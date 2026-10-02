'use strict';
// Reseñas verificadas por servicio. El especialista no puede borrarlas: puede responder,
// reportarlas o pedir revisión. Solo administración modera (y queda auditado).
const { badRequest, forbidden, notFound } = require('../lib/errors');
const { getSettings } = require('./settings');
const { notify, notifyAdmins } = require('./notifications');
const { recomputeServiceRating, recomputeSpecialistStats, syncSearchForSpecialist } = require('./specialists');

async function reviewEligibility(booking, user) {
  const settings = await getSettings();
  if (!booking || String(booking.user) !== String(user._id)) return { ok: false, reason: 'Solo quien realizó la sesión puede valorarla.' };
  if (booking.status !== 'completed') return { ok: false, reason: 'Podés valorar el servicio una vez realizada la sesión.' };
  if (booking.reviewed) return { ok: false, reason: 'Ya valoraste esta sesión.' };
  const limit = new Date((booking.completedAt || booking.end).getTime() + settings.reviews.reviewWindowDays * 86400000);
  if (new Date() > limit) return { ok: false, reason: 'Venció el plazo para valorar esta sesión.' };
  return { ok: true };
}

async function refreshReputation(review) {
  await recomputeServiceRating(review.service);
  await recomputeSpecialistStats(review.specialist);
  await syncSearchForSpecialist(review.specialist);
}

async function createReview({ booking, user, rating, comment }) {
  const { Review, Booking, Specialist, User } = require('../models');
  const elig = await reviewEligibility(booking, user);
  if (!elig.ok) throw badRequest(elig.reason);
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) throw badRequest('Elegí de 1 a 5 estrellas.');
  const author = await User.findById(user._id);
  const review = await Review.create({
    booking: booking._id, service: booking.service, specialist: booking.specialist, user: user._id,
    authorName: author.publicName(), rating: r, comment: String(comment || '').trim().slice(0, 2000) || undefined,
    serviceDate: booking.start,
  });
  await Booking.updateOne({ _id: booking._id }, { $set: { reviewed: true } });
  await refreshReputation(review);
  const sp = await Specialist.findById(booking.specialist).select('user').lean();
  if (sp?.user) {
    await notify(sp.user, {
      type: 'review_new', title: `Nueva reseña: ${'★'.repeat(r)}`,
      body: `${review.authorName} valoró ${booking.snapshot.serviceTitle}.${review.comment ? ` “${review.comment.slice(0, 120)}”` : ''}`,
      link: '/panel/resenas',
    });
  }
  return review;
}

async function editReview(review, user, { rating, comment }) {
  const settings = await getSettings();
  if (String(review.user) !== String(user._id)) throw forbidden();
  const limit = new Date(review.createdAt.getTime() + settings.reviews.editWindowDays * 86400000);
  if (new Date() > limit) throw badRequest(`Las reseñas se pueden editar durante ${settings.reviews.editWindowDays} días.`);
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) throw badRequest('Elegí de 1 a 5 estrellas.');
  review.rating = r;
  review.comment = String(comment || '').trim().slice(0, 2000) || undefined;
  review.editedAt = new Date();
  await review.save();
  await refreshReputation(review);
  return review;
}

async function replyToReview(review, specialist, text) {
  const t = String(text || '').trim();
  if (t.length < 2) throw badRequest('Escribí una respuesta.');
  review.reply = { text: t.slice(0, 1500), at: new Date() };
  await review.save();
  await notify(review.user, {
    type: 'review_reply', title: 'Respondieron tu reseña',
    body: `${specialist.displayName} respondió a tu reseña.`,
    link: `/especialistas/${specialist.slug}#resenas`,
  });
  return review;
}

// Pedido de revisión: la reseña sigue visible mientras administración la analiza.
async function requestRevision(review, specialistUser, { reason, details }) {
  const { Report } = require('../models');
  if (review.status === 'hidden') throw badRequest('La reseña ya fue moderada.');
  review.status = 'under_review';
  review.reviewRequest = { reason, details: String(details || '').slice(0, 2000), at: new Date() };
  await review.save();
  await Report.create({ reporter: specialistUser._id, reporterRole: 'specialist', targetType: 'review', targetId: review._id, reason, details });
  await notifyAdmins({ title: 'Pedido de revisión de reseña', body: `Motivo: ${reason}`, link: '/admin/resenas?estado=under_review', dedupeKey: `review-rev:${review._id}` });
  return review;
}

async function reportReview(review, user, { reason, details }) {
  const { Report } = require('../models');
  const exists = await Report.findOne({ targetType: 'review', targetId: review._id, reporter: user._id, status: 'open' });
  if (exists) return exists;
  return Report.create({ reporter: user._id, reporterRole: user.role, targetType: 'review', targetId: review._id, reason, details });
}

async function moderateReview(reviewId, { action, reason, admin }) {
  const { Review, Report } = require('../models');
  const review = await Review.findById(reviewId);
  if (!review) throw notFound();
  const before = review.status;
  if (action === 'hide') review.status = 'hidden';
  else if (action === 'publish') review.status = 'published';
  else throw badRequest('Acción no válida.');
  review.moderation = { by: admin._id, at: new Date(), reason };
  if (review.reviewRequest?.at && !review.reviewRequest.resolvedAt) {
    review.reviewRequest.resolvedAt = new Date();
    review.reviewRequest.resolution = action === 'hide' ? 'Reseña ocultada' : 'Reseña mantenida';
  }
  await review.save();
  await Report.updateMany({ targetType: 'review', targetId: review._id, status: 'open' }, { $set: { status: 'resolved', resolution: { by: admin._id, at: new Date(), action, note: reason } } });
  await refreshReputation(review);
  return { review, before };
}

module.exports = { reviewEligibility, createReview, editReview, replyToReview, requestRevision, reportReview, moderateReview };
