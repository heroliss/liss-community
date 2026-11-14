/* LISS visitor analytics tracker (community + portfolio).
 * <script src=".../static/liss-analytics.js" data-site="forum|works|atoll" async></script>
 * Sends small JSON batches with sendBeacon (text/plain, no preflight). Opt out per
 * browser with ?liss_analytics=off, opt back in with ?liss_analytics=on. Mark this browser
 * as the site owner (shown as 本人) with ?liss_analytics=me, undo with ?liss_analytics=notme. */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || window.__lissAnalytics) return;
  window.__lissAnalytics = true;
  var data = script.dataset || {};
  var site = data.site || 'forum';
  var endpoint;
  try { endpoint = data.endpoint ? new URL(data.endpoint, script.src).href : new URL('/analytics/collect', script.src).href; }
  catch (e) { return; }
  var store = (function () { try { var k = '__liss_a_probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; } catch (e) { return null; } })();
  var get = function (key) { try { return store ? store.getItem(key) : null; } catch (e) { return null; } };
  var set = function (key, value) { try { if (store) store.setItem(key, value); } catch (e) {} };
  // First-party cookies back up what lives in storage (Safari clears script storage after 7 days
  // without a visit): the visitor id, and the opt-out / owner flags, which must survive just as long.
  var readCookie = function (name, pattern) { try { var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=(' + pattern + ')(?:;|$)')); return m ? m[1] : null; } catch (e) { return null; } };
  var writeCookie = function (name, value) { try { document.cookie = name + '=' + value + '; max-age=' + (value ? 63072000 : 0) + '; path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : ''); } catch (e) {} };
  var setFlag = function (key, on) { if (on) set('liss-a:' + key, '1'); else { try { store && store.removeItem('liss-a:' + key); } catch (e) {} } writeCookie('liss_' + key, on ? '1' : ''); };
  var hasFlag = function (key) { return get('liss-a:' + key) === '1' || readCookie('liss_' + key, '1') === '1'; };
  try {
    var flag = new URLSearchParams(location.search).get('liss_analytics');
    if (flag === 'off') { setFlag('optout', true); writeCookie('liss_vid', ''); }
    if (flag === 'on') setFlag('optout', false);
    if (flag === 'me') setFlag('me', true);
    if (flag === 'notme') setFlag('me', false);
  } catch (e) {}
  if (hasFlag('optout')) return;
  if (hasFlag('me')) setFlag('me', true);  // Restore whichever copy was cleared.

  var random = function () {
    var bytes = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  };
  var now = function () { return Date.now(); };
  // The visitor id: this site's storage, the liss_vid cookie, or (community) the server cookie handed
  // over as data-vid. Any surviving copy restores the others.
  var VID = /^[a-f0-9]{24}$/;
  var cookieVid = function () { return readCookie('liss_vid', '[a-f0-9]{24}'); };
  var vid = get('liss-a:vid');
  if (!vid || !VID.test(vid)) vid = VID.test(data.vid || '') ? data.vid : cookieVid();
  if (!vid || !VID.test(vid)) vid = random();
  set('liss-a:vid', vid);
  if (cookieVid() !== vid) writeCookie('liss_vid', vid);
  var SESSION_IDLE = 30 * 60 * 1000;
  var session = null;
  try { session = JSON.parse(get('liss-a:session') || 'null'); } catch (e) {}
  var freshSession = !session || !/^[a-f0-9]{24}$/.test(session.id || '') || now() - (session.last || 0) > SESSION_IDLE;
  if (freshSession) session = { id: random(), last: now() };
  var touchSession = function () { session.last = now(); set('liss-a:session', JSON.stringify(session)); };
  touchSession();

  var utm = '';
  try {
    var params = new URLSearchParams(location.search), parts = [];
    ['utm_source', 'utm_medium', 'utm_campaign', 'from', 'ref'].forEach(function (key) { var v = params.get(key); if (v) parts.push(key + '=' + v.slice(0, 60)); });
    utm = parts.join('&');
  } catch (e) {}

  var idleLimit = site === 'atoll' ? 10 * 60 * 1000 : 2 * 60 * 1000;
  var page, queue = [], errors = 0, sentFirst = false, dirty = true;
  var lastInput = now(), lastTick = now();

  function newPage() {
    page = { id: random(), opened: now(), active: 0, scroll: 0, perf: null, clicks: 0, human: false, inputs: 0, lastBurst: 0 };
    sentFirst = false; dirty = true; errors = 0;
  }
  newPage();

  function scrollDepth() {
    var doc = document.documentElement, body = document.body || doc;
    var height = Math.max(doc.scrollHeight, body.scrollHeight || 0);
    if (!height) return 0;
    var seen = (window.scrollY || doc.scrollTop || 0) + window.innerHeight;
    return Math.max(0, Math.min(100, Math.round(seen / height * 100)));
  }
  function tick() {
    var t = now(), delta = Math.min(t - lastTick, 5000);
    lastTick = t;
    if (document.visibilityState === 'visible' && t - lastInput < idleLimit) { page.active += delta; dirty = true; }
    var depth = scrollDepth();
    if (depth > page.scroll) { page.scroll = depth; dirty = true; }
  }
  function perf() {
    if (page.perf) return page.perf;
    try {
      var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      if (nav && nav.loadEventEnd > 0) {
        page.perf = { ttfb: Math.round(nav.responseStart), dom: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd) };
      }
    } catch (e) {}
    return page.perf;
  }
  // Browser signals that tell real browsers from automation and describe the device. Synchronous
  // parts are read once; client hints and the notification check resolve shortly after load.
  var envCache = null, envAsync = {}, envPending = 0, envSent = false;
  function media(query) { try { return window.matchMedia(query).matches; } catch (e) { return false; } }
  function env() {
    if (!envCache) {
      var nav = navigator, ua = nav.userAgent || '', out = { wd: !!nav.webdriver };
      try { out.pf = String(nav.platform || '').slice(0, 40); } catch (e) {}
      try { out.langs = (nav.languages || []).slice(0, 6).join(',').slice(0, 80); } catch (e) {}
      if (typeof nav.hardwareConcurrency === 'number') out.hc = nav.hardwareConcurrency;
      if (typeof nav.deviceMemory === 'number') out.dm = nav.deviceMemory;
      if (typeof nav.maxTouchPoints === 'number') out.tp = nav.maxTouchPoints;
      try { out.cd = screen.colorDepth; out.tzo = new Date().getTimezoneOffset(); } catch (e) {}
      try {
        var c = nav.connection;
        if (c) { if (c.effectiveType) out.conn = String(c.effectiveType).slice(0, 16); if (typeof c.rtt === 'number') out.rtt = c.rtt; if (typeof c.downlink === 'number') out.dl = Math.round(c.downlink); if (c.saveData) out.sd = true; }
      } catch (e) {}
      out.cs = media('(prefers-color-scheme: dark)') ? 'dark' : 'light';
      out.ptr = media('(pointer: fine)') ? 'fine' : media('(pointer: coarse)') ? 'coarse' : 'none';
      out.hov = media('(hover: hover)');
      if (media('(dynamic-range: high)')) out.hdr = true;
      if (media('(color-gamut: p3)')) out.p3 = true;
      if (media('(prefers-reduced-motion: reduce)')) out.rm = true;
      try { out.oz = window.outerWidth === 0 && window.outerHeight === 0; } catch (e) {}
      try { out.pl = nav.plugins ? nav.plugins.length : 0; } catch (e) {}
      if (/Chrome\//.test(ua) && !/Edg|OPR|SamsungBrowser/.test(ua)) out.nc = !window.chrome;
      try {
        var brands = nav.userAgentData && nav.userAgentData.brands;
        if (brands) {
          var names = brands.map(function (b) { return b.brand + ' ' + b.version; }).join(', ');
          out.uab = names.slice(0, 120);
          out.hl = /Headless/i.test(names);
        }
      } catch (e) {}
      try { if (hasFlag('me')) out.me = true; } catch (e) {}
      try {
        var gl = document.createElement('canvas').getContext('webgl');
        if (gl) {
          var info = gl.getExtension('WEBGL_debug_renderer_info');
          out.gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '').slice(0, 120);
          var lose = gl.getExtension('WEBGL_lose_context');
          if (lose) lose.loseContext();
        }
      } catch (e) {}
      try {
        // Canvas rendering differs slightly between GPUs, drivers and font setups: a short hash helps
        // tell apart devices that otherwise report the same hardware.
        var cv = document.createElement('canvas'); cv.width = 220; cv.height = 40;
        var ctx = cv.getContext('2d');
        ctx.textBaseline = 'top'; ctx.font = '16px Arial'; ctx.fillStyle = '#f60'; ctx.fillRect(100, 1, 62, 20);
        ctx.fillStyle = '#069'; ctx.fillText('Liss 访客 ✨ 0.1', 2, 15);
        ctx.fillStyle = 'rgba(102,204,0,0.7)'; ctx.fillText('Liss 访客 ✨ 0.1', 4, 17);
        var data = cv.toDataURL(), h = 2166136261;
        for (var i = 0; i < data.length; i++) { h ^= data.charCodeAt(i); h = Math.imul(h, 16777619); }
        out.cv = ('0000000' + (h >>> 0).toString(16)).slice(-8);
      } catch (e) {}
      envCache = out;
    }
    var merged = {};
    Object.keys(envCache).forEach(function (k) { merged[k] = envCache[k]; });
    Object.keys(envAsync).forEach(function (k) { merged[k] = envAsync[k]; });
    return merged;
  }
  (function () {
    try {
      var uad = navigator.userAgentData;
      if (uad && uad.getHighEntropyValues) {
        envPending++;
        uad.getHighEntropyValues(['platformVersion', 'model', 'architecture', 'bitness']).then(function (v) {
          if (v.platformVersion) envAsync.pv = String(v.platformVersion).slice(0, 24);
          if (v.model) envAsync.mdl = String(v.model).slice(0, 60);
          if (v.architecture) envAsync.arch = (String(v.architecture) + (v.bitness ? '-' + v.bitness : '')).slice(0, 16);
        }).catch(function () {}).then(function () { envPending--; envSent = false; dirty = true; });
      }
    } catch (e) {}
    try {
      // Headless Chrome reports Notification "denied" while the permission itself is still "prompt".
      if (window.Notification && navigator.permissions && navigator.permissions.query) {
        envPending++;
        navigator.permissions.query({ name: 'notifications' }).then(function (status) {
          if (Notification.permission === 'denied' && status.state === 'prompt') envAsync.np = true;
        }).catch(function () {}).then(function () { envPending--; envSent = false; dirty = true; });
      }
    } catch (e) {}
  })();
  function payload(end) {
    tick();
    var body = {
      v: 1, site: site, vid: vid, sid: session.id, now: now(),
      pv: { id: page.id, url: location.href.split('#')[0].slice(0, 1000), path: location.pathname.slice(0, 600), title: (document.title || '').slice(0, 300),
            ref: (document.referrer || '').slice(0, 600), active: page.active, total: now() - page.opened, scroll: page.scroll,
            vp: window.innerWidth + 'x' + window.innerHeight, perf: perf(), end: !!end, hi: page.human, inp: page.inputs },
      ev: queue.splice(0, 100),
      ctx: { lang: (navigator.language || '').slice(0, 24), tz: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })(),
             screen: (screen.width || 0) + 'x' + (screen.height || 0) + (window.devicePixelRatio && window.devicePixelRatio !== 1 ? '@' + Math.round(window.devicePixelRatio * 100) / 100 : ''),
             uid: data.uid || '', uname: data.uname || '', usig: data.usig || '' }
    };
    if (!sentFirst || !envSent) { body.ctx.env = env(); envSent = envPending === 0; }
    if (freshSession && !sentFirst) { body.sref = (document.referrer || '').slice(0, 600); body.landing = location.pathname.slice(0, 600); body.utm = utm; }
    return body;
  }
  function send(end) {
    var body;
    try { body = JSON.stringify(payload(end)); } catch (e) { return; }
    sentFirst = true; dirty = false;
    touchSession();
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
    } catch (e) {}
    try { fetch(endpoint, { method: 'POST', body: body, keepalive: true, mode: 'no-cors', credentials: 'include', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }); } catch (e) {}
  }

  // ---- events
  function text(el) {
    var label = el.getAttribute('data-track') || el.getAttribute('aria-label') || '';
    if (!label) {
      var tag = el.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        var type = (el.getAttribute('type') || '').toLowerCase();
        label = (type === 'submit' || type === 'button' || type === 'reset') ? el.value : (el.name || el.id || type || tag.toLowerCase());
        if (tag === 'SELECT' && el.selectedIndex >= 0 && el.options[el.selectedIndex]) label = (el.name || 'select') + ': ' + el.options[el.selectedIndex].text;
        if (type === 'checkbox' || type === 'radio') {
          var lab = el.closest('label');
          label = (lab ? (lab.innerText || '') : label) + (el.checked ? ' ✓' : '');
        }
      } else {
        label = el.innerText || el.textContent || el.getAttribute('title') || el.getAttribute('alt') || '';
        if (!label.trim()) { var img = el.querySelector && el.querySelector('img[alt],svg title'); if (img) label = img.getAttribute('alt') || img.textContent || ''; }
      }
    }
    return label.replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  function describe(el) {
    var out = el.tagName.toLowerCase();
    if (el.id) out += '#' + el.id;
    var cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) out += '.' + cls.join('.');
    return out.slice(0, 120);
  }
  var CLICKABLE = 'a,button,[role="button"],[role="tab"],[role="menuitem"],[role="switch"],summary,select,input,label,[data-track],[onclick]';
  document.addEventListener('click', function (event) {
    var el = event.target && event.target.closest ? event.target.closest(CLICKABLE) : null;
    if (!el) return;
    if (el.tagName === 'LABEL' && el.control) return; // The control click follows.
    var href = el.tagName === 'A' ? el.href : '';
    var type = 'click';
    try { if (href && /^https?:/.test(href) && new URL(href).host !== location.host) type = 'outbound'; } catch (e) {}
    queue.push({ t: now(), type: type, label: text(el), target: describe(el), href: (href || '').slice(0, 600),
                 x: Math.round(event.pageX || 0), y: Math.round(event.pageY || 0),
                 data: { vw: window.innerWidth, vh: window.innerHeight } });
    page.clicks++; dirty = true;
    if (type === 'outbound' || href) send(false); // Navigation may end the page before the next heartbeat.
  }, true);
  window.addEventListener('error', function (event) {
    if (errors >= 10 || !event.message) return;
    errors++;
    queue.push({ t: now(), type: 'error', label: String(event.message).slice(0, 200), target: '',
                 data: { src: (event.filename || '').slice(0, 200) + ':' + (event.lineno || 0) + ':' + (event.colno || 0),
                         stack: event.error && event.error.stack ? String(event.error.stack).slice(0, 600) : '' } });
    dirty = true;
  });
  window.addEventListener('unhandledrejection', function (event) {
    if (errors >= 10) return;
    errors++;
    var reason = event.reason;
    queue.push({ t: now(), type: 'error', label: ('Promise: ' + (reason && reason.message ? reason.message : String(reason))).slice(0, 200), target: '',
                 data: { stack: reason && reason.stack ? String(reason.stack).slice(0, 600) : '' } });
    dirty = true;
  });
  var markInput = function () { lastInput = now(); };
  var markHuman = function (event) {
    if (!event.isTrusted) return;
    if (!page.human) { page.human = true; dirty = true; }
    var t = now();  // Count interaction bursts: inputs more than 0.6 s apart start a new one.
    if (t - page.lastBurst > 600) { page.inputs++; dirty = true; }
    page.lastBurst = t;
  };
  ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'].forEach(function (name) {
    window.addEventListener(name, markInput, { passive: true, capture: true });
    if (name !== 'scroll') window.addEventListener(name, markHuman, { passive: true, capture: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') send(false);
    else { lastTick = now(); lastInput = now(); }
  });
  window.addEventListener('pagehide', function () { send(true); });
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) { newPage(); freshSession = now() - session.last > SESSION_IDLE; if (freshSession) session = { id: random(), last: now() }; send(false); }
  });
  window.addEventListener('load', function () { setTimeout(function () { if (perf()) { dirty = true; send(false); } }, 50); });

  setInterval(tick, 1000);
  setInterval(function () { if (document.visibilityState === 'visible' && (dirty || queue.length)) send(false); }, 15000);
  window.LissAnalytics = {
    track: function (label, extra) { queue.push({ t: now(), type: 'custom', label: String(label || '').slice(0, 120), target: '', data: extra || {} }); dirty = true; },
    flush: function () { send(false); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { send(false); });
  else send(false);
})();
