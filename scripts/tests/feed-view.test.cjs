'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../app/static/community-feed.js'), 'utf8');
const storageKey = 'liss-feed-view:v1';

function fixture({ session = new Map(), local = new Map(), failSession = false, failLocal = false, reduced = false, paused = false, hasFeed = true } = {}) {
  const state = { notifications: [], animations: [], focused: null, writes: [], session, local };
  class Target {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, callback, options = {}) {
      const callbacks = this.listeners.get(type) || new Set();
      callbacks.add(callback); this.listeners.set(type, callbacks);
      options.signal?.addEventListener('abort', () => callbacks.delete(callback), { once: true });
    }
    dispatchEvent(event) {
      event.target ||= this;
      event.preventDefault ||= function () { this.defaultPrevented = true; };
      for (const callback of [...this.listeners.get(event.type) || []]) callback(event);
      return !event.defaultPrevented;
    }
  }
  class Button {
    constructor(value) { this.dataset = { feedViewValue: value }; this.attributes = {}; this.style = { transform: 'owned by depth' }; }
    setAttribute(name, value) { this.attributes[name] = value; }
    closest(selector) { return selector === '[data-feed-view-value]' ? this : null; }
    focus(options) { state.focused = { button: this, options }; }
  }
  class Control extends Target {
    constructor() { super(); this.buttons = [new Button('cards'), new Button('list')]; this.hidden = true; }
    querySelectorAll(selector) { assert.equal(selector, '[data-feed-view-value]'); return this.buttons; }
    contains(node) { return this.buttons.includes(node); }
    click(button = this.buttons[1], nested = false) {
      this.dispatchEvent({ type: 'click', target: nested ? { closest: () => button } : button });
    }
    key(key, index = 0, extras = {}) {
      const event = { type: 'keydown', target: this.buttons[index], key, ...extras };
      this.dispatchEvent(event); return event;
    }
  }
  class Copy {
    constructor(top) { this.top = top; }
    getBoundingClientRect() { return { top: this.top, bottom: this.top + 70 }; }
    animate(keyframes, options) {
      const animation = { keyframes, options, canceled: false, cancel() { this.canceled = true; } };
      state.animations.push(animation); return animation;
    }
  }
  const copies = [-90, 20, 140, 260, 380, 500, 620, 740, 1300].map(top => new Copy(top));
  const posts = copies.map((copy, index) => ({ id: index + 1, copy, depth: { transform: 'spatial-owned' } }));
  const feed = { querySelectorAll(selector) { assert.equal(selector, '.post-copy'); return copies; } };
  const controls = [new Control(), new Control()];
  const html = { dataset: { roomMotion: paused ? 'paused' : 'running' } };
  const document = new Target();
  document.documentElement = html;
  document.querySelectorAll = selector => selector === '[data-feed-list]' ? (hasFeed ? [feed] : []) : selector === '[data-feed-view-control]' ? controls : assert.fail(selector);
  document.addEventListener('liss:depth-content', event => state.notifications.push(event.detail));
  const window = new Target(), media = new Target(); media.matches = reduced;
  const store = (map, blocked, kind) => ({
    getItem(key) { if (blocked) throw new Error('blocked'); return map.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error('blocked'); state.writes.push(kind); map.set(key, value); }
  });
  const context = vm.createContext({ window, document, innerHeight: 900, matchMedia: () => media,
    AbortController, CustomEvent: class { constructor(type, options = {}) { this.type = type; Object.assign(this, options); } },
    sessionStorage: store(session, failSession, 'session'), localStorage: store(local, failLocal, 'local') });
  function run() { vm.runInContext(source, context, { filename: 'community-feed.js' }); }
  run();
  return { state, window, media, html, controls, posts, copies, run };
}
function selection(f, value) {
  assert.equal(f.html.dataset.feedView, value);
  for (const control of f.controls) {
    assert.equal(control.hidden, false);
    for (const button of control.buttons) assert.equal(button.attributes['aria-pressed'], String(button.dataset.feedViewValue === value));
  }
}
const tests = [];
function test(name, callback) { tests.push([name, callback]); }

test('defaults to accessible cards and notifies the existing depth registry', () => {
  const f = fixture(); selection(f, 'cards');
  assert.equal(f.state.notifications.length, 1);
  assert.equal(f.state.notifications[0].source, 'feed-view');
  assert.equal(f.state.animations.length, 0);
});
test('reads global local preference first and falls back to a valid session value', () => {
  selection(fixture({ session: new Map([[storageKey, 'list']]), local: new Map([[storageKey, 'cards']]) }), 'cards');
  selection(fixture({ session: new Map([[storageKey, 'cards']]), local: new Map([[storageKey, 'list']]) }), 'list');
  selection(fixture({ session: new Map([[storageKey, 'list']]), local: new Map([[storageKey, 'unknown']]) }), 'list');
  selection(fixture({ session: new Map([[storageKey, '<script>']]) }), 'cards');
});
test('a fresh feed after detail reads another tab update over the older session preference', () => {
  const session = new Map([[storageKey, 'cards']]), local = new Map([[storageKey, 'cards']]);
  const detail = fixture({ hasFeed: false, session, local });
  assert.equal(detail.window.__lissCommunityFeed, undefined);
  local.set(storageKey, 'list');
  selection(fixture({ session, local }), 'list');
});
test('nested button click persists one shared preference through navigation', () => {
  const f = fixture(); const original = f.posts.slice();
  f.controls[0].click(undefined, true); selection(f, 'list');
  assert.equal(f.state.session.get(storageKey), 'list');
  assert.equal(f.state.local.get(storageKey), 'list');
  assert.deepEqual(f.posts, original);
  assert.ok(f.posts.every(post => post.depth.transform === 'spatial-owned'));
  assert.ok(f.controls.every(control => control.buttons.every(button => button.style.transform === 'owned by depth')));
  selection(fixture({ session: f.state.session, local: f.state.local }), 'list');
});
test('blocked storage still permits switching and either surviving store persists', () => {
  const blocked = fixture({ failSession: true, failLocal: true }); blocked.controls[0].click(); selection(blocked, 'list');
  const localOnly = fixture({ failSession: true }); localOnly.controls[0].click();
  selection(fixture({ failSession: true, local: localOnly.state.local }), 'list');
  const sessionOnly = fixture({ failLocal: true }); sessionOnly.controls[0].click();
  selection(fixture({ failLocal: true, session: sessionOnly.state.session }), 'list');
});
test('arrows and Home/End switch and focus without scrolling; native activation survives', () => {
  const f = fixture(), control = f.controls[0];
  assert.equal(control.key('ArrowLeft').defaultPrevented, true); selection(f, 'list');
  assert.equal(f.state.focused.button, control.buttons[1]);
  assert.equal(f.state.focused.options.preventScroll, true);
  control.key('ArrowRight', 1); selection(f, 'cards');
  control.key('End'); selection(f, 'list');
  control.key('Home', 1); selection(f, 'cards');
  control.key('ArrowDown'); selection(f, 'list');
  control.key('ArrowUp', 1); selection(f, 'cards');
  assert.equal(control.key('Enter').defaultPrevented, undefined);
  assert.equal(control.key(' ', 1).defaultPrevented, undefined);
  assert.equal(control.key('End', 0, { ctrlKey: true }).defaultPrevented, undefined);
  selection(f, 'cards');
});
test('only visible copies get a bounded user-triggered reveal; hosts retain transform ownership', () => {
  const f = fixture(); f.controls[0].click();
  assert.equal(f.state.animations.length, 6);
  for (const animation of f.state.animations) {
    assert.ok(animation.keyframes.every(frame => !('transform' in frame)));
    assert.equal(animation.options.fill, 'none');
  }
  const animations = f.state.animations.slice(); f.controls[0].click();
  assert.equal(f.state.animations.length, 6);
  assert.ok(animations.every(animation => animation.canceled));
});
test('reduced and paused motion suppress reveal and live changes cancel it', () => {
  for (const options of [{ reduced: true }, { paused: true }]) {
    const f = fixture(options); f.controls[0].click(); selection(f, 'list');
    assert.equal(f.state.animations.length, 0);
  }
  const f = fixture(); f.controls[0].click(); f.media.matches = true;
  f.media.dispatchEvent({ type: 'change' }); assert.ok(f.state.animations.every(animation => animation.canceled));
  f.media.matches = false; f.controls[0].click(f.controls[0].buttons[0]);
  f.html.dataset.roomMotion = 'paused'; f.window.dispatchEvent({ type: 'liss:motion-state' });
  assert.ok(f.state.animations.every(animation => animation.canceled));
});
test('storage events synchronize controls and clear safely without animations', () => {
  const f = fixture();
  f.window.dispatchEvent({ type: 'storage', key: 'unrelated', newValue: 'list' }); selection(f, 'cards');
  f.window.dispatchEvent({ type: 'storage', key: storageKey, newValue: 'list' }); selection(f, 'list');
  assert.equal(f.state.session.get(storageKey), 'list');
  assert.equal(f.state.animations.length, 0);
  f.window.dispatchEvent({ type: 'storage', key: null, newValue: null }); selection(f, 'cards');
});
test('bfcache return rereads preference without entrance and pagehide stops animations', () => {
  const f = fixture(); f.controls[0].click();
  f.window.dispatchEvent({ type: 'pagehide' }); assert.ok(f.state.animations.every(animation => animation.canceled));
  f.state.session.set(storageKey, 'list'); f.state.local.set(storageKey, 'cards');
  const count = f.state.animations.length;
  f.window.dispatchEvent({ type: 'pageshow', persisted: true }); selection(f, 'cards');
  assert.equal(f.state.animations.length, count);
});
test('invalid or foreign controls cannot change the preference', () => {
  const f = fixture(), control = f.controls[0];
  const foreign = { dataset: { feedViewValue: 'list' }, closest() { return this; } };
  control.click(foreign); selection(f, 'cards');
  control.buttons[1].dataset.feedViewValue = 'unknown'; control.click();
  assert.equal(f.html.dataset.feedView, 'cards'); assert.equal(f.state.writes.length, 0);
});
test('detail/search pages without an opted-in list are untouched', () => {
  const f = fixture({ hasFeed: false, session: new Map([[storageKey, 'list']]) });
  assert.equal(f.html.dataset.feedView, undefined);
  assert.equal(f.window.__lissCommunityFeed, undefined);
  assert.equal(f.state.notifications.length, 0);
  assert.ok(f.controls.every(control => control.hidden));
});
test('controller replacement removes old listeners and destroy cancels motion', () => {
  const f = fixture(); f.run();
  const before = f.state.notifications.length;
  f.controls[0].click(); assert.equal(f.state.notifications.length, before + 1);
  assert.equal(f.state.writes.length, 2);
  f.window.__lissCommunityFeed.destroy();
  assert.ok(f.state.animations.every(animation => animation.canceled));
  assert.ok(f.controls.every(control => control.hidden));
  f.controls[0].click(f.controls[0].buttons[0]); assert.equal(f.html.dataset.feedView, 'list');
});

let failures = 0;
for (const [name, callback] of tests) {
  try { callback(); console.log(`ok - ${name}`); }
  catch (error) { failures++; console.error(`not ok - ${name}\n${error.stack}`); }
}
if (failures) process.exitCode = 1;
else console.log(`${tests.length} feed-view checks passed.`);
