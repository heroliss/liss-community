/* Native MPA navigation remains authoritative. Only the selected article is
   shared, and all input intent skips snapshots synchronously. */
(function(){
  'use strict';
  var key='__lissCommunityTransitions';if(window[key])window[key].destroy();
  var abort=new AbortController(),signal=abort.signal,reduce=matchMedia('(prefers-reduced-motion: reduce)');
  var current=null,named=[],previous=null,submitting=false,serial=0,observed=new WeakSet();
  var storageKey='liss-post-origin-v22';
  function url(value){try{return new URL(value,location.href);}catch(e){return null;}}
  function postId(value){var u=typeof value==='string'?url(value):value,m=u&&u.pathname.match(/\/post\/(\d+)\/?$/);return m?m[1]:null;}
  function samePage(a,b){return !!a&&!!b&&a.origin===b.origin&&a.pathname===b.pathname&&a.search===b.search;}
  function paused(){if(reduce.matches||document.documentElement.dataset.roomMotion==='paused')return true;try{return localStorage.getItem('liss-room-motion')==='paused';}catch(e){return false;}}
  function readOrigin(){try{var o=JSON.parse(sessionStorage.getItem(storageKey));if(o&&/^\d+$/.test(o.id)&&url(o.list)&&url(o.list).origin===location.origin&&Date.now()-o.time<28800000)return o;}catch(e){}return null;}
  function saveOrigin(id){var o={id:id,list:location.href,x:scrollX,y:scrollY,time:Date.now()};try{sessionStorage.setItem(storageKey,JSON.stringify(o));}catch(e){}return o;}
  function restoreNames(){named.forEach(function(e){if(e.value)e.node.style.setProperty('view-transition-name',e.value,e.priority);else e.node.style.removeProperty('view-transition-name');});named=[];}
  function reset(){restoreNames();if(previous){if(previous.present)document.documentElement.setAttribute('data-community-transition',previous.value);else document.documentElement.removeAttribute('data-community-transition');previous=null;}}
  function failed(error){if(!error||error.name!=='AbortError')console.error('[community-transition]',error);}
  function observe(transition){
    if(observed.has(transition))return;observed.add(transition);
    // skipTransition rejects ready, including on paths which never configure a
    // shared post. Observe both promises before any early-exit cancellation.
    transition.ready.then(function(){},failed);transition.finished.then(function(){},failed);
  }
  function skip(){if(current)try{current.skipTransition();}catch(e){failed(e);}}
  function name(node,value){if(!node)return;named.push({node:node,value:node.style.getPropertyValue('view-transition-name'),priority:node.style.getPropertyPriority('view-transition-name')});node.style.setProperty('view-transition-name',value);}
  function article(id){return document.querySelector('.post[data-depth-id="'+id+'"]');}
  function returnLink(){var origin=readOrigin(),id=postId(location.href);if(!origin||origin.id!==id)return;var a=document.querySelector('[data-post-return],.reader-navigation .back-link');if(a){var destination=url(origin.list);destination.hash='';a.href=destination.href;a.setAttribute('aria-label','返回这篇文章在列表中的位置');}}
  function configure(from,to,transition,inbound,activation){
    var token=++serial;reset();
    if(!from||!to||from.origin!==location.origin||to.origin!==location.origin){skip();return;}
    var before=postId(from),after=postId(to),opening=!!after&&after!==before,closing=!!before&&!after;
    if(!opening&&!closing){skip();return;}
    var chosen=opening?after:before,origin=readOrigin();
    if(!inbound&&opening&&article(chosen))origin=saveOrigin(chosen);
    // Native Back restores its own history entry. A normal return link gets the
    // same list position before the inbound snapshot, with no navigation delay.
    if(inbound&&closing&&origin&&origin.id===chosen&&samePage(url(origin.list),to)){
      if(!activation||activation.navigationType!=='traverse')window.scrollTo({left:Number(origin.x)||0,top:Number(origin.y)||0,behavior:'instant'});
    }
    var selected=article(chosen);if(!selected){skip();return;}
    previous={present:document.documentElement.hasAttribute('data-community-transition'),value:document.documentElement.getAttribute('data-community-transition')};
    document.documentElement.dataset.communityTransition=opening?'reading-open':'reading-close';
    // Keep scenery in its own viewport-sized snapshot. It must not be mixed
    // with the much faster root fade while the incoming photograph decodes.
    name(document.querySelector('.community-atmosphere'),'community-landscape');
    name(document.querySelector('.site-header'),'community-navigation');
    name(selected,'liss-post-stage');
    // The whole article travels as one object. Independently interpolated
    // title/image snapshots used different list/reader geometry and ghosted.
    var captured=inbound?transition.ready:transition.finished;
    captured.then(function(){if(token===serial)restoreNames();},function(){if(token===serial)restoreNames();});
    transition.finished.then(function(){if(token===serial){current=null;reset();}},function(){if(token===serial){current=null;reset();}});
  }
  // This listener observes native links only. It never prevents the default,
  // pushes history, fetches HTML or waits for an outgoing animation.
  document.addEventListener('click',function(e){
    if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    var a=e.target.closest&&e.target.closest('a[href]');if(!a||a.hasAttribute('download')||(a.target&&a.target!=='_self'))return;
    var to=url(a.href),id=postId(to);if(to&&to.origin===location.origin&&id&&!postId(location.href)&&article(id))saveOrigin(id);
    if(a.closest('form'))skip();
  },{capture:true,signal:signal});
  window.addEventListener('pageswap',function(e){
    if(!e.viewTransition)return;skip();current=e.viewTransition;observe(current);
    if(paused()||submitting||!e.activation){skip();return;}
    configure(url(location.href),url(e.activation.entry.url),current,false,e.activation);
  },{signal:signal});
  window.addEventListener('pagereveal',function(e){
    submitting=false;returnLink();
    if(!e.viewTransition){reset();current=null;return;}
    skip();current=e.viewTransition;observe(current);if(paused()){skip();return;}
    var activation=window.navigation&&window.navigation.activation;
    if(!activation||!activation.from){skip();return;}
    configure(url(activation.from.url),url(activation.entry.url),current,true,activation);
  },{signal:signal});
  // A freshly revealed login must accept fill/click/submit immediately, even
  // while the browser is still displaying an incoming snapshot.
  ['pointerdown','keydown','focusin','beforeinput','input','compositionstart'].forEach(function(type){document.addEventListener(type,skip,{capture:true,passive:type==='pointerdown',signal:signal});});
  document.addEventListener('submit',function(){submitting=true;skip();},{capture:true,signal:signal});
  reduce.addEventListener('change',function(){if(paused())skip();},{signal:signal});window.addEventListener('liss:motion-state',function(){if(paused())skip();},{signal:signal});
  window.addEventListener('storage',function(e){if(e.key==='liss-room-motion'&&paused())skip();},{signal:signal});
  document.addEventListener('DOMContentLoaded',returnLink,{once:true,signal:signal});
  // pageswap.finished owns outbound snapshot cleanup. pagehide must not erase
  // names before that capture; a BFCache reveal always resets them below.
  window.addEventListener('pageshow',function(e){if(e.persisted){reset();current=null;submitting=false;returnLink();}},{signal:signal});
  window[key]={destroy:function(){++serial;skip();reset();abort.abort();delete window[key];}};
})();
