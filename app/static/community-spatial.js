(function () {
  'use strict';
  var dispose = null;

  function mount() {
    if (dispose) dispose();
    var html = document.documentElement;
    var abort = new AbortController(), signal = abort.signal;
    var reduce = matchMedia('(prefers-reduced-motion: reduce)');
    var fine = matchMedia('(hover:hover) and (pointer:fine)');
    var scenes = [], inserted = [], restorers = [], frame = 0, closed = false;
    var previousState = html.getAttribute('data-community-spatial');

    function element(tag, className) {
      var node = document.createElement(tag);
      node.className = className;
      return node;
    }
    function rememberAttribute(node, name, value) {
      var old = node.getAttribute(name);
      node.setAttribute(name, value);
      restorers.push(function () { if (old === null) node.removeAttribute(name); else node.setAttribute(name, old); });
    }
    function paper(host) {
      var world = element('div', 'community-spatial-world');
      ['rear', 'main', 'fold'].forEach(function (layer) {
        var leaf = element('span', 'spatial-leaf spatial-leaf--' + layer);
        world.appendChild(leaf);
      });
      world.setAttribute('aria-hidden', 'true');
      world.inert = true;
      host.appendChild(world);
      inserted.push(world);
      return world;
    }

    // Existing room.js remains the sole pointer driver for header illustrations.
    document.querySelectorAll('.room-fold').forEach(function (host) {
      var world = paper(host);
      world.appendChild(element('span', 'spatial-paper-score'));
      host.classList.add('has-spatial-model');
      restorers.push(function () { host.classList.remove('has-spatial-model'); });
    });
    document.querySelectorAll('.discussion-orbit').forEach(function (host) {
      var original = host.querySelector('svg');
      if (!original) return;
      var world = element('div', 'community-spatial-world');
      world.setAttribute('aria-hidden', 'true');
      world.inert = true;
      world.appendChild(element('span', 'spatial-orbit-floor'));
      ['rear', 'middle', 'front'].forEach(function (layer) {
        var clone = original.cloneNode(true);
        clone.setAttribute('class', 'spatial-orbit-layer spatial-orbit-layer--' + layer);
        clone.setAttribute('aria-hidden', 'true');
        clone.setAttribute('focusable', 'false');
        world.appendChild(clone);
      });
      host.appendChild(world);
      host.classList.add('has-spatial-model');
      inserted.push(world);
      restorers.push(function () { host.classList.remove('has-spatial-model'); });
    });

    function paused() {
      var stored = false;
      try { stored = localStorage.getItem('liss-room-motion') === 'paused'; } catch (error) {}
      return html.dataset.roomMotion === 'paused' || stored;
    }
    function active(scene) {
      return !closed && !document.hidden && !paused() && !reduce.matches && fine.matches && scene.visible;
    }
    function styleValue(node, property) {
      return { value: node.style.getPropertyValue(property), priority: node.style.getPropertyPriority(property) };
    }
    function restoreStyle(node, property, original) {
      if (original.value) node.style.setProperty(property, original.value, original.priority);
      else node.style.removeProperty(property);
    }
    function register(host, target, visual, kind) {
      var names = ['--spatial-x', '--spatial-y', '--spatial-rx', '--spatial-ry'];
      var originals = names.map(function (name) { return styleValue(host, name); });
      var scene = { host: host, target: target, visual: visual, kind: kind, visible: !observer,
        x: 0, y: 0, inside: false, held: false, bounds: null, written: {}, frozen: null };
      rememberAttribute(host, 'data-spatial-visible', String(scene.visible));
      rememberAttribute(host, 'data-spatial-held', 'false');
      restorers.push(function () { names.forEach(function (name, index) { restoreStyle(host, name, originals[index]); }); });
      scenes.push(scene);
      if (observer) observer.observe(host);
      if (resizeObserver) resizeObserver.observe(target);
      target.addEventListener('pointerenter', function () { scene.inside = true; scene.bounds = null; }, { passive: true, signal: signal });
      target.addEventListener('pointermove', function (event) {
        if (!active(scene) || scene.held || event.pointerType === 'touch') return;
        if (event.target.closest('input,textarea,select,.CodeMirror,.editor-toolbar')) { scene.x = scene.y = 0; schedule(); return; }
        if (!scene.bounds) {
          var rect = target.getBoundingClientRect();
          scene.bounds = { left: rect.left + scrollX, top: rect.top + scrollY, width: rect.width, height: rect.height };
        }
        scene.x = Math.max(-1, Math.min(1, (event.pageX - scene.bounds.left) / Math.max(1, scene.bounds.width) * 2 - 1));
        scene.y = Math.max(-1, Math.min(1, (event.pageY - scene.bounds.top) / Math.max(1, scene.bounds.height) * 2 - 1));
        schedule();
      }, { passive: true, signal: signal });
      target.addEventListener('pointerleave', function () {
        scene.inside = false;
        if (!scene.held) { scene.x = scene.y = 0; schedule(); }
      }, { passive: true, signal: signal });
      target.addEventListener('pointerdown', function (event) {
        if (!event.isPrimary || event.button !== 0 || scene.held || !active(scene) || event.pointerType === 'touch') return;
        scene.held = true;
        scene.frozen = { original: styleValue(visual, 'transform'), value: getComputedStyle(visual).transform };
        visual.style.transform = scene.frozen.value;
        host.dataset.spatialHeld = 'true';
      }, { passive: true, signal: signal });
      target.addEventListener('focusin', function (event) {
        scene.x = scene.y = 0;
        if (kind === 'cover' && !event.target.matches('input,textarea,select')) { scene.x = -.25; scene.y = .15; }
        schedule();
      }, { signal: signal });
      target.addEventListener('focusout', function () { if (!scene.inside) { scene.x = scene.y = 0; schedule(); } }, { signal: signal });
    }
    function thaw(scene) {
      if (scene.frozen) { restoreStyle(scene.visual, 'transform', scene.frozen.original); scene.frozen = null; }
      scene.held = false;
      scene.host.dataset.spatialHeld = 'false';
    }
    function paint() {
      frame = 0;
      scenes.forEach(function (scene) {
        var enabled = active(scene), x = enabled ? scene.x : 0, y = enabled ? scene.y : 0;
        var gain = scene.kind === 'cover' ? 2 : 4;
        var values = [x * gain + 'px', y * gain + 'px', (-y * (scene.kind === 'cover' ? 3 : 4)).toFixed(2) + 'deg', (x * (scene.kind === 'cover' ? 4 : 5)).toFixed(2) + 'deg'];
        ['--spatial-x', '--spatial-y', '--spatial-rx', '--spatial-ry'].forEach(function (name, index) {
          var value = index < 2 ? parseFloat(values[index]).toFixed(2) + 'px' : values[index];
          if (scene.written[name] !== value) { scene.host.style.setProperty(name, value); scene.written[name] = value; }
        });
      });
    }
    function schedule() {
      if (closed) return;
      if (document.hidden) { if (frame) cancelAnimationFrame(frame); paint(); }
      else if (!frame) frame = requestAnimationFrame(paint);
    }
    function gate() {
      html.dataset.communitySpatial = paused() || reduce.matches || !fine.matches || document.hidden ? 'static' : 'ready';
      scenes.forEach(function (scene) {
        if (!active(scene)) { thaw(scene); scene.x = scene.y = 0; }
      });
      schedule();
    }
    var observer = window.IntersectionObserver ? new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var scene = scenes.find(function (item) { return item.host === entry.target; });
        if (!scene) return;
        scene.visible = entry.isIntersecting;
        scene.host.dataset.spatialVisible = String(scene.visible);
        if (!scene.visible) { thaw(scene); scene.x = scene.y = 0; scene.bounds = null; }
      });
      schedule();
    }, { rootMargin: '24px' }) : null;
    var resizeObserver = window.ResizeObserver ? new ResizeObserver(function (entries) {
      entries.forEach(function (entry) { scenes.forEach(function (scene) { if (scene.target === entry.target) scene.bounds = null; }); });
    }) : null;

    document.querySelectorAll('.post-cover > img[data-post-cover-image]').forEach(function (image) {
      var anchor = image.parentElement;
      rememberAttribute(anchor, 'data-spatial-cover', 'true');
      register(anchor, anchor.closest('.post') || anchor, image, 'cover');
    });
    document.querySelectorAll('.identity-reading,.identity-profile,.identity-followers,.identity-auth,.identity-welcome,.identity-settings,.identity-editor,.identity-status,.identity-admin').forEach(function (host) {
      var environment = element('div', 'community-spatial-environment');
      environment.setAttribute('aria-hidden', 'true');
      environment.inert = true;
      host.appendChild(environment);
      inserted.push(environment);
      register(environment, host, paper(environment), 'margin');
    });
    function release() {
      scenes.forEach(function (scene) {
        if (!scene.held) return;
        thaw(scene);
        if (!scene.inside) scene.x = scene.y = 0;
      });
      schedule();
    }
    window.addEventListener('pointerup', release, { passive: true, signal: signal });
    window.addEventListener('pointercancel', release, { passive: true, signal: signal });
    window.addEventListener('blur', function () {
      scenes.forEach(function (scene) { thaw(scene); scene.inside = false; scene.x = scene.y = 0; });
      schedule();
    }, { signal: signal });
    window.addEventListener('resize', function () {
      scenes.forEach(function (scene) { scene.bounds = null; });
    }, { passive: true, signal: signal });
    window.addEventListener('storage', function (event) { if (event.key === 'liss-room-motion') gate(); }, { signal: signal });
    document.addEventListener('visibilitychange', gate, { signal: signal });
    reduce.addEventListener('change', gate, { signal: signal });
    fine.addEventListener('change', gate, { signal: signal });
    var stateObserver = new MutationObserver(gate);
    stateObserver.observe(html, { attributes: true, attributeFilter: ['data-room-motion'] });
    gate();
    dispose = function () {
      if (closed) return;
      closed = true;
      abort.abort();
      if (frame) cancelAnimationFrame(frame);
      if (observer) observer.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      stateObserver.disconnect();
      scenes.forEach(thaw);
      restorers.reverse().forEach(function (restore) { restore(); });
      inserted.reverse().forEach(function (node) { node.remove(); });
      if (previousState === null) html.removeAttribute('data-community-spatial');
      else html.setAttribute('data-community-spatial', previousState);
    };
  }
  mount();
  window.addEventListener('pagehide', function () { if (dispose) dispose(); });
  window.addEventListener('pageshow', function (event) { if (event.persisted) mount(); });
})();
