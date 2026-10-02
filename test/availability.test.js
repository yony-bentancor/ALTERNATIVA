'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/lib/dates');
const { computeDaySlots, subtractIntervals, workingRangesForDate } = require('../src/services/availability');

const TZ = 'America/Montevideo';
const baseAv = {
  weekly: [{ day: 1, ranges: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }] }],
  breaks: [],
  exceptions: [],
  timeOff: [],
  blocks: [],
  slotStepMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 0,
  maxAdvanceDays: 60,
};
// Lunes 5 de octubre de 2026, "ahora" = domingo 4 a las 10:00 locales
const MONDAY = '2026-10-05';
const NOW = D.zonedToUtc('2026-10-04', '10:00', TZ);

test('zonedToUtc respeta UTC-3 de Montevideo', () => {
  assert.equal(D.zonedToUtc('2026-10-05', '09:00', TZ).toISOString(), '2026-10-05T12:00:00.000Z');
  assert.equal(D.localParts(new Date('2026-10-05T12:00:00Z'), TZ).timeStr, '09:00');
  assert.equal(D.weekdayOf(MONDAY), 1);
});

test('genera horarios dentro de los rangos semanales', () => {
  const slots = computeDaySlots({ dateStr: MONDAY, availability: baseAv, durationMinutes: 60, now: NOW, tz: TZ });
  const times = slots.map((s) => s.time);
  assert.deepEqual(times.slice(0, 3), ['09:00', '09:30', '10:00']);
  assert.ok(times.includes('12:00'));
  assert.ok(!times.includes('12:30'), 'una sesión de 60 min a las 12:30 terminaría fuera del rango');
  assert.ok(times.includes('14:00'));
  assert.equal(times.at(-1), '17:00');
});

test('no ofrece días sin agenda', () => {
  assert.equal(computeDaySlots({ dateStr: '2026-10-06', availability: baseAv, durationMinutes: 60, now: NOW, tz: TZ }).length, 0);
});

test('las reservas ocupadas y el buffer bloquean horarios', () => {
  const busy = [{ start: D.zonedToUtc(MONDAY, '10:00', TZ), end: D.zonedToUtc(MONDAY, '11:00', TZ) }];
  const slots = computeDaySlots({ dateStr: MONDAY, availability: { ...baseAv, bufferMinutes: 15 }, durationMinutes: 60, busy, now: NOW, tz: TZ }).map((s) => s.time);
  assert.ok(!slots.includes('09:30'), '09:30–10:30 se superpone');
  assert.ok(!slots.includes('09:00'), '09:00–10:00 + 15 min de buffer choca con la reserva de las 10');
  assert.ok(!slots.includes('11:00'), '11:00 está dentro del buffer posterior');
  assert.ok(slots.includes('11:30'));
});

test('respeta la anticipación mínima', () => {
  const now = D.zonedToUtc(MONDAY, '09:10', TZ);
  const slots = computeDaySlots({ dateStr: MONDAY, availability: { ...baseAv, minNoticeMinutes: 120 }, durationMinutes: 60, now, tz: TZ }).map((s) => s.time);
  assert.equal(slots[0], '11:30');
});

test('excepciones, vacaciones, descansos y bloqueos', () => {
  const closed = { ...baseAv, exceptions: [{ date: MONDAY, type: 'closed' }] };
  assert.equal(computeDaySlots({ dateStr: MONDAY, availability: closed, durationMinutes: 60, now: NOW, tz: TZ }).length, 0);

  const custom = { ...baseAv, exceptions: [{ date: MONDAY, type: 'custom', ranges: [{ start: '20:00', end: '22:00' }] }] };
  assert.deepEqual(computeDaySlots({ dateStr: MONDAY, availability: custom, durationMinutes: 60, now: NOW, tz: TZ }).map((s) => s.time), ['20:00', '20:30', '21:00']);

  const vacation = { ...baseAv, timeOff: [{ from: '2026-10-01', to: '2026-10-10' }] };
  assert.equal(computeDaySlots({ dateStr: MONDAY, availability: vacation, durationMinutes: 60, now: NOW, tz: TZ }).length, 0);

  const withBreak = { ...baseAv, breaks: [{ day: 1, start: '10:00', end: '10:30' }] };
  const times = computeDaySlots({ dateStr: MONDAY, availability: withBreak, durationMinutes: 30, now: NOW, tz: TZ }).map((s) => s.time);
  assert.ok(!times.includes('10:00'));
  assert.ok(times.includes('10:30'));

  const blocked = { ...baseAv, blocks: [{ start: D.zonedToUtc(MONDAY, '14:00', TZ), end: D.zonedToUtc(MONDAY, '18:00', TZ) }] };
  assert.equal(computeDaySlots({ dateStr: MONDAY, availability: blocked, durationMinutes: 60, now: NOW, tz: TZ }).filter((s) => s.time >= '14:00').length, 0);
});

test('límite de días hacia adelante y fechas pasadas', () => {
  const av = { ...baseAv, maxAdvanceDays: 3 };
  assert.equal(computeDaySlots({ dateStr: '2026-10-12', availability: av, durationMinutes: 60, now: NOW, tz: TZ }).length, 0);
  assert.equal(computeDaySlots({ dateStr: '2026-09-28', availability: baseAv, durationMinutes: 60, now: NOW, tz: TZ }).length, 0);
});

test('límite diario de reservas', () => {
  const av = { ...baseAv, dailyLimit: 2 };
  assert.equal(computeDaySlots({ dateStr: MONDAY, availability: av, durationMinutes: 60, now: NOW, tz: TZ, bookingsThatDay: 2 }).length, 0);
});

test('subtractIntervals y rangos de trabajo', () => {
  assert.deepEqual(subtractIntervals([{ start: 0, end: 100 }], [{ start: 20, end: 30 }, { start: 90, end: 120 }]), [{ start: 0, end: 20 }, { start: 30, end: 90 }]);
  assert.equal(workingRangesForDate(baseAv, '2026-10-06').reason, 'off');
});
