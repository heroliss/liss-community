/* Art-directed environment reflections and bounded water impulses. The native
   backdrop supplies transmission; no DOM capture or perpetual render loop. */
(function () {
  'use strict';
  var KEY = '__lissCommunityReflections';
  if (window[KEY] && window[KEY].destroy) window[KEY].destroy();
  var lifetime = new AbortController(), states = new Map(), frame = 0, scanFrame = 0, environmentFrame = 0;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)'), coarse = matchMedia('(pointer: coarse)'), forced = matchMedia('(forced-colors: active)');
  var observer = null, mutations = null, suspended = false, failedEnvironment = '';
  var environment = {image:'none',a:'',b:'',c:''};
  var metrics = {version:'optical-surfaces-v45',mounted:0,frames:0,ripples:0,environment:'sky',activeRipples:0};
  function clamp(value,min,max) { return Math.max(min,Math.min(max,value)); }
  function moving() { return !suspended && !document.hidden && !reduce.matches && !coarse.matches && !forced.matches; }
  function schedule() { if (!frame && moving()) frame = requestAnimationFrame(update); }
  function paint(state) {
    state.shell.style.setProperty('--optical-x',state.x.toFixed(2)+'px');
    state.shell.style.setProperty('--optical-y',state.y.toFixed(2)+'px');
  }
  function update() {
    frame = 0;
    if (!moving()) return;
    var unsettled = false;
    states.forEach(function (state) {
      if (!state.visible || !state.host.isConnected) return;
      var dx=state.tx-state.x,dy=state.ty-state.y;
      state.x = Math.abs(dx)<.04 ? state.tx : state.x+dx*.18;
      state.y = Math.abs(dy)<.04 ? state.ty : state.y+dy*.18;
      paint(state);
      if (Math.abs(dx)>=.04 || Math.abs(dy)>=.04) unsettled=true;
    });
    metrics.frames++;
    if (unsettled) schedule();
  }
  function eraseRing(state,item) {
    if (!state.rings.has(item)) return;
    clearTimeout(item.timer);item.node.remove();state.rings.delete(item);metrics.activeRipples--;
  }
  function clearRings(state) { Array.from(state.rings).forEach(function (item) { eraseRing(state,item); }); }
  function reset(state) {
    state.tx=state.ty=state.x=state.y=0;state.lastRipple=0;state.lastPoint=null;paint(state);clearRings(state);
  }
  function impulse(state,x,y,pressed,width,height) {
    if (!moving() || !state.visible || state.material!=='water') return;
    var now=performance.now(),last=state.lastPoint;
    if (!pressed && (now-state.lastRipple<300 || last && Math.hypot((x-last.x)*width,(y-last.y)*height)<46)) return;
    while (state.rings.size>=2) eraseRing(state,state.rings.values().next().value);
    var node=document.createElement('span');node.className='material-ripple';
    node.style.left=(x*100).toFixed(2)+'%';node.style.top=(y*100).toFixed(2)+'%';
    node.style.setProperty('--ripple-size',(pressed?198:152)+'px');
    node.style.setProperty('--ripple-force',pressed?'.84':'.5');
    var item={node:node,timer:0};state.rings.add(item);metrics.ripples++;metrics.activeRipples++;
    item.timer=setTimeout(function () { eraseRing(state,item); },1450);
    node.addEventListener('animationend',function () { eraseRing(state,item); },{once:true,signal:state.abort.signal});
    state.ripple.appendChild(node);state.lastRipple=now;state.lastPoint={x:x,y:y};
  }
  function point(state,event,pressed) {
    if (!moving() || !state.visible || event.pointerType==='touch') return;
    var bounds=state.host.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    var x=clamp((event.clientX-bounds.left)/bounds.width,0,1),y=clamp((event.clientY-bounds.top)/bounds.height,0,1);
    state.tx=(x-.5)*(state.material==='mirror'?36:24);state.ty=(y-.5)*(state.material==='mirror'?22:13);
    schedule();impulse(state,x,y,pressed,bounds.width,bounds.height);
  }
  function applyEnvironment(state) {
    state.shell.style.setProperty('--optical-scene-image',environment.image);
    ['a','b','c'].forEach(function (key) {
      if (environment[key]) state.shell.style.setProperty('--optical-scene-'+key,environment[key]);
      else state.shell.style.removeProperty('--optical-scene-'+key);
    });
    state.host.dataset.opticalImage=environment.image==='none'?'false':'true';
  }
  function updateEnvironment() {
    environmentFrame=0;
    environment={image:'none',a:'',b:'',c:''};
    var api=window.LissBackgrounds,choice=api&&api.read(),scene=document.querySelector('.community-procedural-scene');
    if (choice && choice.kind==='image' && choice.id!==failedEnvironment && !choice.dataSaver) {
      var source=api.source(choice);
      // The background catalogue owns selection. Only same-origin artwork is
      // replayed; references reuse the browser's current image/cache resource.
      if (source) {
        try { var url=new URL(source,document.baseURI);if (url.origin===location.origin) environment.image='url('+JSON.stringify(url.href)+')'; } catch (error) { /* Sky remains the no-image fallback. */ }
      }
    } else if (scene && choice && choice.kind==='vector') {
      var style=getComputedStyle(scene);
      ['a','b','c'].forEach(function (key) { environment[key]=style.getPropertyValue('--scene-'+key).trim(); });
    }
    metrics.environment=environment.image==='none'?'sky':'scene-image';states.forEach(applyEnvironment);
  }
  function scheduleEnvironment() { if (!environmentFrame) environmentFrame=requestAnimationFrame(updateEnvironment); }
  function unmount(state) {
    state.abort.abort();clearRings(state);if (observer) observer.unobserve(state.host);
    state.leaves.forEach(function (node) {node.remove();});
    ['x','y','scene-image','scene-a','scene-b','scene-c'].forEach(function (key) {state.shell.style.removeProperty('--optical-'+key);});
    delete state.host.dataset.optics;delete state.host.dataset.opticalImage;states.delete(state.host);
  }
  function scan() {
    scanFrame=0;
    if (!document.body || suspended) return;
    states.forEach(function (state) { if (!state.host.isConnected || state.host.dataset.material!==state.material) unmount(state); });
    document.querySelectorAll('[data-material=mirror],[data-material=water]').forEach(function (host) {
      if (states.has(host)) return;
      var shell=host.querySelector(':scope > .depth-scroll > .depth-arrival > .depth-surface > .material-shell');
      if (!shell) return;
      var leaves=['material-reflection','material-wear','material-ripple-layer'].map(function (name) {var node=document.createElement('span');node.className=name;node.setAttribute('aria-hidden','true');shell.appendChild(node);return node;});
      var state={host:host,shell:shell,leaves:leaves,ripple:leaves[2],material:host.dataset.material,abort:new AbortController(),visible:!observer,rings:new Set(),x:0,y:0,tx:0,ty:0,lastRipple:0,lastPoint:null};
      states.set(host,state);host.dataset.optics=state.material;applyEnvironment(state);
      host.addEventListener('pointermove',function (event) {point(state,event,false);},{passive:true,signal:state.abort.signal});
      host.addEventListener('pointerdown',function (event) {point(state,event,true);},{passive:true,signal:state.abort.signal});
      host.addEventListener('pointerleave',function () {state.tx=state.ty=0;state.lastPoint=null;schedule();},{signal:state.abort.signal});
      host.addEventListener('pointercancel',function () {reset(state);},{signal:state.abort.signal});
      if (observer) observer.observe(host);
    });metrics.mounted=states.size;
  }
  function scheduleScan() { if (!scanFrame && !suspended) scanFrame=requestAnimationFrame(scan); }
  function stop() { if(frame)cancelAnimationFrame(frame);frame=0;states.forEach(reset); }
  function preferences() {stop();scheduleEnvironment();}
  if (typeof IntersectionObserver==='function') observer=new IntersectionObserver(function (entries) {entries.forEach(function (entry) {var state=states.get(entry.target);if(!state)return;state.visible=entry.isIntersecting;if(!state.visible)reset(state);});},{rootMargin:'80px'});
  if (typeof MutationObserver==='function' && document.body) {
    mutations=new MutationObserver(function (records) {
      if (records.some(function (record) {return record.type==='attributes' && record.attributeName==='data-theme';})) scheduleEnvironment();
      if (records.some(function (record) {return record.type==='attributes' || Array.from(record.addedNodes).concat(Array.from(record.removedNodes)).some(function (node) {return node.nodeType===1 && !/^(material-reflection|material-wear|material-ripple-layer|material-ripple)$/.test(node.className||'');});})) scheduleScan();
    });
    mutations.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-material']});
    mutations.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  }
  [reduce,coarse,forced].forEach(function (query) {query.addEventListener('change',preferences,{signal:lifetime.signal});});
  document.addEventListener('visibilitychange',function () {if(document.hidden)stop();else scheduleEnvironment();},{signal:lifetime.signal});
  window.addEventListener('liss:background-change',function () {failedEnvironment='';scheduleEnvironment();},{signal:lifetime.signal});
  window.addEventListener('liss:background-status',function (event) {
    if(event.detail && event.detail.state==='unavailable')failedEnvironment=event.detail.id;
    if(event.detail && event.detail.state==='ready' && failedEnvironment===event.detail.id)failedEnvironment='';
    scheduleEnvironment();
  },{signal:lifetime.signal});
  window.addEventListener('liss:background-resolution',scheduleEnvironment,{signal:lifetime.signal});
  window.addEventListener('liss:theme-change',scheduleEnvironment,{signal:lifetime.signal});
  window.addEventListener('pagehide',function () {suspended=true;stop();},{signal:lifetime.signal});
  window.addEventListener('pageshow',function () {suspended=false;scan();scheduleEnvironment();},{signal:lifetime.signal});
  window[KEY]={inspect:function () {return Object.assign({},metrics,{mounted:states.size,reducedMotion:reduce.matches,coarsePointer:coarse.matches,suspended:suspended});},destroy:function () {
    lifetime.abort();if(observer)observer.disconnect();if(mutations)mutations.disconnect();
    [frame,scanFrame,environmentFrame].forEach(function (id) {if(id)cancelAnimationFrame(id);});
    states.forEach(unmount);delete window[KEY];
  }};
  updateEnvironment();scan();
}());
