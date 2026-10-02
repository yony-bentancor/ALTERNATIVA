/*
 * Comisiones y desglose de precios.
 * Decisión de producto (docs/decisiones.md → Modelo de pagos):
 * - El especialista define SU precio (lo que quiere recibir por el servicio).
 * - La tarifa de Alternativa se SUMA y el cliente ve un único precio final: $900 + 5% = $945 (modo "sumada").
 *   El modo "incluida" descuenta la comisión del precio, por si se necesita.
 * - El costo del procesador (Mercado Pago) se modela aparte y lo absorbe quien se configure.
 */
const { porcentaje } = require("./util");

const vigente = (r, ahora) => r.activa !== false && (!r.desde || new Date(r.desde) <= ahora) && (!r.hasta || new Date(r.hasta) >= ahora);
const enLista = (lista, id) => !lista || lista.length === 0 || lista.includes(id);

/**
 * Tasa de comisión aplicable.
 * Precedencia: promoción vigente (la más baja) → tasa fija del especialista → regla de especialista → regla de categoría → general.
 */
function resolverComision({ especialista, categoriaId, reglas = [], tasaGeneral, ahora = new Date() }) {
  const validas = reglas.filter((r) => vigente(r, ahora));
  const promos = validas.filter((r) => r.alcance === "promocion" && enLista(r.especialistas, especialista?.id) && enLista(r.categorias, categoriaId));
  if (promos.length) {
    const mejor = promos.reduce((a, b) => (b.tasa < a.tasa ? b : a));
    return { tasa: mejor.tasa, origen: "promocion", regla: mejor.nombre };
  }
  if (especialista && especialista.comision !== null && especialista.comision !== undefined && especialista.comision !== "") {
    return { tasa: Number(especialista.comision), origen: "especialista", regla: "Comisión particular del especialista" };
  }
  const deEsp = validas.find((r) => r.alcance === "especialista" && r.especialistaId === especialista?.id);
  if (deEsp) return { tasa: deEsp.tasa, origen: "regla_especialista", regla: deEsp.nombre };
  const deCat = validas.find((r) => r.alcance === "categoria" && r.categoriaId === categoriaId);
  if (deCat) return { tasa: deCat.tasa, origen: "categoria", regla: deCat.nombre };
  return { tasa: tasaGeneral, origen: "general", regla: "Comisión general" };
}

/**
 * Desglose completo de una operación.
 * comision = tarifa de Alternativa · netoEspecialista = lo del especialista antes del procesador
 * comisionMarketplace = lo que se envía a la pasarela como comisión del marketplace en el split.
 */
function desglose({ precio, recargo = 0, descuentoPct = 0, financia = "especialista", tasa, modo = "sumada", procesadorPct = 0, procesadorPaga = "especialista" }) {
  const subtotal = Math.round(precio + (recargo || 0));
  let descuento = descuentoPct ? porcentaje(subtotal, descuentoPct) : 0;
  let netoEspecialista; let tarifa; let clienteBase;

  if (modo === "incluida") {
    if (financia === "plataforma") {
      const completa = porcentaje(subtotal, tasa);
      descuento = Math.min(descuento, completa);
      tarifa = completa - descuento;
      clienteBase = subtotal - descuento;
    } else {
      clienteBase = subtotal - descuento;
      tarifa = porcentaje(clienteBase, tasa);
    }
    netoEspecialista = clienteBase - tarifa;
  } else {
    if (financia === "plataforma") {
      const completa = porcentaje(subtotal, tasa);
      descuento = Math.min(descuento, completa);
      netoEspecialista = subtotal;
      tarifa = completa - descuento;
    } else {
      netoEspecialista = subtotal - descuento;
      tarifa = porcentaje(netoEspecialista, tasa);
    }
    clienteBase = netoEspecialista + tarifa;
  }

  let total = clienteBase;
  let procesador = 0;
  let recibeEspecialista = netoEspecialista;
  let netoPlataforma = tarifa;
  let comisionMarketplace = tarifa;
  const r = Math.max(0, Math.min(50, procesadorPct || 0)) / 100;
  if (r > 0) {
    if (procesadorPaga === "cliente") {
      total = Math.round(clienteBase / (1 - r));
      procesador = total - clienteBase;
    } else if (procesadorPaga === "plataforma") {
      procesador = Math.round(total * r);
      netoPlataforma = tarifa - procesador;
      comisionMarketplace = Math.max(0, netoPlataforma);
    } else {
      procesador = Math.round(total * r);
      recibeEspecialista = netoEspecialista - procesador;
    }
  }
  return { subtotal, descuento, tarifa, total, comision: tarifa, netoEspecialista, procesador, recibeEspecialista, netoPlataforma, comisionMarketplace, procesadorPaga, modo };
}

/** Tasa para un especialista y categoría, leyendo reglas y configuración. */
async function comisionPara({ especialista, categoriaId, ahora = new Date() }) {
  const { ReglaComision, Config } = require("../models");
  const cfg = await Config.obtener();
  return resolverComision({ especialista, categoriaId, reglas: await ReglaComision.activas(), tasaGeneral: cfg.comision.tasaGeneral, ahora });
}

/** Precio final que ve el cliente en listados (sin promociones ni recargos). */
function precioPublico({ servicio, especialista, reglas, cfg, ahora = new Date() }) {
  const { tasa } = resolverComision({ especialista, categoriaId: servicio.categoriaId, reglas, tasaGeneral: cfg.comision.tasaGeneral, ahora });
  return desglose({ precio: servicio.precio, tasa, modo: cfg.comision.modo, procesadorPct: cfg.pagos.comisionProcesador, procesadorPaga: cfg.pagos.procesadorPaga }).total;
}

module.exports = { resolverComision, desglose, comisionPara, precioPublico };
