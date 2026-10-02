/*
 * Ranking de búsqueda. No hay un "Nº1" universal: los pesos dependen de la intención
 * ("masaje hoy", "reiki online barato", "yoga cerca"). Lógica pura (cubierta por tests).
 */
const { normalizar } = require("./util");

const entre01 = (x) => Math.max(0, Math.min(1, x));

/** Promedio bayesiano: 5,0 con 2 reseñas no supera automáticamente a 4,9 con 127. */
function bayesiano(prom, cant, base = 4.4, peso = 10) {
  if (!cant) return base;
  return (peso * base + prom * cant) / (peso + cant);
}

const CUANDO = [
  { re: /\b(hoy|ahora|ya|urgente|esta tarde|esta noche|hoy mismo)\b/, cuando: "hoy" },
  { re: /\b(manana)\b/, cuando: "manana" },
  { re: /\b(esta semana|semana|finde|fin de semana|sabado|domingo)\b/, cuando: "semana" },
];
const GENERICOS = ["masaje", "masajes", "terapia", "terapias", "yoga", "reiki", "acupuntura", "meditacion", "tai chi", "astrologia"];

/** Interpreta la búsqueda en lenguaje natural. */
function detectarIntencion(q, filtros = {}) {
  let t = normalizar(q);
  const i = { cuando: filtros.cuando || null, cerca: !!filtros.cerca, barato: false, modalidad: filtros.modalidad || null, especifica: false, texto: "" };
  for (const w of CUANDO) if (w.re.test(t)) { i.cuando = i.cuando || w.cuando; t = t.replace(w.re, " "); }
  if (/\b(cerca|cerca de mi|cercano|cercanos|mi zona|por aca)\b/.test(t)) { i.cerca = true; t = t.replace(/\b(cerca de mi|cerca|cercanos?|mi zona|por aca)\b/g, " "); }
  if (/\b(barato|baratos|economico|economicos|accesible|oferta)\b/.test(t)) { i.barato = true; t = t.replace(/\b(barato|baratos|economicos?|accesible|oferta)\b/g, " "); }
  if (/\b(a domicilio|domicilio|en casa|en mi casa)\b/.test(t)) { i.modalidad = i.modalidad || "domicilio"; t = t.replace(/\b(a domicilio|domicilio|en mi casa|en casa)\b/g, " "); }
  if (/\b(online|virtual|remoto|por zoom|videollamada)\b/.test(t)) { i.modalidad = i.modalidad || "online"; t = t.replace(/\b(online|virtual|remoto|por zoom|videollamada)\b/g, " "); }
  t = t.replace(/\b(de|para|en|un|una|el|la|los|las|con|y|quiero|busco|necesito)\b/g, " ").replace(/\s+/g, " ").trim();
  i.texto = t;
  i.especifica = !!t && (t.split(" ").length > 1 || !GENERICOS.includes(t));
  return i;
}

function pesosPara(i) {
  if (i.cuando) return { disponibilidad: 0.45, rating: 0.25, distancia: 0.2, precio: 0.05, texto: 0.05 };
  if (i.cerca) return { distancia: 0.45, rating: 0.3, disponibilidad: 0.15, precio: 0.05, texto: 0.05 };
  if (i.barato) return { precio: 0.45, rating: 0.3, disponibilidad: 0.1, distancia: 0.1, texto: 0.05 };
  if (i.especifica) return { rating: 0.5, texto: 0.2, disponibilidad: 0.1, distancia: 0.15, precio: 0.05 };
  return { rating: 0.35, disponibilidad: 0.2, distancia: 0.2, precio: 0.15, texto: 0.1 };
}

/** items: { id, ponderado, distanciaKm?, precio, minutosHastaTurno?, puntajeTexto? } */
function puntuar(items, intencion) {
  const w = pesosPara(intencion);
  const precios = items.map((x) => x.precio).filter(Number.isFinite);
  const min = Math.min(...precios); const max = Math.max(...precios);
  const maxTexto = Math.max(0.0001, ...items.map((x) => x.puntajeTexto || 0));
  return items.map((it) => {
    const rating = entre01((it.ponderado - 3) / 2);
    const distancia = Number.isFinite(it.distanciaKm) ? 1 / (1 + it.distanciaKm / 4) : (intencion.modalidad === "online" ? 1 : 0.4);
    let disponibilidad = 0.2;
    if (it.minutosHastaTurno === null) disponibilidad = 0;
    else if (Number.isFinite(it.minutosHastaTurno)) {
      const h = it.minutosHastaTurno / 60;
      disponibilidad = h <= 24 ? 1 : h <= 72 ? 0.6 : h <= 168 ? 0.3 : 0.1;
    }
    const precio = max > min ? 1 - (it.precio - min) / (max - min) : 0.5;
    const texto = (it.puntajeTexto || 0) / maxTexto;
    const puntaje = w.rating * rating + w.distancia * distancia + w.disponibilidad * disponibilidad + w.precio * precio + w.texto * texto;
    return { ...it, puntaje: Math.round(puntaje * 10000) / 10000 };
  }).sort((a, b) => b.puntaje - a.puntaje || b.ponderado - a.ponderado);
}

/** Reserva 1 de cada N posiciones para perfiles nuevos (nunca se les inventa reputación). */
function intercalarNuevos(lista, cada = 6) {
  const normales = lista.filter((r) => !r.nuevo);
  const nuevos = lista.filter((r) => r.nuevo);
  if (!nuevos.length || cada < 2) return lista;
  const out = [];
  while (normales.length || nuevos.length) {
    if ((out.length + 1) % cada === 0 && nuevos.length) out.push(nuevos.shift());
    else if (normales.length) out.push(normales.shift());
    else out.push(nuevos.shift());
  }
  return out;
}

function esNuevo({ publicado, resenas, ahora = new Date(), dias = 90, maxResenas = 5 }) {
  if (!publicado) return false;
  const edad = (ahora.getTime() - new Date(publicado).getTime()) / 86400000;
  return edad <= dias && (resenas || 0) < maxResenas;
}

/** Distancia en km entre dos puntos {lat, lng}. */
function distanciaKm(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return null;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

module.exports = { bayesiano, detectarIntencion, pesosPara, puntuar, intercalarNuevos, esNuevo, distanciaKm };
