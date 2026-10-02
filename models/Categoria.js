/*
 * Categoría de servicios (Masajes, Reiki, Yoga…).
 * Campos: id, nombre, slug, descripcion, descripcionLarga (texto SEO), icono, color, imagen (url),
 *         estado (activa | pendiente | oculta), propuestaPor (usuarioId), orden, destacada,
 *         seo {titulo, descripcion}
 */
const Modelo = require("./Modelo");

class Categoria extends Modelo {
  static coleccion = "categorias";
  static prefijo = "c";

  static async activas() {
    const l = await this.todos((c) => c.estado === "activa");
    return l.sort((a, b) => (b.destacada ? 1 : 0) - (a.destacada ? 1 : 0) || (a.orden || 0) - (b.orden || 0) || a.nombre.localeCompare(b.nombre));
  }

  static async porSlug(slug) { return this.uno((c) => c.slug === String(slug || "").toLowerCase()); }
}

module.exports = Categoria;
