'use strict';
const { Schema, model } = require('mongoose');

// Reglas de comisión configurables sin tocar código.
// Precedencia (de mayor a menor): promoción vigente → especialista → categoría → global (settings).
const commissionRuleSchema = new Schema({
  name: { type: String, required: true, trim: true },
  scope: { type: String, enum: ['promotion', 'specialist', 'category'], required: true },
  rate: { type: Number, required: true, min: 0, max: 100 },
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist' },
  category: { type: Schema.Types.ObjectId, ref: 'Category' },
  // Una promoción puede aplicar a todos o a especialistas/categorías específicos
  appliesToSpecialists: [{ type: Schema.Types.ObjectId, ref: 'Specialist' }],
  appliesToCategories: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
  validFrom: Date,
  validTo: Date,
  active: { type: Boolean, default: true, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

commissionRuleSchema.index({ scope: 1, active: 1 });

module.exports = model('CommissionRule', commissionRuleSchema);
