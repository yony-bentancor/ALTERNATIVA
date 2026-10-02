'use strict';
// Pasarela simulada para desarrollo y staging: permite probar el circuito completo
// (aprobación, rechazo, reembolso) sin dinero real. Bloqueada en producción (APP_ENV=production).
const crypto = require('crypto');
const config = require('../../config');

module.exports = {
  name: 'simulated',
  supportsSplit: true,

  async createCheckout({ payment }) {
    if (config.isLive) throw new Error('La pasarela simulada no está disponible en producción.');
    return { checkoutUrl: `/pago/simulado/${payment._id}`, preferenceId: `SIM-PREF-${payment._id}` };
  },

  // En el simulador el "pago" se crea al aprobar/rechazar desde la pantalla de prueba.
  async fetchPayment(providerPaymentId, { payment } = {}) {
    const [, status] = String(providerPaymentId).split(':');
    const amount = payment?.amount || 0;
    const fee = Math.round(amount * 0.0609);
    return {
      id: providerPaymentId,
      status: status || 'approved',
      statusDetail: status === 'rejected' ? 'cc_rejected_insufficient_amount' : 'accredited',
      amount,
      providerFee: status === 'approved' ? fee : 0,
      marketplaceFee: payment?.marketplaceFee || 0,
      method: 'credit_card',
      externalReference: payment ? String(payment._id) : null,
      paidAt: status === 'approved' ? new Date() : null,
    };
  },

  async refund({ amount }) {
    return { id: `SIM-REF-${crypto.randomBytes(4).toString('hex')}`, amount, status: 'approved' };
  },

  async searchByReference() { return null; },

  verifyWebhook() { return true; },
};
