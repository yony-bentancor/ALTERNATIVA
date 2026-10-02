/*
 * Conversación usuario ↔ especialista (una por par).
 * Campos: id, usuarioId, especialistaId, usuarioEspecialistaId, reservaId, ultimoMensaje (fecha),
 *         vistaPrevia, sinLeerUsuario, sinLeerEspecialista, estado (abierta | bloqueada | archivada), bloqueadaPor
 */
const Modelo = require("./Modelo");

class Conversacion extends Modelo {
  static coleccion = "conversaciones";
  static prefijo = "cv";

  static async entre(usuarioId, especialistaId) {
    return this.uno((c) => c.usuarioId === usuarioId && c.especialistaId === especialistaId);
  }
}

module.exports = Conversacion;
