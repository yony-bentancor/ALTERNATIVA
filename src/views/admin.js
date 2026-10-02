'use strict';
const { html, attr, classes } = require('../lib/html');
const { fmtMoney, fmtPercent } = require('../lib/money');
const D = require('../lib/dates');
const {
  MODALITIES, SPECIALIST_STATUS, SERVICE_STATUS, PAYMENT_STATUS, COLLECTION_MODELS, BOOKING_STATUS, REPORT_REASONS,
} = require('../lib/constants');
const { layout } = require('./layout');
const { icon, CATEGORY_ICONS } = require('./icons');
const C = require('./components');

const page = (ctx, title, active, body) => layout(ctx, { title: `${title} · Admin`, active, body, area: 'admin', noindex: true, wide: true });
const csrf = (ctx) => C.csrfField(ctx);
const idLink = (href, text) => html`<a href="${href}">${text}</a>`;

function filters(fields, query, action = '') {
  return html`<form class="toolbar" action="${action}">${fields.map((f) => (f.options
    ? C.select({ label: f.label, name: f.name, value: query[f.name], options: [['', 'Todos'], ...f.options] })
    : C.field({ label: f.label, name: f.name, value: query[f.name], type: f.type || 'text' })))}<button class="btn btn--ghost btn--sm">Filtrar</button></form>`;
}

function table(headers, rows, empty = 'Sin resultados.') {
  return html`<div class="table-wrap"><table class="table"><thead><tr>${headers.map((h) => (Array.isArray(h) ? html`<th class="${h[1]}">${h[0]}</th>` : html`<th>${h}</th>`))}</tr></thead>
    <tbody>${rows.length ? rows : html`<tr><td colspan="${headers.length}" class="muted">${empty}</td></tr>`}</tbody></table></div>`;
}

const statusOpts = (obj) => Object.entries(obj).map(([k, v]) => [k, typeof v === 'string' ? v : v.label]);

// ── Resumen ───────────────────────────────────────────────
function dashboard(ctx, { stats: s, recent, latestBookings }) {
  const pend = s.pending;
  const pendingTotal = pend.reports + pend.tickets + pend.verifications + pend.specialists + pend.incidents;
  const body = html`${C.pageHead({ title: 'Resumen', subtitle: 'Administrá el sistema y sus excepciones, no cada reserva.' })}
    ${C.tabs([['7d', '/admin?periodo=7d', '7 días'], ['30d', '/admin?periodo=30d', '30 días'], ['90d', '/admin?periodo=90d', '90 días'], ['365d', '/admin?periodo=365d', '12 meses']], s.period)}
    ${pendingTotal ? html`<a class="panel panel--warn row" href="/admin/pendientes" style="text-decoration:none;color:inherit;margin-bottom:16px">${icon('bell', { size: 22 })}<span style="flex:1"><strong>${pendingTotal} temas requieren intervención</strong><br><span class="small">${pend.specialists} fichas · ${pend.verifications} verificaciones · ${pend.reports} denuncias · ${pend.tickets} consultas · ${pend.incidents} incidencias</span></span>${icon('chevronRight')}</a>` : html`<p class="notice">${icon('checkCircle', { size: 16 })} Nada requiere intervención en este momento.</p>`}
    <div class="grid-kpi">
      ${C.kpi('Usuarios', s.users.toLocaleString('es-UY'), `+${s.newUsers} en el período`)}
      ${C.kpi('Especialistas activos', s.activeSpecialists, `${s.specialists} en total · +${s.newSpecialists}`)}
      ${C.kpi('Servicios publicados', s.services)}
      ${C.kpi('Reservas', s.bookings, `${s.cancellations} canceladas`)}
      ${C.kpi('Facturación procesada', fmtMoney(s.gross), `${s.paymentsCount} pagos`)}
      ${C.kpi('Comisiones (neto de reembolsos)', fmtMoney(s.commission))}
      ${C.kpi('Costo de procesamiento', fmtMoney(s.processorFees))}
      ${C.kpi('Reembolsos', fmtMoney(s.refunds))}
      ${C.kpi('Usuarios activos', s.activeUsers, `${String(s.bookingsPerActiveUser).replace('.', ',')} reservas por usuario`)}
      ${C.kpi('Reseñas', s.reviews, s.reviewsAvg ? `Promedio ${String(s.reviewsAvg).replace('.', ',')} ★` : '')}
    </div>
    <section class="section panel"><h2>Reservas por día</h2>${C.barChart(s.series, { key: 'bookings', label: 'Reservas por día' })}</section>
    <div class="grid-2 section" style="align-items:start">
      <section class="panel"><div class="panel__title"><h2>Últimas reservas</h2><a href="/admin/reservas">Ver todas</a></div>
        <ul class="list">${latestBookings.map((b) => html`<li><a class="list-row" href="/admin/reservas/${b._id}"><div class="list-row__main"><p class="list-row__title">${b.code} · ${b.snapshot.serviceTitle}</p><p class="list-row__sub">${b.snapshot.userName} → ${b.snapshot.specialistName} · ${D.fmtDateTime(b.start)}</p></div>${C.statusPill(b.status)}</a></li>`)}</ul></section>
      <section class="panel"><div class="panel__title"><h2>Eventos sensibles</h2><a href="/admin/auditoria">Auditoría</a></div>
        ${recent.length ? html`<ul class="list">${recent.map((l) => html`<li><p class="list-row__title" style="font-size:.9rem">${l.action}</p><p class="list-row__sub">${l.actorName} · ${D.fmtRelative(l.createdAt)}${l.summary ? ` · ${l.summary}` : ''}</p></li>`)}</ul>` : html`<p class="muted">Sin eventos.</p>`}</section>
    </div>`;
  return page(ctx, 'Resumen', 'dashboard', body);
}

function pending(ctx, d) {
  const item = (n, label, href) => (n ? html`<li><a class="list-row" href="${href}"><span class="pill pill--brand">${n}</span><span class="list-row__main">${label}</span>${icon('chevronRight', { size: 16 })}</a></li>` : '');
  const body = html`${C.pageHead({ title: 'Solicitudes pendientes', subtitle: 'Lo que necesita una decisión humana.' })}
    <ul class="list panel">
      ${item(d.specialistsPending.length, 'Fichas esperando publicación', '/admin/especialistas?estado=pending_review')}
      ${item(d.withChanges.length, 'Cambios sensibles de perfiles', '/admin/moderacion?tab=cambios')}
      ${item(d.verifications, 'Verificaciones de identidad', '/admin/verificaciones')}
      ${item(d.certs, 'Certificaciones para verificar', '/admin/verificaciones')}
      ${item(d.services.length, 'Servicios en revisión', '/admin/moderacion?tab=servicios')}
      ${item(d.categories.length, 'Categorías propuestas', '/admin/categorias')}
      ${item(d.media, 'Multimedia pendiente o reportada', '/admin/moderacion')}
      ${item(d.reviews, 'Reseñas con pedido de revisión', '/admin/resenas?estado=under_review')}
      ${item(d.reports, 'Denuncias abiertas', '/admin/denuncias')}
      ${item(d.tickets, 'Consultas de soporte abiertas', '/admin/soporte')}
      ${item(d.refunds, 'Reembolsos fallidos', '/admin/reembolsos?estado=failed')}
      ${item(d.incidents.length, 'Reservas con incidencia', '/admin/reservas?incidencia=1')}
      ${item(d.adRequests, 'Solicitudes de destacados', '/admin/destacados')}
    </ul>
    ${d.specialistsPending.length ? html`<section class="section"><h2>Fichas para revisar</h2><ul class="list panel">${d.specialistsPending.map((s) => html`<li><a class="list-row" href="/admin/especialistas/${s._id}"><span class="list-row__main">${s.displayName}</span><span class="small muted">${D.fmtRelative(s.createdAt)}</span></a></li>`)}</ul></section>` : ''}
    ${d.incidents.length ? html`<section class="section"><h2>Incidencias</h2><ul class="list panel">${d.incidents.map((b) => html`<li><a class="list-row" href="/admin/reservas/${b._id}"><span class="list-row__main"><strong>${b.code}</strong> · ${b.snapshot.specialistName}<br><span class="small muted">${b.incident.note}</span></span></a></li>`)}</ul></section>` : ''}`;
  return page(ctx, 'Pendientes', 'pendientes', body);
}

function stats(ctx, { stats: s, byCategory, byDepartment, topSpecialists, byModel }) {
  const body = html`${C.pageHead({ title: 'Estadísticas' })}
    ${C.tabs([['7d', '/admin/estadisticas?periodo=7d', '7 días'], ['30d', '/admin/estadisticas?periodo=30d', '30 días'], ['90d', '/admin/estadisticas?periodo=90d', '90 días'], ['365d', '/admin/estadisticas?periodo=365d', '12 meses']], s.period)}
    <section class="panel"><h2>Economía real de las operaciones</h2>
      ${C.dl([
    ['Volumen procesado', fmtMoney(s.gross)],
    ['Comisión bruta de Alternativa (neta de reembolsos)', fmtMoney(s.commission)],
    ['Costo del procesador informado', fmtMoney(s.processorFees)],
    ['Reembolsos', fmtMoney(s.refunds)],
    ['Reservas por usuario activo (recurrencia)', String(s.bookingsPerActiveUser).replace('.', ',')],
  ])}
      <p class="small muted">El costo del procesador lo absorbe quien indique la configuración de pagos; el margen neto de Alternativa depende de ese reparto e impuestos.</p></section>
    <div class="grid-2 section" style="align-items:start">
      <section class="panel"><h2>Por categoría</h2>${C.hbars(byCategory.map((c) => ({ label: c._id || '—', value: c.n, display: `${c.n} · ${fmtMoney(c.gross)}` })))}</section>
      <section class="panel"><h2>Por departamento</h2>${C.hbars(byDepartment.map((c) => ({ label: c._id || 'Sin ubicación', value: c.n })))}</section>
    </div>
    <div class="grid-2 section" style="align-items:start">
      <section class="panel"><h2>Especialistas con más reservas</h2>${C.hbars(topSpecialists.map((t) => ({ label: t.name, value: t.n, display: `${t.n} · ${fmtMoney(t.commission)}` })))}</section>
      <section class="panel"><h2>Por modelo de cobro</h2>${C.hbars(byModel.map((m) => ({ label: COLLECTION_MODELS[m._id]?.short || m._id, value: m.n, display: `${m.n} · ${fmtMoney(m.gross)}` })))}</section>
    </div>
    <section class="section panel"><h2>Reservas por estado</h2>${C.hbars(Object.entries(s.byStatus).map(([k, v]) => ({ label: BOOKING_STATUS[k]?.label || k, value: v })))}</section>`;
  return page(ctx, 'Estadísticas', 'estadisticas', body);
}

// ── Especialistas ─────────────────────────────────────────
function specialists(ctx, { result, query }) {
  const body = html`${C.pageHead({ title: 'Especialistas', actions: html`<a class="btn btn--primary btn--sm" href="/admin/especialistas/nuevo">${icon('plus', { size: 16 })}Crear especialista</a>` })}
    ${filters([{ label: 'Buscar', name: 'q' }, { label: 'Estado', name: 'estado', options: Object.entries(SPECIALIST_STATUS) }, { label: 'Identidad', name: 'verificacion', options: [['none', 'Sin verificar'], ['pending', 'Pendiente'], ['verified', 'Verificada'], ['rejected', 'Rechazada']] }, { label: 'Origen', name: 'reclamo', options: [['self', 'Alta propia'], ['unclaimed', 'Sin reclamar'], ['invited', 'Invitado'], ['claimed', 'Reclamado']] }], query)}
    ${table(['Especialista', 'Estado', 'Identidad', 'Ubicación', ['Reseñas', 'num'], ['Comisión', 'num'], 'Alta'], result.items.map((s) => html`<tr>
      <td>${idLink(`/admin/especialistas/${s._id}`, s.displayName)}<br><span class="small muted">${s.claim?.status === 'unclaimed' ? 'Sin reclamar' : s.claim?.status === 'invited' ? 'Invitado' : ''}</span></td>
      <td>${C.pill(SPECIALIST_STATUS[s.status], s.status === 'active' ? 'ok' : s.status === 'suspended' ? 'danger' : s.status === 'pending_review' ? 'info' : 'muted')}</td>
      <td>${s.verification?.identity?.status === 'verified' ? C.pill('Verificada', 'ok') : s.verification?.identity?.status === 'pending' ? C.pill('Pendiente', 'info') : '—'}</td>
      <td>${[s.location?.city, s.location?.department].filter(Boolean).join(', ')}</td>
      <td class="num">${s.stats?.reviewCount || 0}</td><td class="num">${s.commissionRate !== null && s.commissionRate !== undefined ? fmtPercent(s.commissionRate) : 'General'}</td><td>${D.fmtDateShort(s.createdAt)}</td></tr>`))}
    ${C.pagination(result, query, '/admin/especialistas')}`;
  return page(ctx, 'Especialistas', 'especialistas', body);
}

function specialistForm(ctx, { categories, values: v = {}, errors = {}, editing, departments }) {
  const loc = v.location || {};
  const coords = loc.geo?.coordinates || [];
  const body = html`${C.pageHead({ title: editing ? `Editar ${v.displayName}` : 'Crear especialista', subtitle: editing ? '' : 'Cargá una ficha completa. Después podés invitar al especialista a reclamarla.', back: editing ? `/admin/especialistas/${editing}` : '/admin/especialistas' })}
    <form method="post" action="${editing ? `/admin/especialistas/${editing}` : '/admin/especialistas'}" class="form" style="max-width:820px">${csrf(ctx)}
      <section class="panel stack"><h2>Ficha</h2>
        ${C.field({ label: 'Nombre profesional', name: 'displayName', value: v.displayName, required: true, error: errors.displayName })}
        ${C.field({ label: 'Frase de presentación', name: 'headline', value: v.headline })}
        ${C.field({ label: 'Presentación', name: 'bio', type: 'textarea', rows: 5, value: v.bio })}
        ${C.field({ label: 'Experiencia', name: 'experience', type: 'textarea', rows: 3, value: v.experience })}
        ${C.field({ label: 'Formación', name: 'education', type: 'textarea', rows: 3, value: v.education })}
        ${C.field({ label: 'Años de experiencia', name: 'yearsOfExperience', type: 'number', value: v.yearsOfExperience })}
        ${C.checkGroup({ label: 'Categorías', name: 'categories', options: categories.map((c) => [c._id, c.name]), values: [].concat(v.categories || []).map(String) })}
        ${C.checkGroup({ label: 'Modalidades', name: 'modalities', options: Object.entries(MODALITIES).map(([k, m]) => [k, m.label]), values: [].concat(v.modalities || []) })}
      </section>
      <section class="panel stack section"><h2>Ubicación</h2>
        <div class="grid-2">${C.select({ label: 'Departamento', name: 'department', value: loc.department || v.department, options: [['', '—'], ...departments.map((x) => [x, x])] })}${C.field({ label: 'Ciudad', name: 'city', value: loc.city || v.city })}</div>
        <div class="grid-2">${C.field({ label: 'Barrio', name: 'neighborhood', value: loc.neighborhood || v.neighborhood })}${C.field({ label: 'Radio a domicilio (km)', name: 'serviceRadiusKm', type: 'number', value: loc.serviceRadiusKm ?? v.serviceRadiusKm })}</div>
        ${C.field({ label: 'Dirección (privada)', name: 'address', value: loc.address || v.address })}
        ${C.field({ label: 'Referencia pública', name: 'addressPublicHint', value: loc.addressPublicHint || v.addressPublicHint })}
        <div class="grid-2">${C.field({ label: 'Latitud', name: 'lat', type: 'number', step: 'any', value: coords[1] ?? v.lat })}${C.field({ label: 'Longitud', name: 'lng', type: 'number', step: 'any', value: coords[0] ?? v.lng })}</div>
      </section>
      <section class="panel stack section"><h2>Comercial</h2>
        ${C.field({ label: 'Teléfono de contacto (privado)', name: 'contactPhone', type: 'tel', value: v.contactPhone })}
        <div class="grid-2">${C.field({ label: 'Comisión particular (%)', name: 'commissionRate', type: 'number', step: 0.1, min: 0, max: 50, value: v.commissionRate ?? '', hint: 'Vacío = reglas generales.' })}
        ${C.select({ label: 'Plan', name: 'plan', value: v.plan || 'free', options: [['free', 'Gratis'], ['profesional', 'Profesional']] })}</div>
        ${C.field({ label: 'Plan vigente hasta', name: 'planExpiresAt', type: 'date', value: v.planExpiresAt ? D.localParts(v.planExpiresAt).dateStr : '' })}
      </section>
      <div class="form-actions"><button class="btn btn--primary btn--lg">${editing ? 'Guardar cambios' : 'Crear ficha'}</button></div>
    </form>`;
  return page(ctx, editing ? 'Editar especialista' : 'Crear especialista', 'especialistas', body);
}

function specialistDetail(ctx, d) {
  const { sp, user, services, media, certifications, requests, stats: s, completeness, logs, reports, categories } = d;
  const catName = new Map(categories.map((c) => [String(c._id), c.name]));
  const statusBtns = [['active', 'Publicar / reactivar', 'btn btn--primary'], ['inactive', 'Desactivar', 'btn btn--ghost'], ['draft', 'Volver a borrador', 'btn btn--ghost']].filter(([st]) => st !== sp.status);
  const body = html`${C.pageHead({ title: sp.displayName, subtitle: html`${C.pill(SPECIALIST_STATUS[sp.status], sp.status === 'active' ? 'ok' : 'warn')} · <a href="/especialistas/${sp.slug}">/especialistas/${sp.slug}</a>`, back: '/admin/especialistas', actions: html`<a class="btn btn--primary btn--sm" href="/admin/especialistas/${sp._id}/editar">${icon('edit', { size: 16 })}Editar</a>` })}
    <div class="grid-kpi">${C.kpi('Reservas (90 d)', s.bookings)}${C.kpi('Ingresos especialista (90 d)', fmtMoney(s.revenue))}${C.kpi('Visualizaciones (90 d)', s.views)}${C.kpi('Ficha completa', `${completeness.percent}%`)}</div>
    ${sp.pendingChanges?.length ? html`<section class="section panel panel--warn"><h2>Cambios pendientes</h2>${sp.pendingChanges.map((p) => html`<div class="row row--between" style="padding:8px 0"><span><strong>${p.field === 'displayName' ? 'Nombre' : 'Categorías'}:</strong> ${p.field === 'categories' ? [].concat(p.value).map((id) => catName.get(String(id)) || id).join(', ') : String(p.value)} <span class="small muted">(${D.fmtRelative(p.requestedAt)})</span></span>
      <span class="row">${C.actionButton(ctx, { action: `/admin/especialistas/${sp._id}/cambios`, label: 'Aprobar', cls: 'btn btn--primary btn--sm', fields: { field: p.field, decision: 'aprobar' } })}${C.actionButton(ctx, { action: `/admin/especialistas/${sp._id}/cambios`, label: 'Rechazar', cls: 'btn btn--danger btn--sm', fields: { field: p.field, decision: 'rechazar' } })}</span></div>`)}</section>` : ''}
    <div class="grid-2 section" style="align-items:start">
      <section class="panel stack"><h2>Estado y moderación</h2>
        <div class="btnbar" style="margin:0">${statusBtns.map(([st, label, cls]) => C.actionButton(ctx, { action: `/admin/especialistas/${sp._id}/estado`, label, cls: `${cls} btn--sm`, fields: { status: st } }))}</div>
        ${sp.status !== 'suspended' ? html`<form method="post" action="/admin/especialistas/${sp._id}/estado" class="inputgroup" data-confirm="¿Suspender esta ficha?">${csrf(ctx)}<input type="hidden" name="status" value="suspended"><input type="text" name="reason" placeholder="Motivo de suspensión" required aria-label="Motivo"><button class="btn btn--danger btn--sm" style="flex:0 0 auto">Suspender</button></form>` : html`<p class="notice">Suspendida: ${sp.statusReason}</p>`}
        <h3 style="margin-top:12px">Identidad</h3>
        <p style="margin:0">${sp.verification?.identity?.status === 'verified' ? C.pill('Verificada', 'ok') : C.pill(sp.verification?.identity?.status || 'none')}${sp.verification?.identity?.at ? html` <span class="small muted">${D.fmtDateShort(sp.verification.identity.at)}</span>` : ''}</p>
        <div class="row">${C.actionButton(ctx, { action: `/admin/especialistas/${sp._id}/identidad`, label: 'Marcar verificada', cls: 'btn btn--ghost btn--sm', fields: { status: 'verified' }, confirm: '¿Revisaste el documento de identidad?' })}${C.actionButton(ctx, { action: `/admin/especialistas/${sp._id}/identidad`, label: 'Quitar verificación', cls: 'btn btn--text btn--sm', fields: { status: 'none' } })}</div>
        <h3 style="margin-top:12px">Cuenta</h3>
        ${user ? html`<p style="margin:0">${idLink(`/admin/usuarios/${user._id}`, user.name)} · ${user.email}</p>` : html`<p class="muted" style="margin:0">Sin dueño (${sp.claim?.status === 'invited' ? `invitado ${sp.claim.invitedEmail}` : 'sin reclamar'}).</p>
          <form method="post" action="/admin/especialistas/${sp._id}/invitar" class="inputgroup">${csrf(ctx)}<input type="email" name="email" placeholder="email@ejemplo.com" required aria-label="Email" value="${sp.claim?.invitedEmail || ''}"><button class="btn btn--ghost btn--sm" style="flex:0 0 auto">${sp.claim?.status === 'invited' ? 'Reenviar invitación' : 'Invitar a reclamar'}</button></form>`}
        <p class="small muted" style="margin:0">Cobros: ${sp.mercadopago?.connectedAt ? `Mercado Pago vinculado (${sp.mercadopago.userId})` : 'sin cuenta vinculada'}</p>
      </section>
      <section class="panel stack"><h2>Datos</h2>${C.dl([
    ['Comisión', sp.commissionRate !== null && sp.commissionRate !== undefined ? fmtPercent(sp.commissionRate) : 'Reglas generales'],
    ['Plan', sp.plan === 'profesional' ? `Profesional${sp.planExpiresAt ? ` hasta ${D.fmtDateShort(sp.planExpiresAt)}` : ''}` : 'Gratis'],
    ['Categorías', (sp.categories || []).map((id) => catName.get(String(id))).join(', ')],
    ['Modalidades', (sp.modalities || []).map((m) => MODALITIES[m].label).join(', ')],
    ['Dirección', sp.location?.address || '—'],
    ['Teléfono', sp.contactPhone || '—'],
    ['Facturación', [sp.business?.legalName, sp.business?.taxId].filter(Boolean).join(' · ') || '—'],
    ['Publicada', sp.publishedAt ? D.fmtDateShort(sp.publishedAt) : '—'],
  ])}</section>
    </div>
    <section class="section panel"><div class="panel__title"><h2>Servicios</h2><a class="btn btn--ghost btn--sm" href="/admin/especialistas/${sp._id}/servicios/nuevo">${icon('plus', { size: 14 })}Agregar servicio</a></div>
      ${table(['Servicio', 'Categoría', ['Precio', 'num'], ['Duración', 'num'], 'Estado', ['Valoración', 'num']], services.map((x) => html`<tr><td>${idLink(`/admin/servicios/${x._id}`, x.title)}</td><td>${x.category?.name}</td><td class="num">${fmtMoney(x.price)}</td><td class="num">${x.durationMinutes} min</td><td>${SERVICE_STATUS[x.status]}</td><td class="num">${x.rating?.count ? `${C.fmtRating(x.rating.avg)} (${x.rating.count})` : '—'}</td></tr>`))}</section>
    <section class="section panel"><h2>Multimedia</h2>
      <div class="grid-3">${media.filter((m) => m.visibility === 'public').map((m) => html`<div>${m.kind === 'video' ? html`<video src="${m.url}" controls preload="metadata" style="width:100%;border-radius:10px"></video>` : html`<img src="${m.thumbUrl || m.url}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px">`}<p class="small muted">${m.kind} · ${m.status}</p></div>`)}</div>
      <form method="post" action="/admin/especialistas/${sp._id}/multimedia?_csrf=${ctx.csrf}" enctype="multipart/form-data" class="row" style="margin-top:12px">${csrf(ctx)}
        <select name="tipo" aria-label="Tipo"><option value="perfil">Foto de perfil</option><option value="portada">Portada</option><option value="foto">Galería</option><option value="video">Video</option></select>
        <input type="file" name="file" required aria-label="Archivo"><button class="btn btn--ghost btn--sm">Subir</button></form>
    </section>
    <div class="grid-2 section" style="align-items:start">
      <section class="panel"><h2>Certificaciones</h2>${certifications.length ? html`<ul class="list">${certifications.map((c) => html`<li>${c.title} · ${C.pill(c.status)}${c.document ? html` · <a href="/admin/documentos/${c.document}" target="_blank" rel="noopener">documento</a>` : ''}</li>`)}</ul>` : html`<p class="muted">Sin certificaciones.</p>`}</section>
      <section class="panel"><h2>Verificaciones enviadas</h2>${requests.length ? html`<ul class="list">${requests.map((r) => html`<li>${D.fmtDateShort(r.createdAt)} · ${r.type} · ${C.pill(r.status)} ${(r.documents || []).map((doc, i) => html` <a href="/admin/documentos/${doc}" target="_blank" rel="noopener">doc ${i + 1}</a>`)}</li>`)}</ul>` : html`<p class="muted">Ninguna.</p>`}</section>
    </div>
    ${reports.length ? html`<section class="section panel"><h2>Denuncias sobre esta ficha</h2><ul class="list">${reports.map((r) => html`<li>${REPORT_REASONS[r.reason] || r.reason} · ${r.status} · ${D.fmtRelative(r.createdAt)}${r.details ? html`<br><span class="small">${r.details}</span>` : ''}</li>`)}</ul></section>` : ''}
    <section class="section panel"><h2>Actividad</h2>${auditList(logs)}<a href="/admin/auditoria?objeto=${sp._id}">Ver toda la auditoría</a></section>
    <section class="section">${C.actionButton(ctx, { action: `/admin/especialistas/${sp._id}/eliminar`, label: 'Dar de baja la ficha', cls: 'btn btn--danger', confirm: 'La ficha deja de mostrarse. El historial se conserva. ¿Continuar?' })}</section>`;
  return page(ctx, sp.displayName, 'especialistas', body);
}

function serviceForm(ctx, { sp, categories, values: v }) {
  const body = html`${C.pageHead({ title: `Nuevo servicio para ${sp.displayName}`, back: `/admin/especialistas/${sp._id}` })}
    <form method="post" action="/admin/especialistas/${sp._id}/servicios" class="form panel">${csrf(ctx)}
      ${C.field({ label: 'Nombre', name: 'title', required: true })}
      ${C.select({ label: 'Categoría', name: 'category', required: true, options: categories.map((c) => [c._id, c.name]) })}
      ${C.field({ label: 'Resumen', name: 'summary' })}${C.field({ label: 'Descripción', name: 'description', type: 'textarea' })}
      <div class="grid-2">${C.field({ label: 'Precio del especialista (UYU)', name: 'price', type: 'number', required: true })}${C.field({ label: 'Duración (min)', name: 'durationMinutes', type: 'number', value: v.durationMinutes, required: true })}</div>
      ${C.checkGroup({ label: 'Modalidades', name: 'modalities', options: Object.entries(MODALITIES).map(([k, m]) => [k, m.label]), values: v.modalities || [] })}
      <button class="btn btn--primary">Crear servicio</button></form>`;
  return page(ctx, 'Nuevo servicio', 'especialistas', body);
}

function verifications(ctx, { requests, certs, estado }) {
  const body = html`${C.pageHead({ title: 'Verificaciones', subtitle: 'Solo usar la palabra “verificado” cuando Alternativa realmente comprobó algo.' })}
    ${C.tabs([['pending', '/admin/verificaciones', 'Pendientes'], ['approved', '/admin/verificaciones?estado=approved', 'Aprobadas'], ['rejected', '/admin/verificaciones?estado=rejected', 'Rechazadas']], estado)}
    ${requests.length ? requests.map((r) => html`<section class="panel stack" style="margin-bottom:12px">
      <div class="row row--between"><h3 style="margin:0">${idLink(`/admin/especialistas/${r.specialist?._id}`, r.specialist?.displayName)}</h3><span class="small muted">${r.type === 'claim' ? 'Reclamo de perfil' : 'Identidad'} · ${D.fmtRelative(r.createdAt)}</span></div>
      ${r.documentNumberLast4 ? html`<p style="margin:0">Documento terminado en <strong>${r.documentNumberLast4}</strong></p>` : ''}${r.notes ? html`<p class="small" style="margin:0">${r.notes}</p>` : ''}
      <div class="row">${(r.documents || []).map((doc, i) => html`<a class="btn btn--ghost btn--sm" href="/admin/documentos/${doc._id}" target="_blank" rel="noopener">${icon('file', { size: 14 })}Documento ${i + 1}</a>`)}${r.type === 'claim' && !(r.documents || []).length ? html`<span class="small muted">Sin documentos: pedí al especialista que complete la verificación desde su panel.</span>` : ''}</div>
      ${r.status === 'pending' ? html`<form method="post" action="/admin/verificaciones/${r._id}" class="inputgroup">${csrf(ctx)}<input type="text" name="note" placeholder="Nota (obligatoria si rechazás)" aria-label="Nota"><button class="btn btn--primary btn--sm" name="decision" value="aprobar" style="flex:0 0 auto">Aprobar</button><button class="btn btn--danger btn--sm" name="decision" value="rechazar" style="flex:0 0 auto">Rechazar</button></form>` : html`<p class="small muted">${r.review?.note || ''}</p>`}
    </section>`) : html`<p class="muted">No hay solicitudes.</p>`}
    ${estado === 'pending' ? html`<section class="section"><h2>Certificaciones</h2>${certs.length ? certs.map((c) => html`<div class="panel row row--between" style="margin-bottom:8px"><span><strong>${c.title}</strong>${c.issuer ? ` · ${c.issuer}` : ''}${c.year ? ` · ${c.year}` : ''}<br><span class="small muted">${c.specialist?.displayName}</span></span>
      <span class="row">${c.document ? html`<a class="btn btn--ghost btn--sm" href="/admin/documentos/${c.document._id}" target="_blank" rel="noopener">Ver documento</a>` : ''}
      <form method="post" action="/admin/certificaciones/${c._id}" class="row">${csrf(ctx)}<input type="text" name="note" placeholder="Nota" aria-label="Nota" style="max-width:160px"><button class="btn btn--primary btn--sm" name="decision" value="aprobar">Verificar</button><button class="btn btn--danger btn--sm" name="decision" value="rechazar">Rechazar</button></form></span></div>`) : html`<p class="muted">No hay certificaciones pendientes.</p>`}</section>` : ''}`;
  return page(ctx, 'Verificaciones', 'verificaciones', body);
}

// ── Usuarios ──────────────────────────────────────────────
function users(ctx, { result, query }) {
  const body = html`${C.pageHead({ title: 'Usuarios' })}
    ${filters([{ label: 'Nombre o email', name: 'q' }, { label: 'Rol', name: 'rol', options: [['user', 'Usuario'], ['specialist', 'Especialista'], ['admin', 'Admin']] }, { label: 'Estado', name: 'estado', options: [['active', 'Activo'], ['suspended', 'Suspendido'], ['deleted', 'Eliminado']] }], query)}
    ${table(['Nombre', 'Email', 'Rol', 'Estado', 'Alta', 'Último acceso'], result.items.map((u) => html`<tr><td>${idLink(`/admin/usuarios/${u._id}`, u.name)}</td><td>${u.email}${u.emailVerified ? '' : html` ${C.pill('sin confirmar', 'warn')}`}</td><td>${u.role}</td><td>${u.status === 'active' ? C.pill('Activo', 'ok') : C.pill(u.status, 'danger')}</td><td>${D.fmtDateShort(u.createdAt)}</td><td>${u.lastLoginAt ? D.fmtRelative(u.lastLoginAt) : '—'}</td></tr>`))}
    ${C.pagination(result, query, '/admin/usuarios')}`;
  return page(ctx, 'Usuarios', 'usuarios', body);
}

function userDetail(ctx, d) {
  const u = d.u;
  const body = html`${C.pageHead({ title: u.name, subtitle: u.email, back: '/admin/usuarios' })}
    <div class="grid-2" style="align-items:start">
      <form method="post" action="/admin/usuarios/${u._id}" class="panel stack">${csrf(ctx)}<h2>Datos administrativos</h2>
        ${C.field({ label: 'Nombre', name: 'name', value: u.name, required: true })}
        ${C.field({ label: 'Celular', name: 'phone', type: 'tel', value: u.phone })}
        ${C.select({ label: 'Rol', name: 'role', value: u.role, required: true, options: [['user', 'Usuario'], ['specialist', 'Especialista'], ['admin', 'Administrador']] })}
        ${C.checkbox({ label: 'Email confirmado', name: 'emailVerified', checked: u.emailVerified })}
        <button class="btn btn--primary btn--sm">Guardar</button>
        <p class="small muted">El email y la contraseña solo los cambia la persona.</p>
      </form>
      <section class="panel stack"><h2>Estado</h2>
        ${C.dl([['Estado', u.status], ['Alta', D.fmtDateShort(u.createdAt)], ['Último acceso', u.lastLoginAt ? D.fmtDateTime(u.lastLoginAt) : '—'], ['Ficha de especialista', u.specialist ? idLink(`/admin/especialistas/${u.specialist}`, 'Ver ficha') : '—'], u.suspension?.reason ? ['Motivo de suspensión', u.suspension.reason] : null])}
        ${u.status === 'active' ? html`<form method="post" action="/admin/usuarios/${u._id}/estado" class="inputgroup" data-confirm="¿Suspender esta cuenta?">${csrf(ctx)}<input type="hidden" name="status" value="suspended"><input type="text" name="reason" placeholder="Motivo" required aria-label="Motivo"><button class="btn btn--danger btn--sm" style="flex:0 0 auto">Suspender</button></form>`
    : u.status === 'suspended' ? C.actionButton(ctx, { action: `/admin/usuarios/${u._id}/estado`, label: 'Reactivar cuenta', cls: 'btn btn--primary btn--sm', fields: { status: 'active' } }) : ''}
      </section>
    </div>
    <section class="section"><h2>Reservas</h2>${table(['Código', 'Servicio', 'Especialista', 'Fecha', 'Estado', ['Total', 'num']], d.bookings.map((b) => html`<tr><td>${idLink(`/admin/reservas/${b._id}`, b.code)}</td><td>${b.snapshot.serviceTitle}</td><td>${b.snapshot.specialistName}</td><td>${D.fmtDateShort(b.start)}</td><td>${C.statusPill(b.status)}</td><td class="num">${fmtMoney(b.snapshot.total)}</td></tr>`))}</section>
    <div class="grid-2 section" style="align-items:start">
      <section class="panel"><h2>Consultas</h2>${d.tickets.length ? html`<ul class="list">${d.tickets.map((t) => html`<li>${idLink(`/admin/soporte/${t._id}`, `#${t.number} ${t.subject}`)} · ${t.status}</li>`)}</ul>` : html`<p class="muted">Ninguna.</p>`}</section>
      <section class="panel"><h2>Reseñas escritas</h2>${d.reviews.length ? html`<ul class="list">${d.reviews.map((r) => html`<li>${r.service?.title} · ${r.rating}★ · ${r.status}</li>`)}</ul>` : html`<p class="muted">Ninguna.</p>`}</section>
      <section class="panel"><h2>Denuncias sobre esta cuenta</h2>${d.reportsAbout.length ? html`<ul class="list">${d.reportsAbout.map((r) => html`<li>${REPORT_REASONS[r.reason] || r.reason} · ${r.status}</li>`)}</ul>` : html`<p class="muted">Ninguna.</p>`}</section>
      <section class="panel"><h2>Denuncias hechas</h2>${d.reportsBy.length ? html`<ul class="list">${d.reportsBy.map((r) => html`<li>${r.targetType} · ${REPORT_REASONS[r.reason] || r.reason} · ${r.status}</li>`)}</ul>` : html`<p class="muted">Ninguna.</p>`}</section>
    </div>
    <section class="section panel"><h2>Actividad relevante</h2>${auditList(d.logs)}</section>`;
  return page(ctx, u.name, 'usuarios', body);
}

// ── Servicios y categorías ────────────────────────────────
function services(ctx, { result, categories, query }) {
  const body = html`${C.pageHead({ title: 'Servicios' })}
    ${filters([{ label: 'Buscar', name: 'q' }, { label: 'Estado', name: 'estado', options: Object.entries(SERVICE_STATUS) }, { label: 'Categoría', name: 'categoria', options: categories.map((c) => [c._id, c.name]) }], query)}
    ${table(['Servicio', 'Especialista', 'Categoría', ['Precio', 'num'], 'Estado', 'Visible', ['Valoración', 'num']], result.items.map((s) => html`<tr><td>${idLink(`/admin/servicios/${s._id}`, s.title)}</td><td>${s.specialist ? idLink(`/admin/especialistas/${s.specialist._id}`, s.specialist.displayName) : '—'}</td><td>${s.category?.name}</td><td class="num">${fmtMoney(s.price)}</td><td>${SERVICE_STATUS[s.status]}</td><td>${s.search?.visible ? 'Sí' : 'No'}</td><td class="num">${s.rating?.count ? `${C.fmtRating(s.rating.avg)} (${s.rating.count})` : '—'}</td></tr>`))}
    ${C.pagination(result, query, '/admin/servicios')}`;
  return page(ctx, 'Servicios', 'servicios', body);
}

function serviceDetail(ctx, { s, categories }) {
  const body = html`${C.pageHead({ title: s.title, subtitle: html`${s.specialist?.displayName} · <a href="/servicios/${s.specialist?.slug}/${s.slug}">ver público</a>`, back: '/admin/servicios' })}
    <div class="grid-kpi">${C.kpi('Precio', fmtMoney(s.price))}${C.kpi('Duración', `${s.durationMinutes} min`)}${C.kpi('Reservas', s.stats?.bookings || 0)}${C.kpi('Valoración', s.rating?.count ? `${C.fmtRating(s.rating.avg)} ★ (${s.rating.count})` : '—', s.rating?.count ? `Ponderada interna ${s.rating.weighted.toFixed(2)}` : '')}</div>
    <form method="post" action="/admin/servicios/${s._id}" class="form panel section" style="max-width:820px">${csrf(ctx)}<h2>Moderación</h2>
      <div class="grid-2">${C.select({ label: 'Estado', name: 'status', value: s.status, required: true, options: Object.entries(SERVICE_STATUS) })}${C.select({ label: 'Categoría (reclasificar)', name: 'category', value: s.category?._id, required: true, options: categories.map((c) => [c._id, c.name]) })}</div>
      ${C.field({ label: 'Motivo (lo ve el especialista)', name: 'statusReason', value: s.statusReason })}
      ${C.field({ label: 'Nombre', name: 'title', value: s.title, required: true })}
      ${C.field({ label: 'Resumen', name: 'summary', value: s.summary })}
      ${C.field({ label: 'Descripción', name: 'description', type: 'textarea', rows: 6, value: s.description })}
      <button class="btn btn--primary">Guardar</button>
      <p class="small muted">Precio, duración y reputación no se editan desde moderación: los define el especialista y las reseñas verificadas.</p>
    </form>`;
  return page(ctx, s.title, 'servicios', body);
}

function categories(ctx, { list }) {
  const body = html`${C.pageHead({ title: 'Categorías', actions: html`<a class="btn btn--primary btn--sm" href="/admin/categorias/nueva">${icon('plus', { size: 16 })}Nueva categoría</a>` })}
    ${table(['', 'Nombre', 'Enlace', 'Estado', ['Servicios', 'num'], ['Orden', 'num']], list.map((c) => html`<tr><td style="color:${c.color}">${icon(c.icon, { size: 20 })}</td><td>${idLink(`/admin/categorias/${c._id}`, c.name)}${c.featured ? html` ${C.pill('Destacada', 'brand')}` : ''}</td><td><span class="code">/${c.slug}</span></td><td>${c.status === 'active' ? C.pill('Activa', 'ok') : c.status === 'pending' ? C.pill('Propuesta', 'warn') : C.pill('Oculta')}</td><td class="num">${c.serviceCount}</td><td class="num">${c.order}</td></tr>`))}`;
  return page(ctx, 'Categorías', 'categorias', body);
}

function categoryForm(ctx, { values: v = {}, errors = {}, editing }) {
  const body = html`${C.pageHead({ title: editing ? `Editar ${v.name}` : 'Nueva categoría', back: '/admin/categorias' })}
    <form method="post" action="${editing ? `/admin/categorias/${editing}` : '/admin/categorias'}" class="form panel" style="max-width:820px">${csrf(ctx)}
      <div class="grid-2">${C.field({ label: 'Nombre', name: 'name', value: v.name, required: true, error: errors.name })}${C.field({ label: 'Enlace (/…)', name: 'slug', value: v.slug, error: errors.slug, hint: 'Vacío = se genera del nombre. Ej: masajes' })}</div>
      ${C.field({ label: 'Descripción breve', name: 'description', value: v.description })}
      ${C.field({ label: 'Texto de la página (SEO)', name: 'longDescription', type: 'textarea', rows: 6, value: v.longDescription, hint: 'Markdown simple: ## títulos, **negrita**, listas con -.' })}
      <div class="grid-3">${C.select({ label: 'Ícono', name: 'icon', value: v.icon, options: CATEGORY_ICONS.map((i) => [i, i]) })}${C.field({ label: 'Color', name: 'color', type: 'text', value: v.color, pattern: '#[0-9a-fA-F]{6}', hint: 'Hex, p.ej. #8B5CF6' })}${C.field({ label: 'Orden', name: 'order', type: 'number', value: v.order ?? 0 })}</div>
      ${C.select({ label: 'Estado', name: 'status', value: v.status, options: [['active', 'Activa'], ['pending', 'Propuesta (oculta)'], ['hidden', 'Oculta']] })}
      ${C.checkbox({ label: 'Destacada en el inicio', name: 'featured', checked: v.featured })}
      <div class="grid-2">${C.field({ label: 'Título SEO', name: 'seoTitle', value: v.seoTitle, maxlength: 70 })}${C.field({ label: 'Descripción SEO', name: 'seoDescription', value: v.seoDescription, maxlength: 160 })}</div>
      <button class="btn btn--primary">Guardar</button>
    </form>`;
  return page(ctx, 'Categoría', 'categorias', body);
}

// ── Reservas ──────────────────────────────────────────────
function bookings(ctx, { result, query }) {
  const body = html`${C.pageHead({ title: 'Reservas' })}
    ${filters([{ label: 'Código, usuario, especialista o servicio', name: 'q' }, { label: 'Estado', name: 'estado', options: statusOpts(BOOKING_STATUS) }, { label: 'Desde', name: 'desde', type: 'date' }, { label: 'Hasta', name: 'hasta', type: 'date' }, { label: 'Incidencia', name: 'incidencia', options: [['1', 'Con incidencia abierta']] }], query)}
    ${table(['Código', 'Fecha', 'Usuario', 'Especialista', 'Servicio', 'Estado', ['Total', 'num'], ['Comisión', 'num']], result.items.map((b) => html`<tr><td>${idLink(`/admin/reservas/${b._id}`, b.code)}${b.incident?.open ? html` ${C.pill('Incidencia', 'danger')}` : ''}</td><td>${D.fmtDateShort(b.start)} ${D.fmtTime(b.start)}</td><td>${idLink(`/admin/usuarios/${b.user}`, b.snapshot.userName)}</td><td>${idLink(`/admin/especialistas/${b.specialist}`, b.snapshot.specialistName)}</td><td>${b.snapshot.serviceTitle}</td><td>${C.statusPill(b.status)}</td><td class="num">${fmtMoney(b.snapshot.total)}</td><td class="num">${fmtMoney(b.snapshot.commissionAmount)}</td></tr>`))}
    ${C.pagination(result, query, '/admin/reservas')}`;
  return page(ctx, 'Reservas', 'reservas', body);
}

function bookingDetail(ctx, d) {
  const b = d.b;
  const s = b.snapshot;
  const active = ['paid', 'confirmed'].includes(b.status);
  const body = html`${C.pageHead({ title: `Reserva ${b.code}`, subtitle: html`${C.statusPill(b.status)} · ${s.serviceTitle}`, back: '/admin/reservas' })}
    ${b.incident?.open ? html`<div class="flash flash--warn">${icon('alert', { size: 18 })}<span>Incidencia abierta: ${b.incident.note}</span></div>` : ''}
    <div class="grid-2" style="align-items:start">
      <section class="panel"><h2>Operación</h2>${C.dl([
    ['Usuario', d.user ? html`${idLink(`/admin/usuarios/${d.user._id}`, d.user.name)} · ${d.user.email}${d.user.phone ? ` · ${d.user.phone}` : ''}` : s.userName],
    ['Especialista', d.sp ? idLink(`/admin/especialistas/${d.sp._id}`, d.sp.displayName) : s.specialistName],
    ['Fecha', `${D.fmtDateTime(b.start)} – ${D.fmtTime(b.end)}`],
    ['Modalidad', `${MODALITIES[b.modality].label}${b.place?.address ? ` · ${b.place.address}` : ''}`],
    ['Notas del usuario', b.userNotes || '—'],
    ['Reprogramaciones', b.rescheduleCount || 0],
    b.rescheduledFrom ? ['Reprogramada desde', idLink(`/admin/reservas/${b.rescheduledFrom}`, 'reserva original')] : null,
    b.rescheduledTo ? ['Reprogramada a', idLink(`/admin/reservas/${b.rescheduledTo}`, 'nueva reserva')] : null,
    ['Reseña', d.review ? `${d.review.rating}★ (${d.review.status})` : '—'],
  ])}</section>
      <section class="panel"><h2>Datos económicos (fotografía al reservar)</h2>${C.dl([
    ['Precio del especialista', fmtMoney(s.price)],
    s.homeServiceExtra ? ['Recargo domicilio', fmtMoney(s.homeServiceExtra)] : null,
    s.discount ? ['Descuento', `${fmtMoney(s.discount)} (${s.promotionTitle || ''})`] : null,
    ['Total cobrado', fmtMoney(s.total)],
    ['Comisión', `${fmtMoney(s.commissionAmount)} (${fmtPercent(s.commissionRate)} · ${s.commissionRuleName || ''})`],
    ['Corresponde al especialista', fmtMoney(s.specialistNet)],
    ['Procesador (estimado)', `${fmtMoney(s.processorFeeEstimate || 0)} · lo paga ${s.processorFeePaidBy || '—'}`],
    ['Modelo de cobro', COLLECTION_MODELS[s.collectionModel]?.short || s.collectionModel],
    ['Pago', d.payment ? html`${idLink(`/admin/pagos/${d.payment._id}`, PAYMENT_STATUS[d.payment.status])}${d.payment.providerFee ? ` · comisión real ${fmtMoney(d.payment.providerFee)}` : ''}` : '—'],
    ['Reembolsos', d.refunds.length ? d.refunds.map((r) => `${fmtMoney(r.amount)} (${r.status})`).join(', ') : '—'],
  ])}</section>
    </div>
    <div class="grid-2 section" style="align-items:start">
      ${['pending', 'paid', 'confirmed'].includes(b.status) ? html`<form method="post" action="/admin/reservas/${b._id}/cancelar" class="panel stack" data-confirm="¿Cancelar esta reserva?">${csrf(ctx)}<h2>Cancelar</h2>
        ${C.field({ label: 'Motivo', name: 'reason', required: true })}
        <div class="grid-2">${C.field({ label: 'Reembolso (%)', name: 'refundPercent', type: 'number', min: 0, max: 100, value: 100, required: true })}${C.select({ label: 'Se atribuye a', name: 'attributeTo', required: true, options: [['specialist', 'Especialista'], ['user', 'Usuario']] })}</div>
        <button class="btn btn--danger btn--sm">Cancelar reserva</button></form>` : ''}
      <section class="panel stack"><h2>Acciones</h2>
        <div class="btnbar" style="margin:0">
          ${b.status === 'paid' ? C.actionButton(ctx, { action: `/admin/reservas/${b._id}/estado`, label: 'Confirmar', cls: 'btn btn--ghost btn--sm', fields: { action: 'confirmar' } }) : ''}
          ${active && new Date(b.start) < new Date() ? C.actionButton(ctx, { action: `/admin/reservas/${b._id}/estado`, label: 'Marcar realizada', cls: 'btn btn--ghost btn--sm', fields: { action: 'completar' } }) : ''}
          ${['paid', 'confirmed', 'completed'].includes(b.status) && new Date(b.start) < new Date() ? html`${C.actionButton(ctx, { action: `/admin/reservas/${b._id}/estado`, label: 'Ausencia del usuario', cls: 'btn btn--ghost btn--sm', fields: { action: 'ausencia_usuario' }, confirm: 'Se aplica la política de ausencia del usuario.' })}${C.actionButton(ctx, { action: `/admin/reservas/${b._id}/estado`, label: 'Ausencia del especialista', cls: 'btn btn--ghost btn--sm', fields: { action: 'ausencia_especialista' }, confirm: 'Se reembolsa al usuario según la política.' })}` : ''}
        </div>
        <form method="post" action="/admin/reservas/${b._id}/incidencia" class="stack">${csrf(ctx)}${C.field({ label: b.incident?.open ? 'Nota de cierre' : 'Abrir incidencia', name: 'note' })}<input type="hidden" name="open" value="${b.incident?.open ? '0' : '1'}"><button class="btn btn--ghost btn--sm">${b.incident?.open ? 'Cerrar incidencia' : 'Abrir incidencia'}</button></form>
        ${d.payment && ['approved', 'partially_refunded'].includes(d.payment.status) ? html`<form method="post" action="/admin/reservas/${b._id}/reembolso" class="stack" data-confirm="¿Ejecutar este reembolso en la pasarela?">${csrf(ctx)}<h3>Reembolso manual</h3><div class="grid-2">${C.field({ label: 'Porcentaje', name: 'percent', type: 'number', min: 1, max: 100, required: true })}${C.field({ label: 'Motivo', name: 'reason', required: true })}</div><button class="btn btn--ghost btn--sm">Reembolsar</button></form>` : ''}
      </section>
    </div>
    <section class="section panel"><h2>Historial</h2><ul class="timeline">${b.history.map((h) => html`<li><strong>${BOOKING_STATUS[h.status]?.label || h.status}</strong> · ${D.fmtDateTime(h.at)} · ${h.byRole || ''}${h.note ? html`<br><span class="small muted">${h.note}</span>` : ''}</li>`)}</ul></section>
    ${d.tickets.length ? html`<section class="section panel"><h2>Consultas vinculadas</h2><ul class="list">${d.tickets.map((t) => html`<li>${idLink(`/admin/soporte/${t._id}`, `#${t.number} ${t.subject}`)} · ${t.status}</li>`)}</ul></section>` : ''}
    <section class="section panel"><h2>Auditoría</h2>${auditList(d.logs)}</section>`;
  return page(ctx, `Reserva ${b.code}`, 'reservas', body);
}

// ── Dinero ────────────────────────────────────────────────
function payments(ctx, { result, query, totals }) {
  const body = html`${C.pageHead({ title: 'Pagos' })}
    <div class="grid-kpi">${C.kpi('Total procesado', fmtMoney(totals.gross || 0))}${C.kpi('Comisión generada', fmtMoney(totals.commission || 0))}${C.kpi('Costo de procesamiento', fmtMoney(totals.fees || 0))}${C.kpi('Reembolsado', fmtMoney(totals.refunded || 0))}</div>
    <div class="section">${filters([{ label: 'ID en la pasarela', name: 'q' }, { label: 'Estado', name: 'estado', options: Object.entries(PAYMENT_STATUS) }, { label: 'Modelo', name: 'modelo', options: Object.entries(COLLECTION_MODELS).map(([k, v]) => [k, v.short]) }], query)}</div>
    ${table(['Fecha', 'Reserva', 'Pasarela', 'Modelo', 'Estado', ['Total', 'num'], ['Comisión', 'num'], ['Procesador', 'num'], ['Reembolsado', 'num'], 'Liquidación'], result.items.map((p) => html`<tr><td>${idLink(`/admin/pagos/${p._id}`, D.fmtDateShort(p.createdAt))}</td><td>${p.booking ? idLink(`/admin/reservas/${p.booking._id}`, p.booking.code) : '—'}<br><span class="small muted">${p.booking?.snapshot?.specialistName}</span></td><td>${p.provider}${p.providerPaymentId ? html`<br><span class="small muted">${p.providerPaymentId}</span>` : ''}</td><td>${COLLECTION_MODELS[p.collectionModel]?.short}</td><td>${PAYMENT_STATUS[p.status]}</td><td class="num">${fmtMoney(p.amount)}</td><td class="num">${fmtMoney(p.commissionAmount)}</td><td class="num">${p.providerFee ? fmtMoney(p.providerFee) : '—'}</td><td class="num">${p.refundedAmount ? fmtMoney(p.refundedAmount) : '—'}</td><td>${p.settlement?.status === 'not_applicable' ? 'Split' : p.settlement?.status}</td></tr>`))}
    ${C.pagination(result, query, '/admin/pagos')}`;
  return page(ctx, 'Pagos', 'pagos', body);
}

function paymentDetail(ctx, { p, refunds }) {
  const body = html`${C.pageHead({ title: `Pago ${p.providerPaymentId || p._id}`, back: '/admin/pagos', actions: C.actionButton(ctx, { action: `/admin/pagos/${p._id}/sincronizar`, label: 'Consultar a la pasarela', cls: 'btn btn--ghost btn--sm', iconName: 'repeat' }) })}
    <div class="grid-2" style="align-items:start">
      <section class="panel">${C.dl([
    ['Reserva', p.booking ? idLink(`/admin/reservas/${p.booking._id}`, p.booking.code) : '—'],
    ['Estado', `${PAYMENT_STATUS[p.status]}${p.statusDetail ? ` (${p.statusDetail})` : ''}`],
    ['Pasarela', p.provider], ['Modelo', COLLECTION_MODELS[p.collectionModel]?.label],
    ['Total', fmtMoney(p.amount)], ['Comisión Alternativa', fmtMoney(p.commissionAmount)], ['Para el especialista', fmtMoney(p.specialistAmount)],
    ['Marketplace fee enviado', fmtMoney(p.marketplaceFee || 0)], ['Comisión del procesador (real)', fmtMoney(p.providerFee || 0)], ['Estimada al reservar', fmtMoney(p.providerFeeEstimate || 0)],
    ['Medio', p.method || '—'], ['Acreditado', p.paidAt ? D.fmtDateTime(p.paidAt) : '—'], ['Cuenta receptora', p.collectorId || '—'],
    ['Reembolsado', fmtMoney(p.refundedAmount || 0)], ['Liquidación', p.settlement?.status],
    p.chargeback?.status ? ['Contracargo', `${p.chargeback.status} · ${D.fmtDateShort(p.chargeback.at)}`] : null,
    ['Última conciliación', p.lastSyncedAt ? D.fmtDateTime(p.lastSyncedAt) : '—'],
  ])}</section>
      <section class="panel"><h2>Eventos</h2><ul class="timeline">${(p.events || []).map((e) => html`<li><strong>${e.type}</strong> · ${D.fmtDateTime(e.at)}${e.data ? html`<br><span class="code">${JSON.stringify(e.data).slice(0, 200)}</span>` : ''}</li>`)}</ul>
        ${refunds.length ? html`<h3>Reembolsos</h3><ul class="list">${refunds.map((r) => html`<li>${fmtMoney(r.amount)} · ${r.status} · ${D.fmtDateShort(r.createdAt)}${r.error ? html`<br><span class="small muted">${r.error}</span>` : ''}</li>`)}</ul>` : ''}</section>
    </div>`;
  return page(ctx, 'Pago', 'pagos', body);
}

function commissions(ctx, { rules, specialistsWithRate, categories, specialistsList, bySpecialist, settings }) {
  const SC = { promotion: 'Promoción', specialist: 'Especialista', category: 'Categoría' };
  const body = html`${C.pageHead({ title: 'Comisiones', subtitle: 'Configurables sin tocar código. Los cambios aplican a reservas nuevas; las existentes conservan su comisión.' })}
    <section class="panel stack"><h2>Comisión general</h2>
      <p style="margin:0;font-size:1.6rem;font-weight:800">${fmtPercent(settings.commission.globalRate)}</p>
      <p class="muted" style="margin:0">${settings.commission.feeMode === 'added' ? 'Se suma al precio del especialista (el cliente ve el precio final).' : 'Se descuenta del precio del especialista.'} <a href="/admin/configuracion?seccion=commission">Cambiar</a></p>
      <p class="small muted" style="margin:0">Precedencia: promoción vigente (la más baja) → tasa particular del especialista → regla de especialista → regla de categoría → general.</p>
    </section>
    <section class="section"><h2>Reglas</h2>
      ${table(['Nombre', 'Tipo', 'Aplica a', ['Tasa', 'num'], 'Vigencia', 'Estado', ''], rules.map((r) => html`<tr><td>${r.name}</td><td>${SC[r.scope]}</td><td>${r.specialist?.displayName || r.category?.name || 'Todos'}</td><td class="num">${fmtPercent(r.rate)}</td><td>${r.validFrom ? D.fmtDateShort(r.validFrom) : '—'} → ${r.validTo ? D.fmtDateShort(r.validTo) : '—'}</td><td>${r.active ? C.pill('Activa', 'ok') : C.pill('Inactiva')}</td><td>${C.actionButton(ctx, { action: `/admin/comisiones/reglas/${r._id}`, label: r.active ? 'Desactivar' : 'Activar', cls: 'btn btn--text btn--sm' })}</td></tr>`), 'No hay reglas: se usa la comisión general.')}
      <form method="post" action="/admin/comisiones/reglas" class="panel form section" style="max-width:none">${csrf(ctx)}<h3>Nueva regla</h3>
        <div class="grid-3">${C.field({ label: 'Nombre', name: 'name', required: true, placeholder: 'Lanzamiento octubre' })}${C.select({ label: 'Tipo', name: 'scope', required: true, options: Object.entries(SC) })}${C.field({ label: 'Tasa (%)', name: 'rate', type: 'number', step: 0.1, min: 0, max: 50, required: true })}</div>
        <div class="grid-2">${C.select({ label: 'Especialista', name: 'specialist', options: [['', '—'], ...specialistsList.map((s) => [s._id, s.displayName])] })}${C.select({ label: 'Categoría', name: 'category', options: [['', '—'], ...categories.map((c) => [c._id, c.name])] })}</div>
        <div class="grid-2">${C.field({ label: 'Desde', name: 'validFrom', type: 'date' })}${C.field({ label: 'Hasta', name: 'validTo', type: 'date' })}</div>
        <button class="btn btn--primary">Crear regla</button></form>
    </section>
    ${specialistsWithRate.length ? html`<section class="section panel"><h2>Tasas particulares</h2><ul class="list">${specialistsWithRate.map((s) => html`<li class="row row--between">${idLink(`/admin/especialistas/${s._id}`, s.displayName)}<strong>${fmtPercent(s.commissionRate)}</strong></li>`)}</ul></section>` : ''}
    <section class="section"><h2>Comisión por especialista (últimos 90 días)</h2>
      ${table(['Especialista', ['Pagos', 'num'], ['Procesado', 'num'], ['Comisión', 'num']], bySpecialist.map((r) => html`<tr><td>${r.sp?.[0] ? idLink(`/admin/especialistas/${r._id}`, r.sp[0].displayName) : r._id}</td><td class="num">${r.n}</td><td class="num">${fmtMoney(r.gross)}</td><td class="num">${fmtMoney(r.commission)}</td></tr>`))}
    </section>`;
  return page(ctx, 'Comisiones', 'comisiones', body);
}

function refunds(ctx, { result, query }) {
  const ST = { pending: 'Pendiente', processed: 'Procesado', failed: 'Fallido', manual: 'Lo gestiona el especialista' };
  const body = html`${C.pageHead({ title: 'Reembolsos' })}
    ${filters([{ label: 'Estado', name: 'estado', options: Object.entries(ST) }], query)}
    ${table(['Fecha', 'Reserva', 'Motivo', ['Importe', 'num'], ['%', 'num'], 'Estado', ''], result.items.map((r) => html`<tr><td>${D.fmtDateShort(r.createdAt)}</td><td>${r.booking ? idLink(`/admin/reservas/${r.booking._id}`, r.booking.code) : '—'}<br><span class="small muted">${r.booking?.snapshot?.userName} · ${r.booking?.snapshot?.specialistName}</span></td><td>${r.reason || r.rule}${r.error ? html`<br><span class="small" style="color:var(--danger)">${r.error}</span>` : ''}</td><td class="num">${fmtMoney(r.amount)}</td><td class="num">${r.percent ?? ''}</td><td>${ST[r.status]}</td>
      <td>${r.status === 'failed' ? html`${C.actionButton(ctx, { action: `/admin/reembolsos/${r._id}/reintentar`, label: 'Reintentar', cls: 'btn btn--ghost btn--sm' })}<form method="post" action="/admin/reembolsos/${r._id}/manual" class="row" style="margin-top:6px">${csrf(ctx)}<input type="text" name="note" placeholder="Comprobante / cómo se devolvió" aria-label="Nota" required><button class="btn btn--text btn--sm">Marcar gestionado</button></form>` : ''}</td></tr>`))}
    ${C.pagination(result, query, '/admin/reembolsos')}`;
  return page(ctx, 'Reembolsos', 'reembolsos', body);
}

function payouts(ctx, { preview, list, settings }) {
  const split = settings.payments.collectionModel === 'split';
  const body = html`${C.pageHead({ title: 'Liquidaciones' })}
    ${split ? html`<p class="notice">El modelo activo es split automático: los pagos nuevos no generan liquidaciones. Esta sección queda para pagos hechos con los modelos “Alternativa cobra” u “offline”.</p>` : ''}
    <section class="panel"><div class="panel__title"><h2>Pendiente de liquidar</h2>${preview.length ? C.actionButton(ctx, { action: '/admin/liquidaciones/generar', label: 'Generar liquidaciones', cls: 'btn btn--primary btn--sm', confirm: '¿Generar las liquidaciones de los pagos ya cerrados?' }) : ''}</div>
      ${table(['Especialista', 'Tipo', ['Pagos', 'num'], ['Cobrado', 'num'], ['Comisión', 'num'], ['Reembolsos', 'num'], ['A transferir', 'num']], preview.map((p) => html`<tr><td>${idLink(`/admin/especialistas/${p.specialist}`, p.name || p.specialist)}</td><td>${p.model === 'offline' ? 'Cobrar comisión' : 'Transferir al especialista'}</td><td class="num">${p.payments.length}</td><td class="num">${fmtMoney(p.gross)}</td><td class="num">${fmtMoney(p.commission)}</td><td class="num">${fmtMoney(p.refunds)}</td><td class="num"><strong>${fmtMoney(p.model === 'offline' ? p.commission : p.specialistNet)}</strong></td></tr>`), 'No hay pagos cerrados para liquidar.')}
    </section>
    <section class="section"><h2>Liquidaciones</h2>
      ${table(['Fecha', 'Especialista', 'Tipo', ['Reservas', 'num'], ['Importe', 'num'], 'Cuenta', 'Estado', ''], list.map((p) => html`<tr><td>${D.fmtDateShort(p.createdAt)}</td><td>${p.specialist?.displayName}</td><td>${p.direction === 'to_specialist' ? 'A especialista' : 'A Alternativa'}</td><td class="num">${p.bookingsCount}</td><td class="num">${fmtMoney(p.net)}</td><td class="small">${[p.specialist?.business?.bankName, p.specialist?.business?.accountNumber].filter(Boolean).join(' ') || p.specialist?.business?.payoutEmail || '—'}</td><td>${p.status}${p.reference ? html`<br><span class="small muted">${p.reference}</span>` : ''}</td>
        <td>${p.status === 'pending' ? html`<form method="post" action="/admin/liquidaciones/${p._id}/pagar" class="row">${csrf(ctx)}<input type="text" name="reference" placeholder="Nº de transferencia" aria-label="Referencia" required style="max-width:160px"><button class="btn btn--primary btn--sm">Marcar pagada</button></form>${C.actionButton(ctx, { action: `/admin/liquidaciones/${p._id}/anular`, label: 'Anular', cls: 'btn btn--text btn--sm' })}` : ''}</td></tr>`))}
    </section>`;
  return page(ctx, 'Liquidaciones', 'liquidaciones', body);
}

// ── Confianza ─────────────────────────────────────────────
function reviews(ctx, { result, query, reportCounts }) {
  const body = html`${C.pageHead({ title: 'Reseñas', subtitle: 'Moderar es la excepción: ocultar solo si incumple las reglas, nunca porque sea negativa.' })}
    ${filters([{ label: 'Texto', name: 'q' }, { label: 'Estado', name: 'estado', options: [['published', 'Publicada'], ['under_review', 'En revisión'], ['hidden', 'Oculta']] }, { label: 'Estrellas', name: 'estrellas', options: [5, 4, 3, 2, 1].map((n) => [n, `${n}★`]) }], query)}
    ${result.items.map((r) => html`<article class="panel stack" style="margin-bottom:10px">
      <div class="row row--between"><span><strong>${r.authorName}</strong> sobre ${r.service?.title} de ${r.specialist ? idLink(`/admin/especialistas/${r.specialist._id}`, r.specialist.displayName) : '—'}</span>${C.stars(r.rating, 14)}</div>
      <p class="small muted" style="margin:0">${D.fmtDateShort(r.createdAt)} · ${r.status}${reportCounts.get(String(r._id)) ? ` · ${reportCounts.get(String(r._id))} reporte(s)` : ''} · ${idLink(`/admin/reservas/${r.booking}`, 'reserva')}</p>
      ${r.comment ? html`<p style="margin:0">${r.comment}</p>` : ''}
      ${r.reviewRequest?.at ? html`<p class="notice" style="margin:0"><strong>Pedido del especialista:</strong> ${REPORT_REASONS[r.reviewRequest.reason] || r.reviewRequest.reason}. ${r.reviewRequest.details || ''}</p>` : ''}
      ${r.moderation?.reason ? html`<p class="small muted" style="margin:0">Moderación: ${r.moderation.reason}</p>` : ''}
      <form method="post" action="/admin/resenas/${r._id}" class="inputgroup">${csrf(ctx)}<input type="text" name="reason" placeholder="Motivo (se registra en auditoría)" aria-label="Motivo">
        ${r.status !== 'hidden' ? html`<button class="btn btn--danger btn--sm" name="action" value="hide" style="flex:0 0 auto">Ocultar</button>` : ''}
        ${r.status !== 'published' ? html`<button class="btn btn--primary btn--sm" name="action" value="publish" style="flex:0 0 auto">${r.status === 'under_review' ? 'Mantener publicada' : 'Publicar'}</button>` : ''}</form>
    </article>`)}
    ${result.items.length ? '' : html`<p class="muted">Sin reseñas con ese filtro.</p>`}
    ${C.pagination(result, query, '/admin/resenas')}`;
  return page(ctx, 'Reseñas', 'resenas', body);
}

function moderation(ctx, { tab, media, changes, services, categories }) {
  const catName = new Map(categories.map((c) => [String(c._id), c.name]));
  let content;
  if (tab === 'cambios') {
    content = changes.length ? changes.map((sp) => html`<div class="panel" style="margin-bottom:10px"><h3>${idLink(`/admin/especialistas/${sp._id}`, sp.displayName)}</h3>${sp.pendingChanges.map((p) => html`<div class="row row--between" style="padding:6px 0"><span>${p.field === 'displayName' ? `Nombre → “${p.value}”` : `Categorías → ${[].concat(p.value).map((id) => catName.get(String(id)) || id).join(', ')}`}</span><span class="row">${C.actionButton(ctx, { action: `/admin/especialistas/${sp._id}/cambios`, label: 'Aprobar', cls: 'btn btn--primary btn--sm', fields: { field: p.field, decision: 'aprobar' } })}${C.actionButton(ctx, { action: `/admin/especialistas/${sp._id}/cambios`, label: 'Rechazar', cls: 'btn btn--danger btn--sm', fields: { field: p.field, decision: 'rechazar' } })}</span></div>`)}</div>`) : html`<p class="muted">No hay cambios pendientes.</p>`;
  } else if (tab === 'servicios') {
    content = services.length ? table(['Servicio', 'Especialista', 'Categoría', 'Motivo', ''], services.map((s) => html`<tr><td>${s.title}</td><td>${s.specialist?.displayName}</td><td>${s.category?.name}</td><td>${s.statusReason || 'Servicio nuevo'}</td><td>${idLink(`/admin/servicios/${s._id}`, 'Revisar')}</td></tr>`)) : html`<p class="muted">No hay servicios en revisión.</p>`;
  } else {
    content = media.length ? html`<div class="grid-3">${media.map((m) => html`<div class="panel stack" style="padding:10px">
      ${m.kind === 'video' ? html`<video src="${m.url}" controls preload="metadata" style="width:100%;border-radius:10px"></video>` : html`<img src="${m.thumbUrl || m.url}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px">`}
      <p class="small" style="margin:0">${m.specialist ? idLink(`/admin/especialistas/${m.specialist._id}`, m.specialist.displayName) : '—'} · ${m.kind}${m.reportsCount ? ` · ${m.reportsCount} reporte(s)` : ''}</p>
      <form method="post" action="/admin/moderacion/media/${m._id}" class="stack">${csrf(ctx)}<input type="text" name="reason" placeholder="Motivo (si rechazás)" aria-label="Motivo">
        <div class="row"><button class="btn btn--primary btn--sm" name="action" value="aprobar">Aprobar</button><button class="btn btn--ghost btn--sm" name="action" value="rechazar">Rechazar</button><button class="btn btn--danger btn--sm" name="action" value="eliminar">Eliminar</button></div></form>
    </div>`)}</div>` : html`<p class="muted">Nada para revisar.</p>`;
  }
  const body = html`${C.pageHead({ title: 'Moderación' })}${C.tabs([['pendiente', '/admin/moderacion', 'Multimedia pendiente'], ['reportada', '/admin/moderacion?tab=reportada', 'Multimedia reportada'], ['cambios', '/admin/moderacion?tab=cambios', 'Cambios de perfiles'], ['servicios', '/admin/moderacion?tab=servicios', 'Servicios']], tab)}${content}`;
  return page(ctx, 'Moderación', 'moderacion', body);
}

function reports(ctx, { result, query, targets, reasons }) {
  const summary = (r) => {
    const t = targets[`${r.targetType}:${r.targetId}`];
    if (!t) return html`<span class="muted">Contenido eliminado</span>`;
    if (r.targetType === 'review') return html`Reseña ${t.rating}★: “${(t.comment || '').slice(0, 140)}” · ${idLink(`/admin/resenas?q=${encodeURIComponent((t.comment || '').slice(0, 30))}`, 'moderar')}`;
    if (r.targetType === 'media') return html`<a href="${t.url}" target="_blank" rel="noopener">Ver archivo</a> · ${idLink('/admin/moderacion?tab=reportada', 'moderar')}`;
    if (r.targetType === 'specialist') return idLink(`/admin/especialistas/${t._id}`, t.displayName);
    if (r.targetType === 'service') return idLink(`/admin/servicios/${t._id}`, t.title);
    if (r.targetType === 'user') return idLink(`/admin/usuarios/${t._id}`, t.name);
    if (r.targetType === 'message') return html`Mensaje: “${String(t.body).slice(0, 140)}”`;
    return '';
  };
  const body = html`${C.pageHead({ title: 'Denuncias' })}
    ${filters([{ label: 'Estado', name: 'estado', options: [['open', 'Abiertas'], ['resolved', 'Resueltas'], ['dismissed', 'Descartadas']] }, { label: 'Tipo', name: 'tipo', options: [['review', 'Reseña'], ['media', 'Multimedia'], ['specialist', 'Especialista'], ['service', 'Servicio'], ['user', 'Usuario'], ['message', 'Mensaje']] }], query)}
    ${result.items.map((r) => html`<div class="panel stack" style="margin-bottom:10px">
      <div class="row row--between"><strong>${reasons[r.reason] || r.reason}</strong><span class="small muted">${r.targetType} · ${D.fmtRelative(r.createdAt)} · por ${r.reporter?.name || '—'} (${r.reporterRole || ''})</span></div>
      <p style="margin:0">${summary(r)}</p>${r.details ? html`<p class="small" style="margin:0">${r.details}</p>` : ''}
      ${r.status === 'open' ? html`<form method="post" action="/admin/denuncias/${r._id}" class="inputgroup">${csrf(ctx)}<input type="text" name="note" placeholder="Qué se hizo" aria-label="Nota"><button class="btn btn--primary btn--sm" name="decision" value="resolver" style="flex:0 0 auto">Resuelta</button><button class="btn btn--ghost btn--sm" name="decision" value="descartar" style="flex:0 0 auto">Descartar</button></form>` : html`<p class="small muted" style="margin:0">${r.status} · ${r.resolution?.note || ''}</p>`}
    </div>`)}
    ${result.items.length ? '' : html`<p class="muted">No hay denuncias.</p>`}
    ${C.pagination(result, query, '/admin/denuncias')}`;
  return page(ctx, 'Denuncias', 'denuncias', body);
}

// ── Crecimiento ───────────────────────────────────────────
function sponsored(ctx, { list, specialists: sps, categories, departments }) {
  const TYPES = { category: 'Categoría', zone: 'Zona', home: 'Inicio', recommendation: 'Recomendaciones', search: 'Búsquedas' };
  const body = html`${C.pageHead({ title: 'Destacados', subtitle: 'El dinero compra exposición, nunca reputación. Siempre se muestra como “Patrocinado”.' })}
    ${table(['Especialista', 'Tipo', 'Período', ['Precio', 'num'], 'Pago', 'Estado', ['Imp.', 'num'], ['Clics', 'num'], ''], list.map((p) => html`<tr><td>${p.specialist?.displayName}${p.service ? html`<br><span class="small muted">${p.service.title}</span>` : ''}${p.notes ? html`<br><span class="small muted">${p.notes}</span>` : ''}</td><td>${TYPES[p.type]}${p.category ? ` · ${p.category.name}` : ''}${p.department ? ` · ${p.department}` : ''}</td><td>${D.fmtDateShort(p.startsAt)} – ${D.fmtDateShort(p.endsAt)}</td><td class="num">${fmtMoney(p.price)}</td><td>${p.paymentStatus}</td><td>${p.status}</td><td class="num">${p.impressions}</td><td class="num">${p.clicks}</td>
      <td><form method="post" action="/admin/destacados/${p._id}" class="row">${csrf(ctx)}<select name="status" aria-label="Estado">${['scheduled', 'active', 'paused', 'ended', 'cancelled'].map((s) => html`<option${attr('selected', s === p.status)}>${s}</option>`)}</select><select name="paymentStatus" aria-label="Pago">${['pending', 'paid', 'waived'].map((s) => html`<option${attr('selected', s === p.paymentStatus)}>${s}</option>`)}</select><input type="number" name="price" value="${p.price}" style="max-width:100px" aria-label="Precio"><button class="btn btn--ghost btn--sm">Guardar</button></form></td></tr>`))}
    <form method="post" action="/admin/destacados" class="panel form section" style="max-width:none">${csrf(ctx)}<h2>Nuevo destacado</h2>
      <div class="grid-3">${C.select({ label: 'Especialista', name: 'specialist', required: true, options: sps.map((s) => [s._id, s.displayName]) })}${C.select({ label: 'Tipo', name: 'type', required: true, options: Object.entries(TYPES) })}${C.select({ label: 'Categoría', name: 'category', options: [['', '—'], ...categories.map((c) => [c._id, c.name])] })}</div>
      <div class="grid-3">${C.select({ label: 'Departamento', name: 'department', options: [['', '—'], ...departments.map((d) => [d, d])] })}${C.field({ label: 'Palabras clave (búsquedas)', name: 'keywords', placeholder: 'masaje, relajante' })}${C.field({ label: 'Precio (UYU)', name: 'price', type: 'number', min: 0 })}</div>
      <div class="grid-3">${C.field({ label: 'Desde', name: 'startsAt', type: 'date', required: true })}${C.field({ label: 'Hasta', name: 'endsAt', type: 'date', required: true })}${C.select({ label: 'Pago', name: 'paymentStatus', options: [['pending', 'Pendiente'], ['paid', 'Pagado'], ['waived', 'Bonificado']] })}</div>
      <button class="btn btn--primary">Crear destacado</button></form>`;
  return page(ctx, 'Destacados', 'destacados', body);
}

function promotions(ctx, { list }) {
  const body = html`${C.pageHead({ title: 'Promociones', subtitle: 'Las institucionales se financian con la tarifa de Alternativa; las de especialistas, con su precio.' })}
    ${table(['Título', 'De', ['%', 'num'], 'Código', 'Vigencia', ['Usos', 'num'], 'Estado', ''], list.map((p) => html`<tr><td>${p.title}</td><td>${p.specialist?.displayName || 'Alternativa'}</td><td class="num">${p.discountPercent}</td><td>${p.code || '—'}</td><td>${p.validFrom ? D.fmtDateShort(p.validFrom) : '—'} → ${p.validTo ? D.fmtDateShort(p.validTo) : '—'}</td><td class="num">${p.uses}${p.maxUses ? `/${p.maxUses}` : ''}</td><td>${p.status}</td>
      <td><form method="post" action="/admin/promociones/${p._id}/estado" class="row">${csrf(ctx)}<select name="status" aria-label="Estado">${['active', 'paused', 'ended'].map((s) => html`<option${attr('selected', s === p.status)}>${s}</option>`)}</select><button class="btn btn--ghost btn--sm">OK</button></form></td></tr>`))}
    <form method="post" action="/admin/promociones" class="panel form section" style="max-width:none">${csrf(ctx)}<h2>Promoción institucional</h2>
      <div class="grid-3">${C.field({ label: 'Título', name: 'title', required: true })}${C.field({ label: 'Descuento (%)', name: 'discountPercent', type: 'number', min: 1, max: 50, required: true })}${C.field({ label: 'Código', name: 'code' })}</div>
      <div class="grid-3">${C.select({ label: 'Para', name: 'audience', options: [['all', 'Todos'], ['new_clients', 'Clientes nuevos'], ['returning_clients', 'Clientes que vuelven']] })}${C.field({ label: 'Desde', name: 'validFrom', type: 'date' })}${C.field({ label: 'Hasta', name: 'validTo', type: 'date' })}</div>
      ${C.field({ label: 'Usos máximos', name: 'maxUses', type: 'number', min: 0, value: 0 })}
      <p class="small muted">El descuento nunca supera la tarifa de Alternativa de cada reserva.</p>
      <button class="btn btn--primary">Crear</button></form>`;
  return page(ctx, 'Promociones', 'promociones', body);
}

// ── Configuración ─────────────────────────────────────────
const SETTING_LABELS = {
  site: { _title: 'General', name: 'Nombre del sitio', tagline: 'Descripción', contactEmail: 'Email de contacto', supportWhatsapp: 'WhatsApp de soporte', instagram: 'Instagram', maintenanceMode: 'Modo mantenimiento', allowSpecialistSignup: 'Permitir alta de especialistas' },
  commission: { _title: 'Comisión y precios', globalRate: 'Comisión general (%)', feeMode: 'Modo de tarifa', priceDisplay: 'Cómo se muestra el precio', feeLabel: 'Nombre de la tarifa' },
  payments: { _title: 'Pagos', collectionModel: 'Modelo de cobro', paymentWindowMinutes: 'Minutos para pagar', processorFeePercent: 'Costo estimado del procesador (%)', processorFeePaidBy: 'Quién absorbe el costo del procesador', requireConnectedAccount: 'Exigir cuenta de cobro vinculada (split)', payoutFrequencyDays: 'Frecuencia de liquidaciones (días)', minPayoutAmount: 'Monto mínimo de liquidación' },
  cancellation: { _title: 'Cancelaciones', fullRefundHours: 'Reembolso total con anticipación de (h)', partialRefundHours: 'Reembolso parcial desde (h)', partialRefundPercent: 'Reembolso parcial (%)', lateRefundPercent: 'Reembolso tardío (%)', noShowUserRefundPercent: 'Reembolso si el usuario no va (%)', specialistCancelRefundPercent: 'Reembolso si cancela el especialista (%)', noShowSpecialistRefundPercent: 'Reembolso si el especialista no va (%)', rescheduleMinHours: 'Reprogramar hasta (h antes)', maxReschedules: 'Máximo de reprogramaciones' },
  reviews: { _title: 'Reseñas', requestAfterHours: 'Pedir reseña tras (h)', editWindowDays: 'Días para editar', reviewWindowDays: 'Días para reseñar', bayesWeight: 'Peso del promedio ponderado (reseñas virtuales)', bayesPrior: 'Promedio esperado de la plataforma' },
  discovery: { _title: 'Descubrimiento', newcomerDays: 'Días como “Nuevo”', newcomerMaxReviews: 'Reseñas máximas como “Nuevo”', newcomerEvery: '1 perfil nuevo cada N posiciones', sponsoredSlots: 'Patrocinados por listado' },
  messaging: { _title: 'Mensajería', contactPolicy: 'Compartir datos de contacto' },
  moderation: { _title: 'Moderación', newSpecialistsRequireReview: 'Revisar fichas nuevas antes de publicar', sensitiveChangesRequireReview: 'Revisar cambios de nombre y categorías', newServicesRequireReview: 'Revisar servicios nuevos', mediaRequiresReview: 'Revisar fotos y videos', newCategoriesRequireReview: 'Revisar categorías propuestas' },
  media: { _title: 'Multimedia', maxPhotos: 'Máximo de fotos', maxImageMB: 'Tamaño máximo de imagen (MB)', maxVideoMB: 'Tamaño máximo de video (MB)', maxVideoSeconds: 'Duración máxima de video (s)', maxDocumentMB: 'Tamaño máximo de documento (MB)' },
  notifications: { _title: 'Notificaciones', reminderHoursBefore: 'Primer recordatorio (h antes)', secondReminderHoursBefore: 'Segundo recordatorio (h antes)', rebookAfterDays: 'Recordar volver a reservar tras (días)', adminAlertEmail: 'Email extra para alertas' },
  automation: { _title: 'Automatizaciones', autoCompleteAfterHours: 'Marcar realizada tras (h) sin incidencias' },
};
const ENUMS = {
  'commission.feeMode': [['added', 'Se suma al precio (el cliente ve el final)'], ['included', 'Incluida en el precio del especialista']],
  'commission.priceDisplay': [['breakdown', 'Desglosado: servicio + tarifa'], ['total', 'Solo total']],
  'payments.collectionModel': Object.entries(COLLECTION_MODELS).map(([k, v]) => [k, v.label]),
  'payments.processorFeePaidBy': [['specialist', 'El especialista (estándar del split)'], ['customer', 'El cliente (se suma al precio)'], ['platform', 'Alternativa (sale de la tarifa)']],
  'messaging.contactPolicy': [['after_booking', 'Después de la primera reserva'], ['always', 'Siempre'], ['never', 'Nunca']],
};

function settings(ctx, { settings: s, section, env }) {
  const labels = SETTING_LABELS[section];
  const values = s[section];
  const fields = Object.entries(labels).filter(([k]) => k !== '_title').map(([key, label]) => {
    const v = values[key];
    const en = ENUMS[`${section}.${key}`];
    if (en) return C.select({ label, name: key, value: v, required: true, options: en });
    if (typeof v === 'boolean') return C.checkbox({ label, name: key, checked: v });
    if (typeof v === 'number') return C.field({ label, name: key, type: 'number', step: 'any', min: 0, value: v, required: true });
    return C.field({ label, name: key, value: v, type: key.toLowerCase().includes('email') ? 'email' : 'text' });
  });
  const body = html`${C.pageHead({ title: 'Configuración general' })}
    ${C.tabs(Object.entries(SETTING_LABELS).map(([k, l]) => [k, `/admin/configuracion?seccion=${k}`, l._title]), section)}
    <form method="post" action="/admin/configuracion/${section}" class="panel form" style="max-width:720px">${csrf(ctx)}
      ${section === 'payments' ? html`<p class="notice">Modelo recomendado: split automático. El cliente paga una vez y la pasarela divide al instante; no hay transferencias manuales. Los cambios aplican a reservas nuevas.</p>` : ''}
      ${section === 'cancellation' ? html`<p class="notice">Cada reserva guarda la política vigente al momento de reservar.</p>` : ''}
      ${fields}
      <button class="btn btn--primary">Guardar</button>
    </form>
    <section class="section panel" style="max-width:720px"><h2>Entorno (variables de Heroku)</h2>${C.dl([['Entorno', env.appEnv], ['Pasarela', env.provider], ['Almacenamiento', env.storage], ['Email', env.email], ['Push (VAPID)', env.push ? 'Configurado' : 'No configurado'], ['WhatsApp', env.whatsapp ? 'Configurado' : 'No configurado']])}<p class="small muted">Estos valores se cambian como variables de entorno (ver README).</p></section>`;
  return page(ctx, 'Configuración', 'configuracion', body);
}

function notifications(ctx, { list, sent }) {
  const body = html`${C.pageHead({ title: 'Avisos' })}
    <div class="grid-2" style="align-items:start">
      <form method="post" action="/admin/notificaciones/enviar" class="panel form stack" style="max-width:none" data-confirm="¿Enviar este aviso?">${csrf(ctx)}<h2>Enviar aviso</h2>
        ${C.select({ label: 'Destinatarios', name: 'audience', required: true, options: [['email', 'Una cuenta (por email)'], ['specialists', 'Todos los especialistas'], ['users', 'Todos los usuarios (sin ficha)'], ['all', 'Todas las cuentas']] })}
        ${C.field({ label: 'Email (si es una cuenta)', name: 'email', type: 'email' })}
        ${C.field({ label: 'Título', name: 'title', required: true, maxlength: 120 })}
        ${C.field({ label: 'Mensaje', name: 'body', type: 'textarea', rows: 4, required: true })}
        ${C.field({ label: 'Enlace interno', name: 'link', placeholder: '/panel/promociones' })}
        ${C.checkbox({ label: 'También por email (solo a quienes aceptaron novedades, salvo envío individual)', name: 'sendEmail' })}
        <button class="btn btn--primary">Enviar</button></form>
      <section class="panel"><h2>Tus alertas</h2>${list.length ? html`<ul class="list">${list.map((n) => html`<li><a href="${n.link || '#'}"><strong>${n.title}</strong></a><br><span class="small muted">${n.body || ''} · ${D.fmtRelative(n.createdAt)}</span></li>`)}</ul>` : html`<p class="muted">Sin alertas.</p>`}
        ${sent.length ? html`<h3>Últimos envíos</h3><ul class="list">${sent.map((l) => html`<li class="small">${l.summary} · ${D.fmtRelative(l.createdAt)}</li>`)}</ul>` : ''}</section>
    </div>`;
  return page(ctx, 'Avisos', 'notificaciones', body);
}

function contentList(ctx, { tipo, list }) {
  const T = { post: 'Blog', faq: 'Preguntas frecuentes', page: 'Páginas' };
  const PAGES = ['como-funciona', 'sobre-alternativa', 'terminos', 'privacidad', 'cancelaciones'];
  const missing = tipo === 'page' ? PAGES.filter((p) => !list.some((c) => c.slug === p)) : [];
  const body = html`${C.pageHead({ title: 'Gestión de contenido', actions: html`<a class="btn btn--primary btn--sm" href="/admin/contenido/nuevo?tipo=${tipo}">${icon('plus', { size: 16 })}Nuevo</a>` })}
    ${C.tabs(Object.entries(T).map(([k, l]) => [k, `/admin/contenido?tipo=${k}`, l]), tipo)}
    ${missing.length ? html`<p class="notice">Usando el texto por defecto: ${missing.map((m, i) => html`${i ? ', ' : ''}<a href="/admin/contenido/nuevo?tipo=page&slug=${m}">${m}</a>`)}. Creá la página para editarla (Términos y condiciones incluidos).</p>` : ''}
    ${table(['Título', tipo === 'faq' ? 'Sección' : 'Enlace', 'Estado', 'Actualizado', ''], list.map((c) => html`<tr><td>${idLink(`/admin/contenido/${c._id}`, c.title)}</td><td>${tipo === 'faq' ? c.category : html`<span class="code">${tipo === 'post' ? '/blog/' : '/'}${c.slug}</span>`}</td><td>${c.status === 'published' ? C.pill('Publicado', 'ok') : C.pill('Borrador')}</td><td>${D.fmtRelative(c.updatedAt)}</td><td>${C.actionButton(ctx, { action: `/admin/contenido/${c._id}/eliminar`, label: 'Eliminar', cls: 'btn btn--text btn--sm', confirm: '¿Eliminar este contenido?' })}</td></tr>`))}
    <form method="post" action="/admin/contenido-imagen?_csrf=${ctx.csrf}" enctype="multipart/form-data" class="panel row section">${csrf(ctx)}<span>Subir imagen para usar en artículos:</span><input type="file" name="file" accept="image/jpeg,image/png,image/webp" required aria-label="Imagen"><button class="btn btn--ghost btn--sm">Subir</button></form>`;
  return page(ctx, 'Contenido', 'contenido', body);
}

function contentForm(ctx, { values: v = {}, errors = {}, editing }) {
  const tipo = v.type || 'post';
  const body = html`${C.pageHead({ title: editing ? 'Editar contenido' : 'Nuevo contenido', back: `/admin/contenido?tipo=${tipo}` })}
    <form method="post" action="${editing ? `/admin/contenido/${editing}` : '/admin/contenido'}" class="form panel" style="max-width:860px">${csrf(ctx)}
      <input type="hidden" name="type" value="${tipo}">
      ${C.field({ label: tipo === 'faq' ? 'Pregunta' : 'Título', name: 'title', value: v.title, required: true, error: errors.title })}
      ${tipo !== 'faq' ? C.field({ label: 'Enlace', name: 'slug', value: v.slug, error: errors.slug, hint: tipo === 'page' ? 'Páginas fijas: como-funciona, sobre-alternativa, terminos, privacidad, cancelaciones.' : 'Vacío = se genera del título.' }) : ''}
      ${tipo !== 'faq' ? C.field({ label: 'Resumen', name: 'excerpt', value: v.excerpt, maxlength: 400 }) : ''}
      ${C.field({ label: tipo === 'faq' ? 'Respuesta' : 'Contenido', name: 'body', type: 'textarea', rows: 16, value: v.body, required: true, error: errors.body, hint: 'Markdown simple: ## título, **negrita**, *cursiva*, [enlace](/ruta), listas con - o 1.' })}
      <div class="grid-3">
        ${C.field({ label: tipo === 'faq' ? 'Sección' : 'Tema', name: 'category', value: v.category })}
        ${tipo === 'post' ? C.field({ label: 'Etiquetas (categorías relacionadas)', name: 'tags', value: v.tags, hint: 'Ej: masajes, yoga' }) : C.field({ label: 'Orden', name: 'order', type: 'number', value: v.order ?? 0 })}
        ${C.select({ label: 'Estado', name: 'status', value: v.status, options: [['draft', 'Borrador'], ['published', 'Publicado']] })}
      </div>
      ${tipo === 'post' ? C.field({ label: 'Imagen de portada (URL)', name: 'coverUrl', type: 'url', value: v.coverUrl }) : ''}
      ${tipo !== 'faq' ? html`<div class="grid-2">${C.field({ label: 'Título SEO', name: 'seoTitle', value: v.seoTitle, maxlength: 70 })}${C.field({ label: 'Descripción SEO', name: 'seoDescription', value: v.seoDescription, maxlength: 160 })}</div>` : ''}
      <button class="btn btn--primary">Guardar</button>
    </form>`;
  return page(ctx, 'Contenido', 'contenido', body);
}

function auditList(logs) {
  if (!logs.length) return html`<p class="muted">Sin registros.</p>`;
  return html`<ul class="list">${logs.map((l) => html`<li><span class="${classes('pill', l.severity === 'security' && 'pill--danger', l.severity === 'warning' && 'pill--warn')}">${l.action}</span> <span class="small muted">${l.actorName} · ${D.fmtDateTime(l.createdAt)}</span>${l.summary ? html`<br><span class="small">${l.summary}</span>` : ''}</li>`)}</ul>`;
}

function audit(ctx, { result, query }) {
  const body = html`${C.pageHead({ title: 'Auditoría', subtitle: 'Quién modificó qué, cuándo, con valor anterior y nuevo.' })}
    ${filters([{ label: 'Acción (prefijo)', name: 'accion' }, { label: 'Entidad', name: 'entidad', options: ['Booking', 'Payment', 'Refund', 'Payout', 'Specialist', 'Service', 'User', 'Review', 'CommissionRule', 'Setting', 'Media', 'Category', 'Content', 'Ticket'].map((x) => [x, x]) }, { label: 'Severidad', name: 'severidad', options: [['info', 'Info'], ['warning', 'Advertencia'], ['security', 'Seguridad']] }], query)}
    ${table(['Fecha', 'Quién', 'Acción', 'Objeto', 'Cambios', 'IP'], result.items.map((l) => html`<tr><td style="white-space:nowrap">${D.fmtDateShort(l.createdAt)} ${D.fmtTime(l.createdAt)}</td><td>${l.actorName}<br><span class="small muted">${l.actorRole}</span></td><td><span class="${classes('pill', l.severity === 'security' && 'pill--danger', l.severity === 'warning' && 'pill--warn')}">${l.action}</span>${l.summary ? html`<br><span class="small">${l.summary}</span>` : ''}</td><td class="small">${l.entity || ''}${l.entityId ? html`<br><span class="code">${String(l.entityId).slice(-8)}</span>` : ''}</td>
      <td class="small">${l.before || l.after ? html`<details><summary style="cursor:pointer">Ver</summary><pre class="code">${JSON.stringify({ antes: l.before, despues: l.after }, null, 1).slice(0, 2000)}</pre></details>` : ''}</td><td class="small muted">${l.ip || ''}</td></tr>`))}
    ${C.pagination(result, query, '/admin/auditoria')}`;
  return page(ctx, 'Auditoría', 'auditoria', body);
}

const TS = { open: 'Abierta', waiting_user: 'Esperando usuario', resolved: 'Resuelta', closed: 'Cerrada' };
function tickets(ctx, { result, query }) {
  const body = html`${C.pageHead({ title: 'Soporte e incidencias' })}
    ${filters([{ label: 'Estado', name: 'estado', options: Object.entries(TS) }, { label: 'Tema', name: 'tema', options: [['booking', 'Reserva'], ['payment', 'Pago'], ['refund', 'Reembolso'], ['account', 'Cuenta'], ['specialist', 'Especialista'], ['technical', 'Técnico'], ['other', 'Otro']] }], query)}
    ${table(['#', 'Asunto', 'De', 'Reserva', 'Prioridad', 'Estado', 'Actualizado'], result.items.map((t) => html`<tr><td>${t.number}</td><td>${idLink(`/admin/soporte/${t._id}`, t.subject)}</td><td>${t.user?.name || t.name}<br><span class="small muted">${t.user?.email || t.email}</span></td><td>${t.booking ? idLink(`/admin/reservas/${t.booking._id}`, t.booking.code) : '—'}</td><td>${t.priority === 'high' ? C.pill('Alta', 'danger') : t.priority}</td><td>${TS[t.status]}</td><td>${D.fmtRelative(t.updatedAt)}</td></tr>`))}
    ${C.pagination(result, query, '/admin/soporte')}`;
  return page(ctx, 'Soporte', 'soporte', body);
}

function ticketDetail(ctx, { t }) {
  const body = html`${C.pageHead({ title: `#${t.number} · ${t.subject}`, subtitle: html`${t.user ? idLink(`/admin/usuarios/${t.user._id}`, t.user.name) : t.name} · ${t.user?.email || t.email}${t.booking ? html` · ${idLink(`/admin/reservas/${t.booking._id}`, t.booking.code)}` : ''}`, back: '/admin/soporte' })}
    <div class="thread" style="max-height:none">${t.messages.map((m) => html`<div class="bubble ${m.authorRole === 'admin' ? 'bubble--me' : 'bubble--them'}"><strong>${m.authorRole === 'admin' ? 'Alternativa' : m.authorRole === 'system' ? 'Sistema' : m.authorRole}</strong><br>${m.body}<span class="bubble__time">${D.fmtDateTime(m.at)}</span></div>`)}</div>
    <form method="post" action="/admin/soporte/${t._id}" class="panel form stack" style="max-width:none">${csrf(ctx)}
      ${C.field({ label: 'Respuesta (se notifica a la persona)', name: 'body', type: 'textarea', rows: 4 })}
      <div class="grid-2">${C.select({ label: 'Estado', name: 'status', value: t.status, options: Object.entries(TS) })}${C.select({ label: 'Prioridad', name: 'priority', value: t.priority, options: [['low', 'Baja'], ['normal', 'Normal'], ['high', 'Alta']] })}</div>
      <button class="btn btn--primary">Guardar y responder</button></form>`;
  return page(ctx, `Consulta #${t.number}`, 'soporte', body);
}

module.exports = {
  dashboard, pending, stats, specialists, specialistForm, specialistDetail, serviceForm, verifications, users, userDetail, services, serviceDetail,
  categories, categoryForm, bookings, bookingDetail, payments, paymentDetail, commissions, refunds, payouts, reviews, moderation, reports,
  sponsored, promotions, settings, notifications, contentList, contentForm, audit, tickets, ticketDetail, SETTING_LABELS,
};
