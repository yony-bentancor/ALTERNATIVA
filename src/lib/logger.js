'use strict';
// Logger estructurado mínimo: una línea JSON por evento (Heroku/Papertrail lo indexan bien).
const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const min = levels[process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')] || 20;

function serializeError(err) {
  if (!(err instanceof Error)) return err;
  return { name: err.name, message: err.message, code: err.code, stack: err.stack };
}

function log(level, msg, meta = {}) {
  if (levels[level] < min || process.env.NODE_ENV === 'test') return;
  const entry = { t: new Date().toISOString(), level, msg };
  for (const [k, v] of Object.entries(meta || {})) entry[k] = serializeError(v);
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  debug: (m, meta) => log('debug', m, meta),
  info: (m, meta) => log('info', m, meta),
  warn: (m, meta) => log('warn', m, meta),
  error: (m, meta) => log('error', m, meta),
};
