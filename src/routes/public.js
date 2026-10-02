'use strict';
const express = require('express');
const config = require('../config');
const { asyncHandler, notFound } = require('../lib/errors');
const { validate, isObjectId } = require('../lib/validate');
const { requireAuth } = require('../middleware/auth');
const limits = require('../middleware/rateLimit');
const { search, homeSections, hydrateCards } = require('../services/search');
const { track } = require('../services/stats');
const { getSettings } = require('../services/settings');
const { activeRules, commissionFor, priceBreakdown } = require('../services/commission');
const { publicFilter } = require('../services/media');
const { describePolicy } = require('../services/cancellation');
const { nextAvailableSlot } = require('../services/availability');
const { reportReview } = require('../services/reviews');
const { DEPARTMENTS, REPORT_REASONS } = require('../lib/constants');
const defaults = require('../views/defaultContent');
const V = require('../views/public');
const M = require('../models');

const router = express.Router();

async function favoritesOf(user) {
  if (!user) return new Set();
  const favs = await M.Favorite.find({ user: user._id }).select('kind specialist service').lean();
  return new Set(favs.map((f) => String(f.kind === 'service' ? f.service : f.specialist)));
}

async function contentPage(slug) {
  const doc = await M.Content.findOne({ type: 'page', slug, status: 'published' }).lean();
  return doc || defaults.pages[slug] || null;
}

// ── Home ──────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const [sections, favorites, posts] = await Promise.all([
    homeSections(),
    favoritesOf(req.user),
    M.Content.find({ type: 'post', status: 'published' }).sort({ publishedAt: -1 }).limit(3).lean(),
  ]);
  let upcoming = null;
  if (req.user) {
    upcoming = await M.Booking.findOne({ user: req.user._id, status: { $in: ['paid', 'confirmed'] }, start: { $gt: new Date() } }).sort({ start: 1 }).lean();
  }
  res.page(V.home, { ...sections, favorites, posts, upcoming });
}));

// ── Búsqueda ──────────────────────────────────────────────
router.get('/buscar', asyncHandler(async (req, res) => {
  const q = req.query;
  const params = {
    q: String(q.q || '').slice(0, 120),
    categoria: q.categoria ? String(q.categoria) : undefined,
    departamento: DEPARTMENTS.includes(q.departamento) ? q.departamento : undefined,
    ciudad: q.ciudad ? String(q.ciudad).slice(0, 60) : undefined,
    modality: ['presencial', 'domicilio', 'online'].includes(q.modalidad) ? q.modalidad : undefined,
    when: ['today', 'tomorrow', 'week'].includes(q.cuando) ? q.cuando : undefined,
    precioMax: q.precioMax,
    rating: q.valoracion,
    verificado: q.verificado === '1',
    orden: ['relevancia', 'precio', 'valoracion', 'distancia'].includes(q.orden) ? q.orden : undefined,
    lat: q.lat && Number.isFinite(Number(q.lat)) ? Number(q.lat) : undefined,
    lng: q.lng && Number.isFinite(Number(q.lng)) ? Number(q.lng) : undefined,
    page: q.page,
  };
  const [result, categories, favorites] = await Promise.all([
    search(params, { user: req.user }),
    M.Category.find({ status: 'active' }).sort({ order: 1, name: 1 }).select('name slug').lean(),
    favoritesOf(req.user),
  ]);
  res.page(V.search, { params, result, categories, favorites, departments: DEPARTMENTS });
}));

// ── Categorías ────────────────────────────────────────────
router.get('/categorias', asyncHandler(async (req, res) => {
  const categories = await M.Category.find({ status: 'active' }).sort({ featured: -1, order: 1, name: 1 }).lean();
  res.page(V.categories, { categories });
}));

// ── Perfil público del especialista ───────────────────────
async function loadPublicSpecialist(req, slug) {
  const sp = await M.Specialist.findOne({ slug: String(slug).toLowerCase(), deletedAt: null }).lean();
  if (!sp) throw notFound('Este perfil no existe o ya no está publicado.');
  const isOwner = req.user && String(req.user.specialist) === String(sp._id);
  const isAdmin = req.user?.role === 'admin';
  if (sp.status !== 'active' && !isOwner && !isAdmin) throw notFound('Este perfil no está publicado en este momento.');
  return { sp, preview: sp.status !== 'active', isOwner };
}

router.get('/especialistas/:slug', asyncHandler(async (req, res) => {
  const { sp, preview, isOwner } = await loadPublicSpecialist(req, req.params.slug);
  const settings = await getSettings();
  const rules = await activeRules();
  const [services, media, reviews, certifications, categories, favorites, avatar, cover, video] = await Promise.all([
    M.Service.find({ specialist: sp._id, status: 'active' }).sort({ order: 1, createdAt: 1 }).lean(),
    M.Media.find({ ...publicFilter(sp._id), kind: { $in: ['photo', 'space', 'service'] } }).sort({ order: 1 }).limit(24).lean(),
    M.Review.find({ specialist: sp._id, status: { $ne: 'hidden' } }).sort({ createdAt: -1 }).limit(6).populate('service', 'title').lean(),
    M.Certification.find({ specialist: sp._id, status: { $in: ['declared', 'verified', 'pending'] } }).sort({ year: -1 }).lean(),
    M.Category.find({ _id: { $in: sp.categories } }).select('name slug').lean(),
    favoritesOf(req.user),
    sp.avatar ? M.Media.findOne({ _id: sp.avatar, status: 'approved' }).lean() : null,
    sp.cover ? M.Media.findOne({ _id: sp.cover, status: 'approved' }).lean() : null,
    sp.video ? M.Media.findOne({ _id: sp.video, status: 'approved' }).lean() : null,
  ]);
  const cards = await hydrateCards(services, { settings, rules });
  const next = services[0] ? await nextAvailableSlot({ specialistId: sp._id, service: services[0] }).catch(() => null) : null;
  if (!preview && !isOwner) await track({ specialist: sp._id, field: 'profileViews', req });
  res.page(V.specialistProfile, { sp, preview, isOwner, cards, media, reviews, certifications, categories, favorites, avatar, cover, video, next });
}));

router.get('/especialistas/:slug/galeria', asyncHandler(async (req, res) => {
  const { sp } = await loadPublicSpecialist(req, req.params.slug);
  const [media, video] = await Promise.all([
    M.Media.find({ ...publicFilter(sp._id), kind: { $in: ['photo', 'space', 'service'] } }).sort({ order: 1 }).lean(),
    sp.video ? M.Media.findOne({ _id: sp.video, status: 'approved' }).lean() : null,
  ]);
  res.page(V.gallery, { sp, media, video });
}));

// ── Detalle de servicio ───────────────────────────────────
async function loadPublicService(req) {
  const { sp, preview, isOwner } = await loadPublicSpecialist(req, req.params.spSlug);
  const service = await M.Service.findOne({ specialist: sp._id, slug: String(req.params.svcSlug).toLowerCase() }).populate('category', 'name slug').lean();
  if (!service || (service.status !== 'active' && !isOwner && req.user?.role !== 'admin')) throw notFound('Este servicio no está disponible.');
  return { sp, service, preview, isOwner };
}

router.get('/servicios/:spSlug/:svcSlug', asyncHandler(async (req, res) => {
  const { sp, service, preview, isOwner } = await loadPublicService(req);
  const settings = await getSettings();
  const commission = await commissionFor({ specialist: sp, categoryId: service.category?._id });
  const breakdown = priceBreakdown({
    price: service.price, rate: commission.rate, mode: settings.commission.feeMode,
    processorRate: settings.payments.processorFeePercent, processorPaidBy: settings.payments.processorFeePaidBy,
  });
  const [reviews, otherServices, photos, avatar, favorites, next] = await Promise.all([
    M.Review.find({ service: service._id, status: { $ne: 'hidden' } }).sort({ createdAt: -1 }).limit(5).lean(),
    M.Service.find({ specialist: sp._id, status: 'active', _id: { $ne: service._id } }).sort({ order: 1 }).limit(6).lean(),
    M.Media.find({ _id: { $in: service.photos || [] }, status: 'approved' }).lean(),
    sp.avatar ? M.Media.findOne({ _id: sp.avatar, status: 'approved' }).lean() : null,
    favoritesOf(req.user),
    nextAvailableSlot({ specialistId: sp._id, service }).catch(() => null),
  ]);
  const others = await hydrateCards(otherServices, { settings, rules: await activeRules() });
  if (req.query.ad && isObjectId(req.query.ad)) await M.SponsoredPlacement.updateOne({ _id: req.query.ad }, { $inc: { clicks: 1 } });
  if (!preview && !isOwner) await track({ specialist: sp._id, service: service._id, field: 'serviceViews', req });
  res.page(V.serviceDetail, { sp, service, breakdown, reviews, others, photos, avatar, favorites, next, preview, settings });
}));

router.get('/servicios/:spSlug/:svcSlug/resenas', asyncHandler(async (req, res) => {
  const { sp, service } = await loadPublicService(req);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const filter = { service: service._id, status: { $ne: 'hidden' } };
  if (['1', '2', '3', '4', '5'].includes(req.query.estrellas)) filter.rating = Number(req.query.estrellas);
  const [reviews, total] = await Promise.all([
    M.Review.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean(),
    M.Review.countDocuments(filter),
  ]);
  res.page(V.serviceReviews, { sp, service, reviews, page, pages: Math.max(1, Math.ceil(total / 20)), stars: req.query.estrellas, reasons: REPORT_REASONS });
}));

// ── Reportar contenido (reseñas, fotos, perfiles) ─────────
router.post('/reportar', requireAuth, limits.forms, asyncHandler(async (req, res) => {
  const { data, ok } = validate(req.body, {
    targetType: { type: 'enum', values: ['review', 'media', 'specialist', 'service'], required: true },
    targetId: { type: 'objectId', required: true },
    reason: { type: 'enum', values: Object.keys(REPORT_REASONS), required: true },
    details: { type: 'text', max: 2000 },
  });
  if (!ok) { req.flash('error', 'Elegí un motivo para el reporte.'); return res.redirect('back'); }
  if (data.targetType === 'review') {
    const review = await M.Review.findById(data.targetId);
    if (review) await reportReview(review, req.user, data);
  } else {
    await M.Report.create({ reporter: req.user._id, reporterRole: req.user.role, ...data });
    if (data.targetType === 'media') await M.Media.updateOne({ _id: data.targetId }, { $inc: { reportsCount: 1 } });
  }
  req.flash('success', 'Gracias. Recibimos tu reporte y lo vamos a revisar.');
  return res.redirect('back');
}));

// ── Contenido institucional ───────────────────────────────
for (const slug of ['como-funciona', 'sobre-alternativa', 'terminos', 'privacidad']) {
  router.get(`/${slug}`, asyncHandler(async (req, res) => {
    const page = await contentPage(slug);
    if (!page) throw notFound();
    res.page(V.contentPage, { page, slug });
  }));
}

router.get('/cancelaciones', asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const page = await contentPage('cancelaciones');
  res.page(V.cancellationPolicy, { page, rules: describePolicy(settings.cancellation) });
}));

router.get('/preguntas-frecuentes', asyncHandler(async (req, res) => {
  let faqs = await M.Content.find({ type: 'faq', status: 'published' }).sort({ category: 1, order: 1 }).lean();
  if (!faqs.length) faqs = defaults.faqs;
  res.page(V.faq, { faqs });
}));

router.get('/ofrecer', asyncHandler(async (req, res) => {
  const settings = await getSettings();
  res.page(V.offer, { settings });
}));

router.get('/contacto', (req, res) => res.page(V.contact, { values: { name: req.user?.name, email: req.user?.email } }));

router.post('/contacto', limits.forms, asyncHandler(async (req, res) => {
  const { data, errors, ok } = validate(req.body, {
    name: { type: 'string', required: true, max: 120, label: 'Tu nombre' },
    email: { type: 'email', required: true },
    topic: { type: 'enum', values: ['booking', 'payment', 'refund', 'account', 'specialist', 'technical', 'other'], default: 'other' },
    subject: { type: 'string', required: true, max: 200, label: 'Asunto' },
    message: { type: 'text', required: true, min: 10, max: 5000, label: 'Mensaje' },
    website: { type: 'string' }, // trampa para bots
  });
  if (data.website) return res.redirect('/contacto?enviado=1');
  if (!ok) return res.page(V.contact, { values: req.body, errors }, 400);
  const number = await M.Counter.next('ticket');
  await M.Ticket.create({
    number, user: req.user?._id, name: data.name, email: data.email, topic: data.topic, subject: data.subject,
    messages: [{ author: req.user?._id, authorRole: req.user ? req.user.role : 'guest', body: data.message }],
  });
  req.flash('success', `Recibimos tu mensaje (#${number}). Te respondemos por email a la brevedad.`);
  return res.redirect('/contacto');
}));

// ── Blog ──────────────────────────────────────────────────
router.get('/blog', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const filter = { type: 'post', status: 'published', publishedAt: { $lte: new Date() } };
  if (req.query.tema) filter.category = String(req.query.tema);
  const [posts, total, topics] = await Promise.all([
    M.Content.find(filter).sort({ publishedAt: -1 }).skip((page - 1) * 12).limit(12).lean(),
    M.Content.countDocuments(filter),
    M.Content.distinct('category', { type: 'post', status: 'published' }),
  ]);
  res.page(V.blog, { posts, page, pages: Math.max(1, Math.ceil(total / 12)), topics: topics.filter(Boolean), topic: req.query.tema });
}));

router.get('/blog/:slug', asyncHandler(async (req, res) => {
  const post = await M.Content.findOne({ type: 'post', slug: String(req.params.slug).toLowerCase(), status: 'published' }).lean();
  if (!post) throw notFound('Este artículo no existe o ya no está publicado.');
  const related = await M.Content.find({ type: 'post', status: 'published', _id: { $ne: post._id }, category: post.category }).sort({ publishedAt: -1 }).limit(3).lean();
  res.page(V.article, { post, related });
}));

// ── SEO técnico ───────────────────────────────────────────
router.get('/robots.txt', (req, res) => {
  const allow = config.appEnv === 'production';
  res.type('text/plain').send(allow
    ? `User-agent: *\nDisallow: /mi\nDisallow: /panel\nDisallow: /admin\nDisallow: /api\nDisallow: /reservar\nDisallow: /pago\nSitemap: ${config.appUrl}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n');
});

router.get('/sitemap.xml', asyncHandler(async (req, res) => {
  const [cats, specialists, services, posts] = await Promise.all([
    M.Category.find({ status: 'active' }).select('slug updatedAt').lean(),
    M.Specialist.find({ status: 'active' }).select('slug updatedAt').lean(),
    M.Service.find({ 'search.visible': true }).select('slug search.specialistSlug updatedAt').lean(),
    M.Content.find({ type: 'post', status: 'published' }).select('slug updatedAt').lean(),
  ]);
  const u = (loc, lastmod, priority = '0.6') => `<url><loc>${config.appUrl}${loc}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}<priority>${priority}</priority></url>`;
  const urls = [
    u('/', null, '1.0'), u('/categorias', null, '0.8'), u('/como-funciona'), u('/sobre-alternativa'), u('/preguntas-frecuentes'), u('/blog'), u('/ofrecer'),
    ...cats.map((c) => u(`/${c.slug}`, c.updatedAt, '0.9')),
    ...specialists.map((s) => u(`/especialistas/${s.slug}`, s.updatedAt, '0.8')),
    ...services.map((s) => u(`/servicios/${s.search.specialistSlug}/${s.slug}`, s.updatedAt, '0.7')),
    ...posts.map((p) => u(`/blog/${p.slug}`, p.updatedAt, '0.5')),
  ];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
}));

// ── Página de categoría (URL amigable: /masajes, /acupuntura) ──
router.get('/:slug', asyncHandler(async (req, res, next) => {
  const slug = String(req.params.slug).toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug)) return next();
  const category = await M.Category.findOne({ slug, status: 'active' }).lean();
  if (!category) return next();
  const params = {
    categoria: slug, q: '',
    departamento: DEPARTMENTS.includes(req.query.departamento) ? req.query.departamento : undefined,
    modality: ['presencial', 'domicilio', 'online'].includes(req.query.modalidad) ? req.query.modalidad : undefined,
    page: req.query.page,
  };
  const [result, favorites, posts] = await Promise.all([
    search(params, { user: req.user }),
    favoritesOf(req.user),
    M.Content.find({ type: 'post', status: 'published', tags: slug }).sort({ publishedAt: -1 }).limit(3).lean(),
  ]);
  return res.page(V.category, { category, result, favorites, params, posts, departments: DEPARTMENTS });
}));

module.exports = router;
