'use strict';
const { Schema, model } = require('mongoose');

const pointSchema = new Schema({
  type: { type: String, enum: ['Point'], default: 'Point' },
  coordinates: { type: [Number] },
}, { _id: false });

// Cada servicio es una entidad propia, con su propia reputación.
const serviceSchema = new Schema({
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist', required: true, index: true },
  category: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
  slug: { type: String, required: true, lowercase: true, trim: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  summary: { type: String, maxlength: 240 },
  description: { type: String, maxlength: 5000 },
  includes: [String],
  preparation: { type: String, maxlength: 1500 }, // "Qué llevar / cómo prepararse"
  price: { type: Number, required: true, min: 0 }, // UYU enteros
  currency: { type: String, default: 'UYU' },
  durationMinutes: { type: Number, required: true, min: 10, max: 600 },
  modalities: [{ type: String, enum: ['presencial', 'domicilio', 'online'] }],
  homeServiceExtra: { type: Number, default: 0, min: 0 }, // recargo a domicilio
  maxAdvanceDays: Number, // opcional, sobreescribe el de agenda
  photos: [{ type: Schema.Types.ObjectId, ref: 'Media' }],
  status: { type: String, enum: ['active', 'paused', 'pending_review', 'suspended'], default: 'active', index: true },
  statusReason: String,
  order: { type: Number, default: 0 },

  // Reputación por servicio (lo que ve el usuario: promedio y cantidad).
  rating: {
    avg: { type: Number, default: 0 },
    count: { type: Number, default: 0 },
    sum: { type: Number, default: 0 },
    // Promedio ponderado bayesiano (interno, nunca se muestra)
    weighted: { type: Number, default: 0 },
    distribution: { type: [Number], default: [0, 0, 0, 0, 0] }, // 1★..5★
  },
  stats: {
    views: { type: Number, default: 0 },
    bookings: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
  },

  // Datos desnormalizados del especialista para búsquedas rápidas en una sola colección.
  search: {
    visible: { type: Boolean, default: false, index: true }, // especialista activo + servicio activo
    specialistName: String,
    specialistSlug: String,
    categorySlug: { type: String, index: true },
    department: String,
    city: String,
    neighborhood: String,
    geo: { type: pointSchema, default: undefined },
    serviceRadiusKm: Number,
    verified: Boolean,
    newcomer: Boolean, // "Nuevo en Alternativa"
    publishedAt: Date,
  },
}, { timestamps: true });

serviceSchema.index({ specialist: 1, slug: 1 }, { unique: true });
serviceSchema.index({ 'search.visible': 1, 'search.categorySlug': 1, 'rating.weighted': -1 });
serviceSchema.index({ 'search.visible': 1, 'search.department': 1, 'search.city': 1 });
serviceSchema.index({ 'search.visible': 1, price: 1 });
serviceSchema.index({ 'search.geo': '2dsphere' });
serviceSchema.index(
  { title: 'text', summary: 'text', description: 'text', 'search.specialistName': 'text', 'search.categorySlug': 'text', 'search.neighborhood': 'text', 'search.city': 'text' },
  { default_language: 'spanish', name: 'service_text', weights: { title: 10, 'search.categorySlug': 6, summary: 4, 'search.specialistName': 4, 'search.neighborhood': 3, 'search.city': 3, description: 1 } },
);

module.exports = model('Service', serviceSchema);
