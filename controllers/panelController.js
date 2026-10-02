/* Panel del especialista: alta de la ficha, inicio, publicación, estadísticas e ingresos (pantallas 56, 80 a 83, 94). */
const M = require("../models");
const Modelo = require("../models/Modelo");
const F = require("../services/fechas");
const especialistas = require("../services/especialistas");
const { tableroEspecialista, rango } = require("../services/estadisticas");
const { notificarAdmins } = require("../services/notificaciones");
const { invalido } = require("../services/errores");
const { texto, DEPARTAMENTOS } = require("../services/util");

const periodo = (q) => (["7d", "30d", "90d", "365d"].includes(q) ? q : "30d");

// Alta de la ficha (desde "Ofrecé tus servicios" o el registro como especialista)
exports.formComenzar = async (req, res) => {
  if (req.especialista) return res.redirect("/panel");
  const cfg = await M.Config.obtener();
  if (!cfg.sitio.altaEspecialistas) { req.session.flash = { tipo: "info", texto: "Por ahora el alta de especialistas es por invitación. Escribinos desde Contacto." }; return res.redirect("/contacto"); }
  res.render("panel/comenzar", { titulo: "Creá tu ficha", area: "publico", categorias: await M.Categoria.activas(), datos: { nombre: req.usuario.nombre }, errores: [] });
};

exports.comenzar = async (req, res) => {
  if (req.especialista) return res.redirect("/panel");
  const d = req.body;
  const categorias = [].concat(d.categorias || []).filter(Boolean);
  const modalidades = [].concat(d.modalidades || []).filter((m) => ["presencial", "domicilio", "online"].includes(m));
  const errores = [];
  if (texto(d.nombre).length < 2) errores.push("Escribí tu nombre profesional.");
  if (!categorias.length) errores.push("Elegí al menos una categoría.");
  if (!modalidades.length) errores.push("Elegí cómo atendés.");
  if (!DEPARTAMENTOS.includes(d.departamento)) errores.push("Elegí tu departamento.");
  if (errores.length) return res.status(400).render("panel/comenzar", { titulo: "Creá tu ficha", area: "publico", categorias: await M.Categoria.activas(), datos: d, errores });
  const e = await especialistas.crearParaUsuario(req.usuario, { nombre: texto(d.nombre, 120), titular: texto(d.titular, 160), categorias: categorias.slice(0, 6), modalidades, departamento: d.departamento, ciudad: texto(d.ciudad, 80) });
  await M.Auditoria.registrar(req, { accion: "especialista.alta", entidad: "especialista", entidadId: e.id });
  req.session.flash = { tipo: "ok", texto: "Creamos tu ficha. Completá los pasos para publicarla." };
  res.redirect("/panel");
};

// 56: inicio del panel
exports.inicio = async (req, res) => {
  const e = req.especialista;
  const hoy = F.hoy();
  const mias = await M.Reserva.todos((r) => r.especialistaId === e.id);
  const deHoy = mias.filter((r) => F.partes(r.inicio).fecha === hoy && ["pagada", "confirmada", "realizada"].includes(r.estado)).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const porConfirmar = mias.filter((r) => r.estado === "pagada").sort((a, b) => a.inicio.localeCompare(b.inicio));
  const proximas = mias.filter((r) => M.Reserva.proxima(r) && r.estado !== "pendiente").sort((a, b) => a.inicio.localeCompare(b.inicio));
  const resenas = (await M.Resena.visiblesDeEspecialista(e.id)).slice(0, 3);
  const servMap = await M.Servicio.mapaPorIds(resenas.map((r) => r.servicioId));
  res.render("panel/inicio", {
    titulo: "Inicio", area: "panel", activo: "inicio", e, stats: await tableroEspecialista(e.id, "30d"), comp: await especialistas.completitud(e),
    deHoy, porConfirmar, proximas: proximas.slice(0, 5), totalProximas: proximas.length, resenas, servMap,
    verificacionPendiente: await M.Verificacion.uno((v) => v.especialistaId === e.id && v.estado === "pendiente"),
  });
};

exports.mas = (req, res) => res.render("panel/mas", { titulo: "Más", area: "panel", activo: "mas" });

exports.publicar = async (req, res) => {
  const e = req.especialista;
  const cfg = await M.Config.obtener();
  const c = await especialistas.completitud(e);
  if (!c.listo) throw invalido(`Antes de publicar te falta: ${c.faltan.map((x) => x.texto.toLowerCase()).join(", ")}.`);
  if (!["borrador", "inactivo"].includes(e.estado)) return res.redirect("/panel");
  const estado = cfg.moderacion.especialistasNuevos && !e.publicado ? "en_revision" : "activo";
  await especialistas.cambiarEstado(e.id, estado);
  await M.Auditoria.registrar(req, { accion: "especialista.publicar", entidad: "especialista", entidadId: e.id, despues: { estado } });
  if (estado === "en_revision") {
    await notificarAdmins({ titulo: "Ficha para revisar", texto: `${e.nombre} pidió publicar su ficha.`, enlace: `/admin/especialistas/${e.id}`, tipo: "admin" });
    req.session.flash = { tipo: "ok", texto: "Enviamos tu ficha a revisión. Te avisamos cuando esté publicada (normalmente en menos de 48 h)." };
  } else req.session.flash = { tipo: "ok", texto: "¡Tu ficha está publicada!" };
  res.redirect("/panel");
};

exports.pausar = async (req, res) => {
  if (req.especialista.estado !== "activo") return res.redirect("/panel");
  await especialistas.cambiarEstado(req.especialista.id, "inactivo", "Pausado por el especialista");
  req.session.flash = { tipo: "ok", texto: "Pausaste tu ficha: no aparece en búsquedas ni recibe reservas nuevas. Las reservas existentes se mantienen." };
  res.redirect("/panel/cuenta");
};

// 86: avisos (misma vista que el usuario, con el diseño del panel)
exports.notificaciones = async (req, res) => {
  const l = await M.Notificacion.de(req.usuario.id);
  res.render("cuenta/notificaciones", { titulo: "Avisos", area: "panel", activo: "inicio", p: Modelo.paginar(l, req.query.page, 25), base: "/panel/notificaciones" });
};

// 80, 82 y 83: estadísticas
exports.estadisticas = (vista) => async (req, res) => {
  const p = periodo(req.query.periodo);
  const titulos = { estadisticas: "Estadísticas", visualizaciones: "Visualizaciones", rendimiento: "Rendimiento por servicio" };
  res.render(`panel/${vista}`, { titulo: titulos[vista], area: "panel", activo: "estadisticas", stats: await tableroEspecialista(req.especialista.id, p), periodo: p, vista });
};

// 81: ingresos
exports.ingresos = async (req, res) => {
  const p = periodo(req.query.periodo);
  const rg = rango(p);
  const pagos = Modelo.ordenar(await M.Pago.todos((x) => x.especialistaId === req.especialista.id && x.estado !== "pendiente" && new Date(x.creado) >= rg.inicio), "creado");
  const rs = await M.Reserva.mapaPorIds(pagos.map((x) => x.reservaId));
  const reembolsos = await M.Reembolso.todos((x) => x.especialistaId === req.especialista.id && new Date(x.creado) >= rg.inicio);
  const liquidaciones = Modelo.ordenar(await M.Liquidacion.todos((l) => l.especialistaId === req.especialista.id), "creado");
  const efectivos = pagos.filter((x) => ["aprobado", "reembolso_parcial", "a_cobrar"].includes(x.estado));
  const tot = {
    bruto: efectivos.reduce((a, x) => a + x.monto, 0),
    neto: efectivos.reduce((a, x) => a + x.montoEspecialista, 0),
    comisionPasarela: efectivos.reduce((a, x) => a + (x.comisionPasarela || 0), 0),
    reembolsado: reembolsos.filter((x) => x.estado === "procesado").reduce((a, x) => a + x.especialistaRevertido, 0),
  };
  tot.recibido = tot.neto - tot.comisionPasarela - tot.reembolsado;
  res.render("panel/ingresos", { titulo: "Ingresos", area: "panel", activo: "ingresos", periodo: p, pagos, rs, reembolsos, liquidaciones, tot, stats: await tableroEspecialista(req.especialista.id, p) });
};

// 94: facturación (resumen mensual)
exports.facturacion = async (req, res) => {
  const pagos = await M.Pago.todos((x) => x.especialistaId === req.especialista.id && ["aprobado", "reembolso_parcial", "reembolsado", "a_cobrar"].includes(x.estado));
  const meses = {};
  for (const x of pagos) {
    const p = F.partes(x.creado); const k = `${p.anio}-${F.dos(p.mes)}`;
    const m = (meses[k] ||= { mes: k, bruto: 0, comision: 0, pasarela: 0, reembolsado: 0, cantidad: 0 });
    m.bruto += x.monto; m.comision += x.comision; m.pasarela += x.comisionPasarela || 0; m.reembolsado += x.reembolsado || 0; m.cantidad++;
  }
  res.render("panel/facturacion", { titulo: "Facturación", area: "panel", activo: "ingresos", meses: Object.values(meses).sort((a, b) => b.mes.localeCompare(a.mes)), liquidaciones: Modelo.ordenar(await M.Liquidacion.todos((l) => l.especialistaId === req.especialista.id), "creado") });
};
