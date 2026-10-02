'use strict';
const { html } = require('../lib/html');
const { layout } = require('./layout');
const { icon } = require('./icons');

const notFound = (ctx) => layout(ctx, {
  title: 'Página no encontrada', noindex: true,
  body: html`<div class="errorpage"><p class="errorpage__code">404</p><h1>No encontramos esta página</h1><p class="muted">Puede que el enlace esté mal escrito o que el contenido ya no esté publicado.</p><div class="btnbar" style="justify-content:center"><a class="btn btn--primary" href="/buscar">Buscar servicios</a><a class="btn btn--ghost" href="/">Ir al inicio</a></div></div>`,
});

const error = (ctx, { status, message }) => layout(ctx, {
  title: status === 403 ? 'Sin permiso' : 'Error', noindex: true,
  body: html`<div class="errorpage"><p class="errorpage__code">${status}</p><h1>${status === 403 ? 'No tenés acceso a esta sección' : status === 401 ? 'Tenés que iniciar sesión' : 'Algo no salió bien'}</h1><p class="muted">${message}</p><div class="btnbar" style="justify-content:center">${status === 401 ? html`<a class="btn btn--primary" href="/login">Iniciar sesión</a>` : ''}<a class="btn btn--ghost" href="/">Ir al inicio</a></div></div>`,
});

const maintenance = (ctx) => layout(ctx, {
  title: 'En mantenimiento', noindex: true, hideFooter: true,
  body: html`<div class="errorpage">${icon('leaf', { size: 48 })}<h1>Estamos haciendo mejoras</h1><p class="muted">Alternativa vuelve en unos minutos. Tus reservas siguen confirmadas.</p></div>`,
});

module.exports = { notFound, error, maintenance };
