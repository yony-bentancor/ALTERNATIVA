/*
 * Servicio: cada servicio es una entidad propia, con su propia reputación.
 * Campos: id, especialistaId, categoriaId, slug, titulo, resumen, descripcion, incluye[], preparacion,
 *         precio (lo que quiere recibir el especialista, en pesos enteros), moneda, duracion (minutos),
 *         modalidades[], recargoDomicilio, anticipacionMax, fotos[urls],
 *         estado (activo | pausado | en_revision | suspendido), motivoEstado, orden,
 *         rating {prom, cant, suma, ponderado (bayesiano, interno), distribucion[1★..5★]},
 *         stats {vistas, reservas, realizadas}
 */
const Modelo = require("./Modelo");

const ESTADOS = { activo: "Publicado", pausado: "Pausado", en_revision: "En revisión", suspendido: "Suspendido" };

class Servicio extends Modelo {
  static coleccion = "servicios";
  static prefijo = "s";
  static ESTADOS = ESTADOS;

  static async deEspecialista(especialistaId, soloActivos = false) {
    const l = await this.todos((s) => s.especialistaId === especialistaId && (!soloActivos || s.estado === "activo"));
    return l.sort((a, b) => (a.orden || 0) - (b.orden || 0));
  }

  static async porSlugs(espSlug, slug) {
    const Especialista = require("./Especialista");
    const e = await Especialista.porSlug(espSlug);
    if (!e) return { especialista: null, servicio: null };
    const s = await this.uno((x) => x.especialistaId === e.id && x.slug === slug);
    return { especialista: e, servicio: s };
  }

  static url(servicio, especialista) { return `/servicios/${especialista.slug}/${servicio.slug}`; }
}

module.exports = Servicio;
