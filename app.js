const path = require("path");
const express = require("express");
const session = require("express-session");

const config = require("./config");
const conectarDB = require("./config/db");
const store = require("./config/store");
const { cargarUsuario } = require("./middlewares/auth");
const { cabeceras, csrf } = require("./middlewares/seguridad");
const locales = require("./middlewares/locales");
const { noEncontrado, manejarError } = require("./middlewares/errores");

const app = express();

// Vistas
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1); // Heroku
app.disable("x-powered-by");

// Redirección a HTTPS en producción (Heroku informa el protocolo original)
if (config.produccion) {
  app.use((req, res, next) => (req.secure || req.path === "/healthz" ? next() : res.redirect(301, `https://${req.get("host")}${req.originalUrl}`)));
}
app.use(cabeceras);
app.get("/healthz", (req, res) => res.json({ ok: true }));

// Webhooks de pagos: sin sesión ni CSRF (se autentican por firma)
app.use("/webhooks", express.json({ limit: "200kb" }), require("./routes/webhooks"));

// Archivos estáticos
app.use(express.static(path.join(__dirname, "public"), { maxAge: config.produccion ? "7d" : 0 }));
app.use("/subidas", express.static(config.carpetaPublica, { maxAge: "7d" }));

// Formularios
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.json({ limit: "200kb" }));

// Sesiones (en memoria, como Relámpago; con MongoDB se usaría connect-mongo)
app.use(session({
  name: "alternativa.sid",
  secret: config.secretoSesion,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: "lax", secure: config.produccion, maxAge: 1000 * 60 * 60 * 24 * 30 },
}));

// Usuario, seguridad y variables comunes de las vistas
app.use(cargarUsuario);
app.use(csrf);
app.use(locales);

// Rutas
app.use("/", require("./routes/auth"));
app.use("/api", require("./routes/api"));
app.use("/archivos", require("./routes/archivos"));
app.use("/", require("./routes/reservas"));
app.use("/mi", require("./routes/cuenta"));
app.use("/panel", require("./routes/panel"));
app.use("/admin", require("./routes/admin"));
app.use("/", require("./routes/publico"));

// Errores
app.use(noEncontrado);
app.use(manejarError);

async function iniciar() {
  await conectarDB();
  store.cargar();
  require("./services/automatizacion").iniciar(config.tareasCadaMinutos);
  app.listen(config.puerto, () => console.log(`Alternativa en http://localhost:${config.puerto} (${config.entorno})`));
}

if (require.main === module) iniciar();

module.exports = app;
