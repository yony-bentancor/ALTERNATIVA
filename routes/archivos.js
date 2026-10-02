/* Documentos privados (identidad y certificaciones): solo los ve su dueño y administración. */
const path = require("path");
const fs = require("fs");
const router = require("express").Router();
const a = require("../middlewares/asincrono");
const { requiereSesion, sinPermiso } = require("../middlewares/auth");
const config = require("../config");
const { Multimedia } = require("../models");

router.get("/:archivo", requiereSesion, a(async (req, res, next) => {
  const archivo = path.basename(req.params.archivo);
  const m = await Multimedia.uno((x) => x.url === `/archivos/${archivo}`);
  if (!m) return next();
  const propio = req.usuario.especialistaId && req.usuario.especialistaId === m.especialistaId;
  if (!propio && req.usuario.rol !== "admin") return sinPermiso(req, res);
  const ruta = path.join(config.carpetaPrivada, archivo);
  if (!fs.existsSync(ruta)) return next();
  res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  res.sendFile(ruta);
}));

module.exports = router;
