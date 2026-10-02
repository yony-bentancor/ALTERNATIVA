/*
 * Reserva. Guarda una FOTOGRAFÍA (foto) de los datos contractuales al momento de reservar
 * (precio, comisión, duración, nombres, política de cancelación) para que cambios posteriores
 * no alteren el histórico.
 * Campos: id, codigo, usuarioId, especialistaId, servicioId,
 *         foto {servicio, servicioSlug, categoria, especialista, especialistaSlug, usuario, precio, recargo,
 *               subtotal, descuento, promocionId, promocion, total, moneda, modoTarifa, tasa, regla, comision,
 *               netoEspecialista, procesadorPct, procesadorPaga, procesadorEstimado, recibeEspecialista,
 *               netoPlataforma, comisionMarketplace, duracion, modeloCobro, politica},
 *         inicio, fin (ISO), modalidad (presencial | domicilio | online),
 *         lugar {direccion, referencia, lat, lng, enlaceOnline}, notasUsuario, notasEspecialista (privadas),
 *         estado (ver ESTADOS), historial [{estado, fecha, por, rol, nota}], pagoId, vencePago,
 *         cancelacion {por, rol, motivo, fecha, porcentaje, monto, regla},
 *         reprogramadaDesde, reprogramadaA, reprogramaciones, volverDe, primeraVez,
 *         recordatorios {diaAntes, horaAntes}, pedidoResena, resenada, realizadaEn,
 *         incidencia {abierta, nota, fecha}, origen
 */
const Modelo = require("./Modelo");

const ESTADOS = {
  pendiente: { texto: "Pendiente de pago", tono: "warn" },
  pagada: { texto: "Pagada", tono: "info" },
  confirmada: { texto: "Confirmada", tono: "ok" },
  realizada: { texto: "Realizada", tono: "done" },
  cancelada_usuario: { texto: "Cancelada por el usuario", tono: "muted" },
  cancelada_especialista: { texto: "Cancelada por el especialista", tono: "muted" },
  reprogramada: { texto: "Reprogramada", tono: "muted" },
  ausencia_usuario: { texto: "Ausencia del usuario", tono: "danger" },
  ausencia_especialista: { texto: "Ausencia del especialista", tono: "danger" },
  reembolsada: { texto: "Reembolsada", tono: "muted" },
  vencida: { texto: "Vencida sin pago", tono: "muted" },
};
const ACTIVAS = ["pendiente", "pagada", "confirmada"];
const PASADAS = ["realizada", "ausencia_usuario", "ausencia_especialista"];
const CANCELADAS = ["cancelada_usuario", "cancelada_especialista", "reembolsada", "vencida", "reprogramada"];

class Reserva extends Modelo {
  static coleccion = "reservas";
  static prefijo = "r";
  static ESTADOS = ESTADOS;
  static ACTIVAS = ACTIVAS;
  static PASADAS = PASADAS;
  static CANCELADAS = CANCELADAS;

  static async porCodigo(codigo) { return this.uno((r) => r.codigo === String(codigo || "").toUpperCase()); }

  /** Ocupa agenda: pagadas/confirmadas, y pendientes mientras no vence el plazo de pago. */
  static ocupa(r, ahora = new Date()) {
    if (r.estado === "pagada" || r.estado === "confirmada") return true;
    return r.estado === "pendiente" && r.vencePago && new Date(r.vencePago) > ahora;
  }

  static proxima(r, ahora = new Date()) { return ACTIVAS.includes(r.estado) && new Date(r.inicio) > ahora; }
}

module.exports = Reserva;
