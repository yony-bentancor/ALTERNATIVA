/*
 * Archivo multimedia (fotos, video, documentos). El archivo vive en uploads/ (o en Cloudinary);
 * acá se guarda la URL, tipo, dueño, estado y orden.
 * Campos: id, especialistaId, usuarioId, tipo (avatar | portada | foto | espacio | servicio | video | documento | contenido),
 *         servicioId, url, mime, bytes, epigrafe, visibilidad (publica | privada),
 *         estado (aprobado | pendiente | rechazado | reportado), moderacion {fecha, motivo}, denuncias, orden
 */
const Modelo = require("./Modelo");

class Multimedia extends Modelo {
  static coleccion = "multimedia";
  static prefijo = "m";
  static TIPOS = { avatar: "Foto de perfil", portada: "Portada", foto: "Foto", espacio: "Consultorio", servicio: "Foto de servicio", video: "Video", documento: "Documento" };

  static async galeria(especialistaId) {
    const l = await this.todos((m) => m.especialistaId === especialistaId && ["foto", "espacio", "servicio"].includes(m.tipo) && m.visibilidad !== "privada" && m.estado === "aprobado");
    return l.sort((a, b) => (a.orden || 0) - (b.orden || 0));
  }
}

module.exports = Multimedia;
