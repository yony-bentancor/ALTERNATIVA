'use strict';
const { html, attr, classes } = require('../lib/html');
const { fmtMoney, fmtPercent } = require('../lib/money');
const D = require('../lib/dates');
const { MODALITIES, SERVICE_STATUS, SPECIALIST_STATUS, PAYMENT_STATUS, COLLECTION_MODELS, BOOKING_STATUS } = require('../lib/constants');
const { layout, SPECIALIST_SIDE } = require('./layout');
const { icon } = require('./icons');
const C = require('./components');
const { datebox } = require('./public');

const page = (ctx, title, active, body, o = {}) => layout(ctx, { title, active, body, area: 'specialist', noindex: true, ...o });

const PERIODS = [['7d', '7 días'], ['30d', '30 días'], ['90d', '90 días'], ['365d', '12 meses']];
function periodTabs(base, current) {
  return C.tabs(PERIODS.map(([k, l]) => [k, `${base}?periodo=${k}`, l]), current);
}

const MOD_OPTS = [['presencial', 'Presencial (consultorio)'], ['domicilio', 'A domicilio'], ['online', 'Online']];

// ── Alta ──────────────────────────────────────────────────
function onboarding(ctx, { categories, values = {}, errors = {}, departments }) {
  const body = html`<div class="form" style="margin:0 auto">
    ${C.pageHead({ title: 'Creá tu ficha de especialista', subtitle: 'Empezamos con lo básico. Después sumás servicios, fotos y horarios.' })}
    <form method="post" action="/panel/comenzar">${C.csrfField(ctx)}
      ${C.field({ label: 'Nombre profesional', name: 'displayName', value: values.displayName, required: true, error: errors.displayName, hint: 'Como querés que te encuentren: tu nombre o el de tu espacio.' })}
      ${C.field({ label: 'Frase de presentación', name: 'headline', value: values.headline, maxlength: 160, placeholder: 'Masajista terapéutica con 10 años de experiencia' })}
      ${C.checkGroup({ label: 'Categorías', name: 'categories', options: categories.map((c) => [c._id, c.name]), values: [].concat(values.categories || []) })}
      ${errors.categories ? html`<p class="field__error">${errors.categories}</p>` : ''}
      ${C.checkGroup({ label: '¿Cómo atendés?', name: 'modalities', options: MOD_OPTS, values: [].concat(values.modalities || ['presencial']) })}
      ${errors.modalities ? html`<p class="field__error">${errors.modalities}</p>` : ''}
      <div class="grid-2">${C.select({ label: 'Departamento', name: 'department', required: true, value: values.department || 'Montevideo', options: departments.map((x) => [x, x]) })}
      ${C.field({ label: 'Ciudad o barrio', name: 'city', value: values.city, required: true, error: errors.city })}</div>
      <p class="small muted">¿No encontrás tu disciplina? Elegí la más cercana y escribinos desde Ayuda para sumar una categoría.</p>
      <button class="btn btn--lav btn--lg">Crear mi ficha</button>
    </form></div>`;
  return layout(ctx, { title: 'Crear ficha', body, noindex: true });
}

// ── Inicio ────────────────────────────────────────────────
function dashboard(ctx, d) {
  const { sp, stats: s, completeness: c } = d;
  const statusBox = sp.status === 'active'
    ? html`<div class="panel row row--between"><span>${C.pill('Publicada', 'ok')} Tu ficha está visible.</span><a href="/especialistas/${sp.slug}" class="btn btn--ghost btn--sm">${icon('eye', { size: 16 })}Ver ficha pública</a></div>`
    : sp.status === 'pending_review'
      ? html`<div class="panel panel--blue">${icon('clock', { size: 18 })} <strong>Tu ficha está en revisión.</strong> Te avisamos cuando esté publicada.</div>`
      : sp.status === 'suspended'
        ? html`<div class="panel panel--warn">${icon('alert', { size: 18 })} <strong>Tu ficha está suspendida.</strong> ${sp.statusReason || ''} Escribinos desde <a href="/panel/ayuda">Ayuda</a>.</div>`
        : html`<div class="panel panel--lav stack">
          <div class="row row--between"><h2 style="margin:0">Completá tu ficha para publicarla</h2><strong>${c.percent}%</strong></div>
          <div class="progress"><span style="width:${c.percent}%"></span></div>
          <ul class="checklist">${c.checks.map((x) => html`<li>${x.ok ? html`<span class="is-ok">${icon('checkCircle', { size: 18 })}${x.label}</span>` : html`<a href="${x.href}">${icon('plus', { size: 18 })}${x.label}</a>`}</li>`)}</ul>
          <form method="post" action="/panel/publicar">${C.csrfField(ctx)}<button class="btn btn--lav"${attr('disabled', !c.ready)}>${sp.status === 'inactive' ? 'Volver a publicar' : 'Publicar mi ficha'}</button></form>
        </div>`;
  const body = html`
    ${C.pageHead({ title: `Hola, ${ctx.user.name.split(' ')[0]}`, subtitle: sp.displayName })}
    ${statusBox}
    ${sp.claim?.status === 'claimed' && sp.verification?.identity?.status === 'none' && !d.pendingClaimVerification ? html`<div class="flash flash--warn" style="margin-top:12px">${icon('shield', { size: 18 })}<span>Verificá tu identidad para mostrar el sello “Identidad verificada”. <a href="/panel/verificacion">Verificar ahora</a></span></div>` : ''}
    ${d.toConfirm.length ? html`<section class="section"><div class="section__head"><h2>Para confirmar</h2><a href="/panel/reservas?tab=confirmar">Ver todas</a></div><div class="stack">${d.toConfirm.map((b) => bookingCard(b))}</div></section>` : ''}
    <section class="section">
      <div class="section__head"><h2>Hoy</h2><a href="/panel/agenda?vista=dia">Agenda del día</a></div>
      ${d.today.length ? html`<ul class="day-agenda panel">${d.today.map((b) => html`<li><time>${D.fmtTime(b.start)}</time><a class="list-row" href="/panel/reservas/${b._id}"><div class="list-row__main"><p class="list-row__title">${b.snapshot.userName}</p><p class="list-row__sub">${b.snapshot.serviceTitle} · ${MODALITIES[b.modality].label}</p></div>${C.statusPill(b.status)}</a></li>`)}</ul>`
    : html`<p class="muted">No tenés sesiones hoy. ${d.upcomingCount ? `Tenés ${d.upcomingCount} reservas próximas.` : ''}</p>`}
    </section>
    <section class="section">
      <div class="section__head"><h2>Últimos 30 días</h2><a href="/panel/estadisticas">Estadísticas</a></div>
      <div class="grid-kpi">
        ${C.kpi('Visualizaciones', s.views.toLocaleString('es-UY'))}
        ${C.kpi('Consultas de disponibilidad', s.availabilityChecks.toLocaleString('es-UY'))}
        ${C.kpi('Reservas', s.bookings, `Conversión ${String(s.conversion).replace('.', ',')}%`)}
        ${C.kpi('Ingresos', fmtMoney(s.revenue), 'Estimado neto')}
        ${C.kpi('Clientes nuevos', s.newClients)}
        ${C.kpi('Recurrentes', s.returningClients, `Repetición ${String(s.repeatRate).replace('.', ',')}%`)}
        ${C.kpi('Servicio más reservado', s.topService ? s.topService.title : '—')}
        ${C.kpi('Horario con más demanda', s.busiestHour !== null ? `${D.pad(s.busiestHour)}:00 h` : '—')}
      </div>
    </section>
    ${d.recentReviews.length ? html`<section class="section"><div class="section__head"><h2>Reseñas recientes</h2><a href="/panel/resenas">Ver todas</a></div>
      <div class="panel">${d.recentReviews.map((r) => html`<div class="review"><div class="review__head"><span class="review__who">${r.authorName}</span>${C.stars(r.rating, 14)}</div><p class="review__meta">${r.service?.title} · ${D.fmtRelative(r.createdAt)}</p>${r.comment ? html`<p class="review__body">${r.comment}</p>` : ''}${!r.reply?.text ? html`<a class="small" href="/panel/resenas#r-${r._id}">Responder</a>` : ''}</div>`)}</div></section>` : ''}`;
  return page(ctx, 'Panel', 'inicio', body);
}

function more(ctx) {
  const body = html`${C.pageHead({ title: 'Más opciones' })}
    ${SPECIALIST_SIDE.map(([title, links]) => html`<section class="section"><h2 style="font-size:.95rem" class="muted">${title}</h2><ul class="list panel">${links.map(([, href, label, ic]) => html`<li><a class="list-row" href="${href}">${icon(ic)}<span class="list-row__main">${label}</span>${icon('chevronRight', { size: 16 })}</a></li>`)}</ul></section>`)}
    <ul class="list panel"><li><a class="list-row" href="/mi">${icon('user')}<span class="list-row__main">Mi cuenta personal</span></a></li><li><a class="list-row" href="/">${icon('home')}<span class="list-row__main">Ir al sitio</span></a></li></ul>`;
  return page(ctx, 'Más', 'mas', body);
}

function bookingCard(b) {
  return html`<a class="booking-card" href="/panel/reservas/${b._id}">${datebox(b.start)}<div class="list-row__main"><p class="list-row__title">${b.snapshot.userName}</p><p class="list-row__sub">${b.snapshot.serviceTitle} · ${D.fmtTime(b.start)} h · ${MODALITIES[b.modality].label}</p><div style="margin-top:6px">${C.statusPill(b.status)}</div></div>${icon('chevronRight')}</a>`;
}

// ── Perfil ────────────────────────────────────────────────
function profile(ctx, { sp, completeness, categories, avatar, cover }) {
  const verif = sp.verification?.identity?.status;
  const body = html`${C.pageHead({ title: 'Mi perfil', actions: html`<a class="btn btn--ghost btn--sm" href="/especialistas/${sp.slug}">${icon('eye', { size: 16 })}Vista pública</a><a class="btn btn--primary btn--sm" href="/panel/perfil/editar">${icon('edit', { size: 16 })}Editar</a>` })}
    ${sp.pendingChanges?.length ? html`<div class="flash flash--warn">${icon('clock', { size: 18 })}<span>Cambios en revisión: ${sp.pendingChanges.map((p) => (p.field === 'displayName' ? `nombre (“${p.value}”)` : 'categorías')).join(', ')}.</span></div>` : ''}
    <div class="panel stack">
      ${cover ? html`<img src="${cover.thumbUrl || cover.url}" alt="" style="border-radius:var(--r-card);max-height:160px;width:100%;object-fit:cover">` : ''}
      <div class="row">${C.avatar({ url: avatar?.thumbUrl || avatar?.url, name: sp.displayName, size: 'lg' })}<div><h2 style="margin:0">${sp.displayName}</h2><p class="muted" style="margin:0">${sp.headline || 'Sin frase de presentación'}</p></div></div>
      ${C.dl([
    ['Estado', html`${C.pill(SPECIALIST_STATUS[sp.status], sp.status === 'active' ? 'ok' : 'warn')}`],
    ['Identidad', verif === 'verified' ? C.pill('Verificada', 'ok') : verif === 'pending' ? C.pill('En revisión', 'info') : html`<a href="/panel/verificacion">Verificar</a>`],
    ['Categorías', categories.map((c) => c.name).join(', ') || '—'],
    ['Modalidades', (sp.modalities || []).map((m) => MODALITIES[m].label).join(', ') || '—'],
    ['Ubicación', [sp.location?.neighborhood, sp.location?.city, sp.location?.department].filter(Boolean).join(', ') || '—'],
    ['Dirección pública', sp.location?.addressPublicHint || '—'],
    ['Ficha completa', `${completeness.percent}%`],
  ])}
    </div>
    <div class="grid-2 section">
      <a class="panel list-row" href="/panel/perfil/multimedia">${icon('image')}<div class="list-row__main"><p class="list-row__title">Fotos y video</p><p class="list-row__sub">Foto de perfil, portada, galería, video</p></div>${icon('chevronRight')}</a>
      <a class="panel list-row" href="/panel/perfil/apariencia">${icon('layers')}<div class="list-row__main"><p class="list-row__title">Apariencia de la ficha</p><p class="list-row__sub">Estilo, orden de secciones, servicio destacado</p></div>${icon('chevronRight')}</a>
      <a class="panel list-row" href="/panel/certificaciones">${icon('file')}<div class="list-row__main"><p class="list-row__title">Formación y certificaciones</p></div>${icon('chevronRight')}</a>
      <a class="panel list-row" href="/panel/servicios">${icon('layers')}<div class="list-row__main"><p class="list-row__title">Servicios</p></div>${icon('chevronRight')}</a>
    </div>`;
  return page(ctx, 'Mi perfil', 'perfil', body);
}

function profileEdit(ctx, { sp, values = {}, errors = {}, categories, departments }) {
  const loc = values.location || {};
  const coords = loc.geo?.coordinates || [];
  const body = html`${C.pageHead({ title: 'Editar perfil', back: '/panel/perfil' })}
    <form method="post" action="/panel/perfil/editar" class="form" style="max-width:720px">${C.csrfField(ctx)}
      ${sp.status === 'active' ? html`<p class="notice">Los cambios de precio, agenda y textos se publican al instante. El nombre y las categorías pasan por una revisión rápida.</p>` : ''}
      <section class="panel stack"><h2>Presentación</h2>
        ${C.field({ label: 'Nombre profesional', name: 'displayName', value: values.displayName, required: true, error: errors.displayName })}
        ${C.field({ label: 'Frase de presentación', name: 'headline', value: values.headline, maxlength: 160 })}
        ${C.field({ label: 'Sobre vos', name: 'bio', type: 'textarea', rows: 6, value: values.bio, maxlength: 4000, hint: 'Contá cómo trabajás y a quién podés ayudar. Mínimo 80 caracteres para publicar.' })}
        ${C.field({ label: 'Experiencia', name: 'experience', type: 'textarea', rows: 4, value: values.experience })}
        <div class="grid-2">${C.field({ label: 'Años de experiencia', name: 'yearsOfExperience', type: 'number', min: 0, max: 80, value: values.yearsOfExperience })}${C.field({ label: 'Idiomas', name: 'languages', value: Array.isArray(values.languages) ? values.languages.join(', ') : values.languages, placeholder: 'Español, inglés' })}</div>
        ${C.field({ label: 'Formación', name: 'education', type: 'textarea', rows: 4, value: values.education, hint: 'Lo que escribas acá se muestra como declarado. Para mostrarlo verificado, cargá la certificación con su documento.' })}
      </section>
      <section class="panel stack section"><h2>Categorías y modalidades</h2>
        ${C.checkGroup({ label: 'Categorías', name: 'categories', options: categories.map((c) => [c._id, c.name]), values: [].concat(values.categories || []).map(String) })}
        ${errors.categories ? html`<p class="field__error">${errors.categories}</p>` : ''}
        ${C.checkGroup({ label: 'Modalidades', name: 'modalities', options: MOD_OPTS, values: [].concat(values.modalities || []) })}
      </section>
      <section class="panel stack section"><h2>Ubicación</h2>
        <div class="grid-2">${C.select({ label: 'Departamento', name: 'department', value: loc.department || values.department, options: [['', '—'], ...departments.map((x) => [x, x])] })}${C.field({ label: 'Ciudad', name: 'city', value: loc.city || values.city })}</div>
        <div class="grid-2">${C.field({ label: 'Barrio o zona', name: 'neighborhood', value: loc.neighborhood || values.neighborhood })}${C.field({ label: 'Radio para domicilio (km)', name: 'serviceRadiusKm', type: 'number', min: 0, max: 200, value: loc.serviceRadiusKm ?? values.serviceRadiusKm })}</div>
        ${C.field({ label: 'Dirección del consultorio', name: 'address', value: loc.address || values.address, hint: 'Privada: solo la ve quien tiene una reserva confirmada.' })}
        ${C.field({ label: 'Referencia pública', name: 'addressPublicHint', value: loc.addressPublicHint || values.addressPublicHint, placeholder: 'Pocitos, cerca de Rambla y 26 de Marzo' })}
        <div class="grid-2">${C.field({ label: 'Latitud', name: 'lat', type: 'number', step: 'any', value: coords[1] ?? values.lat, hint: 'Para búsquedas “cerca de mí”. Copiala de Google Maps.' })}${C.field({ label: 'Longitud', name: 'lng', type: 'number', step: 'any', value: coords[0] ?? values.lng })}</div>
      </section>
      <section class="panel stack section"><h2>Contacto privado</h2>
        ${C.field({ label: 'Teléfono', name: 'contactPhone', type: 'tel', value: values.contactPhone, hint: 'Solo para el equipo de Alternativa y avisos urgentes de reservas.' })}
      </section>
      <div class="form-actions"><button class="btn btn--primary btn--lg">Guardar perfil</button><a class="btn btn--ghost" href="/panel/perfil">Cancelar</a></div>
    </form>`;
  return page(ctx, 'Editar perfil', 'perfil', body);
}

function appearance(ctx, { sp, services }) {
  const L = sp.profileLayout || {};
  const titles = { servicios: 'Servicios', sobre: 'Sobre mí', galeria: 'Fotos', video: 'Video', resenas: 'Reseñas', ubicacion: 'Dónde atiendo' };
  const order = (L.sectionOrder?.length ? L.sectionOrder : Object.keys(titles));
  const body = html`${C.pageHead({ title: 'Apariencia de la ficha', subtitle: 'Personalizá algunos aspectos. Precios, valoraciones, disponibilidad y botón de reserva siempre se muestran igual.', back: '/panel/perfil' })}
    <form method="post" action="/panel/perfil/apariencia" class="form" style="max-width:720px">${C.csrfField(ctx)}
      <fieldset class="field"><legend>Estilo</legend><div class="checkgrid">
        ${[['clasica', 'Clásica'], ['serena', 'Serena'], ['luminosa', 'Luminosa']].map(([v, l]) => html`<label class="check check--pill"><input type="radio" name="variant" value="${v}"${attr('checked', (L.variant || 'clasica') === v)}><span>${l}</span></label>`)}
      </div></fieldset>
      <fieldset class="field"><legend>Orden de las secciones</legend><p class="field__hint">Elegí qué va primero (1) y qué después.</p>
        ${order.map((k, i) => html`<div class="row" style="margin:6px 0">${C.select({ label: `Posición ${i + 1}`, name: 'order', value: k, options: Object.entries(titles) })}</div>`)}
      </fieldset>
      ${C.select({ label: 'Servicio destacado', name: 'featuredService', value: L.featuredService, options: [['', 'Ninguno'], ...services.map((s) => [s._id, s.title])] })}
      ${C.checkbox({ label: 'Mostrar el video al principio', name: 'showVideoFirst', checked: L.showVideoFirst })}
      <div class="form-actions"><button class="btn btn--primary">Guardar</button><a class="btn btn--ghost" href="/especialistas/${sp.slug}">Ver ficha</a></div>
    </form>`;
  return page(ctx, 'Apariencia', 'perfil', body);
}

// ── Multimedia ────────────────────────────────────────────
const MEDIA_STATUS = { approved: ['Publicada', 'ok'], pending: ['En revisión', 'info'], rejected: ['Rechazada', 'danger'], reported: ['Reportada', 'warn'] };
function mediaItem(ctx, m) {
  const st = MEDIA_STATUS[m.status];
  return html`<div class="panel stack" style="padding:10px">
    ${m.kind === 'video' ? html`<video src="${m.url}" controls preload="metadata" style="border-radius:10px;width:100%"></video>` : html`<img src="${m.thumbUrl || m.url}" alt="${m.caption || ''}" style="aspect-ratio:1;object-fit:cover;border-radius:10px;width:100%">`}
    <div class="row row--between">${C.pill(st[0], st[1])}<span class="small muted">${Math.round((m.bytes || 0) / 1024)} KB${m.durationSec ? ` · ${Math.round(m.durationSec)} s` : ''}</span></div>
    ${['photo', 'space', 'service'].includes(m.kind) ? html`<form method="post" action="/panel/perfil/multimedia/${m._id}" class="stack">${C.csrfField(ctx)}
      <input type="text" name="caption" value="${m.caption || ''}" placeholder="Descripción" aria-label="Descripción" maxlength="200">
      <select name="kind" aria-label="Tipo"><option value="photo"${attr('selected', m.kind === 'photo')}>Foto</option><option value="space"${attr('selected', m.kind === 'space')}>Mi espacio</option><option value="service"${attr('selected', m.kind === 'service')}>De un servicio</option></select>
      <div class="row"><button class="btn btn--sm btn--ghost">Guardar</button>
      <button class="btn btn--sm btn--text" name="action" value="subir" aria-label="Mover antes">↑</button><button class="btn btn--sm btn--text" name="action" value="bajar" aria-label="Mover después">↓</button></div></form>` : ''}
    <form method="post" action="/panel/perfil/multimedia/${m._id}" data-confirm="¿Eliminar este archivo?">${C.csrfField(ctx)}<input type="hidden" name="action" value="eliminar"><button class="btn btn--sm btn--danger btn--block">Eliminar</button></form>
  </div>`;
}

function media(ctx, { media: list, limits }) {
  const byKind = (k) => list.filter((m) => [].concat(k).includes(m.kind));
  const gallery = byKind(['photo', 'space', 'service']);
  const body = html`${C.pageHead({ title: 'Fotos y video', back: '/panel/perfil' })}
    <p class="muted">Formatos: JPG, PNG o WebP hasta ${limits.maxImageMB} MB. Video MP4 o MOV hasta ${limits.maxVideoMB} MB y ${limits.maxVideoSeconds} segundos. Hasta ${limits.maxPhotos} fotos.</p>
    <section class="section"><div class="section__head"><h2>Foto de perfil y portada</h2></div>
      <div class="grid-3">
        ${byKind('avatar').map((m) => mediaItem(ctx, m))}${byKind('avatar').length ? '' : html`<a class="panel empty" href="/panel/perfil/multimedia/subir?tipo=perfil">${icon('user', { size: 28 })}<p>Subir foto de perfil</p></a>`}
        ${byKind('cover').map((m) => mediaItem(ctx, m))}${byKind('cover').length ? '' : html`<a class="panel empty" href="/panel/perfil/multimedia/subir?tipo=portada">${icon('image', { size: 28 })}<p>Subir portada</p></a>`}
      </div>
      <div class="btnbar"><a class="btn btn--ghost btn--sm" href="/panel/perfil/multimedia/subir?tipo=perfil">Cambiar foto de perfil</a><a class="btn btn--ghost btn--sm" href="/panel/perfil/multimedia/subir?tipo=portada">Cambiar portada</a></div>
    </section>
    <section class="section"><div class="section__head"><h2>Galería (${gallery.length}/${limits.maxPhotos})</h2><a class="btn btn--primary btn--sm" href="/panel/perfil/multimedia/subir?tipo=foto">${icon('upload', { size: 16 })}Subir foto</a></div>
      ${gallery.length ? html`<div class="grid-3">${gallery.map((m) => mediaItem(ctx, m))}</div>` : C.empty({ title: 'Sumá fotos de tu espacio y tu trabajo', text: 'Las fichas con fotos reciben más reservas.', iconName: 'image' })}
    </section>
    <section class="section"><div class="section__head"><h2>Video de presentación</h2><a class="btn btn--ghost btn--sm" href="/panel/perfil/multimedia/subir?tipo=video">${icon('video', { size: 16 })}${byKind('video').length ? 'Reemplazar' : 'Subir'} video</a></div>
      ${byKind('video').length ? html`<div class="grid-2">${byKind('video').map((m) => mediaItem(ctx, m))}</div>` : html`<p class="muted">Un video corto presentándote genera confianza. Máximo ${limits.maxVideoSeconds} segundos.</p>`}
    </section>`;
  return page(ctx, 'Fotos y video', 'multimedia', body);
}

function mediaUpload(ctx, { tipo, limits }) {
  const isVideo = tipo === 'video';
  const titles = { foto: 'Subir fotografía', video: 'Subir video', perfil: 'Foto de perfil', portada: 'Imagen de portada' };
  const body = html`${C.pageHead({ title: titles[tipo], back: '/panel/perfil/multimedia' })}
    <form method="post" action="/panel/perfil/multimedia?_csrf=${ctx.csrf}" enctype="multipart/form-data" class="form panel stack">${C.csrfField(ctx)}
      <input type="hidden" name="tipo" value="${tipo === 'foto' ? (ctx.query.espacio ? 'espacio' : 'foto') : tipo}">
      <div class="field"><label for="f-file">${isVideo ? 'Archivo de video' : 'Imagen'}</label>
        <input id="f-file" type="file" name="file" required accept="${isVideo ? 'video/mp4,video/quicktime' : 'image/jpeg,image/png,image/webp'}"${isVideo ? '' : html` data-preview="#preview"`}>
        <p class="field__hint">${isVideo ? `MP4 o MOV, hasta ${limits.maxVideoMB} MB y ${limits.maxVideoSeconds} segundos.` : `JPG, PNG o WebP hasta ${limits.maxImageMB} MB. Mínimo 200 × 200 px.${tipo === 'portada' ? ' Ideal horizontal (1600 × 600).' : tipo === 'perfil' ? ' Ideal cuadrada, con tu cara bien visible.' : ''}`}</p></div>
      ${isVideo ? '' : html`<img id="preview" alt="" hidden style="max-height:240px;border-radius:var(--r-card);object-fit:cover">`}
      ${tipo === 'foto' ? C.field({ label: 'Descripción', name: 'caption', maxlength: 200, placeholder: 'Sala de masajes con luz natural' }) : ''}
      <p class="small muted">No subas imágenes de otras personas sin su permiso ni contenido que no sea tuyo.</p>
      <button class="btn btn--primary">Subir</button>
    </form>`;
  return page(ctx, titles[tipo], 'multimedia', body);
}

// ── Servicios ─────────────────────────────────────────────
function services(ctx, { list }) {
  const body = html`${C.pageHead({ title: 'Servicios', subtitle: 'Cada servicio tiene su propio precio, duración y reputación.', actions: html`<a class="btn btn--primary btn--sm" href="/panel/servicios/nuevo">${icon('plus', { size: 16 })}Nuevo servicio</a>` })}
    ${list.length ? html`<ul class="list panel">${list.map((s) => html`<li><a class="list-row" href="/panel/servicios/${s._id}">
      <div class="list-row__main"><p class="list-row__title">${s.title}</p><p class="list-row__sub">${s.category?.name || ''} · ${C.duration(s.durationMinutes)} · ${fmtMoney(s.price)}</p>
      <div class="row" style="gap:8px;margin-top:6px">${C.pill(SERVICE_STATUS[s.status], s.status === 'active' ? 'ok' : s.status === 'suspended' ? 'danger' : 'warn')}${s.rating?.count ? C.rating(s.rating, { compact: true }) : ''}</div></div>${icon('chevronRight')}</a></li>`)}</ul>`
    : C.empty({ title: 'Creá tu primer servicio', text: 'Definí nombre, precio y duración. Podés tener varios (por ejemplo, masaje relajante y descontracturante).', action: 'Crear servicio', href: '/panel/servicios/nuevo', iconName: 'layers' })}`;
  return page(ctx, 'Servicios', 'servicios', body);
}

function serviceForm(ctx, { categories, values = {}, errors = {}, editing, settings }) {
  const rate = settings.commission.globalRate;
  const added = settings.commission.feeMode === 'added';
  const body = html`${C.pageHead({ title: editing ? 'Editar servicio' : 'Nuevo servicio', back: editing ? `/panel/servicios/${editing}` : '/panel/servicios' })}
    <form method="post" action="${editing ? `/panel/servicios/${editing}` : '/panel/servicios'}" class="form" style="max-width:720px">${C.csrfField(ctx)}
      <section class="panel stack">
        ${C.field({ label: 'Nombre del servicio', name: 'title', value: values.title, required: true, error: errors.title, placeholder: 'Masaje descontracturante' })}
        ${C.select({ label: 'Categoría', name: 'category', value: values.category?._id || values.category, required: true, options: [['', 'Elegí una'], ...categories.map((c) => [c._id, c.name])] })}
        ${errors.category ? html`<p class="field__error">${errors.category}</p>` : ''}
        ${C.field({ label: 'Resumen', name: 'summary', value: values.summary, maxlength: 240, hint: 'Una o dos frases que se ven en los resultados.' })}
        ${C.field({ label: 'Descripción', name: 'description', type: 'textarea', rows: 6, value: values.description, maxlength: 5000 })}
        ${C.field({ label: 'Qué incluye (uno por línea)', name: 'includes', type: 'textarea', rows: 3, value: values.includes })}
        ${C.field({ label: 'Cómo prepararse', name: 'preparation', type: 'textarea', rows: 3, value: values.preparation, placeholder: 'Ropa cómoda, llegar 5 minutos antes…' })}
      </section>
      <section class="panel stack section">
        <div class="grid-2">
          ${C.field({ label: 'Tu precio (UYU)', name: 'price', type: 'number', min: 100, step: 10, value: values.price, required: true, error: errors.price, inputmode: 'numeric', hint: added ? `Lo que recibís por el servicio. Al cliente se le suma la tarifa de Alternativa (${fmtPercent(rate)}).` : `Precio final. Alternativa descuenta su comisión (${fmtPercent(rate)}).` })}
          ${C.field({ label: 'Duración (minutos)', name: 'durationMinutes', type: 'number', min: 10, max: 600, step: 5, value: values.durationMinutes, required: true, error: errors.durationMinutes })}
        </div>
        ${C.checkGroup({ label: 'Modalidades de este servicio', name: 'modalities', options: MOD_OPTS, values: [].concat(values.modalities || []) })}
        ${errors.modalities ? html`<p class="field__error">${errors.modalities}</p>` : ''}
        <div class="grid-2">
          ${C.field({ label: 'Recargo a domicilio (UYU)', name: 'homeServiceExtra', type: 'number', min: 0, step: 10, value: values.homeServiceExtra || 0, hint: 'Se suma solo si eligen atención a domicilio.' })}
          ${C.field({ label: 'Reservas con hasta (días)', name: 'maxAdvanceDays', type: 'number', min: 1, max: 365, value: values.maxAdvanceDays, hint: 'Vacío = lo que diga tu agenda.' })}
        </div>
      </section>
      <div class="form-actions"><button class="btn btn--primary btn--lg">${editing ? 'Guardar cambios' : 'Crear servicio'}</button></div>
    </form>`;
  return page(ctx, editing ? 'Editar servicio' : 'Nuevo servicio', 'servicios', body);
}

function serviceDetail(ctx, { service: s, photos, reviews, perf, breakdown, commission, category, sp }) {
  const body = html`${C.pageHead({ title: s.title, subtitle: `${category?.name || ''} · ${C.duration(s.durationMinutes)}`, back: '/panel/servicios', actions: html`<a class="btn btn--primary btn--sm" href="/panel/servicios/${s._id}/editar">${icon('edit', { size: 16 })}Editar</a>` })}
    ${s.status === 'pending_review' ? html`<div class="flash flash--warn">${icon('clock', { size: 18 })}<span>En revisión. ${s.statusReason || ''}</span></div>` : ''}
    ${s.status === 'suspended' ? html`<div class="flash flash--error">${icon('ban', { size: 18 })}<span>Suspendido por administración. ${s.statusReason || ''}</span></div>` : ''}
    <div class="grid-kpi">
      ${C.kpi('Estado', SERVICE_STATUS[s.status])}
      ${C.kpi('Valoración', s.rating?.count ? `${C.fmtRating(s.rating.avg)} ★` : '—', s.rating?.count ? `${s.rating.count} reseñas` : 'Sin reseñas')}
      ${C.kpi('Visitas (90 días)', perf?.views ?? 0, `${perf?.checks ?? 0} consultas de horarios`)}
      ${C.kpi('Reservas (90 días)', perf?.bookings ?? 0, `Conversión ${String(perf?.conversion ?? 0).replace('.', ',')}%`)}
    </div>
    <div class="grid-2 section" style="align-items:start">
      <section class="panel"><h2>Precio</h2>
        <div class="summary">
          <div class="summary__row"><span>Tu precio</span><span>${fmtMoney(s.price)}</span></div>
          <div class="summary__row"><span>${ctx.settings.commission.feeLabel} (${fmtPercent(commission.rate)})</span><span>${fmtMoney(breakdown.commissionAmount)}</span></div>
          <div class="summary__row summary__row--total"><span>Ve el cliente</span><span>${fmtMoney(breakdown.total)}</span></div>
          ${breakdown.processorFee ? html`<p class="small muted" style="margin:8px 0 0">Costo estimado del procesador de pagos: ${fmtMoney(breakdown.processorFee)} (${breakdown.processorPaidBy === 'specialist' ? 'se descuenta de tu parte' : breakdown.processorPaidBy === 'customer' ? 'lo paga el cliente' : 'lo absorbe Alternativa'}). Estimado que recibís: <strong>${fmtMoney(breakdown.specialistReceives)}</strong>.</p>` : ''}
        </div>
      </section>
      <section class="panel"><h2>Fotos del servicio</h2>
        ${photos.length ? html`<div class="gallery" style="grid-template-columns:repeat(3,1fr)">${photos.map((m) => html`<form method="post" action="/panel/servicios/${s._id}/fotos?_csrf=${ctx.csrf}" style="position:relative" data-confirm="¿Quitar esta foto?">${C.csrfField(ctx)}<input type="hidden" name="remove" value="${m._id}"><img src="${m.thumbUrl || m.url}" alt="" style="aspect-ratio:1;object-fit:cover"><button class="btn btn--sm btn--danger" style="position:absolute;bottom:4px;right:4px;min-height:28px;padding:0 8px" aria-label="Quitar foto">${icon('trash', { size: 14 })}</button></form>`)}</div>` : html`<p class="muted">Sin fotos propias (se muestran las de tu galería).</p>`}
        <form method="post" action="/panel/servicios/${s._id}/fotos?_csrf=${ctx.csrf}" enctype="multipart/form-data" class="row" style="margin-top:12px">${C.csrfField(ctx)}<input type="file" name="file" accept="image/jpeg,image/png,image/webp" required aria-label="Foto del servicio"><button class="btn btn--sm btn--ghost">Subir</button></form>
      </section>
    </div>
    <section class="section panel"><div class="panel__title"><h2>Reseñas recientes</h2><a href="/panel/resenas?servicio=${s._id}">Ver todas</a></div>
      ${reviews.length ? reviews.map((r) => html`<div class="review"><div class="review__head"><span class="review__who">${r.authorName}</span>${C.stars(r.rating, 14)}</div>${r.comment ? html`<p class="review__body">${r.comment}</p>` : ''}</div>`) : html`<p class="muted">Todavía no hay reseñas para este servicio.</p>`}
    </section>
    <div class="btnbar">
      <a class="btn btn--ghost" href="/servicios/${sp.slug}/${s.slug}">${icon('eye', { size: 16 })}Ver como cliente</a>
      ${['active', 'paused'].includes(s.status) ? C.actionButton(ctx, { action: `/panel/servicios/${s._id}/estado`, label: s.status === 'active' ? 'Pausar servicio' : 'Publicar servicio', cls: 'btn btn--ghost' }) : ''}
      ${C.actionButton(ctx, { action: `/panel/servicios/${s._id}/eliminar`, label: 'Eliminar', cls: 'btn btn--danger', confirm: '¿Eliminar este servicio? Si tiene reservas en el historial, se pausa en lugar de borrarse.' })}
    </div>`;
  return page(ctx, s.title, 'servicios', body);
}

// ── Agenda ────────────────────────────────────────────────
function agendaNav(vista, date, from) {
  const shift = vista === 'dia' ? 1 : vista === 'semana' ? 7 : 0;
  let prev; let next;
  if (vista === 'mes') {
    const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7));
    prev = m === 1 ? `${y - 1}-12-01` : `${y}-${D.pad(m - 1)}-01`;
    next = m === 12 ? `${y + 1}-01-01` : `${y}-${D.pad(m + 1)}-01`;
  } else { prev = D.addDays(vista === 'semana' ? from : date, -shift); next = D.addDays(vista === 'semana' ? from : date, shift); }
  const label = vista === 'mes' ? `${D.MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}` : vista === 'semana' ? `Semana del ${D.fmtDateStr(from).split(' ').slice(1).join(' ')}` : D.fmtDateStr(date);
  return html`<div class="row row--between" style="margin-bottom:12px">
    <div class="row" style="gap:4px"><a class="btn btn--ghost btn--sm" href="/panel/agenda?vista=${vista}&fecha=${prev}" aria-label="Anterior">${icon('chevronLeft', { size: 16 })}</a><a class="btn btn--ghost btn--sm" href="/panel/agenda?vista=${vista}">Hoy</a><a class="btn btn--ghost btn--sm" href="/panel/agenda?vista=${vista}&fecha=${next}" aria-label="Siguiente">${icon('chevronRight', { size: 16 })}</a></div>
    <strong>${label.charAt(0).toUpperCase() + label.slice(1)}</strong>
  </div>`;
}

function agenda(ctx, d) {
  const { vista, date, from, list, av } = d;
  const today = D.todayStr();
  const views = C.tabs([['dia', `/panel/agenda?vista=dia&fecha=${date}`, 'Día'], ['semana', `/panel/agenda?vista=semana&fecha=${date}`, 'Semana'], ['mes', `/panel/agenda?vista=mes&fecha=${date}`, 'Mes']], vista);
  let content;
  if (vista === 'dia') {
    const { workingRangesForDate } = require('../services/availability');
    const wr = workingRangesForDate(av, date);
    content = html`<div class="panel">
      <p class="muted small">${wr.ranges.length ? `Horario: ${wr.ranges.map((r) => `${D.minutesToHHMM(r.start)}–${D.minutesToHHMM(r.end)}`).join(', ')}` : wr.reason === 'timeoff' ? 'Vacaciones' : wr.reason === 'closed' ? 'Día bloqueado' : 'No atendés este día'}</p>
      ${list.length ? html`<ul class="day-agenda">${list.map((b) => html`<li><time>${D.fmtTime(b.start)}</time><a class="list-row" href="/panel/reservas/${b._id}"><div class="list-row__main"><p class="list-row__title">${b.snapshot.userName}</p><p class="list-row__sub">${b.snapshot.serviceTitle} · hasta ${D.fmtTime(b.end)} · ${MODALITIES[b.modality].label}</p></div>${C.statusPill(b.status)}</a></li>`)}</ul>` : html`<p class="muted">Sin reservas.</p>`}
    </div>`;
  } else if (vista === 'semana') {
    const days = Array.from({ length: 7 }, (_, i) => D.addDays(from, i));
    const startH = 7; const endH = 22; const hourPx = 48;
    const { workingRangesForDate } = require('../services/availability');
    content = html`<div class="week" style="grid-template-rows:auto">
      <div class="week__hours"><div class="week__head" style="height:44px"></div>${Array.from({ length: endH - startH }, (_, i) => html`<div>${D.pad(startH + i)}:00</div>`)}</div>
      ${days.map((day) => {
    const wr = workingRangesForDate(av, day).ranges;
    const events = list.filter((b) => D.localParts(b.start).dateStr === day);
    return html`<div class="week__col"><div class="${classes('week__head', day === today && 'is-today')}">${D.WEEKDAYS_SHORT[D.weekdayOf(day)]} ${Number(day.slice(8))}</div>
          <div class="week__body" style="height:${(endH - startH) * hourPx}px">
            ${Array.from({ length: endH - startH }, (_, i) => {
      const h = (startH + i) * 60;
      const open = wr.some((r) => r.start <= h && r.end >= h + 60);
      return html`<div class="${classes('week__slot', open && 'is-open')}"></div>`;
    })}
            ${events.map((b) => {
      const p = D.localParts(b.start);
      const top = Math.max(0, (p.minutesOfDay - startH * 60) * (hourPx / 60));
      const h = Math.max(22, ((b.end - b.start) / 60000) * (hourPx / 60));
      return html`<a class="${classes('week__event', b.status === 'paid' && 'week__event--paid', b.status === 'pending' && 'week__event--pending')}" href="/panel/reservas/${b._id}" style="top:${top}px;height:${h}px">${D.fmtTime(b.start)} ${b.snapshot.userName}<br>${b.snapshot.serviceTitle}</a>`;
    })}
          </div></div>`;
  })}
    </div>
    <p class="small muted">Las franjas celestes son tus horarios de atención. Violeta: reservas pagas por confirmar.</p>`;
  } else {
    const grid = D.monthGrid(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
    const { workingRangesForDate } = require('../services/availability');
    content = html`<div class="month">${['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map((x) => html`<div class="month__dow">${x}</div>`)}
      ${grid.flat().map((day) => {
    const count = list.filter((b) => D.localParts(b.start).dateStr === day).length;
    const off = !workingRangesForDate(av, day).ranges.length;
    return html`<a class="${classes('month__day', day.slice(5, 7) !== date.slice(5, 7) && 'is-other', day === today && 'is-today', off && 'is-off')}" href="/panel/agenda?vista=dia&fecha=${day}"><span class="month__num">${Number(day.slice(8))}</span>${count ? html`<span class="month__count">${count} ${count === 1 ? 'reserva' : 'reservas'}</span>` : ''}</a>`;
  })}</div>`;
  }
  const body = html`${C.pageHead({ title: 'Agenda', actions: html`<a class="btn btn--ghost btn--sm" href="/panel/agenda/horarios">${icon('clock', { size: 16 })}Horarios</a><a class="btn btn--ghost btn--sm" href="/panel/agenda/bloqueos">${icon('ban', { size: 16 })}Bloqueos</a>` })}
    ${views}${agendaNav(vista, date, from)}${content}
    <p class="small" style="margin-top:12px"><a href="/panel/agenda/disponibilidad">Ver cómo ven tu disponibilidad los clientes</a></p>`;
  return page(ctx, 'Agenda', 'agenda', body, { wide: true });
}

function schedule(ctx, { av }) {
  const days = [1, 2, 3, 4, 5, 6, 0];
  const body = html`${C.pageHead({ title: 'Horarios de atención', subtitle: 'Los turnos libres se calculan solos a partir de estos horarios.', back: '/panel/agenda' })}
    <form method="post" action="/panel/agenda/horarios" class="panel" style="max-width:820px">${C.csrfField(ctx)}
      ${days.map((day) => {
    const ranges = (av.weekly || []).find((w) => w.day === day)?.ranges || [];
    return html`<div class="sched-day"><strong style="text-transform:capitalize">${D.WEEKDAYS[day]}</strong>
        <div><div class="sched-ranges" data-ranges="${day}">${ranges.map((r, i) => html`<div class="sched-range"><input type="time" name="weekly[${day}][${i}][start]" value="${r.start}" aria-label="Desde"><span>a</span><input type="time" name="weekly[${day}][${i}][end]" value="${r.end}" aria-label="Hasta"><button type="button" class="btn btn--text btn--sm" data-remove-range>Quitar</button></div>`)}</div>
        <button type="button" class="btn btn--text btn--sm" data-add-range="${day}">${icon('plus', { size: 14 })}Agregar franja</button>${ranges.length ? '' : html` <span class="small muted">No atendés</span>`}</div></div>`;
  })}
      <hr>
      <div class="grid-2">
        ${C.select({ label: 'Cada cuánto empiezan los turnos', name: 'slotStepMinutes', value: av.slotStepMinutes, required: true, options: [[15, 'Cada 15 minutos'], [30, 'Cada 30 minutos'], [60, 'Cada hora']] })}
        ${C.field({ label: 'Tiempo entre sesiones (min)', name: 'bufferMinutes', type: 'number', min: 0, max: 120, value: av.bufferMinutes, hint: 'Para preparar el espacio o trasladarte.' })}
        ${C.field({ label: 'Anticipación mínima (horas)', name: 'minNoticeHours', type: 'number', min: 0, max: 168, step: 0.5, value: (av.minNoticeMinutes || 0) / 60 })}
        ${C.field({ label: 'Reservas con hasta (días)', name: 'maxAdvanceDays', type: 'number', min: 1, max: 365, value: av.maxAdvanceDays })}
        ${C.field({ label: 'Máximo de reservas por día', name: 'dailyLimit', type: 'number', min: 0, max: 50, value: av.dailyLimit, hint: '0 = sin límite.' })}
      </div>
      <button class="btn btn--primary btn--lg">Guardar horarios</button>
    </form>`;
  return page(ctx, 'Horarios', 'agenda', body);
}

function blocks(ctx, { av, today }) {
  const upcomingEx = (av.exceptions || []).filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const upcomingOff = (av.timeOff || []).filter((t) => t.to >= today);
  const upcomingBlocks = (av.blocks || []).filter((b) => new Date(b.end) > new Date());
  const del = (list, id, extra = {}) => C.actionButton(ctx, { action: '/panel/agenda/bloqueos/eliminar', label: 'Quitar', cls: 'btn btn--text btn--sm', fields: { list, id: id || '', ...extra } });
  const body = html`${C.pageHead({ title: 'Bloqueos, descansos y vacaciones', back: '/panel/agenda' })}
    <div class="grid-2" style="align-items:start">
      <section class="panel"><h2>Bloquear un día</h2>
        <form method="post" action="/panel/agenda/bloqueos">${C.csrfField(ctx)}<input type="hidden" name="type" value="dia">
          ${C.field({ label: 'Fecha', name: 'date', type: 'date', min: today, required: true })}${C.field({ label: 'Motivo (privado)', name: 'note' })}
          <button class="btn btn--primary btn--sm">Bloquear día</button></form></section>
      <section class="panel"><h2>Bloquear un horario</h2>
        <form method="post" action="/panel/agenda/bloqueos">${C.csrfField(ctx)}<input type="hidden" name="type" value="horario">
          ${C.field({ label: 'Fecha', name: 'date', type: 'date', min: today, required: true })}
          <div class="grid-2">${C.field({ label: 'Desde', name: 'start', type: 'time', required: true })}${C.field({ label: 'Hasta', name: 'end', type: 'time', required: true })}</div>
          ${C.field({ label: 'Motivo (privado)', name: 'reason' })}<button class="btn btn--primary btn--sm">Bloquear horario</button></form></section>
      <section class="panel"><h2>Vacaciones</h2>
        <form method="post" action="/panel/agenda/bloqueos">${C.csrfField(ctx)}<input type="hidden" name="type" value="vacaciones">
          <div class="grid-2">${C.field({ label: 'Desde', name: 'from', type: 'date', min: today, required: true })}${C.field({ label: 'Hasta', name: 'to', type: 'date', min: today, required: true })}</div>
          ${C.field({ label: 'Motivo (privado)', name: 'reason' })}<button class="btn btn--primary btn--sm">Guardar vacaciones</button></form></section>
      <section class="panel"><h2>Horario especial de un día</h2>
        <form method="post" action="/panel/agenda/bloqueos">${C.csrfField(ctx)}<input type="hidden" name="type" value="especial">
          ${C.field({ label: 'Fecha', name: 'date', type: 'date', min: today, required: true })}
          <div class="grid-2">${C.field({ label: 'Desde', name: 'start', type: 'time', required: true })}${C.field({ label: 'Hasta', name: 'end', type: 'time', required: true })}</div>
          <button class="btn btn--primary btn--sm">Guardar excepción</button></form></section>
      <section class="panel"><h2>Descanso fijo semanal</h2>
        <form method="post" action="/panel/agenda/bloqueos">${C.csrfField(ctx)}<input type="hidden" name="type" value="descanso">
          ${C.select({ label: 'Día', name: 'day', required: true, options: [1, 2, 3, 4, 5, 6, 0].map((d) => [d, D.WEEKDAYS[d]]) })}
          <div class="grid-2">${C.field({ label: 'Desde', name: 'start', type: 'time', value: '13:00', required: true })}${C.field({ label: 'Hasta', name: 'end', type: 'time', value: '14:00', required: true })}</div>
          <button class="btn btn--primary btn--sm">Agregar descanso</button></form></section>
    </div>
    <section class="section panel"><h2>Vigentes</h2>
      <ul class="list">
        ${upcomingEx.map((e) => html`<li class="row row--between"><span><strong>${D.fmtDateStr(e.date)}</strong> · ${e.type === 'closed' ? 'Día bloqueado' : `Horario especial ${(e.ranges || []).map((r) => `${r.start}–${r.end}`).join(', ')}`}${e.note ? html` <span class="muted">(${e.note})</span>` : ''}</span>${del('exceptions', e._id)}</li>`)}
        ${upcomingOff.map((t) => html`<li class="row row--between"><span><strong>Vacaciones</strong> del ${D.fmtDateStr(t.from)} al ${D.fmtDateStr(t.to)}${t.reason ? html` <span class="muted">(${t.reason})</span>` : ''}</span>${del('timeOff', t._id)}</li>`)}
        ${upcomingBlocks.map((b) => html`<li class="row row--between"><span><strong>${D.fmtDate(b.start)}</strong> · ${D.fmtTime(b.start)}–${D.fmtTime(b.end)}${b.reason ? html` <span class="muted">(${b.reason})</span>` : ''}</span>${del('blocks', b._id)}</li>`)}
        ${(av.breaks || []).map((b, i) => html`<li class="row row--between"><span><strong>Descanso</strong> todos los ${D.WEEKDAYS[b.day]} de ${b.start} a ${b.end}</span>${del('breaks', '', { index: i })}</li>`)}
        ${!upcomingEx.length && !upcomingOff.length && !upcomingBlocks.length && !(av.breaks || []).length ? html`<li class="muted">No hay bloqueos vigentes.</li>` : ''}
      </ul></section>`;
  return page(ctx, 'Bloqueos', 'agenda', body);
}

function availabilityPreview(ctx, { services, service, summary }) {
  const body = html`${C.pageHead({ title: 'Disponibilidad', subtitle: 'Así ven tus próximos turnos los clientes.', back: '/panel/agenda' })}
    ${services.length > 1 ? html`<form class="toolbar">${C.select({ label: 'Servicio', name: 'servicio', value: service?._id, options: services.map((s) => [s._id, `${s.title} (${s.durationMinutes} min)`]) })}<button class="btn btn--ghost btn--sm">Ver</button></form>` : ''}
    ${summary.length ? html`<ul class="list panel">${summary.map((d) => html`<li class="row row--between"><span style="text-transform:capitalize">${D.fmtDateStr(d.date)}</span>${d.count ? html`<span>${C.pill(`${d.count} turnos`, 'ok')} <span class="small muted">desde ${d.first}</span></span>` : html`<span class="muted small">Sin turnos</span>`}</li>`)}</ul>` : C.empty({ title: 'Creá un servicio para ver tu disponibilidad', action: 'Crear servicio', href: '/panel/servicios/nuevo', iconName: 'calendar' })}`;
  return page(ctx, 'Disponibilidad', 'agenda', body);
}

// ── Reservas ──────────────────────────────────────────────
function bookings(ctx, { tab, list, counts, q }) {
  const body = html`${C.pageHead({ title: 'Reservas' })}
    ${C.tabs([['proximas', '/panel/reservas', 'Próximas', counts[0]], ['confirmar', '/panel/reservas?tab=confirmar', 'Por confirmar', counts[1]], ['historial', '/panel/reservas?tab=historial', 'Historial', counts[2]], ['canceladas', '/panel/reservas?tab=canceladas', 'Canceladas', counts[3]]], tab)}
    <form class="toolbar"><input type="hidden" name="tab" value="${tab}">${C.field({ label: 'Buscar por cliente o código', name: 'q', value: q })}<button class="btn btn--ghost btn--sm">Buscar</button></form>
    ${list.length ? html`<div class="stack">${list.map((b) => bookingCard(b))}</div>` : C.empty({ title: 'No hay reservas en esta sección', iconName: 'calendar' })}`;
  return page(ctx, 'Reservas', 'reservas', body);
}

function bookingDetail(ctx, d) {
  const b = d.booking;
  const s = b.snapshot;
  const future = new Date(b.start) > new Date();
  const started = new Date(b.start) <= new Date();
  const body = html`${C.pageHead({ title: s.userName, subtitle: `${s.serviceTitle} · ${b.code}`, back: '/panel/reservas' })}
    ${b.incident?.open ? html`<div class="flash flash--warn">${icon('alert', { size: 18 })}<span>Hay una incidencia abierta en esta reserva. El equipo de Alternativa la está revisando.</span></div>` : ''}
    <div class="layout-aside">
      <div class="stack">
        <div class="panel stack">
          <div class="row row--between">${C.statusPill(b.status)}${d.previous ? C.pill(`${d.previous} ${d.previous === 1 ? 'sesión previa' : 'sesiones previas'}`, 'info') : C.pill('Primera vez', 'brand')}</div>
          <p class="row" style="gap:10px;margin:0">${icon('calendar')}<strong>${D.fmtDate(b.start)}</strong></p>
          <p class="row" style="gap:10px;margin:0">${icon('clock')}${D.fmtTime(b.start)} a ${D.fmtTime(b.end)} h</p>
          <p class="row" style="gap:10px;margin:0">${icon(MODALITIES[b.modality].icon)}${MODALITIES[b.modality].label}${b.modality === 'domicilio' && b.place?.address ? html` · ${b.place.address}` : ''}</p>
          ${d.showPhone && d.client?.phone ? html`<p class="row" style="gap:10px;margin:0">${icon('phone')}<a href="tel:${d.client.phone}">${d.client.phone}</a></p>` : ''}
          ${b.userNotes ? html`<p class="notice" style="margin:0"><strong>Nota del cliente:</strong> ${b.userNotes}</p>` : ''}
        </div>
        <div class="btnbar" style="margin-top:0">
          ${b.status === 'paid' ? C.actionButton(ctx, { action: `/panel/reservas/${b._id}/confirmar`, label: 'Confirmar reserva', cls: 'btn btn--primary', iconName: 'check' }) : ''}
          <a class="btn btn--ghost" href="${d.conversation ? `/panel/mensajes/${d.conversation._id}` : `/panel/clientes/${b.user}/mensaje`}">${icon('chat', { size: 16 })}Mensaje</a>
          ${['paid', 'confirmed'].includes(b.status) && future ? html`<a class="btn btn--ghost" href="/panel/reservas/${b._id}/reprogramar">${icon('repeat', { size: 16 })}Reprogramar</a>` : ''}
          ${['paid', 'confirmed'].includes(b.status) && started ? C.actionButton(ctx, { action: `/panel/reservas/${b._id}/realizada`, label: 'Marcar realizada', cls: 'btn btn--primary', iconName: 'checkCircle' }) : ''}
          ${['paid', 'confirmed'].includes(b.status) && started ? C.actionButton(ctx, { action: `/panel/reservas/${b._id}/ausencia`, label: 'No se presentó', cls: 'btn btn--ghost', confirm: 'Se aplicará la política de ausencias (sin reembolso por defecto). ¿Confirmás que el cliente no se presentó?' }) : ''}
          <a class="btn btn--ghost" href="/panel/clientes/${b.user}">${icon('user', { size: 16 })}Ficha del cliente</a>
        </div>
        ${['paid', 'confirmed'].includes(b.status) && future ? html`<details class="panel"><summary style="cursor:pointer;font-weight:600;color:var(--danger)">Cancelar esta reserva</summary>
          <form method="post" action="/panel/reservas/${b._id}/cancelar" style="margin-top:12px" data-confirm="El cliente recibe el reembolso completo. ¿Cancelar?">${C.csrfField(ctx)}
            ${C.field({ label: 'Motivo (lo ve el cliente)', name: 'reason', type: 'textarea', rows: 3, required: true })}
            <p class="small muted">Las cancelaciones del especialista se reembolsan al 100% y afectan tu confiabilidad. Si podés, mejor reprogramá.</p>
            <button class="btn btn--danger">Cancelar reserva</button></form></details>` : ''}
        <form method="post" action="/panel/reservas/${b._id}/notas" class="panel stack">${C.csrfField(ctx)}
          ${b.modality === 'online' ? C.field({ label: 'Enlace de la sesión online', name: 'onlineUrl', type: 'url', value: b.place?.onlineUrl, placeholder: 'https://meet.google.com/…', hint: 'El cliente lo ve en el detalle de su reserva.' }) : ''}
          ${C.field({ label: 'Notas privadas', name: 'notes', type: 'textarea', rows: 3, value: b.specialistNotes, hint: 'Solo las ves vos.' })}
          <button class="btn btn--ghost btn--sm">Guardar</button>
        </form>
        ${d.review ? html`<div class="panel"><h3>Reseña del cliente</h3>${C.stars(d.review.rating)}${d.review.comment ? html`<p>${d.review.comment}</p>` : ''}<a href="/panel/resenas#r-${d.review._id}">${d.review.reply?.text ? 'Ver respuesta' : 'Responder'}</a></div>` : ''}
        <details class="panel"><summary style="cursor:pointer;font-weight:600">Historial</summary><ul class="timeline" style="margin-top:12px">${b.history.map((h) => html`<li><strong>${BOOKING_STATUS[h.status]?.label || h.status}</strong> · <span class="muted">${D.fmtDateTime(h.at)}</span>${h.note ? html`<br><span class="small muted">${h.note}</span>` : ''}</li>`)}</ul></details>
      </div>
      <aside class="panel stack">
        <h3 style="margin:0">Importes</h3>
        <div class="summary">
          <div class="summary__row"><span>Pagó el cliente</span><span>${fmtMoney(s.total)}</span></div>
          <div class="summary__row"><span>Tarifa Alternativa (${fmtPercent(s.commissionRate)})</span><span>−${fmtMoney(s.commissionAmount)}</span></div>
          ${s.processorFeeEstimate && s.processorFeePaidBy === 'specialist' ? html`<div class="summary__row"><span>Procesador de pagos (estimado)</span><span>−${fmtMoney(s.processorFeeEstimate)}</span></div>` : ''}
          <div class="summary__row summary__row--total"><span>Tu parte</span><span>${fmtMoney(s.specialistReceives ?? s.specialistNet)}</span></div>
        </div>
        <p class="small muted" style="margin:0">${COLLECTION_MODELS[s.collectionModel]?.short || ''}${d.payment ? ` · Pago ${(PAYMENT_STATUS[d.payment.status] || '').toLowerCase()}` : ''}</p>
        ${b.cancellation?.at ? html`<p class="small" style="margin:0">Cancelación: ${b.cancellation.reason || '—'} · reembolso ${b.cancellation.refundPercent}%</p>` : ''}
      </aside>
    </div>`;
  return page(ctx, `Reserva ${b.code}`, 'reservas', body);
}

// ── Clientes ──────────────────────────────────────────────
function clients(ctx, { rows, q }) {
  const body = html`${C.pageHead({ title: 'Clientes', subtitle: 'Personas que reservaron con vos en Alternativa.' })}
    <form class="toolbar">${C.field({ label: 'Buscar', name: 'q', value: q })}<button class="btn btn--ghost btn--sm">Buscar</button></form>
    ${rows.length ? html`<ul class="list panel">${rows.map((r) => html`<li><a class="list-row" href="/panel/clientes/${r._id}">${C.avatar({ name: r.name })}
      <div class="list-row__main"><p class="list-row__title">${r.name}</p><p class="list-row__sub">${r.total} ${r.total === 1 ? 'reserva' : 'reservas'}${r.last ? ` · última ${D.fmtDateShort(r.last)}` : ''}${r.next ? ` · próxima ${D.fmtDateShort(r.next)}` : ''}</p><p class="list-row__sub truncate">${r.services.join(', ')}</p></div>
      ${r.total > 1 ? C.pill('Recurrente', 'brand') : ''}</a></li>`)}</ul>` : C.empty({ title: 'Todavía no tenés clientes', text: 'Cuando alguien reserve, lo vas a ver acá con su historial.', iconName: 'users' })}`;
  return page(ctx, 'Clientes', 'clientes', body);
}

function clientDetail(ctx, { client, list, reviews, conversation, showPhone }) {
  const done = list.filter((b) => b.status === 'completed');
  const next = list.filter((b) => ['paid', 'confirmed'].includes(b.status) && new Date(b.start) > new Date()).at(-1);
  const freq = done.length > 1 ? Math.round((new Date(done[0].start) - new Date(done.at(-1).start)) / 86400000 / (done.length - 1)) : null;
  const body = html`${C.pageHead({ title: client?.name || 'Cliente', back: '/panel/clientes', actions: html`<a class="btn btn--ghost btn--sm" href="${conversation ? `/panel/mensajes/${conversation._id}` : `/panel/clientes/${list[0].user}/mensaje`}">${icon('chat', { size: 16 })}Mensaje</a>` })}
    <div class="grid-kpi">${C.kpi('Reservas', list.length)}${C.kpi('Realizadas', done.length)}${C.kpi('Frecuencia', freq ? `cada ${freq} días` : '—')}${C.kpi('Próxima', next ? D.fmtDateShort(next.start) : '—')}</div>
    ${showPhone && client?.phone ? html`<p class="section">${icon('phone', { size: 16 })} <a href="tel:${client.phone}">${client.phone}</a></p>` : ''}
    <section class="section"><h2>Historial</h2><div class="stack">${list.map((b) => bookingCard(b))}</div></section>
    ${list.some((b) => b.specialistNotes) ? html`<section class="section panel"><h2>Tus notas</h2>${list.filter((b) => b.specialistNotes).map((b) => html`<p><strong>${D.fmtDateShort(b.start)}:</strong> ${b.specialistNotes}</p>`)}</section>` : ''}
    ${reviews.length ? html`<section class="section panel"><h2>Reseñas que dejó</h2>${reviews.map((r) => html`<div class="review"><div class="review__head"><span>${r.service?.title}</span>${C.stars(r.rating, 14)}</div>${r.comment ? html`<p class="review__body">${r.comment}</p>` : ''}</div>`)}</section>` : ''}
    <p class="small muted">Por privacidad solo ves los datos necesarios para atender sus reservas.</p>`;
  return page(ctx, client?.name || 'Cliente', 'clientes', body);
}

function inbox(ctx, { list }) {
  const body = html`${C.pageHead({ title: 'Mensajes' })}
    ${list.length ? html`<ul class="list panel">${list.map((c) => html`<li><a class="list-row" href="/panel/mensajes/${c._id}">${C.avatar({ url: c.user?.avatarUrl, name: c.user?.name })}
      <div class="list-row__main"><p class="${classes('list-row__title', c.unreadSpecialist && 'conv-unread')}">${c.user?.name || 'Usuario'}</p><p class="list-row__sub truncate">${c.lastMessagePreview || ''}</p></div>
      <div style="text-align:right"><span class="small muted">${D.fmtRelative(c.lastMessageAt)}</span>${c.unreadSpecialist ? html`<br><span class="pill pill--brand">${c.unreadSpecialist}</span>` : ''}</div></a></li>`)}</ul>`
    : C.empty({ title: 'No tenés mensajes', text: 'Las consultas de clientes aparecen acá.', iconName: 'chat' })}`;
  return page(ctx, 'Mensajes', 'mensajes', body);
}

// ── Estadísticas ──────────────────────────────────────────
function stats(ctx, { stats: s }) {
  const dows = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ label: D.WEEKDAYS[d], value: s.weekdays[d] }));
  const hours = s.hours.map((v, h) => ({ label: `${D.pad(h)}:00`, value: v })).filter((x) => x.value);
  const body = html`${C.pageHead({ title: 'Estadísticas' })}
    ${periodTabs('/panel/estadisticas', s.period)}
    <div class="grid-kpi">
      ${C.kpi('Visualizaciones', s.views, `${s.profileViews} del perfil · ${s.serviceViews} de servicios`)}
      ${C.kpi('Consultas de disponibilidad', s.availabilityChecks)}
      ${C.kpi('Reservas', s.bookings, `Conversión ${String(s.conversion).replace('.', ',')}%`)}
      ${C.kpi('Ingresos estimados', fmtMoney(s.revenue))}
      ${C.kpi('Clientes', s.clients, `${s.newClients} nuevos · ${s.returningClients} recurrentes`)}
      ${C.kpi('Tasa de repetición', `${String(s.repeatRate).replace('.', ',')}%`)}
      ${C.kpi('Cancelaciones', s.cancellations, `${s.noShows} ausencias`)}
      ${C.kpi('Guardado en favoritos', s.favorites)}
    </div>
    <section class="section panel"><h2>Visualizaciones por día</h2>${C.barChart(s.series, { key: 'views', label: 'Visualizaciones por día' })}</section>
    <section class="section panel"><h2>Reservas por día</h2>${C.barChart(s.series, { key: 'bookings', label: 'Reservas por día', color: 'var(--lav)' })}</section>
    <div class="grid-2 section" style="align-items:start">
      <section class="panel"><h2>Días con más demanda</h2>${C.hbars(dows)}</section>
      <section class="panel"><h2>Horarios con más demanda</h2>${hours.length ? C.hbars(hours) : html`<p class="muted">Sin datos todavía.</p>`}</section>
    </div>
    <section class="section panel"><h2>Evolución de reseñas</h2>${s.reviewTrend.length ? C.hbars(s.reviewTrend.map((r) => ({ label: r.month, value: r.count, display: `${r.count} · ${String(r.avg).replace('.', ',')}★` }))) : html`<p class="muted">Todavía no hay reseñas.</p>`}</section>
    <div class="btnbar"><a class="btn btn--ghost" href="/panel/rendimiento?periodo=${s.period}">Rendimiento por servicio</a><a class="btn btn--ghost" href="/panel/visualizaciones?periodo=${s.period}">Visualizaciones</a><a class="btn btn--ghost" href="/panel/ingresos?periodo=${s.period}">Ingresos</a></div>`;
  return page(ctx, 'Estadísticas', 'estadisticas', body);
}

function views(ctx, { stats: s }) {
  const body = html`${C.pageHead({ title: 'Visualizaciones', back: '/panel/estadisticas' })}${periodTabs('/panel/visualizaciones', s.period)}
    <div class="grid-kpi">${C.kpi('Perfil', s.profileViews)}${C.kpi('Servicios', s.serviceViews)}${C.kpi('Apariciones en resultados', s.impressions)}${C.kpi('Consultas de horarios', s.availabilityChecks)}</div>
    <section class="section panel">${C.barChart(s.series, { key: 'views', label: 'Visualizaciones por día' })}</section>
    <section class="section panel"><h2>Por servicio</h2>${C.hbars(s.servicePerformance.map((p) => ({ label: p.title, value: p.views })))}</section>`;
  return page(ctx, 'Visualizaciones', 'estadisticas', body);
}

function performance(ctx, { stats: s }) {
  const body = html`${C.pageHead({ title: 'Rendimiento por servicio', back: '/panel/estadisticas' })}${periodTabs('/panel/rendimiento', s.period)}
    <div class="table-wrap"><table class="table"><thead><tr><th>Servicio</th><th class="num">Visitas</th><th class="num">Consultas</th><th class="num">Reservas</th><th class="num">Conversión</th><th class="num">Ingresos</th><th class="num">Valoración</th></tr></thead>
    <tbody>${s.servicePerformance.map((p) => html`<tr><td><a href="/panel/servicios/${p._id}">${p.title}</a> ${p.status !== 'active' ? C.pill(SERVICE_STATUS[p.status]) : ''}</td><td class="num">${p.views}</td><td class="num">${p.checks}</td><td class="num">${p.bookings}</td><td class="num">${String(p.conversion).replace('.', ',')}%</td><td class="num">${fmtMoney(p.revenue)}</td><td class="num">${p.rating?.count ? `${C.fmtRating(p.rating.avg)} (${p.rating.count})` : '—'}</td></tr>`)}</tbody></table></div>`;
  return page(ctx, 'Rendimiento', 'estadisticas', body);
}

function income(ctx, { period, payments, payouts, refunds, settings }) {
  const ok = payments.filter((p) => ['approved', 'partially_refunded', 'refunded', 'offline'].includes(p.status));
  const gross = ok.reduce((a, p) => a + p.amount, 0);
  const commission = ok.reduce((a, p) => a + p.commissionAmount, 0);
  const fees = ok.reduce((a, p) => a + (p.providerFee || 0), 0);
  const refunded = refunds.filter((r) => r.status === 'processed').reduce((a, r) => a + r.specialistReversed, 0);
  const net = ok.reduce((a, p) => a + p.specialistAmount, 0) - refunded - (settings.payments.processorFeePaidBy === 'specialist' ? fees : 0);
  const model = settings.payments.collectionModel;
  const body = html`${C.pageHead({ title: 'Ingresos', back: '/panel/estadisticas' })}${periodTabs('/panel/ingresos', period)}
    <div class="grid-kpi">${C.kpi('Cobrado a clientes', fmtMoney(gross))}${C.kpi('Tarifa Alternativa', fmtMoney(commission))}${C.kpi('Procesador de pagos', fmtMoney(fees))}${C.kpi('Tu ingreso neto', fmtMoney(net), refunded ? `Incluye −${fmtMoney(refunded)} de reembolsos` : '')}</div>
    <p class="notice section">${model === 'split' ? 'Cobro con split automático: tu parte se acredita en tu cuenta de Mercado Pago en cada pago, sin liquidaciones.' : model === 'platform' ? 'Alternativa cobra y te transfiere tus liquidaciones periódicamente.' : 'Cobrás directamente a tus clientes; Alternativa te factura la tarifa de servicio.'} <a href="/panel/facturacion">Ver resumen mensual</a></p>
    <div class="table-wrap section"><table class="table"><thead><tr><th>Fecha</th><th>Reserva</th><th>Estado</th><th class="num">Total</th><th class="num">Tarifa</th><th class="num">Procesador</th><th class="num">Tu parte</th></tr></thead>
      <tbody>${payments.map((p) => html`<tr><td>${D.fmtDateShort(p.createdAt)}</td><td><a href="/panel/reservas/${p.booking?._id}">${p.booking?.code}</a><br><span class="small muted">${p.booking?.snapshot?.userName} · ${p.booking?.snapshot?.serviceTitle}</span></td><td>${PAYMENT_STATUS[p.status]}</td><td class="num">${fmtMoney(p.amount)}</td><td class="num">${fmtMoney(p.commissionAmount)}</td><td class="num">${p.providerFee ? fmtMoney(p.providerFee) : '—'}</td><td class="num">${fmtMoney(p.specialistAmount - (settings.payments.processorFeePaidBy === 'specialist' ? p.providerFee || 0 : 0))}</td></tr>`)}</tbody></table></div>
    ${payouts.length ? html`<section class="section"><h2>Liquidaciones</h2>${payoutTable(payouts)}</section>` : ''}`;
  return page(ctx, 'Ingresos', 'ingresos', body);
}

function payoutTable(payouts) {
  return html`<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Tipo</th><th class="num">Reservas</th><th class="num">Importe</th><th>Estado</th><th>Referencia</th></tr></thead>
    <tbody>${payouts.map((p) => html`<tr><td>${D.fmtDateShort(p.createdAt)}</td><td>${p.direction === 'to_specialist' ? 'Transferencia a vos' : 'Comisión a pagar'}</td><td class="num">${p.bookingsCount}</td><td class="num">${fmtMoney(p.net)}</td><td>${p.status === 'paid' ? C.pill('Pagada', 'ok') : p.status === 'cancelled' ? C.pill('Anulada') : C.pill('Pendiente', 'warn')}</td><td>${p.reference || '—'}</td></tr>`)}</tbody></table></div>`;
}

function billing(ctx, { months, payouts, sp }) {
  const b = sp.business || {};
  const body = html`${C.pageHead({ title: 'Facturación', subtitle: 'Resumen mensual de lo procesado y la tarifa de Alternativa.' })}
    <div class="table-wrap"><table class="table"><thead><tr><th>Mes</th><th class="num">Pagos</th><th class="num">Cobrado</th><th class="num">Tarifa Alternativa</th><th class="num">Procesador</th><th class="num">Reembolsado</th></tr></thead>
      <tbody>${months.length ? months.map((m) => html`<tr><td>${m._id}</td><td class="num">${m.n}</td><td class="num">${fmtMoney(m.gross)}</td><td class="num">${fmtMoney(m.commission)}</td><td class="num">${fmtMoney(m.fees)}</td><td class="num">${fmtMoney(m.refunded)}</td></tr>`) : html`<tr><td colspan="6" class="muted">Sin movimientos todavía.</td></tr>`}</tbody></table></div>
    ${payouts.length ? html`<section class="section"><h2>Liquidaciones</h2>${payoutTable(payouts)}</section>` : ''}
    <section class="section panel"><h2>Datos de facturación</h2>${C.dl([['Razón social', b.legalName || '—'], ['RUT / CI', b.taxId || '—'], ['Tipo', b.invoiceType || '—']])}<a href="/panel/cuenta">Editar datos</a></section>`;
  return page(ctx, 'Facturación', 'ingresos', body);
}

// ── Reseñas ───────────────────────────────────────────────
function reviews(ctx, { list, services, query, reasons }) {
  const body = html`${C.pageHead({ title: 'Reseñas', subtitle: 'No se pueden borrar: podés responder o pedir una revisión si incumplen las reglas.' })}
    <div class="grid-kpi">${services.filter((s) => s.rating?.count).map((s) => C.kpi(s.title, `${C.fmtRating(s.rating.avg)} ★`, `${s.rating.count} reseñas`))}</div>
    <form class="toolbar section">${C.select({ label: 'Servicio', name: 'servicio', value: query.servicio, options: [['', 'Todos'], ...services.map((s) => [s._id, s.title])] })}
      ${C.checkbox({ label: 'Sin responder', name: 'sinResponder', value: '1', checked: query.sinResponder === '1' })}<button class="btn btn--ghost btn--sm">Filtrar</button></form>
    ${list.length ? html`<div class="panel">${list.map((r) => html`<article class="review" id="r-${r._id}">
      <div class="review__head"><span class="review__who">${r.authorName}</span>${C.stars(r.rating, 14)}</div>
      <p class="review__meta">${r.service?.title} · ${D.fmtDateShort(r.createdAt)}${r.status === 'under_review' ? ' · En revisión' : r.status === 'hidden' ? ' · Oculta por moderación' : ''}</p>
      ${r.comment ? html`<p class="review__body">${r.comment}</p>` : ''}
      ${r.reply?.text ? html`<div class="review__reply"><strong>Tu respuesta</strong><br>${r.reply.text}</div>` : ''}
      <details style="margin-top:8px"><summary class="small" style="cursor:pointer;color:var(--blue-600)">${r.reply?.text ? 'Editar respuesta' : 'Responder'}</summary>
        <form method="post" action="/panel/resenas/${r._id}/responder" class="stack" style="margin-top:8px">${C.csrfField(ctx)}<textarea name="text" rows="3" maxlength="1500" required aria-label="Respuesta">${r.reply?.text || ''}</textarea><button class="btn btn--sm btn--primary">Publicar respuesta</button></form></details>
      ${r.status === 'published' ? html`<details style="margin-top:4px"><summary class="small muted" style="cursor:pointer">Pedir revisión</summary>
        <form method="post" action="/panel/resenas/${r._id}/revision" class="stack" style="margin-top:8px">${C.csrfField(ctx)}
          ${C.select({ label: 'Motivo', name: 'reason', required: true, options: Object.entries(reasons) })}
          ${C.field({ label: 'Detalle', name: 'details', type: 'textarea', rows: 3 })}<button class="btn btn--sm btn--ghost">Enviar a revisión</button></form></details>` : ''}
    </article>`)}</div>` : C.empty({ title: 'Todavía no tenés reseñas', text: 'Después de cada sesión le pedimos al cliente que valore el servicio.', iconName: 'star' })}`;
  return page(ctx, 'Reseñas', 'resenas', body);
}

function notifications(ctx, { list }) {
  const body = html`${C.pageHead({ title: 'Notificaciones', actions: html`<a class="btn btn--ghost btn--sm" href="/mi/configuracion">Preferencias</a>` })}
    ${list.length ? html`<ul class="list panel">${list.map((n) => html`<li><a class="list-row" href="${n.link || '#'}"><div class="list-row__main"><p class="${classes('list-row__title', !n.readAt && 'conv-unread')}">${n.title}</p>${n.body ? html`<p class="list-row__sub">${n.body}</p>` : ''}<p class="list-row__sub">${D.fmtRelative(n.createdAt)}</p></div></a></li>`)}</ul>` : C.empty({ title: 'Sin notificaciones', iconName: 'bell' })}`;
  return page(ctx, 'Notificaciones', 'inicio', body);
}

// ── Verificación ──────────────────────────────────────────
function verification(ctx, { sp, requests }) {
  const st = sp.verification?.identity?.status || 'none';
  const body = html`${C.pageHead({ title: 'Verificación de identidad', subtitle: 'Mostrá el sello “Identidad verificada” en tu ficha.' })}
    ${st === 'verified' ? html`<div class="panel panel--blue">${icon('shield', { size: 20 })} <strong>Tu identidad está verificada.</strong></div>`
    : st === 'pending' ? html`<div class="panel panel--blue">${icon('clock', { size: 20 })} <strong>Estamos revisando tu documentación.</strong> Te avisamos por email.</div>`
      : html`<form method="post" action="/panel/verificacion?_csrf=${ctx.csrf}" enctype="multipart/form-data" class="panel form stack" style="max-width:none">${C.csrfField(ctx)}
        ${st === 'rejected' ? html`<div class="flash flash--error">${icon('alert', { size: 18 })}<span>La verificación anterior no se aprobó${sp.verification.identity.note ? `: ${sp.verification.identity.note}` : ''}. Podés enviarla de nuevo.</span></div>` : ''}
        <p>Subí una foto de frente y dorso de tu cédula (o el documento que uses), y una selfie sosteniéndolo. Los archivos son privados: solo los ve el equipo de verificación.</p>
        <div class="field"><label for="f-docs">Archivos (hasta 3)</label><input id="f-docs" type="file" name="documents" multiple required accept="image/jpeg,image/png,application/pdf"><p class="field__hint">JPG, PNG o PDF.</p></div>
        ${C.field({ label: 'Últimos 4 dígitos del documento', name: 'documentNumber', inputmode: 'numeric', maxlength: 12, hint: 'No guardamos el número completo.' })}
        ${C.field({ label: 'Comentarios', name: 'notes', type: 'textarea', rows: 2 })}
        <button class="btn btn--primary">Enviar para verificar</button></form>`}
    <section class="section panel"><h2>Qué significa cada sello</h2>
      <div class="cred cred--verified">${icon('shield', { size: 18 })}<div><strong>Identidad verificada</strong><br><span class="small muted">Alternativa revisó tu documento.</span></div></div>
      <div class="cred cred--verified">${icon('checkCircle', { size: 18 })}<div><strong>Certificación verificada</strong><br><span class="small muted">Alternativa revisó el certificado. <a href="/panel/certificaciones">Cargar certificaciones</a></span></div></div>
      <div class="cred cred--declared">${icon('file', { size: 18 })}<div><strong>Declarado</strong><br><span class="small muted">Lo informaste vos y todavía no fue comprobado.</span></div></div>
    </section>
    ${requests.length ? html`<section class="section"><h2>Envíos</h2><ul class="list panel">${requests.map((r) => html`<li class="row row--between"><span>${D.fmtDateShort(r.createdAt)} · ${r.type === 'claim' ? 'Reclamo de perfil' : 'Identidad'}</span>${C.pill(r.status === 'approved' ? 'Aprobada' : r.status === 'rejected' ? 'Rechazada' : 'Pendiente', r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'danger' : 'info')}</li>`)}</ul></section>` : ''}`;
  return page(ctx, 'Verificación', 'verificacion', body);
}

function certifications(ctx, { list, categories }) {
  const ST = { declared: ['Declarada', 'muted'], pending: ['En revisión', 'info'], verified: ['Verificada', 'ok'], rejected: ['No aprobada', 'danger'] };
  const body = html`${C.pageHead({ title: 'Formación y certificaciones', back: '/panel/perfil' })}
    ${list.length ? html`<ul class="list panel">${list.map((c) => html`<li class="row row--between"><div><strong>${c.title}</strong>${c.issuer ? ` · ${c.issuer}` : ''}${c.year ? ` · ${c.year}` : ''}<br>${C.pill(ST[c.status][0], ST[c.status][1])}${c.review?.note ? html` <span class="small muted">${c.review.note}</span>` : ''}</div>
      ${C.actionButton(ctx, { action: `/panel/certificaciones/${c._id}/eliminar`, label: 'Eliminar', cls: 'btn btn--text btn--sm', confirm: '¿Eliminar esta certificación?' })}</li>`)}</ul>` : ''}
    <form method="post" action="/panel/certificaciones?_csrf=${ctx.csrf}" enctype="multipart/form-data" class="panel form section" style="max-width:none">${C.csrfField(ctx)}
      <h2>Agregar</h2>
      ${C.field({ label: 'Título o certificación', name: 'title', required: true, placeholder: 'Masoterapeuta' })}
      <div class="grid-2">${C.field({ label: 'Institución', name: 'issuer' })}${C.field({ label: 'Año', name: 'year', type: 'number', min: 1950, max: new Date().getFullYear() })}</div>
      ${categories.length ? C.select({ label: 'Relacionada con', name: 'category', options: [['', '—'], ...categories.map((c) => [c._id, c.name])] }) : ''}
      <div class="field"><label for="f-doc">Documento (para verificarla)</label><input id="f-doc" type="file" name="document" accept="application/pdf,image/jpeg,image/png"><p class="field__hint">Privado. Sin documento se muestra como declarada.</p></div>
      <button class="btn btn--primary">Agregar certificación</button>
    </form>`;
  return page(ctx, 'Certificaciones', 'perfil', body);
}

// ── Cuenta ────────────────────────────────────────────────
function account(ctx, { sp, settings }) {
  const b = sp.business || {};
  const body = html`${C.pageHead({ title: 'Configuración de la cuenta' })}
    <form method="post" action="/panel/cuenta" class="form" style="max-width:720px">${C.csrfField(ctx)}
      <section class="panel stack"><h2>Reservas</h2>
        ${C.checkbox({ label: 'Confirmar reservas automáticamente al recibir el pago', name: 'autoConfirm', checked: sp.settings?.autoConfirm !== false, hint: 'Si lo desactivás, tenés que confirmar cada reserva pagada.' })}
        ${C.checkbox({ label: 'Permitir que los clientes reprogramen desde la app', name: 'allowReschedule', checked: sp.settings?.allowReschedule !== false, hint: `Según la política: hasta ${settings.cancellation.rescheduleMinHours} h antes.` })}
      </section>
      <section class="panel stack section"><h2>Datos de facturación</h2>
        ${C.field({ label: 'Nombre o razón social', name: 'legalName', value: b.legalName })}
        <div class="grid-2">${C.field({ label: 'RUT o CI', name: 'taxId', value: b.taxId })}${C.select({ label: 'Tipo de contribuyente', name: 'invoiceType', value: b.invoiceType, options: [['', '—'], ['monotributo', 'Monotributo'], ['literal_e', 'Literal E'], ['empresa', 'Empresa'], ['otro', 'Otro']] })}</div>
      </section>
      ${settings.payments.collectionModel === 'platform' ? html`<section class="panel stack section"><h2>Cuenta para liquidaciones</h2>
        ${C.select({ label: 'Método', name: 'payoutMethod', value: b.payoutMethod, options: [['', '—'], ['bank', 'Transferencia bancaria'], ['mercadopago', 'Mercado Pago']] })}
        <div class="grid-2">${C.field({ label: 'Banco', name: 'bankName', value: b.bankName })}${C.field({ label: 'Titular', name: 'accountHolder', value: b.accountHolder })}</div>
        <div class="grid-2">${C.field({ label: 'Número de cuenta', name: 'accountNumber', value: b.accountNumber })}${C.field({ label: 'Tipo de cuenta', name: 'accountType', value: b.accountType, placeholder: 'Caja de ahorro en pesos' })}</div>
        ${C.field({ label: 'Email de Mercado Pago', name: 'payoutEmail', type: 'email', value: b.payoutEmail })}
      </section>` : ''}
      <div class="form-actions"><button class="btn btn--primary">Guardar</button></div>
    </form>
    <section class="section panel stack" style="max-width:720px"><h2>Cobros</h2><p class="muted" style="margin:0">Cómo recibís el dinero de tus reservas.</p><a class="btn btn--ghost" href="/panel/cuenta/cobros">${icon('card', { size: 16 })}Configurar cobros</a></section>
    ${sp.status === 'active' ? html`<section class="section panel stack" style="max-width:720px"><h2>Pausar mi ficha</h2><p class="muted" style="margin:0">Dejás de aparecer en búsquedas y no recibís reservas nuevas. Tus reservas existentes se mantienen.</p>${C.actionButton(ctx, { action: '/panel/pausar', label: 'Pausar ficha', cls: 'btn btn--danger', confirm: '¿Pausar tu ficha?' })}</section>` : ''}
    <p class="small muted">Tu cuenta personal (email, contraseña, notificaciones) se configura en <a href="/mi/configuracion">Mi cuenta</a>.</p>`;
  return page(ctx, 'Configuración', 'configuracion', body);
}

function payouts(ctx, { sp, settings, provider, oauthReady }) {
  const model = settings.payments.collectionModel;
  const connected = !!sp.mercadopago?.connectedAt;
  const body = html`${C.pageHead({ title: 'Cobros', back: '/panel/cuenta' })}
    <section class="panel stack">
      <h2>${COLLECTION_MODELS[model].short}</h2>
      ${model === 'split' ? html`
        <p style="margin:0">El cliente paga una sola vez. Mercado Pago divide el pago al instante: tu parte va a tu cuenta y la tarifa de Alternativa a la nuestra. No hay transferencias manuales ni liquidaciones.</p>
        <p class="small muted" style="margin:0">Mercado Pago descuenta su comisión de procesamiento según las condiciones de tu cuenta${settings.payments.processorFeePaidBy === 'specialist' ? '' : settings.payments.processorFeePaidBy === 'customer' ? ' (en Alternativa ese costo lo paga el cliente)' : ' (en Alternativa ese costo lo absorbe la plataforma)'}. Los reembolsos se descuentan proporcionalmente de tu parte y de la tarifa; mantené saldo disponible para cubrirlos.</p>
        <div class="panel ${connected ? 'panel--blue' : 'panel--warn'}">
          ${connected ? html`${icon('checkCircle', { size: 20 })} <strong>Cuenta de Mercado Pago vinculada</strong>${sp.mercadopago.userId ? html` <span class="small muted">(usuario ${sp.mercadopago.userId})</span>` : ''}<br><span class="small muted">Desde el ${D.fmtDateShort(sp.mercadopago.connectedAt)}</span>`
    : html`${icon('alert', { size: 20 })} <strong>Todavía no vinculaste tu cuenta.</strong> Sin cuenta vinculada tu ficha no puede recibir reservas pagas.`}
        </div>
        <div class="btnbar">
          ${connected ? C.actionButton(ctx, { action: '/panel/cuenta/cobros/desconectar', label: 'Desvincular', cls: 'btn btn--danger', confirm: '¿Desvincular tu cuenta de Mercado Pago?' })
    : oauthReady ? html`<a class="btn btn--primary" href="/panel/cuenta/cobros/mercadopago/conectar">Vincular Mercado Pago</a>` : html`<p class="small muted">La vinculación todavía no está habilitada. Avisanos desde Ayuda.</p>`}
          ${!connected && provider === 'simulated' ? C.actionButton(ctx, { action: '/panel/cuenta/cobros/simular', label: 'Simular vinculación (prueba)', cls: 'btn btn--ghost' }) : ''}
        </div>` : model === 'platform'
    ? html`<p style="margin:0">Alternativa cobra las reservas y te transfiere tu parte cada ${settings.payments.payoutFrequencyDays} días, una vez realizadas las sesiones.</p><a href="/panel/cuenta">Cargar cuenta para liquidaciones</a>`
    : html`<p style="margin:0">Cobrás directamente a tus clientes. Alternativa te factura periódicamente la tarifa de servicio de las reservas realizadas.</p>`}
    </section>
    <p class="small muted section">Alternativa nunca guarda datos de tarjetas. Los pagos los procesa Mercado Pago.</p>`;
  return page(ctx, 'Cobros', 'cobros', body);
}

// ── Crecimiento ───────────────────────────────────────────
function promotions(ctx, { list, services }) {
  const AUD = { all: 'Todos', new_clients: 'Clientes nuevos', returning_clients: 'Clientes que vuelven' };
  const body = html`${C.pageHead({ title: 'Promociones', subtitle: 'Descuentos que se aplican solos al reservar. El descuento sale de tu precio.' })}
    ${list.length ? html`<ul class="list panel">${list.map((p) => html`<li class="row row--between"><div><strong>${p.title}</strong> · ${p.discountPercent}% · ${AUD[p.audience]}${p.code ? html` · código <span class="code">${p.code}</span>` : ''}<br><span class="small muted">${p.validFrom ? `Desde ${D.fmtDateShort(p.validFrom)} ` : ''}${p.validTo ? `hasta ${D.fmtDateShort(p.validTo)}` : 'sin vencimiento'} · ${p.uses}${p.maxUses ? `/${p.maxUses}` : ''} usos</span></div>
      <div class="row">${C.pill(p.status === 'active' ? 'Activa' : p.status === 'paused' ? 'Pausada' : p.status === 'ended' ? 'Finalizada' : 'En revisión', p.status === 'active' ? 'ok' : 'muted')}${['active', 'paused'].includes(p.status) ? C.actionButton(ctx, { action: `/panel/promociones/${p._id}/estado`, label: p.status === 'active' ? 'Pausar' : 'Activar', cls: 'btn btn--text btn--sm' }) : ''}</div></li>`)}</ul>` : ''}
    <form method="post" action="/panel/promociones" class="panel form section" style="max-width:none">${C.csrfField(ctx)}<h2>Nueva promoción</h2>
      <div class="grid-2">${C.field({ label: 'Título', name: 'title', required: true, placeholder: 'Primera sesión con 15% off' })}${C.field({ label: 'Descuento (%)', name: 'discountPercent', type: 'number', min: 5, max: 50, required: true, value: 10 })}</div>
      <div class="grid-2">${C.select({ label: 'Para quién', name: 'audience', options: Object.entries(AUD) })}${C.field({ label: 'Código (opcional)', name: 'code', hint: 'Si lo completás, solo aplica con el código.' })}</div>
      ${C.checkGroup({ label: 'Servicios (ninguno = todos)', name: 'services', options: services.map((s) => [s._id, s.title]) })}
      <div class="grid-3">${C.field({ label: 'Desde', name: 'validFrom', type: 'date' })}${C.field({ label: 'Hasta', name: 'validTo', type: 'date' })}${C.field({ label: 'Usos máximos', name: 'maxUses', type: 'number', min: 0, value: 0, hint: '0 = sin límite' })}</div>
      <button class="btn btn--primary">Crear promoción</button>
    </form>`;
  return page(ctx, 'Promociones', 'promociones', body);
}

function sponsored(ctx, { list, services, categories }) {
  const TYPES = { category: 'Destacado en una categoría', zone: 'Destacado en tu zona', home: 'Recomendados en el inicio', recommendation: 'Recomendaciones', search: 'Búsquedas' };
  const ST = { scheduled: 'Programada', active: 'Activa', paused: 'Solicitada / pausada', ended: 'Finalizada', cancelled: 'Cancelada' };
  const body = html`${C.pageHead({ title: 'Destacados', subtitle: 'Comprá exposición adicional. Se muestra marcada como “Patrocinado” y nunca cambia tus estrellas ni tus reseñas.' })}
    ${list.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Tipo</th><th>Período</th><th>Estado</th><th class="num">Impresiones</th><th class="num">Clics</th></tr></thead>
      <tbody>${list.map((p) => html`<tr><td>${TYPES[p.type]}${p.category ? ` · ${p.category.name}` : ''}</td><td>${D.fmtDateShort(p.startsAt)} – ${D.fmtDateShort(p.endsAt)}</td><td>${ST[p.status]}</td><td class="num">${p.impressions}</td><td class="num">${p.clicks}</td></tr>`)}</tbody></table></div>` : ''}
    <form method="post" action="/panel/destacados" class="panel form section" style="max-width:none">${C.csrfField(ctx)}<h2>Solicitar un destacado</h2>
      <div class="grid-2">${C.select({ label: 'Dónde', name: 'type', required: true, options: Object.entries(TYPES).filter(([k]) => k !== 'search') })}${C.select({ label: 'Categoría', name: 'category', options: [['', '—'], ...categories.map((c) => [c._id, c.name])] })}</div>
      <div class="grid-2">${C.select({ label: 'Servicio a promocionar', name: 'service', options: [['', 'El mejor valorado'], ...services.map((s) => [s._id, s.title])] })}${C.field({ label: 'Semanas', name: 'weeks', type: 'number', min: 1, max: 12, value: 2 })}</div>
      ${C.field({ label: 'Comentarios', name: 'notes', type: 'textarea', rows: 2 })}
      <button class="btn btn--primary">Solicitar presupuesto</button>
    </form>`;
  return page(ctx, 'Destacados', 'destacados', body);
}

function plan(ctx, { sp }) {
  const body = html`${C.pageHead({ title: 'Plan Profesional' })}
    ${sp.plan === 'profesional' ? html`<div class="panel panel--lav">${icon('sparkle', { size: 20 })} <strong>Tenés el Plan Profesional</strong>${sp.planExpiresAt ? ` hasta el ${D.fmtDateShort(sp.planExpiresAt)}` : ''}.</div>` : ''}
    <div class="grid-2 section">
      <section class="panel"><h2>Gratis</h2><ul class="checklist">${['Ficha pública con servicios, fotos y video', 'Agenda online y reservas pagas', 'Mensajes con clientes', 'Estadísticas principales', 'Reseñas verificadas'].map((x) => html`<li><span>${icon('check', { size: 18 })}${x}</span></li>`)}</ul></section>
      <section class="panel panel--lav"><h2>Profesional</h2><ul class="checklist">${['Estadísticas avanzadas y exportación', 'CRM: etiquetas, notas y recordatorios por cliente', 'Promociones y paquetes de sesiones', 'Más personalización de la ficha', 'Automatizaciones de mensajes', 'Informes mensuales'].map((x) => html`<li><span>${icon('sparkle', { size: 18 })}${x}</span></li>`)}</ul>
        ${sp.plan !== 'profesional' ? html`<form method="post" action="/panel/plan" class="stack" style="margin-top:12px">${C.csrfField(ctx)}${C.field({ label: '¿Qué te interesa más?', name: 'notes', type: 'textarea', rows: 2 })}<button class="btn btn--lav">Quiero el Plan Profesional</button></form>` : ''}</section>
    </div>`;
  return page(ctx, 'Plan Profesional', 'plan', body);
}

module.exports = {
  onboarding, dashboard, more, profile, profileEdit, appearance, media, mediaUpload, services, serviceForm, serviceDetail, agenda, schedule, blocks,
  availabilityPreview, bookings, bookingDetail, clients, clientDetail, inbox, stats, views, performance, income, billing, reviews, notifications,
  verification, certifications, account, payouts, promotions, sponsored, plan,
};
