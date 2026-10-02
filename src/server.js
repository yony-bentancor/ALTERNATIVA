"use strict";
const config = require("./config");
const logger = require("./lib/logger");
const db = require("./config/db");

async function main() {
  const problems = config.assertProductionConfig();
  if (problems.length) {
    const msg = `Configuración incompleta: ${problems.join("; ")}`;
    if (config.isProd) {
      logger.error(msg);
      process.exit(1);
    }
    logger.warn(msg);
  }
  /*  await db.connect(); */
  const { createApp } = require("./app");
  const app = createApp();
  const server = app.listen(config.port, () =>
    logger.info(
      `Alternativa escuchando en ${config.appUrl} (puerto ${config.port}, ${config.appEnv})`,
    ),
  );

  if (config.jobs.inProcess) require("./services/automation").startInProcess();

  // Apagado prolijo (Heroku envía SIGTERM en cada deploy/reinicio)
  const shutdown = (signal) => {
    logger.info(`Recibido ${signal}, cerrando…`);
    server.close(async () => {
      await db.disconnect().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (err) =>
    logger.error("unhandledRejection", { err }),
  );
}

main().catch((err) => {
  logger.error("No se pudo iniciar", { err });
  process.exit(1);
});
