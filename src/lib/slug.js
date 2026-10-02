'use strict';
const crypto = require('crypto');

function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

// Genera un slug único consultando un modelo (filtro extra opcional, p.ej. por especialista).
async function uniqueSlug(Model, base, extraFilter = {}, excludeId = null) {
  const root = slugify(base);
  let candidate = root;
  for (let i = 2; i < 500; i++) {
    const filter = { slug: candidate, ...extraFilter };
    if (excludeId) filter._id = { $ne: excludeId };
    const exists = await Model.exists(filter);
    if (!exists) return candidate;
    candidate = `${root}-${i}`;
  }
  return `${root}-${crypto.randomBytes(3).toString('hex')}`;
}

module.exports = { slugify, uniqueSlug };
