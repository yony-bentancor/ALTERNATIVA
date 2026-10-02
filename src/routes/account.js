'use strict';
const express = require('express');
const D = require('../lib/dates');
const { asyncHandler, notFound, forbidden, badRequest } = require('../lib/errors');
const { validate, isObjectId } = require('../lib/validate');
const { requireAuth, logout } = require('../middleware/auth');
const upload = require('../middleware/upload');
const limits = require('../middleware/rateLimit');
const bookings = require('../services/bookings');
const reviews = require('../services/reviews');
const messaging = require('../services/messaging');
const authService = require('../services/auth');
const { uploadMedia } = require('../services/media');
const { evaluateCancellation, splitRefund, describePolicy, canReschedule } = require('../services/cancellation');
const { getSettings } = require('../services/settings');
const { hydrateCards } = require('../services/search');
const { activeRules } = require('../services/commission');
const { audit } = require('../services/audit');
const { UPCOMING_STATUSES, PAST_STATUSES, CANCELLED_STATUSES } = require('../lib/constants');
const V = require('../views/account');
const M = require('../models');

const router = express.Router();
router.use(requireAuth);

async function myBooking(req, id = req.params.id) {
  if (!isObjectId(id)) throw notFound();
  const booking = await M.Booking.findById(id);
  if (!booking) throw notFound('No encontramos esa reserva.');
  if (String(booking.user) !== String(req.user._id)) throw forbidden();
  return booking;
}

// ── Inicio ────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const now = new Date();
  const [upcoming, pastDone, favCount, pendingReviews] = await Promise.all([
    M.Booking.find({ user: req.user._id, status: { $in: UPCOMING_STATUSES }, start: { $gt: now } }).sort({ start: 1 }).limit(3).lean(),
    M.Booking.aggregate([
      { $match: { user: req.user._id, status: 'completed' } },
      { $sort: { start: -1 } },
      { $group: { _id: '$service', booking: { $first: '$$ROOT' } } },
      { $limit: 4 },
    ]),
    M.Favorite.countDocuments({ user: req.user._id }),
    M.Booking.countDocuments({ user: req.user._id, status: 'completed', reviewed: false, end: { $gt: new Date(now.getTime() - 60 * 86400000) } }),
  ]);
  res.page(V.dashboard, { upcoming, rebook: pastDone.map((x) => x.booking), favCount, pendingReviews });
}));

// ── Reservas ──────────────────────────────────────────────
router.get('/reservas', asyncHandler(async (req, res) => {
  const tab = ['proximas', 'historial', 'canceladas'].includes(req.query.tab) ? req.query.tab : 'proximas';
  const now = new Date();
  const filters = {
    proximas: { status: { $in: UPCOMING_STATUSES }, $or: [{ start: { $gt: now } }, { status: 'pending' }] },
    historial: { $or: [{ status: { $in: PAST_STATUSES } }, { status: { $in: ['paid', 'confirmed'] }, start: { $lte: now } }] },
    canceladas: { status: { $in: CANCELLED_STATUSES } },
  };
  const list = await M.Booking.find({ user: req.user._id, ...filters[tab] }).sort({ start: tab === 'proximas' ? 1 : -1 }).limit(100).lean();
  const counts = await Promise.all(Object.values(filters).map((f) => M.Booking.countDocuments({ user: req.user._id, ...f })));
  res.page(V.bookings, { tab, list, counts });
}));

router.get('/reservas/:id', asyncHandler(async (req, res) => {
  const booking = await myBooking(req);
  const [specialist, payment, review, refunds, conversation] = await Promise.all([
    M.Specialist.findById(booking.specialist).select('displayName slug avatar user location modalities settings').lean(),
    booking.payment ? M.Payment.findById(booking.payment).lean() : null,
    M.Review.findOne({ booking: booking._id }).lean(),
    M.Refund.find({ booking: booking._id }).sort({ createdAt: -1 }).lean(),
    M.Conversation.findOne({ user: req.user._id, specialist: booking.specialist }).select('_id').lean(),
  ]);
  const settings = await getSettings();
  const policy = { ...settings.cancellation, ...(booking.snapshot.cancellationPolicy || {}) };
  const hoursBefore = (booking.start.getTime() - Date.now()) / 3600000;
  const eligibility = await reviews.reviewEligibility(booking, req.user);
  const resched = canReschedule({ hoursBefore, rescheduleCount: booking.rescheduleCount, policy, actor: 'user' });
  res.page(V.bookingDetail, {
    booking: booking.toObject(), specialist, payment, review, refunds, conversation,
    canCancel: bookings.canUserCancel(booking), canReschedule: resched.ok && ['paid', 'confirmed'].includes(booking.status) && specialist?.settings?.allowReschedule !== false,
    rescheduleReason: resched.reason, canReview: eligibility.ok, isNew: req.query.nueva === '1',
  });
}));

// Archivo de calendario (.ics) para agendar la sesión
router.get('/reservas/:id/calendario.ics', asyncHandler(async (req, res) => {
  const b = await myBooking(req);
  const fmt = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const location = b.modality === 'online' ? 'Online' : b.place?.address || b.place?.notes || '';
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Alternativa//Reservas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${b.code}@alternativa.uy`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(b.start)}`, `DTEND:${fmt(b.end)}`,
    `SUMMARY:${esc(`${b.snapshot.serviceTitle} con ${b.snapshot.specialistName}`)}`, `LOCATION:${esc(location)}`,
    `DESCRIPTION:${esc(`Reserva ${b.code} en Alternativa`)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Recordatorio de tu sesión', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  res.type('text/calendar').attachment(`${b.code}.ics`).send(ics);
}));

// Cancelar: muestra antes cuánto se reembolsa según la política vigente al reservar
router.get('/reservas/:id/cancelar', asyncHandler(async (req, res) => {
  const booking = await myBooking(req);
  if (!bookings.canUserCancel(booking)) { req.flash('error', 'Esta reserva ya no se puede cancelar.'); return res.redirect(`/mi/reservas/${booking._id}`); }
  const settings = await getSettings();
  const policy = { ...settings.cancellation, ...(booking.snapshot.cancellationPolicy || {}) };
  const hoursBefore = (booking.start.getTime() - Date.now()) / 3600000;
  const decision = booking.status === 'pending' ? { refundPercent: 0, label: 'Reserva sin pagar' } : evaluateCancellation({ actor: 'user', hoursBefore, policy });
  const split = booking.status === 'pending' ? { amount: 0 } : splitRefund({ total: booking.snapshot.total, commissionAmount: booking.snapshot.commissionAmount, refundPercent: decision.refundPercent });
  const resched = canReschedule({ hoursBefore, rescheduleCount: booking.rescheduleCount, policy, actor: 'user' });
  return res.page(V.cancel, { booking: booking.toObject(), decision, split, policy: describePolicy(policy), canReschedule: resched.ok && booking.status !== 'pending' });
}));

router.post('/reservas/:id/cancelar', asyncHandler(async (req, res) => {
  const booking = await myBooking(req);
  const { refund } = await bookings.cancelBooking({ booking, actor: req.user, actorRole: 'user', reason: String(req.body.reason || '').slice(0, 500) });
  await audit(req, { action: 'booking.cancel', entity: 'Booking', entityId: booking._id, summary: `Cancelada por el usuario (${booking.code})`, after: { status: booking.status, refund: refund?.amount } });
  req.flash('success', refund?.status === 'processed' ? 'Cancelamos tu reserva y procesamos el reembolso.' : refund?.status === 'failed' ? 'Cancelamos tu reserva. El reembolso quedó en revisión y te avisamos cuando se acredite.' : 'Cancelamos tu reserva.');
  res.redirect(`/mi/reservas/${booking._id}`);
}));

// Reprogramar
router.get('/reservas/:id/reprogramar', asyncHandler(async (req, res) => {
  const booking = await myBooking(req);
  const settings = await getSettings();
  const policy = { ...settings.cancellation, ...(booking.snapshot.cancellationPolicy || {}) };
  const check = canReschedule({ hoursBefore: (booking.start.getTime() - Date.now()) / 3600000, rescheduleCount: booking.rescheduleCount, policy, actor: 'user' });
  if (!check.ok || !['paid', 'confirmed'].includes(booking.status)) { req.flash('error', check.reason || 'Esta reserva no se puede reprogramar.'); return res.redirect(`/mi/reservas/${booking._id}`); }
  return res.page(V.reschedule, { booking: booking.toObject(), action: `/mi/reservas/${booking._id}/reprogramar`, today: D.todayStr(), back: `/mi/reservas/${booking._id}` });
}));

router.post('/reservas/:id/reprogramar', limits.booking, asyncHandler(async (req, res) => {
  const booking = await myBooking(req);
  const { data, ok } = validate(req.body, { fecha: { type: 'date', required: true }, hora: { type: 'time', required: true } });
  if (!ok) throw badRequest('Elegí el nuevo día y horario.');
  const next = await bookings.rescheduleBooking({ booking, actor: req.user, actorRole: 'user', dateStr: data.fecha, time: data.hora });
  req.flash('success', `Listo: tu sesión pasó al ${D.fmtDateTime(next.start)}.`);
  res.redirect(`/mi/reservas/${next._id}`);
}));

// Volver a reservar: mismo servicio, especialista y preferencias + próximos horarios
router.get('/reservas/:id/volver', asyncHandler(async (req, res) => {
  const booking = await myBooking(req);
  const ctxData = await bookings.rebookContext(booking);
  if (!ctxData) { req.flash('error', 'Este servicio ya no está disponible para reservar.'); return res.redirect('/buscar'); }
  const { slotsForDate } = require('../services/availability');
  const nextSlots = [];
  if (ctxData.next) {
    let day = ctxData.next.date;
    for (let i = 0; i < 7 && nextSlots.length < 6; i++) {
      const slots = await slotsForDate({ specialistId: ctxData.specialist._id, service: ctxData.service, dateStr: day });
      for (const s of slots.slice(0, 6 - nextSlots.length)) nextSlots.push({ date: day, time: s.time });
      day = D.addDays(day, 1);
    }
  }
  return res.page(V.rebook, { booking: booking.toObject(), ...ctxData, nextSlots });
}));

router.post('/reservas/:id/problema', limits.forms, asyncHandler(async (req, res) => {
  const booking = await myBooking(req);
  const note = String(req.body.note || '').trim();
  if (note.length < 10) throw badRequest('Contanos un poco más qué pasó (mínimo 10 caracteres).');
  await bookings.reportIncident(booking, { actor: req.user, actorRole: 'user', note });
  req.flash('success', 'Recibimos tu reporte. Lo revisamos y te escribimos a la brevedad.');
  res.redirect(`/mi/reservas/${booking._id}`);
}));

// Valorar
router.get('/reservas/:id/valorar', asyncHandler(async (req, res) => {
  const booking = await myBooking(req);
  const elig = await reviews.reviewEligibility(booking, req.user);
  if (!elig.ok) { req.flash('info', elig.reason); return res.redirect(`/mi/reservas/${booking._id}`); }
  return res.page(V.reviewForm, { booking: booking.toObject(), action: `/mi/reservas/${booking._id}/valorar`, values: {} });
}));

router.post('/reservas/:id/valorar', asyncHandler(async (req, res) => {
  const booking = await myBooking(req);
  await reviews.createReview({ booking, user: req.user, rating: req.body.rating, comment: req.body.comment });
  req.flash('success', 'Gracias por tu reseña. Ya está publicada como reseña verificada.');
  res.redirect(`/mi/reservas/${booking._id}`);
}));

router.get('/resenas', asyncHandler(async (req, res) => {
  const list = await M.Review.find({ user: req.user._id }).sort({ createdAt: -1 }).populate('service', 'title slug').populate('specialist', 'displayName slug').lean();
  const settings = await getSettings();
  res.page(V.myReviews, { list, editDays: settings.reviews.editWindowDays });
}));

router.get('/resenas/:id/editar', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const review = await M.Review.findById(req.params.id).lean();
  if (!review || String(review.user) !== String(req.user._id)) throw notFound();
  const booking = await M.Booking.findById(review.booking).lean();
  res.page(V.reviewForm, { booking, action: `/mi/resenas/${review._id}/editar`, values: review, editing: true });
}));

router.post('/resenas/:id/editar', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const review = await M.Review.findById(req.params.id);
  if (!review) throw notFound();
  await reviews.editReview(review, req.user, { rating: req.body.rating, comment: req.body.comment });
  req.flash('success', 'Actualizamos tu reseña.');
  res.redirect('/mi/resenas');
}));

// ── Favoritos ─────────────────────────────────────────────
router.get('/favoritos', asyncHandler(async (req, res) => {
  const favs = await M.Favorite.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();
  const settings = await getSettings();
  const rules = await activeRules();
  const services = await M.Service.find({ _id: { $in: favs.filter((f) => f.kind === 'service').map((f) => f.service) } }).lean();
  const specialists = await M.Specialist.find({ _id: { $in: favs.filter((f) => f.kind === 'specialist').map((f) => f.specialist) } }).select('displayName slug avatar headline status location').lean();
  const avatars = await M.Media.find({ _id: { $in: specialists.map((s) => s.avatar).filter(Boolean) } }).select('url thumbUrl').lean();
  const avatarMap = new Map(avatars.map((a) => [String(a._id), a.thumbUrl || a.url]));
  const cards = await hydrateCards(services.filter((s) => s.search?.visible), { settings, rules });
  res.page(V.favorites, {
    cards, unavailable: services.filter((s) => !s.search?.visible),
    specialists: specialists.map((s) => ({ ...s, avatarUrl: avatarMap.get(String(s.avatar)) })),
    favorites: new Set(favs.map((f) => String(f.kind === 'service' ? f.service : f.specialist))),
  });
}));

// ── Mensajes ──────────────────────────────────────────────
router.get('/mensajes', asyncHandler(async (req, res) => {
  const list = await M.Conversation.find({ user: req.user._id }).sort({ lastMessageAt: -1 }).limit(100).populate('specialist', 'displayName slug avatar').lean();
  const avatars = await M.Media.find({ _id: { $in: list.map((c) => c.specialist?.avatar).filter(Boolean) } }).select('url thumbUrl').lean();
  const map = new Map(avatars.map((a) => [String(a._id), a.thumbUrl || a.url]));
  res.page(V.inbox, { list: list.map((c) => ({ ...c, avatarUrl: map.get(String(c.specialist?.avatar)) })) });
}));

router.get('/mensajes/nuevo/:specialistId', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.specialistId)) throw notFound();
  const sp = await M.Specialist.findOne({ _id: req.params.specialistId, status: 'active' }).lean();
  if (!sp || !sp.user) { req.flash('error', 'Este especialista todavía no puede recibir mensajes.'); return res.redirect('back'); }
  const conv = await messaging.getOrCreateConversation(req.user._id, sp);
  return res.redirect(`/mi/mensajes/${conv._id}`);
}));

router.get('/mensajes/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const conv = await M.Conversation.findById(req.params.id);
  if (!conv || String(conv.user) !== String(req.user._id)) throw notFound();
  const [messages, sp, allowed, booking] = await Promise.all([
    M.Message.find({ conversation: conv._id }).sort({ createdAt: -1 }).limit(80).lean(),
    M.Specialist.findById(conv.specialist).select('displayName slug avatar').lean(),
    messaging.contactAllowed(conv),
    M.Booking.findOne({ user: req.user._id, specialist: conv.specialist, status: { $in: ['paid', 'confirmed'] }, start: { $gt: new Date() } }).sort({ start: 1 }).lean(),
  ]);
  await messaging.markRead(conv, 'user');
  res.page(V.conversation, { conv, messages: messages.reverse(), sp, allowed, booking, me: req.user._id, base: '/mi', title: sp?.displayName });
}));

router.post('/mensajes/:id', limits.forms, asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const conv = await M.Conversation.findById(req.params.id);
  if (!conv || String(conv.user) !== String(req.user._id)) throw notFound();
  await messaging.sendMessage({ conversation: conv, sender: req.user, body: req.body.body });
  res.redirect(`/mi/mensajes/${conv._id}`);
}));

// ── Notificaciones ────────────────────────────────────────
router.get('/notificaciones', asyncHandler(async (req, res) => {
  const list = await M.Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.page(V.notifications, { list });
  await M.Notification.updateMany({ user: req.user._id, readAt: null, createdAt: { $lte: new Date() } }, { $set: { readAt: new Date() } });
}));

router.get('/notificaciones/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const n = await M.Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { $set: { readAt: new Date() } }).lean();
  if (!n) throw notFound();
  res.redirect(n.link && n.link.startsWith('/') ? n.link : '/mi/notificaciones');
}));

// ── Perfil ────────────────────────────────────────────────
router.get('/perfil', (req, res) => res.page(V.profile, {}));

router.get('/perfil/editar', (req, res) => res.page(V.profileEdit, { values: req.user.toObject() }));

router.post('/perfil/editar', upload.single('avatar'), asyncHandler(async (req, res) => {
  const { DEPARTMENTS } = require('../lib/constants');
  const { data, errors, ok } = validate(req.body, {
    name: { type: 'string', required: true, min: 2, max: 120, label: 'Nombre' },
    phone: { type: 'phone', label: 'Celular' },
    department: { type: 'enum', values: ['', ...DEPARTMENTS] },
    city: { type: 'string', max: 80 },
    homeAddress: { type: 'string', max: 300 },
  });
  if (!ok) return res.page(V.profileEdit, { values: { ...req.user.toObject(), ...req.body }, errors }, 400);
  req.user.name = data.name;
  req.user.phone = data.phone;
  req.user.location = { department: data.department, city: data.city };
  req.user.preferences.homeAddress = data.homeAddress;
  if (req.file) {
    const media = await uploadMedia({ file: req.file, kind: 'user_avatar', owner: req.user._id });
    req.user.avatarUrl = media.thumbUrl || media.url;
  }
  await req.user.save();
  req.flash('success', 'Guardamos tus datos.');
  return res.redirect('/mi/perfil');
}));

// ── Pagos y métodos ───────────────────────────────────────
router.get('/pagos', asyncHandler(async (req, res) => {
  const list = await M.Payment.find({ user: req.user._id, status: { $ne: 'pending' } }).sort({ createdAt: -1 }).limit(100).populate('booking', 'code snapshot.serviceTitle snapshot.specialistName start').lean();
  const refunds = await M.Refund.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();
  res.page(V.payments, { list, refunds });
}));

router.get('/metodos-de-pago', (req, res) => res.page(V.paymentMethods, {}));

// ── Configuración, privacidad y ayuda ─────────────────────
router.get('/configuracion', (req, res) => res.page(V.settings, {}));

router.post('/configuracion/notificaciones', asyncHandler(async (req, res) => {
  const b = req.body;
  req.user.preferences.notifications = {
    email: !!b.email, push: !!b.push, whatsapp: !!b.whatsapp, marketing: !!b.marketing,
  };
  await req.user.save();
  req.flash('success', 'Guardamos tus preferencias de notificaciones.');
  res.redirect('/mi/configuracion');
}));

router.post('/configuracion/contrasena', limits.auth, asyncHandler(async (req, res) => {
  if (req.body.next !== req.body.next2) throw badRequest('Las contraseñas nuevas no coinciden.');
  await authService.changePassword(req.user._id, req.body.current, req.body.next);
  await audit(req, { action: 'auth.password_change', entity: 'User', entityId: req.user._id, severity: 'security' });
  req.flash('success', 'Cambiamos tu contraseña.');
  res.redirect('/mi/configuracion');
}));

router.get('/privacidad', (req, res) => res.page(V.privacy, {}));

router.post('/privacidad', asyncHandler(async (req, res) => {
  req.user.privacy = { showFirstNameOnly: true, shareContactAfterBooking: !!req.body.shareContactAfterBooking };
  await req.user.save();
  req.flash('success', 'Guardamos tus preferencias de privacidad.');
  res.redirect('/mi/privacidad');
}));

// Exportación de datos personales (derecho de acceso)
router.get('/privacidad/mis-datos.json', asyncHandler(async (req, res) => {
  const uid = req.user._id;
  const [bookingsList, reviewsList, favorites, conversations, payments] = await Promise.all([
    M.Booking.find({ user: uid }).select('-specialistNotes').lean(),
    M.Review.find({ user: uid }).lean(),
    M.Favorite.find({ user: uid }).lean(),
    M.Conversation.find({ user: uid }).lean(),
    M.Payment.find({ user: uid }).select('-events').lean(),
  ]);
  const messages = await M.Message.find({ conversation: { $in: conversations.map((c) => c._id) }, sender: uid }).lean();
  const user = req.user.toObject();
  delete user.pushSubscriptions;
  res.attachment('alternativa-mis-datos.json').json({ exportedAt: new Date(), user, bookings: bookingsList, reviews: reviewsList, favorites, messages, payments });
}));

// Baja de cuenta: se anonimiza (las reservas y pagos se conservan por obligación legal y contable)
router.post('/privacidad/eliminar', asyncHandler(async (req, res) => {
  if (req.body.confirm !== 'ELIMINAR') throw badRequest('Escribí ELIMINAR para confirmar.');
  const active = await M.Booking.countDocuments({ user: req.user._id, status: { $in: ['pending', 'paid', 'confirmed'] }, start: { $gt: new Date() } });
  if (active) throw badRequest('Tenés reservas próximas. Cancelalas antes de eliminar tu cuenta.');
  if (req.user.specialist) throw badRequest('Tu cuenta administra una ficha de especialista. Escribinos para darla de baja.');
  const id = req.user._id;
  await audit(req, { action: 'user.delete_self', entity: 'User', entityId: id, severity: 'security' });
  await M.User.updateOne({ _id: id }, {
    $set: { name: 'Usuario eliminado', email: `eliminado-${id}@alternativa.invalid`, status: 'deleted', deletedAt: new Date(), phone: null, avatarUrl: null, pushSubscriptions: [], paymentMethods: [] },
    $unset: { passwordHash: 1, location: 1, 'preferences.homeAddress': 1 },
  });
  await M.Favorite.deleteMany({ user: id });
  await M.Review.updateMany({ user: id }, { $set: { authorName: 'Usuario' } });
  await logout(req);
  res.redirect('/?cuenta=eliminada');
}));

router.get('/ayuda', asyncHandler(async (req, res) => {
  const tickets = await M.Ticket.find({ user: req.user._id }).sort({ updatedAt: -1 }).limit(50).lean();
  const recent = await M.Booking.find({ user: req.user._id }).sort({ start: -1 }).limit(10).select('code snapshot.serviceTitle start').lean();
  res.page(V.help, { tickets, recent });
}));

router.post('/ayuda', limits.forms, asyncHandler(async (req, res) => {
  const { data, ok, errors } = validate(req.body, {
    topic: { type: 'enum', values: ['booking', 'payment', 'refund', 'account', 'specialist', 'technical', 'other'], required: true },
    booking: { type: 'objectId' },
    subject: { type: 'string', required: true, max: 200, label: 'Asunto' },
    body: { type: 'text', required: true, min: 10, max: 5000, label: 'Mensaje' },
  });
  if (!ok) throw badRequest(Object.values(errors)[0]);
  if (data.booking && !(await M.Booking.exists({ _id: data.booking, user: req.user._id }))) data.booking = undefined;
  const number = await M.Counter.next('ticket');
  const ticket = await M.Ticket.create({
    number, user: req.user._id, email: req.user.email, name: req.user.name, topic: data.topic, booking: data.booking, subject: data.subject,
    messages: [{ author: req.user._id, authorRole: req.user.role, body: data.body }],
  });
  req.flash('success', `Creamos tu consulta #${number}. Te respondemos acá y por email.`);
  res.redirect(`/mi/ayuda/${ticket._id}`);
}));

router.get('/ayuda/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const ticket = await M.Ticket.findOne({ _id: req.params.id, user: req.user._id }).lean();
  if (!ticket) throw notFound();
  res.page(V.ticket, { ticket, base: '/mi/ayuda' });
}));

router.post('/ayuda/:id', limits.forms, asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const body = String(req.body.body || '').trim();
  if (body.length < 2) throw badRequest('Escribí tu mensaje.');
  const t = await M.Ticket.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { $push: { messages: { author: req.user._id, authorRole: req.user.role, body: body.slice(0, 5000) } }, $set: { status: 'open' } },
  );
  if (!t) throw notFound();
  res.redirect(`/mi/ayuda/${t._id}`);
}));

module.exports = router;
