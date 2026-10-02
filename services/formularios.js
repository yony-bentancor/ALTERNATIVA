/* Lectura y validación de formularios compartidos entre el panel del especialista y administración. */
const { texto, aMonto, DEPARTAMENTOS, MODALIDADES } = require("./util");

const num = (v, min, max, def = null) => { const n = Number(v); return Number.isFinite(n) && v !== "" && v !== undefined && v !== null ? Math.min(max, Math.max(min, n)) : def; };
const modalidadesDe = (v) => [].concat(v || []).filter((m) => Object.keys(MODALIDADES).includes(m));

/** Servicio: devuelve { errores, datos }. */
function leerServicio(d) {
  const modalidades = [].concat(d.modalidades || []).filter((m) => ["presencial", "domicilio", "online"].includes(m));
  const precio = aMonto(d.precio); const duracion = parseInt(d.duracion, 10);
  const errores = [];
  if (texto(d.titulo).length < 3) errores.push("Escribí el nombre del servicio.");
  if (!d.categoriaId) errores.push("Elegí una categoría.");
  if (!Number.isFinite(precio) || precio < 100 || precio > 200000) errores.push("El precio tiene que estar entre $100 y $200.000.");
  if (!Number.isFinite(duracion) || duracion < 10 || duracion > 600) errores.push("La duración tiene que estar entre 10 y 600 minutos.");
  if (!modalidades.length) errores.push("Elegí al menos una modalidad.");
  return {
    errores,
    datos: {
      titulo: texto(d.titulo, 120), categoriaId: d.categoriaId, resumen: texto(d.resumen, 240), descripcion: texto(d.descripcion, 5000),
      incluye: texto(d.incluye, 1000).split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 12), preparacion: texto(d.preparacion, 1500),
      precio, duracion, modalidades, recargoDomicilio: modalidades.includes("domicilio") ? aMonto(d.recargoDomicilio) || 0 : 0, anticipacionMax: num(d.anticipacionMax, 1, 365),
    },
  };
}

/** Ficha de especialista cargada por administración: devuelve { errores, datos }. */
function leerFicha(d) {
  const categorias = [].concat(d.categorias || []).filter(Boolean).slice(0, 10);
  const modalidades = modalidadesDe(d.modalidades);
  const errores = [];
  if (texto(d.nombre).length < 2) errores.push("Escribí el nombre profesional.");
  if (!categorias.length) errores.push("Elegí al menos una categoría.");
  if (!modalidades.length) errores.push("Elegí al menos una modalidad.");
  if (d.departamento && !DEPARTAMENTOS.includes(d.departamento)) errores.push("Departamento no válido.");
  const lat = num(d.lat, -35.2, -30); const lng = num(d.lng, -58.6, -53);
  if ((d.lat || d.lng) && (lat === null || lng === null)) errores.push("Las coordenadas no son válidas para Uruguay.");
  const comision = d.comision === "" || d.comision === undefined ? null : num(d.comision, 0, 50);
  return {
    errores,
    datos: {
      nombre: texto(d.nombre, 120), titular: texto(d.titular, 160), bio: texto(d.bio, 4000), experiencia: texto(d.experiencia, 3000), formacion: texto(d.formacion, 3000),
      anios: num(d.anios, 0, 80, 0), categorias, modalidades, idiomas: texto(d.idiomas || "Español", 120).split(",").map((x) => x.trim()).filter(Boolean),
      ubicacion: { departamento: d.departamento || "", ciudad: texto(d.ciudad, 80), barrio: texto(d.barrio, 80), direccion: texto(d.direccion, 200), referencia: texto(d.referencia, 160), lat, lng, radioKm: num(d.radioKm, 0, 200, 10) },
      telefono: texto(d.telefono, 40), whatsapp: texto(d.whatsapp, 40), mostrarWhatsapp: !!d.mostrarWhatsapp,
      redes: { instagram: texto(d.instagram, 60).replace(/^@/, ""), web: texto(d.web, 200) },
      comision, plan: d.plan === "profesional" ? "profesional" : "gratis", planVence: d.planVence || null,
    },
  };
}

module.exports = { num, leerServicio, leerFicha };
