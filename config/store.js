/*
 * Almacenamiento de datos.
 *
 * Mientras MongoDB no esté activo, todo se guarda en un archivo JSON (data/db.json).
 * Si el archivo no existe, se generan los datos de prueba automáticamente (scripts/seed.js).
 * Los modelos (carpeta models/) son la única parte del sistema que habla con este archivo,
 * así que pasar a MongoDB más adelante significa cambiar los modelos, no los controladores.
 *
 * En Heroku el disco se reinicia con cada deploy y una vez por día: los datos de prueba
 * se vuelven a generar solos. Para datos reales y permanentes hay que activar MongoDB.
 */
const fs = require("fs");
const path = require("path");
const config = require("./index");

let datos = null;
let temporizador = null;

function cargar() {
  if (datos) return datos;
  if (!fs.existsSync(config.archivoDatos)) {
    const { generar } = require("../scripts/seed");
    datos = generar();
    escribirAhora();
    console.log("Datos de prueba generados en", path.relative(config.raiz, config.archivoDatos));
  } else {
    datos = JSON.parse(fs.readFileSync(config.archivoDatos, "utf8"));
  }
  datos.meta = datos.meta || { secuencia: 1000 };
  return datos;
}

function escribirAhora() {
  if (!datos) return;
  fs.mkdirSync(path.dirname(config.archivoDatos), { recursive: true });
  const tmp = config.archivoDatos + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(datos));
  fs.renameSync(tmp, config.archivoDatos);
}

/** Guarda los cambios en disco (agrupa varias escrituras seguidas). */
function guardar() {
  clearTimeout(temporizador);
  temporizador = setTimeout(escribirAhora, 150);
}

function coleccion(nombre) {
  cargar();
  if (!datos[nombre]) datos[nombre] = [];
  return datos[nombre];
}

function nuevoId(prefijo) {
  cargar();
  datos.meta.secuencia = (datos.meta.secuencia || 1000) + 1;
  return prefijo + datos.meta.secuencia;
}

/** Número correlativo legible (tickets, liquidaciones…). */
function siguienteNumero(nombre) {
  cargar();
  datos.meta.contadores = datos.meta.contadores || {};
  datos.meta.contadores[nombre] = (datos.meta.contadores[nombre] || 0) + 1;
  guardar();
  return datos.meta.contadores[nombre];
}

function reemplazarTodo(nuevos) {
  datos = nuevos;
  datos.meta = datos.meta || { secuencia: 1000 };
  escribirAhora();
}

function vaciarCache() {
  datos = null;
}

process.on("exit", () => { if (datos && temporizador) escribirAhora(); });

module.exports = { cargar, guardar, escribirAhora, coleccion, nuevoId, siguienteNumero, reemplazarTodo, vaciarCache };
