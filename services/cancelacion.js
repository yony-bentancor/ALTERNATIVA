/*
 * Política de cancelaciones, reprogramaciones y reembolsos.
 * Las reglas viven en Config (sección "cancelacion") y se copian en la reserva al crearla
 * (foto.politica): si administración cambia la política, las reservas existentes conservan la aceptada.
 */

/**
 * @param {'usuario'|'especialista'|'admin'} actor
 * @param {'cancelar'|'ausencia_usuario'|'ausencia_especialista'} tipo
 * @param {number} horasAntes  horas entre la acción y el inicio (negativo si ya empezó)
 */
function evaluarCancelacion({ actor, tipo = "cancelar", horasAntes, politica: p }) {
  if (tipo === "ausencia_usuario") return { porcentaje: p.porcentajeAusenciaUsuario, regla: "ausencia_usuario", texto: "Ausencia del usuario" };
  if (tipo === "ausencia_especialista") return { porcentaje: p.porcentajeAusenciaEspecialista, regla: "ausencia_especialista", texto: "Ausencia del especialista" };
  if (actor === "especialista") return { porcentaje: p.porcentajeCancelaEspecialista, regla: "cancela_especialista", texto: "Cancelación del especialista" };
  if (actor === "admin") return { porcentaje: 100, regla: "admin", texto: "Cancelación administrativa" };
  if (horasAntes >= p.horasReembolsoTotal) return { porcentaje: 100, regla: "anticipada", texto: `Cancelación con ${p.horasReembolsoTotal} h o más de anticipación` };
  if (horasAntes >= p.horasReembolsoParcial) return { porcentaje: p.porcentajeParcial, regla: "parcial", texto: `Cancelación entre ${p.horasReembolsoParcial} y ${p.horasReembolsoTotal} h antes` };
  return { porcentaje: p.porcentajeTardio, regla: "tardia", texto: `Cancelación con menos de ${p.horasReembolsoParcial} h` };
}

function puedeReprogramar({ horasAntes, reprogramaciones, politica: p, actor }) {
  if (actor === "especialista" || actor === "admin") return { ok: horasAntes > 0, motivo: horasAntes > 0 ? null : "La sesión ya comenzó." };
  if ((reprogramaciones || 0) >= p.maxReprogramaciones) return { ok: false, motivo: `Alcanzaste el máximo de ${p.maxReprogramaciones} reprogramaciones para esta reserva.` };
  if (horasAntes < p.horasMinReprogramar) return { ok: false, motivo: `Solo se puede reprogramar hasta ${p.horasMinReprogramar} h antes de la sesión.` };
  return { ok: true, motivo: null };
}

/**
 * Reparte un reembolso entre la comisión y el neto del especialista, en proporción.
 * Con reembolso total, Alternativa no retiene comisión.
 */
function repartirReembolso({ total, comision, porcentaje }) {
  const monto = Math.round((total * porcentaje) / 100);
  if (monto <= 0) return { monto: 0, comisionRevertida: 0, especialistaRevertido: 0 };
  const comisionRevertida = porcentaje >= 100 ? comision : Math.round((comision * porcentaje) / 100);
  return { monto, comisionRevertida, especialistaRevertido: monto - comisionRevertida };
}

function describirPolitica(p) {
  return [
    `Cancelando con ${p.horasReembolsoTotal} h o más de anticipación: reembolso del 100%.`,
    `Entre ${p.horasReembolsoParcial} y ${p.horasReembolsoTotal} h antes: reembolso del ${p.porcentajeParcial}%.`,
    `Con menos de ${p.horasReembolsoParcial} h: reembolso del ${p.porcentajeTardio}%.`,
    `Si no te presentás: reembolso del ${p.porcentajeAusenciaUsuario}%.`,
    `Si el especialista cancela o no se presenta: reembolso del ${p.porcentajeCancelaEspecialista}%.`,
    `Podés reprogramar sin costo hasta ${p.horasMinReprogramar} h antes (máximo ${p.maxReprogramaciones} veces).`,
  ];
}

module.exports = { evaluarCancelacion, puedeReprogramar, repartirReembolso, describirPolitica };
