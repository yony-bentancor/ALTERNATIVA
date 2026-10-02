'use strict';
const { Schema, model } = require('mongoose');

const messageSchema = new Schema({
  conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
  sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  senderRole: { type: String, enum: ['user', 'specialist', 'admin', 'system'] },
  body: { type: String, required: true, maxlength: 2000 }, // texto original (auditable por admin)
  containsContact: { type: Boolean, default: false },
  booking: { type: Schema.Types.ObjectId, ref: 'Booking' },
  readAt: Date,
  flagged: { type: Boolean, default: false },
}, { timestamps: true });

messageSchema.index({ conversation: 1, createdAt: -1 });

module.exports = model('Message', messageSchema);
