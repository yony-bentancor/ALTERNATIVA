'use strict';
// Notificaciones multicanal: in-app (siempre), email, push (Web Push) y WhatsApp.
// Cada aviso queda registrado con el resultado de cada canal.
const config = require('../config');
const logger = require('../lib/logger');
const { sendEmail, layout } = require('./email');
const { sendWebPush } = require('../lib/webpush');
const { sendWhatsapp, enabled: whatsappEnabled } = require('./whatsapp');

// Tipos que siempre se envían por email aunque el usuario haya desactivado avisos opcionales.
const TRANSACTIONAL = new Set(['booking_confirmed', 'booking_new', 'booking_cancelled', 'booking_rescheduled', 'payment_confirmed', 'refund_processed', 'account', 'payout_paid']);
// Tipos que justifican WhatsApp si el usuario lo habilitó
const WHATSAPP_TYPES = new Set(['booking_confirmed', 'booking_new', 'booking_reminder', 'booking_cancelled', 'booking_rescheduled']);

async function notify(userOrId, { type, title, body = '', link = '', data, dedupeKey, emailHtml, emailSubject, ctaLabel, channels = {} }) {
  const { User, Notification } = require('../models');
  const user = userOrId && userOrId._id && userOrId.preferences ? userOrId : await User.findById(userOrId).lean();
  if (!user || user.status !== 'active') return null;

  let notification;
  try {
    notification = await Notification.create({ user: user._id, type, title, body, link, data, dedupeKey });
  } catch (err) {
    if (err && err.code === 11000) return null; // ya notificado (dedupe)
    throw err;
  }

  const prefs = user.preferences?.notifications || {};
  const results = {};
  const url = link ? `${config.appUrl}${link}` : config.appUrl;

  // Email
  const wantsEmail = channels.email !== false && (TRANSACTIONAL.has(type) || prefs.email !== false);
  if (wantsEmail && user.email) {
    try {
      await sendEmail({
        to: user.email,
        subject: emailSubject || `${title} · Alternativa`,
        html: emailHtml || layout({ title, intro: body, ctaLabel: ctaLabel || 'Ver en Alternativa', ctaUrl: url }),
      });
      results.email = { status: 'sent', at: new Date() };
    } catch (err) {
      logger.warn('Fallo email', { type, err });
      results.email = { status: 'failed', at: new Date(), error: String(err.message).slice(0, 200) };
    }
  }

  // Push
  const subs = user.pushSubscriptions || [];
  if (channels.push !== false && prefs.push !== false && subs.length && config.push.publicKey && config.push.privateKey) {
    const gone = [];
    let sent = 0;
    for (const sub of subs) {
      try {
        const r = await sendWebPush(sub, { title, body, url: link || '/' }, config.push);
        if (r.ok) sent++;
        if (r.gone) gone.push(sub.endpoint);
      } catch (err) {
        logger.warn('Fallo push', { err });
      }
    }
    if (gone.length) await User.updateOne({ _id: user._id }, { $pull: { pushSubscriptions: { endpoint: { $in: gone } } } });
    results.push = { status: sent ? 'sent' : 'failed', at: new Date() };
  }

  // WhatsApp
  if (channels.whatsapp !== false && prefs.whatsapp && WHATSAPP_TYPES.has(type) && whatsappEnabled() && user.phone) {
    try {
      const r = await sendWhatsapp({ phone: user.phone, title, body });
      results.whatsapp = { status: r.ok ? 'sent' : `skipped:${r.skipped}`, at: new Date() };
    } catch (err) {
      results.whatsapp = { status: 'failed', at: new Date(), error: String(err.message).slice(0, 200) };
    }
  }

  if (Object.keys(results).length) {
    const set = {};
    for (const [k, v] of Object.entries(results)) set[`channels.${k}`] = v;
    await Notification.updateOne({ _id: notification._id }, { $set: set });
  }
  return notification;
}

// Avisos al equipo de administración: solo cuando algo requiere intervención humana.
async function notifyAdmins({ title, body, link = '/admin', type = 'admin_alert', dedupeKey }) {
  const { User } = require('../models');
  const { getSettings } = require('./settings');
  const admins = await User.find({ role: 'admin', status: 'active' }).lean();
  for (const admin of admins) {
    await notify(admin, { type, title, body, link, dedupeKey: dedupeKey ? `${dedupeKey}:${admin._id}` : undefined }).catch((err) => logger.error('notifyAdmins', { err }));
  }
  const settings = await getSettings();
  const extra = settings.notifications.adminAlertEmail;
  if (extra) {
    await sendEmail({ to: extra, subject: `[Alternativa] ${title}`, html: layout({ title, intro: body, ctaLabel: 'Abrir panel', ctaUrl: `${config.appUrl}${link}` }) })
      .catch((err) => logger.error('adminAlertEmail', { err }));
  }
}

async function unreadCount(userId) {
  const { Notification } = require('../models');
  return Notification.countDocuments({ user: userId, readAt: null });
}

module.exports = { notify, notifyAdmins, unreadCount, TRANSACTIONAL };
