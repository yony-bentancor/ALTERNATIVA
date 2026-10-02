/* Ingreso (con usuarios de prueba), registro, salida, verificación de email, recuperación de clave y reclamo de perfiles. */
const config = require("../config");
const { Usuario, Auditoria, Config } = require("../models");
const { hashClave, crearToken, hashToken } = require("../services/claves");
const { enviarEmail, plantilla } = require("../services/email");
const { inicioDe } = require("../services/menu");
const { EMAIL, texto } = require("../services/util");
const especialistas = require("../services/especialistas");

const volverSeguro = (url) => (typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : null);

async function iniciarSesion(req, u) {
  const volverA = req.session.volverA;
  await new Promise((ok, mal) => req.session.regenerate((e) => (e ? mal(e) : ok())));
  req.session.usuarioId = u.id;
  u.ultimoIngreso = new Date().toISOString();
  await Usuario.guardar(u);
  return volverSeguro(volverA);
}

async function enviarVerificacion(u) {
  const { token, hash } = crearToken();
  u.tokenVerificar = { hash, vence: new Date(Date.now() + 3 * 86400000).toISOString() };
  await Usuario.guardar(u);
  await enviarEmail({ para: u.email, asunto: "Confirmá tu email · Alternativa", html: plantilla({ titulo: "Confirmá tu email", intro: `Hola ${Usuario.primerNombre(u)}, confirmá tu dirección para recibir los avisos de tus reservas.`, boton: "Confirmar email", url: `${config.urlSitio}/verificar/${token}` }) });
  return token;
}

exports.formIngreso = async (req, res) => {
  if (req.usuario) return res.redirect(inicioDe(req.usuario));
  if (volverSeguro(req.query.volver)) req.session.volverA = req.query.volver;
  const prueba = config.modoDemo ? await Usuario.todos((u) => u.prueba) : [];
  const orden = { admin: 0, especialista: 1, usuario: 2 };
  prueba.sort((a, b) => orden[a.rol] - orden[b.rol]);
  res.render("auth/ingresar", { titulo: "Ingresar", prueba, email: "", claveDemo: config.modoDemo ? config.claveDemo : null, sinWhatsapp: true });
};

exports.ingresar = async (req, res) => {
  const { email, clave } = req.body;
  const r = await Usuario.autenticar(email, clave);
  if (r.error) {
    const textos = { credenciales: "El correo o la contraseña no son correctos.", bloqueado: "Demasiados intentos fallidos. Esperá 15 minutos y probá de nuevo.", suspendido: "Tu cuenta está suspendida. Escribinos desde Contacto para revisarlo." };
    req.session.flash = { tipo: "error", texto: textos[r.error] };
    return res.redirect("/ingresar");
  }
  const u = r.usuario;
  const volverA = await iniciarSesion(req, u);
  if (u.rol === "admin") await Auditoria.registrar(req, { accion: "acceso.admin", entidad: "usuario", entidadId: u.id, resumen: `Ingreso de ${u.email}`, severidad: "seguridad" });
  req.session.flash = { tipo: "ok", texto: `Hola, ${Usuario.primerNombre(u)}. Ingresaste como ${Usuario.ROLES[u.rol]}.` };
  res.redirect(volverA || inicioDe(u));
};

exports.salir = (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("alternativa.sid");
    res.redirect("/");
  });
};

// Pantallas 20 y 21: selección de tipo de cuenta → registro
exports.formRegistro = async (req, res) => {
  const tipo = req.query.tipo === "especialista" ? "especialista" : req.query.tipo === "usuario" ? "usuario" : null;
  if (req.usuario) return res.redirect(tipo === "especialista" ? "/panel/comenzar" : "/mi");
  if (!tipo) return res.render("auth/tipo-cuenta", { titulo: "Crear cuenta" });
  res.render("auth/registro", { titulo: tipo === "especialista" ? "Registrate como especialista" : "Crear cuenta", tipo, datos: {}, errores: [] });
};

exports.registrar = async (req, res) => {
  const d = req.body;
  const tipo = d.tipo === "especialista" ? "especialista" : "usuario";
  const cfg = await Config.obtener();
  const errores = [];
  if (!texto(d.nombre) || texto(d.nombre).split(" ").length < 2) errores.push("Escribí tu nombre y apellido.");
  if (!EMAIL.test(d.email || "")) errores.push("Escribí un correo válido.");
  if (!d.clave || d.clave.length < 8) errores.push("La contraseña tiene que tener al menos 8 caracteres.");
  if (d.clave !== d.clave2) errores.push("Las dos contraseñas no coinciden.");
  if (!d.acepto) errores.push("Tenés que aceptar los términos y la política de privacidad.");
  if (await Usuario.porEmail(d.email)) errores.push("Ya hay una cuenta con ese correo. Probá ingresar o recuperar tu contraseña.");
  if (tipo === "especialista" && !cfg.sitio.altaEspecialistas) errores.push("El alta de especialistas está cerrada por el momento.");
  if (errores.length) return res.status(400).render("auth/registro", { titulo: "Crear cuenta", tipo, datos: d, errores });

  const u = await Usuario.crear({
    nombre: texto(d.nombre, 120), email: texto(d.email, 200).toLowerCase(), clave: hashClave(d.clave), rol: "usuario", telefono: texto(d.telefono, 40),
    avatar: "", estado: "activo", emailVerificado: false, especialistaId: null, ubicacion: { departamento: d.departamento || "", ciudad: "", barrio: "" },
    preferencias: { avisos: { email: true, push: true, whatsapp: false, marketing: !!d.novedades } }, privacidad: { soloNombre: true, compartirContacto: true },
    metodosPago: [], aceptoTerminos: new Date().toISOString(),
  });
  await enviarVerificacion(u);
  await iniciarSesion(req, u);
  if (tipo === "especialista") {
    req.session.flash = { tipo: "ok", texto: "Cuenta creada. Ahora armemos tu ficha de especialista." };
    return res.redirect("/panel/comenzar");
  }
  req.session.flash = { tipo: "ok", texto: `Te damos la bienvenida, ${Usuario.primerNombre(u)}. Te mandamos un email para confirmar tu dirección.` };
  res.redirect("/");
};

exports.verificar = async (req, res) => {
  const h = hashToken(req.params.token);
  const u = await Usuario.uno((x) => x.tokenVerificar?.hash === h);
  if (!u || new Date(u.tokenVerificar.vence) < new Date()) req.session.flash = { tipo: "error", texto: "El enlace no es válido o venció. Pedí uno nuevo desde Mi cuenta." };
  else {
    u.emailVerificado = true;
    u.tokenVerificar = null;
    await Usuario.guardar(u);
    req.session.flash = { tipo: "ok", texto: "Tu email quedó confirmado." };
  }
  res.redirect(req.usuario ? "/mi" : "/ingresar");
};

exports.reenviarVerificacion = async (req, res) => {
  if (!req.usuario.emailVerificado) {
    const token = await enviarVerificacion(req.usuario);
    // En modo demo (sin email real) se muestra el enlace para poder probarlo.
    req.session.flash = { tipo: "ok", texto: config.email.proveedor === "consola" ? `Te reenviamos el email de confirmación. Enlace de prueba: ${config.urlSitio}/verificar/${token}` : "Te reenviamos el email de confirmación." };
  }
  res.redirect("/mi");
};

exports.formRecuperar = (req, res) => res.render("auth/recuperar", { titulo: "Recuperar contraseña", enviado: false, enlaceDemo: null });

exports.recuperar = async (req, res) => {
  const u = await Usuario.porEmail(req.body.email);
  let enlaceDemo = null;
  if (u && u.estado === "activo") {
    const { token, hash } = crearToken();
    u.tokenRestablecer = { hash, vence: new Date(Date.now() + 3600000).toISOString() };
    await Usuario.guardar(u);
    const url = `${config.urlSitio}/restablecer/${token}`;
    await enviarEmail({ para: u.email, asunto: "Restablecé tu contraseña · Alternativa", html: plantilla({ titulo: "Restablecé tu contraseña", intro: "Recibimos un pedido para cambiar tu contraseña. El enlace vence en 1 hora. Si no fuiste vos, ignorá este email.", boton: "Elegir nueva contraseña", url }) });
    if (config.email.proveedor === "consola") enlaceDemo = url;
  }
  // Siempre la misma respuesta: no revela si el correo existe.
  res.render("auth/recuperar", { titulo: "Recuperar contraseña", enviado: true, enlaceDemo });
};

async function porTokenRestablecer(token) {
  const h = hashToken(token);
  const u = await Usuario.uno((x) => x.tokenRestablecer?.hash === h);
  return u && new Date(u.tokenRestablecer.vence) > new Date() ? u : null;
}

exports.formRestablecer = async (req, res) => {
  res.render("auth/restablecer", { titulo: "Nueva contraseña", token: req.params.token, invalido: !(await porTokenRestablecer(req.params.token)), error: null });
};

exports.restablecer = async (req, res) => {
  const u = await porTokenRestablecer(req.params.token);
  const mostrar = (error) => res.status(400).render("auth/restablecer", { titulo: "Nueva contraseña", token: req.params.token, invalido: !u, error });
  if (!u) return mostrar(null);
  if (!req.body.clave || req.body.clave.length < 8) return mostrar("La contraseña tiene que tener al menos 8 caracteres.");
  if (req.body.clave !== req.body.clave2) return mostrar("Las contraseñas no coinciden.");
  u.clave = hashClave(req.body.clave);
  u.tokenRestablecer = null;
  u.intentosFallidos = 0;
  u.bloqueadoHasta = null;
  await Usuario.guardar(u);
  await iniciarSesion(req, u);
  await Auditoria.registrar(req, { accion: "acceso.restablecer_clave", entidad: "usuario", entidadId: u.id, severidad: "seguridad" });
  req.session.flash = { tipo: "ok", texto: "Listo, ya podés usar tu nueva contraseña." };
  res.redirect(inicioDe(u));
};

// Reclamo de perfiles creados por administración
exports.formReclamar = async (req, res) => {
  try {
    const e = await especialistas.porTokenDeReclamo(req.params.token);
    if (!req.usuario) req.session.volverA = `/reclamar/${req.params.token}`;
    res.render("auth/reclamar", { titulo: "Reclamar perfil", e, token: req.params.token, error: null });
  } catch (err) {
    res.status(err.estado || 400).render("auth/reclamar", { titulo: "Reclamar perfil", e: null, token: null, error: err.message });
  }
};

exports.reclamar = async (req, res) => {
  const e = await especialistas.reclamarPerfil(req.params.token, req.usuario);
  await Auditoria.registrar(req, { accion: "especialista.reclamar", entidad: "especialista", entidadId: e.id, resumen: `Perfil reclamado por ${req.usuario.email}` });
  req.session.flash = { tipo: "ok", texto: "Ya administrás tu perfil. Para mostrarlo como verificado, completá la verificación de identidad." };
  res.redirect("/panel/verificacion");
};
