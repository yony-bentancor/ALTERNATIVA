'use strict';
const { Schema, model } = require('mongoose');

const settingSchema = new Schema({
  key: { type: String, required: true },
  value: Schema.Types.Mixed,
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

settingSchema.index({ key: 1 }, { unique: true });

module.exports = model('Setting', settingSchema);
