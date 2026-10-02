/* API JSON que usa public/js/app.js: calendario y horarios, favoritos, chat en vivo, push y estado del pago. */
const M = require("../models");
const F = require("../services/fechas");
const { resumenDias, horariosPara } = require("../services/disponibilidad");
const mensajeria = require("../services/mensajeria");
const { noEncontrado, prohibido, invalido } = require("../services/errores");

async function servicioDe(id) {
  const s = await M.Servicio.porId(id);
  if (!s) throw noEncontrado();
  return s;
}

/** Reserva a excluir del cálculo (al reprogramar, su propio horario cuenta como libre). */
async function excluir(req, s) {
  const id = req.query.excluir;
  if (!id || !req.usuario) return null;
  const r = await M.Reserva.porId(String(id));
  if (!r || r.servicioId !== s.id) return null;
  return r.usuarioId === req.usuario.id || req.usuario.especialistaId === r.especialistaId || req.usuario.rol === "admin" ? r.id : null;
}

exports.disponibilidad = async (req, res) => {
  const s = await servicioDe(req.params.servicioId);
  const desde = F.fechaValida(req.query.desde) ? req.query.desde : F.hoy();
  const dias = Math.min(62, Math.max(1, parseInt(req.query.dias, 10) || 42));
  const r = await resumenDias({ especialistaId: s.especialistaId, servicio: s, desde, dias, excluirReservaId: await excluir(req, s) });
  res.set("Cache-Control", "no-store").json({ dias: r });
};

exports.horarios = async (req, res) => {
  const s = await servicioDe(req.params.servicioId);
  if (!F.fechaValida(req.query.fecha)) throw invalido("Fecha no válida");
  const l = await horariosPara({ especialistaId: s.especialistaId, servicio: s, fecha: req.query.fecha, excluirReservaId: await excluir(req, s) });
  res.set("Cache-Control", "no-store").json({ fecha: req.query.fecha, horarios: l.map((t) => ({ hora: t.hora, inicio: t.inicio })) });
};

exports.favorito = async (req, res) => {
  const { tipo, id, on } = req.body || {};
  if (!["servicio", "especialista"].includes(tipo) || !id) throw invalido("Datos no válidos");
  let especialistaId; let servicioId = null;
  if (tipo === "servicio") {
    const s = await M.Servicio.porId(String(id));
    if (!s) throw noEncontrado();
    servicioId = s.id; especialistaId = s.especialistaId;
  } else {
    if (!(await M.Especialista.porId(String(id)))) throw noEncontrado();
    especialistaId = String(id);
  }
  const existe = await M.Favorito.uno((f) => f.usuarioId === req.usuario.id && f.tipo === tipo && (tipo === "servicio" ? f.servicioId === servicioId : f.especialistaId === especialistaId));
  let estado;
  if (on === false || (on === undefined && existe)) {
    if (existe) await M.Favorito.eliminar(existe.id);
    estado = false;
  } else {
    if (!existe) {
      await M.Favorito.crear({ usuarioId: req.usuario.id, tipo, especialistaId, servicioId });
      await M.Estadistica.sumar({ especialistaId, fecha: F.hoy(), campo: "favoritos" });
    }
    estado = true;
  }
  res.json({ on: estado });
};

exports.contador = async (req, res) => res.json({ sinLeer: await M.Notificacion.sinLeer(req.usuario.id) });

exports.suscribirPush = async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint) || !keys?.p256dh || !keys?.auth) throw invalido("Suscripción no válida");
  const u = req.usuario;
  u.suscripcionesPush = (u.suscripcionesPush || []).filter((s) => s.endpoint !== endpoint).concat({ endpoint, keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) } }).slice(-5);
  await M.Usuario.guardar(u);
  res.json({ ok: true });
};

exports.desuscribirPush = async (req, res) => {
  const u = req.usuario;
  u.suscripcionesPush = (u.suscripcionesPush || []).filter((s) => s.endpoint !== String(req.body?.endpoint || ""));
  await M.Usuario.guardar(u);
  res.json({ ok: true });
};

async function conversacion(req) {
  const c = await M.Conversacion.porId(req.params.id);
  if (!c) throw noEncontrado();
  const rol = mensajeria.rolEn(c, req.usuario);
  if (!rol || rol === "admin") throw prohibido();
  return { c, rol };
}
const json = (m, lectorId, permitido) => ({ id: m.id, fecha: m.creado, hora: F.fHora(m.creado), texto: mensajeria.textoVisible(m, lectorId, permitido), mio: m.autorId === lectorId });

exports.mensajes = async (req, res) => {
  const { c, rol } = await conversacion(req);
  let l = await M.Mensaje.deConversacion(c.id);
  if (req.query.desde) l = l.filter((m) => m.creado > String(req.query.desde));
  if (l.some((m) => m.autorId !== req.usuario.id)) await mensajeria.marcarLeida(c, rol);
  const permitido = await mensajeria.contactoPermitido(c);
  res.json({ mensajes: l.slice(-100).map((m) => json(m, req.usuario.id, permitido)) });
};

exports.enviarMensaje = async (req, res) => {
  const { c } = await conversacion(req);
  const { mensaje, ocultoParaOtros } = await mensajeria.enviar({ conversacion: c, autor: req.usuario, texto: req.body?.texto });
  res.json({ mensaje: json(mensaje, req.usuario.id, true), aviso: ocultoParaOtros ? "Los datos de contacto se comparten después de la primera reserva. La otra persona verá ese dato oculto." : null });
};

exports.estadoPago = async (req, res) => {
  const p = await M.Pago.porId(req.params.id);
  if (!p || p.usuarioId !== req.usuario.id) throw noEncontrado();
  const r = await M.Reserva.porId(p.reservaId);
  const destino = ["pagada", "confirmada"].includes(r?.estado) ? `/mi/reservas/${r.id}?nueva=1` : p.estado === "pendiente" ? null : `/pago/retorno?pago=${p.id}&resultado=error`;
  res.json({ estado: p.estado, estadoReserva: r?.estado, final: !!destino, destino });
};
