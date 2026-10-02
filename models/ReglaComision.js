/*
 * Regla de comisión configurable sin tocar código.
 * Precedencia (de mayor a menor): promoción vigente → especialista → categoría → general (Config).
 * Campos: id, nombre, alcance (promocion | especialista | categoria), tasa (%), especialistaId, categoriaId,
 *         especialistas[] y categorias[] (para promociones; vacío = todos), desde, hasta, activa, creadaPor
 */
const Modelo = require("./Modelo");

class ReglaComision extends Modelo {
  static coleccion = "reglasComision";
  static prefijo = "rc";
  static ALCANCES = { promocion: "Promoción", especialista: "Especialista", categoria: "Categoría" };

  static async activas() { return this.todos((r) => r.activa !== false); }
}

module.exports = ReglaComision;
