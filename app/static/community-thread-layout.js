/* Remember the reading layout without moving focus or navigating to a reply. */
(function () {
  'use strict';
  var section = document.querySelector('[data-thread]');
  var control = section && section.querySelector('[data-thread-layout-switch]');
  if (!control) return;
  var buttons = Array.from(control.querySelectorAll('[data-thread-layout-value]'));
  var storageKey = 'liss-thread-layout:v1', runway = null, runwayHeight = 0;
  function valid(value) { return value === 'scatter' || value === 'list'; }
  function read() {
    try { var saved = localStorage.getItem(storageKey); return valid(saved) ? saved : 'scatter'; }
    catch (error) { return valid(section.dataset.threadLayout) ? section.dataset.threadLayout : 'scatter'; }
  }
  function metrics() {
    var scroller = document.scrollingElement || document.documentElement;
    var height = scroller && scroller.scrollHeight, viewport = scroller && scroller.clientHeight;
    return Number.isFinite(height) && viewport > 0 ? { height: height, viewport: viewport } : null;
  }
  function setRunway(height) {
    height = Math.max(0, Math.ceil(height));
    if (!height) {
      if (runway) runway.remove();
      runway = null; runwayHeight = 0; return;
    }
    if (!runway) {
      runway = document.createElement('div');
      runway.setAttribute('data-thread-layout-runway', ''); runway.setAttribute('aria-hidden', 'true');
      Object.assign(runway.style, { display: 'block', margin: '0', padding: '0', border: '0', minHeight: '0', maxHeight: 'none', pointerEvents: 'none', overflowAnchor: 'none', flex: 'none' });
      section.appendChild(runway);
    }
    runway.style.height = height + 'px'; runwayHeight = height;
  }
  function releaseRunway() {
    if (!runwayHeight) return;
    var bounds = metrics(); if (!bounds) return;
    var removable = window.scrollY <= .5 ? runwayHeight : Math.min(runwayHeight, Math.floor(Math.max(0, bounds.height - bounds.viewport - window.scrollY)));
    if (removable) setRunway(runwayHeight - removable);
  }
  function readingAnchor() {
    var comments = Array.from(section.querySelectorAll('[data-thread-comment]'));
    return comments.find(function (item) { var bounds = item.getBoundingClientRect(); return bounds.top >= 100 && bounds.top < window.innerHeight - 30; }) ||
      comments.find(function (item) { var bounds = item.getBoundingClientRect(); return bounds.bottom > 100 && bounds.top < window.innerHeight - 30; });
  }
  function apply(value, persist) {
    value = valid(value) ? value : 'scatter';
    var previous = section.dataset.threadLayout;
    var anchor = readingAnchor(), before = anchor ? anchor.getBoundingClientRect().top : null;
    section.dataset.threadLayout = value;
    section.setAttribute('data-thread-layout-ready', '');
    buttons.forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.threadLayoutValue === value)); });
    control.hidden = false;
    if (before !== null && anchor.isConnected) {
      var after = anchor.getBoundingClientRect().top;
      var destination = Math.max(0, window.scrollY + after - before), bounds = metrics();
      if (bounds && destination + bounds.viewport > bounds.height) setRunway(runwayHeight + Math.ceil(destination + bounds.viewport - bounds.height));
      var delta = anchor.getBoundingClientRect().top - before;
      if (Math.abs(delta) > .5) window.scrollBy({ top: delta, left: 0, behavior: 'instant' });
    }
    releaseRunway();
    if (persist) { try { localStorage.setItem(storageKey, value); } catch (error) {} }
    if (previous !== value) window.dispatchEvent(new CustomEvent('liss:thread-layout', { detail: { layout: value, previous: previous } }));
  }
  control.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var button = event.target.closest && event.target.closest('[data-thread-layout-value]');
    if (!button || !control.contains(button) || !valid(button.dataset.threadLayoutValue)) return;
    event.preventDefault(); apply(button.dataset.threadLayoutValue, true);
  });
  window.addEventListener('storage', function (event) {
    if (event.key === storageKey || event.key === null) apply(event.newValue, false);
  });
  window.addEventListener('scroll', releaseRunway, { passive: true });
  window.addEventListener('resize', releaseRunway, { passive: true });
  window.addEventListener('pageshow', function (event) { if (event.persisted) apply(read(), false); });
  window.addEventListener('pagehide', function (event) { if (!event.persisted) setRunway(0); });
  apply(read(), false);
})();
