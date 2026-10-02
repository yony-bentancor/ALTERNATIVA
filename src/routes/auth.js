'use strict';
const express = require('express');
const { asyncHandler } = require('../lib/errors');
const { validate } = require('../lib/validate');
const { login, logout, requireAuth } = require('../middleware/auth');
const limits = require('../middleware/rateLimit');
const authService = require('../services/auth');
const specialists = require('../services/specialists');
const { audit } = require('../services/audit');
const { getSettings } = require('../services/settings');
const V = require('../views/auth');

const router = express.Router();

const safeReturn = (url) => (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : null);

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/mi');
  if (req.query.volver && safeReturn(req.query.volver)) req.session.returnTo = req.query.volver;
  return res.page(V.login, { values: {} });
});

router.post('/login', limits.auth, asyncHandler(async (req, res) => {
  const { data } = validate(req.body, { email: { type: 'email', required: true }, password: { type: 'password', required: true } });
  try {
    const user = await authService.authenticate(data.email || req.body.email, req.body.password);
    const returnTo = await login(req, user);
    if (user.role === 'admin') await audit(req, { action: 'auth.admin_login', entity: 'User', entityId: user._id, severity: 'security' });
    return res.redirect(safeReturn(returnTo) || (user.role === 'admin' ? '/admin' : user.specialist ? '/panel' : '/'));
  } catch (err) {
    if (err.status && err.status < 500) return res.page(V.login, { values: { email: req.body.email }, error: err.message }, 400);
    throw err;
  }
}));

router.post('/salir', asyncHandler(async (req, res) => {
  await logout(req);
  res.redirect('/');
}));

// Selección de tipo de cuenta → registro
router.get('/registro', (req, res) => {
  if (req.user) return res.redirect(req.query.tipo === 'especialista' ? '/panel/comenzar' : '/mi');
  if (!req.query.tipo) return res.page(V.accountType, {});
  return res.page(V.register, { values: {}, tipo: req.query.tipo === 'especialista' ? 'especialista' : 'usuario' });
});

router.post('/registro', limits.auth, asyncHandler(async (req, res) => {
  const tipo = req.body.tipo === 'especialista' ? 'especialista' : 'usuario';
  const settings = await getSettings();
  const { data, errors, ok } = validate(req.body, {
    name: { type: 'string', required: true, min: 2, max: 120, label: 'Nombre y apellido' },
    email: { type: 'email', required: true },
    phone: { type: 'phone', label: 'Teléfono' },
    password: { type: 'password', required: true, min: 8, label: 'Contraseña' },
    acceptTerms: { type: 'bool' },
  });
  if (!ok) return res.page(V.register, { values: req.body, errors, tipo }, 400);
  try {
    const user = await authService.register(data);
    const returnTo = await login(req, user);
    if (tipo === 'especialista' && settings.site.allowSpecialistSignup) {
      req.flash('success', 'Cuenta creada. Ahora armemos tu ficha de especialista.');
      return res.redirect('/panel/comenzar');
    }
    req.flash('success', 'Te damos la bienvenida. Te mandamos un email para confirmar tu dirección.');
    return res.redirect(safeReturn(returnTo) || '/');
  } catch (err) {
    if (err.status && err.status < 500) return res.page(V.register, { values: req.body, errors: { [err.code === 'email_taken' ? 'email' : 'password']: err.message }, tipo }, 400);
    throw err;
  }
}));

router.get('/verificar/:token', asyncHandler(async (req, res) => {
  try {
    await authService.verifyEmail(req.params.token);
    req.flash('success', 'Tu email quedó confirmado.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect(req.user ? '/mi' : '/login');
}));

router.post('/verificar/reenviar', requireAuth, limits.auth, asyncHandler(async (req, res) => {
  if (!req.user.emailVerified) await authService.sendVerification(req.user);
  req.flash('success', 'Te reenviamos el email de confirmación.');
  res.redirect('back');
}));

router.get('/recuperar', (req, res) => res.page(V.forgot, {}));

router.post('/recuperar', limits.auth, asyncHandler(async (req, res) => {
  const { data, ok } = validate(req.body, { email: { type: 'email', required: true } });
  if (ok) await authService.requestPasswordReset(data.email);
  res.page(V.forgot, { sent: true });
}));

router.get('/restablecer/:token', asyncHandler(async (req, res) => {
  const user = await authService.findByResetToken(req.params.token);
  res.page(V.reset, { token: req.params.token, invalid: !user });
}));

router.post('/restablecer/:token', limits.auth, asyncHandler(async (req, res) => {
  if (req.body.password !== req.body.password2) return res.page(V.reset, { token: req.params.token, error: 'Las contraseñas no coinciden.' }, 400);
  try {
    const user = await authService.resetPassword(req.params.token, req.body.password);
    await audit({ user, ip: req.ip, get: req.get.bind(req) }, { action: 'auth.password_reset', entity: 'User', entityId: user._id, severity: 'security' });
    await login(req, user);
    req.flash('success', 'Listo, ya podés usar tu nueva contraseña.');
    return res.redirect('/');
  } catch (err) {
    if (err.status && err.status < 500) return res.page(V.reset, { token: req.params.token, error: err.message }, 400);
    throw err;
  }
}));

// Reclamación de perfiles creados por administración
router.get('/reclamar/:token', asyncHandler(async (req, res) => {
  try {
    const sp = await specialists.findByClaimToken(req.params.token);
    if (!req.user) req.session.returnTo = `/reclamar/${req.params.token}`;
    res.page(V.claim, { sp, token: req.params.token });
  } catch (err) {
    res.page(V.claim, { error: err.message }, err.status || 400);
  }
}));

router.post('/reclamar/:token', requireAuth, asyncHandler(async (req, res) => {
  const sp = await specialists.claimProfile(req.params.token, req.user);
  await audit(req, { action: 'specialist.claim', entity: 'Specialist', entityId: sp._id, summary: `Perfil reclamado por ${req.user.email}` });
  req.flash('success', 'Ya administrás tu perfil. Para mostrarlo como verificado, completá la verificación de identidad.');
  res.redirect('/panel/verificacion');
}));

module.exports = router;
