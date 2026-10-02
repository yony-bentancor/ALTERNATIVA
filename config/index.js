/*
 * Configuración general (variables de entorno).
 * Copiá .env.example como .env para trabajar en tu computadora.
 * En Heroku los valores se cargan en Settings → Config Vars.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const raiz = path.join(__dirname, "..");
const env = (k, d = "") => (process.env[k] === undefined || process.env[k] === "" ? d : process.env[k]);
const si = (k, d = false) => {
  const v = process.env[k];
  if (v === undefined || v === "") return d;
  return ["1", "true", "si", "sí", "yes"].includes(String(v).toLowerCase());
};

const produccion = env("NODE_ENV") === "production";
const entorno = env("APP_ENV", produccion ? "staging" : "desarrollo");

module.exports = {
  raiz,
  puerto: Number(env("PORT", "3000")),
  produccion,
  // "production" = sitio real con dinero real. "staging" o "desarrollo" = pruebas.
  entorno,
  enVivo: entorno === "production",
  urlSitio: env("URL_SITIO", env("APP_URL", "http://localhost:3000")).replace(/\/$/, ""),
  zonaHoraria: env("TZ_NAME", "America/Montevideo"),
  secretoSesion: env("SESSION_SECRET", "cambiar-este-secreto-en-produccion-por-uno-largo"),

  // Mientras MongoDB no esté activo, los datos se guardan en un archivo JSON (igual que Relámpago).
  archivoDatos: env("DATA_FILE", path.join(raiz, "data", "db.json")),
  carpetaPublica: path.join(raiz, "uploads", "publico"),
  carpetaPrivada: path.join(raiz, "uploads", "privado"),
  tamanioMaximoImagen: 8 * 1024 * 1024,
  tamanioMaximoVideo: 60 * 1024 * 1024,
  tamanioMaximoDocumento: 10 * 1024 * 1024,

  // Usuarios de prueba visibles en la pantalla de ingreso.
  modoDemo: env("MODO_DEMO", "true") !== "false",
  claveDemo: env("CLAVE_DEMO", "alternativa2026"),

  pagos: {
    // simulado: checkout de prueba sin dinero real | mercadopago
    proveedor: ({ simulated: "simulado" })[env("PAYMENT_PROVIDER", "simulado")] || env("PAYMENT_PROVIDER", "simulado"),
    mp: {
      accessToken: env("MP_ACCESS_TOKEN"),
      publicKey: env("MP_PUBLIC_KEY"),
      webhookSecret: env("MP_WEBHOOK_SECRET"),
      clientId: env("MP_CLIENT_ID"),
      clientSecret: env("MP_CLIENT_SECRET"),
      apiBase: env("MP_API_BASE", "https://api.mercadopago.com"),
      authBase: env("MP_AUTH_BASE", "https://auth.mercadopago.com.uy"),
    },
  },
  email: {
    // consola: se imprime en los logs | resend
    proveedor: env("EMAIL_PROVIDER", "consola"),
    remitente: env("EMAIL_FROM", "Alternativa <hola@alternativa.uy>"),
    resendApiKey: env("RESEND_API_KEY"),
  },
  whatsapp: {
    // Meta Cloud API (opcional) para avisos automáticos por WhatsApp
    token: env("WHATSAPP_TOKEN"),
    numeroId: env("WHATSAPP_PHONE_NUMBER_ID"),
    idioma: env("WHATSAPP_TEMPLATE_LANG", "es"),
  },
  // Notificaciones push del navegador (generar claves con: npm run vapid)
  push: {
    publicKey: env("VAPID_PUBLIC_KEY"),
    privateKey: env("VAPID_PRIVATE_KEY"),
    subject: env("VAPID_SUBJECT", "mailto:hola@alternativa.uy"),
  },
  // Opcional: con clave usa la API oficial de Google Maps Embed; sin clave, el mapa público de Google.
  googleMapsKey: env("GOOGLE_MAPS_API_KEY"),
  // Tareas automáticas (vencer reservas impagas, recordatorios, cierre de sesiones realizadas).
  tareasCadaMinutos: Number(env("JOBS_EVERY_MINUTES", "5")),
  // MongoDB (todavía no activo). Ver config/db.js.
  usarMongo: si("USAR_MONGO", false),
  mongoUri: env("MONGODB_URI", env("MONGO_URI")),
};
