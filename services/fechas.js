/*
 * Fechas con zona horaria explícita. Todo se guarda en UTC (ISO) y se interpreta/visualiza
 * en la hora de Uruguay (America/Montevideo) por defecto.
 */
const config = require("../config");

const ZONA = config.zonaHoraria;
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const dos = (n) => String(n).padStart(2, "0");

const formateadores = new Map();
function formateador(tz) {
  if (!formateadores.has(tz)) {
    formateadores.set(tz, new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    }));
  }
  return formateadores.get(tz);
}

/** Partes locales de un instante. */
function partes(fecha, tz = ZONA) {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  const p = {};
  for (const { type, value } of formateador(tz).formatToParts(d)) p[type] = value;
  const diaSemana = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  const anio = Number(p.year); const mes = Number(p.month); const dia = Number(p.day);
  const hora = Number(p.hour) % 24; const minuto = Number(p.minute);
  return { anio, mes, dia, hora, minuto, segundo: Number(p.second), diaSemana, fecha: `${anio}-${dos(mes)}-${dos(dia)}`, horaTexto: `${dos(hora)}:${dos(minuto)}`, minutosDelDia: hora * 60 + minuto };
}

function desfaseMinutos(fecha, tz = ZONA) {
  const p = partes(fecha, tz);
  const comoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return Math.round((comoUtc - Math.floor(fecha.getTime() / 1000) * 1000) / 60000);
}

/** "2026-10-02" + "14:30" en la zona → instante UTC (resuelve cambios de horario). */
function aUtc(fechaTexto, horaTexto = "00:00", tz = ZONA) {
  const [y, m, d] = fechaTexto.split("-").map(Number);
  const [hh, mm] = horaTexto.split(":").map(Number);
  const supuesto = Date.UTC(y, m - 1, d, hh, mm);
  let desfase = desfaseMinutos(new Date(supuesto), tz);
  let r = supuesto - desfase * 60000;
  const d2 = desfaseMinutos(new Date(r), tz);
  if (d2 !== desfase) { desfase = d2; r = supuesto - desfase * 60000; }
  return new Date(r);
}

const minutosAUtc = (fechaTexto, minutos, tz = ZONA) => aUtc(fechaTexto, `${dos(Math.floor(minutos / 60))}:${dos(minutos % 60)}`, tz);

function fechaValida(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const horaValida = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const aMinutos = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const aHora = (n) => `${dos(Math.floor(n / 60))}:${dos(n % 60)}`;

function sumarDias(fechaTexto, n) {
  const [y, m, d] = fechaTexto.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${dos(dt.getUTCMonth() + 1)}-${dos(dt.getUTCDate())}`;
}
function diaSemana(fechaTexto) {
  const [y, m, d] = fechaTexto.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function diferenciaDias(a, b) {
  const u = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((u(b) - u(a)) / 86400000);
}
const hoy = (tz = ZONA, ahora = new Date()) => partes(ahora, tz).fecha;
function inicioSemana(fechaTexto) { // lunes
  const wd = diaSemana(fechaTexto);
  return sumarDias(fechaTexto, wd === 0 ? -6 : 1 - wd);
}
/** Semanas (lunes a domingo) que cubren un mes. */
function grillaMes(anio, mes) {
  let cursor = inicioSemana(`${anio}-${dos(mes)}-01`);
  const semanas = [];
  for (let w = 0; w < 6; w++) {
    const dias = [];
    for (let i = 0; i < 7; i++) { dias.push(cursor); cursor = sumarDias(cursor, 1); }
    semanas.push(dias);
    if (Number(cursor.slice(5, 7)) !== mes && w >= 3) break;
  }
  return semanas;
}

// ── Formatos para la interfaz ────────────────────────────
function fFecha(f) { if (!f) return ""; const p = partes(f); return `${DIAS[p.diaSemana]} ${p.dia} de ${MESES[p.mes - 1]}`; }
function fCorta(f) { if (!f) return ""; const p = partes(f); return `${dos(p.dia)}/${dos(p.mes)}/${p.anio}`; }
function fHora(f) { return f ? partes(f).horaTexto : ""; }
function fFechaHora(f) { return f ? `${fFecha(f)}, ${fHora(f)} h` : ""; }
function fFechaTexto(fechaTexto) { const [, m, d] = fechaTexto.split("-").map(Number); return `${DIAS[diaSemana(fechaTexto)]} ${d} de ${MESES[m - 1]}`; }
function fRelativa(f, ahora = new Date()) {
  if (!f) return "";
  const diff = Math.round((new Date(f).getTime() - ahora.getTime()) / 60000);
  const abs = Math.abs(diff);
  const s = (v, u) => (diff < 0 ? `hace ${v} ${u}` : `en ${v} ${u}`);
  if (abs < 1) return "ahora";
  if (abs < 60) return s(abs, abs === 1 ? "minuto" : "minutos");
  const h = Math.round(abs / 60);
  if (h < 24) return s(h, h === 1 ? "hora" : "horas");
  const d = Math.round(h / 24);
  if (d < 30) return s(d, d === 1 ? "día" : "días");
  return fCorta(f);
}
/** "hoy", "mañana" o "vie 9". */
function fDiaCercano(fechaTexto) {
  const h = hoy();
  if (fechaTexto === h) return "hoy";
  if (fechaTexto === sumarDias(h, 1)) return "mañana";
  return `${DIAS_CORTOS[diaSemana(fechaTexto)]} ${Number(fechaTexto.slice(8))}`;
}

module.exports = {
  ZONA, DIAS, DIAS_CORTOS, MESES, dos, partes, aUtc, minutosAUtc, fechaValida, horaValida, aMinutos, aHora,
  sumarDias, diaSemana, diferenciaDias, hoy, inicioSemana, grillaMes,
  fFecha, fCorta, fHora, fFechaHora, fFechaTexto, fRelativa, fDiaCercano,
};
