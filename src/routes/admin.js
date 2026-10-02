'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const D = require('../lib/dates');
const { asyncHandler, notFound, badRequest } = require('../lib/errors');
const { validate, isObjectId } = require('../lib/validate');
const { parsePage, paginate } = require('../lib/pagination');
const { uniqueSlug, slugify } = require('../lib/slug');
const { requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { DEPARTMENTS, REPORT_REASONS, RESERVED_SLUGS } = require('../lib/constants');
const { audit, diff } = require('../services/audit');
const { adminDashboard, specialistDashboard } = require('../services/stats');
const specialists = require('../services/specialists');
const bookings = require('../services/bookings');
const payments = require('../services/payments');
const payouts = require('../services/payouts');
const reviewsService = require('../services/reviews');
const { uploadMedia, removeMedia } = require('../services/media');
const { storage } = require('../services/storage');
const { getSettings, updateSection, DEFAULTS } = require('../services/settings');
const { clearRulesCache } = require('../services/commission');
const { notify } = require('../services/notifications');
const { sendEmail, layout: emailLayout } = require('../services/email');
const { splitRefund } = require('../services/cancellation');
const V = require('../views/admin');
const M = require('../models');

const router = express.Router();
router.get('/login', (req, res) => res.redirect('/login?volver=/admin'));
router.use(requireRole('admin'));

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const period = (q) => (['7d', '30d', '90d', '365d'].includes(q) ? q : '30d');

// ── Resumen ───────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const stats = await adminDashboard(period(req.query.periodo));
  const recent = await M.AuditLog.find({ severity: { $in: ['warning', 'security'] } }).sort({ createdAt: -1 }).limit(8).lean();
  const latestBookings = await M.Booking.find({}).sort({ createdAt: -1 }).limit(8).lean();
  res.page(V.dashboard, { stats, recent, latestBookings });
}));

router.get('/pendientes', asyncHandler(async (req, res) => {
  const [specialistsPending, withChanges, verifications, certs, media, categories, services, reviews, reports, tickets, refunds, incidents, adRequests] = await Promise.all([
    M.Specialist.find({ status: 'pending_review' }).select('displayName createdAt').lean(),
    M.Specialist.find({ 'pendingChanges.0': { $exists: true } }).select('displayName pendingChanges').lean(),
    M.VerificationRequest.countDocuments({ status: 'pending' }),
    M.Certification.countDocuments({ status: 'pending' }),
    M.Media.countDocuments({ status: { $in: ['pending', 'reported'] } }),
    M.Category.find({ status: 'pending' }).select('name').lean(),
    M.Service.find({ status: 'pending_review' }).select('title specialist statusReason').populate('specialist', 'displayName').lean(),
    M.Review.countDocuments({ status: 'under_review' }),
    M.Report.countDocuments({ status: 'open' }),
    M.Ticket.countDocuments({ status: 'open' }),
    M.Refund.countDocuments({ status: 'failed' }),
    M.Booking.find({ 'incident.open': true }).select('code incident snapshot.specialistName').lean(),
    M.SponsoredPlacement.countDocuments({ status: 'paused', paymentStatus: 'pending' }),
  ]);
  res.page(V.pending, { specialistsPending, withChanges, verifications, certs, media, categories, services, reviews, reports, tickets, refunds, incidents, adRequests });
}));

router.get('/estadisticas', asyncHandler(async (req, res) => {
  const p = period(req.query.periodo);
  const stats = await adminDashboard(p);
  const from = stats.range.from;
  const [byCategory, byDepartment, topSpecialists, byModel] = await Promise.all([
    M.Booking.aggregate([{ $match: { createdAt: { $gte: from }, status: { $in: ['paid', 'confirmed', 'completed'] } } }, { $group: { _id: '$snapshot.categoryName', n: { $sum: 1 }, gross: { $sum: '$snapshot.total' } } }, { $sort: { n: -1 } }]),
    M.Booking.aggregate([
      { $match: { createdAt: { $gte: from }, status: { $in: ['paid', 'confirmed', 'completed'] } } },
      { $lookup: { from: 'specialists', localField: 'specialist', foreignField: '_id', as: 'sp' } },
      { $group: { _id: { $first: '$sp.location.department' }, n: { $sum: 1 } } }, { $sort: { n: -1 } },
    ]),
    M.Booking.aggregate([{ $match: { createdAt: { $gte: from }, status: { $in: ['paid', 'confirmed', 'completed'] } } }, { $group: { _id: '$specialist', name: { $first: '$snapshot.specialistName' }, n: { $sum: 1 }, commission: { $sum: '$snapshot.commissionAmount' } } }, { $sort: { n: -1 } }, { $limit: 15 }]),
    M.Payment.aggregate([{ $match: { createdAt: { $gte: from }, status: { $in: ['approved', 'partially_refunded', 'refunded', 'offline'] } } }, { $group: { _id: '$collectionModel', n: { $sum: 1 }, gross: { $sum: '$amount' } } }]),
  ]);
  res.page(V.stats, { stats, byCategory, byDepartment, topSpecialists, byModel });
}));

// ── Especialistas ─────────────────────────────────────────
router.get('/especialistas', asyncHandler(async (req, res) => {
  const filter = { deletedAt: null };
  if (req.query.estado) filter.status = req.query.estado;
  if (req.query.verificacion) filter['verification.identity.status'] = req.query.verificacion;
  if (req.query.reclamo) filter['claim.status'] = req.query.reclamo;
  if (req.query.q) filter.displayName = new RegExp(esc(req.query.q), 'i');
  const result = await paginate(M.Specialist, filter, parsePage(req.query), { sort: { createdAt: -1 } });
  res.page(V.specialists, { result, query: req.query });
}));

router.get('/especialistas/nuevo', asyncHandler(async (req, res) => {
  const categories = await M.Category.find({ status: 'active' }).sort({ name: 1 }).lean();
  res.page(V.specialistForm, { categories, values: {}, departments: DEPARTMENTS });
}));

const specialistRules = {
  displayName: { type: 'string', required: true, max: 120, label: 'Nombre' },
  headline: { type: 'string', max: 160 },
  bio: { type: 'text', max: 4000 },
  experience: { type: 'text', max: 3000 },
  education: { type: 'text', max: 3000 },
  yearsOfExperience: { type: 'int', min: 0, max: 80 },
  categories: { type: 'array', of: 'objectId', max: 10 },
  modalities: { type: 'array', values: ['presencial', 'domicilio', 'online'] },
  department: { type: 'enum', values: ['', ...DEPARTMENTS] },
  city: { type: 'string', max: 80 },
  neighborhood: { type: 'string', max: 80 },
  address: { type: 'string', max: 200 },
  addressPublicHint: { type: 'string', max: 160 },
  lat: { type: 'number', min: -35.2, max: -30 },
  lng: { type: 'number', min: -58.6, max: -53 },
  serviceRadiusKm: { type: 'int', min: 0, max: 200 },
  contactPhone: { type: 'phone' },
  commissionRate: { type: 'number', min: 0, max: 50 },
  plan: { type: 'enum', values: ['free', 'profesional'], default: 'free' },
  planExpiresAt: { type: 'date' },
};

function specialistDoc(data) {
  return {
    displayName: data.displayName, headline: data.headline, bio: data.bio, experience: data.experience, education: data.education,
    yearsOfExperience: data.yearsOfExperience, categories: data.categories, modalities: data.modalities,
    location: {
      department: data.department, city: data.city, neighborhood: data.neighborhood, address: data.address, addressPublicHint: data.addressPublicHint,
      serviceRadiusKm: data.serviceRadiusKm,
      geo: Number.isFinite(data.lat) && Number.isFinite(data.lng) ? { type: 'Point', coordinates: [data.lng, data.lat] } : undefined,
    },
    contactPhone: data.contactPhone,
    commissionRate: data.commissionRate === undefined ? null : data.commissionRate,
    plan: data.plan, planExpiresAt: data.planExpiresAt ? D.zonedToUtc(data.planExpiresAt, '23:59') : undefined,
  };
}

router.post('/especialistas', asyncHandler(async (req, res) => {
  const { data, errors, ok } = validate(req.body, specialistRules);
  if (!ok) {
    const categories = await M.Category.find({ status: 'active' }).sort({ name: 1 }).lean();
    return res.page(V.specialistForm, { categories, values: req.body, errors, departments: DEPARTMENTS }, 400);
  }
  const sp = await specialists.adminCreate({ ...specialistDoc(data), status: 'draft' }, req.user);
  await audit(req, { action: 'specialist.admin_create', entity: 'Specialist', entityId: sp._id, after: { displayName: sp.displayName } });
  req.flash('success', 'Creamos la ficha. Cargá servicios y fotos; después podés invitar al especialista a reclamarla.');
  return res.redirect(`/admin/especialistas/${sp._id}`);
}));

async function loadSpecialist(id) {
  if (!isObjectId(id)) throw notFound();
  const sp = await M.Specialist.findById(id).select('+location.address +contactPhone');
  if (!sp) throw notFound();
  return sp;
}

router.get('/especialistas/:id', asyncHandler(async (req, res) => {
  const sp = await loadSpecialist(req.params.id);
  const [user, services, media, certifications, requests, stats, completeness, logs, bookingsCount, reportsList, categories] = await Promise.all([
    sp.user ? M.User.findById(sp.user).lean() : null,
    M.Service.find({ specialist: sp._id }).populate('category', 'name').lean(),
    M.Media.find({ specialist: sp._id }).sort({ kind: 1, order: 1 }).lean(),
    M.Certification.find({ specialist: sp._id }).lean(),
    M.VerificationRequest.find({ specialist: sp._id }).sort({ createdAt: -1 }).lean(),
    specialistDashboard(sp._id, '90d'),
    specialists.profileCompleteness(sp),
    M.AuditLog.find({ entity: 'Specialist', entityId: sp._id }).sort({ createdAt: -1 }).limit(20).lean(),
    M.Booking.countDocuments({ specialist: sp._id }),
    M.Report.find({ targetType: 'specialist', targetId: sp._id }).sort({ createdAt: -1 }).lean(),
    M.Category.find({}).select('name').lean(),
  ]);
  res.page(V.specialistDetail, { sp: sp.toObject(), user, services, media, certifications, requests, stats, completeness, logs, bookingsCount, reports: reportsList, categories });
}));

router.get('/especialistas/:id/editar', asyncHandler(async (req, res) => {
  const sp = await loadSpecialist(req.params.id);
  const categories = await M.Category.find({ status: { $ne: 'hidden' } }).sort({ name: 1 }).lean();
  const v = sp.toObject();
  res.page(V.specialistForm, { categories, values: v, editing: sp._id, departments: DEPARTMENTS });
}));

router.post('/especialistas/:id', asyncHandler(async (req, res) => {
  const sp = await loadSpecialist(req.params.id);
  const { data, errors, ok } = validate(req.body, specialistRules);
  if (!ok) {
    const categories = await M.Category.find({}).sort({ name: 1 }).lean();
    return res.page(V.specialistForm, { categories, values: { ...sp.toObject(), ...req.body }, errors, editing: sp._id, departments: DEPARTMENTS }, 400);
  }
  const before = sp.toObject();
  const doc = specialistDoc(data);
  if (doc.displayName !== sp.displayName) sp.slug = await specialists.specialistSlug(doc.displayName, sp._id);
  sp.set(doc);
  await sp.save();
  await specialists.syncSearchForSpecialist(sp._id);
  const d = diff({ displayName: before.displayName, commissionRate: before.commissionRate, plan: before.plan, categories: before.categories?.map(String) }, { displayName: doc.displayName, commissionRate: doc.commissionRate, plan: doc.plan, categories: doc.categories });
  await audit(req, { action: 'specialist.admin_update', entity: 'Specialist', entityId: sp._id, ...d, severity: before.commissionRate !== doc.commissionRate ? 'warning' : 'info' });
  req.flash('success', 'Guardamos los cambios.');
  return res.redirect(`/admin/especialistas/${sp._id}`);
}));

router.post('/especialistas/:id/estado', asyncHandler(async (req, res) => {
  const { status, reason } = req.body;
  if (!['active', 'suspended', 'inactive', 'draft'].includes(status)) throw badRequest('Estado no válido.');
  if (status === 'suspended' && String(reason || '').trim().length < 5) throw badRequest('Indicá el motivo de la suspensión.');
  const { sp, before } = await specialists.setStatus(req.params.id, status, reason);
  await audit(req, { action: `specialist.status.${status}`, entity: 'Specialist', entityId: sp._id, before: { status: before }, after: { status, reason }, severity: status === 'suspended' ? 'warning' : 'info' });
  if (sp.user) {
    const msg = { active: 'Tu ficha está publicada en Alternativa.', suspended: `Tu ficha fue suspendida. Motivo: ${reason}`, inactive: 'Tu ficha fue desactivada.', draft: 'Tu ficha volvió a borrador para que completes algunos datos.' }[status];
    await notify(sp.user, { type: 'moderation_update', title: status === 'active' ? '¡Tu ficha está publicada!' : 'Cambio en tu ficha', body: msg + (reason && status !== 'suspended' ? ` ${reason}` : ''), link: '/panel' });
  }
  req.flash('success', 'Actualizamos el estado.');
  res.redirect(`/admin/especialistas/${sp._id}`);
}));

router.post('/especialistas/:id/cambios', asyncHandler(async (req, res) => {
  const approve = req.body.decision === 'aprobar';
  const { sp, change } = await specialists.resolvePendingChange(req.params.id, req.body.field, approve);
  await audit(req, { action: `specialist.change.${approve ? 'approve' : 'reject'}`, entity: 'Specialist', entityId: sp._id, after: { field: change.field, value: change.value } });
  if (sp.user) await notify(sp.user, { type: 'moderation_update', title: approve ? 'Cambio aprobado' : 'Cambio no aprobado', body: `${change.field === 'displayName' ? 'Nombre' : 'Categorías'}: ${approve ? 'ya se ve en tu ficha.' : `no se aplicó. ${req.body.note || ''}`}`, link: '/panel/perfil' });
  res.redirect(`/admin/especialistas/${sp._id}`);
}));

router.post('/especialistas/:id/invitar', asyncHandler(async (req, res) => {
  const sp = await loadSpecialist(req.params.id);
  const { data, ok } = validate(req.body, { email: { type: 'email', required: true } });
  if (!ok) throw badRequest('Ingresá un email válido.');
  if (sp.user) throw badRequest('Este perfil ya tiene dueño.');
  const { url } = await specialists.inviteToClaim(sp, data.email);
  await audit(req, { action: 'specialist.claim_invite', entity: 'Specialist', entityId: sp._id, after: { email: data.email } });
  req.flash('success', `Enviamos la invitación a ${data.email}.${config.isLive ? '' : ` Enlace (solo pruebas): ${url}`}`);
  res.redirect(`/admin/especialistas/${sp._id}`);
}));

router.post('/especialistas/:id/identidad', asyncHandler(async (req, res) => {
  const sp = await loadSpecialist(req.params.id);
  const status = req.body.status === 'verified' ? 'verified' : req.body.status === 'rejected' ? 'rejected' : 'none';
  const before = sp.verification.identity.status;
  sp.verification.identity = { status, at: new Date(), by: req.user._id, note: String(req.body.note || '').slice(0, 300) };
  await sp.save();
  await specialists.syncSearchForSpecialist(sp._id);
  await audit(req, { action: 'specialist.identity', entity: 'Specialist', entityId: sp._id, before: { status: before }, after: { status, note: req.body.note }, severity: 'security' });
  res.redirect(`/admin/especialistas/${sp._id}`);
}));

router.post('/especialistas/:id/eliminar', asyncHandler(async (req, res) => {
  const sp = await loadSpecialist(req.params.id);
  const active = await M.Booking.countDocuments({ specialist: sp._id, status: { $in: ['pending', 'paid', 'confirmed'] }, start: { $gt: new Date() } });
  if (active) throw badRequest(`Tiene ${active} reservas próximas. Cancelalas o reprogramalas antes de dar de baja la ficha.`);
  sp.deletedAt = new Date();
  sp.status = 'inactive';
  await sp.save();
  await specialists.syncSearchForSpecialist(sp._id);
  await audit(req, { action: 'specialist.delete', entity: 'Specialist', entityId: sp._id, severity: 'warning' });
  req.flash('success', 'Dimos de baja la ficha. El historial de reservas y reseñas se conserva.');
  res.redirect('/admin/especialistas');
}));

// Servicios y multimedia de fichas administradas (p. ej. perfiles sin reclamar)
router.get('/especialistas/:id/servicios/nuevo', asyncHandler(async (req, res) => {
  const sp = await loadSpecialist(req.params.id);
  const categories = await M.Category.find({ status: 'active' }).sort({ name: 1 }).lean();
  res.page(V.serviceForm, { sp, categories, values: { durationMinutes: 60, modalities: sp.modalities } });
}));

router.post('/especialistas/:id/servicios', asyncHandler(async (req, res) => {
  const sp = await loadSpecialist(req.params.id);
  const { data, ok, errors } = validate(req.body, {
    title: { type: 'string', required: true, max: 120, label: 'Nombre' }, category: { type: 'objectId', required: true, label: 'Categoría' },
    summary: { type: 'string', max: 240 }, description: { type: 'text', max: 5000 },
    price: { type: 'int', required: true, min: 100, max: 200000, label: 'Precio' }, durationMinutes: { type: 'int', required: true, min: 10, max: 600, label: 'Duración' },
    modalities: { type: 'array', values: ['presencial', 'domicilio', 'online'], required: true, label: 'Modalidades' },
  });
  if (!ok) throw badRequest(Object.values(errors)[0]);
  const s = await M.Service.create({ ...data, specialist: sp._id, slug: await uniqueSlug(M.Service, data.title, { specialist: sp._id }), status: 'active' });
  await specialists.syncSearchForSpecialist(sp._id);
  await audit(req, { action: 'service.admin_create', entity: 'Service', entityId: s._id, after: { title: s.title, price: s.price } });
  res.redirect(`/admin/especialistas/${sp._id}`);
}));

router.post('/especialistas/:id/multimedia', upload.single('file'), asyncHandler(async (req, res) => {
  const sp = await loadSpecialist(req.params.id);
  const kind = { perfil: 'avatar', portada: 'cover', foto: 'photo', video: 'video' }[req.body.tipo] || 'photo';
  const media = await uploadMedia({ file: req.file, kind, specialist: sp._id, owner: req.user._id });
  media.status = 'approved';
  await media.save();
  if (kind === 'avatar') sp.avatar = media._id;
  if (kind === 'cover') sp.cover = media._id;
  if (kind === 'video') sp.video = media._id;
  await sp.save();
  res.redirect(`/admin/especialistas/${sp._id}`);
}));

// ── Verificaciones ────────────────────────────────────────
router.get('/verificaciones', asyncHandler(async (req, res) => {
  const [requests, certs] = await Promise.all([
    M.VerificationRequest.find({ status: req.query.estado || 'pending' }).sort({ createdAt: 1 }).populate('specialist', 'displayName slug claim').populate('documents').lean(),
    M.Certification.find({ status: 'pending' }).populate('specialist', 'displayName').populate('document').lean(),
  ]);
  res.page(V.verifications, { requests, certs, estado: req.query.estado || 'pending' });
}));

router.post('/verificaciones/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const vr = await M.VerificationRequest.findById(req.params.id);
  if (!vr) throw notFound();
  const approve = req.body.decision === 'aprobar';
  vr.status = approve ? 'approved' : 'rejected';
  vr.review = { by: req.user._id, at: new Date(), note: String(req.body.note || '').slice(0, 300) };
  await vr.save();
  const sp = await M.Specialist.findById(vr.specialist);
  sp.verification.identity = { status: approve ? 'verified' : 'rejected', at: new Date(), by: req.user._id, note: vr.review.note };
  await sp.save();
  await specialists.syncSearchForSpecialist(sp._id);
  await audit(req, { action: `verification.${approve ? 'approve' : 'reject'}`, entity: 'Specialist', entityId: sp._id, after: { note: vr.review.note }, severity: 'security' });
  if (sp.user) await notify(sp.user, { type: 'verification_update', title: approve ? 'Identidad verificada' : 'Verificación no aprobada', body: approve ? 'Tu ficha ya muestra el sello de identidad verificada.' : `Motivo: ${vr.review.note || 'documentación insuficiente'}. Podés enviarla de nuevo.`, link: '/panel/verificacion' });
  res.redirect('/admin/verificaciones');
}));

router.post('/certificaciones/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const c = await M.Certification.findById(req.params.id);
  if (!c) throw notFound();
  const approve = req.body.decision === 'aprobar';
  c.status = approve ? 'verified' : 'rejected';
  c.review = { by: req.user._id, at: new Date(), note: String(req.body.note || '').slice(0, 300) };
  await c.save();
  await audit(req, { action: `certification.${approve ? 'verify' : 'reject'}`, entity: 'Certification', entityId: c._id, severity: 'security' });
  const sp = await M.Specialist.findById(c.specialist).select('user').lean();
  if (sp?.user) await notify(sp.user, { type: 'verification_update', title: approve ? 'Certificación verificada' : 'Certificación no verificada', body: `${c.title}${approve ? '' : `: ${c.review.note || 'no pudimos validarla'}`}`, link: '/panel/certificaciones' });
  res.redirect('/admin/verificaciones');
}));

// Documentos privados: solo administración, y queda registrado quién los abrió
router.get('/documentos/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const media = await M.Media.findById(req.params.id).lean();
  if (!media) throw notFound();
  await audit(req, { action: 'document.view', entity: 'Media', entityId: media._id, severity: 'security' });
  if (media.visibility !== 'private') return res.redirect(media.url);
  if (media.storage?.driver === 'cloudinary') return res.redirect(storage().signedUrl(media.storage.key));
  const file = require('../services/storage').drivers.local.privatePath(media.storage?.key);
  if (!file || !fs.existsSync(file)) throw notFound();
  res.set('Cache-Control', 'private, no-store');
  return res.type(media.mime || 'application/octet-stream').sendFile(path.resolve(file));
}));

// ── Usuarios ──────────────────────────────────────────────
router.get('/usuarios', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.q) filter.$or = [{ name: new RegExp(esc(req.query.q), 'i') }, { email: new RegExp(esc(req.query.q), 'i') }];
  if (req.query.rol) filter.role = req.query.rol;
  if (req.query.estado) filter.status = req.query.estado;
  const result = await paginate(M.User, filter, parsePage(req.query), { sort: { createdAt: -1 } });
  res.page(V.users, { result, query: req.query });
}));

router.get('/usuarios/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const u = await M.User.findById(req.params.id).lean();
  if (!u) throw notFound();
  const [bookingsList, tickets, reportsAbout, reportsBy, logs, reviewsList] = await Promise.all([
    M.Booking.find({ user: u._id }).sort({ start: -1 }).limit(50).lean(),
    M.Ticket.find({ user: u._id }).sort({ createdAt: -1 }).lean(),
    M.Report.find({ targetType: 'user', targetId: u._id }).lean(),
    M.Report.find({ reporter: u._id }).sort({ createdAt: -1 }).limit(20).lean(),
    M.AuditLog.find({ $or: [{ actor: u._id }, { entityId: u._id }] }).sort({ createdAt: -1 }).limit(30).lean(),
    M.Review.find({ user: u._id }).populate('service', 'title').lean(),
  ]);
  res.page(V.userDetail, { u, bookings: bookingsList, tickets, reportsAbout, reportsBy, logs, reviews: reviewsList });
}));

router.post('/usuarios/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const u = await M.User.findById(req.params.id);
  if (!u) throw notFound();
  const { data, ok, errors } = validate(req.body, {
    name: { type: 'string', required: true, max: 120 }, phone: { type: 'phone' }, role: { type: 'enum', values: ['user', 'specialist', 'admin'], required: true },
    emailVerified: { type: 'bool' },
  });
  if (!ok) throw badRequest(Object.values(errors)[0]);
  if (String(u._id) === String(req.user._id) && data.role !== 'admin') throw badRequest('No podés quitarte el rol de administrador a vos mismo.');
  if (data.role === 'specialist' && !u.specialist) throw badRequest('El rol de especialista se asigna al crear o reclamar una ficha.');
  const before = { name: u.name, phone: u.phone, role: u.role, emailVerified: u.emailVerified };
  Object.assign(u, data);
  await u.save();
  await audit(req, { action: 'user.admin_update', entity: 'User', entityId: u._id, ...diff(before, data), severity: before.role !== data.role ? 'security' : 'info' });
  req.flash('success', 'Guardamos los cambios.');
  res.redirect(`/admin/usuarios/${u._id}`);
}));

router.post('/usuarios/:id/estado', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const u = await M.User.findById(req.params.id);
  if (!u) throw notFound();
  if (String(u._id) === String(req.user._id)) throw badRequest('No podés suspender tu propia cuenta.');
  const suspend = req.body.status === 'suspended';
  if (suspend && String(req.body.reason || '').trim().length < 5) throw badRequest('Indicá el motivo.');
  const before = u.status;
  u.status = suspend ? 'suspended' : 'active';
  u.suspension = suspend ? { reason: req.body.reason, at: new Date(), by: req.user._id } : undefined;
  await u.save();
  // Las sesiones abiertas quedan sin efecto: loadUser descarta usuarios no activos en cada request.
  await audit(req, { action: `user.${suspend ? 'suspend' : 'reactivate'}`, entity: 'User', entityId: u._id, before: { status: before }, after: { status: u.status, reason: req.body.reason }, severity: 'security' });
  req.flash('success', suspend ? 'Suspendimos la cuenta y cerramos sus sesiones.' : 'Reactivamos la cuenta.');
  res.redirect(`/admin/usuarios/${u._id}`);
}));

// ── Servicios ─────────────────────────────────────────────
router.get('/servicios', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.estado) filter.status = req.query.estado;
  if (isObjectId(req.query.categoria)) filter.category = req.query.categoria;
  if (isObjectId(req.query.especialista)) filter.specialist = req.query.especialista;
  if (req.query.q) filter.title = new RegExp(esc(req.query.q), 'i');
  const [result, categories] = await Promise.all([
    paginate(M.Service, filter, parsePage(req.query), { sort: { createdAt: -1 }, populate: [{ path: 'category', select: 'name' }, { path: 'specialist', select: 'displayName slug' }] }),
    M.Category.find({}).select('name').sort({ name: 1 }).lean(),
  ]);
  res.page(V.services, { result, categories, query: req.query });
}));

router.get('/servicios/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const s = await M.Service.findById(req.params.id).populate('specialist', 'displayName slug').populate('category', 'name').lean();
  if (!s) throw notFound();
  const categories = await M.Category.find({ status: 'active' }).select('name').sort({ name: 1 }).lean();
  res.page(V.serviceDetail, { s, categories });
}));

router.post('/servicios/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const s = await M.Service.findById(req.params.id);
  if (!s) throw notFound();
  const before = { status: s.status, category: String(s.category), title: s.title, description: s.description };
  const { data, ok } = validate(req.body, {
    status: { type: 'enum', values: ['active', 'paused', 'pending_review', 'suspended'], required: true },
    statusReason: { type: 'string', max: 300 },
    category: { type: 'objectId', required: true },
    title: { type: 'string', required: true, max: 120 },
    summary: { type: 'string', max: 240 },
    description: { type: 'text', max: 5000 },
  });
  if (!ok) throw badRequest('Revisá los datos.');
  if (data.title !== s.title) s.slug = await uniqueSlug(M.Service, data.title, { specialist: s.specialist }, s._id);
  Object.assign(s, data);
  await s.save();
  await specialists.syncSearchForSpecialist(s.specialist);
  await audit(req, { action: 'service.moderate', entity: 'Service', entityId: s._id, ...diff(before, { status: s.status, category: String(s.category), title: s.title, description: s.description }), severity: data.status === 'suspended' ? 'warning' : 'info' });
  const sp = await M.Specialist.findById(s.specialist).select('user').lean();
  if (sp?.user && before.status !== s.status) await notify(sp.user, { type: 'moderation_update', title: `Servicio ${s.status === 'active' ? 'publicado' : s.status === 'suspended' ? 'suspendido' : 'actualizado'}`, body: `${s.title}${data.statusReason ? `: ${data.statusReason}` : ''}`, link: `/panel/servicios/${s._id}` });
  req.flash('success', 'Guardamos los cambios.');
  res.redirect(`/admin/servicios/${s._id}`);
}));

// ── Categorías ────────────────────────────────────────────
router.get('/categorias', asyncHandler(async (req, res) => {
  const list = await M.Category.find({}).sort({ status: 1, order: 1, name: 1 }).lean();
  res.page(V.categories, { list });
}));

router.get('/categorias/nueva', (req, res) => res.page(V.categoryForm, { values: { color: '#8B5CF6', icon: 'leaf', status: 'active' } }));

const categoryRules = {
  name: { type: 'string', required: true, max: 80, label: 'Nombre' },
  slug: { type: 'string', max: 80, pattern: /^[a-z0-9-]*$/, patternMessage: 'Solo minúsculas, números y guiones.' },
  description: { type: 'string', max: 1000 },
  longDescription: { type: 'text', max: 6000 },
  icon: { type: 'string', max: 30, default: 'leaf' },
  color: { type: 'string', pattern: /^#[0-9a-fA-F]{6}$/, default: '#8B5CF6' },
  status: { type: 'enum', values: ['active', 'pending', 'hidden'], default: 'active' },
  order: { type: 'int', min: 0, max: 999, default: 0 },
  featured: { type: 'bool' },
  seoTitle: { type: 'string', max: 70 },
  seoDescription: { type: 'string', max: 160 },
};

async function saveCategory(req, cat) {
  const { data, ok, errors } = validate(req.body, categoryRules);
  if (!ok) return { errors };
  const slug = slugify(data.slug || data.name);
  if (RESERVED_SLUGS.has(slug)) return { errors: { slug: 'Ese enlace está reservado por el sistema. Elegí otro.' } };
  if (await M.Category.exists({ slug, _id: { $ne: cat?._id } })) return { errors: { slug: 'Ya existe una categoría con ese enlace.' } };
  const doc = { name: data.name, slug, description: data.description, longDescription: data.longDescription, icon: data.icon, color: data.color, status: data.status, order: data.order, featured: data.featured, seo: { title: data.seoTitle, description: data.seoDescription } };
  if (cat) { cat.set(doc); await cat.save(); return { cat }; }
  return { cat: await M.Category.create(doc) };
}

router.post('/categorias', asyncHandler(async (req, res) => {
  const { errors, cat } = await saveCategory(req, null);
  if (errors) return res.page(V.categoryForm, { values: req.body, errors }, 400);
  await audit(req, { action: 'category.create', entity: 'Category', entityId: cat._id, after: { name: cat.name } });
  return res.redirect('/admin/categorias');
}));

router.get('/categorias/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const c = await M.Category.findById(req.params.id).lean();
  if (!c) throw notFound();
  res.page(V.categoryForm, { values: { ...c, seoTitle: c.seo?.title, seoDescription: c.seo?.description }, editing: c._id });
}));

router.post('/categorias/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const c = await M.Category.findById(req.params.id);
  if (!c) throw notFound();
  const before = { name: c.name, slug: c.slug, status: c.status };
  const { errors } = await saveCategory(req, c);
  if (errors) return res.page(V.categoryForm, { values: { ...req.body }, errors, editing: c._id }, 400);
  // Re-sincroniza servicios de la categoría (visibilidad y slug de búsqueda)
  const sps = await M.Service.distinct('specialist', { category: c._id });
  for (const id of sps) await specialists.syncSearchForSpecialist(id);
  await audit(req, { action: 'category.update', entity: 'Category', entityId: c._id, ...diff(before, { name: c.name, slug: c.slug, status: c.status }) });
  req.flash('success', 'Guardamos la categoría.');
  return res.redirect('/admin/categorias');
}));

// ── Reservas ──────────────────────────────────────────────
router.get('/reservas', asyncHandler(async (req, res) => {
  const filter = {};
  const q = req.query;
  if (q.estado) filter.status = q.estado;
  if (q.incidencia === '1') filter['incident.open'] = true;
  if (D.isValidDateStr(q.desde) || D.isValidDateStr(q.hasta)) {
    filter.start = {};
    if (D.isValidDateStr(q.desde)) filter.start.$gte = D.zonedToUtc(q.desde, '00:00');
    if (D.isValidDateStr(q.hasta)) filter.start.$lt = D.zonedToUtc(D.addDays(q.hasta, 1), '00:00');
  }
  if (isObjectId(q.especialista)) filter.specialist = q.especialista;
  if (isObjectId(q.usuario)) filter.user = q.usuario;
  if (isObjectId(q.servicio)) filter.service = q.servicio;
  if (q.q) {
    const re = new RegExp(esc(q.q), 'i');
    filter.$or = [{ code: q.q.toUpperCase() }, { 'snapshot.userName': re }, { 'snapshot.specialistName': re }, { 'snapshot.serviceTitle': re }];
  }
  const result = await paginate(M.Booking, filter, parsePage(q, { defaultLimit: 30 }), { sort: { start: -1 } });
  res.page(V.bookings, { result, query: q });
}));

router.get('/reservas/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const b = await M.Booking.findById(req.params.id).select('+specialistNotes').lean();
  if (!b) throw notFound();
  const [payment, refunds, user, sp, tickets, logs, review] = await Promise.all([
    b.payment ? M.Payment.findById(b.payment).lean() : null,
    M.Refund.find({ booking: b._id }).lean(),
    M.User.findById(b.user).select('name email phone').lean(),
    M.Specialist.findById(b.specialist).select('displayName slug user').lean(),
    M.Ticket.find({ booking: b._id }).lean(),
    M.AuditLog.find({ entity: 'Booking', entityId: b._id }).sort({ createdAt: -1 }).lean(),
    M.Review.findOne({ booking: b._id }).lean(),
  ]);
  res.page(V.bookingDetail, { b, payment, refunds, user, sp, tickets, logs, review });
}));

router.post('/reservas/:id/cancelar', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const booking = await M.Booking.findById(req.params.id);
  if (!booking) throw notFound();
  const { data, ok } = validate(req.body, {
    reason: { type: 'string', required: true, min: 5, max: 500 },
    refundPercent: { type: 'int', min: 0, max: 100, required: true },
    attributeTo: { type: 'enum', values: ['user', 'specialist'], required: true },
  });
  if (!ok) throw badRequest('Completá motivo, porcentaje de reembolso y a quién se atribuye.');
  const before = { status: booking.status };
  const { refund } = await bookings.cancelBooking({ booking, actor: req.user, actorRole: 'admin', reason: data.reason, refundPercentOverride: data.refundPercent, attributeTo: data.attributeTo });
  await audit(req, { action: 'booking.admin_cancel', entity: 'Booking', entityId: booking._id, before, after: { status: booking.status, refundPercent: data.refundPercent, refund: refund?.amount, reason: data.reason }, severity: 'warning' });
  req.flash('success', `Cancelada. ${refund ? `Reembolso: ${refund.status}.` : 'Sin reembolso.'}`);
  res.redirect(`/admin/reservas/${booking._id}`);
}));

router.post('/reservas/:id/estado', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const booking = await M.Booking.findById(req.params.id);
  if (!booking) throw notFound();
  const action = req.body.action;
  const before = { status: booking.status };
  if (action === 'completar') await bookings.markCompleted(booking, { actor: req.user, actorRole: 'admin' });
  else if (action === 'ausencia_usuario') await bookings.cancelBooking({ booking, actor: req.user, actorRole: 'admin', kind: 'no_show_user', reason: req.body.reason || 'Ausencia del usuario' });
  else if (action === 'ausencia_especialista') await bookings.cancelBooking({ booking, actor: req.user, actorRole: 'admin', kind: 'no_show_specialist', reason: req.body.reason || 'Ausencia del especialista' });
  else if (action === 'confirmar') await bookings.confirmBySpecialist(booking, req.user);
  else throw badRequest('Acción no válida.');
  await audit(req, { action: `booking.admin_${action}`, entity: 'Booking', entityId: booking._id, before, after: { status: booking.status }, severity: 'warning' });
  res.redirect(`/admin/reservas/${booking._id}`);
}));

router.post('/reservas/:id/incidencia', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const b = await M.Booking.findById(req.params.id);
  if (!b) throw notFound();
  const open = req.body.open === '1';
  b.incident = { open, note: String(req.body.note || b.incident?.note || '').slice(0, 1000), at: new Date() };
  b.history.push({ status: b.status, at: new Date(), by: req.user._id, byRole: 'admin', note: open ? `Incidencia abierta: ${req.body.note || ''}` : `Incidencia cerrada: ${req.body.note || ''}` });
  await b.save();
  await audit(req, { action: `booking.incident_${open ? 'open' : 'close'}`, entity: 'Booking', entityId: b._id, after: { note: req.body.note } });
  res.redirect(`/admin/reservas/${b._id}`);
}));

router.post('/reservas/:id/reembolso', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const booking = await M.Booking.findById(req.params.id);
  if (!booking?.payment) throw badRequest('La reserva no tiene un pago asociado.');
  const payment = await M.Payment.findById(booking.payment);
  const { data, ok } = validate(req.body, { percent: { type: 'int', min: 1, max: 100, required: true }, reason: { type: 'string', required: true, min: 5, max: 300 } });
  if (!ok) throw badRequest('Indicá porcentaje y motivo.');
  const remaining = payment.amount - (payment.refundedAmount || 0);
  const split = splitRefund({ total: booking.snapshot.total, commissionAmount: booking.snapshot.commissionAmount, refundPercent: data.percent });
  if (split.amount > remaining) throw badRequest(`Solo quedan ${remaining} UYU sin reembolsar.`);
  const refund = await payments.executeRefund({ booking, payment, split, percent: data.percent, reason: data.reason, rule: 'admin_manual', actor: req.user, actorRole: 'admin' });
  await audit(req, { action: 'refund.admin', entity: 'Booking', entityId: booking._id, after: { amount: split.amount, percent: data.percent, status: refund?.status, reason: data.reason }, severity: 'warning' });
  req.flash(refund?.status === 'processed' ? 'success' : 'error', refund?.status === 'processed' ? 'Reembolso procesado.' : `El reembolso quedó como ${refund?.status}: ${refund?.error || ''}`);
  res.redirect(`/admin/reservas/${booking._id}`);
}));

// ── Pagos, comisiones, reembolsos y liquidaciones ────────
router.get('/pagos', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.estado) filter.status = req.query.estado;
  if (req.query.modelo) filter.collectionModel = req.query.modelo;
  if (req.query.q) filter.providerPaymentId = String(req.query.q);
  const result = await paginate(M.Payment, filter, parsePage(req.query, { defaultLimit: 30 }), { sort: { createdAt: -1 }, populate: [{ path: 'booking', select: 'code snapshot.serviceTitle snapshot.specialistName snapshot.userName' }], select: '-events' });
  const totals = await M.Payment.aggregate([
    { $match: { status: { $in: ['approved', 'partially_refunded', 'refunded', 'offline'] } } },
    { $group: { _id: null, gross: { $sum: '$amount' }, commission: { $sum: '$commissionAmount' }, fees: { $sum: '$providerFee' }, refunded: { $sum: '$refundedAmount' } } },
  ]);
  res.page(V.payments, { result, query: req.query, totals: totals[0] || {} });
}));

router.get('/pagos/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const p = await M.Payment.findById(req.params.id).populate('booking').lean();
  if (!p) throw notFound();
  const refunds = await M.Refund.find({ payment: p._id }).lean();
  res.page(V.paymentDetail, { p, refunds });
}));

router.post('/pagos/:id/sincronizar', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const payment = await M.Payment.findById(req.params.id);
  if (!payment) throw notFound();
  const prov = payments.provider(payment.provider === 'offline' ? config.payments.provider : payment.provider);
  const pid = payment.providerPaymentId || await prov.searchByReference(payment);
  if (!pid) { req.flash('info', 'La pasarela todavía no informa un pago para esta reserva.'); return res.redirect(`/admin/pagos/${payment._id}`); }
  const info = await prov.fetchPayment(pid, { payment });
  await payments.applyProviderStatus(payment, info);
  await audit(req, { action: 'payment.sync', entity: 'Payment', entityId: payment._id, after: { status: info.status } });
  req.flash('success', `Estado en la pasarela: ${info.status}.`);
  return res.redirect(`/admin/pagos/${payment._id}`);
}));

router.get('/comisiones', asyncHandler(async (req, res) => {
  const [rules, specialistsWithRate, categories, specialistsList, bySpecialist, settings] = await Promise.all([
    M.CommissionRule.find({}).sort({ active: -1, createdAt: -1 }).populate('specialist', 'displayName').populate('category', 'name').lean(),
    M.Specialist.find({ commissionRate: { $ne: null } }).select('displayName commissionRate').lean(),
    M.Category.find({}).select('name').sort({ name: 1 }).lean(),
    M.Specialist.find({ deletedAt: null }).select('displayName').sort({ displayName: 1 }).lean(),
    M.Payment.aggregate([
      { $match: { status: { $in: ['approved', 'partially_refunded', 'offline'] }, createdAt: { $gte: new Date(Date.now() - 90 * 86400000) } } },
      { $group: { _id: '$specialist', commission: { $sum: '$commissionAmount' }, gross: { $sum: '$amount' }, n: { $sum: 1 } } },
      { $sort: { commission: -1 } }, { $limit: 30 },
      { $lookup: { from: 'specialists', localField: '_id', foreignField: '_id', as: 'sp' } },
    ]),
    getSettings(),
  ]);
  res.page(V.commissions, { rules, specialistsWithRate, categories, specialistsList, bySpecialist, settings });
}));

router.post('/comisiones/reglas', asyncHandler(async (req, res) => {
  const { data, ok, errors } = validate(req.body, {
    name: { type: 'string', required: true, max: 100, label: 'Nombre' },
    scope: { type: 'enum', values: ['promotion', 'specialist', 'category'], required: true },
    rate: { type: 'number', required: true, min: 0, max: 50, label: 'Tasa' },
    specialist: { type: 'objectId' }, category: { type: 'objectId' },
    validFrom: { type: 'date' }, validTo: { type: 'date' },
  });
  if (!ok) throw badRequest(Object.values(errors)[0]);
  if (data.scope === 'specialist' && !data.specialist) throw badRequest('Elegí el especialista.');
  if (data.scope === 'category' && !data.category) throw badRequest('Elegí la categoría.');
  const rule = await M.CommissionRule.create({
    ...data,
    appliesToSpecialists: data.scope === 'promotion' && data.specialist ? [data.specialist] : [],
    appliesToCategories: data.scope === 'promotion' && data.category ? [data.category] : [],
    validFrom: data.validFrom ? D.zonedToUtc(data.validFrom, '00:00') : undefined,
    validTo: data.validTo ? D.zonedToUtc(D.addDays(data.validTo, 1), '00:00') : undefined,
    createdBy: req.user._id,
  });
  clearRulesCache();
  await audit(req, { action: 'commission.rule_create', entity: 'CommissionRule', entityId: rule._id, after: data, severity: 'warning' });
  req.flash('success', 'Creamos la regla. Aplica a las reservas nuevas; las existentes conservan su comisión.');
  res.redirect('/admin/comisiones');
}));

router.post('/comisiones/reglas/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const rule = await M.CommissionRule.findById(req.params.id);
  if (!rule) throw notFound();
  rule.active = !rule.active;
  await rule.save();
  clearRulesCache();
  await audit(req, { action: `commission.rule_${rule.active ? 'enable' : 'disable'}`, entity: 'CommissionRule', entityId: rule._id, severity: 'warning' });
  res.redirect('/admin/comisiones');
}));

router.get('/reembolsos', asyncHandler(async (req, res) => {
  const filter = req.query.estado ? { status: req.query.estado } : {};
  const result = await paginate(M.Refund, filter, parsePage(req.query, { defaultLimit: 30 }), { sort: { createdAt: -1 }, populate: [{ path: 'booking', select: 'code snapshot.serviceTitle snapshot.userName snapshot.specialistName' }] });
  res.page(V.refunds, { result, query: req.query });
}));

router.post('/reembolsos/:id/reintentar', asyncHandler(async (req, res) => {
  const refund = await payments.retryRefund(req.params.id);
  await audit(req, { action: 'refund.retry', entity: 'Refund', entityId: refund._id, after: { status: refund.status }, severity: 'warning' });
  req.flash('success', 'Reembolso procesado.');
  res.redirect('/admin/reembolsos');
}));

router.post('/reembolsos/:id/manual', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const refund = await M.Refund.findById(req.params.id);
  if (!refund) throw notFound();
  const note = String(req.body.note || '').trim();
  if (note.length < 5) throw badRequest('Indicá cómo se realizó la devolución (comprobante, transferencia, etc.).');
  refund.status = 'processed';
  refund.processedAt = new Date();
  refund.error = `Gestionado manualmente: ${note}`;
  await refund.save();
  await M.Payment.updateOne({ _id: refund.payment }, { $inc: { refundedAmount: refund.amount } });
  const p = await M.Payment.findById(refund.payment);
  p.status = p.refundedAmount >= p.amount ? 'refunded' : 'partially_refunded';
  await p.save();
  await M.Booking.updateOne({ _id: refund.booking }, { $set: { 'incident.open': false } });
  await audit(req, { action: 'refund.manual', entity: 'Refund', entityId: refund._id, after: { note }, severity: 'warning' });
  res.redirect('/admin/reembolsos');
}));

router.get('/liquidaciones', asyncHandler(async (req, res) => {
  const [preview, list, settings] = await Promise.all([
    payouts.settleableBySpecialist(new Date()),
    M.Payout.find({}).sort({ createdAt: -1 }).limit(100).populate('specialist', 'displayName business').lean(),
    getSettings(),
  ]);
  const ids = preview.map((p) => p.specialist);
  const names = new Map((await M.Specialist.find({ _id: { $in: ids } }).select('displayName').lean()).map((s) => [String(s._id), s.displayName]));
  res.page(V.payouts, { preview: preview.map((p) => ({ ...p, name: names.get(String(p.specialist)) })), list, settings });
}));

router.post('/liquidaciones/generar', asyncHandler(async (req, res) => {
  const created = await payouts.generatePayouts({ until: new Date(), admin: req.user });
  await audit(req, { action: 'payout.generate', entity: 'Payout', summary: `${created.length} liquidaciones`, severity: 'warning' });
  req.flash('success', created.length ? `Generamos ${created.length} liquidaciones.` : 'No hay pagos para liquidar.');
  res.redirect('/admin/liquidaciones');
}));

router.post('/liquidaciones/:id/pagar', asyncHandler(async (req, res) => {
  const p = await payouts.markPayoutPaid(req.params.id, { reference: req.body.reference, admin: req.user });
  await audit(req, { action: 'payout.paid', entity: 'Payout', entityId: p._id, after: { net: p.net, reference: p.reference }, severity: 'warning' });
  res.redirect('/admin/liquidaciones');
}));

router.post('/liquidaciones/:id/anular', asyncHandler(async (req, res) => {
  const p = await payouts.cancelPayout(req.params.id);
  await audit(req, { action: 'payout.cancel', entity: 'Payout', entityId: p._id, severity: 'warning' });
  res.redirect('/admin/liquidaciones');
}));

// ── Reseñas, moderación y denuncias ───────────────────────
router.get('/resenas', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.estado) filter.status = req.query.estado;
  if (req.query.estrellas) filter.rating = Number(req.query.estrellas);
  if (req.query.q) filter.comment = new RegExp(esc(req.query.q), 'i');
  const result = await paginate(M.Review, filter, parsePage(req.query, { defaultLimit: 30 }), { sort: { createdAt: -1 }, populate: [{ path: 'service', select: 'title' }, { path: 'specialist', select: 'displayName slug' }] });
  const reportCounts = await M.Report.aggregate([{ $match: { targetType: 'review', targetId: { $in: result.items.map((r) => r._id) } } }, { $group: { _id: '$targetId', n: { $sum: 1 } } }]);
  res.page(V.reviews, { result, query: req.query, reportCounts: new Map(reportCounts.map((r) => [String(r._id), r.n])) });
}));

router.post('/resenas/:id', asyncHandler(async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (req.body.action === 'hide' && reason.length < 5) throw badRequest('Indicá el motivo de la moderación.');
  const { review, before } = await reviewsService.moderateReview(req.params.id, { action: req.body.action, reason, admin: req.user });
  await audit(req, { action: `review.${req.body.action}`, entity: 'Review', entityId: review._id, before: { status: before }, after: { status: review.status, reason }, severity: 'warning' });
  const sp = await M.Specialist.findById(review.specialist).select('user').lean();
  if (sp?.user && review.reviewRequest?.at) await notify(sp.user, { type: 'moderation_update', title: 'Revisión de reseña resuelta', body: review.status === 'hidden' ? 'Ocultamos la reseña porque incumplía las reglas.' : 'La reseña cumple las reglas y se mantiene publicada.', link: '/panel/resenas' });
  res.redirect('back');
}));

router.get('/moderacion', asyncHandler(async (req, res) => {
  const tab = ['pendiente', 'reportada', 'cambios', 'servicios'].includes(req.query.tab) ? req.query.tab : 'pendiente';
  const [media, changes, services] = await Promise.all([
    M.Media.find({ status: tab === 'reportada' ? { $in: ['reported'] } : 'pending', visibility: 'public' }).sort({ createdAt: 1 }).limit(100).populate('specialist', 'displayName slug').lean()
      .then(async (list) => (tab === 'reportada' ? list.concat(await M.Media.find({ reportsCount: { $gt: 0 }, status: 'approved' }).limit(100).populate('specialist', 'displayName slug').lean()) : list)),
    M.Specialist.find({ 'pendingChanges.0': { $exists: true } }).select('displayName pendingChanges categories').lean(),
    M.Service.find({ status: 'pending_review' }).populate('specialist', 'displayName').populate('category', 'name').lean(),
  ]);
  const categories = await M.Category.find({}).select('name').lean();
  res.page(V.moderation, { tab, media, changes, services, categories });
}));

router.post('/moderacion/media/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const media = await M.Media.findById(req.params.id);
  if (!media) throw notFound();
  const action = req.body.action;
  if (action === 'aprobar') { media.status = 'approved'; media.reportsCount = 0; await media.save(); }
  else if (action === 'rechazar') { media.status = 'rejected'; media.moderation = { by: req.user._id, at: new Date(), reason: req.body.reason }; await media.save(); }
  else if (action === 'eliminar') await removeMedia(media);
  else throw badRequest('Acción no válida.');
  await M.Report.updateMany({ targetType: 'media', targetId: media._id, status: 'open' }, { $set: { status: 'resolved', resolution: { by: req.user._id, at: new Date(), action } } });
  await audit(req, { action: `media.${action}`, entity: 'Media', entityId: media._id, after: { reason: req.body.reason } });
  const sp = media.specialist ? await M.Specialist.findById(media.specialist).select('user').lean() : null;
  if (sp?.user && action !== 'aprobar') await notify(sp.user, { type: 'moderation_update', title: 'Un archivo no se publicó', body: req.body.reason || 'No cumple las reglas de contenido.', link: '/panel/perfil/multimedia' });
  res.redirect('back');
}));

router.get('/denuncias', asyncHandler(async (req, res) => {
  const filter = { status: req.query.estado || 'open' };
  if (req.query.tipo) filter.targetType = req.query.tipo;
  const result = await paginate(M.Report, filter, parsePage(req.query, { defaultLimit: 30 }), { sort: { createdAt: -1 }, populate: [{ path: 'reporter', select: 'name email' }] });
  // Resumen de cada objetivo para decidir sin abrir otra pantalla
  const targets = {};
  for (const r of result.items) {
    const key = `${r.targetType}:${r.targetId}`;
    if (targets[key]) continue;
    const Model = { review: M.Review, media: M.Media, specialist: M.Specialist, service: M.Service, user: M.User, message: M.Message }[r.targetType];
    targets[key] = Model ? await Model.findById(r.targetId).lean() : null;
  }
  res.page(V.reports, { result, query: req.query, targets, reasons: REPORT_REASONS });
}));

router.post('/denuncias/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const r = await M.Report.findById(req.params.id);
  if (!r) throw notFound();
  r.status = req.body.decision === 'descartar' ? 'dismissed' : 'resolved';
  r.resolution = { by: req.user._id, at: new Date(), action: req.body.action || req.body.decision, note: String(req.body.note || '').slice(0, 500) };
  await r.save();
  await audit(req, { action: `report.${r.status}`, entity: 'Report', entityId: r._id, after: r.resolution });
  res.redirect('back');
}));

// ── Destacados y promociones ──────────────────────────────
router.get('/destacados', asyncHandler(async (req, res) => {
  const [list, specialistsList, categories] = await Promise.all([
    M.SponsoredPlacement.find({}).sort({ createdAt: -1 }).limit(200).populate('specialist', 'displayName').populate('category', 'name').populate('service', 'title').lean(),
    M.Specialist.find({ status: 'active' }).select('displayName').sort({ displayName: 1 }).lean(),
    M.Category.find({ status: 'active' }).select('name').lean(),
  ]);
  res.page(V.sponsored, { list, specialists: specialistsList, categories, departments: DEPARTMENTS });
}));

router.post('/destacados', asyncHandler(async (req, res) => {
  const { data, ok, errors } = validate(req.body, {
    specialist: { type: 'objectId', required: true, label: 'Especialista' },
    type: { type: 'enum', values: ['category', 'zone', 'home', 'recommendation', 'search'], required: true },
    category: { type: 'objectId' }, department: { type: 'enum', values: ['', ...DEPARTMENTS] }, keywords: { type: 'string', max: 200 },
    startsAt: { type: 'date', required: true }, endsAt: { type: 'date', required: true },
    price: { type: 'int', min: 0, default: 0 }, paymentStatus: { type: 'enum', values: ['pending', 'paid', 'waived'], default: 'pending' },
  });
  if (!ok) throw badRequest(Object.values(errors)[0]);
  if (data.endsAt < data.startsAt) throw badRequest('La fecha de fin es anterior al inicio.');
  const startsAt = D.zonedToUtc(data.startsAt, '00:00');
  const p = await M.SponsoredPlacement.create({
    ...data, keywords: (data.keywords || '').split(',').map((k) => slugify(k).replace(/-/g, ' ')).filter(Boolean),
    startsAt, endsAt: D.zonedToUtc(D.addDays(data.endsAt, 1), '00:00'), status: startsAt <= new Date() ? 'active' : 'scheduled', createdBy: req.user._id,
  });
  await audit(req, { action: 'sponsored.create', entity: 'SponsoredPlacement', entityId: p._id, after: data });
  res.redirect('/admin/destacados');
}));

router.post('/destacados/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const p = await M.SponsoredPlacement.findById(req.params.id);
  if (!p) throw notFound();
  const { status, paymentStatus, price } = req.body;
  if (['scheduled', 'active', 'paused', 'ended', 'cancelled'].includes(status)) p.status = status;
  if (['pending', 'paid', 'waived'].includes(paymentStatus)) p.paymentStatus = paymentStatus;
  if (price !== undefined && price !== '' && Number.isFinite(Number(price))) p.price = Math.max(0, Math.round(Number(price)));
  if (p.status === 'active' && p.startsAt > new Date()) p.status = 'scheduled';
  await p.save();
  await audit(req, { action: 'sponsored.update', entity: 'SponsoredPlacement', entityId: p._id, after: { status: p.status, paymentStatus: p.paymentStatus, price: p.price } });
  res.redirect('/admin/destacados');
}));

router.get('/promociones', asyncHandler(async (req, res) => {
  const list = await M.Promotion.find({}).sort({ createdAt: -1 }).limit(200).populate('specialist', 'displayName').lean();
  res.page(V.promotions, { list });
}));

router.post('/promociones', asyncHandler(async (req, res) => {
  const { data, ok, errors } = validate(req.body, {
    title: { type: 'string', required: true, max: 100, label: 'Título' }, discountPercent: { type: 'int', required: true, min: 1, max: 50 },
    code: { type: 'string', max: 20 }, audience: { type: 'enum', values: ['all', 'new_clients', 'returning_clients'], default: 'all' },
    validFrom: { type: 'date' }, validTo: { type: 'date' }, maxUses: { type: 'int', min: 0, default: 0 },
  });
  if (!ok) throw badRequest(Object.values(errors)[0]);
  // Promoción institucional: financiada con la tarifa de Alternativa (no reduce el neto del especialista)
  const p = await M.Promotion.create({
    ...data, specialist: null, fundedBy: 'platform', code: data.code ? data.code.toUpperCase() : undefined,
    validFrom: data.validFrom ? D.zonedToUtc(data.validFrom, '00:00') : undefined, validTo: data.validTo ? D.zonedToUtc(D.addDays(data.validTo, 1), '00:00') : undefined,
    createdBy: req.user._id,
  });
  await audit(req, { action: 'promotion.create', entity: 'Promotion', entityId: p._id, after: data });
  res.redirect('/admin/promociones');
}));

router.post('/promociones/:id/estado', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const p = await M.Promotion.findById(req.params.id);
  if (!p) throw notFound();
  if (['active', 'paused', 'ended'].includes(req.body.status)) p.status = req.body.status;
  await p.save();
  await audit(req, { action: 'promotion.status', entity: 'Promotion', entityId: p._id, after: { status: p.status } });
  res.redirect('/admin/promociones');
}));

// ── Configuración ─────────────────────────────────────────
router.get('/configuracion', asyncHandler(async (req, res) => {
  const settings = await getSettings({ fresh: true });
  res.page(V.settings, { settings, section: DEFAULTS[req.query.seccion] ? req.query.seccion : 'site', env: { provider: config.payments.provider, storage: config.storage.driver, email: config.email.provider, push: !!config.push.publicKey, whatsapp: !!config.whatsapp.token, appEnv: config.appEnv } });
}));

router.post('/configuracion/:section', asyncHandler(async (req, res) => {
  const section = req.params.section;
  const defs = DEFAULTS[section];
  if (!defs) throw notFound();
  const value = {};
  for (const [key, def] of Object.entries(defs)) {
    const raw = req.body[key];
    if (typeof def === 'boolean') value[key] = raw === 'on' || raw === 'true' || raw === '1';
    else if (typeof def === 'number') {
      if (raw === undefined || raw === '') continue;
      const n = Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) throw badRequest(`Valor no válido para ${key}.`);
      value[key] = n;
    } else if (typeof def === 'string') {
      if (raw === undefined) continue;
      value[key] = String(raw).trim().slice(0, 500);
    }
  }
  // Reglas de coherencia
  if (section === 'commission' && (value.globalRate > 50)) throw badRequest('La comisión global no puede superar el 50%.');
  if (section === 'commission' && value.feeMode && !['added', 'included'].includes(value.feeMode)) throw badRequest('Modo de tarifa no válido.');
  if (section === 'commission' && value.priceDisplay && !['total', 'breakdown'].includes(value.priceDisplay)) throw badRequest('Visualización no válida.');
  if (section === 'payments') {
    if (value.collectionModel && !['split', 'platform', 'offline'].includes(value.collectionModel)) throw badRequest('Modelo de cobro no válido.');
    if (value.processorFeePaidBy && !['specialist', 'customer', 'platform'].includes(value.processorFeePaidBy)) throw badRequest('Opción no válida.');
    if (value.processorFeePercent > 20) throw badRequest('El costo del procesador parece demasiado alto.');
    if (value.paymentWindowMinutes !== undefined && (value.paymentWindowMinutes < 5 || value.paymentWindowMinutes > 120)) throw badRequest('El plazo de pago debe estar entre 5 y 120 minutos.');
  }
  if (section === 'cancellation' && value.partialRefundHours > value.fullRefundHours) throw badRequest('Las horas de reembolso parcial deben ser menores que las de reembolso total.');
  if (section === 'messaging' && value.contactPolicy && !['always', 'after_booking', 'never'].includes(value.contactPolicy)) throw badRequest('Política no válida.');
  const { before, after } = await updateSection(section, value, req.user);
  if (section === 'commission' || section === 'payments') clearRulesCache();
  if (section === 'discovery') {
    const active = await M.Specialist.find({ status: 'active' }).select('_id').lean();
    for (const sp of active) await specialists.syncSearchForSpecialist(sp._id);
  }
  await audit(req, { action: `settings.${section}`, entity: 'Setting', ...diff(before, after), severity: ['commission', 'payments', 'cancellation'].includes(section) ? 'warning' : 'info' });
  req.flash('success', 'Guardamos la configuración. Aplica a las operaciones nuevas.');
  res.redirect(`/admin/configuracion?seccion=${section}`);
}));

// ── Avisos y contenido ────────────────────────────────────
router.get('/notificaciones', asyncHandler(async (req, res) => {
  const list = await M.Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
  await M.Notification.updateMany({ user: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
  const sent = await M.AuditLog.find({ action: 'broadcast.send' }).sort({ createdAt: -1 }).limit(10).lean();
  res.page(V.notifications, { list, sent });
}));

router.post('/notificaciones/enviar', asyncHandler(async (req, res) => {
  const { data, ok, errors } = validate(req.body, {
    audience: { type: 'enum', values: ['all', 'users', 'specialists', 'email'], required: true },
    email: { type: 'email' }, title: { type: 'string', required: true, max: 120 }, body: { type: 'text', required: true, max: 1000 },
    link: { type: 'string', max: 200 }, sendEmail: { type: 'bool' },
  });
  if (!ok) throw badRequest(Object.values(errors)[0]);
  if (data.link && !data.link.startsWith('/')) throw badRequest('El enlace debe ser interno (empezar con /).');
  const filter = { status: 'active' };
  if (data.audience === 'users') filter.specialist = null;
  if (data.audience === 'specialists') filter.specialist = { $ne: null };
  if (data.audience === 'email') filter.email = data.email;
  const recipients = await M.User.find(filter).select('_id email preferences status').lean();
  let n = 0;
  for (const u of recipients) {
    await notify(u, { type: 'account', title: data.title, body: data.body, link: data.link || '/', channels: { email: data.sendEmail && (data.audience === 'email' || u.preferences?.notifications?.marketing), whatsapp: false } });
    n++;
  }
  await audit(req, { action: 'broadcast.send', entity: 'Notification', summary: `${data.title} → ${data.audience} (${n})` });
  req.flash('success', `Enviamos el aviso a ${n} cuenta(s).`);
  res.redirect('/admin/notificaciones');
}));

router.get('/contenido', asyncHandler(async (req, res) => {
  const tipo = ['post', 'faq', 'page'].includes(req.query.tipo) ? req.query.tipo : 'post';
  const list = await M.Content.find({ type: tipo }).sort(tipo === 'faq' ? { category: 1, order: 1 } : { updatedAt: -1 }).lean();
  res.page(V.contentList, { tipo, list });
}));

router.get('/contenido/nuevo', (req, res) => {
  const tipo = ['post', 'faq', 'page'].includes(req.query.tipo) ? req.query.tipo : 'post';
  res.page(V.contentForm, { values: { type: tipo, status: 'draft', slug: req.query.slug || '' } });
});

async function saveContent(req, doc) {
  const { data, ok, errors } = validate(req.body, {
    type: { type: 'enum', values: ['post', 'faq', 'page'], required: true },
    title: { type: 'string', required: true, max: 200, label: 'Título' }, slug: { type: 'string', max: 120 },
    excerpt: { type: 'string', max: 400 }, body: { type: 'text', required: true, max: 60000, label: 'Contenido' },
    coverUrl: { type: 'url' }, category: { type: 'string', max: 60 }, tags: { type: 'string', max: 200 },
    status: { type: 'enum', values: ['draft', 'published'], default: 'draft' }, order: { type: 'int', min: 0, max: 999, default: 0 },
    seoTitle: { type: 'string', max: 70 }, seoDescription: { type: 'string', max: 160 },
  });
  if (!ok) return { errors };
  const slug = data.type === 'faq' ? undefined : slugify(data.slug || data.title);
  if (slug && await M.Content.exists({ type: data.type, slug, _id: { $ne: doc?._id } })) return { errors: { slug: 'Ya existe contenido con ese enlace.' } };
  const fields = {
    type: data.type, title: data.title, slug, excerpt: data.excerpt, body: data.body, coverUrl: data.coverUrl, category: data.category,
    tags: (data.tags || '').split(',').map((t) => slugify(t)).filter(Boolean), status: data.status, order: data.order,
    seo: { title: data.seoTitle, description: data.seoDescription }, updatedBy: req.user._id,
  };
  if (data.status === 'published' && !doc?.publishedAt) fields.publishedAt = new Date();
  if (doc) { doc.set(fields); await doc.save(); return { doc }; }
  return { doc: await M.Content.create({ ...fields, author: req.user._id }) };
}

router.post('/contenido', asyncHandler(async (req, res) => {
  const { errors, doc } = await saveContent(req, null);
  if (errors) return res.page(V.contentForm, { values: req.body, errors }, 400);
  await audit(req, { action: 'content.create', entity: 'Content', entityId: doc._id, after: { title: doc.title, type: doc.type } });
  return res.redirect(`/admin/contenido?tipo=${doc.type}`);
}));

router.get('/contenido/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const c = await M.Content.findById(req.params.id).lean();
  if (!c) throw notFound();
  res.page(V.contentForm, { values: { ...c, tags: (c.tags || []).join(', '), seoTitle: c.seo?.title, seoDescription: c.seo?.description }, editing: c._id });
}));

router.post('/contenido/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const c = await M.Content.findById(req.params.id);
  if (!c) throw notFound();
  const { errors } = await saveContent(req, c);
  if (errors) return res.page(V.contentForm, { values: req.body, errors, editing: c._id }, 400);
  await audit(req, { action: 'content.update', entity: 'Content', entityId: c._id, after: { title: c.title, status: c.status } });
  req.flash('success', 'Guardamos el contenido.');
  return res.redirect(`/admin/contenido?tipo=${c.type}`);
}));

router.post('/contenido/:id/eliminar', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const c = await M.Content.findById(req.params.id);
  if (!c) throw notFound();
  await c.deleteOne();
  await audit(req, { action: 'content.delete', entity: 'Content', entityId: c._id, before: { title: c.title } });
  res.redirect(`/admin/contenido?tipo=${c.type}`);
}));

router.post('/contenido-imagen', upload.single('file'), asyncHandler(async (req, res) => {
  const media = await uploadMedia({ file: req.file, kind: 'content', owner: req.user._id });
  req.flash('success', `Imagen subida. URL: ${media.url}`);
  res.redirect('back');
}));

// ── Auditoría ─────────────────────────────────────────────
router.get('/auditoria', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.accion) filter.action = new RegExp(`^${esc(req.query.accion)}`);
  if (req.query.entidad) filter.entity = req.query.entidad;
  if (req.query.severidad) filter.severity = req.query.severidad;
  if (isObjectId(req.query.actor)) filter.actor = req.query.actor;
  if (isObjectId(req.query.objeto)) filter.entityId = req.query.objeto;
  const result = await paginate(M.AuditLog, filter, parsePage(req.query, { defaultLimit: 50 }), { sort: { createdAt: -1 } });
  res.page(V.audit, { result, query: req.query });
}));

// ── Soporte ───────────────────────────────────────────────
router.get('/soporte', asyncHandler(async (req, res) => {
  const filter = req.query.estado ? { status: req.query.estado } : { status: { $in: ['open', 'waiting_user'] } };
  if (req.query.tema) filter.topic = req.query.tema;
  const result = await paginate(M.Ticket, filter, parsePage(req.query, { defaultLimit: 30 }), { sort: { priority: 1, updatedAt: -1 }, populate: [{ path: 'user', select: 'name email' }, { path: 'booking', select: 'code' }] });
  res.page(V.tickets, { result, query: req.query });
}));

router.get('/soporte/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const t = await M.Ticket.findById(req.params.id).populate('user', 'name email role specialist').populate('booking', 'code status snapshot start').lean();
  if (!t) throw notFound();
  res.page(V.ticketDetail, { t });
}));

router.post('/soporte/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const t = await M.Ticket.findById(req.params.id);
  if (!t) throw notFound();
  const body = String(req.body.body || '').trim();
  if (body) t.messages.push({ author: req.user._id, authorRole: 'admin', body: body.slice(0, 5000) });
  if (['open', 'waiting_user', 'resolved', 'closed'].includes(req.body.status)) t.status = req.body.status;
  if (['low', 'normal', 'high'].includes(req.body.priority)) t.priority = req.body.priority;
  t.assignedTo = req.user._id;
  await t.save();
  if (body) {
    if (t.user) await notify(t.user, { type: 'account', title: `Respuesta a tu consulta #${t.number}`, body: body.slice(0, 200), link: `/mi/ayuda/${t._id}` });
    else if (t.email) await sendEmail({ to: t.email, subject: `Re: ${t.subject} (#${t.number})`, html: emailLayout({ title: `Respuesta a tu consulta #${t.number}`, body: `<p style="white-space:pre-wrap">${body.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])}</p>`, footer: 'Podés responder este email o escribirnos desde Contacto.' }), replyTo: (await getSettings()).site.contactEmail });
  }
  await audit(req, { action: 'ticket.reply', entity: 'Ticket', entityId: t._id, after: { status: t.status } });
  res.redirect(`/admin/soporte/${t._id}`);
}));

module.exports = router;
