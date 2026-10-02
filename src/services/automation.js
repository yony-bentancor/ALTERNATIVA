'use strict';
// Automatizaciones: el objetivo es que nadie tenga que gestionar reservas a mano.
// Se ejecutan con Heroku Scheduler (npm run jobs) o dentro del proceso web.
const D = require('../lib/dates');
const logger = require('../lib/logger');
const { getSettings } = require('./settings');
const { notify } = require('./notifications');

async function sendReminders(now = new Date()) {
  const { Booking } = require('../models');
  const settings = await getSettings();
  let sent = 0;
  const windows = [
    { hours: settings.notifications.reminderHoursBefore, field: 'reminders.dayBeforeAt', key: 'r1' },
    { hours: settings.notifications.secondReminderHoursBefore, field: 'reminders.hourBeforeAt', key: 'r2' },
  ].filter((w) => w.hours > 0);
  for (const w of windows) {
    const limit = new Date(now.getTime() + w.hours * 3600000);
    const due = await Booking.find({ status: { $in: ['paid', 'confirmed'] }, start: { $gt: now, $lte: limit }, [w.field]: null }).limit(500).lean();
    for (const b of due) {
      // Si la reserva se hizo dentro de la ventana, el primer recordatorio no tiene sentido
      if (w.key === 'r1' && b.createdAt > new Date(b.start.getTime() - w.hours * 3600000)) {
        await Booking.updateOne({ _id: b._id }, { $set: { [w.field]: now } });
        continue;
      }
      const when = D.fmtDateTime(b.start);
      const place = b.modality === 'online' ? 'Online' : b.modality === 'domicilio' ? 'A domicilio' : (b.place?.address || 'En consultorio');
      await notify(b.user, {
        type: 'booking_reminder', title: 'Tu próxima sesión',
        body: `${b.snapshot.serviceTitle} con ${b.snapshot.specialistName} · ${when} · ${place}`,
        link: `/mi/reservas/${b._id}`, dedupeKey: `${w.key}:${b._id}`,
      });
      await Booking.updateOne({ _id: b._id }, { $set: { [w.field]: now } });
      sent++;
    }
  }
  return sent;
}

// Cierre automático: si nadie reportó problemas, la sesión pasa a "realizada".
async function autoComplete(now = new Date()) {
  const { Booking } = require('../models');
  const { markCompleted } = require('./bookings');
  const settings = await getSettings();
  const limit = new Date(now.getTime() - settings.automation.autoCompleteAfterHours * 3600000);
  const due = await Booking.find({ status: { $in: ['paid', 'confirmed'] }, end: { $lte: limit }, 'incident.open': { $ne: true } }).limit(500);
  for (const b of due) {
    await markCompleted(b, { actorRole: 'system', now }).catch((err) => logger.warn('autoComplete', { booking: b.code, err }));
  }
  return due.length;
}

async function requestReviews(now = new Date()) {
  const { Booking } = require('../models');
  const settings = await getSettings();
  const limit = new Date(now.getTime() - settings.reviews.requestAfterHours * 3600000);
  const due = await Booking.find({ status: 'completed', reviewed: false, reviewRequestedAt: null, end: { $lte: limit } }).limit(500).lean();
  for (const b of due) {
    await notify(b.user, {
      type: 'review_request', title: '¿Cómo te fue en tu sesión?',
      body: `Contanos qué te pareció ${b.snapshot.serviceTitle} con ${b.snapshot.specialistName}. Tu reseña verificada ayuda a otras personas.`,
      link: `/mi/reservas/${b._id}/valorar`, ctaLabel: 'Valorar sesión', dedupeKey: `review:${b._id}`,
    });
    await Booking.updateOne({ _id: b._id }, { $set: { reviewRequestedAt: now } });
  }
  return due.length;
}

// Recordatorio para volver a reservar (recurrencia), solo si no reservó de nuevo.
async function rebookReminders(now = new Date()) {
  const { Booking } = require('../models');
  const settings = await getSettings();
  const days = settings.notifications.rebookAfterDays;
  if (!days) return 0;
  const limit = new Date(now.getTime() - days * 86400000);
  const due = await Booking.find({ status: 'completed', rebookReminderAt: null, end: { $lte: limit, $gte: new Date(limit.getTime() - 14 * 86400000) } }).limit(500).lean();
  let sent = 0;
  for (const b of due) {
    const newer = await Booking.exists({ user: b.user, specialist: b.specialist, start: { $gt: b.start }, status: { $in: ['pending', 'paid', 'confirmed', 'completed'] } });
    if (!newer) {
      await notify(b.user, {
        type: 'rebook_reminder', title: `¿Repetimos ${b.snapshot.serviceTitle}?`,
        body: `Pasaron ${days} días desde tu sesión con ${b.snapshot.specialistName}. Mirá sus próximos horarios.`,
        link: `/mi/reservas/${b._id}/volver`, ctaLabel: 'Ver horarios', dedupeKey: `rebook:${b._id}`,
        channels: { whatsapp: false },
      });
      sent++;
    }
    await Booking.updateOne({ _id: b._id }, { $set: { rebookReminderAt: now } });
  }
  return sent;
}

async function rollSponsoredAndPromotions(now = new Date()) {
  const { SponsoredPlacement, Promotion, Specialist } = require('../models');
  const a = await SponsoredPlacement.updateMany({ status: 'scheduled', startsAt: { $lte: now }, endsAt: { $gte: now } }, { $set: { status: 'active' } });
  const b = await SponsoredPlacement.updateMany({ status: { $in: ['active', 'scheduled'] }, endsAt: { $lt: now } }, { $set: { status: 'ended' } });
  const c = await Promotion.updateMany({ status: 'active', validTo: { $lt: now } }, { $set: { status: 'ended' } });
  const d = await Specialist.updateMany({ plan: 'profesional', planExpiresAt: { $lt: now } }, { $set: { plan: 'free' } });
  return { activated: a.modifiedCount, ended: b.modifiedCount, promotionsEnded: c.modifiedCount, plansExpired: d.modifiedCount };
}

// Actualiza la marca "Nuevo en Alternativa" de quienes cruzaron el umbral de días.
async function refreshNewcomers(now = new Date()) {
  const { Specialist } = require('../models');
  const { syncSearchForSpecialist } = require('./specialists');
  const settings = await getSettings();
  const edge = new Date(now.getTime() - settings.discovery.newcomerDays * 86400000);
  const list = await Specialist.find({ status: 'active', publishedAt: { $lte: edge, $gte: new Date(edge.getTime() - 3 * 86400000) } }).select('_id').lean();
  for (const s of list) {
    await syncSearchForSpecialist(s._id);
  }
  return list.length;
}

async function runAll({ now = new Date() } = {}) {
  const { expirePending } = require('./bookings');
  const { reconcile } = require('./payments');
  const results = {};
  const steps = {
    expirePending: () => expirePending(now),
    reconcilePayments: () => reconcile({ now }),
    reminders: () => sendReminders(now),
    autoComplete: () => autoComplete(now),
    reviewRequests: () => requestReviews(now),
    rebookReminders: () => rebookReminders(now),
    sponsoredAndPromotions: () => rollSponsoredAndPromotions(now),
    newcomers: () => refreshNewcomers(now),
  };
  for (const [name, fn] of Object.entries(steps)) {
    try {
      results[name] = await fn();
    } catch (err) {
      results[name] = `error: ${err.message}`;
      logger.error(`Job ${name} falló`, { err });
    }
  }
  logger.info('Automatizaciones ejecutadas', results);
  return results;
}

let timer = null;
function startInProcess(intervalMs = 5 * 60000) {
  if (timer) return;
  const tick = () => runAll().catch((err) => logger.error('runAll', { err }));
  timer = setInterval(tick, intervalMs);
  timer.unref();
  setTimeout(tick, 15000).unref();
}

module.exports = { sendReminders, autoComplete, requestReviews, rebookReminders, rollSponsoredAndPromotions, refreshNewcomers, runAll, startInProcess };
