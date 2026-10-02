/* Alternativa — interacción del lado del cliente (sin dependencias).
   El sitio funciona sin JavaScript; esto agrega comodidad: calendario de reservas,
   favoritos, chat en vivo, confirmaciones, push y ubicación. */
(function () {
  'use strict';

  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function api(url, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/json', 'X-CSRF-Token': csrf };
    if (opts.body && !(opts.body instanceof FormData)) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.body); }
    return fetch(url, { method: opts.method || 'GET', headers: headers, body: opts.body, credentials: 'same-origin' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) { var e = new Error(data.error || 'Error'); e.status = r.status; e.data = data; throw e; }
        return data;
      });
    });
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ── Mensajes flash ── */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-dismiss]');
    if (btn) btn.parentElement.remove();
  });

  /* ── Confirmación de acciones (diálogo accesible nativo) ── */
  var dialog;
  function confirmDialog(text) {
    return new Promise(function (resolve) {
      if (!window.HTMLDialogElement) return resolve(window.confirm(text));
      if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.className = 'confirm';
        dialog.innerHTML = '<p></p><div class="btnbar"><button type="button" class="btn btn--ghost" value="no">Volver</button><button type="button" class="btn btn--primary" value="si">Confirmar</button></div>';
        document.body.appendChild(dialog);
      }
      $('p', dialog).textContent = text;
      var done = function (v) { dialog.close(); resolve(v); };
      $$('button', dialog).forEach(function (b) { b.onclick = function () { done(b.value === 'si'); }; });
      dialog.oncancel = function () { resolve(false); };
      dialog.showModal();
      $('button[value="si"]', dialog).focus();
    });
  }
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.dataset.confirm && !form.dataset.confirmed) {
      e.preventDefault();
      confirmDialog(form.dataset.confirm).then(function (ok) {
        if (ok) { form.dataset.confirmed = '1'; if (form.requestSubmit) form.requestSubmit(); else form.submit(); }
      });
      return;
    }
    // Evita doble envío
    var submit = form.querySelector('button[type="submit"], button:not([type])');
    if (submit && !form.hasAttribute('data-no-lock')) {
      setTimeout(function () { submit.disabled = true; }, 0);
      setTimeout(function () { submit.disabled = false; }, 8000);
    }
  });

  /* ── Autoenvío de filtros ── */
  $$('[data-autosubmit]').forEach(function (el) {
    el.addEventListener('change', function () { el.form.submit(); });
  });

  /* ── Favoritos ── */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-fav]');
    if (!btn) return;
    e.preventDefault();
    var on = btn.getAttribute('aria-pressed') !== 'true';
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    api('/api/favoritos', { method: 'POST', body: { kind: btn.dataset.fav, id: btn.dataset.id, on: on } })
      .then(function (r) { btn.setAttribute('aria-label', r.on ? 'Quitar de favoritos' : 'Guardar en favoritos'); })
      .catch(function () { btn.classList.toggle('is-on', !on); btn.setAttribute('aria-pressed', on ? 'false' : 'true'); });
  });

  /* ── Cerca de mí ── */
  $$('[data-near]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var form = btn.form || document.querySelector(btn.dataset.near);
      if (!navigator.geolocation || !form) return;
      btn.disabled = true;
      navigator.geolocation.getCurrentPosition(function (pos) {
        form.elements.lat.value = pos.coords.latitude.toFixed(4);
        form.elements.lng.value = pos.coords.longitude.toFixed(4);
        form.submit();
      }, function () {
        btn.disabled = false;
        alert('No pudimos acceder a tu ubicación. Podés elegir el departamento en los filtros.');
      }, { timeout: 8000, maximumAge: 600000 });
    });
  });

  /* ── Calendario de reserva / reprogramación ── */
  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DOW = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

  $$('[data-booking]').forEach(function (root) {
    var serviceId = root.dataset.service;
    var mode = root.dataset.mode || 'book';
    var today = root.dataset.today; // YYYY-MM-DD en hora de Uruguay
    var exclude = root.dataset.exclude || '';
    var selectedDate = root.dataset.selected || '';
    var cur = { y: +today.slice(0, 4), m: +today.slice(5, 7) };
    var summary = {};
    var calEl = $('[data-cal]', root);
    var slotsEl = $('[data-slots]', root);
    var dayTitle = $('[data-day-title]', root);
    function currentModality() {
      var c = root.querySelector('input[name="modalidad"]:checked') || root.querySelector('select[name="modalidad"]');
      return c ? c.value : '';
    }

    function load(from) {
      return api('/api/disponibilidad/' + serviceId + '?desde=' + from + '&dias=42' + (exclude ? '&excluir=' + exclude : '')).then(function (r) {
        r.days.forEach(function (d) { summary[d.date] = d; });
      });
    }

    function render() {
      var first = new Date(Date.UTC(cur.y, cur.m - 1, 1));
      var offset = (first.getUTCDay() + 6) % 7;
      var days = new Date(Date.UTC(cur.y, cur.m, 0)).getUTCDate();
      var html = '<div class="cal__head"><button type="button" class="btn btn--ghost btn--sm" data-prev aria-label="Mes anterior">‹</button>' +
        '<span class="cal__title">' + MONTHS[cur.m - 1] + ' ' + cur.y + '</span>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-next aria-label="Mes siguiente">›</button></div><div class="cal__grid">';
      DOW.forEach(function (d) { html += '<span class="cal__dow">' + d + '</span>'; });
      for (var i = 0; i < offset; i++) html += '<span></span>';
      for (var d = 1; d <= days; d++) {
        var key = ymd(cur.y, cur.m, d);
        var info = summary[key];
        var has = info && info.count > 0;
        var cls = 'cal__day' + (has ? ' has-slots' : '') + (key === selectedDate ? ' is-selected' : '') + (key === today ? ' is-today' : '');
        html += '<button type="button" class="' + cls + '" data-day="' + key + '"' + (has ? '' : ' disabled') + ' aria-label="' + d + ' de ' + MONTHS[cur.m - 1] + (has ? ', ' + info.count + ' horarios' : ', sin horarios') + '">' + d + '</button>';
      }
      html += '</div>';
      calEl.innerHTML = html;
      var prev = $('[data-prev]', calEl);
      var isFirstMonth = cur.y === +today.slice(0, 4) && cur.m === +today.slice(5, 7);
      if (isFirstMonth) prev.disabled = true;
    }

    function showSlots(date) {
      selectedDate = date;
      render();
      slotsEl.innerHTML = '<p class="slots-empty">Buscando horarios…</p>';
      var p = date.split('-');
      if (dayTitle) dayTitle.textContent = 'Horarios del ' + (+p[2]) + ' de ' + MONTHS[+p[1] - 1];
      api('/api/horarios/' + serviceId + '?fecha=' + date + (exclude ? '&excluir=' + exclude : '')).then(function (r) {
        if (!r.slots.length) { slotsEl.innerHTML = '<p class="slots-empty">No quedan horarios libres este día. Probá con otra fecha.</p>'; return; }
        var html = '<div class="slots">';
        r.slots.forEach(function (s) {
          if (mode === 'reschedule') {
            html += '<button type="button" class="slot" data-time="' + s.time + '">' + s.time + '</button>';
          } else {
            var mod = currentModality();
            html += '<a class="slot" href="/reservar/' + serviceId + '/confirmar?fecha=' + date + '&hora=' + encodeURIComponent(s.time) + (mod ? '&modalidad=' + mod : '') + (root.dataset.extra || '') + '">' + s.time + '</a>';
          }
        });
        slotsEl.innerHTML = html + '</div>';
        slotsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }).catch(function () { slotsEl.innerHTML = '<p class="slots-empty">No pudimos cargar los horarios. Revisá tu conexión.</p>'; });
    }

    calEl.addEventListener('click', function (e) {
      var day = e.target.closest('[data-day]');
      if (day && !day.disabled) return showSlots(day.dataset.day);
      if (e.target.closest('[data-prev]')) { cur.m--; if (cur.m < 1) { cur.m = 12; cur.y--; } render(); }
      if (e.target.closest('[data-next]')) {
        cur.m++; if (cur.m > 12) { cur.m = 1; cur.y++; }
        var key = ymd(cur.y, cur.m, 1);
        if (!summary[key]) load(key).then(render); else render();
      }
    });

    if (mode === 'reschedule') {
      slotsEl.addEventListener('click', function (e) {
        var b = e.target.closest('[data-time]');
        if (!b) return;
        $$('.slot', slotsEl).forEach(function (x) { x.classList.remove('is-selected'); });
        b.classList.add('is-selected');
        root.querySelector('[name="fecha"]').value = selectedDate;
        root.querySelector('[name="hora"]').value = b.dataset.time;
        var submit = root.querySelector('[data-reschedule-submit]');
        if (submit) { submit.disabled = false; submit.textContent = 'Pasar al ' + selectedDate.split('-').reverse().slice(0, 2).join('/') + ' a las ' + b.dataset.time; }
      });
    }
    // Al cambiar la modalidad se regeneran los enlaces de horarios
    $$('[name="modalidad"]', root).forEach(function (el) { el.addEventListener('change', function () { if (selectedDate) showSlots(selectedDate); }); });

    load(today).then(function () {
      render();
      var firstAvailable = selectedDate || Object.keys(summary).sort().filter(function (k) { return summary[k].count > 0; })[0];
      if (firstAvailable) {
        cur = { y: +firstAvailable.slice(0, 4), m: +firstAvailable.slice(5, 7) };
        showSlots(firstAvailable);
      } else {
        slotsEl.innerHTML = '<p class="slots-empty">No hay horarios disponibles en las próximas semanas. Escribile al especialista para coordinar.</p>';
      }
    }).catch(function () { calEl.innerHTML = '<p class="slots-empty">No pudimos cargar la agenda.</p>'; });
  });

  /* ── Cuenta regresiva del plazo de pago ── */
  $$('[data-deadline]').forEach(function (el) {
    var end = new Date(el.dataset.deadline).getTime();
    function tick() {
      var s = Math.max(0, Math.round((end - Date.now()) / 1000));
      el.textContent = Math.floor(s / 60) + ':' + pad(s % 60);
      if (s === 0) { el.closest('[data-deadline-box]') && el.closest('[data-deadline-box]').classList.add('is-expired'); return; }
      setTimeout(tick, 1000);
    }
    tick();
  });

  /* ── Estado del pago tras volver de la pasarela ── */
  $$('[data-payment-poll]').forEach(function (el) {
    var id = el.dataset.paymentPoll;
    var tries = 0;
    function poll() {
      tries++;
      api('/api/pagos/' + id + '/estado').then(function (r) {
        if (r.final) { window.location.href = r.redirect; return; }
        if (tries < 40) setTimeout(poll, 3000);
      }).catch(function () { if (tries < 40) setTimeout(poll, 5000); });
    }
    setTimeout(poll, 1500);
  });

  /* ── Chat ── */
  $$('[data-thread]').forEach(function (thread) {
    var conv = thread.dataset.thread;
    var last = thread.dataset.last || '';
    var form = document.querySelector('[data-composer="' + conv + '"]');
    thread.scrollTop = thread.scrollHeight;

    function append(m) {
      var div = document.createElement('div');
      div.className = 'bubble ' + (m.mine ? 'bubble--me' : 'bubble--them');
      div.innerHTML = esc(m.body) + '<span class="bubble__time">' + esc(m.time) + '</span>';
      thread.appendChild(div);
      last = m.at;
    }
    function poll() {
      if (document.hidden) return setTimeout(poll, 8000);
      api('/api/mensajes/' + conv + (last ? '?desde=' + encodeURIComponent(last) : '')).then(function (r) {
        var atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
        r.messages.forEach(function (m) { if (!m.mine) append(m); else last = m.at; });
        if (r.messages.length && atBottom) thread.scrollTop = thread.scrollHeight;
        setTimeout(poll, 5000);
      }).catch(function () { setTimeout(poll, 15000); });
    }
    setTimeout(poll, 5000);

    if (form) {
      var ta = form.querySelector('textarea');
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 960px)').matches) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.submit(); }
      });
      form.setAttribute('data-no-lock', '');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var body = ta.value.trim();
        if (!body) return;
        ta.value = '';
        api('/api/mensajes/' + conv, { method: 'POST', body: { body: body } }).then(function (r) {
          append({ body: r.message.body, time: r.message.time, at: r.message.at, mine: true });
          thread.scrollTop = thread.scrollHeight;
          if (r.notice) { var n = form.querySelector('[data-notice]'); if (n) { n.textContent = r.notice; n.hidden = false; } }
        }).catch(function (err) { ta.value = body; alert(err.message); });
      });
    }
  });

  /* ── Editor de horarios semanales ── */
  document.addEventListener('click', function (e) {
    var add = e.target.closest('[data-add-range]');
    if (add) {
      var day = add.dataset.addRange;
      var box = document.querySelector('[data-ranges="' + day + '"]');
      var idx = box.querySelectorAll('.sched-range').length;
      var row = document.createElement('div');
      row.className = 'sched-range';
      row.innerHTML = '<input type="time" name="weekly[' + day + '][' + idx + '][start]" value="09:00" aria-label="Desde"><span>a</span><input type="time" name="weekly[' + day + '][' + idx + '][end]" value="13:00" aria-label="Hasta"><button type="button" class="btn btn--text btn--sm" data-remove-range aria-label="Quitar franja">Quitar</button>';
      box.appendChild(row);
    }
    var rm = e.target.closest('[data-remove-range]');
    if (rm) rm.closest('.sched-range').remove();
  });

  /* ── Vista previa de imágenes antes de subir ── */
  $$('input[type="file"][data-preview]').forEach(function (input) {
    input.addEventListener('change', function () {
      var target = document.querySelector(input.dataset.preview);
      if (!target || !input.files[0] || !/^image\//.test(input.files[0].type)) return;
      target.src = URL.createObjectURL(input.files[0]);
      target.hidden = false;
    });
  });

  /* ── Service worker y notificaciones push ── */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
  function urlB64ToUint8Array(base64) {
    var padding = '='.repeat((4 - (base64.length % 4)) % 4);
    var b = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(b);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  $$('[data-push-enable]').forEach(function (btn) {
    var key = (document.querySelector('meta[name="vapid-key"]') || {}).content;
    if (!key || !('PushManager' in window)) { btn.hidden = true; return; }
    btn.addEventListener('click', function () {
      btn.disabled = true;
      Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') throw new Error('Permiso denegado');
        return navigator.serviceWorker.ready;
      }).then(function (reg) {
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
      }).then(function (sub) {
        return api('/api/push', { method: 'POST', body: sub.toJSON() });
      }).then(function () {
        btn.textContent = 'Notificaciones activadas en este dispositivo';
      }).catch(function () {
        btn.disabled = false;
        alert('No se pudieron activar las notificaciones. Revisá los permisos del navegador.');
      });
    });
  });
})();
