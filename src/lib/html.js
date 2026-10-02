'use strict';
// Motor de vistas sin dependencias: plantillas literales con escape automático.
// html`<p>${valor}</p>` escapa todo lo interpolado salvo que ya sea SafeHtml.

class SafeHtml {
  constructor(value) { this.value = String(value); }
  toString() { return this.value; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
function escape(value) {
  return String(value).replace(/[&<>"'`]/g, (c) => ESC[c]);
}

function render(value) {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escape(value);
}

function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

const raw = (s) => new SafeHtml(s === null || s === undefined ? '' : s);

// Atributos opcionales: attr('selected', cond) → ' selected'
const attr = (name, cond, value) => {
  if (!cond) return raw('');
  return value === undefined ? raw(` ${name}`) : raw(` ${name}="${escape(value)}"`);
};

const classes = (...list) => list.filter(Boolean).join(' ');

// JSON seguro para incrustar en <script type="application/ld+json">
const jsonScript = (obj) => raw(JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'));

// Texto con saltos de línea → párrafos (escapado)
function paragraphs(text) {
  if (!text) return raw('');
  return raw(String(text).split(/\n{2,}/).map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join(''));
}

// Markdown mínimo y seguro para blog / páginas legales / FAQ:
// # títulos, **negrita**, *cursiva*, [link](url), listas "- ", párrafos.
function markdown(text) {
  if (!text) return raw('');
  const inline = (s) => escape(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]*)\)/g, (m, label, url) => `<a href="${url}"${url.startsWith('http') ? ' rel="noopener" target="_blank"' : ''}>${label}</a>`);
  const blocks = String(text).replace(/\r\n/g, '\n').split(/\n{2,}/);
  return raw(blocks.map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*] /.test(l))) {
      return '<ul>' + lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`).join('') + '</ul>';
    }
    if (lines.every((l) => /^\s*\d+\. /.test(l))) {
      return '<ol>' + lines.map((l) => `<li>${inline(l.replace(/^\s*\d+\. /, ''))}</li>`).join('') + '</ol>';
    }
    const h = block.match(/^(#{1,4}) (.+)$/);
    if (h && lines.length === 1) {
      const level = Math.min(h[1].length + 1, 4);
      return `<h${level}>${inline(h[2])}</h${level}>`;
    }
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('\n'));
}

module.exports = { html, raw, escape, attr, classes, jsonScript, paragraphs, markdown, SafeHtml };
