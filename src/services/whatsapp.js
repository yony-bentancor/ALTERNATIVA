'use strict';
// WhatsApp Business (Meta Cloud API). Preparado para avisos transaccionales con plantillas
// aprobadas por Meta. Si no hay credenciales, el canal queda deshabilitado.
const config = require('../config');

const enabled = () => !!(config.whatsapp.token && config.whatsapp.phoneNumberId);

function normalizeUyPhone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('598')) return d;
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 8 && d.startsWith('9')) return `598${d}`; // celular 09X XXX XXX
  return d.length >= 10 ? d : null;
}

// Plantilla genérica "alternativa_aviso" con 2 parámetros (título y detalle) que debe crearse en Meta.
async function sendWhatsapp({ phone, title, body, template = 'alternativa_aviso' }) {
  if (!enabled()) return { ok: false, skipped: 'not_configured' };
  const to = normalizeUyPhone(phone);
  if (!to) return { ok: false, skipped: 'no_phone' };
  const res = await fetch(`https://graph.facebook.com/v20.0/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template,
        language: { code: config.whatsapp.lang },
        components: [{ type: 'body', parameters: [{ type: 'text', text: String(title).slice(0, 60) }, { type: 'text', text: String(body || '').slice(0, 900) }] }],
      },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return { ok: true };
}

module.exports = { sendWhatsapp, normalizeUyPhone, enabled };
