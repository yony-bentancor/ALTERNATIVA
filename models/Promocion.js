/*
 * Promoción de un especialista (descuento sobre sus servicios) o institucional (sin especialista).
 * Campos: id, especialistaId (vacío = institucional), servicios[] (vacío = todos), titulo, descripcion,
 *         descuento (%), financia (especialista | plataforma), publico (todos | nuevos | recurrentes),
 *         codigo, desde, hasta, maxUsos (0 = ilimitado), usos, estado (activa | pausada | terminada | en_revision)
 */
const Modelo = require("./Modelo");

class Promocion extends Modelo {
  static coleccion = "promociones";
  static prefijo = "pr";
  static ESTADOS = { activa: "Activa", pausada: "Pausada", terminada: "Terminada", en_revision: "En revisión" };
  static PUBLICOS = { todos: "Todos", nuevos: "Clientes nuevos", recurrentes: "Clientes recurrentes" };

  static vigente(p, ahora = new Date()) {
    return p.estado === "activa" && (!p.desde || new Date(p.desde) <= ahora) && (!p.hasta || new Date(p.hasta) >= ahora) && (!p.maxUsos || (p.usos || 0) < p.maxUsos);
  }
}

module.exports = Promocion;
