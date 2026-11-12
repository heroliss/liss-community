(function () {
  'use strict';
  if (window.LissWritingDrafts) return;
  var draftPrefix = 'liss-writing-draft:v1:';
  var draftAge = 30 * 24 * 60 * 60 * 1000;
  var drafts = new WeakMap();
  var forms = new WeakMap(), controllers = [];
  function draftKey(owner, scope, name) {
    return draftPrefix + [owner, scope, name].map(encodeURIComponent).join(':');
  }
  function readDraft(key) {
    var raw = localStorage.getItem(key);
    if (!raw) return null;
    var saved;
    try { saved = JSON.parse(raw); } catch (error) { return null; }
    return saved && saved.version === 1 && typeof saved.body === 'string' &&
      typeof saved.base === 'string' && typeof saved.token === 'string' &&
      /^[0-9a-f]{32}$/.test(saved.token) && Number.isFinite(saved.updated) ? saved : null;
  }
  function draftToken() {
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes).map(function (value) { return value.toString(16).padStart(2, '0'); }).join('');
  }
  document.querySelectorAll('form[data-writing-owner] textarea[name=body]').forEach(function (textarea) {
    var form = textarea.form, field = textarea.closest('.form-group');
    if (!form || !field || !form.dataset.writingOwner || field.dataset.draftReady) return;
    field.dataset.draftReady = 'true';
    var owner = form.dataset.writingOwner, scope = form.dataset.writingScope;
    var key = draftKey(owner, scope, textarea.name), editor = null, timer = null;
    var initial = textarea.defaultValue, rejected = form.dataset.writingMethod === 'POST';
    var baseline = { body: initial, color: '', material: 'auto' };
    var token = '', savedState = null, pendingRestore = null, submitting = false, guarded = false;
    var volatile = new Map();
    function isThreadScope(value) { return /^\/post\/\d+#reply:/.test(value); }
    var color = form.querySelector('[name=appearance_color]');
    function state() {
      var material = form.querySelector('[name=appearance_material]:checked');
      return { body: editor ? editor.value() : textarea.value, color: color ? color.value : '', material: material ? material.value : 'auto' };
    }
    baseline = state(); baseline.body = initial;
    var notice = document.createElement('div');
    notice.className = 'writing-draft';
    notice.hidden = isThreadScope(scope);
    var status = document.createElement('span');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    notice.appendChild(status);
    var restore = document.createElement('button');
    restore.type = 'button'; restore.className = 'quiet-link writing-draft-action'; restore.textContent = '恢复草稿'; restore.hidden = true;
    notice.appendChild(restore);
    var discard = document.createElement('button');
    discard.type = 'button'; discard.className = 'quiet-link writing-draft-action'; discard.textContent = '舍弃草稿'; discard.hidden = true;
    notice.appendChild(discard);
    var help = field.querySelector('.field-help');
    if (help) help.insertAdjacentElement('afterend', notice); else field.appendChild(notice);
    var inputToken = document.createElement('input');
    inputToken.type = 'hidden'; inputToken.name = '_writing_draft_token'; form.appendChild(inputToken);
    function message(text) {
      if (/^\/post\/\d+#reply:/.test(scope)) text = {
        '正文会自动保存到当前浏览器。': '草稿自动保存在此浏览器',
        '草稿已保存到当前浏览器。': '草稿已保存',
        '已恢复此浏览器的草稿，发布后会自动清除。': '已恢复草稿',
        '已保留此浏览器的草稿，发布后会自动清除。': '草稿已保留',
        '已保存，新的文字仍会自动保存到当前浏览器。': '草稿自动保存在此浏览器',
        '浏览器无法保存草稿，请先复制正文再离开。': '无法保存草稿，请先复制内容',
        '已舍弃本页草稿，离开前仍可撤销。': '草稿已舍弃，可撤销'
      }[text] || text;
      if (status.textContent !== text) status.textContent = text;
    }
    function same(a, b) { return a && b && a.body === b.body && a.color === b.color && a.material === b.material; }
    function dirty() {
      var current = state();
      if (isThreadScope(scope)) return !!current.body.trim();
      return rejected && !!current.body.trim() || current.body !== baseline.body ||
        !!current.body.trim() && (current.color !== baseline.color || current.material !== baseline.material);
    }
    function unsaved() {
      return dirty() || isThreadScope(scope) && Array.from(volatile.values()).some(function (record) { return !!record.body.trim(); });
    }
    function guard(event) {
      save();
      if (!submitting && unsaved()) { event.preventDefault(); event.returnValue = ''; }
    }
    function updateGuard() {
      var active = !submitting && unsaved();
      if (active === guarded) return;
      guarded = active;
      window[active ? 'addEventListener' : 'removeEventListener']('beforeunload', guard);
    }
    function save() {
      clearTimeout(timer); timer = null;
      var current = state();
      if (!dirty()) {
        volatile.delete(scope);
        if (savedState && !pendingRestore) {
          try { var previous = readDraft(key); if (previous && previous.token === token) localStorage.removeItem(key); } catch (error) {}
          token = ''; savedState = null; inputToken.value = ''; discard.hidden = true;
          message('正文会自动保存到当前浏览器。');
        }
        updateGuard(); return;
      }
      var changed = !same(current, savedState);
      if (changed) { token = draftToken(); savedState = current; }
      var record = { version: 1, body: current.body, base: baseline.body, color: current.color,
        material: current.material, token: token, updated: Date.now() };
      volatile.set(scope, record);
      try {
        var latest = readDraft(key);
        // A stale tab may submit or hide without editing again. Do not replace
        // a newer tab's version with the older value just to refresh its time.
        if (!changed && latest && latest.token !== token) {
          inputToken.value = token;
          message('其他标签页已有更新，当前内容仍保留在这里。');
          updateGuard(); return;
        }
        localStorage.setItem(key, JSON.stringify(record));
        volatile.delete(scope);
        savedState = current; pendingRestore = null;
        notice.classList.remove('is-unavailable'); restore.hidden = true; discard.hidden = false;
        message('草稿已保存到当前浏览器。');
      } catch (error) {
        notice.classList.add('is-unavailable');
        message('浏览器无法保存草稿，请先复制正文再离开。');
      }
      inputToken.value = token;
      updateGuard();
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(save, 300); updateGuard(); }
    function write(value) {
      textarea.value = value.body;
      if (editor) editor.value(value.body);
      if (color && typeof value.color === 'string') color.value = value.color;
      form.querySelectorAll('[name=appearance_material]').forEach(function (radio) { radio.checked = radio.value === value.material; });
      if (!form.querySelector('[name=appearance_material]:checked')) {
        var fallback = form.querySelector('[name=appearance_material][value=auto]') || form.querySelector('[name=appearance_material][value=glass]'); if (fallback) fallback.checked = true;
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      if (color) color.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function recover(record) {
      pendingRestore = null; token = record.token;
      write(record); savedState = state(); inputToken.value = token;
      restore.hidden = true; restore.textContent = '恢复草稿'; discard.hidden = false;
      message('已恢复此浏览器的草稿，发布后会自动清除。');
      // Keep a recovered conflict based on the current server version, so the
      // next reload need not ask the same recovery question again.
      save();
    }
    function load() { try {
      var existing = volatile.get(scope) || readDraft(key);
      if (isThreadScope(scope) && existing && !existing.body.trim()) {
        try { var blank = readDraft(key); if (blank && blank.token === existing.token) localStorage.removeItem(key); } catch (error) {}
        volatile.delete(scope); existing = null;
      }
      if (existing) {
        token = existing.token;
        var current = state();
        if (same(current, existing)) savedState = current;
        if (!rejected && same(current, existing)) {
          message('已保留此浏览器的草稿，发布后会自动清除。'); discard.hidden = false;
        } else if (!rejected && current.body === initial && existing.base === initial && Date.now() - existing.updated <= draftAge) {
          recover(existing);
        } else if (!rejected) {
          pendingRestore = existing; restore.hidden = false; discard.hidden = false;
          message(Date.now() - existing.updated > draftAge ? '找到较早的本地草稿，可恢复或舍弃。' : '另有本地草稿，当前显示服务器内容。');
        } else {
          message('提交未完成，正文仍保留在这里。'); discard.hidden = false;
        }
      } else message('正文会自动保存到当前浏览器。');
    } catch (error) {
      notice.classList.add('is-unavailable');
      message('浏览器无法保存草稿，请先复制正文再离开。');
    } }
    load();
    restore.addEventListener('click', function () { if (pendingRestore) recover(pendingRestore); });
    discard.addEventListener('click', function () {
      var discarded = pendingRestore || Object.assign(state(), { base: baseline.body, token: token || draftToken(), updated: Date.now() });
      // The explicit button discards the draft displayed on this page, not a
      // newer value another tab may have saved since it was loaded.
      try { var latest = readDraft(key); if (latest && latest.token === token) localStorage.removeItem(key); } catch (error) {}
      clearTimeout(timer); rejected = false; pendingRestore = null;
      write(baseline); clearTimeout(timer); token = ''; savedState = null; inputToken.value = '';
      pendingRestore = discarded; restore.hidden = false; restore.textContent = '撤销舍弃'; discard.hidden = true;
      message('已舍弃本页草稿，离开前仍可撤销。');
      updateGuard();
    });
    textarea.addEventListener('input', schedule);
    form.addEventListener('input', function (event) { if (event.target !== textarea) schedule(); });
    form.addEventListener('change', schedule);
    form.addEventListener('submit', function (event) {
      save(); submitting = true; updateGuard();
      queueMicrotask(function () { if (event.defaultPrevented) { submitting = false; updateGuard(); } });
    });
    window.addEventListener('pagehide', save);
    window.addEventListener('pageshow', function () { submitting = false; updateGuard(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });
    function switchScope(nextScope, options) {
      if (!nextScope || nextScope === scope) return false;
      save(); clearTimeout(timer);
      scope = nextScope; key = draftKey(owner, scope, textarea.name);
      notice.hidden = isThreadScope(scope);
      form.dataset.writingScope = scope; form.dataset.writingMethod = 'GET';
      initial = options && typeof options.body === 'string' ? options.body : '';
      baseline = { body: initial, color: baseline.color, material: baseline.material };
      textarea.defaultValue = initial;
      rejected = false; token = ''; savedState = null; pendingRestore = null; submitting = false;
      inputToken.value = ''; restore.hidden = true; restore.textContent = '恢复草稿'; discard.hidden = true;
      notice.classList.remove('is-unavailable');
      write(baseline); clearTimeout(timer); load(); updateGuard();
      return true;
    }
    function acknowledge(receipt) {
      if (receipt.owner !== owner || receipt.scope !== scope) return;
      // Flush any typing after the request was sent before comparing tokens.
      // An acknowledgement for the submitted text must not clear those edits.
      save(); submitting = false;
      if (token === receipt.token) {
        clearTimeout(timer); rejected = false; pendingRestore = null;
        var current = state();
        baseline = { body: /^\/post\/\d+#reply:/.test(scope) ? '' : current.body,
          color: current.color, material: current.material };
        initial = baseline.body; textarea.defaultValue = initial;
        write(baseline); clearTimeout(timer);
        token = ''; savedState = null; inputToken.value = '';
        restore.hidden = true; restore.textContent = '恢复草稿'; discard.hidden = true;
        message('已保存，新的文字仍会自动保存到当前浏览器。');
      }
      updateGuard();
    }
    function scopeRecord(nextScope) {
      if (!isThreadScope(nextScope)) return null;
      if (nextScope === scope && dirty()) return { body: state().body, token: token };
      try { return volatile.get(nextScope) || readDraft(draftKey(owner, nextScope, textarea.name)); }
      catch (error) { return volatile.get(nextScope) || null; }
    }
    function discardScope(nextScope, expectedToken) {
      if (!isThreadScope(nextScope)) return false;
      var record = scopeRecord(nextScope);
      if (expectedToken && record && record.token !== expectedToken) return false;
      volatile.delete(nextScope);
      try {
        var storedKey = draftKey(owner, nextScope, textarea.name), latest = readDraft(storedKey);
        if (latest && (!expectedToken || latest.token === expectedToken)) localStorage.removeItem(storedKey);
      } catch (error) {}
      if (nextScope === scope) {
        clearTimeout(timer); rejected = false; pendingRestore = null;
        write(baseline); clearTimeout(timer); token = ''; savedState = null; inputToken.value = '';
        restore.hidden = true; discard.hidden = true; message('正文会自动保存到当前浏览器。');
      }
      updateGuard();
      return true;
    }
    var controller = { bind: function (instance) {
      editor = instance;
      if (editor) editor.codemirror.on('change', schedule);
    }, switchScope: switchScope, acknowledge: acknowledge, scopeRecord: scopeRecord, discardScope: discardScope, prepare: function () {
      save(); return { owner: owner, scope: scope, token: inputToken.value };
    } };
    drafts.set(textarea, controller); forms.set(form, controller); controllers.push(controller);
    updateGuard();
  });
  function committed(receipt) {
    if (!receipt) return;
    receipt = { owner: receipt.owner, scope: receipt.scope || receipt.path, token: receipt.token };
    if (typeof receipt.owner !== 'string' || typeof receipt.scope !== 'string' ||
      !/^[0-9a-f]{32}$/.test(receipt.token || '')) return;
    controllers.forEach(function (controller) { controller.acknowledge(receipt); });
    try {
      var key = draftKey(receipt.owner, receipt.scope, 'body'), saved = readDraft(key);
      if (saved && saved.token === receipt.token) localStorage.removeItem(key);
    } catch (error) {}
  }
  document.addEventListener('liss:writing-committed', function (event) { committed(event.detail); });
  window.LissWritingDrafts = {
    bind: function (textarea, editor) { var draft = drafts.get(textarea); if (draft) draft.bind(editor); },
    prepare: function (form) { var draft = forms.get(form); return draft ? draft.prepare() : null; },
    switchScope: function (form, scope, options) { var draft = forms.get(form); return draft ? draft.switchScope(scope, options) : false; },
    scopeRecord: function (form, scope) { var draft = forms.get(form); return draft ? draft.scopeRecord(scope) : null; },
    discardScope: function (form, scope, token) { var draft = forms.get(form); return draft ? draft.discardScope(scope, token) : false; },
    committed: committed
  };
})();
