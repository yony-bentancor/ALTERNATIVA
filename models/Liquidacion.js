/*
 * Liquidación: agrupa pagos de un período (solo modelos "plataforma" y "offline").
 * - plataforma: Alternativa le transfiere al especialista el neto (direccion: al_especialista).
 * - offline: el especialista le debe la comisión a Alternativa (direccion: a_plataforma).
 * Campos: id, numero, especialistaId, direccion, desde, hasta, pagos[ids], reservas, bruto, comision,
 *         reembolsos, neto, estado (pendiente | pagada | anulada), referencia, pagadaEn, pagadaPor, notas, creadaPor
 */
const Modelo = require("./Modelo");

class Liquidacion extends Modelo {
  static coleccion = "liquidaciones";
  static prefijo = "l";
  static ESTADOS = { pendiente: "Pendiente", pagada: "Pagada", anulada: "Anulada" };
}

module.exports = Liquidacion;
