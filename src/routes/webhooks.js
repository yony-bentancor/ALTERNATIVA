'use strict';
const express = require('express');
const logger = require('../lib/logger');
const payments = require('../services/payments');

const router = express.Router();

// Mercado Pago notifica pagos y contracargos. Se responde 200 rápido; si algo falla,
// devolvemos 500 para que la pasarela reintente (el procesamiento es idempotente).
router.post('/mercadopago', async (req, res) => {
  try {
    const result = await payments.handleWebhook('mercadopago', req);
    if (!result.ok) return res.status(result.status || 400).json({ ok: false });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('Webhook Mercado Pago', { err, query: req.query });
    return res.status(500).json({ ok: false });
  }
});

module.exports = router;
