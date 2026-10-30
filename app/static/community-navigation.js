/* One owner for deliberate anchor navigation. Native MPA links, browser Back,
   modified clicks and editor-internal scrolling retain their native behavior. */
(function(){
  'use strict';
  var KEY='__lissCommunityNavigation';if(window[KEY])window[KEY].destroy();
  var abort=new AbortController(),signal=abort.signal,reduce=matchMedia('(prefers-reduced-motion:reduce)');
  var frame=0,serial=0,last=null,closed=false;
  function stop(){serial++;if(frame)cancelAnimationFrame(frame);frame=0;}
  function smooth(){return !reduce.matches&&document.documentElement.dataset.roomMotion!=='paused';}
  function find(hash){try{return document.getElementById(decodeURIComponent(hash.replace(/^#/,'')));}catch(error){return null;}}
  function focus(target){
    if(target.id==='write'){
      var event=new CustomEvent('liss:write-focus',{cancelable:true,detail:{target:target}});
      document.dispatchEvent(event);
      if(!event.defaultPrevented){var input=target.querySelector('textarea,input:not([type=hidden])');if(input)input.focus({preventScroll:true});}
      return;
    }
    if(!target.matches('a,button,input,textarea,select,[tabindex]')){
      target.setAttribute('tabindex','-1');
      target.addEventListener('blur',function(){target.removeAttribute('tabindex');},{once:true,signal:signal});
    }
    target.focus({preventScroll:true});
  }
  function go(hash,focusAfter){
    stop();var target=find(hash);if(!target)return false;
    var token=serial;
    if(target.id==='write'){
      if(target.tagName==='DETAILS')target.open=true;
      document.dispatchEvent(new CustomEvent('liss:write',{detail:{target:target}}));
    }
    var eased=smooth();
    last={hash:hash,behavior:eased?'smooth':'instant',focusAfter:!!focusAfter};
    target.scrollIntoView({behavior:last.behavior,block:'start'});
    if(!focusAfter)return true;
    if(!eased){focus(target);return true;}
    var started=performance.now(),previous=scrollY,stable=0;
    function settle(now){
      frame=0;if(closed||token!==serial||!target.isConnected)return;
      stable=Math.abs(scrollY-previous)<.5?stable+1:0;previous=scrollY;
      // Keep the existing single settle loop. A desk already at its anchor
      // still needs time to finish opening before editor focus removes its clip.
      var revealing=target.dataset&&target.dataset.disclosurePhase;
      if((stable>=4&&now-started>140&&!revealing)||now-started>1800){focus(target);return;}
      frame=requestAnimationFrame(settle);
    }
    frame=requestAnimationFrame(settle);return true;
  }
  document.addEventListener('click',function(event){
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    var link=event.target.closest&&event.target.closest('a[href]');
    if(!link||link.hasAttribute('download')||(link.target&&link.target!=='_self'))return;
    var url;try{url=new URL(link.href,location.href);}catch(error){return;}
    if(url.origin!==location.origin||url.pathname!==location.pathname||(url.search&&url.search!==location.search)||!url.hash||!find(url.hash))return;
    // A local fragment may have been rendered without preview query parameters.
    // Keep this history entry's actual query rather than navigating/reloading it.
    event.preventDefault();
    if(location.hash!==url.hash)history.pushState(null,'',location.pathname+location.search+url.hash);
    go(url.hash,true);
  },{signal:signal});
  window.addEventListener('hashchange',function(){go(location.hash,true);},{signal:signal});
  ['wheel','touchstart','pointerdown','keydown'].forEach(function(type){document.addEventListener(type,stop,{capture:true,passive:true,signal:signal});});
  window.addEventListener('pagehide',stop,{signal:signal});
  function motionGate(){if(!smooth()){stop();window.scrollTo({top:scrollY,left:scrollX,behavior:'instant'});}}
  reduce.addEventListener('change',motionGate,{signal:signal});
  window.addEventListener('liss:motion-state',motionGate,{signal:signal});
  document.addEventListener('visibilitychange',function(){if(document.hidden)stop();},{signal:signal});
  if(location.hash)go(location.hash,true);
  window[KEY]={inspect:function(){return{version:'navigation-v27',framePending:!!frame,last:last,reduced:reduce.matches};},destroy:function(){closed=true;stop();abort.abort();delete window[KEY];}};
})();
