(function () {
  'use strict';
  var KEY = '__lissAppearance';
  if (window[KEY]) window[KEY]();
  var abort = new AbortController(), signal = abort.signal, cleanups = [];
  document.querySelectorAll('[data-appearance-editor]').forEach(function (root) {
    var form = root.closest('form'), hex = form.elements.appearance_color;
    var picker = root.querySelector('[data-appearance-picker]');
    var preview = root.querySelector('[data-appearance-preview]');
    var status = root.querySelector('[data-appearance-status]');
    var body = form.querySelector('.writing-field textarea');
    var swatches = root.querySelectorAll('[data-appearance-swatch]');
    if (!hex || !preview) return;
    function appearance() {
      var color = /^#[\da-f]{6}$/i.test(hex.value) ? hex.value.toLowerCase() : '';
      var radio = root.querySelector('[name=appearance_material]:checked');
      var material = radio ? radio.value : 'auto';
      preview.dataset.material = material === 'auto' ? 'glass' : material;
      preview.dataset.themeColor = color;
      if (color) {
        var rgb = [1,3,5].map(function(i) { return parseInt(color.slice(i,i+2),16)/255; });
        var max = Math.max.apply(Math,rgb), min = Math.min.apply(Math,rgb), d = max-min;
        var light = (max+min)/2, sat = d ? d/(1-Math.abs(2*light-1)) : 0, h = 0;
        if (d) h = max === rgb[0] ? ((rgb[1]-rgb[2])/d+6)%6 : max === rgb[1] ? (rgb[2]-rgb[0])/d+2 : (rgb[0]-rgb[1])/d+4;
        var hue = Math.round(h*60)%360, saturation = sat < .08 ? 0 : Math.round(Math.max(18,Math.min(55,sat*100)));
        preview.style.setProperty('--appearance-accent','hsl('+hue+' '+saturation+'% 70%)');
        picker.value = color;
      } else preview.style.removeProperty('--appearance-accent');
      swatches.forEach(function(s) { s.setAttribute('aria-pressed',String(s.dataset.appearanceSwatch===color)); });
      status.textContent = (color ? '自选配色' : hex.value ? '待校验配色' : '自动配色')+' · '+(radio ? radio.parentElement.lastElementChild.textContent : '自动安排');
      root.querySelector('.appearance-sample-note').hidden = material !== 'auto';
    }
    swatches.forEach(function(s) { s.addEventListener('click',function() { hex.value=s.dataset.appearanceSwatch; appearance(); },{signal:signal}); });
    picker.addEventListener('input',function() { hex.value=picker.value; appearance(); },{signal:signal});
    root.querySelector('[data-appearance-reset]').addEventListener('click',function() { hex.value=''; appearance(); },{signal:signal});
    root.addEventListener('input',appearance,{signal:signal});
    root.addEventListener('change',appearance,{signal:signal});
    function copy() {
      var cm = form.querySelector('.CodeMirror'), value = cm && cm.CodeMirror ? cm.CodeMirror.getValue() : body ? body.value : '';
      var lines = value.replace(/!\[[^\]]*\]\([^\n]*?\)/g,'').split('\n').map(function(s) { return s.replace(/^\s{0,3}#{1,6}\s+|^\s*>\s?|^\s*[-*+]\s+/g,'').replace(/\[([^\]]+)\]\([^\n]*?\)/g,'$1').replace(/[*_`]/g,'').trim(); }).filter(Boolean);
      preview.querySelector('[data-appearance-title]').textContent=(lines[0]||'你的下一篇文章').slice(0,48);
      preview.querySelector('[data-appearance-excerpt]').textContent=(lines.slice(1).join(' ')||'一点发现，一个故事，或还在酝酿的想法。').slice(0,90);
    }
    var cmNode = form.querySelector('.CodeMirror');
    if (cmNode && cmNode.CodeMirror) { cmNode.CodeMirror.on('change',copy); cleanups.push(function(){cmNode.CodeMirror.off('change',copy);}); }
    if (body) body.addEventListener('input',copy,{signal:signal});
    root.querySelectorAll('[data-appearance-enhanced]').forEach(function(e) {e.hidden=false;});
    appearance(); copy();
  });
  window[KEY] = function() { abort.abort(); cleanups.forEach(function(fn){fn();}); };
}());
