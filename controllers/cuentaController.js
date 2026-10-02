/* Área del usuario (/mi): reservas, reseñas, favoritos, mensajes, avisos, perfil, pagos, configuración, privacidad y ayuda. */
const config = require("../config");
const store = require("../config/store");
const M = require("../models");
const Modelo = require("../models/Modelo");
const F = require("../services/fechas");
const reservas = require("../services/reservas");
const resenas = require("../services/resenas");
const mensajeria = require("../services/mensajeria");
const { evaluarCancelacion, puedeReprogramar, repartirReembolso, describirPolitica } = require("../services/cancelacion");
const { notificarAdmins } = require("../services/notificaciones");
const { hashClave, verificarClave } = require("../services/claves");
const { noEncontrado, prohibido, invalido } = require("../services/errores");
const { texto, EMAIL } = require("../services/util");
const { lista } = require("../middlewares/subida");

const vista = (res, v, datos) => res.render(`cuenta/${v}`, { activo: "perfil", ...datos });

async function reservaPropia(req, id = req.params.id) {
  const r = await M.Reserva.porId(id);
  if (!r) throw noEncontrado("No encontramos esa reserva.");
  if (r.usuarioId !== req.usuario.id) throw prohibido();
  return r;
}

// 26: inicio del usuario
exports.inicio = async (req, res) => {
  const u = req.usuario;
  const mias = await M.Reserva.todos((r) => r.usuarioId === u.id);
  const proximas = mias.filter((r) => M.Reserva.proxima(r)).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const porValorar = mias.filter((r) => r.estado === "realizada" && !r.resenada);
  const pendientesPago = mias.filter((r) => r.estado === "pendiente" && new Date(r.vencePago) > new Date());
  const favoritos = await M.Favorito.contar((f) => f.usuarioId === u.id);
  const avisos = (await M.Notificacion.de(u.id)).slice(0, 4);
  // Para "volver a reservar": últimas sesiones realizadas con distintos especialistas
  const vistos = new Set();
  const volver = Modelo.ordenar(mias.filter((r) => r.estado === "realizada"), "inicio").filter((r) => (vistos.has(r.especialistaId) ? false : vistos.add(r.especialistaId))).slice(0, 3);
  vista(res, "inicio", { titulo: "Mi cuenta", proximas, porValorar, pendientesPago, favoritos, avisos, volver, total: mias.length });
};

// 38 a 40: mis reservas
exports.reservas = async (req, res) => {
  const tab = ["proximas", "historial", "canceladas"].includes(req.query.tab) ? req.query.tab : "proximas";
  const mias = await M.Reserva.todos((r) => r.usuarioId === req.usuario.id);
  const grupos = {
    proximas: mias.filter((r) => M.Reserva.ACTIVAS.includes(r.estado)).sort((a, b) => a.inicio.localeCompare(b.inicio)),
    historial: Modelo.ordenar(mias.filter((r) => M.Reserva.PASADAS.includes(r.estado)), "inicio"),
    canceladas: Modelo.ordenar(mias.filter((r) => M.Reserva.CANCELADAS.includes(r.estado)), "inicio"),
  };
  vista(res, "reservas", { titulo: "Mis reservas", activo: "reservas", tab, grupos, lista: grupos[tab] });
};

// 41 y 37: detalle (y "reserva confirmada" con ?nueva=1)
exports.reserva = async (req, res) => {
  const r = await reservaPropia(req);
  const e = await M.Especialista.porId(r.especialistaId);
  const pago = r.pagoId ? await M.Pago.porId(r.pagoId) : null;
  const reembolsos = await M.Reembolso.todos((x) => x.reservaId === r.id);
  const resena = await M.Resena.uno((x) => x.reservaId === r.id);
  const conversacion = await M.Conversacion.entre(req.usuario.id, r.especialistaId);
  const politica = { ...(await M.Config.obtener()).cancelacion, ...(r.foto.politica || {}) };
  const horasAntes = (new Date(r.inicio).getTime() - Date.now()) / 3600000;
  const repro = puedeReprogramar({ horasAntes, reprogramaciones: r.reprogramaciones, politica, actor: "usuario" });
  // La dirección exacta y el WhatsApp se muestran solo con la reserva pagada o confirmada.
  const confirmada = ["pagada", "confirmada", "realizada"].includes(r.estado);
  vista(res, "reserva", {
    titulo: `Reserva ${r.codigo}`, activo: "reservas", r, e, pago, reembolsos, resena, conversacion, nueva: req.query.nueva === "1", confirmada,
    puedeCancelar: reservas.usuarioPuedeCancelar(r), repro, politica: describirPolitica(politica), wa: await mensajeria.whatsappVisible(e, req.usuario),
    reprogramadaA: r.reprogramadaA ? await M.Reserva.porId(r.reprogramadaA) : null,
  });
};

exports.ics = async (req, res) => {
  const r = await reservaPropia(req);
  const f = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lugar = r.modalidad === "online" ? "Online" : r.lugar?.direccion || "";
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Alternativa//Reservas//ES", "BEGIN:VEVENT", `UID:${r.id}@alternativa.uy`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(r.inicio)}`, `DTEND:${f(r.fin)}`,
    `SUMMARY:${r.foto.servicio} con ${r.foto.especialista}`, `LOCATION:${lugar.replace(/[,;]/g, " ")}`, `DESCRIPTION:Reserva ${r.codigo} - ${config.urlSitio}/mi/reservas/${r.id}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  res.type("text/calendar").set("Content-Disposition", `attachment; filename="reserva-${r.codigo}.ics"`).send(ics);
};

// 43: cancelar (muestra el reembolso antes de confirmar)
exports.formCancelar = async (req, res) => {
  const r = await reservaPropia(req);
  if (!reservas.usuarioPuedeCancelar(r)) { req.session.flash = { tipo: "error", texto: "Esta reserva ya no se puede cancelar." }; return res.redirect(`/mi/reservas/${r.id}`); }
  const politica = { ...(await M.Config.obtener()).cancelacion, ...(r.foto.politica || {}) };
  const horasAntes = (new Date(r.inicio).getTime() - Date.now()) / 3600000;
  const dec = r.estado === "pendiente" ? { porcentaje: 0, texto: "Reserva sin pagar" } : evaluarCancelacion({ actor: "usuario", horasAntes, politica });
  const rep = repartirReembolso({ total: r.foto.total, comision: r.foto.comision, porcentaje: dec.porcentaje });
  const repro = puedeReprogramar({ horasAntes, reprogramaciones: r.reprogramaciones, politica, actor: "usuario" });
  vista(res, "cancelar", { titulo: "Cancelar reserva", activo: "reservas", r, dec, rep, repro });
};

exports.cancelar = async (req, res) => {
  const r = await reservaPropia(req);
  const { reembolso } = await reservas.cancelar({ reserva: r, actor: req.usuario, rol: "usuario", motivo: texto(req.body.motivo, 500) });
  req.session.flash = { tipo: "ok", texto: reembolso ? (reembolso.estado === "procesado" ? "Reserva cancelada. El reembolso ya está en camino." : "Reserva cancelada. Estamos gestionando tu reembolso.") : "Reserva cancelada." };
  res.redirect(`/mi/reservas/${r.id}`);
};

// 42: reprogramar
exports.formReprogramar = async (req, res) => {
  const r = await reservaPropia(req);
  const politica = { ...(await M.Config.obtener()).cancelacion, ...(r.foto.politica || {}) };
  const repro = puedeReprogramar({ horasAntes: (new Date(r.inicio).getTime() - Date.now()) / 3600000, reprogramaciones: r.reprogramaciones, politica, actor: "usuario" });
  if (!["pagada", "confirmada"].includes(r.estado) || !repro.ok) { req.session.flash = { tipo: "error", texto: repro.motivo || "Esta reserva no se puede reprogramar." }; return res.redirect(`/mi/reservas/${r.id}`); }
  vista(res, "reprogramar", { titulo: "Reprogramar", activo: "reservas", r, hoy: F.hoy(), accion: `/mi/reservas/${r.id}/reprogramar`, volver: `/mi/reservas/${r.id}` });
};

exports.reprogramar = async (req, res) => {
  const r = await reservaPropia(req);
  const nueva = await reservas.reprogramar({ reserva: r, actor: req.usuario, rol: "usuario", fecha: req.body.fecha, hora: req.body.hora });
  req.session.flash = { tipo: "ok", texto: `Listo: tu sesión pasó al ${F.fFechaHora(nueva.inicio)}.` };
  res.redirect(`/mi/reservas/${nueva.id}`);
};

// Volver a reservar: mismo servicio con preferencias
exports.volver = async (req, res) => {
  const r = await reservaPropia(req);
  const ctx = await reservas.contextoVolver(r);
  if (!ctx) { req.session.flash = { tipo: "error", texto: "Este servicio ya no está disponible. Buscá otras opciones." }; return res.redirect("/buscar"); }
  res.redirect(`/reservar/${ctx.servicio.id}?modalidad=${ctx.modalidad}${ctx.proximo ? `&fecha=${ctx.proximo.fecha}` : ""}&volverDe=${r.id}`);
};

exports.problema = async (req, res) => {
  const r = await reservaPropia(req);
  const nota = texto(req.body.nota, 1000);
  if (nota.length < 10) throw invalido("Contanos qué pasó (al menos 10 caracteres).");
  const t = await reservas.reportarIncidencia(r, { actor: req.usuario, rol: "usuario", nota });
  req.session.flash = { tipo: "ok", texto: `Recibimos tu reporte (#${t.numero}). Lo revisamos y te escribimos.` };
  res.redirect(`/mi/reservas/${r.id}`);
};

// 44 y 45: valorar y escribir reseña
exports.formValorar = async (req, res) => {
  const r = await reservaPropia(req);
  const ok = await resenas.puedeValorar(r, req.usuario);
  if (!ok.ok) { req.session.flash = { tipo: "info", texto: ok.motivo }; return res.redirect(`/mi/reservas/${r.id}`); }
  vista(res, "valorar", { titulo: "Valorar sesión", activo: "reservas", r, e: await M.Especialista.porId(r.especialistaId), resena: null, accion: `/mi/reservas/${r.id}/valorar` });
};

exports.valorar = async (req, res) => {
  const r = await reservaPropia(req);
  await resenas.crear({ reserva: r, usuario: req.usuario, puntaje: req.body.puntaje, comentario: req.body.comentario });
  req.session.flash = { tipo: "ok", texto: "¡Gracias! Tu reseña ya está publicada." };
  res.redirect("/mi/resenas");
};

exports.misResenas = async (req, res) => {
  const l = Modelo.ordenar(await M.Resena.todos((x) => x.usuarioId === req.usuario.id), "creado");
  const esp = await M.Especialista.mapaPorIds(l.map((x) => x.especialistaId));
  const serv = await M.Servicio.mapaPorIds(l.map((x) => x.servicioId));
  const dias = (await M.Config.obtener()).resenas.diasEdicion;
  vista(res, "resenas", { titulo: "Mis reseñas", activo: "reservas", lista: l, esp, serv, dias });
};

async function resenaPropia(req) {
  const rv = await M.Resena.porId(req.params.id);
  if (!rv) throw noEncontrado();
  if (rv.usuarioId !== req.usuario.id) throw prohibido();
  return rv;
}

exports.formEditarResena = async (req, res) => {
  const rv = await resenaPropia(req);
  const r = await M.Reserva.porId(rv.reservaId);
  vista(res, "valorar", { titulo: "Editar reseña", activo: "reservas", r, e: await M.Especialista.porId(rv.especialistaId), resena: rv, accion: `/mi/resenas/${rv.id}/editar` });
};

exports.editarResena = async (req, res) => {
  const rv = await resenaPropia(req);
  await resenas.editar(rv, req.usuario, { puntaje: req.body.puntaje, comentario: req.body.comentario });
  req.session.flash = { tipo: "ok", texto: "Actualizamos tu reseña." };
  res.redirect("/mi/resenas");
};

// 46: favoritos
exports.favoritos = async (req, res) => {
  const { tarjetas, datosBase } = require("../services/busqueda");
  const { catalogo } = require("../services/especialistas");
  const favs = await M.Favorito.todos((f) => f.usuarioId === req.usuario.id);
  const cat = await catalogo();
  const { cfg, reglas } = await datosBase();
  const servicios = tarjetas(cat.filter((i) => favs.some((f) => f.tipo === "servicio" && f.servicioId === i.servicio.id)), { cfg, reglas });
  const especialistas = [...(await M.Especialista.mapaPorIds(favs.filter((f) => f.tipo === "especialista").map((f) => f.especialistaId))).values()];
  vista(res, "favoritos", { titulo: "Favoritos", servicios, especialistas, favoritos: await M.Favorito.idsDe(req.usuario.id) });
};

// 47 y 48: mensajes
exports.mensajes = async (req, res) => {
  const l = Modelo.ordenar(await M.Conversacion.todos((c) => c.usuarioId === req.usuario.id), "ultimoMensaje");
  const esp = await M.Especialista.mapaPorIds(l.map((c) => c.especialistaId));
  vista(res, "mensajes", { titulo: "Mensajes", activo: "mensajes", lista: l, esp });
};

exports.nuevoMensaje = async (req, res) => {
  const e = await M.Especialista.porId(req.params.especialistaId);
  if (!e || e.estado !== "activo" || !e.usuarioId) throw noEncontrado("No se puede escribir a este especialista.");
  const c = await mensajeria.conversacionCon(req.usuario.id, e);
  res.redirect(`/mi/mensajes/${c.id}`);
};

async function conversacionPropia(req) {
  const c = await M.Conversacion.porId(req.params.id);
  if (!c) throw noEncontrado();
  if (c.usuarioId !== req.usuario.id) throw prohibido();
  return c;
}

exports.conversacion = async (req, res) => {
  const c = await conversacionPropia(req);
  await mensajeria.marcarLeida(c, "usuario");
  const e = await M.Especialista.porId(c.especialistaId);
  const permitido = await mensajeria.contactoPermitido(c);
  const msjs = (await M.Mensaje.deConversacion(c.id)).map((m) => ({ ...m, visible: mensajeria.textoVisible(m, req.usuario.id, permitido) }));
  const proxima = (await M.Reserva.todos((r) => r.usuarioId === req.usuario.id && r.especialistaId === e.id && M.Reserva.proxima(r))).sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
  vista(res, "conversacion", { titulo: `Mensajes con ${e.nombre}`, activo: "mensajes", c, e, msjs, permitido, proxima, accion: `/mi/mensajes/${c.id}`, volver: "/mi/mensajes", wa: await mensajeria.whatsappVisible(e, req.usuario), otro: { nombre: e.nombre, avatar: e.avatar, enlace: `/especialistas/${e.slug}` } });
};

exports.enviarMensaje = async (req, res) => {
  const c = await conversacionPropia(req);
  const { ocultoParaOtros } = await mensajeria.enviar({ conversacion: c, autor: req.usuario, texto: req.body.texto });
  if (ocultoParaOtros) req.session.flash = { tipo: "info", texto: "Los datos de contacto se comparten después de la primera reserva. La otra persona verá ese dato oculto." };
  res.redirect(`/mi/mensajes/${c.id}`);
};

// 49: avisos
exports.notificaciones = async (req, res) => {
  const l = await M.Notificacion.de(req.usuario.id);
  vista(res, "notificaciones", { titulo: "Avisos", p: Modelo.paginar(l, req.query.page, 25), base: "/mi/notificaciones" });
};

exports.abrirNotificacion = async (req, res) => {
  const n = await M.Notificacion.porId(req.params.id);
  if (!n || n.usuarioId !== req.usuario.id) throw noEncontrado();
  if (!n.leida) { n.leida = new Date().toISOString(); await M.Notificacion.guardar(n); }
  res.redirect(n.enlace && n.enlace.startsWith("/") ? n.enlace : "/mi/notificaciones");
};

exports.leerTodas = async (req, res) => {
  for (const n of await M.Notificacion.todos((x) => x.usuarioId === req.usuario.id && !x.leida)) n.leida = new Date().toISOString();
  await M.Notificacion.guardar(null);
  res.redirect(req.get("referer") || "/mi/notificaciones");
};

// 50 y 51: perfil
exports.perfil = async (req, res) => vista(res, "perfil", { titulo: "Mi perfil", stats: { reservas: await M.Reserva.contar((r) => r.usuarioId === req.usuario.id && r.estado === "realizada"), resenas: await M.Resena.contar((r) => r.usuarioId === req.usuario.id) } });

exports.formEditarPerfil = (req, res) => vista(res, "editar-perfil", { titulo: "Editar perfil", errores: [] });

exports.editarPerfil = async (req, res) => {
  const u = req.usuario;
  const d = req.body;
  const errores = [...(req.erroresSubida || [])];
  if (texto(d.nombre).split(" ").length < 2) errores.push("Escribí tu nombre y apellido.");
  if (!EMAIL.test(d.email || "")) errores.push("Escribí un correo válido.");
  const otro = await M.Usuario.porEmail(d.email);
  if (otro && otro.id !== u.id) errores.push("Ese correo ya está en uso por otra cuenta.");
  if (errores.length) return res.status(400).render("cuenta/editar-perfil", { titulo: "Editar perfil", activo: "perfil", errores });
  const foto = lista(req, "avatar")[0];
  const cambioEmail = texto(d.email, 200).toLowerCase() !== u.email;
  Object.assign(u, {
    nombre: texto(d.nombre, 120), email: texto(d.email, 200).toLowerCase(), telefono: texto(d.telefono, 40),
    ubicacion: { departamento: texto(d.departamento, 40), ciudad: texto(d.ciudad, 60), barrio: texto(d.barrio, 60) },
    avatar: foto ? foto.url : d.quitarFoto ? "" : u.avatar, emailVerificado: cambioEmail ? false : u.emailVerificado,
  });
  await M.Usuario.guardar(u);
  req.session.flash = { tipo: "ok", texto: cambioEmail ? "Guardamos tus datos. Confirmá tu nuevo correo desde el email que te enviamos." : "Guardamos tus datos." };
  res.redirect("/mi/perfil");
};

// 52: métodos de pago e historial
exports.pagos = async (req, res) => {
  const l = Modelo.ordenar(await M.Pago.todos((p) => p.usuarioId === req.usuario.id), "creado");
  const rs = await M.Reserva.mapaPorIds(l.map((p) => p.reservaId));
  const rbs = await M.Reembolso.todos((x) => x.usuarioId === req.usuario.id);
  vista(res, "pagos", { titulo: "Mis pagos", lista: l, rs, rbs });
};

exports.metodosPago = (req, res) => vista(res, "metodos-pago", { titulo: "Métodos de pago" });

exports.quitarMetodo = async (req, res) => {
  const u = req.usuario;
  u.metodosPago = (u.metodosPago || []).filter((m) => m.id !== req.body.id);
  await M.Usuario.guardar(u);
  req.session.flash = { tipo: "ok", texto: "Quitamos el medio de pago guardado." };
  res.redirect("/mi/metodos-de-pago");
};

// 53: configuración
exports.configuracion = (req, res) => vista(res, "configuracion", { titulo: "Configuración", whatsappActivo: require("../services/notificaciones").whatsappActivo() });

exports.guardarAvisos = async (req, res) => {
  const u = req.usuario;
  const b = req.body;
  u.preferencias = { ...(u.preferencias || {}), avisos: { email: !!b.email, push: !!b.push, whatsapp: !!b.whatsapp, marketing: !!b.marketing } };
  await M.Usuario.guardar(u);
  req.session.flash = { tipo: "ok", texto: "Guardamos tus preferencias de avisos." };
  res.redirect("/mi/configuracion");
};

exports.cambiarClave = async (req, res) => {
  const u = req.usuario;
  if (!verificarClave(req.body.actual, u.clave)) throw invalido("La contraseña actual no es correcta.");
  if (!req.body.nueva || req.body.nueva.length < 8) throw invalido("La nueva contraseña tiene que tener al menos 8 caracteres.");
  if (req.body.nueva !== req.body.nueva2) throw invalido("Las contraseñas nuevas no coinciden.");
  u.clave = hashClave(req.body.nueva);
  await M.Usuario.guardar(u);
  await M.Auditoria.registrar(req, { accion: "cuenta.cambiar_clave", entidad: "usuario", entidadId: u.id, severidad: "seguridad" });
  req.session.flash = { tipo: "ok", texto: "Cambiaste tu contraseña." };
  res.redirect("/mi/configuracion");
};

// 54: privacidad
exports.privacidad = (req, res) => vista(res, "privacidad", { titulo: "Privacidad" });

exports.guardarPrivacidad = async (req, res) => {
  const u = req.usuario;
  u.privacidad = { soloNombre: !!req.body.soloNombre, compartirContacto: !!req.body.compartirContacto };
  await M.Usuario.guardar(u);
  req.session.flash = { tipo: "ok", texto: "Guardamos tus preferencias de privacidad." };
  res.redirect("/mi/privacidad");
};

exports.misDatos = async (req, res) => {
  const u = req.usuario;
  const datos = {
    cuenta: M.Usuario.publico(u),
    reservas: await M.Reserva.todos((r) => r.usuarioId === u.id),
    pagos: await M.Pago.todos((p) => p.usuarioId === u.id),
    resenas: await M.Resena.todos((r) => r.usuarioId === u.id),
    favoritos: await M.Favorito.todos((f) => f.usuarioId === u.id),
    mensajes: await M.Mensaje.todos((m) => m.autorId === u.id),
    exportado: new Date().toISOString(),
  };
  res.set("Content-Disposition", 'attachment; filename="mis-datos-alternativa.json"').json(datos);
};

exports.eliminarCuenta = async (req, res) => {
  const u = req.usuario;
  if (!verificarClave(req.body.clave, u.clave)) throw invalido("La contraseña no es correcta.");
  const activas = await M.Reserva.contar((r) => r.usuarioId === u.id && M.Reserva.proxima(r));
  if (activas) throw invalido("Tenés reservas próximas. Cancelalas antes de eliminar tu cuenta.");
  if (u.especialistaId) throw invalido("Tu cuenta administra una ficha de especialista. Escribinos para darla de baja.");
  // Se anonimizan los datos personales; las reservas y pagos se conservan por obligaciones legales.
  Object.assign(u, { nombre: "Usuario eliminado", email: `eliminado-${u.id}@alternativa.invalid`, telefono: "", avatar: "", estado: "eliminado", eliminado: new Date().toISOString(), clave: "", metodosPago: [], suscripcionesPush: [] });
  await M.Usuario.guardar(u);
  await M.Favorito.eliminarVarios((f) => f.usuarioId === u.id);
  await M.Auditoria.registrar(req, { accion: "cuenta.eliminar", entidad: "usuario", entidadId: u.id, severidad: "seguridad" });
  req.session.destroy(() => res.redirect("/"));
};

// 55: ayuda y soporte
exports.ayuda = async (req, res, area = "cuenta") => {
  const consultas = Modelo.ordenar(await M.Consulta.todos((t) => t.usuarioId === req.usuario.id), "creado");
  const faqs = (await M.Contenido.publicados("faq")).slice(0, 6);
  const mias = Modelo.ordenar(await M.Reserva.todos((r) => r.usuarioId === req.usuario.id), "inicio").slice(0, 10);
  res.render("cuenta/ayuda", { titulo: "Ayuda", activo: area === "panel" ? "ayuda" : "perfil", area: area === "panel" ? "panel" : "publico", consultas, faqs, mias, temas: M.Consulta.TEMAS, base: area === "panel" ? "/panel/ayuda" : "/mi/ayuda" });
};

exports.crearConsulta = async (req, res) => {
  const d = req.body;
  if (!texto(d.asunto) || texto(d.mensaje).length < 10) throw invalido("Escribí un asunto y contanos el problema (al menos 10 caracteres).");
  const r = d.reservaId ? await M.Reserva.porId(d.reservaId) : null;
  const t = await M.Consulta.crear({
    numero: store.siguienteNumero("consulta"), usuarioId: req.usuario.id, reservaId: r && (r.usuarioId === req.usuario.id || r.especialistaId === req.usuario.especialistaId) ? r.id : null,
    tema: M.Consulta.TEMAS[d.tema] ? d.tema : "otro", asunto: texto(d.asunto, 200), estado: "abierta", prioridad: d.tema === "pago" || d.tema === "reembolso" ? "alta" : "normal",
    mensajes: [{ autorId: req.usuario.id, rol: req.usuario.rol, texto: texto(d.mensaje, 5000), fecha: new Date().toISOString() }],
  });
  await notificarAdmins({ titulo: `Nueva consulta #${t.numero}`, texto: t.asunto, enlace: `/admin/soporte/${t.id}`, tipo: "admin" });
  req.session.flash = { tipo: "ok", texto: `Recibimos tu consulta #${t.numero}. Te respondemos acá y por email.` };
  res.redirect(`${req.baseUrl}/ayuda/${t.id}`);
};

async function consultaPropia(req) {
  const t = await M.Consulta.porId(req.params.id);
  if (!t || t.usuarioId !== req.usuario.id) throw noEncontrado();
  return t;
}

exports.consulta = async (req, res, area = "cuenta") => {
  const t = await consultaPropia(req);
  res.render("cuenta/consulta", { titulo: `Consulta #${t.numero}`, activo: area === "panel" ? "ayuda" : "perfil", area: area === "panel" ? "panel" : "publico", t, base: area === "panel" ? "/panel/ayuda" : "/mi/ayuda" });
};

exports.responderConsulta = async (req, res) => {
  const t = await consultaPropia(req);
  const msg = texto(req.body.mensaje, 5000);
  if (!msg) throw invalido("Escribí un mensaje.");
  t.mensajes.push({ autorId: req.usuario.id, rol: req.usuario.rol, texto: msg, fecha: new Date().toISOString() });
  if (["esperando_usuario", "resuelta"].includes(t.estado)) t.estado = "abierta";
  await M.Consulta.guardar(t);
  res.redirect(`${req.baseUrl}/ayuda/${t.id}`);
};
