/*
 * Mercado Pago (API REST, sin SDK).
 * - Checkout Pro: el cliente paga en Mercado Pago. Alternativa nunca recibe ni guarda datos de tarjeta.
 * - Split (marketplace): la preferencia se crea con el access token del especialista (OAuth) y
 *   "marketplace_fee" = tarifa de Alternativa. Mercado Pago acredita a ambos en el mismo pago.
 * - Webhooks firmados (x-signature) para pagos y contracargos.
 */
const crypto = require("crypto");
const config = require("../../config");
const { cifrar, descifrar } = require("../claves");

const mp = () => config.pagos.mp;

async function api(metodo, ruta, { token, cuerpo, idempotencia } = {}) {
  const headers = { Authorization: `Bearer ${token || mp().accessToken}`, "Content-Type": "application/json" };
  if (idempotencia) headers["X-Idempotency-Key"] = idempotencia;
  const r = await fetch(`${mp().apiBase}${ruta}`, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const t = await r.text();
  let j = {};
  try { j = t ? JSON.parse(t) : {}; } catch { j = { raw: t }; }
  if (!r.ok) { const e = new Error(`Mercado Pago ${r.status}: ${j.message || j.error || t.slice(0, 200)}`); e.status = r.status; throw e; }
  return j;
}

// ── OAuth: vinculación de la cuenta del especialista ─────
const urlRetorno = () => `${config.urlSitio}/panel/cuenta/cobros/mercadopago/callback`;
function urlOAuth(estado) {
  const q = new URLSearchParams({ client_id: mp().clientId, response_type: "code", platform_id: "mp", state: estado, redirect_uri: urlRetorno() });
  return `${mp().authBase}/authorization?${q}`;
}
const canjearCodigo = (code) => api("POST", "/oauth/token", { cuerpo: { client_id: mp().clientId, client_secret: mp().clientSecret, grant_type: "authorization_code", code, redirect_uri: urlRetorno() } });
const renovar = (refresh) => api("POST", "/oauth/token", { cuerpo: { client_id: mp().clientId, client_secret: mp().clientSecret, grant_type: "refresh_token", refresh_token: refresh } });

function datosCuenta(t) {
  return {
    usuarioMp: String(t.user_id || ""), tokenCifrado: cifrar(t.access_token), refreshCifrado: cifrar(t.refresh_token), publicKey: t.public_key,
    vence: new Date(Date.now() + (Number(t.expires_in) || 15552000) * 1000).toISOString(), conectado: new Date().toISOString(), simulado: false,
  };
}

/** Access token vigente del especialista (lo renueva si está por vencer). */
async function tokenVendedor(especialistaId) {
  const { Especialista } = require("../../models");
  const e = await Especialista.porId(especialistaId);
  if (!e?.mercadopago?.tokenCifrado) return null;
  if (e.mercadopago.vence && new Date(e.mercadopago.vence) < new Date(Date.now() + 7 * 86400000) && e.mercadopago.refreshCifrado) {
    try {
      const t = await renovar(descifrar(e.mercadopago.refreshCifrado));
      e.mercadopago = { ...e.mercadopago, ...datosCuenta(t) };
      await Especialista.guardar(e);
      return t.access_token;
    } catch { /* se usa el token actual */ }
  }
  return descifrar(e.mercadopago.tokenCifrado);
}

async function tokensPara(pago) {
  const l = [];
  if (pago?.modeloCobro === "split") l.push(await tokenVendedor(pago.especialistaId));
  l.push(mp().accessToken);
  return l.filter(Boolean);
}

module.exports = {
  nombre: "mercadopago",
  urlOAuth, canjearCodigo, datosCuenta, tokenVendedor,

  async crearCheckout({ reserva: r, pago, usuario, especialista, modelo }) {
    const split = modelo === "split";
    const token = split ? await tokenVendedor(especialista.id) : mp().accessToken;
    if (!token) throw new Error("El especialista no tiene una cuenta de cobro vinculada.");
    const volver = (x) => `${config.urlSitio}/pago/retorno?pago=${pago.id}&resultado=${x}`;
    const cuerpo = {
      items: [{ id: r.servicioId, title: `${r.foto.servicio} — ${r.foto.especialista}`.slice(0, 250), description: `Reserva ${r.codigo}`, category_id: "services", quantity: 1, currency_id: r.foto.moneda || "UYU", unit_price: pago.monto }],
      payer: { email: usuario.email, name: usuario.nombre },
      external_reference: pago.id,
      metadata: { reserva: r.id, pago: pago.id, codigo: r.codigo },
      back_urls: { success: volver("ok"), failure: volver("error"), pending: volver("pendiente") },
      auto_return: "approved",
      notification_url: `${config.urlSitio}/webhooks/mercadopago?pago=${pago.id}`,
      statement_descriptor: "ALTERNATIVA",
      binary_mode: true, // aprobado o rechazado: no deja reservas colgadas en "pendiente"
      expires: true, expiration_date_from: new Date().toISOString(), expiration_date_to: new Date(r.vencePago).toISOString(),
    };
    if (split) cuerpo.marketplace_fee = pago.comisionMarketplace;
    const pref = await api("POST", "/checkout/preferences", { token, cuerpo, idempotencia: `pref-${pago.id}` });
    return { urlCheckout: String(token).startsWith("TEST-") ? pref.sandbox_init_point || pref.init_point : pref.init_point, preferenciaId: pref.id };
  },

  async consultarPago(id, { pago } = {}) {
    let p; let ultimo;
    for (const token of await tokensPara(pago)) {
      try { p = await api("GET", `/v1/payments/${encodeURIComponent(id)}`, { token }); break; } catch (e) { ultimo = e; }
    }
    if (!p) throw ultimo || new Error("Pago no encontrado");
    const fees = p.fee_details || [];
    const suma = (tipo) => Math.round(fees.filter((f) => f.type === tipo).reduce((a, f) => a + Number(f.amount || 0), 0));
    return {
      id: String(p.id), status: p.status, statusDetail: p.status_detail, amount: Number(p.transaction_amount), refundedAmount: Number(p.transaction_amount_refunded || 0),
      providerFee: suma("mercadopago_fee"), marketplaceFee: suma("application_fee"), method: p.payment_type_id, externalReference: p.external_reference,
      collectorId: p.collector_id ? String(p.collector_id) : null, paidAt: p.date_approved ? new Date(p.date_approved) : null,
    };
  },

  async reembolsar({ pago, monto }) {
    let ultimo;
    for (const token of await tokensPara(pago)) {
      try {
        const r = await api("POST", `/v1/payments/${encodeURIComponent(pago.idPasarela)}/refunds`, { token, cuerpo: { amount: monto }, idempotencia: `refund-${pago.id}-${monto}-${pago.reembolsado || 0}` });
        return { id: String(r.id), monto: r.amount, estado: r.status };
      } catch (e) { ultimo = e; if (e.status && e.status !== 401 && e.status !== 403) break; }
    }
    throw ultimo;
  },

  consultarContracargo: (id) => api("GET", `/v1/chargebacks/${encodeURIComponent(id)}`),

  async buscarPorReferencia(pago) {
    for (const token of await tokensPara(pago)) {
      try {
        const r = await api("GET", `/v1/payments/search?external_reference=${encodeURIComponent(pago.id)}&sort=date_created&criteria=desc`, { token });
        if (r.results?.[0]) return String(r.results[0].id);
      } catch { /* siguiente token */ }
    }
    return null;
  },

  // Firma: x-signature "ts=…,v1=…" sobre "id:{data.id};request-id:{x-request-id};ts:{ts};"
  verificarWebhook(req) {
    const secreto = mp().webhookSecret;
    if (!secreto) return !config.produccion; // en producción la firma es obligatoria
    const firma = String(req.get("x-signature") || "");
    const requestId = String(req.get("x-request-id") || "");
    const partes = Object.fromEntries(firma.split(",").map((kv) => kv.trim().split("=")));
    if (!partes.ts || !partes.v1) return false;
    let id = String(req.query["data.id"] || req.body?.data?.id || "");
    if (/^[a-z0-9]+$/i.test(id)) id = id.toLowerCase();
    let manifiesto = "";
    if (id) manifiesto += `id:${id};`;
    if (requestId) manifiesto += `request-id:${requestId};`;
    manifiesto += `ts:${partes.ts};`;
    const esperado = Buffer.from(crypto.createHmac("sha256", secreto).update(manifiesto).digest("hex"));
    const recibido = Buffer.from(String(partes.v1));
    return esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido);
  },
};
