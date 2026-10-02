/*
 * Certificación o formación del especialista.
 * "declarada" = la informó el especialista; "verificada" = Alternativa revisó el documento.
 * Nunca se dice "verificado" sin verificación real.
 * Campos: id, especialistaId, titulo, institucion, anio, categoriaId, documentoId (privado),
 *         estado (declarada | pendiente | verificada | rechazada), revision {fecha, nota}
 */
const Modelo = require("./Modelo");

class Certificacion extends Modelo {
  static coleccion = "certificaciones";
  static prefijo = "ce";
  static ESTADOS = { declarada: "Declarada", pendiente: "En revisión", verificada: "Verificada", rechazada: "Rechazada" };
}

module.exports = Certificacion;
