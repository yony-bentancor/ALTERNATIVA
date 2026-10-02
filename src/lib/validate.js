'use strict';
// Validación de formularios en backend (nunca confiar solo en el frontend).
// rules: { campo: { type, required, min, max, values, label, default } }
const { isValidDateStr, isValidTimeStr } = require('./dates');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const PHONE_RE = /^\+?[\d\s()-]{7,20}$/;

function validate(input, rules) {
  const data = {};
  const errors = {};
  const src = input || {};

  for (const [field, rule] of Object.entries(rules)) {
    const label = rule.label || field;
    let v = src[field];
    if (typeof v === 'string' && rule.type !== 'password') v = v.trim();
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

    if (empty) {
      if (rule.type === 'bool') { data[field] = false; continue; }
      if (rule.required) { errors[field] = `${label} es obligatorio.`; continue; }
      if (rule.default !== undefined) data[field] = typeof rule.default === 'function' ? rule.default() : rule.default;
      else if (rule.type === 'array') data[field] = [];
      continue;
    }

    switch (rule.type) {
      case 'string':
      case 'text':
      case 'password': {
        v = String(v);
        if (rule.min && v.length < rule.min) errors[field] = `${label} debe tener al menos ${rule.min} caracteres.`;
        else if (rule.max && v.length > rule.max) errors[field] = `${label} no puede superar ${rule.max} caracteres.`;
        else if (rule.pattern && !rule.pattern.test(v)) errors[field] = rule.patternMessage || `${label} no tiene un formato válido.`;
        else data[field] = v;
        break;
      }
      case 'email': {
        v = String(v).toLowerCase();
        if (!EMAIL_RE.test(v) || v.length > 200) errors[field] = 'Ingresá un email válido.';
        else data[field] = v;
        break;
      }
      case 'phone': {
        if (!PHONE_RE.test(String(v))) errors[field] = 'Ingresá un teléfono válido.';
        else data[field] = String(v).replace(/\s+/g, ' ');
        break;
      }
      case 'url': {
        try {
          const u = new URL(String(v));
          if (!['http:', 'https:'].includes(u.protocol)) throw new Error('protocol');
          data[field] = u.toString();
        } catch { errors[field] = `${label} debe ser una URL válida (https://…).`; }
        break;
      }
      case 'int':
      case 'number': {
        const n = rule.type === 'int' ? parseInt(String(v).replace(/\./g, ''), 10) : Number(String(v).replace(',', '.'));
        if (!Number.isFinite(n)) errors[field] = `${label} debe ser un número.`;
        else if (rule.min !== undefined && n < rule.min) errors[field] = `${label} debe ser al menos ${rule.min}.`;
        else if (rule.max !== undefined && n > rule.max) errors[field] = `${label} no puede ser mayor a ${rule.max}.`;
        else data[field] = n;
        break;
      }
      case 'bool':
        data[field] = ['on', 'true', '1', 'yes', 'si', true, 1].includes(v);
        break;
      case 'enum':
        if (!rule.values.includes(v)) errors[field] = `${label}: opción no válida.`;
        else data[field] = v;
        break;
      case 'array': {
        let arr = Array.isArray(v) ? v : String(v).split(',');
        arr = arr.map((x) => (typeof x === 'string' ? x.trim() : x)).filter((x) => x !== '');
        if (rule.values && arr.some((x) => !rule.values.includes(x))) errors[field] = `${label}: opción no válida.`;
        else if (rule.of === 'objectId' && arr.some((x) => !OBJECT_ID_RE.test(String(x)))) errors[field] = `${label}: valor no válido.`;
        else if (rule.max && arr.length > rule.max) errors[field] = `${label}: máximo ${rule.max} elementos.`;
        else if (rule.required && arr.length === 0) errors[field] = `${label} es obligatorio.`;
        else data[field] = [...new Set(arr)];
        break;
      }
      case 'objectId':
        if (!OBJECT_ID_RE.test(String(v))) errors[field] = `${label}: valor no válido.`;
        else data[field] = String(v);
        break;
      case 'date':
        if (!isValidDateStr(v)) errors[field] = `${label}: fecha no válida.`;
        else data[field] = v;
        break;
      case 'time':
        if (!isValidTimeStr(v)) errors[field] = `${label}: hora no válida.`;
        else data[field] = v;
        break;
      default:
        data[field] = v;
    }
  }
  return { data, errors, ok: Object.keys(errors).length === 0 };
}

const isObjectId = (v) => OBJECT_ID_RE.test(String(v || ''));

module.exports = { validate, isObjectId, EMAIL_RE };
