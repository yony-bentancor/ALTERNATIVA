"use strict";

// Configuración de negocio editable desde el panel admin (sin tocar código).
// Se guarda por secciones en la colección "settings" y se combina
// con estos valores por defecto.

const mongoose = require("mongoose");

const DEFAULTS = Object.freeze({
  site: {
    name: "Alternativa",
    tagline:
      "Terapias, bienestar y disciplinas alternativas, con especialistas reales y reseñas verificadas.",
    contactEmail: "hola@alternativa.uy",
    supportWhatsapp: "",
    instagram: "",
    maintenanceMode: false,
    allowSpecialistSignup: true,
  },

  commission: {
    globalRate: 5,

    // added: el cliente paga precio del especialista + tarifa
    // ($900 + 5% = $945)
    // included: la tarifa se descuenta del precio del especialista
    feeMode: "added",

    // total: se muestra solo "Total $945"
    // breakdown: "Servicio $900 + tarifa de servicio $45"
    priceDisplay: "breakdown",

    feeLabel: "Tarifa de servicio",
  },

  payments: {
    // split (principal): pago único, la pasarela divide automáticamente
    // (Mercado Pago marketplace + OAuth).
    // platform: Alternativa cobra y liquida
    // offline: el especialista cobra y se factura la comisión.
    collectionModel: "split",

    // Tiempo para pagar antes de liberar el horario
    paymentWindowMinutes: 20,

    // Costo estimado del procesador (% con IVA).
    // La comisión real de cada pago se guarda al acreditarse.
    processorFeePercent: 6.09,

    // Quién absorbe el costo del procesador:
    // specialist | customer | platform
    processorFeePaidBy: "specialist",

    // Los especialistas sin cuenta vinculada no pueden recibir
    // reservas pagas en modelo split.
    requireConnectedAccount: true,

    // Solo modelos platform/offline
    payoutFrequencyDays: 7,
    minPayoutAmount: 0,
  },

  cancellation: {
    fullRefundHours: 24,
    partialRefundHours: 6,
    partialRefundPercent: 50,
    lateRefundPercent: 0,
    noShowUserRefundPercent: 0,
    specialistCancelRefundPercent: 100,
    noShowSpecialistRefundPercent: 100,

    // Si el especialista cancela, la comisión no se cobra.
    rescheduleMinHours: 12,
    maxReschedules: 2,
  },

  reviews: {
    requestAfterHours: 2,
    editWindowDays: 7,
    reviewWindowDays: 60,

    // C del promedio bayesiano
    bayesWeight: 10,

    // Promedio esperado de la plataforma
    bayesPrior: 4.4,
  },

  discovery: {
    newcomerDays: 90,
    newcomerMaxReviews: 5,
    newcomerEvery: 6,
    sponsoredSlots: 2,
  },

  messaging: {
    // always | after_booking | never
    contactPolicy: "after_booking",
  },

  moderation: {
    newSpecialistsRequireReview: true,
    sensitiveChangesRequireReview: true,
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
    adminAlertEmail: "",
  },

  automation: {
    autoCompleteAfterHours: 3,
  },
});

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };

  for (const [k, v] of Object.entries(extra || {})) {
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      base &&
      typeof base[k] === "object" &&
      !Array.isArray(base[k])
    ) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }

  return out;
}

let cache = null;
let cacheAt = 0;

const TTL = 30 * 1000;

async function getSettings({ fresh = false } = {}) {
  /*
   * =====================================================
   * MODO TEMPORAL SIN MONGODB
   * =====================================================
   *
   * Si MongoDB no está conectado, usamos directamente
   * la configuración DEFAULTS.
   *
   * Esto permite ejecutar Alternativa temporalmente
   * en Heroku sin base de datos.
   *
   * Cuando MongoDB vuelva a estar conectado,
   * automáticamente se utilizará la colección settings.
   * =====================================================
   */

  if (mongoose.connection.readyState !== 1) {
    return deepMerge(DEFAULTS, {});
  }

  if (!fresh && cache && Date.now() - cacheAt < TTL) {
    return cache;
  }

  const { Setting } = require("../models");

  const docs = await Setting.find({}).lean();

  let merged = deepMerge(DEFAULTS, {});

  for (const d of docs) {
    if (DEFAULTS[d.key]) {
      merged = deepMerge(merged, {
        [d.key]: d.value,
      });
    }
  }

  cache = merged;
  cacheAt = Date.now();

  return merged;
}

async function updateSection(section, value, actor) {
  if (!DEFAULTS[section]) {
    throw new Error(`Sección de configuración desconocida: ${section}`);
  }

  /*
   * No permitimos modificar configuración persistente
   * mientras MongoDB esté desconectado.
   */
  if (mongoose.connection.readyState !== 1) {
    throw new Error(
      "La base de datos no está disponible. No se puede guardar la configuración.",
    );
  }

  const { Setting } = require("../models");

  const current = await getSettings({
    fresh: true,
  });

  const before = current[section];

  const next = deepMerge(before, value);

  await Setting.findOneAndUpdate(
    {
      key: section,
    },
    {
      value: next,
      updatedBy: actor?._id,
    },
    {
      upsert: true,
    },
  );

  cache = null;

  return {
    before,
    after: next,
  };
}

function clearCache() {
  cache = null;
}

module.exports = {
  DEFAULTS,
  getSettings,
  updateSection,
  deepMerge,
  clearCache,
};
