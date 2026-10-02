/*
 * Pasarela simulada para desarrollo y pruebas: permite recorrer el circuito completo
 * (aprobación, rechazo, reembolso) sin dinero real. Bloqueada en producción (APP_ENV=production).
 */
const crypto = require("crypto");
const config = require("../../config");

module.exports = {
  nombre: "simulado",

  async crearCheckout({ pago }) {
    if (config.enVivo) throw new Error("La pasarela simulada no está disponible en producción.");
    return { urlCheckout: `/pago/simulado/${pago.id}`, preferenciaId: `SIM-PREF-${pago.id}` };
  },

  // El "pago" se crea al aprobar/rechazar desde la pantalla de prueba: el id lleva el estado (SIM:approved:xxxx).
  async consultarPago(id, { pago } = {}) {
    const [, status] = String(id).split(":");
    const monto = pago?.monto || 0;
    return {
      id, status: status || "approved", statusDetail: status === "rejected" ? "cc_rejected_insufficient_amount" : "accredited", amount: monto,
      providerFee: status === "approved" ? Math.round(monto * 0.0609) : 0, marketplaceFee: pago?.comisionMarketplace || 0,
      method: "credit_card", externalReference: pago?.id || null, paidAt: status === "approved" ? new Date() : null,
    };
  },

  async reembolsar({ monto }) { return { id: `SIM-REF-${crypto.randomBytes(4).toString("hex")}`, monto, estado: "approved" }; },
  async buscarPorReferencia() { return null; },
  verificarWebhook() { return true; },
};
