/* Optional viewing controls. Opening is temporary; background preferences stay local. */
(function(){
  'use strict';
  var KEY='LissBackgroundViewer';
  if(window[KEY]&&window[KEY].destroy)window[KEY].destroy();
  var root=document.querySelector('[data-background-viewer]'),backgrounds=window.LissBackgrounds;
  if(!root||!backgrounds)return;
  var lifetime=new AbortController(),signal=lifetime.signal,entries=backgrounds.list(),active=false,clear=false,returnFocus=null,suppressed=[],clearScroll=null;
  var previous=root.querySelector('[data-review-previous]'),next=root.querySelector('[data-review-next]'),clearButton=root.querySelector('[data-review-clear]'),details=root.querySelector('[data-review-details]');
  var dock=root.querySelector('[data-review-dock]'),reveal=root.querySelector('[data-review-reveal]'),collapseButton=root.querySelector('[data-review-collapse]');
  var activeEvents=null,sizeObserver=null,idleTimer=0,layoutFrame=0,collapsed=false,placement='bottom',lift=0,dockBottom=14;
  var pointerNear=false,keyboardMode=false,keyboardHold=false,movingFocus=false,manualQuiet=false,lastPointer=null,region=null,handleRegion=null;
  var IDLE_DELAY=2400,FOOTER_GAP=12;
  function button(selector,handler){var node=root.querySelector(selector);node.addEventListener('click',handler,{signal:signal});return node;}
  function current(){var id=backgrounds.read().id;return entries.find(function(e){return e.id===id;})||entries[0];}
  function read(){return{active:active,onlyBackground:clear,id:current().id,collapsed:collapsed,placement:placement,dockBottom:dockBottom};}
  function announce(text){root.querySelector('[data-review-status]').textContent=text;}
  function cancelIdle(){if(idleTimer)clearTimeout(idleTimer);idleTimer=0;}
  function modalOpen(){return !!document.querySelector('dialog[open],.image-viewer[aria-hidden="false"]');}
  function held(){return pointerNear||keyboardHold||details.open||modalOpen()||document.hidden;}
  function armIdle(){
    cancelIdle();if(!active||collapsed||held())return;
    idleTimer=setTimeout(function(){idleTimer=0;if(active&&!held())setCollapsed(true);},IDLE_DELAY);
  }
  function setCollapsed(value){
    if(!active)return;value=!!value;if(value===collapsed)return;
    cancelIdle();collapsed=value;root.dataset.viewerCollapsed=String(value);
    if(reveal){reveal.hidden=!value;reveal.setAttribute('aria-expanded',String(!value));}
    if(value){
      // Programmatic focus from opening with a mouse must not pin the dock.
      // Move it before hiding the subtree, without treating this as a reveal.
      if(dock.contains(document.activeElement)){movingFocus=true;(reveal||root).focus({preventScroll:true});movingFocus=false;}
      dock.setAttribute('inert','');dock.setAttribute('aria-hidden','true');
    }else{dock.removeAttribute('inert');dock.removeAttribute('aria-hidden');}
  }
  function inside(point,box){return !!point&&!!box&&point.x>=box.left&&point.x<=box.right&&point.y>=box.top&&point.y<=box.bottom;}
  function nearPointer(point){
    if(!active||!point)return;var near=inside(point,region)||inside(point,handleRegion);
    if(manualQuiet){if(near)return;manualQuiet=false;}
    if(near===pointerNear)return;
    pointerNear=near;
    if(near){cancelIdle();if(placement!=='parked')show(false,false);}else armIdle();
  }
  function arrange(){
    if(!active||document.hidden)return;
    var height=window.innerHeight||document.documentElement.clientHeight||720,rect=dock.getBoundingClientRect();
    var computed=parseFloat(getComputedStyle(dock).bottom),base=Number.isFinite(computed)?Math.max(0,computed-lift):(window.innerWidth<=600?10:14);
    var footer=clear?null:document.querySelector('.site-footer'),bounds=footer?footer.getBoundingClientRect():null;
    var nextLift=0,nextPlacement='bottom',top=height-base-rect.height;
    if(bounds&&bounds.top<height&&bounds.bottom>0&&bounds.top<height-base+FOOTER_GAP&&bounds.bottom>top-FOOTER_GAP){
      nextLift=Math.max(0,height-bounds.top+FOOTER_GAP-base);
      nextPlacement=bounds.top-FOOTER_GAP>=rect.height+FOOTER_GAP?'above-footer':'parked';
    }
    lift=nextLift;dockBottom=base+lift;placement=nextPlacement;
    root.style.setProperty('--viewer-footer-lift',lift.toFixed(2)+'px');root.dataset.viewerPlacement=placement;
    root.style.setProperty('--viewer-info-space',Math.max(40,height-dockBottom-rect.height-20).toFixed(2)+'px');
    if(placement==='parked'){pointerNear=false;setCollapsed(true);}
    // Cache one hit region per layout event, rather than reading layout on
    // every pointermove. Movement far from the controls never resets idle.
    rect=dock.getBoundingClientRect();region={left:rect.left-28,right:rect.right+28,top:rect.top-44,bottom:rect.bottom+26};
    if(reveal&&!reveal.hidden){var handle=reveal.getBoundingClientRect();handleRegion={left:handle.left-28,right:handle.right+28,top:handle.top-34,bottom:handle.bottom+24};}else handleRegion=null;
    if(lastPointer)nearPointer(lastPointer);
  }
  function queueLayout(){
    if(!active||document.hidden||layoutFrame)return;
    layoutFrame=requestAnimationFrame(function(){layoutFrame=0;arrange();});
  }
  function ensureRoom(extra){
    if((placement!=='parked'&&!extra)||placement==='bottom'||clear)return;
    var footer=document.querySelector('.site-footer');if(!footer)return;
    var rect=footer.getBoundingClientRect(),height=dock.getBoundingClientRect().height;
    // On an unusually tall footer there is no collision-free floating band.
    // An explicit click/key may bring the band before the footer into view;
    // hovering the small handle never moves the reading position.
    // Native scrolling rounds to device pixels; leave room beyond the exact
    // fractional boundary so a deliberate reveal can exit the parked state.
    var distance=Math.max(0,height+FOOTER_GAP*2+2+(extra||0)-rect.top);if(!distance)return;
    var target=Math.max(0,(window.scrollY||0)-distance);
    window.scrollTo({left:window.scrollX||0,top:target,behavior:'instant'});arrange();
  }
  function show(explicit,focus){
    if(!active)return;if(explicit){manualQuiet=false;ensureRoom();}
    if(placement==='parked')return;
    var focusHandle=reveal&&document.activeElement===reveal;
    setCollapsed(false);
    if(focus||focusHandle){keyboardHold=keyboardMode;movingFocus=true;previous.focus({preventScroll:true});movingFocus=false;}
    if(reveal)reveal.hidden=true;
    armIdle();
  }
  function stopDock(){
    cancelIdle();if(layoutFrame)cancelAnimationFrame(layoutFrame);layoutFrame=0;
    if(activeEvents)activeEvents.abort();activeEvents=null;if(sizeObserver)sizeObserver.disconnect();sizeObserver=null;
    pointerNear=false;keyboardHold=false;lastPointer=null;manualQuiet=false;region=handleRegion=null;
  }
  function startDock(){
    activeEvents=new AbortController();var options={signal:activeEvents.signal},passive={signal:activeEvents.signal,passive:true};
    window.addEventListener('scroll',queueLayout,passive);window.addEventListener('resize',queueLayout,passive);
    document.addEventListener('pointermove',function(event){if(event.pointerType==='touch')return;lastPointer={x:event.clientX,y:event.clientY};nearPointer(lastPointer);},passive);
    document.addEventListener('pointerdown',function(event){keyboardMode=false;keyboardHold=false;if(dock.contains(event.target))show(false,false);else armIdle();},passive);
    document.addEventListener('focusin',function(event){
      if(movingFocus)return;
      if(event.target===reveal&&keyboardMode){keyboardHold=true;show(true,true);return;}
      keyboardHold=keyboardMode&&dock.contains(event.target);if(keyboardHold)show(true,false);else armIdle();
    },Object.assign({capture:true},options));
    document.addEventListener('focusout',function(event){if(movingFocus)return;if(!dock.contains(event.relatedTarget)){keyboardHold=false;armIdle();}},Object.assign({capture:true},options));
    document.addEventListener('close',armIdle,Object.assign({capture:true},options));
    document.addEventListener('toggle',function(){if(modalOpen())cancelIdle();else armIdle();},Object.assign({capture:true},options));
    document.addEventListener('visibilitychange',function(){if(document.hidden){cancelIdle();if(layoutFrame)cancelAnimationFrame(layoutFrame);layoutFrame=0;}else{queueLayout();armIdle();}},options);
    if(window.visualViewport){window.visualViewport.addEventListener('resize',queueLayout,passive);window.visualViewport.addEventListener('scroll',queueLayout,passive);}
    if(typeof ResizeObserver!=='undefined'){sizeObserver=new ResizeObserver(queueLayout);[document.body,document.querySelector('.site-footer'),dock].forEach(function(node){if(node)sizeObserver.observe(node);});}
    arrange();armIdle();
  }
  function sync(){
    if(!active)return;
    var e=current(),index=entries.findIndex(function(item){return item.id===e.id;})+1;
    root.querySelector('[data-review-title]').textContent=e.title;
    root.querySelector('[data-review-count]').textContent=index+' / '+entries.length;
    root.querySelector('[data-review-description]').textContent=e.description;
    root.querySelector('[data-review-info-title]').textContent=e.title;
    root.querySelector('[data-review-info-description]').textContent=e.description;
    root.querySelector('[data-review-material]').textContent=(e.theme||(e.kind==='image'?'窗外影像':'浏览器绘图'))+(e.palette?' · 配色：'+e.palette.name:'');
    var source=e.kind==='image'?e.width+' × '+e.height+(e.enhancement?' · AI 细节增强':''):'直接在浏览器中绘制，无需下载背景图片。';
    if(e.sourceCrop)source+=' · 取自完整原画的局部';
    root.querySelector('[data-review-source]').textContent=source;
    var credit=root.querySelector('[data-review-credit]');credit.hidden=!e.credit;credit.textContent=e.credit||'';
    if(e.creditUrl)credit.href=e.creditUrl;else credit.removeAttribute('href');
    root.dataset.reviewScene=e.id;
    queueLayout();
  }
  function restoreAttribute(node,name,present,value){if(present)node.setAttribute(name,value);else node.removeAttribute(name);}
  function setClear(value,options){
    value=!!value&&active;options=options||{};
    if(value===clear)return;
    clear=value;
    if(clear){
      clearScroll={x:window.scrollX||0,y:window.scrollY||0};
      suppressed=Array.from(document.querySelectorAll('.site-header,.site-main,.site-footer,.skip-link')).map(function(node){
        var record={node:node,ariaPresent:node.hasAttribute('aria-hidden'),aria:node.getAttribute('aria-hidden'),inertPresent:node.hasAttribute('inert'),inert:node.getAttribute('inert')};
        node.setAttribute('aria-hidden','true');node.setAttribute('inert','');return record;
      });
      document.body.classList.add('scene-viewer-clear');
      clearButton.focus({preventScroll:true});
    }else{
      suppressed.forEach(function(record){var node=record.node;if(!node.isConnected)return;restoreAttribute(node,'aria-hidden',record.ariaPresent,record.aria);restoreAttribute(node,'inert',record.inertPresent,record.inert);});
      suppressed=[];document.body.classList.remove('scene-viewer-clear');
      if(clearScroll&&options.restoreScroll!==false)window.scrollTo({left:clearScroll.x,top:clearScroll.y,behavior:'instant'});
      clearScroll=null;
    }
    clearButton.setAttribute('aria-pressed',String(clear));clearButton.textContent=clear?'显示正文':'只看背景';
    queueLayout();
  }
  function open(options){
    options=options||{};
    if(active){sync();show(true,false);return read();}
    returnFocus=options.returnFocus&&options.returnFocus.isConnected?options.returnFocus:document.querySelector('[data-background-open]');
    active=true;collapsed=false;placement='bottom';lift=0;keyboardHold=keyboardMode;root.hidden=false;root.dataset.viewerActive='true';root.dataset.viewerCollapsed='false';details.open=false;dock.removeAttribute('inert');dock.removeAttribute('aria-hidden');if(reveal)reveal.hidden=true;sync();movingFocus=true;previous.focus({preventScroll:true});movingFocus=false;startDock();announce('已进入观景模式。');return read();
  }
  function close(options){
    options=options||{};
    var wasActive=active;setClear(false,options);active=false;stopDock();collapsed=false;placement='bottom';lift=0;dockBottom=14;root.hidden=true;delete root.dataset.viewerActive;delete root.dataset.viewerCollapsed;delete root.dataset.viewerPlacement;root.style.removeProperty('--viewer-footer-lift');root.style.removeProperty('--viewer-info-space');dock.removeAttribute('inert');dock.removeAttribute('aria-hidden');if(reveal){reveal.hidden=true;reveal.setAttribute('aria-expanded','false');}details.open=false;
    if(wasActive&&options.returnFocus!==false&&returnFocus&&returnFocus.isConnected)returnFocus.focus({preventScroll:true});
    returnFocus=null;announce('');return read();
  }
  function select(offset){
    if(!active||!entries.length)return;
    var choice=backgrounds.read(),index=entries.findIndex(function(e){return e.id===choice.id;}),e=entries[(index+offset+entries.length)%entries.length];
    backgrounds.set({id:e.id,quality:choice.quality,scroll:choice.scroll});announce('已选择'+e.title+'。');
  }
  previous.addEventListener('click',function(){select(-1);},{signal:signal});next.addEventListener('click',function(){select(1);},{signal:signal});
  if(reveal)reveal.addEventListener('click',function(){show(true,true);},{signal:signal});
  if(collapseButton)collapseButton.addEventListener('click',function(){manualQuiet=true;pointerNear=false;keyboardHold=false;details.open=false;setCollapsed(true);arrange();},{signal:signal});
  dock.addEventListener('pointerenter',function(event){if(event.pointerType==='touch'||manualQuiet)return;pointerNear=true;show(false,false);},{signal:signal});
  dock.addEventListener('pointerleave',function(event){if(event.pointerType==='touch')return;pointerNear=false;armIdle();},{signal:signal});
  dock.addEventListener('click',function(){if(active&&!collapsed){show(false,false);armIdle();}},{signal:signal});
  details.addEventListener('toggle',function(){if(!active)return;if(details.open){ensureRoom(Math.min(240,(window.innerHeight||720)*.4));show(true,false);cancelIdle();}else armIdle();queueLayout();},{signal:signal});
  button('[data-review-clear]',function(){setClear(!clear);});
  button('[data-review-exit]',function(){close();});
  button('[data-review-browse]',function(event){setClear(false);details.open=false;window.dispatchEvent(new CustomEvent('liss:background-picker-open',{detail:{returnFocus:event.currentTarget}}));});
  window.addEventListener('liss:background-viewer-open',function(event){open(event.detail);},{signal:signal});
  window.addEventListener('liss:background-status',function(event){var d=event.detail;if(!active||!d||d.id!==current().id)return;if(d.state==='ready')announce('已显示'+current().title+'。');else if(d.state==='unavailable')announce('图片暂时无法载入，已显示柔光背景。');},{signal:signal});
  // Remember how the picker was opened, even while the optional dock is shut.
  document.addEventListener('pointerdown',function(){keyboardMode=false;},{signal:signal,passive:true});
  document.addEventListener('keydown',function(event){
    keyboardMode=true;
    if(active){keyboardMode=true;keyboardHold=dock.contains(event.target);if(keyboardHold)show(true,false);}
    if(!active||event.defaultPrevented||event.isComposing||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.repeat)return;
    var target=event.target;
    if(target&&target.closest&&target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))return;
    if(document.querySelector('dialog[open],.image-viewer[aria-hidden="false"]'))return;
    if(event.key==='ArrowLeft'){event.preventDefault();show(true,false);select(-1);}else if(event.key==='ArrowRight'){event.preventDefault();show(true,false);select(1);}else if(event.key==='Escape'){event.preventDefault();close();}
  },{signal:signal});
  var unsubscribe=backgrounds.subscribe(sync);
  function destroy(){close({returnFocus:false,restoreScroll:false});unsubscribe();lifetime.abort();if(window[KEY]===api)delete window[KEY];}
  var api={open:open,close:close,read:read,destroy:destroy};window[KEY]=api;
  window.addEventListener('pagehide',function(event){close({returnFocus:false,restoreScroll:false});if(!event.persisted)destroy();},{signal:signal});
  window.addEventListener('pageshow',function(event){if(event.persisted)close({returnFocus:false,restoreScroll:false});},{signal:signal});
  // Earlier shared scene URLs still choose that scene once, without opening tools.
  var url=new URL(location.href),requested=url.searchParams.get('scene');
  if(requested&&entries.some(function(e){return e.id===requested;})&&backgrounds.read().id!==requested){var choice=backgrounds.read();backgrounds.set({id:requested,quality:choice.quality,scroll:choice.scroll});}
  if(url.searchParams.has('scene')||url.searchParams.has('background_review')){url.searchParams.delete('scene');url.searchParams.delete('background_review');history.replaceState(history.state,'',url);}
})();
