'use strict';
// Política de cancelaciones, reprogramaciones y reembolsos.
// Las reglas viven en settings.cancellation y se copian en la reserva al crearla
// (snapshot.cancellationPolicy): si el admin cambia la política, las reservas
// existentes conservan la que aceptó el usuario.

/**
 * @param {object} p
 * @param {'user'|'specialist'|'admin'} p.actor
 * @param {'cancel'|'no_show_user'|'no_show_specialist'} p.kind
 * @param {number} p.hoursBefore  horas entre la acción y el inicio (negativo si ya empezó)
 * @param {object} p.policy
 * @returns {{refundPercent:number, rule:string, label:string, chargeCommission:boolean}}
 */
function evaluateCancellation({ actor, kind = 'cancel', hoursBefore, policy }) {
  if (kind === 'no_show_user') {
    return { refundPercent: policy.noShowUserRefundPercent, rule: 'no_show_user', label: 'Ausencia del usuario', chargeCommission: true };
  }
  if (kind === 'no_show_specialist') {
    return { refundPercent: policy.noShowSpecialistRefundPercent, rule: 'no_show_specialist', label: 'Ausencia del especialista', chargeCommission: false };
  }
  if (actor === 'specialist') {
    return { refundPercent: policy.specialistCancelRefundPercent, rule: 'specialist_cancel', label: 'Cancelación del especialista', chargeCommission: false };
  }
  if (actor === 'admin') {
    // El admin elige el porcentaje en la pantalla; por defecto reembolso total sin comisión.
    return { refundPercent: 100, rule: 'admin', label: 'Cancelación administrativa', chargeCommission: false };
  }
  if (hoursBefore >= policy.fullRefundHours) {
    return { refundPercent: 100, rule: 'early', label: `Cancelación con ${policy.fullRefundHours} h o más de anticipación`, chargeCommission: false };
  }
  if (hoursBefore >= policy.partialRefundHours) {
    return { refundPercent: policy.partialRefundPercent, rule: 'partial', label: `Cancelación entre ${policy.partialRefundHours} y ${policy.fullRefundHours} h antes`, chargeCommission: true };
  }
  return { refundPercent: policy.lateRefundPercent, rule: 'late', label: `Cancelación con menos de ${policy.partialRefundHours} h`, chargeCommission: true };
}

function canReschedule({ hoursBefore, rescheduleCount, policy, actor }) {
  if (actor === 'specialist' || actor === 'admin') return { ok: hoursBefore > 0, reason: hoursBefore > 0 ? null : 'La sesión ya comenzó.' };
  if (rescheduleCount >= policy.maxReschedules) return { ok: false, reason: `Alcanzaste el máximo de ${policy.maxReschedules} reprogramaciones para esta reserva.` };
  if (hoursBefore < policy.rescheduleMinHours) return { ok: false, reason: `Solo se puede reprogramar hasta ${policy.rescheduleMinHours} h antes de la sesión.` };
  return { ok: true, reason: null };
}

/**
 * Reparte un reembolso entre la comisión y el neto del especialista, en proporción.
 * Con reembolso total, Alternativa no retiene comisión; con reembolso parcial cada parte
 * conserva su proporción sobre lo que no se devuelve.
 */
function splitRefund({ total, commissionAmount, refundPercent }) {
  const amount = Math.round((total * refundPercent) / 100);
  if (amount <= 0) return { amount: 0, commissionReversed: 0, specialistReversed: 0 };
  const commissionReversed = refundPercent >= 100 ? commissionAmount : Math.round((commissionAmount * refundPercent) / 100);
  return { amount, commissionReversed, specialistReversed: amount - commissionReversed };
}

function describePolicy(policy) {
  return [
    `Cancelando con ${policy.fullRefundHours} h o más de anticipación: reembolso del 100%.`,
    `Entre ${policy.partialRefundHours} y ${policy.fullRefundHours} h antes: reembolso del ${policy.partialRefundPercent}%.`,
    `Con menos de ${policy.partialRefundHours} h: reembolso del ${policy.lateRefundPercent}%.`,
    `Si no te presentás: reembolso del ${policy.noShowUserRefundPercent}%.`,
    `Si el especialista cancela o no se presenta: reembolso del ${policy.specialistCancelRefundPercent}%.`,
    `Podés reprogramar sin costo hasta ${policy.rescheduleMinHours} h antes (máximo ${policy.maxReschedules} veces).`,
  ];
}

module.exports = { evaluateCancellation, canReschedule, splitRefund, describePolicy };
