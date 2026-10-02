'use strict';
const { Schema, model } = require('mongoose');

const categorySchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  slug: { type: String, required: true, lowercase: true, trim: true },
  description: { type: String, maxlength: 1000 },
  longDescription: { type: String, maxlength: 6000 }, // texto SEO de la página de categoría
  icon: { type: String, default: 'leaf' },
  color: { type: String, default: '#8B5CF6' },
  parent: { type: Schema.Types.ObjectId, ref: 'Category' },
  // Las categorías propuestas por especialistas quedan "pending" hasta aprobación
  status: { type: String, enum: ['active', 'pending', 'hidden'], default: 'active', index: true },
  proposedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  order: { type: Number, default: 0 },
  featured: { type: Boolean, default: false },
  seo: { title: String, description: String },
  serviceCount: { type: Number, default: 0 },
}, { timestamps: true });

categorySchema.index({ slug: 1 }, { unique: true });
categorySchema.index({ status: 1, order: 1 });

module.exports = model('Category', categorySchema);
