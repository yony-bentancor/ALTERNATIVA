'use strict';
// Uploads en memoria con límites duros (luego se validan por contenido en services/media.js).
const multer = require('multer');
const { badRequest } = require('../lib/errors');

const MAX_BYTES = 100 * 1024 * 1024; // tope absoluto; los límites por tipo se aplican después

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 6, fields: 40 },
});

// Envuelve multer para devolver errores legibles.
function single(field) {
  const mw = upload.single(field);
  return (req, res, next) => mw(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest('El archivo supera el tamaño máximo permitido.'));
    return next(badRequest('No pudimos procesar el archivo.'));
  });
}

function array(field, max = 6) {
  const mw = upload.array(field, max);
  return (req, res, next) => mw(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest('Algún archivo supera el tamaño máximo permitido.'));
    if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') return next(badRequest(`Podés subir hasta ${max} archivos por vez.`));
    return next(badRequest('No pudimos procesar los archivos.'));
  });
}

module.exports = { single, array };
