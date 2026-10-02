'use strict';
const { Schema, model } = require('mongoose');

// Promoción de un especialista (descuento sobre sus servicios) o institucional (admin).
const promotionSchema = new Schema({
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist', index: true }, // null = institucional
  services: [{ type: Schema.Types.ObjectId, ref: 'Service' }], // vacío = todos los del especialista
  title: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, maxlength: 500 },
  discountPercent: { type: Number, required: true, min: 1, max: 90 },
  // Quién absorbe el descuento: especialista (baja su neto) o plataforma (baja la comisión)
  fundedBy: { type: String, enum: ['specialist', 'platform'], default: 'specialist' },
  audience: { type: String, enum: ['all', 'new_clients', 'returning_clients'], default: 'all' },
  code: { type: String, uppercase: true, trim: true, sparse: true },
  validFrom: Date,
  validTo: Date,
  maxUses: { type: Number, default: 0 }, // 0 = ilimitado
  uses: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'paused', 'ended', 'pending_review'], default: 'active', index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = model('Promotion', promotionSchema);
