/* A deliberate, finite reveal for the writing desk. Native details remains the
   fallback and source of semantics; navigation remains the only focus owner. */
(function(){
  'use strict';
  var KEY='__lissCommunityDisclosure';if(window[KEY])window[KEY].destroy();
  var lifetime=new AbortController(),dispose=null,readState=function(){return[];};
  function mount(){
    if(dispose)dispose();
    var abort=new AbortController(),signal=abort.signal,closed=false;
    var reduce=matchMedia('(prefers-reduced-motion:reduce)'),states=[],inserted=[];
    var openObserver=new MutationObserver(function(){states.forEach(function(state){if(state.root.open!==state.renderedOpen)transition(state,state.root.open);});});
    function moving(){return !closed&&!document.hidden&&!reduce.matches&&document.documentElement.dataset.roomMotion!=='paused';}
    function ownOpen(state,value){state.renderedOpen=value;state.root.open=value;}
    function restoreStyle(state){
      ['height','overflow','box-sizing','padding-top','padding-bottom'].forEach(function(name){var old=state.styles[name];if(old.value)state.body.style.setProperty(name,old.value,old.priority);else state.body.style.removeProperty(name);});
    }
    function stopAnimation(state){
      var animation=state.animation;state.animation=null;
      if(animation){animation.onfinish=null;animation.oncancel=null;animation.cancel();}
    }
    function restoreInert(state){if(!state.inert)state.body.removeAttribute('inert');}
    function finish(state){
      stopAnimation(state);restoreStyle(state);restoreInert(state);
      ownOpen(state,state.target);state.phase='idle';state.root.removeAttribute('data-disclosure-phase');
      document.dispatchEvent(new CustomEvent('liss:depth-content',{detail:{target:state.root}}));
    }
    function transition(state,opening){
      // Snapshot a live in-flight height before cancelling so a second click
      // reverses from the visible position rather than starting a new jump.
      // navigation sets .open before dispatching liss:write. renderedOpen, rather
      // than that newly changed attribute, describes what the reader had seen.
      var wasOpen=state.renderedOpen,actuallyOpen=state.root.open,before=getComputedStyle(state.body);
      var from=wasOpen?(actuallyOpen?state.body.getBoundingClientRect().height:(parseFloat(before.height)||state.lastHeight)):0;
      var fromTop=wasOpen?parseFloat(before.paddingTop)||0:0,fromBottom=wasOpen?parseFloat(before.paddingBottom)||0:0;
      var interrupted=!!state.animation;
      stopAnimation(state);restoreStyle(state);restoreInert(state);state.target=opening;
      if(!opening&&state.body.contains(document.activeElement))state.summary.focus({preventScroll:true});
      if(!moving()||typeof state.body.animate!=='function'){finish(state);return;}
      ownOpen(state,true);
      var natural=state.body.getBoundingClientRect().height,after=getComputedStyle(state.body),top=parseFloat(after.paddingTop)||0,bottom=parseFloat(after.paddingBottom)||0;state.lastHeight=natural;
      if(!opening&&!wasOpen&&!interrupted){from=natural;fromTop=top;fromBottom=bottom;}
      var to=opening?natural:0;
      if(Math.abs(to-from)<1){finish(state);return;}
      state.phase=opening?'opening':'closing';state.root.dataset.disclosurePhase=state.phase;
      if(!opening)state.body.setAttribute('inert','');
      state.body.style.setProperty('box-sizing','border-box');
      state.body.style.setProperty('height',to+'px');
      state.body.style.setProperty('overflow','clip');
      // The following feed must make room. Padding collapses with the height
      // so its minimum border-box cannot leave a final 30px closing jump.
      // There is no per-frame JS measurement or permanent RAF.
      var duration=Math.min(opening?760:560,Math.max(opening?420:320,Math.abs(to-from)*(opening?.55:.45)));
      var animation=state.body.animate([{height:from+'px',paddingTop:fromTop+'px',paddingBottom:fromBottom+'px'},{height:to+'px',paddingTop:(opening?top:0)+'px',paddingBottom:(opening?bottom:0)+'px'}],{duration:duration,easing:opening?'cubic-bezier(.22,.8,.22,1)':'cubic-bezier(.4,0,.6,1)',fill:'both'});
      state.animation=animation;animation.onfinish=function(){if(state.animation===animation)finish(state);};
    }
    document.querySelectorAll('details.composer').forEach(function(root){
      var summary=root.querySelector(':scope>summary'),body=root.querySelector(':scope>.composer-content');if(!summary||!body)return;
      var state={root:root,summary:summary,body:body,target:root.open,renderedOpen:root.open,phase:'idle',animation:null,lastHeight:root.open?body.getBoundingClientRect().height:0,inert:body.hasAttribute('inert'),styles:{}};
      ['height','overflow','box-sizing','padding-top','padding-bottom'].forEach(function(name){state.styles[name]={value:body.style.getPropertyValue(name),priority:body.style.getPropertyPriority(name)};});
      states.push(state);
      openObserver.observe(root,{attributes:true,attributeFilter:['open']});
      var light=document.createElement('span');light.className='composer-invitation-light';light.setAttribute('aria-hidden','true');light.appendChild(document.createElement('i'));summary.appendChild(light);inserted.push(light);
      var orbit=document.createElement('span');orbit.className='composer-invitation-orbit';orbit.setAttribute('aria-hidden','true');summary.appendChild(orbit);inserted.push(orbit);
      summary.addEventListener('click',function(event){
        if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;
        var control=event.target.closest&&event.target.closest('a,button,input,select,textarea');if(control&&summary.contains(control))return;
        // With no animation API the native summary behaviour is left intact.
        if(typeof body.animate!=='function')return;
        event.preventDefault();transition(state,!state.target);
      },{signal:signal});
      root.addEventListener('toggle',function(event){
        if(event.target!==root||root.open===state.renderedOpen)return;
        transition(state,root.open);
      },{signal:signal});
      root.addEventListener('focusin',function(event){if(state.animation&&body.contains(event.target))finish(state);},{signal:signal});
      root.addEventListener('submit',function(){if(state.animation)finish(state);},{capture:true,signal:signal});
    });
    function finishAll(){states.forEach(function(state){
      // A synchronous pause/resize can arrive before the open observer's
      // microtask. Honour that newer native intent instead of overwriting it.
      if(state.root.open!==state.renderedOpen){state.target=state.root.open;finish(state);}
      else if(state.animation)finish(state);
    });}
    function gate(){if(!moving())finishAll();}
    document.addEventListener('liss:write',function(event){var target=event.detail&&event.detail.target;states.forEach(function(state){if(!target||target===state.root)if(!state.target)transition(state,true);});},{signal:signal});
    // Finish before writing.js focuses the input. This does not initiate focus,
    // scroll, history or a second anchor-settle loop.
    document.addEventListener('liss:write-focus',function(event){var target=event.detail&&event.detail.target;states.forEach(function(state){if(state.animation&&(!target||target===state.root))finish(state);});},{capture:true,signal:signal});
    window.addEventListener('resize',finishAll,{passive:true,signal:signal});
    window.addEventListener('liss:motion-state',gate,{signal:signal});reduce.addEventListener('change',gate,{signal:signal});document.addEventListener('visibilitychange',gate,{signal:signal});
    var observer=new MutationObserver(gate);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-room-motion']});
    readState=function(){return states.map(function(s){return{id:s.root.id,open:s.root.open,target:s.target,phase:s.phase,animating:!!s.animation};});};
    dispose=function(){if(closed)return;closed=true;abort.abort();observer.disconnect();openObserver.disconnect();finishAll();inserted.forEach(function(node){node.remove();});readState=function(){return[];};};
  }
  window.addEventListener('pagehide',function(){if(dispose)dispose();},{signal:lifetime.signal});
  window.addEventListener('pageshow',function(event){if(event.persisted)mount();},{signal:lifetime.signal});
  window[KEY]={inspect:function(){return{version:'disclosure-v32',states:readState()};},destroy:function(){if(dispose)dispose();lifetime.abort();delete window[KEY];}};
  mount();
})();
