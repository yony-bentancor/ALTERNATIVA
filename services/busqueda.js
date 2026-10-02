/* Búsqueda de servicios con ranking por intención, perfiles nuevos y resultados patrocinados. */
const F = require("./fechas");
const { normalizar } = require("./util");
const { precioPublico } = require("./comision");
const { detectarIntencion, puntuar, intercalarNuevos, distanciaKm } = require("./ranking");
const { proximoTurno } = require("./disponibilidad");
const { catalogo } = require("./especialistas");

const POR_PAGINA = 12;

/** Puntaje de texto simple (título y categoría pesan más que la descripción). */
function puntajeTexto(item, palabras) {
  if (!palabras.length) return 0;
  const campos = [
    [item.servicio.titulo, 10], [item.categoria.nombre, 6], [item.servicio.resumen, 4], [item.especialista.nombre, 4],
    [item.especialista.titular, 3], [item.especialista.ubicacion?.barrio, 3], [item.especialista.ubicacion?.ciudad, 3], [item.servicio.descripcion, 1],
  ].map(([t, p]) => [normalizar(t), p]);
  let total = 0;
  for (const w of palabras) {
    const raiz = w.length > 4 ? w.replace(/(es|s)$/, "") : w;
    for (const [t, p] of campos) if (t && t.includes(raiz)) total += p;
  }
  return total;
}

/** Convierte items del catálogo en tarjetas listas para la vista. */
function tarjetas(items, { cfg, reglas, origen }) {
  return items.map((it) => {
    const u = it.especialista.ubicacion || {};
    return {
      ...it,
      precio: precioPublico({ servicio: it.servicio, especialista: it.especialista, reglas, cfg }),
      distanciaKm: origen && Number.isFinite(u.lat) ? Math.round(distanciaKm(origen, u) * 10) / 10 : null,
    };
  });
}

async function datosBase() {
  const { Config, ReglaComision } = require("../models");
  return { cfg: await Config.obtener(), reglas: await ReglaComision.activas() };
}

async function registrarImpresiones(items, campo = "impresiones") {
  const { Estadistica } = require("../models");
  const fecha = F.hoy();
  for (const it of items) await Estadistica.sumar({ especialistaId: it.especialista.id, servicioId: it.servicio.id, fecha, campo });
}

async function buscar(p = {}, { ahora = new Date() } = {}) {
  const { Categoria } = require("../models");
  const { cfg, reglas } = await datosBase();
  const intencion = detectarIntencion(p.q, { cuando: p.cuando, modalidad: p.modalidad, cerca: !!(p.lat && p.lng) });
  let items = await catalogo();

  let categoria = null;
  if (p.categoria) categoria = await Categoria.uno((c) => c.slug === p.categoria && c.estado === "activa");
  if (!categoria && intencion.texto) {
    const t = intencion.texto;
    categoria = await Categoria.uno((c) => c.estado === "activa" && (normalizar(c.nombre) === t || c.slug === t || normalizar(c.nombre).replace(/s$/, "") === t.replace(/s$/, "")));
    if (categoria) intencion.texto = "";
  }
  if (categoria) items = items.filter((i) => i.categoria.id === categoria.id);
  if (p.departamento) items = items.filter((i) => i.especialista.ubicacion?.departamento === p.departamento || (i.servicio.modalidades || []).includes("online") && intencion.modalidad === "online");
  if (p.ciudad) items = items.filter((i) => normalizar(i.especialista.ubicacion?.ciudad) === normalizar(p.ciudad));
  if (intencion.modalidad) items = items.filter((i) => (i.servicio.modalidades || []).includes(intencion.modalidad));
  if (Number(p.precioMax) > 0) items = items.filter((i) => precioPublico({ servicio: i.servicio, especialista: i.especialista, reglas, cfg }) <= Number(p.precioMax));
  if (Number(p.rating) > 0) items = items.filter((i) => (i.servicio.rating?.prom || 0) >= Number(p.rating));
  if (p.verificado) items = items.filter((i) => i.verificado);

  const palabras = intencion.texto ? intencion.texto.split(" ").filter((w) => w.length > 2) : [];
  if (palabras.length) items = items.map((i) => ({ ...i, puntajeTexto: puntajeTexto(i, palabras) })).filter((i) => i.puntajeTexto > 0);

  const origen = p.lat && p.lng ? { lat: Number(p.lat), lng: Number(p.lng) } : null;
  if (origen && intencion.modalidad === "domicilio") {
    items = items.filter((i) => { const u = i.especialista.ubicacion || {}; const d = distanciaKm(origen, u); return d !== null && d <= (u.radioKm || 10); });
  }

  let lista = items.map((i) => ({
    ...i, id: i.servicio.id, ponderado: i.servicio.rating?.ponderado || cfg.resenas.promedioBase, precioBase: i.servicio.precio, precio: i.servicio.precio,
    distanciaKm: origen ? distanciaKm(origen, i.especialista.ubicacion || {}) ?? undefined : undefined,
  }));

  // Con intención temporal ("hoy", "mañana") se calcula la disponibilidad real de los mejores candidatos.
  if (intencion.cuando) {
    const pre = puntuar(lista, { ...intencion, cuando: null }).slice(0, 40);
    const h = F.hoy(F.ZONA, ahora);
    const limite = intencion.cuando === "hoy" ? h : intencion.cuando === "manana" ? F.sumarDias(h, 1) : F.sumarDias(h, 6);
    const con = [];
    for (const it of pre) {
      const prox = await proximoTurno({ especialistaId: it.especialista.id, servicio: it.servicio, ahora, dias: intencion.cuando === "semana" ? 7 : 2 });
      if (prox && prox.fecha <= limite) con.push({ ...it, proximo: prox, minutosHastaTurno: Math.max(0, (prox.inicio.getTime() - ahora.getTime()) / 60000) });
    }
    lista = con;
  }

  let ordenada;
  if (p.orden === "precio") ordenada = [...lista].sort((a, b) => a.precio - b.precio);
  else if (p.orden === "valoracion") ordenada = [...lista].sort((a, b) => b.ponderado - a.ponderado);
  else if (p.orden === "distancia" && origen) ordenada = [...lista].sort((a, b) => (a.distanciaKm ?? 1e9) - (b.distanciaKm ?? 1e9));
  else ordenada = intercalarNuevos(puntuar(lista, intencion), cfg.descubrimiento.nuevoCada);

  const total = ordenada.length;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pagina = Math.min(Math.max(1, parseInt(p.page || p.pagina, 10) || 1), paginas);
  const enPagina = ordenada.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const cards = tarjetas(enPagina, { cfg, reglas, origen });
  for (const c of cards) if (!c.proximo) c.proximo = await proximoTurno({ especialistaId: c.especialista.id, servicio: c.servicio, ahora, dias: 14 });

  const patrocinados = pagina === 1 ? await patrocinadosPara({ categoria, departamento: p.departamento, q: intencion.texto, cfg, reglas, origen }) : [];
  await registrarImpresiones(cards);
  return { items: cards, total, pagina, paginas, intencion, categoria, patrocinados };
}

/** Resultados patrocinados: separados, marcados y limitados. No modifican reputación ni orden orgánico. */
async function patrocinadosPara({ categoria, departamento, q, cfg, reglas, origen, tipo }) {
  const { Destacado } = require("../models");
  const ahora = new Date();
  const vigentes = await Destacado.todos((d) => Destacado.vigente(d, ahora) && (
    (tipo === "inicio" && d.tipo === "inicio")
    || (categoria && d.tipo === "categoria" && d.categoriaId === categoria.id)
    || (departamento && d.tipo === "zona" && d.departamento === departamento)
    || (q && d.tipo === "busqueda" && (d.palabras || []).some((w) => normalizar(q).includes(normalizar(w))))
    || d.tipo === "recomendacion"));
  if (!vigentes.length) return [];
  const cat = await catalogo();
  const elegidos = vigentes.sort(() => Math.random() - 0.5).slice(0, cfg.descubrimiento.lugaresPatrocinados);
  const out = [];
  for (const d of elegidos) {
    const it = d.servicioId ? cat.find((i) => i.servicio.id === d.servicioId) : cat.filter((i) => i.especialista.id === d.especialistaId && (!categoria || i.categoria.id === categoria.id)).sort((a, b) => (b.servicio.rating?.ponderado || 0) - (a.servicio.rating?.ponderado || 0))[0];
    if (!it) continue;
    d.impresiones = (d.impresiones || 0) + 1;
    await Destacado.guardar(d);
    out.push({ ...tarjetas([it], { cfg, reglas, origen })[0], patrocinado: true, destacadoId: d.id });
  }
  await registrarImpresiones(out, "impresionesPatrocinadas");
  return out;
}

/** Secciones del inicio: mejor valorados con volumen, nuevos, categorías y patrocinados. */
async function seccionesInicio() {
  const { Categoria } = require("../models");
  const { cfg, reglas } = await datosBase();
  const cat = await catalogo();
  const top = cat.filter((i) => (i.servicio.rating?.cant || 0) >= 3).sort((a, b) => (b.servicio.rating.ponderado || 0) - (a.servicio.rating.ponderado || 0)).slice(0, 8);
  const nuevos = cat.filter((i) => i.nuevo).sort((a, b) => String(b.especialista.publicado).localeCompare(String(a.especialista.publicado))).slice(0, 4);
  const categorias = await Categoria.activas();
  const conteo = {};
  for (const i of cat) conteo[i.categoria.id] = (conteo[i.categoria.id] || 0) + 1;
  return {
    top: tarjetas(top, { cfg, reglas }),
    nuevos: tarjetas(nuevos, { cfg, reglas }),
    categorias: categorias.map((c) => ({ ...c, cantidad: conteo[c.id] || 0 })),
    patrocinados: await patrocinadosPara({ cfg, reglas, tipo: "inicio" }),
    totalServicios: cat.length,
    totalEspecialistas: new Set(cat.map((i) => i.especialista.id)).size,
  };
}

module.exports = { buscar, tarjetas, datosBase, patrocinadosPara, seccionesInicio, POR_PAGINA };
