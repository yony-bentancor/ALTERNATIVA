/* Errores con código HTTP que el manejador de errores convierte en mensaje para la persona. */
function error(estado, mensaje, codigo) {
  const e = new Error(mensaje);
  e.estado = estado;
  e.codigo = codigo;
  e.visible = true;
  return e;
}

module.exports = {
  error,
  invalido: (m = "Revisá los datos ingresados.", c) => error(400, m, c),
  prohibido: (m = "No tenés permiso para hacer esto.") => error(403, m),
  noEncontrado: (m = "No encontramos lo que buscabas.") => error(404, m),
  conflicto: (m, c) => error(409, m, c),
};
