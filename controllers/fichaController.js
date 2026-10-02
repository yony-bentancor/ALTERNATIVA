/* Ficha del especialista: perfil, apariencia, fotos y video, servicios, verificación y certificaciones (pantallas 57 a 66, 87, 88). */
const M = require("../models");
const especialistas = require("../services/especialistas");
const { comisionPara, desglose } = require("../services/comision");
const { tableroEspecialista } = require("../services/estadisticas");
const { notificarAdmins } = require("../services/notificaciones");
const { invalido, noEncontrado, prohibido } = require("../services/errores");
const { texto, DEPARTAMENTOS } = require("../services/util");
const { lista } = require("../middlewares/subida");
const { leerServicio } = require("../services/formularios");

const vista = (res, v, datos) => res.render(`panel/${v}`, { area: "panel", ...datos });
const num = (v, min, max, def = null) => { const n = Number(v); return Number.isFinite(n) && v !== "" ? Math.min(max, Math.max(min, n)) : def; };

const { borrarMedia } = require("../services/multimedia");

// 57: mi perfil
exports.perfil = async (req, res) => {
  const e = req.especialista;
  vista(res, "perfil", { titulo: "Mi perfil", activo: "perfil", e, comp: await especialistas.completitud(e), categorias: await M.Categoria.todos((c) => (e.categorias || []).includes(c.id)), galeria: await M.Multimedia.galeria(e.id) });
};

// 58: editar perfil
exports.formEditar = async (req, res) => vista(res, "editar-perfil", { titulo: "Editar perfil", activo: "perfil", e: req.especialista, d: req.especialista, categorias: await M.Categoria.activas(), errores: [] });

exports.editar = async (req, res) => {
  const e = req.especialista;
  const d = req.body;
  const categorias = [].concat(d.categorias || []).filter(Boolean).slice(0, 6);
  const modalidades = [].concat(d.modalidades || []).filter((m) => ["presencial", "domicilio", "online"].includes(m));
  const errores = [];
  if (texto(d.nombre).length < 2) errores.push("Escribí tu nombre profesional.");
  if (!categorias.length) errores.push("Elegí al menos una categoría.");
  if (!modalidades.length) errores.push("Elegí al menos una modalidad.");
  if (d.departamento && !DEPARTAMENTOS.includes(d.departamento)) errores.push("Departamento no válido.");
  const lat = num(d.lat, -35.2, -30); const lng = num(d.lng, -58.6, -53);
  if ((d.lat || d.lng) && (lat === null || lng === null)) errores.push("Las coordenadas del mapa no son válidas para Uruguay.");
  if (errores.length) return res.status(400).render("panel/editar-perfil", { titulo: "Editar perfil", area: "panel", activo: "perfil", e, d: { ...e, ...d, categorias, modalidades }, categorias: await M.Categoria.activas(), errores });
  const antes = { nombre: e.nombre, categorias: e.categorias };
  const { pendientes } = await especialistas.aplicarCambios(e, {
    nombre: texto(d.nombre, 120), categorias, titular: texto(d.titular, 160), bio: texto(d.bio, 4000), experiencia: texto(d.experiencia, 3000), anios: num(d.anios, 0, 80, 0),
    formacion: texto(d.formacion, 3000), idiomas: texto(d.idiomas, 120).split(",").map((x) => x.trim()).filter(Boolean), modalidades,
    ubicacion: { departamento: d.departamento || "", ciudad: texto(d.ciudad, 80), barrio: texto(d.barrio, 80), direccion: texto(d.direccion, 200), referencia: texto(d.referencia, 160), lat, lng, radioKm: num(d.radioKm, 0, 200, 10) },
    telefono: texto(d.telefono, 40), whatsapp: texto(d.whatsapp, 40), mostrarWhatsapp: !!d.mostrarWhatsapp, redes: { instagram: texto(d.instagram, 60).replace(/^@/, ""), web: texto(d.web, 200) },
  }, { rol: "especialista" });
  await M.Auditoria.registrar(req, { accion: "especialista.perfil", entidad: "especialista", entidadId: e.id, antes, despues: { nombre: d.nombre, categorias, pendientes } });
  if (pendientes.length) {
    await notificarAdmins({ titulo: "Cambios sensibles para revisar", texto: `${e.nombre} pidió cambiar: ${pendientes.join(", ")}.`, enlace: `/admin/especialistas/${e.id}`, tipo: "admin" });
    req.session.flash = { tipo: "info", texto: "Guardamos tus cambios. El nombre y las categorías se publican después de una revisión rápida." };
  } else req.session.flash = { tipo: "ok", texto: "Guardamos tu perfil." };
  res.redirect("/panel/perfil");
};

// Apariencia de la ficha
exports.formApariencia = async (req, res) => vista(res, "apariencia", { titulo: "Apariencia de la ficha", activo: "perfil", e: req.especialista, servicios: await M.Servicio.deEspecialista(req.especialista.id, true) });

exports.apariencia = async (req, res) => {
  const PERMITIDAS = ["servicios", "sobre", "galeria", "video", "resenas", "ubicacion"];
  const orden = [...new Set([].concat(req.body.orden || []).filter((x) => PERMITIDAS.includes(x)))];
  for (const k of PERMITIDAS) if (!orden.includes(k)) orden.push(k);
  const e = req.especialista;
  const dest = await M.Servicio.porId(req.body.servicioDestacado);
  e.diseno = { variante: ["clasica", "serena", "luminosa"].includes(req.body.variante) ? req.body.variante : "clasica", orden, servicioDestacado: dest && dest.especialistaId === e.id ? dest.id : null, videoPrimero: !!req.body.videoPrimero };
  if (e.diseno.videoPrimero) e.diseno.orden = ["video", ...orden.filter((x) => x !== "video")];
  await M.Especialista.guardar(e);
  req.session.flash = { tipo: "ok", texto: "Guardamos la apariencia de tu ficha." };
  res.redirect("/panel/perfil/apariencia");
};

// 60 a 62: fotos y video
exports.multimedia = async (req, res) => {
  const cfg = await M.Config.obtener();
  const l = (await M.Multimedia.todos((m) => m.especialistaId === req.especialista.id && m.tipo !== "documento")).sort((a, b) => a.tipo.localeCompare(b.tipo) || (a.orden || 0) - (b.orden || 0));
  vista(res, "multimedia", { titulo: "Fotos y video", activo: "multimedia", e: req.especialista, lista: l, limites: cfg.multimedia });
};

exports.formSubir = async (req, res) => {
  const tipo = ["foto", "video", "perfil", "portada", "espacio"].includes(req.query.tipo) ? req.query.tipo : "foto";
  vista(res, "subir", { titulo: tipo === "video" ? "Subir video" : "Subir fotografía", activo: "multimedia", tipo, limites: (await M.Config.obtener()).multimedia });
};

exports.subir = async (req, res) => {
  const e = req.especialista;
  const cfg = await M.Config.obtener();
  if (req.erroresSubida?.length) throw invalido(req.erroresSubida.join(" "));
  const archivos = lista(req, "archivo");
  if (!archivos.length) throw invalido("Elegí un archivo.");
  const mapa = { foto: "foto", espacio: "espacio", video: "video", perfil: "avatar", portada: "portada" };
  const tipo = mapa[req.body.tipo] || "foto";
  const fotos = await M.Multimedia.contar((m) => m.especialistaId === e.id && ["foto", "espacio", "servicio"].includes(m.tipo));
  if (["foto", "espacio"].includes(tipo) && fotos + archivos.length > cfg.multimedia.maxFotos) throw invalido(`Podés tener hasta ${cfg.multimedia.maxFotos} fotos.`);
  for (const a of archivos) {
    const esVideo = a.tipo.startsWith("video/");
    if (tipo === "video" && !esVideo) throw invalido("Para el video subí un archivo MP4, WEBM o MOV.");
    if (tipo !== "video" && esVideo) throw invalido("Ese archivo es un video: elegí \"Subir video\".");
  }
  const estado = cfg.moderacion.multimedia && ["foto", "espacio", "video"].includes(tipo) ? "pendiente" : "aprobado";
  for (const a of archivos) {
    await M.Multimedia.crear({ especialistaId: e.id, usuarioId: req.usuario.id, tipo, url: a.url, mime: a.tipo, bytes: a.tamanio, epigrafe: texto(req.body.epigrafe, 200), visibilidad: "publica", estado, denuncias: 0, orden: fotos + 1 });
  }
  // Foto de perfil, portada y video son únicos: el nuevo reemplaza al anterior.
  const url = archivos[0].url;
  if (["avatar", "portada", "video"].includes(tipo)) {
    const anteriores = await M.Multimedia.todos((m) => m.especialistaId === e.id && m.tipo === tipo && m.url !== url);
    for (const m of anteriores) await borrarMedia(m);
    e[tipo] = url;
    if (tipo === "video") e.poster = "";
    await M.Especialista.guardar(e);
  }
  req.session.flash = { tipo: "ok", texto: estado === "pendiente" ? "Subimos el archivo. Se publica después de una revisión." : archivos.length > 1 ? `Subimos ${archivos.length} fotos.` : "Subimos el archivo." };
  res.redirect("/panel/perfil/multimedia");
};

exports.editarMedia = async (req, res) => {
  const m = await M.Multimedia.porId(req.params.id);
  if (!m || m.especialistaId !== req.especialista.id) throw noEncontrado();
  const e = req.especialista;
  if (req.body.accion === "eliminar") {
    if (e.avatar === m.url) e.avatar = "";
    if (e.portada === m.url) e.portada = "";
    if (e.video === m.url) e.video = "";
    await M.Especialista.guardar(e);
    await borrarMedia(m);
    req.session.flash = { tipo: "ok", texto: "Eliminamos el archivo." };
  } else if (["subir", "bajar"].includes(req.body.accion)) {
    const hermanos = (await M.Multimedia.todos((x) => x.especialistaId === e.id && ["foto", "espacio", "servicio"].includes(x.tipo))).sort((a, b) => (a.orden || 0) - (b.orden || 0));
    hermanos.forEach((x, i) => { x.orden = i; });
    const i = hermanos.findIndex((x) => x.id === m.id);
    const j = req.body.accion === "subir" ? i - 1 : i + 1;
    if (j >= 0 && j < hermanos.length) [hermanos[i].orden, hermanos[j].orden] = [hermanos[j].orden, hermanos[i].orden];
    await M.Multimedia.guardar(null);
  } else if (req.body.accion === "portada" && ["foto", "espacio"].includes(m.tipo)) {
    e.portada = m.url;
    await M.Especialista.guardar(e);
    req.session.flash = { tipo: "ok", texto: "Usamos esa foto como portada." };
  } else {
    m.epigrafe = texto(req.body.epigrafe, 200);
    if (["foto", "espacio"].includes(req.body.tipo) && ["foto", "espacio"].includes(m.tipo)) m.tipo = req.body.tipo;
    await M.Multimedia.guardar(m);
    req.session.flash = { tipo: "ok", texto: "Guardamos los cambios." };
  }
  res.redirect("/panel/perfil/multimedia");
};

// 63 a 66: servicios
exports.servicios = async (req, res) => {
  const l = await M.Servicio.deEspecialista(req.especialista.id);
  vista(res, "servicios", { titulo: "Servicios", activo: "servicios", lista: l, cats: await M.Categoria.mapaPorIds(l.map((s) => s.categoriaId)) });
};

async function datosFormServicio(e) {
  return { categorias: await M.Categoria.activas(), modalidadesEsp: e.modalidades, cfg: await M.Config.obtener() };
}


exports.formNuevoServicio = async (req, res) => vista(res, "servicio-form", { titulo: "Nuevo servicio", activo: "servicios", ...(await datosFormServicio(req.especialista)), d: { duracion: 60, modalidades: req.especialista.modalidades, incluye: "" }, editando: null, errores: [] });

exports.crearServicio = async (req, res) => {
  const e = req.especialista;
  const { errores, datos } = leerServicio(req.body);
  const cat = await M.Categoria.porId(datos.categoriaId);
  if (!cat || cat.estado !== "activa") errores.push("Elegí una categoría válida.");
  if (errores.length) return res.status(400).render("panel/servicio-form", { titulo: "Nuevo servicio", area: "panel", activo: "servicios", ...(await datosFormServicio(e)), d: req.body, editando: null, errores });
  const cfg = await M.Config.obtener();
  const s = await M.Servicio.crear({
    ...datos, especialistaId: e.id, slug: await especialistas.slugServicio(e.id, datos.titulo), moneda: "UYU", fotos: [],
    estado: cfg.moderacion.serviciosNuevos && e.estado === "activo" ? "en_revision" : "activo", orden: await M.Servicio.contar((x) => x.especialistaId === e.id),
    rating: { prom: 0, cant: 0, suma: 0, ponderado: cfg.resenas.promedioBase, distribucion: [0, 0, 0, 0, 0] }, stats: { vistas: 0, reservas: 0, realizadas: 0 },
  });
  await M.Auditoria.registrar(req, { accion: "servicio.crear", entidad: "servicio", entidadId: s.id, despues: { titulo: s.titulo, precio: s.precio } });
  req.session.flash = { tipo: "ok", texto: s.estado === "en_revision" ? "Creamos el servicio. Se publica después de una revisión." : "Creamos el servicio." };
  res.redirect(`/panel/servicios/${s.id}`);
};

async function servicioPropio(req) {
  const s = await M.Servicio.porId(req.params.id);
  if (!s || s.especialistaId !== req.especialista.id) throw noEncontrado();
  return s;
}

exports.servicio = async (req, res) => {
  const s = await servicioPropio(req);
  const cfg = await M.Config.obtener();
  const com = await comisionPara({ especialista: req.especialista, categoriaId: s.categoriaId });
  const d = desglose({ precio: s.precio, tasa: com.tasa, modo: cfg.comision.modo, procesadorPct: cfg.pagos.comisionProcesador, procesadorPaga: cfg.pagos.procesadorPaga });
  const stats = await tableroEspecialista(req.especialista.id, "90d");
  vista(res, "servicio", { titulo: s.titulo, activo: "servicios", s, d, com, cat: await M.Categoria.porId(s.categoriaId), resenas: (await M.Resena.visiblesDeServicio(s.id)).slice(0, 5), perf: stats.porServicio.find((x) => x.id === s.id), e: req.especialista });
};

exports.formEditarServicio = async (req, res) => {
  const s = await servicioPropio(req);
  vista(res, "servicio-form", { titulo: "Editar servicio", activo: "servicios", ...(await datosFormServicio(req.especialista)), d: { ...s, incluye: (s.incluye || []).join("\n") }, editando: s.id, errores: [] });
};

exports.editarServicio = async (req, res) => {
  const s = await servicioPropio(req);
  const { errores, datos } = leerServicio(req.body);
  if (errores.length) return res.status(400).render("panel/servicio-form", { titulo: "Editar servicio", area: "panel", activo: "servicios", ...(await datosFormServicio(req.especialista)), d: { ...req.body, id: s.id }, editando: s.id, errores });
  const cfg = await M.Config.obtener();
  const antes = { titulo: s.titulo, precio: s.precio, duracion: s.duracion, categoriaId: s.categoriaId };
  if (s.categoriaId !== datos.categoriaId && req.especialista.estado === "activo" && cfg.moderacion.cambiosSensibles) { s.estado = "en_revision"; s.motivoEstado = "Cambio de categoría pendiente de revisión"; }
  if (s.titulo !== datos.titulo) s.slug = await especialistas.slugServicio(req.especialista.id, datos.titulo, s.id);
  Object.assign(s, datos);
  await M.Servicio.guardar(s);
  // Los cambios de precio se publican al instante; las reservas existentes conservan su precio (foto de la reserva).
  await M.Auditoria.registrar(req, { accion: "servicio.editar", entidad: "servicio", entidadId: s.id, antes, despues: { titulo: s.titulo, precio: s.precio, duracion: s.duracion, categoriaId: s.categoriaId } });
  req.session.flash = { tipo: "ok", texto: s.estado === "en_revision" ? "Guardamos los cambios. El cambio de categoría se revisa antes de publicarse." : "Guardamos los cambios. Las reservas ya hechas mantienen su precio original." };
  res.redirect(`/panel/servicios/${s.id}`);
};

exports.estadoServicio = async (req, res) => {
  const s = await servicioPropio(req);
  if (s.estado === "suspendido") throw prohibido("Este servicio fue suspendido por administración. Escribinos desde Ayuda.");
  if (s.estado === "en_revision") throw invalido("El servicio está en revisión.");
  s.estado = s.estado === "activo" ? "pausado" : "activo";
  await M.Servicio.guardar(s);
  req.session.flash = { tipo: "ok", texto: s.estado === "activo" ? "El servicio vuelve a estar publicado." : "Pausaste el servicio: no recibe reservas nuevas." };
  res.redirect(`/panel/servicios/${s.id}`);
};

exports.eliminarServicio = async (req, res) => {
  const s = await servicioPropio(req);
  if (await M.Reserva.uno((r) => r.servicioId === s.id)) {
    // Con historial no se borra (reservas y reseñas lo referencian): se pausa.
    if (s.estado !== "suspendido") s.estado = "pausado";
    await M.Servicio.guardar(s);
    req.session.flash = { tipo: "info", texto: "Este servicio tiene reservas en su historial, así que lo pausamos en lugar de borrarlo." };
  } else {
    await M.Servicio.eliminar(s.id);
    req.session.flash = { tipo: "ok", texto: "Eliminamos el servicio." };
  }
  res.redirect("/panel/servicios");
};

exports.fotosServicio = async (req, res) => {
  const s = await servicioPropio(req);
  if (req.body.quitar) {
    s.fotos = (s.fotos || []).filter((f) => f !== req.body.quitar);
    const m = await M.Multimedia.uno((x) => x.url === req.body.quitar && x.especialistaId === req.especialista.id && x.tipo === "servicio");
    if (m) await borrarMedia(m);
  } else {
    if (req.erroresSubida?.length) throw invalido(req.erroresSubida.join(" "));
    const a = lista(req, "archivo")[0];
    if (!a) throw invalido("Elegí una foto.");
    if ((s.fotos || []).length >= 6) throw invalido("Cada servicio puede tener hasta 6 fotos.");
    await M.Multimedia.crear({ especialistaId: req.especialista.id, usuarioId: req.usuario.id, tipo: "servicio", servicioId: s.id, url: a.url, mime: a.tipo, bytes: a.tamanio, epigrafe: s.titulo, visibilidad: "publica", estado: "aprobado", denuncias: 0, orden: 99 });
    s.fotos = [...(s.fotos || []), a.url];
  }
  await M.Servicio.guardar(s);
  res.redirect(`/panel/servicios/${s.id}`);
};

// 87: verificación de identidad
exports.verificacion = async (req, res) => {
  const l = (await M.Verificacion.todos((v) => v.especialistaId === req.especialista.id)).sort((a, b) => b.creado.localeCompare(a.creado));
  vista(res, "verificacion", { titulo: "Verificación", activo: "verificacion", e: req.especialista, solicitudes: l, docs: await M.Multimedia.mapaPorIds(l.flatMap((v) => v.documentos || [])) });
};

exports.verificar = async (req, res) => {
  const e = req.especialista;
  if (e.verificacion?.estado === "verificada") throw invalido("Tu identidad ya está verificada.");
  if (e.verificacion?.estado === "pendiente") throw invalido("Ya tenemos tu documentación en revisión. Te avisamos apenas la revisemos.");
  if (req.erroresSubida?.length) throw invalido(req.erroresSubida.join(" "));
  const docs = lista(req, "documentos");
  if (!docs.length) throw invalido("Subí al menos una foto o PDF de tu documento.");
  const ids = [];
  for (const a of docs.slice(0, 3)) ids.push((await M.Multimedia.crear({ especialistaId: e.id, usuarioId: req.usuario.id, tipo: "documento", url: a.url, mime: a.tipo, bytes: a.tamanio, epigrafe: "Documento de identidad", visibilidad: "privada", estado: "aprobado", denuncias: 0, orden: 0 })).id);
  await M.Verificacion.crear({ especialistaId: e.id, usuarioId: req.usuario.id, tipo: "identidad", documentos: ids, documentoUltimos4: String(req.body.documento || "").replace(/\D/g, "").slice(-4), notas: texto(req.body.notas, 500), estado: "pendiente", revision: {} });
  e.verificacion = { estado: "pendiente" };
  await M.Especialista.guardar(e);
  await notificarAdmins({ titulo: "Verificación de identidad pendiente", texto: `${e.nombre} envió su documentación.`, enlace: "/admin/verificaciones", tipo: "admin" });
  req.session.flash = { tipo: "ok", texto: "Recibimos tu documentación. La revisamos en menos de 48 h hábiles." };
  res.redirect("/panel/verificacion");
};

// 88: certificaciones
exports.certificaciones = async (req, res) => {
  const l = (await M.Certificacion.todos((c) => c.especialistaId === req.especialista.id)).sort((a, b) => (b.anio || 0) - (a.anio || 0));
  vista(res, "certificaciones", { titulo: "Certificaciones", activo: "verificacion", lista: l, categorias: await M.Categoria.todos((c) => (req.especialista.categorias || []).includes(c.id)) });
};

exports.crearCertificacion = async (req, res) => {
  if (req.erroresSubida?.length) throw invalido(req.erroresSubida.join(" "));
  const titulo = texto(req.body.titulo, 160);
  if (!titulo) throw invalido("Escribí el título de la certificación.");
  const doc = lista(req, "documento")[0];
  let documentoId = null;
  if (doc) documentoId = (await M.Multimedia.crear({ especialistaId: req.especialista.id, usuarioId: req.usuario.id, tipo: "documento", url: doc.url, mime: doc.tipo, bytes: doc.tamanio, epigrafe: titulo, visibilidad: "privada", estado: "aprobado", denuncias: 0, orden: 0 })).id;
  await M.Certificacion.crear({ especialistaId: req.especialista.id, titulo, institucion: texto(req.body.institucion, 160), anio: num(req.body.anio, 1950, new Date().getFullYear()), categoriaId: req.body.categoriaId || null, documentoId, estado: doc ? "pendiente" : "declarada", revision: {} });
  if (doc) await notificarAdmins({ titulo: "Certificación para verificar", texto: `${req.especialista.nombre}: ${titulo}`, enlace: "/admin/verificaciones", tipo: "admin" });
  req.session.flash = { tipo: "ok", texto: doc ? "Agregamos la certificación. Se muestra como declarada hasta que la verifiquemos." : "Agregamos la certificación como declarada. Subí el documento si querés que la verifiquemos." };
  res.redirect("/panel/certificaciones");
};

exports.eliminarCertificacion = async (req, res) => {
  const c = await M.Certificacion.porId(req.params.id);
  if (!c || c.especialistaId !== req.especialista.id) throw noEncontrado();
  if (c.documentoId) await borrarMedia(await M.Multimedia.porId(c.documentoId));
  await M.Certificacion.eliminar(c.id);
  req.session.flash = { tipo: "ok", texto: "Eliminamos la certificación." };
  res.redirect("/panel/certificaciones");
};

