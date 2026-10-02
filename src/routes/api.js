'use strict';
// API JSON usada por la interfaz (calendario, favoritos, chat, push, estado de pagos).
const express = require('express');
const D = require('../lib/dates');
const { asyncHandler, notFound, forbidden, badRequest } = require('../lib/errors');
const { isObjectId } = require('../lib/validate');
const { requireAuth } = require('../middleware/auth');
const limits = require('../middleware/rateLimit');
const { summaryForRange, slotsForDate } = require('../services/availability');
const messaging = require('../services/messaging');
const M = require('../models');

const router = express.Router();
router.use(limits.api);

async function serviceForCalendar(id) {
  if (!isObjectId(id)) throw notFound();
  const service = await M.Service.findById(id).lean();
  if (!service) throw notFound();
  return service;
}

// Para reprogramar: excluye la propia reserva (solo si pertenece a quien consulta)
async function excludeFor(req, service) {
  const id = req.query.excluir;
  if (!id || !req.user || !isObjectId(id)) return null;
  const b = await M.Booking.findById(id).select('user specialist service').lean();
  if (!b || String(b.service) !== String(service._id)) return null;
  const isUser = String(b.user) === String(req.user._id);
  const isSpecialist = req.user.specialist && String(b.specialist) === String(req.user.specialist);
  return isUser || isSpecialist || req.user.role === 'admin' ? b._id : null;
}

router.get('/disponibilidad/:serviceId', asyncHandler(async (req, res) => {
  const service = await serviceForCalendar(req.params.serviceId);
  const from = D.isValidDateStr(req.query.desde) ? req.query.desde : D.todayStr();
  const days = Math.min(62, Math.max(1, parseInt(req.query.dias, 10) || 42));
  const exclude = await excludeFor(req, service);
  let result;
  if (exclude) {
    // La reserva propia no debe bloquear su propio horario al reprogramar
    result = [];
    for (let i = 0; i < days; i++) {
      const date = D.addDays(from, i);
      const slots = await slotsForDate({ specialistId: service.specialist, service, dateStr: date, excludeBookingId: exclude });
      result.push({ date, count: slots.length, first: slots[0]?.time || null });
    }
  } else {
    result = await summaryForRange({ specialistId: service.specialist, service, fromDateStr: from, days });
  }
  res.set('Cache-Control', 'no-store').json({ days: result });
}));

router.get('/horarios/:serviceId', asyncHandler(async (req, res) => {
  const service = await serviceForCalendar(req.params.serviceId);
  if (!D.isValidDateStr(req.query.fecha)) throw badRequest('Fecha no válida');
  const exclude = await excludeFor(req, service);
  const slots = await slotsForDate({ specialistId: service.specialist, service, dateStr: req.query.fecha, excludeBookingId: exclude });
  res.set('Cache-Control', 'no-store').json({ date: req.query.fecha, slots: slots.map((s) => ({ time: s.time, start: s.start })) });
}));

// Favoritos (alternar)
router.post('/favoritos', requireAuth, asyncHandler(async (req, res) => {
  const { kind, id, on } = req.body || {};
  if (!['service', 'specialist'].includes(kind) || !isObjectId(id)) throw badRequest('Datos no válidos');
  const filter = { user: req.user._id, kind, specialist: null, service: null };
  if (kind === 'service') {
    const s = await M.Service.findById(id).select('specialist').lean();
    if (!s) throw notFound();
    filter.service = s._id;
    filter.specialist = s.specialist;
  } else {
    if (!(await M.Specialist.exists({ _id: id }))) throw notFound();
    filter.specialist = id;
  }
  const exists = await M.Favorite.findOne(filter);
  let state;
  if (on === false || (on === undefined && exists)) {
    if (exists) await exists.deleteOne();
    state = false;
  } else {
    if (!exists) {
      await M.Favorite.create(filter).catch((err) => { if (err.code !== 11000) throw err; });
      await M.StatDaily.updateOne({ specialist: filter.specialist, service: null, date: D.todayStr() }, { $inc: { favorites: 1 } }, { upsert: true }).catch(() => {});
    }
    state = true;
  }
  res.json({ on: state });
}));

router.get('/notificaciones/contador', requireAuth, asyncHandler(async (req, res) => {
  const n = await M.Notification.countDocuments({ user: req.user._id, readAt: null });
  res.json({ unread: n });
}));

// Push
router.post('/push', requireAuth, asyncHandler(async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || !keys?.p256dh || !keys?.auth) throw badRequest('Suscripción no válida');
  await M.User.updateOne({ _id: req.user._id }, { $pull: { pushSubscriptions: { endpoint } } });
  await M.User.updateOne({ _id: req.user._id }, {
    $push: { pushSubscriptions: { $each: [{ endpoint, keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) }, userAgent: String(req.get('user-agent') || '').slice(0, 200) }], $slice: -5 } },
  });
  res.json({ ok: true });
}));

router.delete('/push', requireAuth, asyncHandler(async (req, res) => {
  await M.User.updateOne({ _id: req.user._id }, { $pull: { pushSubscriptions: { endpoint: String(req.body?.endpoint || '') } } });
  res.json({ ok: true });
}));

// Chat
async function conversationFor(req, id) {
  if (!isObjectId(id)) throw notFound();
  const conv = await M.Conversation.findById(id);
  if (!conv) throw notFound();
  const role = messaging.participantRole(conv, req.user);
  if (!role || role === 'admin') throw forbidden();
  return { conv, role };
}

function serializeMessage(m, viewerId, allowed) {
  return {
    id: m._id, at: m.createdAt.toISOString(), time: D.fmtTime(m.createdAt),
    body: messaging.displayBody(m, viewerId, allowed), mine: String(m.sender) === String(viewerId),
  };
}

router.get('/mensajes/:id', requireAuth, asyncHandler(async (req, res) => {
  const { conv, role } = await conversationFor(req, req.params.id);
  const since = req.query.desde ? new Date(req.query.desde) : null;
  const filter = { conversation: conv._id };
  if (since && !Number.isNaN(since.getTime())) filter.createdAt = { $gt: since };
  const list = await M.Message.find(filter).sort({ createdAt: 1 }).limit(100).lean();
  if (list.some((m) => String(m.sender) !== String(req.user._id))) await messaging.markRead(conv, role);
  const allowed = await messaging.contactAllowed(conv);
  res.json({ messages: list.map((m) => serializeMessage(m, req.user._id, allowed)) });
}));

router.post('/mensajes/:id', requireAuth, asyncHandler(async (req, res) => {
  const { conv } = await conversationFor(req, req.params.id);
  const { msg, maskedForOthers } = await messaging.sendMessage({ conversation: conv, sender: req.user, body: req.body?.body });
  res.json({
    message: serializeMessage(msg, req.user._id, true),
    notice: maskedForOthers ? 'Los datos de contacto se comparten después de la primera reserva. La otra persona verá ese dato oculto.' : null,
  });
}));

// Estado de pago (para la pantalla de retorno)
router.get('/pagos/:id/estado', requireAuth, asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const p = await M.Payment.findById(req.params.id).lean();
  if (!p || String(p.user) !== String(req.user._id)) throw notFound();
  const b = await M.Booking.findById(p.booking).select('status').lean();
  const final = ['approved', 'rejected', 'cancelled'].includes(p.status) || ['paid', 'confirmed', 'refunded', 'expired'].includes(b?.status);
  const redirect = ['paid', 'confirmed'].includes(b?.status) ? `/mi/reservas/${b._id}?nueva=1` : p.status === 'pending' ? null : `/pago/retorno?pago=${p._id}&resultado=error`;
  res.json({ status: p.status, bookingStatus: b?.status, final: final && !!redirect, redirect });
}));

module.exports = router;
