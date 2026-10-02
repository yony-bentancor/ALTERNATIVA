/*
 * Genera las claves VAPID para las notificaciones push del navegador.
 *
 *   npm run vapid
 *
 * Copiá las dos líneas en el archivo .env (o en Heroku → Settings → Config Vars).
 */
const { generateVapidKeys } = require("../services/webpush");

const { publicKey, privateKey } = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
