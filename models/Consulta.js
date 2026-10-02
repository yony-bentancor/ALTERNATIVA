/*
 * Consulta de soporte o incidencia (desde Contacto, Ayuda o una reserva).
 * Campos: id, numero, usuarioId, nombre y email (si escribe sin cuenta), reservaId,
 *         tema (reserva | pago | reembolso | cuenta | especialista | tecnico | otro), asunto,
 *         estado (abierta | esperando_usuario | resuelta | cerrada), prioridad (baja | normal | alta),
 *         mensajes [{autorId, rol, texto, fecha}], asignadaA
 */
const Modelo = require("./Modelo");

class Consulta extends Modelo {
  static coleccion = "consultas";
  static prefijo = "t";
  static TEMAS = { reserva: "Reserva", pago: "Pago", reembolso: "Reembolso", cuenta: "Cuenta", especialista: "Especialista", tecnico: "Problema técnico", otro: "Otro" };
  static ESTADOS = { abierta: "Abierta", esperando_usuario: "Esperando respuesta", resuelta: "Resuelta", cerrada: "Cerrada" };
  static PRIORIDADES = { baja: "Baja", normal: "Normal", alta: "Alta" };
}

module.exports = Consulta;
