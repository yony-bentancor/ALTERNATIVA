/*
 * Contenido editable: artículos del blog, preguntas frecuentes y páginas institucionales/legales.
 * Campos: id, tipo (articulo | faq | pagina), slug, titulo, resumen, cuerpo (markdown simple), portada (url),
 *         categoria (del blog o sección del FAQ), publico (todos | usuarios | especialistas), etiquetas[],
 *         estado (borrador | publicado), publicado (fecha), orden, seo {titulo, descripcion}, autorId
 */
const Modelo = require("./Modelo");

class Contenido extends Modelo {
  static coleccion = "contenidos";
  static prefijo = "ct";
  static TIPOS = { articulo: "Artículo del blog", faq: "Pregunta frecuente", pagina: "Página" };

  static async publicados(tipo) {
    const l = await this.todos((c) => c.tipo === tipo && c.estado === "publicado");
    return tipo === "articulo" ? Modelo.ordenar(l, "publicado") : l.sort((a, b) => (a.orden || 0) - (b.orden || 0));
  }

  static async pagina(slug) { return this.uno((c) => c.tipo === "pagina" && c.slug === slug && c.estado === "publicado"); }
}

module.exports = Contenido;
