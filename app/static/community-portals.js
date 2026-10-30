/* The sculpture has a camera. The form never does. */
(function(){
  'use strict';
  var key='__lissCommunityPortals';if(window[key])window[key].destroy();
  var life=new AbortController(),dispose=null;
  function mount(){
    if(dispose)dispose();
    var abort=new AbortController(),signal=abort.signal,closed=false,frame=0,last=0;
    var reduce=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(hover:hover) and (pointer:fine)');
    var scenes=[],pressed=false,awake=true;
    document.querySelectorAll('[data-portal-page]').forEach(function(root){
      var art=root.querySelector('[data-portal-tilt]'),camera=root.querySelector('[data-portal-camera]'),form=root.querySelector('form');if(!art||!camera||!form)return;
      var scene={root:root,art:art,camera:camera,form:form,current:[0,0,0],target:[0,0,0],bounds:null,hover:false,inside:false,written:[],saved:camera.getAttribute('style')};scenes.push(scene);
      function copy(){
        var field=form.elements.name||form.elements.nickname||form.elements.username;
        var name=root.querySelector('[data-portal-name]'),bio=root.querySelector('[data-portal-bio]');
        var value=field&&field.value.trim();
        if(!value&&form.elements.nickname&&form.elements.username)value=form.elements.username.value.trim();
        if(name&&field)name.textContent=(value||art.dataset.portalDefaultName||'你的名字').slice(0,36);
        if(bio&&form.elements.about_me)bio.textContent=form.elements.about_me.value.trim().slice(0,160)||'关于你的几句话，会出现在这里。';
      }
      form.addEventListener('input',copy,{signal:signal});copy();
      art.addEventListener('pointermove',function(e){
        if(e.pointerType==='touch'||!fine.matches||blocked(scene))return;
        if(!scene.bounds)scene.bounds=art.getBoundingClientRect();
        var b=scene.bounds,x=Math.max(-1,Math.min(1,(e.clientX-b.left)/Math.max(1,b.width)*2-1)),y=Math.max(-1,Math.min(1,(e.clientY-b.top)/Math.max(1,b.height)*2-1));
        scene.inside=true;scene.target=[-y*11,x*16.5,-y*4];schedule();
      },{passive:true,signal:signal});
      art.addEventListener('pointerleave',function(){scene.inside=false;scene.bounds=null;if(!blocked(scene)){scene.target=[0,0,0];schedule();}},{passive:true,signal:signal});
      var console=root.querySelector('.portal-console');
      console.addEventListener('pointerenter',function(){scene.hover=true;freeze(scene);},{passive:true,signal:signal});
      console.addEventListener('pointerleave',function(){scene.hover=false;gate();},{passive:true,signal:signal});
    });
    if(!scenes.length){dispose=null;return;}
    function focused(scene){return !!document.activeElement&&scene.form.contains(document.activeElement);}
    function blocked(scene){return closed||document.hidden||!awake||pressed||reduce.matches||!fine.matches||document.documentElement.dataset.roomMotion==='paused'||scene.hover||focused(scene);}
    function freeze(scene){scene.target=scene.current.slice();}
    function schedule(){if(!closed&&!frame&&!document.hidden)frame=requestAnimationFrame(paint);}
    function paint(now){frame=0;if(closed)return;var blend=1-Math.exp(-(last?Math.min(48,now-last):16)/120),again=false;last=now;
      scenes.forEach(function(s){if(blocked(s))return;s.current.forEach(function(v,i){var d=s.target[i]-v;if(Math.abs(d)>.01){s.current[i]+=d*blend;again=true;}else s.current[i]=s.target[i];var next=s.current[i].toFixed(2)+(i<2?'deg':'px');if(next!==s.written[i]){s.camera.style.setProperty(['--portal-rx','--portal-ry','--portal-token-y'][i],next);s.written[i]=next;}});});
      if(again)schedule();else last=0;
    }
    function gate(){scenes.forEach(function(s){if(blocked(s))freeze(s);else if(!s.inside)s.target=[0,0,0];});if(document.hidden){if(frame)cancelAnimationFrame(frame);frame=0;last=0;}else schedule();}
    document.addEventListener('focusin',gate,{signal:signal});document.addEventListener('focusout',function(){queueMicrotask(function(){if(!closed)gate();});},{signal:signal});
    document.addEventListener('pointerdown',function(){pressed=true;scenes.forEach(freeze);},{capture:true,passive:true,signal:signal});
    window.addEventListener('pointerup',function(){pressed=false;gate();},{passive:true,signal:signal});window.addEventListener('pointercancel',function(){pressed=false;gate();},{passive:true,signal:signal});
    window.addEventListener('resize',function(){scenes.forEach(function(s){s.bounds=null;});},{passive:true,signal:signal});
    window.addEventListener('blur',function(){awake=false;gate();},{signal:signal});window.addEventListener('focus',function(){awake=true;gate();},{signal:signal});
    document.addEventListener('visibilitychange',gate,{signal:signal});window.addEventListener('liss:motion-state',gate,{signal:signal});reduce.addEventListener('change',gate,{signal:signal});fine.addEventListener('change',gate,{signal:signal});
    var observer=new MutationObserver(gate);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-room-motion']});
    dispose=function(){closed=true;abort.abort();observer.disconnect();if(frame)cancelAnimationFrame(frame);frame=0;scenes.forEach(function(s){if(s.saved===null)s.camera.removeAttribute('style');else s.camera.setAttribute('style',s.saved);});};
  }
  window.addEventListener('pagehide',function(){if(dispose)dispose();},{signal:life.signal});window.addEventListener('pageshow',function(e){if(e.persisted)mount();},{signal:life.signal});
  window[key]={destroy:function(){if(dispose)dispose();life.abort();delete window[key];}};mount();
})();
