'use strict';
const { Schema, model } = require('mongoose');

// Los archivos viven en el servicio de almacenamiento (Cloudinary en producción).
// MongoDB guarda solo URL, tipo, metadata, propietario, estado y orden.
const mediaSchema = new Schema({
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist', index: true },
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
  kind: { type: String, enum: ['avatar', 'cover', 'photo', 'space', 'service', 'video', 'document', 'user_avatar', 'content'], required: true },
  service: { type: Schema.Types.ObjectId, ref: 'Service' },
  url: { type: String, required: true },
  thumbUrl: String,
  storage: { driver: String, key: String },
  mime: String,
  bytes: Number,
  width: Number,
  height: Number,
  durationSec: Number,
  caption: { type: String, maxlength: 200 },
  // Los documentos (identidad, certificaciones) son privados: nunca se listan en público
  visibility: { type: String, enum: ['public', 'private'], default: 'public' },
  status: { type: String, enum: ['approved', 'pending', 'rejected', 'reported'], default: 'approved', index: true },
  moderation: { by: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date, reason: String },
  reportsCount: { type: Number, default: 0 },
  order: { type: Number, default: 0 },
}, { timestamps: true });

mediaSchema.index({ specialist: 1, kind: 1, order: 1 });

module.exports = model('Media', mediaSchema);
