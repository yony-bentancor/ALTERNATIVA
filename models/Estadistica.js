/*
 * Estadísticas diarias por especialista y servicio (visitas, impresiones, favoritos…).
 * Campos: id, especialistaId, servicioId (null = el perfil), fecha "YYYY-MM-DD",
 *         visitasPerfil, visitasServicio, consultasAgenda, impresiones, impresionesPatrocinadas, favoritos, mensajes
 */
const Modelo = require("./Modelo");

class Estadistica extends Modelo {
  static coleccion = "estadisticas";
  static prefijo = "es";

  /** Suma 1 (o n) al contador del día. */
  static async sumar({ especialistaId, servicioId = null, fecha, campo, n = 1 }) {
    let d = await this.uno((x) => x.especialistaId === especialistaId && (x.servicioId || null) === servicioId && x.fecha === fecha);
    if (!d) d = await this.crear({ especialistaId, servicioId, fecha });
    d[campo] = (d[campo] || 0) + n;
    return this.guardar(d);
  }
}

module.exports = Estadistica;
