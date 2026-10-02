'use strict';
// Orquestación de pagos: inicio del checkout, actualización por webhooks, reembolsos,
// contracargos y conciliación. Independiente del proveedor (ver simulated.js / mercadopago.js).
const config = require('../../config');
const logger = require('../../lib/logger');
const { badRequest, notFound } = require('../../lib/errors');
const { notifyAdmins, notify } = require('../notifications');

const providers = {
  simulated: require('./simulated'),
  mercadopago: require('./mercadopago'),
};

function provider(name = config.payments.provider) {
  const p = providers[name];
  if (!p) throw new Error(`Proveedor de pagos desconocido: ${name}`);
  return p;
}

const bookings = () => require('../bookings');

// Crea (o reutiliza) el pago de una reserva y devuelve la URL de checkout.
async function startPayment(booking, user) {
  const { Payment, Specialist } = require('../../models');
  if (booking.status !== 'pending') throw badRequest('Esta reserva no tiene un pago pendiente.');
  if (booking.paymentDeadline && booking.paymentDeadline < new Date()) throw badRequest('El tiempo para pagar venció. Elegí el horario nuevamente.');
  const model = booking.snapshot.collectionModel;

  let payment = booking.payment ? await Payment.findById(booking.payment) : null;
  if (payment && payment.status === 'pending' && payment.checkoutUrl) return payment;

  payment = await Payment.create({
    booking: booking._id, user: booking.user, specialist: booking.specialist,
    provider: config.payments.provider, collectionModel: model,
    amount: booking.snapshot.total, currency: booking.snapshot.currency,
    commissionAmount: booking.snapshot.commissionAmount,
    specialistAmount: booking.snapshot.specialistNet,
    marketplaceFee: booking.snapshot.marketplaceFee,
    providerFeeEstimate: booking.snapshot.processorFeeEstimate,
    status: 'pending',
    settlement: { status: model === 'split' ? 'not_applicable' : 'pending' },
    events: [{ type: 'created' }],
  });
  const specialist = await Specialist.findById(booking.specialist).lean();
  try {
    const { checkoutUrl, preferenceId } = await provider().createCheckout({ booking, payment, user, specialist, collectionModel: model });
    payment.checkoutUrl = checkoutUrl;
    payment.preferenceId = preferenceId;
    await payment.save();
  } catch (err) {
    payment.status = 'cancelled';
    payment.statusDetail = String(err.message).slice(0, 200);
    payment.events.push({ type: 'checkout_error', data: { message: err.message } });
    await payment.save();
    logger.error('No se pudo iniciar el checkout', { booking: booking.code, err });
    throw badRequest('No pudimos iniciar el pago en este momento. Probá de nuevo en unos minutos.');
  }
  const { Booking } = require('../../models');
  await Booking.updateOne({ _id: booking._id }, { $set: { payment: payment._id } });
  return payment;
}

// Aplica el estado informado por la pasarela. Idempotente: se puede llamar varias veces.
async function applyProviderStatus(payment, info) {
  const { Booking } = require('../../models');
  const prev = payment.status;
  payment.providerPaymentId = info.id || payment.providerPaymentId;
  payment.statusDetail = info.statusDetail;
  payment.method = info.method || payment.method;
  if (info.providerFee !== undefined) payment.providerFee = info.providerFee;
  if (info.marketplaceFee) payment.marketplaceFee = info.marketplaceFee;
  if (info.collectorId) payment.collectorId = info.collectorId;
  payment.lastSyncedAt = new Date();
  payment.events.push({ type: 'provider_status', data: { status: info.status, detail: info.statusDetail } });

  const booking = await Booking.findById(payment.booking);
  if (!booking) { await payment.save(); return payment; }

  if (info.status === 'approved' && prev !== 'approved' && !['refunded', 'partially_refunded'].includes(prev)) {
    payment.status = 'approved';
    payment.paidAt = info.paidAt || new Date();
    await payment.save();
    await bookings().markPaid(booking, payment);
    return payment;
  }
  if (['rejected', 'cancelled'].includes(info.status) && prev === 'pending') {
    payment.status = info.status;
    await payment.save();
    return payment;
  }
  if (info.status === 'refunded' && prev !== 'refunded') {
    // Reembolso hecho desde la cuenta de Mercado Pago (fuera de Alternativa): se registra y se avisa.
    payment.status = 'refunded';
    payment.refundedAmount = info.refundedAmount || payment.amount;
    await payment.save();
    if (!['cancelled_user', 'cancelled_specialist', 'refunded'].includes(booking.status)) {
      booking.incident = { open: true, note: 'Reembolso realizado fuera de Alternativa', at: new Date() };
      await booking.save();
      await notifyAdmins({ title: 'Reembolso externo detectado', body: `La reserva ${booking.code} fue reembolsada desde la pasarela. Revisá el estado.`, link: `/admin/reservas/${booking._id}`, dedupeKey: `ext-refund:${payment._id}` });
    }
    return payment;
  }
  if (['charged_back', 'in_mediation'].includes(info.status) && prev !== info.status) {
    payment.status = info.status;
    payment.chargeback = { status: info.status, amount: payment.amount, at: new Date() };
    await payment.save();
    booking.incident = { open: true, note: info.status === 'charged_back' ? 'Contracargo del medio de pago' : 'Pago en disputa', at: new Date() };
    await booking.save();
    await notifyAdmins({
      title: info.status === 'charged_back' ? 'Contracargo recibido' : 'Pago en disputa',
      body: `Reserva ${booking.code} · ${booking.snapshot.specialistName}. Requiere revisión y documentación.`,
      link: `/admin/reservas/${booking._id}`,
      dedupeKey: `cb:${payment._id}:${info.status}`,
    });
    return payment;
  }
  await payment.save();
  return payment;
}

// Webhook de la pasarela (Mercado Pago u otra).
async function handleWebhook(providerName, req) {
  const { Payment } = require('../../models');
  const p = provider(providerName);
  if (!p.verifyWebhook(req)) {
    logger.warn('Webhook con firma inválida', { provider: providerName, ip: req.ip });
    return { ok: false, status: 401 };
  }
  const type = req.query.type || req.query.topic || req.body?.type || req.body?.topic;
  const dataId = req.query['data.id'] || req.query.id || req.body?.data?.id;
  if (!dataId) return { ok: true, ignored: 'sin id' };

  if (type === 'payment') {
    let payment = await Payment.findOne({ providerPaymentId: String(dataId) });
    if (!payment && req.query.pago && /^[a-f\d]{24}$/i.test(req.query.pago)) payment = await Payment.findById(req.query.pago);
    const info = await p.fetchPayment(String(dataId), { payment });
    if (!payment && info.externalReference && /^[a-f\d]{24}$/i.test(info.externalReference)) payment = await Payment.findById(info.externalReference);
    if (!payment) {
      logger.warn('Webhook de pago sin pago asociado', { dataId });
      return { ok: true, ignored: 'pago desconocido' };
    }
    await applyProviderStatus(payment, info);
    return { ok: true };
  }
  if (type === 'chargebacks' && p.fetchChargeback) {
    const cb = await p.fetchChargeback(String(dataId));
    for (const pid of (cb.payments || []).map(String)) {
      const payment = await Payment.findOne({ providerPaymentId: pid });
      if (payment) {
        await applyProviderStatus(payment, { id: pid, status: 'charged_back', statusDetail: cb.coverage_applied ? 'cubierto' : cb.status });
        payment.chargeback = { id: String(dataId), status: cb.status, amount: cb.amount, at: new Date() };
        await payment.save();
      }
    }
    return { ok: true };
  }
  return { ok: true, ignored: type };
}

/**
 * Ejecuta un reembolso en la pasarela y registra el resultado.
 * Si la pasarela lo rechaza (p.ej. el especialista no tiene saldo en un split),
 * queda como incidencia y se alerta a administración: requiere intervención humana.
 */
async function executeRefund({ booking, payment, split, percent, reason, rule, actor, actorRole }) {
  const { Refund, Ticket, Counter } = require('../../models');
  if (!payment || split.amount <= 0) return null;
  const refund = await Refund.create({
    booking: booking._id, payment: payment._id, user: booking.user, specialist: booking.specialist,
    amount: split.amount, percent, commissionReversed: split.commissionReversed, specialistReversed: split.specialistReversed,
    reason, rule, initiatedBy: actor?._id, initiatedByRole: actorRole, status: 'pending',
  });

  if (payment.status === 'offline' || payment.provider === 'offline') {
    refund.status = 'manual';
    refund.error = 'Pago cobrado por el especialista: la devolución la hace el especialista.';
    await refund.save();
    return refund;
  }
  try {
    const r = await provider(payment.provider === 'manual' ? config.payments.provider : payment.provider).refund({ payment, amount: split.amount });
    refund.status = 'processed';
    refund.providerRefundId = r.id;
    refund.processedAt = new Date();
    await refund.save();
    payment.refundedAmount = (payment.refundedAmount || 0) + split.amount;
    payment.status = payment.refundedAmount >= payment.amount ? 'refunded' : 'partially_refunded';
    payment.events.push({ type: 'refund', data: { amount: split.amount, id: r.id } });
    await payment.save();
    await notify(booking.user, {
      type: 'refund_processed', title: 'Reembolso procesado',
      body: `Te devolvimos ${split.amount.toLocaleString('es-UY')} UYU por la reserva ${booking.code}. Según tu medio de pago, puede demorar algunos días en verse.`,
      link: `/mi/reservas/${booking._id}`,
    });
  } catch (err) {
    refund.status = 'failed';
    refund.error = String(err.message).slice(0, 300);
    await refund.save();
    booking.incident = { open: true, note: `Reembolso fallido: ${refund.error}`, at: new Date() };
    await booking.save();
    const number = await Counter.next('ticket');
    await Ticket.create({
      number, user: booking.user, booking: booking._id, topic: 'refund', priority: 'high',
      subject: `Reembolso pendiente ${booking.code}`,
      messages: [{ authorRole: 'system', body: `El reembolso automático de ${split.amount} UYU falló: ${refund.error}. Gestionarlo manualmente.` }],
    });
    await notifyAdmins({ title: 'Reembolso fallido', body: `Reserva ${booking.code}: ${refund.error}`, link: `/admin/reembolsos`, dedupeKey: `refund-failed:${refund._id}` });
    logger.error('Reembolso fallido', { booking: booking.code, err });
  }
  return refund;
}

// Reintento manual desde el panel admin.
async function retryRefund(refundId) {
  const { Refund, Payment, Booking } = require('../../models');
  const refund = await Refund.findById(refundId);
  if (!refund) throw notFound();
  if (!['failed', 'pending'].includes(refund.status)) throw badRequest('Este reembolso no está pendiente.');
  const payment = await Payment.findById(refund.payment);
  const booking = await Booking.findById(refund.booking);
  const r = await provider(payment.provider).refund({ payment, amount: refund.amount });
  refund.status = 'processed';
  refund.providerRefundId = r.id;
  refund.processedAt = new Date();
  refund.error = undefined;
  await refund.save();
  payment.refundedAmount = (payment.refundedAmount || 0) + refund.amount;
  payment.status = payment.refundedAmount >= payment.amount ? 'refunded' : 'partially_refunded';
  await payment.save();
  if (booking?.incident?.open) { booking.incident.open = false; await booking.save(); }
  return refund;
}

// Conciliación periódica: pagos pendientes sin webhook, y verificación de aprobados recientes.
async function reconcile({ now = new Date() } = {}) {
  const { Payment } = require('../../models');
  const pending = await Payment.find({
    status: 'pending', provider: { $ne: 'simulated' },
    createdAt: { $lt: new Date(now.getTime() - 3 * 60000), $gt: new Date(now.getTime() - 3 * 86400000) },
  }).limit(100);
  let updated = 0;
  for (const payment of pending) {
    try {
      const p = provider(payment.provider);
      const pid = payment.providerPaymentId || (await p.searchByReference(payment));
      if (!pid) continue;
      const info = await p.fetchPayment(pid, { payment });
      await applyProviderStatus(payment, info);
      updated++;
    } catch (err) {
      logger.warn('reconcile', { payment: String(payment._id), err });
    }
  }
  return { checked: pending.length, updated };
}

module.exports = { provider, providers, startPayment, applyProviderStatus, handleWebhook, executeRefund, retryRefund, reconcile };
