'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../app/static/community-spatial.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../app/static/community-feed.css'), 'utf8');
const restBlock = css.match(/\.posts\[data-feed-list\]>\.post:nth-child\(n\)\s*\{([^}]+)\}/)[1];
const fineBlock = css.match(/@media\(hover:hover\) and \(pointer:fine\)\s*\{([^}]+)\}/)[1];
const cssValue = (text, name) => text.match(new RegExp(`${name}:([^;]+);`))?.[1].trim();

function fixture({ mode = 'list', fine = true, reduced = false, optIn = true, detail = false, intersection = false } = {}) {
  const state = { frames: new Map(), time: 0, sequence: 0, spatial: [], surfaces: [], animations: [], mutations: [], hit: null, scroll: 0, selecting: false };
  class Target {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, callback, options = {}) {
      const callbacks = this.listeners.get(type) || new Set(); callbacks.add(callback); this.listeners.set(type, callbacks);
      options.signal?.addEventListener('abort', () => callbacks.delete(callback), { once: true });
    }
    dispatchEvent(event) { event.target ||= this; for (const callback of [...this.listeners.get(event.type) || []]) callback(event); }
  }
  class Element extends Target {
    constructor(tag, classes = [], data = {}) {
      super(); this.tagName = tag.toUpperCase(); this.nodeType = 1; this.dataset = { ...data }; this.attributes = new Map(); this.children = [];
      this.classes = new Set(classes); this.classList = { contains: value => this.classes.has(value), add: value => this.classes.add(value), remove: value => this.classes.delete(value) };
      const styles = new Map();
      this.style = { setProperty: (name, value) => styles.set(name, String(value)), getPropertyValue: name => styles.get(name) || '', getPropertyPriority: () => '', removeProperty: name => styles.delete(name) };
      this.scrollLeft = this.scrollTop = this.clientLeft = this.clientTop = 0;
      this.offsetWidth = 800; this.offsetHeight = 150; this.offsetTop = 0; this.offsetLeft = 0;
    }
    appendChild(child) { this.children.push(child); child.parentElement = this; child.offsetParent = this; return child; }
    hasAttribute(name) { return name.startsWith('data-') ? this.getAttribute(name) !== null : this.attributes.has(name); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); }
    getAttribute(name) { return name.startsWith('data-') ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? null : this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); if (name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; }
    get isConnected() { return this === document || !!this.parentElement?.isConnected; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selector) {
      return selector.split(',').some(part => {
        part = part.trim();
        if (part === '.post-title>a') return this.tagName === 'A' && this.parentElement?.classes.has('post-title');
        if (part.includes('>')) return false;
        if (part.includes(':not(.posts-detail)') && this.classes.has('posts-detail')) return false;
        part = part.replace(/:not\([^)]*\)/g, '');
        const tag = part.match(/^[a-z][\w-]*/i); if (tag && this.tagName !== tag[0].toUpperCase()) return false;
        for (const match of part.matchAll(/\.([\w-]+)/g)) if (!this.classes.has(match[1])) return false;
        for (const match of part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)) if (!this.hasAttribute(match[1]) || match[2] !== undefined && this.getAttribute(match[1]) !== match[2]) return false;
        return true;
      });
    }
    closest(selector) { for (let node = this; node && node.nodeType === 1; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) {
      if (selector.startsWith(':scope > ')) return this.children.filter(child => child.matches(selector.slice(9)));
      const result = []; const visit = node => { for (const child of node.children) { if (child.matches(selector)) result.push(child); visit(child); } }; visit(this); return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() { return { left: 100, top: 150 - state.scroll, width: this.offsetWidth, height: this.offsetHeight }; }
    animate(keyframes, options) {
      const animation = { keyframes, options, playState: 'running', finished: new Promise(() => {}), cancel() { this.playState = 'idle'; }, pause() { this.playState = 'paused'; }, play() { this.playState = 'running'; } };
      state.animations.push(animation); return animation;
    }
    remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; } }
  }
  const document = new Element('#document'); document.nodeType = 9;
  const html = document.appendChild(new Element('html', [], { feedView: mode, roomMotion: 'running' })); document.documentElement = html;
  const body = html.appendChild(new Element('body')); document.body = body; document.activeElement = body; document.hidden = false;
  const feed = body.appendChild(new Element('div', detail ? ['posts', 'posts-detail'] : ['posts'], optIn ? { feedList: '' } : {}));
  const host = feed.appendChild(new Element('article', ['post'], { depthHost: '', depthKind: detail ? 'reader' : 'edition', depthId: '7' }));
  const scroll = host.appendChild(new Element('div', ['depth-scroll']));
  const arrival = scroll.appendChild(new Element('div', ['depth-arrival']));
  const surface = arrival.appendChild(new Element('div', ['depth-surface']));
  const title = surface.appendChild(new Element('h2', ['post-title'])); const link = title.appendChild(new Element('a'));
  const author = surface.appendChild(new Element('a', ['post-author']));
  document.elementFromPoint = () => state.hit; document.createElement = tag => new Element(tag);
  const window = new Target(); window.getSelection = () => ({ isCollapsed: !state.selecting, rangeCount: state.selecting ? 1 : 0, getRangeAt: () => ({ intersectsNode: node => node === host }) });
  const reduceMedia = new Target(); reduceMedia.matches = reduced;
  const fineMedia = new Target(); fineMedia.matches = fine;
  const observers = [];
  class MutationObserver { constructor(callback) { this.callback = callback; observers.push(this); } observe(target, options) { this.target = target; this.options = options; } disconnect() {} }
  class IntersectionObserver { constructor(callback) { this.callback = callback; } observe(target) { this.callback([{ target, isIntersecting: true }]); } unobserve() {} disconnect() {} }
  if (intersection) window.IntersectionObserver = IntersectionObserver;
  function rest(name) {
    if (html.dataset.feedView === 'list' && optIn && !detail) {
      if (reduceMedia.matches) return '0deg';
      return (fineMedia.matches && cssValue(fineBlock, name)) || cssValue(restBlock, name) || '0deg';
    }
    const index = ['--depth-rest-rx', '--depth-rest-ry', '--depth-rest-rz'].indexOf(name);
    return index >= 0 ? host.style.getPropertyValue(['--depth-pose-rx', '--depth-pose-ry', '--depth-pose-rz'][index]) || '0deg' : '0deg';
  }
  const context = vm.createContext({ window, document, MutationObserver, IntersectionObserver, AbortController, innerHeight: 900, innerWidth: 1200,
    scrollX: 0, get scrollY() { return state.scroll; },
    getComputedStyle: node => ({ getPropertyValue: name => node === host ? rest(name) : node.style.getPropertyValue(name) }),
    matchMedia: query => query.includes('reduced') ? reduceMedia : fineMedia,
    requestAnimationFrame: callback => { const id = ++state.sequence; state.frames.set(id, callback); return id; },
    cancelAnimationFrame: id => state.frames.delete(id),
    setTimeout: callback => { callback(); return 1; }, clearTimeout() {},
    CustomEvent: class { constructor(type, options = {}) { this.type = type; Object.assign(this, options); } }
  });
  window.addEventListener('liss:spatial-frame', event => state.spatial.push(event.detail));
  window.addEventListener('liss:surface-frame', event => state.surfaces.push(event.detail));
  vm.runInContext(source, context, { filename: 'community-spatial.js' });
  function flush(limit = 220) {
    for (let count = 0; state.frames.size && count < limit; count++) { const batch = [...state.frames.values()]; state.frames.clear(); state.time += 16; for (const callback of batch) callback(state.time); }
    assert.equal(state.frames.size, 0, 'the controller reaches rest without an endless RAF loop');
  }
  function step() { const batch = [...state.frames.values()]; state.frames.clear(); state.time += 16; for (const callback of batch) callback(state.time); }
  function move(u, v = .5, target = surface) {
    state.hit = target; const x = 100 + u * 800, y = 150 - state.scroll + v * 150;
    document.dispatchEvent({ type: 'pointermove', pointerType: 'mouse', target, clientX: x, clientY: y, pageX: x, pageY: y + state.scroll }); flush();
  }
  function modeChange(value) { html.dataset.feedView = value; document.dispatchEvent({ type: 'liss:depth-content' }); flush(); }
  function value(name) { return parseFloat(host.style.getPropertyValue(name)) || 0; }
  function finalYaw() { return parseFloat(rest('--depth-rest-ry')) + value('--depth-ry'); }
  flush();
  return { state, window, document, html, host, surface, arrival, link, author, fineMedia, reduceMedia, observers, move, modeChange, flush, step, value, finalYaw, rest };
}
function near(actual, expected, tolerance = .03) { assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`); }
function telemetry(f) {
  const pose = f.state.surfaces.at(-1).poses.find(item => item.host === f.host);
  near(pose.ry, f.finalYaw()); near(pose.rx, parseFloat(f.rest('--depth-rest-rx')) + f.value('--depth-rx') + f.value('--depth-scroll-rx'));
  if (f.state.spatial.at(-1).active) near(f.state.spatial.at(-1).ry, f.finalYaw());
}
const tests = [];
const test = (name, callback) => tests.push([name, callback]);

test('list rests rightward, left title turns square, right hover stays bounded', () => {
  const f = fixture(); near(f.finalYaw(), 9); telemetry(f);
  f.move(.18, .5, f.link); near(f.finalYaw(), 0); assert.equal(f.host.getAttribute('data-depth-hover'), 'false'); telemetry(f);
  f.move(1, .5); near(f.finalYaw(), 14); telemetry(f);
  f.document.dispatchEvent({ type: 'pointerleave' }); f.flush(); near(f.finalYaw(), 9);
});
test('list pointer pitch, translation and lift are stronger while scroll stays restrained', () => {
  const f = fixture(); f.move(1, 1);
  near(f.value('--depth-rx'), -1.4); near(f.value('--depth-x'), 4);
  near(f.value('--depth-y'), 2); near(f.value('--depth-z'), 6);
  assert.ok(Math.abs(f.value('--depth-scroll-rx')) <= .12); assert.ok(Math.abs(f.value('--depth-scroll-y')) <= 1.27);
  assert.ok(Math.abs(f.value('--depth-scroll-z')) <= 1.81); telemetry(f);
});
test('the whole left title band stays square and the stronger yaw saturates without overshoot', () => {
  const f = fixture();
  for (const position of [-.2, 0, .18, .279, .28]) { f.move(position, .5, f.link); near(f.finalYaw(), 0); telemetry(f); }
  let previous = -1;
  for (const position of [.3, .45, .6, .75, .9, .92, 1, 1.2]) {
    f.move(position, .5); const yaw = f.finalYaw();
    assert.ok(yaw >= previous && yaw >= 0 && yaw <= 14.03); previous = yaw; telemetry(f);
  }
  near(f.finalYaw(), 14);
  f.document.dispatchEvent({ type: 'pointermove', pointerType: 'mouse', target: f.link, clientX: 244, clientY: 225, pageX: 244, pageY: 225 });
  for (let frame = 0; f.state.frames.size && frame < 220; frame++) { f.step(); assert.ok(f.finalYaw() >= -.03 && f.finalYaw() <= 14.03); }
  assert.equal(f.state.frames.size, 0);
  near(f.finalYaw(), 0);
});
test('keyboard focus immediately flattens the complete reading plane', () => {
  const f = fixture(); f.move(1, 1); f.document.activeElement = f.link;
  f.document.dispatchEvent({ type: 'focusin', target: f.link }); f.step();
  near(f.finalYaw(), 0); near(f.value('--depth-rx'), 0);
  for (const name of ['--depth-x', '--depth-y', '--depth-z', '--depth-scroll-rx', '--depth-scroll-y', '--depth-scroll-z']) near(f.value(name), 0);
  telemetry(f); f.flush();
  f.document.activeElement = f.document.body; f.document.dispatchEvent({ type: 'focusout', target: f.link }); f.flush(); near(f.finalYaw(), 14);
});
test('pointerdown and other short controls retain pose locks', () => {
  const f = fixture(); f.move(.18, .5, f.link); near(f.finalYaw(), 0);
  f.document.dispatchEvent({ type: 'pointerdown', target: f.link, isPrimary: true, button: 0 }); f.flush();
  f.move(1, 1); near(f.finalYaw(), 0); assert.equal(f.host.getAttribute('data-depth-held'), 'true');
  f.window.dispatchEvent({ type: 'pointercancel' }); f.flush();
  f.move(.9, .2); const locked = f.finalYaw(); f.move(.1, .8, f.author); near(f.finalYaw(), locked);
  assert.equal(f.host.getAttribute('data-depth-hover'), 'true');
});
test('text selection freezes the stronger pose until the selection is released', () => {
  const f = fixture(); f.move(.8, .25); const yaw = f.finalYaw(), x = f.value('--depth-x');
  f.state.selecting = true; f.document.dispatchEvent({ type: 'selectionchange' }); f.flush();
  f.move(.18, 1, f.link); near(f.finalYaw(), yaw); near(f.value('--depth-x'), x);
  assert.equal(f.host.getAttribute('data-depth-selecting'), 'true'); telemetry(f);
  f.state.selecting = false; f.document.dispatchEvent({ type: 'selectionchange' }); f.flush();
  f.move(.18, .5, f.link); near(f.finalYaw(), 0); telemetry(f);
});
test('coarse input keeps a flat reading plane with no pointer or scroll movement', () => {
  const f = fixture({ fine: false }); f.move(1, 1); near(f.finalYaw(), 0);
  for (const name of ['--depth-rx', '--depth-ry', '--depth-x', '--depth-y', '--depth-z', '--depth-scroll-rx', '--depth-scroll-y', '--depth-scroll-z']) near(f.value(name), 0);
  telemetry(f);
});
test('switching fine input to coarse clears old dynamic yaw in the same frame', () => {
  const f = fixture(); f.move(.18, .5, f.link); near(f.finalYaw(), 0);
  f.fineMedia.matches = false; f.fineMedia.dispatchEvent({ type: 'change' }); f.step();
  near(f.finalYaw(), 0); telemetry(f); f.flush();
});
test('reduced motion instantly flattens old tilt and publishes the true pose', () => {
  const f = fixture(); f.move(1, 1); f.reduceMedia.matches = true;
  f.reduceMedia.dispatchEvent({ type: 'change' }); f.step(); near(f.finalYaw(), 0);
  for (const name of ['--depth-rx', '--depth-ry', '--depth-x', '--depth-y', '--depth-z', '--depth-scroll-rx', '--depth-scroll-y', '--depth-scroll-z']) near(f.value(name), 0);
  telemetry(f); f.flush();
});
test('list/card switches remeasure and re-hit-test a stationary title pointer', () => {
  const f = fixture({ mode: 'cards' }); f.move(.18, .5, f.link);
  assert.equal(f.host.getAttribute('data-depth-hover'), 'true');
  f.modeChange('list'); near(f.finalYaw(), 0); assert.equal(f.host.getAttribute('data-depth-hover'), 'false'); telemetry(f);
  f.modeChange('cards'); near(f.value('--depth-ry'), 0); assert.equal(f.host.getAttribute('data-depth-hover'), 'true'); telemetry(f);
});
test('mode switches clear the previous regime even while pointerdown holds it', () => {
  const f = fixture({ mode: 'cards' }); f.move(1, 1);
  assert.ok(f.value('--depth-x') > 10);
  f.document.dispatchEvent({ type: 'pointerdown', target: f.surface, isPrimary: true, button: 0 }); f.flush();
  f.modeChange('list'); assert.equal(f.host.getAttribute('data-depth-held'), 'true');
  near(f.value('--depth-x'), 0); near(f.value('--depth-ry'), 0); near(f.finalYaw(), 9); telemetry(f);
  f.modeChange('cards'); assert.equal(f.host.getAttribute('data-depth-held'), 'true');
  near(f.value('--depth-x'), 0); near(f.value('--depth-ry'), 0); telemetry(f);
});
test('list arrival uses a smaller finite settle while cards retain their entrance', () => {
  const list = fixture({ intersection: true }), card = fixture({ intersection: true, mode: 'cards' });
  assert.equal(list.state.animations[0].keyframes[0].transform, 'translate3d(0,10px,-12px)');
  assert.equal(list.state.animations[0].options.duration, 400);
  assert.equal(card.state.animations[0].keyframes[0].transform, 'translate3d(0,26px,-58px)');
  assert.equal(card.state.animations[0].options.duration, 680);
  list.modeChange('cards'); assert.equal(list.state.animations[0].playState, 'idle');
});
test('paused mode switches publish the new static pose without old transform residue', () => {
  const f = fixture({ mode: 'cards' }); f.move(1, 1); f.html.dataset.roomMotion = 'paused';
  f.window.dispatchEvent({ type: 'liss:motion-state' }); f.flush();
  f.modeChange('list'); near(f.finalYaw(), 9); near(f.value('--depth-x'), 0); telemetry(f);
});
test('card motion, card title locks and unopted-in pages keep their original behavior', () => {
  for (const options of [{ mode: 'cards' }, { mode: 'list', optIn: false }]) {
    const f = fixture(options); f.move(1, 1);
    near(f.value('--depth-ry'), 11.04); near(f.value('--depth-rx'), -5.76); near(f.value('--depth-x'), 16); near(f.value('--depth-z'), 18);
    const yaw = f.finalYaw(); f.move(.15, .5, f.link); near(f.finalYaw(), yaw); telemetry(f);
  }
  const detail = fixture({ detail: true }); detail.move(1, 1); near(detail.value('--depth-ry'), 0); near(detail.value('--depth-x'), 0);
});
test('destroy restores owned variables and removes controller listeners', () => {
  const f = fixture(); f.move(1, 1); f.window.__lissCommunitySpatial.destroy();
  assert.equal(f.host.style.getPropertyValue('--depth-ry'), ''); assert.equal(f.host.getAttribute('data-depth-hover'), null);
  assert.equal(f.state.frames.size, 0);
});

let failures = 0;
for (const [name, callback] of tests) {
  try { callback(); console.log(`ok - ${name}`); }
  catch (error) { failures++; console.error(`not ok - ${name}\n${error.stack}`); }
}
if (failures) process.exitCode = 1;
else console.log(`${tests.length} spatial-list checks passed.`);
