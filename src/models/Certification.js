'use strict';
const { Schema, model } = require('mongoose');

// Certificación/formación. "declared" = informada por el especialista (se muestra como declarada);
// "verified" = Alternativa revisó la documentación. Nunca decir "verificado" sin verificación real.
const certificationSchema = new Schema({
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  issuer: { type: String, trim: true, maxlength: 160 },
  year: Number,
  category: { type: Schema.Types.ObjectId, ref: 'Category' },
  document: { type: Schema.Types.ObjectId, ref: 'Media' }, // privado
  status: { type: String, enum: ['declared', 'pending', 'verified', 'rejected'], default: 'declared', index: true },
  review: { by: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date, note: String },
}, { timestamps: true });

module.exports = model('Certification', certificationSchema);
