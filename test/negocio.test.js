/* Pruebas de las reglas de negocio puras (sin servidor ni base de datos): npm test */
const test = require("node:test");
const assert = require("node:assert/strict");
const { desglose, resolverComision } = require("../services/comision");
const { evaluarCancelacion, puedeReprogramar, repartirReembolso } = require("../services/cancelacion");
const { bayesiano, detectarIntencion, intercalarNuevos } = require("../services/ranking");
const { horariosDelDia, restarIntervalos } = require("../services/disponibilidad");
const { numeroWhatsapp, enlaceWhatsapp, ocultarContacto, slug } = require("../services/util");
const { PREDETERMINADA } = require("../models/Config");
const F = require("../services/fechas");

const politica = PREDETERMINADA.cancelacion;

test("comisión sumada: el cliente paga precio + tarifa", () => {
  const d = desglose({ precio: 900, tasa: 5, modo: "sumada" });
  assert.equal(d.tarifa, 45);
  assert.equal(d.total, 945);
  assert.equal(d.netoEspecialista, 900);
});

test("comisión incluida: el especialista absorbe la tarifa", () => {
  const d = desglose({ precio: 900, tasa: 5, modo: "incluida" });
  assert.equal(d.total, 900);
  assert.equal(d.netoEspecialista, 855);
});

test("costo de pasarela a cargo del especialista", () => {
  const d = desglose({ precio: 900, tasa: 5, modo: "sumada", procesadorPct: 6.09, procesadorPaga: "especialista" });
  assert.equal(d.total, 945);
  assert.equal(d.procesador, Math.round(945 * 0.0609));
  assert.equal(d.recibeEspecialista, 900 - d.procesador);
});

test("promoción financiada por la plataforma no reduce el neto del especialista", () => {
  const d = desglose({ precio: 1000, tasa: 5, modo: "sumada", descuentoPct: 15, financia: "plataforma" });
  assert.equal(d.netoEspecialista, 1000);
  assert.ok(d.descuento <= 50, "el descuento nunca supera la tarifa");
  assert.equal(d.total, 1000 + d.tarifa);
});

test("precedencia de comisiones: promoción → especialista → categoría → general", () => {
  const reglas = [
    { nombre: "Acupuntura", alcance: "categoria", categoriaId: "c1", tasa: 8, activa: true },
    { nombre: "Lanzamiento", alcance: "promocion", especialistas: ["e2"], categorias: [], tasa: 3, activa: true },
  ];
  assert.equal(resolverComision({ especialista: { id: "e1" }, categoriaId: "c9", reglas, tasaGeneral: 5 }).tasa, 5);
  assert.equal(resolverComision({ especialista: { id: "e1" }, categoriaId: "c1", reglas, tasaGeneral: 5 }).tasa, 8);
  assert.equal(resolverComision({ especialista: { id: "e1", comision: 6 }, categoriaId: "c1", reglas, tasaGeneral: 5 }).tasa, 6);
  assert.equal(resolverComision({ especialista: { id: "e2", comision: 6 }, categoriaId: "c1", reglas, tasaGeneral: 5 }).tasa, 3);
});

test("política de cancelación por anticipación", () => {
  assert.equal(evaluarCancelacion({ actor: "usuario", horasAntes: 30, politica }).porcentaje, 100);
  assert.equal(evaluarCancelacion({ actor: "usuario", horasAntes: 10, politica }).porcentaje, politica.porcentajeParcial);
  assert.equal(evaluarCancelacion({ actor: "usuario", horasAntes: 2, politica }).porcentaje, politica.porcentajeTardio);
  assert.equal(evaluarCancelacion({ actor: "especialista", horasAntes: 1, politica }).porcentaje, 100);
  assert.equal(evaluarCancelacion({ actor: "admin", tipo: "ausencia_usuario", horasAntes: -1, politica }).porcentaje, politica.porcentajeAusenciaUsuario);
});

test("reprogramación: plazo mínimo y máximo de veces", () => {
  assert.equal(puedeReprogramar({ horasAntes: 48, reprogramaciones: 0, politica, actor: "usuario" }).ok, true);
  assert.equal(puedeReprogramar({ horasAntes: 2, reprogramaciones: 0, politica, actor: "usuario" }).ok, false);
  assert.equal(puedeReprogramar({ horasAntes: 48, reprogramaciones: politica.maxReprogramaciones, politica, actor: "usuario" }).ok, false);
});

test("reembolso: proporcional y total sin retener comisión", () => {
  assert.deepEqual(repartirReembolso({ total: 945, comision: 45, porcentaje: 100 }), { monto: 945, comisionRevertida: 45, especialistaRevertido: 900 });
  const parcial = repartirReembolso({ total: 1000, comision: 50, porcentaje: 50 });
  assert.equal(parcial.monto, 500);
  assert.equal(parcial.comisionRevertida + parcial.especialistaRevertido, 500);
  assert.equal(repartirReembolso({ total: 1000, comision: 50, porcentaje: 0 }).monto, 0);
});

test("ranking bayesiano: 1 reseña de 5★ no le gana a 80 de 4,8★", () => {
  assert.ok(bayesiano(4.8, 80) > bayesiano(5, 1));
});

test("búsqueda en lenguaje natural", () => {
  const i = detectarIntencion("masaje hoy cerca");
  assert.equal(i.cuando, "hoy");
  assert.equal(i.cerca, true);
  assert.equal(detectarIntencion("reiki online").modalidad, "online");
  assert.equal(detectarIntencion("masaje barato a domicilio").modalidad, "domicilio");
});

test("perfiles nuevos se intercalan sin inventarles reputación", () => {
  const lista = [...Array(10)].map((_, k) => ({ id: `n${k}`, nuevo: false })).concat([{ id: "x", nuevo: true }]);
  const res = intercalarNuevos(lista, 6);
  assert.equal(res.length, 11);
  assert.ok(res.findIndex((r) => r.id === "x") <= 6);
});

test("disponibilidad: descuenta descansos y reservas ocupadas", () => {
  assert.deepEqual(restarIntervalos([{ inicio: 540, fin: 1080 }], [{ inicio: 780, fin: 840 }]), [{ inicio: 540, fin: 780 }, { inicio: 840, fin: 1080 }]);
  const manana = F.sumarDias(F.hoy(), 1);
  const agenda = { semanal: [{ dia: F.diaSemana(manana), rangos: [{ inicio: "09:00", fin: "12:00" }] }], paso: 60, anticipacionMax: 60 };
  const libres = horariosDelDia({ fecha: manana, agenda, duracion: 60 });
  assert.deepEqual(libres.map((h) => h.hora), ["09:00", "10:00", "11:00"]);
  const ocupado = [{ inicio: F.aUtc(manana, "10:00"), fin: F.aUtc(manana, "11:00") }];
  assert.deepEqual(horariosDelDia({ fecha: manana, agenda, duracion: 60, ocupado }).map((h) => h.hora), ["09:00", "11:00"]);
});

test("WhatsApp: números uruguayos a formato internacional", () => {
  assert.equal(numeroWhatsapp("099 123 456"), "59899123456");
  assert.equal(numeroWhatsapp("+598 99 123 456"), "59899123456");
  assert.match(enlaceWhatsapp("099123456", "Hola"), /^https:\/\/wa\.me\/59899123456\?text=Hola$/);
});

test("el chat oculta datos de contacto antes de la reserva", () => {
  const t = ocultarContacto("escribime al 099 123 456 o a ana@mail.com");
  assert.ok(!t.includes("099 123 456") && !t.includes("ana@mail.com"));
});

test("enlaces amigables", () => {
  assert.equal(slug("Masaje Descontracturante — 60’"), "masaje-descontracturante-60");
});
