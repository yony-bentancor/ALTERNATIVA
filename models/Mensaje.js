/*
 * Mensaje dentro de una conversación. El texto original se conserva para auditoría;
 * los datos de contacto se ocultan al mostrarlo según la política configurada.
 * Campos: id, conversacionId, autorId, rolAutor (usuario | especialista | admin | sistema), texto,
 *         tieneContacto, reservaId, leido (fecha), marcado
 */
const Modelo = require("./Modelo");

class Mensaje extends Modelo {
  static coleccion = "mensajes";
  static prefijo = "ms";

  static async deConversacion(conversacionId) {
    const l = await this.todos((m) => m.conversacionId === conversacionId);
    return Modelo.ordenar(l, "creado", false);
  }
}

module.exports = Mensaje;
