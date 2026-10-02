'use strict';
const { Schema, model } = require('mongoose');

// Soporte e incidencias (desde contacto, ayuda o una reserva).
const ticketSchema = new Schema({
  number: { type: Number, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  name: String, // si escribe sin cuenta desde Contacto
  email: String,
  booking: { type: Schema.Types.ObjectId, ref: 'Booking' },
  topic: { type: String, enum: ['booking', 'payment', 'refund', 'account', 'specialist', 'technical', 'other'], default: 'other' },
  subject: { type: String, required: true, maxlength: 200 },
  status: { type: String, enum: ['open', 'waiting_user', 'resolved', 'closed'], default: 'open', index: true },
  priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
  messages: [{
    author: { type: Schema.Types.ObjectId, ref: 'User' },
    authorRole: String,
    body: { type: String, maxlength: 5000 },
    at: { type: Date, default: Date.now },
  }],
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

ticketSchema.index({ createdAt: -1 });

module.exports = model('Ticket', ticketSchema);
