/*
 * Mensajes entre usuario y especialista. El texto original se guarda siempre (auditoría);
 * los datos de contacto se ocultan al mostrarlos según la política (Configuración → Contacto).
 */
const F = require("./fechas");
const { tieneContacto, ocultarContacto } = require("./util");
const { invalido, prohibido } = require("./errores");
const { notificar } = require("./notificaciones");

async function conversacionCon(usuarioId, especialista) {
  const { Conversacion } = require("../models");
  if (especialista.usuarioId && especialista.usuarioId === usuarioId) throw invalido("No podés escribirte a vos mismo.");
  let c = await Conversacion.entre(usuarioId, especialista.id);
  if (!c) c = await Conversacion.crear({ usuarioId, especialistaId: especialista.id, usuarioEspecialistaId: especialista.usuarioId, ultimoMensaje: new Date().toISOString(), vistaPrevia: "", sinLeerUsuario: 0, sinLeerEspecialista: 0, estado: "abierta" });
  return c;
}

async function tienenReserva(usuarioId, especialistaId) {
  const { Reserva } = require("../models");
  return !!(await Reserva.uno((r) => r.usuarioId === usuarioId && r.especialistaId === especialistaId && ["pagada", "confirmada", "realizada"].includes(r.estado)));
}

/** ¿Se pueden ver los datos de contacto en esta conversación? */
async function contactoPermitido(c) {
  const { Config } = require("../models");
  const p = (await Config.obtener()).contacto.politicaChat;
  if (p === "siempre") return true;
  if (p === "nunca") return false;
  return tienenReserva(c.usuarioId, c.especialistaId);
}

/** ¿Se muestra el botón de WhatsApp del especialista a este usuario? */
async function whatsappVisible(especialista, usuario) {
  const { Config } = require("../models");
  if (!especialista?.mostrarWhatsapp || !especialista.whatsapp) return { visible: false, motivo: "sin_whatsapp" };
  const p = (await Config.obtener()).contacto.whatsappEspecialista;
  if (p === "siempre") return { visible: true };
  if (p === "nunca") return { visible: false, motivo: "politica" };
  if (usuario && (await tienenReserva(usuario.id, especialista.id))) return { visible: true };
  return { visible: false, motivo: "despues_reserva" };
}

function rolEn(c, u) {
  if (c.usuarioId === u.id) return "usuario";
  if (c.usuarioEspecialistaId && c.usuarioEspecialistaId === u.id) return "especialista";
  if (u.rol === "admin") return "admin";
  return null;
}

async function enviar({ conversacion: c, autor, texto }) {
  const { Mensaje, Conversacion, Especialista, Estadistica, Usuario } = require("../models");
  const rol = rolEn(c, autor);
  if (!rol || rol === "admin") throw prohibido();
  if (c.estado === "bloqueada") throw invalido("Esta conversación está bloqueada.");
  const t = String(texto || "").trim();
  if (!t) throw invalido("Escribí un mensaje.");
  if (t.length > 2000) throw invalido("El mensaje es demasiado largo (máximo 2000 caracteres).");
  const recientes = await Mensaje.contar((m) => m.autorId === autor.id && Date.now() - new Date(m.creado).getTime() < 60000);
  if (recientes >= 20) throw invalido("Estás enviando mensajes muy rápido. Esperá un momento.");

  const contacto = tieneContacto(t);
  const m = await Mensaje.crear({ conversacionId: c.id, autorId: autor.id, rolAutor: rol, texto: t, tieneContacto: contacto, leido: null });
  const permitido = await contactoPermitido(c);
  const estabaSinLeer = rol === "usuario" ? c.sinLeerEspecialista : c.sinLeerUsuario;
  c.ultimoMensaje = m.creado;
  c.vistaPrevia = (contacto && !permitido ? ocultarContacto(t) : t).slice(0, 120);
  if (rol === "usuario") c.sinLeerEspecialista = (c.sinLeerEspecialista || 0) + 1; else c.sinLeerUsuario = (c.sinLeerUsuario || 0) + 1;
  await Conversacion.guardar(c);

  const destino = rol === "usuario" ? c.usuarioEspecialistaId : c.usuarioId;
  if (destino && !estabaSinLeer) {
    const e = await Especialista.porId(c.especialistaId);
    const de = rol === "usuario" ? Usuario.primerNombre(autor) : e?.nombre;
    await notificar(destino, { tipo: "mensaje", titulo: `Nuevo mensaje de ${de}`, texto: c.vistaPrevia, enlace: rol === "usuario" ? `/panel/mensajes/${c.id}` : `/mi/mensajes/${c.id}`, canales: { whatsapp: false } });
  }
  if (rol === "usuario") await Estadistica.sumar({ especialistaId: c.especialistaId, fecha: F.hoy(), campo: "mensajes" });
  return { mensaje: m, ocultoParaOtros: contacto && !permitido };
}

async function marcarLeida(c, rol) {
  const { Conversacion, Mensaje } = require("../models");
  if (rol === "usuario") c.sinLeerUsuario = 0; else c.sinLeerEspecialista = 0;
  await Conversacion.guardar(c);
  const otro = rol === "usuario" ? "especialista" : "usuario";
  for (const m of await Mensaje.todos((x) => x.conversacionId === c.id && x.rolAutor === otro && !x.leido)) m.leido = new Date().toISOString();
  await Mensaje.guardar(null);
}

/** Texto a mostrar: el propio autor siempre ve su mensaje completo. */
function textoVisible(m, lectorId, permitido) {
  if (permitido || !m.tieneContacto || m.autorId === lectorId) return m.texto;
  return ocultarContacto(m.texto);
}

async function sinLeer(u) {
  const { Conversacion } = require("../models");
  if (!u) return { usuario: 0, especialista: 0 };
  const lista = await Conversacion.todos((c) => c.usuarioId === u.id || c.usuarioEspecialistaId === u.id);
  return {
    usuario: lista.filter((c) => c.usuarioId === u.id).reduce((a, c) => a + (c.sinLeerUsuario || 0), 0),
    especialista: lista.filter((c) => c.usuarioEspecialistaId === u.id).reduce((a, c) => a + (c.sinLeerEspecialista || 0), 0),
  };
}

module.exports = { conversacionCon, tienenReserva, contactoPermitido, whatsappVisible, rolEn, enviar, marcarLeida, textoVisible, sinLeer };
