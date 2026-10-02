/*
 * Reseña verificada: solo existe si hubo una reserva realizada (una reseña por reserva).
 * Campos: id, reservaId, servicioId, especialistaId, usuarioId, autor ("Ana M."), puntaje (1-5), comentario,
 *         fechaServicio, estado (publicada | en_revision | oculta), moderacion {fecha, motivo, por},
 *         respuesta {texto, fecha}, pedidoRevision {motivo, detalle, fecha, resuelto, resolucion}, editada, util
 */
const Modelo = require("./Modelo");

class Resena extends Modelo {
  static coleccion = "resenas";
  static prefijo = "re";
  static ESTADOS = { publicada: "Publicada", en_revision: "En revisión", oculta: "Oculta" };

  static async visiblesDeServicio(servicioId) {
    const l = await this.todos((r) => r.servicioId === servicioId && r.estado !== "oculta");
    return Modelo.ordenar(l, "creado");
  }

  static async visiblesDeEspecialista(especialistaId) {
    const l = await this.todos((r) => r.especialistaId === especialistaId && r.estado !== "oculta");
    return Modelo.ordenar(l, "creado");
  }
}

module.exports = Resena;
