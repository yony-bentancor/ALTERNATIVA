/*
 * Agenda del especialista. Los horarios disponibles se calculan con esto menos las reservas activas
 * (ver services/disponibilidad.js).
 * Campos: id, especialistaId, zona (America/Montevideo),
 *         semanal [{dia (0=domingo), rangos [{inicio "09:00", fin "13:00"}]}],
 *         descansos [{dia, inicio, fin}], excepciones [{fecha "2026-12-24", tipo (cerrado | especial), rangos, nota}],
 *         vacaciones [{desde, hasta, motivo}], bloqueos [{id, inicio ISO, fin ISO, motivo}],
 *         paso (min entre turnos), buffer (min entre sesiones), avisoMin (min de anticipación),
 *         anticipacionMax (días), limiteDiario (0 = sin límite)
 */
const Modelo = require("./Modelo");

const SEMANA_TIPO = () => [1, 2, 3, 4, 5].map((dia) => ({ dia, rangos: [{ inicio: "09:00", fin: "13:00" }, { inicio: "14:00", fin: "18:00" }] }));

class Agenda extends Modelo {
  static coleccion = "agendas";
  static prefijo = "a";

  static porDefecto(especialistaId) {
    return {
      especialistaId, zona: "America/Montevideo", semanal: SEMANA_TIPO(), descansos: [], excepciones: [], vacaciones: [], bloqueos: [],
      paso: 15, buffer: 0, avisoMin: 120, anticipacionMax: 60, limiteDiario: 0,
    };
  }

  /** Agenda del especialista (la crea con el horario típico si no existe). */
  static async de(especialistaId) {
    let a = await this.uno((x) => x.especialistaId === especialistaId);
    if (!a) a = await this.crear(this.porDefecto(especialistaId));
    return a;
  }
}

module.exports = Agenda;
