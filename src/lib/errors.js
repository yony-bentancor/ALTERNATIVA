'use strict';

class AppError extends Error {
  constructor(message, status = 400, code = 'error', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

const badRequest = (msg, details) => new AppError(msg, 400, 'bad_request', details);
const unauthorized = (msg = 'Tenés que iniciar sesión.') => new AppError(msg, 401, 'unauthorized');
const forbidden = (msg = 'No tenés permiso para hacer esto.') => new AppError(msg, 403, 'forbidden');
const notFound = (msg = 'No encontramos lo que buscabas.') => new AppError(msg, 404, 'not_found');
const conflict = (msg, code = 'conflict') => new AppError(msg, 409, code);

// Envuelve handlers async para que los errores lleguen al middleware de errores.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, asyncHandler };
