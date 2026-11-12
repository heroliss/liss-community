// 访问统计: filter chips submit immediately; the live page refreshes while visible.
(function () {
  'use strict';
  document.querySelectorAll('[data-an-filters]').forEach(function (form) {
    form.addEventListener('change', function (event) {
      var target = event.target;
      if (target.name === 'range') {
        form.querySelectorAll('.an-chip').forEach(function (chip) { chip.classList.toggle('is-active', chip.contains(target)); });
        var dates = form.querySelector('.an-dates');
        if (dates) dates.classList.toggle('is-quiet', target.value !== 'custom');
      }
      if (target.name === 'from' || target.name === 'to') {
        var custom = form.querySelector('input[name="range"][value="custom"]');
        if (custom && !custom.checked) { custom.checked = true; custom.dispatchEvent(new Event('change', { bubbles: true })); }
        return;
      }
      if (target.getAttribute('data-an-autosubmit') === '1') form.requestSubmit ? form.requestSubmit() : form.submit();
    });
  });
  var live = document.querySelector('[data-an-refresh]');
  if (live) {
    var seconds = Math.max(5, parseInt(live.getAttribute('data-an-refresh'), 10) || 20);
    var refresh = function () {
      if (document.visibilityState !== 'visible') return;
      fetch(location.href, { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
        .then(function (response) { return response.ok ? response.text() : null; })
        .then(function (html) {
          if (!html) return;
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var next = doc.querySelector('[data-an-refresh]');
          var pill = doc.querySelector('.an-live-pill');
          if (next) live.innerHTML = next.innerHTML;
          var current = document.querySelector('.an-live-pill');
          if (pill && current) current.innerHTML = pill.innerHTML;
        }).catch(function () {});
    };
    setInterval(refresh, seconds * 1000);
    document.addEventListener('visibilitychange', refresh);
  }
})();
