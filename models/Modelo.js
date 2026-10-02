/*
 * Modelo base. Todos los modelos heredan estos métodos.
 * Son asíncronos para que el cambio a MongoDB/Mongoose no obligue a tocar los controladores.
 */
const store = require("../config/store");

const ahoraISO = () => new Date().toISOString();

class Modelo {
  static coleccion = "";
  static prefijo = "x";

  static _datos() { return store.coleccion(this.coleccion); }

  /** Lista todos los documentos, opcionalmente filtrados con una función. */
  static async todos(filtro) {
    const d = this._datos();
    return filtro ? d.filter(filtro) : d.slice();
  }

  static async uno(filtro) { return this._datos().find(filtro) || null; }

  static async porId(id) {
    if (!id) return null;
    return this._datos().find((x) => x.id === id) || null;
  }

  /** Varios documentos por id, en un Map (útil para "unir" colecciones). */
  static async mapaPorIds(ids) {
    const set = new Set((ids || []).filter(Boolean));
    return new Map(this._datos().filter((x) => set.has(x.id)).map((x) => [x.id, x]));
  }

  static async contar(filtro) { return filtro ? this._datos().filter(filtro).length : this._datos().length; }

  static async crear(datos) {
    const doc = { id: store.nuevoId(this.prefijo), creado: ahoraISO(), ...datos };
    this._datos().push(doc);
    store.guardar();
    return doc;
  }

  static async actualizar(id, cambios) {
    const doc = await this.porId(id);
    if (!doc) return null;
    Object.assign(doc, cambios, { actualizado: ahoraISO() });
    store.guardar();
    return doc;
  }

  /** Guarda un documento que se modificó directamente. */
  static async guardar(doc) {
    if (doc) doc.actualizado = ahoraISO();
    store.guardar();
    return doc;
  }

  static async eliminar(id) {
    const d = this._datos();
    const i = d.findIndex((x) => x.id === id);
    if (i === -1) return false;
    d.splice(i, 1);
    store.guardar();
    return true;
  }

  static async eliminarVarios(filtro) {
    const d = this._datos();
    let n = 0;
    for (let i = d.length - 1; i >= 0; i--) if (filtro(d[i])) { d.splice(i, 1); n++; }
    if (n) store.guardar();
    return n;
  }
}

/** Ordena por un campo (fecha ISO, número o texto). desc = más nuevo primero. */
Modelo.ordenar = (lista, campo, desc = true) => {
  const val = typeof campo === "function" ? campo : (x) => x[campo];
  return lista.sort((a, b) => {
    const va = val(a); const vb = val(b);
    if (va === vb) return 0;
    if (va === undefined || va === null) return 1;
    if (vb === undefined || vb === null) return -1;
    return (va > vb ? 1 : -1) * (desc ? -1 : 1);
  });
};

/** Pagina una lista ya filtrada. */
Modelo.paginar = (lista, pagina, porPagina = 20) => {
  const total = lista.length;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const p = Math.min(Math.max(1, parseInt(pagina, 10) || 1), paginas);
  return { items: lista.slice((p - 1) * porPagina, p * porPagina), total, pagina: p, paginas };
};

module.exports = Modelo;
