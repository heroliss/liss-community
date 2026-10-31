/* One preference, one article DOM. Native navigation owns pagination/return;
   spatial and material controllers keep all transform and shader ownership. */
(function(){
  'use strict';
  var key='__lissCommunityFeed',storageKey='liss-feed-view:v1';
  if(window[key]&&window[key].destroy)window[key].destroy();
  var feeds=Array.from(document.querySelectorAll('[data-feed-list]'));
  if(!feeds.length)return;
  var html=document.documentElement,controls=Array.from(document.querySelectorAll('[data-feed-view-control]'));
  var abort=new AbortController(),signal=abort.signal,reduce=matchMedia('(prefers-reduced-motion: reduce)');
  var animations=[],current=null;
  function valid(value){return value==='cards'||value==='list';}
  function read(){
    var value;
    try{value=localStorage.getItem(storageKey);}catch(error){}
    if(!valid(value))try{value=sessionStorage.getItem(storageKey);}catch(error){}
    return valid(value)?value:'cards';
  }
  function remember(value){
    try{sessionStorage.setItem(storageKey,value);}catch(error){}
    try{localStorage.setItem(storageKey,value);}catch(error){}
  }
  function stop(){animations.forEach(function(animation){animation.cancel();});animations=[];}
  function motion(){return !reduce.matches&&html.dataset.roomMotion!=='paused';}
  function reveal(){
    if(!motion())return;
    feeds.forEach(function(feed){
      var visible=0;
      feed.querySelectorAll('.post-copy').forEach(function(copy){
        var bounds=copy.getBoundingClientRect();
        if(bounds.bottom<=0||bounds.top>=innerHeight||visible>=6||!copy.animate)return;
        animations.push(copy.animate([{opacity:.7,clipPath:'inset(0 0 15% 0)'},{opacity:1,clipPath:'inset(0)'}],{
          duration:200,delay:visible++*18,easing:'cubic-bezier(.16,1,.3,1)',fill:'none'
        }));
      });
    });
  }
  function apply(value,userAction){
    if(!valid(value))value='cards';
    var changed=current!==value;
    current=value;stop();html.dataset.feedView=value;
    controls.forEach(function(control){
      control.querySelectorAll('[data-feed-view-value]').forEach(function(button){
        button.setAttribute('aria-pressed',String(button.dataset.feedViewValue===value));
      });
      control.hidden=false;
    });
    if(!changed)return;
    // data-feed-view is outside both controllers' observed attribute lists.
    document.dispatchEvent(new CustomEvent('liss:depth-content',{detail:{source:'feed-view',view:value}}));
    if(userAction)reveal();
  }
  function choose(button){
    var value=button.dataset.feedViewValue;
    if(!valid(value))return;
    remember(value);apply(value,true);
  }
  controls.forEach(function(control){
    control.addEventListener('click',function(event){
      var button=event.target.closest('[data-feed-view-value]');
      if(button&&control.contains(button))choose(button);
    },{signal:signal});
    control.addEventListener('keydown',function(event){
      var button=event.target.closest('[data-feed-view-value]');
      if(!button||!control.contains(button)||event.altKey||event.ctrlKey||event.metaKey)return;
      var buttons=Array.from(control.querySelectorAll('[data-feed-view-value]')),index=buttons.indexOf(button),next;
      if(event.key==='ArrowRight'||event.key==='ArrowDown')next=(index+1)%buttons.length;
      else if(event.key==='ArrowLeft'||event.key==='ArrowUp')next=(index+buttons.length-1)%buttons.length;
      else if(event.key==='Home')next=0;
      else if(event.key==='End')next=buttons.length-1;
      else return;
      event.preventDefault();buttons[next].focus({preventScroll:true});choose(buttons[next]);
    },{signal:signal});
  });
  reduce.addEventListener('change',function(){if(!motion())stop();},{signal:signal});
  window.addEventListener('liss:motion-state',function(){if(!motion())stop();},{signal:signal});
  window.addEventListener('storage',function(event){
    if(event.key!==storageKey&&event.key!==null)return;
    var value=valid(event.newValue)?event.newValue:'cards';
    // The local cache follows another tab, including a clear/reset. A tab that
    // cannot access persistent storage still keeps a working local selection.
    try{sessionStorage.setItem(storageKey,value);}catch(error){}
    apply(value,false);
  },{signal:signal});
  window.addEventListener('pageshow',function(event){if(event.persisted)apply(read(),false);},{signal:signal});
  window.addEventListener('pagehide',stop,{signal:signal});
  apply(read(),false);
  window[key]={destroy:function(){stop();abort.abort();controls.forEach(function(control){control.hidden=true;});delete window[key];}};
})();
