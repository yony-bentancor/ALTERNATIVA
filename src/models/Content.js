'use strict';
const { Schema, model } = require('mongoose');

// Contenido editable: artículos del blog, preguntas frecuentes y páginas institucionales/legales.
const contentSchema = new Schema({
  type: { type: String, enum: ['post', 'faq', 'page'], required: true, index: true },
  slug: { type: String, lowercase: true, trim: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  excerpt: { type: String, maxlength: 400 },
  body: { type: String, maxlength: 60000 }, // markdown simple
  coverUrl: String,
  category: String, // categoría del blog o sección del FAQ
  audience: { type: String, enum: ['all', 'users', 'specialists'], default: 'all' },
  tags: [String],
  status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
  publishedAt: Date,
  order: { type: Number, default: 0 },
  seo: { title: String, description: String },
  author: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

contentSchema.index({ type: 1, slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: 'string' } } });
contentSchema.index({ type: 1, status: 1, publishedAt: -1 });

module.exports = model('Content', contentSchema);
