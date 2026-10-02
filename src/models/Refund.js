'use strict';
const { Schema, model } = require('mongoose');

const refundSchema = new Schema({
  booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  payment: { type: Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist', index: true },
  amount: { type: Number, required: true, min: 0 },
  percent: Number,
  // Cómo se reparte el reembolso entre comisión y neto del especialista
  commissionReversed: { type: Number, default: 0 },
  specialistReversed: { type: Number, default: 0 },
  reason: String,
  rule: String,
  initiatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  initiatedByRole: String,
  status: { type: String, enum: ['pending', 'processed', 'failed', 'manual'], default: 'pending', index: true },
  providerRefundId: String,
  error: String,
  processedAt: Date,
}, { timestamps: true });

refundSchema.index({ createdAt: -1 });

module.exports = model('Refund', refundSchema);
