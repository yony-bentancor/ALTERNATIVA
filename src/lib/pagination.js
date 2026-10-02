'use strict';

// Paginación por página (para listados admin) con límites para no traer colecciones enteras.
function parsePage(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

async function paginate(Model, filter, { page, limit, skip }, { sort = { createdAt: -1 }, populate, select, lean = true } = {}) {
  let q = Model.find(filter).sort(sort).skip(skip).limit(limit);
  if (select) q = q.select(select);
  if (populate) for (const p of [].concat(populate)) q = q.populate(p);
  if (lean) q = q.lean();
  const [items, total] = await Promise.all([q, Model.countDocuments(filter)]);
  return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

module.exports = { parsePage, paginate };
