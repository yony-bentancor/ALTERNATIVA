'use strict';
const { Schema, model } = require('mongoose');

// Exposición paga. El dinero compra exposición, nunca reputación:
// se muestra separado y marcado como "Patrocinado"; no altera estrellas ni orden orgánico.
const sponsoredPlacementSchema = new Schema({
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist', required: true, index: true },
  service: { type: Schema.Types.ObjectId, ref: 'Service' },
  type: { type: String, enum: ['category', 'zone', 'home', 'recommendation', 'search'], required: true },
  category: { type: Schema.Types.ObjectId, ref: 'Category' },
  department: String,
  city: String,
  keywords: [String],
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  price: { type: Number, default: 0 }, // lo que paga el especialista
  paymentStatus: { type: String, enum: ['pending', 'paid', 'waived'], default: 'pending' },
  status: { type: String, enum: ['scheduled', 'active', 'paused', 'ended', 'cancelled'], default: 'scheduled', index: true },
  impressions: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  notes: String,
}, { timestamps: true });

sponsoredPlacementSchema.index({ status: 1, type: 1, startsAt: 1, endsAt: 1 });

module.exports = model('SponsoredPlacement', sponsoredPlacementSchema);
