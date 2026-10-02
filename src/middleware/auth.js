'use strict';
const crypto = require('crypto');
const { forbidden, unauthorized } = require('../lib/errors');
const { safeEqual } = require('../lib/tokens');

// ── Sesión y usuario actual ────────────────────────────────
async function loadUser(req, res, next) {
  try {
    req.user = null;
    if (req.session?.userId) {
      const { User } = require('../models');
      const user = await User.findById(req.session.userId);
      if (user && user.status === 'active') req.user = user;
      else req.session.userId = null;
    }
    next();
  } catch (err) { next(err); }
}

function login(req, user) {
  return new Promise((resolve, reject) => {
    const returnTo = req.session.returnTo;
    // Nueva sesión al iniciar sesión (evita fijación de sesión)
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = String(user._id);
      req.session.csrf = crypto.randomBytes(24).toString('base64url');
      return req.session.save((e) => (e ? reject(e) : resolve(returnTo)));
    });
  });
}

function logout(req) {
  return new Promise((resolve) => req.session.destroy(() => resolve()));
}

const wantsJson = (req) => req.xhr || req.path.startsWith('/api/') || (req.get('accept') || '').includes('application/json');

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return next(unauthorized());
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  req.flash('info', 'Iniciá sesión para continuar.');
  return res.redirect('/login');
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (!roles.includes(req.user.role)) return next(forbidden());
    return next();
  };
}

// Carga la ficha del especialista del usuario actual (o lo manda a crearla).
async function requireSpecialist(req, res, next) {
  try {
    if (!req.user) return requireAuth(req, res, next);
    const { Specialist } = require('../models');
    if (!req.user.specialist) return res.redirect('/panel/comenzar');
    const sp = await Specialist.findById(req.user.specialist);
    if (!sp || sp.deletedAt) return res.redirect('/panel/comenzar');
    req.specialist = sp;
    res.locals.ctx.specialist = sp;
    return next();
  } catch (err) { return next(err); }
}

// ── CSRF (token por sesión, en formularios y en cabecera para fetch) ──
function csrf(req, res, next) {
  if (!req.session) return next();
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  res.locals.csrf = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/webhooks/')) return next();
  const sent = req.body?._csrf || req.get('x-csrf-token') || req.query._csrf;
  if (sent && safeEqual(sent, req.session.csrf)) return next();
  const err = forbidden('La sesión expiró o el formulario ya no es válido. Recargá la página e intentá de nuevo.');
  err.code = 'csrf';
  return next(err);
}

// ── Mensajes flash ─────────────────────────────────────────
function flash(req, res, next) {
  req.flash = (type, message) => {
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type, message });
  };
  res.locals.flash = req.session?.flash || [];
  if (req.session) req.session.flash = [];
  next();
}

module.exports = { loadUser, login, logout, requireAuth, requireRole, requireSpecialist, csrf, flash, wantsJson };
