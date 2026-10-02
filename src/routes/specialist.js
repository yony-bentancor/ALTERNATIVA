'use strict';
const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const D = require('../lib/dates');
const { asyncHandler, notFound, forbidden, badRequest } = require('../lib/errors');
const { validate, isObjectId } = require('../lib/validate');
const { uniqueSlug } = require('../lib/slug');
const { requireAuth, requireSpecialist } = require('../middleware/auth');
const upload = require('../middleware/upload');
const limits = require('../middleware/rateLimit');
const { DEPARTMENTS, CANCELLED_STATUSES } = require('../lib/constants');
const specialists = require('../services/specialists');
const bookings = require('../services/bookings');
const reviews = require('../services/reviews');
const messaging = require('../services/messaging');
const { uploadMedia, removeMedia } = require('../services/media');
const { specialistDashboard } = require('../services/stats');
const { getAvailabilityFor, summaryForRange } = require('../services/availability');
const { normalizeRanges } = require('../services/availability');
const { getSettings } = require('../services/settings');
const { notifyAdmins } = require('../services/notifications');
const { audit } = require('../services/audit');
const { commissionFor, priceBreakdown } = require('../services/commission');
const mp = require('../services/payments/mercadopago');
const V = require('../views/specialist');
const A = require('../views/account');
const M = require('../models');

const router = express.Router();
router.use(requireAuth);

// ── Alta de la ficha ──────────────────────────────────────
router.get('/comenzar', asyncHandler(async (req, res) => {
  if (req.user.specialist) return res.redirect('/panel');
  const settings = await getSettings();
  if (!settings.site.allowSpecialistSignup) { req.flash('info', 'Por ahora el alta de especialistas es por invitación. Escribinos desde Contacto.'); return res.redirect('/contacto'); }
  const categories = await M.Category.find({ status: 'active' }).sort({ order: 1, name: 1 }).lean();
  return res.page(V.onboarding, { categories, values: { displayName: req.user.name }, departments: DEPARTMENTS });
}));

router.post('/comenzar', asyncHandler(async (req, res) => {
  if (req.user.specialist) return res.redirect('/panel');
  const categories = await M.Category.find({ status: 'active' }).sort({ order: 1, name: 1 }).lean();
  const { data, errors, ok } = validate(req.body, {
    displayName: { type: 'string', required: true, min: 2, max: 120, label: 'Nombre profesional' },
    headline: { type: 'string', max: 160 },
    categories: { type: 'array', of: 'objectId', required: true, max: 6, label: 'Categorías' },
    modalities: { type: 'array', values: ['presencial', 'domicilio', 'online'], required: true, label: 'Modalidades' },
    department: { type: 'enum', values: DEPARTMENTS, required: true, label: 'Departamento' },
    city: { type: 'string', required: true, max: 80, label: 'Ciudad' },
  });
  if (!ok) return res.page(V.onboarding, { categories, values: req.body, errors, departments: DEPARTMENTS }, 400);
  const sp = await specialists.createForUser(req.user, data);
  await audit(req, { action: 'specialist.create_self', entity: 'Specialist', entityId: sp._id });
  req.flash('success', 'Creamos tu ficha. Completá los pasos para publicarla.');
  return res.redirect('/panel');
}));

router.use(requireSpecialist);

const own = (doc, sp) => doc && String(doc.specialist) === String(sp._id);

// ── Inicio ────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const sp = req.specialist;
  const now = new Date();
  const todayStart = D.zonedToUtc(D.todayStr(), '00:00');
  const todayEnd = D.zonedToUtc(D.addDays(D.todayStr(), 1), '00:00');
  const [stats, completeness, today, toConfirm, upcomingCount, recentReviews, pendingClaimVerification] = await Promise.all([
    specialistDashboard(sp._id, '30d'),
    specialists.profileCompleteness(sp),
    M.Booking.find({ specialist: sp._id, start: { $gte: todayStart, $lt: todayEnd }, status: { $in: ['paid', 'confirmed', 'completed'] } }).sort({ start: 1 }).lean(),
    M.Booking.find({ specialist: sp._id, status: 'paid' }).sort({ start: 1 }).limit(10).lean(),
    M.Booking.countDocuments({ specialist: sp._id, status: { $in: ['paid', 'confirmed'] }, start: { $gt: now } }),
    M.Review.find({ specialist: sp._id }).sort({ createdAt: -1 }).limit(3).populate('service', 'title').lean(),
    M.VerificationRequest.exists({ specialist: sp._id, status: 'pending' }),
  ]);
  res.page(V.dashboard, { sp, stats, completeness, today, toConfirm, upcomingCount, recentReviews, pendingClaimVerification });
}));

router.get('/mas', (req, res) => res.page(V.more, {}));

router.post('/publicar', asyncHandler(async (req, res) => {
  const sp = req.specialist;
  const settings = await getSettings();
  const c = await specialists.profileCompleteness(sp);
  if (!c.ready) throw badRequest(`Antes de publicar te falta: ${c.missing.map((m) => m.label.toLowerCase()).join(', ')}.`);
  if (!['draft', 'inactive'].includes(sp.status)) return res.redirect('/panel');
  const status = settings.moderation.newSpecialistsRequireReview && !sp.publishedAt ? 'pending_review' : 'active';
  await specialists.setStatus(sp._id, status);
  await audit(req, { action: 'specialist.publish_request', entity: 'Specialist', entityId: sp._id, after: { status } });
  if (status === 'pending_review') {
    await notifyAdmins({ title: 'Ficha para revisar', body: `${sp.displayName} pidió publicar su ficha.`, link: `/admin/especialistas/${sp._id}`, dedupeKey: `publish:${sp._id}:${Date.now()}` });
    req.flash('success', 'Enviamos tu ficha a revisión. Te avisamos cuando esté publicada (normalmente en menos de 48 h).');
  } else {
    req.flash('success', '¡Tu ficha está publicada!');
  }
  return res.redirect('/panel');
}));

router.post('/pausar', asyncHandler(async (req, res) => {
  if (req.specialist.status !== 'active') return res.redirect('/panel');
  await specialists.setStatus(req.specialist._id, 'inactive', 'Pausado por el especialista');
  req.flash('success', 'Pausaste tu ficha: no aparece en búsquedas y no recibe reservas nuevas. Las reservas existentes se mantienen.');
  return res.redirect('/panel/cuenta');
}));

// ── Perfil ────────────────────────────────────────────────
router.get('/perfil', asyncHandler(async (req, res) => {
  const sp = req.specialist;
  const [completeness, categories, avatar, cover] = await Promise.all([
    specialists.profileCompleteness(sp),
    M.Category.find({ _id: { $in: sp.categories } }).select('name').lean(),
    sp.avatar ? M.Media.findById(sp.avatar).lean() : null,
    sp.cover ? M.Media.findById(sp.cover).lean() : null,
  ]);
  res.page(V.profile, { sp, completeness, categories, avatar, cover });
}));

router.get('/perfil/editar', asyncHandler(async (req, res) => {
  const categories = await M.Category.find({ status: 'active' }).sort({ order: 1, name: 1 }).lean();
  const sp = await M.Specialist.findById(req.specialist._id).select('+location.address +contactPhone').lean();
  res.page(V.profileEdit, { sp, values: sp, categories, departments: DEPARTMENTS });
}));

router.post('/perfil/editar', asyncHandler(async (req, res) => {
  const sp = await M.Specialist.findById(req.specialist._id).select('+location.address +contactPhone');
  const categories = await M.Category.find({ status: 'active' }).sort({ order: 1, name: 1 }).lean();
  const { data, errors, ok } = validate(req.body, {
    displayName: { type: 'string', required: true, min: 2, max: 120, label: 'Nombre profesional' },
    headline: { type: 'string', max: 160 },
    bio: { type: 'text', max: 4000 },
    experience: { type: 'text', max: 3000 },
    yearsOfExperience: { type: 'int', min: 0, max: 80 },
    education: { type: 'text', max: 3000 },
    languages: { type: 'string', max: 120 },
    categories: { type: 'array', of: 'objectId', required: true, max: 6, label: 'Categorías' },
    modalities: { type: 'array', values: ['presencial', 'domicilio', 'online'], required: true, label: 'Modalidades' },
    department: { type: 'enum', values: ['', ...DEPARTMENTS] },
    city: { type: 'string', max: 80 },
    neighborhood: { type: 'string', max: 80 },
    address: { type: 'string', max: 200 },
    addressPublicHint: { type: 'string', max: 160 },
    lat: { type: 'number', min: -35.2, max: -30 },
    lng: { type: 'number', min: -58.6, max: -53 },
    serviceRadiusKm: { type: 'int', min: 0, max: 200 },
    contactPhone: { type: 'phone', label: 'Teléfono' },
  });
  if (!ok) return res.page(V.profileEdit, { sp: sp.toObject(), values: { ...sp.toObject(), ...req.body }, errors, categories, departments: DEPARTMENTS }, 400);
  const location = {
    department: data.department, city: data.city, neighborhood: data.neighborhood, address: data.address,
    addressPublicHint: data.addressPublicHint, serviceRadiusKm: data.serviceRadiusKm,
    geo: Number.isFinite(data.lat) && Number.isFinite(data.lng) ? { type: 'Point', coordinates: [data.lng, data.lat] } : undefined,
  };
  const before = { displayName: sp.displayName, categories: sp.categories.map(String) };
  const { pending } = await specialists.applyProfileChanges(sp, {
    displayName: data.displayName, categories: data.categories,
    headline: data.headline, bio: data.bio, experience: data.experience, yearsOfExperience: data.yearsOfExperience, education: data.education,
    languages: data.languages ? data.languages.split(',').map((x) => x.trim()).filter(Boolean) : [],
    modalities: data.modalities, location, contactPhone: data.contactPhone,
  }, { actorRole: 'specialist' });
  await audit(req, { action: 'specialist.profile_update', entity: 'Specialist', entityId: sp._id, before, after: { displayName: data.displayName, categories: data.categories, pending } });
  if (pending.length) {
    await notifyAdmins({ title: 'Cambios sensibles para revisar', body: `${sp.displayName} pidió cambiar: ${pending.join(', ')}.`, link: `/admin/especialistas/${sp._id}`, dedupeKey: `changes:${sp._id}:${Date.now()}` });
    req.flash('info', 'Guardamos tus cambios. El nombre y las categorías se publican después de una revisión rápida.');
  } else req.flash('success', 'Guardamos tu perfil.');
  return res.redirect('/panel/perfil');
}));

router.get('/perfil/apariencia', asyncHandler(async (req, res) => {
  const services = await M.Service.find({ specialist: req.specialist._id, status: 'active' }).select('title').lean();
  res.page(V.appearance, { sp: req.specialist, services });
}));

router.post('/perfil/apariencia', asyncHandler(async (req, res) => {
  const ALLOWED = ['servicios', 'sobre', 'galeria', 'video', 'resenas', 'ubicacion'];
  const order = [].concat(req.body.order || []).filter((x) => ALLOWED.includes(x));
  const unique = [...new Set(order)];
  for (const k of ALLOWED) if (!unique.includes(k)) unique.push(k);
  const featured = isObjectId(req.body.featuredService) && await M.Service.exists({ _id: req.body.featuredService, specialist: req.specialist._id }) ? req.body.featuredService : null;
  req.specialist.profileLayout = {
    variant: ['clasica', 'serena', 'luminosa'].includes(req.body.variant) ? req.body.variant : 'clasica',
    sectionOrder: unique,
    featuredService: featured,
    showVideoFirst: !!req.body.showVideoFirst,
  };
  await req.specialist.save();
  req.flash('success', 'Guardamos la apariencia de tu ficha.');
  res.redirect('/panel/perfil/apariencia');
}));

// ── Multimedia ────────────────────────────────────────────
router.get('/perfil/multimedia', asyncHandler(async (req, res) => {
  const sp = req.specialist;
  const settings = await getSettings();
  const media = await M.Media.find({ specialist: sp._id, kind: { $ne: 'document' } }).sort({ kind: 1, order: 1 }).lean();
  res.page(V.media, { sp, media, limits: settings.media });
}));

router.get('/perfil/multimedia/subir', asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const tipo = ['foto', 'video', 'perfil', 'portada'].includes(req.query.tipo) ? req.query.tipo : 'foto';
  res.page(V.mediaUpload, { tipo, limits: settings.media });
}));

router.post('/perfil/multimedia', limits.uploads, upload.single('file'), asyncHandler(async (req, res) => {
  const sp = req.specialist;
  const kindMap = { foto: 'photo', espacio: 'space', video: 'video', perfil: 'avatar', portada: 'cover' };
  const kind = kindMap[req.body.tipo] || 'photo';
  const media = await uploadMedia({ file: req.file, kind, specialist: sp._id, owner: req.user._id, caption: req.body.caption });
  const set = {};
  if (kind === 'avatar') set.avatar = media._id;
  if (kind === 'cover') set.cover = media._id;
  if (kind === 'video') set.video = media._id;
  if (Object.keys(set).length) {
    const old = await M.Media.find({ specialist: sp._id, kind, _id: { $ne: media._id } });
    await M.Specialist.updateOne({ _id: sp._id }, { $set: set });
    for (const o of old) await removeMedia(o);
  }
  req.flash('success', media.status === 'pending' ? 'Subimos el archivo. Se publica después de una revisión.' : 'Subimos el archivo.');
  res.redirect('/panel/perfil/multimedia');
}));

router.post('/perfil/multimedia/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const media = await M.Media.findById(req.params.id);
  if (!own(media, req.specialist)) throw notFound();
  if (req.body.action === 'eliminar') {
    await removeMedia(media);
    req.flash('success', 'Eliminamos el archivo.');
  } else if (req.body.action === 'subir' || req.body.action === 'bajar') {
    const siblings = await M.Media.find({ specialist: req.specialist._id, kind: media.kind }).sort({ order: 1 });
    const i = siblings.findIndex((m) => String(m._id) === String(media._id));
    const j = req.body.action === 'subir' ? i - 1 : i + 1;
    if (j >= 0 && j < siblings.length) {
      const a = siblings[i].order; siblings[i].order = siblings[j].order; siblings[j].order = a;
      if (siblings[i].order === siblings[j].order) siblings[i].order += req.body.action === 'subir' ? -1 : 1;
      await siblings[i].save(); await siblings[j].save();
    }
  } else {
    media.caption = String(req.body.caption || '').slice(0, 200);
    const gallery = ['photo', 'space', 'service'];
    if (gallery.includes(media.kind) && gallery.includes(req.body.kind)) media.kind = req.body.kind;
    await media.save();
    req.flash('success', 'Guardamos los cambios.');
  }
  res.redirect('/panel/perfil/multimedia');
}));

// ── Servicios ─────────────────────────────────────────────
async function serviceFormData(sp) {
  const categories = await M.Category.find({ status: 'active' }).sort({ order: 1, name: 1 }).lean();
  return { categories, spModalities: sp.modalities };
}

const serviceRules = {
  title: { type: 'string', required: true, min: 3, max: 120, label: 'Nombre del servicio' },
  category: { type: 'objectId', required: true, label: 'Categoría' },
  summary: { type: 'string', max: 240 },
  description: { type: 'text', max: 5000 },
  includes: { type: 'text', max: 1000 },
  preparation: { type: 'text', max: 1500 },
  price: { type: 'int', required: true, min: 100, max: 200000, label: 'Precio' },
  durationMinutes: { type: 'int', required: true, min: 10, max: 600, label: 'Duración' },
  modalities: { type: 'array', values: ['presencial', 'domicilio', 'online'], required: true, label: 'Modalidades' },
  homeServiceExtra: { type: 'int', min: 0, max: 50000 },
  maxAdvanceDays: { type: 'int', min: 1, max: 365 },
};

function serviceDoc(data) {
  return {
    title: data.title, category: data.category, summary: data.summary, description: data.description,
    includes: (data.includes || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 12),
    preparation: data.preparation, price: data.price, durationMinutes: data.durationMinutes, modalities: data.modalities,
    homeServiceExtra: data.modalities.includes('domicilio') ? data.homeServiceExtra || 0 : 0, maxAdvanceDays: data.maxAdvanceDays,
  };
}

router.get('/servicios', asyncHandler(async (req, res) => {
  const list = await M.Service.find({ specialist: req.specialist._id }).sort({ order: 1, createdAt: 1 }).populate('category', 'name').lean();
  res.page(V.services, { list, sp: req.specialist });
}));

router.get('/servicios/nuevo', asyncHandler(async (req, res) => {
  res.page(V.serviceForm, { ...(await serviceFormData(req.specialist)), values: { durationMinutes: 60, modalities: req.specialist.modalities }, settings: await getSettings() });
}));

router.post('/servicios', asyncHandler(async (req, res) => {
  const sp = req.specialist;
  const { data, errors, ok } = validate(req.body, serviceRules);
  if (!ok) return res.page(V.serviceForm, { ...(await serviceFormData(sp)), values: req.body, errors, settings: await getSettings() }, 400);
  if (!(await M.Category.exists({ _id: data.category, status: 'active' }))) throw badRequest('Elegí una categoría válida.');
  const settings = await getSettings();
  const count = await M.Service.countDocuments({ specialist: sp._id });
  const service = await M.Service.create({
    ...serviceDoc(data), specialist: sp._id, slug: await uniqueSlug(M.Service, data.title, { specialist: sp._id }),
    status: settings.moderation.newServicesRequireReview && sp.status === 'active' ? 'pending_review' : 'active', order: count,
  });
  await specialists.syncSearchForSpecialist(sp._id);
  await audit(req, { action: 'service.create', entity: 'Service', entityId: service._id, after: { title: service.title, price: service.price } });
  req.flash('success', service.status === 'pending_review' ? 'Creamos el servicio. Se publica después de una revisión.' : 'Creamos el servicio.');
  return res.redirect(`/panel/servicios/${service._id}`);
}));

async function ownService(req) {
  if (!isObjectId(req.params.id)) throw notFound();
  const s = await M.Service.findById(req.params.id);
  if (!own(s, req.specialist)) throw notFound();
  return s;
}

router.get('/servicios/:id', asyncHandler(async (req, res) => {
  const service = await ownService(req);
  const settings = await getSettings();
  const commission = await commissionFor({ specialist: req.specialist, categoryId: service.category });
  const breakdown = priceBreakdown({ price: service.price, rate: commission.rate, mode: settings.commission.feeMode, processorRate: settings.payments.processorFeePercent, processorPaidBy: settings.payments.processorFeePaidBy });
  const [photos, reviewsList, stats, category] = await Promise.all([
    M.Media.find({ _id: { $in: service.photos } }).lean(),
    M.Review.find({ service: service._id }).sort({ createdAt: -1 }).limit(5).lean(),
    specialistDashboard(req.specialist._id, '90d'),
    M.Category.findById(service.category).select('name').lean(),
  ]);
  const perf = stats.servicePerformance.find((p) => String(p._id) === String(service._id));
  res.page(V.serviceDetail, { service: service.toObject(), photos, reviews: reviewsList, perf, breakdown, commission, category, sp: req.specialist });
}));

router.get('/servicios/:id/editar', asyncHandler(async (req, res) => {
  const service = await ownService(req);
  const values = service.toObject();
  values.includes = (values.includes || []).join('\n');
  res.page(V.serviceForm, { ...(await serviceFormData(req.specialist)), values, editing: service._id, settings: await getSettings() });
}));

router.post('/servicios/:id', asyncHandler(async (req, res) => {
  const service = await ownService(req);
  const { data, errors, ok } = validate(req.body, serviceRules);
  if (!ok) return res.page(V.serviceForm, { ...(await serviceFormData(req.specialist)), values: { ...req.body, _id: service._id }, errors, editing: service._id, settings: await getSettings() }, 400);
  const before = { title: service.title, price: service.price, durationMinutes: service.durationMinutes, category: String(service.category) };
  const doc = serviceDoc(data);
  // Cambiar de categoría es un cambio sensible en servicios publicados
  const settings = await getSettings();
  if (String(service.category) !== String(doc.category) && req.specialist.status === 'active' && settings.moderation.sensitiveChangesRequireReview) {
    service.statusReason = 'Cambio de categoría pendiente de revisión';
    service.status = 'pending_review';
  }
  if (service.title !== doc.title) service.slug = await uniqueSlug(M.Service, doc.title, { specialist: req.specialist._id }, service._id);
  Object.assign(service, doc);
  await service.save();
  await specialists.syncSearchForSpecialist(req.specialist._id);
  // Los cambios de precio y duración se publican al instante; las reservas existentes conservan su precio.
  await audit(req, { action: 'service.update', entity: 'Service', entityId: service._id, before, after: { title: doc.title, price: doc.price, durationMinutes: doc.durationMinutes, category: String(doc.category) } });
  req.flash('success', service.status === 'pending_review' ? 'Guardamos los cambios. El cambio de categoría se revisa antes de publicarse.' : 'Guardamos los cambios. Las reservas ya hechas mantienen su precio original.');
  return res.redirect(`/panel/servicios/${service._id}`);
}));

router.post('/servicios/:id/estado', asyncHandler(async (req, res) => {
  const service = await ownService(req);
  if (service.status === 'suspended') throw forbidden('Este servicio fue suspendido por administración. Escribinos desde Ayuda.');
  if (service.status === 'pending_review') throw badRequest('El servicio está en revisión.');
  service.status = service.status === 'active' ? 'paused' : 'active';
  await service.save();
  await specialists.syncSearchForSpecialist(req.specialist._id);
  req.flash('success', service.status === 'active' ? 'El servicio vuelve a estar publicado.' : 'Pausaste el servicio: no recibe reservas nuevas.');
  res.redirect(`/panel/servicios/${service._id}`);
}));

router.post('/servicios/:id/eliminar', asyncHandler(async (req, res) => {
  const service = await ownService(req);
  const used = await M.Booking.exists({ service: service._id });
  if (used) {
    // Con historial no se borra (reseñas y reservas lo referencian): se pausa
    service.status = service.status === 'suspended' ? 'suspended' : 'paused';
    await service.save();
    req.flash('info', 'Este servicio tiene reservas en su historial, así que lo pausamos en lugar de borrarlo.');
  } else {
    await M.Service.deleteOne({ _id: service._id });
    req.flash('success', 'Eliminamos el servicio.');
  }
  await specialists.syncSearchForSpecialist(req.specialist._id);
  res.redirect('/panel/servicios');
}));

router.post('/servicios/:id/fotos', limits.uploads, upload.single('file'), asyncHandler(async (req, res) => {
  const service = await ownService(req);
  if (req.body.remove && isObjectId(req.body.remove)) {
    service.photos = service.photos.filter((p) => String(p) !== String(req.body.remove));
    await service.save();
    const m = await M.Media.findById(req.body.remove);
    if (own(m, req.specialist)) await removeMedia(m);
  } else {
    if (service.photos.length >= 6) throw badRequest('Cada servicio puede tener hasta 6 fotos.');
    const media = await uploadMedia({ file: req.file, kind: 'service', specialist: req.specialist._id, owner: req.user._id, service: service._id, caption: req.body.caption });
    service.photos.push(media._id);
    await service.save();
  }
  res.redirect(`/panel/servicios/${service._id}`);
}));

// ── Agenda ────────────────────────────────────────────────
router.get('/agenda', asyncHandler(async (req, res) => {
  const sp = req.specialist;
  const vista = ['dia', 'semana', 'mes'].includes(req.query.vista) ? req.query.vista : 'semana';
  const date = D.isValidDateStr(req.query.fecha) ? req.query.fecha : D.todayStr();
  let from;
  let to;
  if (vista === 'dia') { from = date; to = D.addDays(date, 1); } else if (vista === 'semana') { from = D.startOfWeek(date); to = D.addDays(from, 7); } else {
    const grid = D.monthGrid(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
    from = grid[0][0]; to = D.addDays(grid.at(-1)[6], 1);
  }
  const av = await getAvailabilityFor(sp._id);
  const list = await M.Booking.find({
    specialist: sp._id, start: { $gte: D.zonedToUtc(from, '00:00'), $lt: D.zonedToUtc(to, '00:00') },
    status: { $in: ['pending', 'paid', 'confirmed', 'completed', 'no_show_user'] },
  }).sort({ start: 1 }).lean();
  res.page(V.agenda, { vista, date, from, to, list: list.filter((b) => b.status !== 'pending' || (b.paymentDeadline && b.paymentDeadline > new Date())), av });
}));

router.get('/agenda/horarios', asyncHandler(async (req, res) => {
  const av = await getAvailabilityFor(req.specialist._id);
  res.page(V.schedule, { av });
}));

router.post('/agenda/horarios', asyncHandler(async (req, res) => {
  const weekly = [];
  const raw = req.body.weekly || {};
  for (let day = 0; day < 7; day++) {
    const ranges = Object.values(raw[day] || {}).map((r) => ({ start: r.start, end: r.end }));
    const norm = normalizeRanges(ranges);
    // Solapamientos dentro del mismo día no tienen sentido
    for (let i = 1; i < norm.length; i++) if (norm[i].start < norm[i - 1].end) throw badRequest(`Hay franjas superpuestas el ${D.WEEKDAYS[day]}.`);
    const valid = ranges.filter((r) => D.isValidTimeStr(r.start) && D.isValidTimeStr(r.end) && r.end > r.start).sort((a, b) => a.start.localeCompare(b.start));
    if (valid.length) weekly.push({ day, ranges: valid });
  }
  const { data, ok, errors } = validate(req.body, {
    slotStepMinutes: { type: 'int', min: 5, max: 120, default: 15 },
    bufferMinutes: { type: 'int', min: 0, max: 120, default: 0 },
    minNoticeHours: { type: 'number', min: 0, max: 168, default: 2 },
    maxAdvanceDays: { type: 'int', min: 1, max: 365, default: 60 },
    dailyLimit: { type: 'int', min: 0, max: 50, default: 0 },
  });
  if (!ok) throw badRequest(Object.values(errors)[0]);
  await M.Availability.updateOne({ specialist: req.specialist._id }, {
    $set: {
      weekly, slotStepMinutes: data.slotStepMinutes, bufferMinutes: data.bufferMinutes,
      minNoticeMinutes: Math.round(data.minNoticeHours * 60), maxAdvanceDays: data.maxAdvanceDays, dailyLimit: data.dailyLimit,
    },
  }, { upsert: true });
  req.flash('success', 'Guardamos tus horarios. Las reservas ya confirmadas no cambian.');
  res.redirect('/panel/agenda/horarios');
}));

router.get('/agenda/bloqueos', asyncHandler(async (req, res) => {
  const av = await getAvailabilityFor(req.specialist._id);
  res.page(V.blocks, { av, today: D.todayStr() });
}));

router.post('/agenda/bloqueos', asyncHandler(async (req, res) => {
  const sp = req.specialist;
  const type = req.body.type;
  const update = {};
  if (type === 'dia') {
    const { data, ok } = validate(req.body, { date: { type: 'date', required: true }, note: { type: 'string', max: 120 } });
    if (!ok) throw badRequest('Elegí la fecha.');
    await M.Availability.updateOne({ specialist: sp._id }, { $pull: { exceptions: { date: data.date } } });
    update.$push = { exceptions: { date: data.date, type: 'closed', note: data.note } };
  } else if (type === 'especial') {
    const { data, ok } = validate(req.body, { date: { type: 'date', required: true }, start: { type: 'time', required: true }, end: { type: 'time', required: true }, note: { type: 'string', max: 120 } });
    if (!ok || data.end <= data.start) throw badRequest('Revisá la fecha y el horario.');
    await M.Availability.updateOne({ specialist: sp._id }, { $pull: { exceptions: { date: data.date } } });
    update.$push = { exceptions: { date: data.date, type: 'custom', ranges: [{ start: data.start, end: data.end }], note: data.note } };
  } else if (type === 'vacaciones') {
    const { data, ok } = validate(req.body, { from: { type: 'date', required: true }, to: { type: 'date', required: true }, reason: { type: 'string', max: 120 } });
    if (!ok || data.to < data.from) throw badRequest('Revisá las fechas de inicio y fin.');
    update.$push = { timeOff: { from: data.from, to: data.to, reason: data.reason } };
  } else if (type === 'horario') {
    const { data, ok } = validate(req.body, { date: { type: 'date', required: true }, start: { type: 'time', required: true }, end: { type: 'time', required: true }, reason: { type: 'string', max: 120 } });
    if (!ok || data.end <= data.start) throw badRequest('Revisá la fecha y el horario.');
    update.$push = { blocks: { start: D.zonedToUtc(data.date, data.start), end: D.zonedToUtc(data.date, data.end), reason: data.reason } };
  } else if (type === 'descanso') {
    const { data, ok } = validate(req.body, { day: { type: 'int', min: 0, max: 6, required: true }, start: { type: 'time', required: true }, end: { type: 'time', required: true } });
    if (!ok || data.end <= data.start) throw badRequest('Revisá el día y el horario del descanso.');
    update.$push = { breaks: { day: data.day, start: data.start, end: data.end } };
  } else throw badRequest('Tipo de bloqueo no válido.');
  await M.Availability.updateOne({ specialist: sp._id }, update, { upsert: true });
  // Aviso si ya hay reservas en ese período (no se cancelan automáticamente)
  const conflicts = await M.Booking.countDocuments({
    specialist: sp._id, status: { $in: ['paid', 'confirmed'] },
    start: { $gte: D.zonedToUtc(req.body.date || req.body.from || D.todayStr(), '00:00'), $lt: D.zonedToUtc(D.addDays(req.body.date || req.body.to || D.todayStr(), 1), '00:00') },
  });
  req.flash(conflicts ? 'warn' : 'success', conflicts ? `Guardamos el bloqueo. Ojo: ya tenés ${conflicts} reserva(s) en ese período; si no podés atenderlas, reprogramalas o cancelalas desde Reservas.` : 'Guardamos el bloqueo.');
  res.redirect('/panel/agenda/bloqueos');
}));

router.post('/agenda/bloqueos/eliminar', asyncHandler(async (req, res) => {
  const { list, id } = req.body;
  const field = { exceptions: 'exceptions', timeOff: 'timeOff', blocks: 'blocks' }[list];
  if (field && isObjectId(id)) await M.Availability.updateOne({ specialist: req.specialist._id }, { $pull: { [field]: { _id: id } } });
  if (list === 'breaks') {
    const av = await getAvailabilityFor(req.specialist._id);
    const idx = Number(req.body.index);
    const breaks = (av.breaks || []).filter((_, i) => i !== idx);
    await M.Availability.updateOne({ specialist: req.specialist._id }, { $set: { breaks } });
  }
  req.flash('success', 'Quitamos el bloqueo.');
  res.redirect('/panel/agenda/bloqueos');
}));

router.get('/agenda/disponibilidad', asyncHandler(async (req, res) => {
  const services = await M.Service.find({ specialist: req.specialist._id, status: { $in: ['active', 'paused'] } }).select('title durationMinutes maxAdvanceDays').lean();
  const service = services.find((s) => String(s._id) === req.query.servicio) || services[0];
  const summary = service ? await summaryForRange({ specialistId: req.specialist._id, service, fromDateStr: D.todayStr(), days: 21 }) : [];
  res.page(V.availabilityPreview, { services, service, summary });
}));

// ── Reservas ──────────────────────────────────────────────
router.get('/reservas', asyncHandler(async (req, res) => {
  const sp = req.specialist;
  const tab = ['proximas', 'confirmar', 'historial', 'canceladas'].includes(req.query.tab) ? req.query.tab : 'proximas';
  const now = new Date();
  const filters = {
    proximas: { status: { $in: ['paid', 'confirmed'] }, start: { $gt: now } },
    confirmar: { status: 'paid' },
    historial: { $or: [{ status: { $in: ['completed', 'no_show_user', 'no_show_specialist'] } }, { status: { $in: ['paid', 'confirmed'] }, start: { $lte: now } }] },
    canceladas: { status: { $in: CANCELLED_STATUSES.filter((s) => s !== 'expired') } },
  };
  const q = String(req.query.q || '').trim();
  const extra = q ? { $or: [{ 'snapshot.userName': new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { code: q.toUpperCase() }] } : {};
  const list = await M.Booking.find({ specialist: sp._id, ...filters[tab], ...extra }).sort({ start: tab === 'proximas' || tab === 'confirmar' ? 1 : -1 }).limit(200).lean();
  const counts = await Promise.all(Object.values(filters).map((f) => M.Booking.countDocuments({ specialist: sp._id, ...f })));
  res.page(V.bookings, { tab, list, counts, q });
}));

async function ownBooking(req, id = req.params.id) {
  if (!isObjectId(id)) throw notFound();
  const b = await M.Booking.findById(id).select('+specialistNotes');
  if (!own(b, req.specialist)) throw notFound();
  return b;
}

router.get('/reservas/:id', asyncHandler(async (req, res) => {
  const booking = await ownBooking(req);
  const [client, previous, payment, conversation, review] = await Promise.all([
    M.User.findById(booking.user).select('name phone email privacy').lean(),
    M.Booking.countDocuments({ user: booking.user, specialist: req.specialist._id, status: 'completed' }),
    booking.payment ? M.Payment.findById(booking.payment).lean() : null,
    M.Conversation.findOne({ user: booking.user, specialist: req.specialist._id }).select('_id').lean(),
    M.Review.findOne({ booking: booking._id }).lean(),
  ]);
  const showPhone = ['paid', 'confirmed', 'completed'].includes(booking.status) && client?.privacy?.shareContactAfterBooking !== false;
  res.page(V.bookingDetail, { booking: booking.toObject(), client, previous, payment, conversation, review, showPhone });
}));

router.post('/reservas/:id/confirmar', asyncHandler(async (req, res) => {
  const booking = await ownBooking(req);
  await bookings.confirmBySpecialist(booking, req.user);
  req.flash('success', 'Confirmaste la reserva. Le avisamos al cliente.');
  res.redirect(`/panel/reservas/${booking._id}`);
}));

router.post('/reservas/:id/cancelar', asyncHandler(async (req, res) => {
  const booking = await ownBooking(req);
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 5) throw badRequest('Contale al cliente el motivo de la cancelación.');
  await bookings.cancelBooking({ booking, actor: req.user, actorRole: 'specialist', reason });
  await audit(req, { action: 'booking.cancel_specialist', entity: 'Booking', entityId: booking._id, summary: reason });
  req.flash('success', 'Cancelaste la reserva. El cliente recibe el reembolso completo y un aviso.');
  res.redirect(`/panel/reservas/${booking._id}`);
}));

router.get('/reservas/:id/reprogramar', asyncHandler(async (req, res) => {
  const booking = await ownBooking(req);
  if (!['paid', 'confirmed'].includes(booking.status)) throw badRequest('Esta reserva no se puede reprogramar.');
  res.page(A.reschedule, { booking: booking.toObject(), action: `/panel/reservas/${booking._id}/reprogramar`, today: D.todayStr(), back: `/panel/reservas/${booking._id}`, area: 'specialist' });
}));

router.post('/reservas/:id/reprogramar', asyncHandler(async (req, res) => {
  const booking = await ownBooking(req);
  const { data, ok } = validate(req.body, { fecha: { type: 'date', required: true }, hora: { type: 'time', required: true } });
  if (!ok) throw badRequest('Elegí el nuevo horario.');
  const next = await bookings.rescheduleBooking({ booking, actor: req.user, actorRole: 'specialist', dateStr: data.fecha, time: data.hora });
  req.flash('success', `Reprogramada para el ${D.fmtDateTime(next.start)}. Le avisamos al cliente.`);
  res.redirect(`/panel/reservas/${next._id}`);
}));

router.post('/reservas/:id/realizada', asyncHandler(async (req, res) => {
  const booking = await ownBooking(req);
  await bookings.markCompleted(booking, { actor: req.user, actorRole: 'specialist' });
  req.flash('success', 'Marcaste la sesión como realizada.');
  res.redirect(`/panel/reservas/${booking._id}`);
}));

router.post('/reservas/:id/ausencia', asyncHandler(async (req, res) => {
  const booking = await ownBooking(req);
  await bookings.cancelBooking({ booking, actor: req.user, actorRole: 'specialist', kind: 'no_show_user', reason: 'El cliente no se presentó' });
  await audit(req, { action: 'booking.no_show_user', entity: 'Booking', entityId: booking._id });
  req.flash('success', 'Registramos la ausencia del cliente según la política de cancelación.');
  res.redirect(`/panel/reservas/${booking._id}`);
}));

router.post('/reservas/:id/notas', asyncHandler(async (req, res) => {
  const booking = await ownBooking(req);
  booking.specialistNotes = String(req.body.notes || '').slice(0, 2000);
  if (booking.modality === 'online' && req.body.onlineUrl !== undefined) {
    const url = String(req.body.onlineUrl || '').trim();
    if (url && !/^https:\/\//.test(url)) throw badRequest('El enlace de la sesión online debe empezar con https://');
    booking.place = { ...(booking.place?.toObject?.() || booking.place || {}), onlineUrl: url || undefined };
  }
  await booking.save();
  req.flash('success', 'Guardamos los cambios.');
  res.redirect(`/panel/reservas/${booking._id}`);
}));

// ── Clientes ──────────────────────────────────────────────
router.get('/clientes', asyncHandler(async (req, res) => {
  const now = new Date();
  const rows = await M.Booking.aggregate([
    { $match: { specialist: req.specialist._id, status: { $in: ['paid', 'confirmed', 'completed', 'no_show_user'] } } },
    { $sort: { start: 1 } },
    {
      $group: {
        _id: '$user', name: { $last: '$snapshot.userName' }, total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        last: { $max: { $cond: [{ $lte: ['$start', now] }, '$start', null] } },
        next: { $min: { $cond: [{ $gt: ['$start', now] }, '$start', null] } },
        first: { $min: '$start' },
        services: { $addToSet: '$snapshot.serviceTitle' },
        spent: { $sum: '$snapshot.specialistNet' },
      },
    },
    { $sort: { last: -1 } },
    { $limit: 500 },
  ]);
  const q = String(req.query.q || '').toLowerCase();
  res.page(V.clients, { rows: q ? rows.filter((r) => (r.name || '').toLowerCase().includes(q)) : rows, q });
}));

router.get('/clientes/:userId', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.userId)) throw notFound();
  const list = await M.Booking.find({ specialist: req.specialist._id, user: req.params.userId }).select('+specialistNotes').sort({ start: -1 }).lean();
  if (!list.length) throw notFound('No tenés reservas con esta persona.');
  const [client, reviewsList, conversation] = await Promise.all([
    M.User.findById(req.params.userId).select('name phone privacy createdAt').lean(),
    M.Review.find({ specialist: req.specialist._id, user: req.params.userId }).populate('service', 'title').lean(),
    M.Conversation.findOne({ user: req.params.userId, specialist: req.specialist._id }).select('_id').lean(),
  ]);
  const hasActive = list.some((b) => ['paid', 'confirmed', 'completed'].includes(b.status));
  res.page(V.clientDetail, { client, list, reviews: reviewsList, conversation, showPhone: hasActive && client?.privacy?.shareContactAfterBooking !== false });
}));

// Iniciar conversación con un cliente (solo si tiene reservas con este especialista)
router.get('/clientes/:userId/mensaje', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.userId)) throw notFound();
  if (!(await M.Booking.exists({ specialist: req.specialist._id, user: req.params.userId }))) throw notFound();
  const conv = await messaging.getOrCreateConversation(req.params.userId, { _id: req.specialist._id, user: req.user._id });
  res.redirect(`/panel/mensajes/${conv._id}`);
}));

// ── Mensajes ──────────────────────────────────────────────
router.get('/mensajes', asyncHandler(async (req, res) => {
  const list = await M.Conversation.find({ specialist: req.specialist._id }).sort({ lastMessageAt: -1 }).limit(200).populate('user', 'name avatarUrl').lean();
  res.page(V.inbox, { list });
}));

router.get('/mensajes/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const conv = await M.Conversation.findById(req.params.id);
  if (!own(conv, req.specialist)) throw notFound();
  if (!conv.specialistUser || String(conv.specialistUser) !== String(req.user._id)) { conv.specialistUser = req.user._id; await conv.save(); }
  const [messages, client, allowed, booking] = await Promise.all([
    M.Message.find({ conversation: conv._id }).sort({ createdAt: -1 }).limit(80).lean(),
    M.User.findById(conv.user).select('name').lean(),
    messaging.contactAllowed(conv),
    M.Booking.findOne({ user: conv.user, specialist: req.specialist._id, status: { $in: ['paid', 'confirmed'] }, start: { $gt: new Date() } }).sort({ start: 1 }).lean(),
  ]);
  await messaging.markRead(conv, 'specialist');
  res.page(A.conversation, { conv, messages: messages.reverse(), allowed, booking, me: req.user._id, base: '/panel', title: client?.name });
}));

router.post('/mensajes/:id', limits.forms, asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const conv = await M.Conversation.findById(req.params.id);
  if (!own(conv, req.specialist)) throw notFound();
  await messaging.sendMessage({ conversation: conv, sender: req.user, body: req.body.body });
  res.redirect(`/panel/mensajes/${conv._id}`);
}));

// ── Estadísticas e ingresos ───────────────────────────────
const period = (q) => (['7d', '30d', '90d', '365d'].includes(q) ? q : '30d');

router.get('/estadisticas', asyncHandler(async (req, res) => {
  const stats = await specialistDashboard(req.specialist._id, period(req.query.periodo));
  res.page(V.stats, { stats, sp: req.specialist });
}));

router.get('/visualizaciones', asyncHandler(async (req, res) => {
  const stats = await specialistDashboard(req.specialist._id, period(req.query.periodo));
  res.page(V.views, { stats });
}));

router.get('/rendimiento', asyncHandler(async (req, res) => {
  const stats = await specialistDashboard(req.specialist._id, period(req.query.periodo));
  res.page(V.performance, { stats });
}));

router.get('/ingresos', asyncHandler(async (req, res) => {
  const p = period(req.query.periodo);
  const { periodRange } = require('../services/stats');
  const r = periodRange(p);
  const [payments, payouts, refunds] = await Promise.all([
    M.Payment.find({ specialist: req.specialist._id, createdAt: { $gte: r.from }, status: { $ne: 'pending' } }).sort({ createdAt: -1 }).limit(300).populate('booking', 'code snapshot start status').lean(),
    M.Payout.find({ specialist: req.specialist._id }).sort({ createdAt: -1 }).limit(24).lean(),
    M.Refund.find({ specialist: req.specialist._id, createdAt: { $gte: r.from } }).lean(),
  ]);
  res.page(V.income, { period: p, payments, payouts, refunds, settings: await getSettings() });
}));

router.get('/facturacion', asyncHandler(async (req, res) => {
  const months = await M.Payment.aggregate([
    { $match: { specialist: req.specialist._id, status: { $in: ['approved', 'partially_refunded', 'refunded', 'offline'] } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: D.DEFAULT_TZ } }, gross: { $sum: '$amount' }, commission: { $sum: '$commissionAmount' }, fees: { $sum: '$providerFee' }, refunded: { $sum: '$refundedAmount' }, n: { $sum: 1 } } },
    { $sort: { _id: -1 } },
    { $limit: 24 },
  ]);
  const payouts = await M.Payout.find({ specialist: req.specialist._id }).sort({ createdAt: -1 }).lean();
  res.page(V.billing, { months, payouts, sp: req.specialist });
}));

// ── Reseñas ───────────────────────────────────────────────
router.get('/resenas', asyncHandler(async (req, res) => {
  const filter = { specialist: req.specialist._id };
  if (isObjectId(req.query.servicio)) filter.service = req.query.servicio;
  if (req.query.sinResponder === '1') filter['reply.text'] = { $exists: false };
  const [list, services] = await Promise.all([
    M.Review.find(filter).sort({ createdAt: -1 }).limit(200).populate('service', 'title').lean(),
    M.Service.find({ specialist: req.specialist._id }).select('title rating').lean(),
  ]);
  const { REPORT_REASONS } = require('../lib/constants');
  res.page(V.reviews, { list, services, query: req.query, reasons: REPORT_REASONS });
}));

router.post('/resenas/:id/responder', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const review = await M.Review.findById(req.params.id);
  if (!own(review, req.specialist)) throw notFound();
  await reviews.replyToReview(review, req.specialist, req.body.text);
  req.flash('success', 'Publicamos tu respuesta.');
  res.redirect(`/panel/resenas#r-${review._id}`);
}));

router.post('/resenas/:id/revision', limits.forms, asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const review = await M.Review.findById(req.params.id);
  if (!own(review, req.specialist)) throw notFound();
  const { REPORT_REASONS } = require('../lib/constants');
  if (!REPORT_REASONS[req.body.reason]) throw badRequest('Elegí un motivo.');
  await reviews.requestRevision(review, req.user, { reason: req.body.reason, details: req.body.details });
  await audit(req, { action: 'review.revision_request', entity: 'Review', entityId: review._id, summary: req.body.reason });
  req.flash('success', 'Enviamos tu pedido de revisión. La reseña sigue visible mientras la analizamos.');
  res.redirect('/panel/resenas');
}));

// ── Notificaciones ────────────────────────────────────────
router.get('/notificaciones', asyncHandler(async (req, res) => {
  const list = await M.Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.page(V.notifications, { list });
  await M.Notification.updateMany({ user: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
}));

// ── Verificación y certificaciones ────────────────────────
router.get('/verificacion', asyncHandler(async (req, res) => {
  const requests = await M.VerificationRequest.find({ specialist: req.specialist._id }).sort({ createdAt: -1 }).lean();
  res.page(V.verification, { sp: req.specialist, requests });
}));

router.post('/verificacion', limits.uploads, upload.array('documents', 3), asyncHandler(async (req, res) => {
  const sp = req.specialist;
  if (sp.verification?.identity?.status === 'verified') throw badRequest('Tu identidad ya está verificada.');
  if (!req.files?.length) throw badRequest('Subí al menos una foto o PDF de tu documento.');
  const docs = [];
  for (const file of req.files) {
    docs.push(await uploadMedia({ file, kind: 'document', specialist: sp._id, owner: req.user._id, caption: 'Documento de identidad' }));
  }
  const last4 = String(req.body.documentNumber || '').replace(/\D/g, '').slice(-4);
  await M.VerificationRequest.create({ specialist: sp._id, user: req.user._id, type: 'identity', documents: docs.map((d) => d._id), documentNumberLast4: last4 || undefined, notes: String(req.body.notes || '').slice(0, 500) });
  sp.verification.identity.status = 'pending';
  await sp.save();
  await notifyAdmins({ title: 'Verificación de identidad pendiente', body: `${sp.displayName} envió su documentación.`, link: '/admin/verificaciones', dedupeKey: `verif:${sp._id}:${Date.now()}` });
  req.flash('success', 'Recibimos tu documentación. La revisamos en menos de 48 h hábiles.');
  res.redirect('/panel/verificacion');
}));

router.get('/certificaciones', asyncHandler(async (req, res) => {
  const [list, categories] = await Promise.all([
    M.Certification.find({ specialist: req.specialist._id }).sort({ year: -1 }).lean(),
    M.Category.find({ _id: { $in: req.specialist.categories } }).select('name').lean(),
  ]);
  res.page(V.certifications, { list, categories });
}));

router.post('/certificaciones', limits.uploads, upload.single('document'), asyncHandler(async (req, res) => {
  const { data, ok, errors } = validate(req.body, {
    title: { type: 'string', required: true, max: 160, label: 'Título' },
    issuer: { type: 'string', max: 160 },
    year: { type: 'int', min: 1950, max: new Date().getFullYear() },
    category: { type: 'objectId' },
  });
  if (!ok) throw badRequest(Object.values(errors)[0]);
  let document;
  if (req.file) document = (await uploadMedia({ file: req.file, kind: 'document', specialist: req.specialist._id, owner: req.user._id, caption: data.title }))._id;
  await M.Certification.create({ ...data, specialist: req.specialist._id, document, status: document ? 'pending' : 'declared' });
  if (document) await notifyAdmins({ title: 'Certificación para verificar', body: `${req.specialist.displayName}: ${data.title}`, link: '/admin/verificaciones', dedupeKey: `cert:${req.specialist._id}:${Date.now()}` });
  req.flash('success', document ? 'Agregamos la certificación. Se muestra como declarada hasta que la verifiquemos.' : 'Agregamos la certificación como declarada. Subí el documento si querés que la verifiquemos.');
  res.redirect('/panel/certificaciones');
}));

router.post('/certificaciones/:id/eliminar', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const cert = await M.Certification.findById(req.params.id);
  if (!own(cert, req.specialist)) throw notFound();
  if (cert.document) {
    const m = await M.Media.findById(cert.document);
    if (m) await removeMedia(m);
  }
  await cert.deleteOne();
  req.flash('success', 'Eliminamos la certificación.');
  res.redirect('/panel/certificaciones');
}));

// ── Cuenta y cobros ───────────────────────────────────────
router.get('/cuenta', asyncHandler(async (req, res) => {
  const sp = await M.Specialist.findById(req.specialist._id).lean();
  res.page(V.account, { sp, settings: await getSettings() });
}));

router.post('/cuenta', asyncHandler(async (req, res) => {
  const sp = req.specialist;
  const { data, ok, errors } = validate(req.body, {
    autoConfirm: { type: 'bool' },
    allowReschedule: { type: 'bool' },
    legalName: { type: 'string', max: 160 },
    taxId: { type: 'string', max: 20 },
    invoiceType: { type: 'enum', values: ['', 'monotributo', 'literal_e', 'empresa', 'otro'], default: '' },
    payoutMethod: { type: 'enum', values: ['', 'bank', 'mercadopago'], default: '' },
    bankName: { type: 'string', max: 80 },
    accountHolder: { type: 'string', max: 120 },
    accountNumber: { type: 'string', max: 40 },
    accountType: { type: 'string', max: 40 },
    payoutEmail: { type: 'email' },
  });
  if (!ok) throw badRequest(Object.values(errors)[0]);
  const before = { business: sp.business?.toObject?.() };
  sp.settings = { autoConfirm: data.autoConfirm, allowReschedule: data.allowReschedule };
  sp.business = {
    legalName: data.legalName, taxId: data.taxId, invoiceType: data.invoiceType, payoutMethod: data.payoutMethod, bankName: data.bankName,
    accountHolder: data.accountHolder, accountNumber: data.accountNumber, accountType: data.accountType, payoutEmail: data.payoutEmail,
  };
  await sp.save();
  await audit(req, { action: 'specialist.business_update', entity: 'Specialist', entityId: sp._id, before, after: { business: data } });
  req.flash('success', 'Guardamos la configuración.');
  res.redirect('/panel/cuenta');
}));

router.get('/cuenta/cobros', asyncHandler(async (req, res) => {
  const sp = await M.Specialist.findById(req.specialist._id).lean();
  res.page(V.payouts, { sp, settings: await getSettings(), provider: config.payments.provider, oauthReady: !!(config.payments.mp.clientId && config.payments.mp.clientSecret) });
}));

router.get('/cuenta/cobros/mercadopago/conectar', asyncHandler(async (req, res) => {
  if (!config.payments.mp.clientId) throw badRequest('La vinculación con Mercado Pago todavía no está configurada. Avisale a soporte.');
  const state = crypto.randomBytes(16).toString('hex');
  req.session.mpState = state;
  res.redirect(mp.oauthUrl(state));
}));

router.get('/cuenta/cobros/mercadopago/callback', asyncHandler(async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== req.session.mpState) throw badRequest('No pudimos validar la vinculación. Intentá de nuevo.');
  delete req.session.mpState;
  const tokens = await mp.exchangeCode(String(code));
  await M.Specialist.updateOne({ _id: req.specialist._id }, { $set: mp.tokensToFields(tokens) });
  await audit(req, { action: 'specialist.mp_connect', entity: 'Specialist', entityId: req.specialist._id, after: { mpUserId: String(tokens.user_id) }, severity: 'security' });
  req.flash('success', 'Vinculaste tu cuenta de Mercado Pago. Ya podés recibir reservas pagas.');
  res.redirect('/panel/cuenta/cobros');
}));

// Solo en desarrollo/staging con la pasarela simulada
router.post('/cuenta/cobros/simular', asyncHandler(async (req, res) => {
  if (config.isLive || config.payments.provider !== 'simulated') throw forbidden();
  await M.Specialist.updateOne({ _id: req.specialist._id }, { $set: { 'mercadopago.userId': 'SIMULADO', 'mercadopago.connectedAt': new Date() } });
  req.flash('success', 'Cuenta de cobro simulada vinculada.');
  res.redirect('/panel/cuenta/cobros');
}));

router.post('/cuenta/cobros/desconectar', asyncHandler(async (req, res) => {
  const pending = await M.Booking.countDocuments({ specialist: req.specialist._id, status: { $in: ['paid', 'confirmed'] }, start: { $gt: new Date() } });
  if (pending) throw badRequest(`Tenés ${pending} reserva(s) próximas pagadas. Desvinculá la cuenta cuando no haya reservas pendientes, para poder gestionar reembolsos.`);
  await M.Specialist.updateOne({ _id: req.specialist._id }, { $unset: { mercadopago: 1 } });
  await audit(req, { action: 'specialist.mp_disconnect', entity: 'Specialist', entityId: req.specialist._id, severity: 'security' });
  req.flash('success', 'Desvinculaste tu cuenta de cobro. Tu ficha no recibe reservas pagas hasta que vincules otra.');
  res.redirect('/panel/cuenta/cobros');
}));

// ── Ayuda ─────────────────────────────────────────────────
router.get('/ayuda', asyncHandler(async (req, res) => {
  const tickets = await M.Ticket.find({ user: req.user._id }).sort({ updatedAt: -1 }).limit(50).lean();
  const recent = await M.Booking.find({ specialist: req.specialist._id }).sort({ start: -1 }).limit(10).select('code snapshot.serviceTitle start').lean();
  res.page(A.help, { tickets, recent, area: 'specialist', base: '/panel/ayuda' });
}));

router.post('/ayuda', limits.forms, asyncHandler(async (req, res) => {
  const { data, ok, errors } = validate(req.body, {
    topic: { type: 'enum', values: ['booking', 'payment', 'refund', 'account', 'specialist', 'technical', 'other'], required: true },
    booking: { type: 'objectId' },
    subject: { type: 'string', required: true, max: 200, label: 'Asunto' },
    body: { type: 'text', required: true, min: 10, max: 5000, label: 'Mensaje' },
  });
  if (!ok) throw badRequest(Object.values(errors)[0]);
  if (data.booking && !(await M.Booking.exists({ _id: data.booking, specialist: req.specialist._id }))) data.booking = undefined;
  const number = await M.Counter.next('ticket');
  const t = await M.Ticket.create({ number, user: req.user._id, email: req.user.email, name: req.user.name, topic: data.topic, booking: data.booking, subject: data.subject, messages: [{ author: req.user._id, authorRole: 'specialist', body: data.body }] });
  req.flash('success', `Creamos tu consulta #${number}.`);
  res.redirect(`/panel/ayuda/${t._id}`);
}));

router.get('/ayuda/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const ticket = await M.Ticket.findOne({ _id: req.params.id, user: req.user._id }).lean();
  if (!ticket) throw notFound();
  res.page(A.ticket, { ticket, base: '/panel/ayuda', area: 'specialist' });
}));

router.post('/ayuda/:id', limits.forms, asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const body = String(req.body.body || '').trim();
  if (body.length < 2) throw badRequest('Escribí tu mensaje.');
  const t = await M.Ticket.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { $push: { messages: { author: req.user._id, authorRole: 'specialist', body: body.slice(0, 5000) } }, $set: { status: 'open' } });
  if (!t) throw notFound();
  res.redirect(`/panel/ayuda/${t._id}`);
}));

// ── Promociones ───────────────────────────────────────────
router.get('/promociones', asyncHandler(async (req, res) => {
  const [list, services] = await Promise.all([
    M.Promotion.find({ specialist: req.specialist._id }).sort({ createdAt: -1 }).lean(),
    M.Service.find({ specialist: req.specialist._id }).select('title').lean(),
  ]);
  res.page(V.promotions, { list, services });
}));

router.post('/promociones', asyncHandler(async (req, res) => {
  const { data, ok, errors } = validate(req.body, {
    title: { type: 'string', required: true, max: 100, label: 'Título' },
    discountPercent: { type: 'int', required: true, min: 5, max: 50, label: 'Descuento' },
    audience: { type: 'enum', values: ['all', 'new_clients', 'returning_clients'], default: 'all' },
    services: { type: 'array', of: 'objectId' },
    code: { type: 'string', max: 20, pattern: /^[A-Za-z0-9-]*$/, patternMessage: 'El código solo puede tener letras, números y guiones.' },
    validFrom: { type: 'date' },
    validTo: { type: 'date' },
    maxUses: { type: 'int', min: 0, max: 10000, default: 0 },
  });
  if (!ok) throw badRequest(Object.values(errors)[0]);
  const ownedCount = await M.Service.countDocuments({ _id: { $in: data.services }, specialist: req.specialist._id });
  if (ownedCount !== data.services.length) throw badRequest('Elegí servicios válidos.');
  await M.Promotion.create({
    ...data, specialist: req.specialist._id, code: data.code ? data.code.toUpperCase() : undefined, fundedBy: 'specialist',
    validFrom: data.validFrom ? D.zonedToUtc(data.validFrom, '00:00') : undefined,
    validTo: data.validTo ? D.zonedToUtc(D.addDays(data.validTo, 1), '00:00') : undefined,
    createdBy: req.user._id, status: 'active',
  });
  req.flash('success', 'Creamos la promoción. Se aplica automáticamente al reservar.');
  res.redirect('/panel/promociones');
}));

router.post('/promociones/:id/estado', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound();
  const p = await M.Promotion.findById(req.params.id);
  if (!own(p, req.specialist)) throw notFound();
  p.status = p.status === 'active' ? 'paused' : p.status === 'paused' ? 'active' : p.status;
  await p.save();
  res.redirect('/panel/promociones');
}));

// ── Destacados (exposición paga, nunca reputación) ────────
router.get('/destacados', asyncHandler(async (req, res) => {
  const [list, services, categories] = await Promise.all([
    M.SponsoredPlacement.find({ specialist: req.specialist._id }).sort({ createdAt: -1 }).populate('category', 'name').lean(),
    M.Service.find({ specialist: req.specialist._id, status: 'active' }).select('title').lean(),
    M.Category.find({ _id: { $in: req.specialist.categories } }).select('name').lean(),
  ]);
  res.page(V.sponsored, { list, services, categories, sp: req.specialist });
}));

router.post('/destacados', limits.forms, asyncHandler(async (req, res) => {
  const { data, ok, errors } = validate(req.body, {
    type: { type: 'enum', values: ['category', 'zone', 'home', 'recommendation'], required: true },
    service: { type: 'objectId' },
    category: { type: 'objectId' },
    weeks: { type: 'int', min: 1, max: 12, default: 1 },
    notes: { type: 'text', max: 500 },
  });
  if (!ok) throw badRequest(Object.values(errors)[0]);
  if (data.service && !(await M.Service.exists({ _id: data.service, specialist: req.specialist._id }))) throw badRequest('Elegí un servicio válido.');
  const start = new Date();
  await M.SponsoredPlacement.create({
    specialist: req.specialist._id, service: data.service, type: data.type, category: data.type === 'category' ? data.category : undefined,
    department: data.type === 'zone' ? req.specialist.location?.department : undefined,
    startsAt: start, endsAt: new Date(start.getTime() + data.weeks * 7 * 86400000), status: 'paused', paymentStatus: 'pending',
    notes: `Solicitud del especialista: ${data.weeks} semana(s). ${data.notes || ''}`.trim(), createdBy: req.user._id,
  });
  await notifyAdmins({ title: 'Solicitud de destacado', body: `${req.specialist.displayName} quiere destacarse (${data.type}, ${data.weeks} semanas).`, link: '/admin/destacados', dedupeKey: `ad:${req.specialist._id}:${Date.now()}` });
  req.flash('success', 'Recibimos tu solicitud. Te contactamos con el presupuesto y la fecha de inicio.');
  res.redirect('/panel/destacados');
}));

// ── Plan Profesional ──────────────────────────────────────
router.get('/plan', (req, res) => res.page(V.plan, { sp: req.specialist }));

router.post('/plan', limits.forms, asyncHandler(async (req, res) => {
  const number = await M.Counter.next('ticket');
  await M.Ticket.create({ number, user: req.user._id, email: req.user.email, name: req.user.name, topic: 'specialist', subject: 'Quiero el Plan Profesional', messages: [{ author: req.user._id, authorRole: 'specialist', body: `Solicitud de Plan Profesional para ${req.specialist.displayName}. ${String(req.body.notes || '').slice(0, 1000)}` }] });
  await notifyAdmins({ title: 'Interés en Plan Profesional', body: req.specialist.displayName, link: '/admin/soporte', dedupeKey: `plan:${req.specialist._id}:${Date.now()}` });
  req.flash('success', 'Te anotamos. Te escribimos con los detalles del Plan Profesional.');
  res.redirect('/panel/plan');
}));

module.exports = router;
