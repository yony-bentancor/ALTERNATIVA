'use strict';
const { html, attr, classes } = require('../lib/html');
const { fmtMoney } = require('../lib/money');
const D = require('../lib/dates');
const { MODALITIES, PAYMENT_STATUS, BOOKING_STATUS, DEPARTMENTS } = require('../lib/constants');
const { layout } = require('./layout');
const { icon } = require('./icons');
const C = require('./components');
const { datebox } = require('./public');

const page = (ctx, o) => layout(ctx, { noindex: true, ...o });

function bookingRow(b, href) {
  const past = b.start < new Date() || ['cancelled_user', 'cancelled_specialist', 'refunded', 'expired', 'rescheduled'].includes(b.status);
  return html`<a class="booking-card" href="${href}">
    ${datebox(b.start, past)}
    <div class="list-row__main">
      <p class="list-row__title">${b.snapshot.serviceTitle}</p>
      <p class="list-row__sub">${b.snapshot.specialistName} · ${D.fmtTime(b.start)} h · ${MODALITIES[b.modality]?.label}</p>
      <div style="margin-top:6px">${C.statusPill(b.status)}</div>
    </div>
    ${icon('chevronRight')}
  </a>`;
}

function dashboard(ctx, d) {
  const u = ctx.user;
  const body = html`
    ${C.pageHead({ title: `Hola, ${u.name.split(' ')[0]}`, actions: html`<a class="btn btn--ghost btn--sm" href="/mi/perfil">${icon('user', { size: 16 })}Mi perfil</a>` })}
    ${!u.emailVerified ? html`<div class="flash flash--warn">${icon('mail', { size: 18 })}<span>Confirmá tu email para recibir avisos de tus reservas.</span><form method="post" action="/verificar/reenviar">${C.csrfField(ctx)}<button class="btn btn--sm btn--ghost">Reenviar</button></form></div>` : ''}
    <section class="section">
      <div class="section__head"><h2>Próximas sesiones</h2><a href="/mi/reservas">Ver todas</a></div>
      ${d.upcoming.length ? html`<div class="stack">${d.upcoming.map((b) => bookingRow(b, `/mi/reservas/${b._id}`))}</div>` : C.empty({ title: 'No tenés sesiones próximas', text: 'Encontrá especialistas y reservá en minutos.', action: 'Buscar servicios', href: '/buscar', iconName: 'calendar' })}
    </section>
    ${d.pendingReviews ? html`<a class="panel panel--lav row" href="/mi/reservas?tab=historial" style="text-decoration:none;color:inherit">${icon('star', { size: 22 })}<span style="flex:1"><strong>Tenés ${d.pendingReviews} ${d.pendingReviews === 1 ? 'sesión' : 'sesiones'} para valorar</strong><br><span class="small muted">Tu reseña verificada ayuda a otras personas a elegir.</span></span>${icon('chevronRight')}</a>` : ''}
    ${d.rebook.length ? html`<section class="section"><div class="section__head"><h2>Volver a reservar</h2></div>
      <div class="stack">${d.rebook.map((b) => html`<a class="booking-card" href="/mi/reservas/${b._id}/volver"><span class="datebox datebox--muted" style="display:flex;align-items:center;justify-content:center">${icon('repeat', { size: 22 })}</span><div class="list-row__main"><p class="list-row__title">${b.snapshot.serviceTitle}</p><p class="list-row__sub">${b.snapshot.specialistName} · última vez ${D.fmtDateShort(b.start)}</p></div>${icon('chevronRight')}</a>`)}</div></section>` : ''}
    <section class="section grid-2">
      <a class="panel list-row" href="/mi/favoritos">${icon('heart', { size: 22 })}<div class="list-row__main"><p class="list-row__title">Favoritos</p><p class="list-row__sub">${d.favCount} guardados</p></div>${icon('chevronRight')}</a>
      <a class="panel list-row" href="/mi/mensajes">${icon('chat', { size: 22 })}<div class="list-row__main"><p class="list-row__title">Mensajes</p><p class="list-row__sub">${ctx.unreadMessages.user ? `${ctx.unreadMessages.user} sin leer` : 'Conversaciones con especialistas'}</p></div>${icon('chevronRight')}</a>
      <a class="panel list-row" href="/mi/pagos">${icon('receipt', { size: 22 })}<div class="list-row__main"><p class="list-row__title">Pagos y reembolsos</p></div>${icon('chevronRight')}</a>
      <a class="panel list-row" href="/mi/resenas">${icon('star', { size: 22 })}<div class="list-row__main"><p class="list-row__title">Mis reseñas</p></div>${icon('chevronRight')}</a>
      <a class="panel list-row" href="/mi/configuracion">${icon('settings', { size: 22 })}<div class="list-row__main"><p class="list-row__title">Configuración</p><p class="list-row__sub">Notificaciones y contraseña</p></div>${icon('chevronRight')}</a>
      <a class="panel list-row" href="/mi/ayuda">${icon('help', { size: 22 })}<div class="list-row__main"><p class="list-row__title">Ayuda</p><p class="list-row__sub">Consultas y soporte</p></div>${icon('chevronRight')}</a>
    </section>
    ${u.specialist ? '' : html`<p class="muted small">¿Ofrecés servicios? <a href="/ofrecer">Creá tu ficha de especialista</a>.</p>`}
    <form method="post" action="/salir" class="mobile-only" style="margin-top:20px">${C.csrfField(ctx)}<button class="btn btn--ghost btn--block">${icon('logout', { size: 18 })}Salir</button></form>`;
  return page(ctx, { title: 'Mi cuenta', active: 'perfil', body });
}

function bookings(ctx, { tab, list, counts }) {
  const body = html`${C.pageHead({ title: 'Mis reservas' })}
    ${C.tabs([['proximas', '/mi/reservas', 'Próximas', counts[0]], ['historial', '/mi/reservas?tab=historial', 'Historial', counts[1]], ['canceladas', '/mi/reservas?tab=canceladas', 'Canceladas', counts[2]]], tab)}
    ${list.length ? html`<div class="stack">${list.map((b) => bookingRow(b, `/mi/reservas/${b._id}`))}</div>`
    : C.empty({ title: tab === 'proximas' ? 'No tenés reservas próximas' : tab === 'historial' ? 'Todavía no tenés sesiones realizadas' : 'No tenés reservas canceladas', action: tab === 'proximas' ? 'Buscar servicios' : null, href: '/buscar', iconName: 'calendar' })}`;
  return page(ctx, { title: 'Mis reservas', active: 'reservas', body });
}

function moneyRows(b, ctx) {
  const s = b.snapshot;
  return html`<div class="summary">
    ${s.feeMode === 'added' && ctx.settings.commission.priceDisplay === 'breakdown' ? html`
      <div class="summary__row"><span>Servicio</span><span>${fmtMoney(s.subtotal ?? s.price)}</span></div>
      ${s.discount ? html`<div class="summary__row"><span>${s.promotionTitle || 'Descuento'}</span><span>−${fmtMoney(s.discount)}</span></div>` : ''}
      <div class="summary__row"><span>${ctx.settings.commission.feeLabel}</span><span>${fmtMoney(s.total - (s.subtotal ?? s.price) + (s.discount || 0) - (s.processorFeePaidBy === 'customer' ? s.processorFeeEstimate || 0 : 0))}</span></div>
      ${s.processorFeePaidBy === 'customer' && s.processorFeeEstimate ? html`<div class="summary__row"><span>Costo de procesamiento</span><span>${fmtMoney(s.processorFeeEstimate)}</span></div>` : ''}`
    : s.discount ? html`<div class="summary__row"><span>${s.promotionTitle || 'Descuento'}</span><span>−${fmtMoney(s.discount)}</span></div>` : ''}
    <div class="summary__row summary__row--total"><span>Total</span><span>${fmtMoney(s.total)}</span></div>
  </div>`;
}

function bookingDetail(ctx, d) {
  const b = d.booking;
  const sp = d.specialist;
  const upcoming = ['pending', 'paid', 'confirmed'].includes(b.status) && new Date(b.start) > new Date();
  const place = b.modality === 'online'
    ? (b.place?.onlineUrl ? html`<a href="${b.place.onlineUrl}" target="_blank" rel="noopener">Entrar a la sesión online</a>` : 'Online · el especialista te enviará el enlace por mensaje')
    : b.modality === 'domicilio' ? html`A domicilio · ${b.place?.address || ''}`
      : ['paid', 'confirmed', 'completed'].includes(b.status) && b.place?.address ? html`${b.place.address}${b.place.notes ? html`<br><span class="small muted">${b.place.notes}</span>` : ''}` : b.place?.notes || 'En consultorio · la dirección se muestra al confirmar';
  const body = html`
    ${C.pageHead({ title: b.snapshot.serviceTitle, subtitle: html`Reserva ${b.code}`, back: '/mi/reservas' })}
    ${d.isNew ? html`<div class="result-hero" style="padding-top:0"><div class="result-hero__icon result-hero__icon--ok">${icon('check', { size: 34 })}</div><h2>${b.status === 'confirmed' ? '¡Reserva confirmada!' : 'Recibimos tu pago'}</h2><p class="muted">${b.status === 'confirmed' ? 'Te mandamos los detalles por email. Te vamos a recordar la sesión.' : `${b.snapshot.specialistName} va a confirmar la reserva a la brevedad.`}</p></div>` : ''}
    ${b.incident?.open ? html`<div class="flash flash--warn">${icon('alert', { size: 18 })}<span>Estamos revisando un problema reportado en esta reserva.</span></div>` : ''}
    <div class="layout-aside">
      <div class="stack">
        <div class="panel stack">
          <div class="row row--between">${C.statusPill(b.status)}<span class="muted small">${b.snapshot.categoryName || ''}</span></div>
          <p class="row" style="gap:10px;margin:0">${icon('calendar')}<strong>${D.fmtDate(b.start)}</strong></p>
          <p class="row" style="gap:10px;margin:0">${icon('clock')}${D.fmtTime(b.start)} a ${D.fmtTime(b.end)} h (${C.duration(b.snapshot.durationMinutes)})</p>
          <p class="row" style="gap:10px;margin:0;align-items:flex-start">${icon(MODALITIES[b.modality].icon)}<span>${place}</span></p>
          ${sp ? html`<a class="list-row" href="/especialistas/${sp.slug}">${icon('user')}<span class="list-row__main">${sp.displayName}</span>${icon('chevronRight', { size: 16 })}</a>` : ''}
          ${b.userNotes ? html`<p class="notice" style="margin:0"><strong>Tu nota:</strong> ${b.userNotes}</p>` : ''}
        </div>
        ${b.status === 'pending' ? html`<div class="panel panel--warn stack"><p style="margin:0"><strong>Falta completar el pago.</strong> El horario está reservado por unos minutos.</p><a class="btn btn--primary" href="/pago/${b._id}">Pagar ahora</a></div>` : ''}
        <div class="btnbar" style="margin-top:0">
          ${upcoming && b.status !== 'pending' ? html`<a class="btn btn--ghost" href="/mi/reservas/${b._id}/calendario.ics">${icon('calendar', { size: 16 })}Agregar al calendario</a>` : ''}
          ${sp?.user ? html`<a class="btn btn--ghost" href="${d.conversation ? `/mi/mensajes/${d.conversation._id}` : `/mi/mensajes/nuevo/${sp._id}`}">${icon('chat', { size: 16 })}Escribir</a>` : ''}
          ${d.canReschedule ? html`<a class="btn btn--ghost" href="/mi/reservas/${b._id}/reprogramar">${icon('repeat', { size: 16 })}Reprogramar</a>` : ''}
          ${d.canCancel ? html`<a class="btn btn--danger" href="/mi/reservas/${b._id}/cancelar">Cancelar</a>` : ''}
          ${d.canReview ? html`<a class="btn btn--lav" href="/mi/reservas/${b._id}/valorar">${icon('star', { size: 16 })}Valorar sesión</a>` : ''}
          ${['completed', 'no_show_specialist', 'cancelled_specialist', 'cancelled_user'].includes(b.status) ? html`<a class="btn btn--primary" href="/mi/reservas/${b._id}/volver">${icon('repeat', { size: 16 })}Volver a reservar</a>` : ''}
        </div>
        ${d.review ? html`<div class="panel"><h3>Tu reseña</h3>${C.stars(d.review.rating)}${d.review.comment ? html`<p style="margin:8px 0 0">${d.review.comment}</p>` : ''}${d.review.reply?.text ? html`<div class="review__reply"><strong>Respuesta</strong><br>${d.review.reply.text}</div>` : ''}<p class="small" style="margin-top:8px"><a href="/mi/resenas/${d.review._id}/editar">Editar reseña</a></p></div>` : ''}
        ${b.rescheduledTo ? html`<p class="notice">Esta reserva se reprogramó. <a href="/mi/reservas/${b.rescheduledTo}">Ver la reserva nueva</a>.</p>` : ''}
        ${b.rescheduledFrom ? html`<p class="notice">Reprogramada desde otra reserva. <a href="/mi/reservas/${b.rescheduledFrom}">Ver la original</a>.</p>` : ''}
        <details class="panel"><summary style="cursor:pointer;font-weight:600">Historial de la reserva</summary>
          <ul class="timeline" style="margin-top:12px">${b.history.map((h) => html`<li><strong>${BOOKING_STATUS[h.status]?.label || h.status}</strong> · <span class="muted">${D.fmtDateTime(h.at)}</span>${h.note ? html`<br><span class="small muted">${h.note}</span>` : ''}</li>`)}</ul>
        </details>
        ${['paid', 'confirmed', 'completed'].includes(b.status) && !b.incident?.open ? html`<details class="panel"><summary style="cursor:pointer;font-weight:600">Reportar un problema</summary>
          <form method="post" action="/mi/reservas/${b._id}/problema" style="margin-top:12px">${C.csrfField(ctx)}
            ${C.field({ label: '¿Qué pasó?', name: 'note', type: 'textarea', rows: 4, required: true, hint: 'Lo revisa el equipo de Alternativa. Mientras tanto la reserva no se cierra.' })}
            <button class="btn btn--ghost">Enviar reporte</button></form></details>` : ''}
      </div>
      <aside class="stack">
        <div class="panel">${moneyRows(b, ctx)}
          ${d.payment ? html`<p class="small muted" style="margin:10px 0 0">Pago: ${PAYMENT_STATUS[d.payment.status] || d.payment.status}${d.payment.paidAt ? ` · ${D.fmtDateShort(d.payment.paidAt)}` : ''}</p>` : ''}
          ${d.refunds.map((r) => html`<p class="small" style="margin:6px 0 0">${icon('repeat', { size: 14 })} Reembolso ${fmtMoney(r.amount)} · ${r.status === 'processed' ? 'procesado' : r.status === 'failed' ? 'en revisión' : r.status === 'manual' ? 'lo gestiona el especialista' : 'pendiente'}</p>`)}
        </div>
        <p class="small muted">¿Dudas? <a href="/mi/ayuda">Escribinos</a> · <a href="/cancelaciones">Política de cancelaciones</a></p>
      </aside>
    </div>`;
  return page(ctx, { title: `Reserva ${b.code}`, active: 'reservas', body });
}

function cancel(ctx, { booking: b, decision, split, policy, canReschedule }) {
  const body = html`${C.pageHead({ title: 'Cancelar reserva', back: `/mi/reservas/${b._id}` })}
    <div class="form stack">
      <div class="panel"><p style="margin:0"><strong>${b.snapshot.serviceTitle}</strong><br><span class="muted">${b.snapshot.specialistName} · ${D.fmtDateTime(b.start)}</span></p></div>
      ${b.status === 'pending' ? html`<p>Esta reserva todavía no está pagada: al cancelarla liberamos el horario y no se cobra nada.</p>` : html`
        <div class="panel ${split.amount ? 'panel--blue' : 'panel--warn'}"><p style="margin:0"><strong>${split.amount ? `Te devolvemos ${fmtMoney(split.amount)} (${decision.refundPercent}%)` : 'Esta cancelación no tiene reembolso'}</strong><br><span class="small">${decision.label}.</span></p></div>
        ${canReschedule ? html`<p class="notice">¿Preferís cambiar el horario? <a href="/mi/reservas/${b._id}/reprogramar">Reprogramar sin costo</a>.</p>` : ''}
        <details><summary class="small muted" style="cursor:pointer">Ver la política completa</summary><ul class="small">${policy.map((p) => html`<li>${p}</li>`)}</ul></details>`}
      <form method="post" action="/mi/reservas/${b._id}/cancelar" data-confirm="¿Confirmás la cancelación?">${C.csrfField(ctx)}
        ${C.field({ label: 'Motivo', name: 'reason', type: 'textarea', rows: 3, hint: 'Ayuda al especialista a organizarse.' })}
        <div class="form-actions"><button class="btn btn--danger">Cancelar reserva</button><a class="btn btn--ghost" href="/mi/reservas/${b._id}">Volver</a></div>
      </form>
    </div>`;
  return page(ctx, { title: 'Cancelar reserva', active: 'reservas', body });
}

// Reprogramación (compartido con el panel del especialista)
function reschedule(ctx, { booking: b, action, today, back, area = 'public' }) {
  const body = html`${C.pageHead({ title: 'Elegí el nuevo horario', subtitle: `${b.snapshot.serviceTitle} · hoy: ${D.fmtDateTime(b.start)}`, back })}
    <div data-booking data-mode="reschedule" data-service="${b.service}" data-today="${today}" data-exclude="${b._id}">
      <div class="grid-2" style="align-items:start;gap:24px">
        <div class="panel cal" data-cal><p class="slots-empty">Cargando agenda…</p></div>
        <div><h2 data-day-title style="font-size:1.05rem">Horarios</h2><div data-slots></div></div>
      </div>
      <form method="post" action="${action}" style="margin-top:20px">${C.csrfField(ctx)}
        <input type="hidden" name="fecha"><input type="hidden" name="hora">
        <button class="btn btn--primary btn--lg" type="submit" data-reschedule-submit disabled>Elegí un horario</button>
      </form>
    </div>`;
  return layout(ctx, { title: 'Reprogramar', body, noindex: true, area, active: 'reservas' });
}

function rebook(ctx, d) {
  const { service, specialist, booking: b } = d;
  const mod = MODALITIES[d.modality] ? d.modality : '';
  const confirmUrl = (slot) => `/reservar/${service._id}/confirmar?fecha=${slot.date}&hora=${encodeURIComponent(slot.time)}${mod ? `&modalidad=${mod}` : ''}&volver=${b._id}`;
  const body = html`${C.pageHead({ title: 'Volver a reservar', subtitle: `${service.title} con ${specialist.displayName}`, back: `/mi/reservas/${b._id}` })}
    <div class="panel stack">
      <p style="margin:0">${icon(MODALITIES[d.modality]?.icon || 'pin', { size: 16 })} ${MODALITIES[d.modality]?.label || ''}${d.address ? ` · ${d.address}` : ''}</p>
      ${d.nextSlots.length ? html`<p style="margin:0"><strong>Próximos horarios libres</strong></p>
        <div class="slots">${d.nextSlots.map((s) => html`<a class="slot" href="${confirmUrl(s)}" style="flex-direction:column;line-height:1.2;min-height:56px"><span class="small muted">${D.fmtDateStr(s.date).split(' ').slice(0, 2).join(' ')}</span>${s.time}</a>`)}</div>`
    : html`<p class="muted">No hay horarios libres en los próximos días.</p>`}
      <a class="btn btn--ghost" href="/reservar/${service._id}?modalidad=${mod}&volver=${b._id}">Ver más días</a>
    </div>`;
  return page(ctx, { title: 'Volver a reservar', active: 'reservas', body });
}

function reviewForm(ctx, { booking: b, action, values = {}, editing }) {
  const body = html`${C.pageHead({ title: editing ? 'Editar reseña' : '¿Cómo te fue?', subtitle: `${b.snapshot.serviceTitle} con ${b.snapshot.specialistName}`, back: editing ? '/mi/resenas' : `/mi/reservas/${b._id}` })}
    <form method="post" action="${action}" class="form">${C.csrfField(ctx)}
      <fieldset class="field"><legend>Tu valoración de este servicio</legend>
        <div class="checkgrid">${[5, 4, 3, 2, 1].map((n) => html`<label class="check check--pill"><input type="radio" name="rating" value="${n}" required${attr('checked', Number(values.rating) === n)}><span>${'★'.repeat(n)} ${n}</span></label>`)}</div>
      </fieldset>
      ${C.field({ label: 'Contá tu experiencia', name: 'comment', type: 'textarea', rows: 5, value: values.comment, maxlength: 2000, hint: 'Se publica con tu nombre y la inicial del apellido. Sé respetuoso/a y concreto/a.' })}
      <button class="btn btn--primary btn--lg">${editing ? 'Guardar cambios' : 'Publicar reseña'}</button>
    </form>`;
  return page(ctx, { title: 'Valorar sesión', active: 'reservas', body });
}

function myReviews(ctx, { list, editDays }) {
  const body = html`${C.pageHead({ title: 'Mis reseñas', back: '/mi' })}
    ${list.length ? list.map((r) => html`<div class="review">
      <div class="review__head"><a class="review__who" href="/servicios/${r.specialist?.slug}/${r.service?.slug}">${r.service?.title}</a>${C.stars(r.rating, 14)}</div>
      <p class="review__meta">${r.specialist?.displayName} · ${D.fmtDateShort(r.createdAt)}${r.status === 'hidden' ? ' · Oculta por moderación' : ''}</p>
      ${r.comment ? html`<p class="review__body">${r.comment}</p>` : ''}
      ${r.reply?.text ? html`<div class="review__reply"><strong>Respuesta</strong><br>${r.reply.text}</div>` : ''}
      ${Date.now() - new Date(r.createdAt).getTime() < editDays * 86400000 ? html`<p class="small"><a href="/mi/resenas/${r._id}/editar">Editar</a></p>` : ''}
    </div>`) : C.empty({ title: 'Todavía no escribiste reseñas', text: 'Después de cada sesión te vamos a pedir tu opinión.', iconName: 'star' })}`;
  return page(ctx, { title: 'Mis reseñas', active: 'perfil', body });
}

function favorites(ctx, d) {
  const body = html`${C.pageHead({ title: 'Favoritos' })}
    ${d.specialists.length ? html`<section class="section"><h2>Especialistas</h2><ul class="list panel">${d.specialists.map((s) => html`<li><a class="list-row" href="/especialistas/${s.slug}">${C.avatar({ url: s.avatarUrl, name: s.displayName })}<div class="list-row__main"><p class="list-row__title">${s.displayName}</p><p class="list-row__sub">${s.headline || ''}${s.status !== 'active' ? ' · No disponible' : ''}</p></div>${icon('chevronRight')}</a></li>`)}</ul></section>` : ''}
    ${d.cards.length ? html`<section class="section"><h2>Servicios</h2><div class="results">${d.cards.map((c) => C.serviceCard(c, { ctx, favorites: d.favorites }))}</div></section>` : ''}
    ${d.unavailable.length ? html`<p class="small muted">${d.unavailable.length} servicio(s) guardado(s) ya no están disponibles.</p>` : ''}
    ${!d.cards.length && !d.specialists.length ? C.empty({ title: 'Todavía no guardaste favoritos', text: 'Tocá el corazón en un servicio o especialista para encontrarlo rápido.', action: 'Buscar servicios', href: '/buscar', iconName: 'heart' }) : ''}`;
  return page(ctx, { title: 'Favoritos', active: 'perfil', body });
}

function inbox(ctx, { list }) {
  const body = html`${C.pageHead({ title: 'Mensajes' })}
    ${list.length ? html`<ul class="list panel">${list.map((c) => html`<li><a class="list-row" href="/mi/mensajes/${c._id}">${C.avatar({ url: c.avatarUrl, name: c.specialist?.displayName })}
      <div class="list-row__main"><p class="${classes('list-row__title', c.unreadUser && 'conv-unread')}">${c.specialist?.displayName || 'Especialista'}</p><p class="list-row__sub truncate">${c.lastMessagePreview || 'Sin mensajes todavía'}</p></div>
      <div style="text-align:right"><span class="small muted">${D.fmtRelative(c.lastMessageAt)}</span>${c.unreadUser ? html`<br><span class="pill pill--brand">${c.unreadUser}</span>` : ''}</div></a></li>`)}</ul>`
    : C.empty({ title: 'No tenés conversaciones', text: 'Desde la ficha de un especialista podés escribirle para hacer consultas.', iconName: 'chat' })}`;
  return page(ctx, { title: 'Mensajes', active: 'mensajes', body });
}

// Conversación (compartida con el panel del especialista)
function conversation(ctx, d) {
  const lastAt = d.messages.length ? new Date(d.messages.at(-1).createdAt).toISOString() : '';
  let lastDay = '';
  const { displayBody } = require('../services/messaging');
  const isSpecialistView = d.base === '/panel';
  const body = html`${C.pageHead({ title: d.title || 'Conversación', back: `${d.base}/mensajes`, actions: !isSpecialistView && d.sp ? html`<a class="btn btn--ghost btn--sm" href="/especialistas/${d.sp.slug}">Ver perfil</a>` : '' })}
    ${d.booking ? html`<p class="notice">${icon('calendar', { size: 14 })} Próxima sesión: ${d.booking.snapshot.serviceTitle}, ${D.fmtDateTime(d.booking.start)}</p>` : ''}
    ${!d.allowed ? html`<p class="notice">Para cuidar a ambas partes, los teléfonos y emails se comparten después de la primera reserva.</p>` : ''}
    <div class="thread" data-thread="${d.conv._id}" data-last="${lastAt}">
      ${d.messages.map((m) => {
    const day = D.localParts(m.createdAt).dateStr;
    const sep = day !== lastDay ? html`<span class="thread__day">${D.fmtDateStr(day)}</span>` : '';
    lastDay = day;
    const mine = String(m.sender) === String(d.me);
    return html`${sep}<div class="bubble ${mine ? 'bubble--me' : 'bubble--them'}">${displayBody(m, d.me, d.allowed)}<span class="bubble__time">${D.fmtTime(m.createdAt)}</span></div>`;
  })}
      ${d.messages.length ? '' : html`<p class="muted small" style="text-align:center">Escribí tu consulta. ${isSpecialistView ? '' : 'El especialista recibe un aviso.'}</p>`}
    </div>
    ${d.conv.status === 'blocked' ? html`<p class="notice">Esta conversación está bloqueada.</p>` : html`
    <form class="composer" method="post" action="${d.base}/mensajes/${d.conv._id}" data-composer="${d.conv._id}">${C.csrfField(ctx)}
      <textarea name="body" rows="1" placeholder="Escribí un mensaje" required maxlength="2000" aria-label="Mensaje"></textarea>
      <button class="btn btn--primary" aria-label="Enviar">${icon('send', { size: 18 })}</button>
      <p class="notice" data-notice hidden></p>
    </form>`}`;
  return layout(ctx, { title: d.title || 'Mensajes', body, noindex: true, area: isSpecialistView ? 'specialist' : 'public', active: 'mensajes', hideFooter: true });
}

function notifications(ctx, { list }) {
  const body = html`${C.pageHead({ title: 'Notificaciones', actions: html`<a class="btn btn--ghost btn--sm" href="/mi/configuracion">${icon('settings', { size: 16 })}Preferencias</a>` })}
    ${list.length ? html`<ul class="list panel">${list.map((n) => html`<li><a class="list-row" href="/mi/notificaciones/${n._id}">
      <span class="${classes('avatar avatar--md avatar--initial')}">${icon(n.type.startsWith('booking') ? 'calendar' : n.type.startsWith('review') ? 'star' : n.type.startsWith('message') ? 'chat' : n.type.startsWith('payment') || n.type.startsWith('refund') || n.type.startsWith('payout') ? 'card' : 'bell', { size: 20 })}</span>
      <div class="list-row__main"><p class="${classes('list-row__title', !n.readAt && 'conv-unread')}">${n.title}</p>${n.body ? html`<p class="list-row__sub">${n.body}</p>` : ''}<p class="list-row__sub">${D.fmtRelative(n.createdAt)}</p></div>
      ${!n.readAt ? html`<span class="pill pill--brand">Nueva</span>` : ''}</a></li>`)}</ul>`
    : C.empty({ title: 'No tenés notificaciones', iconName: 'bell' })}`;
  return page(ctx, { title: 'Notificaciones', active: 'perfil', body });
}

function profile(ctx) {
  const u = ctx.user;
  const body = html`${C.pageHead({ title: 'Mi perfil', back: '/mi', actions: html`<a class="btn btn--primary btn--sm" href="/mi/perfil/editar">${icon('edit', { size: 16 })}Editar</a>` })}
    <div class="panel stack">
      <div class="row">${C.avatar({ url: u.avatarUrl, name: u.name, size: 'lg' })}<div><h2 style="margin:0">${u.name}</h2><p class="muted" style="margin:0">Se muestra como “${u.publicName()}” en tus reseñas</p></div></div>
      ${C.dl([
    ['Email', html`${u.email} ${u.emailVerified ? C.pill('Confirmado', 'ok') : C.pill('Sin confirmar', 'warn')}`],
    ['Celular', u.phone || '—'],
    ['Ubicación', [u.location?.city, u.location?.department].filter(Boolean).join(', ') || '—'],
    ['Dirección para domicilio', u.preferences?.homeAddress || '—'],
    ['Miembro desde', D.fmtDateShort(u.createdAt)],
  ])}
    </div>
    <div class="btnbar"><a class="btn btn--ghost" href="/mi/metodos-de-pago">${icon('card', { size: 16 })}Métodos de pago</a><a class="btn btn--ghost" href="/mi/privacidad">${icon('lock', { size: 16 })}Privacidad</a></div>`;
  return page(ctx, { title: 'Mi perfil', active: 'perfil', body });
}

function profileEdit(ctx, { values = {}, errors = {} }) {
  const body = html`${C.pageHead({ title: 'Editar perfil', back: '/mi/perfil' })}
    <form method="post" action="/mi/perfil/editar?_csrf=${ctx.csrf}" enctype="multipart/form-data" class="form">${C.csrfField(ctx)}
      <div class="field"><label for="f-avatar">Foto</label><div class="row">${C.avatar({ url: values.avatarUrl, name: values.name, size: 'lg' })}<img id="avatar-preview" class="avatar avatar--lg" hidden alt=""><input id="f-avatar" type="file" name="avatar" accept="image/jpeg,image/png,image/webp" data-preview="#avatar-preview"></div></div>
      ${C.field({ label: 'Nombre y apellido', name: 'name', value: values.name, required: true, error: errors.name, autocomplete: 'name' })}
      ${C.field({ label: 'Celular', name: 'phone', type: 'tel', value: values.phone, error: errors.phone, autocomplete: 'tel' })}
      <div class="grid-2">
        ${C.select({ label: 'Departamento', name: 'department', value: values.location?.department || values.department, options: [['', '—'], ...DEPARTMENTS.map((x) => [x, x])] })}
        ${C.field({ label: 'Ciudad o barrio', name: 'city', value: values.location?.city || values.city })}
      </div>
      ${C.field({ label: 'Dirección para atención a domicilio', name: 'homeAddress', value: values.preferences?.homeAddress || values.homeAddress, hint: 'La usamos para completar tus reservas a domicilio. Solo la ve el especialista con reserva confirmada.' })}
      <button class="btn btn--primary">Guardar</button>
    </form>`;
  return page(ctx, { title: 'Editar perfil', active: 'perfil', body });
}

function payments(ctx, { list, refunds }) {
  const body = html`${C.pageHead({ title: 'Pagos y reembolsos', back: '/mi' })}
    ${list.length ? html`<ul class="list panel">${list.map((p) => html`<li><a class="list-row" href="/mi/reservas/${p.booking?._id}">
      ${icon('receipt', { size: 22 })}<div class="list-row__main"><p class="list-row__title">${p.booking?.snapshot?.serviceTitle || 'Reserva'}</p><p class="list-row__sub">${p.booking?.code} · ${D.fmtDateShort(p.createdAt)} · ${PAYMENT_STATUS[p.status] || p.status}</p></div>
      <strong>${fmtMoney(p.amount)}</strong></a></li>`)}</ul>` : C.empty({ title: 'Todavía no hiciste pagos', iconName: 'card' })}
    ${refunds.length ? html`<section class="section"><h2>Reembolsos</h2><ul class="list panel">${refunds.map((r) => html`<li class="row row--between"><span>${D.fmtDateShort(r.createdAt)} · ${r.status === 'processed' ? 'Procesado' : r.status === 'failed' ? 'En revisión' : r.status === 'manual' ? 'Lo gestiona el especialista' : 'Pendiente'}</span><strong>${fmtMoney(r.amount)}</strong></li>`)}</ul></section>` : ''}`;
  return page(ctx, { title: 'Pagos', active: 'perfil', body });
}

function paymentMethods(ctx) {
  const body = html`${C.pageHead({ title: 'Métodos de pago', back: '/mi/perfil' })}
    <div class="panel stack">
      <p style="margin:0">${icon('lock', { size: 18 })} <strong>Alternativa no guarda datos de tarjetas.</strong></p>
      <p class="muted" style="margin:0">Los pagos se procesan en Mercado Pago. Si ingresás con tu cuenta de Mercado Pago al pagar (${ctx.user.email}), vas a ver tus tarjetas guardadas y pagar en un toque las próximas veces.</p>
      <p class="muted" style="margin:0">Medios disponibles: tarjetas de crédito y débito, dinero en cuenta de Mercado Pago y los medios locales que Mercado Pago habilite.</p>
    </div>`;
  return page(ctx, { title: 'Métodos de pago', active: 'perfil', body });
}

function settings(ctx) {
  const n = ctx.user.preferences?.notifications || {};
  const body = html`${C.pageHead({ title: 'Configuración', back: '/mi' })}
    <section class="panel form" style="max-width:none">
      <h2>Notificaciones</h2>
      <form method="post" action="/mi/configuracion/notificaciones">${C.csrfField(ctx)}
        <p class="small muted">Los emails de confirmación, cancelación y pagos se envían siempre.</p>
        ${C.checkbox({ label: 'Email', name: 'email', checked: n.email !== false, hint: 'Recordatorios, mensajes y reseñas.' })}
        ${C.checkbox({ label: 'Notificaciones push', name: 'push', checked: n.push !== false, hint: 'En este navegador o celular.' })}
        ${C.checkbox({ label: 'WhatsApp', name: 'whatsapp', checked: n.whatsapp, hint: 'Confirmaciones y recordatorios de tus reservas al celular de tu perfil.' })}
        ${C.checkbox({ label: 'Novedades y promociones', name: 'marketing', checked: n.marketing })}
        <div class="form-actions"><button class="btn btn--primary">Guardar preferencias</button><button type="button" class="btn btn--ghost" data-push-enable>${icon('bell', { size: 16 })}Activar push en este dispositivo</button></div>
      </form>
    </section>
    <section class="panel form section" style="max-width:none">
      <h2>Contraseña</h2>
      <form method="post" action="/mi/configuracion/contrasena">${C.csrfField(ctx)}
        ${C.field({ label: 'Contraseña actual', name: 'current', type: 'password', required: true, autocomplete: 'current-password' })}
        <div class="grid-2">${C.field({ label: 'Nueva contraseña', name: 'next', type: 'password', required: true, autocomplete: 'new-password' })}${C.field({ label: 'Repetila', name: 'next2', type: 'password', required: true, autocomplete: 'new-password' })}</div>
        <button class="btn btn--primary">Cambiar contraseña</button>
      </form>
    </section>`;
  return page(ctx, { title: 'Configuración', active: 'perfil', body });
}

function privacy(ctx) {
  const p = ctx.user.privacy || {};
  const body = html`${C.pageHead({ title: 'Privacidad', back: '/mi/perfil' })}
    <section class="panel stack">
      <h2>Qué ven los demás</h2>
      <p class="muted" style="margin:0">En tus reseñas se muestra “${ctx.user.publicName()}”. Tu email y teléfono no son públicos.</p>
      <form method="post" action="/mi/privacidad">${C.csrfField(ctx)}
        ${C.checkbox({ label: 'Compartir mi teléfono con especialistas con los que tengo una reserva confirmada', name: 'shareContactAfterBooking', checked: p.shareContactAfterBooking !== false })}
        <button class="btn btn--primary btn--sm">Guardar</button>
      </form>
    </section>
    <section class="panel stack section">
      <h2>Tus datos</h2>
      <p class="muted" style="margin:0">Descargá una copia de tus datos: cuenta, reservas, reseñas, favoritos, mensajes y pagos.</p>
      <a class="btn btn--ghost" href="/mi/privacidad/mis-datos.json">${icon('upload', { size: 16 })}Descargar mis datos</a>
    </section>
    <section class="panel stack section">
      <h2>Eliminar cuenta</h2>
      <p class="muted" style="margin:0">Se borran tus datos personales y favoritos. Las reservas y pagos se conservan de forma anónima el tiempo que exige la ley. No se puede deshacer.</p>
      <form method="post" action="/mi/privacidad/eliminar" data-confirm="Vas a eliminar tu cuenta de forma permanente. ¿Continuar?">${C.csrfField(ctx)}
        ${C.field({ label: 'Escribí ELIMINAR para confirmar', name: 'confirm', required: true })}
        <button class="btn btn--danger">Eliminar mi cuenta</button>
      </form>
    </section>`;
  return page(ctx, { title: 'Privacidad', active: 'perfil', body });
}

const TOPICS = [['booking', 'Una reserva'], ['payment', 'Un pago'], ['refund', 'Un reembolso'], ['account', 'Mi cuenta'], ['specialist', 'Un especialista'], ['technical', 'Un problema técnico'], ['other', 'Otro']];
const TICKET_STATUS = { open: ['Abierta', 'info'], waiting_user: ['Esperando tu respuesta', 'warn'], resolved: ['Resuelta', 'ok'], closed: ['Cerrada', 'muted'] };

function help(ctx, { tickets, recent, area = 'public', base = '/mi/ayuda' }) {
  const body = html`${C.pageHead({ title: 'Ayuda', subtitle: 'Consultas con el equipo de Alternativa.' })}
    <p><a href="/preguntas-frecuentes">Preguntas frecuentes</a> · <a href="/cancelaciones">Política de cancelaciones</a></p>
    ${tickets.length ? html`<section class="section"><h2>Tus consultas</h2><ul class="list panel">${tickets.map((t) => html`<li><a class="list-row" href="${base}/${t._id}"><div class="list-row__main"><p class="list-row__title">#${t.number} · ${t.subject}</p><p class="list-row__sub">${D.fmtRelative(t.updatedAt)}</p></div>${C.pill(TICKET_STATUS[t.status][0], TICKET_STATUS[t.status][1])}</a></li>`)}</ul></section>` : ''}
    <section class="section panel form" style="max-width:none"><h2>Nueva consulta</h2>
      <form method="post" action="${base}">${C.csrfField(ctx)}
        <div class="grid-2">${C.select({ label: 'Tema', name: 'topic', required: true, options: TOPICS })}
        ${C.select({ label: 'Reserva relacionada', name: 'booking', options: [['', 'Ninguna'], ...(recent || []).map((b) => [b._id, `${b.code} · ${b.snapshot.serviceTitle} · ${D.fmtDateShort(b.start)}`])] })}</div>
        ${C.field({ label: 'Asunto', name: 'subject', required: true })}
        ${C.field({ label: 'Mensaje', name: 'body', type: 'textarea', rows: 5, required: true })}
        <button class="btn btn--primary">Enviar consulta</button>
      </form></section>`;
  return layout(ctx, { title: 'Ayuda', body, noindex: true, area, active: area === 'specialist' ? 'ayuda' : 'perfil' });
}

function ticket(ctx, { ticket: t, base, area = 'public' }) {
  const body = html`${C.pageHead({ title: `#${t.number} · ${t.subject}`, back: base })}
    ${C.pill(TICKET_STATUS[t.status][0], TICKET_STATUS[t.status][1])}
    <div class="thread" style="max-height:none;margin-top:12px">${t.messages.map((m) => html`<div class="bubble ${m.authorRole === 'admin' || m.authorRole === 'system' ? 'bubble--them' : 'bubble--me'}">${m.authorRole === 'admin' ? html`<strong>Equipo Alternativa</strong><br>` : ''}${m.body}<span class="bubble__time">${D.fmtDateTime(m.at)}</span></div>`)}</div>
    ${t.status !== 'closed' ? html`<form method="post" action="${base}/${t._id}" class="form">${C.csrfField(ctx)}${C.field({ label: 'Responder', name: 'body', type: 'textarea', rows: 3, required: true })}<button class="btn btn--primary">Enviar</button></form>` : ''}`;
  return layout(ctx, { title: `Consulta #${t.number}`, body, noindex: true, area, active: area === 'specialist' ? 'ayuda' : 'perfil' });
}

module.exports = {
  dashboard, bookings, bookingDetail, cancel, reschedule, rebook, reviewForm, myReviews, favorites, inbox, conversation, notifications,
  profile, profileEdit, payments, paymentMethods, settings, privacy, help, ticket, bookingRow, moneyRows, TICKET_STATUS, TOPICS,
};
