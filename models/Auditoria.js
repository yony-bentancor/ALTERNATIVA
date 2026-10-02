/*
 * Auditoría de acciones sensibles: quién, qué, cuándo, valor anterior y nuevo.
 * Solo inserción: no hay edición ni borrado desde la aplicación.
 * Campos: id, actorId, rol, actor (nombre), accion (ej. reserva.cancelar), entidad, entidadId, resumen,
 *         antes, despues, ip, severidad (info | aviso | seguridad)
 */
const Modelo = require("./Modelo");

class Auditoria extends Modelo {
  static coleccion = "auditoria";
  static prefijo = "au";

  static async registrar(req, { accion, entidad, entidadId, resumen, antes, despues, severidad = "info" }) {
    const u = req?.usuario;
    return this.crear({
      actorId: u?.id || null, rol: u?.rol || "sistema", actor: u?.nombre || "Sistema",
      accion, entidad, entidadId, resumen, antes, despues, ip: req?.ip, severidad,
    });
  }
}

module.exports = Auditoria;
