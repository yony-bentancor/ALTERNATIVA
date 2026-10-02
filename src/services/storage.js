'use strict';
// Almacenamiento de archivos multimedia. MongoDB guarda solo la referencia (URL + clave).
// - local: disco (desarrollo). Archivos públicos en public/uploads, privados en storage/private.
// - cloudinary: producción (imágenes con transformaciones, videos y documentos privados firmados).
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public', 'uploads');
const PRIVATE_DIR = path.join(ROOT, 'storage', 'private');

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'application/pdf': 'pdf' };

// ── Local ─────────────────────────────────────────────────
const local = {
  async save({ buffer, mime, folder = 'misc', isPrivate = false }) {
    const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${EXT[mime] || 'bin'}`;
    const dir = path.join(isPrivate ? PRIVATE_DIR : PUBLIC_DIR, folder);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), buffer);
    const key = `${folder}/${name}`;
    return { driver: 'local', key, url: isPrivate ? `private:${key}` : `/uploads/${key}`, thumbUrl: null };
  },
  async remove(key, { isPrivate = false } = {}) {
    if (!key || key.includes('..')) return;
    await fs.unlink(path.join(isPrivate ? PRIVATE_DIR : PUBLIC_DIR, key)).catch(() => {});
  },
  privatePath(key) {
    if (!key || key.includes('..')) return null;
    return path.join(PRIVATE_DIR, key);
  },
  signedUrl() { return null; },
};

// ── Cloudinary (API REST firmada, sin SDK) ────────────────
function cloudSign(params) {
  const { apiSecret } = config.storage.cloudinary;
  const toSign = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== '').sort().map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');
}
const resourceType = (mime) => (mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : 'raw');

const cloudinary = {
  async save({ buffer, mime, folder = 'misc', isPrivate = false }) {
    const c = config.storage.cloudinary;
    const rt = resourceType(mime);
    const params = {
      folder: `${c.folder}/${folder}`,
      timestamp: Math.floor(Date.now() / 1000),
      type: isPrivate ? 'authenticated' : 'upload',
    };
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) form.append(k, String(v));
    form.append('api_key', c.apiKey);
    form.append('signature', cloudSign(params));
    form.append('file', new Blob([buffer], { type: mime }), `upload.${EXT[mime] || 'bin'}`);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${c.cloudName}/${rt}/upload`, { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Cloudinary: ${json.error?.message || res.status}`);
    const url = json.secure_url;
    let thumbUrl = null;
    if (!isPrivate && rt === 'image') thumbUrl = url.replace('/upload/', '/upload/c_fill,w_480,h_480,g_auto,q_auto,f_auto/');
    if (!isPrivate && rt === 'video') thumbUrl = url.replace('/upload/', '/upload/so_1,w_640,c_limit/').replace(/\.\w+$/, '.jpg');
    return {
      driver: 'cloudinary', key: `${rt}:${isPrivate ? 'authenticated' : 'upload'}:${json.public_id}:${json.format || ''}`,
      url: isPrivate ? `private:${rt}:${json.public_id}` : url, thumbUrl,
      width: json.width, height: json.height, durationSec: json.duration,
    };
  },
  async remove(key) {
    if (!key) return;
    const c = config.storage.cloudinary;
    const [rt, type, publicId] = key.split(':');
    const params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000), type, invalidate: 'true' };
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) form.append(k, String(v));
    form.append('api_key', c.apiKey);
    form.append('signature', cloudSign(params));
    await fetch(`https://api.cloudinary.com/v1_1/${c.cloudName}/${rt}/destroy`, { method: 'POST', body: form }).catch(() => {});
  },
  // URL firmada para recursos "authenticated" (documentos privados): solo se entrega al admin.
  signedUrl(key) {
    const c = config.storage.cloudinary;
    const [rt, type, publicId, format] = key.split(':');
    const target = format ? `${publicId}.${format}` : publicId;
    const sig = crypto.createHash('sha1').update(target + c.apiSecret).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').slice(0, 8);
    return `https://res.cloudinary.com/${c.cloudName}/${rt}/${type}/s--${sig}--/${target}`;
  },
  privatePath() { return null; },
};

const drivers = { local, cloudinary };
function storage() {
  return drivers[config.storage.driver] || local;
}

module.exports = { storage, drivers, PUBLIC_DIR, PRIVATE_DIR };
