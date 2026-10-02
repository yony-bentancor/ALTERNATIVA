'use strict';
const { Schema, model } = require('mongoose');

// Conversación usuario ↔ especialista (una por par; puede referenciar la última reserva).
const conversationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist', required: true, index: true },
  specialistUser: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  booking: { type: Schema.Types.ObjectId, ref: 'Booking' },
  lastMessageAt: { type: Date, default: Date.now },
  lastMessagePreview: String,
  unreadUser: { type: Number, default: 0 },
  unreadSpecialist: { type: Number, default: 0 },
  status: { type: String, enum: ['open', 'blocked', 'archived'], default: 'open' },
  blockedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

conversationSchema.index({ user: 1, specialist: 1 }, { unique: true });
conversationSchema.index({ specialistUser: 1, lastMessageAt: -1 });
conversationSchema.index({ user: 1, lastMessageAt: -1 });

module.exports = model('Conversation', conversationSchema);
