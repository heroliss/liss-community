'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../app/static/writing.js'), 'utf8');
const draftSource = fs.readFileSync(path.join(__dirname, '../../app/static/writing-drafts.js'), 'utf8');
const receiptSource = fs.readFileSync(path.join(__dirname, '../../app/static/writing-receipt.js'), 'utf8');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.dataset = {}; this.children = [];
    this.listeners = new Map(); this.attributes = {}; this.textContent = ''; this.hidden = false;
    this.classList = { add() {}, remove() {} };
  }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  dispatchEvent(event) { event.target ||= this; for (const fn of [...(this.listeners.get(event.type) || [])]) fn(event); return !event.defaultPrevented; }
  setAttribute(name, value) { this.attributes[name] = value; }
  appendChild(node) { this.children.push(node); return node; }
  insertAdjacentElement(_position, node) { this.sibling = node; }
}
class BrowserEvent {
  constructor(type, options = {}) { this.type = type; this.bubbles = !!options.bubbles; this.defaultPrevented = false; }
  preventDefault() { this.defaultPrevented = true; }
}
function fixture({ owner = '12', scope = '/', body = '', value = body, method = 'GET', storage = new Map(), blocked = false, receipt, article = true, comment = false } = {}) {
  const window = new Element(), document = new Element();
  const form = new Element('form'), field = new Element(), textarea = new Element('textarea'), help = new Element('p');
  const color = Object.assign(new Element('input'), { value: '' }), materials = ['auto', 'glass', 'paper'].map(value => ({ value, checked: value === 'auto' }));
  form.dataset = { writingOwner: owner, writingScope: scope, writingMethod: method };
  form.querySelector = selector => comment ? null : selector === '[name=appearance_color]' ? color : selector.includes(':checked') ? materials.find(r => r.checked) : selector.includes('[value=auto]') ? materials[0] : null;
  form.querySelectorAll = () => comment ? [] : materials;
  textarea.form = form; textarea.name = 'body'; textarea.defaultValue = body; textarea.value = value;
  textarea.closest = () => field; field.querySelector = selector => selector === '.field-help' ? help : null;
  const receiptNode = receipt && Object.assign(new Element(), { dataset: { writingReceiptOwner: receipt.owner, writingReceiptScope: receipt.scope || receipt.path, writingReceiptToken: receipt.token } });
  document.currentScript = receiptNode;
  document.querySelectorAll = selector => selector === '[data-writing-receipt]' ? receiptNode ? [receiptNode] : [] : selector === 'form[data-writing-owner] textarea[name=body]' && (article || comment) ? [textarea] : selector === '.writing-field textarea' && article && !comment ? [textarea] : [];
  document.createElement = tag => new Element(tag);
  const localStorage = {
    getItem(key) { if (blocked) throw new Error('blocked'); return storage.get(key) || null; },
    setItem(key, value) { if (blocked) throw new Error('blocked'); storage.set(key, value); },
    removeItem(key) { if (blocked) throw new Error('blocked'); storage.delete(key); }
  };
  const timers = new Map(), microtasks = []; let timerId = 0;
  const context = { window, document, localStorage, Event: BrowserEvent, Uint8Array, WeakMap, Date, Number, Math, console,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); }, queueMicrotask(fn) { microtasks.push(fn); } };
  vm.runInNewContext(receiptSource, context, { filename: 'writing-receipt.js' });
  if (article || comment) vm.runInNewContext(draftSource, context, { filename: 'writing-drafts.js' });
  if (article && !comment) vm.runInNewContext(source, context, { filename: 'writing.js' });
  function flush() { for (const fn of [...timers.values()]) fn(); timers.clear(); while (microtasks.length) microtasks.shift()(); }
  function input(text) { textarea.value = text; textarea.dispatchEvent(new BrowserEvent('input')); flush(); }
  function event(name) { const e = new BrowserEvent(name); window.dispatchEvent(e); return e; }
  const notice = help.sibling, status = notice?.children[0], restore = notice?.children[1], discard = notice?.children[2];
  return { window, document, form, textarea, color, materials, storage, input, flush, event, status, restore, discard, context,
    record() { return JSON.parse([...storage.values()][0]); }, token() { return form.children.find(el => el.name === '_writing_draft_token').value; } };
}
let checks = 0;
function check(description, callback) { callback(); checks++; console.log(`ok ${checks} - ${description}`); }

check('native textarea is protected without loading EasyMDE', () => {
  const page = fixture(); assert.equal(page.event('beforeunload').defaultPrevented, false);
  page.input('还没有发布的中文草稿'); assert.equal(page.record().body, '还没有发布的中文草稿');
  assert.match(page.token(), /^[0-9a-f]{32}$/); assert.equal(page.event('beforeunload').defaultPrevented, true);
  const next = fixture({ storage: page.storage }); assert.equal(next.textarea.value, '还没有发布的中文草稿');
});
check('account and page boundaries do not restore another draft', () => {
  const page = fixture(); page.input('只属于账号12的首页');
  assert.equal(fixture({ owner: '13', storage: page.storage }).textarea.value, '');
  assert.equal(fixture({ scope: '/edit/9', storage: page.storage }).textarea.value, '');
  assert.equal(fixture({ owner: '', storage: page.storage }).textarea.value, '');
});
check('appearance-only edits are saved and recovered with the article body', () => {
  const page = fixture({ scope: '/edit/9', body: '已经发布的正文' });
  page.color.value = '#80bfa1'; page.materials.forEach(item => { item.checked = item.value === 'paper'; });
  page.form.dispatchEvent(new BrowserEvent('change')); page.flush();
  assert.equal(page.record().color, '#80bfa1'); assert.equal(page.record().material, 'paper');
  assert.equal(page.event('beforeunload').defaultPrevented, true);
  const next = fixture({ scope: '/edit/9', body: '已经发布的正文', storage: page.storage });
  assert.equal(next.textarea.value, '已经发布的正文'); assert.equal(next.color.value, '#80bfa1');
  assert.equal(next.materials.find(item => item.checked).value, 'paper');
});
check('submission preserves the draft until a matching server receipt', () => {
  const page = fixture(); page.input('提交中的内容');
  page.form.dispatchEvent(new BrowserEvent('submit')); page.flush();
  assert.equal(page.storage.size, 1); assert.equal(page.event('beforeunload').defaultPrevented, false);
  const failed = fixture({ method: 'POST', body: '提交中的内容', storage: page.storage });
  assert.equal(failed.textarea.value, '提交中的内容'); assert.equal(failed.storage.size, 1);
  assert.equal(failed.event('beforeunload').defaultPrevented, true);
  fixture({ storage: page.storage, receipt: { owner: '12', path: '/', token: page.token() } });
  assert.equal(page.storage.size, 0);
});
check('a successful receipt cannot erase a newer edit from another tab', () => {
  const page = fixture(); page.input('第一版'); const sent = page.token(); page.input('另一标签页的第二版');
  const result = fixture({ storage: page.storage, receipt: { owner: '12', path: '/', token: sent } });
  assert.equal(result.textarea.value, '另一标签页的第二版');
});
check('a stale tab submit and pagehide cannot replace a newer tab draft', () => {
  const oldTab = fixture({ comment: true, scope: '/post/7#reply:9' }); oldTab.input('即将提交的回复');
  const oldToken = oldTab.token(), newTab = fixture({ comment: true, scope: '/post/7#reply:9', storage: oldTab.storage });
  newTab.input('另一标签页的较新内容'); const newToken = newTab.token();
  oldTab.form.dispatchEvent(new BrowserEvent('submit')); oldTab.flush(); oldTab.event('pagehide');
  assert.equal(newTab.record().body, '另一标签页的较新内容'); assert.equal(oldTab.token(), oldToken);
  fixture({ article: false, storage: newTab.storage, receipt: { owner: '12', scope: '/post/7#reply:9', token: oldToken } });
  assert.equal(newTab.record().token, newToken);
});
check('a receipt clears edit drafts on the destination page without loading the editor', () => {
  const page = fixture({ scope: '/edit/9', body: '原文' }); page.input('保存后的新正文');
  fixture({ article: false, storage: page.storage, receipt: { owner: '12', path: '/edit/9', token: page.token() } });
  assert.equal(page.storage.size, 0);
});
check('a cancelled submit re-enables the unsaved-change guard', () => {
  const page = fixture(); page.input('仍未提交');
  const event = new BrowserEvent('submit'); page.form.addEventListener('submit', e => e.preventDefault());
  page.form.dispatchEvent(event); page.flush(); assert.equal(page.event('beforeunload').defaultPrevented, true);
});
check('server changes and old drafts require an explicit recovery', () => {
  const page = fixture({ scope: '/edit/9', body: '原文' }); page.input('本地修改');
  const conflict = fixture({ scope: '/edit/9', body: '其他地方保存的版本', storage: page.storage });
  assert.equal(conflict.textarea.value, '其他地方保存的版本'); assert.equal(conflict.restore.hidden, false);
  conflict.restore.dispatchEvent(new BrowserEvent('click')); conflict.flush(); assert.equal(conflict.textarea.value, '本地修改');
  const key = [...conflict.storage.keys()][0], old = conflict.record(); old.updated = Date.now() - 31 * 86400000; conflict.storage.set(key, JSON.stringify(old));
  const stale = fixture({ scope: '/edit/9', body: '其他地方保存的版本', storage: page.storage });
  assert.equal(stale.textarea.value, '其他地方保存的版本'); assert.equal(stale.restore.hidden, false);
  stale.restore.dispatchEvent(new BrowserEvent('click')); stale.flush(); assert.equal(stale.textarea.value, '本地修改');
});
check('discard can be undone and reverting to the original removes stale data', () => {
  const page = fixture(); page.input('需要撤销舍弃的内容');
  page.discard.dispatchEvent(new BrowserEvent('click')); page.flush();
  assert.equal(page.textarea.value, ''); assert.equal(page.storage.size, 0); assert.equal(page.event('beforeunload').defaultPrevented, false);
  page.restore.dispatchEvent(new BrowserEvent('click')); page.flush(); assert.equal(page.textarea.value, '需要撤销舍弃的内容');
  page.input(''); assert.equal(page.storage.size, 0); assert.equal(page.event('beforeunload').defaultPrevented, false);
});
check('storage errors retain input and keep the leave-page guard', () => {
  const page = fixture({ blocked: true }); page.input('不能丢的内容');
  assert.equal(page.textarea.value, '不能丢的内容'); assert.match(page.status.textContent, /无法保存/);
  assert.equal(page.event('beforeunload').defaultPrevented, true);
});
check('malformed local data is ignored without disabling later saving', () => {
  const storage = new Map([['liss-writing-draft:v1:12:%2F:body', '{invalid']]);
  const page = fixture({ storage }); page.input('正常新草稿'); assert.equal(page.record().body, '正常新草稿');
});
check('ordinary comments, directed targets and correction forms keep separate drafts', () => {
  const storage = new Map();
  for (const [scope, text] of [['/post/7#reply:new', '普通评论'], ['/post/7#reply:9', '回复甲'],
    ['/post/7#reply:10', '回复乙'], ['/post/8#reply:new', '另一篇文章'], ['/comments/9/edit', '本人评论修改']]) {
    fixture({ comment: true, scope, storage }).input(text);
  }
  assert.equal(storage.size, 5);
  assert.equal(fixture({ comment: true, scope: '/post/7#reply:new', storage }).textarea.value, '普通评论');
  assert.equal(fixture({ comment: true, scope: '/post/7#reply:9', storage }).textarea.value, '回复甲');
  assert.equal(fixture({ comment: true, scope: '/post/7#reply:10', storage }).textarea.value, '回复乙');
  assert.equal(fixture({ comment: true, scope: '/comments/9/edit', storage }).textarea.value, '本人评论修改');
  assert.equal(fixture({ comment: true, scope: '/post/7#reply:9', owner: '13', storage }).textarea.value, '');
});
check('comment drafts need neither appearance fields nor EasyMDE', () => {
  const page = fixture({ comment: true, article: false, scope: '/post/7#reply:new' }); page.input('原生评论输入');
  assert.equal(page.record().body, '原生评论输入'); assert.equal(page.event('beforeunload').defaultPrevented, true);
  const recovered = fixture({ comment: true, article: false, scope: '/post/7#reply:new', storage: page.storage });
  assert.equal(recovered.textarea.value, '原生评论输入');
  recovered.discard.dispatchEvent(new BrowserEvent('click')); recovered.flush(); assert.equal(recovered.textarea.value, '');
  recovered.restore.dispatchEvent(new BrowserEvent('click')); recovered.flush(); assert.equal(recovered.textarea.value, '原生评论输入');
});
check('comment failures keep submitted text and only an exact target receipt clears it', () => {
  const scope = '/post/7#reply:9', page = fixture({ comment: true, article: false, scope }); page.input('待发布回复');
  const failed = fixture({ comment: true, article: false, scope, method: 'POST', body: '待发布回复', storage: page.storage });
  assert.equal(failed.textarea.value, '待发布回复'); assert.equal(failed.event('beforeunload').defaultPrevented, true);
  fixture({ article: false, storage: page.storage, receipt: { owner: '12', scope: '/post/7#reply:10', token: page.token() } });
  assert.equal(page.storage.size, 1);
  fixture({ article: false, storage: page.storage, receipt: { owner: '12', scope, token: page.token() } });
  assert.equal(page.storage.size, 0);
});
check('editor enhancement binds to the same protected textarea state', () => {
  const page = fixture(); let value = '通过编辑器修改', onChange;
  page.window.LissWritingDrafts.bind(page.textarea, { value() { return value; }, codemirror: { on(event, fn) { assert.equal(event, 'change'); onChange = fn; } } });
  onChange(); page.flush(); assert.equal(page.record().body, value); assert.equal(page.event('beforeunload').defaultPrevented, true);
  value = '编辑器中的下一版'; onChange(); page.flush(); assert.equal(page.record().body, value);
});
check('scope switches immediately save and recover each in-page reply target', () => {
  const page = fixture({ comment: true, article: false, scope: '/post/7#reply:new' });
  page.textarea.value = '来不及等防抖的普通评论'; page.textarea.dispatchEvent(new BrowserEvent('input'));
  const api = page.window.LissWritingDrafts;
  assert.equal(api.switchScope(page.form, '/post/7#reply:9'), true); assert.equal(page.textarea.value, '');
  assert.equal(page.form.dataset.writingScope, '/post/7#reply:9'); assert.equal(page.token(), '');
  page.input('回复甲'); api.switchScope(page.form, '/post/7#reply:10'); page.input('回复乙');
  api.switchScope(page.form, '/post/7#reply:new'); assert.equal(page.textarea.value, '来不及等防抖的普通评论');
  api.switchScope(page.form, '/post/7#reply:9'); assert.equal(page.textarea.value, '回复甲');
  const token = page.token(); assert.equal(api.switchScope(page.form, '/post/7#reply:9'), false); assert.equal(page.token(), token);
});
check('AJAX commit clears the exact submitted scope and resets its visible form', () => {
  const page = fixture({ comment: true, article: false, scope: '/post/7#reply:9' }); page.input('已提交回复');
  const receipt = page.window.LissWritingDrafts.prepare(page.form);
  const event = new BrowserEvent('liss:writing-committed'); event.detail = receipt;
  page.document.dispatchEvent(event); page.flush();
  assert.equal(page.storage.size, 0); assert.equal(page.textarea.value, ''); assert.equal(page.token(), '');
  assert.equal(page.event('beforeunload').defaultPrevented, false);
  page.input('继续下一条'); assert.equal(page.record().body, '继续下一条');
});
check('typing while an AJAX submission is pending survives the old acknowledgement', () => {
  const page = fixture({ comment: true, article: false, scope: '/post/7#reply:9' }); page.input('已发出的内容');
  const api = page.window.LissWritingDrafts, receipt = api.prepare(page.form);
  page.textarea.value = '请求期间继续输入'; page.textarea.dispatchEvent(new BrowserEvent('input'));
  api.committed(receipt); page.flush();
  assert.equal(page.textarea.value, '请求期间继续输入'); assert.equal(page.record().body, '请求期间继续输入');
  assert.notEqual(page.token(), receipt.token); assert.equal(page.event('beforeunload').defaultPrevented, true);
});
check('AJAX acknowledgement after switching scope leaves the current target intact', () => {
  const page = fixture({ comment: true, article: false, scope: '/post/7#reply:9' }); page.input('提交给甲');
  const api = page.window.LissWritingDrafts, receipt = api.prepare(page.form);
  api.switchScope(page.form, '/post/7#reply:10'); page.input('正在回复乙'); api.committed(receipt);
  assert.equal(page.storage.size, 1); assert.equal(page.textarea.value, '正在回复乙');
  assert.equal(page.record().body, '正在回复乙');
});
check('AJAX acknowledgement clears unchanged input even when browser storage is blocked', () => {
  const page = fixture({ comment: true, article: false, blocked: true, scope: '/post/7#reply:new' }); page.input('无法本地存储但可提交');
  const api = page.window.LissWritingDrafts, receipt = api.prepare(page.form);
  assert.equal(receipt.token, page.token()); api.committed(receipt);
  assert.equal(page.textarea.value, ''); assert.equal(page.event('beforeunload').defaultPrevented, false);
});
check('AJAX acknowledgement clears the submitting tab while preserving a newer tab version', () => {
  const page = fixture({ comment: true, article: false, scope: '/post/7#reply:new' }); page.input('此页提交');
  const api = page.window.LissWritingDrafts, receipt = api.prepare(page.form);
  const other = fixture({ comment: true, article: false, scope: receipt.scope, storage: page.storage }); other.input('另一标签页仍未发布');
  api.committed(receipt); page.flush();
  assert.equal(page.textarea.value, ''); assert.equal(other.record().body, '另一标签页仍未发布');
  assert.equal(page.event('beforeunload').defaultPrevented, false);
});
console.log(`writing draft behavior: ${checks} checks passed`);
