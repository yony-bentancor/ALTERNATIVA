/*
 * Reseñas verificadas por servicio. El especialista no puede borrarlas: puede responder o pedir revisión.
 * Solo administración modera (y queda auditado).
 */
const { invalido, prohibido, noEncontrado } = require("./errores");
const { notificar, notificarAdmins } = require("./notificaciones");
const { recalcularRatingServicio, recalcularStatsEspecialista } = require("./especialistas");

async function puedeValorar(reserva, usuario) {
  const { Config } = require("../models");
  const cfg = await Config.obtener();
  if (!reserva || reserva.usuarioId !== usuario.id) return { ok: false, motivo: "Solo quien realizó la sesión puede valorarla." };
  if (reserva.estado !== "realizada") return { ok: false, motivo: "Podés valorar el servicio una vez realizada la sesión." };
  if (reserva.resenada) return { ok: false, motivo: "Ya valoraste esta sesión." };
  const limite = new Date(reserva.realizadaEn || reserva.fin).getTime() + cfg.resenas.diasParaValorar * 86400000;
  if (Date.now() > limite) return { ok: false, motivo: "Venció el plazo para valorar esta sesión." };
  return { ok: true };
}

async function actualizarReputacion(r) {
  await recalcularRatingServicio(r.servicioId);
  await recalcularStatsEspecialista(r.especialistaId);
}

const validarPuntaje = (p) => {
  const n = Number(p);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw invalido("Elegí de 1 a 5 estrellas.");
  return n;
};

async function crear({ reserva, usuario, puntaje, comentario }) {
  const { Resena, Reserva, Especialista, Usuario } = require("../models");
  const ok = await puedeValorar(reserva, usuario);
  if (!ok.ok) throw invalido(ok.motivo);
  const r = await Resena.crear({
    reservaId: reserva.id, servicioId: reserva.servicioId, especialistaId: reserva.especialistaId, usuarioId: usuario.id,
    autor: Usuario.nombrePublico(usuario), puntaje: validarPuntaje(puntaje), comentario: String(comentario || "").trim().slice(0, 2000),
    fechaServicio: reserva.inicio, estado: "publicada", util: 0,
  });
  await Reserva.actualizar(reserva.id, { resenada: true });
  await actualizarReputacion(r);
  const e = await Especialista.porId(reserva.especialistaId);
  if (e?.usuarioId) await notificar(e.usuarioId, { tipo: "resena_nueva", titulo: `Nueva reseña: ${"★".repeat(r.puntaje)}`, texto: `${r.autor} valoró ${reserva.foto.servicio}.${r.comentario ? ` “${r.comentario.slice(0, 120)}”` : ""}`, enlace: "/panel/resenas" });
  return r;
}

async function editar(r, usuario, { puntaje, comentario }) {
  const { Resena, Config } = require("../models");
  const cfg = await Config.obtener();
  if (r.usuarioId !== usuario.id) throw prohibido();
  if (Date.now() > new Date(r.creado).getTime() + cfg.resenas.diasEdicion * 86400000) throw invalido(`Las reseñas se pueden editar durante ${cfg.resenas.diasEdicion} días.`);
  r.puntaje = validarPuntaje(puntaje);
  r.comentario = String(comentario || "").trim().slice(0, 2000);
  r.editada = new Date().toISOString();
  await Resena.guardar(r);
  await actualizarReputacion(r);
  return r;
}

async function responder(r, especialista, texto) {
  const { Resena } = require("../models");
  const t = String(texto || "").trim();
  if (t.length < 2) throw invalido("Escribí una respuesta.");
  r.respuesta = { texto: t.slice(0, 1500), fecha: new Date().toISOString() };
  await Resena.guardar(r);
  await notificar(r.usuarioId, { tipo: "respuesta_resena", titulo: "Respondieron tu reseña", texto: `${especialista.nombre} respondió a tu reseña.`, enlace: `/especialistas/${especialista.slug}#resenas` });
  return r;
}

/** Pedido de revisión: la reseña sigue visible mientras administración la analiza. */
async function pedirRevision(r, usuarioEsp, { motivo, detalle }) {
  const { Resena, Denuncia } = require("../models");
  if (r.estado === "oculta") throw invalido("La reseña ya fue moderada.");
  r.estado = "en_revision";
  r.pedidoRevision = { motivo, detalle: String(detalle || "").slice(0, 2000), fecha: new Date().toISOString() };
  await Resena.guardar(r);
  await Denuncia.crear({ denuncianteId: usuarioEsp.id, rolDenunciante: "especialista", tipo: "resena", objetivoId: r.id, motivo, detalle, estado: "abierta" });
  await notificarAdmins({ titulo: "Pedido de revisión de reseña", texto: `Motivo: ${motivo}`, enlace: "/admin/resenas?estado=en_revision", clave: `rev:${r.id}` });
  return r;
}

async function denunciar(r, usuario, { motivo, detalle }) {
  const { Denuncia } = require("../models");
  const ya = await Denuncia.uno((d) => d.tipo === "resena" && d.objetivoId === r.id && d.denuncianteId === usuario.id && d.estado === "abierta");
  return ya || Denuncia.crear({ denuncianteId: usuario.id, rolDenunciante: usuario.rol, tipo: "resena", objetivoId: r.id, motivo, detalle, estado: "abierta" });
}

async function moderar(id, { accion, motivo, admin }) {
  const { Resena, Denuncia } = require("../models");
  const r = await Resena.porId(id);
  if (!r) throw noEncontrado();
  const antes = r.estado;
  if (accion === "ocultar") r.estado = "oculta";
  else if (accion === "publicar") r.estado = "publicada";
  else throw invalido("Acción no válida.");
  r.moderacion = { fecha: new Date().toISOString(), motivo, por: admin.id };
  if (r.pedidoRevision?.fecha && !r.pedidoRevision.resuelto) {
    r.pedidoRevision.resuelto = new Date().toISOString();
    r.pedidoRevision.resolucion = accion === "ocultar" ? "Reseña ocultada" : "Reseña mantenida";
  }
  await Resena.guardar(r);
  for (const d of await Denuncia.todos((x) => x.tipo === "resena" && x.objetivoId === r.id && x.estado === "abierta")) {
    d.estado = "resuelta";
    d.resolucion = { fecha: new Date().toISOString(), accion, nota: motivo, por: admin.id };
  }
  await Denuncia.guardar(null);
  await actualizarReputacion(r);
  return { r, antes };
}

module.exports = { puedeValorar, crear, editar, responder, pedirRevision, denunciar, moderar };
