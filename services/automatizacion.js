/*
 * Tareas automáticas. Corren solas cada pocos minutos dentro del mismo proceso (app.js);
 * también se pueden ejecutar a mano con "npm run tareas" (por ejemplo desde Heroku Scheduler).
 */
const F = require("./fechas");
const { notificar } = require("./notificaciones");

async function recordatorios(ahora = new Date()) {
  const { Reserva, Config } = require("../models");
  const cfg = await Config.obtener();
  let enviados = 0;
  const ventanas = [{ horas: cfg.avisos.recordatorioHoras, campo: "diaAntes" }, { horas: cfg.avisos.segundoRecordatorioHoras, campo: "horaAntes" }].filter((v) => v.horas > 0);
  for (const v of ventanas) {
    const limite = ahora.getTime() + v.horas * 3600000;
    for (const r of await Reserva.todos((x) => ["pagada", "confirmada"].includes(x.estado) && new Date(x.inicio) > ahora && new Date(x.inicio).getTime() <= limite && !x.recordatorios?.[v.campo])) {
      r.recordatorios = { ...(r.recordatorios || {}), [v.campo]: ahora.toISOString() };
      // Si se reservó dentro de la ventana, no hace falta el primer recordatorio.
      if (v.campo === "diaAntes" && new Date(r.creado).getTime() > new Date(r.inicio).getTime() - v.horas * 3600000) { await Reserva.guardar(r); continue; }
      const lugar = r.modalidad === "online" ? "Online" : r.modalidad === "domicilio" ? "A domicilio" : r.lugar?.direccion || "En consultorio";
      await notificar(r.usuarioId, { tipo: "recordatorio", titulo: "Tu próxima sesión", texto: `${r.foto.servicio} con ${r.foto.especialista} · ${F.fFechaHora(r.inicio)} · ${lugar}`, enlace: `/mi/reservas/${r.id}`, clave: `${v.campo}:${r.id}` });
      await Reserva.guardar(r);
      enviados++;
    }
  }
  return enviados;
}

async function cerrarRealizadas(ahora = new Date()) {
  const { Reserva, Config } = require("../models");
  const { marcarRealizada } = require("./reservas");
  const cfg = await Config.obtener();
  const limite = ahora.getTime() - cfg.automatizacion.cerrarDespuesHoras * 3600000;
  const l = await Reserva.todos((r) => ["pagada", "confirmada"].includes(r.estado) && new Date(r.fin).getTime() <= limite && !r.incidencia?.abierta);
  for (const r of l) await marcarRealizada(r, { rol: "sistema", ahora }).catch(() => {});
  return l.length;
}

async function pedirResenas(ahora = new Date()) {
  const { Reserva, Config } = require("../models");
  const cfg = await Config.obtener();
  const limite = ahora.getTime() - cfg.resenas.pedirDespuesHoras * 3600000;
  const l = await Reserva.todos((r) => r.estado === "realizada" && !r.resenada && !r.pedidoResena && new Date(r.fin).getTime() <= limite);
  for (const r of l) {
    await notificar(r.usuarioId, { tipo: "pedir_resena", titulo: "¿Cómo te fue en tu sesión?", texto: `Contanos qué te pareció ${r.foto.servicio} con ${r.foto.especialista}. Tu reseña verificada ayuda a otras personas.`, enlace: `/mi/reservas/${r.id}/valorar`, boton: "Valorar sesión", clave: `resena:${r.id}` });
    r.pedidoResena = ahora.toISOString();
    await Reserva.guardar(r);
  }
  return l.length;
}

async function volverAReservar(ahora = new Date()) {
  const { Reserva, Config } = require("../models");
  const dias = (await Config.obtener()).avisos.volverAReservarDias;
  if (!dias) return 0;
  const limite = ahora.getTime() - dias * 86400000;
  let n = 0;
  for (const r of await Reserva.todos((x) => x.estado === "realizada" && !x.avisoVolver && new Date(x.fin).getTime() <= limite && new Date(x.fin).getTime() >= limite - 14 * 86400000)) {
    const posterior = await Reserva.uno((x) => x.usuarioId === r.usuarioId && x.especialistaId === r.especialistaId && new Date(x.inicio) > new Date(r.inicio) && ["pendiente", "pagada", "confirmada", "realizada"].includes(x.estado));
    if (!posterior) { await notificar(r.usuarioId, { tipo: "volver_a_reservar", titulo: `¿Repetimos ${r.foto.servicio}?`, texto: `Pasaron ${dias} días desde tu sesión con ${r.foto.especialista}. Mirá sus próximos horarios.`, enlace: `/mi/reservas/${r.id}/volver`, boton: "Ver horarios", clave: `volver:${r.id}`, canales: { whatsapp: false } }); n++; }
    r.avisoVolver = ahora.toISOString();
    await Reserva.guardar(r);
  }
  return n;
}

async function rotarDestacadosYPromos(ahora = new Date()) {
  const { Destacado, Promocion, Especialista } = require("../models");
  let n = 0;
  for (const d of await Destacado.todos()) {
    if (d.estado === "programado" && new Date(d.desde) <= ahora && new Date(d.hasta) >= ahora) { d.estado = "activo"; n++; }
    if (["activo", "programado"].includes(d.estado) && new Date(d.hasta) < ahora) { d.estado = "terminado"; n++; }
  }
  await Destacado.guardar(null);
  for (const p of await Promocion.todos((x) => x.estado === "activa" && x.hasta && new Date(x.hasta) < ahora)) { p.estado = "terminada"; n++; }
  for (const e of await Especialista.todos((x) => x.plan === "profesional" && x.planVence && new Date(x.planVence) < ahora)) { e.plan = "gratis"; n++; }
  await Promocion.guardar(null);
  return n;
}

async function ejecutarTodas({ ahora = new Date() } = {}) {
  const { vencerPendientes } = require("./reservas");
  const { conciliar } = require("./pagos");
  const pasos = {
    vencerPendientes: () => vencerPendientes(ahora), conciliarPagos: () => conciliar({ ahora }), recordatorios: () => recordatorios(ahora),
    cerrarRealizadas: () => cerrarRealizadas(ahora), pedirResenas: () => pedirResenas(ahora), volverAReservar: () => volverAReservar(ahora),
    destacadosYPromociones: () => rotarDestacadosYPromos(ahora),
  };
  const res = {};
  for (const [k, fn] of Object.entries(pasos)) {
    try { res[k] = await fn(); } catch (e) { res[k] = `error: ${e.message}`; }
  }
  return res;
}

let timer = null;
function iniciar(minutos = 5) {
  if (timer) return;
  const tic = () => ejecutarTodas().catch((e) => console.error("Tareas automáticas:", e.message));
  timer = setInterval(tic, minutos * 60000);
  timer.unref();
  setTimeout(tic, 10000).unref();
}

module.exports = { recordatorios, cerrarRealizadas, pedirResenas, volverAReservar, rotarDestacadosYPromos, ejecutarTodas, iniciar };
