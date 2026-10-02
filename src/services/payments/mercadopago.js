'use strict';
// Mercado Pago (API REST, sin SDK).
// - Checkout Pro: el cliente paga en Mercado Pago (tarjetas, débito, billetera, medios locales).
//   Alternativa nunca recibe ni guarda datos de tarjeta.
// - Split de pagos (marketplace): la preferencia se crea con el access token del especialista
//   (obtenido por OAuth) y "marketplace_fee" = tarifa de Alternativa. Mercado Pago acredita al
//   especialista y a Alternativa en el mismo pago, sin transferencias manuales.
// - Webhooks firmados (x-signature) para pagos y contracargos.
const crypto = require('crypto');
const config = require('../../config');
const logger = require('../../lib/logger');
const { encrypt, decrypt } = require('../../lib/crypto');

const mp = () => config.payments.mp;

async function api(method, path, { token, body, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${token || mp().accessToken}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
  const res = await fetch(`${mp().apiBase}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Mercado Pago ${res.status}: ${json.message || json.error || text.slice(0, 200)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// ── OAuth (vinculación de la cuenta del especialista) ─────
function oauthUrl(state) {
  const redirect = `${config.appUrl}/panel/cuenta/cobros/mercadopago/callback`;
  const q = new URLSearchParams({ client_id: mp().clientId, response_type: 'code', platform_id: 'mp', state, redirect_uri: redirect });
  return `${mp().authBase}/authorization?${q.toString()}`;
}

async function exchangeCode(code) {
  const redirect = `${config.appUrl}/panel/cuenta/cobros/mercadopago/callback`;
  return api('POST', '/oauth/token', {
    token: mp().accessToken,
    body: { client_id: mp().clientId, client_secret: mp().clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirect },
  });
}

async function refreshToken(refresh) {
  return api('POST', '/oauth/token', {
    token: mp().accessToken,
    body: { client_id: mp().clientId, client_secret: mp().clientSecret, grant_type: 'refresh_token', refresh_token: refresh },
  });
}

function tokensToFields(t) {
  return {
    'mercadopago.userId': String(t.user_id || ''),
    'mercadopago.accessTokenEnc': encrypt(t.access_token),
    'mercadopago.refreshTokenEnc': encrypt(t.refresh_token),
    'mercadopago.publicKey': t.public_key,
    'mercadopago.expiresAt': new Date(Date.now() + (Number(t.expires_in) || 15552000) * 1000),
    'mercadopago.connectedAt': new Date(),
  };
}

// Devuelve el access token vigente del especialista (renovándolo si está por vencer).
async function sellerToken(specialistId) {
  const { Specialist } = require('../../models');
  const sp = await Specialist.findById(specialistId).select('+mercadopago.accessTokenEnc +mercadopago.refreshTokenEnc mercadopago').lean();
  if (!sp?.mercadopago?.accessTokenEnc) return null;
  const soon = new Date(Date.now() + 7 * 86400000);
  if (sp.mercadopago.expiresAt && sp.mercadopago.expiresAt < soon && sp.mercadopago.refreshTokenEnc) {
    try {
      const t = await refreshToken(decrypt(sp.mercadopago.refreshTokenEnc));
      await Specialist.updateOne({ _id: sp._id }, { $set: tokensToFields(t) });
      return t.access_token;
    } catch (err) {
      logger.error('No se pudo renovar token de Mercado Pago', { specialist: String(sp._id), err });
    }
  }
  return decrypt(sp.mercadopago.accessTokenEnc);
}

const isTestToken = (t) => String(t || '').startsWith('TEST-');

module.exports = {
  name: 'mercadopago',
  supportsSplit: true,
  oauthUrl, exchangeCode, tokensToFields, sellerToken,

  async createCheckout({ booking, payment, user, specialist, collectionModel }) {
    const split = collectionModel === 'split';
    const token = split ? await sellerToken(specialist._id) : mp().accessToken;
    if (!token) throw new Error('El especialista no tiene una cuenta de cobro vinculada.');
    const back = (r) => `${config.appUrl}/pago/retorno?pago=${payment._id}&resultado=${r}`;
    const body = {
      items: [{
        id: String(booking.service),
        title: `${booking.snapshot.serviceTitle} — ${booking.snapshot.specialistName}`.slice(0, 250),
        description: `Reserva ${booking.code}`,
        category_id: 'services',
        quantity: 1,
        currency_id: booking.snapshot.currency || 'UYU',
        unit_price: payment.amount,
      }],
      payer: { email: user.email, name: user.name },
      external_reference: String(payment._id),
      metadata: { booking_id: String(booking._id), payment_id: String(payment._id), booking_code: booking.code },
      back_urls: { success: back('ok'), failure: back('error'), pending: back('pendiente') },
      auto_return: 'approved',
      notification_url: `${config.appUrl}/webhooks/mercadopago?pago=${payment._id}`,
      statement_descriptor: 'ALTERNATIVA',
      binary_mode: true, // aprobado o rechazado: no deja reservas colgadas en "pendiente"
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: new Date(booking.paymentDeadline).toISOString(),
    };
    if (split) body.marketplace_fee = payment.marketplaceFee;
    const pref = await api('POST', '/checkout/preferences', { token, body, idempotencyKey: `pref-${payment._id}` });
    return { checkoutUrl: isTestToken(token) ? pref.sandbox_init_point || pref.init_point : pref.init_point, preferenceId: pref.id };
  },

  async fetchPayment(providerPaymentId, { payment } = {}) {
    // Los pagos split pertenecen a la cuenta del especialista: se consultan con su token,
    // y si falla, con el de la plataforma (que también tiene acceso como marketplace).
    let p;
    const tokens = [];
    if (payment?.collectionModel === 'split') tokens.push(await sellerToken(payment.specialist));
    tokens.push(mp().accessToken);
    let lastErr;
    for (const token of tokens.filter(Boolean)) {
      try {
        p = await api('GET', `/v1/payments/${encodeURIComponent(providerPaymentId)}`, { token });
        break;
      } catch (err) { lastErr = err; }
    }
    if (!p) throw lastErr || new Error('Pago no encontrado');
    const fees = p.fee_details || [];
    const providerFee = fees.filter((f) => f.type === 'mercadopago_fee').reduce((a, f) => a + Number(f.amount || 0), 0);
    const marketplaceFee = fees.filter((f) => f.type === 'application_fee').reduce((a, f) => a + Number(f.amount || 0), 0);
    return {
      id: String(p.id),
      status: p.status, // approved | rejected | cancelled | refunded | charged_back | in_mediation | pending | in_process
      statusDetail: p.status_detail,
      amount: Number(p.transaction_amount),
      refundedAmount: Number(p.transaction_amount_refunded || 0),
      providerFee: Math.round(providerFee),
      marketplaceFee: Math.round(marketplaceFee),
      method: p.payment_type_id,
      externalReference: p.external_reference,
      collectorId: p.collector_id ? String(p.collector_id) : null,
      paidAt: p.date_approved ? new Date(p.date_approved) : null,
    };
  },

  async refund({ payment, amount }) {
    const tokens = [];
    if (payment.collectionModel === 'split') tokens.push(await sellerToken(payment.specialist));
    tokens.push(mp().accessToken);
    let lastErr;
    for (const token of tokens.filter(Boolean)) {
      try {
        const r = await api('POST', `/v1/payments/${encodeURIComponent(payment.providerPaymentId)}/refunds`, {
          token, body: { amount }, idempotencyKey: `refund-${payment._id}-${amount}-${payment.refundedAmount || 0}`,
        });
        return { id: String(r.id), amount: r.amount, status: r.status };
      } catch (err) {
        lastErr = err;
        if (err.status && err.status !== 401 && err.status !== 403) break;
      }
    }
    throw lastErr;
  },

  async fetchChargeback(id) {
    return api('GET', `/v1/chargebacks/${encodeURIComponent(id)}`);
  },

  // Conciliación: busca el pago asociado a nuestra referencia (cuando el webhook no llegó).
  async searchByReference(payment) {
    const tokens = [];
    if (payment.collectionModel === 'split') tokens.push(await sellerToken(payment.specialist));
    tokens.push(mp().accessToken);
    for (const token of tokens.filter(Boolean)) {
      try {
        const r = await api('GET', `/v1/payments/search?external_reference=${encodeURIComponent(String(payment._id))}&sort=date_created&criteria=desc`, { token });
        const found = (r.results || [])[0];
        if (found) return String(found.id);
      } catch (err) {
        logger.warn('searchByReference', { err });
      }
    }
    return null;
  },

  // Firma: x-signature "ts=…,v1=…" sobre "id:{data.id};request-id:{x-request-id};ts:{ts};"
  verifyWebhook(req) {
    const secret = mp().webhookSecret;
    if (!secret) return !config.isProd; // en producción la firma es obligatoria
    const sig = String(req.get('x-signature') || '');
    const requestId = String(req.get('x-request-id') || '');
    const parts = Object.fromEntries(sig.split(',').map((kv) => kv.trim().split('=')));
    if (!parts.ts || !parts.v1) return false;
    let dataId = String(req.query['data.id'] || req.body?.data?.id || '');
    if (/^[a-z0-9]+$/i.test(dataId)) dataId = dataId.toLowerCase();
    let manifest = '';
    if (dataId) manifest += `id:${dataId};`;
    if (requestId) manifest += `request-id:${requestId};`;
    manifest += `ts:${parts.ts};`;
    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(parts.v1));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },
};
