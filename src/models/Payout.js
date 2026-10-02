'use strict';
const { Schema, model } = require('mongoose');

// Liquidación: agrupa pagos de un período.
// - Modelo A (platform): Alternativa le transfiere al especialista el neto (direction: to_specialist).
// - Modelo B (offline): el especialista le debe la comisión a Alternativa (direction: to_platform).
const payoutSchema = new Schema({
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist', required: true, index: true },
  direction: { type: String, enum: ['to_specialist', 'to_platform'], required: true },
  periodFrom: Date,
  periodTo: Date,
  payments: [{ type: Schema.Types.ObjectId, ref: 'Payment' }],
  bookingsCount: Number,
  gross: Number, // total cobrado al público
  commission: Number,
  refunds: Number, // ajustes por reembolsos posteriores
  net: Number, // importe a transferir
  status: { type: String, enum: ['draft', 'pending', 'paid', 'cancelled'], default: 'pending', index: true },
  reference: String, // nro. de transferencia / comprobante
  paidAt: Date,
  paidBy: { type: Schema.Types.ObjectId, ref: 'User' },
  notes: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

payoutSchema.index({ createdAt: -1 });

module.exports = model('Payout', payoutSchema);
