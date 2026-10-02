/*
 * Aviso dentro de la aplicación (y registro de envío por email / push / WhatsApp).
 * Campos: id, usuarioId, tipo, titulo, texto, enlace, boton, canales {email, push, whatsapp}, clave (evita duplicados), leida
 */
const Modelo = require("./Modelo");

const TIPOS = {
  reserva_confirmada: "Reserva confirmada", reserva_nueva: "Nueva reserva", recordatorio: "Próxima reserva",
  reprogramada: "Cambio de horario", cancelada: "Cancelación", pago: "Pago confirmado", reembolso: "Reembolso",
  resena_nueva: "Nueva reseña", pedir_resena: "Valorá tu sesión", respuesta_resena: "Respuesta a tu reseña",
  mensaje: "Nuevo mensaje", admin: "Solicitud administrativa", alerta: "Requiere intervención",
  volver_a_reservar: "Volver a reservar", verificacion: "Verificación", moderacion: "Moderación",
  liquidacion: "Liquidación pagada", cuenta: "Cuenta",
};

class Notificacion extends Modelo {
  static coleccion = "notificaciones";
  static prefijo = "n";
  static TIPOS = TIPOS;

  static async sinLeer(usuarioId) { return this.contar((n) => n.usuarioId === usuarioId && !n.leida); }

  static async de(usuarioId) {
    const l = await this.todos((n) => n.usuarioId === usuarioId);
    return Modelo.ordenar(l, "creado");
  }
}

module.exports = Notificacion;
