/*
 * Subida de archivos (fotos, videos, documentos). Usa busboy.
 * Los documentos personales (identidad, certificaciones) se guardan en uploads/privado (solo se ven con permiso);
 * las fotos y videos públicos en uploads/publico.
 *
 * Uso: router.post("/ruta", subida({ privado: false, tipos: "imagen" }), controlador)
 *      En el controlador: req.body (campos) y req.archivos.campo = { archivo, nombreOriginal, tipo, tamanio, url }
 *      (si se envían varios con el mismo nombre, req.archivos.campo es una lista).
 */
const Busboy = require("busboy");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const config = require("../config");

const TIPOS = {
  imagen: { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" },
  video: { "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" },
  documento: { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf" },
};
TIPOS.multimedia = { ...TIPOS.imagen, ...TIPOS.video };

module.exports = function subida({ privado = false, tipos = "imagen", maxArchivos = 12 } = {}) {
  return (req, res, next) => {
    if (!req.is("multipart/form-data")) return next();
    const permitidos = TIPOS[tipos] || TIPOS.imagen;
    const carpeta = privado ? config.carpetaPrivada : config.carpetaPublica;
    fs.mkdirSync(carpeta, { recursive: true });
    req.body = {};
    req.archivos = {};
    const errores = [];
    const escrituras = [];
    let bb;
    try {
      bb = Busboy({ headers: req.headers, limits: { fileSize: Math.max(config.tamanioMaximoImagen, tipos === "video" || tipos === "multimedia" ? config.tamanioMaximoVideo : 0, privado ? config.tamanioMaximoDocumento : 0), files: maxArchivos, fields: 100 } });
    } catch (e) { return next(e); }
    bb.on("field", (nombre, valor) => {
      if (nombre.endsWith("[]")) (req.body[nombre.slice(0, -2)] ||= []).push(valor);
      else if (req.body[nombre] !== undefined) req.body[nombre] = [].concat(req.body[nombre], valor);
      else req.body[nombre] = valor;
    });
    bb.on("file", (campo, stream, info) => {
      const ext = permitidos[info.mimeType];
      if (!info.filename) { stream.resume(); return; }
      if (!ext) { errores.push(`"${info.filename}" no es un formato permitido.`); stream.resume(); return; }
      const limite = info.mimeType.startsWith("video/") ? config.tamanioMaximoVideo : info.mimeType === "application/pdf" ? config.tamanioMaximoDocumento : config.tamanioMaximoImagen;
      const archivo = crypto.randomBytes(12).toString("hex") + ext;
      const destino = path.join(carpeta, archivo);
      const salida = fs.createWriteStream(destino);
      let tamanio = 0;
      let excedido = false;
      stream.on("data", (d) => {
        tamanio += d.length;
        if (tamanio > limite && !excedido) { excedido = true; errores.push(`"${info.filename}" supera los ${Math.round(limite / 1048576)} MB.`); stream.unpipe(salida); salida.end(); stream.resume(); }
      });
      escrituras.push(new Promise((ok) => salida.on("close", ok)));
      stream.pipe(salida);
      stream.on("end", () => {
        if (excedido || stream.truncated) { fs.rm(destino, () => {}); return; }
        const dato = { archivo, ruta: destino, nombreOriginal: info.filename, tipo: info.mimeType, tamanio, url: privado ? `/archivos/${archivo}` : `/subidas/${archivo}` };
        if (req.archivos[campo]) req.archivos[campo] = [].concat(req.archivos[campo], dato);
        else req.archivos[campo] = dato;
      });
    });
    bb.on("close", async () => {
      await Promise.all(escrituras);
      req.erroresSubida = errores;
      // Los formularios con archivos se verifican acá (el cuerpo recién está disponible ahora).
      const { csrfValido } = require("./seguridad");
      if (!csrfValido(req)) {
        for (const a of Object.values(req.archivos).flat()) fs.rm(path.join(carpeta, a.archivo), () => {});
        const e = new Error("La sesión venció o el formulario expiró. Volvé a intentarlo.");
        e.estado = 403; e.visible = true; e.codigo = "csrf";
        return next(e);
      }
      next();
    });
    bb.on("error", next);
    req.pipe(bb);
  };
};

/** Lista de archivos de un campo (siempre como array). */
module.exports.lista = (req, campo) => [].concat(req.archivos?.[campo] || []);

/** Borra los archivos recibidos en la petición (se usa cuando la operación falla, para no dejar huérfanos). */
module.exports.descartar = (req) => {
  for (const a of Object.values(req.archivos || {}).flat()) if (a?.ruta) fs.rm(a.ruta, () => {});
  req.archivos = {};
};
