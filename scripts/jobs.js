'use strict';
// Heroku Scheduler: "npm run jobs" cada 10 minutos.
const db = require('../src/config/db');
const logger = require('../src/lib/logger');

(async () => {
  try {
    await db.connect();
    const { runAll } = require('../src/services/automation');
    await runAll();
  } catch (err) {
    logger.error('Jobs fallaron', { err });
    process.exitCode = 1;
  } finally {
    await db.disconnect().catch(() => {});
  }
})();
