'use strict';
const mongoose = require('mongoose');
const config = require('./index');
const logger = require('../lib/logger');

mongoose.set('strictQuery', true);

async function connect(uri = config.mongoUri) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  await mongoose.connect(uri, {
    autoIndex: !config.isProd, // en producción los índices se sincronizan en la fase release
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 20,
  });
  logger.info('MongoDB conectado', { host: mongoose.connection.host, db: mongoose.connection.name });
  return mongoose.connection;
}

async function disconnect() {
  await mongoose.disconnect();
}

module.exports = { connect, disconnect, mongoose };
