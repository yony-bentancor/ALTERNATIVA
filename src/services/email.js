'use strict';
// Envío de emails. Proveedores: console (desarrollo) y Resend (HTTP API, sin SDK).
const config = require('../config');
const logger = require('../lib/logger');
const { escape } = require('../lib/html');

function layout({ title, intro, body = '', ctaLabel, ctaUrl, footer }) {
  const btn = ctaLabel && ctaUrl
    ? `<p style="margin:28px 0"><a href="${escape(ctaUrl)}" style="background:#3B82F6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;display:inline-block">${escape(ctaLabel)}</a></p>`
    : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head>
<body style="margin:0;background:#F3F4F6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1F2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#3B82F6,#8B5CF6);padding:22px 28px;color:#fff;font-size:20px;font-weight:700;letter-spacing:-.2px">Alternativa</td></tr>
<tr><td style="padding:28px">
<h1 style="font-size:20px;margin:0 0 12px">${escape(title)}</h1>
${intro ? `<p style="margin:0 0 12px;line-height:1.55">${escape(intro)}</p>` : ''}
${body}
${btn}
<p style="font-size:12px;color:#6B7280;margin-top:28px;line-height:1.5">${escape(footer || 'Recibís este email porque tenés una cuenta en Alternativa. Podés ajustar tus notificaciones desde Configuración.')}</p>
</td></tr></table></td></tr></table></body></html>`;
}

function htmlToText(html) {
  return String(html).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<br\s*\/?>/g, '\n').replace(/<\/p>/g, '\n\n')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

async function sendEmail({ to, subject, html, text, replyTo }) {
  const provider = config.email.provider;
  const plain = text || htmlToText(html);
  if (provider === 'resend') {
    if (!config.email.resendApiKey) throw new Error('Falta RESEND_API_KEY');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.email.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.email.from, to: [to], subject, html, text: plain, reply_to: replyTo }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Resend ${res.status}: ${detail.slice(0, 300)}`);
    }
    return { ok: true };
  }
  // console: útil en desarrollo; muestra enlaces de verificación/restablecimiento en logs
  logger.info('EMAIL (console)', { to, subject, text: plain.slice(0, 2000) });
  return { ok: true, simulated: true };
}

module.exports = { sendEmail, layout, htmlToText };
