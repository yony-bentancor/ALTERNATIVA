'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { html, raw, markdown, jsonScript } = require('../src/lib/html');
const { detectContact, maskContact } = require('../src/lib/contact');
const { sniffMime, mp4DurationSeconds } = require('../src/lib/files');
const { encryptPayload, vapidAuthHeader, generateVapidKeys } = require('../src/lib/webpush');
const { validate } = require('../src/lib/validate');
const { encrypt, decrypt } = require('../src/lib/crypto');
const { slugify } = require('../src/lib/slug');
const { fmtMoney } = require('../src/lib/money');
const { slotKeys } = require('../src/services/bookings');

test('las plantillas escapan todo lo interpolado', () => {
  const out = String(html`<p>${'<script>alert(1)</script>'}</p>${raw('<b>ok</b>')}${['<i>', html`<u>x</u>`]}`);
  assert.equal(out, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><b>ok</b>&lt;i&gt;<u>x</u>');
  assert.ok(!String(markdown('[x](javascript:alert(1))')).includes('href'));
  assert.ok(String(markdown('**hola** [link](https://a.uy)')).includes('<strong>hola</strong>'));
  assert.ok(!String(jsonScript({ a: '</script>' })).includes('</script>'));
});

test('detecta y oculta datos de contacto sin confundir fechas ni precios', () => {
  assert.equal(detectContact('mi cel es 099 123 456').length, 1);
  assert.equal(detectContact('escribime a ana@mail.com').length, 1);
  assert.equal(detectContact('wa.me/59899123456').length >= 1, true);
  assert.equal(detectContact('nos vemos el 2026-10-02 a las 14:30, sale $1.200').length, 0);
  assert.ok(!maskContact('llamame al +598 99 123 456').includes('123'));
});

test('identifica tipos de archivo por contenido', () => {
  assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(sniffMime(Buffer.from('%PDF-1.7 aaaaaaa')), 'application/pdf');
  assert.equal(sniffMime(Buffer.from('<html><script>xx')), null);
});

test('lee la duración de un MP4 (caja mvhd)', () => {
  const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('ftypisom'), Buffer.alloc(4)]);
  const mvhdBody = Buffer.alloc(100);
  mvhdBody.writeUInt32BE(1000, 12); // timescale
  mvhdBody.writeUInt32BE(45000, 16); // duración = 45 s
  const mvhd = Buffer.concat([Buffer.from([0, 0, 0, 108]), Buffer.from('mvhd'), mvhdBody]);
  const moov = Buffer.concat([Buffer.from([0, 0, 0, 116]), Buffer.from('moov'), mvhd]);
  const file = Buffer.concat([ftyp, moov]);
  assert.equal(sniffMime(file), 'video/mp4');
  assert.equal(mp4DurationSeconds(file), 45);
});

test('Web Push: vector de prueba del RFC 8291', () => {
  const out = encryptPayload(
    { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    'When I grow up, I want to be a watermelon',
    { asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: 'DGv6ra1nlYgDCS1FRnbzlw' },
  );
  assert.equal(out.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('Web Push: JWT VAPID verificable con la clave pública', () => {
  const keys = generateVapidKeys();
  const header = vapidAuthHeader('https://fcm.googleapis.com/fcm/send/abc', { ...keys, subject: 'mailto:a@b.uy' });
  const jwt = header.match(/t=([^,]+)/)[1];
  const [h, c, s] = jwt.split('.');
  const pub = Buffer.from(keys.publicKey, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(c, 'base64url')).aud, 'https://fcm.googleapis.com');
});

test('validación de formularios en backend', () => {
  const r = validate({ email: 'MAL', price: '1.200', when: '2026-02-30', ok: 'on' }, {
    email: { type: 'email', required: true },
    price: { type: 'int', min: 0 },
    when: { type: 'date' },
    ok: { type: 'bool' },
    name: { type: 'string', required: true, label: 'Nombre' },
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.email);
  assert.ok(r.errors.when);
  assert.equal(r.errors.name, 'Nombre es obligatorio.');
  assert.equal(r.data.price, 1200);
  assert.equal(r.data.ok, true);
});

test('cifrado de secretos', () => {
  const enc = encrypt('APP_USR-123');
  assert.notEqual(enc, 'APP_USR-123');
  assert.equal(decrypt(enc), 'APP_USR-123');
});

test('slugs y formato de moneda', () => {
  assert.equal(slugify('Masaje Descontracturante Ñandú'), 'masaje-descontracturante-nandu');
  assert.equal(fmtMoney(5400000), '$5.400.000');
  assert.equal(fmtMoney(945), '$945');
});

test('bloques anti doble reserva de 5 minutos con buffer', () => {
  const start = new Date('2026-10-05T12:00:00Z');
  const end = new Date('2026-10-05T13:00:00Z');
  assert.equal(slotKeys(start, end).length, 12);
  assert.equal(slotKeys(start, end, 15).length, 15);
  // Dos reservas superpuestas comparten al menos un bloque → el índice único rechaza la segunda
  const a = slotKeys(start, end).map((d) => d.getTime());
  const b = slotKeys(new Date('2026-10-05T12:55:00Z'), new Date('2026-10-05T13:55:00Z')).map((d) => d.getTime());
  assert.ok(a.some((t) => b.includes(t)));
  const c = slotKeys(end, new Date('2026-10-05T14:00:00Z')).map((d) => d.getTime());
  assert.ok(!a.some((t) => c.includes(t)), 'reservas consecutivas no chocan');
});
