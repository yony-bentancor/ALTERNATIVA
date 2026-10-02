/*
 * Pagos: inicio del checkout, estados que informa la pasarela (webhooks), reembolsos, contracargos y conciliación.
 * Independiente del proveedor (ver pagos/simulado.js y pagos/mercadopago.js).
 */
const config = require("../../config");
const store = require("../../config/store");
const { invalido, noEncontrado } = require("../errores");
const { notificar, notificarAdmins } = require("../notificaciones");
const { pesos } = require("../util");

const proveedores = { simulado: require("./simulado"), mercadopago: require("./mercadopago") };
function proveedor(nombre = config.pagos.proveedor) {
  const p = proveedores[nombre];
  if (!p) throw new Error(`Proveedor de pagos desconocido: ${nombre}`);
  return p;
}
const reservas = () => require("../reservas");
const ahoraISO = () => new Date().toISOString();

// Estados de la pasarela → estados de Alternativa
const MAPA = { approved: "aprobado", rejected: "rechazado", cancelled: "cancelado", refunded: "reembolsado", charged_back: "contracargo", in_mediation: "en_disputa", pending: "pendiente", in_process: "pendiente", authorized: "pendiente" };

/** Crea (o reutiliza) el pago de una reserva y devuelve el pago con la URL de checkout. */
async function iniciarPago(r, usuario) {
  const { Pago, Especialista, Reserva } = require("../../models");
  if (r.estado !== "pendiente") throw invalido("Esta reserva no tiene un pago pendiente.");
  if (r.vencePago && new Date(r.vencePago) < new Date()) throw invalido("El tiempo para pagar venció. Elegí el horario nuevamente.");
  let pago = r.pagoId ? await Pago.porId(r.pagoId) : null;
  if (pago && pago.estado === "pendiente" && pago.urlCheckout) return pago;
  const modelo = r.foto.modeloCobro;
  pago = await Pago.crear({
    reservaId: r.id, usuarioId: r.usuarioId, especialistaId: r.especialistaId, proveedor: config.pagos.proveedor, modeloCobro: modelo,
    monto: r.foto.total, moneda: r.foto.moneda, comision: r.foto.comision, montoEspecialista: r.foto.netoEspecialista,
    comisionMarketplace: r.foto.comisionMarketplace, comisionPasarelaEstimada: r.foto.procesadorEstimado, comisionPasarela: 0, reembolsado: 0,
    estado: "pendiente", liquidacion: { estado: modelo === "split" ? "no_aplica" : "pendiente" }, eventos: [{ fecha: ahoraISO(), tipo: "creado" }],
  });
  const e = await Especialista.porId(r.especialistaId);
  try {
    const { urlCheckout, preferenciaId } = await proveedor().crearCheckout({ reserva: r, pago, usuario, especialista: e, modelo });
    pago.urlCheckout = urlCheckout;
    pago.preferenciaId = preferenciaId;
    await Pago.guardar(pago);
  } catch (err) {
    pago.estado = "cancelado";
    pago.detalle = String(err.message).slice(0, 200);
    await Pago.evento(pago, "error_checkout", { mensaje: err.message });
    throw invalido("No pudimos iniciar el pago en este momento. Probá de nuevo en unos minutos.");
  }
  await Reserva.actualizar(r.id, { pagoId: pago.id });
  return pago;
}

/** Aplica el estado informado por la pasarela. Idempotente: se puede llamar varias veces. */
async function aplicarEstado(pago, info) {
  const { Pago, Reserva } = require("../../models");
  const antes = pago.estado;
  const nuevo = MAPA[info.status] || info.status;
  pago.idPasarela = info.id || pago.idPasarela;
  pago.detalle = info.statusDetail;
  pago.medio = info.method || pago.medio;
  if (info.providerFee !== undefined) pago.comisionPasarela = info.providerFee;
  if (info.marketplaceFee) pago.comisionMarketplace = info.marketplaceFee;
  if (info.collectorId) pago.cobradorId = info.collectorId;
  pago.sincronizado = ahoraISO();
  pago.eventos = pago.eventos || [];
  pago.eventos.push({ fecha: ahoraISO(), tipo: "estado_pasarela", datos: { estado: info.status, detalle: info.statusDetail } });
  const r = await Reserva.porId(pago.reservaId);
  if (!r) { await Pago.guardar(pago); return pago; }

  if (nuevo === "aprobado" && antes !== "aprobado" && !["reembolsado", "reembolso_parcial"].includes(antes)) {
    pago.estado = "aprobado";
    pago.pagadoEn = info.paidAt ? new Date(info.paidAt).toISOString() : ahoraISO();
    await Pago.guardar(pago);
    await reservas().marcarPagada(r, pago);
    return pago;
  }
  if (["rechazado", "cancelado"].includes(nuevo) && antes === "pendiente") { pago.estado = nuevo; await Pago.guardar(pago); return pago; }
  if (nuevo === "reembolsado" && antes !== "reembolsado") {
    // Reembolso hecho desde la cuenta de Mercado Pago (fuera de Alternativa): se registra y se avisa.
    pago.estado = "reembolsado";
    pago.reembolsado = info.refundedAmount || pago.monto;
    await Pago.guardar(pago);
    if (!["cancelada_usuario", "cancelada_especialista", "reembolsada"].includes(r.estado)) {
      r.incidencia = { abierta: true, nota: "Reembolso realizado fuera de Alternativa", fecha: ahoraISO() };
      await Reserva.guardar(r);
      await notificarAdmins({ titulo: "Reembolso externo detectado", texto: `La reserva ${r.codigo} fue reembolsada desde la pasarela. Revisá el estado.`, enlace: `/admin/reservas/${r.id}`, clave: `ext:${pago.id}` });
    }
    return pago;
  }
  if (["contracargo", "en_disputa"].includes(nuevo) && antes !== nuevo) {
    pago.estado = nuevo;
    pago.contracargo = { estado: nuevo, monto: pago.monto, fecha: ahoraISO() };
    await Pago.guardar(pago);
    r.incidencia = { abierta: true, nota: nuevo === "contracargo" ? "Contracargo del medio de pago" : "Pago en disputa", fecha: ahoraISO() };
    await Reserva.guardar(r);
    await notificarAdmins({ titulo: nuevo === "contracargo" ? "Contracargo recibido" : "Pago en disputa", texto: `Reserva ${r.codigo} · ${r.foto.especialista}. Requiere revisión y documentación.`, enlace: `/admin/reservas/${r.id}`, clave: `cb:${pago.id}:${nuevo}` });
    return pago;
  }
  await Pago.guardar(pago);
  return pago;
}

/** Webhook de la pasarela. */
async function procesarWebhook(nombre, req) {
  const { Pago } = require("../../models");
  const p = proveedor(nombre);
  if (!p.verificarWebhook(req)) return { ok: false, estado: 401 };
  const tipo = req.query.type || req.query.topic || req.body?.type || req.body?.topic;
  const id = req.query["data.id"] || req.query.id || req.body?.data?.id;
  if (!id) return { ok: true, ignorado: "sin id" };
  if (tipo === "payment") {
    let pago = await Pago.uno((x) => x.idPasarela === String(id));
    if (!pago && req.query.pago) pago = await Pago.porId(String(req.query.pago));
    const info = await p.consultarPago(String(id), { pago });
    if (!pago && info.externalReference) pago = await Pago.porId(info.externalReference);
    if (!pago) return { ok: true, ignorado: "pago desconocido" };
    await aplicarEstado(pago, info);
    return { ok: true };
  }
  if (tipo === "chargebacks" && p.consultarContracargo) {
    const cb = await p.consultarContracargo(String(id));
    for (const pid of (cb.payments || []).map(String)) {
      const pago = await Pago.uno((x) => x.idPasarela === pid);
      if (pago) await aplicarEstado(pago, { id: pid, status: "charged_back", statusDetail: cb.status });
    }
    return { ok: true };
  }
  return { ok: true, ignorado: tipo };
}

/**
 * Ejecuta un reembolso en la pasarela y registra el resultado.
 * Si la pasarela lo rechaza (p. ej. el especialista no tiene saldo en un split), queda como incidencia
 * con ticket de prioridad alta y alerta a administración: requiere intervención humana.
 */
async function reembolsar({ reserva: r, pago, rep, porcentaje, motivo, regla, actor, rol }) {
  const { Reembolso, Pago, Reserva, Consulta } = require("../../models");
  if (!pago || rep.monto <= 0) return null;
  const rb = await Reembolso.crear({
    reservaId: r.id, pagoId: pago.id, usuarioId: r.usuarioId, especialistaId: r.especialistaId, monto: rep.monto, porcentaje,
    comisionRevertida: rep.comisionRevertida, especialistaRevertido: rep.especialistaRevertido, motivo, regla, iniciadoPor: actor?.id || null, rolIniciador: rol, estado: "pendiente",
  });
  if (pago.estado === "a_cobrar" || pago.proveedor === "offline") {
    rb.estado = "manual";
    rb.error = "Pago cobrado por el especialista: la devolución la hace el especialista.";
    await Reembolso.guardar(rb);
    return rb;
  }
  try {
    const res = await proveedor(pago.proveedor === "manual" ? config.pagos.proveedor : pago.proveedor).reembolsar({ pago, monto: rep.monto });
    rb.estado = "procesado"; rb.idPasarela = res.id; rb.procesadoEn = ahoraISO();
    await Reembolso.guardar(rb);
    pago.reembolsado = (pago.reembolsado || 0) + rep.monto;
    pago.estado = pago.reembolsado >= pago.monto ? "reembolsado" : "reembolso_parcial";
    await Pago.evento(pago, "reembolso", { monto: rep.monto, id: res.id });
    await notificar(r.usuarioId, { tipo: "reembolso", titulo: "Reembolso procesado", texto: `Te devolvimos ${pesos(rep.monto)} por la reserva ${r.codigo}. Según tu medio de pago, puede demorar algunos días en verse.`, enlace: `/mi/reservas/${r.id}` });
  } catch (err) {
    rb.estado = "fallido"; rb.error = String(err.message).slice(0, 300);
    await Reembolso.guardar(rb);
    r.incidencia = { abierta: true, nota: `Reembolso fallido: ${rb.error}`, fecha: ahoraISO() };
    await Reserva.guardar(r);
    await Consulta.crear({
      numero: store.siguienteNumero("consulta"), usuarioId: r.usuarioId, reservaId: r.id, tema: "reembolso", prioridad: "alta", estado: "abierta",
      asunto: `Reembolso pendiente ${r.codigo}`, mensajes: [{ rol: "sistema", texto: `El reembolso automático de ${pesos(rep.monto)} falló: ${rb.error}. Gestionarlo manualmente.`, fecha: ahoraISO() }],
    });
    await notificarAdmins({ titulo: "Reembolso fallido", texto: `Reserva ${r.codigo}: ${rb.error}`, enlace: "/admin/reembolsos", clave: `rbf:${rb.id}` });
  }
  return rb;
}

/** Reintento manual desde administración. */
async function reintentarReembolso(id) {
  const { Reembolso, Pago, Reserva } = require("../../models");
  const rb = await Reembolso.porId(id);
  if (!rb) throw noEncontrado();
  if (!["fallido", "pendiente"].includes(rb.estado)) throw invalido("Este reembolso no está pendiente.");
  const pago = await Pago.porId(rb.pagoId);
  const res = await proveedor(pago.proveedor).reembolsar({ pago, monto: rb.monto });
  Object.assign(rb, { estado: "procesado", idPasarela: res.id, procesadoEn: ahoraISO(), error: "" });
  await Reembolso.guardar(rb);
  pago.reembolsado = (pago.reembolsado || 0) + rb.monto;
  pago.estado = pago.reembolsado >= pago.monto ? "reembolsado" : "reembolso_parcial";
  await Pago.guardar(pago);
  const r = await Reserva.porId(rb.reservaId);
  if (r?.incidencia?.abierta) { r.incidencia.abierta = false; await Reserva.guardar(r); }
  return rb;
}

/** Conciliación: pagos pendientes sin webhook se consultan a la pasarela. */
async function conciliar({ ahora = new Date() } = {}) {
  const { Pago } = require("../../models");
  const pendientes = await Pago.todos((p) => p.estado === "pendiente" && p.proveedor !== "simulado" && ahora - new Date(p.creado) > 3 * 60000 && ahora - new Date(p.creado) < 3 * 86400000);
  let actualizados = 0;
  for (const pago of pendientes) {
    try {
      const p = proveedor(pago.proveedor);
      const pid = pago.idPasarela || (await p.buscarPorReferencia(pago));
      if (!pid) continue;
      await aplicarEstado(pago, await p.consultarPago(pid, { pago }));
      actualizados++;
    } catch { /* se reintenta en la próxima pasada */ }
  }
  return { revisados: pendientes.length, actualizados };
}

module.exports = { proveedor, proveedores, iniciarPago, aplicarEstado, procesarWebhook, reembolsar, reintentarReembolso, conciliar };
