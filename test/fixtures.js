'use strict';
// Datos de ejemplo para renderizar todas las vistas sin base de datos.
const oid = (n) => `64b7f0c2a1b2c3d4e5f6${String(n).padStart(4, '0')}`;
const now = new Date();
const inDays = (d, h = 10) => { const x = new Date(now.getTime() + d * 86400000); x.setUTCHours(h + 3, 0, 0, 0); return x; };

const { DEFAULTS } = require('../src/services/settings');

const user = {
  _id: oid(1), name: 'Ana Pérez', email: 'ana@example.com', role: 'admin', phone: '099 123 456', status: 'active', emailVerified: false,
  specialist: oid(10), createdAt: inDays(-100), avatarUrl: null, location: { department: 'Montevideo', city: 'Pocitos' },
  preferences: { notifications: { email: true, push: true, whatsapp: false, marketing: false }, homeAddress: 'Av. Brasil 1234', lastModality: 'presencial' },
  privacy: { shareContactAfterBooking: true },
  publicName() { return 'Ana P.'; },
  toObject() { return { ...this }; },
};

const ctx = {
  user, csrf: 'tok<en>', flash: [{ type: 'success', message: 'Hecho <b>' }, { type: 'error', message: 'Ups' }],
  path: '/buscar', url: '/buscar?q=masaje', query: { q: 'masaje', volver: oid(50) }, settings: JSON.parse(JSON.stringify(DEFAULTS)),
  appUrl: 'https://alternativa.uy', appEnv: 'development', vapidPublicKey: 'BKEY', unreadNotifications: 3, unreadMessages: { user: 2, specialist: 1 },
  specialist: null,
};

const category = { _id: oid(5), name: 'Masajes', slug: 'masajes', description: 'Relajantes y terapéuticos', longDescription: '## Tipos\n\n- Relajante\n- Descontracturante', icon: 'hands', color: '#3B82F6', status: 'active', serviceCount: 12, order: 1, featured: true, seo: {} };

const specialist = {
  _id: oid(10), user: oid(1), slug: 'laura-martinez', displayName: 'Laura Martínez', headline: 'Masajista terapéutica', bio: 'Trabajo hace 10 años.\n\nAtiendo en Pocitos.',
  experience: 'Spa', education: 'Escuela X', yearsOfExperience: 10, languages: ['Español'], categories: [oid(5)], modalities: ['presencial', 'domicilio', 'online'],
  location: { department: 'Montevideo', city: 'Montevideo', neighborhood: 'Pocitos', address: 'Calle 1', addressPublicHint: 'Cerca de la rambla', serviceRadiusKm: 8, geo: { type: 'Point', coordinates: [-56.15, -34.91] } },
  avatar: oid(60), cover: oid(61), video: oid(62), profileLayout: { variant: 'serena', sectionOrder: ['resenas', 'servicios'], featuredService: oid(20), showVideoFirst: true },
  status: 'active', verification: { identity: { status: 'verified', at: inDays(-5) } }, claim: { status: 'claimed' }, pendingChanges: [{ field: 'displayName', value: 'Laura M.', requestedAt: inDays(-1) }, { field: 'categories', value: [oid(5)], requestedAt: inDays(-1) }],
  settings: { autoConfirm: true, allowReschedule: true }, commissionRate: 4, business: { legalName: 'Laura M', taxId: '123', payoutMethod: 'bank', bankName: 'BROU', accountNumber: '001' },
  mercadopago: { userId: '123', connectedAt: inDays(-3) }, stats: { rating: 4.8, reviewCount: 30, completedBookings: 120 }, plan: 'free', publishedAt: inDays(-30), createdAt: inDays(-40),
  statusReason: '',
};
specialist.toObject = () => ({ ...specialist });

const service = {
  _id: oid(20), specialist: oid(10), category: { _id: oid(5), name: 'Masajes', slug: 'masajes' }, slug: 'masaje-relajante', title: 'Masaje relajante', summary: 'Una hora para soltar.',
  description: 'Descripción larga', includes: ['Aceites', 'Música'], preparation: 'Ropa cómoda', price: 900, durationMinutes: 60, modalities: ['presencial', 'domicilio'], homeServiceExtra: 200,
  photos: [], status: 'active', rating: { avg: 4.9, count: 127, sum: 622, weighted: 4.8, distribution: [1, 1, 5, 20, 100] }, stats: { views: 10, bookings: 5 },
  search: { visible: true, specialistSlug: 'laura-martinez', newcomer: true, verified: true, geo: { coordinates: [-56.15, -34.91] } }, createdAt: inDays(-20), updatedAt: inDays(-1),
};
service.toObject = () => ({ ...service });

const media = (n, kind = 'photo', extra = {}) => ({ _id: oid(60 + n), kind, url: `/uploads/x${n}.jpg`, thumbUrl: `/uploads/t${n}.jpg`, status: 'approved', visibility: 'public', caption: 'Foto', bytes: 20000, specialist: { _id: oid(10), displayName: 'Laura', slug: 'laura-martinez' }, ...extra });

const card = { service, specialist: { ...specialist, avatarUrl: '/uploads/a.jpg' }, displayPrice: 945, newcomer: true, verified: true, distanceKm: 2.3, nextSlot: { date: '2026-10-05', time: '10:00', start: inDays(2) } };

const snapshot = {
  serviceTitle: 'Masaje relajante', serviceSlug: 'masaje-relajante', categoryName: 'Masajes', specialistName: 'Laura Martínez', specialistSlug: 'laura-martinez', userName: 'Ana Pérez',
  price: 900, subtotal: 900, discount: 0, total: 945, currency: 'UYU', feeMode: 'added', commissionRate: 5, commissionRuleName: 'General', commissionAmount: 45, specialistNet: 900,
  processorFeePercent: 6.09, processorFeePaidBy: 'specialist', processorFeeEstimate: 58, specialistReceives: 842, platformNet: 45, marketplaceFee: 45, durationMinutes: 60, collectionModel: 'split',
  cancellationPolicy: DEFAULTS.cancellation,
};
const booking = (extra = {}) => {
  const b = {
    _id: oid(50), code: 'ALT-ABC123', user: oid(1), specialist: oid(10), service: oid(20), snapshot: { ...snapshot }, start: inDays(3), end: inDays(3, 11), modality: 'presencial',
    place: { address: 'Calle 1', notes: 'Timbre 2' }, userNotes: 'Primera vez', specialistNotes: 'Nota', status: 'confirmed',
    history: [{ status: 'pending', at: inDays(-1), byRole: 'user', note: 'Iniciada' }, { status: 'confirmed', at: inDays(-1), byRole: 'system' }],
    payment: oid(70), paymentDeadline: inDays(0, 12), rescheduleCount: 0, incident: { open: true, note: 'Algo pasó' }, cancellation: {}, createdAt: inDays(-1), isFirstWithSpecialist: true,
    ...extra,
  };
  b.toObject = () => ({ ...b });
  return b;
};
const payment = { _id: oid(70), booking: booking(), provider: 'mercadopago', collectionModel: 'split', amount: 945, commissionAmount: 45, specialistAmount: 900, providerFee: 58, providerFeeEstimate: 58, marketplaceFee: 45, status: 'approved', statusDetail: 'accredited', method: 'credit_card', paidAt: inDays(-1), refundedAmount: 0, settlement: { status: 'not_applicable' }, events: [{ type: 'created', at: inDays(-1), data: { a: 1 } }], createdAt: inDays(-1), providerPaymentId: '123', chargeback: {} };
const review = { _id: oid(80), booking: oid(50), service: { _id: oid(20), title: 'Masaje relajante', slug: 'masaje-relajante' }, specialist: { _id: oid(10), displayName: 'Laura', slug: 'laura-martinez' }, user: oid(1), authorName: 'Ana P.', rating: 4, comment: 'Muy bien <script>', status: 'under_review', reply: { text: 'Gracias' }, reviewRequest: { reason: 'fake', details: 'x', at: inDays(-1) }, moderation: { reason: 'x' }, createdAt: inDays(-2), serviceDate: inDays(-3) };

const stats = {
  period: '30d', range: { from: inDays(-30), fromStr: '2026-09-03', toStr: '2026-10-02', days: 30 }, views: 1240, profileViews: 800, serviceViews: 440, availabilityChecks: 83, impressions: 3000, favorites: 9,
  bookings: 31, cancellations: 2, noShows: 1, revenue: 27000, clients: 25, newClients: 18, returningClients: 7, repeatRate: 28, conversion: 2.5,
  servicePerformance: [{ _id: oid(20), title: 'Masaje relajante', status: 'active', views: 100, checks: 20, bookings: 10, revenue: 9000, conversion: 10, rating: service.rating }],
  topService: { title: 'Masaje relajante', bookings: 10 }, hours: Array.from({ length: 24 }, (_, i) => (i === 10 ? 5 : 0)), weekdays: [0, 3, 4, 5, 1, 2, 0], busiestHour: 10,
  reviewTrend: [{ month: '2026-09', count: 4, avg: 4.5 }], series: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, views: i, bookings: i % 3 })),
};
const adminStats = {
  period: '30d', range: { from: inDays(-30) }, users: 100, newUsers: 10, specialists: 30, activeSpecialists: 20, newSpecialists: 3, services: 50, bookings: 70, byStatus: { confirmed: 50, cancelled_user: 3 },
  cancellations: 3, gross: 63000, commission: 3150, processorFees: 3800, refunds: 900, paymentsCount: 70, reviews: 20, reviewsAvg: 4.7, activeUsers: 35, bookingsPerActiveUser: 2,
  pending: { reports: 1, tickets: 2, verifications: 1, specialists: 1, incidents: 1 }, series: stats.series,
};
const availability = {
  weekly: [{ day: 1, ranges: [{ start: '09:00', end: '13:00' }] }], breaks: [{ day: 1, start: '11:00', end: '11:30' }], exceptions: [{ _id: oid(90), date: '2099-12-24', type: 'closed', note: 'Navidad' }, { _id: oid(91), date: '2099-12-31', type: 'custom', ranges: [{ start: '10:00', end: '12:00' }] }],
  timeOff: [{ _id: oid(92), from: '2099-01-01', to: '2099-01-10', reason: 'Vacaciones' }], blocks: [{ _id: oid(93), start: inDays(5), end: inDays(5, 11), reason: 'Médico' }],
  slotStepMinutes: 15, bufferMinutes: 10, minNoticeMinutes: 120, maxAdvanceDays: 60, dailyLimit: 0,
};
const paged = (items) => ({ items, total: items.length, page: 1, pages: 2, limit: 20 });

module.exports = { oid, user, ctx, category, specialist, service, media, card, booking, payment, review, stats, adminStats, availability, paged, inDays, snapshot };
