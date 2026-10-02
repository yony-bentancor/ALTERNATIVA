/*
 * Avisos a los usuarios: siempre dentro de la app; además por email, push y WhatsApp
 * según las preferencias de cada persona y lo que esté configurado.
 */
const config = require("../config");
const { enviarEmail, plantilla } = require("./email");
const { numeroWhatsapp } = require("./util");

// Los avisos de operaciones (reservas, pagos, reembolsos) siempre van por email.
const TRANSACCIONALES = new Set(["reserva_confirmada", "reserva_nueva", "cancelada", "reprogramada", "pago", "reembolso", "cuenta", "liquidacion"]);
const POR_WHATSAPP = new Set(["reserva_confirmada", "reserva_nueva", "recordatorio", "cancelada", "reprogramada"]);

const whatsappActivo = () => !!(config.whatsapp.token && config.whatsapp.numeroId);

/** WhatsApp automático (Meta Cloud API, con una plantilla aprobada "alternativa_aviso"). */
async function enviarWhatsapp({ telefono, titulo, texto }) {
  if (!whatsappActivo()) return { ok: false, omitido: "sin_configurar" };
  const to = numeroWhatsapp(telefono);
  if (!to) return { ok: false, omitido: "sin_telefono" };
  const r = await fetch(`https://graph.facebook.com/v20.0/${config.whatsapp.numeroId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.whatsapp.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "template",
      template: { name: "alternativa_aviso", language: { code: config.whatsapp.idioma }, components: [{ type: "body", parameters: [{ type: "text", text: String(titulo).slice(0, 60) }, { type: "text", text: String(texto || "").slice(0, 900) }] }] },
    }),
  });
  if (!r.ok) throw new Error(`WhatsApp ${r.status}`);
  return { ok: true };
}

async function notificar(usuarioOId, { tipo, titulo, texto = "", enlace = "", boton, clave, canales = {} }) {
  const { Usuario, Notificacion } = require("../models");
  const u = typeof usuarioOId === "string" ? await Usuario.porId(usuarioOId) : usuarioOId;
  if (!u || u.estado !== "activo") return null;
  if (clave && (await Notificacion.uno((n) => n.clave === clave && n.usuarioId === u.id))) return null;
  const n = await Notificacion.crear({ usuarioId: u.id, tipo, titulo, texto, enlace, boton, clave, canales: {}, leida: null });

  const pref = u.preferencias?.avisos || {};
  const url = `${config.urlSitio}${enlace || "/"}`;
  if (canales.email !== false && u.email && (TRANSACCIONALES.has(tipo) || pref.email !== false)) {
    try {
      await enviarEmail({ para: u.email, asunto: `${titulo} · Alternativa`, html: plantilla({ titulo, intro: texto, boton: boton || "Ver en Alternativa", url }) });
      n.canales.email = "enviado";
    } catch (e) { n.canales.email = `error: ${String(e.message).slice(0, 120)}`; }
  }
  if (canales.push !== false && pref.push !== false && (u.suscripcionesPush || []).length && config.push.publicKey && config.push.privateKey) {
    const { enviarPush } = require("./webpush");
    const vencidas = [];
    for (const s of u.suscripcionesPush) {
      try { const r = await enviarPush(s, { title: titulo, body: texto, url: enlace || "/" }, config.push); if (r.gone) vencidas.push(s.endpoint); } catch { /* sigue */ }
    }
    if (vencidas.length) { u.suscripcionesPush = u.suscripcionesPush.filter((s) => !vencidas.includes(s.endpoint)); await Usuario.guardar(u); }
    n.canales.push = "enviado";
  }
  if (canales.whatsapp !== false && pref.whatsapp && POR_WHATSAPP.has(tipo) && u.telefono) {
    try { const r = await enviarWhatsapp({ telefono: u.telefono, titulo, texto }); n.canales.whatsapp = r.ok ? "enviado" : r.omitido; } catch (e) { n.canales.whatsapp = "error"; }
  }
  await Notificacion.guardar(n);
  return n;
}

async function notificarAdmins({ titulo, texto, enlace = "/admin", tipo = "alerta", clave }) {
  const { Usuario, Config } = require("../models");
  for (const a of await Usuario.admins()) await notificar(a, { tipo, titulo, texto, enlace, clave: clave ? `${clave}:${a.id}` : undefined });
  const extra = (await Config.obtener()).avisos.emailAlertas;
  if (extra) await enviarEmail({ para: extra, asunto: `[Alternativa] ${titulo}`, html: plantilla({ titulo, intro: texto, boton: "Abrir panel", url: `${config.urlSitio}${enlace}` }) }).catch(() => {});
}

module.exports = { notificar, notificarAdmins, enviarWhatsapp, whatsappActivo };
