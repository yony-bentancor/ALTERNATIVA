"use strict";

const path = require("path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const compression = require("compression");
const mongoose = require("mongoose");

const config = require("./config");
const logger = require("./lib/logger");
const { loadUser, csrf, flash } = require("./middleware/auth");
const { getSettings } = require("./services/settings");
const { unreadCount } = require("./services/notifications");
const { unreadMessages } = require("./services/messaging");
const views = require("./views/errors");

function createApp() {
  const app = express();

  app.set("trust proxy", 1); // Heroku termina TLS en su router
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
          "media-src": ["'self'", "blob:", "https://res.cloudinary.com"],
          "font-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "frame-src": ["'self'", "https://www.openstreetmap.org"],
          "frame-ancestors": ["'none'"],

          // Las redirecciones al checkout de Mercado Pago
          // ocurren después de enviar formularios
          "form-action": [
            "'self'",
            "https://*.mercadopago.com",
            "https://*.mercadopago.com.uy",
            "https://*.mercadolibre.com",
          ],

          "upgrade-insecure-requests": config.isProd ? [] : null,
        },
      },

      crossOriginEmbedderPolicy: false,

      hsts: config.isProd
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
          }
        : false,
    }),
  );

  app.use(compression());

  // Redirección a HTTPS en producción
  // Heroku informa el protocolo original
  if (config.isProd) {
    app.use((req, res, next) =>
      req.secure || req.path === "/healthz"
        ? next()
        : res.redirect(301, `https://${req.get("host")}${req.originalUrl}`),
    );
  }

  // Health check.
  // db será false mientras MongoDB esté deshabilitado.
  app.get("/healthz", (req, res) => {
    res.json({
      ok: true,
      db: mongoose.connection.readyState === 1,
    });
  });

  // Webhooks: sin sesión ni CSRF;
  // autenticados por firma.
  app.use(
    "/webhooks",
    express.json({ limit: "200kb" }),
    require("./routes/webhooks"),
  );

  // Archivos estáticos
  app.use(
    express.static(path.join(__dirname, "..", "public"), {
      maxAge: config.isProd ? "7d" : 0,

      setHeaders: (res, filePath) => {
        if (filePath.endsWith("sw.js")) {
          res.setHeader("Cache-Control", "no-cache");
        }

        if (filePath.includes(`${path.sep}uploads${path.sep}`)) {
          res.setHeader("X-Content-Type-Options", "nosniff");
        }
      },
    }),
  );

  app.use(
    express.urlencoded({
      extended: true,
      limit: "1mb",
      parameterLimit: 2000,
    }),
  );

  app.use(
    express.json({
      limit: "200kb",
    }),
  );

  /*
   * =====================================================
   * SESIONES
   * =====================================================
   *
   * TEMPORAL:
   * No usamos MongoStore mientras Heroku está funcionando
   * sin MongoDB.
   *
   * Express utilizará MemoryStore.
   *
   * Esto NO debe quedar así en producción definitiva.
   * Cuando configuremos MongoDB restauraremos connect-mongo.
   * =====================================================
   */

  app.use(
    session({
      name: "alt.sid",

      secret:
        config.sessionSecret || "dev-only-secret-change-me-dev-only-secret",

      resave: false,
      saveUninitialized: false,
      rolling: true,

      // TEMPORAL: almacenamiento en memoria.
      store: undefined,

      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.isProd,
        maxAge: 30 * 24 * 3600 * 1000,
      },
    }),
  );

  app.use(flash);
  app.use(csrf);
  app.use(loadUser);

  /*
   * =====================================================
   * CONTEXTO COMÚN PARA TODAS LAS VISTAS
   * =====================================================
   */

  app.use(async (req, res, next) => {
    try {
      const settings = await getSettings();

      const ctx = {
        user: req.user,
        csrf: res.locals.csrf,
        flash: res.locals.flash,

        path: req.path,
        url: req.originalUrl,
        query: req.query,

        settings,

        appUrl: config.appUrl,
        appEnv: config.appEnv,

        vapidPublicKey: config.push.publicKey,

        unreadNotifications: 0,

        unreadMessages: {
          user: 0,
          specialist: 0,
        },

        specialist: null,
      };

      if (req.user) {
        const [n, m] = await Promise.all([
          unreadCount(req.user._id),
          unreadMessages(req.user),
        ]);

        ctx.unreadNotifications = n;
        ctx.unreadMessages = m;
      }

      res.locals.ctx = ctx;

      res.page = (view, data = {}, status = 200) =>
        res
          .status(status)
          .type("html")
          .send(String(view(res.locals.ctx, data)));

      // Modo mantenimiento:
      // solo administración y acceso
      if (
        settings.site.maintenanceMode &&
        req.user?.role !== "admin" &&
        !["/login", "/salir"].includes(req.path) &&
        !req.path.startsWith("/admin")
      ) {
        return res.page(views.maintenance, {}, 503);
      }

      return next();
    } catch (err) {
      return next(err);
    }
  });

  /*
   * =====================================================
   * RUTAS
   * =====================================================
   */

  app.use(require("./routes/auth"));

  app.use("/api", require("./routes/api"));

  app.use(require("./routes/booking"));

  app.use("/mi", require("./routes/account"));

  app.use("/panel", require("./routes/specialist"));

  app.use("/admin", require("./routes/admin"));

  app.use(require("./routes/public"));

  /*
   * =====================================================
   * 404
   * =====================================================
   */

  app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({
        error: "No encontrado",
      });
    }

    return res.page(views.notFound, {}, 404);
  });

  /*
   * =====================================================
   * MANEJO DE ERRORES
   * =====================================================
   */

  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;

    if (status >= 500) {
      logger.error("Error no controlado", {
        path: req.path,
        method: req.method,
        err,
      });
    }

    const message =
      err.expose || status < 500
        ? err.message
        : "Ocurrió un error inesperado. Ya lo registramos; probá de nuevo en unos minutos.";

    // Respuesta JSON
    if (
      req.path.startsWith("/api/") ||
      (req.get("accept") || "").includes("application/json")
    ) {
      return res.status(status).json({
        error: message,
        code: err.code,
      });
    }

    // Errores de formulario:
    // volver a la página anterior
    if (
      status < 500 &&
      req.method === "POST" &&
      req.session &&
      err.code !== "csrf"
    ) {
      req.flash("error", message);

      let back = "/";

      try {
        const ref = new URL(req.get("referer") || "");

        if (ref.host === req.get("host")) {
          back = ref.pathname + ref.search;
        }
      } catch {
        // sin referer válido
      }

      return res.redirect(back);
    }

    // Si todavía no existe contexto
    if (!res.locals.ctx) {
      return res.status(status).send(
        `<!doctype html>
<meta charset="utf-8">
<title>Error</title>
<p>${status === 404 ? "No encontrado" : "Error"}</p>`,
      );
    }

    return res.page(
      views.error,
      {
        status,
        message,
      },
      status,
    );
  });

  return app;
}

module.exports = {
  createApp,
};
