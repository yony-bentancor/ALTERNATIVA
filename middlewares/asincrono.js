/* Envuelve controladores async para que los errores lleguen al manejador de errores de Express. */
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
