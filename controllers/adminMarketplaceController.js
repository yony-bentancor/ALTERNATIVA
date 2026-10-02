/* Administración del marketplace: especialistas, verificaciones, usuarios, servicios, categorías y reservas (pantallas 98 a 112). */
const M = require("../models");
const Modelo = require("../models/Modelo");
const config = require("../config");
const F = require("../services/fechas");
const especialistas = require("../services/especialistas");
const reservas = require("../services/reservas");
const pagos = require("../services/pagos");
const { repartirReembolso } = require("../services/cancelacion");
const { tableroEspecialista } = require("../services/estadisticas");
const { notificar } = require("../services/notificaciones");
const { borrarMedia } = require("../services/multimedia");
const { leerServicio, leerFicha, num } = require("../services/formularios");
const { invalido, noEncontrado } = require("../services/errores");
const { texto, slug, EMAIL, DEPARTAMENTOS, SLUGS_RESERVADOS, normalizar } = require("../services/util");
const { lista } = require("../middlewares/subida");

const vista = (res, v, datos) => res.render(`admin/${v}`, { area: "admin", ...datos });
const contiene = (a, q) => normalizar(String(a || "")).includes(normalizar(String(q || "")));
const ok = (req, t) => { req.session.flash = { tipo: "ok", texto: t }; };

// ── Especialistas (98 a 101) ─────────────────────────────
exports.especialistas = async (req, res) => {
  const q = req.query;
  let l = await M.Especialista.todos((e) => !e.eliminado
    && (!q.estado || e.estado === q.estado) && (!q.verificacion || (e.verificacion?.estado || "ninguna") === q.verificacion)
    && (!q.reclamo || (e.reclamo?.estado || "propio") === q.reclamo) && (!q.q || contiene(e.nombre, q.q) || contiene(e.slug, q.q)));
  l = Modelo.ordenar(l, "creado");
  const conteo = {};
  for (const e of await M.Especialista.todos((x) => !x.eliminado)) conteo[e.estado] = (conteo[e.estado] || 0) + 1;
  vista(res, "especialistas", { titulo: "Especialistas", activo: "especialistas", p: Modelo.paginar(l, q.page, 25), conteo, categorias: await M.Categoria.mapaPorIds(l.flatMap((e) => e.categorias || [])) });
};

async function especialista(id) {
  const e = await M.Especialista.porId(id);
  if (!e) throw noEncontrado();
  return e;
}
const formFicha = async (res, datos) => vista(res, "especialista-form", { titulo: datos.editando ? "Editar ficha" : "Nueva ficha", activo: "especialistas", categorias: await M.Categoria.todos((c) => c.estado !== "oculta"), DEPARTAMENTOS, errores: [], ...datos });

exports.formNuevo = async (req, res) => formFicha(res, { d: { modalidades: ["presencial"], idiomas: ["Español"], ubicacion: { departamento: "Montevideo" } }, editando: null });

exports.crear = async (req, res) => {
  const { errores, datos } = leerFicha(req.body);
  if (errores.length) return res.status(400) && formFicha(res, { d: { ...req.body, ubicacion: req.body, categorias: [].concat(req.body.categorias || []), modalidades: [].concat(req.body.modalidades || []) }, editando: null, errores });
  const e = await especialistas.crearPorAdmin({ ...datos, estado: "borrador" }, req.usuario);
  await M.Auditoria.registrar(req, { accion: "especialista.alta_admin", entidad: "especialista", entidadId: e.id, despues: { nombre: e.nombre } });
  ok(req, "Creamos la ficha. Cargá servicios y fotos; después invitá al especialista a reclamarla.");
  res.redirect(`/admin/especialistas/${e.id}`);
};

exports.especialista = async (req, res) => {
  const e = await especialista(req.params.id);
  const [cuenta, servicios, media, certificaciones, solicitudes, stats, comp, registros, cantReservas, denuncias] = await Promise.all([
    e.usuarioId ? M.Usuario.porId(e.usuarioId) : null,
    M.Servicio.todos((s) => s.especialistaId === e.id),
    M.Multimedia.todos((m) => m.especialistaId === e.id),
    M.Certificacion.todos((c) => c.especialistaId === e.id),
    M.Verificacion.todos((v) => v.especialistaId === e.id).then((l) => Modelo.ordenar(l, "creado")),
    tableroEspecialista(e.id, "90d"),
    especialistas.completitud(e),
    M.Auditoria.todos((a) => a.entidadId === e.id).then((l) => Modelo.ordenar(l, "creado").slice(0, 20)),
    M.Reserva.contar((r) => r.especialistaId === e.id),
    M.Denuncia.todos((d) => d.tipo === "especialista" && d.objetivoId === e.id),
  ]);
  vista(res, "especialista", {
    titulo: e.nombre, activo: "especialistas", e, cuenta, servicios, media, certificaciones, solicitudes, stats, comp, registros, cantReservas, denuncias,
    categorias: await M.Categoria.todos(), catMap: await M.Categoria.mapaPorIds([...(e.categorias || []), ...servicios.map((s) => s.categoriaId)]),
    nombresCampo: especialistas.NOMBRES_CAMPOS, enlaceReclamo: req.session.enlaceReclamo?.[e.id], enVivo: config.enVivo,
  });
};

exports.formEditar = async (req, res) => {
  const e = await especialista(req.params.id);
  formFicha(res, { d: e, editando: e.id });
};

exports.editar = async (req, res) => {
  const e = await especialista(req.params.id);
  const { errores, datos } = leerFicha(req.body);
  if (errores.length) return res.status(400) && formFicha(res, { d: { ...e, ...req.body, ubicacion: req.body, categorias: [].concat(req.body.categorias || []), modalidades: [].concat(req.body.modalidades || []) }, editando: e.id, errores });
  const antes = { nombre: e.nombre, comision: e.comision, plan: e.plan, categorias: e.categorias };
  if (datos.nombre !== e.nombre) e.slug = await especialistas.slugEspecialista(datos.nombre, e.id);
  if (datos.planVence) datos.planVence = F.aUtc(datos.planVence, "23:59").toISOString();
  Object.assign(e, datos);
  await M.Especialista.guardar(e);
  await M.Auditoria.registrar(req, { accion: "especialista.editar_admin", entidad: "especialista", entidadId: e.id, antes, despues: { nombre: e.nombre, comision: e.comision, plan: e.plan, categorias: e.categorias }, severidad: antes.comision !== e.comision ? "aviso" : "info" });
  ok(req, "Guardamos los cambios.");
  res.redirect(`/admin/especialistas/${e.id}`);
};

exports.estado = async (req, res) => {
  const { estado } = req.body; const motivo = texto(req.body.motivo, 300);
  if (!["activo", "suspendido", "inactivo", "borrador", "en_revision"].includes(estado)) throw invalido("Estado no válido.");
  if (estado === "suspendido" && motivo.length < 5) throw invalido("Indicá el motivo de la suspensión.");
  const { e, antes } = await especialistas.cambiarEstado(req.params.id, estado, motivo);
  await M.Auditoria.registrar(req, { accion: `especialista.estado.${estado}`, entidad: "especialista", entidadId: e.id, antes: { estado: antes }, despues: { estado, motivo }, severidad: estado === "suspendido" ? "aviso" : "info" });
  if (e.usuarioId && antes !== estado) {
    const txt = { activo: "Tu ficha está publicada en Alternativa.", suspendido: `Tu ficha fue suspendida. Motivo: ${motivo}`, inactivo: "Tu ficha fue desactivada.", borrador: `Tu ficha volvió a borrador para que completes algunos datos. ${motivo}`, en_revision: "Estamos revisando tu ficha." }[estado];
    await notificar(e.usuarioId, { tipo: "moderacion", titulo: estado === "activo" ? "¡Tu ficha está publicada!" : "Cambio en tu ficha", texto: txt, enlace: "/panel" });
  }
  ok(req, "Actualizamos el estado de la ficha.");
  res.redirect(`/admin/especialistas/${e.id}`);
};

exports.cambios = async (req, res) => {
  const aprobar = req.body.decision === "aprobar";
  const { e, cambio } = await especialistas.resolverCambio(req.params.id, req.body.campo, aprobar);
  const nombre = especialistas.NOMBRES_CAMPOS[cambio.campo] || cambio.campo;
  await M.Auditoria.registrar(req, { accion: `especialista.cambio.${aprobar ? "aprobar" : "rechazar"}`, entidad: "especialista", entidadId: e.id, despues: { campo: cambio.campo, valor: cambio.valor } });
  if (e.usuarioId) await notificar(e.usuarioId, { tipo: "moderacion", titulo: aprobar ? "Cambio aprobado" : "Cambio no aprobado", texto: `${nombre}: ${aprobar ? "ya se ve en tu ficha." : `no se aplicó. ${texto(req.body.nota, 300)}`}`, enlace: "/panel/perfil" });
  ok(req, aprobar ? "Aprobamos el cambio." : "Rechazamos el cambio.");
  res.redirect(req.body.volver === "pendientes" ? "/admin/pendientes" : `/admin/especialistas/${e.id}`);
};

exports.invitar = async (req, res) => {
  const e = await especialista(req.params.id);
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw invalido("Ingresá un email válido.");
  if (e.usuarioId) throw invalido("Este perfil ya tiene dueño.");
  const { url } = await especialistas.invitarAReclamar(e, email);
  await M.Auditoria.registrar(req, { accion: "especialista.invitar_reclamo", entidad: "especialista", entidadId: e.id, despues: { email } });
  if (!config.enVivo) req.session.enlaceReclamo = { ...(req.session.enlaceReclamo || {}), [e.id]: url };
  ok(req, `Enviamos la invitación a ${email}.`);
  res.redirect(`/admin/especialistas/${e.id}`);
};

exports.identidad = async (req, res) => {
  const e = await especialista(req.params.id);
  const estado = ["verificada", "rechazada"].includes(req.body.estado) ? req.body.estado : "ninguna";
  const antes = e.verificacion?.estado || "ninguna";
  e.verificacion = { estado, fecha: new Date().toISOString(), nota: texto(req.body.nota, 300), por: req.usuario.id };
  await M.Especialista.guardar(e);
  await M.Auditoria.registrar(req, { accion: "especialista.identidad", entidad: "especialista", entidadId: e.id, antes: { estado: antes }, despues: { estado, nota: e.verificacion.nota }, severidad: "seguridad" });
  ok(req, "Actualizamos la verificación de identidad.");
  res.redirect(`/admin/especialistas/${e.id}`);
};

exports.eliminar = async (req, res) => {
  const e = await especialista(req.params.id);
  const activas = await M.Reserva.contar((r) => r.especialistaId === e.id && M.Reserva.ACTIVAS.includes(r.estado) && new Date(r.inicio) > new Date());
  if (activas) throw invalido(`Tiene ${activas} reserva(s) próximas. Cancelalas o reprogramalas antes de dar de baja la ficha.`);
  e.eliminado = new Date().toISOString(); e.estado = "inactivo";
  await M.Especialista.guardar(e);
  await M.Auditoria.registrar(req, { accion: "especialista.baja", entidad: "especialista", entidadId: e.id, severidad: "aviso" });
  ok(req, "Dimos de baja la ficha. El historial de reservas y reseñas se conserva.");
  res.redirect("/admin/especialistas");
};

// Servicios y multimedia de fichas administradas (por ejemplo, perfiles sin reclamar)
exports.crearServicio = async (req, res) => {
  const e = await especialista(req.params.id);
  const { errores, datos } = leerServicio(req.body);
  if (errores.length) throw invalido(errores[0]);
  const cfg = await M.Config.obtener();
  const s = await M.Servicio.crear({
    ...datos, especialistaId: e.id, slug: await especialistas.slugServicio(e.id, datos.titulo), moneda: "UYU", fotos: [], estado: "activo", orden: await M.Servicio.contar((x) => x.especialistaId === e.id),
    rating: { prom: 0, cant: 0, suma: 0, ponderado: cfg.resenas.promedioBase, distribucion: [0, 0, 0, 0, 0] }, stats: { vistas: 0, reservas: 0, realizadas: 0 },
  });
  await M.Auditoria.registrar(req, { accion: "servicio.alta_admin", entidad: "servicio", entidadId: s.id, despues: { titulo: s.titulo, precio: s.precio } });
  ok(req, `Agregamos el servicio "${s.titulo}".`);
  res.redirect(`/admin/especialistas/${e.id}#servicios`);
};

exports.subirMultimedia = async (req, res) => {
  const e = await especialista(req.params.id);
  if (req.erroresSubida?.length) throw invalido(req.erroresSubida.join(" "));
  const a = lista(req, "archivo")[0];
  if (!a) throw invalido("Elegí un archivo.");
  const tipo = { perfil: "avatar", portada: "portada", foto: "foto", video: "video" }[req.body.tipo] || "foto";
  if ((tipo === "video") !== a.tipo.startsWith("video/")) throw invalido(tipo === "video" ? "Elegí un archivo de video." : "Elegí una imagen.");
  await M.Multimedia.crear({ especialistaId: e.id, usuarioId: req.usuario.id, tipo, url: a.url, mime: a.tipo, bytes: a.tamanio, epigrafe: texto(req.body.epigrafe, 200), visibilidad: "publica", estado: "aprobado", denuncias: 0, orden: 99 });
  if (["avatar", "portada", "video"].includes(tipo)) {
    for (const m of await M.Multimedia.todos((x) => x.especialistaId === e.id && x.tipo === tipo && x.url !== a.url)) await borrarMedia(m);
    e[tipo] = a.url;
    await M.Especialista.guardar(e);
  }
  ok(req, "Subimos el archivo.");
  res.redirect(`/admin/especialistas/${e.id}#multimedia`);
};

// ── Verificaciones (102) ─────────────────────────────────
exports.verificaciones = async (req, res) => {
  const estado = ["pendiente", "aprobada", "rechazada"].includes(req.query.estado) ? req.query.estado : "pendiente";
  const solicitudes = Modelo.ordenar(await M.Verificacion.todos((v) => v.estado === estado), "creado", estado !== "pendiente");
  const certs = Modelo.ordenar(await M.Certificacion.todos((c) => c.estado === "pendiente"), "creado", false);
  const ids = [...solicitudes.map((v) => v.especialistaId), ...certs.map((c) => c.especialistaId)];
  vista(res, "verificaciones", {
    titulo: "Verificaciones", activo: "verificaciones", estado, solicitudes, certs,
    esp: await M.Especialista.mapaPorIds(ids), usuarios: await M.Usuario.mapaPorIds(solicitudes.map((v) => v.usuarioId)),
    docs: await M.Multimedia.mapaPorIds([...solicitudes.flatMap((v) => v.documentos || []), ...certs.map((c) => c.documentoId).filter(Boolean)]),
  });
};

exports.resolverVerificacion = async (req, res) => {
  const v = await M.Verificacion.porId(req.params.id);
  if (!v) throw noEncontrado();
  if (v.estado !== "pendiente") throw invalido("Esta solicitud ya fue resuelta.");
  const aprobar = req.body.decision === "aprobar";
  const nota = texto(req.body.nota, 300);
  if (!aprobar && nota.length < 5) throw invalido("Indicá el motivo del rechazo: se lo mostramos al especialista.");
  v.estado = aprobar ? "aprobada" : "rechazada";
  v.revision = { fecha: new Date().toISOString(), nota, por: req.usuario.id };
  await M.Verificacion.guardar(v);
  const e = await M.Especialista.porId(v.especialistaId);
  e.verificacion = { estado: aprobar ? "verificada" : "rechazada", fecha: new Date().toISOString(), nota, por: req.usuario.id };
  await M.Especialista.guardar(e);
  await M.Auditoria.registrar(req, { accion: `verificacion.${aprobar ? "aprobar" : "rechazar"}`, entidad: "especialista", entidadId: e.id, despues: { nota }, severidad: "seguridad" });
  if (e.usuarioId) await notificar(e.usuarioId, { tipo: "verificacion", titulo: aprobar ? "Identidad verificada" : "Verificación no aprobada", texto: aprobar ? "Tu ficha ya muestra el sello de identidad verificada." : `Motivo: ${nota}. Podés enviarla de nuevo.`, enlace: "/panel/verificacion" });
  ok(req, aprobar ? `Verificamos la identidad de ${e.nombre}.` : "Rechazamos la solicitud y le avisamos al especialista.");
  res.redirect("/admin/verificaciones");
};

exports.resolverCertificacion = async (req, res) => {
  const c = await M.Certificacion.porId(req.params.id);
  if (!c) throw noEncontrado();
  const aprobar = req.body.decision === "aprobar";
  c.estado = aprobar ? "verificada" : "rechazada";
  c.revision = { fecha: new Date().toISOString(), nota: texto(req.body.nota, 300), por: req.usuario.id };
  await M.Certificacion.guardar(c);
  await M.Auditoria.registrar(req, { accion: `certificacion.${aprobar ? "verificar" : "rechazar"}`, entidad: "certificacion", entidadId: c.id, severidad: "seguridad" });
  const e = await M.Especialista.porId(c.especialistaId);
  if (e?.usuarioId) await notificar(e.usuarioId, { tipo: "verificacion", titulo: aprobar ? "Certificación verificada" : "Certificación no verificada", texto: `${c.titulo}${aprobar ? "" : `: ${c.revision.nota || "no pudimos validarla"}`}`, enlace: "/panel/certificaciones" });
  ok(req, aprobar ? "Marcamos la certificación como verificada." : "Marcamos la certificación como no verificada.");
  res.redirect("/admin/verificaciones");
};

// ── Usuarios (103 y 104) ─────────────────────────────────
exports.usuarios = async (req, res) => {
  const q = req.query;
  const l = Modelo.ordenar(await M.Usuario.todos((u) => u.estado !== "eliminado"
    && (!q.rol || u.rol === q.rol) && (!q.estado || u.estado === q.estado) && (!q.q || contiene(u.nombre, q.q) || contiene(u.email, q.q))), "creado");
  vista(res, "usuarios", { titulo: "Usuarios", activo: "usuarios", p: Modelo.paginar(l, q.page, 30) });
};

exports.usuario = async (req, res) => {
  const u = await M.Usuario.porId(req.params.id);
  if (!u) throw noEncontrado();
  const rs = Modelo.ordenar(await M.Reserva.todos((r) => r.usuarioId === u.id), "inicio").slice(0, 50);
  vista(res, "usuario", {
    titulo: u.nombre, activo: "usuarios", u, rs,
    consultas: Modelo.ordenar(await M.Consulta.todos((t) => t.usuarioId === u.id), "creado"),
    resenas: await M.Resena.todos((r) => r.usuarioId === u.id),
    denunciasSobre: await M.Denuncia.todos((d) => d.tipo === "usuario" && d.objetivoId === u.id),
    denunciasHechas: await M.Denuncia.todos((d) => d.denuncianteId === u.id),
    registros: Modelo.ordenar(await M.Auditoria.todos((a) => a.actorId === u.id || a.entidadId === u.id), "creado").slice(0, 30),
    ficha: u.especialistaId ? await M.Especialista.porId(u.especialistaId) : null,
    pagosTotal: (await M.Pago.todos((x) => x.usuarioId === u.id && ["aprobado", "reembolso_parcial"].includes(x.estado))).reduce((a, x) => a + x.monto, 0),
  });
};

exports.editarUsuario = async (req, res) => {
  const u = await M.Usuario.porId(req.params.id);
  if (!u) throw noEncontrado();
  const nombre = texto(req.body.nombre, 120); const rol = req.body.rol;
  if (nombre.length < 2) throw invalido("Escribí el nombre.");
  if (!M.Usuario.ROLES[rol]) throw invalido("Rol no válido.");
  if (u.id === req.usuario.id && rol !== "admin") throw invalido("No podés quitarte el rol de administración a vos mismo.");
  if (rol === "especialista" && !u.especialistaId) throw invalido("El rol de especialista se asigna al crear o reclamar una ficha.");
  const antes = { nombre: u.nombre, telefono: u.telefono, rol: u.rol, emailVerificado: !!u.emailVerificado };
  Object.assign(u, { nombre, telefono: texto(req.body.telefono, 40), rol, emailVerificado: req.body.emailVerificado ? u.emailVerificado || new Date().toISOString() : null });
  await M.Usuario.guardar(u);
  await M.Auditoria.registrar(req, { accion: "usuario.editar_admin", entidad: "usuario", entidadId: u.id, antes, despues: { nombre, telefono: u.telefono, rol, emailVerificado: !!u.emailVerificado }, severidad: antes.rol !== rol ? "seguridad" : "info" });
  ok(req, "Guardamos los cambios.");
  res.redirect(`/admin/usuarios/${u.id}`);
};

exports.estadoUsuario = async (req, res) => {
  const u = await M.Usuario.porId(req.params.id);
  if (!u) throw noEncontrado();
  if (u.id === req.usuario.id) throw invalido("No podés suspender tu propia cuenta.");
  const suspender = req.body.estado === "suspendido";
  const motivo = texto(req.body.motivo, 300);
  if (suspender && motivo.length < 5) throw invalido("Indicá el motivo de la suspensión.");
  const antes = u.estado;
  u.estado = suspender ? "suspendido" : "activo";
  u.suspension = suspender ? { motivo, fecha: new Date().toISOString(), por: req.usuario.id } : null;
  await M.Usuario.guardar(u);
  // Las sesiones abiertas quedan sin efecto: cargarUsuario descarta usuarios no activos en cada pedido.
  await M.Auditoria.registrar(req, { accion: `usuario.${suspender ? "suspender" : "reactivar"}`, entidad: "usuario", entidadId: u.id, antes: { estado: antes }, despues: { estado: u.estado, motivo }, severidad: "seguridad" });
  ok(req, suspender ? "Suspendimos la cuenta y cerramos sus sesiones." : "Reactivamos la cuenta.");
  res.redirect(`/admin/usuarios/${u.id}`);
};

// ── Servicios (105 y 106) ────────────────────────────────
exports.servicios = async (req, res) => {
  const q = req.query;
  const l = Modelo.ordenar(await M.Servicio.todos((s) => (!q.estado || s.estado === q.estado) && (!q.categoria || s.categoriaId === q.categoria)
    && (!q.especialista || s.especialistaId === q.especialista) && (!q.q || contiene(s.titulo, q.q))), "creado");
  const p = Modelo.paginar(l, q.page, 30);
  vista(res, "servicios", { titulo: "Servicios", activo: "servicios", p, categorias: await M.Categoria.todos(), catMap: await M.Categoria.mapaPorIds(p.items.map((s) => s.categoriaId)), espMap: await M.Especialista.mapaPorIds(p.items.map((s) => s.especialistaId)) });
};

exports.servicio = async (req, res) => {
  const s = await M.Servicio.porId(req.params.id);
  if (!s) throw noEncontrado();
  vista(res, "servicio", {
    titulo: s.titulo, activo: "servicios", s, e: await M.Especialista.porId(s.especialistaId), categorias: await M.Categoria.todos((c) => c.estado !== "oculta"),
    resenas: Modelo.ordenar(await M.Resena.todos((r) => r.servicioId === s.id), "creado").slice(0, 10), cantReservas: await M.Reserva.contar((r) => r.servicioId === s.id),
  });
};

exports.moderarServicio = async (req, res) => {
  const s = await M.Servicio.porId(req.params.id);
  if (!s) throw noEncontrado();
  const b = req.body;
  if (!M.Servicio.ESTADOS[b.estado]) throw invalido("Estado no válido.");
  const cat = await M.Categoria.porId(b.categoriaId);
  if (!cat) throw invalido("Elegí una categoría.");
  const titulo = texto(b.titulo, 120);
  if (titulo.length < 3) throw invalido("Escribí el nombre del servicio.");
  const antes = { estado: s.estado, categoriaId: s.categoriaId, titulo: s.titulo };
  if (titulo !== s.titulo) s.slug = await especialistas.slugServicio(s.especialistaId, titulo, s.id);
  Object.assign(s, { estado: b.estado, motivoEstado: texto(b.motivoEstado, 300), categoriaId: cat.id, titulo, resumen: texto(b.resumen, 240), descripcion: texto(b.descripcion, 5000) });
  await M.Servicio.guardar(s);
  await M.Auditoria.registrar(req, { accion: "servicio.moderar", entidad: "servicio", entidadId: s.id, antes, despues: { estado: s.estado, categoriaId: s.categoriaId, titulo: s.titulo }, severidad: s.estado === "suspendido" ? "aviso" : "info" });
  const e = await M.Especialista.porId(s.especialistaId);
  if (e?.usuarioId && antes.estado !== s.estado) await notificar(e.usuarioId, { tipo: "moderacion", titulo: `Servicio ${s.estado === "activo" ? "publicado" : s.estado === "suspendido" ? "suspendido" : "actualizado"}`, texto: `${s.titulo}${s.motivoEstado ? `: ${s.motivoEstado}` : ""}`, enlace: `/panel/servicios/${s.id}` });
  ok(req, "Guardamos los cambios del servicio.");
  res.redirect(b.volver === "pendientes" ? "/admin/pendientes" : `/admin/servicios/${s.id}`);
};

// ── Categorías (107 y 108) ───────────────────────────────
exports.categorias = async (req, res) => {
  const l = (await M.Categoria.todos()).sort((a, b) => ({ pendiente: 0, activa: 1, oculta: 2 }[a.estado] - { pendiente: 0, activa: 1, oculta: 2 }[b.estado]) || (a.orden || 0) - (b.orden || 0) || a.nombre.localeCompare(b.nombre));
  const servicios = await M.Servicio.todos();
  const cuenta = {};
  for (const s of servicios) cuenta[s.categoriaId] = (cuenta[s.categoriaId] || 0) + 1;
  vista(res, "categorias", { titulo: "Categorías", activo: "categorias", lista: l, cuenta, usuarios: await M.Usuario.mapaPorIds(l.map((c) => c.propuestaPor).filter(Boolean)) });
};

const formCategoria = (res, datos) => vista(res, "categoria-form", { titulo: datos.editando ? "Editar categoría" : "Nueva categoría", activo: "categorias", errores: [], ...datos });
exports.formNuevaCategoria = (req, res) => formCategoria(res, { d: { color: "#8B5CF6", icono: "leaf", estado: "activa", orden: 0 }, editando: null });

async function leerCategoria(req, actual) {
  const b = req.body; const errores = [];
  const nombre = texto(b.nombre, 80);
  if (nombre.length < 2) errores.push("Escribí el nombre.");
  const s = slug(b.slug || nombre);
  if (SLUGS_RESERVADOS.has(s)) errores.push("Ese enlace está reservado por el sistema. Elegí otro.");
  if (await M.Categoria.uno((c) => c.slug === s && c.id !== actual?.id)) errores.push("Ya existe una categoría con ese enlace.");
  const color = /^#[0-9a-fA-F]{6}$/.test(b.color || "") ? b.color : "#8B5CF6";
  if (!["activa", "pendiente", "oculta"].includes(b.estado)) errores.push("Estado no válido.");
  return {
    errores,
    datos: {
      nombre, slug: s, descripcion: texto(b.descripcion, 1000), descripcionLarga: texto(b.descripcionLarga, 6000), icono: texto(b.icono, 30) || "leaf", color,
      imagen: texto(b.imagen, 300), estado: b.estado, orden: num(b.orden, 0, 999, 0), destacada: !!b.destacada, seo: { titulo: texto(b.seoTitulo, 70), descripcion: texto(b.seoDescripcion, 160) },
    },
  };
}

exports.crearCategoria = async (req, res) => {
  const { errores, datos } = await leerCategoria(req, null);
  if (errores.length) return res.status(400) && formCategoria(res, { d: req.body, editando: null, errores });
  const c = await M.Categoria.crear(datos);
  await M.Auditoria.registrar(req, { accion: "categoria.crear", entidad: "categoria", entidadId: c.id, despues: { nombre: c.nombre } });
  ok(req, `Creamos la categoría ${c.nombre}.`);
  res.redirect("/admin/categorias");
};

exports.formEditarCategoria = async (req, res) => {
  const c = await M.Categoria.porId(req.params.id);
  if (!c) throw noEncontrado();
  formCategoria(res, { d: { ...c, seoTitulo: c.seo?.titulo, seoDescripcion: c.seo?.descripcion }, editando: c.id });
};

exports.editarCategoria = async (req, res) => {
  const c = await M.Categoria.porId(req.params.id);
  if (!c) throw noEncontrado();
  const { errores, datos } = await leerCategoria(req, c);
  if (errores.length) return res.status(400) && formCategoria(res, { d: { ...req.body, id: c.id }, editando: c.id, errores });
  const antes = { nombre: c.nombre, slug: c.slug, estado: c.estado };
  Object.assign(c, datos);
  await M.Categoria.guardar(c);
  await M.Auditoria.registrar(req, { accion: "categoria.editar", entidad: "categoria", entidadId: c.id, antes, despues: { nombre: c.nombre, slug: c.slug, estado: c.estado } });
  if (antes.estado === "pendiente" && c.estado === "activa" && c.propuestaPor) await notificar(c.propuestaPor, { tipo: "moderacion", titulo: "Aprobamos tu categoría", texto: `${c.nombre} ya está disponible para tus servicios.`, enlace: "/panel/servicios" });
  ok(req, "Guardamos la categoría.");
  res.redirect("/admin/categorias");
};

// ── Reservas (109 a 112) ─────────────────────────────────
exports.reservas = async (req, res) => {
  const q = req.query;
  const desde = F.fechaValida(q.desde) ? F.aUtc(q.desde) : null;
  const hasta = F.fechaValida(q.hasta) ? F.aUtc(F.sumarDias(q.hasta, 1)) : null;
  const l = (await M.Reserva.todos((r) => (!q.estado || r.estado === q.estado) && (q.incidencia !== "1" || r.incidencia?.abierta)
    && (!desde || new Date(r.inicio) >= desde) && (!hasta || new Date(r.inicio) < hasta)
    && (!q.especialista || r.especialistaId === q.especialista) && (!q.usuario || r.usuarioId === q.usuario) && (!q.servicio || r.servicioId === q.servicio)
    && (!q.q || r.codigo === String(q.q).toUpperCase().trim() || contiene(r.foto.usuario, q.q) || contiene(r.foto.especialista, q.q) || contiene(r.foto.servicio, q.q))))
    .sort((a, b) => b.inicio.localeCompare(a.inicio));
  const total = l.reduce((a, r) => a + (["pagada", "confirmada", "realizada"].includes(r.estado) ? r.foto.total : 0), 0);
  vista(res, "reservas", { titulo: "Reservas", activo: "reservas", p: Modelo.paginar(l, q.page, 30), total, cantidad: l.length });
};

async function reserva(id) {
  const r = await M.Reserva.porId(id);
  if (!r) throw noEncontrado();
  return r;
}

exports.reserva = async (req, res) => {
  const r = await reserva(req.params.id);
  const pago = r.pagoId ? await M.Pago.porId(r.pagoId) : null;
  vista(res, "reserva", {
    titulo: `Reserva ${r.codigo}`, activo: "reservas", r, pago,
    reembolsos: await M.Reembolso.todos((x) => x.reservaId === r.id), cliente: await M.Usuario.porId(r.usuarioId), e: await M.Especialista.porId(r.especialistaId),
    consultas: await M.Consulta.todos((t) => t.reservaId === r.id), resena: await M.Resena.uno((x) => x.reservaId === r.id),
    registros: Modelo.ordenar(await M.Auditoria.todos((a) => a.entidadId === r.id), "creado"),
    pendienteReembolso: pago ? pago.monto - (pago.reembolsado || 0) : 0,
  });
};

exports.cancelarReserva = async (req, res) => {
  const r = await reserva(req.params.id);
  const motivo = texto(req.body.motivo, 500);
  const pct = parseInt(req.body.porcentaje, 10);
  if (motivo.length < 5) throw invalido("Indicá el motivo de la cancelación.");
  if (!(pct >= 0 && pct <= 100)) throw invalido("El porcentaje de reembolso va de 0 a 100.");
  if (!["usuario", "especialista"].includes(req.body.atribuirA)) throw invalido("Indicá a quién se atribuye la cancelación.");
  const antes = { estado: r.estado };
  const { reembolso } = await reservas.cancelar({ reserva: r, actor: req.usuario, rol: "admin", motivo, porcentajeManual: pct, atribuirA: req.body.atribuirA });
  // El especialista también se entera cuando cancela administración.
  const e = await M.Especialista.porId(r.especialistaId);
  if (e?.usuarioId) await notificar(e.usuarioId, { tipo: "cancelada", titulo: "Reserva cancelada por Alternativa", texto: `${r.foto.servicio} del ${F.fFechaHora(r.inicio)} (${r.codigo}). Motivo: ${motivo}`, enlace: `/panel/reservas/${r.id}` });
  await M.Auditoria.registrar(req, { accion: "reserva.cancelar_admin", entidad: "reserva", entidadId: r.id, antes, despues: { estado: r.estado, porcentaje: pct, reembolso: reembolso?.monto, motivo }, severidad: "aviso" });
  req.session.flash = { tipo: !reembolso || reembolso.estado === "procesado" ? "ok" : "error", texto: `Cancelamos la reserva. ${reembolso ? `Reembolso ${reembolso.estado}${reembolso.error ? `: ${reembolso.error}` : ""}.` : "Sin reembolso."}` };
  res.redirect(`/admin/reservas/${r.id}`);
};

exports.estadoReserva = async (req, res) => {
  const r = await reserva(req.params.id);
  const accion = req.body.accion;
  const antes = { estado: r.estado };
  if (accion === "realizada") await reservas.marcarRealizada(r, { actor: req.usuario, rol: "admin" });
  else if (accion === "confirmar") await reservas.confirmarPorEspecialista(r, req.usuario);
  else if (accion === "ausencia_usuario" || accion === "ausencia_especialista") await reservas.cancelar({ reserva: r, actor: req.usuario, rol: "admin", tipo: accion, motivo: texto(req.body.motivo, 300) || (accion === "ausencia_usuario" ? "El cliente no se presentó" : "El especialista no se presentó"), atribuirA: accion === "ausencia_usuario" ? "usuario" : "especialista" });
  else throw invalido("Acción no válida.");
  await M.Auditoria.registrar(req, { accion: `reserva.${accion}_admin`, entidad: "reserva", entidadId: r.id, antes, despues: { estado: r.estado }, severidad: "aviso" });
  ok(req, `La reserva quedó: ${M.Reserva.ESTADOS[r.estado]?.texto || r.estado}.`);
  res.redirect(`/admin/reservas/${r.id}`);
};

exports.incidencia = async (req, res) => {
  const r = await reserva(req.params.id);
  const abrir = req.body.abrir === "1";
  const nota = texto(req.body.nota, 1000);
  r.incidencia = { abierta: abrir, nota: nota || r.incidencia?.nota || "", fecha: new Date().toISOString() };
  r.historial = [...(r.historial || []), { estado: r.estado, fecha: new Date().toISOString(), por: req.usuario.id, rol: "admin", nota: `${abrir ? "Incidencia abierta" : "Incidencia cerrada"}${nota ? `: ${nota}` : ""}` }];
  await M.Reserva.guardar(r);
  await M.Auditoria.registrar(req, { accion: `reserva.incidencia_${abrir ? "abrir" : "cerrar"}`, entidad: "reserva", entidadId: r.id, despues: { nota } });
  ok(req, abrir ? "Abrimos la incidencia: la reserva no se cierra sola hasta resolverla." : "Cerramos la incidencia.");
  res.redirect(`/admin/reservas/${r.id}`);
};

exports.reembolso = async (req, res) => {
  const r = await reserva(req.params.id);
  const pago = r.pagoId ? await M.Pago.porId(r.pagoId) : null;
  if (!pago || !["aprobado", "reembolso_parcial", "en_disputa"].includes(pago.estado)) throw invalido("La reserva no tiene un pago acreditado para reembolsar.");
  const pct = parseInt(req.body.porcentaje, 10); const motivo = texto(req.body.motivo, 300);
  if (!(pct >= 1 && pct <= 100) || motivo.length < 5) throw invalido("Indicá el porcentaje (1 a 100) y el motivo.");
  const rep = repartirReembolso({ total: r.foto.total, comision: r.foto.comision, porcentaje: pct });
  const queda = pago.monto - (pago.reembolsado || 0);
  if (rep.monto > queda) throw invalido(`Solo quedan $ ${queda} sin reembolsar.`);
  const rb = await pagos.reembolsar({ reserva: r, pago, rep, porcentaje: pct, motivo, regla: "admin_manual", actor: req.usuario, rol: "admin" });
  await M.Auditoria.registrar(req, { accion: "reembolso.admin", entidad: "reserva", entidadId: r.id, despues: { monto: rep.monto, porcentaje: pct, estado: rb?.estado, motivo }, severidad: "aviso" });
  req.session.flash = rb?.estado === "procesado" ? { tipo: "ok", texto: `Reembolsamos $ ${rep.monto}.` } : { tipo: "error", texto: `El reembolso quedó ${rb?.estado}: ${rb?.error || ""}` };
  res.redirect(`/admin/reservas/${r.id}`);
};
