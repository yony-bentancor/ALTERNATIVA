'use strict';
const { html, raw, jsonScript, classes } = require('../lib/html');
const { icon } = require('./icons');

const NAV = {
  public: [
    { key: 'inicio', href: '/', label: 'Inicio', icon: 'home' },
    { key: 'buscar', href: '/buscar', label: 'Buscar', icon: 'search' },
    { key: 'reservas', href: '/mi/reservas', label: 'Reservas', icon: 'calendar' },
    { key: 'mensajes', href: '/mi/mensajes', label: 'Mensajes', icon: 'chat', badge: 'userMessages' },
    { key: 'perfil', href: '/mi', label: 'Perfil', icon: 'user' },
  ],
  specialist: [
    { key: 'inicio', href: '/panel', label: 'Inicio', icon: 'home' },
    { key: 'agenda', href: '/panel/agenda', label: 'Agenda', icon: 'calendar' },
    { key: 'reservas', href: '/panel/reservas', label: 'Reservas', icon: 'list' },
    { key: 'clientes', href: '/panel/clientes', label: 'Clientes', icon: 'users' },
    { key: 'mas', href: '/panel/mas', label: 'Más', icon: 'menu', badge: 'specialistMessages' },
  ],
};

const SPECIALIST_SIDE = [
  ['Gestión', [
    ['inicio', '/panel', 'Inicio', 'home'], ['agenda', '/panel/agenda', 'Agenda', 'calendar'], ['reservas', '/panel/reservas', 'Reservas', 'list'],
    ['clientes', '/panel/clientes', 'Clientes', 'users'], ['mensajes', '/panel/mensajes', 'Mensajes', 'chat'],
  ]],
  ['Mi ficha', [
    ['perfil', '/panel/perfil', 'Perfil', 'user'], ['servicios', '/panel/servicios', 'Servicios', 'layers'], ['multimedia', '/panel/perfil/multimedia', 'Fotos y video', 'image'],
    ['resenas', '/panel/resenas', 'Reseñas', 'star'], ['verificacion', '/panel/verificacion', 'Verificación', 'shield'],
  ]],
  ['Negocio', [
    ['estadisticas', '/panel/estadisticas', 'Estadísticas', 'chart'], ['ingresos', '/panel/ingresos', 'Ingresos', 'wallet'],
    ['promociones', '/panel/promociones', 'Promociones', 'tag'], ['destacados', '/panel/destacados', 'Destacados', 'megaphone'], ['plan', '/panel/plan', 'Plan Profesional', 'sparkle'],
  ]],
  ['Cuenta', [
    ['cobros', '/panel/cuenta/cobros', 'Cobros', 'card'], ['configuracion', '/panel/cuenta', 'Configuración', 'settings'], ['ayuda', '/panel/ayuda', 'Ayuda', 'help'],
  ]],
];

const ADMIN_SIDE = [
  ['General', [['dashboard', '/admin', 'Resumen', 'home'], ['pendientes', '/admin/pendientes', 'Pendientes', 'bell'], ['estadisticas', '/admin/estadisticas', 'Estadísticas', 'chart']]],
  ['Marketplace', [
    ['especialistas', '/admin/especialistas', 'Especialistas', 'users'], ['usuarios', '/admin/usuarios', 'Usuarios', 'user'], ['servicios', '/admin/servicios', 'Servicios', 'layers'],
    ['categorias', '/admin/categorias', 'Categorías', 'grid'], ['reservas', '/admin/reservas', 'Reservas', 'calendar'], ['verificaciones', '/admin/verificaciones', 'Verificaciones', 'shield'],
  ]],
  ['Dinero', [
    ['pagos', '/admin/pagos', 'Pagos', 'card'], ['reembolsos', '/admin/reembolsos', 'Reembolsos', 'repeat'], ['liquidaciones', '/admin/liquidaciones', 'Liquidaciones', 'wallet'],
    ['comisiones', '/admin/comisiones', 'Comisiones', 'receipt'],
  ]],
  ['Confianza', [
    ['resenas', '/admin/resenas', 'Reseñas', 'star'], ['moderacion', '/admin/moderacion', 'Moderación', 'eye'], ['denuncias', '/admin/denuncias', 'Denuncias', 'flag'],
    ['soporte', '/admin/soporte', 'Soporte', 'help'],
  ]],
  ['Crecimiento', [['destacados', '/admin/destacados', 'Destacados', 'megaphone'], ['promociones', '/admin/promociones', 'Promociones', 'tag'], ['contenido', '/admin/contenido', 'Contenido', 'file'], ['notificaciones', '/admin/notificaciones', 'Avisos', 'send']]],
  ['Sistema', [['configuracion', '/admin/configuracion', 'Configuración', 'settings'], ['auditoria', '/admin/auditoria', 'Auditoría', 'lock']]],
];

function flashes(ctx) {
  if (!ctx.flash?.length) return '';
  return html`<div class="flashes" role="status">${ctx.flash.map((f) => html`<div class="flash flash--${f.type}">${icon(f.type === 'error' ? 'alert' : f.type === 'success' ? 'checkCircle' : 'info', { size: 18 })}<span>${f.message}</span><button type="button" class="flash__close" data-dismiss aria-label="Cerrar">${icon('x', { size: 16 })}</button></div>`)}</div>`;
}

function logo(href = '/') {
  return html`<a class="logo" href="${href}" aria-label="Alternativa, inicio"><span class="logo__mark" aria-hidden="true"></span><span class="logo__word">alternativa</span></a>`;
}

function avatarMini(user) {
  const initial = (user?.name || '?').trim()[0]?.toUpperCase() || '?';
  if (user?.avatarUrl) return html`<img class="avatar avatar--sm" src="${user.avatarUrl}" alt="">`;
  return html`<span class="avatar avatar--sm avatar--initial" aria-hidden="true">${initial}</span>`;
}

function topbar(ctx, area) {
  const u = ctx.user;
  const panelLink = u?.specialist ? html`<a class="topnav__link hide-sm" href="/panel">Mi panel</a>` : '';
  const adminLink = u?.role === 'admin' ? html`<a class="topnav__link hide-sm" href="/admin">Administración</a>` : '';
  const offer = !u?.specialist ? html`<a class="topnav__link topnav__link--quiet hide-sm" href="/ofrecer">Ofrecé tus servicios</a>` : '';
  const right = u
    ? html`
      <a class="iconbtn" href="/mi/notificaciones" aria-label="Notificaciones${ctx.unreadNotifications ? ` (${ctx.unreadNotifications} sin leer)` : ''}">${icon('bell')}${ctx.unreadNotifications ? html`<span class="dot">${ctx.unreadNotifications > 9 ? '9+' : ctx.unreadNotifications}</span>` : ''}</a>
      <details class="menu">
        <summary class="menu__trigger" aria-label="Menú de cuenta">${avatarMini(u)}<span class="hide-sm">${u.name.split(' ')[0]}</span>${icon('chevronDown', { size: 16 })}</summary>
        <div class="menu__panel">
          <a href="/mi">Mi cuenta</a>
          <a href="/mi/reservas">Mis reservas</a>
          <a href="/mi/favoritos">Favoritos</a>
          <a href="/mi/mensajes">Mensajes${ctx.unreadMessages?.user ? html` <span class="pill pill--brand">${ctx.unreadMessages.user}</span>` : ''}</a>
          ${u.specialist ? html`<a href="/panel">Panel de especialista</a>` : html`<a href="/ofrecer">Ofrecer mis servicios</a>`}
          ${u.role === 'admin' ? html`<a href="/admin">Administración</a>` : ''}
          <a href="/mi/configuracion">Configuración</a>
          <form method="post" action="/salir"><input type="hidden" name="_csrf" value="${ctx.csrf}"><button type="submit" class="menu__logout">${icon('logout', { size: 18 })} Salir</button></form>
        </div>
      </details>`
    : html`<a class="topnav__link" href="/login">Ingresar</a><a class="btn btn--primary btn--sm" href="/registro">Crear cuenta</a>`;

  const searchForm = area === 'public' ? html`
    <form class="topsearch hide-sm" action="/buscar" role="search">
      ${icon('search', { size: 18 })}<input type="search" name="q" placeholder="Masaje hoy, reiki online…" value="${ctx.path === '/buscar' ? ctx.query.q || '' : ''}" aria-label="Buscar servicios">
    </form>` : '';

  return html`
  <header class="topbar topbar--${area}">
    <div class="topbar__inner">
      ${logo(area === 'specialist' ? '/panel' : area === 'admin' ? '/admin' : '/')}
      ${area === 'specialist' ? html`<span class="area-tag">Panel</span>` : area === 'admin' ? html`<span class="area-tag area-tag--admin">Admin · ${ctx.appEnv}</span>` : ''}
      ${searchForm}
      <nav class="topnav" aria-label="Principal">
        ${area === 'public' ? html`<a class="topnav__link hide-sm" href="/categorias">Categorías</a>${offer}` : html`<a class="topnav__link hide-sm" href="/">Ver sitio</a>`}
        ${area !== 'specialist' ? panelLink : ''}${area !== 'admin' ? adminLink : ''}
        ${right}
      </nav>
    </div>
  </header>`;
}

function bottomNav(ctx, area, active) {
  const items = NAV[area === 'specialist' ? 'specialist' : 'public'];
  if (area === 'admin') return '';
  const badges = { userMessages: ctx.unreadMessages?.user || 0, specialistMessages: ctx.unreadMessages?.specialist || 0 };
  return html`<nav class="bottomnav" aria-label="Navegación">
    ${items.map((it) => html`<a class="${classes('bottomnav__item', active === it.key && 'is-active')}" href="${it.href}"${active === it.key ? raw(' aria-current="page"') : ''}>
      <span class="bottomnav__icon">${icon(it.icon, { size: 22 })}${it.badge && badges[it.badge] ? html`<span class="dot">${badges[it.badge]}</span>` : ''}</span>
      <span>${it.label}</span></a>`)}
  </nav>`;
}

function sidebar(groups, active, ctx) {
  return html`<aside class="sidenav" aria-label="Secciones">
    ${groups.map(([title, links]) => html`<div class="sidenav__group"><p class="sidenav__title">${title}</p>
      ${links.map(([key, href, label, ic]) => html`<a class="${classes('sidenav__link', active === key && 'is-active')}" href="${href}">${icon(ic, { size: 18 })}<span>${label}</span>${key === 'mensajes' && ctx.unreadMessages?.specialist ? html`<span class="pill pill--brand">${ctx.unreadMessages.specialist}</span>` : ''}</a>`)}
    </div>`)}
  </aside>`;
}

// En celulares el panel de administración no tiene barra inferior: menú desplegable.
function mobileAdminMenu(active) {
  const current = ADMIN_SIDE.flatMap(([, links]) => links).find(([key]) => key === active);
  return html`<details class="menu mobile-only adminmenu"><summary class="btn btn--ghost btn--sm">${icon('menu', { size: 16 })}${current ? current[2] : 'Secciones'}</summary>
    <div class="menu__panel" style="left:0;right:auto;max-height:70vh;overflow:auto">${ADMIN_SIDE.map(([title, links]) => html`<p class="sidenav__title" style="margin:8px 12px 2px">${title}</p>${links.map(([, href, label, ic]) => html`<a href="${href}">${icon(ic, { size: 16 })}${label}</a>`)}`)}</div>
  </details>`;
}

function footer(ctx) {
  const s = ctx.settings.site;
  return html`<footer class="footer">
    <div class="footer__inner">
      <div class="footer__brand">${logo()}<p>${s.tagline}</p></div>
      <nav class="footer__cols" aria-label="Pie de página">
        <div><p class="footer__h">Alternativa</p><a href="/como-funciona">Cómo funciona</a><a href="/sobre-alternativa">Sobre Alternativa</a><a href="/blog">Blog</a><a href="/contacto">Contacto</a></div>
        <div><p class="footer__h">Ayuda</p><a href="/preguntas-frecuentes">Preguntas frecuentes</a><a href="/cancelaciones">Política de cancelaciones</a><a href="/terminos">Términos y condiciones</a><a href="/privacidad">Privacidad</a></div>
        <div><p class="footer__h">Especialistas</p><a href="/ofrecer">Ofrecé tus servicios</a><a href="/panel">Panel de especialista</a><a href="/categorias">Categorías</a></div>
      </nav>
    </div>
    <p class="footer__legal">© ${new Date().getFullYear()} Alternativa · Uruguay${s.contactEmail ? html` · <a href="mailto:${s.contactEmail}">${s.contactEmail}</a>` : ''}</p>
  </footer>`;
}

/**
 * Página completa.
 * @param {object} ctx  contexto de la request (usuario, csrf, flash, settings…)
 * @param {object} o    { title, description, body, area, active, canonical, jsonLd, noindex, image, bodyClass, wide }
 */
function layout(ctx, o) {
  const area = o.area || 'public';
  const siteName = ctx.settings.site.name;
  const title = o.title ? `${o.title} · ${siteName}` : `${siteName} — Terapias y bienestar en Uruguay`;
  const description = o.description || ctx.settings.site.tagline;
  const canonical = o.canonical ? `${ctx.appUrl}${o.canonical}` : null;
  const image = o.image ? (o.image.startsWith('http') ? o.image : `${ctx.appUrl}${o.image}`) : `${ctx.appUrl}/img/og.png`;
  const noindex = o.noindex || area !== 'public' || ctx.appEnv !== 'production';
  const withSide = area === 'specialist' || area === 'admin';

  return html`<!doctype html>
<html lang="es-UY">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
${canonical ? html`<link rel="canonical" href="${canonical}">` : ''}
${noindex ? html`<meta name="robots" content="noindex,nofollow">` : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${siteName}">
<meta property="og:title" content="${o.title || siteName}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${image}">
${canonical ? html`<meta property="og:url" content="${canonical}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#3B82F6">
<meta name="csrf-token" content="${ctx.csrf}">
${ctx.vapidPublicKey ? html`<meta name="vapid-key" content="${ctx.vapidPublicKey}">` : ''}
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/img/icon-192.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/css/app.css">
${o.jsonLd ? [].concat(o.jsonLd).map((j) => html`<script type="application/ld+json">${jsonScript(j)}</script>`) : ''}
<script src="/js/app.js" defer></script>
</head>
<body class="${classes(`area-${area}`, o.bodyClass)}">
<a class="skip" href="#contenido">Saltar al contenido</a>
${topbar(ctx, area)}
${withSide
    ? html`<div class="shell">${sidebar(area === 'admin' ? ADMIN_SIDE : SPECIALIST_SIDE, o.active, ctx)}<main id="contenido" class="${classes('main', o.wide && 'main--wide')}">${area === 'admin' ? mobileAdminMenu(o.active) : ''}${flashes(ctx)}${o.body}</main></div>`
    : html`<main id="contenido" class="${classes('main', o.wide && 'main--wide', o.flush && 'main--flush')}">${flashes(ctx)}${o.body}</main>${o.hideFooter ? '' : footer(ctx)}`}
${bottomNav(ctx, area, o.active)}
</body>
</html>`;
}

module.exports = { layout, logo, NAV, SPECIALIST_SIDE, ADMIN_SIDE };
