'use strict';
// Importes en pesos uruguayos enteros (sin centésimos: los servicios se cotizan en pesos redondos).
// Si en el futuro se necesitan centésimos, todos los importes pasan por estas funciones.

function toAmount(value) {
  const n = typeof value === 'number' ? value : Number(String(value).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n);
}

function percentOf(amount, percent) {
  return Math.round((amount * percent) / 100);
}

function fmtMoney(amount, currency = 'UYU') {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '';
  const n = Math.round(Number(amount));
  const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = n < 0 ? '-' : '';
  return currency === 'USD' ? `${sign}US$${s}` : `${sign}$${s}`;
}

function fmtPercent(p) {
  if (p === null || p === undefined) return '';
  return `${String(Math.round(p * 100) / 100).replace('.', ',')}%`;
}

module.exports = { toAmount, percentOf, fmtMoney, fmtPercent };
