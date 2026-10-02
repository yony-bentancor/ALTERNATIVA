'use strict';
const { Schema, model } = require('mongoose');

const pointSchema = new Schema({
  type: { type: String, enum: ['Point'], default: 'Point' },
  coordinates: { type: [Number] }, // [lng, lat]
}, { _id: false });

const specialistSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
  slug: { type: String, required: true, lowercase: true, trim: true },
  displayName: { type: String, required: true, trim: true, maxlength: 120 },
  headline: { type: String, trim: true, maxlength: 160 },
  bio: { type: String, maxlength: 4000 },
  experience: { type: String, maxlength: 3000 },
  yearsOfExperience: { type: Number, min: 0, max: 80 },
  education: { type: String, maxlength: 3000 },
  languages: [String],
  contactPhone: { type: String, select: false }, // privado: solo admin y cliente con reserva según política
  categories: [{ type: Schema.Types.ObjectId, ref: 'Category', index: true }],
  modalities: [{ type: String, enum: ['presencial', 'domicilio', 'online'] }],
  location: {
    department: { type: String, index: true },
    city: String,
    neighborhood: String,
    address: { type: String, select: false }, // se muestra solo a quien reservó presencial
    addressPublicHint: String, // "Pocitos, cerca de Rambla y 26 de Marzo"
    geo: { type: pointSchema, default: undefined },
    serviceRadiusKm: { type: Number, min: 0, max: 200 },
  },
  avatar: { type: Schema.Types.ObjectId, ref: 'Media' },
  cover: { type: Schema.Types.ObjectId, ref: 'Media' },
  video: { type: Schema.Types.ObjectId, ref: 'Media' },
  // Personalización acotada de la ficha (la identidad visual es de Alternativa)
  profileLayout: {
    variant: { type: String, enum: ['clasica', 'serena', 'luminosa'], default: 'clasica' },
    sectionOrder: { type: [String], default: ['servicios', 'sobre', 'galeria', 'video', 'resenas', 'ubicacion'] },
    featuredService: { type: Schema.Types.ObjectId, ref: 'Service' },
    showVideoFirst: { type: Boolean, default: false },
  },
  status: { type: String, enum: ['draft', 'pending_review', 'active', 'suspended', 'inactive'], default: 'draft', index: true },
  statusReason: String,
  verification: {
    identity: {
      status: { type: String, enum: ['none', 'pending', 'verified', 'rejected'], default: 'none' },
      at: Date,
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      note: String,
    },
  },
  // Reclamación de perfiles creados por administración
  claim: {
    status: { type: String, enum: ['self', 'unclaimed', 'invited', 'claimed'], default: 'self' },
    tokenHash: { type: String, select: false },
    invitedEmail: String,
    invitedAt: Date,
    expiresAt: Date,
    claimedAt: Date,
  },
  // Cambios sensibles a la espera de moderación (nombre, categorías, etc.)
  pendingChanges: [{
    field: String,
    value: Schema.Types.Mixed,
    requestedAt: { type: Date, default: Date.now },
  }],
  settings: {
    autoConfirm: { type: Boolean, default: true },
    allowReschedule: { type: Boolean, default: true },
  },
  // Comisión particular (null = usa reglas generales)
  commissionRate: { type: Number, min: 0, max: 100, default: null },
  // Información comercial y de liquidación (privada)
  business: {
    legalName: String,
    taxId: String, // RUT o CI para facturación
    invoiceType: { type: String, enum: ['', 'monotributo', 'literal_e', 'empresa', 'otro'], default: '' },
    payoutMethod: { type: String, enum: ['', 'bank', 'mercadopago'], default: '' },
    bankName: String,
    accountHolder: String,
    accountNumber: String,
    accountType: String,
    payoutEmail: String,
  },
  // Conexión de Mercado Pago (modelo mixto/split). Tokens cifrados.
  mercadopago: {
    userId: String,
    accessTokenEnc: { type: String, select: false },
    refreshTokenEnc: { type: String, select: false },
    publicKey: String,
    expiresAt: Date,
    connectedAt: Date,
  },
  stats: {
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    completedBookings: { type: Number, default: 0 },
    repeatClients: { type: Number, default: 0 },
    responseMinutes: Number,
  },
  plan: { type: String, enum: ['free', 'profesional'], default: 'free' },
  planExpiresAt: Date,
  publishedAt: Date,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  deletedAt: Date,
}, { timestamps: true });

specialistSchema.index({ slug: 1 }, { unique: true });
specialistSchema.index({ 'location.geo': '2dsphere' });
specialistSchema.index({ status: 1, publishedAt: -1 });
specialistSchema.index({ displayName: 'text', headline: 'text', bio: 'text' }, { default_language: 'spanish', weights: { displayName: 5, headline: 3, bio: 1 } });

specialistSchema.virtual('isVerified').get(function isVerified() {
  return this.verification?.identity?.status === 'verified';
});

module.exports = model('Specialist', specialistSchema);
