'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCommission, priceBreakdown } = require('../src/services/commission');
const { evaluateCancellation, splitRefund, canReschedule } = require('../src/services/cancellation');
const { DEFAULTS } = require('../src/services/settings');

test('el cliente paga el precio del especialista + 5% ($900 → $945)', () => {
  const b = priceBreakdown({ price: 900, rate: 5, mode: 'added' });
  assert.equal(b.total, 945);
  assert.equal(b.commissionAmount, 45);
  assert.equal(b.specialistNet, 900);
  assert.equal(b.marketplaceFee, 45);
});

test('modo incluido: la comisión se descuenta del precio', () => {
  const b = priceBreakdown({ price: 900, rate: 5, mode: 'included' });
  assert.equal(b.total, 900);
  assert.equal(b.commissionAmount, 45);
  assert.equal(b.specialistNet, 855);
});

test('costo del procesador según quién lo absorbe', () => {
  const spec = priceBreakdown({ price: 900, rate: 5, processorRate: 6, processorPaidBy: 'specialist' });
  assert.equal(spec.total, 945);
  assert.equal(spec.processorFee, 57);
  assert.equal(spec.specialistReceives, 843);
  assert.equal(spec.marketplaceFee, 45);

  const cust = priceBreakdown({ price: 900, rate: 5, processorRate: 6, processorPaidBy: 'customer' });
  assert.equal(cust.total, Math.round(945 / 0.94));
  assert.equal(cust.specialistReceives, 900);
  assert.equal(cust.marketplaceFee, 45);
  // Tras descontar la comisión del procesador y la del marketplace, el especialista recibe sus $900
  assert.ok(Math.abs(cust.total * 0.94 - cust.marketplaceFee - 900) < 1);

  const plat = priceBreakdown({ price: 900, rate: 5, processorRate: 6, processorPaidBy: 'platform' });
  assert.equal(plat.total, 945);
  assert.equal(plat.specialistReceives, 900);
  assert.equal(plat.platformNet, 45 - 57);
  assert.equal(plat.marketplaceFee, 0);
});

test('promociones: quién absorbe el descuento', () => {
  const s = priceBreakdown({ price: 1000, rate: 5, discountPercent: 10, fundedBy: 'specialist' });
  assert.equal(s.discount, 100);
  assert.equal(s.specialistNet, 900);
  assert.equal(s.total, 945);
  const p = priceBreakdown({ price: 1000, rate: 5, discountPercent: 3, fundedBy: 'platform' });
  assert.equal(p.specialistNet, 1000);
  assert.equal(p.commissionAmount, 20);
  assert.equal(p.total, 1020);
  // El descuento financiado por la plataforma nunca supera su comisión
  const cap = priceBreakdown({ price: 1000, rate: 5, discountPercent: 20, fundedBy: 'platform' });
  assert.equal(cap.commissionAmount, 0);
  assert.equal(cap.total, 1000);
});

test('recargo a domicilio entra en la base del especialista', () => {
  const b = priceBreakdown({ price: 900, homeServiceExtra: 200, rate: 5 });
  assert.equal(b.specialistNet, 1100);
  assert.equal(b.total, 1155);
});

test('precedencia de reglas de comisión', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  const sp = { _id: 'S1', commissionRate: null };
  const rules = [
    { scope: 'category', category: 'C1', rate: 6, name: 'Cat', active: true },
    { scope: 'specialist', specialist: 'S1', rate: 7, name: 'Esp', active: true },
    { scope: 'promotion', rate: 3, name: 'Lanzamiento', active: true, validFrom: '2026-10-01', validTo: '2026-10-31', appliesToSpecialists: [], appliesToCategories: [] },
  ];
  assert.equal(resolveCommission({ specialist: sp, categoryId: 'C1', rules, globalRate: 5, now }).rate, 3);
  assert.equal(resolveCommission({ specialist: sp, categoryId: 'C1', rules: rules.slice(0, 2), globalRate: 5, now }).rate, 7);
  assert.equal(resolveCommission({ specialist: { _id: 'S2' }, categoryId: 'C1', rules: rules.slice(0, 2), globalRate: 5, now }).rate, 6);
  assert.equal(resolveCommission({ specialist: { _id: 'S2' }, categoryId: 'C9', rules: rules.slice(0, 2), globalRate: 5, now }).rate, 5);
  assert.equal(resolveCommission({ specialist: { _id: 'S1', commissionRate: 4 }, categoryId: 'C1', rules: rules.slice(0, 2), globalRate: 5, now }).rate, 4);
  const expired = [{ ...rules[2], validTo: '2026-09-30' }];
  assert.equal(resolveCommission({ specialist: sp, categoryId: 'C1', rules: expired, globalRate: 5, now }).rate, 5);
});

test('política de cancelación por defecto', () => {
  const policy = DEFAULTS.cancellation;
  assert.equal(evaluateCancellation({ actor: 'user', hoursBefore: 30, policy }).refundPercent, 100);
  assert.equal(evaluateCancellation({ actor: 'user', hoursBefore: 10, policy }).refundPercent, 50);
  assert.equal(evaluateCancellation({ actor: 'user', hoursBefore: 2, policy }).refundPercent, 0);
  assert.equal(evaluateCancellation({ actor: 'specialist', hoursBefore: 1, policy }).refundPercent, 100);
  assert.equal(evaluateCancellation({ actor: 'admin', kind: 'no_show_user', hoursBefore: -1, policy }).refundPercent, 0);
  assert.equal(evaluateCancellation({ actor: 'user', kind: 'no_show_specialist', hoursBefore: -1, policy }).refundPercent, 100);
});

test('reparto proporcional del reembolso', () => {
  assert.deepEqual(splitRefund({ total: 945, commissionAmount: 45, refundPercent: 100 }), { amount: 945, commissionReversed: 45, specialistReversed: 900 });
  const half = splitRefund({ total: 945, commissionAmount: 45, refundPercent: 50 });
  assert.equal(half.amount, 473);
  assert.equal(half.commissionReversed + half.specialistReversed, half.amount);
  assert.equal(splitRefund({ total: 945, commissionAmount: 45, refundPercent: 0 }).amount, 0);
});

test('reprogramación con límites', () => {
  const policy = DEFAULTS.cancellation;
  assert.equal(canReschedule({ hoursBefore: 48, rescheduleCount: 0, policy, actor: 'user' }).ok, true);
  assert.equal(canReschedule({ hoursBefore: 5, rescheduleCount: 0, policy, actor: 'user' }).ok, false);
  assert.equal(canReschedule({ hoursBefore: 48, rescheduleCount: 2, policy, actor: 'user' }).ok, false);
  assert.equal(canReschedule({ hoursBefore: 5, rescheduleCount: 5, policy, actor: 'specialist' }).ok, true);
});
