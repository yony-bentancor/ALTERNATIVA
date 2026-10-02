/* Estadísticas: visitas (sin contar al propio especialista), tablero del especialista y de administración. */
const F = require("./fechas");

/** Suma una visita (una vez por sesión) al perfil o servicio. */
async function registrar({ especialistaId, servicioId = null, campo, req }) {
  const { Estadistica } = require("../models");
  if (!especialistaId) return;
  if (req?.session) {
    const k = `${campo}:${especialistaId}:${servicioId || ""}`;
    const vistos = req.session.vistos || (req.session.vistos = []);
    if (vistos.includes(k)) return;
    vistos.push(k);
    if (vistos.length > 200) vistos.splice(0, vistos.length - 200);
  }
  if (req?.usuario && (req.usuario.rol === "admin" || req.usuario.especialistaId === especialistaId)) return;
  await Estadistica.sumar({ especialistaId, servicioId, fecha: F.hoy(), campo });
}

function rango(periodo = "30d", ahora = new Date()) {
  const dias = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 }[periodo] || 30;
  const hasta = F.hoy(F.ZONA, ahora);
  const desde = F.sumarDias(hasta, -(dias - 1));
  return { periodo, dias, desde, hasta, inicio: F.aUtc(desde), fin: F.aUtc(F.sumarDias(hasta, 1)) };
}

const EFECTIVAS = ["pagada", "confirmada", "realizada"];
const neto = (r) => r.foto?.recibeEspecialista ?? r.foto?.netoEspecialista ?? 0;

async function tableroEspecialista(especialistaId, periodo = "30d") {
  const { Estadistica, Reserva, Resena, Servicio } = require("../models");
  const rg = rango(periodo);
  const est = await Estadistica.todos((x) => x.especialistaId === especialistaId && x.fecha >= rg.desde && x.fecha <= rg.hasta);
  const reservas = await Reserva.todos((r) => r.especialistaId === especialistaId && new Date(r.inicio) >= rg.inicio && new Date(r.inicio) < rg.fin);
  const resenas = await Resena.visiblesDeEspecialista(especialistaId);
  const servicios = await Servicio.deEspecialista(especialistaId);
  const s = (campo) => est.reduce((a, x) => a + (x[campo] || 0), 0);

  const efectivas = reservas.filter((r) => EFECTIVAS.includes(r.estado));
  const canceladas = reservas.filter((r) => ["cancelada_usuario", "cancelada_especialista", "reembolsada"].includes(r.estado));
  const clientes = new Map();
  for (const r of efectivas) clientes.set(r.usuarioId, (clientes.get(r.usuarioId) || 0) + 1);
  const nuevos = new Set(efectivas.filter((r) => r.primeraVez).map((r) => r.usuarioId)).size;
  const recurrentes = new Set(efectivas.filter((r) => !r.primeraVez).map((r) => r.usuarioId)).size;

  const porServicio = servicios.map((sv) => {
    const rs = efectivas.filter((r) => r.servicioId === sv.id);
    const vistas = est.filter((x) => x.servicioId === sv.id).reduce((a, x) => a + (x.visitasServicio || 0), 0);
    const consultas = est.filter((x) => x.servicioId === sv.id).reduce((a, x) => a + (x.consultasAgenda || 0), 0);
    return { id: sv.id, titulo: sv.titulo, estado: sv.estado, vistas, consultas, reservas: rs.length, ingresos: rs.reduce((a, r) => a + neto(r), 0), conversion: vistas ? Math.round((rs.length / vistas) * 1000) / 10 : 0, rating: sv.rating };
  }).sort((a, b) => b.reservas - a.reservas || b.vistas - a.vistas);

  const horas = Array(24).fill(0); const dias = Array(7).fill(0);
  for (const r of efectivas) { const p = F.partes(r.inicio); horas[p.hora]++; dias[p.diaSemana]++; }

  const meses = new Map();
  for (const rv of [...resenas].reverse()) {
    const p = F.partes(rv.creado); const k = `${p.anio}-${F.dos(p.mes)}`;
    const c = meses.get(k) || { cant: 0, suma: 0 }; c.cant++; c.suma += rv.puntaje; meses.set(k, c);
  }
  const serie = [];
  for (let i = 0; i < rg.dias; i++) {
    const d = F.sumarDias(rg.desde, i);
    serie.push({
      fecha: d,
      vistas: est.filter((x) => x.fecha === d).reduce((a, x) => a + (x.visitasPerfil || 0) + (x.visitasServicio || 0), 0),
      reservas: efectivas.filter((r) => F.partes(r.inicio).fecha === d).length,
      ingresos: efectivas.filter((r) => F.partes(r.inicio).fecha === d).reduce((a, r) => a + neto(r), 0),
    });
  }
  const vistas = s("visitasPerfil") + s("visitasServicio");
  return {
    rango: rg, vistas, visitasPerfil: s("visitasPerfil"), visitasServicio: s("visitasServicio"), consultasAgenda: s("consultasAgenda"),
    impresiones: s("impresiones"), impresionesPatrocinadas: s("impresionesPatrocinadas"), favoritos: s("favoritos"), mensajes: s("mensajes"),
    reservas: efectivas.length, cancelaciones: canceladas.length, ausencias: reservas.filter((r) => r.estado === "ausencia_usuario").length,
    ingresos: efectivas.reduce((a, r) => a + neto(r), 0), clientes: clientes.size, nuevos, recurrentes,
    tasaRepeticion: clientes.size ? Math.round((recurrentes / clientes.size) * 1000) / 10 : 0,
    conversion: vistas ? Math.round((efectivas.length / vistas) * 1000) / 10 : 0,
    porServicio, mejorServicio: porServicio[0]?.reservas ? porServicio[0] : null, horas, dias,
    horaPico: horas.some(Boolean) ? horas.indexOf(Math.max(...horas)) : null,
    tendenciaResenas: [...meses.entries()].slice(-12).map(([mes, v]) => ({ mes, cant: v.cant, prom: Math.round((v.suma / v.cant) * 10) / 10 })),
    serie,
  };
}

async function tableroAdmin(periodo = "30d") {
  const { Usuario, Especialista, Reserva, Pago, Reembolso, Resena, Denuncia, Consulta, Verificacion } = require("../models");
  const { catalogo } = require("./especialistas");
  const rg = rango(periodo);
  const enRango = (x) => new Date(x.creado) >= rg.inicio;
  const reservas = await Reserva.todos(enRango);
  const porEstado = {};
  for (const r of reservas) porEstado[r.estado] = (porEstado[r.estado] || 0) + 1;
  const pagos = await Pago.todos((p) => enRango(p) && ["aprobado", "reembolso_parcial", "reembolsado", "a_cobrar"].includes(p.estado));
  const reembolsos = await Reembolso.todos((r) => enRango(r) && r.estado === "procesado");
  const resenas = await Resena.todos(enRango);
  const activos = new Set(reservas.filter((r) => EFECTIVAS.includes(r.estado)).map((r) => r.usuarioId));
  const serie = [];
  for (let i = 0; i < rg.dias; i++) {
    const d = F.sumarDias(rg.desde, i);
    const delDia = reservas.filter((r) => F.partes(r.creado).fecha === d);
    serie.push({ fecha: d, reservas: delDia.length, bruto: pagos.filter((p) => F.partes(p.creado).fecha === d).reduce((a, p) => a + p.monto, 0) });
  }
  const comisionRevertida = reembolsos.reduce((a, r) => a + r.comisionRevertida, 0);
  // Ranking de categorías por reservas
  const porCategoria = {};
  for (const r of reservas.filter((x) => EFECTIVAS.includes(x.estado))) porCategoria[r.foto.categoria] = (porCategoria[r.foto.categoria] || 0) + 1;
  return {
    rango: rg,
    usuarios: await Usuario.contar((u) => u.rol === "usuario" && u.estado !== "eliminado"),
    usuariosNuevos: await Usuario.contar(enRango),
    especialistas: await Especialista.contar((e) => !e.eliminado),
    especialistasActivos: await Especialista.contar((e) => e.estado === "activo"),
    especialistasNuevos: await Especialista.contar(enRango),
    servicios: (await catalogo()).length,
    reservas: reservas.length, porEstado,
    cancelaciones: (porEstado.cancelada_usuario || 0) + (porEstado.cancelada_especialista || 0),
    bruto: pagos.reduce((a, p) => a + p.monto, 0),
    comision: pagos.reduce((a, p) => a + p.comision, 0) - comisionRevertida,
    comisionPasarela: pagos.reduce((a, p) => a + (p.comisionPasarela || 0), 0),
    reembolsos: reembolsos.reduce((a, r) => a + r.monto, 0), cantidadPagos: pagos.length,
    resenas: resenas.length, promedioResenas: resenas.length ? Math.round((resenas.reduce((a, r) => a + r.puntaje, 0) / resenas.length) * 10) / 10 : null,
    usuariosActivos: activos.size,
    reservasPorUsuario: activos.size ? Math.round((reservas.length / activos.size) * 100) / 100 : 0,
    pendientes: {
      denuncias: await Denuncia.contar((d) => d.estado === "abierta"),
      consultas: await Consulta.contar((t) => ["abierta", "esperando_usuario"].includes(t.estado)),
      verificaciones: await Verificacion.contar((v) => v.estado === "pendiente"),
      especialistas: await Especialista.contar((e) => e.estado === "en_revision"),
      incidencias: await Reserva.contar((r) => r.incidencia?.abierta),
      cambios: await Especialista.contar((e) => (e.cambiosPendientes || []).length > 0),
    },
    porCategoria: Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).slice(0, 8),
    serie,
  };
}

module.exports = { registrar, rango, tableroEspecialista, tableroAdmin };
