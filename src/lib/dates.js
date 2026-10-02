'use strict';
// Utilidades de fecha con zona horaria explícita. Todo se guarda en UTC y se
// interpreta/visualiza en la zona del negocio (America/Montevideo por defecto).
const config = require('../config');

const DEFAULT_TZ = config.tz;
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad = (n) => String(n).padStart(2, '0');

const partsCache = new Map();
function formatter(tz) {
  if (!partsCache.has(tz)) {
    partsCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    }));
  }
  return partsCache.get(tz);
}

// Partes locales de un instante en la zona dada.
function localParts(date, tz = DEFAULT_TZ) {
  const d = date instanceof Date ? date : new Date(date);
  const p = {};
  for (const { type, value } of formatter(tz).formatToParts(d)) p[type] = value;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  const year = Number(p.year); const month = Number(p.month); const day = Number(p.day);
  const hour = Number(p.hour) % 24; const minute = Number(p.minute);
  return {
    year, month, day, hour, minute, second: Number(p.second), weekday: wd,
    dateStr: `${year}-${pad(month)}-${pad(day)}`,
    timeStr: `${pad(hour)}:${pad(minute)}`,
    minutesOfDay: hour * 60 + minute,
  };
}

// Diferencia (en minutos) entre la hora local de tz y UTC para ese instante.
function offsetMinutes(date, tz = DEFAULT_TZ) {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// "2026-10-02" + "14:30" en tz → instante UTC. Resuelve correctamente cambios de horario.
function zonedToUtc(dateStr, timeStr = '00:00', tz = DEFAULT_TZ) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let offset = offsetMinutes(new Date(guess), tz);
  let result = guess - offset * 60000;
  const offset2 = offsetMinutes(new Date(result), tz);
  if (offset2 !== offset) { offset = offset2; result = guess - offset * 60000; }
  return new Date(result);
}

function minutesToUtc(dateStr, minutes, tz = DEFAULT_TZ) {
  return zonedToUtc(dateStr, `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`, tz);
}

function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isValidTimeStr(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function hhmmToMinutes(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}
function minutesToHHMM(n) {
  return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
}

// Aritmética de fechas calendario (sin zona)
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function diffDays(a, b) {
  const toUtc = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}
function todayStr(tz = DEFAULT_TZ, now = new Date()) {
  return localParts(now, tz).dateStr;
}
function startOfWeek(dateStr) { // lunes
  const wd = weekdayOf(dateStr);
  return addDays(dateStr, wd === 0 ? -6 : 1 - wd);
}
function monthGrid(year, month) { // semanas (lunes a domingo) que cubren el mes
  const first = `${year}-${pad(month)}-01`;
  let cursor = startOfWeek(first);
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const days = [];
    for (let i = 0; i < 7; i++) { days.push(cursor); cursor = addDays(cursor, 1); }
    weeks.push(days);
    if (Number(cursor.slice(5, 7)) !== month && w >= 3) break;
  }
  return weeks;
}

// Formatos para la interfaz
function fmtDate(date, tz = DEFAULT_TZ) {
  if (!date) return '';
  const p = localParts(date, tz);
  return `${WEEKDAYS[p.weekday]} ${p.day} de ${MONTHS[p.month - 1]}`;
}
function fmtDateShort(date, tz = DEFAULT_TZ) {
  if (!date) return '';
  const p = localParts(date, tz);
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
}
function fmtTime(date, tz = DEFAULT_TZ) {
  if (!date) return '';
  return localParts(date, tz).timeStr;
}
function fmtDateTime(date, tz = DEFAULT_TZ) {
  if (!date) return '';
  return `${fmtDate(date, tz)}, ${fmtTime(date, tz)} h`;
}
function fmtDateStr(dateStr) { // "2026-10-02" → "viernes 2 de octubre"
  const [, m, d] = dateStr.split('-').map(Number);
  return `${WEEKDAYS[weekdayOf(dateStr)]} ${d} de ${MONTHS[m - 1]}`;
}
function fmtRelative(date, now = new Date()) {
  if (!date) return '';
  const diff = Math.round((new Date(date).getTime() - now.getTime()) / 60000);
  const abs = Math.abs(diff);
  const s = (v, unit) => (diff < 0 ? `hace ${v} ${unit}` : `en ${v} ${unit}`);
  if (abs < 1) return 'ahora';
  if (abs < 60) return s(abs, abs === 1 ? 'minuto' : 'minutos');
  const h = Math.round(abs / 60);
  if (h < 24) return s(h, h === 1 ? 'hora' : 'horas');
  const d = Math.round(h / 24);
  if (d < 30) return s(d, d === 1 ? 'día' : 'días');
  return fmtDateShort(date);
}

module.exports = {
  DEFAULT_TZ, WEEKDAYS, WEEKDAYS_SHORT, MONTHS, pad,
  localParts, offsetMinutes, zonedToUtc, minutesToUtc, isValidDateStr, isValidTimeStr,
  hhmmToMinutes, minutesToHHMM, addDays, weekdayOf, diffDays, todayStr, startOfWeek, monthGrid,
  fmtDate, fmtDateShort, fmtTime, fmtDateTime, fmtDateStr, fmtRelative,
};
