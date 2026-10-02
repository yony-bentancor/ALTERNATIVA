'use strict';
// Liquidaciones para los modelos que no usan split:
// - platform: Alternativa cobró y transfiere al especialista su neto.
// - offline: el especialista cobró y le debe a Alternativa la comisión.
// En el modelo split no hay liquidaciones: la pasarela ya dividió el dinero.
const { badRequest, notFound } = require('../lib/errors');
const { notify } = require('./notifications');

async function settleableBySpecialist(until) {
  const { Payment, Booking, Refund } = require('../models');
  const payments = await Payment.find({
    collectionModel: { $in: ['platform', 'offline'] },
    'settlement.status': 'pending',
    status: { $in: ['approved', 'partially_refunded', 'refunded', 'offline'] },
    createdAt: { $lte: until },
  }).lean();
  const bookingIds = payments.map((p) => p.booking);
  const bookings = await Booking.find({ _id: { $in: bookingIds } }).select('status start').lean();
  const bMap = new Map(bookings.map((b) => [String(b._id), b]));
  const refunds = await Refund.find({ payment: { $in: payments.map((p) => p._id) }, status: { $in: ['processed', 'manual'] } }).lean();
  const rMap = new Map();
  for (const r of refunds) {
    const cur = rMap.get(String(r.payment)) || { commission: 0, specialist: 0, amount: 0 };
    cur.commission += r.commissionReversed; cur.specialist += r.specialistReversed; cur.amount += r.amount;
    rMap.set(String(r.payment), cur);
  }
  const groups = new Map();
  for (const p of payments) {
    const b = bMap.get(String(p.booking));
    // Solo se liquida lo que ya no puede cambiar: sesión realizada, ausencia o cancelación cerrada.
    if (!b || ['pending', 'paid', 'confirmed'].includes(b.status)) continue;
    const key = `${p.specialist}:${p.collectionModel}`;
    const g = groups.get(key) || { specialist: p.specialist, model: p.collectionModel, payments: [], gross: 0, commission: 0, refunds: 0, specialistNet: 0 };
    const rf = rMap.get(String(p._id)) || { commission: 0, specialist: 0, amount: 0 };
    g.payments.push(p._id);
    g.gross += p.amount;
    g.refunds += rf.amount;
    g.commission += p.commissionAmount - (p.collectionModel === 'platform' ? rf.commission : 0);
    g.specialistNet += p.specialistAmount - rf.specialist;
    groups.set(key, g);
  }
  return [...groups.values()];
}

async function generatePayouts({ until = new Date(), admin }) {
  const { Payout, Payment } = require('../models');
  const groups = await settleableBySpecialist(until);
  const created = [];
  for (const g of groups) {
    const direction = g.model === 'offline' ? 'to_platform' : 'to_specialist';
    const net = direction === 'to_platform' ? g.commission : g.specialistNet;
    if (net <= 0) continue;
    const payout = await Payout.create({
      specialist: g.specialist, direction, periodTo: until, payments: g.payments, bookingsCount: g.payments.length,
      gross: g.gross, commission: g.commission, refunds: g.refunds, net, status: 'pending', createdBy: admin?._id,
    });
    await Payment.updateMany({ _id: { $in: g.payments } }, { $set: { 'settlement.status': 'included', 'settlement.payout': payout._id } });
    created.push(payout);
  }
  return created;
}

async function markPayoutPaid(payoutId, { reference, admin }) {
  const { Payout, Payment, Specialist } = require('../models');
  const payout = await Payout.findById(payoutId);
  if (!payout) throw notFound();
  if (payout.status !== 'pending') throw badRequest('La liquidación no está pendiente.');
  payout.status = 'paid';
  payout.reference = String(reference || '').slice(0, 120);
  payout.paidAt = new Date();
  payout.paidBy = admin._id;
  await payout.save();
  await Payment.updateMany({ _id: { $in: payout.payments } }, { $set: { 'settlement.status': 'settled', 'settlement.settledAt': new Date() } });
  const sp = await Specialist.findById(payout.specialist).select('user').lean();
  if (sp?.user) {
    await notify(sp.user, {
      type: 'payout_paid',
      title: payout.direction === 'to_specialist' ? 'Te transferimos tu liquidación' : 'Registramos tu pago de comisiones',
      body: `Liquidación por ${payout.net.toLocaleString('es-UY')} UYU (${payout.bookingsCount} reservas). Referencia: ${payout.reference || '—'}.`,
      link: '/panel/ingresos',
    });
  }
  return payout;
}

async function cancelPayout(payoutId) {
  const { Payout, Payment } = require('../models');
  const payout = await Payout.findById(payoutId);
  if (!payout) throw notFound();
  if (payout.status !== 'pending') throw badRequest('Solo se pueden anular liquidaciones pendientes.');
  payout.status = 'cancelled';
  await payout.save();
  await Payment.updateMany({ _id: { $in: payout.payments } }, { $set: { 'settlement.status': 'pending' }, $unset: { 'settlement.payout': 1 } });
  return payout;
}

module.exports = { settleableBySpecialist, generatePayouts, markPayoutPaid, cancelPayout };
