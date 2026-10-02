/*
 * Solicitud de verificación de identidad (documento privado + revisión de administración).
 * Campos: id, especialistaId, usuarioId, tipo (identidad | reclamo), documentos[ids Multimedia],
 *         documentoUltimos4 (nunca el número completo), notas, estado (pendiente | aprobada | rechazada),
 *         revision {fecha, nota, por}
 */
const Modelo = require("./Modelo");

class Verificacion extends Modelo {
  static coleccion = "verificaciones";
  static prefijo = "v";
  static ESTADOS = { pendiente: "Pendiente", aprobada: "Aprobada", rechazada: "Rechazada" };
}

module.exports = Verificacion;
