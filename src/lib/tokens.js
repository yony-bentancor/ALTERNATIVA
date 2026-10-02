'use strict';
const crypto = require('crypto');

// Tokens de un solo uso: se envía el valor plano por email y se guarda solo el hash.
function createToken(bytes = 32) {
  const token = crypto.randomBytes(bytes).toString('base64url');
  return { token, hash: hashToken(token) };
}
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
// Código de reserva legible: ALT-7K3P9Q (sin caracteres ambiguos)
function bookingCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `ALT-${s}`;
}

module.exports = { createToken, hashToken, safeEqual, bookingCode };
