/*
 * Reembolso (total o parcial) de un pago.
 * Campos: id, reservaId, pagoId, usuarioId, especialistaId, monto, porcentaje,
 *         comisionRevertida, especialistaRevertido, motivo, regla, iniciadoPor, rolIniciador,
 *         estado (pendiente | procesado | fallido | manual), idPasarela, error, procesadoEn
 */
const Modelo = require("./Modelo");

class Reembolso extends Modelo {
  static coleccion = "reembolsos";
  static prefijo = "rb";
  static ESTADOS = { pendiente: "Pendiente", procesado: "Procesado", fallido: "Fallido", manual: "Gestión manual" };
}

module.exports = Reembolso;
