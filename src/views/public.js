'use strict';
const { html, markdown, paragraphs, attr, classes } = require('../lib/html');
const { fmtMoney } = require('../lib/money');
const D = require('../lib/dates');
const { MODALITIES } = require('../lib/constants');
const { layout } = require('./layout');
const { icon } = require('./icons');
const C = require('./components');

const SUGGESTIONS = ['Masaje hoy', 'Reiki online', 'Yoga en Pocitos', 'Acupuntura', 'Masaje a domicilio', 'Meditación esta semana'];

function categoryTile(c) {
  return html`<a class="cat" href="/${c.slug}" style="--c:${/^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#8B5CF6'}">
    <span class="cat__icon">${icon(c.icon || 'leaf', { size: 26 })}</span>
    <span class="cat__name">${c.name}</span>
    <span class="cat__count">${c.serviceCount ? `${c.serviceCount} ${c.serviceCount === 1 ? 'servicio' : 'servicios'}` : 'Próximamente'}</span>
  </a>`;
}

function resultsList(items, { ctx, favorites, grid = false }) {
  return html`<div class="${classes('results', grid && 'results--grid')}">${items.map((card) => C.serviceCard(card, { ctx, favorites }))}</div>`;
}

// ── Home ──────────────────────────────────────────────────
function home(ctx, d) {
  const u = ctx.user;
  const body = html`
  <section class="hero">
    <h1 class="hero__title">${u ? `Hola, ${u.name.split(' ')[0]}. ¿Qué necesitás hoy?` : '¿Qué necesitás hoy?'}</h1>
    <p class="hero__lead">Masajes, acupuntura, yoga, reiki y más, con especialistas de todo Uruguay. Reservás y pagás en un solo paso.</p>
    <form class="ask" action="/buscar" role="search">
      <span class="ask__icon">${icon('sparkle', { size: 22 })}</span>
      <input type="search" name="q" placeholder="Probá con “masaje hoy cerca”" aria-label="¿Qué estás buscando?" autocomplete="off">
      <button class="btn btn--primary" type="submit">Buscar</button>
    </form>
    <nav class="suggest" aria-label="Búsquedas sugeridas">${SUGGESTIONS.map((s) => html`<a href="/buscar?q=${encodeURIComponent(s)}">${s}</a>`)}</nav>
  </section>

  ${d.upcoming ? html`<a class="booking-card" href="/mi/reservas/${d.upcoming._id}" style="margin:8px 0 24px">
    ${datebox(d.upcoming.start)}
    <div class="list-row__main"><p class="list-row__sub">Tu próxima sesión</p><p class="list-row__title">${d.upcoming.snapshot.serviceTitle}</p><p class="list-row__sub">${d.upcoming.snapshot.specialistName} · ${D.fmtTime(d.upcoming.start)} h</p></div>
    ${icon('chevronRight')}
  </a>` : ''}

  <section class="section">
    <div class="section__head"><h2>Categorías</h2><a href="/categorias">Ver todas</a></div>
    <div class="cats">${d.categories.slice(0, 8).map(categoryTile)}</div>
  </section>

  ${d.sponsored?.length ? html`<section class="section sponsored-block"><div class="section__head"><h2>Recomendados</h2><span class="muted small">Espacios patrocinados</span></div>${resultsList(d.sponsored, { ctx, favorites: d.favorites, grid: true })}</section>` : ''}

  ${d.top.length ? html`<section class="section">
    <div class="section__head"><h2>Mejor valorados por quienes ya fueron</h2></div>
    ${resultsList(d.top, { ctx, favorites: d.favorites, grid: true })}
  </section>` : ''}

  ${d.fresh.length ? html`<section class="section">
    <div class="section__head"><h2>Nuevos en Alternativa</h2></div>
    <p class="muted">Especialistas que se sumaron hace poco. Todavía tienen pocas reseñas, por eso les damos un lugar propio.</p>
    ${resultsList(d.fresh, { ctx, favorites: d.favorites, grid: true })}
  </section>` : ''}

  <section class="section panel panel--soft">
    <div class="trust">
      <div class="trust__item">${icon('checkCircle', { size: 24 })}<p><strong>Reseñas verificadas</strong>Solo opina quien hizo la sesión reservada en Alternativa.</p></div>
      <div class="trust__item">${icon('card', { size: 24 })}<p><strong>Un solo pago</strong>Precio final claro y pago con Mercado Pago. No guardamos datos de tarjetas.</p></div>
      <div class="trust__item">${icon('repeat', { size: 24 })}<p><strong>Volvé en dos toques</strong>Repetí tu sesión favorita desde tu historial.</p></div>
    </div>
  </section>

  ${d.posts?.length ? html`<section class="section"><div class="section__head"><h2>Para leer</h2><a href="/blog">Ir al blog</a></div>
    <div>${d.posts.map((p) => html`<a class="post-card" href="/blog/${p.slug}"><h2>${p.title}</h2>${p.excerpt ? html`<p class="muted">${p.excerpt}</p>` : ''}</a>`)}</div></section>` : ''}

  ${!u?.specialist ? html`<section class="section panel panel--lav">
    <h2>¿Ofrecés terapias o clases?</h2>
    <p>Sumate a Alternativa: tu ficha, tu agenda online, cobros automáticos y estadísticas para hacer crecer tu práctica.</p>
    <a class="btn btn--lav" href="/ofrecer">Conocé cómo funciona para especialistas</a>
  </section>` : ''}`;

  return layout(ctx, {
    active: 'inicio', canonical: '/', body,
    jsonLd: { '@context': 'https://schema.org', '@type': 'WebSite', name: ctx.settings.site.name, url: ctx.appUrl, potentialAction: { '@type': 'SearchAction', target: `${ctx.appUrl}/buscar?q={search_term_string}`, 'query-input': 'required name=search_term_string' } },
  });
}

function datebox(date, muted = false) {
  const p = D.localParts(date);
  return html`<div class="${classes('datebox', muted && 'datebox--muted')}"><div class="datebox__d">${p.day}</div><div class="datebox__m">${D.MONTHS[p.month - 1].slice(0, 3)}</div></div>`;
}

// ── Búsqueda ──────────────────────────────────────────────
function intentNote(intent, total, category) {
  const parts = [];
  if (intent.when === 'today') parts.push('con turnos libres hoy');
  if (intent.when === 'tomorrow') parts.push('con turnos libres hasta mañana');
  if (intent.when === 'week') parts.push('con turnos libres esta semana');
  if (intent.modality) parts.push(MODALITIES[intent.modality].label.toLowerCase());
  if (intent.near) parts.push('ordenados por cercanía');
  if (intent.cheap) parts.push('priorizando precio');
  if (!parts.length && !category) return '';
  return html`<p class="intent-note">${total} ${total === 1 ? 'resultado' : 'resultados'}${category ? html` en <strong>${category.name}</strong>` : ''}${parts.length ? ` · ${parts.join(', ')}` : ''}</p>`;
}

function filterChip(label, href, on) {
  return html`<a class="${classes('filter-chip', on && 'is-on')}" href="${href}">${label}</a>`;
}

function qs(params, change) {
  const merged = { ...params, ...change };
  const map = { q: 'q', categoria: 'categoria', departamento: 'departamento', ciudad: 'ciudad', modality: 'modalidad', when: 'cuando', precioMax: 'precioMax', rating: 'valoracion', verificado: 'verificado', orden: 'orden', lat: 'lat', lng: 'lng' };
  const out = new URLSearchParams();
  for (const [k, name] of Object.entries(map)) {
    const v = merged[k];
    if (v !== undefined && v !== '' && v !== null && v !== false) out.set(name, v === true ? '1' : String(v));
  }
  return `/buscar?${out.toString()}`;
}

function searchFilters(ctx, d, { action = '/buscar', hiddenCategory } = {}) {
  const p = d.params;
  return html`<details class="filter-sheet"${attr('open', !!(p.departamento || p.precioMax || p.rating || p.verificado))}>
    <summary class="filter-chip">${icon('filter', { size: 16 })} Filtros</summary>
    <form class="filter-sheet__body panel" action="${action}">
      ${p.q ? html`<input type="hidden" name="q" value="${p.q}">` : ''}
      ${hiddenCategory ? '' : C.select({ label: 'Categoría', name: 'categoria', value: p.categoria, options: [['', 'Todas'], ...(d.categories || []).map((c) => [c.slug, c.name])] })}
      <div class="grid-2">
        ${C.select({ label: 'Departamento', name: 'departamento', value: p.departamento, options: [['', 'Todo Uruguay'], ...d.departments.map((x) => [x, x])] })}
        ${C.select({ label: 'Modalidad', name: 'modalidad', value: p.modality, options: [['', 'Todas'], ['presencial', 'Presencial'], ['domicilio', 'A domicilio'], ['online', 'Online']] })}
      </div>
      ${hiddenCategory ? '' : html`<div class="grid-2">
        ${C.select({ label: '¿Cuándo?', name: 'cuando', value: p.when, options: [['', 'Cualquier día'], ['today', 'Hoy'], ['tomorrow', 'Hasta mañana'], ['week', 'Esta semana']] })}
        ${C.select({ label: 'Valoración mínima', name: 'valoracion', value: p.rating, options: [['', 'Cualquiera'], ['4.5', '4,5 o más'], ['4', '4 o más']] })}
      </div>
      ${C.field({ label: 'Precio máximo (UYU)', name: 'precioMax', type: 'number', value: p.precioMax, min: 0, step: 50, inputmode: 'numeric' })}
      ${C.checkbox({ label: 'Solo identidad verificada', name: 'verificado', value: '1', checked: p.verificado })}`}
      <input type="hidden" name="lat" value="${p.lat || ''}"><input type="hidden" name="lng" value="${p.lng || ''}">
      <div class="form-actions"><button class="btn btn--primary" type="submit">Aplicar filtros</button><a class="btn btn--ghost" href="${hiddenCategory ? action : '/buscar'}">Limpiar</a></div>
    </form>
  </details>`;
}

function search(ctx, d) {
  const p = d.params;
  const r = d.result;
  const title = p.q ? `Resultados para “${p.q}”` : r.category ? r.category.name : 'Buscar servicios';
  const body = html`
    <form class="ask" action="/buscar" role="search" style="margin-top:0" id="searchform">
      <span class="ask__icon">${icon('search', { size: 20 })}</span>
      <input type="search" name="q" value="${p.q}" placeholder="Masaje hoy, reiki online, yoga en Pocitos…" aria-label="Buscar">
      ${p.categoria ? html`<input type="hidden" name="categoria" value="${p.categoria}">` : ''}
      <input type="hidden" name="lat" value="${p.lat || ''}"><input type="hidden" name="lng" value="${p.lng || ''}">
      <button class="btn btn--primary" type="submit">Buscar</button>
    </form>
    <div class="filters" style="margin-top:12px">
      ${filterChip('Hoy', qs(p, { when: p.when === 'today' ? '' : 'today', page: '' }), p.when === 'today' || r.intent.when === 'today')}
      ${filterChip('Esta semana', qs(p, { when: p.when === 'week' ? '' : 'week' }), p.when === 'week')}
      ${filterChip('A domicilio', qs(p, { modality: p.modality === 'domicilio' ? '' : 'domicilio' }), p.modality === 'domicilio')}
      ${filterChip('Online', qs(p, { modality: p.modality === 'online' ? '' : 'online' }), p.modality === 'online')}
      <button type="button" class="${classes('filter-chip', p.lat && 'is-on')}" data-near="#searchform">${icon('pin', { size: 16 })} Cerca de mí</button>
      ${filterChip('Mejor valorados', qs(p, { orden: p.orden === 'valoracion' ? '' : 'valoracion' }), p.orden === 'valoracion')}
      ${filterChip('Menor precio', qs(p, { orden: p.orden === 'precio' ? '' : 'precio' }), p.orden === 'precio')}
    </div>
    ${searchFilters(ctx, d)}
    ${intentNote(r.intent, r.total, r.category)}
    ${r.sponsored?.length ? html`<div class="sponsored-block">${resultsList(r.sponsored, { ctx, favorites: d.favorites })}</div>` : ''}
    ${r.items.length
    ? html`${resultsList(r.items, { ctx, favorites: d.favorites, grid: true })}${C.pagination(r, Object.fromEntries(new URLSearchParams(qs(p, {}).split('?')[1])), '/buscar')}`
    : C.empty({
      title: r.intent.when ? 'No encontramos turnos libres para ese momento' : 'No encontramos servicios con esa búsqueda',
      text: 'Probá con otras palabras, quitá algún filtro o mirá todas las categorías.',
      action: 'Ver categorías', href: '/categorias', iconName: 'search',
    })}`;
  return layout(ctx, { title, active: 'buscar', body, noindex: true });
}

function categories(ctx, d) {
  const body = html`${C.pageHead({ title: 'Categorías', subtitle: 'Terapias, prácticas corporales y disciplinas alternativas.' })}<div class="cats">${d.categories.map(categoryTile)}</div>`;
  return layout(ctx, { title: 'Categorías', active: 'buscar', canonical: '/categorias', body });
}

function category(ctx, d) {
  const c = d.category;
  const r = d.result;
  const body = html`
    <nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a><span>›</span><a href="/categorias">Categorías</a></nav>
    ${C.pageHead({ title: c.name, subtitle: c.description })}
    <div class="filters">
      ${filterChip('Todas', `/${c.slug}`, !d.params.modality && !d.params.departamento)}
      ${filterChip('Presencial', `/${c.slug}?modalidad=presencial`, d.params.modality === 'presencial')}
      ${filterChip('A domicilio', `/${c.slug}?modalidad=domicilio`, d.params.modality === 'domicilio')}
      ${filterChip('Online', `/${c.slug}?modalidad=online`, d.params.modality === 'online')}
      ${filterChip(`${c.name} hoy`, `/buscar?categoria=${c.slug}&cuando=today`, false)}
    </div>
    ${searchFilters(ctx, { ...d, params: { ...d.params, categoria: c.slug } }, { action: `/${c.slug}`, hiddenCategory: true })}
    ${r.sponsored?.length ? html`<div class="sponsored-block">${resultsList(r.sponsored, { ctx, favorites: d.favorites })}</div>` : ''}
    ${r.items.length
    ? html`${resultsList(r.items, { ctx, favorites: d.favorites, grid: true })}${C.pagination(r, { modalidad: d.params.modality, departamento: d.params.departamento }, `/${c.slug}`)}`
    : C.empty({ title: `Todavía no hay servicios de ${c.name.toLowerCase()} publicados`, text: '¿Ofrecés este servicio? Sumate y aparecé acá.', action: 'Ofrecé tus servicios', href: '/ofrecer' })}
    ${c.longDescription ? html`<section class="section prose">${markdown(c.longDescription)}</section>` : ''}
    ${d.posts?.length ? html`<section class="section"><h2>Sobre ${c.name.toLowerCase()}</h2>${d.posts.map((p) => html`<a class="post-card" href="/blog/${p.slug}"><h2>${p.title}</h2><p class="muted">${p.excerpt}</p></a>`)}</section>` : ''}`;
  return layout(ctx, {
    title: c.seo?.title || `${c.name} en Uruguay`, description: c.seo?.description || c.description, canonical: `/${c.slug}`, active: 'buscar', body,
    jsonLd: { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Inicio', item: ctx.appUrl }, { '@type': 'ListItem', position: 2, name: c.name, item: `${ctx.appUrl}/${c.slug}` }] },
  });
}

// ── Ficha pública del especialista ────────────────────────
function reviewItem(r, { showService = false, ctx, reasons } = {}) {
  return html`<article class="review" id="r-${r._id}">
    <div class="review__head"><span class="review__who">${r.authorName}</span>${C.stars(r.rating, 14)}</div>
    <p class="review__meta">${showService && r.service?.title ? html`${r.service.title} · ` : ''}${r.serviceDate ? D.fmtDateShort(r.serviceDate) : D.fmtDateShort(r.createdAt)} · <span class="review__verified">${icon('check', { size: 13 })}Reserva realizada</span>${r.status === 'under_review' ? html` · <span class="pill">En revisión</span>` : ''}</p>
    ${r.comment ? html`<p class="review__body">${r.comment}</p>` : ''}
    ${r.reply?.text ? html`<div class="review__reply"><strong>Respuesta del especialista</strong><br>${r.reply.text}</div>` : ''}
    ${ctx?.user && reasons ? html`<details class="small" style="margin-top:6px"><summary class="muted" style="cursor:pointer">Reportar reseña</summary>
      <form method="post" action="/reportar" class="stack" style="margin-top:8px">${C.csrfField(ctx)}<input type="hidden" name="targetType" value="review"><input type="hidden" name="targetId" value="${r._id}">
      ${C.select({ label: 'Motivo', name: 'reason', required: true, options: Object.entries(reasons) })}<button class="btn btn--sm btn--ghost">Enviar reporte</button></form></details>` : ''}
  </article>`;
}

function specialistProfile(ctx, d) {
  const sp = d.sp;
  const layoutOpts = sp.profileLayout || {};
  const featured = layoutOpts.featuredService ? d.cards.find((c) => String(c.service._id) === String(layoutOpts.featuredService)) : null;
  const totalReviews = d.cards.reduce((a, c) => a + (c.service.rating?.count || 0), 0);
  const where = sp.location?.addressPublicHint || [sp.location?.neighborhood, sp.location?.city, sp.location?.department].filter(Boolean).join(', ');
  const verified = sp.verification?.identity?.status === 'verified';

  const sections = {
    servicios: d.cards.length ? html`<section class="section" id="servicios"><h2>Servicios</h2><ul class="svc-list">
      ${d.cards.map((c) => html`<li class="${classes('svc', featured && c === featured && 'svc--featured')}">
        <div><h3 class="svc__title"><a href="/servicios/${sp.slug}/${c.service.slug}">${c.service.title}</a></h3></div>
        <div class="svc__meta"><span>${icon('clock', { size: 14 })} ${C.duration(c.service.durationMinutes)}</span>${c.service.rating?.count ? C.rating(c.service.rating, { verified: false }) : html`<span class="muted">Sin reseñas todavía</span>`}</div>
        <div class="svc__price"><strong>${fmtMoney(c.displayPrice)}</strong>${featured && c === featured ? html`<span class="pill pill--brand">Destacado</span>` : ''}</div>
      </li>`)}</ul></section>` : '',
    sobre: (sp.bio || sp.experience || sp.education || d.certifications.length) ? html`<section class="section" id="sobre"><h2>Sobre ${sp.displayName.split(' ')[0]}</h2>
      ${sp.bio ? html`<div class="prose">${paragraphs(sp.bio)}</div>` : ''}
      ${sp.experience ? html`<h3>Experiencia</h3><div class="prose">${paragraphs(sp.experience)}</div>` : ''}
      ${sp.education ? html`<h3>Formación</h3><div class="prose">${paragraphs(sp.education)}</div>` : ''}
      ${d.certifications.length ? html`<h3>Certificaciones</h3>${d.certifications.map((c) => html`<div class="${classes('cred', c.status === 'verified' ? 'cred--verified' : 'cred--declared')}">${icon(c.status === 'verified' ? 'shield' : 'file', { size: 18 })}<div><strong>${c.title}</strong>${c.issuer ? html` · ${c.issuer}` : ''}${c.year ? html` · ${c.year}` : ''}<br><span class="small ${c.status === 'verified' ? '' : 'muted'}">${c.status === 'verified' ? 'Certificación verificada por Alternativa' : 'Declarada por el especialista'}</span></div></div>`)}` : ''}
    </section>` : '',
    galeria: d.media.length ? html`<section class="section" id="galeria"><div class="section__head"><h2>Fotos</h2>${d.media.length > 8 ? html`<a href="/especialistas/${sp.slug}/galeria">Ver todas (${d.media.length})</a>` : ''}</div>
      <div class="gallery">${d.media.slice(0, 8).map((m) => html`<a href="/especialistas/${sp.slug}/galeria#m-${m._id}"><img src="${m.thumbUrl || m.url}" alt="${m.caption || `Foto de ${sp.displayName}`}" loading="lazy"></a>`)}</div></section>` : '',
    video: d.video ? html`<section class="section" id="video"><h2>Video de presentación</h2><div class="video-frame"><video src="${d.video.url}" controls preload="metadata" playsinline${d.video.thumbUrl ? html` poster="${d.video.thumbUrl}"` : ''}></video></div></section>` : '',
    resenas: html`<section class="section" id="resenas"><h2>Reseñas</h2>
      ${d.reviews.length ? html`<p class="muted small">Cada servicio tiene su propia valoración. Estas son las más recientes.</p>${d.reviews.map((r) => reviewItem(r, { showService: true }))}` : html`<p class="muted">Todavía no hay reseñas. Las reseñas en Alternativa son de personas que hicieron la sesión.</p>`}
    </section>`,
    ubicacion: where || sp.modalities?.length ? html`<section class="section" id="ubicacion"><h2>Dónde atiende</h2>
      <div class="stack">${(sp.modalities || []).map((m) => html`<p class="row" style="gap:8px">${icon(MODALITIES[m].icon, { size: 18 })} <span><strong>${MODALITIES[m].label}</strong>${m === 'presencial' && where ? html` · ${where}` : ''}${m === 'domicilio' && sp.location?.serviceRadiusKm ? html` · hasta ${sp.location.serviceRadiusKm} km${sp.location?.city ? ` desde ${sp.location.city}` : ''}` : ''}</span></p>`)}</div>
      ${sp.location?.geo?.coordinates?.length === 2 && (sp.modalities || []).includes('presencial') ? html`<p class="small muted">La dirección exacta se comparte al confirmar la reserva.</p>` : ''}
    </section>` : '',
  };
  let order = (layoutOpts.sectionOrder || []).filter((k) => sections[k] !== undefined);
  for (const k of Object.keys(sections)) if (!order.includes(k)) order.push(k);
  if (layoutOpts.showVideoFirst && d.video) order = ['video', ...order.filter((k) => k !== 'video')];

  const firstService = featured || d.cards[0];
  const coverStyle = d.cover ? `background-image:url('${String(d.cover.url).replace(/'/g, '%27')}')` : '';

  const body = html`
    ${d.preview ? html`<div class="flash flash--warn">${icon('eyeOff', { size: 18 })}<span>Vista previa: esta ficha todavía no es pública (${sp.status === 'pending_review' ? 'en revisión' : sp.status === 'draft' ? 'borrador' : sp.status}).</span></div>` : ''}
    <div class="${`variant-${layoutOpts.variant || 'clasica'}`}">
      <div class="profile-cover" style="${coverStyle}" role="img" aria-label="Portada"></div>
      <header class="profile-head">
        ${C.avatar({ url: d.avatar?.url, name: sp.displayName, size: 'xl' })}
        <div style="flex:1;min-width:0">
          <h1>${sp.displayName}</h1>
          ${sp.headline ? html`<p class="profile-head__headline">${sp.headline}</p>` : ''}
          <div class="profile-badges">
            ${verified ? C.verifiedBadge() : ''}
            ${totalReviews ? html`<span class="badge badge--declared">${icon('star', { size: 13 })}${totalReviews} reseñas verificadas</span>` : ''}
            ${sp.publishedAt && (Date.now() - new Date(sp.publishedAt).getTime()) < 90 * 86400000 && totalReviews < 5 ? C.newcomerBadge() : ''}
          </div>
        </div>
      </header>
    </div>
    <div class="layout-aside" style="margin-top:16px">
      <div>
        <div class="profile-facts">
          ${where ? html`<span>${icon('pin', { size: 16 })}${where}</span>` : ''}
          ${sp.yearsOfExperience ? html`<span>${icon('sparkle', { size: 16 })}${sp.yearsOfExperience} años de experiencia</span>` : ''}
          ${d.categories.length ? html`<span>${icon('leaf', { size: 16 })}${d.categories.map((c, i) => html`${i ? ', ' : ''}<a href="/${c.slug}">${c.name}</a>`)}</span>` : ''}
          ${sp.stats?.completedBookings ? html`<span>${icon('checkCircle', { size: 16 })}${sp.stats.completedBookings} sesiones realizadas</span>` : ''}
        </div>
        ${C.modalityChips(sp.modalities)}
        ${order.map((k) => sections[k])}
      </div>
      <aside>
        <div class="panel stack">
          ${firstService ? html`
            <p class="muted small" style="margin:0">Desde</p>
            <p style="margin:0;font-size:1.5rem;font-weight:800">${fmtMoney(Math.min(...d.cards.map((c) => c.displayPrice)))}</p>
            ${d.next ? C.nextSlotLabel(d.next) : html`<p class="small muted">Sin turnos libres en las próximas semanas.</p>`}
            ${sp.user ? html`<a class="btn btn--primary btn--block btn--lg" href="/reservar/${firstService.service._id}">Reservar</a>` : html`<p class="notice" style="margin:0">Este perfil todavía no fue activado por el especialista: las reservas online se habilitan cuando lo haga.</p>`}` : html`<p class="muted">Este especialista todavía no publicó servicios.</p>`}
          <div class="row">
            <a class="btn btn--ghost" style="flex:1" href="${ctx.user ? `/mi/mensajes/nuevo/${sp._id}` : '/login'}">${icon('chat', { size: 18 })}Escribir</a>
            ${C.favButton({ kind: 'specialist', id: sp._id, active: d.favorites.has(String(sp._id)), ctx })}
          </div>
          ${d.isOwner ? html`<a class="btn btn--text" href="/panel/perfil">${icon('edit', { size: 16 })}Editar mi ficha</a>` : ''}
        </div>
        ${ctx.user && !d.isOwner ? html`<details class="small" style="margin-top:12px"><summary class="muted" style="cursor:pointer">${icon('flag', { size: 14 })} Reportar este perfil</summary>
          <form method="post" action="/reportar" class="stack panel" style="margin-top:8px">${C.csrfField(ctx)}<input type="hidden" name="targetType" value="specialist"><input type="hidden" name="targetId" value="${sp._id}">
          ${C.select({ label: 'Motivo', name: 'reason', required: true, options: [['fake', 'Información falsa'], ['fraud', 'Fraude o abuso'], ['offensive', 'Contenido inapropiado'], ['other', 'Otro motivo']] })}
          ${C.field({ label: 'Detalle', name: 'details', type: 'textarea', rows: 3 })}<button class="btn btn--sm btn--ghost">Enviar reporte</button></form></details>` : ''}
      </aside>
    </div>`;

  const ratingAll = d.cards.filter((c) => c.service.rating?.count);
  const agg = ratingAll.reduce((a, c) => ({ sum: a.sum + c.service.rating.sum, count: a.count + c.service.rating.count }), { sum: 0, count: 0 });
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'LocalBusiness', name: sp.displayName, description: sp.headline || undefined,
    url: `${ctx.appUrl}/especialistas/${sp.slug}`, image: d.avatar?.url ? (d.avatar.url.startsWith('http') ? d.avatar.url : `${ctx.appUrl}${d.avatar.url}`) : undefined,
    address: sp.location?.city ? { '@type': 'PostalAddress', addressLocality: sp.location.city, addressRegion: sp.location.department, addressCountry: 'UY' } : undefined,
    aggregateRating: agg.count ? { '@type': 'AggregateRating', ratingValue: Math.round((agg.sum / agg.count) * 10) / 10, reviewCount: agg.count } : undefined,
    makesOffer: d.cards.map((c) => ({ '@type': 'Offer', price: c.displayPrice, priceCurrency: 'UYU', itemOffered: { '@type': 'Service', name: c.service.title } })),
  };
  return layout(ctx, {
    title: `${sp.displayName}${sp.headline ? ` — ${sp.headline}` : ''}`,
    description: (sp.bio || sp.headline || '').slice(0, 155),
    canonical: `/especialistas/${sp.slug}`, image: d.avatar?.url, body, jsonLd, noindex: d.preview, active: 'buscar',
  });
}

function gallery(ctx, d) {
  const body = html`${C.pageHead({ title: `Fotos de ${d.sp.displayName}`, back: `/especialistas/${d.sp.slug}` })}
    ${d.video ? html`<div class="video-frame" style="margin-bottom:16px"><video src="${d.video.url}" controls preload="metadata" playsinline></video></div>` : ''}
    ${d.media.length ? html`<div class="gallery-full">${d.media.map((m) => html`<figure id="m-${m._id}"><img src="${m.url}" alt="${m.caption || ''}" loading="lazy">${m.caption ? html`<figcaption>${m.caption}</figcaption>` : ''}</figure>`)}</div>` : C.empty({ title: 'Todavía no hay fotos', iconName: 'image' })}`;
  return layout(ctx, { title: `Fotos de ${d.sp.displayName}`, canonical: `/especialistas/${d.sp.slug}/galeria`, body, active: 'buscar' });
}

// ── Detalle de servicio ───────────────────────────────────
function ratingSummary(service) {
  const r = service.rating || {};
  if (!r.count) return html`<p class="muted">Este servicio todavía no tiene reseñas. Las reseñas son de personas que hicieron la sesión con reserva en Alternativa.</p>`;
  const dist = r.distribution || [0, 0, 0, 0, 0];
  return html`<div class="row" style="align-items:flex-start;gap:24px">
    <div><p class="big-rating">${C.fmtRating(r.avg)}</p>${C.stars(Math.round(r.avg))}<p class="small muted">${r.count} reseñas verificadas</p></div>
    <div class="dist" style="flex:1;min-width:180px">${[5, 4, 3, 2, 1].map((n) => html`<div class="dist__row"><span>${n}★</span><span class="dist__bar"><span style="width:${r.count ? Math.round((dist[n - 1] / r.count) * 100) : 0}%"></span></span><span class="muted">${dist[n - 1]}</span></div>`)}</div>
  </div>`;
}

function priceLines(ctx, b, { promo } = {}) {
  const s = ctx.settings;
  const showBreakdown = s.commission.priceDisplay === 'breakdown' && b.mode === 'added';
  return html`<div class="summary">
    ${showBreakdown ? html`
      <div class="summary__row"><span>Servicio</span><span>${fmtMoney(b.subtotal)}</span></div>
      ${b.discount && promo?.fundedBy !== 'platform' ? html`<div class="summary__row"><span>${promo?.title || 'Descuento'}</span><span>−${fmtMoney(b.discount)}</span></div>` : ''}
      <div class="summary__row"><span>${s.commission.feeLabel}</span><span>${fmtMoney(b.commissionAmount + (promo?.fundedBy === 'platform' ? b.discount : 0))}</span></div>
      ${b.discount && promo?.fundedBy === 'platform' ? html`<div class="summary__row"><span>${promo?.title || 'Descuento'}</span><span>−${fmtMoney(b.discount)}</span></div>` : ''}
      ${b.processorPaidBy === 'customer' && b.processorFee ? html`<div class="summary__row"><span>Costo de procesamiento del pago</span><span>${fmtMoney(b.processorFee)}</span></div>` : ''}`
    : b.discount ? html`<div class="summary__row"><span>${promo?.title || 'Descuento'}</span><span>−${fmtMoney(b.discount)}</span></div>` : ''}
    <div class="summary__row summary__row--total"><span>Total</span><span>${fmtMoney(b.total)}</span></div>
  </div>`;
}

function serviceDetail(ctx, d) {
  const { sp, service: s } = d;
  const mods = s.modalities?.length ? s.modalities : sp.modalities || [];
  const body = html`
    <nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a><span>›</span>${s.category ? html`<a href="/${s.category.slug}">${s.category.name}</a><span>›</span>` : ''}<a href="/especialistas/${sp.slug}">${sp.displayName}</a></nav>
    ${d.preview ? html`<div class="flash flash--warn">${icon('eyeOff', { size: 18 })}<span>Vista previa: todavía no es público.</span></div>` : ''}
    <div class="layout-aside">
      <div>
        <h1>${s.title}</h1>
        <a class="list-row" href="/especialistas/${sp.slug}" style="margin:8px 0 12px">${C.avatar({ url: d.avatar?.thumbUrl || d.avatar?.url, name: sp.displayName, size: 'md' })}<div class="list-row__main"><p class="list-row__title">${sp.displayName}</p><p class="list-row__sub">${sp.verification?.identity?.status === 'verified' ? 'Identidad verificada · ' : ''}Ver perfil completo</p></div></a>
        <div class="row" style="gap:8px 16px">
          ${s.rating?.count ? C.rating(s.rating) : html`<span class="muted small">Sin reseñas todavía</span>`}
          <span class="row" style="gap:6px">${icon('clock', { size: 16 })}${C.duration(s.durationMinutes)}</span>
        </div>
        <div style="margin-top:10px">${C.modalityChips(mods)}</div>
        ${d.photos.length ? html`<div class="gallery" style="margin-top:16px">${d.photos.map((m) => html`<a href="${m.url}"><img src="${m.thumbUrl || m.url}" alt="${m.caption || s.title}" loading="lazy"></a>`)}</div>` : ''}
        ${s.summary ? html`<p style="margin-top:16px;font-size:1.05rem">${s.summary}</p>` : ''}
        ${s.description ? html`<div class="prose">${paragraphs(s.description)}</div>` : ''}
        ${s.includes?.length ? html`<h3>Qué incluye</h3><ul class="checklist">${s.includes.map((i) => html`<li><span>${icon('check', { size: 18 })}${i}</span></li>`)}</ul>` : ''}
        ${s.preparation ? html`<h3 style="margin-top:20px">Antes de la sesión</h3><div class="prose">${paragraphs(s.preparation)}</div>` : ''}
        ${mods.includes('domicilio') && s.homeServiceExtra ? html`<p class="small muted">A domicilio se suma un recargo de ${fmtMoney(s.homeServiceExtra)} del especialista por traslado.</p>` : ''}
        <section class="section" id="resenas">
          <div class="section__head"><h2>Reseñas de este servicio</h2>${s.rating?.count > 5 ? html`<a href="/servicios/${sp.slug}/${s.slug}/resenas">Ver todas</a>` : ''}</div>
          ${ratingSummary(s)}
          ${d.reviews.map((r) => reviewItem(r))}
        </section>
        ${d.others.length ? html`<section class="section"><h2>Otros servicios de ${sp.displayName.split(' ')[0]}</h2><ul class="svc-list">${d.others.map((o) => html`<li class="svc"><div><h3 class="svc__title"><a href="/servicios/${sp.slug}/${o.service.slug}">${o.service.title}</a></h3></div><div class="svc__meta">${C.duration(o.service.durationMinutes)} ${o.service.rating?.count ? C.rating(o.service.rating, { compact: true }) : ''}</div><div class="svc__price"><strong>${fmtMoney(o.displayPrice)}</strong></div></li>`)}</ul></section>` : ''}
      </div>
      <aside>
        <div class="panel stack">
          ${priceLines(ctx, d.breakdown)}
          ${d.next ? C.nextSlotLabel(d.next) : html`<p class="small muted" style="margin:0">Sin turnos libres en las próximas semanas.</p>`}
          ${sp.user ? html`<a class="btn btn--primary btn--block btn--lg" href="/reservar/${s._id}">Elegir día y hora</a>` : html`<p class="notice" style="margin:0">Las reservas online se habilitan cuando el especialista active su perfil.</p>`}
          <div class="row"><a class="btn btn--ghost" style="flex:1" href="${ctx.user ? `/mi/mensajes/nuevo/${sp._id}` : '/login'}">${icon('chat', { size: 18 })}Consultar</a>${C.favButton({ kind: 'service', id: s._id, active: d.favorites.has(String(s._id)), ctx })}</div>
          <p class="small muted" style="margin:0">Pagás una sola vez con Mercado Pago. <a href="/cancelaciones">Política de cancelaciones</a>.</p>
        </div>
      </aside>
    </div>
    <div class="sticky-cta mobile-only"${sp.user ? '' : ' hidden'}><div><strong>${fmtMoney(d.breakdown.total)}</strong><br><span class="small muted">${C.duration(s.durationMinutes)}</span></div><a class="btn btn--primary" href="/reservar/${s._id}">Reservar</a></div>`;

  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Service', name: s.title, description: s.summary || undefined,
    provider: { '@type': 'LocalBusiness', name: sp.displayName, url: `${ctx.appUrl}/especialistas/${sp.slug}` },
    areaServed: sp.location?.department ? { '@type': 'AdministrativeArea', name: sp.location.department } : 'UY',
    offers: { '@type': 'Offer', price: d.breakdown.total, priceCurrency: 'UYU' },
    aggregateRating: s.rating?.count ? { '@type': 'AggregateRating', ratingValue: s.rating.avg, reviewCount: s.rating.count } : undefined,
  };
  return layout(ctx, {
    title: `${s.title} con ${sp.displayName}`, description: (s.summary || s.description || '').slice(0, 155),
    canonical: `/servicios/${sp.slug}/${s.slug}`, body, jsonLd, noindex: d.preview, active: 'buscar',
  });
}

function serviceReviews(ctx, d) {
  const base = `/servicios/${d.sp.slug}/${d.service.slug}/resenas`;
  const body = html`${C.pageHead({ title: `Reseñas: ${d.service.title}`, subtitle: d.sp.displayName, back: `/servicios/${d.sp.slug}/${d.service.slug}` })}
    ${ratingSummary(d.service)}
    <div class="filters" style="margin-top:16px">${filterChip('Todas', base, !d.stars)}${[5, 4, 3, 2, 1].map((n) => filterChip(`${n} ★`, `${base}?estrellas=${n}`, String(d.stars) === String(n)))}</div>
    ${d.reviews.length ? d.reviews.map((r) => reviewItem(r, { ctx, reasons: d.reasons })) : C.empty({ title: 'No hay reseñas con ese filtro', iconName: 'star' })}
    ${C.pagination({ page: d.page, pages: d.pages }, { estrellas: d.stars }, base)}`;
  return layout(ctx, { title: `Reseñas de ${d.service.title} — ${d.sp.displayName}`, canonical: base, body, active: 'buscar' });
}

// ── Contenido ─────────────────────────────────────────────
function contentPage(ctx, { page, slug }) {
  const body = html`<article class="prose">${C.pageHead({ title: page.title, subtitle: page.excerpt })}${markdown(page.body)}</article>
    ${slug === 'como-funciona' ? html`<div class="btnbar"><a class="btn btn--primary" href="/buscar">Buscar servicios</a><a class="btn btn--ghost" href="/ofrecer">Soy especialista</a></div>` : ''}`;
  return layout(ctx, { title: page.seo?.title || page.title, description: page.seo?.description || page.excerpt, canonical: `/${slug}`, body });
}

function cancellationPolicy(ctx, { page, rules }) {
  const body = html`<article class="prose">${C.pageHead({ title: 'Política de cancelaciones', subtitle: 'Cuándo y cuánto se reembolsa.' })}
    <div class="panel panel--blue"><ul>${rules.map((r) => html`<li>${r}</li>`)}</ul></div>
    ${page ? markdown(page.body) : ''}</article>`;
  return layout(ctx, { title: 'Política de cancelaciones', canonical: '/cancelaciones', body });
}

function faq(ctx, { faqs }) {
  const groups = {};
  for (const f of faqs) (groups[f.category || 'General'] = groups[f.category || 'General'] || []).push(f);
  const body = html`${C.pageHead({ title: 'Preguntas frecuentes' })}
    <div class="faq">${Object.entries(groups).map(([g, list]) => html`<h2 style="margin-top:24px">${g}</h2>${list.map((f) => html`<details><summary>${f.title}</summary><div>${markdown(f.body)}</div></details>`)}`)}</div>
    <div class="panel panel--soft" style="margin-top:24px"><p style="margin:0">¿No encontraste tu respuesta? <a href="/contacto">Escribinos</a>.</p></div>`;
  return layout(ctx, {
    title: 'Preguntas frecuentes', canonical: '/preguntas-frecuentes', body,
    jsonLd: { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.title, acceptedAnswer: { '@type': 'Answer', text: f.body } })) },
  });
}

function offer(ctx, { settings }) {
  const rate = String(settings.commission.globalRate).replace('.', ',');
  const body = html`
    <section class="hero" style="padding-bottom:12px">
      <h1 class="hero__title">Tu práctica, con agenda y cobros resueltos</h1>
      <p class="hero__lead">Publicá tus servicios, recibí reservas pagas y seguí tus números. Vos ponés el precio; Alternativa suma una tarifa de servicio del ${rate}% que paga el cliente.</p>
      <div class="btnbar">${ctx.user ? html`<a class="btn btn--lav btn--lg" href="/panel/comenzar">Crear mi ficha</a>` : html`<a class="btn btn--lav btn--lg" href="/registro?tipo=especialista">Crear mi cuenta de especialista</a>`}<a class="btn btn--ghost btn--lg" href="/como-funciona">Cómo funciona</a></div>
    </section>
    <section class="section grid-2">
      <div class="panel"><h3>${icon('calendar', { size: 20 })} Agenda que se ordena sola</h3><p class="muted">Definís días, horarios, descansos y vacaciones. Los turnos libres se calculan automáticamente y nunca se superponen dos reservas.</p></div>
      <div class="panel"><h3>${icon('card', { size: 20 })} Cobro automático</h3><p class="muted">Vinculás tu cuenta de Mercado Pago y cada pago se divide al instante: tu parte va directo a tu cuenta.</p></div>
      <div class="panel"><h3>${icon('star', { size: 20 })} Reputación por servicio</h3><p class="muted">Cada servicio acumula sus propias reseñas verificadas. Podés responderlas y pedir revisión si alguna incumple las reglas.</p></div>
      <div class="panel"><h3>${icon('chart', { size: 20 })} Tus números</h3><p class="muted">Visitas, consultas, reservas, clientes nuevos y recurrentes, ingresos, horarios con más demanda.</p></div>
    </section>
    <section class="section panel panel--lav"><h2>Ejemplo con un servicio de $900</h2>
      <div class="summary" style="max-width:420px">
        <div class="summary__row"><span>Tu precio</span><span>$900</span></div>
        <div class="summary__row"><span>${settings.commission.feeLabel} (${rate}%)</span><span>${fmtMoney(Math.round(900 * settings.commission.globalRate / 100))}</span></div>
        <div class="summary__row summary__row--total"><span>Paga el cliente</span><span>${fmtMoney(900 + Math.round(900 * settings.commission.globalRate / 100))}</span></div>
      </div>
      <p class="small muted" style="margin-top:12px">Mercado Pago cobra su propia comisión por procesar el pago según las condiciones de tu cuenta.</p>
    </section>`;
  return layout(ctx, { title: 'Ofrecé tus servicios en Alternativa', canonical: '/ofrecer', body });
}

function contact(ctx, { values = {}, errors = {} }) {
  const body = html`<div class="form">${C.pageHead({ title: 'Contacto', subtitle: 'Respondemos por email, normalmente en el día.' })}
    <form method="post" action="/contacto" novalidate>${C.csrfField(ctx)}
      ${C.field({ label: 'Tu nombre', name: 'name', value: values.name, required: true, error: errors.name, autocomplete: 'name' })}
      ${C.field({ label: 'Email', name: 'email', type: 'email', value: values.email, required: true, error: errors.email, autocomplete: 'email' })}
      ${C.select({ label: 'Tema', name: 'topic', value: values.topic, required: true, options: [['booking', 'Una reserva'], ['payment', 'Un pago'], ['refund', 'Un reembolso'], ['account', 'Mi cuenta'], ['specialist', 'Soy especialista'], ['technical', 'Un problema técnico'], ['other', 'Otro']] })}
      ${C.field({ label: 'Asunto', name: 'subject', value: values.subject, required: true, error: errors.subject })}
      ${C.field({ label: 'Mensaje', name: 'message', type: 'textarea', rows: 6, value: values.message, required: true, error: errors.message })}
      <div style="position:absolute;left:-9999px" aria-hidden="true"><label>No completar <input name="website" tabindex="-1" autocomplete="off"></label></div>
      <button class="btn btn--primary" type="submit">Enviar mensaje</button>
    </form></div>`;
  return layout(ctx, { title: 'Contacto', canonical: '/contacto', body });
}

function blog(ctx, d) {
  const body = html`${C.pageHead({ title: 'Blog', subtitle: 'Notas sobre terapias, bienestar y cómo elegir especialista.' })}
    ${d.topics.length ? html`<div class="filters">${filterChip('Todo', '/blog', !d.topic)}${d.topics.map((t) => filterChip(t, `/blog?tema=${encodeURIComponent(t)}`, d.topic === t))}</div>` : ''}
    ${d.posts.length ? d.posts.map((p) => html`<a class="post-card" href="/blog/${p.slug}"><h2>${p.title}</h2>${p.excerpt ? html`<p class="muted" style="margin:0 0 4px">${p.excerpt}</p>` : ''}<p class="small muted" style="margin:0">${p.publishedAt ? D.fmtDateShort(p.publishedAt) : ''}${p.category ? ` · ${p.category}` : ''}</p></a>`) : C.empty({ title: 'Todavía no hay artículos', iconName: 'file' })}
    ${C.pagination(d, { tema: d.topic }, '/blog')}`;
  return layout(ctx, { title: 'Blog', canonical: '/blog', body });
}

function article(ctx, { post, related }) {
  const body = html`<article class="prose">
    <nav class="breadcrumb"><a href="/blog">Blog</a>${post.category ? html`<span>›</span><a href="/blog?tema=${encodeURIComponent(post.category)}">${post.category}</a>` : ''}</nav>
    <h1>${post.title}</h1>
    <p class="muted">${post.publishedAt ? D.fmtDate(post.publishedAt) : ''}</p>
    ${post.coverUrl ? html`<img src="${post.coverUrl}" alt="" style="border-radius:var(--r-card);margin:16px 0">` : ''}
    ${markdown(post.body)}
  </article>
  ${related.length ? html`<section class="section"><h2>Seguí leyendo</h2>${related.map((p) => html`<a class="post-card" href="/blog/${p.slug}"><h2>${p.title}</h2><p class="muted">${p.excerpt}</p></a>`)}</section>` : ''}`;
  return layout(ctx, {
    title: post.seo?.title || post.title, description: post.seo?.description || post.excerpt, canonical: `/blog/${post.slug}`, image: post.coverUrl, body,
    jsonLd: { '@context': 'https://schema.org', '@type': 'Article', headline: post.title, datePublished: post.publishedAt, dateModified: post.updatedAt, image: post.coverUrl || undefined, publisher: { '@type': 'Organization', name: ctx.settings.site.name } },
  });
}

module.exports = {
  home, search, categories, category, specialistProfile, gallery, serviceDetail, serviceReviews, contentPage, cancellationPolicy, faq, offer, contact, blog, article,
  reviewItem, priceLines, datebox, categoryTile, ratingSummary,
};
