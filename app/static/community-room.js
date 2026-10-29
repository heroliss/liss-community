/* Preferences/native recovery only. community-spatial.js owns all room motion. */
(function () {
  'use strict';
  var key = '__lissRoomPreferences';
  if (window[key] && typeof window[key].destroy === 'function') window[key].destroy();
  var lifetime = new AbortController(), dispose = null;
  function mount() {
    if (dispose) dispose();
    var html = document.documentElement, abort = new AbortController(), signal = abort.signal;
    var reduce = matchMedia('(prefers-reduced-motion: reduce)'), userPaused = false, closed = false;
    var controls = Array.from(document.querySelectorAll('[data-room-motion-toggle]'));
    try { userPaused = localStorage.getItem('liss-room-motion') === 'paused'; } catch (error) {}
    function sync() {
      if (closed) return;
      var blocked = userPaused || reduce.matches;
      html.dataset.roomMotion = blocked ? 'paused' : 'ready';
      controls.forEach(function (button) {
        button.hidden = false;
        button.disabled = reduce.matches;
        button.setAttribute('aria-pressed', String(blocked));
        var label = button.querySelector('[data-room-motion-label]');
        if (label) label.textContent = reduce.matches ? '已减少动态' : userPaused ? '继续动效' : '暂停动效';
      });
      window.dispatchEvent(new CustomEvent('liss:motion-state', { detail: {
        paused: userPaused, reduced: reduce.matches, blocked: blocked
      } }));
    }
    controls.forEach(function (button) {
      button.addEventListener('click', function () {
        userPaused = !userPaused;
        try { localStorage.setItem('liss-room-motion', userPaused ? 'paused' : 'ready'); } catch (error) {}
        sync();
      }, { signal: signal });
    });
    reduce.addEventListener('change', sync, { signal: signal });
    window.addEventListener('storage', function (event) {
      if (event.key !== 'liss-room-motion') return;
      userPaused = event.newValue === 'paused';
      sync();
    }, { signal: signal });
    function syncTheme() {
      var meta = document.getElementById('theme-color');
      if (meta) meta.content = getComputedStyle(html).getPropertyValue('--bg').trim();
    }
    var themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(html, { attributes: true, attributeFilter: ['data-theme'] });
    document.querySelectorAll('form[aria-busy]').forEach(function (form) {
      form.removeAttribute('aria-busy');
      var pending = form.querySelector('.form-pending');
      if (pending) pending.textContent = '';
    });
    syncTheme(); sync();
    dispose = function () {
      if (closed) return;
      closed = true; abort.abort(); themeObserver.disconnect();
    };
  }
  window.addEventListener('pagehide', function () { if (dispose) dispose(); }, { signal: lifetime.signal });
  window.addEventListener('pageshow', function (event) { if (event.persisted) mount(); }, { signal: lifetime.signal });
  window[key] = { destroy: function () { if (dispose) dispose(); lifetime.abort(); delete window[key]; } };
  mount();
})();
