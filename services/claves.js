/* Hash de contraseñas con scrypt (incluido en Node, no requiere dependencias). */
const crypto = require("crypto");

function hashClave(clave) {
  const sal = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(clave), sal, 32).toString("hex");
  return `scrypt$${sal}$${hash}`;
}

function verificarClave(clave, guardada) {
  if (!guardada || !guardada.startsWith("scrypt$")) return false;
  const [, sal, hash] = guardada.split("$");
  const calc = crypto.scryptSync(String(clave), sal, 32);
  const esperado = Buffer.from(hash, "hex");
  return esperado.length === calc.length && crypto.timingSafeEqual(calc, esperado);
}

/** Token aleatorio para enlaces (verificar email, restablecer clave, reclamar perfil). Se guarda solo el hash. */
function crearToken() {
  const token = crypto.randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token) };
}
const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

/** Cifrado simétrico (tokens de Mercado Pago de cada especialista). */
function clave32() {
  const config = require("../config");
  return crypto.createHash("sha256").update(config.secretoSesion).digest();
}
function cifrar(texto) {
  if (!texto) return "";
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", clave32(), iv);
  const enc = Buffer.concat([c.update(String(texto), "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}
function descifrar(valor) {
  if (!valor) return "";
  const [iv, tag, enc] = String(valor).split(".");
  const d = crypto.createDecipheriv("aes-256-gcm", clave32(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
}

module.exports = { hashClave, verificarClave, crearToken, hashToken, cifrar, descifrar };
