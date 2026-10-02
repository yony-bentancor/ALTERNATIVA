/*
 * Ejecuta una vez todas las tareas automáticas y termina:
 * vencer reservas impagas, conciliar pagos, recordatorios, cerrar sesiones realizadas,
 * pedir reseñas, sugerir volver a reservar y activar/terminar destacados y promociones.
 *
 *   npm run tareas
 *
 * El servidor ya las corre solo cada JOBS_EVERY_MINUTES minutos (por defecto 5).
 * Este script sirve para probarlas a mano o para Heroku Scheduler.
 */
const store = require("../config/store");
const { ejecutarTodas } = require("../services/automatizacion");

(async () => {
  store.cargar();
  const res = await ejecutarTodas();
  store.escribirAhora();
  for (const [k, v] of Object.entries(res)) console.log(`${k.padEnd(24)} ${typeof v === "object" ? JSON.stringify(v) : v}`);
})().catch((e) => { console.error(e); process.exit(1); });
