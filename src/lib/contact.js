'use strict';
// Detección de datos de contacto en mensajes. La política (configurable por admin) decide
// si se muestran, se ocultan hasta tener una reserva, o se ocultan siempre.
// Principio del producto: no impedir artificialmente el contacto, sino que usar
// Alternativa sea más conveniente. Por defecto se permite después de la primera reserva.

const PATTERNS = [
  { kind: 'email', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { kind: 'link', re: /\b(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|t\.me|instagram\.com|ig\.me)\/[^\s]*/gi },
  // Teléfonos: internacionales (+...), celulares uruguayos (09X XXX XXX) y fijos (2XXX XXXX / 4XXX XXXX).
  // Se evita confundir fechas (2026-10-02) o precios con teléfonos.
  { kind: 'phone', re: /\+\d(?:[\s.-]?\d){7,14}|\b0?9\d(?:[\s.-]?\d){6}\b|\b[24]\d{3}[\s.-]?\d{4}\b/g },
];

function detectContact(text) {
  const found = [];
  for (const { kind, re } of PATTERNS) {
    const matches = String(text || '').match(re);
    if (matches) for (const m of matches) found.push({ kind, value: m.trim() });
  }
  return found;
}

function maskContact(text) {
  let out = String(text || '');
  for (const { re } of PATTERNS) out = out.replace(re, '[dato de contacto oculto]');
  return out;
}

module.exports = { detectContact, maskContact };
