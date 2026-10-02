/* Negocio del especialista: reseñas, configuración, cobros (Mercado Pago), promociones, destacados y plan (84, 85, 89, 91 a 93). */
const crypto = require("crypto");
const config = require("../config");
const store = require("../config/store");
const M = require("../models");
const Modelo = require("../models/Modelo");
const F = require("../services/fechas");
const resenas = require("../services/resenas");
const { notificarAdmins } = require("../services/notificaciones");
const { invalido, noEncontrado, prohibido } = require("../services/errores");
const { texto, EMAIL } = require("../services/util");

const vista = (res, v, datos) => res.render(`panel/${v}`, { area: "panel", ...datos });

// 84 y 85: reseñas y respuestas
exports.resenas = async (req, res) => {
  const e = req.especialista;
  let l = Modelo.ordenar(await M.Resena.todos((r) => r.especialistaId === e.id), "creado");
  if (req.query.servicio) l = l.filter((r) => r.servicioId === req.query.servicio);
  if (req.query.sinResponder === "1") l = l.filter((r) => !r.respuesta);
  const servicios = await M.Servicio.deEspecialista(e.id);
  vista(res, "resenas", { titulo: "Reseñas", activo: "resenas", p: Modelo.paginar(l, req.query.page, 20), servicios, servMap: new Map(servicios.map((s) => [s.id, s])), motivos: M.Denuncia.MOTIVOS, e });
};

async function resenaPropia(req) {
  const r = await M.Resena.porId(req.params.id);
  if (!r || r.especialistaId !== req.especialista.id) throw noEncontrado();
  return r;
}

exports.responder = async (req, res) => {
  const r = await resenaPropia(req);
  await resenas.responder(r, req.especialista, req.body.texto);
  req.session.flash = { tipo: "ok", texto: "Publicamos tu respuesta." };
  res.redirect(`/panel/resenas#r-${r.id}`);
};

exports.pedirRevision = async (req, res) => {
  const r = await resenaPropia(req);
  if (!M.Denuncia.MOTIVOS[req.body.motivo]) throw invalido("Elegí un motivo.");
  await resenas.pedirRevision(r, req.usuario, { motivo: req.body.motivo, detalle: req.body.detalle });
  await M.Auditoria.registrar(req, { accion: "resena.pedido_revision", entidad: "resena", entidadId: r.id, resumen: req.body.motivo });
  req.session.flash = { tipo: "ok", texto: "Enviamos tu pedido de revisión. La reseña sigue visible mientras la analizamos." };
  res.redirect("/panel/resenas");
};

// 89: configuración de cuenta
exports.cuenta = async (req, res) => vista(res, "cuenta", { titulo: "Configuración", activo: "configuracion", e: req.especialista });

exports.guardarCuenta = async (req, res) => {
  const e = req.especialista;
  const b = req.body;
  if (b.email && !EMAIL.test(b.email)) throw invalido("El correo para liquidaciones no es válido.");
  const antes = { facturacion: e.facturacion };
  e.ajustes = { autoConfirmar: !!b.autoConfirmar, permitirReprogramar: !!b.permitirReprogramar };
  e.facturacion = {
    razonSocial: texto(b.razonSocial, 160), rut: texto(b.rut, 20), tipo: ["", "monotributo", "literal_e", "empresa", "otro"].includes(b.tipo) ? b.tipo : "",
    metodo: ["", "banco", "mercadopago"].includes(b.metodo) ? b.metodo : "", banco: texto(b.banco, 80), titular: texto(b.titular, 120), cuenta: texto(b.cuenta, 40), tipoCuenta: texto(b.tipoCuenta, 40), email: texto(b.email, 200),
  };
  await M.Especialista.guardar(e);
  await M.Auditoria.registrar(req, { accion: "especialista.facturacion", entidad: "especialista", entidadId: e.id, antes, despues: { facturacion: e.facturacion } });
  req.session.flash = { tipo: "ok", texto: "Guardamos la configuración." };
  res.redirect("/panel/cuenta");
};

// Cobros: vinculación de Mercado Pago (split automático)
exports.cobros = async (req, res) => vista(res, "cobros", { titulo: "Cobros", activo: "cobros", e: req.especialista, proveedor: config.pagos.proveedor, oauthListo: !!(config.pagos.mp.clientId && config.pagos.mp.clientSecret), enVivo: config.enVivo });

exports.conectarMp = async (req, res) => {
  if (!config.pagos.mp.clientId) throw invalido("La vinculación con Mercado Pago todavía no está configurada. Avisale a soporte.");
  const estado = crypto.randomBytes(16).toString("hex");
  req.session.estadoMp = estado;
  res.redirect(require("../services/pagos/mercadopago").urlOAuth(estado));
};

exports.retornoMp = async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== req.session.estadoMp) throw invalido("No pudimos validar la vinculación. Intentá de nuevo.");
  delete req.session.estadoMp;
  const mp = require("../services/pagos/mercadopago");
  const t = await mp.canjearCodigo(String(code));
  const e = req.especialista;
  e.mercadopago = mp.datosCuenta(t);
  await M.Especialista.guardar(e);
  await M.Auditoria.registrar(req, { accion: "especialista.mp_vincular", entidad: "especialista", entidadId: e.id, despues: { usuarioMp: e.mercadopago.usuarioMp }, severidad: "seguridad" });
  req.session.flash = { tipo: "ok", texto: "Vinculaste tu cuenta de Mercado Pago. Ya podés recibir reservas pagas." };
  res.redirect("/panel/cuenta/cobros");
};

// Solo en modo demostración (pasarela simulada)
exports.simularMp = async (req, res) => {
  if (config.enVivo || config.pagos.proveedor !== "simulado") throw prohibido();
  const e = req.especialista;
  e.mercadopago = { usuarioMp: "SIMULADO", conectado: new Date().toISOString(), simulado: true };
  await M.Especialista.guardar(e);
  req.session.flash = { tipo: "ok", texto: "Vinculamos una cuenta de cobro de prueba." };
  res.redirect("/panel/cuenta/cobros");
};

exports.desconectarMp = async (req, res) => {
  const e = req.especialista;
  const pendientes = await M.Reserva.contar((r) => r.especialistaId === e.id && ["pagada", "confirmada"].includes(r.estado) && new Date(r.inicio) > new Date());
  if (pendientes) throw invalido(`Tenés ${pendientes} reserva(s) próximas pagadas. Desvinculá la cuenta cuando no haya reservas pendientes, para poder gestionar reembolsos.`);
  e.mercadopago = {};
  await M.Especialista.guardar(e);
  await M.Auditoria.registrar(req, { accion: "especialista.mp_desvincular", entidad: "especialista", entidadId: e.id, severidad: "seguridad" });
  req.session.flash = { tipo: "ok", texto: "Desvinculaste tu cuenta de cobro. Tu ficha no recibe reservas pagas hasta que vincules otra." };
  res.redirect("/panel/cuenta/cobros");
};

// 91: promociones
exports.promociones = async (req, res) => {
  vista(res, "promociones", { titulo: "Promociones", activo: "promociones", lista: Modelo.ordenar(await M.Promocion.todos((p) => p.especialistaId === req.especialista.id), "creado"), servicios: await M.Servicio.deEspecialista(req.especialista.id), hoy: F.hoy() });
};

exports.crearPromocion = async (req, res) => {
  const b = req.body;
  const titulo = texto(b.titulo, 100); const descuento = parseInt(b.descuento, 10);
  if (!titulo) throw invalido("Escribí un título.");
  if (!(descuento >= 5 && descuento <= 50)) throw invalido("El descuento tiene que estar entre 5% y 50%.");
  const codigo = texto(b.codigo, 20).toUpperCase();
  if (codigo && !/^[A-Z0-9-]+$/.test(codigo)) throw invalido("El código solo puede tener letras, números y guiones.");
  const mios = new Set((await M.Servicio.deEspecialista(req.especialista.id)).map((s) => s.id));
  const servicios = [].concat(b.servicios || []).filter((x) => mios.has(x));
  await M.Promocion.crear({
    especialistaId: req.especialista.id, servicios, titulo, descripcion: texto(b.descripcion, 500), descuento, financia: "especialista",
    publico: ["todos", "nuevos", "recurrentes"].includes(b.publico) ? b.publico : "todos", codigo,
    desde: F.fechaValida(b.desde) ? F.aUtc(b.desde).toISOString() : null, hasta: F.fechaValida(b.hasta) ? F.aUtc(F.sumarDias(b.hasta, 1)).toISOString() : null,
    maxUsos: Math.max(0, parseInt(b.maxUsos, 10) || 0), usos: 0, estado: "activa",
  });
  req.session.flash = { tipo: "ok", texto: "Creamos la promoción. Se aplica automáticamente al reservar." };
  res.redirect("/panel/promociones");
};

exports.estadoPromocion = async (req, res) => {
  const p = await M.Promocion.porId(req.params.id);
  if (!p || p.especialistaId !== req.especialista.id) throw noEncontrado();
  p.estado = p.estado === "activa" ? "pausada" : p.estado === "pausada" ? "activa" : p.estado;
  await M.Promocion.guardar(p);
  res.redirect("/panel/promociones");
};

// 92: destacados (exposición paga, nunca reputación)
exports.destacados = async (req, res) => {
  const e = req.especialista;
  const l = Modelo.ordenar(await M.Destacado.todos((d) => d.especialistaId === e.id), "creado");
  vista(res, "destacados", { titulo: "Destacados", activo: "destacados", lista: l, servicios: await M.Servicio.deEspecialista(e.id, true), categorias: await M.Categoria.todos((c) => (e.categorias || []).includes(c.id)), catMap: await M.Categoria.mapaPorIds(l.map((d) => d.categoriaId)), e });
};

exports.pedirDestacado = async (req, res) => {
  const e = req.especialista;
  const b = req.body;
  if (!["categoria", "zona", "inicio", "recomendacion"].includes(b.tipo)) throw invalido("Elegí dónde querés destacarte.");
  const s = b.servicioId ? await M.Servicio.porId(b.servicioId) : null;
  if (b.servicioId && (!s || s.especialistaId !== e.id)) throw invalido("Elegí un servicio válido.");
  const semanas = Math.min(12, Math.max(1, parseInt(b.semanas, 10) || 1));
  const ahora = new Date();
  await M.Destacado.crear({
    especialistaId: e.id, servicioId: s?.id || null, tipo: b.tipo, categoriaId: b.tipo === "categoria" ? b.categoriaId : null, departamento: b.tipo === "zona" ? e.ubicacion?.departamento : null,
    desde: ahora.toISOString(), hasta: new Date(ahora.getTime() + semanas * 7 * 86400000).toISOString(), precio: 0, estadoPago: "pendiente", estado: "pausado",
    impresiones: 0, clics: 0, notas: `Solicitud del especialista: ${semanas} semana(s). ${texto(b.notas, 400)}`.trim(),
  });
  await notificarAdmins({ titulo: "Solicitud de destacado", texto: `${e.nombre} quiere destacarse (${b.tipo}, ${semanas} semanas).`, enlace: "/admin/destacados", tipo: "admin" });
  req.session.flash = { tipo: "ok", texto: "Recibimos tu solicitud. Te contactamos con el presupuesto y la fecha de inicio." };
  res.redirect("/panel/destacados");
};

// 93: plan profesional
exports.plan = (req, res) => vista(res, "plan", { titulo: "Plan Profesional", activo: "plan", e: req.especialista });

exports.pedirPlan = async (req, res) => {
  const t = await M.Consulta.crear({
    numero: store.siguienteNumero("consulta"), usuarioId: req.usuario.id, tema: "especialista", asunto: "Quiero el Plan Profesional", estado: "abierta", prioridad: "normal",
    mensajes: [{ autorId: req.usuario.id, rol: "especialista", texto: `Solicitud de Plan Profesional para ${req.especialista.nombre}. ${texto(req.body.notas, 1000)}`, fecha: new Date().toISOString() }],
  });
  await notificarAdmins({ titulo: "Interés en Plan Profesional", texto: req.especialista.nombre, enlace: `/admin/soporte/${t.id}`, tipo: "admin" });
  req.session.flash = { tipo: "ok", texto: "Te anotamos. Te escribimos con los detalles del Plan Profesional." };
  res.redirect("/panel/plan");
};
