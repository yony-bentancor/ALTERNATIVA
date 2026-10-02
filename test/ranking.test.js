'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bayesian, detectIntent, scoreItems, interleaveNewcomers, isNewcomer, haversineKm } = require('../src/services/ranking');

test('5,0★ con 2 reseñas no supera a 4,9★ con 127', () => {
  const few = bayesian(5, 2, 4.4, 10);
  const many = bayesian(4.9, 127, 4.4, 10);
  assert.ok(many > few, `${many} debería ser mayor que ${few}`);
});

test('sin reseñas el promedio ponderado es el previo de la plataforma', () => {
  assert.equal(bayesian(0, 0, 4.4, 10), 4.4);
});

test('interpreta intenciones en lenguaje natural', () => {
  const today = detectIntent('masaje hoy');
  assert.equal(today.when, 'today');
  assert.equal(today.text, 'masaje');
  assert.equal(today.specific, false);

  const sport = detectIntent('Masaje deportivo');
  assert.equal(sport.when, null);
  assert.equal(sport.specific, true);

  const near = detectIntent('reiki cerca a domicilio barato');
  assert.equal(near.near, true);
  assert.equal(near.modality, 'domicilio');
  assert.equal(near.cheap, true);
  assert.equal(near.text, 'reiki');

  assert.equal(detectIntent('yoga online mañana').when, 'tomorrow');
  assert.equal(detectIntent('yoga online mañana').modality, 'online');
});

test('"hoy" prioriza disponibilidad; búsqueda específica prioriza reputación', () => {
  const items = [
    { id: 'a', weightedRating: 4.9, price: 1000, nextSlotMinutes: 5000 },
    { id: 'b', weightedRating: 4.3, price: 1000, nextSlotMinutes: 120 },
  ];
  assert.equal(scoreItems(items, detectIntent('masaje hoy'))[0].id, 'b');
  assert.equal(scoreItems(items, detectIntent('masaje deportivo'))[0].id, 'a');
});

test('reserva posiciones para perfiles nuevos sin inventarles reputación', () => {
  const ranked = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, newcomer: false })),
    { id: 'n1', newcomer: true }, { id: 'n2', newcomer: true },
  ];
  const out = interleaveNewcomers(ranked, 6);
  assert.equal(out.length, 12);
  assert.equal(out[5].id, 'n1');
  assert.equal(out[11].id, 'n2');
  assert.equal(out[0].id, 'r0');
});

test('criterio de perfil nuevo', () => {
  const now = new Date('2026-10-02');
  assert.equal(isNewcomer({ publishedAt: new Date('2026-09-01'), reviewCount: 1, now }), true);
  assert.equal(isNewcomer({ publishedAt: new Date('2026-01-01'), reviewCount: 1, now }), false);
  assert.equal(isNewcomer({ publishedAt: new Date('2026-09-01'), reviewCount: 9, now }), false);
});

test('distancia Montevideo centro → Pocitos ≈ 4-5 km', () => {
  const d = haversineKm([-56.1913, -34.9058], [-56.1504, -34.9145]);
  assert.ok(d > 3 && d < 6, String(d));
});
