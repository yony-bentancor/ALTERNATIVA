const router = require("express").Router();
const a = require("../middlewares/asincrono");
const c = require("../controllers/apiController");

// En la API, sin sesión se responde 401 en JSON (no se redirige al ingreso).
const conSesion = (req, res, next) => (req.usuario ? next() : res.status(401).json({ error: "Ingresá para continuar." }));

router.get("/disponibilidad/:servicioId", a(c.disponibilidad));
router.get("/horarios/:servicioId", a(c.horarios));
router.post("/favoritos", conSesion, a(c.favorito));
router.get("/notificaciones/contador", conSesion, a(c.contador));
router.post("/push", conSesion, a(c.suscribirPush));
router.delete("/push", conSesion, a(c.desuscribirPush));
router.get("/mensajes/:id", conSesion, a(c.mensajes));
router.post("/mensajes/:id", conSesion, a(c.enviarMensaje));
router.get("/pagos/:id/estado", conSesion, a(c.estadoPago));

module.exports = router;
