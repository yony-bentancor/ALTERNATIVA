/* Agenda y clientes del especialista: agenda diaria/semanal/mensual, horarios, bloqueos, reservas, clientes y mensajes (67 a 79). */
const M = require("../models");
const Modelo = require("../models/Modelo");
const F = require("../services/fechas");
const reservas = require("../services/reservas");
const mensajeria = require("../services/mensajeria");
const { normalizarRangos, resumenDias } = require("../services/disponibilidad");
const { invalido, noEncontrado } = require("../services/errores");
const { texto } = require("../services/util");

const vista = (res, v, datos) => res.render(`panel/${v}`, { area: "panel", ...datos });
const VISIBLES = ["pendiente", "pagada", "confirmada", "realizada", "ausencia_usuario"];

// 68 a 70: agenda (día, semana, mes)
exports.agenda = async (req, res) => {
  const e = req.especialista;
  const vistaA = ["dia", "semana", "mes"].includes(req.query.vista) ? req.query.vista : "semana";
  const fecha = F.fechaValida(req.query.fecha) ? req.query.fecha : F.hoy();
  let desde; let hasta; let grilla = null;
  if (vistaA === "dia") { desde = fecha; hasta = F.sumarDias(fecha, 1); }
  else if (vistaA === "semana") { desde = F.inicioSemana(fecha); hasta = F.sumarDias(desde, 7); }
  else { grilla = F.grillaMes(Number(fecha.slice(0, 4)), Number(fecha.slice(5, 7))); desde = grilla[0][0]; hasta = F.sumarDias(grilla.at(-1)[6], 1); }
  const ini = F.aUtc(desde); const fin = F.aUtc(hasta);
  const l = (await M.Reserva.todos((r) => r.especialistaId === e.id && VISIBLES.includes(r.estado) && new Date(r.inicio) >= ini && new Date(r.inicio) < fin && (r.estado !== "pendiente" || M.Reserva.ocupa(r)))).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const agenda = await M.Agenda.de(e.id);
  const porDia = {};
  for (const r of l) (porDia[F.partes(r.inicio).fecha] ||= []).push(r);
  vista(res, "agenda", { titulo: "Agenda", activo: "agenda", vistaA, fecha, desde, hasta, grilla, lista: l, porDia, agenda, rangosDe: require("../services/disponibilidad").rangosDeFecha });
};

// 71: configurar horarios
exports.formHorarios = async (req, res) => vista(res, "horarios", { titulo: "Horarios de atención", activo: "agenda", agenda: await M.Agenda.de(req.especialista.id) });

exports.horarios = async (req, res) => {
  const semanal = [];
  const crudo = req.body.semanal || {};
  for (let dia = 0; dia < 7; dia++) {
    const rangos = Object.values(crudo[dia] || {}).map((r) => ({ inicio: r.inicio, fin: r.fin })).filter((r) => F.horaValida(r.inicio) && F.horaValida(r.fin) && r.fin > r.inicio).sort((a, b) => a.inicio.localeCompare(b.inicio));
    const norm = normalizarRangos(rangos);
    for (let i = 1; i < norm.length; i++) if (norm[i].inicio < norm[i - 1].fin) throw invalido(`Hay franjas superpuestas el ${F.DIAS[dia]}.`);
    if (rangos.length) semanal.push({ dia, rangos });
  }
  const n = (v, min, max, def) => { const x = Number(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def; };
  const a = await M.Agenda.de(req.especialista.id);
  Object.assign(a, { semanal, paso: n(req.body.paso, 5, 120, 15), buffer: n(req.body.buffer, 0, 120, 0), avisoMin: Math.round(n(req.body.avisoHoras, 0, 168, 2) * 60), anticipacionMax: n(req.body.anticipacionMax, 1, 365, 60), limiteDiario: n(req.body.limiteDiario, 0, 50, 0) });
  await M.Agenda.guardar(a);
  req.session.flash = { tipo: "ok", texto: "Guardamos tus horarios. Las reservas ya confirmadas no cambian." };
  res.redirect("/panel/agenda/horarios");
};

// 72: bloquear horario o día
exports.bloqueos = async (req, res) => vista(res, "bloqueos", { titulo: "Bloqueos y vacaciones", activo: "agenda", agenda: await M.Agenda.de(req.especialista.id), hoy: F.hoy() });

exports.crearBloqueo = async (req, res) => {
  const a = await M.Agenda.de(req.especialista.id);
  const b = req.body;
  const nota = texto(b.nota, 120);
  let desde; let hasta;
  if (b.tipo === "dia") {
    if (!F.fechaValida(b.fecha)) throw invalido("Elegí la fecha.");
    a.excepciones = (a.excepciones || []).filter((x) => x.fecha !== b.fecha).concat({ fecha: b.fecha, tipo: "cerrado", rangos: [], nota });
    desde = hasta = b.fecha;
  } else if (b.tipo === "especial") {
    if (!F.fechaValida(b.fecha) || !F.horaValida(b.inicio) || !F.horaValida(b.fin) || b.fin <= b.inicio) throw invalido("Revisá la fecha y el horario.");
    a.excepciones = (a.excepciones || []).filter((x) => x.fecha !== b.fecha).concat({ fecha: b.fecha, tipo: "especial", rangos: [{ inicio: b.inicio, fin: b.fin }], nota });
    desde = hasta = b.fecha;
  } else if (b.tipo === "vacaciones") {
    if (!F.fechaValida(b.desde) || !F.fechaValida(b.hasta) || b.hasta < b.desde) throw invalido("Revisá las fechas de inicio y fin.");
    a.vacaciones = [...(a.vacaciones || []), { desde: b.desde, hasta: b.hasta, motivo: nota }];
    desde = b.desde; hasta = b.hasta;
  } else if (b.tipo === "horario") {
    if (!F.fechaValida(b.fecha) || !F.horaValida(b.inicio) || !F.horaValida(b.fin) || b.fin <= b.inicio) throw invalido("Revisá la fecha y el horario.");
    a.bloqueos = [...(a.bloqueos || []), { id: `b${Date.now()}`, inicio: F.aUtc(b.fecha, b.inicio).toISOString(), fin: F.aUtc(b.fecha, b.fin).toISOString(), motivo: nota }];
    desde = hasta = b.fecha;
  } else if (b.tipo === "descanso") {
    const dia = Number(b.dia);
    if (!(dia >= 0 && dia <= 6) || !F.horaValida(b.inicio) || !F.horaValida(b.fin) || b.fin <= b.inicio) throw invalido("Revisá el día y el horario del descanso.");
    a.descansos = [...(a.descansos || []), { dia, inicio: b.inicio, fin: b.fin }];
  } else throw invalido("Tipo de bloqueo no válido.");
  await M.Agenda.guardar(a);
  // Aviso si ya hay reservas en ese período (no se cancelan solas)
  const choques = desde ? await M.Reserva.contar((r) => r.especialistaId === req.especialista.id && ["pagada", "confirmada"].includes(r.estado) && F.partes(r.inicio).fecha >= desde && F.partes(r.inicio).fecha <= hasta) : 0;
  req.session.flash = choques ? { tipo: "alerta", texto: `Guardamos el bloqueo. Ojo: ya tenés ${choques} reserva(s) en ese período; si no podés atenderlas, reprogramalas o cancelalas desde Reservas.` } : { tipo: "ok", texto: "Guardamos el bloqueo." };
  res.redirect("/panel/agenda/bloqueos");
};

exports.eliminarBloqueo = async (req, res) => {
  const a = await M.Agenda.de(req.especialista.id);
  const i = Number(req.body.indice);
  const campo = { excepciones: "excepciones", vacaciones: "vacaciones", bloqueos: "bloqueos", descansos: "descansos" }[req.body.lista];
  if (campo && Number.isInteger(i)) a[campo] = (a[campo] || []).filter((_, k) => k !== i);
  await M.Agenda.guardar(a);
  req.session.flash = { tipo: "ok", texto: "Quitamos el bloqueo." };
  res.redirect("/panel/agenda/bloqueos");
};

// 67: disponibilidad (vista previa de lo que ven los clientes)
exports.disponibilidad = async (req, res) => {
  const servicios = (await M.Servicio.deEspecialista(req.especialista.id)).filter((s) => ["activo", "pausado"].includes(s.estado));
  const s = servicios.find((x) => x.id === req.query.servicio) || servicios[0];
  vista(res, "disponibilidad", { titulo: "Disponibilidad", activo: "agenda", servicios, s, resumen: s ? await resumenDias({ especialistaId: req.especialista.id, servicio: s, desde: F.hoy(), dias: 21 }) : [] });
};

// 73 a 76: reservas
exports.reservas = async (req, res) => {
  const e = req.especialista;
  const tab = ["proximas", "confirmar", "historial", "canceladas"].includes(req.query.tab) ? req.query.tab : "proximas";
  const ahora = new Date();
  const filtros = {
    proximas: (r) => ["pagada", "confirmada"].includes(r.estado) && new Date(r.inicio) > ahora,
    confirmar: (r) => r.estado === "pagada",
    historial: (r) => ["realizada", "ausencia_usuario", "ausencia_especialista"].includes(r.estado) || (["pagada", "confirmada"].includes(r.estado) && new Date(r.inicio) <= ahora),
    canceladas: (r) => ["cancelada_usuario", "cancelada_especialista", "reembolsada", "reprogramada"].includes(r.estado),
  };
  const mias = await M.Reserva.todos((r) => r.especialistaId === e.id);
  const q = texto(req.query.q, 60).toLowerCase();
  let l = mias.filter(filtros[tab]);
  if (q) l = l.filter((r) => r.foto.usuario.toLowerCase().includes(q) || r.codigo.toLowerCase() === q);
  l.sort((a, b) => (["proximas", "confirmar"].includes(tab) ? a.inicio.localeCompare(b.inicio) : b.inicio.localeCompare(a.inicio)));
  const cuentas = Object.fromEntries(Object.entries(filtros).map(([k, f]) => [k, mias.filter(f).length]));
  vista(res, "reservas", { titulo: "Reservas", activo: "reservas", tab, p: Modelo.paginar(l, req.query.page, 30), cuentas, q });
};

async function reservaPropia(req, id = req.params.id) {
  const r = await M.Reserva.porId(id);
  if (!r || r.especialistaId !== req.especialista.id) throw noEncontrado();
  return r;
}

exports.reserva = async (req, res) => {
  const r = await reservaPropia(req);
  const cliente = await M.Usuario.porId(r.usuarioId);
  const previas = await M.Reserva.contar((x) => x.usuarioId === r.usuarioId && x.especialistaId === req.especialista.id && x.estado === "realizada");
  const mostrarTelefono = ["pagada", "confirmada", "realizada"].includes(r.estado) && cliente?.privacidad?.compartirContacto !== false;
  vista(res, "reserva", {
    titulo: `Reserva ${r.codigo}`, activo: "reservas", r, cliente, previas, mostrarTelefono, pago: r.pagoId ? await M.Pago.porId(r.pagoId) : null,
    conversacion: await M.Conversacion.entre(r.usuarioId, req.especialista.id), resena: await M.Resena.uno((x) => x.reservaId === r.id),
    reembolsos: await M.Reembolso.todos((x) => x.reservaId === r.id),
  });
};

exports.confirmar = async (req, res) => {
  const r = await reservaPropia(req);
  await reservas.confirmarPorEspecialista(r, req.usuario);
  req.session.flash = { tipo: "ok", texto: "Confirmaste la reserva. Le avisamos al cliente." };
  res.redirect(`/panel/reservas/${r.id}`);
};

exports.cancelar = async (req, res) => {
  const r = await reservaPropia(req);
  const motivo = texto(req.body.motivo, 500);
  if (motivo.length < 5) throw invalido("Contale al cliente el motivo de la cancelación.");
  await reservas.cancelar({ reserva: r, actor: req.usuario, rol: "especialista", motivo });
  await M.Auditoria.registrar(req, { accion: "reserva.cancela_especialista", entidad: "reserva", entidadId: r.id, resumen: motivo });
  req.session.flash = { tipo: "ok", texto: "Cancelaste la reserva. El cliente recibe el reembolso completo y un aviso." };
  res.redirect(`/panel/reservas/${r.id}`);
};

exports.formReprogramar = async (req, res) => {
  const r = await reservaPropia(req);
  if (!["pagada", "confirmada"].includes(r.estado)) throw invalido("Esta reserva no se puede reprogramar.");
  res.render("cuenta/reprogramar", { titulo: "Reprogramar", area: "panel", activo: "reservas", r, hoy: F.hoy(), accion: `/panel/reservas/${r.id}/reprogramar`, volver: `/panel/reservas/${r.id}` });
};

exports.reprogramar = async (req, res) => {
  const r = await reservaPropia(req);
  const nueva = await reservas.reprogramar({ reserva: r, actor: req.usuario, rol: "especialista", fecha: req.body.fecha, hora: req.body.hora });
  req.session.flash = { tipo: "ok", texto: `Reprogramada para el ${F.fFechaHora(nueva.inicio)}. Le avisamos al cliente.` };
  res.redirect(`/panel/reservas/${nueva.id}`);
};

exports.realizada = async (req, res) => {
  const r = await reservaPropia(req);
  await reservas.marcarRealizada(r, { actor: req.usuario, rol: "especialista" });
  req.session.flash = { tipo: "ok", texto: "Marcaste la sesión como realizada. Le pedimos al cliente que la valore." };
  res.redirect(`/panel/reservas/${r.id}`);
};

exports.ausencia = async (req, res) => {
  const r = await reservaPropia(req);
  await reservas.cancelar({ reserva: r, actor: req.usuario, rol: "especialista", tipo: "ausencia_usuario", motivo: "El cliente no se presentó" });
  await M.Auditoria.registrar(req, { accion: "reserva.ausencia_usuario", entidad: "reserva", entidadId: r.id });
  req.session.flash = { tipo: "ok", texto: "Registramos la ausencia del cliente según la política de cancelación." };
  res.redirect(`/panel/reservas/${r.id}`);
};

exports.notas = async (req, res) => {
  const r = await reservaPropia(req);
  r.notasEspecialista = texto(req.body.notas, 2000);
  if (r.modalidad === "online" && req.body.enlaceOnline !== undefined) {
    const url = texto(req.body.enlaceOnline, 300);
    if (url && !/^https:\/\//.test(url)) throw invalido("El enlace de la sesión online debe empezar con https://");
    r.lugar = { ...(r.lugar || {}), enlaceOnline: url };
  }
  await M.Reserva.guardar(r);
  req.session.flash = { tipo: "ok", texto: "Guardamos los cambios." };
  res.redirect(`/panel/reservas/${r.id}`);
};

// 77 y 78: clientes
exports.clientes = async (req, res) => {
  const ahora = new Date();
  const l = await M.Reserva.todos((r) => r.especialistaId === req.especialista.id && ["pagada", "confirmada", "realizada", "ausencia_usuario"].includes(r.estado));
  const por = new Map();
  for (const r of l) {
    const c = por.get(r.usuarioId) || { usuarioId: r.usuarioId, nombre: r.foto.usuario, total: 0, realizadas: 0, ultima: null, proxima: null, servicios: new Set(), gastado: 0 };
    c.total++; if (r.estado === "realizada") c.realizadas++;
    if (new Date(r.inicio) <= ahora && (!c.ultima || r.inicio > c.ultima)) c.ultima = r.inicio;
    if (new Date(r.inicio) > ahora && (!c.proxima || r.inicio < c.proxima)) c.proxima = r.inicio;
    c.servicios.add(r.foto.servicio); c.gastado += r.foto.netoEspecialista;
    por.set(r.usuarioId, c);
  }
  const q = texto(req.query.q, 60).toLowerCase();
  const filas = [...por.values()].filter((c) => !q || c.nombre.toLowerCase().includes(q)).sort((a, b) => String(b.ultima || b.proxima).localeCompare(String(a.ultima || a.proxima)));
  const usuarios = await M.Usuario.mapaPorIds(filas.map((c) => c.usuarioId));
  vista(res, "clientes", { titulo: "Clientes", activo: "clientes", filas, usuarios, q });
};

exports.cliente = async (req, res) => {
  const l = Modelo.ordenar(await M.Reserva.todos((r) => r.especialistaId === req.especialista.id && r.usuarioId === req.params.usuarioId), "inicio");
  if (!l.length) throw noEncontrado("No tenés reservas con esta persona.");
  const cliente = await M.Usuario.porId(req.params.usuarioId);
  const activa = l.some((r) => ["pagada", "confirmada", "realizada"].includes(r.estado));
  vista(res, "cliente", {
    titulo: cliente?.nombre || "Cliente", activo: "clientes", cliente, lista: l, resenas: await M.Resena.todos((x) => x.especialistaId === req.especialista.id && x.usuarioId === req.params.usuarioId),
    conversacion: await M.Conversacion.entre(req.params.usuarioId, req.especialista.id), mostrarTelefono: activa && cliente?.privacidad?.compartirContacto !== false,
    servMap: await M.Servicio.mapaPorIds(l.map((r) => r.servicioId)),
  });
};

exports.mensajeCliente = async (req, res) => {
  if (!(await M.Reserva.uno((r) => r.especialistaId === req.especialista.id && r.usuarioId === req.params.usuarioId))) throw noEncontrado();
  const c = await M.Conversacion.entre(req.params.usuarioId, req.especialista.id) || await M.Conversacion.crear({ usuarioId: req.params.usuarioId, especialistaId: req.especialista.id, usuarioEspecialistaId: req.usuario.id, ultimoMensaje: new Date().toISOString(), vistaPrevia: "", sinLeerUsuario: 0, sinLeerEspecialista: 0, estado: "abierta" });
  res.redirect(`/panel/mensajes/${c.id}`);
};

// 79: mensajes
exports.mensajes = async (req, res) => {
  const l = Modelo.ordenar(await M.Conversacion.todos((c) => c.especialistaId === req.especialista.id), "ultimoMensaje");
  vista(res, "mensajes", { titulo: "Mensajes", activo: "mensajes", lista: l, usuarios: await M.Usuario.mapaPorIds(l.map((c) => c.usuarioId)) });
};

async function conversacionPropia(req) {
  const c = await M.Conversacion.porId(req.params.id);
  if (!c || c.especialistaId !== req.especialista.id) throw noEncontrado();
  if (c.usuarioEspecialistaId !== req.usuario.id) { c.usuarioEspecialistaId = req.usuario.id; await M.Conversacion.guardar(c); }
  return c;
}

exports.conversacion = async (req, res) => {
  const c = await conversacionPropia(req);
  await mensajeria.marcarLeida(c, "especialista");
  const cliente = await M.Usuario.porId(c.usuarioId);
  const permitido = await mensajeria.contactoPermitido(c);
  const msjs = (await M.Mensaje.deConversacion(c.id)).map((m) => ({ ...m, visible: mensajeria.textoVisible(m, req.usuario.id, permitido) }));
  const proxima = (await M.Reserva.todos((r) => r.usuarioId === c.usuarioId && r.especialistaId === req.especialista.id && M.Reserva.proxima(r))).sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
  const conReserva = await mensajeria.tienenReserva(c.usuarioId, req.especialista.id);
  res.render("cuenta/conversacion", {
    titulo: `Mensajes con ${cliente?.nombre}`, area: "panel", activo: "mensajes", c, msjs, permitido, proxima, accion: `/panel/mensajes/${c.id}`, volver: "/panel/mensajes",
    otro: { nombre: cliente?.nombre || "Cliente", avatar: cliente?.avatar, enlace: conReserva ? `/panel/clientes/${c.usuarioId}` : null },
    telefonoCliente: conReserva && cliente?.privacidad?.compartirContacto !== false ? cliente?.telefono : null, wa: null, e: req.especialista,
  });
};

exports.enviarMensaje = async (req, res) => {
  const c = await conversacionPropia(req);
  await mensajeria.enviar({ conversacion: c, autor: req.usuario, texto: req.body.texto });
  res.redirect(`/panel/mensajes/${c.id}`);
};
