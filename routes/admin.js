/* Administración. Todas las rutas requieren rol admin. */
const router = require("express").Router();
const a = require("../middlewares/asincrono");
const { requiereAdmin } = require("../middlewares/auth");
const subida = require("../middlewares/subida");
const { seccionesAdmin } = require("../services/menu");

const general = require("../controllers/adminController");
const mercado = require("../controllers/adminMarketplaceController");
const dinero = require("../controllers/adminDineroController");
const confianza = require("../controllers/adminConfianzaController");
const crecimiento = require("../controllers/adminCrecimientoController");

router.use(requiereAdmin);
// Menú lateral con contadores de pendientes
router.use(a(async (req, res, next) => { res.locals.secciones = await seccionesAdmin(); next(); }));

// General
router.get("/", a(general.dashboard));
router.get("/pendientes", a(general.pendientes));
router.get("/estadisticas", a(general.estadisticas));

// Especialistas
router.get("/especialistas", a(mercado.especialistas));
router.get("/especialistas/nuevo", a(mercado.formNuevo));
router.post("/especialistas", a(mercado.crear));
router.get("/especialistas/:id", a(mercado.especialista));
router.get("/especialistas/:id/editar", a(mercado.formEditar));
router.post("/especialistas/:id", a(mercado.editar));
router.post("/especialistas/:id/estado", a(mercado.estado));
router.post("/especialistas/:id/cambios", a(mercado.cambios));
router.post("/especialistas/:id/invitar", a(mercado.invitar));
router.post("/especialistas/:id/identidad", a(mercado.identidad));
router.post("/especialistas/:id/eliminar", a(mercado.eliminar));
router.post("/especialistas/:id/servicios", a(mercado.crearServicio));
router.post("/especialistas/:id/multimedia", subida({ tipos: "multimedia", maxArchivos: 1 }), a(mercado.subirMultimedia));

// Verificaciones y documentos privados
router.get("/verificaciones", a(mercado.verificaciones));
router.post("/verificaciones/:id", a(mercado.resolverVerificacion));
router.post("/certificaciones/:id", a(mercado.resolverCertificacion));
router.get("/documentos/:id", a(general.documento));

// Usuarios, servicios y categorías
router.get("/usuarios", a(mercado.usuarios));
router.get("/usuarios/:id", a(mercado.usuario));
router.post("/usuarios/:id", a(mercado.editarUsuario));
router.post("/usuarios/:id/estado", a(mercado.estadoUsuario));
router.get("/servicios", a(mercado.servicios));
router.get("/servicios/:id", a(mercado.servicio));
router.post("/servicios/:id", a(mercado.moderarServicio));
router.get("/categorias", a(mercado.categorias));
router.get("/categorias/nueva", mercado.formNuevaCategoria);
router.post("/categorias", a(mercado.crearCategoria));
router.get("/categorias/:id", a(mercado.formEditarCategoria));
router.post("/categorias/:id", a(mercado.editarCategoria));

// Reservas
router.get("/reservas", a(mercado.reservas));
router.get("/reservas/:id", a(mercado.reserva));
router.post("/reservas/:id/cancelar", a(mercado.cancelarReserva));
router.post("/reservas/:id/estado", a(mercado.estadoReserva));
router.post("/reservas/:id/incidencia", a(mercado.incidencia));
router.post("/reservas/:id/reembolso", a(mercado.reembolso));

// Dinero
router.get("/pagos", a(dinero.pagos));
router.post("/pagos/conciliar", a(dinero.conciliar));
router.get("/pagos/:id", a(dinero.pago));
router.post("/pagos/:id/sincronizar", a(dinero.sincronizar));
router.get("/comisiones", a(dinero.comisiones));
router.post("/comisiones/reglas", a(dinero.crearRegla));
router.post("/comisiones/reglas/:id", a(dinero.alternarRegla));
router.get("/reembolsos", a(dinero.reembolsos));
router.post("/reembolsos/:id/reintentar", a(dinero.reintentar));
router.post("/reembolsos/:id/manual", a(dinero.manual));
router.get("/liquidaciones", a(dinero.liquidaciones));
router.post("/liquidaciones/generar", a(dinero.generar));
router.post("/liquidaciones/:id/pagar", a(dinero.pagar));
router.post("/liquidaciones/:id/anular", a(dinero.anular));

// Confianza
router.get("/resenas", a(confianza.resenas));
router.post("/resenas/:id", a(confianza.moderarResena));
router.get("/moderacion", a(confianza.moderacion));
router.post("/moderacion/multimedia/:id", a(confianza.moderarMedia));
router.get("/denuncias", a(confianza.denuncias));
router.post("/denuncias/:id", a(confianza.resolverDenuncia));
router.get("/soporte", a(confianza.soporte));
router.get("/soporte/:id", a(confianza.consulta));
router.post("/soporte/:id", a(confianza.responderConsulta));

// Crecimiento
router.get("/destacados", a(crecimiento.destacados));
router.post("/destacados", a(crecimiento.crearDestacado));
router.post("/destacados/:id", a(crecimiento.actualizarDestacado));
router.get("/promociones", a(crecimiento.promociones));
router.post("/promociones", a(crecimiento.crearPromocion));
router.post("/promociones/:id/estado", a(crecimiento.estadoPromocion));
router.get("/contenido", a(crecimiento.contenido));
router.get("/contenido/nuevo", crecimiento.formNuevoContenido);
router.post("/contenido", a(crecimiento.crearContenido));
router.post("/contenido/imagen", subida({ tipos: "imagen", maxArchivos: 1 }), a(crecimiento.subirImagen));
router.get("/contenido/:id", a(crecimiento.formEditarContenido));
router.post("/contenido/:id", a(crecimiento.editarContenido));
router.post("/contenido/:id/eliminar", a(crecimiento.eliminarContenido));
router.get("/notificaciones", a(general.notificaciones));
router.post("/notificaciones/enviar", a(general.enviarAviso));

// Sistema
router.get("/configuracion", a(general.configuracion));
router.post("/configuracion/:seccion", a(general.guardarConfiguracion));
router.get("/auditoria", a(general.auditoria));

module.exports = router;
