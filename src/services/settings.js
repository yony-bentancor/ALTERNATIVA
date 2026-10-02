'use strict';
// Configuración de negocio editable desde el panel admin (sin tocar código).
// Se guarda por secciones en la colección "settings" y se combina con estos valores por defecto.

const DEFAULTS = Object.freeze({
  site: {
    name: 'Alternativa',
    tagline: 'Terapias, bienestar y disciplinas alternativas, con especialistas reales y reseñas verificadas.',
    contactEmail: 'hola@alternativa.uy',
    supportWhatsapp: '',
    instagram: '',
    maintenanceMode: false,
    allowSpecialistSignup: true,
  },
  commission: {
    globalRate: 5,
    // added: el cliente paga precio del especialista + tarifa ($900 + 5% = $945)
    // included: la tarifa se descuenta del precio del especialista
    feeMode: 'added',
    // total: se muestra solo "Total $945" | breakdown: "Servicio $900 + tarifa de servicio $45"
    priceDisplay: 'breakdown',
    feeLabel: 'Tarifa de servicio',
  },
  payments: {
    // split (principal): pago único, la pasarela divide automáticamente (Mercado Pago marketplace + OAuth).
    // platform: Alternativa cobra y liquida | offline: el especialista cobra y se factura la comisión.
    collectionModel: 'split',
    paymentWindowMinutes: 20, // tiempo para pagar antes de liberar el horario
    // Costo estimado del procesador (% con IVA). La comisión real de cada pago se guarda al acreditarse.
    processorFeePercent: 6.09,
    // Quién absorbe el costo del procesador: specialist (comportamiento estándar del split) | customer | platform
    processorFeePaidBy: 'specialist',
    // Los especialistas sin cuenta vinculada no pueden recibir reservas pagas en modelo split
    requireConnectedAccount: true,
    payoutFrequencyDays: 7, // solo modelos platform/offline
    minPayoutAmount: 0,
  },
  cancellation: {
    fullRefundHours: 24, // usuario cancela con ≥ 24 h → 100%
    partialRefundHours: 6, // entre 6 y 24 h → partialRefundPercent
    partialRefundPercent: 50,
    lateRefundPercent: 0, // < 6 h → 0%
    noShowUserRefundPercent: 0,
    specialistCancelRefundPercent: 100,
    noShowSpecialistRefundPercent: 100,
    // Si el especialista cancela, la comisión no se cobra.
    rescheduleMinHours: 12, // reprogramar sin costo hasta 12 h antes
    maxReschedules: 2,
  },
  reviews: {
    requestAfterHours: 2, // pedir reseña 2 h después de terminada la sesión
    editWindowDays: 7,
    reviewWindowDays: 60, // plazo para dejar reseña
    bayesWeight: 10, // C del promedio bayesiano (cuántas reseñas "virtuales")
    bayesPrior: 4.4, // m: promedio esperado de la plataforma
  },
  discovery: {
    newcomerDays: 90, // "Nuevo en Alternativa" durante 90 días…
    newcomerMaxReviews: 5, // …o hasta tener 5 reseñas
    newcomerEvery: 6, // 1 de cada 6 posiciones orgánicas puede ser para un perfil nuevo
    sponsoredSlots: 2, // posiciones patrocinadas máximas por listado
  },
  messaging: {
    // always | after_booking | never  → cuándo se permite compartir datos de contacto en el chat
    contactPolicy: 'after_booking',
  },
  moderation: {
    newSpecialistsRequireReview: true,
    sensitiveChangesRequireReview: true, // nombre y categorías de perfiles publicados
    newServicesRequireReview: false,
    mediaRequiresReview: false,
    newCategoriesRequireReview: true,
  },
  media: {
    maxPhotos: 24,
    maxImageMB: 8,
    maxVideoMB: 80,
    maxVideoSeconds: 120,
    maxDocumentMB: 10,
  },
  notifications: {
    reminderHoursBefore: 24,
    secondReminderHoursBefore: 2,
    rebookAfterDays: 30,
    adminAlertEmail: '',
  },
  automation: {
    autoCompleteAfterHours: 3, // marcar realizada si nadie reporta problemas
  },
});

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) out[k] = v;
  }
  return out;
}

let cache = null;
let cacheAt = 0;
const TTL = 30 * 1000;

async function getSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cacheAt < TTL) return cache;
  const { Setting } = require('../models');
  const docs = await Setting.find({}).lean();
  let merged = deepMerge(DEFAULTS, {});
  for (const d of docs) if (DEFAULTS[d.key]) merged = deepMerge(merged, { [d.key]: d.value });
  cache = merged;
  cacheAt = Date.now();
  return merged;
}

async function updateSection(section, value, actor) {
  if (!DEFAULTS[section]) throw new Error(`Sección de configuración desconocida: ${section}`);
  const { Setting } = require('../models');
  const current = await getSettings({ fresh: true });
  const before = current[section];
  const next = deepMerge(before, value);
  await Setting.findOneAndUpdate({ key: section }, { value: next, updatedBy: actor?._id }, { upsert: true });
  cache = null;
  return { before, after: next };
}

function clearCache() { cache = null; }

module.exports = { DEFAULTS, getSettings, updateSection, deepMerge, clearCache };
