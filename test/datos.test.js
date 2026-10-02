/* Pruebas de los datos de prueba: que estén todos los usuarios demo y que no haya reservas superpuestas. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { generar } = require("../scripts/seed");

const d = generar();

test("existen los usuarios de prueba de cada rol", () => {
  const emails = d.usuarios.filter((u) => u.prueba).map((u) => u.email);
  for (const e of ["admin@alternativa.uy", "especialista@alternativa.uy", "reiki@alternativa.uy", "nuevo.especialista@alternativa.uy", "usuario@alternativa.uy", "nuevo.usuario@alternativa.uy"]) assert.ok(emails.includes(e), e);
});

test("ningún especialista tiene dos reservas activas superpuestas", () => {
  const activas = d.reservas.filter((r) => ["pendiente", "pagada", "confirmada", "realizada"].includes(r.estado));
  const porEsp = new Map();
  for (const r of activas) (porEsp.get(r.especialistaId) || porEsp.set(r.especialistaId, []).get(r.especialistaId)).push(r);
  for (const [id, l] of porEsp) {
    l.sort((a, b) => a.inicio.localeCompare(b.inicio));
    for (let i = 1; i < l.length; i++) assert.ok(new Date(l[i].inicio) >= new Date(l[i - 1].fin), `superposición en ${id}: ${l[i - 1].codigo} y ${l[i].codigo}`);
  }
});

test("cada reseña corresponde a una reserva realizada y no tiene fecha futura", () => {
  const rs = new Map(d.reservas.map((r) => [r.id, r]));
  for (const rv of d.resenas) {
    assert.ok(rs.get(rv.reservaId), rv.id);
    assert.ok(new Date(rv.creado) <= new Date(), rv.id);
  }
});

test("hay casos para cada pantalla de administración", () => {
  assert.ok(d.verificaciones.some((v) => v.estado === "pendiente"));
  assert.ok(d.certificaciones.some((c) => c.estado === "pendiente"));
  assert.ok(d.reembolsos.some((r) => r.estado === "fallido"));
  assert.ok(d.denuncias.some((x) => x.estado === "abierta"));
  assert.ok(d.reservas.some((r) => r.incidencia?.abierta));
  assert.ok(d.especialistas.some((e) => e.estado === "en_revision"));
  assert.ok(d.especialistas.some((e) => (e.cambiosPendientes || []).length));
  assert.ok(d.categorias.some((c) => c.estado === "pendiente"));
});
