'use strict';
// Reservas: cotización, creación con validación de disponibilidad en backend, bloqueo
// anti doble reserva, pago, confirmación, cancelación, reprogramación, ausencias y cierre.
const D = require('../lib/dates');
const { bookingCode } = require('../lib/tokens');
const { badRequest, conflict, forbidden, notFound } = require('../lib/errors');
const { fmtMoney } = require('../lib/money');
const { isObjectId } = require('../lib/validate');
const { getSettings } = require('./settings');
const { commissionFor, priceBreakdown } = require('./commission');
const { evaluateCancellation, canReschedule, splitRefund } = require('./cancellation');
const { slotsForDate, getAvailabilityFor } = require('./availability');
const { notify } = require('./notifications');

const SLOT_MS = 5 * 60000;
const payments = () => require('./payments');

// ── Bloqueo de agenda ──────────────────────────────────────
function slotKeys(start, end, bufferMinutes = 0) {
  const from = Math.floor(new Date(start).getTime() / SLOT_MS) * SLOT_MS;
  const to = Math.ceil((new Date(end).getTime() + bufferMinutes * 60000) / SLOT_MS) * SLOT_MS;
  const keys = [];
  for (let t = from; t < to; t += SLOT_MS) keys.push(new Date(t));
  return keys;
}

async function lockSlots(booking, { expiresAt = null, bufferMinutes = 0 } = {}) {
  const { BookingSlot } = require('../models');
  const docs = slotKeys(booking.start, booking.end, bufferMinutes).map((slot) => {
    const d = { specialist: booking.specialist, slot, booking: booking._id };
    if (expiresAt) d.expiresAt = expiresAt;
    return d;
  });
  try {
    await BookingSlot.insertMany(docs, { ordered: true });
    return true;
  } catch (err) {
    await BookingSlot.deleteMany({ booking: booking._id });
    if (err && (err.code === 11000 || err.writeErrors?.some?.((e) => e.code === 11000))) return false;
    throw err;
  }
}

async function releaseSlots(bookingId) {
  const { BookingSlot } = require('../models');
  await BookingSlot.deleteMany({ booking: bookingId });
}

async function makeSlotsPermanent(bookingId) {
  const { BookingSlot } = require('../models');
  await BookingSlot.updateMany({ booking: bookingId }, { $unset: { expiresAt: 1 } });
}

// ── Promociones ────────────────────────────────────────────
async function bestPromotion({ service, specialist, user, code, now = new Date() }) {
  const { Promotion, Booking } = require('../models');
  const promos = await Promotion.find({
    status: 'active',
    $and: [
      { $or: [{ specialist: specialist._id }, { specialist: null }] },
      { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
      { $or: [{ validTo: null }, { validTo: { $gte: now } }] },
    ],
  }).lean();
  if (!promos.length) return null;
  let previous = null;
  const candidates = [];
  for (const p of promos) {
    if (p.services?.length && !p.services.some((s) => String(s) === String(service._id))) continue;
    if (p.maxUses && p.uses >= p.maxUses) continue;
    if (p.code && (!code || p.code !== String(code).trim().toUpperCase())) continue;
    if (p.audience !== 'all') {
      if (!user) continue;
      if (previous === null) {
        previous = await Booking.countDocuments({ user: user._id, specialist: specialist._id, status: { $in: ['completed', 'confirmed', 'paid'] } });
      }
      if (p.audience === 'new_clients' && previous > 0) continue;
      if (p.audience === 'returning_clients' && previous === 0) continue;
    }
    candidates.push(p);
  }
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.discountPercent > a.discountPercent ? b : a));
}

// ── Cotización ─────────────────────────────────────────────
async function quote({ service, specialist, user, modality, promoCode, now = new Date() }) {
  const settings = await getSettings();
  const commission = await commissionFor({ specialist, categoryId: service.category?._id || service.category, now });
  const promo = await bestPromotion({ service, specialist, user, code: promoCode, now });
  const extra = modality === 'domicilio' ? (service.homeServiceExtra || 0) : 0;
  const breakdown = priceBreakdown({
    price: service.price,
    homeServiceExtra: extra,
    discountPercent: promo?.discountPercent || 0,
    fundedBy: promo?.fundedBy || 'specialist',
    rate: commission.rate,
    mode: settings.commission.feeMode,
    processorRate: settings.payments.processorFeePercent,
    processorPaidBy: settings.payments.processorFeePaidBy,
  });
  return { breakdown, commission, promo, settings };
}

function resolveCollectionModel(settings, specialist) {
  let model = settings.payments.collectionModel;
  if (model === 'split' && !specialist.mercadopago?.connectedAt) {
    if (settings.payments.requireConnectedAccount) {
      throw badRequest('Este especialista todavía no habilitó los pagos en línea. Probá más tarde o escribile por mensaje.');
    }
    model = 'platform';
  }
  return model;
}

// ── Creación ──────────────────────────────────────────────
async function createBooking({ user, serviceId, dateStr, time, modality, address, notes, promoCode, rebookOf, now = new Date() }) {
  const { Service, Specialist, Category, Booking, Promotion } = require('../models');
  if (!D.isValidDateStr(dateStr) || !D.isValidTimeStr(time)) throw badRequest('Fecha u hora no válida.');
  const service = await Service.findById(serviceId).lean();
  if (!service || !service.search?.visible || service.status !== 'active') throw notFound('Este servicio no está disponible para reservar.');
  const specialist = await Specialist.findById(service.specialist).select('+location.address').lean();
  if (!specialist || specialist.status !== 'active') throw notFound('Este especialista no está recibiendo reservas.');
  // Perfiles cargados por administración y aún no reclamados: se muestran, pero nadie gestionaría la reserva
  if (!specialist.user) throw badRequest('Este especialista todavía no activó su cuenta en Alternativa, así que no recibe reservas online. Podés guardarlo en favoritos.');
  if (String(specialist.user) === String(user._id)) throw badRequest('No podés reservar tus propios servicios.');
  if (user.status !== 'active') throw forbidden('Tu cuenta no puede hacer reservas en este momento.');

  const allowed = service.modalities?.length ? service.modalities : specialist.modalities;
  if (!allowed.includes(modality)) throw badRequest('Esa modalidad no está disponible para este servicio.');
  if (modality === 'domicilio' && !String(address || '').trim()) throw badRequest('Indicá la dirección para la atención a domicilio.');

  // Validación de disponibilidad en el backend (lo que mostró la pantalla no alcanza).
  const slots = await slotsForDate({ specialistId: specialist._id, service, dateStr, now });
  const slot = slots.find((s) => s.time === time);
  if (!slot) throw conflict('Ese horario ya no está disponible. Elegí otro, por favor.', 'slot_taken');

  // Límite de reservas impagas simultáneas por usuario (evita bloquear agendas de forma abusiva)
  const openPending = await Booking.countDocuments({ user: user._id, status: 'pending', paymentDeadline: { $gt: now } });
  if (openPending >= 3) throw badRequest('Tenés varias reservas sin pagar. Completá o cancelá alguna antes de reservar otra.');

  const { breakdown, commission, promo, settings } = await quote({ service, specialist, user, modality, promoCode, now });
  const collectionModel = resolveCollectionModel(settings, specialist);
  const category = await Category.findById(service.category).select('name').lean();
  const previous = await Booking.countDocuments({ user: user._id, specialist: specialist._id, status: { $in: ['completed', 'confirmed', 'paid'] } });
  const av = await getAvailabilityFor(specialist._id);

  const paymentDeadline = new Date(now.getTime() + settings.payments.paymentWindowMinutes * 60000);
  const booking = await Booking.create({
    code: bookingCode(),
    user: user._id,
    specialist: specialist._id,
    service: service._id,
    snapshot: {
      serviceTitle: service.title,
      serviceSlug: service.slug,
      categoryName: category?.name,
      specialistName: specialist.displayName,
      specialistSlug: specialist.slug,
      userName: user.name,
      price: service.price,
      homeServiceExtra: modality === 'domicilio' ? (service.homeServiceExtra || 0) : 0,
      subtotal: breakdown.subtotal,
      discount: breakdown.discount,
      promotion: promo?._id,
      promotionTitle: promo?.title,
      total: breakdown.total,
      currency: service.currency || 'UYU',
      feeMode: breakdown.mode,
      commissionRate: commission.rate,
      commissionRuleName: commission.ruleName,
      commissionAmount: breakdown.commissionAmount,
      specialistNet: breakdown.specialistNet,
      processorFeePercent: settings.payments.processorFeePercent,
      processorFeePaidBy: breakdown.processorPaidBy,
      processorFeeEstimate: breakdown.processorFee,
      specialistReceives: breakdown.specialistReceives,
      platformNet: breakdown.platformNet,
      marketplaceFee: breakdown.marketplaceFee,
      durationMinutes: service.durationMinutes,
      collectionModel,
      cancellationPolicy: settings.cancellation,
    },
    start: slot.start,
    end: slot.end,
    modality,
    place: {
      address: modality === 'domicilio' ? String(address).trim().slice(0, 300) : modality === 'presencial' ? specialist.location?.address : undefined,
      notes: modality === 'presencial' ? specialist.location?.addressPublicHint : undefined,
    },
    userNotes: String(notes || '').slice(0, 1000) || undefined,
    status: 'pending',
    paymentDeadline,
    rebookOf: rebookOf && isObjectId(rebookOf) ? rebookOf : undefined,
    isFirstWithSpecialist: previous === 0,
    history: [{ status: 'pending', by: user._id, byRole: 'user', note: 'Reserva iniciada' }],
  });

  const locked = await lockSlots(booking, { expiresAt: collectionModel === 'offline' ? null : paymentDeadline, bufferMinutes: av.bufferMinutes || 0 });
  if (!locked) {
    await Booking.deleteOne({ _id: booking._id });
    throw conflict('Alguien acaba de reservar ese horario. Elegí otro, por favor.', 'slot_taken');
  }
  if (promo) await Promotion.updateOne({ _id: promo._id }, { $inc: { uses: 1 } });

  // Guardar preferencias para "volver a reservar"
  const { User } = require('../models');
  await User.updateOne({ _id: user._id }, { $set: { 'preferences.lastModality': modality, ...(modality === 'domicilio' ? { 'preferences.homeAddress': String(address).trim().slice(0, 300) } : {}) } });

  if (collectionModel === 'offline') {
    const { Payment } = require('../models');
    const payment = await Payment.create({
      booking: booking._id, user: user._id, specialist: specialist._id, provider: 'offline', collectionModel,
      amount: breakdown.total, commissionAmount: breakdown.commissionAmount, specialistAmount: breakdown.specialistNet,
      status: 'offline', settlement: { status: 'pending' }, events: [{ type: 'offline' }],
    });
    booking.payment = payment._id;
    await booking.save();
    await markPaid(booking, payment, { offline: true });
  }
  return booking;
}

function pushHistory(booking, status, { by, byRole, note } = {}) {
  booking.history.push({ status, at: new Date(), by, byRole, note });
}

// ── Pago acreditado ────────────────────────────────────────
async function markPaid(booking, payment, { offline = false } = {}) {
  const { Specialist, Service } = require('../models');
  if (['paid', 'confirmed', 'completed'].includes(booking.status)) return booking;

  if (booking.status !== 'pending') {
    // El pago llegó tarde (reserva vencida o cancelada): intentamos recuperar el horario.
    const relocked = booking.status === 'expired' ? await lockSlots(booking, { bufferMinutes: 0 }) : false;
    if (!relocked) {
      pushHistory(booking, booking.status, { byRole: 'system', note: 'Pago recibido fuera de término: se reembolsa' });
      await booking.save();
      const split = { amount: payment.amount, commissionReversed: payment.commissionAmount, specialistReversed: payment.amount - payment.commissionAmount };
      await payments().executeRefund({ booking, payment, split, percent: 100, reason: 'Pago fuera de término, horario no disponible', rule: 'late_payment', actorRole: 'system' });
      booking.status = 'refunded';
      await booking.save();
      return booking;
    }
  } else {
    await makeSlotsPermanent(booking._id);
  }

  const specialist = await Specialist.findById(booking.specialist).lean();
  booking.status = 'paid';
  pushHistory(booking, 'paid', { byRole: 'system', note: offline ? 'Pago a coordinar con el especialista' : 'Pago acreditado' });
  if (specialist?.settings?.autoConfirm !== false) {
    booking.status = 'confirmed';
    pushHistory(booking, 'confirmed', { byRole: 'system', note: 'Confirmación automática' });
  }
  booking.paymentDeadline = undefined;
  await booking.save();
  await Service.updateOne({ _id: booking.service }, { $inc: { 'stats.bookings': 1 } });

  const when = D.fmtDateTime(booking.start);
  const confirmed = booking.status === 'confirmed';
  await notify(booking.user, {
    type: 'booking_confirmed',
    title: confirmed ? 'Reserva confirmada' : 'Pago recibido',
    body: confirmed
      ? `${booking.snapshot.serviceTitle} con ${booking.snapshot.specialistName}, ${when}.`
      : `Recibimos tu pago. ${booking.snapshot.specialistName} confirmará la reserva a la brevedad.`,
    link: `/mi/reservas/${booking._id}`,
    ctaLabel: 'Ver reserva',
  });
  if (specialist?.user) {
    await notify(specialist.user, {
      type: 'booking_new',
      title: confirmed ? 'Nueva reserva' : 'Nueva reserva para confirmar',
      body: `${booking.snapshot.userName} · ${booking.snapshot.serviceTitle} · ${when}. Te corresponden ${fmtMoney(booking.snapshot.specialistNet)}.`,
      link: `/panel/reservas/${booking._id}`,
      ctaLabel: confirmed ? 'Ver reserva' : 'Confirmar reserva',
    });
  }
  return booking;
}

async function confirmBySpecialist(booking, actor) {
  if (booking.status !== 'paid') throw badRequest('Solo se pueden confirmar reservas pagadas.');
  booking.status = 'confirmed';
  pushHistory(booking, 'confirmed', { by: actor._id, byRole: 'specialist' });
  await booking.save();
  await notify(booking.user, {
    type: 'booking_confirmed', title: 'Reserva confirmada',
    body: `${booking.snapshot.specialistName} confirmó tu reserva del ${D.fmtDateTime(booking.start)}.`,
    link: `/mi/reservas/${booking._id}`,
  });
  return booking;
}

// ── Cancelaciones y ausencias ──────────────────────────────
// attributeTo: a quién se atribuye la cancelación cuando la registra un administrador ('user' | 'specialist').
async function cancelBooking({ booking, actor, actorRole, reason = '', kind = 'cancel', refundPercentOverride = null, attributeTo = null, now = new Date() }) {
  const { Payment } = require('../models');
  const settings = await getSettings();
  const policy = { ...settings.cancellation, ...(booking.snapshot.cancellationPolicy || {}) };

  if (kind === 'cancel' && !['pending', 'paid', 'confirmed'].includes(booking.status)) throw badRequest('Esta reserva ya no se puede cancelar.');
  if (kind !== 'cancel' && !['paid', 'confirmed', 'completed'].includes(booking.status)) throw badRequest('No se puede registrar una ausencia para esta reserva.');
  if (kind !== 'cancel' && booking.start > now) throw badRequest('La ausencia se registra después del horario de inicio.');

  // Reserva aún impaga: se libera el horario sin movimientos de dinero.
  if (booking.status === 'pending') {
    booking.status = actorRole === 'specialist' ? 'cancelled_specialist' : 'cancelled_user';
    booking.cancellation = { by: actor?._id, byRole: actorRole, reason, at: now, refundPercent: 0, refundAmount: 0, rule: 'unpaid' };
    pushHistory(booking, booking.status, { by: actor?._id, byRole: actorRole, note: 'Cancelada antes del pago' });
    await booking.save();
    await releaseSlots(booking._id);
    if (booking.payment) await Payment.updateOne({ _id: booking.payment, status: 'pending' }, { $set: { status: 'cancelled' } });
    return { booking, refund: null };
  }

  const hoursBefore = (booking.start.getTime() - now.getTime()) / 3600000;
  const decision = evaluateCancellation({ actor: actorRole, kind, hoursBefore, policy });
  const refundPercent = refundPercentOverride !== null && refundPercentOverride !== undefined ? Math.max(0, Math.min(100, Number(refundPercentOverride))) : decision.refundPercent;

  const cancelledBy = actorRole === 'admin' ? (attributeTo || 'specialist') : actorRole;
  const statusByKind = {
    cancel: cancelledBy === 'specialist' ? 'cancelled_specialist' : 'cancelled_user',
    no_show_user: 'no_show_user',
    no_show_specialist: 'no_show_specialist',
  };

  const payment = booking.payment ? await Payment.findById(booking.payment) : null;
  const split = splitRefund({ total: booking.snapshot.total, commissionAmount: booking.snapshot.commissionAmount, refundPercent });

  booking.status = statusByKind[kind];
  booking.cancellation = { by: actor?._id, byRole: actorRole, reason: String(reason).slice(0, 500), at: now, refundPercent, refundAmount: split.amount, rule: decision.rule };
  pushHistory(booking, booking.status, { by: actor?._id, byRole: actorRole, note: `${decision.label}. Reembolso ${refundPercent}%` });
  await booking.save();
  await releaseSlots(booking._id);

  let refund = null;
  if (payment && ['approved', 'partially_refunded'].includes(payment.status) && split.amount > 0) {
    refund = await payments().executeRefund({ booking, payment, split, percent: refundPercent, reason, rule: decision.rule, actor, actorRole });
  }
  if (payment && payment.status === 'offline') {
    // Modelo offline: la comisión adeudada se ajusta en proporción a lo que el especialista devuelve.
    payment.commissionAmount = Math.max(0, payment.commissionAmount - split.commissionReversed);
    payment.events.push({ type: 'cancel_adjust', data: { refundPercent } });
    await payment.save();
  }
  // Avisos a la otra parte
  const { Specialist } = require('../models');
  const sp = await Specialist.findById(booking.specialist).select('user').lean();
  const when = D.fmtDateTime(booking.start);
  const refundText = split.amount > 0 ? ` Reembolso: ${fmtMoney(split.amount)} (${refundPercent}%).` : '';
  if (kind === 'cancel') {
    if (actorRole !== 'user') {
      await notify(booking.user, {
        type: 'booking_cancelled', title: 'Reserva cancelada',
        body: `Tu reserva de ${booking.snapshot.serviceTitle} del ${when} fue cancelada.${refundText}${reason ? ` Motivo: ${reason}` : ''}`,
        link: `/mi/reservas/${booking._id}`,
      });
    }
    if (actorRole !== 'specialist' && sp?.user) {
      await notify(sp.user, {
        type: 'booking_cancelled', title: 'Reserva cancelada',
        body: `${booking.snapshot.userName} canceló ${booking.snapshot.serviceTitle} del ${when}. El horario quedó libre.`,
        link: `/panel/reservas/${booking._id}`,
      });
    }
  }
  return { booking, refund, decision };
}

// ── Reprogramación ─────────────────────────────────────────
async function rescheduleBooking({ booking, actor, actorRole, dateStr, time, now = new Date() }) {
  const { Booking, Service, Payment, Specialist } = require('../models');
  if (!['paid', 'confirmed'].includes(booking.status)) throw badRequest('Solo se pueden reprogramar reservas pagadas o confirmadas.');
  const settings = await getSettings();
  const policy = { ...settings.cancellation, ...(booking.snapshot.cancellationPolicy || {}) };
  const hoursBefore = (booking.start.getTime() - now.getTime()) / 3600000;
  const check = canReschedule({ hoursBefore, rescheduleCount: booking.rescheduleCount, policy, actor: actorRole });
  if (!check.ok) throw badRequest(check.reason);
  const sp = await Specialist.findById(booking.specialist).lean();
  if (actorRole === 'user' && sp?.settings?.allowReschedule === false) throw badRequest('Este especialista no permite reprogramar desde la app. Escribile por mensaje.');

  const service = await Service.findById(booking.service).lean();
  const slots = await slotsForDate({ specialistId: booking.specialist, service: { ...service, durationMinutes: booking.snapshot.durationMinutes }, dateStr, now, excludeBookingId: booking._id });
  const slot = slots.find((s) => s.time === time);
  if (!slot) throw conflict('Ese horario no está disponible. Elegí otro, por favor.', 'slot_taken');
  if (slot.start.getTime() === booking.start.getTime()) throw badRequest('Elegiste el mismo horario.');

  const av = await getAvailabilityFor(booking.specialist);
  const data = booking.toObject();
  delete data._id; delete data.createdAt; delete data.updatedAt; delete data.__v;
  const next = new Booking({
    ...data,
    code: bookingCode(),
    start: slot.start,
    end: new Date(slot.start.getTime() + booking.snapshot.durationMinutes * 60000),
    rescheduledFrom: booking._id,
    rescheduledTo: undefined,
    rescheduleCount: booking.rescheduleCount + 1,
    reminders: {},
    incident: undefined,
    history: [{ status: booking.status, by: actor._id, byRole: actorRole, note: `Reprogramada desde ${booking.code} (${D.fmtDateTime(booking.start)})` }],
  });
  await next.save();
  // Primero se ocupa el horario nuevo y recién después se libera el anterior.
  const ok = await lockSlots(next, { bufferMinutes: av.bufferMinutes || 0 });
  if (!ok) {
    await Booking.deleteOne({ _id: next._id });
    throw conflict('Alguien acaba de reservar ese horario. Elegí otro, por favor.', 'slot_taken');
  }
  booking.status = 'rescheduled';
  booking.rescheduledTo = next._id;
  pushHistory(booking, 'rescheduled', { by: actor._id, byRole: actorRole, note: `Nuevo horario: ${D.fmtDateTime(next.start)} (${next.code})` });
  await booking.save();
  await releaseSlots(booking._id);
  if (booking.payment) await Payment.updateOne({ _id: booking.payment }, { $set: { booking: next._id }, $push: { events: { type: 'rescheduled', data: { from: booking.code, to: next.code }, at: new Date() } } });

  const when = D.fmtDateTime(next.start);
  if (actorRole !== 'user') {
    await notify(booking.user, { type: 'booking_rescheduled', title: 'Cambio de horario', body: `Tu reserva de ${booking.snapshot.serviceTitle} pasó al ${when}.`, link: `/mi/reservas/${next._id}` });
  }
  if (actorRole !== 'specialist' && sp?.user) {
    await notify(sp.user, { type: 'booking_rescheduled', title: 'Reserva reprogramada', body: `${booking.snapshot.userName} movió ${booking.snapshot.serviceTitle} al ${when}.`, link: `/panel/reservas/${next._id}` });
  }
  return next;
}

// ── Cierre ─────────────────────────────────────────────────
async function markCompleted(booking, { actor = null, actorRole = 'system', now = new Date() } = {}) {
  const { Service } = require('../models');
  if (!['paid', 'confirmed'].includes(booking.status)) throw badRequest('Esta reserva no se puede marcar como realizada.');
  if (booking.start > now) throw badRequest('La sesión todavía no ocurrió.');
  booking.status = 'completed';
  booking.completedAt = now;
  pushHistory(booking, 'completed', { by: actor?._id, byRole: actorRole, note: actorRole === 'system' ? 'Cierre automático' : undefined });
  await booking.save();
  await Service.updateOne({ _id: booking.service }, { $inc: { 'stats.completed': 1 } });
  const { recomputeSpecialistStats } = require('./specialists');
  await recomputeSpecialistStats(booking.specialist);
  return booking;
}

// El usuario reporta un problema: se abre incidencia, se frena el cierre automático y se avisa a admin.
async function reportIncident(booking, { actor, actorRole, note }) {
  const { Ticket, Counter } = require('../models');
  booking.incident = { open: true, note: String(note || '').slice(0, 1000), at: new Date() };
  pushHistory(booking, booking.status, { by: actor._id, byRole: actorRole, note: 'Incidencia reportada' });
  await booking.save();
  const number = await Counter.next('ticket');
  const ticket = await Ticket.create({
    number, user: actor._id, booking: booking._id, topic: 'booking', priority: 'high',
    subject: `Problema con la reserva ${booking.code}`,
    messages: [{ author: actor._id, authorRole: actorRole, body: String(note || '').slice(0, 5000) }],
  });
  const { notifyAdmins } = require('./notifications');
  await notifyAdmins({ title: 'Incidencia en una reserva', body: `${booking.code}: ${String(note || '').slice(0, 140)}`, link: `/admin/soporte/${ticket._id}`, dedupeKey: `incident:${booking._id}:${ticket._id}` });
  return ticket;
}

// Vence reservas impagas (el TTL ya liberó el horario; acá se actualiza el estado).
async function expirePending(now = new Date()) {
  const { Booking, Payment } = require('../models');
  const expired = await Booking.find({ status: 'pending', paymentDeadline: { $lt: now } }).limit(500);
  for (const b of expired) {
    b.status = 'expired';
    pushHistory(b, 'expired', { byRole: 'system', note: 'Venció el plazo de pago' });
    await b.save();
    await releaseSlots(b._id);
    if (b.payment) await Payment.updateOne({ _id: b.payment, status: 'pending' }, { $set: { status: 'cancelled', statusDetail: 'expired' } });
  }
  return expired.length;
}

// Datos para "Volver a reservar": mismo servicio y especialista, preferencias y próximos horarios.
async function rebookContext(pastBooking) {
  const { Service, Specialist } = require('../models');
  const service = await Service.findById(pastBooking.service).lean();
  const specialist = await Specialist.findById(pastBooking.specialist).lean();
  if (!service || !specialist || !service.search?.visible) return null;
  const { nextAvailableSlot } = require('./availability');
  const next = await nextAvailableSlot({ specialistId: specialist._id, service });
  return { service, specialist, next, modality: pastBooking.modality, address: pastBooking.modality === 'domicilio' ? pastBooking.place?.address : '' };
}

function canUserCancel(booking) {
  return ['pending', 'paid', 'confirmed'].includes(booking.status) && booking.start > new Date();
}

module.exports = {
  slotKeys, lockSlots, releaseSlots, makeSlotsPermanent, bestPromotion, quote, resolveCollectionModel,
  createBooking, markPaid, confirmBySpecialist, cancelBooking, rescheduleBooking, markCompleted,
  reportIncident, expirePending, rebookContext, canUserCancel,
};
