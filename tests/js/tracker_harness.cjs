// Runs app/static/liss-analytics.js in a minimal fake browser and prints what it stored and sent.
// Input (argv[2], JSON): {search, dataset, cookies: {name: value}, storage: {key: value} | null}
// Output (stdout, JSON): {storage, cookies, beacons: [parsed bodies]}
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const input = JSON.parse(process.argv[2] || '{}');
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'static', 'liss-analytics.js'), 'utf8');

const jar = Object.assign({}, input.cookies || {});
const storageData = input.storage === null ? null : Object.assign({}, input.storage || {});
const localStorage = storageData === null ? undefined : {
  getItem: key => (key in storageData ? storageData[key] : null),
  setItem: (key, value) => { storageData[key] = String(value); },
  removeItem: key => { delete storageData[key]; },
};
const document = {
  currentScript: { dataset: input.dataset || { site: 'works' }, src: 'https://liss.pythonanywhere.com/static/liss-analytics.js' },
  visibilityState: 'visible', title: 'Test', referrer: '',
  documentElement: { scrollHeight: 1000, scrollTop: 0 }, body: { scrollHeight: 1000 },
  addEventListener() {}, createElement() { return { getContext() { return null; } }; },
  get cookie() { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); },
  set cookie(text) {
    const [pair, ...attributes] = text.split(';').map(part => part.trim());
    const [name, value] = pair.split('=');
    const maxAge = attributes.find(a => a.toLowerCase().startsWith('max-age='));
    if (maxAge && Number(maxAge.split('=')[1]) <= 0) delete jar[name]; else jar[name] = value;
  },
};
const beacons = [];
const window = {
  addEventListener() {}, crypto: webcrypto, innerWidth: 1280, innerHeight: 720, scrollY: 0,
  matchMedia: () => ({ matches: false }), outerWidth: 1280, outerHeight: 800,
};
const sandbox = {
  window, document, localStorage, console,
  navigator: { userAgent: 'Mozilla/5.0', language: 'zh-CN', languages: ['zh-CN'],
               sendBeacon: (url, blob) => { beacons.push(blob.text); return true; } },
  location: { search: input.search || '', href: 'https://heroliss.github.io/liss-works/', pathname: '/liss-works/',
              protocol: 'https:', host: 'heroliss.github.io' },
  screen: { width: 2560, height: 1440, colorDepth: 24 },
  performance: { getEntriesByType: () => [] },
  Blob: function (parts) { this.text = parts.join(''); },
  URL, URLSearchParams, Intl, JSON, Math, Date, Object, Array, String, Number, RegExp, Uint8Array,
  setInterval() {}, setTimeout() {},
};
sandbox.window.localStorage = localStorage;
sandbox.window.document = document;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
if (window.LissAnalytics) window.LissAnalytics.flush();
process.stdout.write(JSON.stringify({ storage: storageData, cookies: jar, beacons: beacons.map(b => JSON.parse(b)) }));
