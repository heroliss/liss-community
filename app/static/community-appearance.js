(function () {
  'use strict';
  var KEY = '__lissAppearance';
  if (window[KEY]) window[KEY]();
  var theme = window.LissTheme;
  if (!theme) return; // Native HEX/radios remain usable without enhancement.
  var abort = new AbortController(), signal = abort.signal, cleanups = [];
  document.querySelectorAll('[data-appearance-editor]').forEach(function (root) {
    var form = root.closest('form'), hex = form.elements.appearance_color;
    var picker = root.querySelector('[data-appearance-picker]'), preview = root.querySelector('[data-appearance-preview]');
    var status = root.querySelector('[data-appearance-status]'), body = form.querySelector('.writing-field textarea');
    var swatches = root.querySelectorAll('[data-appearance-swatch]'), composer = root.closest('.composer');
    if (!hex || !preview || !picker) return;
    var initialColor = theme.normalize(hex.value), checked = root.querySelector('[name=appearance_material]:checked');
    var initialMaterial = checked ? checked.value : 'auto';
    // Choose a real, editable starting look only for an untouched creation form.
    // POST validation, existing posts and browser-restored drafts keep their values.
    if (root.dataset.appearanceNew === 'true' && !root.dataset.appearanceSeeded && !hex.value.trim() && initialMaterial === 'auto' && !(body && body.value.trim())) {
      var palette = ['#80bfa1','#76b8cf','#a59bd8','#d6a37e','#cf91a8','#bdc8b8','#92b8bc','#b4b883','#ba9eb4','#9baed0','#c5ad86','#8fb4a7'];
      var materials = ['glass','glass','glass','frosted','frosted','frosted','ceramic','paper','metal','leather','cork','slate'];
      function sample(length) {
        if (window.crypto && window.crypto.getRandomValues) {
          var values = new Uint32Array(1); window.crypto.getRandomValues(values);
          return values[0] % length;
        }
        return Math.floor(Math.random() * length);
      }
      initialColor = palette[sample(palette.length)];
      initialMaterial = materials[sample(materials.length)];
      var selected = root.querySelector('[name=appearance_material][value='+initialMaterial+']');
      if (selected) {
        hex.value = hex.defaultValue = initialColor;
        root.querySelectorAll('[name=appearance_material]').forEach(function (radio) { radio.checked = radio.defaultChecked = radio === selected; });
        root.dataset.appearanceSeeded = 'true';
      }
    }
    if (initialColor === null) initialColor = theme.normalize(document.body.dataset.postThemeColor || '') || '';
    function visible() { return root.open && (!composer || composer.open); }
    function appearance(activate) {
      var color = theme.normalize(hex.value), radio = root.querySelector('[name=appearance_material]:checked');
      var material = radio ? radio.value : 'auto';
      var automaticMaterial = root.dataset.appearanceAutoMaterial;
      if (['glass','ceramic','paper','metal','leather','cork','slate'].indexOf(automaticMaterial) === -1) automaticMaterial = 'glass';
      preview.dataset.material = material === 'frosted' ? 'glass' : material === 'auto' ? automaticMaterial : material;
      preview.dataset.glassFinish = material === 'frosted' ? 'frosted' : 'clear';
      if (color !== null) {
        var displayColor = color || theme.normalize(root.dataset.appearanceAutoColor || '') || '';
        preview.dataset.themeColor = displayColor;
        theme.tint(preview,displayColor,'draft');
        if (color) picker.value = color;
        if (activate && visible()) theme.preview(displayColor,root);
      } else theme.tint(preview,preview.dataset.themeColor || '','draft');
      swatches.forEach(function (s) { s.setAttribute('aria-pressed',String(s.dataset.appearanceSwatch === color)); });
      status.textContent = (color === null ? '色值待校验' : color ? '整页实时配色' : '自动配色')+' · '+(radio ? radio.parentElement.lastElementChild.textContent : '自动安排');
      root.querySelector('.appearance-sample-note').hidden = false;
    }
    swatches.forEach(function (swatch) {
      swatch.addEventListener('click',function () { hex.value=swatch.dataset.appearanceSwatch; appearance(true); },{signal:signal});
    });
    root.addEventListener('input',function (event) {
      if (event.target === picker) hex.value=picker.value;
      appearance(true);
    },{signal:signal});
    root.addEventListener('change',function () { appearance(true); },{signal:signal});
    root.querySelector('[data-appearance-reset]').addEventListener('click',function () {
      hex.value='';
      root.querySelector('[name=appearance_material][value=auto]').checked=true;
      appearance(true);
    },{signal:signal});
    root.querySelector('[data-appearance-cancel]').addEventListener('click',function () {
      hex.value=initialColor;
      root.querySelector('[name=appearance_material][value='+initialMaterial+']').checked=true;
      appearance(false); theme.restore(root); root.open=false;
    },{signal:signal});
    root.addEventListener('toggle',function () { if (visible()) appearance(true); else theme.restore(root); },{signal:signal});
    if (composer) composer.addEventListener('toggle',function () { if (visible()) appearance(true); else theme.restore(root); },{signal:signal});
    root.addEventListener('keydown',function (event) { if (event.key === 'Escape') { root.open=false; theme.restore(root); } },{signal:signal});
    form.addEventListener('reset',function () { queueMicrotask(function () { appearance(visible()); if (!visible()) theme.restore(root); }); },{signal:signal});
    document.addEventListener('liss:theme-resume',function () { appearance(visible()); },{signal:signal});
    function copy() {
      var cm = form.querySelector('.CodeMirror'), value = cm && cm.CodeMirror ? cm.CodeMirror.getValue() : body ? body.value : '';
      var lines = value.replace(/!\[[^\]]*\]\([^\n]*?\)/g,'').split('\n').map(function (s) { return s.replace(/^\s{0,3}#{1,6}\s+|^\s*>\s?|^\s*[-*+]\s+/g,'').replace(/\[([^\]]+)\]\([^\n]*?\)/g,'$1').replace(/[*_`]/g,'').trim(); }).filter(Boolean);
      preview.querySelector('[data-appearance-title]').textContent=(lines[0]||'你的下一篇文章').slice(0,48);
      preview.querySelector('[data-appearance-excerpt]').textContent=(lines.slice(1).join(' ')||'一点发现，一个故事，或还在酝酿的想法。').slice(0,90);
    }
    var cmNode = form.querySelector('.CodeMirror');
    if (cmNode && cmNode.CodeMirror) { cmNode.CodeMirror.on('change',copy); cleanups.push(function () {cmNode.CodeMirror.off('change',copy);}); }
    if (body) body.addEventListener('input',copy,{signal:signal});
    root.querySelectorAll('[data-appearance-enhanced]').forEach(function (el) {el.hidden=false;});
    appearance(false); copy();
    cleanups.push(function () {theme.restore(root);});
  });
  window[KEY] = function () { abort.abort(); cleanups.forEach(function (fn) {fn();}); };
}());
