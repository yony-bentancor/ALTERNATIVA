const router = require("express").Router();
const a = require("../middlewares/asincrono");
const { requiereSesion } = require("../middlewares/auth");
const { limite } = require("../middlewares/seguridad");
const c = require("../controllers/reservaController");

const reservando = limite({ max: 20, minutos: 10, mensaje: "Hiciste muchos intentos de reserva seguidos. Esperá unos minutos." });

router.get("/reservar/:servicioId", a(c.elegir));
router.get("/reservar/:servicioId/confirmar", requiereSesion, a(c.confirmar));
router.post("/reservar/:servicioId", requiereSesion, reservando, a(c.crear));
router.get("/pago/retorno", requiereSesion, a(c.retorno));
router.get("/pago/simulado/:pagoId", requiereSesion, a(c.simulado));
router.post("/pago/simulado/:pagoId", requiereSesion, a(c.simuladoResultado));
router.get("/pago/:reservaId", requiereSesion, a(c.pago));
router.post("/pago/:reservaId", requiereSesion, reservando, a(c.pagar));

module.exports = router;
