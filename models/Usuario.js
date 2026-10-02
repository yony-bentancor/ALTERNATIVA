/*
 * Usuario: cualquier persona que ingresa al sistema.
 * Campos: id, nombre, email, clave (hash), rol (usuario | especialista | admin), telefono, avatar (url),
 *         estado (activo | suspendido | eliminado), suspension {motivo, fecha},
 *         emailVerificado, tokenVerificar {hash, vence}, tokenRestablecer {hash, vence},
 *         especialistaId (si ofrece servicios), ubicacion {departamento, ciudad, barrio},
 *         preferencias {avisos {email, push, whatsapp, marketing}, ultimaModalidad, direccionDomicilio},
 *         privacidad {soloNombre, compartirContacto},
 *         metodosPago [{id, etiqueta, marca, ultimos4, predeterminado}]  (solo referencias, nunca la tarjeta),
 *         intentosFallidos, bloqueadoHasta, ultimoIngreso, aceptoTerminos, eliminado,
 *         prueba (texto: si es un usuario de prueba, qué rol muestra en el ingreso)
 */
const Modelo = require("./Modelo");
const { verificarClave } = require("../services/claves");

const ROLES = { usuario: "Usuario", especialista: "Especialista", admin: "Administración" };

class Usuario extends Modelo {
  static coleccion = "usuarios";
  static prefijo = "u";
  static ROLES = ROLES;

  static async porEmail(email) {
    const e = String(email || "").trim().toLowerCase();
    return this.uno((u) => u.email.toLowerCase() === e);
  }

  /** Devuelve el usuario si la clave es correcta (y maneja el bloqueo por intentos fallidos). */
  static async autenticar(email, clave) {
    const u = await this.porEmail(email);
    if (!u || u.estado === "eliminado") return { error: "credenciales" };
    if (u.bloqueadoHasta && new Date(u.bloqueadoHasta) > new Date()) return { error: "bloqueado" };
    if (!verificarClave(clave, u.clave)) {
      u.intentosFallidos = (u.intentosFallidos || 0) + 1;
      if (u.intentosFallidos >= 8) { u.bloqueadoHasta = new Date(Date.now() + 15 * 60000).toISOString(); u.intentosFallidos = 0; }
      await this.guardar(u);
      return { error: "credenciales" };
    }
    if (u.estado === "suspendido") return { error: "suspendido", usuario: u };
    u.intentosFallidos = 0;
    u.bloqueadoHasta = null;
    return { usuario: u };
  }

  static async admins() { return this.todos((u) => u.rol === "admin" && u.estado === "activo"); }

  static primerNombre(u) { return u ? String(u.nombre || "").split(" ")[0] : ""; }

  /** Nombre visible para otros: "Ana M." por privacidad. */
  static nombrePublico(u) {
    const p = String(u?.nombre || "").trim().split(/\s+/);
    if (p.length < 2) return p[0] || "Usuario";
    return `${p[0]} ${p[p.length - 1][0]}.`;
  }

  static iniciales(u) {
    return String(u?.nombre || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
  }

  /** Datos del usuario sin la clave ni tokens, para mostrar en las vistas. */
  static publico(u) {
    if (!u) return null;
    const { clave, tokenVerificar, tokenRestablecer, ...resto } = u;
    return resto;
  }
}

module.exports = Usuario;
