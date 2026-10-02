'use strict';
const { Schema, model } = require('mongoose');

// Solicitud de verificación de identidad (documento privado + revisión del admin).
const verificationRequestSchema = new Schema({
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist', required: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  type: { type: String, enum: ['identity', 'claim'], default: 'identity' },
  documents: [{ type: Schema.Types.ObjectId, ref: 'Media' }],
  documentNumberLast4: String, // nunca se guarda el número completo
  notes: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  review: { by: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date, note: String },
}, { timestamps: true });

module.exports = model('VerificationRequest', verificationRequestSchema);
