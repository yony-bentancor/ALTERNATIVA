/*
 * Reservas: cotización, creación con validación de disponibilidad en el servidor,
 * bloqueo anti doble reserva, pago acreditado, confirmación, cancelación, reprogramación, ausencias y cierre.
 */
const F = require("./fechas");
const { codigoReserva, pesos, texto } = require("./util");
const { invalido, prohibido, noEncontrado, conflicto } = require("./errores");
const { comisionPara, desglose } = require("./comision");
const { evaluarCancelacion, puedeReprogramar, repartirReembolso } = require("./cancelacion");
const { horariosPara, proximoTurno } = require("./disponibilidad");
const { notificar, notificarAdmins } = require("./notificaciones");

const pagos = () => require("./pagos");
const ahoraISO = () => new Date().toISOString();

/*
 * Anti doble reserva: las operaciones que ocupan agenda de un mismo especialista se ejecutan
 * de a una (cola por especialista). Validar el horario y crear la reserva ocurre sin que otra
 * solicitud pueda meterse en el medio, aunque lleguen al mismo milisegundo.
 */
const colas = new Map();
function enCola(especialistaId, fn) {
  const anterior = colas.get(especialistaId) || Promise.resolve();
  const actual = anterior.then(fn, fn);
  colas.set(especialistaId, actual.catch(() => {}));
  return actual;
}

function historial(r, estado, { por, rol, nota } = {}) {
  r.historial = r.historial || [];
  r.historial.push({ estado, fecha: ahoraISO(), por: por || null, rol: rol || "sistema", nota: nota || "" });
}

// ── Promociones ──────────────────────────────────────────
async function mejorPromocion({ servicio, especialista, usuario, codigo, ahora = new Date() }) {
  const { Promocion, Reserva } = require("../models");
  const promos = await Promocion.todos((p) => Promocion.vigente(p, ahora) && (!p.especialistaId || p.especialistaId === especialista.id));
  let previas = null;
  const candidatas = [];
  for (const p of promos) {
    if (p.servicios?.length && !p.servicios.includes(servicio.id)) continue;
    if (p.codigo && (!codigo || p.codigo !== String(codigo).trim().toUpperCase())) continue;
    if (p.publico && p.publico !== "todos") {
      if (!usuario) continue;
      if (previas === null) previas = await Reserva.contar((r) => r.usuarioId === usuario.id && r.especialistaId === especialista.id && ["realizada", "confirmada", "pagada"].includes(r.estado));
      if (p.publico === "nuevos" && previas > 0) continue;
      if (p.publico === "recurrentes" && previas === 0) continue;
    }
    candidatas.push(p);
  }
  return candidatas.length ? candidatas.reduce((a, b) => (b.descuento > a.descuento ? b : a)) : null;
}

// ── Cotización ───────────────────────────────────────────
async function cotizar({ servicio, especialista, usuario, modalidad, codigo, ahora = new Date() }) {
  const { Config } = require("../models");
  const cfg = await Config.obtener();
  const comision = await comisionPara({ especialista, categoriaId: servicio.categoriaId, ahora });
  const promo = await mejorPromocion({ servicio, especialista, usuario, codigo, ahora });
  const recargo = modalidad === "domicilio" ? servicio.recargoDomicilio || 0 : 0;
  const d = desglose({
    precio: servicio.precio, recargo, descuentoPct: promo?.descuento || 0, financia: promo?.financia || "especialista",
    tasa: comision.tasa, modo: cfg.comision.modo, procesadorPct: cfg.pagos.comisionProcesador, procesadorPaga: cfg.pagos.procesadorPaga,
  });
  return { d, comision, promo, cfg, recargo };
}

/** Modelo de cobro efectivo para este especialista. */
function modeloCobro(cfg, especialista) {
  let m = cfg.pagos.modelo;
  if (m === "split" && !especialista.mercadopago?.conectado) {
    if (cfg.pagos.exigirCuentaVinculada) throw invalido("Este especialista todavía no habilitó los pagos en línea. Probá más tarde o escribile por mensaje.");
    m = "plataforma";
  }
  return m;
}

// ── Creación ─────────────────────────────────────────────
async function crearReserva(p) {
  const { Servicio, Especialista } = require("../models");
  const servicio = await Servicio.porId(p.servicioId);
  if (!servicio) throw noEncontrado("Este servicio no está disponible para reservar.");
  const especialista = await Especialista.porId(servicio.especialistaId);
  return enCola(servicio.especialistaId, () => crearReservaEnCola({ ...p, servicio, especialista }));
}

async function crearReservaEnCola({ usuario, servicio, especialista, fecha, hora, modalidad, direccion, notas, codigo, volverDe, ahora = new Date() }) {
  const { Categoria, Reserva, Promocion, Usuario, Pago } = require("../models");
  if (!F.fechaValida(fecha) || !F.horaValida(hora)) throw invalido("Fecha u hora no válida.");
  const categoria = await Categoria.porId(servicio.categoriaId);
  if (servicio.estado !== "activo" || categoria?.estado !== "activa") throw noEncontrado("Este servicio no está disponible para reservar.");
  if (!especialista || especialista.estado !== "activo") throw noEncontrado("Este especialista no está recibiendo reservas.");
  // Perfiles cargados por administración y aún no reclamados: se muestran, pero nadie gestionaría la reserva.
  if (!especialista.usuarioId) throw invalido("Este especialista todavía no activó su cuenta en Alternativa, así que no recibe reservas online. Podés guardarlo en favoritos.");
  if (especialista.usuarioId === usuario.id) throw invalido("No podés reservar tus propios servicios.");
  if (usuario.estado !== "activo") throw prohibido("Tu cuenta no puede hacer reservas en este momento.");

  const permitidas = servicio.modalidades?.length ? servicio.modalidades : especialista.modalidades;
  if (!permitidas.includes(modalidad)) throw invalido("Esa modalidad no está disponible para este servicio.");
  if (modalidad === "domicilio" && !String(direccion || "").trim()) throw invalido("Indicá la dirección para la atención a domicilio.");

  // Validación de disponibilidad en el servidor (lo que mostró la pantalla no alcanza).
  const turnos = await horariosPara({ especialistaId: especialista.id, servicio, fecha, ahora });
  const turno = turnos.find((t) => t.hora === hora);
  if (!turno) throw conflicto("Ese horario ya no está disponible. Elegí otro, por favor.", "horario_ocupado");

  const impagas = await Reserva.contar((r) => r.usuarioId === usuario.id && r.estado === "pendiente" && new Date(r.vencePago) > ahora);
  if (impagas >= 3) throw invalido("Tenés varias reservas sin pagar. Completá o cancelá alguna antes de reservar otra.");

  const { d, comision, promo, cfg, recargo } = await cotizar({ servicio, especialista, usuario, modalidad, codigo, ahora });
  const modelo = modeloCobro(cfg, especialista);
  const previas = await Reserva.contar((r) => r.usuarioId === usuario.id && r.especialistaId === especialista.id && ["realizada", "confirmada", "pagada"].includes(r.estado));
  const u = especialista.ubicacion || {};

  const r = await Reserva.crear({
    codigo: codigoReserva(), usuarioId: usuario.id, especialistaId: especialista.id, servicioId: servicio.id,
    foto: {
      servicio: servicio.titulo, servicioSlug: servicio.slug, categoria: categoria?.nombre, especialista: especialista.nombre, especialistaSlug: especialista.slug,
      usuario: usuario.nombre, precio: servicio.precio, recargo, subtotal: d.subtotal, descuento: d.descuento, promocionId: promo?.id || null, promocion: promo?.titulo || "",
      total: d.total, moneda: "UYU", modoTarifa: d.modo, tasa: comision.tasa, regla: comision.regla, comision: d.comision, netoEspecialista: d.netoEspecialista,
      procesadorPct: cfg.pagos.comisionProcesador, procesadorPaga: d.procesadorPaga, procesadorEstimado: d.procesador, recibeEspecialista: d.recibeEspecialista,
      netoPlataforma: d.netoPlataforma, comisionMarketplace: d.comisionMarketplace, duracion: servicio.duracion, modeloCobro: modelo, politica: cfg.cancelacion,
    },
    inicio: turno.inicio.toISOString(), fin: turno.fin.toISOString(), modalidad,
    lugar: modalidad === "domicilio" ? { direccion: texto(direccion, 300) }
      : modalidad === "presencial" ? { direccion: u.direccion || "", referencia: u.referencia || "", lat: u.lat, lng: u.lng }
        : { enlaceOnline: "" },
    notasUsuario: texto(notas, 1000), notasEspecialista: "", estado: "pendiente",
    vencePago: new Date(ahora.getTime() + cfg.pagos.minutosParaPagar * 60000).toISOString(),
    volverDe: volverDe || null, primeraVez: previas === 0, reprogramaciones: 0, resenada: false, incidencia: { abierta: false }, historial: [], origen: "web",
  });
  historial(r, "pendiente", { por: usuario.id, rol: "usuario", nota: "Reserva iniciada" });
  await Reserva.guardar(r);
  if (promo) { promo.usos = (promo.usos || 0) + 1; await Promocion.guardar(promo); }
  // Preferencias para "volver a reservar"
  const pref = { ...(usuario.preferencias || {}), ultimaModalidad: modalidad };
  if (modalidad === "domicilio") pref.direccionDomicilio = texto(direccion, 300);
  await Usuario.actualizar(usuario.id, { preferencias: pref });

  if (modelo === "offline") {
    const pago = await Pago.crear({ reservaId: r.id, usuarioId: usuario.id, especialistaId: especialista.id, proveedor: "offline", modeloCobro: modelo, monto: d.total, comision: d.comision, montoEspecialista: d.netoEspecialista, estado: "a_cobrar", reembolsado: 0, liquidacion: { estado: "pendiente" }, eventos: [{ fecha: ahoraISO(), tipo: "offline" }] });
    r.pagoId = pago.id;
    await marcarPagada(r, pago, { offline: true });
  }
  return r;
}

// ── Pago acreditado ──────────────────────────────────────
async function marcarPagada(r, pago, { offline = false } = {}) {
  const { Reserva, Especialista, Servicio } = require("../models");
  if (["pagada", "confirmada", "realizada"].includes(r.estado)) return r;
  if (r.estado !== "pendiente") {
    // El pago llegó tarde (reserva vencida o cancelada): si el horario sigue libre se recupera; si no, se reembolsa.
    const libre = r.estado === "vencida" && (await horariosPara({ especialistaId: r.especialistaId, servicio: { duracion: r.foto.duracion }, fecha: F.partes(r.inicio).fecha })).some((t) => t.inicio.toISOString() === r.inicio);
    if (!libre) {
      historial(r, r.estado, { nota: "Pago recibido fuera de término: se reembolsa" });
      await Reserva.guardar(r);
      const rep = { monto: pago.monto, comisionRevertida: pago.comision, especialistaRevertido: pago.monto - pago.comision };
      await pagos().reembolsar({ reserva: r, pago, rep, porcentaje: 100, motivo: "Pago fuera de término, horario no disponible", regla: "pago_tardio", rol: "sistema" });
      r.estado = "reembolsada";
      await Reserva.guardar(r);
      return r;
    }
  }
  const e = await Especialista.porId(r.especialistaId);
  r.estado = "pagada";
  r.pagoId = pago.id;
  historial(r, "pagada", { nota: offline ? "Pago a coordinar con el especialista" : "Pago acreditado" });
  if (e?.ajustes?.autoConfirmar !== false) { r.estado = "confirmada"; historial(r, "confirmada", { nota: "Confirmación automática" }); }
  r.vencePago = null;
  await Reserva.guardar(r);
  const s = await Servicio.porId(r.servicioId);
  if (s) { s.stats = s.stats || {}; s.stats.reservas = (s.stats.reservas || 0) + 1; await Servicio.guardar(s); }

  const cuando = F.fFechaHora(r.inicio);
  const conf = r.estado === "confirmada";
  await notificar(r.usuarioId, {
    tipo: "reserva_confirmada", titulo: conf ? "Reserva confirmada" : "Pago recibido",
    texto: conf ? `${r.foto.servicio} con ${r.foto.especialista}, ${cuando}.` : `Recibimos tu pago. ${r.foto.especialista} confirmará la reserva a la brevedad.`,
    enlace: `/mi/reservas/${r.id}`, boton: "Ver reserva",
  });
  if (e?.usuarioId) {
    await notificar(e.usuarioId, {
      tipo: "reserva_nueva", titulo: conf ? "Nueva reserva" : "Nueva reserva para confirmar",
      texto: `${r.foto.usuario} · ${r.foto.servicio} · ${cuando}. Te corresponden ${pesos(r.foto.netoEspecialista)}.`,
      enlace: `/panel/reservas/${r.id}`, boton: conf ? "Ver reserva" : "Confirmar reserva",
    });
  }
  return r;
}

async function confirmarPorEspecialista(r, actor) {
  const { Reserva } = require("../models");
  if (r.estado !== "pagada") throw invalido("Solo se pueden confirmar reservas pagadas.");
  r.estado = "confirmada";
  historial(r, "confirmada", { por: actor.id, rol: "especialista" });
  await Reserva.guardar(r);
  await notificar(r.usuarioId, { tipo: "reserva_confirmada", titulo: "Reserva confirmada", texto: `${r.foto.especialista} confirmó tu reserva del ${F.fFechaHora(r.inicio)}.`, enlace: `/mi/reservas/${r.id}` });
  return r;
}

// ── Cancelaciones y ausencias ────────────────────────────
// atribuirA: a quién se atribuye la cancelación cuando la registra administración ("usuario" | "especialista").
async function cancelar({ reserva: r, actor, rol, motivo = "", tipo = "cancelar", porcentajeManual = null, atribuirA = null, ahora = new Date() }) {
  const { Reserva, Pago, Especialista, Config } = require("../models");
  const cfg = await Config.obtener();
  const politica = { ...cfg.cancelacion, ...(r.foto.politica || {}) };
  if (tipo === "cancelar" && !["pendiente", "pagada", "confirmada"].includes(r.estado)) throw invalido("Esta reserva ya no se puede cancelar.");
  if (tipo !== "cancelar" && !["pagada", "confirmada", "realizada"].includes(r.estado)) throw invalido("No se puede registrar una ausencia para esta reserva.");
  if (tipo !== "cancelar" && new Date(r.inicio) > ahora) throw invalido("La ausencia se registra después del horario de inicio.");

  if (r.estado === "pendiente") {
    r.estado = rol === "especialista" ? "cancelada_especialista" : "cancelada_usuario";
    r.cancelacion = { por: actor?.id, rol, motivo, fecha: ahoraISO(), porcentaje: 0, monto: 0, regla: "impaga" };
    historial(r, r.estado, { por: actor?.id, rol, nota: "Cancelada antes del pago" });
    await Reserva.guardar(r);
    const pp = r.pagoId && (await Pago.porId(r.pagoId));
    if (pp && pp.estado === "pendiente") { pp.estado = "cancelado"; await Pago.guardar(pp); }
    return { reserva: r, reembolso: null };
  }

  const horasAntes = (new Date(r.inicio).getTime() - ahora.getTime()) / 3600000;
  const decision = evaluarCancelacion({ actor: rol, tipo, horasAntes, politica });
  const pct = porcentajeManual !== null && porcentajeManual !== undefined && porcentajeManual !== "" ? Math.max(0, Math.min(100, Number(porcentajeManual))) : decision.porcentaje;
  const quien = rol === "admin" ? atribuirA || "especialista" : rol;
  const estadoPorTipo = { cancelar: quien === "especialista" ? "cancelada_especialista" : "cancelada_usuario", ausencia_usuario: "ausencia_usuario", ausencia_especialista: "ausencia_especialista" };

  const pago = r.pagoId ? await Pago.porId(r.pagoId) : null;
  const rep = repartirReembolso({ total: r.foto.total, comision: r.foto.comision, porcentaje: pct });
  r.estado = estadoPorTipo[tipo];
  r.cancelacion = { por: actor?.id, rol, motivo: String(motivo).slice(0, 500), fecha: ahoraISO(), porcentaje: pct, monto: rep.monto, regla: decision.regla };
  historial(r, r.estado, { por: actor?.id, rol, nota: `${decision.texto}. Reembolso ${pct}%` });
  await Reserva.guardar(r);

  let reembolso = null;
  if (pago && ["aprobado", "reembolso_parcial"].includes(pago.estado) && rep.monto > 0) {
    reembolso = await pagos().reembolsar({ reserva: r, pago, rep, porcentaje: pct, motivo, regla: decision.regla, actor, rol });
  }
  if (pago && pago.estado === "a_cobrar") {
    // Modelo offline: la comisión adeudada se ajusta en proporción a lo que el especialista devuelve.
    pago.comision = Math.max(0, pago.comision - rep.comisionRevertida);
    await Pago.evento(pago, "ajuste_cancelacion", { porcentaje: pct });
  }
  const e = await Especialista.porId(r.especialistaId);
  const cuando = F.fFechaHora(r.inicio);
  const txtReembolso = rep.monto > 0 ? ` Reembolso: ${pesos(rep.monto)} (${pct}%).` : "";
  if (tipo === "cancelar") {
    if (rol !== "usuario") await notificar(r.usuarioId, { tipo: "cancelada", titulo: "Reserva cancelada", texto: `Tu reserva de ${r.foto.servicio} del ${cuando} fue cancelada.${txtReembolso}${motivo ? ` Motivo: ${motivo}` : ""}`, enlace: `/mi/reservas/${r.id}` });
    if (rol !== "especialista" && e?.usuarioId) await notificar(e.usuarioId, { tipo: "cancelada", titulo: "Reserva cancelada", texto: `${r.foto.usuario} canceló ${r.foto.servicio} del ${cuando}. El horario quedó libre.`, enlace: `/panel/reservas/${r.id}` });
  }
  return { reserva: r, reembolso, decision };
}

// ── Reprogramación ───────────────────────────────────────
async function reprogramar(p) {
  return enCola(p.reserva.especialistaId, () => reprogramarEnCola(p));
}

async function reprogramarEnCola({ reserva: r, actor, rol, fecha, hora, ahora = new Date() }) {
  const { Reserva, Pago, Especialista, Config } = require("../models");
  if (!["pagada", "confirmada"].includes(r.estado)) throw invalido("Solo se pueden reprogramar reservas pagadas o confirmadas.");
  const cfg = await Config.obtener();
  const politica = { ...cfg.cancelacion, ...(r.foto.politica || {}) };
  const horasAntes = (new Date(r.inicio).getTime() - ahora.getTime()) / 3600000;
  const ok = puedeReprogramar({ horasAntes, reprogramaciones: r.reprogramaciones, politica, actor: rol });
  if (!ok.ok) throw invalido(ok.motivo);
  const e = await Especialista.porId(r.especialistaId);
  if (rol === "usuario" && e?.ajustes?.permitirReprogramar === false) throw invalido("Este especialista no permite reprogramar desde la app. Escribile por mensaje.");

  const turnos = await horariosPara({ especialistaId: r.especialistaId, servicio: { duracion: r.foto.duracion }, duracion: r.foto.duracion, fecha, ahora, excluirReservaId: r.id });
  const turno = turnos.find((t) => t.hora === hora);
  if (!turno) throw conflicto("Ese horario no está disponible. Elegí otro, por favor.", "horario_ocupado");
  if (turno.inicio.toISOString() === r.inicio) throw invalido("Elegiste el mismo horario.");

  const { id, creado, actualizado, ...datos } = JSON.parse(JSON.stringify(r));
  const nueva = await Reserva.crear({
    ...datos, codigo: codigoReserva(), inicio: turno.inicio.toISOString(), fin: new Date(turno.inicio.getTime() + r.foto.duracion * 60000).toISOString(),
    reprogramadaDesde: r.id, reprogramadaA: null, reprogramaciones: (r.reprogramaciones || 0) + 1, recordatorios: {}, incidencia: { abierta: false },
    historial: [{ estado: r.estado, fecha: ahoraISO(), por: actor.id, rol, nota: `Reprogramada desde ${r.codigo} (${F.fFechaHora(r.inicio)})` }],
  });
  r.estado = "reprogramada";
  r.reprogramadaA = nueva.id;
  historial(r, "reprogramada", { por: actor.id, rol, nota: `Nuevo horario: ${F.fFechaHora(nueva.inicio)} (${nueva.codigo})` });
  await Reserva.guardar(r);
  if (r.pagoId) { const pg = await Pago.porId(r.pagoId); if (pg) { pg.reservaId = nueva.id; await Pago.evento(pg, "reprogramada", { desde: r.codigo, a: nueva.codigo }); } }

  const cuando = F.fFechaHora(nueva.inicio);
  if (rol !== "usuario") await notificar(r.usuarioId, { tipo: "reprogramada", titulo: "Cambio de horario", texto: `Tu reserva de ${r.foto.servicio} pasó al ${cuando}.`, enlace: `/mi/reservas/${nueva.id}` });
  if (rol !== "especialista" && e?.usuarioId) await notificar(e.usuarioId, { tipo: "reprogramada", titulo: "Reserva reprogramada", texto: `${r.foto.usuario} movió ${r.foto.servicio} al ${cuando}.`, enlace: `/panel/reservas/${nueva.id}` });
  return nueva;
}

// ── Cierre ───────────────────────────────────────────────
async function marcarRealizada(r, { actor = null, rol = "sistema", ahora = new Date() } = {}) {
  const { Reserva, Servicio } = require("../models");
  if (!["pagada", "confirmada"].includes(r.estado)) throw invalido("Esta reserva no se puede marcar como realizada.");
  if (new Date(r.inicio) > ahora) throw invalido("La sesión todavía no ocurrió.");
  r.estado = "realizada";
  r.realizadaEn = ahora.toISOString();
  historial(r, "realizada", { por: actor?.id, rol, nota: rol === "sistema" ? "Cierre automático" : "" });
  await Reserva.guardar(r);
  const s = await Servicio.porId(r.servicioId);
  if (s) { s.stats = s.stats || {}; s.stats.realizadas = (s.stats.realizadas || 0) + 1; await Servicio.guardar(s); }
  await require("./especialistas").recalcularStatsEspecialista(r.especialistaId);
  return r;
}

/** El usuario reporta un problema: se abre una incidencia, se frena el cierre automático y se avisa a administración. */
async function reportarIncidencia(r, { actor, rol, nota }) {
  const { Reserva, Consulta } = require("../models");
  const store = require("../config/store");
  r.incidencia = { abierta: true, nota: String(nota || "").slice(0, 1000), fecha: ahoraISO() };
  historial(r, r.estado, { por: actor.id, rol, nota: "Incidencia reportada" });
  await Reserva.guardar(r);
  const t = await Consulta.crear({
    numero: store.siguienteNumero("consulta"), usuarioId: actor.id, reservaId: r.id, tema: "reserva", prioridad: "alta", estado: "abierta",
    asunto: `Problema con la reserva ${r.codigo}`, mensajes: [{ autorId: actor.id, rol, texto: String(nota || "").slice(0, 5000), fecha: ahoraISO() }],
  });
  await notificarAdmins({ titulo: "Incidencia en una reserva", texto: `${r.codigo}: ${String(nota || "").slice(0, 140)}`, enlace: `/admin/soporte/${t.id}` });
  return t;
}

/** Vence reservas impagas (libera el horario). */
async function vencerPendientes(ahora = new Date()) {
  const { Reserva, Pago } = require("../models");
  const vencidas = await Reserva.todos((r) => r.estado === "pendiente" && r.vencePago && new Date(r.vencePago) < ahora);
  for (const r of vencidas) {
    r.estado = "vencida";
    historial(r, "vencida", { nota: "Venció el plazo de pago" });
    await Reserva.guardar(r);
    const pg = r.pagoId && (await Pago.porId(r.pagoId));
    if (pg && pg.estado === "pendiente") { pg.estado = "cancelado"; pg.detalle = "vencido"; await Pago.guardar(pg); }
  }
  return vencidas.length;
}

/** Datos para "Volver a reservar": mismo servicio, preferencias y próximo horario. */
async function contextoVolver(r) {
  const { Servicio, Especialista } = require("../models");
  const servicio = await Servicio.porId(r.servicioId);
  const especialista = await Especialista.porId(r.especialistaId);
  if (!servicio || !especialista || servicio.estado !== "activo" || especialista.estado !== "activo") return null;
  return { servicio, especialista, proximo: await proximoTurno({ especialistaId: especialista.id, servicio }), modalidad: r.modalidad, direccion: r.modalidad === "domicilio" ? r.lugar?.direccion : "" };
}

const usuarioPuedeCancelar = (r) => ["pendiente", "pagada", "confirmada"].includes(r.estado) && new Date(r.inicio) > new Date();

module.exports = {
  enCola, historial, mejorPromocion, cotizar, modeloCobro, crearReserva, marcarPagada, confirmarPorEspecialista, cancelar,
  reprogramar, marcarRealizada, reportarIncidencia, vencerPendientes, contextoVolver, usuarioPuedeCancelar,
};
