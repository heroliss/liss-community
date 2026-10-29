(function () {
  'use strict';
  var key = '__lissCommunityGallery';
  if (window[key] && typeof window[key].destroy === 'function') window[key].destroy();
  var lifetime = new AbortController(), dispose = null;
  function mount() {
    if (dispose) dispose();
    var abort = new AbortController(), signal = abort.signal;
    var reduce = matchMedia('(prefers-reduced-motion: reduce)'), fine = matchMedia('(hover:hover) and (pointer:fine)');
    var html = document.documentElement, records = [], closed = false, queued = false;
    var dialog = null, stage = null, plane = null, fullImage = null, caption = null, originalLink = null;
    var opener = null, sourceImage = null, state = 'closed', epoch = 0, animations = new Set();
    var frame = 0, last = 0, x = 0, y = 0, tx = 0, ty = 0, bounds = null, restoreOverflow = null;
    var selector = '.post-body img,.post-cover img[data-post-cover-image],.comment-body img,.editor-preview img,.editor-preview-side img';
    var canDialog = typeof HTMLDialogElement !== 'undefined' && typeof document.createElement('dialog').showModal === 'function';
    function el(tag, name) { var node = document.createElement(tag); if (name) node.className = name; return node; }
    function allowed() { return !closed && !document.hidden && !reduce.matches && html.dataset.roomMotion !== 'paused'; }
    function sourceUrl(image) {
      try { var url = new URL(image.currentSrc || image.src, location.href); return /^https?:$/.test(url.protocol) ? url.href : null; } catch (e) { return null; }
    }
    function closestRecord(image) { return records.find(function (record) { return record.image === image; }); }
    function releaseRecord(record, unwrap) {
      if (record.control && record.click) record.control.removeEventListener('click',record.click);
      if (unwrap && record.host.isConnected) record.host.replaceWith(record.image);
    }
    function announce() { document.dispatchEvent(new Event('liss:depth-content')); }
    function stopPointer() { if (frame) cancelAnimationFrame(frame); frame = 0; last = 0; }
    function paintPointer(now) {
      frame = 0;
      if (!dialog || !dialog.open || state === 'closing' || document.hidden || !allowed() || !fine.matches) { last = 0; return; }
      var dt = last ? Math.min(.08, (now-last)/1000) : 1/60; last = now;
      var k = 1-Math.exp(-dt/.16); x += (tx-x)*k; y += (ty-y)*k;
      plane.style.transform = 'rotateX('+(-y*4).toFixed(3)+'deg) rotateY('+(x*6).toFixed(3)+'deg) translateZ(8px)';
      if (Math.abs(tx-x)+Math.abs(ty-y) > .002) frame = requestAnimationFrame(paintPointer); else last = 0;
    }
    function schedulePointer() { if (!frame && dialog && dialog.open && state !== 'closing' && allowed() && fine.matches && !document.hidden) frame = requestAnimationFrame(paintPointer); }
    function cancelAnimations() { animations.forEach(function (animation) { animation.cancel(); }); animations.clear(); }
    function animate(node, frames, duration) {
      if (!allowed() || typeof node.animate !== 'function') return null;
      var animation = node.animate(frames,{duration:duration,easing:'cubic-bezier(.16,1,.3,1)',fill:'none'});
      animations.add(animation);
      animation.finished.then(function () { animations.delete(animation); },function () { animations.delete(animation); });
      return animation;
    }
    function originTransform(origin, target) {
      if (!origin || !target.width || !target.height || !origin.width || !origin.height) return null;
      var scale = Math.max(.04, Math.min(origin.width/target.width,origin.height/target.height));
      var dx = origin.left+origin.width/2-target.left-target.width/2;
      var dy = origin.top+origin.height/2-target.top-target.height/2;
      return 'translate3d('+dx.toFixed(2)+'px,'+dy.toFixed(2)+'px,-70px) scale('+scale.toFixed(5)+') rotateX(8deg) rotateY(-7deg)';
    }
    function restorePage() { if (restoreOverflow) { restoreOverflow(); restoreOverflow = null; } }
    function finishClose(focus) {
      if (!dialog) return;
      stopPointer(); cancelAnimations();
      if (dialog.open) dialog.close();
      state = 'closed'; stage.style.transform = ''; stage.style.opacity = ''; plane.style.transform = '';
      fullImage.removeAttribute('src'); restorePage();
      var previous = opener; opener = sourceImage = null; bounds = null; x = y = tx = ty = 0;
      if (focus && previous && previous.isConnected) previous.focus({preventScroll:true});
    }
    function closeViewer(focus) {
      if (!dialog || !dialog.open || state === 'closing') return;
      var token = ++epoch, initial = getComputedStyle(stage).transform;
      state = 'closing'; stopPointer(); cancelAnimations();
      var target = stage.getBoundingClientRect(), origin = sourceImage && sourceImage.isConnected ? sourceImage.getBoundingClientRect() : null;
      var destination = originTransform(origin,target);
      var animation = animate(stage,[{transform:initial === 'none' ? 'none' : initial,opacity:1},{transform:destination || 'translate3d(0,8px,-55px)',opacity:.05}],240);
      animate(plane,[{transform:getComputedStyle(plane).transform},{transform:'none'}],220);
      if (!animation) { finishClose(focus); return; }
      animation.finished.then(function () { if (!closed && token === epoch) finishClose(focus); },function () { if (!closed && token === epoch) finishClose(focus); });
    }
    function buildViewer() {
      if (dialog) return;
      dialog = el('dialog','community-image-viewer'); dialog.setAttribute('aria-label','图片查看器');
      var close = el('button','community-image-close'); close.type = 'button'; close.setAttribute('aria-label','关闭图片');
      var icon = document.createElementNS('http://www.w3.org/2000/svg','svg'); icon.setAttribute('class','icon'); icon.setAttribute('viewBox','0 0 24 24'); icon.setAttribute('aria-hidden','true');
      var path = document.createElementNS('http://www.w3.org/2000/svg','path'); path.setAttribute('d','M6 6l12 12M18 6L6 18'); path.setAttribute('stroke','currentColor'); path.setAttribute('stroke-width','1.7'); path.setAttribute('fill','none'); path.setAttribute('stroke-linecap','round'); icon.appendChild(path); close.appendChild(icon);
      stage = el('div','community-image-stage'); plane = el('div','community-image-plane'); fullImage = el('img'); fullImage.referrerPolicy = 'no-referrer';
      plane.appendChild(fullImage); stage.appendChild(plane); caption = el('p','community-image-caption');
      originalLink = el('a','community-image-original'); originalLink.textContent = '查看原图'; originalLink.target = '_blank'; originalLink.rel = 'noopener noreferrer';
      dialog.append(close,stage,caption,originalLink); document.body.appendChild(dialog);
      close.addEventListener('click',function () { closeViewer(true); },{signal:signal});
      dialog.addEventListener('cancel',function (event) { event.preventDefault(); closeViewer(true); },{signal:signal});
      dialog.addEventListener('click',function (event) { if (event.target === dialog) closeViewer(true); },{signal:signal});
      dialog.addEventListener('close',function () { if (state !== 'closed') { ++epoch; finishClose(true); } },{signal:signal});
      dialog.addEventListener('pointermove',function (event) {
        if (!allowed() || !fine.matches || event.pointerType === 'touch' || state === 'closing') return;
        if (!bounds) bounds = fullImage.getBoundingClientRect();
        tx = Math.max(-1,Math.min(1,(event.clientX-bounds.left)/Math.max(1,bounds.width)*2-1));
        ty = Math.max(-1,Math.min(1,(event.clientY-bounds.top)/Math.max(1,bounds.height)*2-1)); schedulePointer();
      },{passive:true,signal:signal});
      dialog.addEventListener('pointerleave',function () { tx = ty = 0; schedulePointer(); },{signal:signal});
      fullImage.addEventListener('error',function () { if (dialog.open) closeViewer(true); },{signal:signal});
    }
    function openViewer(image, control) {
      if (closed || !canDialog || !image.complete || !image.naturalWidth || !sourceUrl(image)) return;
      buildViewer(); ++epoch; stopPointer(); cancelAnimations();
      var token = epoch, origin = image.getBoundingClientRect();
      opener = control; sourceImage = image; x = y = tx = ty = 0; plane.style.transform = '';
      fullImage.width = image.naturalWidth; fullImage.height = image.naturalHeight; fullImage.alt = image.alt || '';
      caption.textContent = image.alt || ''; caption.hidden = !image.alt; originalLink.href = sourceUrl(image); fullImage.src = sourceUrl(image);
      var oldOverflow = html.style.getPropertyValue('overflow'), oldPriority = html.style.getPropertyPriority('overflow');
      if (!restoreOverflow) {
        restoreOverflow = function () { if (oldOverflow) html.style.setProperty('overflow',oldOverflow,oldPriority); else html.style.removeProperty('overflow'); };
        html.style.overflow = 'hidden';
      }
      try { if (!dialog.open) dialog.showModal(); } catch (error) { finishClose(false); return; }
      state = 'opening'; bounds = fullImage.getBoundingClientRect();
      var from = originTransform(origin,bounds), animation = from ? animate(stage,[{transform:from,opacity:.6},{transform:'none',opacity:1}],420) : null;
      if (animation) animation.finished.then(function () { if (!closed && token === epoch && state === 'opening') state = 'open'; },function () {});
      else state = 'open';
    }
    function wrap(image) {
      if (!image.isConnected || !image.matches(selector) || image.closest('.community-image-viewer,.depth-image-host,button,summary') || !image.complete || !image.naturalWidth || !sourceUrl(image)) return;
      var host = el('span','depth-image-host'); host.dataset.depthHost = ''; host.dataset.depthKind = 'image';
      var scroll = el('span','depth-scroll'), arrival = el('span','depth-arrival'), surface = el('span','depth-surface');
      host.appendChild(scroll); scroll.appendChild(arrival); arrival.appendChild(surface);
      var anchor = image.closest('a'), control = null;
      image.replaceWith(host);
      if (!anchor && canDialog && !image.closest('button')) {
        control = el('button','community-image-trigger'); control.type = 'button'; control.setAttribute('aria-label',image.alt ? '查看图片：'+image.alt : '查看图片');
        control.appendChild(image); surface.appendChild(control);
      } else { surface.appendChild(image); if (anchor && anchor.href === sourceUrl(image)) control = anchor; }
      var click = control ? function (event) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !image.naturalWidth) return;
        event.preventDefault(); openViewer(image,control);
      } : null;
      if (control) control.addEventListener('click',click);
      records.push({image:image,host:host,control:control,click:click}); announce();
    }
    function scan() {
      queued = false; if (closed) return;
      records = records.filter(function (record) { if (record.host.isConnected) return true; releaseRecord(record,false); return false; });
      document.querySelectorAll(selector).forEach(wrap);
    }
    function scheduleScan() { if (!closed && !queued) { queued = true; queueMicrotask(scan); } }
    var observer = new MutationObserver(function (entries) {
      if (records.some(function (record) { return !record.host.isConnected; }) || entries.some(function (entry) { return Array.from(entry.addedNodes).some(function (node) { return node.nodeType === 1 && !node.closest('.community-image-viewer') && (node.matches('img') || node.querySelector('img')); }); })) scheduleScan();
    }); observer.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('load',function (event) { if (event.target instanceof HTMLImageElement && event.target.matches(selector)) wrap(event.target); },{capture:true,signal:signal});
    document.addEventListener('error',function (event) {
      if (!(event.target instanceof HTMLImageElement)) return;
      var record = closestRecord(event.target); if (!record) return;
      releaseRecord(record,true);
      records = records.filter(function (item) { return item !== record; }); announce();
    },{capture:true,signal:signal});
    function gate() {
      if (document.hidden) {
        stopPointer(); animations.forEach(function (animation) { if (animation.playState === 'running') animation.pause(); }); return;
      }
      if (reduce.matches || !fine.matches) { stopPointer(); x = y = tx = ty = 0; if (plane) plane.style.transform = ''; }
      else if (!allowed()) stopPointer();
      else schedulePointer();
      if (!allowed()) {
        cancelAnimations();
        if (state === 'closing') finishClose(true); else if (state === 'opening') state = 'open';
      } else animations.forEach(function (animation) { if (animation.playState === 'paused') animation.play(); });
    }
    var stateObserver = new MutationObserver(gate); stateObserver.observe(html,{attributes:true,attributeFilter:['data-room-motion']});
    reduce.addEventListener('change',gate,{signal:signal}); fine.addEventListener('change',gate,{signal:signal});
    document.addEventListener('visibilitychange',gate,{signal:signal});
    window.addEventListener('resize',function () { bounds = null; },{passive:true,signal:signal});
    scan();
    dispose = function () {
      if (closed) return; closed = true; ++epoch; abort.abort(); observer.disconnect(); stateObserver.disconnect(); stopPointer(); cancelAnimations(); finishClose(false);
      if (dialog) dialog.remove();
      records.reverse().forEach(function (record) { releaseRecord(record,true); }); records = [];
    };
  }
  mount();
  window.addEventListener('pagehide',function () { if (dispose) dispose(); },{signal:lifetime.signal});
  window.addEventListener('pageshow',function (event) { if (event.persisted) mount(); },{signal:lifetime.signal});
  window[key] = {destroy:function () { if (dispose) dispose(); lifetime.abort(); delete window[key]; }};
})();
