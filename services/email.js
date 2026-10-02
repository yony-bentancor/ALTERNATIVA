/* Envío de emails: "consola" (se imprime en los logs, para pruebas) o Resend (producción). */
const config = require("../config");
const { esc } = require("./util");

/** Plantilla HTML de los emails de Alternativa. */
function plantilla({ titulo, intro, cuerpo = "", boton, url, pie }) {
  const btn = boton && url
    ? `<p style="margin:28px 0"><a href="${esc(url)}" style="background:#3B82F6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;display:inline-block">${esc(boton)}</a></p>`
    : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title></head>
<body style="margin:0;background:#F3F4F6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1F2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#3B82F6,#8B5CF6);padding:22px 28px;color:#fff;font-size:20px;font-weight:700">Alternativa</td></tr>
<tr><td style="padding:28px"><h1 style="font-size:20px;margin:0 0 12px">${esc(titulo)}</h1>
${intro ? `<p style="margin:0 0 12px;line-height:1.55">${esc(intro)}</p>` : ""}${cuerpo}${btn}
<p style="font-size:12px;color:#6B7280;margin-top:28px;line-height:1.5">${esc(pie || "Recibís este email porque tenés una cuenta en Alternativa. Podés ajustar tus avisos desde Configuración.")}</p>
</td></tr></table></td></tr></table></body></html>`;
}

const aTexto = (html) => String(html).replace(/<br\s*\/?>/g, "\n").replace(/<\/p>/g, "\n\n").replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();

/** Últimos emails "enviados" en modo consola (se ven en Administración → Avisos). */
const bandejaDemo = [];

async function enviarEmail({ para, asunto, html }) {
  if (config.email.proveedor === "resend") {
    if (!config.email.resendApiKey) throw new Error("Falta RESEND_API_KEY");
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.email.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.email.remitente, to: [para], subject: asunto, html, text: aTexto(html) }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
    return { ok: true };
  }
  bandejaDemo.unshift({ fecha: new Date().toISOString(), para, asunto, texto: aTexto(html).slice(0, 1200) });
  bandejaDemo.length = Math.min(bandejaDemo.length, 50);
  if (process.env.NODE_ENV !== "test") console.log(`[email] Para: ${para} · ${asunto}`);
  return { ok: true, simulado: true };
}

module.exports = { plantilla, enviarEmail, aTexto, bandejaDemo };
