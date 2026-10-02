'use strict';
// Mensajería usuario ↔ especialista, siempre entre cuentas reales.
// Política de datos de contacto configurable (settings.messaging.contactPolicy).
const { badRequest, forbidden } = require('../lib/errors');
const { detectContact, maskContact } = require('../lib/contact');
const { getSettings } = require('./settings');
const { notify } = require('./notifications');

async function getOrCreateConversation(userId, specialist) {
  const { Conversation } = require('../models');
  if (specialist.user && String(specialist.user) === String(userId)) throw badRequest('No podés escribirte a vos mismo.');
  return Conversation.findOneAndUpdate(
    { user: userId, specialist: specialist._id },
    { $setOnInsert: { specialistUser: specialist.user, lastMessageAt: new Date() } },
    { upsert: true, new: true },
  );
}

async function hasBookingBetween(userId, specialistId) {
  const { Booking } = require('../models');
  return !!(await Booking.exists({ user: userId, specialist: specialistId, status: { $in: ['paid', 'confirmed', 'completed'] } }));
}

async function contactAllowed(conversation) {
  const settings = await getSettings();
  const policy = settings.messaging.contactPolicy;
  if (policy === 'always') return true;
  if (policy === 'never') return false;
  return hasBookingBetween(conversation.user, conversation.specialist);
}

function participantRole(conversation, user) {
  if (String(conversation.user) === String(user._id)) return 'user';
  if (conversation.specialistUser && String(conversation.specialistUser) === String(user._id)) return 'specialist';
  if (user.role === 'admin') return 'admin';
  return null;
}

async function sendMessage({ conversation, sender, body }) {
  const { Message, Conversation, Specialist, StatDaily } = require('../models');
  const role = participantRole(conversation, sender);
  if (!role || role === 'admin') throw forbidden();
  if (conversation.status === 'blocked') throw badRequest('Esta conversación está bloqueada.');
  const text = String(body || '').trim();
  if (!text) throw badRequest('Escribí un mensaje.');
  if (text.length > 2000) throw badRequest('El mensaje es demasiado largo (máximo 2000 caracteres).');

  // Antispam básico: máximo 20 mensajes por minuto por remitente.
  const recent = await Message.countDocuments({ sender: sender._id, createdAt: { $gt: new Date(Date.now() - 60000) } });
  if (recent >= 20) throw badRequest('Estás enviando mensajes muy rápido. Esperá un momento.');

  const containsContact = detectContact(text).length > 0;
  const msg = await Message.create({ conversation: conversation._id, sender: sender._id, senderRole: role, body: text, containsContact, booking: conversation.booking });

  const allowed = await contactAllowed(conversation);
  const preview = (containsContact && !allowed ? maskContact(text) : text).slice(0, 120);
  const inc = role === 'user' ? { unreadSpecialist: 1 } : { unreadUser: 1 };
  const before = await Conversation.findOneAndUpdate(
    { _id: conversation._id },
    { $set: { lastMessageAt: new Date(), lastMessagePreview: preview }, $inc: inc },
  ).lean();

  // Notifica solo el primer mensaje no leído (evita una notificación por cada mensaje).
  const recipient = role === 'user' ? conversation.specialistUser : conversation.user;
  const wasUnread = role === 'user' ? before.unreadSpecialist : before.unreadUser;
  if (recipient && !wasUnread) {
    const sp = await Specialist.findById(conversation.specialist).select('displayName').lean();
    const from = role === 'user' ? sender.name.split(' ')[0] : sp?.displayName;
    await notify(recipient, {
      type: 'message_new', title: `Nuevo mensaje de ${from}`, body: preview,
      link: role === 'user' ? `/panel/mensajes/${conversation._id}` : `/mi/mensajes/${conversation._id}`,
      channels: { whatsapp: false },
    });
  }
  if (role === 'user') {
    const { todayStr } = require('../lib/dates');
    await StatDaily.updateOne({ specialist: conversation.specialist, service: null, date: todayStr() }, { $inc: { messages: 1 } }, { upsert: true }).catch(() => {});
  }
  return { msg, maskedForOthers: containsContact && !allowed };
}

async function markRead(conversation, role) {
  const { Conversation, Message } = require('../models');
  const field = role === 'user' ? 'unreadUser' : 'unreadSpecialist';
  await Conversation.updateOne({ _id: conversation._id }, { $set: { [field]: 0 } });
  const otherRole = role === 'user' ? 'specialist' : 'user';
  await Message.updateMany({ conversation: conversation._id, senderRole: otherRole, readAt: null }, { $set: { readAt: new Date() } });
}

// Texto a mostrar según política: el propio autor siempre ve su mensaje completo.
function displayBody(message, viewerId, allowed) {
  if (allowed || !message.containsContact || String(message.sender) === String(viewerId)) return message.body;
  return maskContact(message.body);
}

async function unreadMessages(user) {
  const { Conversation } = require('../models');
  const [asUser, asSpecialist] = await Promise.all([
    Conversation.aggregate([{ $match: { user: user._id } }, { $group: { _id: null, n: { $sum: '$unreadUser' } } }]),
    user.specialist ? Conversation.aggregate([{ $match: { specialistUser: user._id } }, { $group: { _id: null, n: { $sum: '$unreadSpecialist' } } }]) : [],
  ]);
  return { user: asUser[0]?.n || 0, specialist: asSpecialist[0]?.n || 0 };
}

module.exports = { getOrCreateConversation, hasBookingBetween, contactAllowed, participantRole, sendMessage, markRead, displayBody, unreadMessages };
