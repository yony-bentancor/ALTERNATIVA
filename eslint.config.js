'use strict';
// ESLint (flat config) sin dependencias extra: globals declarados a mano.
const node = {
  require: 'readonly', module: 'writable', exports: 'writable', process: 'readonly', __dirname: 'readonly', __filename: 'readonly',
  Buffer: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', fetch: 'readonly', FormData: 'readonly', Blob: 'readonly', Intl: 'readonly',
};
const browser = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', fetch: 'readonly', FormData: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', alert: 'readonly', atob: 'readonly', Notification: 'readonly', HTMLDialogElement: 'readonly',
  Uint8Array: 'readonly', Promise: 'readonly', self: 'readonly', clients: 'readonly', caches: 'readonly', console: 'readonly',
};

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-redeclare': 'error',
  'no-shadow-restricted-names': 'error',
  'no-self-assign': 'error',
  'no-unsafe-finally': 'error',
  'no-const-assign': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'eqeqeq': ['error', 'smart'],
  'no-var': 'off',
};

module.exports = [
  { files: ['src/**/*.js', 'scripts/**/*.js', 'test/**/*.js', 'eslint.config.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: node }, rules },
  { files: ['public/js/**/*.js', 'public/sw.js'], languageOptions: { ecmaVersion: 2020, sourceType: 'script', globals: browser }, rules },
];
