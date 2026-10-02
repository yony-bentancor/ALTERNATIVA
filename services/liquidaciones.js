/*
 * Liquidaciones (solo modelos "plataforma" y "offline"; en split la pasarela ya dividió el dinero).
 * - plataforma: Alternativa transfiere al especialista su neto menos reembolsos.
 * - offline: el especialista le debe a Alternativa la comisión.
 */
const store = require("../config/store");
const { invalido, noEncontrado } = require("./errores");
const { notificar } = require("./notificaciones");
const { pesos } = require("./util");

async function liquidablesPorEspecialista(hasta = new Date()) {
  const { Pago, Reserva, Reembolso } = require("../models");
  const pagos = await Pago.todos((p) => ["plataforma", "offline"].includes(p.modeloCobro) && p.liquidacion?.estado === "pendiente"
    && ["aprobado", "reembolso_parcial", "reembolsado", "a_cobrar"].includes(p.estado) && new Date(p.creado) <= hasta);
  const reservas = await Reserva.mapaPorIds(pagos.map((p) => p.reservaId));
  const rbs = await Reembolso.todos((r) => ["procesado", "manual"].includes(r.estado));
  const porPago = new Map();
  for (const r of rbs) {
    const c = porPago.get(r.pagoId) || { comision: 0, especialista: 0, monto: 0 };
    c.comision += r.comisionRevertida; c.especialista += r.especialistaRevertido; c.monto += r.monto;
    porPago.set(r.pagoId, c);
  }
  const grupos = new Map();
  for (const p of pagos) {
    const r = reservas.get(p.reservaId);
    if (!r || ["pendiente", "pagada", "confirmada"].includes(r.estado)) continue; // solo sesiones cerradas
    const k = `${p.especialistaId}:${p.modeloCobro}`;
    const g = grupos.get(k) || { especialistaId: p.especialistaId, modelo: p.modeloCobro, pagos: [], bruto: 0, comision: 0, reembolsos: 0, neto: 0 };
    const rf = porPago.get(p.id) || { comision: 0, especialista: 0, monto: 0 };
    g.pagos.push(p.id); g.bruto += p.monto; g.reembolsos += rf.monto;
    g.comision += p.comision - (p.modeloCobro === "plataforma" ? rf.comision : 0);
    g.neto += p.montoEspecialista - rf.especialista;
    grupos.set(k, g);
  }
  return [...grupos.values()];
}

async function generar({ hasta = new Date(), admin }) {
  const { Liquidacion, Pago } = require("../models");
  const creadas = [];
  for (const g of await liquidablesPorEspecialista(hasta)) {
    const direccion = g.modelo === "offline" ? "a_plataforma" : "al_especialista";
    const neto = direccion === "a_plataforma" ? g.comision : g.neto;
    if (neto <= 0) continue;
    const l = await Liquidacion.crear({ numero: store.siguienteNumero("liquidacion"), especialistaId: g.especialistaId, direccion, hasta: hasta.toISOString(), pagos: g.pagos, reservas: g.pagos.length, bruto: g.bruto, comision: g.comision, reembolsos: g.reembolsos, neto, estado: "pendiente", creadaPor: admin?.id });
    for (const p of await Pago.todos((x) => g.pagos.includes(x.id))) p.liquidacion = { estado: "incluida", liquidacionId: l.id };
    await Pago.guardar(null);
    creadas.push(l);
  }
  return creadas;
}

async function marcarPagada(id, { referencia, admin }) {
  const { Liquidacion, Pago, Especialista } = require("../models");
  const l = await Liquidacion.porId(id);
  if (!l) throw noEncontrado();
  if (l.estado !== "pendiente") throw invalido("La liquidación no está pendiente.");
  Object.assign(l, { estado: "pagada", referencia: String(referencia || "").slice(0, 120), pagadaEn: new Date().toISOString(), pagadaPor: admin.id });
  await Liquidacion.guardar(l);
  for (const p of await Pago.todos((x) => l.pagos.includes(x.id))) p.liquidacion = { ...p.liquidacion, estado: "liquidada", fecha: new Date().toISOString() };
  await Pago.guardar(null);
  const e = await Especialista.porId(l.especialistaId);
  if (e?.usuarioId) {
    await notificar(e.usuarioId, {
      tipo: "liquidacion", titulo: l.direccion === "al_especialista" ? "Te transferimos tu liquidación" : "Registramos tu pago de comisiones",
      texto: `Liquidación N.º ${l.numero} por ${pesos(l.neto)} (${l.reservas} reservas). Referencia: ${l.referencia || "—"}.`, enlace: "/panel/ingresos",
    });
  }
  return l;
}

async function anular(id) {
  const { Liquidacion, Pago } = require("../models");
  const l = await Liquidacion.porId(id);
  if (!l) throw noEncontrado();
  if (l.estado !== "pendiente") throw invalido("Solo se pueden anular liquidaciones pendientes.");
  l.estado = "anulada";
  await Liquidacion.guardar(l);
  for (const p of await Pago.todos((x) => l.pagos.includes(x.id))) p.liquidacion = { estado: "pendiente" };
  await Pago.guardar(null);
  return l;
}

module.exports = { liquidablesPorEspecialista, generar, marcarPagada, anular };
