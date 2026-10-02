/*
 * Seguridad sin dependencias extra: cabeceras HTTP (incluida la política de contenido que permite
 * el mapa de Google), protección CSRF de formularios y límite de intentos.
 */
const crypto = require("crypto");
const config = require("../config");

function cabeceras(req, res, next) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      // Mapas de Google embebidos
      "frame-src 'self' https://www.google.com https://maps.google.com",
      "frame-ancestors 'self'",
      "form-action 'self' https://*.mercadopago.com https://*.mercadopago.com.uy https://*.mercadolibre.com",
      "base-uri 'self'",
    ].join("; "),
  });
  if (config.produccion) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

/** Token CSRF por sesión. Los formularios lo envían en el campo oculto _csrf. */
function token(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString("base64url");
  return req.session.csrf;
}

function csrfValido(req) {
  const esperado = req.session?.csrf;
  const recibido = (req.body && req.body._csrf) || req.get("x-csrf-token") || "";
  if (!esperado || !recibido) return false;
  const a = Buffer.from(String(esperado)); const b = Buffer.from(String(recibido));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function csrf(req, res, next) {
  res.locals.csrf = token(req);
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.is("multipart/form-data")) return next(); // se verifica en middlewares/subida.js
  if (csrfValido(req)) return next();
  const e = new Error("La sesión venció o el formulario expiró. Volvé a intentarlo.");
  e.estado = 403; e.visible = true; e.codigo = "csrf";
  return next(e);
}

/** Límite simple de intentos por IP (ingreso, registro, contacto). */
function limite({ max = 10, minutos = 15, mensaje = "Demasiados intentos. Esperá unos minutos y probá de nuevo." } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    if (req.method !== "POST") return next();
    const ahora = Date.now();
    const k = req.ip;
    const lista = (hits.get(k) || []).filter((t) => ahora - t < minutos * 60000);
    lista.push(ahora);
    hits.set(k, lista);
    if (hits.size > 5000) hits.clear();
    if (lista.length > max) {
      req.session.flash = { tipo: "error", texto: mensaje };
      return res.redirect(req.get("referer") || "/");
    }
    return next();
  };
}

module.exports = { cabeceras, csrf, csrfValido, limite };
