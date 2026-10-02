'use strict';
const fs = require('fs');
const path = require('path');

// Node 22 trae un cargador de .env nativo: no hace falta dotenv.
const envFile = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

const env = (key, fallback = '') => {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
};
const bool = (key, fallback = false) => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'si', 'sí'].includes(String(v).toLowerCase());
};

const nodeEnv = env('NODE_ENV', 'development');
const isProd = nodeEnv === 'production';

const appEnv = env('APP_ENV', nodeEnv);

const config = {
  nodeEnv,
  isProd, // NODE_ENV=production: cookies seguras, HTTPS, logs, sin autoIndex
  isLive: appEnv === 'production', // el sitio real con dinero real (staging usa NODE_ENV=production con isLive=false)
  isTest: nodeEnv === 'test',
  appEnv,
  port: Number(env('PORT', '3000')),
  appUrl: env('APP_URL', 'http://localhost:3000').replace(/\/$/, ''),
  tz: env('TZ_NAME', 'America/Montevideo'),
  locale: 'es-UY',
  currency: 'UYU',
  mongoUri: env('MONGODB_URI', 'mongodb://127.0.0.1:27017/alternativa'),
  sessionSecret: env('SESSION_SECRET', ''),
  admin: {
    email: env('ADMIN_EMAIL', ''),
    password: env('ADMIN_PASSWORD', ''),
  },
  payments: {
    provider: env('PAYMENT_PROVIDER', 'simulated'),
    mp: {
      accessToken: env('MP_ACCESS_TOKEN'),
      publicKey: env('MP_PUBLIC_KEY'),
      webhookSecret: env('MP_WEBHOOK_SECRET'),
      clientId: env('MP_CLIENT_ID'),
      clientSecret: env('MP_CLIENT_SECRET'),
      apiBase: env('MP_API_BASE', 'https://api.mercadopago.com'),
      authBase: env('MP_AUTH_BASE', 'https://auth.mercadopago.com.uy'),
    },
  },
  storage: {
    driver: env('STORAGE_DRIVER', 'local'),
    cloudinary: {
      cloudName: env('CLOUDINARY_CLOUD_NAME'),
      apiKey: env('CLOUDINARY_API_KEY'),
      apiSecret: env('CLOUDINARY_API_SECRET'),
      folder: env('CLOUDINARY_FOLDER', 'alternativa'),
    },
  },
  email: {
    provider: env('EMAIL_PROVIDER', 'console'),
    from: env('EMAIL_FROM', 'Alternativa <hola@alternativa.uy>'),
    resendApiKey: env('RESEND_API_KEY'),
  },
  push: {
    publicKey: env('VAPID_PUBLIC_KEY'),
    privateKey: env('VAPID_PRIVATE_KEY'),
    subject: env('VAPID_SUBJECT', 'mailto:hola@alternativa.uy'),
  },
  whatsapp: {
    token: env('WHATSAPP_TOKEN'),
    phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
    lang: env('WHATSAPP_TEMPLATE_LANG', 'es'),
  },
  jobs: {
    inProcess: bool('RUN_JOBS_IN_PROCESS', !isProd),
  },
};

function assertProductionConfig() {
  const problems = [];
  if (!config.sessionSecret || config.sessionSecret.length < 32) problems.push('SESSION_SECRET (mínimo 32 caracteres)');
  if (config.isProd && config.storage.driver === 'local') problems.push('STORAGE_DRIVER=local no persiste en Heroku: usar cloudinary');
  if (config.isLive && config.payments.provider === 'simulated') problems.push('PAYMENT_PROVIDER=simulated no está permitido en producción');
  if (config.payments.provider === 'mercadopago' && !config.payments.mp.accessToken) problems.push('MP_ACCESS_TOKEN');
  if (config.storage.driver === 'cloudinary' && !(config.storage.cloudinary.cloudName && config.storage.cloudinary.apiKey && config.storage.cloudinary.apiSecret)) {
    problems.push('credenciales de Cloudinary');
  }
  return problems;
}

config.assertProductionConfig = assertProductionConfig;
module.exports = config;
