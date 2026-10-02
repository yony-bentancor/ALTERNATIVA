'use strict';
// Especialistas: alta, reclamación de perfiles, moderación de cambios sensibles,
// completitud de ficha y sincronización de datos de búsqueda en los servicios.
const config = require('../config');
const { uniqueSlug } = require('../lib/slug');
const { createToken, hashToken } = require('../lib/tokens');
const { badRequest, notFound } = require('../lib/errors');
const { RESERVED_SLUGS } = require('../lib/constants');
const { isNewcomer, bayesian } = require('./ranking');
const { getSettings } = require('./settings');
const { sendEmail, layout } = require('./email');

// Campos cuya modificación por el especialista requiere revisión (si el perfil ya está publicado).
const SENSITIVE_FIELDS = ['displayName', 'categories'];

async function specialistSlug(name, excludeId) {
  const { Specialist } = require('../models');
  let base = name;
  const { slugify } = require('../lib/slug');
  if (RESERVED_SLUGS.has(slugify(base))) base = `${base}-especialista`;
  return uniqueSlug(Specialist, base, {}, excludeId);
}

// Copia en cada servicio los datos del especialista que se usan para buscar y ordenar.
async function syncSearchForSpecialist(specialistId) {
  const { Specialist, Service, Category } = require('../models');
  const settings = await getSettings();
  const sp = await Specialist.findById(specialistId).lean();
  if (!sp) return;
  const services = await Service.find({ specialist: sp._id }).lean();
  const categories = await Category.find({ _id: { $in: services.map((s) => s.category) } }).select('slug status').lean();
  const catMap = new Map(categories.map((c) => [String(c._id), c]));
  const newcomer = isNewcomer({
    publishedAt: sp.publishedAt, reviewCount: sp.stats?.reviewCount,
    days: settings.discovery.newcomerDays, maxReviews: settings.discovery.newcomerMaxReviews,
  });
  const ops = services.map((svc) => {
    const cat = catMap.get(String(svc.category));
    const visible = sp.status === 'active' && !sp.deletedAt && svc.status === 'active' && cat?.status === 'active';
    const geo = sp.location?.geo?.coordinates?.length === 2 ? sp.location.geo : undefined;
    const set = {
      'search.visible': visible,
      'search.specialistName': sp.displayName,
      'search.specialistSlug': sp.slug,
      'search.categorySlug': cat?.slug,
      'search.department': sp.location?.department,
      'search.city': sp.location?.city,
      'search.neighborhood': sp.location?.neighborhood,
      'search.serviceRadiusKm': sp.location?.serviceRadiusKm,
      'search.verified': sp.verification?.identity?.status === 'verified',
      'search.newcomer': newcomer,
      'search.publishedAt': sp.publishedAt,
    };
    const update = { $set: set };
    if (geo) set['search.geo'] = geo;
    else update.$unset = { 'search.geo': 1 };
    return { updateOne: { filter: { _id: svc._id }, update } };
  });
  if (ops.length) await Service.bulkWrite(ops);
  await refreshCategoryCounts();
}

async function refreshCategoryCounts() {
  const { Service, Category } = require('../models');
  const counts = await Service.aggregate([{ $match: { 'search.visible': true } }, { $group: { _id: '$category', n: { $sum: 1 } } }]);
  const map = new Map(counts.map((c) => [String(c._id), c.n]));
  const cats = await Category.find({}).select('_id').lean();
  if (cats.length) await Category.bulkWrite(cats.map((c) => ({ updateOne: { filter: { _id: c._id }, update: { $set: { serviceCount: map.get(String(c._id)) || 0 } } } })));
}

// Recalcula la reputación de un servicio a partir de sus reseñas visibles.
async function recomputeServiceRating(serviceId) {
  const { Review, Service } = require('../models');
  const settings = await getSettings();
  const reviews = await Review.find({ service: serviceId, status: { $ne: 'hidden' } }).select('rating').lean();
  const count = reviews.length;
  const sum = reviews.reduce((a, r) => a + r.rating, 0);
  const avg = count ? Math.round((sum / count) * 10) / 10 : 0;
  const distribution = [0, 0, 0, 0, 0];
  for (const r of reviews) distribution[r.rating - 1]++;
  const weighted = bayesian(count ? sum / count : 0, count, settings.reviews.bayesPrior, settings.reviews.bayesWeight);
  await Service.updateOne({ _id: serviceId }, { $set: { rating: { avg, count, sum, weighted, distribution } } });
}

async function recomputeSpecialistStats(id) {
  const { Review, Booking, Specialist } = require('../models');
  const { Types } = require('mongoose');
  // Las agregaciones no convierten strings a ObjectId: se normaliza acá
  const specialistId = typeof id === 'string' ? new Types.ObjectId(id) : id;
  const [reviewAgg, completed, clients] = await Promise.all([
    Review.aggregate([{ $match: { specialist: specialistId, status: { $ne: 'hidden' } } }, { $group: { _id: null, n: { $sum: 1 }, avg: { $avg: '$rating' } } }]),
    Booking.countDocuments({ specialist: specialistId, status: 'completed' }),
    Booking.aggregate([{ $match: { specialist: specialistId, status: 'completed' } }, { $group: { _id: '$user', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: 'n' }]),
  ]);
  await Specialist.updateOne({ _id: specialistId }, {
    $set: {
      'stats.reviewCount': reviewAgg[0]?.n || 0,
      'stats.rating': reviewAgg[0]?.avg ? Math.round(reviewAgg[0].avg * 10) / 10 : 0,
      'stats.completedBookings': completed,
      'stats.repeatClients': clients[0]?.n || 0,
    },
  });
}

// Requisitos mínimos para publicarse (y para la exposición de "Nuevo en Alternativa").
async function profileCompleteness(specialist) {
  const { Service, Availability } = require('../models');
  const [services, availability] = await Promise.all([
    Service.countDocuments({ specialist: specialist._id, status: { $in: ['active', 'pending_review'] } }),
    Availability.findOne({ specialist: specialist._id }).lean(),
  ]);
  const checks = [
    { key: 'avatar', ok: !!specialist.avatar, label: 'Foto de perfil', href: '/panel/perfil/multimedia' },
    { key: 'bio', ok: (specialist.bio || '').length >= 80, label: 'Presentación de al menos 80 caracteres', href: '/panel/perfil' },
    { key: 'categories', ok: (specialist.categories || []).length > 0, label: 'Al menos una categoría', href: '/panel/perfil' },
    { key: 'modalities', ok: (specialist.modalities || []).length > 0, label: 'Modalidades de atención', href: '/panel/perfil' },
    { key: 'location', ok: !!(specialist.location?.department && specialist.location?.city) || (specialist.modalities || []).every((m) => m === 'online'), label: 'Departamento y ciudad', href: '/panel/perfil' },
    { key: 'services', ok: services > 0, label: 'Al menos un servicio con precio y duración', href: '/panel/servicios/nuevo' },
    { key: 'availability', ok: !!availability && (availability.weekly || []).some((w) => (w.ranges || []).length), label: 'Horarios de atención', href: '/panel/agenda/horarios' },
  ];
  const settings = await getSettings();
  if (settings.payments.collectionModel === 'split' && settings.payments.requireConnectedAccount) {
    checks.push({ key: 'payments', ok: !!specialist.mercadopago?.connectedAt, label: 'Cuenta de cobro vinculada (Mercado Pago)', href: '/panel/cuenta/cobros' });
  }
  const done = checks.filter((c) => c.ok).length;
  return { percent: Math.round((done / checks.length) * 100), checks, missing: checks.filter((c) => !c.ok), ready: done === checks.length };
}

async function createForUser(user, data = {}) {
  const { Specialist, Availability, User } = require('../models');
  const slug = await specialistSlug(data.displayName || user.name);
  const sp = await Specialist.create({
    user: user._id,
    displayName: data.displayName || user.name,
    slug,
    headline: data.headline,
    categories: data.categories || [],
    modalities: data.modalities || ['presencial'],
    location: { department: data.department, city: data.city },
    status: 'draft',
    claim: { status: 'self' },
  });
  await Availability.create({ specialist: sp._id });
  await User.updateOne({ _id: user._id }, { $set: { specialist: sp._id, role: 'specialist' } });
  return sp;
}

// Alta manual por administración (perfil sin dueño, reclamable luego).
async function adminCreate(data, admin) {
  const { Specialist, Availability } = require('../models');
  const slug = await specialistSlug(data.displayName);
  const sp = await Specialist.create({
    ...data,
    slug,
    status: data.status || 'draft',
    claim: { status: 'unclaimed' },
    createdBy: admin._id,
    publishedAt: data.status === 'active' ? new Date() : undefined,
  });
  await Availability.create({ specialist: sp._id });
  await syncSearchForSpecialist(sp._id);
  return sp;
}

async function inviteToClaim(specialist, email) {
  const { Specialist } = require('../models');
  const { token, hash } = createToken();
  const expiresAt = new Date(Date.now() + 30 * 86400000);
  await Specialist.updateOne({ _id: specialist._id }, {
    $set: { 'claim.status': 'invited', 'claim.tokenHash': hash, 'claim.invitedEmail': email, 'claim.invitedAt': new Date(), 'claim.expiresAt': expiresAt },
  });
  const url = `${config.appUrl}/reclamar/${token}`;
  await sendEmail({
    to: email,
    subject: 'Tu perfil está disponible en Alternativa',
    html: layout({
      title: 'Tu perfil está disponible en Alternativa',
      intro: `Creamos la ficha de ${specialist.displayName} en Alternativa. Verificá tu identidad para administrarla: vas a poder editar tus servicios, precios, agenda y recibir reservas.`,
      ctaLabel: 'Reclamar mi perfil',
      ctaUrl: url,
      footer: 'Si no reconocés este perfil, ignorá este email o escribinos y lo damos de baja. El enlace vence en 30 días.',
    }),
  });
  return { url, expiresAt };
}

async function findByClaimToken(token) {
  const { Specialist } = require('../models');
  const sp = await Specialist.findOne({ 'claim.tokenHash': hashToken(token), 'claim.status': 'invited' }).select('+claim.tokenHash');
  if (!sp) throw notFound('El enlace no es válido o ya fue usado.');
  if (sp.claim.expiresAt && sp.claim.expiresAt < new Date()) throw badRequest('El enlace venció. Pedí uno nuevo a Alternativa.');
  return sp;
}

// El usuario reclama el perfil. Queda vinculado y con verificación de identidad pendiente.
async function claimProfile(token, user) {
  const { User, VerificationRequest } = require('../models');
  const sp = await findByClaimToken(token);
  if (user.specialist && String(user.specialist) !== String(sp._id)) throw badRequest('Tu cuenta ya administra otro perfil de especialista.');
  sp.user = user._id;
  sp.claim.status = 'claimed';
  sp.claim.claimedAt = new Date();
  sp.claim.tokenHash = undefined;
  await sp.save();
  await User.updateOne({ _id: user._id }, { $set: { specialist: sp._id, role: user.role === 'admin' ? 'admin' : 'specialist' } });
  await VerificationRequest.create({ specialist: sp._id, user: user._id, type: 'claim', status: 'pending', notes: 'Perfil reclamado mediante invitación. Falta verificar identidad.' });
  return sp;
}

/**
 * Aplica cambios de perfil. Los operativos se publican al instante; los sensibles quedan
 * pendientes de revisión si el perfil ya está publicado y quien edita es el especialista.
 */
async function applyProfileChanges(specialist, changes, { actorRole }) {
  const settings = await getSettings();
  const moderated = actorRole === 'specialist' && specialist.status === 'active' && settings.moderation.sensitiveChangesRequireReview;
  const pending = [];
  for (const [field, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    const current = specialist.get(field);
    const same = JSON.stringify(current?.map ? current.map(String) : current) === JSON.stringify(value?.map ? value.map(String) : value);
    if (same) continue;
    if (moderated && SENSITIVE_FIELDS.includes(field)) {
      specialist.pendingChanges = (specialist.pendingChanges || []).filter((p) => p.field !== field);
      specialist.pendingChanges.push({ field, value, requestedAt: new Date() });
      pending.push(field);
    } else {
      specialist.set(field, value);
    }
  }
  await specialist.save();
  await syncSearchForSpecialist(specialist._id);
  return { pending };
}

async function resolvePendingChange(specialistId, field, approve) {
  const { Specialist } = require('../models');
  const sp = await Specialist.findById(specialistId);
  if (!sp) throw notFound();
  const change = (sp.pendingChanges || []).find((p) => p.field === field);
  if (!change) throw notFound('No hay cambios pendientes en ese campo.');
  if (approve) {
    sp.set(field, change.value);
    if (field === 'displayName') sp.slug = await specialistSlug(change.value, sp._id);
  }
  sp.pendingChanges = sp.pendingChanges.filter((p) => p.field !== field);
  await sp.save();
  await syncSearchForSpecialist(sp._id);
  return { sp, change };
}

async function setStatus(specialistId, status, reason) {
  const { Specialist } = require('../models');
  const sp = await Specialist.findById(specialistId);
  if (!sp) throw notFound();
  const before = sp.status;
  sp.status = status;
  sp.statusReason = reason;
  if (status === 'active' && !sp.publishedAt) sp.publishedAt = new Date();
  await sp.save();
  await syncSearchForSpecialist(sp._id);
  return { sp, before };
}

module.exports = {
  SENSITIVE_FIELDS, specialistSlug, syncSearchForSpecialist, refreshCategoryCounts, recomputeServiceRating, recomputeSpecialistStats,
  profileCompleteness, createForUser, adminCreate, inviteToClaim, findByClaimToken, claimProfile, applyProfileChanges,
  resolvePendingChange, setStatus,
};
