/*
 * Conexión a MongoDB (todavía no activa).
 *
 * El sistema funciona hoy con un archivo JSON (ver config/store.js), igual que Relámpago.
 * Cuando quieras activar MongoDB:
 *   1. npm install mongoose
 *   2. Cargá MONGODB_URI y USAR_MONGO=true en el archivo .env (o en las Config Vars de Heroku).
 *   3. Reemplazá los métodos de models/Modelo.js por consultas de Mongoose
 *      (cada modelo tiene sus campos documentados al principio del archivo).
 * Los controladores no cambian: solo hablan con los modelos.
 */
const config = require("./index");

async function conectar() {
  if (!config.usarMongo || !config.mongoUri) {
    console.log("Base de datos: archivo JSON local (MongoDB desactivado).");
    return null;
  }
  const mongoose = require("mongoose");
  await mongoose.connect(config.mongoUri);
  console.log("MongoDB conectado");
  return mongoose;
}

module.exports = conectar;
