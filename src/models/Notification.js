'use strict';
const { Schema, model } = require('mongoose');

const notificationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  body: String,
  link: String,
  data: Schema.Types.Mixed,
  // Resultado por canal: in-app siempre; email/push/whatsapp según preferencias y configuración
  channels: {
    inapp: { type: Boolean, default: true },
    email: { status: String, at: Date, error: String },
    push: { status: String, at: Date, error: String },
    whatsapp: { status: String, at: Date, error: String },
  },
  dedupeKey: String, // evita duplicar avisos automáticos (p.ej. recordatorio de una misma reserva)
  readAt: Date,
}, { timestamps: true });

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, readAt: 1 });
notificationSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
// Las notificaciones se purgan a los 180 días (el historial de reservas y pagos vive en sus colecciones)
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

module.exports = model('Notification', notificationSchema);
