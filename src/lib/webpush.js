'use strict';
// Web Push sin dependencias: cifrado aes128gcm (RFC 8291) + autenticación VAPID (RFC 8292).
const crypto = require('crypto');

const b64u = {
  enc: (buf) => Buffer.from(buf).toString('base64url'),
  dec: (s) => Buffer.from(String(s), 'base64url'),
};

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/**
 * Cifra un payload para una suscripción.
 * opts.asPrivate / opts.salt permiten valores fijos para pruebas con vectores del RFC.
 */
function encryptPayload({ p256dh, auth }, payload, opts = {}) {
  const uaPublic = b64u.dec(p256dh);
  const authSecret = b64u.dec(auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (opts.asPrivate) ecdh.setPrivateKey(b64u.dec(opts.asPrivate));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = opts.salt ? b64u.dec(opts.salt) : crypto.randomBytes(16);

  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);

  const plaintext = Buffer.concat([Buffer.from(payload), Buffer.from([2])]); // delimitador de último registro
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  const header = Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic]);
  return Buffer.concat([header, ciphertext]);
}

function vapidAuthHeader(endpoint, { publicKey, privateKey, subject }, now = Date.now()) {
  const pub = b64u.dec(publicKey);
  const jwk = {
    kty: 'EC', crv: 'P-256', d: privateKey,
    x: b64u.enc(pub.subarray(1, 33)), y: b64u.enc(pub.subarray(33, 65)),
  };
  const key = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const header = b64u.enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u.enc(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const unsigned = `${header}.${claims}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64u.enc(sig)}, k=${publicKey}`;
}

function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u.enc(ecdh.getPublicKey()), privateKey: b64u.enc(ecdh.getPrivateKey()) };
}

// Envía la notificación. Devuelve { ok, status, gone } — gone=true si la suscripción caducó (borrarla).
async function sendWebPush(subscription, payload, vapid, { ttl = 3600, urgency = 'normal' } = {}) {
  const body = encryptPayload(subscription.keys, JSON.stringify(payload));
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuthHeader(subscription.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}

module.exports = { encryptPayload, vapidAuthHeader, generateVapidKeys, sendWebPush };
