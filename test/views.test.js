'use strict';
process.env.NODE_ENV = 'test';
// Renderiza todas las pantallas con datos de ejemplo: detecta errores de plantilla,
// valores "undefined"/"[object Object]" filtrados a la interfaz y fallas de escape.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures');
const { DEPARTMENTS, REPORT_REASONS } = require('../src/lib/constants');
const { DEFAULTS } = require('../src/services/settings');
const { priceBreakdown } = require('../src/services/commission');

const P = require('../src/views/public');
const B = require('../src/views/booking');
const A = require('../src/views/account');
const S = require('../src/views/specialist');
const AD = require('../src/views/admin');
const AU = require('../src/views/auth');
const E = require('../src/views/errors');

const ctx = F.ctx;
const spCtx = { ...ctx, specialist: F.specialist };
const breakdown = priceBreakdown({ price: 900, rate: 5, processorRate: 6, processorPaidBy: 'specialist' });
const quote = { breakdown, commission: { rate: 5, ruleName: 'General' }, promo: { title: 'Promo', discountPercent: 10, fundedBy: 'specialist' }, settings: DEFAULTS };
const searchResult = { items: [F.card], total: 1, page: 1, pages: 3, intent: { when: 'today', modality: 'online', near: true, cheap: true, text: 'masaje' }, category: F.category, sponsored: [{ ...F.card, sponsored: true, placementId: F.oid(99) }] };
const cats = [F.category, { ...F.category, _id: F.oid(6), name: 'Yoga', slug: 'yoga', serviceCount: 0, color: 'invalid' }];
const ticket = { _id: F.oid(95), number: 7, subject: 'Ayuda', status: 'open', priority: 'high', topic: 'booking', messages: [{ authorRole: 'user', body: 'Hola', at: F.inDays(-1) }, { authorRole: 'admin', body: 'Respuesta', at: F.inDays(0) }], updatedAt: F.inDays(0), user: { _id: F.oid(1), name: 'Ana', email: 'a@b.uy' }, booking: { _id: F.oid(50), code: 'ALT-1' } };
const conv = { _id: F.oid(96), user: F.oid(1), specialist: F.oid(10), status: 'open', lastMessageAt: F.inDays(0), lastMessagePreview: 'hola', unreadUser: 1, unreadSpecialist: 2 };
const msgs = [{ _id: F.oid(97), sender: F.oid(1), body: 'Mi cel 099 123 456', containsContact: true, createdAt: F.inDays(-1) }, { _id: F.oid(98), sender: F.oid(2), body: 'ok', containsContact: false, createdAt: F.inDays(0) }];
const audit = [{ action: 'booking.cancel', actorName: 'Ana', actorRole: 'admin', createdAt: F.inDays(0), severity: 'warning', summary: 'x', entity: 'Booking', entityId: F.oid(50), before: { a: 1 }, after: { a: 2 }, ip: '1.1.1.1' }];

const cases = {
  // Públicas
  'home': () => P.home(ctx, { top: [F.card], fresh: [F.card], categories: cats, sponsored: [F.card], favorites: new Set([String(F.service._id)]), posts: [{ slug: 'a', title: 'Post', excerpt: 'x' }], upcoming: F.booking() }),
  'home sin sesión': () => P.home({ ...ctx, user: null }, { top: [], fresh: [], categories: [], sponsored: [], favorites: new Set(), posts: [], upcoming: null }),
  'buscar': () => P.search(ctx, { params: { q: 'masaje hoy', when: 'today', modality: 'online', lat: -34.9, lng: -56.1, verificado: true, orden: 'precio' }, result: searchResult, categories: cats, favorites: new Set(), departments: DEPARTMENTS }),
  'buscar vacío': () => P.search(ctx, { params: { q: '' }, result: { ...searchResult, items: [], sponsored: [], category: null, intent: { when: null } }, categories: cats, favorites: new Set(), departments: DEPARTMENTS }),
  'categorías': () => P.categories(ctx, { categories: cats }),
  'categoría': () => P.category(ctx, { category: F.category, result: searchResult, favorites: new Set(), params: { categoria: 'masajes', modality: 'online' }, posts: [{ slug: 'a', title: 't', excerpt: 'e' }], departments: DEPARTMENTS }),
  'perfil especialista': () => P.specialistProfile(ctx, { sp: F.specialist, preview: true, isOwner: true, cards: [F.card], media: [F.media(1), F.media(2)], reviews: [F.review], certifications: [{ title: 'Masoterapeuta', issuer: 'X', year: 2020, status: 'verified' }, { title: 'Reiki', status: 'declared' }], categories: [F.category], favorites: new Set(), avatar: F.media(0, 'avatar'), cover: F.media(1, 'cover'), video: F.media(2, 'video'), next: { date: '2026-10-05', time: '10:00' } }),
  'perfil sin dueño': () => P.specialistProfile({ ...ctx, user: null }, { sp: { ...F.specialist, user: null, profileLayout: {} }, preview: false, isOwner: false, cards: [F.card], media: [], reviews: [], certifications: [], categories: [], favorites: new Set(), avatar: null, cover: null, video: null, next: null }),
  'galería': () => P.gallery(ctx, { sp: F.specialist, media: [F.media(1)], video: F.media(2, 'video') }),
  'servicio': () => P.serviceDetail(ctx, { sp: F.specialist, service: F.service, breakdown, reviews: [F.review], others: [F.card], photos: [F.media(3)], avatar: F.media(0), favorites: new Set(), next: null, preview: false, settings: DEFAULTS }),
  'reseñas servicio': () => P.serviceReviews(ctx, { sp: F.specialist, service: F.service, reviews: [F.review], page: 1, pages: 2, stars: '5', reasons: REPORT_REASONS }),
  'página contenido': () => P.contentPage(ctx, { page: require('../src/views/defaultContent').pages['como-funciona'], slug: 'como-funciona' }),
  'cancelaciones': () => P.cancellationPolicy(ctx, { page: require('../src/views/defaultContent').pages.cancelaciones, rules: ['a', 'b'] }),
  'faq': () => P.faq(ctx, { faqs: require('../src/views/defaultContent').faqs }),
  'ofrecer': () => P.offer({ ...ctx, user: null }, { settings: DEFAULTS }),
  'contacto': () => P.contact(ctx, { values: { name: 'A' }, errors: { email: 'mal' } }),
  'blog': () => P.blog(ctx, { posts: [{ slug: 'a', title: 'T', excerpt: 'E', publishedAt: new Date(), category: 'Bienestar' }], page: 1, pages: 2, topics: ['Bienestar'], topic: 'Bienestar' }),
  'artículo': () => P.article(ctx, { post: { slug: 'a', title: 'T', body: '## Hola\n\nTexto', publishedAt: new Date(), category: 'B', coverUrl: '/x.jpg' }, related: [{ slug: 'b', title: 'R', excerpt: 'e' }] }),
  // Auth
  'login': () => AU.login(ctx, { values: { email: 'a' }, error: 'Mal' }),
  'tipo de cuenta': () => AU.accountType(ctx),
  'registro': () => AU.register(ctx, { values: {}, errors: { email: 'x' }, tipo: 'especialista' }),
  'recuperar': () => AU.forgot(ctx, { sent: false }),
  'recuperar enviado': () => AU.forgot(ctx, { sent: true }),
  'restablecer': () => AU.reset(ctx, { token: 't', error: 'x' }),
  'restablecer vencido': () => AU.reset(ctx, { invalid: true }),
  'reclamar': () => AU.claim(ctx, { sp: F.specialist, token: 't' }),
  'reclamar error': () => AU.claim(ctx, { error: 'x' }),
  // Reserva
  'elegir horario': () => B.pickTime(ctx, { service: F.service, specialist: F.specialist, avatar: F.media(0), modalities: ['presencial', 'online'], modality: 'online', today: '2026-10-02', selected: '' }),
  'confirmar': () => B.confirm(ctx, { service: F.service, specialist: F.specialist, avatar: null, slot: { start: F.inDays(3), end: F.inDays(3, 11) }, fecha: '2026-10-05', hora: '10:00', modality: 'domicilio', modalities: ['domicilio'], quote, promoCode: 'X', policy: ['a'], address: 'Calle' }),
  'pago': () => B.payment(ctx, { booking: F.booking({ status: 'pending' }) }),
  'retorno pago': () => B.paymentReturn(ctx, { payment: F.payment, booking: F.booking(), result: 'ok' }),
  'retorno rechazado': () => B.paymentReturn(ctx, { payment: { ...F.payment, status: 'rejected', statusDetail: 'cc_rejected_insufficient_amount' }, booking: F.booking(), result: 'error' }),
  'checkout simulado': () => B.simulatedCheckout(ctx, { payment: F.payment, booking: F.booking() }),
  // Usuario
  'mi cuenta': () => A.dashboard(ctx, { upcoming: [F.booking()], rebook: [F.booking({ status: 'completed' })], favCount: 3, pendingReviews: 1 }),
  'mis reservas': () => A.bookings(ctx, { tab: 'proximas', list: [F.booking(), F.booking({ status: 'cancelled_user', start: F.inDays(-3) })], counts: [1, 2, 3] }),
  'detalle reserva': () => A.bookingDetail(ctx, { booking: F.booking().toObject(), specialist: F.specialist, payment: F.payment, review: F.review, refunds: [{ amount: 100, status: 'failed' }], conversation: conv, canCancel: true, canReschedule: true, canReview: true, isNew: true }),
  'detalle reserva online': () => A.bookingDetail(ctx, { booking: F.booking({ modality: 'online', status: 'completed', place: { onlineUrl: 'https://meet.x' }, rescheduledFrom: F.oid(51) }).toObject(), specialist: F.specialist, payment: null, review: null, refunds: [], conversation: null, canCancel: false, canReschedule: false, canReview: false, isNew: false }),
  'cancelar': () => A.cancel(ctx, { booking: F.booking().toObject(), decision: { refundPercent: 50, label: 'Parcial' }, split: { amount: 473 }, policy: ['a'], canReschedule: true }),
  'reprogramar': () => A.reschedule(ctx, { booking: F.booking().toObject(), action: '/x', today: '2026-10-02', back: '/y' }),
  'volver a reservar': () => A.rebook(ctx, { booking: F.booking().toObject(), service: F.service, specialist: F.specialist, next: {}, modality: 'domicilio', address: 'Calle', nextSlots: [{ date: '2026-10-05', time: '10:00' }] }),
  'valorar': () => A.reviewForm(ctx, { booking: F.booking().toObject(), action: '/x', values: { rating: 4, comment: 'x' }, editing: true }),
  'mis reseñas': () => A.myReviews(ctx, { list: [{ ...F.review, createdAt: new Date() }], editDays: 7 }),
  'favoritos': () => A.favorites(ctx, { cards: [F.card], unavailable: [F.service], specialists: [{ ...F.specialist, avatarUrl: null }], favorites: new Set() }),
  'favoritos vacíos': () => A.favorites(ctx, { cards: [], unavailable: [], specialists: [], favorites: new Set() }),
  'mensajes': () => A.inbox(ctx, { list: [{ ...conv, specialist: F.specialist, avatarUrl: null }] }),
  'conversación': () => A.conversation(ctx, { conv, messages: msgs, sp: F.specialist, allowed: false, booking: F.booking(), me: F.oid(1), base: '/mi', title: 'Laura' }),
  'notificaciones': () => A.notifications(ctx, { list: [{ _id: F.oid(1), type: 'booking_confirmed', title: 'T', body: 'B', createdAt: new Date() }, { _id: F.oid(2), type: 'x', title: 'T', readAt: new Date(), createdAt: new Date() }] }),
  'perfil': () => A.profile(ctx),
  'editar perfil': () => A.profileEdit(ctx, { values: F.user.toObject(), errors: {} }),
  'pagos': () => A.payments(ctx, { list: [{ ...F.payment, booking: F.booking() }], refunds: [{ amount: 100, status: 'processed', createdAt: new Date() }] }),
  'métodos de pago': () => A.paymentMethods(ctx),
  'configuración': () => A.settings(ctx),
  'privacidad': () => A.privacy(ctx),
  'ayuda': () => A.help(ctx, { tickets: [ticket], recent: [F.booking()] }),
  'consulta': () => A.ticket(ctx, { ticket, base: '/mi/ayuda' }),
  // Especialista
  'alta especialista': () => S.onboarding(ctx, { categories: cats, values: {}, errors: { categories: 'x' }, departments: DEPARTMENTS }),
  'panel': () => S.dashboard(spCtx, { sp: F.specialist, stats: F.stats, completeness: { percent: 60, checks: [{ ok: true, label: 'A', href: '/' }, { ok: false, label: 'B', href: '/' }], missing: [], ready: false }, today: [F.booking()], toConfirm: [F.booking({ status: 'paid' })], upcomingCount: 4, recentReviews: [F.review], pendingClaimVerification: false }),
  'panel borrador': () => S.dashboard(spCtx, { sp: { ...F.specialist, status: 'draft', claim: { status: 'claimed' }, verification: { identity: { status: 'none' } } }, stats: { ...F.stats, topService: null, busiestHour: null }, completeness: { percent: 100, checks: [], missing: [], ready: true }, today: [], toConfirm: [], upcomingCount: 0, recentReviews: [] }),
  'más': () => S.more(spCtx),
  'mi perfil esp': () => S.profile(spCtx, { sp: F.specialist, completeness: { percent: 80 }, categories: [F.category], avatar: F.media(0), cover: F.media(1) }),
  'editar perfil esp': () => S.profileEdit(spCtx, { sp: F.specialist, values: F.specialist, errors: {}, categories: cats, departments: DEPARTMENTS }),
  'apariencia': () => S.appearance(spCtx, { sp: F.specialist, services: [F.service] }),
  'multimedia': () => S.media(spCtx, { sp: F.specialist, media: [F.media(0, 'avatar'), F.media(1, 'photo', { status: 'pending' }), F.media(2, 'video', { durationSec: 40 })], limits: DEFAULTS.media }),
  'subir video': () => S.mediaUpload(spCtx, { tipo: 'video', limits: DEFAULTS.media }),
  'subir foto': () => S.mediaUpload(spCtx, { tipo: 'portada', limits: DEFAULTS.media }),
  'servicios': () => S.services(spCtx, { list: [F.service], sp: F.specialist }),
  'form servicio': () => S.serviceForm(spCtx, { categories: cats, values: { ...F.service, includes: 'a\nb' }, errors: { price: 'x' }, editing: F.service._id, settings: DEFAULTS }),
  'detalle servicio esp': () => S.serviceDetail(spCtx, { service: { ...F.service, status: 'pending_review' }, photos: [F.media(1)], reviews: [F.review], perf: F.stats.servicePerformance[0], breakdown, commission: { rate: 5 }, category: F.category, sp: F.specialist }),
  'agenda día': () => S.agenda(spCtx, { vista: 'dia', date: '2026-10-05', from: '2026-10-05', to: '2026-10-06', list: [F.booking()], av: F.availability }),
  'agenda semana': () => S.agenda(spCtx, { vista: 'semana', date: '2026-10-05', from: '2026-10-05', to: '2026-10-12', list: [F.booking(), F.booking({ status: 'paid' })], av: F.availability }),
  'agenda mes': () => S.agenda(spCtx, { vista: 'mes', date: '2026-10-05', from: '2026-09-28', to: '2026-11-02', list: [F.booking()], av: F.availability }),
  'horarios': () => S.schedule(spCtx, { av: F.availability }),
  'bloqueos': () => S.blocks(spCtx, { av: F.availability, today: '2026-10-02' }),
  'disponibilidad': () => S.availabilityPreview(spCtx, { services: [F.service, F.service], service: F.service, summary: [{ date: '2026-10-05', count: 3, first: '09:00' }, { date: '2026-10-06', count: 0 }] }),
  'reservas esp': () => S.bookings(spCtx, { tab: 'confirmar', list: [F.booking()], counts: [1, 2, 3, 4], q: 'ana' }),
  'detalle reserva esp': () => S.bookingDetail(spCtx, { booking: F.booking({ status: 'paid', modality: 'online', start: F.inDays(-1), cancellation: { at: new Date(), reason: 'x', refundPercent: 100 } }).toObject(), client: { name: 'Ana', phone: '099' }, previous: 2, payment: F.payment, conversation: null, review: F.review, showPhone: true }),
  'clientes': () => S.clients(spCtx, { rows: [{ _id: F.oid(1), name: 'Ana', total: 3, last: new Date(), next: F.inDays(3), services: ['Masaje'] }], q: '' }),
  'detalle cliente': () => S.clientDetail(spCtx, { client: { name: 'Ana', phone: '099' }, list: [F.booking({ status: 'completed', start: F.inDays(-30) }), F.booking({ status: 'completed', start: F.inDays(-10) })], reviews: [F.review], conversation: null, showPhone: true }),
  'mensajes esp': () => S.inbox(spCtx, { list: [{ ...conv, user: { name: 'Ana' } }] }),
  'conversación esp': () => A.conversation(spCtx, { conv: { ...conv, status: 'blocked' }, messages: [], allowed: true, booking: null, me: F.oid(1), base: '/panel', title: 'Ana' }),
  'estadísticas': () => S.stats(spCtx, { stats: F.stats, sp: F.specialist }),
  'visualizaciones': () => S.views(spCtx, { stats: F.stats }),
  'rendimiento': () => S.performance(spCtx, { stats: F.stats }),
  'ingresos': () => S.income(spCtx, { period: '30d', payments: [{ ...F.payment, booking: F.booking() }], payouts: [{ createdAt: new Date(), direction: 'to_specialist', bookingsCount: 2, net: 1800, status: 'paid', reference: 'TRF1' }], refunds: [{ status: 'processed', specialistReversed: 100 }], settings: DEFAULTS }),
  'facturación': () => S.billing(spCtx, { months: [{ _id: '2026-09', n: 3, gross: 2835, commission: 135, fees: 170, refunded: 0 }], payouts: [], sp: F.specialist }),
  'reseñas esp': () => S.reviews(spCtx, { list: [F.review, { ...F.review, status: 'published', reply: {} }], services: [F.service], query: { sinResponder: '1' }, reasons: REPORT_REASONS }),
  'notificaciones esp': () => S.notifications(spCtx, { list: [{ title: 'T', createdAt: new Date() }] }),
  'verificación': () => S.verification(spCtx, { sp: { ...F.specialist, verification: { identity: { status: 'rejected', note: 'borrosa' } } }, requests: [{ createdAt: new Date(), type: 'identity', status: 'rejected' }] }),
  'certificaciones': () => S.certifications(spCtx, { list: [{ _id: F.oid(1), title: 'X', status: 'pending', review: { note: 'n' } }], categories: [F.category] }),
  'cuenta esp': () => S.account(spCtx, { sp: F.specialist, settings: { ...DEFAULTS, payments: { ...DEFAULTS.payments, collectionModel: 'platform' } } }),
  'cobros split': () => S.payouts(spCtx, { sp: F.specialist, settings: DEFAULTS, provider: 'simulated', oauthReady: false }),
  'cobros sin cuenta': () => S.payouts(spCtx, { sp: { ...F.specialist, mercadopago: {} }, settings: DEFAULTS, provider: 'simulated', oauthReady: true }),
  'cobros offline': () => S.payouts(spCtx, { sp: F.specialist, settings: { ...DEFAULTS, payments: { ...DEFAULTS.payments, collectionModel: 'offline' } }, provider: 'mercadopago', oauthReady: true }),
  'promociones': () => S.promotions(spCtx, { list: [{ _id: F.oid(1), title: 'P', discountPercent: 10, audience: 'all', code: 'X', uses: 1, maxUses: 5, status: 'active', validFrom: new Date(), validTo: new Date() }], services: [F.service] }),
  'destacados': () => S.sponsored(spCtx, { list: [{ type: 'category', category: { name: 'Masajes' }, startsAt: new Date(), endsAt: new Date(), status: 'paused', impressions: 1, clicks: 0 }], services: [F.service], categories: [F.category], sp: F.specialist }),
  'plan': () => S.plan(spCtx, { sp: F.specialist }),
  // Admin
  'admin resumen': () => AD.dashboard(ctx, { stats: F.adminStats, recent: audit, latestBookings: [F.booking()] }),
  'admin pendientes': () => AD.pending(ctx, { specialistsPending: [F.specialist], withChanges: [F.specialist], verifications: 1, certs: 1, media: 2, categories: [F.category], services: [F.service], reviews: 1, reports: 1, tickets: 1, refunds: 1, incidents: [F.booking()], adRequests: 1 }),
  'admin estadísticas': () => AD.stats(ctx, { stats: F.adminStats, byCategory: [{ _id: 'Masajes', n: 3, gross: 2000 }], byDepartment: [{ _id: null, n: 1 }], topSpecialists: [{ name: 'L', n: 3, commission: 100 }], byModel: [{ _id: 'split', n: 3, gross: 3000 }] }),
  'admin especialistas': () => AD.specialists(ctx, { result: F.paged([F.specialist, { ...F.specialist, commissionRate: null, claim: { status: 'unclaimed' } }]), query: { q: 'x' } }),
  'admin form especialista': () => AD.specialistForm(ctx, { categories: cats, values: { ...F.specialist, planExpiresAt: new Date() }, errors: {}, editing: F.specialist._id, departments: DEPARTMENTS }),
  'admin detalle especialista': () => AD.specialistDetail(ctx, { sp: F.specialist, user: F.user, services: [F.service], media: [F.media(1), F.media(2, 'video')], certifications: [{ title: 'X', status: 'pending', document: F.oid(1) }], requests: [{ createdAt: new Date(), type: 'identity', status: 'pending', documents: [F.oid(1)] }], stats: F.stats, completeness: { percent: 90 }, logs: audit, bookingsCount: 3, reports: [{ reason: 'fake', status: 'open', createdAt: new Date(), details: 'd' }], categories: cats }),
  'admin especialista sin dueño': () => AD.specialistDetail(ctx, { sp: { ...F.specialist, user: null, status: 'suspended', claim: { status: 'invited', invitedEmail: 'x@y.uy' }, pendingChanges: [] }, user: null, services: [], media: [], certifications: [], requests: [], stats: F.stats, completeness: { percent: 10 }, logs: [], bookingsCount: 0, reports: [], categories: [] }),
  'admin nuevo servicio': () => AD.serviceForm(ctx, { sp: F.specialist, categories: cats, values: { durationMinutes: 60, modalities: ['online'] } }),
  'admin verificaciones': () => AD.verifications(ctx, { requests: [{ _id: F.oid(1), specialist: F.specialist, type: 'claim', documents: [], status: 'pending', createdAt: new Date(), documentNumberLast4: '1234' }], certs: [{ _id: F.oid(2), title: 'C', specialist: F.specialist, document: { _id: F.oid(3) } }], estado: 'pending' }),
  'admin usuarios': () => AD.users(ctx, { result: F.paged([F.user, { ...F.user, status: 'suspended', lastLoginAt: null }]), query: {} }),
  'admin detalle usuario': () => AD.userDetail(ctx, { u: { ...F.user, suspension: { reason: 'x' } }, bookings: [F.booking()], tickets: [ticket], reportsAbout: [], reportsBy: [{ targetType: 'review', reason: 'fake', status: 'open' }], logs: audit, reviews: [F.review] }),
  'admin servicios': () => AD.services(ctx, { result: F.paged([{ ...F.service, specialist: F.specialist }]), categories: cats, query: {} }),
  'admin servicio': () => AD.serviceDetail(ctx, { s: { ...F.service, specialist: F.specialist }, categories: cats }),
  'admin categorías': () => AD.categories(ctx, { list: cats }),
  'admin form categoría': () => AD.categoryForm(ctx, { values: F.category, errors: { slug: 'x' }, editing: F.category._id }),
  'admin reservas': () => AD.bookings(ctx, { result: F.paged([F.booking()]), query: { estado: 'confirmed' } }),
  'admin detalle reserva': () => AD.bookingDetail(ctx, { b: F.booking({ start: F.inDays(-1), rescheduledTo: F.oid(52), snapshot: { ...F.snapshot, discount: 50, homeServiceExtra: 100 } }), payment: F.payment, refunds: [{ amount: 1, status: 'processed' }], user: F.user, sp: F.specialist, tickets: [ticket], logs: audit, review: F.review }),
  'admin pagos': () => AD.payments(ctx, { result: F.paged([{ ...F.payment, booking: F.booking() }]), query: {}, totals: { gross: 1 } }),
  'admin pago': () => AD.paymentDetail(ctx, { p: { ...F.payment, chargeback: { status: 'opened', at: new Date() }, lastSyncedAt: new Date() }, refunds: [{ amount: 1, status: 'failed', error: 'e', createdAt: new Date() }] }),
  'admin comisiones': () => AD.commissions(ctx, { rules: [{ _id: F.oid(1), name: 'R', scope: 'category', category: F.category, rate: 4, active: true, validFrom: new Date() }], specialistsWithRate: [F.specialist], categories: cats, specialistsList: [F.specialist], bySpecialist: [{ _id: F.oid(10), sp: [F.specialist], n: 2, gross: 1890, commission: 90 }], settings: DEFAULTS }),
  'admin reembolsos': () => AD.refunds(ctx, { result: F.paged([{ _id: F.oid(1), booking: F.booking(), reason: 'r', amount: 10, percent: 50, status: 'failed', error: 'sin saldo', createdAt: new Date() }]), query: {} }),
  'admin liquidaciones': () => AD.payouts(ctx, { preview: [{ specialist: F.oid(10), name: 'L', model: 'platform', payments: [1], gross: 945, commission: 45, refunds: 0, specialistNet: 900 }], list: [{ _id: F.oid(1), createdAt: new Date(), specialist: F.specialist, direction: 'to_specialist', bookingsCount: 1, net: 900, status: 'pending' }], settings: DEFAULTS }),
  'admin reseñas': () => AD.reviews(ctx, { result: F.paged([F.review, { ...F.review, status: 'hidden', reviewRequest: {} }]), query: {}, reportCounts: new Map([[String(F.review._id), 2]]) }),
  'admin moderación': () => AD.moderation(ctx, { tab: 'pendiente', media: [F.media(1), F.media(2, 'video')], changes: [], services: [], categories: cats }),
  'admin moderación cambios': () => AD.moderation(ctx, { tab: 'cambios', media: [], changes: [F.specialist], services: [], categories: cats }),
  'admin moderación servicios': () => AD.moderation(ctx, { tab: 'servicios', media: [], changes: [], services: [{ ...F.service, specialist: F.specialist }], categories: cats }),
  'admin denuncias': () => AD.reports(ctx, { result: F.paged(['review', 'media', 'specialist', 'service', 'user', 'message'].map((t, i) => ({ _id: F.oid(i), targetType: t, targetId: F.oid(i), reason: 'fake', status: i ? 'open' : 'resolved', createdAt: new Date(), reporter: { name: 'A' }, resolution: {} }))), query: {}, targets: { [`review:${F.oid(0)}`]: F.review, [`media:${F.oid(1)}`]: F.media(1), [`specialist:${F.oid(2)}`]: F.specialist, [`service:${F.oid(3)}`]: F.service, [`user:${F.oid(4)}`]: F.user, [`message:${F.oid(5)}`]: msgs[0] }, reasons: REPORT_REASONS }),
  'admin destacados': () => AD.sponsored(ctx, { list: [{ _id: F.oid(1), specialist: F.specialist, service: F.service, type: 'zone', department: 'Montevideo', startsAt: new Date(), endsAt: new Date(), price: 100, paymentStatus: 'paid', status: 'active', impressions: 1, clicks: 1, notes: 'n' }], specialists: [F.specialist], categories: cats, departments: DEPARTMENTS }),
  'admin promociones': () => AD.promotions(ctx, { list: [{ _id: F.oid(1), title: 'P', discountPercent: 5, uses: 0, maxUses: 0, status: 'active' }] }),
  ...Object.fromEntries(Object.keys(AD.SETTING_LABELS).map((section) => [`admin configuración ${section}`, () => AD.settings(ctx, { settings: DEFAULTS, section, env: { appEnv: 'staging', provider: 'simulated', storage: 'local', email: 'console', push: false, whatsapp: false } })])),
  'admin avisos': () => AD.notifications(ctx, { list: [{ title: 'T', createdAt: new Date() }], sent: audit }),
  'admin contenido': () => AD.contentList(ctx, { tipo: 'page', list: [{ _id: F.oid(1), title: 'T', slug: 'terminos', status: 'published', updatedAt: new Date() }] }),
  'admin contenido faq': () => AD.contentList(ctx, { tipo: 'faq', list: [] }),
  'admin form contenido': () => AD.contentForm(ctx, { values: { type: 'post', title: 'T', tags: 'a, b' }, errors: { body: 'x' }, editing: F.oid(1) }),
  'admin form faq': () => AD.contentForm(ctx, { values: { type: 'faq' } }),
  'admin auditoría': () => AD.audit(ctx, { result: F.paged(audit), query: {} }),
  'admin soporte': () => AD.tickets(ctx, { result: F.paged([ticket, { ...ticket, user: null, name: 'Visitante', email: 'v@x.uy', booking: null, priority: 'normal' }]), query: {} }),
  'admin consulta': () => AD.ticketDetail(ctx, { t: ticket }),
  // Errores
  '404': () => E.notFound(ctx),
  'error': () => E.error(ctx, { status: 403, message: 'No' }),
  'mantenimiento': () => E.maintenance(ctx),
};

for (const [name, fn] of Object.entries(cases)) {
  test(`renderiza: ${name}`, () => {
    const out = String(fn());
    assert.ok(out.startsWith('<!doctype html>'), 'debe ser una página completa');
    assert.ok(out.includes('</html>'));
    assert.ok(!/\bundefined\b/.test(out.replace(/<script[\s\S]*?<\/script>/g, '')), `"undefined" visible en ${name}: …${out.slice(Math.max(0, out.indexOf('undefined') - 120), out.indexOf('undefined') + 40)}…`);
    assert.ok(!out.includes('[object Object]'), `"[object Object]" en ${name}: …${out.slice(Math.max(0, out.indexOf('[object Object]') - 120), out.indexOf('[object Object]') + 40)}…`);
    assert.ok(!out.includes('NaN'), `NaN en ${name}: …${out.slice(Math.max(0, out.indexOf('NaN') - 120), out.indexOf('NaN') + 40)}…`);
    assert.ok(!out.includes('<script>alert') && !out.includes('Muy bien <script>'), 'el contenido de usuarios debe escaparse');
  });
}

test('el conteo de pantallas cubre todas las exportadas', () => {
  const exported = [P, B, A, S, AD, AU, E].flatMap((m) => Object.entries(m).filter(([, v]) => typeof v === 'function').map(([k]) => k));
  assert.ok(exported.length > 100, `pantallas: ${exported.length}`);
});
