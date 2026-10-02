/*
 * Especialista: la ficha pública de quien ofrece servicios.
 * Campos: id, usuarioId (vacío si lo cargó administración y aún no lo reclamó), slug, nombre, titular, bio,
 *         experiencia, anios, formacion, idiomas[], telefono (privado), whatsapp (privado), mostrarWhatsapp,
 *         categorias[ids], modalidades[] (presencial | domicilio | online),
 *         ubicacion {departamento, ciudad, barrio, direccion (privada), referencia, lat, lng, radioKm},
 *         avatar (url), portada (url), video (url), redes {instagram, web},
 *         diseno {variante (clasica | serena | luminosa), orden[], servicioDestacado, videoPrimero},
 *         estado (borrador | en_revision | activo | suspendido | inactivo), motivoEstado,
 *         verificacion {estado (ninguna | pendiente | verificada | rechazada), fecha, nota},
 *         reclamo {estado (propio | sin_reclamar | invitado | reclamado), tokenHash, email, invitado, vence, reclamado},
 *         cambiosPendientes [{campo, valor, fecha}], ajustes {autoConfirmar, permitirReprogramar},
 *         comision (null = usa las reglas generales),
 *         facturacion {razonSocial, rut, tipo, metodo, banco, titular, cuenta, tipoCuenta, email},
 *         mercadopago {usuarioMp, tokenCifrado, refreshCifrado, publicKey, vence, conectado, simulado},
 *         stats {rating, resenas, realizadas, recurrentes, respuestaMin},
 *         plan (gratis | profesional), planVence, publicado, creadoPor
 */
const Modelo = require("./Modelo");

const ESTADOS = { borrador: "Borrador", en_revision: "En revisión", activo: "Activo", suspendido: "Suspendido", inactivo: "Desactivado" };

class Especialista extends Modelo {
  static coleccion = "especialistas";
  static prefijo = "e";
  static ESTADOS = ESTADOS;

  static async porSlug(slug) { return this.uno((e) => e.slug === String(slug || "").toLowerCase()); }
  static async deUsuario(usuarioId) { return usuarioId ? this.uno((e) => e.usuarioId === usuarioId) : null; }
  static async activos() { return this.todos((e) => e.estado === "activo" && !e.eliminado); }

  static verificado(e) { return e?.verificacion?.estado === "verificada"; }
  static pagosHabilitados(e) { return !!e?.mercadopago?.conectado; }
  /** Recibe reservas online: tiene dueño, está activo y (si corresponde) cobra en línea. */
  static reservable(e) { return !!e && !!e.usuarioId && e.estado === "activo"; }
}

module.exports = Especialista;
