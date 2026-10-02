/*
 * Denuncia de contenido (reseñas, fotos, perfiles, mensajes, usuarios).
 * Campos: id, denuncianteId, rolDenunciante, tipo (resena | multimedia | especialista | servicio | usuario | mensaje),
 *         objetivoId, motivo, detalle, estado (abierta | resuelta | descartada), resolucion {fecha, accion, nota, por}
 */
const Modelo = require("./Modelo");

const MOTIVOS = {
  falso: "Contenido falso o engañoso", ofensivo: "Ofensivo o inapropiado", spam: "Spam o publicidad",
  datos_personales: "Expone datos personales", fraude: "Fraude o abuso", conflicto: "Conflicto de interés", otro: "Otro motivo",
};

class Denuncia extends Modelo {
  static coleccion = "denuncias";
  static prefijo = "dn";
  static MOTIVOS = MOTIVOS;
  static TIPOS = { resena: "Reseña", multimedia: "Foto o video", especialista: "Perfil", servicio: "Servicio", usuario: "Usuario", mensaje: "Mensaje" };
  static ESTADOS = { abierta: "Abierta", resuelta: "Resuelta", descartada: "Descartada" };
}

module.exports = Denuncia;
