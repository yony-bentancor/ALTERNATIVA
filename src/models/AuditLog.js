'use strict';
const { Schema, model } = require('mongoose');

// Auditoría de acciones sensibles: quién, qué, cuándo, valor anterior y nuevo.
// Solo inserción: no se expone edición ni borrado desde la aplicación.
const auditLogSchema = new Schema({
  actor: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  actorRole: String,
  actorName: String,
  action: { type: String, required: true, index: true }, // ej: booking.cancel, commission.update
  entity: { type: String, index: true },
  entityId: { type: Schema.Types.ObjectId, index: true },
  summary: String,
  before: Schema.Types.Mixed,
  after: Schema.Types.Mixed,
  ip: String,
  userAgent: String,
  severity: { type: String, enum: ['info', 'warning', 'security'], default: 'info' },
}, { timestamps: { createdAt: true, updatedAt: false } });

auditLogSchema.index({ createdAt: -1 });

module.exports = model('AuditLog', auditLogSchema);
