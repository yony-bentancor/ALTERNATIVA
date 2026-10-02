const router = require("express").Router();
const a = require("../middlewares/asincrono");
const { requiereSesion } = require("../middlewares/auth");
const { limite } = require("../middlewares/seguridad");
const c = require("../controllers/publicoController");

router.get("/", a(c.inicio));
router.get("/buscar", a(c.buscar));
router.get("/categorias", a(c.categorias));
router.get("/especialistas/:slug", a(c.especialista));
router.get("/especialistas/:slug/galeria", a(c.galeria));
router.get("/servicios/:espSlug/:slug", a(c.servicio));
router.get("/servicios/:espSlug/:slug/resenas", a(c.resenasServicio));
router.post("/reportar", requiereSesion, limite({ max: 20 }), a(c.reportar));

// Páginas institucionales (editables desde Administración → Contenido)
for (const slug of ["como-funciona", "sobre-alternativa", "terminos", "privacidad"]) router.get(`/${slug}`, a(c.pagina(slug)));
router.get("/cancelaciones", a(c.cancelaciones));
router.get("/preguntas-frecuentes", a(c.preguntas));
router.get("/ofrecer", a(c.ofrecer));
router.get("/contacto", c.contacto);
router.post("/contacto", limite({ max: 6, minutos: 30 }), a(c.enviarContacto));
router.get("/blog", a(c.blog));
router.get("/blog/:slug", a(c.articulo));
router.get("/robots.txt", c.robots);
router.get("/sitemap.xml", a(c.sitemap));

// Página de categoría con URL amigable: /masajes, /yoga… (va al final)
router.get("/:slug", a(c.categoria));

module.exports = router;
