'use strict';
const rateLimit = require('express-rate-limit');
const logger = require('../lib/logger');

const handler = (message) => (req, res) => {
  logger.warn('Rate limit', { ip: req.ip, path: req.path });
  if (req.path.startsWith('/api/') || (req.get('accept') || '').includes('json')) return res.status(429).json({ error: message });
  return res.status(429).send(`<!doctype html><meta charset="utf-8"><title>Demasiados intentos</title><body style="font-family:system-ui;padding:40px;max-width:520px;margin:auto"><h1>Demasiados intentos</h1><p>${message}</p><p><a href="/">Volver al inicio</a></p></body>`);
};

const base = { standardHeaders: 'draft-7', legacyHeaders: false };

module.exports = {
  // Login, registro y recuperación: frena fuerza bruta y abuso de emails
  auth: rateLimit({ ...base, windowMs: 15 * 60000, limit: 20, handler: handler('Hiciste muchos intentos seguidos. Esperá unos minutos y probá de nuevo.') }),
  // API general (disponibilidad, favoritos, mensajes)
  api: rateLimit({ ...base, windowMs: 60000, limit: 120, handler: handler('Demasiadas solicitudes. Esperá un momento.') }),
  // Creación de reservas y pagos
  booking: rateLimit({ ...base, windowMs: 10 * 60000, limit: 30, handler: handler('Demasiados intentos de reserva. Esperá unos minutos.') }),
  // Formularios públicos (contacto, denuncias)
  forms: rateLimit({ ...base, windowMs: 60 * 60000, limit: 15, handler: handler('Enviaste muchos formularios. Probá más tarde.') }),
  // Subida de archivos
  uploads: rateLimit({ ...base, windowMs: 60 * 60000, limit: 60, handler: handler('Subiste muchos archivos seguidos. Probá más tarde.') }),
};
