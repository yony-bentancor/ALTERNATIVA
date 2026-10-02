/*
 * Cálculo automático de horarios disponibles.
 * La parte pura (horariosDelDia) no toca los datos y está cubierta por tests.
 */
const F = require("./fechas");

function normalizarRangos(rangos) {
  return (rangos || [])
    .filter((r) => F.horaValida(r.inicio) && F.horaValida(r.fin))
    .map((r) => ({ inicio: F.aMinutos(r.inicio), fin: r.fin === "00:00" ? 1440 : F.aMinutos(r.fin) }))
    .filter((r) => r.fin > r.inicio)
    .sort((a, b) => a.inicio - b.inicio);
}

function restarIntervalos(rangos, cortes) {
  let res = rangos.map((r) => ({ ...r }));
  for (const c of cortes) {
    const sig = [];
    for (const r of res) {
      if (c.fin <= r.inicio || c.inicio >= r.fin) { sig.push(r); continue; }
      if (c.inicio > r.inicio) sig.push({ inicio: r.inicio, fin: c.inicio });
      if (c.fin < r.fin) sig.push({ inicio: c.fin, fin: r.fin });
    }
    res = sig;
  }
  return res;
}

/** Rangos de trabajo de una fecha, aplicando vacaciones, excepciones y descansos. */
function rangosDeFecha(agenda, fecha) {
  if ((agenda.vacaciones || []).some((v) => v.desde && v.hasta && fecha >= v.desde && fecha <= v.hasta)) return { rangos: [], motivo: "vacaciones" };
  const ex = (agenda.excepciones || []).find((e) => e.fecha === fecha);
  if (ex) return ex.tipo === "cerrado" ? { rangos: [], motivo: "cerrado" } : { rangos: normalizarRangos(ex.rangos), motivo: "especial" };
  const wd = F.diaSemana(fecha);
  const dia = (agenda.semanal || []).find((w) => w.dia === wd);
  const rangos = normalizarRangos(dia ? dia.rangos : []);
  const descansos = normalizarRangos((agenda.descansos || []).filter((b) => b.dia === wd));
  return { rangos: restarIntervalos(rangos, descansos), motivo: rangos.length ? "semanal" : "libre" };
}

/**
 * Horarios disponibles de un día.
 * ocupado: [{inicio, fin}] reservas activas (ISO o Date).
 */
function horariosDelDia({ fecha, agenda, duracion, ocupado = [], ahora = new Date(), tz = F.ZONA, anticipacionMax, reservasEseDia = 0 }) {
  if (!F.fechaValida(fecha) || !agenda || !duracion) return [];
  const adelante = F.diferenciaDias(F.hoy(tz, ahora), fecha);
  const maxDias = Math.min(agenda.anticipacionMax || 60, anticipacionMax || Infinity);
  if (adelante < 0 || adelante > maxDias) return [];
  if (agenda.limiteDiario > 0 && reservasEseDia >= agenda.limiteDiario) return [];
  const { rangos } = rangosDeFecha(agenda, fecha);
  if (!rangos.length) return [];

  const paso = Math.max(5, agenda.paso || 15);
  const buffer = Math.max(0, agenda.buffer || 0) * 60000;
  const minimo = ahora.getTime() + Math.max(0, agenda.avisoMin || 0) * 60000;
  const ocupaciones = ocupado.map((o) => ({ inicio: new Date(o.inicio).getTime(), fin: new Date(o.fin).getTime() }))
    .concat((agenda.bloqueos || []).map((b) => ({ inicio: new Date(b.inicio).getTime(), fin: new Date(b.fin).getTime() })));

  const out = [];
  for (const r of rangos) {
    for (let t = r.inicio; t + duracion <= r.fin; t += paso) {
      const inicio = F.minutosAUtc(fecha, t, tz).getTime();
      const fin = inicio + duracion * 60000;
      if (inicio < minimo) continue;
      // El buffer separa sesiones: se aplica antes y después de cada ocupación.
      if (ocupaciones.some((o) => inicio < o.fin + buffer && fin + buffer > o.inicio)) continue;
      out.push({ hora: F.aHora(t), inicio: new Date(inicio), fin: new Date(fin) });
    }
  }
  return out;
}

// ── Con datos ─────────────────────────────────────────────
async function ocupacion(especialistaId, { excluirReservaId = null, ahora = new Date() } = {}) {
  const { Reserva } = require("../models");
  return Reserva.todos((r) => r.especialistaId === especialistaId && r.id !== excluirReservaId && Reserva.ocupa(r, ahora));
}

async function horariosPara({ especialistaId, servicio, fecha, ahora = new Date(), excluirReservaId = null, duracion }) {
  const { Agenda } = require("../models");
  const agenda = await Agenda.de(especialistaId);
  const tz = agenda.zona || F.ZONA;
  const ocupado = await ocupacion(especialistaId, { excluirReservaId, ahora });
  const eseDia = ocupado.filter((o) => F.partes(o.inicio, tz).fecha === fecha).length;
  return horariosDelDia({ fecha, agenda, duracion: duracion || servicio.duracion, ocupado, ahora, tz, anticipacionMax: servicio.anticipacionMax, reservasEseDia: eseDia });
}

/** Resumen de días (cuántos turnos libres y el primero) para pintar el calendario. */
async function resumenDias({ especialistaId, servicio, desde, dias = 14, ahora = new Date(), excluirReservaId = null }) {
  const { Agenda } = require("../models");
  const agenda = await Agenda.de(especialistaId);
  const tz = agenda.zona || F.ZONA;
  const ocupado = await ocupacion(especialistaId, { ahora, excluirReservaId });
  const porDia = {};
  for (const o of ocupado) { const d = F.partes(o.inicio, tz).fecha; porDia[d] = (porDia[d] || 0) + 1; }
  const out = [];
  for (let i = 0; i < dias; i++) {
    const fecha = F.sumarDias(desde, i);
    const h = horariosDelDia({ fecha, agenda, duracion: servicio.duracion, ocupado, ahora, tz, anticipacionMax: servicio.anticipacionMax, reservasEseDia: porDia[fecha] || 0 });
    out.push({ fecha, cantidad: h.length, primero: h[0]?.hora || null });
  }
  return out;
}

/** Próximo horario libre (tarjetas de resultados y "Volver a reservar"). */
async function proximoTurno({ especialistaId, servicio, ahora = new Date(), dias = 21 }) {
  const r = await resumenDias({ especialistaId, servicio, desde: F.hoy(F.ZONA, ahora), dias, ahora });
  const d = r.find((x) => x.cantidad > 0);
  return d ? { fecha: d.fecha, hora: d.primero, inicio: F.aUtc(d.fecha, d.primero) } : null;
}

module.exports = { normalizarRangos, restarIntervalos, rangosDeFecha, horariosDelDia, ocupacion, horariosPara, resumenDias, proximoTurno };
