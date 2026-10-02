'use strict';
// Componentes de interfaz reutilizables.
const { html, raw, attr, classes, escape } = require('../lib/html');
const { fmtMoney } = require('../lib/money');
const D = require('../lib/dates');
const { MODALITIES, BOOKING_STATUS } = require('../lib/constants');
const { icon } = require('./icons');

const fmtRating = (n) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');

// ★ 4,9 · 127 reseñas verificadas  (lo que el usuario ve: simple, sin índices)
function rating(r, { verified = true, compact = false } = {}) {
  if (!r || !r.count) return '';
  const label = compact ? '' : html` · ${r.count} ${r.count === 1 ? 'reseña' : 'reseñas'}${verified && !compact ? ' verificadas' : ''}`;
  return html`<span class="rating" aria-label="${fmtRating(r.avg)} de 5, ${r.count} reseñas">${icon('star', { size: 15, cls: 'rating__star' })}<strong>${fmtRating(r.avg)}</strong>${compact ? html`<span class="muted"> (${r.count})</span>` : label}</span>`;
}

function stars(n, size = 16) {
  return html`<span class="stars" aria-label="${n} de 5 estrellas">${[1, 2, 3, 4, 5].map((i) => html`<span class="${i <= n ? 'on' : ''}">${icon('star', { size })}</span>`)}</span>`;
}

function avatar({ url, name, size = 'md' }) {
  const initials = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  if (url) return html`<img class="avatar avatar--${size}" src="${url}" alt="" loading="lazy" decoding="async">`;
  return html`<span class="avatar avatar--${size} avatar--initial" aria-hidden="true">${initials}</span>`;
}

function modalityChips(list = []) {
  return html`<span class="chips">${list.map((m) => html`<span class="chip chip--${m}">${icon(MODALITIES[m]?.icon || 'pin', { size: 14 })}${MODALITIES[m]?.short || m}</span>`)}</span>`;
}

function statusPill(status) {
  const s = BOOKING_STATUS[status] || { label: status, tone: 'muted' };
  return html`<span class="status status--${s.tone}">${s.label}</span>`;
}

function pill(text, tone = 'muted') {
  return html`<span class="pill pill--${tone}">${text}</span>`;
}

function verifiedBadge() {
  return html`<span class="badge badge--verified" title="Alternativa verificó la identidad">${icon('shield', { size: 14 })}Identidad verificada</span>`;
}
function newcomerBadge() {
  return html`<span class="badge badge--new">${icon('sparkle', { size: 14 })}Nuevo en Alternativa</span>`;
}
function sponsoredBadge() {
  return html`<span class="badge badge--sponsored">Patrocinado</span>`;
}

function duration(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function nextSlotLabel(next) {
  if (!next) return '';
  const today = D.todayStr();
  const label = next.date === today ? 'hoy' : next.date === D.addDays(today, 1) ? 'mañana' : D.fmtDateStr(next.date).split(' ').slice(0, 2).join(' ');
  return html`<span class="next-slot">${icon('clock', { size: 14 })}Próximo turno: ${label} ${next.time}</span>`;
}

// Tarjeta de resultado: servicio + especialista. El precio es el final (tarifa incluida).
function serviceCard(card, { ctx, favorites = new Set() } = {}) {
  const { service: s, specialist: sp } = card;
  const href = `/servicios/${sp.slug}/${s.slug}`;
  const fav = favorites.has(String(s._id));
  const place = s.modalities?.length === 1 && s.modalities[0] === 'online' ? 'Online' : [sp.location?.neighborhood, sp.location?.city].filter(Boolean).join(', ');
  return html`<article class="${classes('result', card.sponsored && 'result--sponsored')}">
    <a class="result__link" href="${href}${card.placementId ? `?ad=${card.placementId}` : ''}" aria-label="${s.title} con ${sp.displayName}"></a>
    <div class="result__media">${avatar({ url: sp.avatarUrl, name: sp.displayName, size: 'lg' })}</div>
    <div class="result__body">
      <div class="result__top">
        ${card.sponsored ? sponsoredBadge() : card.newcomer ? newcomerBadge() : ''}
        ${card.verified ? html`<span class="result__verified" title="Identidad verificada">${icon('shield', { size: 15, label: 'Identidad verificada' })}</span>` : ''}
      </div>
      <h3 class="result__title">${s.title}</h3>
      <p class="result__who">${sp.displayName}${place ? html` <span class="muted">· ${place}</span>` : ''}${card.distanceKm !== null && card.distanceKm !== undefined ? html` <span class="muted">· ${String(card.distanceKm).replace('.', ',')} km</span>` : ''}</p>
      <div class="result__meta">
        ${s.rating?.count ? rating(s.rating) : html`<span class="muted small">Todavía sin reseñas</span>`}
      </div>
      <div class="result__foot">
        <span class="price">${fmtMoney(card.displayPrice)} <span class="muted">· ${duration(s.durationMinutes)}</span></span>
        ${nextSlotLabel(card.nextSlot)}
      </div>
    </div>
    ${ctx ? favButton({ kind: 'service', id: s._id, active: fav, ctx }) : ''}
  </article>`;
}

function favButton({ kind, id, active, ctx }) {
  if (!ctx?.user) return html`<a class="fav" href="/login" aria-label="Guardar en favoritos">${icon('heart', { size: 20 })}</a>`;
  return html`<button type="button" class="${classes('fav', active && 'is-on')}" data-fav="${kind}" data-id="${id}" aria-pressed="${active ? 'true' : 'false'}" aria-label="${active ? 'Quitar de favoritos' : 'Guardar en favoritos'}">${icon('heart', { size: 20 })}</button>`;
}

function empty({ title, text, action, href, iconName = 'leaf' }) {
  return html`<div class="empty">${icon(iconName, { size: 32 })}<h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${action ? html`<a class="btn btn--primary" href="${href}">${action}</a>` : ''}</div>`;
}

function pageHead({ title, subtitle, back, actions }) {
  return html`<div class="pagehead">
    ${back ? html`<a class="pagehead__back" href="${back}" aria-label="Volver">${icon('arrowLeft')}</a>` : ''}
    <div class="pagehead__text"><h1>${title}</h1>${subtitle ? html`<p class="muted">${subtitle}</p>` : ''}</div>
    ${actions ? html`<div class="pagehead__actions">${actions}</div>` : ''}
  </div>`;
}

function tabs(items, active) {
  return html`<nav class="tabs" aria-label="Secciones">${items.map(([key, href, label, count]) => html`<a class="${classes('tabs__item', active === key && 'is-active')}" href="${href}"${active === key ? raw(' aria-current="page"') : ''}>${label}${count ? html` <span class="tabs__count">${count}</span>` : ''}</a>`)}</nav>`;
}

function pagination({ page, pages }, baseQuery = {}, path = '') {
  if (!pages || pages <= 1) return '';
  const link = (p) => {
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(baseQuery).filter(([, v]) => v !== undefined && v !== '')), page: String(p) });
    return `${path}?${q.toString()}`;
  };
  return html`<nav class="pager" aria-label="Paginación">
    ${page > 1 ? html`<a class="btn btn--ghost btn--sm" href="${link(page - 1)}">${icon('chevronLeft', { size: 16 })} Anterior</a>` : html`<span></span>`}
    <span class="muted small">Página ${page} de ${pages}</span>
    ${page < pages ? html`<a class="btn btn--ghost btn--sm" href="${link(page + 1)}">Siguiente ${icon('chevronRight', { size: 16 })}</a>` : html`<span></span>`}
  </nav>`;
}

// ── Formularios ────────────────────────────────────────────
function csrfField(ctx) { return html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`; }

function field({ label, name, type = 'text', value = '', required, hint, error, placeholder, min, max, step, autocomplete, inputmode, rows, maxlength, pattern, readonly, cls }) {
  const id = `f-${name.replace(/[^\w-]/g, '-')}`;
  const control = type === 'textarea'
    ? html`<textarea id="${id}" name="${name}" rows="${rows || 4}"${attr('required', required)}${attr('placeholder', placeholder, placeholder)}${attr('maxlength', maxlength, maxlength)}${attr('readonly', readonly)}>${value ?? ''}</textarea>`
    : html`<input id="${id}" name="${name}" type="${type}" value="${value ?? ''}"${attr('required', required)}${attr('placeholder', placeholder, placeholder)}${attr('min', min !== undefined, min)}${attr('max', max !== undefined, max)}${attr('step', step !== undefined, step)}${attr('autocomplete', autocomplete, autocomplete)}${attr('inputmode', inputmode, inputmode)}${attr('maxlength', maxlength, maxlength)}${attr('pattern', pattern, pattern)}${attr('readonly', readonly)}>`;
  return html`<div class="${classes('field', error && 'field--error', cls)}">
    <label for="${id}">${label}${required ? '' : html` <span class="muted">(opcional)</span>`}</label>
    ${control}
    ${hint ? html`<p class="field__hint">${hint}</p>` : ''}
    ${error ? html`<p class="field__error">${error}</p>` : ''}
  </div>`;
}

function select({ label, name, options, value, required, hint, multiple, size }) {
  const id = `f-${name.replace(/[^\w-]/g, '-')}`;
  const values = [].concat(value ?? []).map(String);
  return html`<div class="field">
    <label for="${id}">${label}${required ? '' : html` <span class="muted">(opcional)</span>`}</label>
    <select id="${id}" name="${name}"${attr('required', required)}${attr('multiple', multiple)}${attr('size', size, size)}>
      ${options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return html`<option value="${v}"${attr('selected', values.includes(String(v)))}>${l}</option>`;
  })}
    </select>
    ${hint ? html`<p class="field__hint">${hint}</p>` : ''}
  </div>`;
}

function checkbox({ label, name, checked, value = 'on', hint }) {
  return html`<label class="check"><input type="checkbox" name="${name}" value="${value}"${attr('checked', checked)}><span>${label}${hint ? html`<small class="muted">${hint}</small>` : ''}</span></label>`;
}

function checkGroup({ label, name, options, values = [] }) {
  const set = new Set(values.map(String));
  return html`<fieldset class="field"><legend>${label}</legend><div class="checkgrid">
    ${options.map(([v, l]) => html`<label class="check check--pill"><input type="checkbox" name="${name}" value="${v}"${attr('checked', set.has(String(v)))}><span>${l}</span></label>`)}
  </div></fieldset>`;
}

// Botón que envía un POST con confirmación opcional (acciones de una sola vez).
function actionButton(ctx, { action, label, cls = 'btn btn--ghost', confirm, fields = {}, iconName }) {
  return html`<form method="post" action="${action}" class="inline-form"${confirm ? html` data-confirm="${confirm}"` : ''}>
    ${csrfField(ctx)}${Object.entries(fields).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
    <button type="submit" class="${cls}">${iconName ? icon(iconName, { size: 16 }) : ''}${label}</button>
  </form>`;
}

function kpi(label, value, sub) {
  return html`<div class="kpi"><p class="kpi__label">${label}</p><p class="kpi__value">${value}</p>${sub ? html`<p class="kpi__sub">${sub}</p>` : ''}</div>`;
}

// Gráfico de barras liviano (SVG) para series diarias.
function barChart(series, { key = 'value', label = '', height = 120, color = 'var(--blue)' } = {}) {
  if (!series?.length) return '';
  const max = Math.max(1, ...series.map((s) => s[key] || 0));
  const w = 100 / series.length;
  return html`<figure class="chart" aria-label="${label}">
    <svg viewBox="0 0 100 ${height}" preserveAspectRatio="none" role="img" aria-hidden="true">
      ${series.map((s, i) => {
    const h = Math.max(0.5, ((s[key] || 0) / max) * (height - 4));
    return raw(`<rect x="${(i * w + w * 0.15).toFixed(3)}" y="${(height - h).toFixed(2)}" width="${(w * 0.7).toFixed(3)}" height="${h.toFixed(2)}" rx="0.6" fill="${escape(color)}"><title>${escape(s.date || s.label || '')}: ${Number(s[key]) || 0}</title></rect>`);
  })}
    </svg>
    <figcaption class="chart__axis"><span>${series[0].date ? D.fmtDateStr(series[0].date).split(' ').slice(1).join(' ') : series[0].label}</span><span>${series.at(-1).date ? D.fmtDateStr(series.at(-1).date).split(' ').slice(1).join(' ') : series.at(-1).label}</span></figcaption>
  </figure>`;
}

function hbars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return html`<ul class="hbars">${rows.map((r) => html`<li><span class="hbars__label">${r.label}</span><span class="hbars__track"><span class="hbars__fill" style="width:${Math.round((r.value / max) * 100)}%"></span></span><span class="hbars__value">${r.display ?? r.value}</span></li>`)}</ul>`;
}

function dl(rows) {
  return html`<dl class="dl">${rows.filter(Boolean).map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
}

function money(n) { return fmtMoney(n); }

module.exports = {
  fmtRating, rating, stars, avatar, modalityChips, statusPill, pill, verifiedBadge, newcomerBadge, sponsoredBadge, duration, nextSlotLabel,
  serviceCard, favButton, empty, pageHead, tabs, pagination, csrfField, field, select, checkbox, checkGroup, actionButton, kpi, barChart, hbars, dl, money,
};
