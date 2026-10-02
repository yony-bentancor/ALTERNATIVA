'use strict';
const { Schema, model } = require('mongoose');

const paymentSchema = new Schema({
  booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist', required: true, index: true },
  provider: { type: String, enum: ['mercadopago', 'simulated', 'offline', 'manual'], required: true },
  collectionModel: { type: String, enum: ['platform', 'offline', 'split'], required: true },
  // Identificadores en la pasarela
  preferenceId: String,
  providerPaymentId: { type: String, index: true, sparse: true },
  checkoutUrl: String,
  amount: { type: Number, required: true },
  currency: { type: String, default: 'UYU' },
  commissionAmount: { type: Number, required: true },
  specialistAmount: { type: Number, required: true },
  providerFee: { type: Number, default: 0 }, // comisión real informada por la pasarela
  providerFeeEstimate: { type: Number, default: 0 },
  marketplaceFee: { type: Number, default: 0 }, // importe que la pasarela separa para Alternativa (split)
  collectorId: String, // cuenta del especialista que recibe (split)
  refundedAmount: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled', 'refunded', 'partially_refunded', 'charged_back', 'in_mediation', 'offline'],
    default: 'pending',
    index: true,
  },
  chargeback: {
    id: String,
    status: String,
    amount: Number,
    at: Date,
  },
  lastSyncedAt: Date, // conciliación con la pasarela
  statusDetail: String,
  method: String, // credit_card, debit_card, account_money, ticket...
  paidAt: Date,
  // Liquidación: solo aplica a los modelos platform (Alternativa transfiere el neto) y offline
  // (el especialista debe la comisión). En split la pasarela ya dividió el dinero: not_applicable.
  settlement: {
    status: { type: String, enum: ['pending', 'included', 'settled', 'not_applicable'], default: 'pending', index: true },
    payout: { type: Schema.Types.ObjectId, ref: 'Payout' },
    settledAt: Date,
  },
  // "type" se declara como { type: String } para que Mongoose no lo confunda con el tipo del elemento
  events: [{ at: { type: Date, default: Date.now }, type: { type: String }, data: Schema.Types.Mixed, _id: false }],
}, { timestamps: true });

paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ specialist: 1, 'settlement.status': 1 });

module.exports = model('Payment', paymentSchema);
