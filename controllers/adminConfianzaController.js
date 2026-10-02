/* Confianza y soporte: reseñas, moderación de fotos/videos y cambios, denuncias y consultas (pantallas 118 a 121 y 129). */
const M = require("../models");
const Modelo = require("../models/Modelo");
const resenas = require("../services/resenas");
const { notificar } = require("../services/notificaciones");
const { enviarEmail, plantilla } = require("../services/email");
const { borrarMedia } = require("../services/multimedia");
const { invalido, noEncontrado } = require("../services/errores");
const { texto, esc, normalizar } = require("../services/util");

const vista = (res, v, datos) => res.render(`admin/${v}`, { area: "admin", ...datos });
const ok = (req, t) => { req.session.flash = { tipo: "ok", texto: t }; };
const volver = (req, def) => { try { const u = new URL(req.get("referer") || ""); if (u.host === req.get("host")) return u.pathname + u.search; } catch { /* sin referer */ } return def; };

// 118: reseñas
exports.resenas = async (req, res) => {
  const q = req.query;
  const l = Modelo.ordenar(await M.Resena.todos((r) => (!q.estado || r.estado === q.estado) && (!q.estrellas || r.puntaje === Number(q.estrellas))
    && (q.revision !== "1" || (r.pedidoRevision?.fecha && !r.pedidoRevision.resuelto)) && (!q.q || normalizar(r.comentario || "").includes(normalizar(q.q)))), "creado");
  const p = Modelo.paginar(l, q.page, 30);
  const denuncias = {};
  for (const d of await M.Denuncia.todos((x) => x.tipo === "resena")) denuncias[d.objetivoId] = (denuncias[d.objetivoId] || 0) + 1;
  vista(res, "resenas", {
    titulo: "Reseñas", activo: "resenas", p, denuncias, motivos: M.Denuncia.MOTIVOS,
    servMap: await M.Servicio.mapaPorIds(p.items.map((r) => r.servicioId)), espMap: await M.Especialista.mapaPorIds(p.items.map((r) => r.especialistaId)),
  });
};

exports.moderarResena = async (req, res) => {
  const motivo = texto(req.body.motivo, 300);
  if (req.body.accion === "ocultar" && motivo.length < 5) throw invalido("Indicá el motivo de la moderación.");
  const { r, antes } = await resenas.moderar(req.params.id, { accion: req.body.accion, motivo, admin: req.usuario });
  await M.Auditoria.registrar(req, { accion: `resena.${req.body.accion}`, entidad: "resena", entidadId: r.id, antes: { estado: antes }, despues: { estado: r.estado, motivo }, severidad: "aviso" });
  const e = await M.Especialista.porId(r.especialistaId);
  if (e?.usuarioId && r.pedidoRevision?.fecha) await notificar(e.usuarioId, { tipo: "moderacion", titulo: "Revisión de reseña resuelta", texto: r.estado === "oculta" ? "Ocultamos la reseña porque incumplía las reglas." : "La reseña cumple las reglas y se mantiene publicada.", enlace: "/panel/resenas" });
  ok(req, r.estado === "oculta" ? "Ocultamos la reseña. La reputación se recalculó." : "La reseña quedó publicada.");
  res.redirect(volver(req, "/admin/resenas"));
};

// 119: moderación (fotos y videos pendientes o denunciados, cambios sensibles, servicios en revisión)
exports.moderacion = async (req, res) => {
  const tab = ["pendiente", "reportado", "cambios", "servicios"].includes(req.query.tab) ? req.query.tab : "pendiente";
  const media = tab === "reportado"
    ? await M.Multimedia.todos((m) => m.visibilidad === "publica" && (m.estado === "reportado" || (m.denuncias > 0 && m.estado === "aprobado")))
    : await M.Multimedia.todos((m) => m.visibilidad === "publica" && m.estado === "pendiente");
  const cambios = await M.Especialista.todos((e) => (e.cambiosPendientes || []).length);
  const servicios = await M.Servicio.todos((s) => s.estado === "en_revision");
  vista(res, "moderacion", {
    titulo: "Moderación", activo: "moderacion", tab, media: Modelo.ordenar(media, "creado", false), cambios, servicios,
    cuentas: { pendiente: await M.Multimedia.contar((m) => m.visibilidad === "publica" && m.estado === "pendiente"), reportado: await M.Multimedia.contar((m) => m.visibilidad === "publica" && (m.estado === "reportado" || (m.denuncias > 0 && m.estado === "aprobado"))), cambios: cambios.length, servicios: servicios.length },
    espMap: await M.Especialista.mapaPorIds([...media.map((m) => m.especialistaId), ...servicios.map((s) => s.especialistaId)]),
    categorias: await M.Categoria.todos(), nombresCampo: require("../services/especialistas").NOMBRES_CAMPOS,
  });
};

exports.moderarMedia = async (req, res) => {
  const m = await M.Multimedia.porId(req.params.id);
  if (!m) throw noEncontrado();
  const accion = req.body.accion; const motivo = texto(req.body.motivo, 300);
  if (accion === "aprobar") { m.estado = "aprobado"; m.denuncias = 0; await M.Multimedia.guardar(m); }
  else if (accion === "rechazar") { m.estado = "rechazado"; m.moderacion = { fecha: new Date().toISOString(), motivo, por: req.usuario.id }; await M.Multimedia.guardar(m); }
  else if (accion === "eliminar") {
    const e = await M.Especialista.porId(m.especialistaId);
    if (e) { for (const k of ["avatar", "portada", "video"]) if (e[k] === m.url) e[k] = ""; await M.Especialista.guardar(e); }
    await borrarMedia(m);
  } else throw invalido("Acción no válida.");
  for (const d of await M.Denuncia.todos((x) => x.tipo === "multimedia" && x.objetivoId === m.id && x.estado === "abierta")) {
    d.estado = "resuelta";
    d.resolucion = { fecha: new Date().toISOString(), accion, nota: motivo, por: req.usuario.id };
  }
  await M.Denuncia.guardar(null);
  await M.Auditoria.registrar(req, { accion: `multimedia.${accion}`, entidad: "multimedia", entidadId: m.id, despues: { motivo } });
  const e = m.especialistaId ? await M.Especialista.porId(m.especialistaId) : null;
  if (e?.usuarioId && accion !== "aprobar") await notificar(e.usuarioId, { tipo: "moderacion", titulo: "Un archivo no se publicó", texto: motivo || "No cumple las reglas de contenido.", enlace: "/panel/perfil/multimedia" });
  ok(req, { aprobar: "Aprobamos el archivo.", rechazar: "Rechazamos el archivo.", eliminar: "Eliminamos el archivo." }[accion]);
  res.redirect(volver(req, "/admin/moderacion"));
};

// 120: denuncias (con el contenido denunciado a la vista para decidir sin abrir otra pantalla)
exports.denuncias = async (req, res) => {
  const q = req.query;
  const estado = ["abierta", "resuelta", "descartada"].includes(q.estado) ? q.estado : "abierta";
  const l = Modelo.ordenar(await M.Denuncia.todos((d) => d.estado === estado && (!q.tipo || d.tipo === q.tipo)), "creado");
  const p = Modelo.paginar(l, q.page, 30);
  const objetivos = {};
  const modelos = { resena: M.Resena, multimedia: M.Multimedia, especialista: M.Especialista, servicio: M.Servicio, usuario: M.Usuario, mensaje: M.Mensaje };
  for (const d of p.items) {
    const k = `${d.tipo}:${d.objetivoId}`;
    if (!(k in objetivos)) objetivos[k] = modelos[d.tipo] ? await modelos[d.tipo].porId(d.objetivoId) : null;
  }
  vista(res, "denuncias", { titulo: "Denuncias", activo: "denuncias", p, estado, objetivos, motivos: M.Denuncia.MOTIVOS, tipos: M.Denuncia.TIPOS, denunciantes: await M.Usuario.mapaPorIds(p.items.map((d) => d.denuncianteId)) });
};

exports.resolverDenuncia = async (req, res) => {
  const d = await M.Denuncia.porId(req.params.id);
  if (!d) throw noEncontrado();
  d.estado = req.body.decision === "descartar" ? "descartada" : "resuelta";
  d.resolucion = { fecha: new Date().toISOString(), accion: req.body.decision, nota: texto(req.body.nota, 500), por: req.usuario.id };
  await M.Denuncia.guardar(d);
  await M.Auditoria.registrar(req, { accion: `denuncia.${d.estado}`, entidad: "denuncia", entidadId: d.id, despues: d.resolucion });
  ok(req, d.estado === "descartada" ? "Descartamos la denuncia." : "Marcamos la denuncia como resuelta.");
  res.redirect(volver(req, "/admin/denuncias"));
};

// 129: soporte
exports.soporte = async (req, res) => {
  const q = req.query;
  const PRI = { alta: 0, normal: 1, baja: 2 };
  const l = (await M.Consulta.todos((t) => (q.estado ? t.estado === q.estado : ["abierta", "esperando_usuario"].includes(t.estado)) && (!q.tema || t.tema === q.tema)))
    .sort((a, b) => PRI[a.prioridad] - PRI[b.prioridad] || (b.actualizado || b.creado).localeCompare(a.actualizado || a.creado));
  const p = Modelo.paginar(l, q.page, 30);
  vista(res, "soporte", { titulo: "Soporte", activo: "soporte", p, usuarios: await M.Usuario.mapaPorIds(p.items.map((t) => t.usuarioId)), rs: await M.Reserva.mapaPorIds(p.items.map((t) => t.reservaId).filter(Boolean)) });
};

exports.consulta = async (req, res) => {
  const t = await M.Consulta.porId(req.params.id);
  if (!t) throw noEncontrado();
  const u = t.usuarioId ? await M.Usuario.porId(t.usuarioId) : null;
  vista(res, "consulta", { titulo: `Consulta #${t.numero}`, activo: "soporte", t, u, r: t.reservaId ? await M.Reserva.porId(t.reservaId) : null, autores: await M.Usuario.mapaPorIds(t.mensajes.map((m) => m.autorId).filter(Boolean)), ficha: u?.especialistaId ? await M.Especialista.porId(u.especialistaId) : null });
};

exports.responderConsulta = async (req, res) => {
  const t = await M.Consulta.porId(req.params.id);
  if (!t) throw noEncontrado();
  const cuerpo = texto(req.body.mensaje, 5000);
  if (cuerpo) t.mensajes.push({ autorId: req.usuario.id, rol: "admin", texto: cuerpo, fecha: new Date().toISOString() });
  if (M.Consulta.ESTADOS[req.body.estado]) t.estado = req.body.estado;
  else if (cuerpo && t.estado === "abierta") t.estado = "esperando_usuario";
  if (M.Consulta.PRIORIDADES[req.body.prioridad]) t.prioridad = req.body.prioridad;
  t.asignadaA = req.usuario.id;
  await M.Consulta.guardar(t);
  if (cuerpo) {
    const u = t.usuarioId ? await M.Usuario.porId(t.usuarioId) : null;
    if (u) await notificar(u, { tipo: "cuenta", titulo: `Respuesta a tu consulta #${t.numero}`, texto: cuerpo.slice(0, 200), enlace: `${u.especialistaId ? "/panel" : "/mi"}/ayuda/${t.id}` });
    else if (t.email) await enviarEmail({ para: t.email, asunto: `Re: ${t.asunto} (#${t.numero})`, html: plantilla({ titulo: `Respuesta a tu consulta #${t.numero}`, intro: "", cuerpo: `<p style="white-space:pre-wrap">${esc(cuerpo)}</p>`, pie: "Podés responder escribiéndonos desde Contacto." }) });
  }
  await M.Auditoria.registrar(req, { accion: "consulta.responder", entidad: "consulta", entidadId: t.id, despues: { estado: t.estado, prioridad: t.prioridad } });
  ok(req, cuerpo ? "Enviamos la respuesta." : "Actualizamos la consulta.");
  res.redirect(`/admin/soporte/${t.id}`);
};
