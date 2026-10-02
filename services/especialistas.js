/*
 * Especialistas: alta, reclamo de perfiles cargados por administración, moderación de cambios sensibles,
 * completitud de ficha, reputación y "catálogo" de servicios visibles para la búsqueda.
 */
const config = require("../config");
const { slugUnico, SLUGS_RESERVADOS, slug: aSlug } = require("./util");
const { crearToken, hashToken } = require("./claves");
const { bayesiano, esNuevo } = require("./ranking");
const { invalido, noEncontrado } = require("./errores");
const { enviarEmail, plantilla } = require("./email");

// Campos cuya modificación por el especialista requiere revisión si el perfil ya está publicado.
const CAMPOS_SENSIBLES = ["nombre", "categorias"];
const NOMBRES_CAMPOS = { nombre: "Nombre público", categorias: "Categorías" };

async function slugEspecialista(nombre, excluirId) {
  const { Especialista } = require("../models");
  let base = nombre;
  if (SLUGS_RESERVADOS.has(aSlug(base))) base = `${base}-especialista`;
  const existentes = (await Especialista.todos((e) => e.id !== excluirId)).map((e) => e.slug);
  return slugUnico(base, existentes);
}

async function slugServicio(especialistaId, titulo, excluirId) {
  const { Servicio } = require("../models");
  const existentes = (await Servicio.todos((s) => s.especialistaId === especialistaId && s.id !== excluirId)).map((s) => s.slug);
  return slugUnico(titulo, existentes);
}

/** Un servicio aparece en la búsqueda si el especialista está activo y el servicio y la categoría también. */
function visible(servicio, especialista, categoria) {
  return !!servicio && !!especialista && !!categoria && especialista.estado === "activo" && !especialista.eliminado && servicio.estado === "activo" && categoria.estado === "activa";
}

/** Todos los servicios visibles con su especialista y categoría (base de búsqueda, inicio y categorías). */
async function catalogo() {
  const { Servicio, Especialista, Categoria, Config } = require("../models");
  const cfg = await Config.obtener();
  const esp = new Map((await Especialista.todos()).map((e) => [e.id, e]));
  const cat = new Map((await Categoria.todos()).map((c) => [c.id, c]));
  const out = [];
  for (const s of await Servicio.todos()) {
    const e = esp.get(s.especialistaId); const c = cat.get(s.categoriaId);
    if (!visible(s, e, c)) continue;
    out.push({
      servicio: s, especialista: e, categoria: c,
      nuevo: esNuevo({ publicado: e.publicado, resenas: e.stats?.resenas, dias: cfg.descubrimiento.diasNuevo, maxResenas: cfg.descubrimiento.maxResenasNuevo }),
      verificado: e.verificacion?.estado === "verificada",
    });
  }
  return out;
}

/** Recalcula la reputación de un servicio a partir de sus reseñas visibles. */
async function recalcularRatingServicio(servicioId) {
  const { Resena, Servicio, Config } = require("../models");
  const cfg = await Config.obtener();
  const s = await Servicio.porId(servicioId);
  if (!s) return;
  const rs = await Resena.todos((r) => r.servicioId === servicioId && r.estado !== "oculta");
  const cant = rs.length;
  const suma = rs.reduce((a, r) => a + r.puntaje, 0);
  const distribucion = [0, 0, 0, 0, 0];
  for (const r of rs) distribucion[r.puntaje - 1]++;
  s.rating = { prom: cant ? Math.round((suma / cant) * 10) / 10 : 0, cant, suma, ponderado: bayesiano(cant ? suma / cant : 0, cant, cfg.resenas.promedioBase, cfg.resenas.pesoBayes), distribucion };
  await Servicio.guardar(s);
}

async function recalcularStatsEspecialista(especialistaId) {
  const { Resena, Reserva, Especialista } = require("../models");
  const e = await Especialista.porId(especialistaId);
  if (!e) return;
  const rs = await Resena.todos((r) => r.especialistaId === especialistaId && r.estado !== "oculta");
  const realizadas = await Reserva.todos((r) => r.especialistaId === especialistaId && r.estado === "realizada");
  const porCliente = {};
  for (const r of realizadas) porCliente[r.usuarioId] = (porCliente[r.usuarioId] || 0) + 1;
  e.stats = {
    ...(e.stats || {}),
    resenas: rs.length,
    rating: rs.length ? Math.round((rs.reduce((a, r) => a + r.puntaje, 0) / rs.length) * 10) / 10 : 0,
    realizadas: realizadas.length,
    recurrentes: Object.values(porCliente).filter((n) => n > 1).length,
  };
  await Especialista.guardar(e);
}

/** Requisitos mínimos para publicarse. */
async function completitud(e) {
  const { Servicio, Agenda, Config } = require("../models");
  const servicios = await Servicio.contar((s) => s.especialistaId === e.id && ["activo", "en_revision"].includes(s.estado));
  const agenda = await Agenda.de(e.id);
  const cfg = await Config.obtener();
  const checks = [
    { ok: !!e.avatar, texto: "Foto de perfil", enlace: "/panel/perfil/multimedia" },
    { ok: (e.bio || "").length >= 80, texto: "Presentación de al menos 80 caracteres", enlace: "/panel/perfil/editar" },
    { ok: (e.categorias || []).length > 0, texto: "Al menos una categoría", enlace: "/panel/perfil/editar" },
    { ok: (e.modalidades || []).length > 0, texto: "Modalidades de atención", enlace: "/panel/perfil/editar" },
    { ok: !!(e.ubicacion?.departamento && e.ubicacion?.ciudad) || (e.modalidades || []).every((m) => m === "online"), texto: "Departamento y ciudad", enlace: "/panel/perfil/editar" },
    { ok: servicios > 0, texto: "Al menos un servicio con precio y duración", enlace: "/panel/servicios/nuevo" },
    { ok: (agenda.semanal || []).some((w) => (w.rangos || []).length), texto: "Horarios de atención", enlace: "/panel/agenda/horarios" },
  ];
  if (cfg.pagos.modelo === "split" && cfg.pagos.exigirCuentaVinculada) checks.push({ ok: !!e.mercadopago?.conectado, texto: "Cuenta de cobro vinculada (Mercado Pago)", enlace: "/panel/cuenta/cobros" });
  const hechos = checks.filter((c) => c.ok).length;
  return { porcentaje: Math.round((hechos / checks.length) * 100), checks, faltan: checks.filter((c) => !c.ok), listo: hechos === checks.length };
}

async function crearParaUsuario(usuario, datos = {}) {
  const { Especialista, Agenda, Usuario } = require("../models");
  const e = await Especialista.crear({
    usuarioId: usuario.id, slug: await slugEspecialista(datos.nombre || usuario.nombre), nombre: datos.nombre || usuario.nombre,
    titular: datos.titular || "", bio: "", categorias: datos.categorias || [], modalidades: datos.modalidades?.length ? datos.modalidades : ["presencial"],
    ubicacion: { departamento: datos.departamento || "", ciudad: datos.ciudad || "" }, estado: "borrador",
    verificacion: { estado: "ninguna" }, reclamo: { estado: "propio" }, ajustes: { autoConfirmar: true, permitirReprogramar: true },
    comision: null, plan: "gratis", stats: {}, idiomas: ["Español"], telefono: usuario.telefono || "", whatsapp: usuario.telefono || "", mostrarWhatsapp: false,
    diseno: { variante: "clasica", orden: ["servicios", "sobre", "galeria", "video", "resenas", "ubicacion"] },
  });
  await Agenda.de(e.id);
  await Usuario.actualizar(usuario.id, { especialistaId: e.id, rol: usuario.rol === "admin" ? "admin" : "especialista" });
  return e;
}

/** Alta manual por administración (perfil sin dueño, que el especialista reclama después). */
async function crearPorAdmin(datos, admin) {
  const { Especialista, Agenda } = require("../models");
  const e = await Especialista.crear({
    ...datos, usuarioId: null, slug: await slugEspecialista(datos.nombre), estado: datos.estado || "borrador",
    verificacion: { estado: "ninguna" }, reclamo: { estado: "sin_reclamar" }, creadoPor: admin.id,
    publicado: datos.estado === "activo" ? new Date().toISOString() : null, ajustes: { autoConfirmar: true, permitirReprogramar: true },
    comision: null, plan: "gratis", stats: {}, diseno: { variante: "clasica", orden: ["servicios", "sobre", "galeria", "video", "resenas", "ubicacion"] },
  });
  await Agenda.de(e.id);
  return e;
}

async function invitarAReclamar(e, email) {
  const { Especialista } = require("../models");
  const { token, hash } = crearToken();
  const vence = new Date(Date.now() + 30 * 86400000).toISOString();
  await Especialista.actualizar(e.id, { reclamo: { estado: "invitado", tokenHash: hash, email, invitado: new Date().toISOString(), vence } });
  const url = `${config.urlSitio}/reclamar/${token}`;
  await enviarEmail({
    para: email, asunto: "Tu perfil está disponible en Alternativa",
    html: plantilla({ titulo: "Tu perfil está disponible en Alternativa", intro: `Creamos la ficha de ${e.nombre} en Alternativa. Verificá tu identidad para administrarla: vas a poder editar tus servicios, precios, agenda y recibir reservas.`, boton: "Reclamar mi perfil", url, pie: "Si no reconocés este perfil, ignorá este email. El enlace vence en 30 días." }),
  });
  return { url, vence };
}

async function porTokenDeReclamo(token) {
  const { Especialista } = require("../models");
  const h = hashToken(token);
  const e = await Especialista.uno((x) => x.reclamo?.tokenHash === h && x.reclamo?.estado === "invitado");
  if (!e) throw noEncontrado("El enlace no es válido o ya fue usado.");
  if (e.reclamo.vence && new Date(e.reclamo.vence) < new Date()) throw invalido("El enlace venció. Pedí uno nuevo a Alternativa.");
  return e;
}

async function reclamarPerfil(token, usuario) {
  const { Usuario, Verificacion, Especialista } = require("../models");
  const e = await porTokenDeReclamo(token);
  if (usuario.especialistaId && usuario.especialistaId !== e.id) throw invalido("Tu cuenta ya administra otro perfil de especialista.");
  e.usuarioId = usuario.id;
  e.reclamo = { ...e.reclamo, estado: "reclamado", reclamado: new Date().toISOString(), tokenHash: null };
  await Especialista.guardar(e);
  await Usuario.actualizar(usuario.id, { especialistaId: e.id, rol: usuario.rol === "admin" ? "admin" : "especialista" });
  await Verificacion.crear({ especialistaId: e.id, usuarioId: usuario.id, tipo: "reclamo", estado: "pendiente", notas: "Perfil reclamado mediante invitación. Falta verificar identidad.", documentos: [] });
  return e;
}

/** Cambios de perfil: los operativos se publican al instante; los sensibles quedan pendientes de revisión. */
async function aplicarCambios(e, cambios, { rol }) {
  const { Especialista, Config } = require("../models");
  const cfg = await Config.obtener();
  const moderado = rol === "especialista" && e.estado === "activo" && cfg.moderacion.cambiosSensibles;
  const pendientes = [];
  for (const [campo, valor] of Object.entries(cambios)) {
    if (valor === undefined) continue;
    if (JSON.stringify(e[campo]) === JSON.stringify(valor)) continue;
    if (moderado && CAMPOS_SENSIBLES.includes(campo)) {
      e.cambiosPendientes = (e.cambiosPendientes || []).filter((p) => p.campo !== campo);
      e.cambiosPendientes.push({ campo, valor, fecha: new Date().toISOString() });
      pendientes.push(NOMBRES_CAMPOS[campo] || campo);
    } else {
      e[campo] = valor;
    }
  }
  await Especialista.guardar(e);
  return { pendientes };
}

async function resolverCambio(especialistaId, campo, aprobar) {
  const { Especialista } = require("../models");
  const e = await Especialista.porId(especialistaId);
  if (!e) throw noEncontrado();
  const c = (e.cambiosPendientes || []).find((p) => p.campo === campo);
  if (!c) throw noEncontrado("No hay cambios pendientes en ese campo.");
  if (aprobar) {
    e[campo] = c.valor;
    if (campo === "nombre") e.slug = await slugEspecialista(c.valor, e.id);
  }
  e.cambiosPendientes = e.cambiosPendientes.filter((p) => p.campo !== campo);
  await Especialista.guardar(e);
  return { e, cambio: c };
}

async function cambiarEstado(especialistaId, estado, motivo) {
  const { Especialista } = require("../models");
  const e = await Especialista.porId(especialistaId);
  if (!e) throw noEncontrado();
  const antes = e.estado;
  e.estado = estado;
  e.motivoEstado = motivo || "";
  if (estado === "activo" && !e.publicado) e.publicado = new Date().toISOString();
  await Especialista.guardar(e);
  return { e, antes };
}

module.exports = {
  CAMPOS_SENSIBLES, NOMBRES_CAMPOS, slugEspecialista, slugServicio, visible, catalogo, recalcularRatingServicio, recalcularStatsEspecialista,
  completitud, crearParaUsuario, crearPorAdmin, invitarAReclamar, porTokenDeReclamo, reclamarPerfil, aplicarCambios, resolverCambio, cambiarEstado,
};
