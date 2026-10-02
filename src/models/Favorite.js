'use strict';
const { Schema, model } = require('mongoose');

const favoriteSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: ['specialist', 'service'], required: true },
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist' },
  service: { type: Schema.Types.ObjectId, ref: 'Service' },
}, { timestamps: true });

favoriteSchema.index({ user: 1, kind: 1, specialist: 1, service: 1 }, { unique: true });
favoriteSchema.index({ user: 1, createdAt: -1 });

module.exports = model('Favorite', favoriteSchema);
