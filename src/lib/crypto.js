'use strict';
// Cifrado simétrico (AES-256-GCM) para secretos guardados en la base (tokens OAuth de Mercado Pago).
// La clave se deriva de ENCRYPTION_KEY o, si no existe, de SESSION_SECRET.
const crypto = require('crypto');
const config = require('../config');

function key() {
  const secret = process.env.ENCRYPTION_KEY || config.sessionSecret || 'dev-only-insecure-key';
  return crypto.createHash('sha256').update(`alternativa:${secret}`).digest();
}

function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

function decrypt(payload) {
  if (!payload) return '';
  const [v, iv, tag, data] = String(payload).split('.');
  if (v !== 'v1') throw new Error('Formato de cifrado desconocido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
