'use strict';
// Datos de referencia del dominio (Uruguay) y etiquetas de interfaz.

const DEPARTMENTS = [
  'Artigas', 'Canelones', 'Cerro Largo', 'Colonia', 'Durazno', 'Flores', 'Florida', 'Lavalleja',
  'Maldonado', 'Montevideo', 'Paysandú', 'Río Negro', 'Rivera', 'Rocha', 'Salto', 'San José',
  'Soriano', 'Tacuarembó', 'Treinta y Tres',
];

const MODALITIES = {
  presencial: { label: 'Presencial', short: 'En consultorio', icon: 'pin' },
  domicilio: { label: 'A domicilio', short: 'A domicilio', icon: 'home' },
  online: { label: 'Online', short: 'Online', icon: 'video' },
};

const BOOKING_STATUS = {
  pending: { label: 'Pendiente de pago', tone: 'warn' },
  paid: { label: 'Pagada', tone: 'info' },
  confirmed: { label: 'Confirmada', tone: 'ok' },
  completed: { label: 'Realizada', tone: 'done' },
  cancelled_user: { label: 'Cancelada por el usuario', tone: 'muted' },
  cancelled_specialist: { label: 'Cancelada por el especialista', tone: 'muted' },
  rescheduled: { label: 'Reprogramada', tone: 'muted' },
  no_show_user: { label: 'Ausencia del usuario', tone: 'danger' },
  no_show_specialist: { label: 'Ausencia del especialista', tone: 'danger' },
  refunded: { label: 'Reembolsada', tone: 'muted' },
  expired: { label: 'Vencida sin pago', tone: 'muted' },
};

// Estados que ocupan agenda (bloquean el horario)
const ACTIVE_BOOKING_STATUSES = ['pending', 'paid', 'confirmed'];
const UPCOMING_STATUSES = ['pending', 'paid', 'confirmed'];
const PAST_STATUSES = ['completed', 'no_show_user', 'no_show_specialist'];
const CANCELLED_STATUSES = ['cancelled_user', 'cancelled_specialist', 'refunded', 'expired', 'rescheduled'];

const PAYMENT_STATUS = {
  pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado', cancelled: 'Cancelado',
  refunded: 'Reembolsado', partially_refunded: 'Reembolso parcial', offline: 'A cobrar por el especialista',
  charged_back: 'Contracargo', in_mediation: 'En disputa',
};

const COLLECTION_MODELS = {
  split: { label: 'Split automático: pago único, la pasarela divide especialista / Alternativa (recomendado)', short: 'Split automático' },
  platform: { label: 'Alternativa cobra y liquida al especialista (requiere transferencias)', short: 'Alternativa cobra' },
  offline: { label: 'El especialista cobra por fuera y Alternativa factura su comisión', short: 'Cobra el especialista' },
};

const SPECIALIST_STATUS = {
  draft: 'Borrador', pending_review: 'En revisión', active: 'Activo', suspended: 'Suspendido', inactive: 'Desactivado',
};
const SERVICE_STATUS = {
  active: 'Publicado', paused: 'Pausado', pending_review: 'En revisión', suspended: 'Suspendido',
};

const NOTIFICATION_TYPES = {
  booking_confirmed: 'Reserva confirmada',
  booking_new: 'Nueva reserva',
  booking_reminder: 'Próxima reserva',
  booking_rescheduled: 'Cambio de horario',
  booking_cancelled: 'Cancelación',
  payment_confirmed: 'Pago confirmado',
  refund_processed: 'Reembolso',
  review_new: 'Nueva reseña',
  review_request: 'Valorá tu sesión',
  review_reply: 'Respuesta a tu reseña',
  message_new: 'Nuevo mensaje',
  admin_request: 'Solicitud administrativa',
  admin_alert: 'Requiere intervención',
  rebook_reminder: 'Volver a reservar',
  verification_update: 'Verificación',
  moderation_update: 'Moderación',
  payout_paid: 'Liquidación pagada',
  account: 'Cuenta',
};

const REPORT_REASONS = {
  fake: 'Contenido falso o engañoso',
  offensive: 'Ofensivo o inapropiado',
  spam: 'Spam o publicidad',
  personal_data: 'Expone datos personales',
  fraud: 'Fraude o abuso',
  conflict: 'Conflicto de interés',
  other: 'Otro motivo',
};

const RESERVED_SLUGS = new Set([
  'buscar', 'categorias', 'especialistas', 'servicios', 'blog', 'ayuda', 'preguntas-frecuentes', 'contacto',
  'como-funciona', 'sobre-alternativa', 'terminos', 'privacidad', 'cancelaciones', 'login', 'registro',
  'salir', 'cuenta', 'mi', 'panel', 'admin', 'api', 'webhooks', 'static', 'uploads', 'sitemap.xml',
  'robots.txt', 'reclamar', 'recuperar', 'restablecer', 'verificar', 'pago', 'reservar', 'manifest.webmanifest', 'sw.js', 'favicon.ico', 'healthz',
]);

module.exports = {
  DEPARTMENTS, MODALITIES, BOOKING_STATUS, ACTIVE_BOOKING_STATUSES, UPCOMING_STATUSES, PAST_STATUSES, CANCELLED_STATUSES,
  PAYMENT_STATUS, COLLECTION_MODELS, SPECIALIST_STATUS, SERVICE_STATUS, NOTIFICATION_TYPES, REPORT_REASONS, RESERVED_SLUGS,
};
