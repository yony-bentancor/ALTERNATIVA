'use strict';
const { Schema, model } = require('mongoose');

// Contador atómico para numeraciones legibles (tickets, etc.).
const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });
const Counter = model('Counter', counterSchema);

Counter.next = async function next(name) {
  const doc = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return doc.seq;
};

module.exports = Counter;
