'use strict';
// Comisiones y desglose de precios. Lógica pura (testeada) + carga de reglas desde la base.
//
// Decisión de producto (docs/decisiones.md → Modelo de pagos):
// - El especialista define SU precio (lo que quiere recibir por el servicio).
// - La tarifa de Alternativa se SUMA y el cliente ve un único precio final: $900 + 5% = $945.
//   (modo "added"; el modo "included" descuenta la comisión del precio, por si se necesita)
// - El costo del procesador (p.ej. Mercado Pago) se modela aparte y lo absorbe quien se configure.
const { percentOf } = require('../lib/money');

const idEq = (a, b) => a && b && String(a) === String(b);
const inList = (list, id) => !list || list.length === 0 || list.some((x) => idEq(x, id));
const isValidNow = (r, now) => r.active !== false && (!r.validFrom || new Date(r.validFrom) <= now) && (!r.validTo || new Date(r.validTo) >= now);

/**
 * Resuelve la tasa de comisión aplicable.
 * Precedencia: promoción vigente (la más baja) → tasa fija del especialista → regla de especialista
 * → regla de categoría → tasa global.
 */
function resolveCommission({ specialist, categoryId, rules = [], globalRate, now = new Date() }) {
  const valid = rules.filter((r) => isValidNow(r, now));

  const promos = valid.filter((r) => r.scope === 'promotion'
    && inList(r.appliesToSpecialists, specialist?._id)
    && inList(r.appliesToCategories, categoryId));
  if (promos.length) {
    const best = promos.reduce((a, b) => (b.rate < a.rate ? b : a));
    return { rate: best.rate, source: 'promotion', ruleName: best.name, ruleId: best._id };
  }
  if (specialist && specialist.commissionRate !== null && specialist.commissionRate !== undefined) {
    return { rate: specialist.commissionRate, source: 'specialist', ruleName: 'Comisión particular del especialista' };
  }
  const specRule = valid.find((r) => r.scope === 'specialist' && idEq(r.specialist, specialist?._id));
  if (specRule) return { rate: specRule.rate, source: 'specialist_rule', ruleName: specRule.name, ruleId: specRule._id };
  const catRule = valid.find((r) => r.scope === 'category' && idEq(r.category, categoryId));
  if (catRule) return { rate: catRule.rate, source: 'category', ruleName: catRule.name, ruleId: catRule._id };
  return { rate: globalRate, source: 'global', ruleName: 'Comisión general' };
}

/**
 * Desglose completo de una operación.
 * @param {object} p
 * @param {number} p.price               precio del especialista
 * @param {number} [p.homeServiceExtra]  recargo a domicilio (del especialista)
 * @param {number} [p.discountPercent]   promoción aplicada
 * @param {'specialist'|'platform'} [p.fundedBy] quién absorbe el descuento
 * @param {number} p.rate                % de comisión de Alternativa
 * @param {'added'|'included'} [p.mode]  tarifa sumada al precio (por defecto) o incluida
 * @param {number} [p.processorRate]     % estimado del procesador (con IVA)
 * @param {'specialist'|'customer'|'platform'} [p.processorPaidBy]
 * @returns {{subtotal,discount,platformFee,total,commissionAmount,specialistNet,processorFee,specialistReceives,platformNet,marketplaceFee}}
 *   commissionAmount = tarifa de Alternativa cobrada en la operación
 *   specialistNet    = lo que corresponde al especialista antes de costos del procesador
 *   marketplaceFee   = importe a enviar a la pasarela como comisión del marketplace en el split
 */
function priceBreakdown({ price, homeServiceExtra = 0, discountPercent = 0, fundedBy = 'specialist', rate, mode = 'added', processorRate = 0, processorPaidBy = 'specialist' }) {
  const subtotal = Math.round(price + (homeServiceExtra || 0));
  let discount = discountPercent ? percentOf(subtotal, discountPercent) : 0;
  let specialistNet;
  let platformFee;
  let customerPre; // lo que paga el cliente antes de trasladarle el costo del procesador

  if (mode === 'included') {
    if (fundedBy === 'platform') {
      const fullFee = percentOf(subtotal, rate);
      discount = Math.min(discount, fullFee);
      platformFee = fullFee - discount;
      customerPre = subtotal - discount;
    } else {
      customerPre = subtotal - discount;
      platformFee = percentOf(customerPre, rate);
    }
    specialistNet = customerPre - platformFee;
  } else {
    if (fundedBy === 'platform') {
      const fullFee = percentOf(subtotal, rate);
      discount = Math.min(discount, fullFee);
      specialistNet = subtotal;
      platformFee = fullFee - discount;
    } else {
      specialistNet = subtotal - discount;
      platformFee = percentOf(specialistNet, rate);
    }
    customerPre = specialistNet + platformFee;
  }

  let total = customerPre;
  let processorFee = 0;
  let specialistReceives = specialistNet;
  let platformNet = platformFee;
  let marketplaceFee = platformFee;
  const r = Math.max(0, Math.min(50, processorRate || 0)) / 100;

  if (r > 0) {
    if (processorPaidBy === 'customer') {
      total = Math.round(customerPre / (1 - r));
      processorFee = total - customerPre;
    } else if (processorPaidBy === 'platform') {
      processorFee = Math.round(total * r);
      platformNet = platformFee - processorFee;
      marketplaceFee = Math.max(0, platformNet);
    } else {
      processorFee = Math.round(total * r);
      specialistReceives = specialistNet - processorFee;
    }
  }

  return {
    subtotal, discount, platformFee, total, commissionAmount: platformFee, specialistNet,
    processorFee, specialistReceives, platformNet, marketplaceFee, processorPaidBy, mode,
  };
}

// Compatibilidad: firma corta usada en algunos cálculos rápidos.
function computeAmounts(p) { return priceBreakdown(p); }

// Reglas activas con caché corta (se usan en listados con muchos servicios).
let rulesCache = null;
let rulesAt = 0;
async function activeRules() {
  if (rulesCache && Date.now() - rulesAt < 30000) return rulesCache;
  const { CommissionRule } = require('../models');
  rulesCache = await CommissionRule.find({ active: true }).lean();
  rulesAt = Date.now();
  return rulesCache;
}
function clearRulesCache() { rulesCache = null; }

async function commissionFor({ specialist, categoryId, now = new Date() }) {
  const { getSettings } = require('./settings');
  const settings = await getSettings();
  const rules = await activeRules();
  return resolveCommission({ specialist, categoryId, rules, globalRate: settings.commission.globalRate, now });
}

// Precio que ve el cliente en listados (sin promociones ni recargos).
function displayPriceSync({ service, specialist, rules, settings, now = new Date() }) {
  const { rate } = resolveCommission({ specialist, categoryId: service.category?._id || service.category, rules, globalRate: settings.commission.globalRate, now });
  return priceBreakdown({
    price: service.price, rate,
    mode: settings.commission.feeMode,
    processorRate: settings.payments.processorFeePercent,
    processorPaidBy: settings.payments.processorFeePaidBy,
  }).total;
}

module.exports = { resolveCommission, priceBreakdown, computeAmounts, commissionFor, activeRules, clearRulesCache, displayPriceSync };
