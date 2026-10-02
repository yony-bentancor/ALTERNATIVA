/* Reserva y pago (pantallas 32 a 37): fecha, hora, confirmación, pago (Mercado Pago o simulado) y resultado. */
const config = require("../config");
const M = require("../models");
const F = require("../services/fechas");
const reservas = require("../services/reservas");
const pagos = require("../services/pagos");
const { horariosPara } = require("../services/disponibilidad");
const { describirPolitica } = require("../services/cancelacion");
const { registrar } = require("../services/estadisticas");
const { noEncontrado, prohibido, invalido } = require("../services/errores");
const { texto } = require("../services/util");

async function reservable(servicioId) {
  const s = await M.Servicio.porId(servicioId);
  const e = s && (await M.Especialista.porId(s.especialistaId));
  const c = s && (await M.Categoria.porId(s.categoriaId));
  if (!s || s.estado !== "activo" || !c || c.estado !== "activa") throw noEncontrado("Este servicio no está disponible para reservar.");
  if (!e || e.estado !== "activo" || !e.usuarioId) throw noEncontrado("Este especialista no está recibiendo reservas online.");
  return { s, e, categoria: c };
}
const modalidadesDe = (s, e) => (s.modalidades?.length ? s.modalidades : e.modalidades || []);

// Pantallas 32 y 33: calendario y horarios
exports.elegir = async (req, res) => {
  const { s, e } = await reservable(req.params.servicioId);
  const mods = modalidadesDe(s, e);
  const pref = req.usuario?.preferencias?.ultimaModalidad;
  const modalidad = mods.includes(req.query.modalidad) ? req.query.modalidad : mods.includes(pref) ? pref : mods[0];
  await registrar({ especialistaId: e.id, servicioId: s.id, campo: "consultasAgenda", req });
  res.render("reservas/elegir", { titulo: `Reservar ${s.titulo}`, s, e, mods, modalidad, hoy: F.hoy(), seleccionada: F.fechaValida(req.query.fecha) ? req.query.fecha : "", volverDe: req.query.volverDe || "" });
};

// Pantalla 34: confirmación (revalida el horario en el servidor)
exports.confirmar = async (req, res) => {
  const { s, e } = await reservable(req.params.servicioId);
  const { fecha, hora } = req.query;
  if (!F.fechaValida(fecha) || !F.horaValida(hora)) return res.redirect(`/reservar/${s.id}`);
  const mods = modalidadesDe(s, e);
  const modalidad = mods.includes(req.query.modalidad) ? req.query.modalidad : mods[0];
  const turno = (await horariosPara({ especialistaId: e.id, servicio: s, fecha })).find((t) => t.hora === hora);
  if (!turno) {
    req.session.flash = { tipo: "error", texto: "Ese horario ya no está disponible. Elegí otro, por favor." };
    return res.redirect(`/reservar/${s.id}?fecha=${fecha}&modalidad=${modalidad}`);
  }
  const cot = await reservas.cotizar({ servicio: s, especialista: e, usuario: req.usuario, modalidad, codigo: req.query.codigo });
  let modelo;
  try { modelo = reservas.modeloCobro(cot.cfg, e); } catch (err) { modelo = null; cot.error = err.message; }
  res.render("reservas/confirmar", {
    titulo: "Confirmá tu reserva", s, e, turno, fecha, hora, modalidad, mods, cot, modelo, codigo: req.query.codigo || "",
    politica: describirPolitica(cot.cfg.cancelacion), direccion: req.usuario.preferencias?.direccionDomicilio || "", volverDe: req.query.volverDe || "",
  });
};

// Crea la reserva y envía directo al pago (un solo paso para el usuario)
exports.crear = async (req, res) => {
  const d = req.body;
  let r;
  try {
    r = await reservas.crearReserva({ usuario: req.usuario, servicioId: req.params.servicioId, fecha: d.fecha, hora: d.hora, modalidad: d.modalidad, direccion: d.direccion, notas: d.notas, codigo: texto(d.codigo, 40), volverDe: d.volverDe || null });
  } catch (err) {
    if (err.codigo === "horario_ocupado") {
      req.session.flash = { tipo: "error", texto: err.message };
      return res.redirect(`/reservar/${req.params.servicioId}?fecha=${d.fecha}&modalidad=${d.modalidad}`);
    }
    throw err;
  }
  if (r.estado !== "pendiente") return res.redirect(`/mi/reservas/${r.id}?nueva=1`);
  try {
    const pago = await pagos.iniciarPago(r, req.usuario);
    return res.redirect(303, pago.urlCheckout);
  } catch (err) {
    req.session.flash = { tipo: "error", texto: err.message };
    return res.redirect(`/pago/${r.id}`);
  }
};

async function reservaPropia(req, id) {
  const r = await M.Reserva.porId(id);
  if (!r) throw noEncontrado();
  if (r.usuarioId !== req.usuario.id) throw prohibido();
  return r;
}

// Pantalla 35: pago pendiente (reintento con cuenta regresiva)
exports.pago = async (req, res) => {
  const r = await reservaPropia(req, req.params.reservaId);
  if (r.estado !== "pendiente") return res.redirect(`/mi/reservas/${r.id}`);
  res.render("reservas/pago", { titulo: "Pago", r, pago: r.pagoId ? await M.Pago.porId(r.pagoId) : null });
};

exports.pagar = async (req, res) => {
  const r = await reservaPropia(req, req.params.reservaId);
  const pago = await pagos.iniciarPago(r, req.usuario);
  res.redirect(303, pago.urlCheckout);
};

// Pantalla 36: regreso desde la pasarela (consulta el estado sin esperar el webhook)
exports.retorno = async (req, res) => {
  const pago = await M.Pago.porId(String(req.query.pago || ""));
  if (!pago || pago.usuarioId !== req.usuario.id) return res.redirect("/mi/reservas");
  const idPasarela = req.query.payment_id || req.query.collection_id;
  if (idPasarela && pago.estado === "pendiente" && /^\d+$/.test(String(idPasarela))) {
    try {
      const info = await pagos.proveedor(pago.proveedor).consultarPago(String(idPasarela), { pago });
      if (info.externalReference === pago.id) await pagos.aplicarEstado(pago, info);
    } catch { /* lo resuelve el webhook o la conciliación */ }
  }
  const r = await M.Reserva.porId(pago.reservaId);
  if (["pagada", "confirmada"].includes(r.estado)) return res.redirect(`/mi/reservas/${r.id}?nueva=1`);
  res.render("reservas/retorno", { titulo: "Resultado del pago", pago, r, resultado: req.query.resultado });
};

// Pasarela simulada (desarrollo y demostración)
exports.simulado = async (req, res) => {
  if (config.enVivo) throw noEncontrado();
  const pago = await M.Pago.porId(req.params.pagoId);
  if (!pago || pago.usuarioId !== req.usuario.id) throw noEncontrado();
  res.render("reservas/simulado", { titulo: "Pago de prueba", pago, r: await M.Reserva.porId(pago.reservaId), sinPie: true });
};

exports.simuladoResultado = async (req, res) => {
  if (config.enVivo) throw noEncontrado();
  const pago = await M.Pago.porId(req.params.pagoId);
  if (!pago || pago.usuarioId !== req.usuario.id) throw noEncontrado();
  if (pago.estado !== "pendiente") throw invalido("Este pago ya fue procesado.");
  const estado = req.body.resultado === "aprobar" ? "approved" : "rejected";
  const info = await pagos.proveedor("simulado").consultarPago(`SIM:${estado}:${pago.id}`, { pago });
  await pagos.aplicarEstado(pago, info);
  res.redirect(`/pago/retorno?pago=${pago.id}&resultado=${estado === "approved" ? "ok" : "error"}`);
};
