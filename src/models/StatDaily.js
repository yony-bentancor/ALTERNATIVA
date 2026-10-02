'use strict';
const { Schema, model } = require('mongoose');

// Estadísticas agregadas por día (escala a miles de especialistas sin guardar cada evento).
// Se incrementan con $inc + upsert. date = "YYYY-MM-DD" en hora local.
const statDailySchema = new Schema({
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist', required: true },
  service: { type: Schema.Types.ObjectId, ref: 'Service', default: null },
  date: { type: String, required: true },
  profileViews: { type: Number, default: 0 },
  serviceViews: { type: Number, default: 0 },
  availabilityChecks: { type: Number, default: 0 },
  impressions: { type: Number, default: 0 },
  sponsoredImpressions: { type: Number, default: 0 },
  favorites: { type: Number, default: 0 },
  messages: { type: Number, default: 0 },
}, { versionKey: false });

statDailySchema.index({ specialist: 1, service: 1, date: 1 }, { unique: true });
statDailySchema.index({ date: 1 });

module.exports = model('StatDaily', statDailySchema);
