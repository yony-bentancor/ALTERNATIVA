/*
 * Pago de una reserva. Alternativa nunca guarda datos de tarjeta: solo el ID de la pasarela.
 * Campos: id, reservaId, usuarioId, especialistaId, proveedor (mercadopago | simulado | offline | manual),
 *         modeloCobro (split | plataforma | offline), preferenciaId, idPasarela, urlCheckout,
 *         monto, moneda, comision, montoEspecialista, comisionPasarela (real), comisionPasarelaEstimada,
 *         comisionMarketplace, cobradorId, reembolsado, estado (ver ESTADOS),
 *         contracargo {id, estado, monto, fecha}, sincronizado, detalle, medio, pagadoEn,
 *         liquidacion {estado (pendiente | incluida | liquidada | no_aplica), liquidacionId, fecha},
 *         eventos [{fecha, tipo, datos}]
 */
const Modelo = require("./Modelo");

const ESTADOS = {
  pendiente: "Pendiente", aprobado: "Aprobado", rechazado: "Rechazado", cancelado: "Cancelado",
  reembolsado: "Reembolsado", reembolso_parcial: "Reembolso parcial", a_cobrar: "A cobrar por el especialista",
  contracargo: "Contracargo", en_disputa: "En disputa",
};

class Pago extends Modelo {
  static coleccion = "pagos";
  static prefijo = "p";
  static ESTADOS = ESTADOS;

  static async evento(pago, tipo, datos) {
    pago.eventos = pago.eventos || [];
    pago.eventos.push({ fecha: new Date().toISOString(), tipo, datos });
    return this.guardar(pago);
  }
}

module.exports = Pago;
