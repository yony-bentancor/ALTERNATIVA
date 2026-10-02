'use strict';
const { Schema, model } = require('mongoose');

// Reseña verificada: solo existe si hubo una reserva realizada (una reseña por reserva).
const reviewSchema = new Schema({
  booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
  service: { type: Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist', required: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  authorName: String, // "Ana M." (snapshot)
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, maxlength: 2000 },
  serviceDate: Date,
  // published: visible | under_review: el especialista pidió revisión (sigue visible)
  // hidden: moderada por admin (no cuenta en reputación)
  status: { type: String, enum: ['published', 'under_review', 'hidden'], default: 'published', index: true },
  moderation: {
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    at: Date,
    reason: String,
  },
  reply: {
    text: { type: String, maxlength: 1500 },
    at: Date,
  },
  reviewRequest: { // pedido de revisión del especialista
    reason: String,
    details: String,
    at: Date,
    resolvedAt: Date,
    resolution: String,
  },
  editedAt: Date,
  helpful: { type: Number, default: 0 },
}, { timestamps: true });

reviewSchema.index({ booking: 1 }, { unique: true });
reviewSchema.index({ service: 1, status: 1, createdAt: -1 });
reviewSchema.index({ specialist: 1, status: 1, createdAt: -1 });

module.exports = model('Review', reviewSchema);
