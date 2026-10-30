(function () {
  'use strict';
  var key = '__lissCommunityGallery';
  if (window[key] && typeof window[key].destroy === 'function') window[key].destroy();
  var lifetime = new AbortController(), dispose = null;
  function mount() {
    if (dispose) dispose();
    var abort = new AbortController(), signal = abort.signal;
    var reduce = matchMedia('(prefers-reduced-motion: reduce)');
    var html = document.documentElement, records = [], closed = false, queued = false;
    var dialog = null, stage = null, plane = null, fullImage = null, caption = null, originalLink = null;
    var zoomOut = null, zoomIn = null, zoomFit = null, zoomLabel = null, sizeObserver = null;
    var opener = null, sourceImage = null, state = 'closed', epoch = 0, animations = new Set();
    var scale = 1, panX = 0, panY = 0, baseWidth = 1, baseHeight = 1, restoreOverflow = null;
    var pointers = new Map(), pinch = null;
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
    function constrainView(nextScale, nextX, nextY, width, height, viewportWidth, viewportHeight) {
      var value = Math.max(1,Math.min(8,nextScale));
      var edgeX = Math.max(0,(width*value-viewportWidth)/2), edgeY = Math.max(0,(height*value-viewportHeight)/2);
      return {scale:value,x:Math.max(-edgeX,Math.min(edgeX,nextX)),y:Math.max(-edgeY,Math.min(edgeY,nextY))};
    }
    function paintView(nextScale, nextX, nextY) {
      if (!stage || !plane) return;
      var value = constrainView(nextScale,nextX,nextY,baseWidth,baseHeight,stage.clientWidth,stage.clientHeight);
      scale = value.scale; panX = value.x; panY = value.y;
      plane.style.setProperty('--viewer-x',panX.toFixed(3)+'px'); plane.style.setProperty('--viewer-y',panY.toFixed(3)+'px'); plane.style.setProperty('--viewer-scale',scale.toFixed(5));
      plane.style.transform = 'translate(-50%,-50%) translate('+panX.toFixed(3)+'px,'+panY.toFixed(3)+'px) scale('+scale.toFixed(5)+')';
      dialog.dataset.viewerScale = scale.toFixed(5);
      stage.dataset.zoomed = scale > 1.001 ? 'true' : 'false';
      zoomLabel.textContent = Math.round(scale*100)+'%';
      zoomOut.disabled = scale <= 1.001; zoomIn.disabled = scale >= 7.999;
      zoomFit.disabled = scale <= 1.001 && Math.abs(panX)+Math.abs(panY) < .01;
    }
    function fitImage(reset) {
      if (!dialog || !dialog.open || !stage.clientWidth || !stage.clientHeight) return;
      var width = fullImage.naturalWidth || fullImage.width || 1, height = fullImage.naturalHeight || fullImage.height || 1;
      var fit = Math.min(1,Math.max(1,stage.clientWidth-24)/width,Math.max(1,stage.clientHeight-24)/height);
      baseWidth = width*fit; baseHeight = height*fit;
      plane.style.width = baseWidth+'px'; plane.style.height = baseHeight+'px';
      paintView(reset ? 1 : scale,reset ? 0 : panX,reset ? 0 : panY);
    }
    function stopGestures() {
      pointers.forEach(function (_, id) { try { if (stage.hasPointerCapture(id)) stage.releasePointerCapture(id); } catch (e) {} });
      pointers.clear(); pinch = null;
      if (stage) stage.dataset.dragging = 'false';
    }
    function beginInteraction() {
      if (!dialog || !dialog.open || state === 'closing') return false;
      if (state === 'opening') { cancelAnimations(); state = 'open'; }
      return true;
    }
    function zoomAt(nextScale, clientX, clientY) {
      if (!beginInteraction()) return;
      var rect = stage.getBoundingClientRect(), pointX = clientX-rect.left-rect.width/2, pointY = clientY-rect.top-rect.height/2;
      var value = Math.max(1,Math.min(8,nextScale)), ratio = value/scale;
      paintView(value,pointX-(pointX-panX)*ratio,pointY-(pointY-panY)*ratio);
    }
    function zoomCenter(multiplier) {
      var rect = stage.getBoundingClientRect(); zoomAt(scale*multiplier,rect.left+rect.width/2,rect.top+rect.height/2);
    }
    function resetView() { if (beginInteraction()) { stopGestures(); paintView(1,0,0); } }
    function pinchStart() {
      var points = Array.from(pointers.values());
      if (points.length < 2) { pinch = null; return; }
      var rect = stage.getBoundingClientRect();
      pinch = {distance:Math.max(1,Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)),scale:scale,x:panX,y:panY,
        centerX:(points[0].x+points[1].x)/2-rect.left-rect.width/2,centerY:(points[0].y+points[1].y)/2-rect.top-rect.height/2};
    }
    function endPointer(event) {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      try { if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId); } catch (e) {}
      pinchStart(); stage.dataset.dragging = pointers.size && scale > 1.001 ? 'true' : 'false';
    }
    function cancelAnimations() { animations.forEach(function (animation) { animation.cancel(); }); animations.clear(); }
    function animate(node, frames, duration) {
      if (!allowed() || typeof node.animate !== 'function') return null;
      var animation = node.animate(frames,{duration:duration,easing:'cubic-bezier(.16,1,.3,1)',fill:'none'});
      animations.add(animation);
      animation.finished.then(function () { animations.delete(animation); },function () { animations.delete(animation); });
      return animation;
    }
    function originTransform(origin, target, container) {
      if (!origin || !target.width || !target.height || !origin.width || !origin.height) return null;
      var scale = Math.max(.04, Math.min(origin.width/target.width,origin.height/target.height));
      container = container || target;
      var centerX = container.left+container.width/2, centerY = container.top+container.height/2;
      var dx = origin.left+origin.width/2-centerX-scale*(target.left+target.width/2-centerX);
      var dy = origin.top+origin.height/2-centerY-scale*(target.top+target.height/2-centerY);
      return 'translate('+dx.toFixed(2)+'px,'+dy.toFixed(2)+'px) scale('+scale.toFixed(5)+')';
    }
    function restorePage() { if (restoreOverflow) { restoreOverflow(); restoreOverflow = null; } }
    function finishClose(focus) {
      if (!dialog) return;
      stopGestures(); cancelAnimations();
      if (dialog.open) dialog.close();
      state = 'closed'; stage.style.transform = ''; stage.style.opacity = ''; plane.style.transform = '';
      fullImage.removeAttribute('src'); restorePage();
      var previous = opener; opener = sourceImage = null; scale = 1; panX = panY = 0;
      if (focus && previous && previous.isConnected) previous.focus({preventScroll:true});
    }
    function closeViewer(focus) {
      if (!dialog || !dialog.open || state === 'closing') return;
      var token = ++epoch, initial = getComputedStyle(stage).transform;
      state = 'closing'; stopGestures(); cancelAnimations();
      var target = plane.getBoundingClientRect(), origin = sourceImage && sourceImage.isConnected ? sourceImage.getBoundingClientRect() : null;
      var destination = originTransform(origin,target,stage.getBoundingClientRect());
      var animation = animate(stage,[{transform:initial === 'none' ? 'none' : initial,opacity:1},{transform:destination || 'scale(.985)',opacity:.05}],240);
      if (!animation) { finishClose(focus); return; }
      animation.finished.then(function () { if (!closed && token === epoch) finishClose(focus); },function () { if (!closed && token === epoch) finishClose(focus); });
    }
    function buildViewer() {
      if (dialog) return;
      dialog = el('dialog','community-image-viewer'); dialog.setAttribute('aria-label','图片查看器');
      var close = el('button','community-image-close'); close.type = 'button'; close.setAttribute('aria-label','关闭图片');
      var icon = document.createElementNS('http://www.w3.org/2000/svg','svg'); icon.setAttribute('class','icon'); icon.setAttribute('viewBox','0 0 24 24'); icon.setAttribute('aria-hidden','true');
      var path = document.createElementNS('http://www.w3.org/2000/svg','path'); path.setAttribute('d','M6 6l12 12M18 6L6 18'); path.setAttribute('stroke','currentColor'); path.setAttribute('stroke-width','1.7'); path.setAttribute('fill','none'); path.setAttribute('stroke-linecap','round'); icon.appendChild(path); close.appendChild(icon);
      var toolbar = el('div','community-image-toolbar'); toolbar.setAttribute('aria-label','图片操作'); toolbar.setAttribute('role','group');
      function tool(name, text) { var button = el('button',name); button.type = 'button'; button.textContent = text; return button; }
      zoomOut = tool('community-image-zoom-out','−'); zoomOut.setAttribute('aria-label','缩小图片');
      zoomIn = tool('community-image-zoom-in','+'); zoomIn.setAttribute('aria-label','放大图片');
      zoomLabel = el('output','community-image-zoom-label'); zoomLabel.setAttribute('aria-label','相对适应窗口的缩放比例');
      zoomFit = tool('community-image-fit','适应窗口');
      stage = el('div','community-image-stage'); stage.tabIndex = 0; stage.setAttribute('role','region'); stage.setAttribute('aria-label','图片画布，可滚轮缩放、拖动或双指查看，方向键移动，零键还原');
      plane = el('div','community-image-plane'); fullImage = el('img'); fullImage.referrerPolicy = 'no-referrer'; fullImage.draggable = false;
      plane.appendChild(fullImage); stage.appendChild(plane); caption = el('p','community-image-caption');
      originalLink = el('a','community-image-original'); originalLink.textContent = '查看原图'; originalLink.target = '_blank'; originalLink.rel = 'noopener noreferrer';
      var footer = el('div','community-image-footer'), help = el('span','community-image-help'); help.textContent = '滚轮 / 双指缩放 · 拖动查看 · 双击放大 / 还原';
      toolbar.append(zoomOut,zoomLabel,zoomIn,zoomFit,originalLink,close); footer.append(caption,help);
      dialog.append(toolbar,stage,footer); document.body.appendChild(dialog);
      zoomOut.addEventListener('click',function () { zoomCenter(1/1.3); },{signal:signal});
      zoomIn.addEventListener('click',function () { zoomCenter(1.3); },{signal:signal});
      zoomFit.addEventListener('click',resetView,{signal:signal});
      close.addEventListener('click',function () { closeViewer(true); },{signal:signal});
      dialog.addEventListener('cancel',function (event) { event.preventDefault(); closeViewer(true); },{signal:signal});
      dialog.addEventListener('click',function (event) { if (event.target === dialog) closeViewer(true); },{signal:signal});
      dialog.addEventListener('close',function () { if (state !== 'closed') { ++epoch; finishClose(true); } },{signal:signal});
      stage.addEventListener('wheel',function (event) {
        if (!beginInteraction()) return;
        event.preventDefault();
        var delta = event.deltaY*(event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
        zoomAt(scale*Math.exp(-Math.max(-160,Math.min(160,delta))*.0025),event.clientX,event.clientY);
      },{passive:false,signal:signal});
      stage.addEventListener('pointerdown',function (event) {
        if (event.button !== 0 || !beginInteraction() || (event.pointerType !== 'touch' && scale <= 1.001)) return;
        event.preventDefault(); pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
        try { stage.setPointerCapture(event.pointerId); } catch (e) {}
        pinchStart(); stage.dataset.dragging = scale > 1.001 ? 'true' : 'false';
      },{signal:signal});
      stage.addEventListener('pointermove',function (event) {
        var previous = pointers.get(event.pointerId); if (!previous || !beginInteraction()) return;
        event.preventDefault(); pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
        if (pointers.size > 1 && pinch) {
          var points = Array.from(pointers.values()), rect = stage.getBoundingClientRect();
          var value = Math.max(1,Math.min(8,pinch.scale*Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)/pinch.distance));
          var centerX = (points[0].x+points[1].x)/2-rect.left-rect.width/2, centerY = (points[0].y+points[1].y)/2-rect.top-rect.height/2;
          paintView(value,centerX-(pinch.centerX-pinch.x)*value/pinch.scale,centerY-(pinch.centerY-pinch.y)*value/pinch.scale);
        } else paintView(scale,panX+event.clientX-previous.x,panY+event.clientY-previous.y);
        stage.dataset.dragging = scale > 1.001 ? 'true' : 'false';
      },{signal:signal});
      stage.addEventListener('pointerup',endPointer,{signal:signal}); stage.addEventListener('pointercancel',endPointer,{signal:signal}); stage.addEventListener('lostpointercapture',endPointer,{signal:signal});
      stage.addEventListener('dblclick',function (event) { event.preventDefault(); if (scale > 1.001) resetView(); else zoomAt(2,event.clientX,event.clientY); },{signal:signal});
      stage.addEventListener('dragstart',function (event) { event.preventDefault(); },{signal:signal});
      dialog.addEventListener('keydown',function (event) {
        if (event.altKey || event.metaKey || event.ctrlKey || !beginInteraction()) return;
        var amount = event.shiftKey ? 160 : 64;
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomCenter(1.3); }
        else if (event.key === '-') { event.preventDefault(); zoomCenter(1/1.3); }
        else if (event.key === '0' || event.key === 'Home') { event.preventDefault(); resetView(); }
        else if (/^Arrow(Left|Right|Up|Down)$/.test(event.key)) {
          event.preventDefault(); paintView(scale,panX+(event.key === 'ArrowLeft' ? amount : event.key === 'ArrowRight' ? -amount : 0),panY+(event.key === 'ArrowUp' ? amount : event.key === 'ArrowDown' ? -amount : 0));
        }
      },{signal:signal});
      fullImage.addEventListener('load',function () { fitImage(false); },{signal:signal});
      fullImage.addEventListener('error',function () { if (dialog.open) closeViewer(true); },{signal:signal});
      if (typeof ResizeObserver === 'function') { sizeObserver = new ResizeObserver(function () { fitImage(false); }); sizeObserver.observe(stage); }
    }
    function openViewer(image, control) {
      if (closed || !canDialog || !image.complete || !image.naturalWidth || !sourceUrl(image)) return;
      buildViewer(); ++epoch; stopGestures(); cancelAnimations();
      var token = epoch, origin = image.getBoundingClientRect();
      opener = control; sourceImage = image; scale = 1; panX = panY = 0; plane.style.transform = '';
      fullImage.width = image.naturalWidth; fullImage.height = image.naturalHeight; fullImage.alt = image.alt || '';
      caption.textContent = image.alt || ''; caption.hidden = !image.alt; originalLink.href = sourceUrl(image); fullImage.src = sourceUrl(image);
      var oldOverflow = html.style.getPropertyValue('overflow'), oldPriority = html.style.getPropertyPriority('overflow');
      if (!restoreOverflow) {
        restoreOverflow = function () { if (oldOverflow) html.style.setProperty('overflow',oldOverflow,oldPriority); else html.style.removeProperty('overflow'); };
        html.style.overflow = 'hidden';
      }
      try { if (!dialog.open) dialog.showModal(); } catch (error) { finishClose(false); return; }
      state = 'opening'; fitImage(true); closeButtonFocus();
      var from = originTransform(origin,plane.getBoundingClientRect(),stage.getBoundingClientRect()), animation = from ? animate(stage,[{transform:from,opacity:.6},{transform:'none',opacity:1}],320) : null;
      if (animation) animation.finished.then(function () { if (!closed && token === epoch && state === 'opening') state = 'open'; },function () {});
      else state = 'open';
    }
    function closeButtonFocus() { var close = dialog.querySelector('.community-image-close'); if (close) close.focus({preventScroll:true}); }
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
        stopGestures(); animations.forEach(function (animation) { if (animation.playState === 'running') animation.pause(); }); return;
      }
      if (!allowed()) {
        cancelAnimations();
        if (state === 'closing') finishClose(true); else if (state === 'opening') state = 'open';
      } else animations.forEach(function (animation) { if (animation.playState === 'paused') animation.play(); });
    }
    var stateObserver = new MutationObserver(gate); stateObserver.observe(html,{attributes:true,attributeFilter:['data-room-motion']});
    reduce.addEventListener('change',gate,{signal:signal});
    document.addEventListener('visibilitychange',gate,{signal:signal});
    window.addEventListener('resize',function () { fitImage(false); },{passive:true,signal:signal});
    scan();
    dispose = function () {
      if (closed) return; closed = true; ++epoch; abort.abort(); observer.disconnect(); stateObserver.disconnect(); if (sizeObserver) sizeObserver.disconnect(); stopGestures(); cancelAnimations(); finishClose(false);
      if (dialog) dialog.remove();
      records.reverse().forEach(function (record) { releaseRecord(record,true); }); records = [];
    };
  }
  mount();
  window.addEventListener('pagehide',function () { if (dispose) dispose(); },{signal:lifetime.signal});
  window.addEventListener('pageshow',function (event) { if (event.persisted) mount(); },{signal:lifetime.signal});
  window[key] = {destroy:function () { if (dispose) dispose(); lifetime.abort(); delete window[key]; }};
})();
