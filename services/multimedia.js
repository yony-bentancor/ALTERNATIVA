/* Archivos subidos: borrado del archivo físico junto con su registro. */
const fs = require("fs");
const path = require("path");
const config = require("../config");

/** Borra el archivo local (si es una subida) y su registro. */
async function borrarMedia(m) {
  const { Multimedia } = require("../models");
  if (!m) return;
  if (m.url.startsWith("/subidas/")) fs.rm(path.join(config.carpetaPublica, path.basename(m.url)), () => {});
  if (m.url.startsWith("/archivos/")) fs.rm(path.join(config.carpetaPrivada, path.basename(m.url)), () => {});
  await Multimedia.eliminar(m.id);
}

module.exports = { borrarMedia };
