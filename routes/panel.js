/* Panel del especialista. Todas las rutas requieren sesión y ficha de especialista (salvo /comenzar). */
const router = require("express").Router();
const a = require("../middlewares/asincrono");
const { requiereSesion, requiereEspecialista } = require("../middlewares/auth");
const subida = require("../middlewares/subida");
const { seccionesPanel } = require("../services/menu");

const panel = require("../controllers/panelController");
const ficha = require("../controllers/fichaController");
const agenda = require("../controllers/agendaController");
const negocio = require("../controllers/negocioController");
const cuenta = require("../controllers/cuentaController");

router.use(requiereSesion);
router.get("/comenzar", a(panel.formComenzar));
router.post("/comenzar", a(panel.comenzar));
router.use(requiereEspecialista);
// Menú lateral con contadores
router.use(a(async (req, res, next) => { res.locals.secciones = await seccionesPanel(req.usuario, res.locals.mensajesSinLeer.especialista); next(); }));

// Inicio y publicación
router.get("/", a(panel.inicio));
router.get("/mas", panel.mas);
router.post("/publicar", a(panel.publicar));
router.post("/pausar", a(panel.pausar));
router.get("/notificaciones", a(panel.notificaciones));
router.post("/notificaciones/leer", a(cuenta.leerTodas));
router.get("/notificaciones/:id", a(cuenta.abrirNotificacion));

// Ficha: perfil, apariencia, fotos y video
router.get("/perfil", a(ficha.perfil));
router.get("/perfil/editar", a(ficha.formEditar));
router.post("/perfil/editar", a(ficha.editar));
router.get("/perfil/apariencia", a(ficha.formApariencia));
router.post("/perfil/apariencia", a(ficha.apariencia));
router.get("/perfil/multimedia", a(ficha.multimedia));
router.get("/perfil/multimedia/subir", a(ficha.formSubir));
router.post("/perfil/multimedia", subida({ tipos: "multimedia", maxArchivos: 12 }), a(ficha.subir));
router.post("/perfil/multimedia/:id", a(ficha.editarMedia));

// Servicios
router.get("/servicios", a(ficha.servicios));
router.get("/servicios/nuevo", a(ficha.formNuevoServicio));
router.post("/servicios", a(ficha.crearServicio));
router.get("/servicios/:id", a(ficha.servicio));
router.get("/servicios/:id/editar", a(ficha.formEditarServicio));
router.post("/servicios/:id", a(ficha.editarServicio));
router.post("/servicios/:id/estado", a(ficha.estadoServicio));
router.post("/servicios/:id/eliminar", a(ficha.eliminarServicio));
router.post("/servicios/:id/fotos", subida({ tipos: "imagen", maxArchivos: 1 }), a(ficha.fotosServicio));

// Agenda
router.get("/agenda", a(agenda.agenda));
router.get("/agenda/horarios", a(agenda.formHorarios));
router.post("/agenda/horarios", a(agenda.horarios));
router.get("/agenda/bloqueos", a(agenda.bloqueos));
router.post("/agenda/bloqueos", a(agenda.crearBloqueo));
router.post("/agenda/bloqueos/eliminar", a(agenda.eliminarBloqueo));
router.get("/agenda/disponibilidad", a(agenda.disponibilidad));

// Reservas, clientes y mensajes
router.get("/reservas", a(agenda.reservas));
router.get("/reservas/:id", a(agenda.reserva));
router.post("/reservas/:id/confirmar", a(agenda.confirmar));
router.post("/reservas/:id/cancelar", a(agenda.cancelar));
router.get("/reservas/:id/reprogramar", a(agenda.formReprogramar));
router.post("/reservas/:id/reprogramar", a(agenda.reprogramar));
router.post("/reservas/:id/realizada", a(agenda.realizada));
router.post("/reservas/:id/ausencia", a(agenda.ausencia));
router.post("/reservas/:id/notas", a(agenda.notas));
router.get("/clientes", a(agenda.clientes));
router.get("/clientes/:usuarioId", a(agenda.cliente));
router.get("/clientes/:usuarioId/mensaje", a(agenda.mensajeCliente));
router.get("/mensajes", a(agenda.mensajes));
router.get("/mensajes/:id", a(agenda.conversacion));
router.post("/mensajes/:id", a(agenda.enviarMensaje));

// Estadísticas e ingresos
router.get("/estadisticas", a(panel.estadisticas("estadisticas")));
router.get("/visualizaciones", a(panel.estadisticas("visualizaciones")));
router.get("/rendimiento", a(panel.estadisticas("rendimiento")));
router.get("/ingresos", a(panel.ingresos));
router.get("/facturacion", a(panel.facturacion));

// Reseñas, verificación y certificaciones
router.get("/resenas", a(negocio.resenas));
router.post("/resenas/:id/responder", a(negocio.responder));
router.post("/resenas/:id/revision", a(negocio.pedirRevision));
router.get("/verificacion", a(ficha.verificacion));
router.post("/verificacion", subida({ privado: true, tipos: "documento", maxArchivos: 3 }), a(ficha.verificar));
router.get("/certificaciones", a(ficha.certificaciones));
router.post("/certificaciones", subida({ privado: true, tipos: "documento", maxArchivos: 1 }), a(ficha.crearCertificacion));
router.post("/certificaciones/:id/eliminar", a(ficha.eliminarCertificacion));

// Cuenta y cobros
router.get("/cuenta", a(negocio.cuenta));
router.post("/cuenta", a(negocio.guardarCuenta));
router.get("/cuenta/cobros", a(negocio.cobros));
router.get("/cuenta/cobros/mercadopago/conectar", a(negocio.conectarMp));
router.get("/cuenta/cobros/mercadopago/callback", a(negocio.retornoMp));
router.post("/cuenta/cobros/simular", a(negocio.simularMp));
router.post("/cuenta/cobros/desconectar", a(negocio.desconectarMp));

// Ayuda (mismo circuito que el usuario, con el diseño del panel)
router.get("/ayuda", a((req, res) => cuenta.ayuda(req, res, "panel")));
router.post("/ayuda", a(cuenta.crearConsulta));
router.get("/ayuda/:id", a((req, res) => cuenta.consulta(req, res, "panel")));
router.post("/ayuda/:id", a(cuenta.responderConsulta));

// Crecimiento
router.get("/promociones", a(negocio.promociones));
router.post("/promociones", a(negocio.crearPromocion));
router.post("/promociones/:id/estado", a(negocio.estadoPromocion));
router.get("/destacados", a(negocio.destacados));
router.post("/destacados", a(negocio.pedirDestacado));
router.get("/plan", negocio.plan);
router.post("/plan", a(negocio.pedirPlan));

module.exports = router;
