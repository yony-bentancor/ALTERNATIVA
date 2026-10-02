/* Control de acceso: sesión iniciada y permisos por rol. */
const { Usuario, Especialista } = require("../models");

/** Carga el usuario de la sesión en req.usuario (y su ficha de especialista en req.especialista). */
async function cargarUsuario(req, res, next) {
  try {
    req.usuario = null;
    req.especialista = null;
    if (req.session.usuarioId) {
      const u = await Usuario.porId(req.session.usuarioId);
      if (u && u.estado === "activo") {
        req.usuario = u;
        if (u.especialistaId) req.especialista = await Especialista.porId(u.especialistaId);
      } else delete req.session.usuarioId;
    }
    next();
  } catch (e) { next(e); }
}

function requiereSesion(req, res, next) {
  if (req.usuario) return next();
  if (req.method === "GET") req.session.volverA = req.originalUrl;
  req.session.flash = { tipo: "info", texto: "Ingresá con tu cuenta para continuar." };
  return res.redirect("/ingresar");
}

function sinPermiso(req, res) {
  res.status(403);
  return res.render("errores/403", { titulo: "Sin permiso" });
}

const requiereAdmin = [requiereSesion, (req, res, next) => (req.usuario.rol === "admin" ? next() : sinPermiso(req, res))];

/** Panel del especialista: si todavía no tiene ficha, lo lleva a crearla. */
const requiereEspecialista = [requiereSesion, (req, res, next) => {
  if (req.especialista) return next();
  if (req.path === "/comenzar") return next();
  return res.redirect("/panel/comenzar");
}];

module.exports = { cargarUsuario, requiereSesion, requiereAdmin, requiereEspecialista, sinPermiso };
