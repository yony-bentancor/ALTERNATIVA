'use strict';
const { html } = require('../lib/html');
const { layout } = require('./layout');
const { icon } = require('./icons');
const C = require('./components');

const page = (ctx, title, body) => layout(ctx, { title, body: html`<div class="auth">${body}</div>`, noindex: true, hideFooter: false });

function login(ctx, { values = {}, error }) {
  return page(ctx, 'Ingresar', html`
    <h1>Ingresar</h1>
    ${error ? html`<div class="flash flash--error">${icon('alert', { size: 18 })}<span>${error}</span></div>` : ''}
    <form method="post" action="/login" style="margin-top:16px">${C.csrfField(ctx)}
      ${C.field({ label: 'Email', name: 'email', type: 'email', value: values.email, required: true, autocomplete: 'email' })}
      ${C.field({ label: 'Contraseña', name: 'password', type: 'password', required: true, autocomplete: 'current-password' })}
      <button class="btn btn--primary btn--block btn--lg" type="submit">Ingresar</button>
    </form>
    <p class="auth__alt"><a href="/recuperar">¿Olvidaste tu contraseña?</a></p>
    <p class="auth__alt">¿No tenés cuenta? <a href="/registro">Creala gratis</a></p>`);
}

function accountType(ctx) {
  return page(ctx, 'Crear cuenta', html`
    <h1>Crear cuenta</h1>
    <p class="muted">¿Cómo vas a usar Alternativa?</p>
    <div class="choice">
      <a href="/registro?tipo=usuario">${icon('search', { size: 26 })}<div><strong>Quiero reservar sesiones</strong><span>Buscá especialistas, reservá y pagá en un paso.</span></div></a>
      <a href="/registro?tipo=especialista">${icon('leaf', { size: 26 })}<div><strong>Ofrezco servicios</strong><span>Publicá tu ficha, recibí reservas y cobrá automáticamente.</span></div></a>
    </div>
    <p class="auth__alt">¿Ya tenés cuenta? <a href="/login">Ingresá</a></p>`);
}

function register(ctx, { values = {}, errors = {}, tipo }) {
  const spec = tipo === 'especialista';
  return page(ctx, 'Crear cuenta', html`
    <h1>${spec ? 'Creá tu cuenta de especialista' : 'Creá tu cuenta'}</h1>
    <p class="muted">${spec ? 'Primero tu cuenta personal; en el paso siguiente armás tu ficha profesional.' : 'Con tu cuenta reservás, guardás favoritos y repetís sesiones en segundos.'}</p>
    <form method="post" action="/registro" novalidate>${C.csrfField(ctx)}<input type="hidden" name="tipo" value="${tipo}">
      ${C.field({ label: 'Nombre y apellido', name: 'name', value: values.name, required: true, error: errors.name, autocomplete: 'name' })}
      ${C.field({ label: 'Email', name: 'email', type: 'email', value: values.email, required: true, error: errors.email, autocomplete: 'email' })}
      ${C.field({ label: 'Celular', name: 'phone', type: 'tel', value: values.phone, error: errors.phone, autocomplete: 'tel', placeholder: '099 123 456', hint: 'Para avisos de tus reservas. No se muestra públicamente.' })}
      ${C.field({ label: 'Contraseña', name: 'password', type: 'password', required: true, error: errors.password, autocomplete: 'new-password', hint: 'Al menos 8 caracteres, con letras y números.' })}
      ${C.checkbox({ label: 'Acepto los términos y la política de privacidad', name: 'acceptTerms', checked: values.acceptTerms })}
      <p class="small muted"><a href="/terminos" target="_blank">Términos y condiciones</a> · <a href="/privacidad" target="_blank">Privacidad</a></p>
      <button class="btn btn--primary btn--block btn--lg" type="submit">Crear cuenta</button>
    </form>
    <p class="auth__alt">¿Ya tenés cuenta? <a href="/login">Ingresá</a></p>`);
}

function forgot(ctx, { sent }) {
  return page(ctx, 'Recuperar contraseña', sent
    ? html`<div class="result-hero"><div class="result-hero__icon result-hero__icon--wait">${icon('mail', { size: 32 })}</div><h1>Revisá tu email</h1><p class="muted">Si hay una cuenta con ese email, te enviamos un enlace para elegir una contraseña nueva. Vence en 1 hora.</p><a class="btn btn--ghost" href="/login">Volver a ingresar</a></div>`
    : html`<h1>Recuperar contraseña</h1><p class="muted">Te enviamos un enlace para elegir una nueva.</p>
      <form method="post" action="/recuperar">${C.csrfField(ctx)}${C.field({ label: 'Email', name: 'email', type: 'email', required: true, autocomplete: 'email' })}<button class="btn btn--primary btn--block" type="submit">Enviar enlace</button></form>`);
}

function reset(ctx, { token, invalid, error }) {
  if (invalid) return page(ctx, 'Enlace vencido', html`<h1>El enlace venció</h1><p class="muted">Pedí uno nuevo para cambiar tu contraseña.</p><a class="btn btn--primary" href="/recuperar">Pedir otro enlace</a>`);
  return page(ctx, 'Nueva contraseña', html`<h1>Elegí una contraseña nueva</h1>
    ${error ? html`<div class="flash flash--error">${icon('alert', { size: 18 })}<span>${error}</span></div>` : ''}
    <form method="post" action="/restablecer/${token}">${C.csrfField(ctx)}
      ${C.field({ label: 'Contraseña nueva', name: 'password', type: 'password', required: true, autocomplete: 'new-password', hint: 'Al menos 8 caracteres, con letras y números.' })}
      ${C.field({ label: 'Repetila', name: 'password2', type: 'password', required: true, autocomplete: 'new-password' })}
      <button class="btn btn--primary btn--block" type="submit">Guardar contraseña</button></form>`);
}

function claim(ctx, { sp, token, error }) {
  if (error) return page(ctx, 'Reclamar perfil', html`<h1>No pudimos abrir la invitación</h1><p class="muted">${error}</p><a class="btn btn--ghost" href="/contacto">Escribinos</a>`);
  return page(ctx, 'Reclamar perfil', html`
    <h1>Tu perfil está disponible en Alternativa</h1>
    <div class="panel panel--lav stack"><p style="margin:0"><strong>${sp.displayName}</strong>${sp.headline ? html`<br><span class="muted">${sp.headline}</span>` : ''}</p><a href="/especialistas/${sp.slug}">Ver la ficha</a></div>
    <p style="margin-top:16px">Al reclamarlo vas a poder editar tu información, servicios, precios y agenda. Después te pediremos verificar tu identidad.</p>
    ${ctx.user
    ? html`<form method="post" action="/reclamar/${token}">${C.csrfField(ctx)}<button class="btn btn--primary btn--block btn--lg">Reclamar este perfil como ${ctx.user.name}</button></form>`
    : html`<div class="btnbar"><a class="btn btn--primary" href="/registro?tipo=usuario">Crear cuenta para reclamarlo</a><a class="btn btn--ghost" href="/login?volver=/reclamar/${token}">Ya tengo cuenta</a></div>`}`);
}

module.exports = { login, accountType, register, forgot, reset, claim };
