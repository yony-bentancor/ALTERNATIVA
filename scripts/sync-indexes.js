'use strict';
// Sincroniza los índices de MongoDB (fase "release" de Heroku en cada deploy).
// Necesario porque en producción autoIndex está desactivado.
const db = require('../src/config/db');
const logger = require('../src/lib/logger');

(async () => {
  try {
    await db.connect();
    const models = require('../src/models');
    for (const [name, Model] of Object.entries(models)) {
      await Model.syncIndexes();
      logger.info(`Índices sincronizados: ${name}`);
    }
  } catch (err) {
    logger.error('No se pudieron sincronizar índices', { err });
    process.exitCode = 1;
  } finally {
    await db.disconnect().catch(() => {});
  }
})();
