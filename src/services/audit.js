'use strict';
const logger = require('../lib/logger');

// Registra acciones sensibles. Nunca rompe la operación principal si falla el log.
async function audit(req, { action, entity, entityId, summary, before, after, severity = 'info' }) {
  try {
    const { AuditLog } = require('../models');
    const actor = req?.user;
    await AuditLog.create({
      actor: actor?._id,
      actorRole: actor?.role || (req ? 'anonymous' : 'system'),
      actorName: actor?.name || (req ? 'Anónimo' : 'Sistema'),
      action, entity, entityId, summary,
      before: scrub(before), after: scrub(after),
      ip: req?.ip,
      userAgent: req?.get ? String(req.get('user-agent') || '').slice(0, 300) : undefined,
      severity,
    });
  } catch (err) {
    logger.error('No se pudo registrar auditoría', { action, err });
  }
}

// Quita campos que nunca deben quedar en logs.
const SECRET_KEYS = /password|token|secret|hash|accountNumber|cardNumber|cvv/i;
function scrub(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj;
  if (typeof obj.toObject === 'function') return scrub(obj.toObject());
  if (Array.isArray(obj)) return obj.map(scrub);
  if (obj._bsontype === 'ObjectId' || obj._bsontype === 'ObjectID') return String(obj);
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = SECRET_KEYS.test(k) ? '[oculto]' : scrub(v);
  return out;
}

// Diferencias superficiales entre dos objetos para before/after compactos.
function diff(before = {}, after = {}) {
  const b = {}; const a = {};
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) { b[k] = before?.[k]; a[k] = after?.[k]; }
  }
  return { before: b, after: a };
}

module.exports = { audit, scrub, diff };
