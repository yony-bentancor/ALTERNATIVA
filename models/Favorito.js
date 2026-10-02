/*
 * Favorito de un usuario (un especialista o un servicio).
 * Campos: id, usuarioId, tipo (especialista | servicio), especialistaId, servicioId
 */
const Modelo = require("./Modelo");

class Favorito extends Modelo {
  static coleccion = "favoritos";
  static prefijo = "f";

  /** Conjunto de ids (servicios y especialistas) guardados por el usuario. */
  static async idsDe(usuarioId) {
    if (!usuarioId) return new Set();
    const l = await this.todos((f) => f.usuarioId === usuarioId);
    return new Set(l.map((f) => (f.tipo === "servicio" ? f.servicioId : f.especialistaId)));
  }
}

module.exports = Favorito;
