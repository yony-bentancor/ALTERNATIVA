'use strict';
const { Schema, model } = require('mongoose');

// Denuncias/reportes de contenido (reseñas, multimedia, perfiles, mensajes, usuarios).
const reportSchema = new Schema({
  reporter: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  reporterRole: String,
  targetType: { type: String, enum: ['review', 'media', 'specialist', 'service', 'user', 'message'], required: true, index: true },
  targetId: { type: Schema.Types.ObjectId, required: true, index: true },
  reason: { type: String, required: true },
  details: { type: String, maxlength: 2000 },
  status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open', index: true },
  resolution: { by: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date, action: String, note: String },
}, { timestamps: true });

reportSchema.index({ createdAt: -1 });

module.exports = model('Report', reportSchema);
