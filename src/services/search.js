'use strict';
// Búsqueda de servicios con ranking por intención, perfiles nuevos y resultados patrocinados.
const D = require('../lib/dates');
const { getSettings } = require('./settings');
const { activeRules, displayPriceSync } = require('./commission');
const { detectIntent, scoreItems, interleaveNewcomers, haversineKm, normalize } = require('./ranking');
const { nextAvailableSlot } = require('./availability');
const { trackImpressions } = require('./stats');

const PAGE_SIZE = 20;
const CANDIDATES = 300;

function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function resolveCategoryFromText(text) {
  if (!text) return null;
  const { Category } = require('../models');
  const cats = await Category.find({ status: 'active' }).select('name slug').lean();
  const t = normalize(text);
  return cats.find((c) => normalize(c.name) === t || c.slug === t || normalize(c.name).replace(/s$/, '') === t.replace(/s$/, '')) || null;
}

// Carga los datos que necesita una tarjeta de resultado.
async function hydrateCards(services, { settings, rules, origin }) {
  const { Specialist, Media } = require('../models');
  const ids = [...new Set(services.map((s) => String(s.specialist)))];
  const specialists = await Specialist.find({ _id: { $in: ids } }).select('displayName slug avatar headline location modalities verification stats publishedAt commissionRate').lean();
  const avatarIds = specialists.map((s) => s.avatar).filter(Boolean);
  const avatars = await Media.find({ _id: { $in: avatarIds }, status: 'approved' }).select('url thumbUrl').lean();
  const avatarMap = new Map(avatars.map((m) => [String(m._id), m.thumbUrl || m.url]));
  const spMap = new Map(specialists.map((s) => [String(s._id), { ...s, avatarUrl: avatarMap.get(String(s.avatar)) || null }]));
  return services.map((svc) => {
    const sp = spMap.get(String(svc.specialist));
    const coords = svc.search?.geo?.coordinates;
    return {
      service: svc,
      specialist: sp,
      displayPrice: displayPriceSync({ service: svc, specialist: sp, rules, settings }),
      newcomer: !!svc.search?.newcomer,
      verified: !!svc.search?.verified,
      distanceKm: origin && coords ? Math.round(haversineKm(origin, coords) * 10) / 10 : null,
    };
  }).filter((c) => c.specialist);
}

async function search(params = {}, { user = null, now = new Date() } = {}) {
  const { Service, Category } = require('../models');
  const settings = await getSettings();
  const rules = await activeRules();
  const intent = detectIntent(params.q, { when: params.when, modality: params.modality, near: !!(params.lat && params.lng) });
  const filter = { 'search.visible': true };

  let category = null;
  if (params.categoria) category = await Category.findOne({ slug: params.categoria, status: 'active' }).lean();
  if (!category && intent.text) {
    category = await resolveCategoryFromText(intent.text);
    if (category) intent.text = '';
  }
  if (category) filter.category = category._id;
  if (params.departamento) filter['search.department'] = params.departamento;
  if (params.ciudad) filter['search.city'] = new RegExp(`^${escapeRegex(params.ciudad)}$`, 'i');
  if (intent.modality) filter.modalities = intent.modality;
  if (params.precioMax) {
    const max = Number(params.precioMax);
    if (Number.isFinite(max) && max > 0) filter.price = { $lte: Math.round(max / (1 + settings.commission.globalRate / 100)) + 1 };
  }
  if (params.rating) filter['rating.avg'] = { $gte: Number(params.rating) || 0 };
  if (params.verificado) filter['search.verified'] = true;

  let candidates;
  let usedText = false;
  if (intent.text) {
    usedText = true;
    candidates = await Service.find({ ...filter, $text: { $search: intent.text } }, { textScore: { $meta: 'textScore' } })
      .sort({ textScore: { $meta: 'textScore' } }).limit(CANDIDATES).lean();
    if (!candidates.length) {
      // Búsqueda parcial (prefijos, palabras sueltas) cuando el índice de texto no encuentra nada
      const words = intent.text.split(' ').filter((w) => w.length > 2).map(escapeRegex);
      if (words.length) {
        const re = new RegExp(words.join('|'), 'i');
        candidates = await Service.find({ ...filter, $or: [{ title: re }, { summary: re }, { 'search.specialistName': re }, { 'search.neighborhood': re }] })
          .sort({ 'rating.weighted': -1 }).limit(CANDIDATES).lean();
      }
    }
  } else {
    candidates = await Service.find(filter).sort({ 'rating.weighted': -1, createdAt: -1 }).limit(CANDIDATES).lean();
  }
  candidates = candidates || [];

  const origin = params.lat && params.lng ? [Number(params.lng), Number(params.lat)] : null;
  // A domicilio con ubicación: solo especialistas cuyo radio cubre al usuario
  if (origin && intent.modality === 'domicilio') {
    candidates = candidates.filter((s) => {
      const c = s.search?.geo?.coordinates;
      if (!c) return false;
      return haversineKm(origin, c) <= (s.search.serviceRadiusKm || 10);
    });
  }

  let items = candidates.map((s) => ({
    id: String(s._id),
    doc: s,
    weightedRating: s.rating?.weighted || settings.reviews.bayesPrior,
    price: s.price,
    textScore: s.textScore || 0,
    newcomer: !!s.search?.newcomer,
    distanceKm: origin && s.search?.geo?.coordinates ? haversineKm(origin, s.search.geo.coordinates) : undefined,
  }));

  // Con intención temporal ("hoy", "mañana") se calcula disponibilidad real de los mejores candidatos.
  if (intent.when) {
    const pre = scoreItems(items, { ...intent, when: null }).slice(0, 40);
    const today = D.todayStr(D.DEFAULT_TZ, now);
    const limitDate = intent.when === 'today' ? today : intent.when === 'tomorrow' ? D.addDays(today, 1) : D.addDays(today, 6);
    const withSlots = [];
    for (const it of pre) {
      const next = await nextAvailableSlot({ specialistId: it.doc.specialist, service: it.doc, now, searchDays: intent.when === 'week' ? 7 : 2 });
      if (next && next.date <= limitDate) {
        withSlots.push({ ...it, nextSlot: next, nextSlotMinutes: Math.max(0, (next.start.getTime() - now.getTime()) / 60000) });
      }
    }
    items = withSlots;
  }

  let ranked = params.orden === 'precio'
    ? [...items].sort((a, b) => a.price - b.price)
    : params.orden === 'valoracion'
      ? [...items].sort((a, b) => b.weightedRating - a.weightedRating)
      : interleaveNewcomers(scoreItems(items, intent), settings.discovery.newcomerEvery);
  if (params.orden === 'distancia' && origin) ranked = [...items].sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));

  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const total = ranked.length;
  const pageItems = ranked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const cards = await hydrateCards(pageItems.map((i) => i.doc), { settings, rules, origin });

  // Próximo turno visible en cada tarjeta de la página
  const nextById = new Map(pageItems.filter((i) => i.nextSlot).map((i) => [i.id, i.nextSlot]));
  await Promise.all(cards.map(async (c) => {
    c.nextSlot = nextById.get(String(c.service._id)) || await nextAvailableSlot({ specialistId: c.service.specialist, service: c.service, now, searchDays: 14 }).catch(() => null);
  }));

  const sponsored = page === 1 ? await sponsoredFor({ category, department: params.departamento, q: intent.text, settings, rules, origin, excludeIds: [] }) : [];
  await trackImpressions(cards.map((c) => c.service));

  return {
    items: cards, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    intent, category, sponsored, usedText,
  };
}

// Resultados patrocinados: separados, marcados y limitados. No modifican reputación ni orden orgánico.
async function sponsoredFor({ category, department, q, settings, rules, origin, type }) {
  const { SponsoredPlacement, Service, StatDaily } = require('../models');
  const now = new Date();
  const or = [];
  if (type === 'home') or.push({ type: 'home' });
  if (category) or.push({ type: 'category', category: category._id });
  if (department) or.push({ type: 'zone', department });
  if (q) or.push({ type: 'search', keywords: { $in: normalize(q).split(' ') } });
  or.push({ type: 'recommendation' });
  const placements = await SponsoredPlacement.find({ status: 'active', startsAt: { $lte: now }, endsAt: { $gte: now }, $or: or }).lean();
  if (!placements.length) return [];
  // Rotación aleatoria entre las campañas activas para repartir exposición
  const shuffled = placements.sort(() => Math.random() - 0.5).slice(0, settings.discovery.sponsoredSlots);
  const services = [];
  for (const p of shuffled) {
    const svc = p.service
      ? await Service.findOne({ _id: p.service, 'search.visible': true }).lean()
      : await Service.findOne({ specialist: p.specialist, 'search.visible': true, ...(category ? { category: category._id } : {}) }).sort({ 'rating.weighted': -1 }).lean();
    if (svc) services.push({ svc, placement: p });
  }
  if (!services.length) return [];
  await SponsoredPlacement.updateMany({ _id: { $in: services.map((s) => s.placement._id) } }, { $inc: { impressions: 1 } });
  const date = D.todayStr();
  await StatDaily.bulkWrite(services.map((s) => ({ updateOne: { filter: { specialist: s.svc.specialist, service: null, date }, update: { $inc: { sponsoredImpressions: 1 } }, upsert: true } })), { ordered: false }).catch(() => {});
  const cards = await hydrateCards(services.map((s) => s.svc), { settings, rules, origin });
  return cards.map((c, i) => ({ ...c, sponsored: true, placementId: services[i].placement._id }));
}

// Destacados para la home: mejor valorados con volumen + nuevos + patrocinados de home.
async function homeSections() {
  const { Service, Category } = require('../models');
  const settings = await getSettings();
  const rules = await activeRules();
  const [top, fresh, categories] = await Promise.all([
    Service.find({ 'search.visible': true, 'rating.count': { $gte: 3 } }).sort({ 'rating.weighted': -1 }).limit(8).lean(),
    Service.find({ 'search.visible': true, 'search.newcomer': true }).sort({ 'search.publishedAt': -1 }).limit(4).lean(),
    Category.find({ status: 'active' }).sort({ featured: -1, order: 1, name: 1 }).lean(),
  ]);
  const [topCards, freshCards, sponsored] = await Promise.all([
    hydrateCards(top, { settings, rules }),
    hydrateCards(fresh, { settings, rules }),
    sponsoredFor({ settings, rules, type: 'home' }),
  ]);
  return { top: topCards, fresh: freshCards, categories, sponsored };
}

module.exports = { search, hydrateCards, sponsoredFor, homeSections, PAGE_SIZE };
