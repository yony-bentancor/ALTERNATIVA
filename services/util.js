/* Utilidades generales: dinero, textos, slugs, códigos, contacto, markdown y datos de referencia. */
const crypto = require("crypto");

// ── Dinero (pesos uruguayos enteros) ─────────────────────
const porcentaje = (monto, pct) => Math.round((monto * pct) / 100);
function pesos(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "";
  const v = Math.round(Number(n));
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}
const fPct = (p) => (p === null || p === undefined ? "" : `${String(Math.round(p * 100) / 100).replace(".", ",")}%`);
function aMonto(v) {
  const n = typeof v === "number" ? v : Number(String(v || "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
}

// ── Textos ───────────────────────────────────────────────
const normalizar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
function slug(s) {
  return normalizar(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "item";
}
/** Slug único dentro de una lista de existentes. */
function slugUnico(base, existentes) {
  const set = new Set(existentes);
  const b = slug(base);
  if (!set.has(b)) return b;
  for (let i = 2; ; i++) if (!set.has(`${b}-${i}`)) return `${b}-${i}`;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const recortar = (s, n) => { const t = String(s || ""); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const texto = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Código de reserva legible (sin letras confusas). */
function codigoReserva() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (const b of crypto.randomBytes(6)) c += abc[b % abc.length];
  return `ALT-${c}`;
}

// ── Markdown simple (blog, páginas, FAQ) ─────────────────
function markdown(md) {
  const lineas = String(md || "").replace(/\r/g, "").split("\n");
  const out = [];
  let lista = null;
  const inline = (t) => esc(t)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((\/[^)\s]*|https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const cerrar = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
  let parrafo = [];
  const volcar = () => { if (parrafo.length) { out.push(`<p>${inline(parrafo.join(" "))}</p>`); parrafo = []; } };
  for (const l of lineas) {
    const t = l.trim();
    if (!t) { volcar(); cerrar(); continue; }
    let m;
    if ((m = t.match(/^(#{2,4})\s+(.*)$/))) { volcar(); cerrar(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = t.match(/^[-*]\s+(.*)$/))) { volcar(); if (lista !== "ul") { cerrar(); out.push("<ul>"); lista = "ul"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = t.match(/^\d+[.)]\s+(.*)$/))) { volcar(); if (lista !== "ol") { cerrar(); out.push("<ol>"); lista = "ol"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = t.match(/^>\s?(.*)$/))) { volcar(); cerrar(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    cerrar();
    parrafo.push(t);
  }
  volcar(); cerrar();
  return out.join("\n");
}

// ── Datos de contacto en mensajes ────────────────────────
// Principio del producto: no impedir artificialmente el contacto, sino que usar Alternativa sea más cómodo.
const PATRONES = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  /\b(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|t\.me|instagram\.com|ig\.me)\/[^\s]*/gi,
  /\+\d(?:[\s.-]?\d){7,14}|\b0?9\d(?:[\s.-]?\d){6}\b|\b[24]\d{3}[\s.-]?\d{4}\b/g,
];
const tieneContacto = (t) => PATRONES.some((re) => { re.lastIndex = 0; return re.test(String(t || "")); });
function ocultarContacto(t) {
  let out = String(t || "");
  for (const re of PATRONES) out = out.replace(re, "[dato de contacto oculto]");
  return out;
}

// ── WhatsApp y mapas ─────────────────────────────────────
/** Número en formato internacional para wa.me (Uruguay por defecto). "099 123 456" → "59899123456". */
function numeroWhatsapp(tel) {
  let d = String(tel || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("598")) return d;
  if (d.startsWith("0")) d = d.slice(1);
  return `598${d}`;
}
const enlaceWhatsapp = (tel, mensaje = "") => {
  const n = numeroWhatsapp(tel);
  return n ? `https://wa.me/${n}${mensaje ? `?text=${encodeURIComponent(mensaje)}` : ""}` : "";
};

// ── Datos de referencia (Uruguay) ────────────────────────
const DEPARTAMENTOS = ["Artigas", "Canelones", "Cerro Largo", "Colonia", "Durazno", "Flores", "Florida", "Lavalleja", "Maldonado", "Montevideo", "Paysandú", "Río Negro", "Rivera", "Rocha", "Salto", "San José", "Soriano", "Tacuarembó", "Treinta y Tres"];
const MODALIDADES = {
  presencial: { texto: "Presencial", corto: "En consultorio", icono: "pin" },
  domicilio: { texto: "A domicilio", corto: "A domicilio", icono: "home" },
  online: { texto: "Online", corto: "Online", icono: "video" },
};
const MODELOS_COBRO = {
  split: { texto: "Split automático: pago único y la pasarela divide especialista / Alternativa (recomendado)", corto: "Split automático" },
  plataforma: { texto: "Alternativa cobra y liquida al especialista (requiere transferencias)", corto: "Alternativa cobra" },
  offline: { texto: "El especialista cobra por fuera y Alternativa factura su comisión", corto: "Cobra el especialista" },
};
const SLUGS_RESERVADOS = new Set(["buscar", "categorias", "especialistas", "servicios", "blog", "ayuda", "preguntas-frecuentes", "contacto", "como-funciona", "sobre-alternativa", "terminos", "privacidad", "cancelaciones", "ingresar", "login", "registro", "salir", "mi", "panel", "admin", "api", "webhooks", "subidas", "archivos", "sitemap.xml", "robots.txt", "reclamar", "recuperar", "restablecer", "verificar", "pago", "reservar", "ofrecer", "healthz", "css", "js", "img"]);

function duracion(min) {
  if (!min) return "";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60); const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
const fRating = (n) => (Math.round((n || 0) * 10) / 10).toFixed(1).replace(".", ",");

module.exports = {
  porcentaje, pesos, fPct, aMonto, normalizar, slug, slugUnico, esc, recortar, texto, EMAIL, codigoReserva, markdown,
  tieneContacto, ocultarContacto, numeroWhatsapp, enlaceWhatsapp, DEPARTAMENTOS, MODALIDADES, MODELOS_COBRO, SLUGS_RESERVADOS, duracion, fRating,
};
