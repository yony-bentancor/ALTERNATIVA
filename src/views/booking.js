'use strict';
const { html, attr } = require('../lib/html');
const { fmtMoney } = require('../lib/money');
const D = require('../lib/dates');
const { MODALITIES } = require('../lib/constants');
const { layout } = require('./layout');
const { icon } = require('./icons');
const C = require('./components');
const { priceLines } = require('./public');

function steps(n) {
  return html`<ol class="steps" aria-label="Paso ${n} de 3">${[1, 2, 3].map((i) => html`<li class="${i <= n ? 'is-done' : ''}"></li>`)}</ol>`;
}

function serviceHeader(service, specialist, avatar) {
  return html`<div class="list-row" style="margin-bottom:16px">${C.avatar({ url: avatar?.thumbUrl || avatar?.url, name: specialist.displayName, size: 'md' })}
    <div class="list-row__main"><p class="list-row__title">${service.title}</p><p class="list-row__sub">${specialist.displayName} · ${C.duration(service.durationMinutes)}</p></div></div>`;
}

function modalityPicker(modalities, current) {
  if (modalities.length < 2) return html`<input type="hidden" name="modalidad" value="${modalities[0]}">`;
  return html`<fieldset class="field"><legend>Modalidad</legend><div class="modality-pick">
    ${modalities.map((m) => html`<label><input type="radio" name="modalidad" value="${m}"${attr('checked', m === current)}>${icon(MODALITIES[m].icon)}<span><strong>${MODALITIES[m].label}</strong></span></label>`)}
  </div></fieldset>`;
}

// Paso 1: fecha y hora (calendario con disponibilidad real)
function pickTime(ctx, d) {
  const { service, specialist, avatar } = d;
  const body = html`
    ${C.pageHead({ title: 'Elegí día y hora', back: `/servicios/${specialist.slug}/${service.slug}` })}
    ${steps(1)}
    ${serviceHeader(service, specialist, avatar)}
    <div data-booking data-service="${service._id}" data-today="${d.today}" data-selected="${d.selected}" data-extra="${/^[a-f\d]{24}$/i.test(ctx.query.volver || '') ? `&volver=${ctx.query.volver}` : ''}">
      ${modalityPicker(d.modalities, d.modality)}
      <div class="grid-2" style="align-items:start;gap:24px">
        <div class="panel cal" data-cal><p class="slots-empty">Cargando agenda…</p></div>
        <div>
          <h2 data-day-title style="font-size:1.05rem">Horarios</h2>
          <div data-slots><p class="slots-empty">Elegí un día en el calendario.</p></div>
          <p class="small muted" style="margin-top:12px">Horarios en hora de Uruguay. Los días resaltados tienen turnos libres.</p>
        </div>
      </div>
      <noscript><p class="flash flash--warn">Activá JavaScript para ver el calendario de turnos.</p></noscript>
    </div>`;
  return layout(ctx, { title: `Reservar ${service.title}`, body, noindex: true, active: 'buscar' });
}

// Paso 2: confirmación con desglose y política vigente
function confirm(ctx, d) {
  const { service, specialist, avatar, slot, quote } = d;
  const b = quote.breakdown;
  const promo = quote.promo;
  const needsAddress = d.modality === 'domicilio';
  const body = html`
    ${C.pageHead({ title: 'Confirmá tu reserva', back: `/reservar/${service._id}?fecha=${d.fecha}&modalidad=${d.modality}` })}
    ${steps(2)}
    <div class="layout-aside">
      <div>
        ${serviceHeader(service, specialist, avatar)}
        <div class="panel stack">
          <p class="row" style="gap:10px;margin:0">${icon('calendar')}<strong>${D.fmtDateStr(d.fecha)}</strong></p>
          <p class="row" style="gap:10px;margin:0">${icon('clock')}${d.hora} a ${D.fmtTime(slot.end)} h</p>
          <p class="row" style="gap:10px;margin:0">${icon(MODALITIES[d.modality].icon)}${MODALITIES[d.modality].label}${d.modality === 'presencial' && (specialist.location?.addressPublicHint || specialist.location?.neighborhood) ? html` · ${specialist.location.addressPublicHint || specialist.location.neighborhood}` : ''}</p>
        </div>
        <form method="post" action="/reservar/${service._id}" id="bookform" style="margin-top:16px">${C.csrfField(ctx)}
          <input type="hidden" name="fecha" value="${d.fecha}"><input type="hidden" name="hora" value="${d.hora}">
          <input type="hidden" name="modalidad" value="${d.modality}">
          ${d.promoCode ? html`<input type="hidden" name="codigo" value="${d.promoCode}">` : ''}
          ${/^[a-f\d]{24}$/i.test(ctx.query.volver || '') ? html`<input type="hidden" name="rebookOf" value="${ctx.query.volver}">` : ''}
          ${needsAddress ? C.field({ label: 'Dirección para la atención a domicilio', name: 'direccion', value: d.address, required: true, hint: 'Solo la ve el especialista una vez confirmada la reserva.', autocomplete: 'street-address' }) : ''}
          ${C.field({ label: 'Algo que el especialista deba saber', name: 'notas', type: 'textarea', rows: 3, maxlength: 1000, placeholder: 'Lesiones, preferencias, si es tu primera vez…' })}
        </form>
        <form method="get" action="/reservar/${service._id}/confirmar" class="inputgroup" style="align-items:end">
          <input type="hidden" name="fecha" value="${d.fecha}"><input type="hidden" name="hora" value="${d.hora}"><input type="hidden" name="modalidad" value="${d.modality}">
          ${C.field({ label: 'Código de descuento', name: 'codigo', value: d.promoCode })}
          <button class="btn btn--ghost" type="submit" style="flex:0 0 auto;margin-bottom:16px">Aplicar</button>
        </form>
        ${d.promoCode && !promo ? html`<p class="field__error" style="margin-top:-8px">Ese código no es válido para este servicio.</p>` : ''}
        <details class="panel panel--soft" style="margin-top:8px"><summary style="cursor:pointer;font-weight:600">Política de cancelación</summary><ul class="small" style="margin:10px 0 0;padding-left:18px">${d.policy.map((p) => html`<li>${p}</li>`)}</ul></details>
      </div>
      <aside>
        <div class="panel stack">
          ${promo ? html`<p class="pill pill--ok" style="margin:0">${icon('tag', { size: 14 })} ${promo.title}</p>` : ''}
          ${priceLines(ctx, b, { promo })}
          <button class="btn btn--primary btn--block btn--lg" type="submit" form="bookform">Confirmar y pagar ${fmtMoney(b.total)}</button>
          <p class="small muted" style="margin:0">${quote.settings.payments.collectionModel === 'offline' ? 'El pago se coordina directamente con el especialista.' : 'Vas a pagar con Mercado Pago. Tenés ' + quote.settings.payments.paymentWindowMinutes + ' minutos para completar el pago antes de que se libere el horario.'}</p>
        </div>
      </aside>
    </div>`;
  return layout(ctx, { title: 'Confirmar reserva', body, noindex: true, active: 'buscar' });
}

function payment(ctx, { booking }) {
  const body = html`
    ${C.pageHead({ title: 'Completá el pago', back: '/mi/reservas' })}
    ${steps(3)}
    <div class="panel stack" data-deadline-box>
      <p style="margin:0"><strong>${booking.snapshot.serviceTitle}</strong><br><span class="muted">${booking.snapshot.specialistName} · ${D.fmtDateTime(booking.start)}</span></p>
      <div class="summary"><div class="summary__row summary__row--total"><span>Total</span><span>${fmtMoney(booking.snapshot.total)}</span></div></div>
      ${booking.paymentDeadline ? html`<p class="small" style="margin:0">Reservamos el horario por <span class="countdown" data-deadline="${new Date(booking.paymentDeadline).toISOString()}">—</span> minutos.</p>` : ''}
      <form method="post" action="/pago/${booking._id}">${C.csrfField(ctx)}<button class="btn btn--primary btn--block btn--lg">Pagar con Mercado Pago</button></form>
      <form method="post" action="/mi/reservas/${booking._id}/cancelar" data-confirm="¿Liberar este horario y cancelar la reserva?">${C.csrfField(ctx)}<button class="btn btn--text btn--block">Cancelar reserva</button></form>
    </div>`;
  return layout(ctx, { title: 'Pago', body, noindex: true, active: 'reservas' });
}

function paymentReturn(ctx, { payment, booking, result }) {
  const rejected = ['rejected', 'cancelled'].includes(payment.status) || (result === 'error' && payment.status !== 'pending');
  const body = rejected
    ? html`<div class="result-hero"><div class="result-hero__icon result-hero__icon--bad">${icon('x', { size: 34 })}</div><h1>El pago no se completó</h1>
        <p class="muted">${payment.statusDetail && /insufficient/.test(payment.statusDetail) ? 'El medio de pago no tenía saldo suficiente.' : 'El medio de pago rechazó la operación.'} Tu horario sigue reservado unos minutos: podés intentar con otro medio.</p>
        <div class="btnbar" style="justify-content:center"><a class="btn btn--primary" href="/pago/${booking._id}">Intentar de nuevo</a><a class="btn btn--ghost" href="/mi/reservas">Mis reservas</a></div></div>`
    : html`<div class="result-hero" data-payment-poll="${payment._id}"><div class="result-hero__icon result-hero__icon--wait">${icon('clock', { size: 34 })}</div><h1>Estamos confirmando tu pago</h1>
        <p class="muted">Mercado Pago nos está informando el resultado. Esta página se actualiza sola; no hace falta que pagues de nuevo.</p>
        <a class="btn btn--ghost" href="/mi/reservas/${booking._id}">Ver la reserva</a></div>`;
  return layout(ctx, { title: 'Resultado del pago', body, noindex: true, active: 'reservas' });
}

function simulatedCheckout(ctx, { payment, booking }) {
  const body = html`<div class="auth">
    <div class="flash flash--warn">${icon('info', { size: 18 })}<span>Pasarela de prueba: no se mueve dinero real. Disponible solo fuera de producción.</span></div>
    <h1>Pago de prueba</h1>
    <div class="panel stack">
      <p style="margin:0"><strong>${booking.snapshot.serviceTitle}</strong><br><span class="muted">${booking.code}</span></p>
      ${C.dl([
    ['Total', fmtMoney(payment.amount)],
    ['Modelo de cobro', payment.collectionModel],
    ['Comisión Alternativa', fmtMoney(payment.commissionAmount)],
    ['Para el especialista', fmtMoney(payment.specialistAmount)],
  ])}
      <form method="post" action="/pago/simulado/${payment._id}">${C.csrfField(ctx)}<input type="hidden" name="result" value="approved"><button class="btn btn--primary btn--block">Simular pago aprobado</button></form>
      <form method="post" action="/pago/simulado/${payment._id}">${C.csrfField(ctx)}<input type="hidden" name="result" value="rejected"><button class="btn btn--danger btn--block">Simular pago rechazado</button></form>
    </div></div>`;
  return layout(ctx, { title: 'Pago de prueba', body, noindex: true });
}

module.exports = { pickTime, confirm, payment, paymentReturn, simulatedCheckout, steps, modalityPicker };
