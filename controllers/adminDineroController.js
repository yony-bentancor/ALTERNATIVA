/* Administración del dinero: pagos, comisiones, reembolsos y liquidaciones (pantallas 113 a 117). */
const M = require("../models");
const Modelo = require("../models/Modelo");
const config = require("../config");
const F = require("../services/fechas");
const pagos = require("../services/pagos");
const liquidaciones = require("../services/liquidaciones");
const { invalido, noEncontrado } = require("../services/errores");
const { texto } = require("../services/util");

const vista = (res, v, datos) => res.render(`admin/${v}`, { area: "admin", ...datos });
const ok = (req, t) => { req.session.flash = { tipo: "ok", texto: t }; };
const EFECTIVOS = ["aprobado", "reembolso_parcial", "reembolsado", "a_cobrar", "en_disputa"];

// 113: pagos
exports.pagos = async (req, res) => {
  const q = req.query;
  const l = Modelo.ordenar(await M.Pago.todos((x) => (!q.estado || x.estado === q.estado) && (!q.modelo || x.modeloCobro === q.modelo) && (!q.proveedor || x.proveedor === q.proveedor)
    && (!q.q || x.idPasarela === String(q.q).trim() || x.id === String(q.q).trim())), "creado");
  const efectivos = (await M.Pago.todos((x) => EFECTIVOS.includes(x.estado)));
  const totales = {
    bruto: efectivos.reduce((a, x) => a + x.monto, 0), comision: efectivos.reduce((a, x) => a + x.comision, 0),
    pasarela: efectivos.reduce((a, x) => a + (x.comisionPasarela || 0), 0), reembolsado: efectivos.reduce((a, x) => a + (x.reembolsado || 0), 0),
    disputa: efectivos.filter((x) => x.estado === "en_disputa").length,
  };
  const p = Modelo.paginar(l, q.page, 30);
  vista(res, "pagos", { titulo: "Pagos", activo: "pagos", p, totales, rs: await M.Reserva.mapaPorIds(p.items.map((x) => x.reservaId)) });
};

exports.pago = async (req, res) => {
  const pago = await M.Pago.porId(req.params.id);
  if (!pago) throw noEncontrado();
  vista(res, "pago", { titulo: "Pago", activo: "pagos", pago, r: await M.Reserva.porId(pago.reservaId), reembolsos: await M.Reembolso.todos((x) => x.pagoId === pago.id), e: await M.Especialista.porId(pago.especialistaId), u: await M.Usuario.porId(pago.usuarioId) });
};

exports.sincronizar = async (req, res) => {
  const pago = await M.Pago.porId(req.params.id);
  if (!pago) throw noEncontrado();
  const prov = pagos.proveedor(["offline", "manual"].includes(pago.proveedor) ? config.pagos.proveedor : pago.proveedor);
  const pid = pago.idPasarela || (prov.buscarPorReferencia ? await prov.buscarPorReferencia(pago) : null);
  if (!pid) {
    req.session.flash = { tipo: "info", texto: "La pasarela todavía no informa un pago para esta reserva." };
    return res.redirect(`/admin/pagos/${pago.id}`);
  }
  const info = await prov.consultarPago(pid, { pago });
  await pagos.aplicarEstado(pago, info);
  await M.Auditoria.registrar(req, { accion: "pago.sincronizar", entidad: "pago", entidadId: pago.id, despues: { estado: pago.estado } });
  ok(req, `Estado en la pasarela: ${M.Pago.ESTADOS[pago.estado] || pago.estado}.`);
  res.redirect(`/admin/pagos/${pago.id}`);
};

exports.conciliar = async (req, res) => {
  const r = await pagos.conciliar();
  await M.Auditoria.registrar(req, { accion: "pago.conciliar", entidad: "pago", resumen: `${r.revisados} revisados, ${r.actualizados} actualizados` });
  ok(req, `Conciliación: ${r.revisados} pago(s) pendientes revisados, ${r.actualizados} actualizados.`);
  res.redirect("/admin/pagos");
};

// 114: comisiones (general + reglas por especialista, categoría o promoción)
exports.comisiones = async (req, res) => {
  const desde = new Date(Date.now() - 90 * 86400000);
  const efectivos = await M.Pago.todos((x) => ["aprobado", "reembolso_parcial", "a_cobrar"].includes(x.estado) && new Date(x.creado) >= desde);
  const porEsp = new Map();
  for (const x of efectivos) {
    const t = porEsp.get(x.especialistaId) || { id: x.especialistaId, comision: 0, bruto: 0, cantidad: 0 };
    t.comision += x.comision; t.bruto += x.monto; t.cantidad++;
    porEsp.set(x.especialistaId, t);
  }
  const reglas = (await M.ReglaComision.todos()).sort((a, b) => (b.activa !== false) - (a.activa !== false) || b.creado.localeCompare(a.creado));
  const especialistas = (await M.Especialista.todos((e) => !e.eliminado)).sort((a, b) => a.nombre.localeCompare(b.nombre));
  vista(res, "comisiones", {
    titulo: "Comisiones", activo: "comisiones", reglas, especialistas, categorias: await M.Categoria.todos(),
    conTasaPropia: especialistas.filter((e) => e.comision !== null && e.comision !== undefined),
    ranking: [...porEsp.values()].sort((a, b) => b.comision - a.comision).slice(0, 20), espMap: new Map(especialistas.map((e) => [e.id, e])),
  });
};

exports.crearRegla = async (req, res) => {
  const b = req.body;
  const nombre = texto(b.nombre, 100); const tasa = Number(String(b.tasa).replace(",", "."));
  if (!nombre) throw invalido("Escribí un nombre para la regla.");
  if (!M.ReglaComision.ALCANCES[b.alcance]) throw invalido("Elegí el alcance.");
  if (!(tasa >= 0 && tasa <= 50)) throw invalido("La tasa va de 0% a 50%.");
  if (b.alcance === "especialista" && !(await M.Especialista.porId(b.especialistaId))) throw invalido("Elegí el especialista.");
  if (b.alcance === "categoria" && !(await M.Categoria.porId(b.categoriaId))) throw invalido("Elegí la categoría.");
  if (b.desde && b.hasta && b.hasta < b.desde) throw invalido("La fecha de fin es anterior al inicio.");
  const regla = await M.ReglaComision.crear({
    nombre, alcance: b.alcance, tasa,
    especialistaId: b.alcance === "especialista" ? b.especialistaId : null, categoriaId: b.alcance === "categoria" ? b.categoriaId : null,
    especialistas: b.alcance === "promocion" && b.especialistaId ? [b.especialistaId] : [], categorias: b.alcance === "promocion" && b.categoriaId ? [b.categoriaId] : [],
    desde: F.fechaValida(b.desde) ? F.aUtc(b.desde).toISOString() : null, hasta: F.fechaValida(b.hasta) ? F.aUtc(F.sumarDias(b.hasta, 1)).toISOString() : null,
    activa: true, creadaPor: req.usuario.id,
  });
  await M.Auditoria.registrar(req, { accion: "comision.regla_crear", entidad: "regla", entidadId: regla.id, despues: { nombre, alcance: regla.alcance, tasa }, severidad: "aviso" });
  ok(req, "Creamos la regla. Aplica a las reservas nuevas; las existentes conservan su comisión.");
  res.redirect("/admin/comisiones");
};

exports.alternarRegla = async (req, res) => {
  const r = await M.ReglaComision.porId(req.params.id);
  if (!r) throw noEncontrado();
  r.activa = r.activa === false;
  await M.ReglaComision.guardar(r);
  await M.Auditoria.registrar(req, { accion: `comision.regla_${r.activa ? "activar" : "desactivar"}`, entidad: "regla", entidadId: r.id, severidad: "aviso" });
  ok(req, r.activa ? "Activamos la regla." : "Desactivamos la regla.");
  res.redirect("/admin/comisiones");
};

// 115: reembolsos
exports.reembolsos = async (req, res) => {
  const q = req.query;
  const l = Modelo.ordenar(await M.Reembolso.todos((x) => !q.estado || x.estado === q.estado), "creado");
  const p = Modelo.paginar(l, q.page, 30);
  const conteo = {};
  for (const x of await M.Reembolso.todos()) conteo[x.estado] = (conteo[x.estado] || 0) + 1;
  vista(res, "reembolsos", { titulo: "Reembolsos", activo: "reembolsos", p, conteo, rs: await M.Reserva.mapaPorIds(p.items.map((x) => x.reservaId)) });
};

exports.reintentar = async (req, res) => {
  try {
    const rb = await pagos.reintentarReembolso(req.params.id);
    await M.Auditoria.registrar(req, { accion: "reembolso.reintentar", entidad: "reembolso", entidadId: rb.id, despues: { estado: rb.estado }, severidad: "aviso" });
    ok(req, "El reembolso se procesó.");
  } catch (err) {
    if (err.estado) throw err;
    const rb = await M.Reembolso.porId(req.params.id);
    if (rb) { rb.error = String(err.message).slice(0, 300); await M.Reembolso.guardar(rb); }
    req.session.flash = { tipo: "error", texto: `La pasarela volvió a rechazarlo: ${err.message}` };
  }
  res.redirect("/admin/reembolsos");
};

exports.manual = async (req, res) => {
  const rb = await M.Reembolso.porId(req.params.id);
  if (!rb) throw noEncontrado();
  if (rb.estado === "procesado") throw invalido("Este reembolso ya está procesado.");
  const nota = texto(req.body.nota, 300);
  if (nota.length < 5) throw invalido("Indicá cómo se realizó la devolución (comprobante, transferencia, etc.).");
  Object.assign(rb, { estado: "procesado", procesadoEn: new Date().toISOString(), error: `Gestionado manualmente: ${nota}` });
  await M.Reembolso.guardar(rb);
  const pago = await M.Pago.porId(rb.pagoId);
  if (pago) {
    pago.reembolsado = (pago.reembolsado || 0) + rb.monto;
    pago.estado = pago.reembolsado >= pago.monto ? "reembolsado" : "reembolso_parcial";
    await M.Pago.guardar(pago);
  }
  const r = await M.Reserva.porId(rb.reservaId);
  if (r?.incidencia?.abierta) { r.incidencia.abierta = false; await M.Reserva.guardar(r); }
  await M.Auditoria.registrar(req, { accion: "reembolso.manual", entidad: "reembolso", entidadId: rb.id, despues: { nota }, severidad: "aviso" });
  ok(req, "Registramos la devolución manual y cerramos la incidencia.");
  res.redirect("/admin/reembolsos");
};

// 116: liquidaciones
exports.liquidaciones = async (req, res) => {
  const previa = await liquidaciones.liquidablesPorEspecialista(new Date());
  const l = Modelo.ordenar(await M.Liquidacion.todos(), "creado");
  vista(res, "liquidaciones", { titulo: "Liquidaciones", activo: "liquidaciones", previa, lista: l, espMap: await M.Especialista.mapaPorIds([...previa.map((x) => x.especialistaId), ...l.map((x) => x.especialistaId)]) });
};

exports.generar = async (req, res) => {
  const creadas = await liquidaciones.generar({ hasta: new Date(), admin: req.usuario });
  await M.Auditoria.registrar(req, { accion: "liquidacion.generar", entidad: "liquidacion", resumen: `${creadas.length} liquidaciones`, severidad: "aviso" });
  ok(req, creadas.length ? `Generamos ${creadas.length} liquidación(es).` : "No hay pagos para liquidar.");
  res.redirect("/admin/liquidaciones");
};

exports.pagar = async (req, res) => {
  const l = await liquidaciones.marcarPagada(req.params.id, { referencia: req.body.referencia, admin: req.usuario });
  await M.Auditoria.registrar(req, { accion: "liquidacion.pagar", entidad: "liquidacion", entidadId: l.id, despues: { neto: l.neto, referencia: l.referencia }, severidad: "aviso" });
  ok(req, `Marcamos la liquidación N.º ${l.numero} como pagada.`);
  res.redirect("/admin/liquidaciones");
};

exports.anular = async (req, res) => {
  const l = await liquidaciones.anular(req.params.id);
  await M.Auditoria.registrar(req, { accion: "liquidacion.anular", entidad: "liquidacion", entidadId: l.id, severidad: "aviso" });
  ok(req, `Anulamos la liquidación N.º ${l.numero}. Sus pagos vuelven a estar pendientes de liquidar.`);
  res.redirect("/admin/liquidaciones");
};
