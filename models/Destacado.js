/*
 * Destacado (exposición paga). El dinero compra exposición, nunca reputación:
 * se muestra separado y marcado "Patrocinado"; no altera estrellas ni el orden orgánico.
 * Campos: id, especialistaId, servicioId, tipo (inicio | categoria | zona | busqueda | recomendacion),
 *         categoriaId, departamento, palabras[], desde, hasta, precio, estadoPago (pendiente | pagado | bonificado),
 *         estado (programado | activo | pausado | terminado | cancelado), impresiones, clics, notas
 */
const Modelo = require("./Modelo");

class Destacado extends Modelo {
  static coleccion = "destacados";
  static prefijo = "d";
  static TIPOS = { inicio: "Inicio", categoria: "Categoría", zona: "Zona", busqueda: "Búsqueda", recomendacion: "Recomendados" };
  static ESTADOS = { programado: "Programado", activo: "Activo", pausado: "Pausado", terminado: "Terminado", cancelado: "Cancelado" };

  static vigente(d, ahora = new Date()) {
    return d.estado === "activo" && new Date(d.desde) <= ahora && new Date(d.hasta) >= ahora;
  }
}

module.exports = Destacado;
