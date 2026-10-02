'use strict';
// Cálculo automático de horarios disponibles.
// La parte pura (computeDaySlots) no toca la base de datos y está cubierta por tests.
const D = require('../lib/dates');

// ── Intervalos en minutos del día ─────────────────────────
function normalizeRanges(ranges) {
  return (ranges || [])
    .filter((r) => D.isValidTimeStr(r.start) && D.isValidTimeStr(r.end))
    .map((r) => ({ start: D.hhmmToMinutes(r.start), end: r.end === '00:00' ? 24 * 60 : D.hhmmToMinutes(r.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
}

function subtractIntervals(ranges, cuts) {
  let result = ranges.map((r) => ({ ...r }));
  for (const c of cuts) {
    const next = [];
    for (const r of result) {
      if (c.end <= r.start || c.start >= r.end) { next.push(r); continue; }
      if (c.start > r.start) next.push({ start: r.start, end: c.start });
      if (c.end < r.end) next.push({ start: c.end, end: r.end });
    }
    result = next;
  }
  return result;
}

// Rangos de trabajo de una fecha concreta, aplicando vacaciones, excepciones y descansos.
function workingRangesForDate(availability, dateStr) {
  const timeOff = (availability.timeOff || []).some((t) => t.from && t.to && dateStr >= t.from && dateStr <= t.to);
  if (timeOff) return { ranges: [], reason: 'timeoff' };
  const exception = (availability.exceptions || []).find((e) => e.date === dateStr);
  if (exception) {
    if (exception.type === 'closed') return { ranges: [], reason: 'closed' };
    return { ranges: normalizeRanges(exception.ranges), reason: 'custom' };
  }
  const weekday = D.weekdayOf(dateStr);
  const day = (availability.weekly || []).find((w) => w.day === weekday);
  const ranges = normalizeRanges(day ? day.ranges : []);
  const breaks = normalizeRanges((availability.breaks || []).filter((b) => b.day === weekday));
  return { ranges: subtractIntervals(ranges, breaks), reason: ranges.length ? 'weekly' : 'off' };
}

/**
 * Horarios disponibles de un día.
 * @param {object} p
 * @param {string} p.dateStr        fecha local "YYYY-MM-DD"
 * @param {object} p.availability   documento de agenda (plain object)
 * @param {number} p.durationMinutes duración del servicio
 * @param {Array<{start:Date,end:Date}>} p.busy  reservas activas y bloqueos (UTC)
 * @param {Date}   p.now
 * @param {string} p.tz
 * @param {number} [p.maxAdvanceDays] tope propio del servicio
 * @param {number} [p.bookingsThatDay] para aplicar límite diario
 */
function computeDaySlots({ dateStr, availability, durationMinutes, busy = [], now = new Date(), tz = D.DEFAULT_TZ, maxAdvanceDays, bookingsThatDay = 0 }) {
  if (!D.isValidDateStr(dateStr) || !availability || !durationMinutes) return [];
  const today = D.todayStr(tz, now);
  const ahead = D.diffDays(today, dateStr);
  const maxDays = Math.min(availability.maxAdvanceDays || 60, maxAdvanceDays || Infinity);
  if (ahead < 0 || ahead > maxDays) return [];
  if (availability.dailyLimit > 0 && bookingsThatDay >= availability.dailyLimit) return [];

  const { ranges } = workingRangesForDate(availability, dateStr);
  if (!ranges.length) return [];

  const step = Math.max(5, availability.slotStepMinutes || 15);
  const buffer = Math.max(0, availability.bufferMinutes || 0) * 60000;
  const earliest = now.getTime() + Math.max(0, availability.minNoticeMinutes || 0) * 60000;
  const blocks = (availability.blocks || []).map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }));
  const occupied = busy.map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() })).concat(blocks);

  const slots = [];
  for (const r of ranges) {
    for (let t = r.start; t + durationMinutes <= r.end; t += step) {
      const start = D.minutesToUtc(dateStr, t, tz).getTime();
      const end = start + durationMinutes * 60000;
      if (start < earliest) continue;
      // El buffer separa sesiones: se aplica antes y después de cada ocupación.
      const clash = occupied.some((o) => start < o.end + buffer && end + buffer > o.start);
      if (clash) continue;
      slots.push({ time: D.minutesToHHMM(t), start: new Date(start), end: new Date(end) });
    }
  }
  return slots;
}

// Días con al menos un horario libre, para pintar el calendario.
// "busy" puede contener ocupaciones de todo el rango: el choque se evalúa por instante.
function computeRangeSummary({ fromDateStr, days, countByDate = {}, ...rest }) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const dateStr = D.addDays(fromDateStr, i);
    const slots = computeDaySlots({ ...rest, dateStr, bookingsThatDay: countByDate[dateStr] || 0 });
    out.push({ date: dateStr, count: slots.length, first: slots[0]?.time || null });
  }
  return out;
}

// ── Capa con base de datos ────────────────────────────────
async function getAvailabilityFor(specialistId) {
  const { Availability } = require('../models');
  let av = await Availability.findOne({ specialist: specialistId }).lean();
  if (!av) {
    av = (await Availability.create({ specialist: specialistId })).toObject();
  }
  return av;
}

// Reservas que ocupan agenda en un intervalo (las pendientes solo mientras no vencen).
async function loadBusy(specialistId, from, to, { excludeBookingId = null, now = new Date() } = {}) {
  const { Booking } = require('../models');
  const filter = {
    specialist: specialistId,
    start: { $lt: to },
    end: { $gt: from },
    $or: [
      { status: { $in: ['paid', 'confirmed'] } },
      { status: 'pending', paymentDeadline: { $gt: now } },
    ],
  };
  if (excludeBookingId) filter._id = { $ne: excludeBookingId };
  return Booking.find(filter).select('start end status').lean();
}

function groupByLocalDate(items, tz) {
  const busyByDate = {};
  const countByDate = {};
  for (const b of items) {
    const d = D.localParts(b.start, tz).dateStr;
    (busyByDate[d] = busyByDate[d] || []).push(b);
    countByDate[d] = (countByDate[d] || 0) + 1;
  }
  return { busyByDate, countByDate };
}

async function slotsForDate({ specialistId, service, dateStr, now = new Date(), excludeBookingId = null }) {
  const av = await getAvailabilityFor(specialistId);
  const tz = av.timezone || D.DEFAULT_TZ;
  const dayStart = D.zonedToUtc(dateStr, '00:00', tz);
  const dayEnd = D.zonedToUtc(D.addDays(dateStr, 1), '00:00', tz);
  const pad = (av.bufferMinutes || 0) * 60000;
  const busy = await loadBusy(specialistId, new Date(dayStart.getTime() - pad), new Date(dayEnd.getTime() + pad), { excludeBookingId, now });
  const sameDay = busy.filter((b) => D.localParts(b.start, tz).dateStr === dateStr).length;
  return computeDaySlots({
    dateStr, availability: av, durationMinutes: service.durationMinutes, busy, now, tz,
    maxAdvanceDays: service.maxAdvanceDays, bookingsThatDay: sameDay,
  });
}

async function summaryForRange({ specialistId, service, fromDateStr, days = 14, now = new Date() }) {
  const av = await getAvailabilityFor(specialistId);
  const tz = av.timezone || D.DEFAULT_TZ;
  const from = D.zonedToUtc(fromDateStr, '00:00', tz);
  const to = D.zonedToUtc(D.addDays(fromDateStr, days + 1), '00:00', tz);
  const busy = await loadBusy(specialistId, new Date(from.getTime() - 86400000), to, { now });
  const { countByDate } = groupByLocalDate(busy, tz);
  return computeRangeSummary({
    fromDateStr, days, availability: av, durationMinutes: service.durationMinutes, now, tz,
    maxAdvanceDays: service.maxAdvanceDays, countByDate, busy,
  });
}

// Próximo horario libre (para "Volver a reservar" y tarjetas de resultados).
async function nextAvailableSlot({ specialistId, service, now = new Date(), searchDays = 21 }) {
  const av = await getAvailabilityFor(specialistId);
  const tz = av.timezone || D.DEFAULT_TZ;
  const today = D.todayStr(tz, now);
  const summary = await summaryForRange({ specialistId, service, fromDateStr: today, days: searchDays, now });
  const day = summary.find((d) => d.count > 0);
  if (!day) return null;
  return { date: day.date, time: day.first, start: D.zonedToUtc(day.date, day.first, tz) };
}

module.exports = {
  normalizeRanges, subtractIntervals, workingRangesForDate, computeDaySlots, computeRangeSummary,
  getAvailabilityFor, loadBusy, slotsForDate, summaryForRange, nextAvailableSlot, groupByLocalDate,
};
