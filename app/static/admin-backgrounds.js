(() => {
  'use strict';

  const fold = (value) => String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
  const moveToPosition = (items, item, position) => {
    if (!items.includes(item) || !Number.isFinite(Number(position))) return [...items];
    const next = items.filter((candidate) => candidate !== item);
    const target = Math.max(0, Math.min(next.length, Number(position) - 1));
    next.splice(target, 0, item);
    return next;
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = { fold, moveToPosition };
  if (typeof document === 'undefined') return;

  const root = document.querySelector('[data-background-library]');
  if (!root) return;
  const form = root.querySelector('[data-background-catalog]');
  const grid = root.querySelector('[data-background-grid]');
  const sceneGrid = root.querySelector('[data-scene-grid]');
  const cards = () => [...grid.querySelectorAll('[data-background-item]')];
  const scenes = () => [...sceneGrid.querySelectorAll('[data-scene-item]')];
  const field = (card, key) => card.querySelector(`[data-background-field="${key}"]`);
  const pool = (card) => card.querySelector('[data-background-pool]');
  const isScene = (item) => item.hasAttribute('data-scene-item');
  const eligible = (card) => isScene(card) || (field(card, 'enabled').value === '1' && field(card, 'deleted').value === '0');
  const search = root.querySelector('[data-background-search]');
  const filter = { value: 'available' };
  const tabs = [...root.querySelectorAll('[data-filter-value]')];
  const strip = root.querySelector('[data-pool-strip]');
  const random = root.querySelector('[data-random-enabled]');
  const editor = root.querySelector('[data-background-editor]');
  const editorForm = root.querySelector('[data-background-editor-form]');
  const positionInput = editor.querySelector('[data-editor-position]');
  const canEdit = typeof editor.showModal === 'function';
  const baselineOrder = cards().map((card) => card.dataset.backgroundId);
  const baseline = new Map();
  const sceneBaseline = new Map(scenes().map((scene) => [scene, pool(scene).checked]));
  const globalBaseline = random.value;
  let editedCard = null;
  let opener = null;

  const record = (card) => JSON.stringify({
    title: field(card, 'title').value,
    description: field(card, 'description').value,
    enabled: field(card, 'enabled').value,
    deleted: field(card, 'deleted').value,
    palette: field(card, 'palette').value,
    inPool: pool(card).checked,
    anchors: ['anchorX', 'anchorY', 'mobileAnchorX'].map((key) => field(card, key).value),
  });
  const announce = (message) => { root.querySelector('[data-background-announcement]').textContent = message; };

  const sync = () => {
    const all = cards();
    const query = fold(search.value);
    let shown = 0;
    let shownPhotos = 0;
    let selected = 0;
    let changed = 0;
    const counts = { available: 0, photos: 0, scenes: 0, pool: 0, disabled: 0, deleted: 0 };
    all.forEach((card, index) => {
      const title = field(card, 'title').value.trim();
      const deleted = field(card, 'deleted').value === '1';
      const enabled = field(card, 'enabled').value === '1';
      const checkbox = pool(card);
      checkbox.disabled = !eligible(card);
      if (checkbox.disabled) checkbox.checked = false;
      if (checkbox.checked) selected += 1;
      card.classList.toggle('is-deleted', deleted);
      card.classList.toggle('is-disabled', !enabled && !deleted);
      card.querySelector('[data-background-title]').textContent = title;
      card.querySelector('[data-background-position]').textContent = String(index + 1);
      card.querySelector('[data-native-position]').value = String(index + 1);
      card.querySelector('[data-edit-background]').setAttribute('aria-label', `编辑 ${title}`);
      const state = card.querySelector('[data-background-state]');
      state.textContent = deleted ? '已删除' : '已停用';
      state.hidden = enabled && !deleted;
      const modified = baseline.has(card) && (baseline.get(card) !== record(card) || baselineOrder[index] !== card.dataset.backgroundId);
      card.querySelector('[data-background-modified]').hidden = !modified;
      if (modified) changed += 1;
      const matches = !query || fold(`${title} ${field(card, 'description').value} ${card.dataset.backgroundId}`).includes(query);
      const scopes = { available: !deleted, photos: !deleted, scenes: false, pool: checkbox.checked, disabled: !deleted && !enabled, deleted };
      Object.keys(counts).forEach((key) => { if (scopes[key]) counts[key] += 1; });
      card.hidden = !matches || !scopes[filter.value];
      if (!card.hidden) { shown += 1; shownPhotos += 1; }
      const quickEnabled = card.querySelector('[data-quick="enabled"]');
      quickEnabled.textContent = enabled ? '停用' : '启用';
      quickEnabled.hidden = deleted;
      card.querySelector('[data-quick="deleted"]').textContent = deleted ? '恢复' : '删除';
      card.querySelector('[data-quick="deleted"]').classList.toggle('is-danger', !deleted);
    });
    let shownScenes = 0;
    scenes().forEach((scene) => {
      const checked = pool(scene).checked;
      if (checked) selected += 1;
      const modified = sceneBaseline.get(scene) !== checked;
      scene.querySelector('[data-background-modified]').hidden = !modified;
      if (modified) changed += 1;
      const scopes = { available: true, photos: false, scenes: true, pool: checked, disabled: false, deleted: false };
      Object.keys(counts).forEach((key) => { if (scopes[key]) counts[key] += 1; });
      scene.hidden = !scopes[filter.value] || (query && !fold(scene.dataset.search).includes(query));
      if (!scene.hidden) { shown += 1; shownScenes += 1; }
    });
    root.querySelector('[data-pool-count]').textContent = String(selected);
    root.querySelector('[data-deleted-count]').textContent = String(counts.deleted);
    tabs.forEach((tab) => {
      tab.setAttribute('aria-pressed', String(tab.dataset.filterValue === filter.value));
      tab.querySelector('[data-filter-count]').textContent = String(counts[tab.dataset.filterValue]);
    });
    root.querySelector('[data-section-title="photos"]').hidden = shownPhotos === 0;
    root.querySelector('[data-section-title="scenes"]').hidden = shownScenes === 0;
    root.querySelector('[data-result-count]').textContent = `显示 ${shown} 项`;
    root.querySelector('[data-background-empty]').hidden = shown > 0;
    root.querySelector('[data-empty-pool]').hidden = selected !== 0 || random.value === '0';
    root.classList.toggle('abg-random-off', random.value === '0');
    renderStrip();
    const dirty = root.querySelector('[data-background-dirty]');
    dirty.textContent = changed ? `${changed} 项有待保存${random.value !== globalBaseline ? '，默认随机设置也已更改' : ''}` : random.value !== globalBaseline ? '默认随机设置有待保存' : '尚未修改';
  };

  // The random list at a glance: a strip of what is in it; a click takes one out.
  const renderStrip = () => {
    const members = [...cards(), ...scenes()].filter((item) => pool(item).checked);
    const limit = 24;
    const chips = members.slice(0, limit).map((item) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'abg-strip-chip';
      const title = isScene(item) ? item.querySelector('h3').textContent : field(item, 'title').value;
      chip.title = `移出随机名单：${title}`;
      chip.setAttribute('aria-label', `把 ${title} 移出随机名单`);
      const source = isScene(item) ? item.querySelector('canvas') : item.querySelector('img');
      if (isScene(item)) {
        const copy = document.createElement('canvas');
        copy.width = 96; copy.height = 64;
        try { copy.getContext('2d').drawImage(source, 0, 0, 96, 64); } catch { /* not painted yet */ }
        copy.className = source.className;
        chip.append(copy);
      } else {
        const image = document.createElement('img');
        image.src = source.currentSrc || source.src; image.alt = ''; image.width = 96; image.height = 64;
        chip.append(image);
      }
      chip.addEventListener('click', () => { pool(item).checked = false; sync(); announce(`已把 ${title} 移出随机名单，预览确认后生效。`); });
      return chip;
    });
    if (members.length > limit) {
      const more = document.createElement('span');
      more.className = 'abg-strip-more';
      more.textContent = `+${members.length - limit}`;
      chips.push(more);
    }
    strip.replaceChildren(...chips);
    strip.hidden = members.length === 0;
  };

  const syncMoveButtons = () => {
    const position = Number(positionInput.value);
    editor.querySelector('[data-move-position="-1"]').disabled = position <= 1;
    editor.querySelector('[data-move-position="1"]').disabled = position >= cards().length;
  };
  const openEditor = (card, focusKey = 'title') => {
    if (!canEdit) return;
    editedCard = card;
    opener = card.querySelector('[data-edit-background]');
    editor.querySelectorAll('[data-editor-field]').forEach((input) => {
      const sourceValue = field(card, input.dataset.editorField).value;
      input.value = input.hasAttribute('data-anchor-percent') ? String(Math.round(Number(sourceValue) * 1000000) / 10000) : sourceValue;
      input.dataset.initialValue = input.value;
    });
    positionInput.value = String(cards().indexOf(card) + 1);
    positionInput.max = String(cards().length);
    editor.querySelector('[data-editor-preview]').src = card.dataset.previewUrl;
    editor.querySelector('[data-editor-preview]').alt = field(card, 'title').value;
    editor.querySelector('[data-editor-mobile-image]').src = card.dataset.previewUrl;
    editor.querySelector('[data-editor-composition]').open = false;
    editor.querySelector('[data-editor-mobile]').hidden = true;
    editor.querySelector('.abg-editor-preview').classList.remove('has-mobile-preview');
    editor.querySelector('[data-editor-source]').textContent = `${card.dataset.sourceWidth} × ${card.dataset.sourceHeight} 像素 · ${card.dataset.sourceKind === 'upload' ? '上传图片' : '内置图片'} · ${card.dataset.backgroundId}`;
    const errors = [...card.querySelectorAll('[data-background-fields] .field-error')].map((node) => { const copy = node.cloneNode(true); copy.removeAttribute('role'); return copy; });
    const editorErrors = editor.querySelector('[data-editor-errors]');
    editorErrors.replaceChildren(...errors);
    editorErrors.hidden = errors.length === 0;
    syncMoveButtons();
    syncComposition();
    if (!editor.open) editor.showModal();
    if (['anchorX', 'anchorY', 'mobileAnchorX'].includes(focusKey)) editor.querySelector('[data-editor-composition]').open = true;
    editor.querySelector(`[data-editor-field="${focusKey}"]`)?.focus();
  };
  const reorder = (card, position) => {
    moveToPosition(cards(), card, position).forEach((item) => grid.append(item));
  };
  const syncComposition = () => {
    const percent = (key) => Math.max(0, Math.min(100, Number(editor.querySelector(`[data-editor-field="${key}"]`).value) || 0));
    editor.querySelector('[data-editor-preview]').style.objectPosition = `${percent('anchorX')}% ${percent('anchorY')}%`;
    editor.querySelector('[data-editor-mobile-image]').style.objectPosition = `${percent('mobileAnchorX')}% ${percent('anchorY')}%`;
  };

  cards().forEach((card) => {
    if (!eligible(card)) pool(card).checked = false;
    baseline.set(card, record(card));
    const trigger = card.querySelector('[data-edit-background]');
    trigger.hidden = !canEdit;
    trigger.addEventListener('click', () => openEditor(card));
    const nativePosition = card.querySelector('[data-native-position]');
    nativePosition.disabled = false;
    nativePosition.addEventListener('change', () => {
      if (!nativePosition.checkValidity()) return;
      reorder(card, nativePosition.value);
      sync();
    });
  });
  root.classList.toggle('abg-is-enhanced', canEdit);
  root.querySelector('[data-background-filters]').hidden = false;
  root.querySelector('[data-pool-actions]').hidden = false;
  search.addEventListener('input', sync);
  random.addEventListener('change', sync);
  form.addEventListener('change', sync);
  tabs.forEach((tab) => tab.addEventListener('click', () => { filter.value = tab.dataset.filterValue; sync(); }));

  // Quick actions on a card change the same fields the editor does.
  cards().forEach((card) => {
    card.querySelector('[data-card-actions]').hidden = false;
    card.querySelectorAll('[data-quick]').forEach((button) => button.addEventListener('click', () => {
      const key = button.dataset.quick;
      const input = field(card, key);
      input.value = key === 'enabled' ? (input.value === '1' ? '0' : '1') : (input.value === '1' ? '0' : '1');
      sync();
      const title = field(card, 'title').value;
      const done = key === 'deleted' ? (input.value === '1' ? '已删除（原图保留）' : '已恢复') : (input.value === '1' ? '已启用' : '已停用');
      announce(`${title} ${done}，预览确认后生效。`);
    }));
  });

  const bulk = {
    'add-shown': () => [...cards(), ...scenes()].forEach((item) => { if (!item.hidden && eligible(item)) pool(item).checked = true; }),
    'remove-shown': () => [...cards(), ...scenes()].forEach((item) => { if (!item.hidden) pool(item).checked = false; }),
    aurora: () => { cards().forEach((card) => { pool(card).checked = false; }); scenes().forEach((scene) => { pool(scene).checked = scene.dataset.aurora === 'true'; }); },
    clear: () => [...cards(), ...scenes()].forEach((item) => { pool(item).checked = false; }),
  };
  const bulkMessages = { 'add-shown': '当前显示的背景已加入随机名单', 'remove-shown': '当前显示的背景已移出随机名单', aurora: '随机名单改为极光系列绘制背景', clear: '随机名单已清空' };
  root.querySelectorAll('[data-pool-action]').forEach((button) => button.addEventListener('click', () => {
    bulk[button.dataset.poolAction]();
    sync();
    announce(`${bulkMessages[button.dataset.poolAction]}，预览确认后生效。`);
  }));
  root.querySelector('[data-reset-filters]').addEventListener('click', () => {
    search.value = '';
    filter.value = 'available';
    sync();
    search.focus();
  });

  // Drawn scenes paint their own thumbnail with the same renderer the site uses.
  const paintScenes = () => {
    const designs = window.LissSceneDesignsV40;
    const light = document.documentElement.dataset.theme === 'light';
    scenes().forEach((scene) => {
      const canvas = scene.querySelector('[data-scene-canvas]');
      if (!designs || typeof designs.paintThumbnail !== 'function' || !designs.has(canvas.dataset.style)) return;
      try { designs.paintThumbnail(canvas, canvas.dataset.style, light); canvas.dataset.painted = 'true'; } catch { /* keep the CSS swatch */ }
    });
    renderStrip();
  };
  const paintWhenVisible = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) { paintWhenVisible.disconnect(); paintScenes(); }
  }, { rootMargin: '400px' }) : null;
  if (paintWhenVisible) paintWhenVisible.observe(sceneGrid); else paintScenes();
  new MutationObserver(() => { if (sceneGrid.querySelector('[data-painted]')) paintScenes(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  form.addEventListener('invalid', (event) => {
    const card = event.target.closest('[data-background-item]');
    if (card && canEdit && !editor.open) {
      event.preventDefault();
      openEditor(card, event.target.dataset.backgroundField || 'title');
    }
  }, true);
  editor.querySelector('[data-close-editor]').addEventListener('click', () => editor.close('cancel'));
  editor.addEventListener('click', (event) => {
    if (event.target !== editor) return;
    const bounds = editor.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) editor.close('cancel');
  });
  editor.addEventListener('close', () => {
    const target = opener && !opener.closest('[data-background-item]').hidden ? opener : search;
    target?.focus({ preventScroll: true });
    editedCard = null;
  });
  editor.querySelectorAll('[data-move-position]').forEach((button) => {
    button.addEventListener('click', () => {
      positionInput.value = String(Math.max(1, Math.min(cards().length, Number(positionInput.value) + Number(button.dataset.movePosition))));
      syncMoveButtons();
    });
  });
  positionInput.addEventListener('input', syncMoveButtons);
  editor.querySelectorAll('[data-anchor-percent]').forEach((input) => input.addEventListener('input', syncComposition));
  editor.querySelector('[data-editor-composition]').addEventListener('toggle', (event) => {
    editor.querySelector('[data-editor-mobile]').hidden = !event.target.open;
    editor.querySelector('.abg-editor-preview').classList.toggle('has-mobile-preview', event.target.open);
  });
  editorForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!editedCard || !editorForm.reportValidity()) return;
    const card = editedCard;
    const moved = cards().indexOf(card) + 1 !== Number(positionInput.value);
    editor.querySelectorAll('[data-editor-field]').forEach((input) => {
      if (input.hasAttribute('data-anchor-percent')) {
        if (Number(input.value) !== Number(input.dataset.initialValue)) field(card, input.dataset.editorField).value = String(Number(input.value) / 100);
      } else field(card, input.dataset.editorField).value = input.value;
    });
    reorder(card, positionInput.value);
    sync();
    if (moved && !card.hidden) card.scrollIntoView({ behavior: 'auto', block: 'center' });
    announce(`${field(card, 'title').value} 的修改已暂存，预览确认后生效。`);
    editor.close('saved');
  });

  const uploadDetails = root.querySelector('#background-upload');
  root.querySelector('[data-open-upload]').addEventListener('click', (event) => {
    event.preventDefault();
    uploadDetails.open = true;
    uploadDetails.scrollIntoView({ behavior: 'auto', block: 'start' });
    dropzone.focus?.({ preventScroll: true });
  });
  const fileInput = root.querySelector('[data-upload-image]');
  const filePreview = root.querySelector('[data-upload-preview]');
  const fileInfo = root.querySelector('[data-upload-file-info]');
  let previewUrl = null;
  let fileRequest = 0;
  const releasePreview = () => { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; };
  const dropzone = root.querySelector('[data-dropzone]');
  const titleInput = root.querySelector('[data-upload-title]');
  ['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (event) => { event.preventDefault(); dropzone.classList.add('is-dragging'); }));
  ['dragleave', 'dragend', 'drop'].forEach((type) => dropzone.addEventListener(type, () => dropzone.classList.remove('is-dragging')));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event('change'));
  });
  fileInput.addEventListener('change', () => {
    const named = fileInput.files?.[0]?.name;
    if (named && !titleInput.value.trim()) titleInput.value = named.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 80);
  });
  fileInput.addEventListener('change', () => {
    const request = ++fileRequest;
    releasePreview();
    filePreview.removeAttribute('src');
    filePreview.hidden = true;
    fileInput.setCustomValidity('');
    const file = fileInput.files?.[0];
    dropzone.classList.toggle('has-file', !!file);
    if (!file) { fileInfo.textContent = '至少 320 × 180 像素'; return; }
    if (file.size > 20 * 1024 * 1024) { fileInput.setCustomValidity('图片不能超过 20 MiB。'); fileInput.reportValidity(); return; }
    if (file.type && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { fileInput.setCustomValidity('请选择 PNG、JPEG 或 WebP 图片。'); fileInput.reportValidity(); return; }
    fileInput.setCustomValidity('正在检查图片，请稍候。');
    previewUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (request !== fileRequest) return;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      const valid = width >= 320 && height >= 180 && width * height <= 40000000 && Math.max(width, height) <= 16000;
      fileInput.setCustomValidity(valid ? '' : '图片需至少 320 × 180 像素，且不超过 4000 万像素或 16000 像素长边。');
      fileInfo.textContent = `${width} × ${height} 像素 · ${(file.size / 1024 / 1024).toFixed(2)} MiB`;
      filePreview.src = previewUrl;
      filePreview.hidden = false;
      if (!valid) fileInput.reportValidity();
    };
    image.onerror = () => { if (request === fileRequest) { fileInput.setCustomValidity('无法读取这张图片，请重新选择。'); fileInput.reportValidity(); } };
    image.src = previewUrl;
  });
  window.addEventListener('pagehide', releasePreview);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && fileInput.files?.length) fileInput.dispatchEvent(new Event('change'));
  });
  sync();
  const invalidCard = cards().find((card) => card.dataset.backgroundError === 'true');
  if (invalidCard) openEditor(invalidCard, invalidCard.dataset.errorField);
  else if (uploadDetails.open && uploadDetails.querySelector('.field-error')) {
    uploadDetails.scrollIntoView({ behavior: 'auto', block: 'start' });
    fileInput.focus({ preventScroll: true });
  }
})();
