/* A draft owns this document's light, never another document's preferences. */
(function () {
  'use strict';
  if (window.LissTheme) window.LissTheme.destroy();
  var root = document.documentElement, body = document.body;
  if (!body || !body.classList.contains('community-room')) return;
  var abort = new AbortController(), signal = abort.signal, owner = null, lastKey = null;
  var saved = normalize(body.dataset.postThemeColor || '') || '', current = saved, restored = new Map();
  function normalize(value) { return value === '' ? '' : typeof value === 'string' && value.length === 7 && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : null; }
  function palette(value) {
    var color = normalize(value);
    if (color === null) return null;
    var rgb = color ? [1,3,5].map(function (i) { return parseInt(color.slice(i,i+2),16); }) : [0,0,0];
    var max = Math.max.apply(Math,rgb), min = Math.min.apply(Math,rgb), range = max-min, hue = 0, saturation = 0;
    if (range) {
      var numerator = max === rgb[0] ? 60*(rgb[1]-rgb[2]) : max === rgb[1] ? 120*range+60*(rgb[2]-rgb[0]) : 240*range+60*(rgb[0]-rgb[1]);
      var turn = 360*range, denominator = max+min <= 255 ? max+min : 510-max-min;
      numerator = (numerator%turn+turn)%turn;
      hue = Math.floor((2*numerator+range)/(2*range))%360;
      saturation = 100*range < 8*denominator ? 0 : Math.max(18,Math.min(55,Math.floor((200*range+denominator)/(2*denominator))));
    }
    function hex(l, chroma) {
      var c = (100-Math.abs(2*l-100))*(chroma === undefined ? saturation : chroma);
      var x = c*(60-Math.abs(hue%120-60))*2, primary=c*120, base=(200*l-c)*60;
      var channels = hue < 60 ? [primary,x,0] : hue < 120 ? [x,primary,0] : hue < 180 ? [0,primary,x] : hue < 240 ? [0,x,primary] : hue < 300 ? [x,0,primary] : [primary,0,x];
      return '#'+channels.map(function (v) { return Math.floor((2*(v+base)*255+1200000)/2400000).toString(16).padStart(2,'0'); }).join('');
    }
    return { color:color, hue:hue, saturation:saturation, active:!!color,
      dark:{accent:hex(72),hover:hex(82),ink:hex(10,Math.min(saturation,24)),background:hex(7,Math.min(saturation,22)),
        surface:hex(11,Math.min(saturation,14)),raised:hex(16,Math.min(saturation,14)),input:hex(9,Math.min(saturation,12)),
        line:hex(28,Math.min(saturation,10)),muted:hex(74,Math.min(saturation,8)),subtle:hex(66,Math.min(saturation,8)),text:'#e9edec'},
      light:{accent:hex(27),hover:hex(21),ink:hex(99,Math.min(saturation,12)),background:hex(96,Math.min(saturation,16)),
        surface:hex(98,Math.min(saturation,6)),raised:hex(92,Math.min(saturation,10)),input:hex(99,Math.min(saturation,6)),
        line:hex(74,Math.min(saturation,9)),muted:hex(34,Math.min(saturation,8)),subtle:hex(39,Math.min(saturation,8)),text:'#24282a'} };
  }
  function appearanceEvent(target, look, source) {
    document.dispatchEvent(new CustomEvent('liss:appearance-change',{detail:{target:target,color:look.color,hue:look.hue,saturation:look.saturation,source:source}}));
  }
  function tint(element, value, source) {
    var look = palette(value); if (!look || !element) return;
    if (!restored.has(element)) restored.set(element, ['--appearance-hue','--appearance-saturation','--appearance-accent'].map(function (p) { return [p,element.style.getPropertyValue(p)]; }));
    element.style.setProperty('--appearance-hue',String(look.hue));
    element.style.setProperty('--appearance-saturation',look.saturation+'%');
    element.style.setProperty('--appearance-accent',look.active ? look[root.dataset.theme === 'light' ? 'light' : 'dark'].accent : 'var(--accent)');
    appearanceEvent(element,look,source || 'post');
  }
  function refresh() {
    document.querySelectorAll('article.post[data-theme-color],[data-post-theme-card],[data-appearance-preview]').forEach(function (el) { tint(el,el.dataset.themeColor || '','mode'); });
  }
  function apply(value, source) {
    var look = palette(value); if (!look) return false;
    current = look.color;
    if (look.active) {
      body.dataset.communityTheme = source === 'draft' ? 'draft' : 'post';
      body.style.setProperty('--community-hue',String(look.hue));
      body.style.setProperty('--community-saturation',look.saturation+'%');
    } else {
      delete body.dataset.communityTheme;
      body.style.removeProperty('--community-hue'); body.style.removeProperty('--community-saturation');
    }
    var key = look.color+'|'+(root.dataset.theme || 'dark');
    if (lastKey !== key) {
      lastKey = key;
      window.dispatchEvent(new CustomEvent('liss:theme-change',{detail:{color:look.color,hue:look.hue,saturation:look.saturation,active:look.active,source:source}}));
    }
    return true;
  }
  function restore(requester) { if (requester && owner !== requester) return; owner=null; apply(saved,'post'); }
  var observer = new MutationObserver(function () { refresh(); apply(current,owner ? 'draft' : 'post'); });
  observer.observe(root,{attributes:true,attributeFilter:['data-theme']});
  window.addEventListener('pagehide',function () { restore(); observer.disconnect(); },{signal:signal});
  window.addEventListener('pageshow',function (event) {
    if (!event.persisted) return;
    observer.observe(root,{attributes:true,attributeFilter:['data-theme']}); refresh(); apply(saved,'post');
    document.dispatchEvent(new Event('liss:theme-resume'));
  },{signal:signal});
  window.LissTheme = {
    normalize:normalize,palette:palette,tint:tint,refresh:refresh,
    preview:function (value,requester) { if (palette(value) === null) return false; owner=requester; return apply(value,'draft'); },
    restore:restore,
    destroy:function () {
      abort.abort(); observer.disconnect(); restore();
      restored.forEach(function (properties,el) { properties.forEach(function (p) { if (p[1]) el.style.setProperty(p[0],p[1]); else el.style.removeProperty(p[0]); }); });
      restored.clear();
    }
  };
  refresh(); apply(saved,'post');
}());
