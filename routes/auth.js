const router = require("express").Router();
const a = require("../middlewares/asincrono");
const { requiereSesion } = require("../middlewares/auth");
const { limite } = require("../middlewares/seguridad");
const c = require("../controllers/authController");

const intentos = limite({ max: 12, minutos: 15 });

router.get("/ingresar", a(c.formIngreso));
router.post("/ingresar", intentos, a(c.ingresar));
router.get("/login", (req, res) => res.redirect(301, `/ingresar${req.originalUrl.slice(6)}`));
router.get("/admin/login", (req, res) => res.redirect("/ingresar?volver=/admin"));
router.post("/salir", c.salir);
router.get("/registro", a(c.formRegistro));
router.post("/registro", intentos, a(c.registrar));
router.get("/verificar/:token", a(c.verificar));
router.post("/verificar/reenviar", requiereSesion, intentos, a(c.reenviarVerificacion));
router.get("/recuperar", c.formRecuperar);
router.post("/recuperar", intentos, a(c.recuperar));
router.get("/restablecer/:token", a(c.formRestablecer));
router.post("/restablecer/:token", intentos, a(c.restablecer));
router.get("/reclamar/:token", a(c.formReclamar));
router.post("/reclamar/:token", requiereSesion, a(c.reclamar));

module.exports = router;
