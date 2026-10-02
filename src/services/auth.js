'use strict';
// Cuentas: registro, login con bloqueo por intentos, verificación de email y recuperación de contraseña.
const bcrypt = require('bcryptjs');
const config = require('../config');
const { createToken, hashToken } = require('../lib/tokens');
const { badRequest, conflict } = require('../lib/errors');
const { sendEmail, layout } = require('./email');

const BCRYPT_ROUNDS = 12;
const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

let dummy = null;
const dummyHash = () => (dummy || (dummy = bcrypt.hash('cuenta-inexistente', BCRYPT_ROUNDS)));

function passwordProblems(password) {
  const p = String(password || '');
  if (p.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (p.length > 128) return 'La contraseña es demasiado larga.';
  if (!/[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(p) || !/\d/.test(p)) return 'Usá letras y números en la contraseña.';
  if (/^(12345678|password|contraseña|alternativa)/i.test(p)) return 'Elegí una contraseña menos predecible.';
  return null;
}

async function hashPassword(password) {
  return bcrypt.hash(String(password), BCRYPT_ROUNDS);
}

async function sendVerification(user) {
  const { User } = require('../models');
  const { token, hash } = createToken();
  await User.updateOne({ _id: user._id }, { $set: { emailVerifyTokenHash: hash, emailVerifyExpires: new Date(Date.now() + 48 * 3600000) } });
  const url = `${config.appUrl}/verificar/${token}`;
  await sendEmail({
    to: user.email,
    subject: 'Confirmá tu email · Alternativa',
    html: layout({ title: `Hola, ${user.name.split(' ')[0]}`, intro: 'Confirmá tu email para activar todas las funciones de tu cuenta.', ctaLabel: 'Confirmar email', ctaUrl: url, footer: 'El enlace vence en 48 horas. Si no creaste una cuenta, ignorá este mensaje.' }),
  });
  return url;
}

// Toda cuenta nace como usuario; el rol de especialista se asigna al crear su ficha.
async function register({ name, email, password, phone, acceptTerms }) {
  const { User } = require('../models');
  if (!acceptTerms) throw badRequest('Tenés que aceptar los términos y la política de privacidad.');
  const problem = passwordProblems(password);
  if (problem) throw badRequest(problem);
  const exists = await User.exists({ email });
  if (exists) throw conflict('Ya existe una cuenta con ese email. ¿Querés iniciar sesión?', 'email_taken');
  const user = await User.create({
    name, email, phone, role: 'user',
    passwordHash: await hashPassword(password), acceptedTermsAt: new Date(),
  });
  await sendVerification(user);
  return user;
}

// Devuelve el usuario o lanza error genérico (no revela si el email existe).
async function authenticate(email, password) {
  const { User } = require('../models');
  const generic = badRequest('Email o contraseña incorrectos.');
  const user = await User.findOne({ email: String(email || '').toLowerCase().trim() }).select('+passwordHash +failedLogins +lockedUntil');
  if (!user || !user.passwordHash) {
    await bcrypt.compare(String(password || ''), await dummyHash()); // mismo tiempo de respuesta exista o no la cuenta
    throw generic;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw badRequest('Por seguridad bloqueamos el acceso unos minutos tras varios intentos fallidos. Probá más tarde o restablecé tu contraseña.');
  }
  const ok = await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!ok) {
    user.failedLogins = (user.failedLogins || 0) + 1;
    if (user.failedLogins >= MAX_FAILED) {
      user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
      user.failedLogins = 0;
    }
    await user.save();
    throw generic;
  }
  if (user.status === 'suspended') throw badRequest('Tu cuenta está suspendida. Escribinos a soporte si creés que es un error.');
  if (user.status === 'deleted') throw generic;
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();
  return user;
}

async function verifyEmail(token) {
  const { User } = require('../models');
  const user = await User.findOne({ emailVerifyTokenHash: hashToken(token), emailVerifyExpires: { $gt: new Date() } });
  if (!user) throw badRequest('El enlace no es válido o venció. Pedí uno nuevo desde tu cuenta.');
  user.emailVerified = true;
  user.emailVerifyTokenHash = undefined;
  user.emailVerifyExpires = undefined;
  await user.save();
  return user;
}

async function requestPasswordReset(email) {
  const { User } = require('../models');
  const user = await User.findOne({ email: String(email || '').toLowerCase().trim(), status: 'active' });
  if (!user) return; // respuesta idéntica exista o no la cuenta
  const { token, hash } = createToken();
  await User.updateOne({ _id: user._id }, { $set: { resetTokenHash: hash, resetExpires: new Date(Date.now() + 3600000) } });
  const url = `${config.appUrl}/restablecer/${token}`;
  await sendEmail({
    to: user.email,
    subject: 'Restablecer contraseña · Alternativa',
    html: layout({ title: 'Restablecer tu contraseña', intro: 'Recibimos un pedido para cambiar la contraseña de tu cuenta.', ctaLabel: 'Elegir nueva contraseña', ctaUrl: url, footer: 'El enlace vence en 1 hora. Si no lo pediste, ignorá este email: tu contraseña no cambia.' }),
  });
}

async function findByResetToken(token) {
  const { User } = require('../models');
  return User.findOne({ resetTokenHash: hashToken(token), resetExpires: { $gt: new Date() } });
}

async function resetPassword(token, password) {
  const user = await findByResetToken(token);
  if (!user) throw badRequest('El enlace no es válido o venció. Pedí uno nuevo.');
  const problem = passwordProblems(password);
  if (problem) throw badRequest(problem);
  user.passwordHash = await hashPassword(password);
  user.resetTokenHash = undefined;
  user.resetExpires = undefined;
  user.emailVerified = true; // demostró acceso al email
  await user.save();
  return user;
}

async function changePassword(userId, current, next) {
  const { User } = require('../models');
  const user = await User.findById(userId).select('+passwordHash');
  if (!user || !(await bcrypt.compare(String(current || ''), user.passwordHash))) throw badRequest('La contraseña actual no es correcta.');
  const problem = passwordProblems(next);
  if (problem) throw badRequest(problem);
  user.passwordHash = await hashPassword(next);
  await user.save();
}

module.exports = { passwordProblems, hashPassword, register, authenticate, sendVerification, verifyEmail, requestPasswordReset, findByResetToken, resetPassword, changePassword };
