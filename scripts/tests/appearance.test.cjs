/* Source-level controller regression checks. No browser or database is used. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const repo = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(repo, 'app/static/community-appearance.js'), 'utf8');
const tokens = ['auto', 'glass', 'frosted', 'ceramic', 'paper', 'metal', 'leather', 'cork', 'slate', 'mirror', 'water'];
const checks = [];
function check(name, condition) { checks.push({name, passed: !!condition}); if (!condition) throw Error(name); }
function emitter(extra = {}) { return Object.assign({events: {}, addEventListener(name, fn) {(this.events[name] ||= []).push(fn);}, fire(name, event = {}) {for (const fn of this.events[name] || []) fn(event);}}, extra); }
function mount(options = {}) {
  const color = {value: options.color || '', defaultValue: options.color || ''};
  const body = emitter({value: options.body || ''}), picker = {}, status = {}, note = {}, reset = emitter(), cancel = emitter();
  const radios = tokens.map(value => ({value, defaultChecked: value === (options.material || 'auto'), _checked: value === (options.material || 'auto'), parentElement: {lastElementChild: {textContent: value}}}));
  for (const radio of radios) Object.defineProperty(radio, 'checked', {get() {return this._checked;}, set(value) {if (value) radios.forEach(other => other._checked = false); this._checked = !!value;}});
  const preview = {dataset: {}, children: {'[data-appearance-title]': {}, '[data-appearance-excerpt]': {}}, querySelector(selector) {return this.children[selector];}};
  const form = emitter({elements: {appearance_color: color}, querySelector(selector) {return selector === '.writing-field textarea' ? body : null;}});
  const root = emitter({dataset: {appearanceNew: options.newForm === false ? 'false' : 'true', appearanceAutoMaterial: options.automatic || 'glass', ...(options.seeded ? {appearanceSeeded: 'true'} : {})}, open: true,
    closest(selector) {return selector === 'form' ? form : null;},
    querySelector(selector) {
      const fixed = {'[data-appearance-picker]': picker, '[data-appearance-preview]': preview, '[data-appearance-status]': status, '.appearance-sample-note': note, '[data-appearance-reset]': reset, '[data-appearance-cancel]': cancel};
      if (selector in fixed) return fixed[selector];
      if (selector === '[name=appearance_material]:checked') return radios.find(radio => radio.checked);
      const matched = selector.match(/^\[name=appearance_material\]\[value=(\w+)\]$/);
      return matched ? radios.find(radio => radio.value === matched[1]) : null;
    },
    querySelectorAll(selector) {return selector === '[name=appearance_material]' ? radios : [];}
  });
  let draws = 0;
  const random = options.random || [0, 0];
  const window = {crypto: {getRandomValues(array) {array[0] = random[draws++ % 2];}}, LissTheme: {normalize(value) {return value === '' ? '' : /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : null;}, tint() {}, preview() {}, restore() {}}};
  const document = emitter({body: {dataset: {}}, querySelectorAll() {return [root];}});
  const context = {window, document, AbortController, Uint32Array, queueMicrotask, Math};
  vm.runInNewContext(source, context);
  return {root, form, color, preview, radios, cancel, reset, status, material() {return radios.find(radio => radio.checked).value;}, get draws() {return draws;}, remount() {vm.runInNewContext(source, context);}};
}

const distribution = {};
for (let index = 0; index < 12; index++) {
  const app = mount({random: [index, index]});
  const token = app.material(); distribution[token] = (distribution[token] || 0) + 1;
  check('random slot ' + index + ' chooses a supported explicit token', tokens.includes(token) && token !== 'auto');
  check('random slot ' + index + ' updates native controls and preview together', app.preview.dataset.material === (token === 'frosted' ? 'glass' : token) && app.preview.dataset.glassFinish === (token === 'frosted' ? 'frosted' : 'clear') && app.radios.find(r => r.checked).defaultChecked && app.color.value === app.color.defaultValue);
  const initial = app.color.value; app.remount();
  check('random slot ' + index + ' is stable after enhancement remount', app.draws === 2 && app.color.value === initial && app.material() === token);
}
check('half of slots select glass finishes equally', distribution.glass === 3 && distribution.frosted === 3);
for (const material of ['ceramic','paper','metal','leather','cork','slate']) check('new defaults include ' + material, distribution[material] === 1);
check('experimental optical materials require an explicit choice', !distribution.mirror && !distribution.water);

for (const material of ['frosted', 'leather', 'cork', 'slate', 'mirror', 'water']) {
  for (const newForm of [true, false]) {
    const app = mount({newForm, material, color: '#7ab8dd'});
    check('saved or POST ' + material + ' retained (' + newForm + ')', app.material() === material && app.color.value === '#7ab8dd' && app.preview.dataset.material === (material === 'frosted' ? 'glass' : material) && app.preview.dataset.glassFinish === (material === 'frosted' ? 'frosted' : 'clear') && app.draws === 0);
    app.color.value = '#a59bd8'; app.radios.find(radio => radio.value === 'glass').checked = true; app.root.fire('input', {target: app.color});
    app.cancel.fire('click');
    check('cancel restores original ' + material + ' controls and preview', app.material() === material && app.color.value === '#7ab8dd' && app.preview.dataset.material === (material === 'frosted' ? 'glass' : material) && app.preview.dataset.glassFinish === (material === 'frosted' ? 'frosted' : 'clear'));
  }
  if (material !== 'frosted') {
    const automatic = mount({newForm: false, automatic: material});
    check('automatic server preview accepts ' + material, automatic.preview.dataset.material === material && automatic.preview.dataset.glassFinish === 'clear' && automatic.material() === 'auto' && automatic.draws === 0);
  }
}
for (const options of [{body: 'restored draft'}, {seeded: true}, {color: '#nothex'}, {newForm: false}]) {
  const app = mount(options);
  check('untouched criteria protect ' + JSON.stringify(options), app.draws === 0 && app.material() === 'auto' && app.color.value === (options.color || ''));
}
check('invalid automatic token safely uses glass', mount({newForm: false, automatic: 'url(evil)'}).preview.dataset.material === 'glass');
const optical = mount({newForm: false, material: 'glass'});
for (const finish of ['frosted','glass','auto','frosted']) {
  optical.radios.find(r => r.value === finish).checked = true;
  optical.root.fire('change');
  check('live finish ' + finish + ' stays on the shared glass model', optical.preview.dataset.material === 'glass');
  check('live finish ' + finish + ' updates optical metadata', optical.preview.dataset.glassFinish === (finish === 'frosted' ? 'frosted' : 'clear'));
}
optical.reset.fire('click');
check('restore default (clear glass) clears frosted optical metadata', optical.material() === 'glass' && optical.preview.dataset.material === 'glass' && optical.preview.dataset.glassFinish === 'clear');
const restoredFrost = mount({body:'A restored draft',material:'frosted'});
check('restored frosted draft does not randomize finish', restoredFrost.material() === 'frosted' && restoredFrost.draws === 0 && restoredFrost.preview.dataset.glassFinish === 'frosted');
const report = {passed: checks.every(item => item.passed), assertions: checks.length, distribution, checks, source_sha256: crypto.createHash('sha256').update(source).digest('hex'), limits: 'VM stubs validate source controller state and random slots. Native rendering and pointer interaction require browser acceptance.'};

console.log(JSON.stringify({passed: report.passed, assertions: report.assertions, distribution, source_sha256: report.source_sha256}));
