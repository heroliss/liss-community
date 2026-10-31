/* Progressive conversation controls: native links/forms remain the fallback. */
(function () {
  'use strict';
  var section = document.querySelector('[data-thread]');
  if (!section) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var finePointer = window.matchMedia('(hover:hover) and (pointer:fine)');
  var forcedColors = window.matchMedia('(forced-colors: active)');
  var composer = section.querySelector('[data-thread-composer]');
  var home = section.querySelector('[data-thread-home]');
  var form = composer && composer.querySelector('form');
  var textarea = form && form.querySelector('textarea[name=body]');
  var feed = section.querySelector('[data-thread-feed]');
  var feedback = composer && composer.querySelector('[data-thread-feedback]');
  var cancel = composer && composer.querySelector('[data-thread-cancel]');
  var quote = composer && composer.querySelector('[data-thread-compose-quote]');
  var heading = composer && composer.querySelector('[data-thread-editor-title]');
  var submit = form && form.querySelector('[type=submit]');
  var draft = window.LissWritingDrafts;
  var enhance = !!(section.dataset.threadJson === 'true' && form && textarea && feed && draft && window.fetch && window.FormData && window.AbortController);
  var busy = false, selected = null, activeContext = null, linked = null, frame = 0, lineAnimation = null;
  var returnPosition = null;
  var composing = false, outsideGesture = null, editorRevision = 0;
  var returnBar = section.querySelector('[data-thread-return]');
  var footer = document.querySelector('.reading-footer');
  var composePanel = composer && composer.querySelector('[data-thread-compose-panel]');
  var canCollapse = !!(enhance && composePanel && composePanel !== composer);
  var scopeBase = form ? form.dataset.writingScope.split('#reply:')[0] : '';
  var svg, path, dot, runway = null, runwayHeight = 0;
  var tiltFrame = 0, tiltSurface = null, tiltPoint = null;
  function motion() { return !reduce.matches && document.documentElement.dataset.roomMotion !== 'paused'; }
  function clearTilt() {
    if (tiltFrame) { cancelAnimationFrame(tiltFrame); tiltFrame = 0; }
    if (tiltSurface) {
      tiltSurface.style.removeProperty('--thread-tilt-x');
      tiltSurface.style.removeProperty('--thread-tilt-y');
    }
    tiltSurface = tiltPoint = null;
  }
  function followTilt(event) {
    if (!finePointer.matches || forcedColors.matches || !motion() || section.dataset.threadLayout !== 'scatter' || event.pointerType && event.pointerType !== 'mouse') { clearTilt(); return; }
    var surface = event.target.closest && event.target.closest('.thread-message');
    if (!surface || !section.contains(surface) || surface.parentElement.classList.contains('has-inline-editor')) { clearTilt(); return; }
    if (tiltSurface !== surface) { clearTilt(); tiltSurface = surface; }
    tiltPoint = { x: event.clientX, y: event.clientY };
    if (tiltFrame) return;
    tiltFrame = requestAnimationFrame(function () {
      tiltFrame = 0;
      if (!tiltSurface || !tiltSurface.isConnected || !tiltPoint) return;
      var bounds = tiltSurface.getBoundingClientRect();
      var x = Math.max(-1, Math.min(1, (tiltPoint.x - bounds.left) / Math.max(1, bounds.width) * 2 - 1));
      var y = Math.max(-1, Math.min(1, (tiltPoint.y - bounds.top) / Math.max(1, bounds.height) * 2 - 1));
      tiltSurface.style.setProperty('--thread-tilt-x', (-y * 1.5).toFixed(2) + 'deg');
      tiltSurface.style.setProperty('--thread-tilt-y', (x * 1.9).toFixed(2) + 'deg');
    });
  }
  function reveal(node) {
    if (motion() && node.animate) node.animate([{ opacity: .45, clipPath: 'inset(0 0 14% 0)' }, { opacity: 1, clipPath: 'inset(0)' }], { duration: 200, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  function scrollMetrics() {
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
      runway = document.createElement('div'); runway.setAttribute('data-thread-scroll-runway', ''); runway.setAttribute('aria-hidden', 'true');
      Object.assign(runway.style, { display: 'block', margin: '0', padding: '0', border: '0', minHeight: '0', maxHeight: 'none', pointerEvents: 'none', overflowAnchor: 'none', flex: 'none' });
      section.appendChild(runway);
    }
    runway.style.height = height + 'px'; runwayHeight = height;
  }
  function releaseRunway() {
    if (!runwayHeight) return;
    var metrics = scrollMetrics(); if (!metrics) return;
    var removable = window.scrollY <= .5 ? runwayHeight : Math.min(runwayHeight, Math.floor(Math.max(0, metrics.height - metrics.viewport - window.scrollY)));
    if (removable) setRunway(runwayHeight - removable);
  }
  function keepPlace(anchor, update) {
    var before = anchor && anchor.isConnected ? anchor.getBoundingClientRect().top : null;
    update();
    if (before !== null && anchor.isConnected) {
      // A shorter document can clamp scrollY before this layout read. Restore
      // its required range at the discussion end, rather than leaving a tall
      // collapsed editor or trying to scroll beyond the new document bottom.
      var after = anchor.getBoundingClientRect().top;
      var destination = Math.max(0, window.scrollY + after - before), metrics = scrollMetrics();
      if (metrics && destination + metrics.viewport > metrics.height) setRunway(runwayHeight + Math.ceil(destination + metrics.viewport - metrics.height));
      var delta = anchor.getBoundingClientRect().top - before;
      if (Math.abs(delta) > .5) window.scrollBy({ top: delta, left: 0, behavior: 'instant' });
    }
    releaseRunway();
  }
  function readingAnchor(preferred) {
    var comments = Array.from(section.querySelectorAll('[data-thread-comment]'));
    if (preferred && preferred.matches('[data-thread-comment]')) {
      var bounds = preferred.getBoundingClientRect();
      if (bounds.bottom > 100 && bounds.top < window.innerHeight - 30) return preferred;
    }
    var visible = comments.find(function (item) { var bounds = item.getBoundingClientRect(); return bounds.top >= 100 && bounds.top < window.innerHeight - 30; });
    if (!visible) visible = comments.find(function (item) { var bounds = item.getBoundingClientRect(); return bounds.bottom > 100 && bounds.top < window.innerHeight - 30; });
    return visible || preferred;
  }
  function status(text, error) {
    if (!feedback) return;
    feedback.textContent = text; feedback.classList.toggle('is-error', !!error);
  }
  function comment(id) { return /^\d+$/.test(id || '') ? document.getElementById('comment-' + id) : null; }
  function text(node) { return node ? node.textContent.replace(/\s+/g, ' ').trim() : ''; }
  function setSubmitLabel(label) { if (!submit) return; if (submit.tagName === 'INPUT') submit.value = label; else submit.textContent = label; }
  function fitTextarea() {
    if (!textarea || composer.hidden) return;
    var computed = window.getComputedStyle(textarea);
    var minimum = parseFloat(computed.minHeight) || 44, maximum = parseFloat(computed.maxHeight) || 176;
    var borders = (parseFloat(computed.borderTopWidth) || 0) + (parseFloat(computed.borderBottomWidth) || 0);
    textarea.style.height = 'auto';
    var content = textarea.scrollHeight + borders;
    textarea.style.height = Math.min(maximum, Math.max(minimum, content)) + 'px';
    textarea.style.overflowY = content > maximum ? 'auto' : 'hidden';
  }
  function expandComposer() {
    if (canCollapse) {
      composer.hidden = false; composePanel.hidden = false; composer.classList.remove('is-collapsed');
    }
    fitTextarea();
  }
  function draftScope(target) { return scopeBase + '#reply:' + (target ? target.dataset.commentId : 'new'); }
  function draftHost(target) { return target ? target.querySelector('[data-thread-slot]') : home; }
  function syncDraftBar(target) {
    var host = draftHost(target); if (!host) return;
    var scope = draftScope(target), existing = Array.from(host.children).find(function (child) { return child.matches('[data-thread-draft-bar]'); });
    var record = draft.scopeRecord(form, scope), body = record && record.body && record.body.trim();
    if (!body || form.dataset.writingScope === scope && !composer.hidden) { if (existing) existing.remove(); return; }
    if (!existing) {
      existing = document.createElement('div'); existing.className = 'thread-draft-bar'; existing.setAttribute('data-thread-draft-bar', '');
      var open = document.createElement('button'); open.type = 'button'; open.className = 'thread-compose-open'; open.setAttribute('data-thread-draft-open', '');
      open.setAttribute('aria-controls', 'reply-compose-panel'); open.setAttribute('aria-expanded', 'false');
      var title = document.createElement('strong'); title.setAttribute('data-thread-draft-title', ''); open.appendChild(title);
      var preview = document.createElement('span'); preview.setAttribute('data-thread-draft-preview', ''); open.appendChild(preview);
      var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'thread-draft-remove';
      remove.setAttribute('data-thread-discard-draft', ''); remove.textContent = '×'; existing.appendChild(open); existing.appendChild(remove);
      host.appendChild(existing);
    }
    existing.setAttribute('data-thread-draft-scope', scope);
    existing.setAttribute('data-thread-draft-token', record.token || '');
    existing.querySelector('[data-thread-draft-title]').textContent = target ? '回复 ' + target.dataset.authorName : '继续写回应';
    var previewText = body.replace(/\s+/g, ' ');
    existing.querySelector('[data-thread-draft-preview]').textContent = previewText.length > 72 ? previewText.slice(0, 72).trimEnd() + '…' : previewText;
    existing.querySelector('[data-thread-discard-draft]').setAttribute('aria-label', target ? '删除给 ' + target.dataset.authorName + ' 的回复草稿' : '删除独立评论草稿');
  }
  function syncDraftBars() {
    syncDraftBar(null);
    section.querySelectorAll('[data-thread-comment]').forEach(syncDraftBar);
    if (resume) resume.hidden = !composer.hidden && form.dataset.writingScope === draftScope(null) || !!home.querySelector('[data-thread-draft-bar]');
  }
  function collapseComposer() {
    if (!canCollapse || composer.hidden || busy) return;
    draft.prepare(form);
    var oldHost = composer.closest('[data-thread-comment]'), focusInside = composePanel.contains(document.activeElement);
    composer.hidden = true; composer.classList.add('is-collapsed');
    if (oldHost) oldHost.classList.remove('has-inline-editor');
    syncDraftBars();
    if (focusInside) {
      var target = oldHost || null, bar = draftHost(target).querySelector('[data-thread-draft-bar]');
      var focusTarget = bar && bar.querySelector('[data-thread-draft-open]') || oldHost && oldHost.querySelector('[data-thread-reply]') || resume;
      if (focusTarget && !focusTarget.hidden) focusTarget.focus({ preventScroll: true });
    }
  }
  var resume;
  if (enhance) {
    resume = document.createElement('button'); resume.type = 'button'; resume.className = 'thread-continue';
    resume.textContent = '写一条独立评论'; resume.hidden = true; home.appendChild(resume);
    resume.addEventListener('click', function () { choose(null, home); });
    if (cancel) {
      cancel.hidden = !canCollapse;
      if (canCollapse) { cancel.classList.add('is-draft-close'); cancel.textContent = '×'; cancel.setAttribute('aria-label', '删除当前草稿并关闭'); cancel.setAttribute('title', '删除当前草稿并关闭'); }
    }
  }
  function choose(target, anchor, keepInline) {
    if (!enhance || busy) return;
    clearTilt();
    var id = target ? target.dataset.commentId : 'new';
    var nextScope = draftScope(target);
    var oldHost = composer.closest('[data-thread-comment]');
    keepPlace(anchor || target || composer, function () {
      expandComposer();
      draft.switchScope(form, nextScope);
      if (oldHost && (!keepInline || target)) oldHost.classList.remove('has-inline-editor');
      selected = target;
      if (target) {
        var slot = target.querySelector('[data-thread-slot]');
        slot.appendChild(composer); target.classList.add('has-inline-editor');
        home.appendChild(resume); resume.hidden = false;
        heading.textContent = '回复 ' + target.dataset.authorName;
        quote.textContent = text(target.querySelector('[data-thread-body]')).slice(0, 180);
        quote.hidden = false; cancel.hidden = !canCollapse; setSubmitLabel('发送');
      } else {
        if (!keepInline) { home.insertBefore(composer, resume); resume.hidden = true; }
        heading.textContent = '写下你的回应'; quote.hidden = true; quote.textContent = ''; cancel.hidden = !canCollapse; setSubmitLabel('发送');
      }
      var parent = form.querySelector('[name=reply_to]'); if (parent) parent.value = target ? id : '';
      status('', false); textarea.removeAttribute('aria-invalid');
      fitTextarea();
      syncDraftBars();
    });
    reveal(composer); textarea.focus({ preventScroll: true });
    scheduleLine();
  }
  function clearLine() {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    if (lineAnimation) { lineAnimation.cancel(); lineAnimation = null; }
    if (svg) svg.remove(); svg = path = dot = null;
    if (linked) linked.classList.remove('is-linked'); linked = null;
  }
  function closeContext() {
    if (activeContext) {
      var host = activeContext.closest('[data-thread-comment]'); if (host) host.classList.remove('is-context-open');
      var panel = document.getElementById(activeContext.getAttribute('aria-controls'));
      if (panel) {
        var focusInside = panel.contains(document.activeElement); panel.hidden = true;
        if (focusInside) activeContext.focus({ preventScroll: true });
      }
      activeContext.setAttribute('aria-expanded', 'false');
      var label = activeContext.querySelector('.thread-context-action'); if (label) label.textContent = '查看原句';
    }
    activeContext = null; clearLine();
  }
  function ensureLine() {
    if (svg) return;
    var ns = 'http://www.w3.org/2000/svg';
    svg = document.createElementNS(ns, 'svg'); svg.classList.add('thread-relation-line'); svg.setAttribute('aria-hidden', 'true');
    path = document.createElementNS(ns, 'path'); dot = document.createElementNS(ns, 'circle'); dot.setAttribute('r', '3');
    svg.appendChild(path); svg.appendChild(dot); document.body.appendChild(svg);
  }
  function drawLine(animate) {
    if (!activeContext || !activeContext.isConnected) { clearLine(); return; }
    var panel = document.getElementById(activeContext.getAttribute('aria-controls'));
    var target = comment(activeContext.dataset.parentId);
    var destination = target && target.querySelector('.thread-message');
    var sourceRect = activeContext.getBoundingClientRect();
    var destinationRect = destination && destination.getBoundingClientRect();
    // An off-page or offscreen parent is represented by its visible quote, never a floating endpoint.
    var parentVisible = destinationRect && destinationRect.top > 68 && destinationRect.bottom < window.innerHeight - 20;
    if (!parentVisible) destination = panel && panel.querySelector('blockquote');
    if (!destination || sourceRect.bottom < 0 || sourceRect.top > window.innerHeight) { if (svg) svg.style.visibility = 'hidden'; return; }
    destinationRect = destination.getBoundingClientRect();
    ensureLine(); svg.style.visibility = 'visible';
    if (linked && linked !== (parentVisible ? target : null)) linked.classList.remove('is-linked');
    linked = parentVisible ? target : null; if (linked) linked.classList.add('is-linked');
    var startX = Math.max(7, sourceRect.left - 9), startY = sourceRect.top + Math.min(sourceRect.height / 2, 17);
    var endX = Math.max(7, destinationRect.left - 7), endY = destinationRect.top + Math.min(destinationRect.height / 2, 25);
    var rail = Math.max(6, Math.min(startX, endX) - (parentVisible ? 25 : 13));
    path.setAttribute('d', 'M ' + startX + ' ' + startY + ' C ' + rail + ' ' + startY + ', ' + rail + ' ' + endY + ', ' + endX + ' ' + endY);
    dot.setAttribute('cx', endX); dot.setAttribute('cy', endY);
    if (animate && motion() && path.animate) {
      var length = path.getTotalLength();
      if (lineAnimation) lineAnimation.cancel();
      lineAnimation = path.animate([{ strokeDasharray: length + ' ' + length, strokeDashoffset: length }, { strokeDasharray: length + ' ' + length, strokeDashoffset: 0 }], { duration: 340, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  }
  function scheduleLine() {
    if (!activeContext || frame) return;
    frame = requestAnimationFrame(function () { frame = 0; drawLine(false); });
  }
  function placeReturnBar() {
    if (!returnBar || returnBar.hidden || !footer) return;
    var base = window.innerWidth <= 699 ? 12 : 22;
    var footerTop = footer.getBoundingClientRect().top;
    var barHeight = returnBar.getBoundingClientRect().height;
    var desired = Math.max(base, window.innerHeight - footerTop + 12);
    var topSafe = Math.max(base, window.innerHeight - barHeight - 96);
    returnBar.style.setProperty('--thread-return-bottom', Math.min(desired, topSafe) + 'px');
  }
  function locate(id) {
    var target = comment(id);
    if (!target) return false;
    returnPosition = { x: window.scrollX, y: window.scrollY, focus: activeContext };
    closeContext(); target.classList.add('is-linked'); linked = target;
    if (returnBar) { returnBar.hidden = false; placeReturnBar(); }
    target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center', behavior: motion() ? 'smooth' : 'instant' });
    return true;
  }
  section.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var origin = event.target.closest && event.target.closest('a,button'); if (!origin) return;
    if (origin.matches('[data-thread-draft-open]') && enhance) {
      event.preventDefault(); var saved = origin.closest('[data-thread-draft-bar]');
      var savedScope = saved && saved.dataset.threadDraftScope, savedId = savedScope && savedScope.split('#reply:')[1];
      choose(savedId === 'new' ? null : comment(savedId), saved.closest('[data-thread-comment]') || home); return;
    }
    if (origin.matches('[data-thread-discard-draft]') && enhance) {
      event.preventDefault(); var bar = origin.closest('[data-thread-draft-bar]');
      if (bar && draft.discardScope(form, bar.dataset.threadDraftScope, bar.dataset.threadDraftToken)) {
        keepPlace(readingAnchor(bar.closest('[data-thread-comment]') || home), syncDraftBars);
      }
      return;
    }
    if (origin.matches('[data-thread-reply]') && enhance) {
      event.preventDefault(); choose(origin.closest('[data-thread-comment]'), origin.closest('[data-thread-comment]')); return;
    }
    if (origin.matches('[data-thread-cancel]') && canCollapse) {
      event.preventDefault();
      keepPlace(readingAnchor(composer.closest('[data-thread-comment]') || composer), function () {
        draft.discardScope(form, form.dataset.writingScope); collapseComposer();
      });
      return;
    }
    if (origin.matches('[data-thread-context]')) {
      if (activeContext === origin && origin.getAttribute('aria-expanded') === 'true') {
        if (locate(origin.dataset.parentId)) event.preventDefault(); return;
      }
      event.preventDefault();
      var anchor = origin.closest('[data-thread-comment]');
      keepPlace(anchor, function () {
        closeContext(); activeContext = origin;
        var panel = document.getElementById(origin.getAttribute('aria-controls'));
        if (panel) { panel.hidden = false; reveal(panel); }
        if (anchor) anchor.classList.add('is-context-open');
        origin.setAttribute('aria-expanded', 'true');
        var label = origin.querySelector('.thread-context-action'); if (label) label.textContent = '定位原评论';
      });
      drawLine(true); return;
    }
    if (origin.matches('[data-thread-context-close]')) { event.preventDefault(); keepPlace(origin.closest('[data-thread-comment]'), closeContext); return; }
    if (origin.matches('[data-thread-locate]')) { if (locate(origin.dataset.parentId)) event.preventDefault(); return; }
    if (origin.matches('[data-thread-return-button]') && returnPosition) {
      event.preventDefault(); var destination = returnPosition; returnPosition = null;
      if (returnBar) { returnBar.hidden = true; returnBar.style.removeProperty('--thread-return-bottom'); } clearLine();
      window.scrollTo({ top: destination.y, left: destination.x, behavior: 'instant' });
      if (destination.focus && destination.focus.isConnected) destination.focus.focus({ preventScroll: true });
    }
  });
  if (enhance) form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (busy) return;
    var trimmed = textarea.value.trim();
    if (textarea.value !== trimmed) { textarea.value = trimmed; textarea.dispatchEvent(new Event('input', { bubbles: true })); }
    if (!trimmed) {
      draft.prepare(form); textarea.setAttribute('aria-invalid', 'true');
      status('请先写下回复内容。', true); return;
    }
    var receipt = draft.prepare(form);
    var data = new FormData(form);
    var targetAtSubmit = composer.closest('[data-thread-comment]');
    var bodyAtSubmit = textarea.value, revisionAtSubmit = editorRevision, collapseAfterReceipt = false;
    function submitStatus(message, error) {
      keepPlace(readingAnchor(targetAtSubmit || composer), function () { status(message, error); });
    }
    keepPlace(readingAnchor(targetAtSubmit || composer), function () {
      busy = true; composer.setAttribute('aria-busy', 'true'); if (submit) submit.disabled = true;
      status('发送中…', false); textarea.removeAttribute('aria-invalid');
    });
    var controller = new AbortController(), timeout = setTimeout(function () { controller.abort(); }, 25000);
    try {
      var response = await fetch(section.dataset.postUrl, { method: 'POST', body: data, credentials: 'same-origin', redirect: 'error', headers: { Accept: 'application/json' }, signal: controller.signal });
      var contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        if (response.status === 429 || response.status === 413 || response.status === 403) {
          submitStatus(response.status === 429 ? '操作有点频繁，请稍后再试。文字仍然保留。' : response.status === 413 ? '内容过长，请缩短后再发布。文字仍然保留。' : '当前身份暂时无法发布，请检查登录状态。文字仍然保留。', true); return;
        }
        throw new Error('unconfirmed');
      }
      var result = await response.json();
      if (!response.ok || !result.ok) {
        var errors = result.errors || {}, messages = Object.keys(errors).map(function (key) { return Array.isArray(errors[key]) ? errors[key].join(' ') : ''; }).filter(Boolean);
        if (errors.body) textarea.setAttribute('aria-invalid', 'true');
        submitStatus(messages.join(' ') || '尚未发布，请检查内容或重新登录。你的文字仍保留。', true); return;
      }
      var parsed = new DOMParser().parseFromString(result.comment_html || '', 'text/html');
      var node = parsed.querySelector('[data-thread-comment]');
      if (!node || !Number.isSafeInteger(result.id) || !Number.isSafeInteger(result.count) || result.count < 1 || node.id !== 'comment-' + result.id) throw new Error('unconfirmed');
      var visibleAnchor = Array.from(section.querySelectorAll('[data-thread-comment]')).find(function (item) { var bounds = item.getBoundingClientRect(); return bounds.bottom > 100 && bounds.top < window.innerHeight - 30; });
      keepPlace(visibleAnchor || composer, function () {
      if (!document.getElementById(node.id)) {
        node.classList.add('is-new');
        node.querySelectorAll('.flask-moment').forEach(function (time) { time.textContent = '刚刚'; time.style.display = ''; });
        // The server renders oldest to newest; async inserts keep that order.
        feed.appendChild(node);
        var empty = section.querySelector('[data-thread-empty]'); if (empty) empty.remove();
      }
      document.querySelectorAll('[data-thread-count]').forEach(function (count) { count.textContent = String(result.count); });
      // Only an exact receipt may clear this editor. Any input during the
      // request keeps the editor open, even if the text was later restored.
      var confirmed = result.writing_receipt && receipt && /^[0-9a-f]{32}$/.test(receipt.token || '') && result.writing_receipt.token === receipt.token &&
        result.writing_receipt.owner === receipt.owner && (result.writing_receipt.scope || result.writing_receipt.path) === receipt.scope;
      var unchanged = textarea.value === bodyAtSubmit && editorRevision === revisionAtSubmit && !composing;
      if (confirmed) document.dispatchEvent(new CustomEvent('liss:writing-committed', { detail: result.writing_receipt }));
      collapseAfterReceipt = !!(confirmed && unchanged && textarea.value === '' && form.dataset.writingScope === receipt.scope);
      status('已发送', false);
      fitTextarea();
      }); scheduleLine();
    } catch (error) {
      submitStatus('连接未确认，文字已保留。请先查看最新评论，确认没有发布成功后再重试。', true);
    } finally {
      clearTimeout(timeout); busy = false; composer.removeAttribute('aria-busy'); form.removeAttribute('aria-busy');
      var pending = form.querySelector('.form-pending'); if (pending) pending.textContent = '';
      if (submit) submit.disabled = false;
      if (collapseAfterReceipt && !composing && textarea.value === '' && form.dataset.writingScope === receipt.scope) {
        keepPlace(readingAnchor(targetAtSubmit || composer), collapseComposer);
        scheduleLine();
      }
    }
  });
  function selectedText() {
    var selection = window.getSelection && window.getSelection();
    return !!(selection && !selection.isCollapsed);
  }
  function outsideProtected(target) {
    if (!target || !target.closest) return true;
    if (composer && composer.contains(target)) return true;
    var panel = activeContext && document.getElementById(activeContext.getAttribute('aria-controls'));
    if (panel && panel.contains(target) || activeContext && activeContext.contains(target)) return true;
    return !!target.closest('a,button,input,textarea,select,label,summary,[contenteditable],dialog,[data-thread-return]');
  }
  function moveOutsideGesture(event) {
    if (!outsideGesture) return;
    if (Math.abs((event.clientX || 0) - outsideGesture.x) > 7 || Math.abs((event.clientY || 0) - outsideGesture.y) > 7) outsideGesture.dragged = true;
  }
  document.addEventListener('pointerdown', function (event) {
    outsideGesture = null;
    if (event.isPrimary === false || event.button !== 0 || busy || composing || selectedText() || outsideProtected(event.target)) return;
    outsideGesture = { target: event.target, x: event.clientX || 0, y: event.clientY || 0, dragged: false };
  }, { capture: true, passive: true });
  document.addEventListener('pointermove', moveOutsideGesture, { passive: true });
  section.addEventListener('pointermove', followTilt, { passive: true });
  section.addEventListener('pointerleave', clearTilt, { passive: true });
  document.addEventListener('pointerup', moveOutsideGesture, { passive: true });
  document.addEventListener('pointercancel', function () { outsideGesture = null; }, { passive: true });
  document.addEventListener('click', function (event) {
    var gesture = outsideGesture; outsideGesture = null;
    if (!gesture || gesture.dragged || gesture.target !== event.target || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || busy || composing || selectedText() || outsideProtected(event.target)) return;
    if (!activeContext && !linked && (!canCollapse || composer.hidden)) return;
    var anchor = readingAnchor(event.target.closest('[data-thread-comment]') || activeContext && activeContext.closest('[data-thread-comment]') || linked || composer && (composer.closest('[data-thread-comment]') || composer) || section);
    keepPlace(anchor, function () { closeContext(); collapseComposer(); });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || composing || busy) return;
    if (activeContext || linked) {
      event.preventDefault();
      keepPlace(readingAnchor(activeContext && activeContext.closest('[data-thread-comment]') || linked), closeContext);
    } else if (canCollapse && !composer.hidden) {
      event.preventDefault(); keepPlace(readingAnchor(composer.closest('[data-thread-comment]') || composer), collapseComposer);
    }
  });
  if (textarea) {
    textarea.addEventListener('input', function () { editorRevision++; keepPlace(composer.closest('[data-thread-comment]') || composer, fitTextarea); });
    textarea.addEventListener('compositionstart', function () { composing = true; });
    textarea.addEventListener('compositionend', function () { composing = false; keepPlace(composer.closest('[data-thread-comment]') || composer, fitTextarea); });
    fitTextarea();
  }
  window.addEventListener('blur', function () { outsideGesture = null; clearTilt(); });
  window.addEventListener('scroll', function () { clearTilt(); releaseRunway(); scheduleLine(); placeReturnBar(); }, { passive: true });
  window.addEventListener('resize', function () {
    if (textarea && !composer.hidden) keepPlace(composer.closest('[data-thread-comment]') || composer, fitTextarea);
    scheduleLine(); placeReturnBar();
  }, { passive: true });
  reduce.addEventListener('change', function () { clearTilt(); if (lineAnimation && !motion()) lineAnimation.cancel(); scheduleLine(); });
  finePointer.addEventListener('change', clearTilt);
  forcedColors.addEventListener('change', clearTilt);
  window.addEventListener('liss:motion-state', function () { clearTilt(); if (lineAnimation && !motion()) lineAnimation.cancel(); scheduleLine(); });
  window.addEventListener('liss:thread-layout', function () { clearTilt(); scheduleLine(); });
  window.addEventListener('pageshow', function () { releaseRunway(); if (enhance) syncDraftBars(); placeReturnBar(); });
  window.addEventListener('storage', function (event) { if (enhance && event.key && event.key.indexOf('liss-writing-draft:v1:') === 0) syncDraftBars(); });
  if (enhance) syncDraftBars();
  window.addEventListener('pagehide', function (event) { outsideGesture = null; clearTilt(); clearLine(); if (!event.persisted) setRunway(0); });
})();
