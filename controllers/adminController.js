/* Administración general: resumen, pendientes, estadísticas, configuración, avisos y auditoría (pantallas 95 a 97, 124 a 129). */
const M = require("../models");
const Modelo = require("../models/Modelo");
const config = require("../config");
const { tableroAdmin, rango } = require("../services/estadisticas");
const { SECCIONES, leerSeccion } = require("../services/ajustes");
const { notificar } = require("../services/notificaciones");
const { bandejaDemo } = require("../services/email");
const { invalido, noEncontrado } = require("../services/errores");
const { texto, EMAIL } = require("../services/util");

const vista = (res, v, datos) => res.render(`admin/${v}`, { area: "admin", ...datos });
const periodo = (q) => (["7d", "30d", "90d", "365d"].includes(q) ? q : "30d");
const EFECTIVAS = ["pagada", "confirmada", "realizada"];

// 95: resumen
exports.dashboard = async (req, res) => {
  const p = periodo(req.query.periodo);
  vista(res, "inicio", {
    titulo: "Administración", activo: "dashboard", periodo: p, stats: await tableroAdmin(p),
    ultimas: Modelo.ordenar(await M.Reserva.todos(), "creado").slice(0, 8),
    alertas: Modelo.ordenar(await M.Auditoria.todos((a) => ["aviso", "seguridad"].includes(a.severidad)), "creado").slice(0, 8),
  });
};

// 96: todo lo que espera una decisión
exports.pendientes = async (req, res) => {
  const especialistas = await M.Especialista.todos((e) => !e.eliminado);
  vista(res, "pendientes", {
    titulo: "Pendientes", activo: "pendientes",
    enRevision: especialistas.filter((e) => e.estado === "en_revision"),
    conCambios: especialistas.filter((e) => (e.cambiosPendientes || []).length),
    verificaciones: await M.Verificacion.contar((v) => v.estado === "pendiente"),
    certificaciones: await M.Certificacion.contar((c) => c.estado === "pendiente"),
    multimedia: await M.Multimedia.contar((m) => ["pendiente", "reportado"].includes(m.estado)),
    categorias: await M.Categoria.todos((c) => c.estado === "pendiente"),
    servicios: await M.Servicio.todos((s) => s.estado === "en_revision"),
    resenas: await M.Resena.contar((r) => r.estado === "en_revision" || (r.pedidoRevision?.fecha && !r.pedidoRevision.resuelto)),
    denuncias: await M.Denuncia.contar((d) => d.estado === "abierta"),
    consultas: await M.Consulta.contar((t) => t.estado === "abierta"),
    reembolsos: await M.Reembolso.contar((r) => r.estado === "fallido"),
    incidencias: await M.Reserva.todos((r) => r.incidencia?.abierta),
    destacados: await M.Destacado.contar((d) => d.estado === "pausado" && d.estadoPago === "pendiente"),
    espMap: new Map(especialistas.map((e) => [e.id, e])),
  });
};

// 97: estadísticas del marketplace
exports.estadisticas = async (req, res) => {
  const p = periodo(req.query.periodo);
  const rg = rango(p);
  const reservas = await M.Reserva.todos((r) => new Date(r.creado) >= rg.inicio && EFECTIVAS.includes(r.estado));
  const especialistas = await M.Especialista.mapaPorIds(reservas.map((r) => r.especialistaId));
  const agrupar = (clave, valor = () => 1) => {
    const m = new Map();
    for (const r of reservas) { const k = clave(r) || "Sin dato"; m.set(k, (m.get(k) || 0) + valor(r)); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const top = new Map();
  for (const r of reservas) {
    const t = top.get(r.especialistaId) || { id: r.especialistaId, nombre: r.foto.especialista, reservas: 0, bruto: 0, comision: 0 };
    t.reservas++; t.bruto += r.foto.total; t.comision += r.foto.comision;
    top.set(r.especialistaId, t);
  }
  const pagos = await M.Pago.todos((x) => new Date(x.creado) >= rg.inicio && ["aprobado", "reembolso_parcial", "reembolsado", "a_cobrar"].includes(x.estado));
  const porModelo = {};
  for (const x of pagos) { const k = x.modeloCobro || "split"; porModelo[k] ||= { cantidad: 0, bruto: 0 }; porModelo[k].cantidad++; porModelo[k].bruto += x.monto; }
  vista(res, "estadisticas", {
    titulo: "Estadísticas", activo: "estadisticas", periodo: p, stats: await tableroAdmin(p),
    porCategoria: agrupar((r) => r.foto.categoria), porDepartamento: agrupar((r) => especialistas.get(r.especialistaId)?.ubicacion?.departamento),
    porModalidad: agrupar((r) => r.modalidad), topEspecialistas: [...top.values()].sort((a, b) => b.reservas - a.reservas).slice(0, 15), porModelo,
  });
};

// 124: configuración de negocio
exports.configuracion = async (req, res) => {
  const cfg = await M.Config.obtener();
  const seccion = SECCIONES[req.query.seccion] ? req.query.seccion : "sitio";
  vista(res, "configuracion", {
    titulo: "Configuración", activo: "configuracion", seccion, ajustes: SECCIONES, valores: cfg[seccion],
    servidor: { proveedor: config.pagos.proveedor, email: config.email.proveedor, push: !!config.push?.publicKey, whatsapp: !!config.whatsapp?.token, mapas: !!config.googleMapsKey, entorno: config.entorno, mongo: !!config.usarMongo },
  });
};

exports.guardarConfiguracion = async (req, res) => {
  const seccion = req.params.seccion;
  if (!SECCIONES[seccion]) throw noEncontrado();
  const cfg = await M.Config.obtener();
  const valores = leerSeccion(seccion, req.body, cfg[seccion]);
  const { antes, despues } = await M.Config.actualizarSeccion(seccion, valores);
  await M.Auditoria.registrar(req, { accion: `config.${seccion}`, entidad: "config", entidadId: seccion, antes, despues, severidad: ["comision", "pagos", "cancelacion"].includes(seccion) ? "aviso" : "info" });
  req.session.flash = { tipo: "ok", texto: "Guardamos la configuración. Aplica a las operaciones nuevas." };
  res.redirect(`/admin/configuracion?seccion=${seccion}`);
};

// 125: avisos (los propios + envío masivo + bandeja de emails de prueba)
exports.notificaciones = async (req, res) => {
  const propias = Modelo.ordenar(await M.Notificacion.todos((n) => n.usuarioId === req.usuario.id), "creado").slice(0, 40);
  for (const n of propias) if (!n.leida) n.leida = new Date().toISOString();
  await M.Notificacion.guardar(null);
  vista(res, "notificaciones", {
    titulo: "Avisos", activo: "notificaciones", propias,
    enviados: Modelo.ordenar(await M.Auditoria.todos((a) => a.accion === "aviso.enviar"), "creado").slice(0, 10),
    bandeja: bandejaDemo.slice(0, 20), proveedorEmail: config.email.proveedor,
  });
};

exports.enviarAviso = async (req, res) => {
  const b = req.body;
  const titulo = texto(b.titulo, 120); const cuerpo = texto(b.texto, 1000); const enlace = texto(b.enlace, 200);
  if (!titulo || !cuerpo) throw invalido("Escribí el título y el texto del aviso.");
  if (enlace && !enlace.startsWith("/")) throw invalido("El enlace tiene que ser interno (empezar con /).");
  if (!["todos", "usuarios", "especialistas", "email"].includes(b.publico)) throw invalido("Elegí a quién enviarlo.");
  if (b.publico === "email" && !EMAIL.test(String(b.email || ""))) throw invalido("Escribí un email válido.");
  const destino = await M.Usuario.todos((u) => u.estado === "activo" && (
    b.publico === "todos" || (b.publico === "usuarios" && !u.especialistaId && u.rol !== "admin") || (b.publico === "especialistas" && u.especialistaId) || (b.publico === "email" && u.email === String(b.email).toLowerCase().trim())));
  const conEmail = b.porEmail === "1";
  for (const u of destino) {
    await notificar(u, { tipo: "cuenta", titulo, texto: cuerpo, enlace: enlace || "/", canales: { email: conEmail && (b.publico === "email" || u.preferencias?.avisos?.marketing) ? undefined : false, whatsapp: false } });
  }
  await M.Auditoria.registrar(req, { accion: "aviso.enviar", entidad: "notificacion", resumen: `${titulo} → ${b.publico} (${destino.length})` });
  req.session.flash = { tipo: "ok", texto: `Enviamos el aviso a ${destino.length} cuenta(s).` };
  res.redirect("/admin/notificaciones");
};

// 128: auditoría
exports.auditoria = async (req, res) => {
  const q = req.query;
  let l = await M.Auditoria.todos((a) =>
    (!q.accion || String(a.accion).startsWith(q.accion)) && (!q.entidad || a.entidad === q.entidad) && (!q.severidad || a.severidad === q.severidad)
    && (!q.actor || a.actorId === q.actor) && (!q.objeto || a.entidadId === q.objeto));
  l = Modelo.ordenar(l, "creado");
  const entidades = [...new Set((await M.Auditoria.todos()).map((a) => a.entidad).filter(Boolean))].sort();
  vista(res, "auditoria", { titulo: "Auditoría", activo: "auditoria", p: Modelo.paginar(l, q.page, 50), entidades });
};

// Documentos privados: solo administración, y queda registrado quién los abrió.
exports.documento = async (req, res) => {
  const m = await M.Multimedia.porId(req.params.id);
  if (!m) throw noEncontrado();
  await M.Auditoria.registrar(req, { accion: "documento.ver", entidad: "multimedia", entidadId: m.id, resumen: m.epigrafe, severidad: "seguridad" });
  res.redirect(m.url);
};

