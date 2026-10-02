'use strict';
const express = require('express');
const config = require('../config');
const D = require('../lib/dates');
const { asyncHandler, notFound, forbidden, badRequest } = require('../lib/errors');
const { validate, isObjectId } = require('../lib/validate');
const { requireAuth } = require('../middleware/auth');
const limits = require('../middleware/rateLimit');
const bookings = require('../services/bookings');
const payments = require('../services/payments');
const { slotsForDate } = require('../services/availability');
const { describePolicy } = require('../services/cancellation');
const { track } = require('../services/stats');
const logger = require('../lib/logger');
const V = require('../views/booking');
const M = require('../models');

const router = express.Router();

async function loadBookable(serviceId) {
  if (!isObjectId(serviceId)) throw notFound();
  const service = await M.Service.findById(serviceId).populate('category', 'name slug').lean();
  if (!service || !service.search?.visible) throw notFound('Este servicio no está disponible para reservar.');
  const specialist = await M.Specialist.findById(service.specialist).lean();
  if (!specialist || specialist.status !== 'active' || !specialist.user) throw notFound('Este especialista no está recibiendo reservas online.');
  const avatar = specialist.avatar ? await M.Media.findOne({ _id: specialist.avatar, status: 'approved' }).lean() : null;
  return { service, specialist, avatar };
}

const modalitiesOf = (service, specialist) => (service.modalities?.length ? service.modalities : specialist.modalities || []);

// Paso 1: fecha y hora
router.get('/reservar/:serviceId', asyncHandler(async (req, res) => {
  const { service, specialist, avatar } = await loadBookable(req.params.serviceId);
  const mods = modalitiesOf(service, specialist);
  const modality = mods.includes(req.query.modalidad) ? req.query.modalidad : (mods.includes(req.user?.preferences?.lastModality) ? req.user.preferences.lastModality : mods[0]);
  await track({ specialist: specialist._id, service: service._id, field: 'availabilityChecks', req });
  res.page(V.pickTime, { service, specialist, avatar, modalities: mods, modality, today: D.todayStr(), selected: D.isValidDateStr(req.query.fecha) ? req.query.fecha : '' });
}));

// Paso 2: confirmación (revalida el horario en el backend)
router.get('/reservar/:serviceId/confirmar', requireAuth, asyncHandler(async (req, res) => {
  const { service, specialist, avatar } = await loadBookable(req.params.serviceId);
  const { fecha, hora } = req.query;
  if (!D.isValidDateStr(fecha) || !D.isValidTimeStr(hora)) return res.redirect(`/reservar/${service._id}`);
  const mods = modalitiesOf(service, specialist);
  const modality = mods.includes(req.query.modalidad) ? req.query.modalidad : mods[0];
  const slots = await slotsForDate({ specialistId: specialist._id, service, dateStr: fecha });
  const slot = slots.find((s) => s.time === hora);
  if (!slot) {
    req.flash('error', 'Ese horario ya no está disponible. Elegí otro, por favor.');
    return res.redirect(`/reservar/${service._id}?fecha=${fecha}&modalidad=${modality}`);
  }
  const quote = await bookings.quote({ service, specialist, user: req.user, modality, promoCode: req.query.codigo });
  return res.page(V.confirm, {
    service, specialist, avatar, slot, fecha, hora, modality, modalities: mods, quote,
    promoCode: req.query.codigo || '', policy: describePolicy(quote.settings.cancellation),
    address: req.user.preferences?.homeAddress || '',
  });
}));

// Crea la reserva y envía directo al pago (un solo paso para el usuario)
router.post('/reservar/:serviceId', requireAuth, limits.booking, asyncHandler(async (req, res) => {
  const { data, ok, errors } = validate(req.body, {
    fecha: { type: 'date', required: true },
    hora: { type: 'time', required: true },
    modalidad: { type: 'enum', values: ['presencial', 'domicilio', 'online'], required: true },
    direccion: { type: 'string', max: 300 },
    notas: { type: 'text', max: 1000 },
    codigo: { type: 'string', max: 40 },
    rebookOf: { type: 'objectId' },
  });
  if (!ok) throw badRequest(Object.values(errors)[0]);
  let booking;
  try {
    booking = await bookings.createBooking({
      user: req.user, serviceId: req.params.serviceId, dateStr: data.fecha, time: data.hora, modality: data.modalidad,
      address: data.direccion, notes: data.notas, promoCode: data.codigo, rebookOf: data.rebookOf,
    });
  } catch (err) {
    if (err.code === 'slot_taken') {
      req.flash('error', err.message);
      return res.redirect(`/reservar/${req.params.serviceId}?fecha=${data.fecha}&modalidad=${data.modalidad}`);
    }
    throw err;
  }
  if (booking.status !== 'pending') return res.redirect(`/mi/reservas/${booking._id}?nueva=1`);
  try {
    const payment = await payments.startPayment(booking, req.user);
    return res.redirect(303, payment.checkoutUrl);
  } catch (err) {
    logger.warn('Checkout no iniciado; se ofrece reintento', { booking: booking.code, err });
    req.flash('error', err.message);
    return res.redirect(`/pago/${booking._id}`);
  }
}));

async function ownBooking(req, id) {
  if (!isObjectId(id)) throw notFound();
  const booking = await M.Booking.findById(id);
  if (!booking) throw notFound();
  if (String(booking.user) !== String(req.user._id)) throw forbidden();
  return booking;
}

// Regreso desde la pasarela: se consulta el estado sin esperar el webhook.
router.get('/pago/retorno', requireAuth, asyncHandler(async (req, res) => {
  const paymentId = req.query.pago;
  if (!isObjectId(paymentId)) return res.redirect('/mi/reservas');
  const payment = await M.Payment.findById(paymentId);
  if (!payment || String(payment.user) !== String(req.user._id)) throw notFound();
  const providerPaymentId = req.query.payment_id || req.query.collection_id;
  if (providerPaymentId && payment.status === 'pending' && /^\d+$/.test(String(providerPaymentId))) {
    try {
      const info = await payments.provider(payment.provider).fetchPayment(String(providerPaymentId), { payment });
      if (info.externalReference === String(payment._id)) await payments.applyProviderStatus(payment, info);
    } catch (err) {
      logger.warn('No se pudo consultar el pago al volver', { err });
    }
  }
  const fresh = await M.Payment.findById(paymentId).lean();
  const booking = await M.Booking.findById(fresh.booking).lean();
  if (['paid', 'confirmed'].includes(booking.status)) return res.redirect(`/mi/reservas/${booking._id}?nueva=1`);
  return res.page(V.paymentReturn, { payment: fresh, booking, result: req.query.resultado });
}));

// Pantalla de pago pendiente (reintento, cuenta regresiva)
router.get('/pago/:bookingId', requireAuth, asyncHandler(async (req, res) => {
  const booking = await ownBooking(req, req.params.bookingId);
  if (booking.status !== 'pending') return res.redirect(`/mi/reservas/${booking._id}`);
  const payment = booking.payment ? await M.Payment.findById(booking.payment).lean() : null;
  res.page(V.payment, { booking, payment });
}));

router.post('/pago/:bookingId', requireAuth, limits.booking, asyncHandler(async (req, res) => {
  const booking = await ownBooking(req, req.params.bookingId);
  const payment = await payments.startPayment(booking, req.user);
  res.redirect(303, payment.checkoutUrl);
}));

// Pasarela simulada (desarrollo/staging)
router.get('/pago/simulado/:paymentId', requireAuth, asyncHandler(async (req, res) => {
  if (config.isLive) throw notFound();
  const payment = await M.Payment.findById(req.params.paymentId).lean();
  if (!payment || String(payment.user) !== String(req.user._id)) throw notFound();
  const booking = await M.Booking.findById(payment.booking).lean();
  res.page(V.simulatedCheckout, { payment, booking });
}));

router.post('/pago/simulado/:paymentId', requireAuth, asyncHandler(async (req, res) => {
  if (config.isLive) throw notFound();
  const payment = await M.Payment.findById(req.params.paymentId);
  if (!payment || String(payment.user) !== String(req.user._id)) throw notFound();
  const status = req.body.result === 'approved' ? 'approved' : 'rejected';
  const info = await payments.provider('simulated').fetchPayment(`SIM-${payment._id}:${status}`, { payment });
  await payments.applyProviderStatus(payment, info);
  res.redirect(`/pago/retorno?pago=${payment._id}&resultado=${status === 'approved' ? 'ok' : 'error'}`);
}));

module.exports = router;
