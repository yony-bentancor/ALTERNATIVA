'use strict';
// Búsqueda y ranking. No hay un "Nº1" universal: los pesos dependen de la intención.
// Lógica pura y testeada; el acceso a datos está en services/search.js.

const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Promedio bayesiano: con pocas reseñas, el valor tiende al promedio de la plataforma.
// 5,0★ con 2 reseñas no supera automáticamente a 4,9★ con 127.
function bayesian(avg, count, prior = 4.4, weight = 10) {
  if (!count) return prior;
  return (weight * prior + avg * count) / (weight + count);
}

const WHEN_WORDS = [
  { re: /\b(hoy|ahora|ya|urgente|esta tarde|esta noche|hoy mismo)\b/, when: 'today' },
  { re: /\b(manana)\b/, when: 'tomorrow' },
  { re: /\b(esta semana|semana|finde|fin de semana|sabado|domingo)\b/, when: 'week' },
];

// Interpreta la búsqueda en lenguaje natural: "masaje hoy cerca", "reiki online barato".
function detectIntent(q, filters = {}) {
  let text = normalize(q);
  const intent = { when: filters.when || null, near: !!filters.near, cheap: false, modality: filters.modality || null, specific: false, text: '' };
  for (const w of WHEN_WORDS) {
    if (w.re.test(text)) { intent.when = intent.when || w.when; text = text.replace(w.re, ' '); }
  }
  if (/\b(cerca|cerca de mi|cercano|cercanos|mi zona|por aca)\b/.test(text)) { intent.near = true; text = text.replace(/\b(cerca de mi|cerca|cercanos?|mi zona|por aca)\b/g, ' '); }
  if (/\b(barato|baratos|economico|economicos|accesible|oferta)\b/.test(text)) { intent.cheap = true; text = text.replace(/\b(barato|baratos|economicos?|accesible|oferta)\b/g, ' '); }
  if (/\b(a domicilio|domicilio|en casa|en mi casa)\b/.test(text)) { intent.modality = intent.modality || 'domicilio'; text = text.replace(/\b(a domicilio|domicilio|en mi casa|en casa)\b/g, ' '); }
  if (/\b(online|virtual|remoto|por zoom|videollamada)\b/.test(text)) { intent.modality = intent.modality || 'online'; text = text.replace(/\b(online|virtual|remoto|por zoom|videollamada)\b/g, ' '); }
  text = text.replace(/\b(de|para|en|un|una|el|la|los|las|con|y|quiero|busco|necesito)\b/g, ' ').replace(/\s+/g, ' ').trim();
  intent.text = text;
  // Más de una palabra o un término no genérico → búsqueda específica (importa la reputación del servicio)
  const GENERIC = ['masaje', 'masajes', 'terapia', 'terapias', 'yoga', 'reiki', 'acupuntura', 'meditacion', 'tai chi', 'astrologia'];
  intent.specific = !!text && (text.split(' ').length > 1 || !GENERIC.includes(text));
  return intent;
}

function weightsFor(intent) {
  if (intent.when) return { availability: 0.45, rating: 0.25, distance: 0.2, price: 0.05, text: 0.05 };
  if (intent.near) return { distance: 0.45, rating: 0.3, availability: 0.15, price: 0.05, text: 0.05 };
  if (intent.cheap) return { price: 0.45, rating: 0.3, availability: 0.1, distance: 0.1, text: 0.05 };
  if (intent.specific) return { rating: 0.5, text: 0.2, availability: 0.1, distance: 0.15, price: 0.05 };
  return { rating: 0.35, availability: 0.2, distance: 0.2, price: 0.15, text: 0.1 };
}

/**
 * @param {Array} items  { id, weightedRating, distanceKm?, price, nextSlotMinutes?, textScore? }
 */
function scoreItems(items, intent) {
  const w = weightsFor(intent);
  const prices = items.map((i) => i.price).filter((p) => Number.isFinite(p));
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const maxText = Math.max(0.0001, ...items.map((i) => i.textScore || 0));
  return items.map((it) => {
    const rating = clamp01((it.weightedRating - 3) / 2);
    const distance = Number.isFinite(it.distanceKm) ? 1 / (1 + it.distanceKm / 4) : (intent.modality === 'online' ? 1 : 0.4);
    let availability = 0.2; // desconocido
    if (it.nextSlotMinutes === null) availability = 0;
    else if (Number.isFinite(it.nextSlotMinutes)) {
      const h = it.nextSlotMinutes / 60;
      availability = h <= 24 ? 1 : h <= 72 ? 0.6 : h <= 168 ? 0.3 : 0.1;
    }
    const price = maxP > minP ? 1 - (it.price - minP) / (maxP - minP) : 0.5;
    const text = (it.textScore || 0) / maxText;
    const score = w.rating * rating + w.distance * distance + w.availability * availability + w.price * price + w.text * text;
    return { ...it, score: Math.round(score * 10000) / 10000 };
  }).sort((a, b) => b.score - a.score || b.weightedRating - a.weightedRating);
}

// Reserva 1 de cada N posiciones para perfiles nuevos (que cumplen requisitos mínimos).
// Nunca se les inventa reputación: se muestran como "Nuevo en Alternativa".
function interleaveNewcomers(ranked, every = 6) {
  const regular = ranked.filter((r) => !r.newcomer);
  const fresh = ranked.filter((r) => r.newcomer);
  if (!fresh.length || every < 2) return ranked;
  const out = [];
  while (regular.length || fresh.length) {
    if ((out.length + 1) % every === 0 && fresh.length) out.push(fresh.shift());
    else if (regular.length) out.push(regular.shift());
    else out.push(fresh.shift());
  }
  return out;
}

function isNewcomer({ publishedAt, reviewCount, now = new Date(), days = 90, maxReviews = 5 }) {
  if (!publishedAt) return false;
  const age = (now.getTime() - new Date(publishedAt).getTime()) / 86400000;
  return age <= days && (reviewCount || 0) < maxReviews;
}

// Distancia en km entre dos [lng, lat]
function haversineKm(a, b) {
  if (!a || !b) return null;
  const toRad = (x) => (x * Math.PI) / 180;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

module.exports = { normalize, bayesian, detectIntent, weightsFor, scoreItems, interleaveNewcomers, isNewcomer, haversineKm };
