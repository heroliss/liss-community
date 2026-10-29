/* Native multi-page navigation owns history, GET/POST and focus. These names
   only connect a selected article's existing title/image across snapshots. */
(function () {
  'use strict';
  var key = '__lissCommunityTransitions';
  if (window[key]) window[key].destroy();
  var abort = new AbortController(), signal = abort.signal;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)'), current = null, submitting = false;
  var named = [], previousDirection = null;
  function resetNames() {
    named.forEach(function (entry) { if (entry.value) entry.node.style.setProperty('view-transition-name',entry.value,entry.priority); else entry.node.style.removeProperty('view-transition-name'); });
    named = [];
  }
  function reset() {
    resetNames();
    if (previousDirection !== null) {
      if (previousDirection.present) document.documentElement.setAttribute('data-community-transition',previousDirection.value);
      else document.documentElement.removeAttribute('data-community-transition');
      previousDirection = null;
    }
  }
  function paused() {
    if (reduce.matches || document.documentElement.dataset.roomMotion === 'paused') return true;
    try { return localStorage.getItem('liss-room-motion') === 'paused'; } catch (e) { return false; }
  }
  function skip() { if (current) current.skipTransition(); }
  function postId(url) { var match = url && url.pathname.match(/\/post\/(\d+)\/?$/); return match ? match[1] : null; }
  function name(node, value) {
    if (!node) return;
    named.push({node:node,value:node.style.getPropertyValue('view-transition-name'),priority:node.style.getPropertyPriority('view-transition-name')});
    node.style.viewTransitionName = value;
  }
  function configure(from, to, transition) {
    reset();
    if (!from || !to || from.origin !== location.origin || to.origin !== location.origin) return;
    var before = postId(from), after = postId(to), chosen = after || before;
    previousDirection = {present:document.documentElement.hasAttribute('data-community-transition'),value:document.documentElement.getAttribute('data-community-transition')};
    document.documentElement.dataset.communityTransition = after && after !== before ? 'reading-open' : before && !after ? 'reading-close' : 'between';
    name(document.querySelector('.site-header'),'community-navigation');
    if (chosen) {
      var article = document.querySelector('.post[data-depth-id="'+chosen+'"]');
      if (article) {
        name(article.querySelector('[data-depth-post-title],.post-body h1') || article.querySelector('.post-meta'),'community-post-title');
        name(article.querySelector('.post-cover img,.post-body img'),'community-post-image');
      }
    }
    transition.ready.then(function () { if (current === transition) resetNames(); },function () { if (current === transition) resetNames(); });
    transition.finished.then(function () { if (current === transition) { current = null; reset(); } },function () { if (current === transition) { current = null; reset(); } });
  }
  window.addEventListener('pageswap',function (event) {
    if (!event.viewTransition) return;
    current = event.viewTransition;
    if (paused() || submitting || !event.activation) { skip(); return; }
    try { configure(new URL(location.href),new URL(event.activation.entry.url),current); } catch (e) { skip(); }
  },{signal:signal});
  window.addEventListener('pagereveal',function (event) {
    submitting = false;
    if (!event.viewTransition) { reset(); current = null; return; }
    current = event.viewTransition;
    if (paused()) { skip(); return; }
    var activation = window.navigation && window.navigation.activation;
    if (!activation || !activation.from) return;
    try { configure(new URL(activation.from.url),new URL(activation.entry.url),current); } catch (e) { skip(); }
  },{signal:signal});
  document.addEventListener('submit',function () { submitting = true; skip(); },{capture:true,signal:signal});
  document.addEventListener('pointerdown',skip,{capture:true,passive:true,signal:signal});
  document.addEventListener('keydown',skip,{capture:true,signal:signal});
  reduce.addEventListener('change',function () { if (paused()) skip(); },{signal:signal});
  window.addEventListener('storage',function (event) { if (event.key === 'liss-room-motion' && paused()) skip(); },{signal:signal});
  window.addEventListener('pagehide',function () { reset(); current = null; },{signal:signal});
  window[key] = {destroy:function () { skip(); reset(); abort.abort(); delete window[key]; }};
})();
