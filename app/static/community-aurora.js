/* Aurora v60 interactions: drifting motes, click ripples in the nearest card's
   colour, prompt chips that open the composer, a header that frosts once the page
   scrolls, and a write orb that steps aside while reading downward. */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Drifting motes: a few dozen soft points tinted to the current scene. They
  // rise slowly with a little sway, render at ~20 fps from one cached sprite
  // per colour, and stop when the tab is hidden or motion is reduced.
  var motes = document.querySelector('[data-aurora-particles]');
  if (motes && motes.getContext) {
    var tones = {
      'aurora-veil': ['#3fe0b0', '#36c4e8', '#8b6cf0'], 'prism-nebula': ['#e26bc9', '#2fb7e6', '#f2b45c'],
      'bokeh-night': ['#6ee8e3', '#e27ee8', '#facf4e'], 'tide-glow': ['#36d2c8', '#d679d6', '#f3a85c'],
      'silk-flow': ['#5ee6d6', '#ff8fb8', '#ffd08a'], 'crystal-cavern': ['#7fd6ff', '#a98bff', '#5cf0d0'],
      'dusk-dunes': ['#ffb36b', '#ff7f8e', '#ffe0b0'], 'deep-current': ['#4fe3e6', '#9dfff0', '#3d9bff'],
      'neon-rain': ['#ff4fa3', '#38e1ff', '#a26bff'], 'lantern-field': ['#ffb347', '#ffd27a', '#ff8a5c']
    };
    var fallback = ['#bfe8ff', '#6ee8e3', '#e2c6ff'];
    var context = motes.getContext('2d'), list = [], sprites = {}, width = 0, height = 0, ratio = 1, frame = 0, last = 0;
    var sprite = function (colour) {
      if (sprites[colour]) return sprites[colour];
      var c = document.createElement('canvas'); c.width = c.height = 32;
      var g = c.getContext('2d'), grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(.22, colour); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 32, 32); return (sprites[colour] = c);
    };
    var palette = function () {
      var id = window.LissBackgrounds && window.LissBackgrounds.read && window.LissBackgrounds.read().id;
      return tones[id] || fallback;
    };
    var seed = function () {
      var colours = palette(), count = Math.round(Math.min(40, Math.max(20, width * height / 36000)));
      list = [];
      for (var i = 0; i < count; i++) list.push({ x: Math.random() * width, y: Math.random() * height, r: 1.2 + Math.random() * 3.2, v: 6 + Math.random() * 16, sway: Math.random() * Math.PI * 2, a: .25 + Math.random() * .55, c: colours[i % colours.length] });
    };
    var size = function () {
      ratio = Math.min(1.5, window.devicePixelRatio || 1); width = innerWidth; height = innerHeight;
      motes.width = Math.round(width * ratio); motes.height = Math.round(height * ratio); context.setTransform(ratio, 0, 0, ratio, 0, 0); seed();
    };
    var tick = function (now) {
      frame = 0;
      if (document.hidden || reduce.matches) { last = 0; return; }
      frame = requestAnimationFrame(tick);
      if (last && now - last < 48) return;
      var dt = last ? Math.min(.1, (now - last) / 1000) : 1 / 30; last = now;
      context.clearRect(0, 0, width, height);
      for (var i = 0; i < list.length; i++) {
        var m = list[i]; m.y -= m.v * dt; m.sway += dt * .6; var x = m.x + Math.sin(m.sway) * 10;
        if (m.y < -10) { m.y = height + 10; m.x = Math.random() * width; }
        context.globalAlpha = m.a * (.75 + Math.sin(m.sway * 1.7) * .25); var d = m.r * 4;
        context.drawImage(sprite(m.c), x - d / 2, m.y - d / 2, d, d);
      }
      context.globalAlpha = 1;
    };
    var start = function () { if (!frame && !document.hidden && !reduce.matches) frame = requestAnimationFrame(tick); };
    size(); start();
    window.addEventListener('resize', function () { size(); }, { passive: true });
    document.addEventListener('visibilitychange', start);
    window.addEventListener('liss:background-change', function () { var colours = palette(); list.forEach(function (m, i) { m.c = colours[i % colours.length]; }); });
  }

  // Click ripples on buttons, cards and chips.
  document.addEventListener('pointerdown', function (event) {
    if (reduce.matches || event.button !== 0) return;
    var hit = event.target.closest && event.target.closest('.button,.btn,button,.post,.prompt-chips a,.write-orb,.feed-tabs a');
    if (!hit) return;
    var ripple = document.createElement('span');
    ripple.className = 'aurora-ripple';
    var card = hit.closest('.post');
    var tone = card ? getComputedStyle(card).getPropertyValue('--appearance-accent').trim() : '';
    if (tone) ripple.style.setProperty('--ripple-tone', tone);
    ripple.style.left = event.clientX + 'px'; ripple.style.top = event.clientY + 'px';
    document.body.appendChild(ripple);
    setTimeout(function () { ripple.remove(); }, 750);
  }, { passive: true });

  // Prompt chips open the composer and suggest a first line.
  document.querySelectorAll('.prompt-chips a[data-prompt]').forEach(function (chip) {
    chip.addEventListener('click', function (event) {
      var composer = document.getElementById('write');
      if (!composer || composer.tagName !== 'DETAILS') return;
      event.preventDefault();
      composer.open = true;
      composer.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'center' });
      var title = composer.querySelector('input[type=text],input:not([type]),textarea');
      if (title) {
        if ('placeholder' in title) title.placeholder = chip.dataset.prompt;
        setTimeout(function () { try { title.focus({ preventScroll: true }); } catch (error) { title.focus(); } }, reduce.matches ? 0 : 450);
      }
    });
  });

  // Writing page: a prompt (from a chip here or ?prompt= from the article list)
  // becomes the first line of an empty editor, with the cursor after it.
  var studio = document.querySelector('[data-write-studio]');
  if (studio) {
    var editorOf = function () { var node = studio.querySelector('.CodeMirror'); return node && node.CodeMirror; };
    var usePrompt = function (text, force) {
      var tries = 0;
      (function attempt() {
        var editor = editorOf(), textarea = studio.querySelector('textarea[name=body]');
        if (!editor && tries++ < 40) { setTimeout(attempt, 75); return; }
        if (editor) {
          if (editor.getValue().trim() && !force) { editor.focus(); return; }
          editor.setValue(text); editor.focus(); editor.setCursor(editor.lineCount(), 0);
        } else if (textarea && (!textarea.value.trim() || force)) { textarea.value = text; textarea.focus(); }
      }());
    };
    studio.querySelectorAll('[data-write-prompt]').forEach(function (button) {
      button.addEventListener('click', function () {
        var editor = editorOf(), current = editor ? editor.getValue().trim() : '';
        var known = [].map.call(studio.querySelectorAll('[data-write-prompt]'), function (b) { return b.dataset.writePrompt; });
        usePrompt(button.dataset.writePrompt, !current || known.indexOf(current) !== -1);
      });
    });
    try { var initial = new URLSearchParams(location.search).get('prompt'); if (initial) usePrompt(initial.slice(0, 80), false); } catch (error) {}
  }

  // The header and the orb slide away while reading down and return on the way up.
  var header = document.querySelector('.community-room .site-header');
  var orb = document.querySelector('[data-write-orb], .write-orb');
  var last = scrollY, ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = scrollY, delta = y - last, hide = y > 160 && delta > 8, show = y < 160 || delta < -6;
      if (header) header.dataset.scrolled = String(y > 24);
      // Near the footer the orb steps aside; its own call to write is right there.
      var nearEnd = y + innerHeight > document.documentElement.scrollHeight - 320;
      if (orb) { if (hide || nearEnd) orb.dataset.hidden = 'true'; else if (show) orb.dataset.hidden = 'false'; }
      if (Math.abs(delta) > 6) last = y;
    });
  }, { passive: true });
})();
