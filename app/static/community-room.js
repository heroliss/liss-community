(function(){
  'use strict';
  var dispose=null;
  function mount(){
    if(dispose)dispose();
    var root=document.documentElement,abort=new AbortController(),signal=abort.signal;
    var preference=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(hover:hover) and (pointer:fine)');
    var scenes=Array.from(document.querySelectorAll('[data-room-scene]')).map(function(element){return {element:element,visible:false,bounds:null,x:0,y:0};});
    var control=document.querySelector('[data-room-motion-toggle]'),paused=false,frame=0,closed=false;
    try{paused=localStorage.getItem('liss-room-motion')==='paused';}catch(e){}
    function enabled(scene){return !closed&&!paused&&!preference.matches&&!document.hidden&&fine.matches&&scene.visible;}
    function paint(){frame=0;scenes.forEach(function(scene){var x=enabled(scene)?scene.x:0,y=enabled(scene)?scene.y:0;scene.element.style.setProperty('--room-x',(x*6).toFixed(2)+'px');scene.element.style.setProperty('--room-y',(y*4).toFixed(2)+'px');scene.element.style.setProperty('--room-rx',(-y*3).toFixed(2)+'deg');scene.element.style.setProperty('--room-ry',(x*4).toFixed(2)+'deg');});}
    function schedule(){if(!frame)frame=requestAnimationFrame(paint);}
    function gate(){root.dataset.roomMotion=paused||preference.matches?'paused':'ready';if(control){control.hidden=false;control.disabled=preference.matches;control.setAttribute('aria-pressed',String(paused||preference.matches));var label=control.querySelector('[data-room-motion-label]');if(label)label.textContent=preference.matches?'已减少动态':paused?'继续动效':'暂停动效';}schedule();}
    var observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){var scene=scenes.find(function(item){return item.element===entry.target;});if(scene){scene.visible=entry.isIntersecting;if(!scene.visible){scene.x=0;scene.y=0;}}});schedule();},{rootMargin:'40px'});
    scenes.forEach(function(scene){
      observer.observe(scene.element);
      function measure(){var r=scene.element.getBoundingClientRect();scene.bounds={left:r.left+scrollX,top:r.top+scrollY,width:r.width,height:r.height};}
      scene.element.addEventListener('pointerenter',measure,{signal:signal});
      scene.element.addEventListener('pointermove',function(event){if(!enabled(scene)||event.pointerType==='touch')return;if(!scene.bounds)measure();scene.x=Math.max(-1,Math.min(1,(event.pageX-scene.bounds.left)/Math.max(1,scene.bounds.width)*2-1));scene.y=Math.max(-1,Math.min(1,(event.pageY-scene.bounds.top)/Math.max(1,scene.bounds.height)*2-1));schedule();},{passive:true,signal:signal});
      scene.element.addEventListener('pointerleave',function(){scene.x=scene.y=0;schedule();},{signal:signal});
    });
    if(control)control.addEventListener('click',function(){paused=!paused;try{localStorage.setItem('liss-room-motion',paused?'paused':'ready');}catch(e){}gate();},{signal:signal});
    preference.addEventListener('change',gate,{signal:signal});fine.addEventListener('change',gate,{signal:signal});
    document.addEventListener('visibilitychange',gate,{signal:signal});
    window.addEventListener('blur',function(){scenes.forEach(function(scene){scene.x=scene.y=0;});schedule();},{signal:signal});
    window.addEventListener('resize',function(){scenes.forEach(function(scene){scene.bounds=null;scene.x=scene.y=0;});schedule();},{signal:signal});
    function syncThemeColour(){var meta=document.getElementById('theme-color');if(meta)meta.content=getComputedStyle(root).getPropertyValue('--bg').trim();}
    var themeObserver=new MutationObserver(syncThemeColour);
    themeObserver.observe(root,{attributes:true,attributeFilter:['data-theme']});
    syncThemeColour();
    document.querySelectorAll('form[aria-busy]').forEach(function(form){form.removeAttribute('aria-busy');var pending=form.querySelector('.form-pending');if(pending)pending.textContent='';});
    gate();
    dispose=function(){closed=true;abort.abort();observer.disconnect();themeObserver.disconnect();if(frame)cancelAnimationFrame(frame);scenes.forEach(function(scene){['--room-x','--room-y','--room-rx','--room-ry'].forEach(function(name){scene.element.style.removeProperty(name);});});};
  }
  mount();
  window.addEventListener('pagehide',function(){if(dispose)dispose();});
  window.addEventListener('pageshow',function(event){if(event.persisted)mount();});
})();
