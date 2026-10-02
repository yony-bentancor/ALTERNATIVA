'use strict';
// Validación de archivos por contenido real ("magic bytes"), no por extensión ni por el
// Content-Type que manda el navegador. Incluye lectura de duración de videos MP4/MOV.

function sniffMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (brand === 'qt  ') return 'video/quicktime';
    if (/^(heic|heix|mif1|msf1)$/.test(brand)) return 'image/heic';
    return 'video/mp4';
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  return null;
}

// Recorre las cajas ISO-BMFF hasta moov/mvhd y calcula duración en segundos.
function mp4DurationSeconds(buf) {
  const readBoxes = (start, end, visit) => {
    let p = start;
    while (p + 8 <= end) {
      let size = buf.readUInt32BE(p);
      const type = buf.toString('ascii', p + 4, p + 8);
      let header = 8;
      if (size === 1) {
        if (p + 16 > end) return;
        size = Number(buf.readBigUInt64BE(p + 8));
        header = 16;
      } else if (size === 0) size = end - p;
      if (size < header || p + size > end) return;
      if (visit(type, p + header, p + size) === true) return;
      p += size;
    }
  };
  let duration = null;
  try {
    readBoxes(0, buf.length, (type, s, e) => {
      if (type !== 'moov') return false;
      readBoxes(s, e, (t2, s2) => {
        if (t2 !== 'mvhd') return false;
        const version = buf[s2];
        if (version === 1) {
          const timescale = buf.readUInt32BE(s2 + 20);
          const dur = Number(buf.readBigUInt64BE(s2 + 24));
          duration = timescale ? dur / timescale : null;
        } else {
          const timescale = buf.readUInt32BE(s2 + 12);
          const dur = buf.readUInt32BE(s2 + 16);
          duration = timescale ? dur / timescale : null;
        }
        return true;
      });
      return true;
    });
  } catch { return null; }
  return duration;
}

// Dimensiones básicas de imagen (para metadata y límites).
function imageSize(buf, mime) {
  try {
    if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/webp') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
    }
    if (mime === 'image/jpeg') {
      let p = 2;
      while (p < buf.length) {
        if (buf[p] !== 0xff) return null;
        const marker = buf[p + 1];
        const len = buf.readUInt16BE(p + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7) };
        }
        p += 2 + len;
      }
    }
  } catch { return null; }
  return null;
}

module.exports = { sniffMime, mp4DurationSeconds, imageSize };
