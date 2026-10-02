'use strict';
const { Schema, model } = require('mongoose');

// Reserva. Guarda una FOTOGRAFÍA de los datos contractuales al momento de la operación
// (precio, comisión, duración, nombres) para que cambios posteriores no alteren el histórico.
const bookingSchema = new Schema({
  code: { type: String, required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist', required: true, index: true },
  service: { type: Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
  snapshot: {
    serviceTitle: String,
    serviceSlug: String,
    categoryName: String,
    specialistName: String,
    specialistSlug: String,
    userName: String,
    price: Number, // precio del especialista
    homeServiceExtra: { type: Number, default: 0 },
    subtotal: Number,
    discount: { type: Number, default: 0 },
    promotion: { type: Schema.Types.ObjectId, ref: 'Promotion' },
    promotionTitle: String,
    total: Number, // lo que paga el usuario (precio final, tarifa incluida)
    currency: { type: String, default: 'UYU' },
    feeMode: { type: String, enum: ['added', 'included'] },
    commissionRate: Number,
    commissionRuleName: String,
    commissionAmount: Number, // tarifa de Alternativa
    specialistNet: Number, // corresponde al especialista antes de costos del procesador
    processorFeePercent: Number,
    processorFeePaidBy: String,
    processorFeeEstimate: Number,
    specialistReceives: Number, // estimado que recibe el especialista
    platformNet: Number, // estimado que queda para Alternativa
    marketplaceFee: Number, // lo que se envía a la pasarela como comisión del marketplace
    durationMinutes: Number,
    collectionModel: { type: String, enum: ['platform', 'offline', 'split'] },
    cancellationPolicy: Schema.Types.Mixed, // reglas vigentes al reservar
  },
  start: { type: Date, required: true },
  end: { type: Date, required: true },
  modality: { type: String, enum: ['presencial', 'domicilio', 'online'], required: true },
  place: {
    address: String, // dirección del consultorio o del domicilio del usuario
    notes: String,
    onlineUrl: String,
  },
  userNotes: { type: String, maxlength: 1000 },
  specialistNotes: { type: String, maxlength: 2000, select: false }, // notas privadas del especialista
  status: {
    type: String,
    enum: ['pending', 'paid', 'confirmed', 'completed', 'cancelled_user', 'cancelled_specialist', 'rescheduled', 'no_show_user', 'no_show_specialist', 'refunded', 'expired'],
    default: 'pending',
    index: true,
  },
  history: [{
    status: String,
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    byRole: String,
    note: String,
    _id: false,
  }],
  payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
  paymentDeadline: Date, // vence la reserva pendiente si no se paga
  cancellation: {
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    byRole: String,
    reason: String,
    at: Date,
    refundPercent: Number,
    refundAmount: Number,
    rule: String,
  },
  rescheduledFrom: { type: Schema.Types.ObjectId, ref: 'Booking' },
  rescheduledTo: { type: Schema.Types.ObjectId, ref: 'Booking' },
  rescheduleCount: { type: Number, default: 0 },
  rebookOf: { type: Schema.Types.ObjectId, ref: 'Booking' }, // "volver a reservar"
  isFirstWithSpecialist: { type: Boolean, default: true },
  reminders: {
    dayBeforeAt: Date,
    hourBeforeAt: Date,
  },
  reviewRequestedAt: Date,
  reviewed: { type: Boolean, default: false },
  rebookReminderAt: Date,
  completedAt: Date,
  incident: {
    open: { type: Boolean, default: false },
    note: String,
    at: Date,
  },
  source: { type: String, default: 'web' },
}, { timestamps: true });

bookingSchema.index({ code: 1 }, { unique: true });
bookingSchema.index({ specialist: 1, start: 1 });
bookingSchema.index({ user: 1, start: -1 });
bookingSchema.index({ status: 1, start: 1 });
bookingSchema.index({ status: 1, paymentDeadline: 1 });
bookingSchema.index({ createdAt: -1 });

module.exports = model('Booking', bookingSchema);
