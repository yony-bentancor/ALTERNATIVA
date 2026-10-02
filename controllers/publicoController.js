/* Sitio público: lo que ve cualquier persona sin registrarse (pantallas 1 a 25). */
const config = require("../config");
const store = require("../config/store");
const M = require("../models");
const Modelo = require("../models/Modelo");
const { buscar, seccionesInicio, tarjetas, datosBase } = require("../services/busqueda");
const { registrar } = require("../services/estadisticas");
const { comisionPara, desglose } = require("../services/comision");
const { describirPolitica } = require("../services/cancelacion");
const { proximoTurno } = require("../services/disponibilidad");
const { whatsappVisible } = require("../services/mensajeria");
const { denunciar } = require("../services/resenas");
const { noEncontrado } = require("../services/errores");
const { DEPARTAMENTOS, EMAIL, texto } = require("../services/util");

const favoritosDe = (req) => M.Favorito.idsDe(req.usuario?.id);

// ── Inicio ───────────────────────────────────────────────
exports.inicio = async (req, res) => {
  const s = await seccionesInicio();
  const articulos = (await M.Contenido.publicados("articulo")).slice(0, 3);
  let proxima = null;
  if (req.usuario) {
    const prox = await M.Reserva.todos((r) => r.usuarioId === req.usuario.id && ["pagada", "confirmada"].includes(r.estado) && new Date(r.inicio) > new Date());
    proxima = prox.sort((a, b) => a.inicio.localeCompare(b.inicio))[0] || null;
  }
  res.render("public/inicio", { titulo: null, activo: "inicio", ...s, articulos, proxima, favoritos: await favoritosDe(req) });
};

// ── Búsqueda (pantallas 2, 3 y 4) ────────────────────────
function parametros(q) {
  return {
    q: String(q.q || "").slice(0, 120),
    categoria: q.categoria ? String(q.categoria) : undefined,
    departamento: DEPARTAMENTOS.includes(q.departamento) ? q.departamento : undefined,
    ciudad: q.ciudad ? String(q.ciudad).slice(0, 60) : undefined,
    modalidad: ["presencial", "domicilio", "online"].includes(q.modalidad) ? q.modalidad : undefined,
    cuando: ["hoy", "manana", "semana"].includes(q.cuando) ? q.cuando : undefined,
    precioMax: Number(q.precioMax) > 0 ? Number(q.precioMax) : undefined,
    rating: ["3", "4", "4.5"].includes(q.valoracion) ? Number(q.valoracion) : undefined,
    verificado: q.verificado === "1",
    orden: ["relevancia", "precio", "valoracion", "distancia"].includes(q.orden) ? q.orden : undefined,
    lat: Number.isFinite(Number(q.lat)) && q.lat ? Number(q.lat) : undefined,
    lng: Number.isFinite(Number(q.lng)) && q.lng ? Number(q.lng) : undefined,
    page: q.page,
  };
}

exports.buscar = async (req, res) => {
  const p = parametros(req.query);
  const resultado = await buscar(p);
  res.render("public/buscar", { titulo: p.q ? `Resultados para "${p.q}"` : "Buscar", activo: "buscar", p, resultado, categorias: await M.Categoria.activas(), favoritos: await favoritosDe(req) });
};

// ── Categorías (pantallas 5 y 6) ─────────────────────────
exports.categorias = async (req, res) => {
  const { catalogo } = require("../services/especialistas");
  const cat = await catalogo();
  const conteo = {};
  for (const i of cat) conteo[i.categoria.id] = (conteo[i.categoria.id] || 0) + 1;
  const categorias = (await M.Categoria.activas()).map((c) => ({ ...c, cantidad: conteo[c.id] || 0 }));
  res.render("public/categorias", { titulo: "Categorías", descripcion: "Todas las terapias y disciplinas de bienestar disponibles en Alternativa.", categorias });
};

exports.categoria = async (req, res, next) => {
  const slug = String(req.params.slug).toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug)) return next();
  const categoria = await M.Categoria.uno((c) => c.slug === slug && c.estado === "activa");
  if (!categoria) return next();
  const p = { ...parametros(req.query), categoria: slug, q: "" };
  const resultado = await buscar(p);
  const articulos = (await M.Contenido.publicados("articulo")).filter((x) => (x.etiquetas || []).includes(slug)).slice(0, 3);
  res.render("public/categoria", { titulo: categoria.seo?.titulo || categoria.nombre, descripcion: categoria.seo?.descripcion || categoria.descripcion, imagenOg: categoria.imagen, categoria, p, resultado, articulos, favoritos: await favoritosDe(req) });
};

// ── Ficha del especialista (pantallas 7 y 10) ────────────
async function especialistaPublico(req, slug) {
  const e = await M.Especialista.porSlug(slug);
  if (!e || e.eliminado) throw noEncontrado("Este perfil no existe o ya no está publicado.");
  const propio = req.usuario && req.usuario.especialistaId === e.id;
  const admin = req.usuario?.rol === "admin";
  if (e.estado !== "activo" && !propio && !admin) throw noEncontrado("Este perfil no está publicado en este momento.");
  return { e, vistaPrevia: e.estado !== "activo", propio };
}

exports.especialista = async (req, res) => {
  const { e, vistaPrevia, propio } = await especialistaPublico(req, req.params.slug);
  const { cfg, reglas } = await datosBase();
  const categorias = await M.Categoria.todos((c) => (e.categorias || []).includes(c.id));
  const catMap = new Map((await M.Categoria.todos()).map((c) => [c.id, c]));
  const servicios = (await M.Servicio.deEspecialista(e.id)).filter((s) => s.estado === "activo" || propio);
  const cards = tarjetas(servicios.map((s) => ({ servicio: s, especialista: e, categoria: catMap.get(s.categoriaId) || categorias[0] || {}, nuevo: false, verificado: e.verificacion?.estado === "verificada" })), { cfg, reglas });
  const galeria = await M.Multimedia.galeria(e.id);
  const resenas = await M.Resena.visiblesDeEspecialista(e.id);
  const servMap = new Map(servicios.map((s) => [s.id, s]));
  const certificaciones = await M.Certificacion.todos((x) => x.especialistaId === e.id && ["declarada", "verificada", "pendiente"].includes(x.estado));
  const proximo = servicios[0] ? await proximoTurno({ especialistaId: e.id, servicio: servicios[0] }) : null;
  const wa = await whatsappVisible(e, req.usuario);
  const favoritos = await favoritosDe(req);
  if (!vistaPrevia && !propio) await registrar({ especialistaId: e.id, campo: "visitasPerfil", req });
  res.render("public/especialista", {
    titulo: e.nombre, descripcion: e.titular, imagenOg: e.portada || e.avatar, e, vistaPrevia, propio, cards, galeria, resenas: resenas.slice(0, 6), totalResenas: resenas.length,
    servMap, certificaciones, categorias, proximo, wa, favorito: favoritos.has(e.id), favoritos, reservable: !!e.usuarioId && e.estado === "activo",
  });
};

exports.galeria = async (req, res) => {
  const { e } = await especialistaPublico(req, req.params.slug);
  res.render("public/galeria", { titulo: `Fotos y video de ${e.nombre}`, e, galeria: await M.Multimedia.galeria(e.id) });
};

// ── Servicio (pantallas 8 y 9) ───────────────────────────
async function servicioPublico(req) {
  const { e, vistaPrevia, propio } = await especialistaPublico(req, req.params.espSlug);
  const s = await M.Servicio.uno((x) => x.especialistaId === e.id && x.slug === String(req.params.slug).toLowerCase());
  if (!s || (s.estado !== "activo" && !propio && req.usuario?.rol !== "admin")) throw noEncontrado("Este servicio no está disponible.");
  return { e, s, vistaPrevia, propio, categoria: await M.Categoria.porId(s.categoriaId) };
}

exports.servicio = async (req, res) => {
  const { e, s, vistaPrevia, propio, categoria } = await servicioPublico(req);
  const { cfg, reglas } = await datosBase();
  const com = await comisionPara({ especialista: e, categoriaId: s.categoriaId });
  const d = desglose({ precio: s.precio, tasa: com.tasa, modo: cfg.comision.modo, procesadorPct: cfg.pagos.comisionProcesador, procesadorPaga: cfg.pagos.procesadorPaga });
  const resenas = await M.Resena.visiblesDeServicio(s.id);
  const otros = tarjetas((await M.Servicio.deEspecialista(e.id, true)).filter((x) => x.id !== s.id).map((x) => ({ servicio: x, especialista: e, categoria: categoria || {}, nuevo: false, verificado: e.verificacion?.estado === "verificada" })), { cfg, reglas });
  const promos = await M.Promocion.todos((p) => M.Promocion.vigente(p) && p.especialistaId === e.id && (!p.servicios?.length || p.servicios.includes(s.id)) && !p.codigo);
  if (req.query.ad) {
    const dst = await M.Destacado.porId(String(req.query.ad));
    if (dst) { dst.clics = (dst.clics || 0) + 1; await M.Destacado.guardar(dst); }
  }
  if (!vistaPrevia && !propio) await registrar({ especialistaId: e.id, servicioId: s.id, campo: "visitasServicio", req });
  res.render("public/servicio", {
    titulo: `${s.titulo} con ${e.nombre}`, descripcion: s.resumen, imagenOg: s.fotos?.[0] || e.portada, e, s, categoria, d, resenas: resenas.slice(0, 5), totalResenas: resenas.length,
    otros, promos, proximo: await proximoTurno({ especialistaId: e.id, servicio: s }), vistaPrevia, propio, reservable: !!e.usuarioId && e.estado === "activo" && s.estado === "activo",
    wa: await whatsappVisible(e, req.usuario), favoritos: await favoritosDe(req),
  });
};

exports.resenasServicio = async (req, res) => {
  const { e, s } = await servicioPublico(req);
  let lista = await M.Resena.visiblesDeServicio(s.id);
  const estrellas = ["1", "2", "3", "4", "5"].includes(req.query.estrellas) ? Number(req.query.estrellas) : null;
  if (estrellas) lista = lista.filter((r) => r.puntaje === estrellas);
  res.render("public/resenas", { titulo: `Reseñas de ${s.titulo}`, e, s, p: Modelo.paginar(lista, req.query.page, 15), estrellas, motivos: M.Denuncia.MOTIVOS });
};

// ── Denunciar contenido ──────────────────────────────────
exports.reportar = async (req, res) => {
  const { tipo, objetivoId, motivo, detalle } = req.body;
  if (!["resena", "multimedia", "especialista", "servicio"].includes(tipo) || !M.Denuncia.MOTIVOS[motivo] || !objetivoId) {
    req.session.flash = { tipo: "error", texto: "Elegí un motivo para el reporte." };
    return res.redirect(req.get("referer") || "/");
  }
  if (tipo === "resena") {
    const r = await M.Resena.porId(objetivoId);
    if (r) await denunciar(r, req.usuario, { motivo, detalle: texto(detalle, 2000) });
  } else {
    await M.Denuncia.crear({ denuncianteId: req.usuario.id, rolDenunciante: req.usuario.rol, tipo, objetivoId, motivo, detalle: texto(detalle, 2000), estado: "abierta" });
    if (tipo === "multimedia") { const m = await M.Multimedia.porId(objetivoId); if (m) { m.denuncias = (m.denuncias || 0) + 1; if (m.denuncias >= 2) m.estado = "reportado"; await M.Multimedia.guardar(m); } }
  }
  req.session.flash = { tipo: "ok", texto: "Gracias. Recibimos tu reporte y lo vamos a revisar." };
  res.redirect(req.get("referer") || "/");
};

// ── Contenido institucional (11 a 19) ────────────────────
exports.pagina = (slug) => async (req, res) => {
  const pagina = await M.Contenido.pagina(slug);
  if (!pagina) throw noEncontrado();
  res.render("public/pagina", { titulo: pagina.titulo, descripcion: pagina.resumen, pagina, slug });
};

exports.cancelaciones = async (req, res) => {
  const cfg = await M.Config.obtener();
  res.render("public/cancelaciones", { titulo: "Política de cancelaciones", pagina: await M.Contenido.pagina("cancelaciones"), reglas: describirPolitica(cfg.cancelacion) });
};

exports.preguntas = async (req, res) => {
  const faqs = await M.Contenido.publicados("faq");
  const grupos = {};
  for (const f of faqs) (grupos[f.categoria || "General"] ||= []).push(f);
  res.render("public/preguntas", { titulo: "Preguntas frecuentes", grupos });
};

exports.ofrecer = async (req, res) => {
  const cfg = await M.Config.obtener();
  const ejemplo = desglose({ precio: 1000, tasa: cfg.comision.tasaGeneral, modo: cfg.comision.modo, procesadorPct: cfg.pagos.comisionProcesador, procesadorPaga: cfg.pagos.procesadorPaga });
  const { catalogo } = require("../services/especialistas");
  const cat = await catalogo();
  res.render("public/ofrecer", { titulo: "Ofrecé tus servicios", ejemplo, totalEspecialistas: new Set(cat.map((i) => i.especialista.id)).size, categorias: await M.Categoria.activas() });
};

exports.contacto = (req, res) => res.render("public/contacto", { titulo: "Contacto", datos: { nombre: req.usuario?.nombre || "", email: req.usuario?.email || "" }, errores: [], temas: M.Consulta.TEMAS });

exports.enviarContacto = async (req, res) => {
  const d = req.body;
  if (d.web) return res.redirect("/contacto"); // trampa para bots
  const errores = [];
  if (!texto(d.nombre)) errores.push("Escribí tu nombre.");
  if (!EMAIL.test(d.email || "")) errores.push("Escribí un correo válido.");
  if (!texto(d.asunto)) errores.push("Escribí un asunto.");
  if (texto(d.mensaje, 5000).length < 10) errores.push("Contanos un poco más en el mensaje.");
  if (errores.length) return res.status(400).render("public/contacto", { titulo: "Contacto", datos: d, errores, temas: M.Consulta.TEMAS });
  const t = await M.Consulta.crear({
    numero: store.siguienteNumero("consulta"), usuarioId: req.usuario?.id || null, nombre: texto(d.nombre, 120), email: texto(d.email, 200), tema: M.Consulta.TEMAS[d.tema] ? d.tema : "otro",
    asunto: texto(d.asunto, 200), estado: "abierta", prioridad: "normal", mensajes: [{ autorId: req.usuario?.id || null, rol: req.usuario ? req.usuario.rol : "visitante", texto: texto(d.mensaje, 5000), fecha: new Date().toISOString() }],
  });
  await require("../services/notificaciones").notificarAdmins({ titulo: `Nueva consulta #${t.numero}`, texto: t.asunto, enlace: `/admin/soporte/${t.id}`, tipo: "admin" });
  req.session.flash = { tipo: "ok", texto: `Recibimos tu mensaje (#${t.numero}). Te respondemos por email a la brevedad.` };
  res.redirect("/contacto");
};

// ── Blog (15 y 16) ───────────────────────────────────────
exports.blog = async (req, res) => {
  let lista = await M.Contenido.publicados("articulo");
  const temas = [...new Set(lista.map((x) => x.categoria).filter(Boolean))];
  if (req.query.tema) lista = lista.filter((x) => x.categoria === req.query.tema);
  res.render("public/blog", { titulo: "Blog", descripcion: "Notas sobre bienestar, terapias y hábitos saludables.", p: Modelo.paginar(lista, req.query.page, 9), temas, tema: req.query.tema || "" });
};

exports.articulo = async (req, res) => {
  const a = await M.Contenido.uno((x) => x.tipo === "articulo" && x.slug === String(req.params.slug).toLowerCase() && x.estado === "publicado");
  if (!a) throw noEncontrado("Este artículo no existe o ya no está publicado.");
  const relacionados = (await M.Contenido.publicados("articulo")).filter((x) => x.id !== a.id).slice(0, 3);
  res.render("public/articulo", { titulo: a.titulo, descripcion: a.resumen, imagenOg: a.portada, a, relacionados });
};

// ── SEO técnico ──────────────────────────────────────────
exports.robots = (req, res) => {
  res.type("text/plain").send(config.enVivo
    ? `User-agent: *\nDisallow: /mi\nDisallow: /panel\nDisallow: /admin\nDisallow: /api\nDisallow: /reservar\nDisallow: /pago\nSitemap: ${config.urlSitio}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n");
};

exports.sitemap = async (req, res) => {
  const { catalogo } = require("../services/especialistas");
  const cat = await catalogo();
  const u = (loc, prioridad = "0.6") => `<url><loc>${config.urlSitio}${loc}</loc><priority>${prioridad}</priority></url>`;
  const urls = [u("/", "1.0"), u("/categorias", "0.8"), u("/como-funciona"), u("/sobre-alternativa"), u("/preguntas-frecuentes"), u("/blog"), u("/ofrecer"),
    ...(await M.Categoria.activas()).map((c) => u(`/${c.slug}`, "0.9")),
    ...[...new Set(cat.map((i) => i.especialista.slug))].map((s) => u(`/especialistas/${s}`, "0.8")),
    ...cat.map((i) => u(`/servicios/${i.especialista.slug}/${i.servicio.slug}`, "0.7")),
    ...(await M.Contenido.publicados("articulo")).map((a) => u(`/blog/${a.slug}`, "0.5"))];
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`);
};

