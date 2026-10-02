/* Variables y funciones disponibles en todas las vistas. */
const config = require("../config");
const { Usuario, Notificacion, Config, Reserva, Pago, Especialista } = require("../models");
const { sinLeer } = require("../services/mensajeria");
const F = require("../services/fechas");
const U = require("../services/util");
const { icono } = require("../services/iconos");

/** URL del mapa embebido de Google (con clave usa la API oficial; sin clave, el mapa público). */
function mapaEmbed({ lat, lng, q, zoom = 15 }) {
  const lugar = q || (Number.isFinite(lat) ? `${lat},${lng}` : "");
  if (!lugar) return "";
  if (config.googleMapsKey) return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(config.googleMapsKey)}&q=${encodeURIComponent(lugar)}&zoom=${zoom}&language=es`;
  return `https://maps.google.com/maps?q=${encodeURIComponent(lugar)}&z=${zoom}&hl=es&output=embed`;
}
const mapaComoLlegar = ({ lat, lng, q }) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(Number.isFinite(lat) ? `${lat},${lng}` : q || "")}`;
const mapaAbrir = ({ lat, lng, q }) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(Number.isFinite(lat) ? `${lat},${lng}` : q || "")}`;

module.exports = async function locales(req, res, next) {
  try {
    const u = req.usuario;
    const cfg = await Config.obtener();
    res.locals.cfg = cfg;
    // Valores por defecto de cada vista (los controladores los pisan al renderizar)
    Object.assign(res.locals, { area: "publico", activo: "", titulo: null, descripcion: null, secciones: [], imagenOg: null, sinPie: false });
    res.locals.usuario = Usuario.publico(u);
    res.locals.miEspecialista = req.especialista;
    res.locals.ruta = req.path;
    res.locals.urlActual = req.originalUrl;
    res.locals.query = req.query;
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    res.locals.modoDemo = config.modoDemo;
    res.locals.entorno = config.entorno;
    res.locals.urlSitio = config.urlSitio;
    res.locals.vapid = config.push.publicKey;
    res.locals.proveedorPagos = config.pagos.proveedor;
    res.locals.avisosSinLeer = u ? await Notificacion.sinLeer(u.id) : 0;
    res.locals.mensajesSinLeer = await sinLeer(u);

    // Formatos y ayudas
    Object.assign(res.locals, {
      pesos: U.pesos, fPct: U.fPct, esc: U.esc, recortar: U.recortar, duracion: U.duracion, fRating: U.fRating, markdown: U.markdown,
      fFecha: F.fFecha, fCorta: F.fCorta, fHora: F.fHora, fFechaHora: F.fFechaHora, fFechaTexto: F.fFechaTexto, fRelativa: F.fRelativa, fDiaCercano: F.fDiaCercano,
      Fx: F, hoy: F.hoy(), DIAS: F.DIAS, DIAS_CORTOS: F.DIAS_CORTOS, MESES: F.MESES,
      nombrePublico: Usuario.nombrePublico, iniciales: Usuario.iniciales, primerNombre: Usuario.primerNombre,
      MODALIDADES: U.MODALIDADES, DEPARTAMENTOS: U.DEPARTAMENTOS, MODELOS_COBRO: U.MODELOS_COBRO,
      ESTADOS_RESERVA: Reserva.ESTADOS, ESTADOS_PAGO: Pago.ESTADOS, ESTADOS_ESPECIALISTA: Especialista.ESTADOS, ROLES: Usuario.ROLES,
      icono, enlaceWhatsapp: U.enlaceWhatsapp, mapaEmbed, mapaComoLlegar, mapaAbrir,
      qs: (extra) => {
        const p = new URLSearchParams({ ...req.query, ...extra });
        for (const [k, v] of [...p]) if (v === "" || v === "undefined" || v === "null") p.delete(k);
        const s = p.toString();
        return s ? `?${s}` : "";
      },
    });

    // Modo mantenimiento: solo administración y acceso.
    if (cfg.sitio.mantenimiento && u?.rol !== "admin" && !["/ingresar", "/salir", "/healthz"].includes(req.path) && !req.path.startsWith("/admin")) {
      return res.status(503).render("errores/mantenimiento", { titulo: "En mantenimiento", sinPie: true });
    }
    next();
  } catch (e) { next(e); }
};
