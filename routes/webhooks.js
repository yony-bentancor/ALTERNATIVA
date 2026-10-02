/* Webhooks de la pasarela de pagos (sin sesión: se autentican por firma). */
const router = require("express").Router();
const { procesarWebhook } = require("../services/pagos");

router.post("/mercadopago", async (req, res) => {
  try {
    const r = await procesarWebhook("mercadopago", req);
    res.status(r.estado || 200).json(r);
  } catch (e) {
    console.error("Webhook Mercado Pago:", e.message);
    // 500: Mercado Pago reintenta más tarde.
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
