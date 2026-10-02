'use strict';
// Métricas: eventos agregados por día (StatDaily) + agregaciones sobre reservas, pagos y reseñas.
const mongoose = require('mongoose');
const D = require('../lib/dates');
const logger = require('../lib/logger');

const oid = (id) => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id)));

// Incrementa contadores del día. Evita contar recargas repetidas de la misma sesión.
async function track({ specialist, service = null, field, req, amount = 1 }) {
  try {
    if (!specialist) return;
    if (req?.session) {
      const key = `${field}:${specialist}:${service || ''}`;
      const seen = req.session.seen || (req.session.seen = []);
      if (seen.includes(key)) return;
      seen.push(key);
      if (seen.length > 200) seen.splice(0, seen.length - 200);
    }
    // No contar visitas del propio especialista ni de administradores
    if (req?.user && (req.user.role === 'admin' || String(req.user.specialist) === String(specialist))) return;
    const { StatDaily } = require('../models');
    await StatDaily.updateOne(
      { specialist, service, date: D.todayStr() },
      { $inc: { [field]: amount } },
      { upsert: true },
    );
  } catch (err) {
    logger.warn('track', { err });
  }
}

async function trackImpressions(serviceDocs, field = 'impressions') {
  try {
    if (!serviceDocs.length) return;
    const { StatDaily } = require('../models');
    const date = D.todayStr();
    await StatDaily.bulkWrite(serviceDocs.map((s) => ({
      updateOne: { filter: { specialist: s.specialist?._id || s.specialist, service: null, date }, update: { $inc: { [field]: 1 } }, upsert: true },
    })), { ordered: false });
  } catch (err) {
    logger.warn('trackImpressions', { err });
  }
}

function periodRange(period = '30d', now = new Date()) {
  const days = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 }[period] || 30;
  const today = D.todayStr(D.DEFAULT_TZ, now);
  const fromStr = D.addDays(today, -(days - 1));
  return { days, fromStr, toStr: today, from: D.zonedToUtc(fromStr, '00:00'), to: D.zonedToUtc(D.addDays(today, 1), '00:00') };
}

async function specialistDashboard(specialistId, period = '30d') {
  const { StatDaily, Booking, Review, Service } = require('../models');
  const sid = oid(specialistId);
  const r = periodRange(period);

  const [statsAgg, statsByService, bookings, reviews, services] = await Promise.all([
    StatDaily.aggregate([
      { $match: { specialist: sid, date: { $gte: r.fromStr, $lte: r.toStr } } },
      { $group: { _id: null, profileViews: { $sum: '$profileViews' }, serviceViews: { $sum: '$serviceViews' }, availabilityChecks: { $sum: '$availabilityChecks' }, impressions: { $sum: '$impressions' }, favorites: { $sum: '$favorites' }, messages: { $sum: '$messages' } } },
    ]),
    StatDaily.aggregate([
      { $match: { specialist: sid, service: { $ne: null }, date: { $gte: r.fromStr, $lte: r.toStr } } },
      { $group: { _id: '$service', views: { $sum: '$serviceViews' }, checks: { $sum: '$availabilityChecks' } } },
    ]),
    Booking.find({ specialist: sid, start: { $gte: r.from, $lt: r.to } }).select('user service status start snapshot.total snapshot.specialistNet snapshot.specialistReceives snapshot.serviceTitle isFirstWithSpecialist').lean(),
    Review.find({ specialist: sid, status: { $ne: 'hidden' } }).select('rating createdAt service').sort({ createdAt: 1 }).lean(),
    Service.find({ specialist: sid }).select('title rating stats price durationMinutes status').lean(),
  ]);

  const s = statsAgg[0] || {};
  const effective = bookings.filter((b) => ['paid', 'confirmed', 'completed'].includes(b.status));
  const cancelled = bookings.filter((b) => ['cancelled_user', 'cancelled_specialist', 'refunded'].includes(b.status));
  const noShows = bookings.filter((b) => b.status === 'no_show_user');
  const revenue = effective.reduce((acc, b) => acc + (b.snapshot?.specialistReceives ?? b.snapshot?.specialistNet ?? 0), 0);
  const clients = new Map();
  for (const b of effective) clients.set(String(b.user), (clients.get(String(b.user)) || 0) + 1);
  const newClients = new Set(effective.filter((b) => b.isFirstWithSpecialist).map((b) => String(b.user))).size;
  const returningClients = new Set(effective.filter((b) => !b.isFirstWithSpecialist).map((b) => String(b.user))).size;

  const byService = new Map();
  for (const b of effective) {
    const k = String(b.service);
    const cur = byService.get(k) || { bookings: 0, revenue: 0, title: b.snapshot?.serviceTitle };
    cur.bookings++;
    cur.revenue += b.snapshot?.specialistReceives ?? b.snapshot?.specialistNet ?? 0;
    byService.set(k, cur);
  }
  const viewsByService = new Map(statsByService.map((x) => [String(x._id), x]));
  const servicePerformance = services.map((svc) => {
    const b = byService.get(String(svc._id)) || { bookings: 0, revenue: 0 };
    const v = viewsByService.get(String(svc._id)) || { views: 0, checks: 0 };
    return {
      _id: svc._id, title: svc.title, status: svc.status, views: v.views, checks: v.checks, bookings: b.bookings, revenue: b.revenue,
      conversion: v.views ? Math.round((b.bookings / v.views) * 1000) / 10 : 0, rating: svc.rating,
    };
  }).sort((a, b) => b.bookings - a.bookings || b.views - a.views);

  const hours = Array(24).fill(0);
  const weekdays = Array(7).fill(0);
  for (const b of effective) {
    const p = D.localParts(b.start);
    hours[p.hour]++;
    weekdays[p.weekday]++;
  }

  // Evolución de reseñas por mes (últimos 12 meses)
  const months = new Map();
  for (const rv of reviews) {
    const p = D.localParts(rv.createdAt);
    const k = `${p.year}-${D.pad(p.month)}`;
    const cur = months.get(k) || { count: 0, sum: 0 };
    cur.count++; cur.sum += rv.rating;
    months.set(k, cur);
  }
  const reviewTrend = [...months.entries()].slice(-12).map(([month, v]) => ({ month, count: v.count, avg: Math.round((v.sum / v.count) * 10) / 10 }));

  // Serie diaria de visualizaciones y reservas
  const dailyViews = await StatDaily.aggregate([
    { $match: { specialist: sid, date: { $gte: r.fromStr, $lte: r.toStr } } },
    { $group: { _id: '$date', views: { $sum: { $add: ['$profileViews', '$serviceViews'] } } } },
  ]);
  const viewsMap = new Map(dailyViews.map((d) => [d._id, d.views]));
  const bookingsMap = new Map();
  for (const b of effective) {
    const k = D.localParts(b.start).dateStr;
    bookingsMap.set(k, (bookingsMap.get(k) || 0) + 1);
  }
  const series = [];
  for (let i = 0; i < r.days; i++) {
    const d = D.addDays(r.fromStr, i);
    series.push({ date: d, views: viewsMap.get(d) || 0, bookings: bookingsMap.get(d) || 0 });
  }

  const totalViews = (s.profileViews || 0) + (s.serviceViews || 0);
  return {
    period, range: r,
    views: totalViews,
    profileViews: s.profileViews || 0,
    serviceViews: s.serviceViews || 0,
    availabilityChecks: s.availabilityChecks || 0,
    impressions: s.impressions || 0,
    favorites: s.favorites || 0,
    bookings: effective.length,
    cancellations: cancelled.length,
    noShows: noShows.length,
    revenue,
    clients: clients.size,
    newClients,
    returningClients,
    repeatRate: clients.size ? Math.round((returningClients / clients.size) * 1000) / 10 : 0,
    conversion: totalViews ? Math.round((effective.length / totalViews) * 1000) / 10 : 0,
    servicePerformance,
    topService: servicePerformance[0]?.bookings ? servicePerformance[0] : null,
    hours, weekdays,
    busiestHour: hours.some((h) => h) ? hours.indexOf(Math.max(...hours)) : null,
    reviewTrend,
    series,
  };
}

async function adminDashboard(period = '30d') {
  const { User, Specialist, Service, Booking, Payment, Refund, Review, Report, Ticket, VerificationRequest } = require('../models');
  const r = periodRange(period);
  const [
    users, newUsers, specialists, activeSpecialists, newSpecialists, services, bookingsAgg, paymentsAgg, refundsAgg,
    reviewsAgg, openReports, openTickets, pendingVerifications, pendingSpecialists, incidents,
  ] = await Promise.all([
    User.countDocuments({ role: 'user', status: { $ne: 'deleted' } }),
    User.countDocuments({ createdAt: { $gte: r.from } }),
    Specialist.countDocuments({ deletedAt: null }),
    Specialist.countDocuments({ status: 'active' }),
    Specialist.countDocuments({ createdAt: { $gte: r.from } }),
    Service.countDocuments({ 'search.visible': true }),
    Booking.aggregate([{ $match: { createdAt: { $gte: r.from } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Payment.aggregate([
      { $match: { status: { $in: ['approved', 'partially_refunded', 'refunded', 'offline'] }, createdAt: { $gte: r.from } } },
      { $group: { _id: null, gross: { $sum: '$amount' }, commission: { $sum: '$commissionAmount' }, fees: { $sum: '$providerFee' }, refunded: { $sum: '$refundedAmount' }, n: { $sum: 1 } } },
    ]),
    Refund.aggregate([{ $match: { createdAt: { $gte: r.from } } }, { $group: { _id: '$status', amount: { $sum: '$amount' }, commission: { $sum: '$commissionReversed' }, n: { $sum: 1 } } }]),
    Review.aggregate([{ $match: { createdAt: { $gte: r.from } } }, { $group: { _id: null, n: { $sum: 1 }, avg: { $avg: '$rating' } } }]),
    Report.countDocuments({ status: 'open' }),
    Ticket.countDocuments({ status: { $in: ['open', 'waiting_user'] } }),
    VerificationRequest.countDocuments({ status: 'pending' }),
    Specialist.countDocuments({ status: 'pending_review' }),
    Booking.countDocuments({ 'incident.open': true }),
  ]);
  const byStatus = Object.fromEntries(bookingsAgg.map((x) => [x._id, x.n]));
  const pay = paymentsAgg[0] || { gross: 0, commission: 0, fees: 0, refunded: 0, n: 0 };
  const refundCommission = refundsAgg.reduce((a, x) => a + (x._id === 'processed' ? x.commission : 0), 0);
  const refundsTotal = refundsAgg.reduce((a, x) => a + (x._id === 'processed' ? x.amount : 0), 0);

  // Serie diaria de reservas
  const daily = await Booking.aggregate([
    { $match: { createdAt: { $gte: r.from } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: D.DEFAULT_TZ } }, n: { $sum: 1 } } },
  ]);
  const dailyMap = new Map(daily.map((d) => [d._id, d.n]));
  const series = [];
  for (let i = 0; i < r.days; i++) {
    const d = D.addDays(r.fromStr, i);
    series.push({ date: d, bookings: dailyMap.get(d) || 0 });
  }

  const totalBookings = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const activeUsers = await Booking.distinct('user', { createdAt: { $gte: r.from }, status: { $in: ['paid', 'confirmed', 'completed'] } });

  return {
    period, range: r,
    users, newUsers, specialists, activeSpecialists, newSpecialists, services,
    bookings: totalBookings, byStatus,
    cancellations: (byStatus.cancelled_user || 0) + (byStatus.cancelled_specialist || 0),
    gross: pay.gross, commission: pay.commission - refundCommission, processorFees: pay.fees,
    refunds: refundsTotal, paymentsCount: pay.n,
    reviews: reviewsAgg[0]?.n || 0, reviewsAvg: reviewsAgg[0]?.avg ? Math.round(reviewsAgg[0].avg * 10) / 10 : null,
    activeUsers: activeUsers.length,
    bookingsPerActiveUser: activeUsers.length ? Math.round((totalBookings / activeUsers.length) * 100) / 100 : 0,
    pending: { reports: openReports, tickets: openTickets, verifications: pendingVerifications, specialists: pendingSpecialists, incidents },
    series,
  };
}

module.exports = { track, trackImpressions, specialistDashboard, adminDashboard, periodRange };
