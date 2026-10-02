'use strict';
// Genera el par de claves VAPID para notificaciones push.
const { generateVapidKeys } = require('../src/lib/webpush');

const { publicKey, privateKey } = generateVapidKeys();
console.log('Agregá estas variables de entorno (Heroku → Settings → Config Vars):\n');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:hola@alternativa.uy');
