/* Crecimiento: destacados (exposición paga), promociones institucionales y contenido editable (pantallas 122, 123, 126 y 127). */
const M = require("../models");
const Modelo = require("../models/Modelo");
const F = require("../services/fechas");
const { notificar } = require("../services/notificaciones");
const { invalido, noEncontrado } = require("../services/errores");
const { texto, slug, DEPARTAMENTOS } = require("../services/util");
const { num } = require("../services/formularios");
const { lista } = require("../middlewares/subida");

const vista = (res, v, datos) => res.render(`admin/${v}`, { area: "admin", ...datos });
const ok = (req, t) => { req.session.flash = { tipo: "ok", texto: t }; };

// 122: destacados
exports.destacados = async (req, res) => {
  const l = Modelo.ordenar(await M.Destacado.todos(), "creado");
  vista(res, "destacados", {
    titulo: "Destacados", activo: "destacados", lista: l, DEPARTAMENTOS,
    especialistas: (await M.Especialista.todos((e) => e.estado === "activo")).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    categorias: await M.Categoria.activas(), espMap: await M.Especialista.mapaPorIds(l.map((d) => d.especialistaId)),
    catMap: await M.Categoria.mapaPorIds(l.map((d) => d.categoriaId).filter(Boolean)), servMap: await M.Servicio.mapaPorIds(l.map((d) => d.servicioId).filter(Boolean)),
  });
};

exports.crearDestacado = async (req, res) => {
  const b = req.body;
  const e = await M.Especialista.porId(b.especialistaId);
  if (!e) throw invalido("Elegí el especialista.");
  if (!M.Destacado.TIPOS[b.tipo]) throw invalido("Elegí dónde se muestra.");
  if (b.tipo === "categoria" && !(await M.Categoria.porId(b.categoriaId))) throw invalido("Elegí la categoría.");
  if (!F.fechaValida(b.desde) || !F.fechaValida(b.hasta) || b.hasta < b.desde) throw invalido("Revisá las fechas de inicio y fin.");
  const desde = F.aUtc(b.desde);
  const d = await M.Destacado.crear({
    especialistaId: e.id, servicioId: null, tipo: b.tipo, categoriaId: b.tipo === "categoria" ? b.categoriaId : null,
    departamento: b.tipo === "zona" ? (DEPARTAMENTOS.includes(b.departamento) ? b.departamento : e.ubicacion?.departamento) : null,
    palabras: texto(b.palabras, 200).split(",").map((k) => slug(k).replace(/-/g, " ")).filter(Boolean),
    desde: desde.toISOString(), hasta: F.aUtc(F.sumarDias(b.hasta, 1)).toISOString(), precio: Math.max(0, parseInt(b.precio, 10) || 0),
    estadoPago: ["pendiente", "pagado", "bonificado"].includes(b.estadoPago) ? b.estadoPago : "pendiente", estado: desde <= new Date() ? "activo" : "programado",
    impresiones: 0, clics: 0, notas: texto(b.notas, 400), creadoPor: req.usuario.id,
  });
  await M.Auditoria.registrar(req, { accion: "destacado.crear", entidad: "destacado", entidadId: d.id, despues: { especialista: e.nombre, tipo: d.tipo, precio: d.precio } });
  ok(req, `Creamos el destacado de ${e.nombre}.`);
  res.redirect("/admin/destacados");
};

exports.actualizarDestacado = async (req, res) => {
  const d = await M.Destacado.porId(req.params.id);
  if (!d) throw noEncontrado();
  const b = req.body;
  const antes = { estado: d.estado, estadoPago: d.estadoPago, precio: d.precio };
  if (M.Destacado.ESTADOS[b.estado]) d.estado = b.estado;
  if (["pendiente", "pagado", "bonificado"].includes(b.estadoPago)) d.estadoPago = b.estadoPago;
  if (b.precio !== undefined && b.precio !== "" && Number.isFinite(Number(b.precio))) d.precio = Math.max(0, Math.round(Number(b.precio)));
  if (d.estado === "activo" && new Date(d.desde) > new Date()) d.estado = "programado";
  await M.Destacado.guardar(d);
  await M.Auditoria.registrar(req, { accion: "destacado.editar", entidad: "destacado", entidadId: d.id, antes, despues: { estado: d.estado, estadoPago: d.estadoPago, precio: d.precio } });
  const e = await M.Especialista.porId(d.especialistaId);
  if (e?.usuarioId && antes.estado !== d.estado && ["activo", "programado"].includes(d.estado)) await notificar(e.usuarioId, { tipo: "cuenta", titulo: "Tu destacado está aprobado", texto: `Se muestra del ${F.fFecha(d.desde)} al ${F.fFecha(new Date(new Date(d.hasta) - 1))}.`, enlace: "/panel/destacados" });
  ok(req, "Actualizamos el destacado.");
  res.redirect("/admin/destacados");
};

// 123: promociones (las institucionales las financia Alternativa con su tarifa)
exports.promociones = async (req, res) => {
  const l = Modelo.ordenar(await M.Promocion.todos(), "creado");
  vista(res, "promociones", { titulo: "Promociones", activo: "promociones", lista: l, espMap: await M.Especialista.mapaPorIds(l.map((p) => p.especialistaId).filter(Boolean)), hoy: F.hoy() });
};

exports.crearPromocion = async (req, res) => {
  const b = req.body;
  const titulo = texto(b.titulo, 100); const descuento = parseInt(b.descuento, 10);
  if (!titulo) throw invalido("Escribí el título.");
  if (!(descuento >= 1 && descuento <= 50)) throw invalido("El descuento va de 1% a 50%.");
  const codigo = texto(b.codigo, 20).toUpperCase();
  if (codigo && !/^[A-Z0-9-]+$/.test(codigo)) throw invalido("El código solo puede tener letras, números y guiones.");
  if (codigo && (await M.Promocion.uno((p) => p.codigo === codigo && ["activa", "pausada"].includes(p.estado)))) throw invalido("Ya hay una promoción vigente con ese código.");
  const p = await M.Promocion.crear({
    especialistaId: null, servicios: [], titulo, descripcion: texto(b.descripcion, 500), descuento, financia: "plataforma",
    publico: ["todos", "nuevos", "recurrentes"].includes(b.publico) ? b.publico : "todos", codigo,
    desde: F.fechaValida(b.desde) ? F.aUtc(b.desde).toISOString() : null, hasta: F.fechaValida(b.hasta) ? F.aUtc(F.sumarDias(b.hasta, 1)).toISOString() : null,
    maxUsos: Math.max(0, parseInt(b.maxUsos, 10) || 0), usos: 0, estado: "activa", creadaPor: req.usuario.id,
  });
  await M.Auditoria.registrar(req, { accion: "promocion.crear", entidad: "promocion", entidadId: p.id, despues: { titulo, descuento, codigo } });
  ok(req, "Creamos la promoción institucional.");
  res.redirect("/admin/promociones");
};

exports.estadoPromocion = async (req, res) => {
  const p = await M.Promocion.porId(req.params.id);
  if (!p) throw noEncontrado();
  if (!M.Promocion.ESTADOS[req.body.estado]) throw invalido("Estado no válido.");
  const antes = p.estado;
  p.estado = req.body.estado;
  await M.Promocion.guardar(p);
  await M.Auditoria.registrar(req, { accion: "promocion.estado", entidad: "promocion", entidadId: p.id, antes: { estado: antes }, despues: { estado: p.estado } });
  ok(req, `La promoción quedó ${M.Promocion.ESTADOS[p.estado].toLowerCase()}.`);
  res.redirect("/admin/promociones");
};

// 126 y 127: contenido (blog, preguntas frecuentes y páginas)
const TIPO = (t) => (M.Contenido.TIPOS[t] ? t : "articulo");

exports.contenido = async (req, res) => {
  const tipo = TIPO(req.query.tipo);
  const l = await M.Contenido.todos((c) => c.tipo === tipo);
  if (tipo === "faq") l.sort((a, b) => String(a.categoria).localeCompare(String(b.categoria)) || (a.orden || 0) - (b.orden || 0));
  else Modelo.ordenar(l, (c) => c.actualizado || c.creado);
  const cuentas = {};
  for (const c of await M.Contenido.todos()) cuentas[c.tipo] = (cuentas[c.tipo] || 0) + 1;
  vista(res, "contenido", { titulo: "Contenido", activo: "contenido", tipo, lista: l, cuentas });
};

const formContenido = (res, datos) => vista(res, "contenido-form", { titulo: datos.editando ? "Editar contenido" : "Nuevo contenido", activo: "contenido", errores: [], ...datos });
exports.formNuevoContenido = (req, res) => formContenido(res, { d: { tipo: TIPO(req.query.tipo), estado: "borrador", publico: "todos", orden: 0 }, editando: null });

async function leerContenido(req, actual) {
  const b = req.body; const errores = [];
  const tipo = TIPO(b.tipo);
  const titulo = texto(b.titulo, 200); const cuerpo = texto(b.cuerpo, 60000);
  if (titulo.length < 3) errores.push("Escribí el título.");
  if (cuerpo.length < 3) errores.push("Escribí el contenido.");
  const s = slug(b.slug || titulo);
  if (await M.Contenido.uno((c) => c.tipo === tipo && c.slug === s && c.id !== actual?.id)) errores.push("Ya existe contenido con ese enlace.");
  const estado = b.estado === "publicado" ? "publicado" : "borrador";
  return {
    errores,
    datos: {
      tipo, titulo, slug: s, resumen: texto(b.resumen, 400), cuerpo, portada: texto(b.portada, 300), categoria: texto(b.categoria, 60),
      publico: ["todos", "usuarios", "especialistas"].includes(b.publico) ? b.publico : "todos",
      etiquetas: texto(b.etiquetas, 200).split(",").map((t) => slug(t)).filter((t) => t && t !== "item"), estado, orden: num(b.orden, 0, 999, 0),
      seo: { titulo: texto(b.seoTitulo, 70), descripcion: texto(b.seoDescripcion, 160) },
      publicado: estado === "publicado" ? actual?.publicado || new Date().toISOString() : actual?.publicado || null,
    },
  };
}

exports.crearContenido = async (req, res) => {
  const { errores, datos } = await leerContenido(req, null);
  if (errores.length) return res.status(400) && formContenido(res, { d: req.body, editando: null, errores });
  const c = await M.Contenido.crear({ ...datos, autorId: req.usuario.id });
  await M.Auditoria.registrar(req, { accion: "contenido.crear", entidad: "contenido", entidadId: c.id, despues: { titulo: c.titulo, tipo: c.tipo } });
  ok(req, "Creamos el contenido.");
  res.redirect(`/admin/contenido?tipo=${c.tipo}`);
};

exports.formEditarContenido = async (req, res) => {
  const c = await M.Contenido.porId(req.params.id);
  if (!c) throw noEncontrado();
  formContenido(res, { d: { ...c, etiquetas: (c.etiquetas || []).join(", "), seoTitulo: c.seo?.titulo, seoDescripcion: c.seo?.descripcion }, editando: c.id });
};

exports.editarContenido = async (req, res) => {
  const c = await M.Contenido.porId(req.params.id);
  if (!c) throw noEncontrado();
  const { errores, datos } = await leerContenido(req, c);
  if (errores.length) return res.status(400) && formContenido(res, { d: { ...req.body, id: c.id }, editando: c.id, errores });
  Object.assign(c, datos);
  await M.Contenido.guardar(c);
  await M.Auditoria.registrar(req, { accion: "contenido.editar", entidad: "contenido", entidadId: c.id, despues: { titulo: c.titulo, estado: c.estado } });
  ok(req, "Guardamos el contenido.");
  res.redirect(`/admin/contenido?tipo=${c.tipo}`);
};

exports.eliminarContenido = async (req, res) => {
  const c = await M.Contenido.porId(req.params.id);
  if (!c) throw noEncontrado();
  await M.Contenido.eliminar(c.id);
  await M.Auditoria.registrar(req, { accion: "contenido.eliminar", entidad: "contenido", entidadId: c.id, antes: { titulo: c.titulo }, severidad: "aviso" });
  ok(req, "Eliminamos el contenido.");
  res.redirect(`/admin/contenido?tipo=${c.tipo}`);
};

exports.subirImagen = async (req, res) => {
  if (req.erroresSubida?.length) throw invalido(req.erroresSubida.join(" "));
  const a = lista(req, "archivo")[0];
  if (!a) throw invalido("Elegí una imagen.");
  await M.Multimedia.crear({ especialistaId: null, usuarioId: req.usuario.id, tipo: "contenido", url: a.url, mime: a.tipo, bytes: a.tamanio, epigrafe: a.nombreOriginal, visibilidad: "publica", estado: "aprobado", denuncias: 0, orden: 0 });
  req.session.flash = { tipo: "ok", texto: `Subimos la imagen. Usala con esta dirección: ${a.url}` };
  res.redirect(req.body.volver && String(req.body.volver).startsWith("/admin/") ? req.body.volver : "/admin/contenido");
};
