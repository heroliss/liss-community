/* A quiet, layered atelier behind the actual conversation. Geometry is baked
   into three transparent depth plates; pointer frames only composite them. */
(function () {
  'use strict';
  var key = '__lissCommunityAtmosphere';
  if (window[key] && typeof window[key].destroy === 'function') window[key].destroy();
  var lifetime = new AbortController(), dispose = null;
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function mount() {
    if (dispose) dispose();
    if (!document.body || !document.body.classList.contains('community-room')) return;
    var body = document.body, html = document.documentElement;
    var abort = new AbortController(), signal = abort.signal;
    var reduce = matchMedia('(prefers-reduced-motion: reduce)');
    var fine = matchMedia('(hover:hover) and (pointer:fine)');
    var forced = matchMedia('(forced-colors: active)');
    var wrapper = document.createElement('div');
    wrapper.className = 'community-atmosphere'; wrapper.setAttribute('aria-hidden', 'true'); wrapper.inert = true;
    wrapper.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;';
    var canvas = document.createElement('canvas'); canvas.className = 'community-atmosphere-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;';
    wrapper.appendChild(canvas);
    var near = document.createElement('div'); near.className = 'community-atmosphere-near';
    ['rail', 'prism', 'caustic'].forEach(function (name) {
      var piece = document.createElement('span'); piece.className = 'atmosphere-near-' + name; near.appendChild(piece);
    });
    wrapper.appendChild(near); body.insertBefore(wrapper, body.firstChild);
    var context = canvas.getContext('2d', { alpha: true });
    if (!context) { wrapper.remove(); return; }
    var hadClass = body.classList.contains('has-atmosphere'); body.classList.add('has-atmosphere');
    var frame = 0, lastTime = 0, lastDraw = 0, closed = false, dirty = true, dirtySize = true;
    var width = 1, height = 1, dpr = 1, padding = 100, mobile = false, light = false, plates = [];
    var current = [0, 0, 0], target = [0, 0, 0], pointer = [0, 0];
    // The card controller publishes its damped dominant pose. These are a
    // counter-camera, never a second writer of card --depth-* properties.
    var scene = [0, 0, 50, 40, 0], sceneTarget = scene.slice();
    var sceneProperties = ['--scene-pan-x','--scene-pan-y','--scene-support-rx','--scene-support-ry','--scene-light-x','--scene-light-y'];
    var savedSceneProperties = sceneProperties.map(function (name) { return [name, body.style.getPropertyValue(name), body.style.getPropertyPriority(name)]; });
    var sceneWritten = {};
    var optics = [], opticsDirty = true, opticsObserver = null, opticsResizeObserver = null;
    var lastOptics = 0, opticScanQueued = false;
    var activeWindow = true, pressed = false, editing = false, selection = false, modal = false;
    var releaseTimer = 0, resizeObserver = null;
    var tones, sizeSignature = '';
    function alpha(color, opacity) { return 'rgba(' + color.join(',') + ',' + opacity + ')'; }
    function hueColor(hue,saturation,lightness) {
      var h=((hue%360)+360)%360/360,s=clamp(saturation,0,100)/100,l=lightness/100;
      function channel(n){var k=(n+h*12)%12,a=s*Math.min(l,1-l);return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1))));}
      return [channel(0),channel(8),channel(4)];
    }
    function stop() { if (frame) cancelAnimationFrame(frame); frame = 0; lastTime = 0; }
    function paused() { return html.dataset.roomMotion === 'paused'; }
    function held() { return pressed || editing || selection || modal || !activeWindow; }
    function blocked() { return closed || document.hidden || forced.matches || reduce.matches || paused() || held(); }
    function schedule() { if (!closed && !document.hidden && !frame) frame = requestAnimationFrame(paint); }
    function freeze() { stop(); target = current.slice(); sceneTarget = scene.slice(); }
    function scrollPosition() { return Math.tanh(Math.max(0, window.scrollY || 0) / 1800); }
    function readLocks() {
      var focused = document.activeElement;
      editing = !!(focused && focused.closest && focused.closest('input,textarea,select,[contenteditable="true"],.CodeMirror,.editor-toolbar'));
      var selected = window.getSelection(); selection = !!(selected && !selected.isCollapsed);
      modal = !!document.querySelector('dialog[open],.CodeMirror-fullscreen,.editor-preview-active-side');
    }
    function gate() {
      if (closed) return;
      readLocks();
      wrapper.dataset.atmosphereState = document.hidden ? 'hidden' : forced.matches ? 'contrast' : reduce.matches ? 'reduced' : paused() ? 'paused' : held() ? 'held' : 'ready';
      if (document.hidden) { freeze(); return; }
      if (forced.matches) { freeze(); return; }
      if (reduce.matches) { current = [0, 0, 0]; target = current.slice(); scene = [0, 0, 50, 40, 0]; sceneTarget = scene.slice(); dirty = true; schedule(); return; }
      if (paused() || held()) { freeze(); if (dirty || dirtySize) schedule(); return; }
      target[0] = fine.matches ? pointer[0] : 0; target[1] = fine.matches ? pointer[1] : 0;
      target[2] = scrollPosition() * (fine.matches ? 1 : .45); schedule();
    }
    function scanOptics() {
      opticScanQueued = false;
      if (closed) return;
      optics = optics.filter(function (optic) {
        if (optic.host.isConnected && optic.host.dataset.material === 'glass' && optic.leaf.isConnected) return true;
        if (opticsObserver) opticsObserver.unobserve(optic.host);
        if (opticsResizeObserver) opticsResizeObserver.unobserve(optic.surface);
        optic.canvas.width = optic.canvas.height = 1; optic.canvas.remove(); return false;
      });
      document.querySelectorAll('[data-material=glass] > .depth-scroll > .depth-arrival > .depth-surface > .material-shell > .material-refraction').forEach(function (leaf) {
        if (optics.some(function (optic) { return optic.leaf === leaf; })) return;
        var sample = document.createElement('canvas'); sample.className = 'material-optic-sample'; sample.setAttribute('aria-hidden', 'true');
        var ctx = sample.getContext('2d', { alpha: true }); if (!ctx) return;
        leaf.appendChild(sample);
        var host = leaf.closest('[data-material]'), surface = leaf.parentElement.parentElement;
        optics.push({ host: host, leaf: leaf, surface: surface, canvas: sample, context: ctx, visible: !opticsObserver });
        if (opticsObserver) opticsObserver.observe(host);
        if (opticsResizeObserver) opticsResizeObserver.observe(surface);
      });
      opticsDirty = true; dirty = true; schedule();
    }
    function queueOpticScan() {
      if (opticScanQueued || closed) return;
      opticScanQueued = true; queueMicrotask(scanOptics);
    }
    // All box reads happen together, before CSS writes in draw(). Sampling
    // reads our own procedural canvas only: user images never taint it.
    function readOptics() {
      if (forced.matches) return [];
      return optics.filter(function (optic) { return optic.visible && optic.host.isConnected; }).map(function (optic) {
        var rect = optic.surface.getBoundingClientRect();
        return { optic: optic, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      }).filter(function (item) { return item.width > 2 && item.height > 2 && item.top < height + 80 && item.top + item.height > -80; });
    }
    function sampleOptics(items) {
      items.forEach(function (item) {
        var optic = item.optic, scale = Math.min(.8, 1000 / item.width, 900 / item.height);
        // Small perspective changes must not reallocate the pixel buffer.
        var w = Math.max(1, Math.min(1000, Math.ceil(item.width * scale / 64) * 64));
        var h = Math.max(1, Math.min(900, Math.ceil(item.height * scale / 64) * 64));
        if (optic.canvas.width !== w) optic.canvas.width = w;
        if (optic.canvas.height !== h) optic.canvas.height = h;
        var ctx = optic.context, edge = mobile ? 6 : 8;
        ctx.setTransform(w / item.width, 0, 0, h / item.height, 0, 0); ctx.clearRect(0, 0, item.width, item.height);
        // About 28px of adjacent scenery is compressed through an 8px bevel;
        // the extra offset differentiates it from mere background blur.
        function strip(sx, sy, sw, sh, dx, dy, dw, dh) {
          var x = clamp(sx, 0, width), y = clamp(sy, 0, height);
          var right = clamp(sx + sw, 0, width), bottom = clamp(sy + sh, 0, height);
          if (right <= x || bottom <= y || dw <= 0 || dh <= 0) return;
          ctx.drawImage(canvas, x * dpr, y * dpr, (right - x) * dpr, (bottom - y) * dpr,
            dx + (x - sx) / sw * dw, dy + (y - sy) / sh * dh, (right - x) / sw * dw, (bottom - y) / sh * dh);
        }
        ctx.globalAlpha = .95;
        var bend = 18 + scene[1] * .3;
        strip(item.left - bend, item.top + 3, 28, item.height, 0, 0, edge, item.height);
        strip(item.left + item.width - 10, item.top - 4, 28, item.height, item.width - edge, 0, edge, item.height);
        strip(item.left + 5, item.top - 17, item.width, 28, edge, 0, item.width - edge * 2, edge);
        strip(item.left - 4, item.top + item.height - 10, item.width, 28, edge, item.height - edge, item.width - edge * 2, edge);
        ctx.globalAlpha = 1;
      });
      opticsDirty = false;
    }
    function project(x, y, z) {
      var focal = Math.max(720, width * .92), ratio = focal / (focal + z);
      return { x: width * .54 + x * ratio, y: height * .40 + y * ratio, z: z };
    }
    function path(ctx, points, close) {
      if (!points.length) return;
      ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach(function (point) { ctx.lineTo(point.x, point.y); });
      if (close) ctx.closePath();
    }
    function glow(ctx, x, y, radius, color, opacity, stretch) {
      ctx.save(); ctx.translate(x, y); ctx.scale(1, stretch || 1);
      var gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      gradient.addColorStop(0, alpha(color, opacity)); gradient.addColorStop(.4, alpha(color, opacity * .45)); gradient.addColorStop(1, alpha(color, 0));
      ctx.fillStyle = gradient; ctx.fillRect(-radius, -radius, radius * 2, radius * 2); ctx.restore();
    }
    function ribbon(ctx, side, depth, opacity, options) {
      options = options || {};
      var a = [], b = [], back = [], count = mobile ? 30 : 46;
      var span = Math.max(40, width * (options.span || (side < 0 ? .082 : .078)));
      for (var i = 0; i <= count; i++) {
        var t = i / count, angle = t * Math.PI * (options.arc || 1.2) + (options.phase === undefined ? side < 0 ? .25 : -.45 : options.phase);
        var x = side * width * (options.offset || .55) + Math.sin(angle) * width * (options.bend || .13) * -side;
        var y = height * (options.start === undefined ? -.61 : options.start) + t * height * (options.length || 1.75);
        var z = depth + Math.cos(angle) * 150;
        var taper = .12 + Math.pow(Math.sin(t * Math.PI), .65) * .88;
        a.push(project(x, y, z));
        b.push(project(x + Math.cos(t * Math.PI) * span * taper, y + Math.sin(t * Math.PI) * 36, z + 48));
        back.push(project(x + 11 * side * taper, y + 8 * taper, z + 22));
      }
      var edge = side < 0 ? tones.mint : tones.blue;
      var end = a[a.length - 1];
      var face = ctx.createLinearGradient(a[0].x, a[0].y, end.x, end.y);
      face.addColorStop(0, alpha(edge, 0)); face.addColorStop(.18, alpha(edge, opacity * .8));
      face.addColorStop(.53, alpha(edge, opacity)); face.addColorStop(.86, alpha(edge, opacity * .32)); face.addColorStop(1, alpha(edge, 0));
      ctx.save(); ctx.globalAlpha = .72;
      path(ctx, a.concat(back.slice().reverse()), true); ctx.fillStyle = face; ctx.fill(); ctx.restore();
      path(ctx, a.concat(b.slice().reverse()), true); ctx.fillStyle = face;
      ctx.shadowColor = light ? 'rgba(48,68,58,.09)' : 'rgba(0,7,11,.35)'; ctx.shadowBlur = 16; ctx.shadowOffsetX = side * 9; ctx.shadowOffsetY = 16;
      ctx.fill(); ctx.shadowColor = 'transparent'; ctx.shadowBlur = ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
      var glint = ctx.createLinearGradient(a[0].x, a[0].y, end.x, end.y);
      glint.addColorStop(0, alpha(edge, 0)); glint.addColorStop(.24, alpha(edge, opacity * 1.65));
      glint.addColorStop(.64, alpha(edge, opacity * 1.15)); glint.addColorStop(1, alpha(edge, 0));
      path(ctx, a, false); ctx.strokeStyle = glint; ctx.lineWidth = 1.25; ctx.stroke();
      path(ctx, b, false); ctx.strokeStyle = alpha(edge, opacity * .43); ctx.lineWidth = .8; ctx.stroke();
    }
    function sweptRail(ctx, opacity) {
      var front = [], back = [], count = mobile ? 40 : 68;
      for (var i = 0; i <= count; i++) {
        var t = i / count * Math.PI * 1.53 + .10;
        var x = Math.cos(t) * width * .72 + width * .13;
        var y = height * .78 + Math.sin(t) * height * .21;
        var z = 260 + Math.sin(t) * 150;
        front.push(project(x, y, z)); back.push(project(x, y + 18, z + 22));
      }
      var gradient = ctx.createLinearGradient(0, height * .63, width, height * 1.12);
      gradient.addColorStop(0, alpha(tones.mint, 0)); gradient.addColorStop(.27, alpha(tones.mint, opacity * .56));
      gradient.addColorStop(.7, alpha(tones.warm, opacity)); gradient.addColorStop(1, alpha(tones.warm, 0));
      path(ctx, front.concat(back.slice().reverse()), true); ctx.fillStyle = gradient; ctx.fill();
      path(ctx, front, false); ctx.strokeStyle = gradient; ctx.lineWidth = 1.4; ctx.stroke();
    }
    function studioFold(ctx) {
      var a = [], b = [], count = mobile ? 32 : 54;
      for (var i = 0; i <= count; i++) {
        var t = i / count, x = width * (-.72 + t * 1.55);
        var y = height * (.33 + Math.sin(t * Math.PI * 1.08) * .38), z = 470 + Math.sin(t * Math.PI) * 180;
        a.push(project(x, y, z)); b.push(project(x + 12, y + 52, z + 40));
      }
      var gradient = ctx.createLinearGradient(0, height * .45, width, height * .75);
      gradient.addColorStop(0, alpha(tones.blue, 0)); gradient.addColorStop(.20, alpha(tones.blue, light ? .05 : .12));
      gradient.addColorStop(.58, alpha(tones.mint, light ? .08 : .14)); gradient.addColorStop(1, alpha(tones.mint, 0));
      path(ctx, a.concat(b.slice().reverse()), true); ctx.fillStyle = gradient; ctx.fill();
      path(ctx, a, false); ctx.lineWidth = 1.2; ctx.strokeStyle = gradient; ctx.stroke();
    }
    function centerQuiet(ctx, amount) {
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      ctx.translate(width * .42, height * .45); ctx.scale(1, 1.12);
      var radius = width * .46, mask = ctx.createRadialGradient(0, 0, radius * .1, 0, 0, radius);
      mask.addColorStop(0, 'rgba(0,0,0,' + amount + ')'); mask.addColorStop(.6, 'rgba(0,0,0,' + amount * .65 + ')'); mask.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = mask; ctx.fillRect(-radius, -radius, radius * 2, radius * 2); ctx.restore();
    }
    function asideQuiet(ctx, amount) {
      if (width < 1050) return;
      // An ellipse, not a column scrim: structure stays legible at the outer
      // edge while the actual aside copy sits in a quieter pool of distance.
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      var radius = width * .172;
      ctx.translate(width * .85, height * .43); ctx.scale(1, height * .49 / radius);
      var mask = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      mask.addColorStop(0, 'rgba(0,0,0,' + amount + ')');
      mask.addColorStop(.54, 'rgba(0,0,0,' + amount * .78 + ')'); mask.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = mask; ctx.fillRect(-radius, -radius, radius * 2, radius * 2); ctx.restore();
    }
    function bake(layer) {
      var plate = document.createElement('canvas');
      plate.width = Math.max(1, Math.floor((width + padding * 2) * dpr)); plate.height = Math.max(1, Math.floor((height + padding * 2) * dpr));
      var ctx = plate.getContext('2d', { alpha: true });
      if (!ctx) return null;
      ctx.setTransform(dpr, 0, 0, dpr, padding * dpr, padding * dpr);
      var strength = mobile ? .68 : 1;
      if (layer === 0) {
        glow(ctx, width * .91, height * .21, width * .46, tones.mint, (light ? .07 : .14) * strength, 1.2);
        glow(ctx, width * .04, height * .65, width * .38, tones.blue, (light ? .045 : .085) * strength, 1.25);
        glow(ctx, width * .65, height * 1.05, width * .44, tones.warm, (light ? .035 : .065) * strength, .55);
        ctx.save(); ctx.filter = 'blur(' + (mobile ? 2 : 4) + 'px)';
        ribbon(ctx, 1, 1050, (light ? .035 : .060) * strength,
          { offset: .67, phase: -1.4, arc: .95, start: -.62, length: .80, bend: .16, span: .044 });
        ribbon(ctx, -1, 1200, (light ? .030 : .060) * strength,
          { offset: .65, phase: 2.1, arc: 1.50, start: -.18, length: 1.05, bend: .20, span: .035 });
        ctx.restore();
        var lenses = [[.09, .20, 26], [.83, .12, 38], [.95, .68, 20], [.12, .86, 32], [.72, .80, 16]];
        lenses.slice(0, mobile ? 3 : lenses.length).forEach(function (p, i) {
          glow(ctx, width * p[0], height * p[1], p[2] * (mobile ? .7 : 1), i % 2 ? tones.warm : tones.mint, light ? .045 : .085, .8);
        });
        asideQuiet(ctx, .26);
      } else if (layer === 1) {
        ribbon(ctx, -1, 230, (light ? .075 : .145) * strength);
        ribbon(ctx, 1, 360, (light ? .07 : .135) * strength, { offset: .68, bend: .13, start: -.66, length: 1.70 });
        studioFold(ctx);
        centerQuiet(ctx, .36);
        asideQuiet(ctx, .66);
      } else {
        glow(ctx, width * .60, height * .99, width * .79, tones.mint, (light ? .065 : .105) * strength, .27);
        ctx.save(); ctx.translate(width * .61, height * 1.025); ctx.rotate(-.08); ctx.scale(1, .18);
        var radius = width * .65, shadow = ctx.createRadialGradient(0, 0, radius * .08, 0, 0, radius);
        shadow.addColorStop(0, light ? 'rgba(35,52,44,.075)' : 'rgba(0,9,13,.25)'); shadow.addColorStop(.55, light ? 'rgba(35,52,44,.04)' : 'rgba(0,9,13,.14)'); shadow.addColorStop(1, 'rgba(0,9,13,0)');
        ctx.fillStyle = shadow; ctx.fillRect(-radius, -radius, radius * 2, radius * 2); ctx.restore();
        // The room's broad floor and independent objects supply depth. A long
        // bright rail across every route read as an unrelated floating line.
        glow(ctx, width * .22, height * 1.01, width * .19, tones.warm, (light ? .035 : .065) * strength, .22);
        glow(ctx, width * .98, height * .91, width * .17, tones.mint, (light ? .045 : .085) * strength, .28);
        centerQuiet(ctx, .40);
        asideQuiet(ctx, .34);
      }
      return plate;
    }
    function resize() {
      dirtySize = false;
      var bounds = wrapper.getBoundingClientRect(); width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
      mobile = width < 700;
      // Bound the main composite plus all three overscan plates together.
      // These soft distant surfaces may render below CSS-pixel resolution on
      // large displays; text and foreground DOM retain native sharpness.
      var pixelArea = width * height + 3 * (width + padding * 2) * (height + padding * 2);
      dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5, Math.sqrt(16000000 / pixelArea));
      light = html.dataset.theme === 'light';
      var themed=body.hasAttribute('data-community-theme'),computed=getComputedStyle(body);
      var selectedHue=parseFloat(computed.getPropertyValue('--community-hue')),selectedSat=parseFloat(computed.getPropertyValue('--community-saturation'));
      if(!Number.isFinite(selectedHue))selectedHue=150;if(!Number.isFinite(selectedSat))selectedSat=45;
      var signature = [width, height, dpr, light,themed,selectedHue,selectedSat].join(':');
      if (signature === sizeSignature) return;
      sizeSignature = signature;
      tones = light ? { mint: [74, 121, 102], blue: [85, 124, 143], warm: [146, 119, 76] } :
        { mint: [118, 187, 155], blue: [115, 157, 181], warm: [208, 177, 122] };
      if(themed)tones={mint:hueColor(selectedHue,selectedSat,light?43:64),blue:hueColor(selectedHue+16,selectedSat*.65,light?47:67),warm:hueColor(selectedHue-12,selectedSat*.5,light?49:70)};
      canvas.width = Math.max(1, Math.floor(width * dpr)); canvas.height = Math.max(1, Math.floor(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      plates.forEach(function (plate) { if (plate) plate.width = plate.height = 1; });
      plates = [bake(0), bake(1), bake(2)]; dirty = true;
    }
    function draw() {
      context.clearRect(0, 0, width, height);
      var depths = [5, 15, 28], scrolls = [13, 35, 68], coarse = fine.matches ? 1 : .45;
      plates.forEach(function (plate, index) {
        if (!plate) return;
        var camera = (index + 1) * .24;
        var dx = current[0] * depths[index] * coarse - scene[1] * camera;
        var dy = current[1] * depths[index] * .65 * coarse - current[2] * scrolls[index] + scene[0] * camera - scene[4] * (index + 1) * 2;
        context.save(); context.translate(width * .5 + dx, height * .5 + dy);
        context.rotate(current[0] * .0013 * (index + 1) - scene[1] * .00016 * (index + 1));
        context.drawImage(plate, -width * .5 - padding, -height * .5 - padding, width + padding * 2, height + padding * 2); context.restore();
      });
      wrapper.style.setProperty('--atmosphere-x', (current[0] * 22).toFixed(2) + 'px');
      wrapper.style.setProperty('--atmosphere-y', (current[1] * 15 - current[2] * 27).toFixed(2) + 'px');
      wrapper.style.setProperty('--atmosphere-tilt-x', (-current[1] * 2.5).toFixed(2) + 'deg');
      wrapper.style.setProperty('--atmosphere-tilt-y', (current[0] * 3.5).toFixed(2) + 'deg');
      wrapper.style.setProperty('--atmosphere-light-x', (50 + current[0] * 20).toFixed(2) + '%');
      wrapper.style.setProperty('--atmosphere-light-y', (35 + current[1] * 15).toFixed(2) + '%');
      function writeScene(name, value) {
        if (sceneWritten[name] === value) return;
        body.style.setProperty(name, value); sceneWritten[name] = value;
      }
      writeScene('--scene-pan-x', (-scene[1] * .62).toFixed(2) + 'px');
      writeScene('--scene-pan-y', (scene[0] * .5 - scene[4] * 4).toFixed(2) + 'px');
      writeScene('--scene-support-rx', (scene[0] * .12).toFixed(2) + 'deg');
      writeScene('--scene-support-ry', (scene[1] * .15).toFixed(2) + 'deg');
      writeScene('--scene-light-x', scene[2].toFixed(2) + '%');
      writeScene('--scene-light-y', scene[3].toFixed(2) + '%');
      dirty = false;
    }
    function paint(now) {
      frame = 0; if (closed || document.hidden) return;
      if (dirtySize) resize();
      var unsettled = false, elapsed = lastTime ? Math.min(50, now - lastTime) : 16; lastTime = now;
      if (!blocked()) {
        var blend = 1 - Math.exp(-elapsed / 170);
        current.forEach(function (value, index) {
          var difference = target[index] - value;
          if (Math.abs(difference) > .002) { current[index] += difference * blend; unsettled = true; } else current[index] = target[index];
        });
        var sceneBlend = 1 - Math.exp(-elapsed / 225);
        scene.forEach(function (value, index) {
          var difference = sceneTarget[index] - value;
          if (Math.abs(difference) > .015) { scene[index] += difference * sceneBlend; unsettled = true; } else scene[index] = sceneTarget[index];
        });
      }
      // Cap only expensive full-canvas composites, not the input controller.
      if (dirty || !lastDraw || now - lastDraw >= 1000 / 60 || !unsettled) {
        var sampleNow = opticsDirty || !lastOptics || now - lastOptics >= 1000 / 30 || !unsettled;
        var opticBoxes = sampleNow ? readOptics() : [];
        draw(); lastDraw = now;
        if (sampleNow) { sampleOptics(opticBoxes); lastOptics = now; }
      }
      if (unsettled && !blocked()) schedule(); else lastTime = 0;
    }
    function invalidate() { dirtySize = true; dirty = true; schedule(); }
    document.addEventListener('pointermove', function (event) {
      if (event.pointerType === 'touch' || !fine.matches || blocked()) return;
      pointer = [clamp(event.clientX / Math.max(1, width) * 2 - 1, -1, 1), clamp(event.clientY / Math.max(1, height) * 2 - 1, -1, 1)];
      target[0] = pointer[0]; target[1] = pointer[1]; schedule();
    }, { passive: true, signal: signal });
    document.addEventListener('pointerleave', function () { pointer = [0, 0]; if (!blocked()) { target[0] = target[1] = 0; schedule(); } }, { passive: true, signal: signal });
    document.addEventListener('pointerdown', function (event) { if (event.isPrimary && event.button === 0) { pressed = true; freeze(); } }, { capture: true, passive: true, signal: signal });
    function release() {
      if (releaseTimer) clearTimeout(releaseTimer);
      releaseTimer = setTimeout(function () { releaseTimer = 0; pressed = false; gate(); }, 0);
    }
    window.addEventListener('pointerup', release, { passive: true, signal: signal });
    window.addEventListener('pointercancel', release, { passive: true, signal: signal });
    document.addEventListener('scroll', function () { if (!blocked()) { target[2] = scrollPosition() * (fine.matches ? 1 : .45); schedule(); } }, { passive: true, signal: signal });
    document.addEventListener('focusin', gate, { signal: signal }); document.addEventListener('focusout', function () { queueMicrotask(function () { if (!closed) gate(); }); }, { signal: signal });
    document.addEventListener('selectionchange', gate, { signal: signal });
    document.addEventListener('visibilitychange', gate, { signal: signal });
    window.addEventListener('blur', function () { activeWindow = false; pressed = false; gate(); }, { signal: signal });
    window.addEventListener('focus', function () { activeWindow = true; gate(); }, { signal: signal });
    window.addEventListener('resize', invalidate, { passive: true, signal: signal });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', invalidate, { passive: true, signal: signal });
    reduce.addEventListener('change', gate, { signal: signal });
    forced.addEventListener('change', gate, { signal: signal });
    fine.addEventListener('change', function () { pointer = [0, 0]; if (!fine.matches) current[0] = current[1] = 0; dirty = true; gate(); }, { signal: signal });
    window.addEventListener('liss:motion-state', gate, { signal: signal });
    window.addEventListener('liss:theme-change',function(){sizeSignature='';dirtySize=true;dirty=true;schedule();},{signal:signal});
    window.addEventListener('liss:spatial-frame', function (event) {
      var detail = event.detail;
      if (!detail || detail.active === false) { sceneTarget = scene.slice(); return; }
      if (blocked()) return;
      function value(name, fallback, min, max) {
        var number = Number(detail[name]); return Number.isFinite(number) ? clamp(number, min, max) : fallback;
      }
      sceneTarget = [value('rx',0,-35,35),value('ry',0,-35,35),value('lightX',50,0,100),value('lightY',40,0,100),value('scroll',0,0,1)];
      schedule();
    }, { signal: signal });
    var stateObserver = new MutationObserver(function (entries) {
      if (entries.some(function (entry) { return entry.attributeName === 'data-theme'; })) { dirtySize = true; dirty = true; }
      gate();
    }); stateObserver.observe(html, { attributes: true, attributeFilter: ['data-theme', 'data-room-motion'] });
    var dialogObserver = new MutationObserver(gate); dialogObserver.observe(body, { attributes: true, subtree: true, attributeFilter: ['open'] });
    if (window.ResizeObserver) { resizeObserver = new ResizeObserver(invalidate); resizeObserver.observe(wrapper); }
    if (window.IntersectionObserver) {
      opticsObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          optics.forEach(function (optic) {
            if (optic.host !== entry.target) return;
            optic.visible = entry.isIntersecting;
            // Release old GPU/bitmap storage beyond the warm-up margin. A
            // 1px alpha canvas is transparent, so re-entry never flashes white.
            if (!optic.visible) optic.canvas.width = optic.canvas.height = 1;
          });
        });
        opticsDirty = true; dirty = true; schedule();
      }, { rootMargin: '80px', threshold: [0, .01] });
    }
    if (window.ResizeObserver) {
      opticsResizeObserver = new ResizeObserver(function () { opticsDirty = true; dirty = true; schedule(); });
    }
    var opticMutationObserver = new MutationObserver(queueOpticScan);
    opticMutationObserver.observe(body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-material'] });
    scanOptics();
    readLocks(); if (!reduce.matches && !paused()) current[2] = target[2] = scrollPosition() * (fine.matches ? 1 : .45); gate();
    window.dispatchEvent(new Event('liss:spatial-request'));
    dispose = function () {
      if (closed) return; closed = true; stop(); abort.abort(); stateObserver.disconnect(); dialogObserver.disconnect();
      if (resizeObserver) resizeObserver.disconnect(); if (releaseTimer) clearTimeout(releaseTimer);
      opticMutationObserver.disconnect(); if (opticsObserver) opticsObserver.disconnect(); if (opticsResizeObserver) opticsResizeObserver.disconnect();
      optics.forEach(function (optic) { optic.canvas.width = optic.canvas.height = 1; optic.canvas.remove(); }); optics = [];
      savedSceneProperties.forEach(function (entry) { if (entry[1]) body.style.setProperty(entry[0],entry[1],entry[2]); else body.style.removeProperty(entry[0]); });
      plates.forEach(function (plate) { if (plate) plate.width = plate.height = 1; }); plates = [];
      canvas.width = canvas.height = 1; wrapper.remove(); if (!hadClass) body.classList.remove('has-atmosphere');
    };
  }
  window.addEventListener('pagehide', function () { if (dispose) dispose(); }, { signal: lifetime.signal });
  window.addEventListener('pageshow', function (event) { if (event.persisted) mount(); }, { signal: lifetime.signal });
  window[key] = { destroy: function () { if (dispose) dispose(); lifetime.abort(); delete window[key]; } };
  mount();
})();
