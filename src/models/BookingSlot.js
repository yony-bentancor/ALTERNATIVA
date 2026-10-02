'use strict';
const { Schema, model } = require('mongoose');

// Bloqueo de agenda anti doble reserva. Cada reserva activa ocupa bloques de 5 minutos;
// el índice único (specialist, slot) hace que dos reservas superpuestas sean imposibles
// a nivel de base de datos, aunque lleguen al mismo milisegundo y sin transacciones.
const bookingSlotSchema = new Schema({
  specialist: { type: Schema.Types.ObjectId, required: true },
  slot: { type: Date, required: true }, // inicio del bloque de 5 min (UTC)
  booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  // Las reservas pendientes de pago tienen vencimiento: el TTL libera el horario solo.
  expiresAt: { type: Date },
}, { timestamps: false, versionKey: false });

bookingSlotSchema.index({ specialist: 1, slot: 1 }, { unique: true });
bookingSlotSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $exists: true } } });

module.exports = model('BookingSlot', bookingSlotSchema);
