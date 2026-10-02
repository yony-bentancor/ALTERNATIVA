/* Páginas de error. */
function noEncontrado(req, res) {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "No encontrado" });
  res.status(404).render("errores/404", { titulo: "Página no encontrada" });
}

// eslint-disable-next-line no-unused-vars
function manejarError(err, req, res, next) {
  const estado = err.estado || err.status || err.statusCode || 500;
  // Si la petición traía archivos y falló, se descartan.
  if (req.archivos) require("./subida").descartar(req);
  if (estado >= 500) console.error(err);
  const mensaje = err.visible || estado < 500 ? err.message : "Ocurrió un error inesperado. Ya lo registramos; probá de nuevo en unos minutos.";
  if (req.path.startsWith("/api/") || (req.get("accept") || "").includes("application/json")) return res.status(estado).json({ error: mensaje, codigo: err.codigo });

  // Errores de formulario: volver a la página anterior con el mensaje.
  if (estado < 500 && req.method === "POST" && req.session) {
    req.session.flash = { tipo: "error", texto: mensaje };
    let volver = "/";
    try {
      const ref = new URL(req.get("referer") || "");
      if (ref.host === req.get("host")) volver = ref.pathname + ref.search;
    } catch { /* sin referer válido */ }
    return res.redirect(volver);
  }
  res.status(estado);
  if (!res.locals.cfg) return res.type("text").send("Algo salió mal. Probá de nuevo en unos segundos.");
  if (estado === 404) return res.render("errores/404", { titulo: "Página no encontrada", mensaje });
  if (estado === 403) return res.render("errores/403", { titulo: "Sin permiso", mensaje });
  return res.render("errores/500", { titulo: "Algo salió mal", mensaje, detalle: process.env.NODE_ENV === "production" ? null : err.stack });
}

module.exports = { noEncontrado, manejarError };
