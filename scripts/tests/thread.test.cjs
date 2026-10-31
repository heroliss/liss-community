'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const threadSource = fs.readFileSync(path.join(__dirname, '../../app/static/community-thread.js'), 'utf8');
const threadCss = fs.readFileSync(path.join(__dirname, '../../app/static/community-thread.css'), 'utf8');
const layoutSource = fs.readFileSync(path.join(__dirname, '../../app/static/community-thread-layout.js'), 'utf8');
const draftSource = fs.readFileSync(path.join(__dirname, '../../app/static/writing-drafts.js'), 'utf8');

class BrowserEvent {
  constructor(type, options = {}) { Object.assign(this, { type, bubbles: true, button: 0, defaultPrevented: false }, options); }
  preventDefault() { this.defaultPrevented = true; }
}
function fixture({ reduced = false, paused = false, fine = false, forced = false, drafts = true, jsonCapable = true, initialReply = '', collapseHooks = true, clamped = false, viewport = 1200, footerTop = null, layoutSwitch = false, savedLayout, savedStorage, storageBlocked = false } = {}) {
  const state = { scrollY: 30, scrollX: 0, scrolls: [], animations: [], tasks: [], requests: [], frames: new Map(), timers: new Map(), microtasks: [], storage: new Map(savedStorage || []), sequence: 0, selectedText: '', wrapColumns: 60, textareaMeasurements: 0, layoutEvents: [] };
  if (savedLayout !== undefined) state.storage.set('liss-thread-layout:v1', savedLayout);
  function dataName(name) { return name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
  class Element {
    constructor(tag = 'div', attributes = {}, height = 0) {
      this.tagName = tag.toUpperCase(); this.dataset = {}; this.attributes = {}; this.children = [];
      this.listeners = new Map(); this.height = height; this.style = { setProperty(name, value) { this[name] = String(value); }, removeProperty(name) { delete this[name]; } }; this.classes = new Set(); this._text = ''; this.hidden = false;
      this.classList = { add: (...values) => values.forEach(value => this.classes.add(value)), remove: (...values) => values.forEach(value => this.classes.delete(value)), contains: value => this.classes.has(value), toggle: (value, force) => { const enabled = force === undefined ? !this.classes.has(value) : force; if (enabled) this.classes.add(value); else this.classes.delete(value); return enabled; } };
      for (const [name, value] of Object.entries(attributes)) this.setAttribute(name, value);
    }
    set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classes].join(' '); }
    set textContent(value) { this._text = String(value); this.children.forEach(child => { child.parentElement = null; }); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    setAttribute(name, value) { this.attributes[name] = String(value); if (name.startsWith('data-')) this.dataset[dataName(name)] = String(value); else if (name === 'class') this.className = value; else if (['id', 'name', 'type'].includes(name)) this[name] = String(value); }
    getAttribute(name) { return name.startsWith('data-') ? this.dataset[dataName(name)] ?? null : this.attributes[name] ?? this[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    matches(selector) {
      return selector.split(',').some(part => {
        part = part.trim();
        const tag = part.match(/^[a-z][\w-]*/i); if (tag && this.tagName !== tag[0].toUpperCase()) return false;
        for (const match of part.matchAll(/\.([\w-]+)/g)) if (!this.classes.has(match[1])) return false;
        for (const match of part.matchAll(/\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
          const value = this.getAttribute(match[1]); if (value === null || match[2] !== undefined && value !== match[2]) return false;
        }
        return true;
      });
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) {
      const parts = selector.trim().split(/\s+(?![^[]*\])/), result = [];
      const visit = node => { for (const child of node.children) { if (child.matches(parts.at(-1))) { let ancestor = child.parentElement, index = parts.length - 2; while (ancestor && index >= 0) { if (ancestor.matches(parts[index])) index--; ancestor = ancestor.parentElement; } if (index < 0) result.push(child); } visit(child); } };
      visit(this); return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
    insertBefore(child, sibling) { child.remove(); child.parentElement = this; const index = this.children.indexOf(sibling); this.children.splice(index < 0 ? this.children.length : index, 0, child); return child; }
    prepend(child) { this.insertBefore(child, this.children[0]); }
    insertAdjacentElement(position, child) { assert.equal(position, 'afterend'); const parent = this.parentElement, next = parent.children[parent.children.indexOf(this) + 1]; parent.insertBefore(child, next); }
    remove() { if (this.parentElement) { const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; } }
    addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    dispatchEvent(event) {
      event.target ||= this;
      for (let node = this; node; node = event.bubbles ? node.parentElement : null) for (const callback of [...node.listeners.get(event.type) || []]) {
        const task = callback(event); if (task && typeof task.then === 'function') state.tasks.push(task);
      }
      return !event.defaultPrevented;
    }
    get isConnected() { return this === document || !!this.parentElement?.isConnected; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    get scrollHeight() {
      if (this.tagName !== 'TEXTAREA') return this.layoutHeight;
      state.textareaMeasurements++;
      return String(this.value || '').split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / state.wrapColumns)), 0) * 24 + 18;
    }
    get layoutHeight() { return this.hidden ? 0 : (this.classes.has('thread-draft-bar') ? 44 : (parseFloat(this.style.height) || this.height)) + this.children.reduce((sum, child) => sum + child.layoutHeight, 0); }
    getBoundingClientRect() {
      clampScroll();
      if (this.hidden || this.parentElement && this.parentElement.getBoundingClientRect().hidden) return { top: 0, bottom: 0, left: 0, height: 0, hidden: true };
      let top = 0; for (let node = this; node.parentElement; node = node.parentElement) { top += node.parentElement.height; for (const sibling of node.parentElement.children) { if (sibling === node) break; top += sibling.layoutHeight; } }
      top -= state.scrollY; return { top, bottom: top + this.layoutHeight, left: 60, height: this.layoutHeight, width: 500 };
    }
    focus(options) { document.activeElement = this; state.focus = { node: this, options }; }
    scrollIntoView(options) { state.scrolls.push({ type: 'into', node: this, ...options }); }
    animate(keyframes, options) { const entry = { node: this, keyframes, options, canceled: false, cancel() { this.canceled = true; } }; state.animations.push(entry); return entry; }
    getTotalLength() { return 125; }
  }
  const document = new Element('#document'), html = new Element('html'), body = new Element('body');
  document.appendChild(html); html.appendChild(body); document.documentElement = html; document.body = body; html.dataset.roomMotion = paused ? 'paused' : 'running';
  document.createElement = tag => new Element(tag); document.createElementNS = (_ns, tag) => new Element(tag);
  document.getElementById = id => document.querySelectorAll('*').find(node => node.id === id) || null;
  function append(parent, tag, attributes = {}, height = 0) { return parent.appendChild(new Element(tag, attributes, height)); }
  const section = append(body, 'section', { 'data-thread': '', 'data-thread-json': String(jsonCapable), 'data-thread-layout': 'scatter', 'data-post-url': '/post/7' }, 90);
  const layoutControl = layoutSwitch ? append(section, 'div', { 'data-thread-layout-switch': '' }) : null;
  const layoutButtons = layoutControl ? ['scatter', 'list'].map(value => append(layoutControl, 'button', { 'data-thread-layout-value': value, 'aria-pressed': String(value === 'scatter') })) : [];
  if (layoutControl) { layoutControl.hidden = true; section.dataset.threadLayout = 'scatter'; }
  const home = append(section, 'div', { 'data-thread-home': '' });
  const composer = append(home, 'div', { 'data-thread-composer': '' }, 40);
  const composePanel = collapseHooks ? append(composer, 'div', { id: 'reply-compose-panel', 'data-thread-compose-panel': '' }) : composer;
  const heading = append(composePanel, 'strong', { 'data-thread-editor-title': '' }); heading.textContent = initialReply ? '回复 作者' + initialReply : '写下你的回应';
  const cancel = append(composePanel, 'a', { 'data-thread-cancel': '' }); cancel.hidden = !initialReply;
  const quote = append(composePanel, 'blockquote', { 'data-thread-compose-quote': '' }, 30); quote.hidden = !initialReply;
  const form = append(composePanel, 'form', { 'data-writing-owner': '12', 'data-writing-scope': '/post/7#reply:' + (initialReply || 'new'), 'data-writing-method': 'GET' });
  const field = append(form, 'div', { class: 'form-group' });
  const textarea = append(field, 'textarea', { name: 'body' }, 150); textarea.form = form; textarea.value = textarea.defaultValue = '';
  const replyTo = append(form, 'input', { name: 'reply_to', type: 'hidden' }); replyTo.value = initialReply;
  const submit = append(form, 'input', { type: 'submit' }); submit.value = '发送';
  const pending = append(form, 'span', { class: 'form-pending' });
  const feedback = append(composePanel, 'div', { 'data-thread-feedback': '' });
  // Match the real feedback CSS: :empty is absent from layout, and longer
  // messages can add another line rather than remaining a zero-height stub.
  Object.defineProperty(feedback, 'layoutHeight', { get: () => feedback.hidden ? 0 : Math.ceil(feedback.textContent.length / 30) * 21 });
  const feed = append(section, 'ol', { 'data-thread-feed': '' });
  const empty = append(section, 'p', { 'data-thread-empty': '' });
  const count = append(section, 'span', { 'data-thread-count': '' }); count.textContent = '2';
  const returnBar = append(section, 'div', { 'data-thread-return': '' }); returnBar.hidden = true;
  const returnButton = append(returnBar, 'button', { 'data-thread-return-button': '' });
  if (footerTop !== null) {
    state.footerTop = footerTop; returnBar.height = 64;
    const footer = append(body, 'footer', { class: 'reading-footer' }, 160);
    footer.getBoundingClientRect = () => ({ top: state.footerTop });
  }
  function makeComment(id, parent = null, container = feed) {
    const node = new Element('li', { id: 'comment-' + id, 'data-thread-comment': '', 'data-comment-id': String(id), 'data-author-name': '作者' + id });
    if (container) container.appendChild(node);
    const message = append(node, 'div', { class: 'thread-message' }, 15);
    const content = append(message, 'div', { 'data-thread-body': '' }, 50); content.textContent = '评论' + id + '的正文';
    const moment = append(message, 'span', { class: 'flask-moment' }); moment.textContent = 'server moment';
    const reply = append(message, 'a', { 'data-thread-reply': '', href: '/post/7?reply_to=' + id }, 24);
    const slot = append(node, 'div', { 'data-thread-slot': '' });
    let context, panel, locate, close;
    if (parent) {
      context = append(message, 'a', { 'data-thread-context': '', 'data-parent-id': String(parent), 'aria-controls': 'context-' + id, 'aria-expanded': 'false', href: '/comments/' + parent }, 25);
      const label = append(context, 'span', { class: 'thread-context-action' }); label.textContent = '查看原句';
      panel = append(message, 'div', { id: 'context-' + id }, 15); panel.hidden = true;
      const block = append(panel, 'blockquote', {}, 45); block.textContent = '原句全文';
      locate = append(panel, 'a', { 'data-thread-locate': '', 'data-parent-id': String(parent) });
      close = append(panel, 'button', { 'data-thread-context-close': '' });
    }
    return { node, message, content, moment, reply, slot, context, panel, locate, close };
  }
  const first = makeComment(1), second = makeComment(2, 1);
  const reduce = new Element('media-query'); reduce.matches = reduced;
  const finePointer = new Element('media-query'); finePointer.matches = fine;
  const forcedColors = new Element('media-query'); forcedColors.matches = forced;
  const window = new Element('window'); window.matchMedia = query => query.includes('prefers-reduced-motion') ? reduce : query.includes('forced-colors') ? forcedColors : finePointer; window.innerHeight = viewport; window.innerWidth = 1024;
  window.getComputedStyle = () => ({ minHeight: '44px', maxHeight: '176px', borderTopWidth: '1px', borderBottomWidth: '1px' });
  window.getSelection = () => ({ isCollapsed: !state.selectedText, toString: () => state.selectedText });
  function clampScroll() { if (clamped) state.scrollY = Math.max(0, Math.min(state.scrollY, body.layoutHeight - window.innerHeight)); }
  if (clamped) {
    document.scrollingElement = html;
    Object.defineProperties(html, { clientHeight: { get: () => window.innerHeight }, scrollHeight: { get: () => Math.max(window.innerHeight, body.layoutHeight) } });
  }
  Object.defineProperties(window, { scrollX: { get: () => state.scrollX }, scrollY: { get: () => { clampScroll(); return state.scrollY; } } });
  window.scrollBy = options => { state.scrolls.push({ type: 'by', ...options }); state.scrollY += options.top; clampScroll(); };
  window.scrollTo = options => { state.scrolls.push({ type: 'to', ...options }); state.scrollY = options.top; state.scrollX = options.left; clampScroll(); };
  const fetch = (url, options) => new Promise((resolve, reject) => {
    state.requests.push({ url, options, resolve, reject });
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  class FormData {
    constructor(node) { this.values = new Map(node.querySelectorAll('input,textarea').filter(input => input.name && !input.disabled).map(input => [input.name, input.value])); }
    get(name) { return this.values.get(name); }
  }
  class DOMParser { parseFromString(value) { const parsed = makeComment(Number(value.match(/comment-(\d+)/)?.[1] || 0), null, null); state.parsed = parsed; return { querySelector: () => parsed.node }; } }
  const localStorage = {
    getItem(key) { if (storageBlocked) throw new Error('blocked'); return state.storage.get(key) || null; },
    setItem(key, value) { if (storageBlocked) throw new Error('blocked'); state.storage.set(key, value); },
    removeItem(key) { if (storageBlocked) throw new Error('blocked'); state.storage.delete(key); }
  };
  const context = { window, document, console, localStorage, Event: BrowserEvent, CustomEvent: BrowserEvent, FormData, AbortController, DOMParser, fetch,
    Uint8Array, Date, Math, Number, WeakMap, queueMicrotask: fn => state.microtasks.push(fn),
    setTimeout: (fn, delay) => { const id = ++state.sequence; state.timers.set(id, { fn, delay }); return id; }, clearTimeout: id => state.timers.delete(id),
    requestAnimationFrame: fn => { const id = ++state.sequence; state.frames.set(id, fn); return id; }, cancelAnimationFrame: id => state.frames.delete(id) };
  Object.assign(window, { fetch, FormData, AbortController });
  window.addEventListener('liss:thread-layout', event => state.layoutEvents.push(event.detail));
  if (drafts) vm.runInNewContext(draftSource, context, { filename: 'writing-drafts.js' });
  vm.runInNewContext(threadSource, context, { filename: 'community-thread.js' });
  vm.runInNewContext(layoutSource, context, { filename: 'community-thread-layout.js' });
  function flush() { while (state.microtasks.length) state.microtasks.shift()(); for (const [id, task] of [...state.timers]) if (task.delay <= 300) { state.timers.delete(id); task.fn(); } for (const [id, fn] of [...state.frames]) { state.frames.delete(id); fn(); } }
  function emit(node, type, options = {}) { const event = new BrowserEvent(type, options); node.dispatchEvent(event); flush(); return event; }
  function input(value) { textarea.value = value; emit(textarea, 'input'); }
  function outside(node = section, options = {}) { emit(node, 'pointerdown', { isPrimary: true, clientX: 40, clientY: 50, ...options }); return emit(node, 'click', options); }
  async function respond(result, status = 201, contentType = 'application/json') { state.requests.at(-1).resolve({ ok: status >= 200 && status < 300, headers: { get: () => contentType }, json: async () => result }); await Promise.all(state.tasks.splice(0)); flush(); }
  function result(id = 3, receipt) { return { ok: true, id, count: id, comment_html: 'comment-' + id, writing_receipt: receipt }; }
  return { state, window, document, section, layoutControl, layoutButtons, home, composer, composePanel, heading, cancel, quote, form, textarea, replyTo, submit, feedback, feed, count, pending, empty, returnBar, returnButton, first, second, reduce, finePointer, forcedColors, makeComment, emit, input, outside, respond, result, flush,
    draftBar: target => (target ? target.slot : home).querySelector('[data-thread-draft-bar]'),
    openDraft: target => { const bar = (target ? target.slot : home).querySelector('[data-thread-draft-bar]'); assert.ok(bar); return emit(bar.querySelector('[data-thread-draft-open]'), 'click'); },
    receipt: () => window.LissWritingDrafts.prepare(form), record: scope => JSON.parse(state.storage.get('liss-writing-draft:v1:12:' + encodeURIComponent(scope) + ':body') || 'null') };
}

let checks = 0;
async function check(name, callback) { await callback(); console.log(`ok ${++checks} - ${name}`); }
(async () => {
  await check('reply selection saves previous scope and compensates the clicked visual anchor', () => {
    const page = fixture(); page.input('独立评论草稿');
    assert.ok(page.window.LissWritingDrafts); assert.equal(page.section.querySelector('form'), page.form);
    assert.equal(page.section.querySelector('[data-thread-composer]'), page.composer);
    assert.equal(page.second.reply.matches('[data-thread-reply]'), true);
    assert.equal(page.form.querySelector('textarea[name=body]'), page.textarea);
    assert.equal(page.section.querySelector('[data-thread-feed]'), page.feed);
    assert.ok(page.window.fetch && page.window.FormData && page.window.AbortController);
    assert.ok(page.home.querySelector('.thread-continue'), 'enhancement did not initialize');
    assert.ok(page.section.contains(page.second.reply), 'reply detached from section');
    const before = page.second.node.getBoundingClientRect().top;
    const event = page.emit(page.second.reply, 'click');
    assert.equal(event.defaultPrevented, true); assert.equal(page.composer.parentElement, page.second.slot);
    assert.equal(page.replyTo.value, '2'); assert.equal(page.form.dataset.writingScope, '/post/7#reply:2');
    assert.equal(page.record('/post/7#reply:new').body, '独立评论草稿'); assert.equal(page.textarea.value, '');
    assert.equal(page.second.node.getBoundingClientRect().top, before);
    assert.equal(page.state.scrolls.filter(scroll => scroll.type === 'into').length, 0);
    assert.equal(page.state.focus.options.preventScroll, true);
  });
  await check('the open-editor x discards that reply while retaining another independent draft', () => {
    const page = fixture(); page.input('独立原稿'); page.emit(page.second.reply, 'click'); page.input('定向回复原稿');
    const before = page.second.node.getBoundingClientRect().top;
    page.emit(page.cancel, 'click');
    assert.equal(page.composer.hidden, true); assert.equal(page.composer.parentElement, page.second.slot);
    assert.equal(page.draftBar(page.second), null); assert.equal(page.record('/post/7#reply:2'), null);
    assert.match(page.draftBar(null).textContent, /独立原稿/); assert.equal(page.second.node.getBoundingClientRect().top, before);
    page.openDraft(null); assert.equal(page.textarea.value, '独立原稿'); assert.equal(page.replyTo.value, '');
  });
  await check('every written reply keeps its own visible draft bar while another reply opens', () => {
    const page = fixture(); page.emit(page.first.reply, 'click'); page.input('回复第一条');
    page.emit(page.second.reply, 'click');
    assert.match(page.draftBar(page.first).textContent, /回复第一条/);
    page.input('回复第二条'); page.outside();
    assert.match(page.draftBar(page.first).textContent, /回复第一条/);
    assert.match(page.draftBar(page.second).textContent, /回复第二条/);
    assert.equal(page.composer.querySelector('.writing-draft').hidden, true);
    page.openDraft(page.first);
    assert.equal(page.textarea.value, '回复第一条'); assert.equal(page.draftBar(page.first), null);
    assert.match(page.draftBar(page.second).textContent, /回复第二条/);
    page.emit(page.second.reply, 'click');
    assert.equal(page.textarea.value, '回复第二条'); assert.match(page.draftBar(page.first).textContent, /回复第一条/);
    const reloaded = fixture({ savedStorage: page.state.storage });
    assert.match(reloaded.draftBar(reloaded.first).textContent, /回复第一条/);
    assert.match(reloaded.draftBar(reloaded.second).textContent, /回复第二条/);
  });
  await check('the draft close button immediately deletes only its own reply without an undo row', () => {
    const page = fixture(); page.emit(page.first.reply, 'click'); page.input('草稿甲');
    page.emit(page.second.reply, 'click'); page.input('草稿乙'); page.outside();
    assert.equal(page.draftBar(page.first).querySelector('[data-thread-discard-draft]').getAttribute('aria-label'), '删除给 作者1 的回复草稿');
    page.emit(page.draftBar(page.first).querySelector('[data-thread-discard-draft]'), 'click');
    assert.equal(page.draftBar(page.first), null); assert.equal(page.record('/post/7#reply:1'), null);
    assert.match(page.draftBar(page.second).textContent, /草稿乙/);
    page.emit(page.draftBar(page.second).querySelector('[data-thread-discard-draft]'), 'click');
    assert.equal(page.draftBar(page.second), null); assert.equal(page.record('/post/7#reply:2'), null);
    assert.equal(page.textarea.value, ''); assert.equal(page.section.querySelector('.writing-draft').hidden, true);
  });
  await check('whitespace-only replies produce no bar or request and outgoing text is trimmed', async () => {
    const page = fixture(); page.input('  \n\t  '); page.outside();
    assert.equal(page.draftBar(null), null); assert.equal(page.record('/post/7#reply:new'), null);
    assert.equal(page.home.querySelector('.thread-continue').hidden, false);
    page.emit(page.first.reply, 'click'); page.input(' \n \t '); page.emit(page.form, 'submit');
    assert.equal(page.state.requests.length, 0); assert.equal(page.textarea.value, '');
    assert.equal(page.textarea.getAttribute('aria-invalid'), 'true');
    page.outside(); assert.equal(page.draftBar(page.first), null);
    page.emit(page.first.reply, 'click'); page.input(' \n  有内容  \t\n '); page.emit(page.form, 'submit');
    assert.equal(page.state.requests[0].options.body.get('body'), '有内容');
    const receipt = page.receipt(); await page.respond(page.result(3, receipt));
    assert.equal(page.composer.hidden, true); assert.equal(page.draftBar(page.first), null);
  });
  await check('reply bars survive target switches while browser storage is unavailable', () => {
    const page = fixture({ storageBlocked: true }); page.emit(page.first.reply, 'click'); page.input('离线甲');
    page.emit(page.second.reply, 'click'); page.input('离线乙'); page.outside();
    assert.match(page.draftBar(page.first).textContent, /离线甲/);
    assert.match(page.draftBar(page.second).textContent, /离线乙/);
    page.openDraft(page.first); assert.equal(page.textarea.value, '离线甲');
    assert.match(page.draftBar(page.second).textContent, /离线乙/);
  });
  await check('an in-memory draft still warns before leaving when the next reply is empty', () => {
    const page = fixture({ storageBlocked: true }); page.emit(page.first.reply, 'click'); page.input('仅留在内存的回复');
    page.emit(page.second.reply, 'click'); page.outside();
    assert.match(page.draftBar(page.first).textContent, /仅留在内存的回复/);
    assert.equal(page.draftBar(page.second), null);
    assert.equal(page.emit(page.window, 'beforeunload').defaultPrevented, true);
  });
  await check('replying keeps the clicked comment steady even when its new editor opens below the viewport', async () => {
    for (const reduced of [false, true]) {
      const page = fixture({ viewport: 500, reduced }); page.second.content.height = 260;
      const before = page.second.node.getBoundingClientRect().top;
      page.emit(page.second.reply, 'click');
      assert.equal(page.composer.parentElement, page.second.slot); assert.equal(page.replyTo.value, '2');
      assert.equal(page.second.node.getBoundingClientRect().top, before);
      assert.ok(page.textarea.getBoundingClientRect().top > page.window.innerHeight - 40, 'the regression exercises the former automatic-scroll branch');
      assert.equal(page.document.activeElement, page.textarea); assert.equal(page.state.focus.options.preventScroll, true);
      assert.ok(page.state.scrolls.every(scroll => scroll.type === 'by' && scroll.behavior === 'instant'), 'only synchronous layout compensation is allowed');
      page.input('展开后立即发送'); const receipt = page.receipt(); page.emit(page.form, 'submit'); await page.respond(page.result(3, receipt));
      assert.equal(page.composer.hidden, true); assert.equal(page.second.node.getBoundingClientRect().top, before);
      assert.equal(page.state.scrolls.filter(scroll => scroll.type === 'into' || scroll.behavior === 'smooth').length, 0);
    }
  });
  await check('the independent-comment home button uses a visible stable anchor', () => {
    const page = fixture(); page.emit(page.second.reply, 'click'); const resume = page.home.querySelector('.thread-continue');
    const before = page.home.getBoundingClientRect().top; page.emit(resume, 'click');
    assert.equal(page.composer.parentElement, page.home); assert.equal(resume.hidden, true);
    assert.equal(page.home.getBoundingClientRect().top, before); assert.equal(page.form.dataset.writingScope, '/post/7#reply:new');
  });
  await check('pending submissions block duplicate requests and target switches while preserving newer input', async () => {
    const page = fixture(); page.emit(page.second.reply, 'click'); page.input('实际提交的正文');
    const receipt = page.receipt(); page.emit(page.form, 'submit'); page.emit(page.form, 'submit'); page.emit(page.first.reply, 'click');
    assert.equal(page.state.requests.length, 1); assert.equal(page.submit.disabled, true); assert.equal(page.replyTo.value, '2');
    assert.equal(page.state.requests[0].options.body.get('body'), '实际提交的正文');
    assert.equal(page.state.requests[0].options.body.get('reply_to'), '2');
    page.input('提交后继续输入的新正文'); await page.respond(page.result(3, receipt));
    assert.equal(page.textarea.value, '提交后继续输入的新正文'); assert.equal(page.record(receipt.scope).body, page.textarea.value);
    assert.equal(page.composer.hidden, false, 'newer typing keeps the editor available');
    assert.equal(page.feed.children.at(-1).id, 'comment-3'); assert.equal(page.count.textContent, '3');
    assert.equal(page.submit.disabled, false); assert.equal(page.form.getAttribute('aria-busy'), null);
    assert.equal(page.state.scrolls.filter(scroll => scroll.type === 'into').length, 0);
  });
  await check('confirmed unchanged submissions reset exactly that draft and retain chronological comment order', async () => {
    const page = fixture(); page.emit(page.second.reply, 'click'); page.input('回复正文'); const receipt = page.receipt();
    page.emit(page.form, 'submit'); await page.respond(page.result(3, receipt));
    assert.equal(page.textarea.value, ''); assert.equal(page.record(receipt.scope), null); assert.equal(page.empty.isConnected, false);
    assert.equal(page.state.parsed.moment.textContent, '刚刚'); assert.equal(page.state.parsed.node.classList.contains('is-new'), true);
    page.emit(page.home.querySelector('.thread-continue'), 'click'); page.input('原位独立评论'); const next = page.receipt(); page.emit(page.form, 'submit'); await page.respond(page.result(4, next));
    assert.deepEqual(page.feed.children.map(node => node.id), ['comment-1', 'comment-2', 'comment-3', 'comment-4']);
  });
  await check('exact unchanged receipts hide editors and empty draft bars without changing the selected target', async () => {
    for (const inline of [false, true]) {
      const page = fixture({ fine: true });
      if (inline) page.emit(page.second.reply, 'click');
      page.input('这一条已经准备发送'); page.textarea.focus({ preventScroll: true });
      const receipt = page.receipt(), host = page.composer.parentElement, before = inline ? page.second.node.getBoundingClientRect().top : page.first.node.getBoundingClientRect().top;
      page.emit(page.form, 'submit');
      assert.equal(page.composer.hidden, false); assert.equal(page.submit.disabled, true); assert.equal(page.composer.getAttribute('aria-busy'), 'true');
      await page.respond(page.result(3, receipt));
      assert.equal(page.composer.hidden, true); assert.equal(page.draftBar(inline ? page.second : null), null);
      assert.equal(page.composer.classList.contains('is-collapsed'), true);
      assert.equal(page.textarea.value, ''); assert.equal(page.record(receipt.scope), null);
      assert.equal(page.composer.parentElement, host); assert.equal(page.form.dataset.writingScope, receipt.scope); assert.equal(page.replyTo.value, inline ? '2' : '');
      assert.equal(page.submit.disabled, false); assert.equal(page.composer.getAttribute('aria-busy'), null); assert.equal(page.form.getAttribute('aria-busy'), null);
      assert.equal(page.document.activeElement, inline ? page.second.reply : page.home.querySelector('.thread-continue')); assert.equal(page.state.focus.options.preventScroll, true);
      assert.equal((inline ? page.second.node : page.first.node).getBoundingClientRect().top, before);
      assert.equal(page.state.scrolls.filter(scroll => scroll.type === 'into' || scroll.behavior === 'smooth').length, 0);
      page.emit(inline ? page.second.reply : page.home.querySelector('.thread-continue'), 'click'); assert.equal(page.composer.hidden, false); assert.equal(page.textarea.value, '');
      assert.equal(page.form.dataset.writingScope, receipt.scope); assert.equal(page.replyTo.value, inline ? '2' : '');
    }
  });
  await check('successful bottom-clamped collapse preserves a visible reading anchor without automatic navigation', async () => {
    for (const inline of [false, true]) {
      const page = fixture({ clamped: true, viewport: 500 }); page.section.height = 900;
      if (inline) page.emit(page.second.reply, 'click');
      page.input('长'.repeat(360));
      for (let id = 3; id <= 7; id++) page.makeComment(id);
      page.window.scrollTo({ top: page.document.documentElement.scrollHeight - page.window.innerHeight, left: 0, behavior: 'instant' });
      const anchor = page.section.querySelectorAll('[data-thread-comment]').find(node => { const bounds = node.getBoundingClientRect(); return bounds.top >= 100 && bounds.top < 470; });
      assert.ok(anchor); const before = anchor.getBoundingClientRect().top, receipt = page.receipt();
      page.state.scrolls = []; page.emit(page.form, 'submit'); await page.respond(page.result(8, receipt));
      assert.equal(page.composer.hidden, true); assert.equal(page.textarea.value, '');
      assert.equal(anchor.getBoundingClientRect().top, before);
      assert.deepEqual(page.feed.children.map(node => node.id), Array.from({ length: 8 }, (_, index) => 'comment-' + (index + 1)));
      assert.equal(page.state.scrolls.filter(scroll => scroll.type === 'into' || scroll.behavior === 'smooth').length, 0);
    }
  });
  await check('editing and restoring the submitted text still keeps the editor open and the later draft intact', async () => {
    const page = fixture(); page.emit(page.second.reply, 'click'); page.input('提交时的原文'); const receipt = page.receipt();
    page.emit(page.form, 'submit'); page.input('正在修改的文字'); page.input('提交时的原文');
    assert.notEqual(page.receipt().token, receipt.token);
    await page.respond(page.result(3, receipt));
    assert.equal(page.composer.hidden, false); assert.equal(page.textarea.value, '提交时的原文');
    assert.equal(page.record(receipt.scope).body, '提交时的原文'); assert.equal(page.submit.disabled, false);
  });
  await check('missing or mismatched receipts never dismiss or acknowledge the active draft', async () => {
    for (const kind of ['missing', 'token', 'owner', 'scope', 'invalid-token']) {
      const page = fixture(); page.emit(page.second.reply, 'click'); page.input('回执不能确认时保留这条草稿'); const receipt = page.receipt();
      let committed = 0; page.document.addEventListener('liss:writing-committed', () => { committed++; });
      const returned = kind === 'missing' ? undefined : { ...receipt };
      if (kind === 'token') returned.token = receipt.token === 'f'.repeat(32) ? 'e'.repeat(32) : 'f'.repeat(32);
      if (kind === 'owner') returned.owner = '99';
      if (kind === 'scope') returned.scope = '/post/7#reply:1';
      if (kind === 'invalid-token') returned.token = 'invalid';
      page.emit(page.form, 'submit'); await page.respond(page.result(3, returned));
      assert.equal(page.composer.hidden, false, kind); assert.equal(page.textarea.value, '回执不能确认时保留这条草稿', kind);
      assert.equal(page.record(receipt.scope).token, receipt.token, kind); assert.equal(committed, 0, kind);
      assert.equal(page.submit.disabled, false); assert.equal(page.feed.children.at(-1).id, 'comment-3');
    }
  });
  await check('legacy path receipts and missing collapse hooks retain safe progressive submission behavior', async () => {
    for (const collapseHooks of [true, false]) {
      const page = fixture({ collapseHooks }); page.input('兼容回执'); const receipt = page.receipt();
      const returned = { owner: receipt.owner, path: receipt.scope, token: receipt.token };
      page.emit(page.form, 'submit'); await page.respond(page.result(3, returned));
      assert.equal(page.textarea.value, ''); assert.equal(page.record(receipt.scope), null); assert.equal(page.submit.disabled, false);
      assert.equal(page.composer.hidden, collapseHooks); assert.equal(page.feedback.classList.contains('is-error'), false);
      assert.equal(page.feed.children.at(-1).id, 'comment-3');
    }
  });
  await check('successive independent and directed submissions stay chronological through automatic collapse and reopening', async () => {
    const page = fixture();
    for (const [id, target] of [[3, null], [4, page.second], [5, page.first], [6, null]]) {
      if (target) page.emit(target.reply, 'click');
      else if (id > 3) page.emit(page.home.querySelector('.thread-continue'), 'click');
      page.input('连续发送的第' + id + '条'); const receipt = page.receipt(); page.emit(page.form, 'submit'); await page.respond(page.result(id, receipt));
      assert.equal(page.composer.hidden, true); assert.equal(page.draftBar(target), null);
      assert.deepEqual(page.feed.children.map(node => node.id), Array.from({ length: id }, (_, index) => 'comment-' + (index + 1)));
    }
    assert.equal(page.state.scrolls.filter(scroll => scroll.type === 'into' || scroll.behavior === 'smooth').length, 0);
  });
  await check('the first pending-feedback line preserves root and inline reading anchors before the response arrives', async () => {
    for (const inline of [false, true]) {
      const page = fixture({ clamped: true, viewport: 500 }); page.section.height = 900;
      if (inline) page.emit(page.first.reply, 'click');
      page.input('发送过程中保持阅读位置');
      page.window.scrollTo({ top: page.document.documentElement.scrollHeight - page.window.innerHeight, left: 0, behavior: 'instant' });
      const anchor = inline ? page.first.node : page.second.node;
      assert.ok(anchor.getBoundingClientRect().bottom > 100); const before = anchor.getBoundingClientRect().top;
      const receipt = page.receipt(); page.state.scrolls = []; page.emit(page.form, 'submit');
      assert.equal(page.feedback.layoutHeight, 21, 'pending feedback actually takes up one line');
      assert.equal(anchor.getBoundingClientRect().top, before, 'the anchor is stable while the request is still pending');
      assert.equal(page.composer.hidden, false); assert.equal(page.submit.disabled, true);
      await page.respond(page.result(3, receipt));
      assert.equal(anchor.getBoundingClientRect().top, before, 'receipt and collapse retain the position from before sending');
      assert.equal(page.composer.hidden, true); assert.equal(page.textarea.value, '');
      assert.equal(page.state.scrolls.filter(scroll => scroll.type === 'into' || scroll.behavior === 'smooth').length, 0);
    }
  });
  await check('longer failure feedback keeps visible comments steady and leaves the draft editor open', async () => {
    for (const kind of ['validation', 'http-rejection', 'unconfirmed']) {
      const page = fixture({ clamped: true, viewport: 500 }); page.section.height = 900; page.input('出错时仍要保持原位的草稿');
      page.window.scrollTo({ top: page.document.documentElement.scrollHeight - page.window.innerHeight, left: 0, behavior: 'instant' });
      const before = page.second.node.getBoundingClientRect().top, receipt = page.receipt(); page.state.scrolls = []; page.emit(page.form, 'submit');
      assert.equal(page.second.node.getBoundingClientRect().top, before); assert.equal(page.feedback.layoutHeight, 21);
      if (kind === 'validation') await page.respond({ ok: false, errors: { body: ['这段内容未通过验证，请修改后重新提交。原有文字已经保留在当前输入区域，不需要再次输入。'] } }, 400);
      else if (kind === 'http-rejection') await page.respond({}, 403, 'text/html');
      else await page.respond({}, 200, 'text/html');
      assert.ok(page.feedback.layoutHeight > 21, kind + ' feedback actually wraps');
      assert.equal(page.second.node.getBoundingClientRect().top, before, kind);
      assert.equal(page.composer.hidden, false); assert.equal(page.textarea.value, '出错时仍要保持原位的草稿');
      assert.equal(page.record(receipt.scope).token, receipt.token); assert.equal(page.submit.disabled, false);
      assert.equal(page.state.scrolls.filter(scroll => scroll.type === 'into' || scroll.behavior === 'smooth').length, 0);
    }
  });
  await check('validation failures retain scope, text and token at the same editor', async () => {
    const page = fixture(); page.emit(page.second.reply, 'click'); page.input('有待提交的正文'); const receipt = page.receipt();
    const before = page.second.node.getBoundingClientRect().top; page.emit(page.form, 'submit');
    await page.respond({ ok: false, errors: { body: ['内容不能为空。'] } }, 400);
    assert.equal(page.textarea.value, '有待提交的正文'); assert.equal(page.receipt().token, receipt.token);
    assert.equal(page.composer.parentElement, page.second.slot); assert.equal(page.second.node.getBoundingClientRect().top, before);
    assert.equal(page.textarea.getAttribute('aria-invalid'), 'true'); assert.equal(page.feedback.classList.contains('is-error'), true);
    assert.match(page.feedback.textContent, /内容不能为空/); assert.equal(page.feed.children.length, 2); assert.equal(page.submit.disabled, false);
    assert.equal(page.composer.hidden, false);
  });
  await check('ambiguous HTML/network replies keep content and invite checking before retrying', async () => {
    const page = fixture(); page.input('网络结果不明确也要保留'); const receipt = page.receipt(); page.emit(page.form, 'submit');
    await page.respond({}, 200, 'text/html');
    assert.equal(page.textarea.value, '网络结果不明确也要保留'); assert.equal(page.record(receipt.scope).token, receipt.token);
    assert.match(page.feedback.textContent, /连接未确认/); assert.equal(page.submit.disabled, false);
    assert.equal(page.composer.hidden, false);
  });
  await check('network timeouts retain text and unlock the same form without another request', async () => {
    const page = fixture(); page.input('超时也不能丢的正文'); const receipt = page.receipt(); page.emit(page.form, 'submit');
    const deadline = [...page.state.timers.values()].find(timer => timer.delay === 25000); assert.ok(deadline); deadline.fn();
    await Promise.all(page.state.tasks.splice(0)); page.flush();
    assert.equal(page.textarea.value, '超时也不能丢的正文'); assert.equal(page.record(receipt.scope).token, receipt.token);
    assert.equal(page.submit.disabled, false); assert.equal(page.state.requests.length, 1); assert.match(page.feedback.textContent, /连接未确认/);
    assert.equal(page.composer.hidden, false);
  });
  await check('unconfirmed comment fragments never acknowledge or erase the pending draft', async () => {
    const page = fixture(); page.input('必须确认插入结果'); const receipt = page.receipt(); page.emit(page.form, 'submit');
    await page.respond({ ...page.result(3, receipt), comment_html: 'comment-999' });
    assert.equal(page.textarea.value, '必须确认插入结果'); assert.equal(page.record(receipt.scope).token, receipt.token);
    assert.equal(page.feed.children.length, 2); assert.match(page.feedback.textContent, /连接未确认/);
    assert.equal(page.composer.hidden, false);
  });
  await check('context opens locally on first click and locates explicitly on second with return position', () => {
    const page = fixture(); const beforeY = page.state.scrollY, context = page.second.context;
    const firstClick = page.emit(context, 'click'); assert.equal(firstClick.defaultPrevented, true);
    assert.equal(page.second.panel.hidden, false); assert.equal(context.getAttribute('aria-expanded'), 'true');
    assert.equal(page.state.scrolls.filter(scroll => scroll.type === 'into').length, 0);
    assert.equal(page.state.scrollY, beforeY); assert.equal(page.document.querySelectorAll('.thread-relation-line').length, 1);
    const secondClick = page.emit(context, 'click'); assert.equal(secondClick.defaultPrevented, true);
    assert.equal(page.second.panel.hidden, true); assert.equal(page.returnBar.hidden, false);
    assert.equal(page.state.scrolls.at(-1).type, 'into'); assert.equal(page.state.scrolls.at(-1).behavior, 'smooth');
    page.state.scrollY = 700; page.emit(page.returnButton, 'click'); assert.equal(page.state.scrollY, beforeY);
    assert.equal(page.returnBar.hidden, true); assert.equal(page.document.activeElement, context);
  });
  await check('a quote sidecar without duplicate controls opens, locates and dismisses through its existing toggle', () => {
    const page = fixture(); page.second.locate.remove(); page.second.close.remove();
    const before = page.second.node.getBoundingClientRect().top;
    page.emit(page.second.context, 'click');
    assert.equal(page.second.panel.hidden, false); assert.equal(page.second.node.classList.contains('is-context-open'), true);
    assert.equal(page.second.node.getBoundingClientRect().top, before); assert.equal(page.state.scrolls.filter(scroll => scroll.type === 'into').length, 0);
    page.emit(page.second.context, 'click');
    assert.equal(page.second.panel.hidden, true); assert.equal(page.second.node.classList.contains('is-context-open'), false);
    assert.equal(page.returnBar.hidden, false); assert.equal(page.state.scrolls.at(-1).type, 'into');
    page.emit(page.returnButton, 'click'); page.emit(page.second.context, 'click'); page.outside();
    assert.equal(page.second.panel.hidden, true); assert.equal(page.second.node.classList.contains('is-context-open'), false);
    assert.equal(page.document.querySelectorAll('.thread-relation-line').length, 0);
    page.emit(page.second.context, 'click'); page.second.panel.querySelector('blockquote').focus({ preventScroll: true });
    page.emit(page.document, 'keydown', { key: 'Escape' });
    assert.equal(page.second.panel.hidden, true); assert.equal(page.document.activeElement, page.second.context);
  });
  await check('only scattered comment cards tilt toward a fine mouse without bringing back the light', () => {
    assert.doesNotMatch(threadSource + threadCss, /has-thread-pointer|--thread-pointer-[xy]/);
    const page = fixture({ fine: true }), bounds = page.first.message.getBoundingClientRect();
    page.first.content.dispatchEvent(new BrowserEvent('pointermove', { pointerType: 'mouse', clientX: bounds.left + bounds.width * .75, clientY: bounds.top + bounds.height * .25 }));
    assert.equal(page.state.frames.size, 1);
    page.flush();
    assert.equal(page.first.message.style['--thread-tilt-x'], '0.75deg');
    assert.equal(page.first.message.style['--thread-tilt-y'], '0.95deg');
    page.emit(page.textarea, 'pointermove', { pointerType: 'mouse', clientX: 400, clientY: 400 });
    assert.equal(page.first.message.style['--thread-tilt-x'], undefined);
    assert.equal(page.composer.style['--thread-tilt-x'], undefined);
    for (const options of [{ fine: false }, { fine: true, reduced: true }, { fine: true, paused: true }, { fine: true, forced: true }]) {
      const disabled = fixture(options), rect = disabled.first.message.getBoundingClientRect();
      disabled.emit(disabled.first.content, 'pointermove', { pointerType: 'mouse', clientX: rect.left + 100, clientY: rect.top + 10 });
      assert.equal(disabled.first.message.style['--thread-tilt-x'], undefined);
    }
    page.emit(page.first.content, 'pointermove', { pointerType: 'mouse', clientX: bounds.left + 100, clientY: bounds.top + 10 });
    page.emit(page.section, 'pointerleave');
    assert.equal(page.first.message.style['--thread-tilt-y'], undefined);
    page.emit(page.first.content, 'pointermove', { pointerType: 'mouse', clientX: bounds.left + 100, clientY: bounds.top + 10 });
    page.emit(page.first.reply, 'click');
    assert.equal(page.first.message.style['--thread-tilt-x'], undefined);
    assert.equal(page.first.node.classList.contains('has-inline-editor'), true);
    const listed = fixture({ fine: true, layoutSwitch: true });
    listed.emit(listed.layoutButtons[1], 'click');
    listed.emit(listed.first.content, 'pointermove', { pointerType: 'mouse', clientX: 300, clientY: 300 });
    assert.equal(listed.first.message.style['--thread-tilt-x'], undefined);
  });
  await check('all scattered comment cards lift by five pixels with a clear linked outline', () => {
    assert.match(threadCss, /\.thread-comment:not\(\.has-inline-editor\)>\.thread-message:hover\s*\{\s*transform:perspective\(800px\) translateY\(-5px\).*scale\(1\.04\)/);
    assert.doesNotMatch(threadCss, /\.thread-comment\[data-thread-long\]:not\(\.has-inline-editor\)>\.thread-message:hover/);
    assert.match(threadCss, /\.thread-comment\.is-linked>\.thread-message\s*\{\s*outline:3px solid var\(--accent\);outline-offset:5px/);
  });
  await check('return control rises above the footer and clears its offset after returning', () => {
    assert.match(threadCss, /\.reading-column:has\(\.thread-return:not\(\[hidden\]\)\)\s*\{\s*z-index:2/);
    const page = fixture({ footerTop: 560, viewport: 720 });
    page.emit(page.second.context, 'click'); page.emit(page.second.context, 'click');
    assert.equal(page.returnBar.hidden, false);
    assert.equal(page.returnBar.style['--thread-return-bottom'], '172px');
    page.state.footerTop = 720; page.emit(page.window, 'scroll');
    assert.equal(page.returnBar.style['--thread-return-bottom'], '22px');
    page.state.footerTop = 100; page.emit(page.window, 'scroll');
    assert.equal(page.returnBar.style['--thread-return-bottom'], '560px');
    page.emit(page.returnButton, 'click');
    assert.equal(page.returnBar.hidden, true);
    assert.equal(page.returnBar.style['--thread-return-bottom'], undefined);
  });
  await check('off-page parent quotes expand locally before a second native navigation', () => {
    const page = fixture(); const remote = page.makeComment(4, 999);
    assert.equal(page.emit(remote.context, 'click').defaultPrevented, true); assert.equal(remote.panel.hidden, false);
    assert.equal(page.state.scrolls.filter(scroll => scroll.type === 'into').length, 0);
    assert.equal(page.emit(remote.context, 'click').defaultPrevented, false);
  });
  await check('closing quote context restores focus and clears line work on page exit', () => {
    const page = fixture(); page.emit(page.second.context, 'click'); page.second.close.focus({ preventScroll: true });
    page.emit(page.document, 'keydown', { key: 'Escape' });
    assert.equal(page.second.panel.hidden, true); assert.equal(page.document.activeElement, page.second.context);
    assert.equal(page.document.querySelectorAll('.thread-relation-line').length, 0);
    page.emit(page.second.context, 'click'); page.emit(page.window, 'scroll'); page.emit(page.window, 'pagehide');
    assert.equal(page.document.querySelectorAll('.thread-relation-line').length, 0); assert.equal(page.state.frames.size, 0);
  });
  await check('reduced and paused motion suppress reveal/path animation and use instant explicit locating', () => {
    for (const options of [{ reduced: true }, { paused: true }]) {
      const page = fixture(options); page.emit(page.first.reply, 'click'); page.emit(page.second.context, 'click');
      assert.equal(page.state.animations.length, 0); page.emit(page.second.context, 'click');
      assert.equal(page.state.scrolls.at(-1).behavior, 'instant');
    }
    const page = fixture(); page.emit(page.second.context, 'click'); const animated = page.state.animations.find(entry => entry.node.tagName === 'PATH');
    assert.ok(animated); page.reduce.matches = true; page.emit(page.reduce, 'change'); assert.equal(animated.canceled, true);
  });
  await check('without draft support the native reply links and form remain authoritative', () => {
    const page = fixture({ drafts: false }); assert.equal(page.emit(page.first.reply, 'click').defaultPrevented, false);
    assert.equal(page.emit(page.form, 'submit').defaultPrevented, false); assert.equal(page.state.requests.length, 0);
  });
  await check('routes without JSON capability retain ordinary native posting even with draft support', () => {
    const page = fixture({ jsonCapable: false }); page.input('旧路由照常提交');
    assert.equal(page.emit(page.first.reply, 'click').defaultPrevented, false);
    assert.equal(page.emit(page.form, 'submit').defaultPrevented, false); assert.equal(page.state.requests.length, 0);
  });
  await check('server-rendered directed reply keeps its target and appends in chronological order', async () => {
    const page = fixture({ initialReply: '2' }); page.input('从定向URL进入的回复'); const receipt = page.receipt();
    page.emit(page.form, 'submit'); assert.equal(page.state.requests[0].options.body.get('reply_to'), '2');
    await page.respond(page.result(3, receipt)); assert.equal(page.feed.children.at(-1).id, 'comment-3'); assert.equal(page.textarea.value, '');
  });
  await check('outside blank collapses an inline editor without changing target, draft token or physical host', () => {
    const page = fixture(); page.input('普通评论草稿'); page.emit(page.second.reply, 'click'); page.input('未发送的定向回复');
    const receipt = page.receipt(), before = page.second.node.getBoundingClientRect().top, beforeY = page.state.scrollY;
    page.textarea.focus({ preventScroll: true }); page.outside();
    assert.equal(page.composer.hidden, true); assert.ok(page.draftBar(page.second));
    assert.equal(page.composer.classList.contains('is-collapsed'), true);
    assert.equal(page.composer.parentElement, page.second.slot); assert.equal(page.replyTo.value, '2');
    assert.equal(page.form.dataset.writingScope, '/post/7#reply:2'); assert.equal(page.textarea.value, '未发送的定向回复');
    assert.equal(page.record(receipt.scope).token, receipt.token); assert.equal(page.document.activeElement, page.draftBar(page.second).querySelector('[data-thread-draft-open]'));
    assert.equal(page.state.focus.options.preventScroll, true); assert.equal(page.second.node.getBoundingClientRect().top, before);
    assert.equal(page.state.scrollY, beforeY); assert.equal(page.state.scrolls.filter(item => item.type === 'into').length, 0);
    page.emit(page.second.reply, 'click');
    assert.equal(page.composer.hidden, false); assert.equal(page.draftBar(page.second), null); assert.equal(page.textarea.value, '未发送的定向回复');
    assert.equal(page.receipt().token, receipt.token); assert.equal(page.replyTo.value, '2');
  });
  await check('the collapsed home opener restores the ordinary draft without moving the page', () => {
    const page = fixture(); page.input('留在初始编辑器的草稿'); const receipt = page.receipt(), before = page.first.node.getBoundingClientRect().top;
    page.outside(); assert.equal(page.composer.hidden, true); assert.equal(page.composer.parentElement, page.home);
    assert.equal(page.first.node.getBoundingClientRect().top, before); const collapsedY = page.state.scrollY;
    assert.match(page.draftBar(null).textContent, /留在初始编辑器的草稿/);
    page.openDraft(null);
    assert.equal(page.composer.hidden, false); assert.equal(page.draftBar(null), null);
    assert.equal(page.form.dataset.writingScope, '/post/7#reply:new'); assert.equal(page.textarea.value, '留在初始编辑器的草稿');
    assert.equal(page.receipt().token, receipt.token); assert.equal(page.state.scrollY, collapsedY);
    assert.equal(page.state.scrolls.filter(item => item.type === 'into' || item.behavior === 'smooth').length, 0);
  });
  await check('a fresh primary outside gesture closes quote and editor together and cancels relation work', () => {
    const page = fixture(); page.emit(page.second.reply, 'click'); page.input('引用和输入并存'); page.emit(page.second.context, 'click');
    assert.equal(page.second.panel.hidden, false); assert.equal(page.document.querySelectorAll('.thread-relation-line').length, 1);
    const line = page.state.animations.find(item => item.node.tagName === 'PATH');
    page.window.dispatchEvent(new BrowserEvent('scroll')); assert.equal(page.state.frames.size, 1);
    const beforeY = page.state.scrollY; page.outside();
    assert.equal(page.composer.hidden, true); assert.equal(page.second.panel.hidden, true);
    assert.equal(page.second.context.getAttribute('aria-expanded'), 'false'); assert.match(page.second.context.textContent, /查看原句/);
    assert.equal(page.document.querySelectorAll('.thread-relation-line').length, 0); assert.equal(page.state.frames.size, 0); assert.equal(line.canceled, true);
    assert.equal(page.first.node.classList.contains('is-linked'), false); assert.equal(page.state.scrollY, beforeY);
    assert.equal(page.record('/post/7#reply:2').body, '引用和输入并存');
  });
  await check('outside collapse preserves a clicked comment below changing content with instant compensation', () => {
    const page = fixture(); page.emit(page.first.reply, 'click'); page.input('第一条下面的回复'); page.emit(page.second.context, 'click');
    const third = page.makeComment(3), before = third.node.getBoundingClientRect().top;
    page.outside(third.message);
    assert.equal(page.composer.hidden, true); assert.equal(page.second.panel.hidden, true);
    assert.equal(third.node.getBoundingClientRect().top, before);
    assert.ok(page.state.scrolls.some(item => item.type === 'by' && item.behavior === 'instant'));
    assert.equal(page.state.scrolls.filter(item => item.type === 'into' || item.behavior === 'smooth').length, 0);
  });
  await check('bottom-clamped dismissal keeps its reading anchor with only temporary minimum scroll runway', () => {
    const page = fixture({ clamped: true, viewport: 500 }); page.section.height = 900;
    page.emit(page.second.reply, 'click'); page.input('长'.repeat(360)); page.emit(page.second.context, 'click');
    page.window.scrollTo({ top: page.document.documentElement.scrollHeight - page.window.innerHeight, left: 0, behavior: 'instant' });
    const beforeY = page.window.scrollY, before = page.second.node.getBoundingClientRect().top;
    const beforeHeight = page.document.documentElement.scrollHeight, editorHeight = page.composer.layoutHeight, receipt = page.receipt();
    page.state.scrolls = []; page.outside(page.document.body);
    const runway = page.section.querySelector('[data-thread-scroll-runway]');
    assert.equal(page.composer.hidden, true); assert.equal(page.second.panel.hidden, true);
    assert.ok(page.composer.layoutHeight < editorHeight, 'the collapsed editor itself is genuinely shorter');
    assert.ok(runway); assert.equal(runway.getAttribute('aria-hidden'), 'true'); assert.equal(runway.parentElement, page.section);
    assert.equal(page.window.scrollY, beforeY); assert.equal(page.second.node.getBoundingClientRect().top, before);
    assert.equal(page.document.documentElement.scrollHeight, beforeHeight, 'only the lost scroll range is restored at the end');
    assert.equal(page.document.documentElement.scrollHeight - page.window.innerHeight, page.window.scrollY);
    assert.equal(page.replyTo.value, '2'); assert.equal(page.receipt().token, receipt.token); assert.equal(page.textarea.value, '长'.repeat(360));
    assert.equal(page.state.scrolls.filter(item => item.type === 'into' || item.behavior === 'smooth').length, 0);
    page.openDraft(page.second);
    assert.equal(page.second.node.getBoundingClientRect().top, before); assert.equal(page.window.scrollY, beforeY);
    const remaining = page.section.querySelector('[data-thread-scroll-runway]');
    assert.ok(remaining); assert.equal(remaining.layoutHeight, 60, 'reopening releases the editor runway, retaining only the still-closed quote range');
    page.emit(page.second.context, 'click'); assert.equal(page.section.querySelector('[data-thread-scroll-runway]'), null);
    page.outside(); const collapseRunway = page.section.querySelector('[data-thread-scroll-runway]'); assert.ok(collapseRunway);
    const upY = page.window.scrollY - collapseRunway.layoutHeight - 40;
    page.window.scrollTo({ top: upY, left: 0, behavior: 'instant' }); page.emit(page.window, 'scroll');
    assert.equal(page.section.querySelector('[data-thread-scroll-runway]'), null); assert.equal(page.window.scrollY, upY);
  });
  await check('bottom-clamped Escape closing a quote preserves the open editor and releases runway safely on page exit', () => {
    const page = fixture({ clamped: true, viewport: 500 }); page.section.height = 900;
    page.emit(page.second.reply, 'click'); page.emit(page.second.context, 'click');
    page.window.scrollTo({ top: page.document.documentElement.scrollHeight - page.window.innerHeight, left: 0, behavior: 'instant' });
    const beforeY = page.window.scrollY, before = page.second.node.getBoundingClientRect().top;
    page.emit(page.document, 'keydown', { key: 'Escape' });
    assert.equal(page.second.panel.hidden, true); assert.equal(page.composer.hidden, false);
    assert.equal(page.window.scrollY, beforeY); assert.equal(page.second.node.getBoundingClientRect().top, before);
    assert.equal(page.section.querySelector('[data-thread-scroll-runway]').layoutHeight, 60);
    page.emit(page.window, 'pagehide', { persisted: true }); assert.ok(page.section.querySelector('[data-thread-scroll-runway]'));
    page.emit(page.window, 'pageshow', { persisted: true }); assert.equal(page.window.scrollY, beforeY);
    page.emit(page.window, 'pagehide', { persisted: false }); assert.equal(page.section.querySelector('[data-thread-scroll-runway]'), null);
  });
  await check('outside and Escape keep a visible comment steady when the root editor has scrolled above the viewport', () => {
    for (const dismiss of ['outside', 'Escape']) {
      const page = fixture({ clamped: true, viewport: 500 }); page.section.height = 900; page.input('长'.repeat(360));
      for (let id = 3; id <= 7; id++) page.makeComment(id);
      page.window.scrollTo({ top: page.document.documentElement.scrollHeight - page.window.innerHeight, left: 0, behavior: 'instant' });
      assert.ok(page.composer.getBoundingClientRect().bottom < 100, 'the ordinary composer is outside the reading region');
      const anchor = page.section.querySelectorAll('[data-thread-comment]').find(node => { const bounds = node.getBoundingClientRect(); return bounds.top >= 100 && bounds.top < 470; });
      assert.ok(anchor); const before = anchor.getBoundingClientRect().top, receipt = page.receipt();
      if (dismiss === 'outside') page.outside(page.document.body); else page.emit(page.document, 'keydown', { key: 'Escape' });
      assert.equal(page.composer.hidden, true); assert.equal(page.composer.parentElement, page.home);
      assert.equal(anchor.getBoundingClientRect().top, before, dismiss + ' preserves the visible comment');
      assert.equal(page.textarea.value, '长'.repeat(360)); assert.equal(page.receipt().token, receipt.token);
      assert.equal(page.state.scrolls.filter(scroll => scroll.type === 'into' || scroll.behavior === 'smooth').length, 0);
    }
  });
  await check('an inline editor keeps its readable host ahead of other visible comments during dismissal', () => {
    const page = fixture({ clamped: true, viewport: 500 }); page.section.height = 900; page.emit(page.second.reply, 'click'); page.input('长'.repeat(360));
    page.window.scrollTo({ top: page.first.node.getBoundingClientRect().top + page.window.scrollY - 120, left: 0, behavior: 'instant' });
    assert.ok(page.first.node.getBoundingClientRect().top >= 100); assert.ok(page.second.node.getBoundingClientRect().top >= 100);
    const before = page.second.node.getBoundingClientRect().top; page.outside(page.document.body);
    assert.equal(page.second.node.getBoundingClientRect().top, before); assert.equal(page.composer.parentElement, page.second.slot);
    assert.equal(page.replyTo.value, '2'); assert.equal(page.composer.hidden, true);
  });
  await check('inputs, quote content, reply controls and unrelated interactive controls cannot trigger outside dismissal', () => {
    const page = fixture(); page.emit(page.second.reply, 'click'); page.emit(page.second.context, 'click');
    for (const target of [page.textarea, page.composer, page.quote, page.second.panel.querySelector('blockquote'), page.submit]) {
      page.emit(target, 'pointerdown', { isPrimary: true, clientX: 10, clientY: 10 });
      // A submit click normally dispatches submit in the browser; it is not an
      // outside gesture even though this fixture does not emulate that default.
      page.emit(target, 'click');
      assert.equal(page.composer.hidden, false); assert.equal(page.second.panel.hidden, false);
    }
    const unrelated = page.document.createElement('button'); page.section.appendChild(unrelated); page.outside(unrelated);
    assert.equal(page.composer.hidden, false); assert.equal(page.second.panel.hidden, false);
    page.outside(page.first.reply); assert.equal(page.composer.hidden, false); assert.equal(page.replyTo.value, '1');
    assert.equal(page.second.panel.hidden, false);
  });
  await check('dragging, selecting text, canceled pointers and mismatched click targets leave surfaces open', () => {
    const page = fixture(); page.emit(page.second.context, 'click');
    page.emit(page.section, 'pointerdown', { isPrimary: true, clientX: 40, clientY: 50 });
    page.emit(page.section, 'pointermove', { clientX: 49, clientY: 50 }); page.emit(page.section, 'click');
    assert.equal(page.composer.hidden, false); assert.equal(page.second.panel.hidden, false);
    page.state.selectedText = ' '; page.outside(); assert.equal(page.composer.hidden, false); assert.equal(page.second.panel.hidden, false);
    page.state.selectedText = ''; page.emit(page.section, 'pointerdown', { isPrimary: true, clientX: 40, clientY: 50 });
    page.state.selectedText = '刚刚划选的正文'; page.emit(page.section, 'click'); assert.equal(page.second.panel.hidden, false);
    page.state.selectedText = ''; page.emit(page.section, 'pointerdown', { isPrimary: true }); page.emit(page.section, 'pointercancel'); page.emit(page.section, 'click');
    assert.equal(page.composer.hidden, false); assert.equal(page.second.panel.hidden, false);
    page.emit(page.section, 'pointerdown', { isPrimary: true }); page.emit(page.first.message, 'click'); assert.equal(page.composer.hidden, false);
    page.emit(page.section, 'click'); assert.equal(page.composer.hidden, false, 'a keyboard/synthetic click without a fresh pointer is not an outside gesture');
    page.outside(page.section, { isPrimary: false }); assert.equal(page.composer.hidden, false);
    page.outside(page.section, { button: 2 }); assert.equal(page.composer.hidden, false);
    page.outside(page.section, { ctrlKey: true }); assert.equal(page.composer.hidden, false);
  });
  await check('Escape dismisses the quote before the editor and retains focus and the selected reply', () => {
    const page = fixture(); page.emit(page.second.reply, 'click'); page.input('Esc以后继续的草稿'); page.emit(page.second.context, 'click');
    page.second.close.focus({ preventScroll: true });
    const first = page.emit(page.document, 'keydown', { key: 'Escape' }); assert.equal(first.defaultPrevented, true);
    assert.equal(page.second.panel.hidden, true); assert.equal(page.composer.hidden, false); assert.equal(page.document.activeElement, page.second.context);
    page.textarea.focus({ preventScroll: true }); const beforeY = page.state.scrollY;
    const second = page.emit(page.document, 'keydown', { key: 'Escape' }); assert.equal(second.defaultPrevented, true);
    assert.equal(page.composer.hidden, true); assert.equal(page.document.activeElement, page.draftBar(page.second).querySelector('[data-thread-draft-open]')); assert.equal(page.state.scrollY, beforeY);
    assert.equal(page.textarea.value, 'Esc以后继续的草稿'); assert.equal(page.replyTo.value, '2');
    assert.equal(page.emit(page.document, 'keydown', { key: 'Escape' }).defaultPrevented, false);
  });
  await check('pending submits ignore outside and Escape dismissal without losing newer typing or quote state', async () => {
    const page = fixture(); page.emit(page.second.reply, 'click'); page.input('提交时的回复'); const receipt = page.receipt();
    page.emit(page.second.context, 'click'); page.emit(page.form, 'submit'); page.input('提交期间的新草稿');
    page.outside(); assert.equal(page.emit(page.document, 'keydown', { key: 'Escape' }).defaultPrevented, false);
    assert.equal(page.composer.hidden, false); assert.equal(page.second.panel.hidden, false); assert.equal(page.replyTo.value, '2');
    assert.equal(page.submit.disabled, true); assert.equal(page.state.requests.length, 1);
    await page.respond(page.result(3, receipt)); assert.equal(page.textarea.value, '提交期间的新草稿');
    page.outside(); assert.equal(page.composer.hidden, true); assert.equal(page.second.panel.hidden, true);
    assert.equal(page.record(receipt.scope).body, '提交期间的新草稿');
  });
  await check('auto-height grows to a bounded scrollable editor and shrinks after switching drafts or committing', async () => {
    const page = fixture(); assert.equal(page.textarea.style.height, '44px'); assert.equal(page.textarea.style.overflowY, 'hidden');
    const beforeY = page.state.scrollY; page.input('一行\n两行\n三行'); assert.equal(page.textarea.style.height, '92px');
    page.input(Array(20).fill('长文的一行').join('\n')); assert.equal(page.textarea.style.height, '176px'); assert.equal(page.textarea.style.overflowY, 'auto');
    assert.equal(page.state.scrollY, beforeY, 'typing preserves the home editor position');
    page.outside(); assert.equal(page.composer.hidden, true); page.openDraft(null); assert.equal(page.textarea.style.height, '176px');
    page.emit(page.second.reply, 'click'); assert.equal(page.textarea.value, ''); assert.equal(page.textarea.style.height, '44px');
    page.input('两行\n回复'); assert.equal(page.textarea.style.height, '68px');
    page.emit(page.cancel, 'click'); page.openDraft(null); assert.equal(page.textarea.style.height, '176px'); assert.equal(page.textarea.style.overflowY, 'auto');
    const visibleAnchor = [page.first.node, page.second.node].find(node => { const bounds = node.getBoundingClientRect(); return bounds.bottom > 100 && bounds.top < page.window.innerHeight - 30; });
    const anchorBefore = visibleAnchor.getBoundingClientRect().top;
    const receipt = page.receipt(); page.emit(page.form, 'submit'); await page.respond(page.result(3, receipt));
    assert.equal(page.textarea.value, ''); assert.equal(page.textarea.style.height, '44px');
    assert.equal(visibleAnchor.getBoundingClientRect().top, anchorBefore, 'receipt preserves the visible comment while the editor shrinks');
    assert.equal(page.state.scrolls.filter(scroll => scroll.type === 'into' || scroll.behavior === 'smooth').length, 0);
  });
  await check('Enter and input-method composition retain native newlines and cannot accidentally dismiss or submit', () => {
    const page = fixture(); page.input('输入法中的正文');
    assert.equal(page.emit(page.textarea, 'keydown', { key: 'Enter' }).defaultPrevented, false);
    page.emit(page.textarea, 'compositionstart'); page.outside();
    assert.equal(page.emit(page.textarea, 'keydown', { key: 'Escape' }).defaultPrevented, false); assert.equal(page.composer.hidden, false);
    page.emit(page.textarea, 'compositionend');
    assert.equal(page.emit(page.textarea, 'keydown', { key: 'Escape', isComposing: true }).defaultPrevented, false);
    assert.equal(page.state.requests.length, 0); assert.equal(page.textarea.value, '输入法中的正文');
    page.outside(); assert.equal(page.composer.hidden, true);
  });
  await check('resizing reflows a long editor in place and defers measurements while it is collapsed', () => {
    const page = fixture(); page.emit(page.second.reply, 'click'); page.input('长'.repeat(180));
    assert.equal(page.textarea.style.height, '92px'); assert.equal(page.textarea.style.overflowY, 'hidden');
    const before = page.second.node.getBoundingClientRect().top;
    page.state.wrapColumns = 20; page.emit(page.window, 'resize');
    assert.equal(page.textarea.style.height, '176px'); assert.equal(page.textarea.style.overflowY, 'auto');
    assert.equal(page.second.node.getBoundingClientRect().top, before);
    page.state.wrapColumns = 90; page.emit(page.window, 'resize');
    assert.equal(page.textarea.style.height, '68px'); assert.equal(page.textarea.style.overflowY, 'hidden');
    assert.equal(page.second.node.getBoundingClientRect().top, before);
    page.outside(); const measured = page.state.textareaMeasurements;
    page.state.wrapColumns = 180; page.emit(page.window, 'resize');
    assert.equal(page.state.textareaMeasurements, measured); assert.equal(page.textarea.style.height, '68px');
    page.openDraft(page.second); assert.equal(page.textarea.style.height, '44px'); assert.equal(page.textarea.style.overflowY, 'hidden');
    assert.equal(page.textarea.value, '长'.repeat(180)); assert.equal(page.replyTo.value, '2');
  });
  await check('directed URLs preserve their original target through dismiss and reopen', () => {
    const page = fixture({ initialReply: '2' }); page.input('服务器预选回复对象的草稿'); const receipt = page.receipt();
    page.outside(); page.openDraft(page.second);
    assert.equal(page.replyTo.value, '2'); assert.equal(page.form.dataset.writingScope, '/post/7#reply:2');
    assert.equal(page.textarea.value, '服务器预选回复对象的草稿'); assert.equal(page.receipt().token, receipt.token);
    assert.equal(page.composer.parentElement, page.second.slot);
  });
  await check('without collapse hooks or JSON enhancement native editor behavior remains available', () => {
    for (const options of [{ collapseHooks: false }, { drafts: false }, { jsonCapable: false }]) {
      const page = fixture(options); page.input('渐进增强缺失时保留正文'); page.outside();
      assert.equal(page.composer.hidden, false); assert.equal(page.textarea.value, '渐进增强缺失时保留正文');
      assert.equal(page.emit(page.document, 'keydown', { key: 'Escape' }).defaultPrevented, false);
    }
  });
  await check('thread layout defaults to scatter, restores its own preference and updates native pressed buttons', () => {
    const key = 'liss-thread-layout:v1', page = fixture({ layoutSwitch: true });
    assert.equal(page.section.dataset.threadLayout, 'scatter'); assert.equal(page.layoutControl.hidden, false);
    assert.equal(page.section.getAttribute('data-thread-layout-ready'), '');
    assert.deepEqual(page.layoutButtons.map(button => button.getAttribute('aria-pressed')), ['true', 'false']);
    page.state.storage.set('liss-feed-view:v1', 'cards'); page.emit(page.layoutButtons[1], 'click');
    assert.equal(page.section.dataset.threadLayout, 'list'); assert.equal(page.state.storage.get(key), 'list');
    assert.equal(page.state.storage.get('liss-feed-view:v1'), 'cards', 'article view and reply layout use independent preferences');
    assert.deepEqual(page.layoutButtons.map(button => button.getAttribute('aria-pressed')), ['false', 'true']);
    assert.equal(page.state.layoutEvents.length, 1); assert.equal(page.state.layoutEvents[0].layout, 'list');
    assert.equal(page.state.layoutEvents[0].previous, 'scatter');
    const restored = fixture({ layoutSwitch: true, savedLayout: page.state.storage.get(key) });
    assert.equal(restored.section.dataset.threadLayout, 'list');
    assert.deepEqual(restored.layoutButtons.map(button => button.getAttribute('aria-pressed')), ['false', 'true']);
    page.emit(page.layoutButtons[0], 'click'); assert.equal(page.section.dataset.threadLayout, 'scatter'); assert.equal(page.state.storage.get(key), 'scatter');
  });
  await check('invalid layout preferences fall back to scatter and blocked storage still permits both choices', () => {
    for (const savedLayout of ['unknown', '<script>', 'LIST', '']) {
      const page = fixture({ layoutSwitch: true, savedLayout }); assert.equal(page.section.dataset.threadLayout, 'scatter');
      assert.deepEqual(page.layoutButtons.map(button => button.getAttribute('aria-pressed')), ['true', 'false']);
    }
    const blocked = fixture({ layoutSwitch: true, storageBlocked: true });
    blocked.emit(blocked.layoutButtons[1], 'click'); assert.equal(blocked.section.dataset.threadLayout, 'list');
    blocked.emit(blocked.window, 'pageshow', { persisted: true }); assert.equal(blocked.section.dataset.threadLayout, 'list');
    blocked.emit(blocked.layoutButtons[0], 'click'); assert.equal(blocked.section.dataset.threadLayout, 'scatter');
    const native = fixture(); assert.equal(native.section.dataset.threadLayout, 'scatter');
    assert.equal(native.section.getAttribute('data-thread-layout-ready'), null); assert.equal(native.state.layoutEvents.length, 0);
  });
  await check('layout switching compensates visible comment geometry instantly without focusing or touching the draft', () => {
    const page = fixture({ layoutSwitch: true, viewport: 500 }); page.section.height = 900;
    Object.defineProperty(page.first.node, 'height', { get: () => page.section.dataset.threadLayout === 'scatter' ? 160 : 0 });
    page.input('切换排版时继续保留的草稿'); const receipt = page.receipt();
    page.window.scrollTo({ top: page.second.node.getBoundingClientRect().top + page.window.scrollY - 140, left: 0, behavior: 'instant' });
    const before = page.second.node.getBoundingClientRect().top, focus = page.document.activeElement;
    const nodes = page.feed.children.slice(); page.state.scrolls = []; page.emit(page.layoutButtons[1], 'click');
    assert.equal(page.second.node.getBoundingClientRect().top, before); assert.equal(page.document.activeElement, focus);
    assert.equal(page.textarea.value, '切换排版时继续保留的草稿'); assert.equal(page.receipt().token, receipt.token);
    assert.deepEqual(page.feed.children, nodes); assert.equal(page.composer.hidden, false);
    assert.ok(page.state.scrolls.some(scroll => scroll.type === 'by' && scroll.top === -160 && scroll.behavior === 'instant'));
    assert.equal(page.state.scrolls.filter(scroll => scroll.type === 'into' || scroll.behavior === 'smooth').length, 0);
    page.emit(page.layoutButtons[0], 'click'); assert.equal(page.second.node.getBoundingClientRect().top, before);
  });
  await check('a shorter layout near the document bottom retains the reading position using only necessary temporary runway', () => {
    const page = fixture({ layoutSwitch: true, clamped: true, viewport: 500 }); page.section.height = 900;
    Object.defineProperty(page.second.node, 'height', { get: () => page.section.dataset.threadLayout === 'scatter' ? 250 : 0 });
    page.window.scrollTo({ top: page.document.documentElement.scrollHeight - page.window.innerHeight, left: 0, behavior: 'instant' });
    const beforeY = page.window.scrollY, before = page.second.node.getBoundingClientRect().top;
    page.state.scrolls = []; page.emit(page.layoutButtons[1], 'click');
    const runway = page.section.querySelector('[data-thread-layout-runway]');
    assert.ok(runway); assert.equal(runway.getAttribute('aria-hidden'), 'true'); assert.equal(runway.layoutHeight, 250);
    assert.equal(page.window.scrollY, beforeY); assert.equal(page.second.node.getBoundingClientRect().top, before);
    page.emit(page.layoutButtons[0], 'click'); assert.equal(page.section.querySelector('[data-thread-layout-runway]'), null);
    assert.equal(page.window.scrollY, beforeY); assert.equal(page.second.node.getBoundingClientRect().top, before);
    page.emit(page.layoutButtons[1], 'click'); const upY = page.window.scrollY - 280;
    page.window.scrollTo({ top: upY, left: 0, behavior: 'instant' }); page.emit(page.window, 'scroll');
    assert.equal(page.section.querySelector('[data-thread-layout-runway]'), null); assert.equal(page.window.scrollY, upY);
    assert.equal(page.state.scrolls.filter(scroll => scroll.type === 'into' || scroll.behavior === 'smooth').length, 0);
  });
  await check('layout events update the open relation without closing the reply editor', () => {
    const page = fixture({ layoutSwitch: true, fine: true }); page.emit(page.second.reply, 'click'); page.input('仍在回复第二条');
    const receipt = page.receipt(); page.emit(page.second.context, 'click');
    const line = page.document.querySelector('.thread-relation-line'), path = line.querySelector('path'), before = path.getAttribute('d');
    Object.defineProperty(page.second.message, 'height', { get: () => page.section.dataset.threadLayout === 'list' ? 65 : 15 });
    page.emit(page.layoutButtons[1], 'click');
    assert.equal(page.document.querySelector('.thread-relation-line'), line); assert.notEqual(path.getAttribute('d'), before);
    assert.equal(page.second.panel.hidden, false); assert.equal(page.composer.hidden, false); assert.equal(page.replyTo.value, '2');
    assert.equal(page.textarea.value, '仍在回复第二条'); assert.equal(page.receipt().token, receipt.token);
  });
  await check('asynchronous new replies inherit the selected layout and preserve the normal successful-send lifecycle', async () => {
    const page = fixture({ layoutSwitch: true }); page.emit(page.layoutButtons[1], 'click');
    page.emit(page.second.reply, 'click'); page.input('整齐排版中的异步回复'); const receipt = page.receipt();
    page.emit(page.form, 'submit'); await page.respond(page.result(3, receipt));
    assert.equal(page.feed.children.at(-1).closest('[data-thread]').dataset.threadLayout, 'list');
    assert.deepEqual(page.feed.children.map(node => node.id), ['comment-1', 'comment-2', 'comment-3']);
    assert.equal(page.composer.hidden, true); assert.equal(page.textarea.value, ''); assert.equal(page.replyTo.value, '2');
    assert.equal(page.record(receipt.scope), null); assert.equal(page.state.storage.get('liss-thread-layout:v1'), 'list');
  });
  await check('cross-tab preference changes and bfcache restore synchronize layout while invalid or foreign clicks are ignored', () => {
    const page = fixture({ layoutSwitch: true }), key = 'liss-thread-layout:v1';
    page.emit(page.layoutButtons[1], 'click', { ctrlKey: true }); assert.equal(page.section.dataset.threadLayout, 'scatter');
    page.layoutButtons[1].dataset.threadLayoutValue = 'unknown'; page.emit(page.layoutButtons[1], 'click');
    assert.equal(page.section.dataset.threadLayout, 'scatter'); page.layoutButtons[1].dataset.threadLayoutValue = 'list';
    const child = page.document.createElement('span'); page.layoutButtons[1].appendChild(child); page.emit(child, 'click');
    assert.equal(page.section.dataset.threadLayout, 'list');
    page.emit(page.window, 'storage', { key: 'unrelated', newValue: 'scatter' }); assert.equal(page.section.dataset.threadLayout, 'list');
    page.emit(page.window, 'storage', { key, newValue: 'scatter' }); assert.equal(page.section.dataset.threadLayout, 'scatter');
    page.emit(page.window, 'storage', { key, newValue: 'unknown' }); assert.equal(page.section.dataset.threadLayout, 'scatter');
    page.state.storage.set(key, 'list'); page.emit(page.window, 'pageshow', { persisted: true }); assert.equal(page.section.dataset.threadLayout, 'list');
    page.emit(page.window, 'storage', { key: null, newValue: null }); assert.equal(page.section.dataset.threadLayout, 'scatter');
    assert.equal(page.state.scrolls.filter(scroll => scroll.type === 'into' || scroll.behavior === 'smooth').length, 0);
  });
  console.log(`thread behavior: ${checks} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
