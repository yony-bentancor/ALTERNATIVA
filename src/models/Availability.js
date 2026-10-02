'use strict';
const { Schema, model } = require('mongoose');

const rangeSchema = new Schema({
  start: { type: String, required: true }, // "09:00" hora local
  end: { type: String, required: true },
}, { _id: false });

// Agenda del especialista. Los horarios disponibles se calculan a partir de esto
// menos las reservas activas (ver services/availability.js).
const availabilitySchema = new Schema({
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist', required: true },
  timezone: { type: String, default: 'America/Montevideo' },
  weekly: {
    type: [{ day: { type: Number, min: 0, max: 6 }, ranges: [rangeSchema] }],
    default: () => [1, 2, 3, 4, 5].map((day) => ({ day, ranges: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }] })),
  },
  // Descansos fijos (p.ej. almuerzo) que se restan de los rangos semanales
  breaks: [{ day: { type: Number, min: 0, max: 6 }, start: String, end: String, _id: false }],
  // Excepciones por fecha: día cerrado u horario especial
  exceptions: [{
    date: { type: String, required: true }, // "2026-12-24"
    type: { type: String, enum: ['closed', 'custom'], default: 'closed' },
    ranges: [rangeSchema],
    note: String,
  }],
  // Vacaciones / días no disponibles (rango de fechas inclusivo)
  timeOff: [{ from: String, to: String, reason: String }],
  // Bloqueos puntuales de horario (instantes UTC)
  blocks: [{ start: Date, end: Date, reason: String }],
  slotStepMinutes: { type: Number, default: 15, min: 5, max: 120 },
  bufferMinutes: { type: Number, default: 0, min: 0, max: 120 }, // tiempo entre sesiones
  minNoticeMinutes: { type: Number, default: 120, min: 0, max: 10080 },
  maxAdvanceDays: { type: Number, default: 60, min: 1, max: 365 },
  dailyLimit: { type: Number, default: 0, min: 0 }, // 0 = sin límite de reservas por día
}, { timestamps: true });

availabilitySchema.index({ specialist: 1 }, { unique: true });

module.exports = model('Availability', availabilitySchema);
