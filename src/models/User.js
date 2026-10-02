'use strict';
const { Schema, model } = require('mongoose');

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 200 },
  passwordHash: { type: String, select: false },
  role: { type: String, enum: ['user', 'specialist', 'admin'], default: 'user', index: true },
  phone: { type: String, trim: true, maxlength: 40 },
  avatarUrl: String,
  status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active', index: true },
  suspension: { reason: String, at: Date, by: { type: Schema.Types.ObjectId, ref: 'User' } },
  emailVerified: { type: Boolean, default: false },
  emailVerifyTokenHash: { type: String, select: false },
  emailVerifyExpires: { type: Date, select: false },
  resetTokenHash: { type: String, select: false },
  resetExpires: { type: Date, select: false },
  specialist: { type: Schema.Types.ObjectId, ref: 'Specialist' },
  location: {
    department: String,
    city: String,
    neighborhood: String,
  },
  preferences: {
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: false },
      marketing: { type: Boolean, default: false },
    },
    // Preferencias que "volver a reservar" puede reutilizar (modalidad, dirección a domicilio)
    lastModality: String,
    homeAddress: String,
  },
  privacy: {
    showFirstNameOnly: { type: Boolean, default: true },
    shareContactAfterBooking: { type: Boolean, default: true },
  },
  pushSubscriptions: [{
    endpoint: String,
    keys: { p256dh: String, auth: String },
    createdAt: { type: Date, default: Date.now },
    userAgent: String,
  }],
  // Método de pago guardado: solo referencia de la pasarela (nunca datos de tarjeta)
  paymentMethods: [{
    provider: String,
    customerId: String,
    label: String,
    brand: String,
    last4: String,
    isDefault: Boolean,
    createdAt: { type: Date, default: Date.now },
  }],
  failedLogins: { type: Number, default: 0, select: false },
  lockedUntil: { type: Date, select: false },
  lastLoginAt: Date,
  acceptedTermsAt: Date,
  deletedAt: Date,
}, { timestamps: true });

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ name: 'text', email: 'text' });
userSchema.index({ createdAt: -1 });

userSchema.virtual('firstName').get(function firstName() {
  return (this.name || '').split(' ')[0];
});

// Nombre visible para otros: "Ana M." por privacidad
userSchema.methods.publicName = function publicName() {
  const parts = (this.name || '').trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || 'Usuario';
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
};

module.exports = model('User', userSchema);
