/* One spatial controller for native Flask pages. Stable hosts own perspective;
   scroll and pointer surfaces own transforms; finite arrival only settles light. */
(function () {
  'use strict';
  var key = '__lissCommunitySpatial';
  if (window[key] && typeof window[key].destroy === 'function') window[key].destroy();
  var lifetime = new AbortController(), dispose = null, entered = new WeakSet(), serial = 0;
  var selector = '[data-depth-host],[data-room-scene]';
  var interactive = 'input,textarea,select,[contenteditable="true"],.CodeMirror,.editor-toolbar';
  var fullscreenSelector = '.editor-toolbar.fullscreen,.CodeMirror-fullscreen,.editor-preview-active-side';
  var names = ['--depth-rx','--depth-ry','--depth-x','--depth-y','--depth-z',
    '--depth-scroll-rx','--depth-scroll-y','--depth-scroll-z','--depth-light-x','--depth-light-y','--depth-scroll-progress'];
  var roomNames = ['--room-x','--room-y','--room-rx','--room-ry'];
  var profiles = {
    edition:[8,12,16,10,18,1.2], reply:[6,8,10,7,12,.8], image:[9,14,18,10,16,.8],
    reader:[0,0,0,0,0,0], workspace:[0,0,0,0,0,0],
    identity:[7,10,14,9,12,.85], ledge:[8,12,13,9,14,.6]
  };
  function clamp(value,min,max) { return Math.max(min,Math.min(max,value)); }
  function snapshot(node,properties) {
    return properties.map(function(name){return [name,node.style.getPropertyValue(name),node.style.getPropertyPriority(name)];});
  }
  function restoreStyle(node,saved) {
    saved.forEach(function(item){if(item[1])node.style.setProperty(item[0],item[1],item[2]);else node.style.removeProperty(item[0]);});
  }
  function mount(fromCache) {
    if(dispose)dispose();
    var html=document.documentElement,abort=new AbortController(),signal=abort.signal;
    var reduce=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(hover:hover) and (pointer:fine)');
    var scenes=new Set(),byHost=new WeakMap(),inserted=[],restorers=[];
    var frame=0,lastTime=0,closed=false,dirtyLayout=true,dirtyRegistry=true,dirtyLocks=true;
    var pointerOwner=null,pointer={x:0,y:0,present:false},clientPoint={x:0,y:0,known:false},hoveredControl=null,dirtyHitTest=false;
    var timers=new Set(),windowActive=true,modalOpen=false,pressed=false,selectionPresent=false,lastRelay='',lastFrame=null;
    var surfaceSerial=0,lastSurfaceSignature='',lastSurfaceFrame=null;
    var previousState=html.getAttribute('data-community-spatial');
    function attr(node,name,value){if(node.getAttribute(name)!==value)node.setAttribute(name,value);}
    function remember(node,name){
      var old=node.getAttribute(name);
      return function(){if(old===null)node.removeAttribute(name);else node.setAttribute(name,old);};
    }
    function element(tag,className){var node=document.createElement(tag);node.className=className;return node;}
    function decoration(host){
      var world=element('div','community-spatial-world');world.setAttribute('aria-hidden','true');world.inert=true;
      host.appendChild(world);inserted.push(world);
      var hadClass=host.classList.contains('has-spatial-model');host.classList.add('has-spatial-model');
      if(!hadClass)restorers.push(function(){host.classList.remove('has-spatial-model');});
      return world;
    }
    document.querySelectorAll('.room-fold').forEach(function(host){
      var world=decoration(host);
      ['rear','main','fold'].forEach(function(kind){world.appendChild(element('span','spatial-leaf spatial-leaf--'+kind));});
      world.appendChild(element('span','spatial-paper-score'));
    });
    document.querySelectorAll('.discussion-orbit').forEach(function(host){
      var original=host.querySelector('svg');if(!original)return;
      var world=decoration(host);world.appendChild(element('span','spatial-orbit-floor'));
      ['rear','middle','front'].forEach(function(kind){
        var clone=original.cloneNode(true),ids=new Map(),prefix='room-orbit-'+(++serial)+'-';
        clone.querySelectorAll('[id]').forEach(function(node){ids.set(node.id,prefix+node.id);node.id=prefix+node.id;});
        clone.querySelectorAll('*').forEach(function(node){
          Array.from(node.attributes).forEach(function(attribute){
            var value=attribute.value;
            ids.forEach(function(next,old){value=value.split('url(#'+old+')').join('url(#'+next+')');if(value==='#'+old)value='#'+next;});
            if(value!==attribute.value)node.setAttribute(attribute.name,value);
          });
        });
        clone.setAttribute('class','spatial-orbit-layer spatial-orbit-layer--'+kind);
        clone.setAttribute('aria-hidden','true');clone.setAttribute('focusable','false');world.appendChild(clone);
      });
    });
    function blocked(){return closed||reduce.matches||document.hidden||!windowActive||modalOpen||html.dataset.roomMotion==='paused';}
    function active(scene){return !blocked()&&scene.visible&&!scene.fullscreen;}
    function held(scene){return scene.held||scene.selecting||scene.hoverControl;}
    function schedule(){if(!closed&&!document.hidden&&!frame)frame=requestAnimationFrame(paint);}
    function invalidate(){dirtyLayout=true;schedule();}
    function stopArrival(scene,cancel){
      if(!scene.animation)return;
      if(cancel){scene.animation.cancel();scene.animation=null;}
      else if(scene.animation.playState==='running')scene.animation.pause();
    }
    function startArrival(scene){
      scene.entering=false;
      // Entry is a one-time light settling, not another angular pose. Replaying
      // a fixed rotateX origin on each IO re-entry caused the visible scroll pop.
      if(entered.has(scene.host))return;
      entered.add(scene.host);
      if(scene.header||scene.kind==='workspace'||scene.kind==='reader'||!scene.arrival||!scene.arrival.animate||!active(scene)||held(scene)||scene.focused)return;
      stopArrival(scene,true);
      var animation=scene.arrival.animate([
        {transform:'translate3d(0,26px,-58px)'},
        {transform:'translate3d(0,0,0)'}
      ],{duration:scene.kind==='reply'?540:680,easing:'cubic-bezier(.16,1,.3,1)',fill:'none'});
      scene.animation=animation;
      animation.finished.then(function(){if(scene.animation===animation){animation.cancel();scene.animation=null;}}).catch(function(){});
    }
    function register(host){
      if(byHost.has(host))return;
      var depth=host.hasAttribute('data-depth-host');
      // Art inside a content plane already shares that plane's pointer camera.
      if(!depth&&host.closest('[data-depth-host]'))return;
      var scroll=depth?host.querySelector(':scope > .depth-scroll'):null;
      var arrival=scroll&&scroll.querySelector(':scope > .depth-arrival');
      var surface=arrival&&arrival.querySelector(':scope > .depth-surface');
      if(depth&&!surface)return;
      var scene={surfaceId:++surfaceSerial,host:host,scroll:scroll,arrival:arrival,surface:surface,header:!depth,
        kind:host.dataset.depthKind||'edition',visible:!observer,focused:false,held:false,selecting:false,fullscreen:false,hoverControl:false,
        bounds:null,rest:[0,0],nested:!!host.parentElement.closest('[data-depth-host]'),inside:false,entering:false,
        relayExcluded:!!host.closest('[data-appearance-preview]'),
        skipEntry:!!fromCache&&entered.has(host),animation:null,savedStyles:snapshot(host,depth?names:roomNames),restores:[],written:{},
        current:[0,0,0,0,0,0,0,0,50,50,.5],x:0,y:0};
      ['data-depth-visible','data-depth-active','data-depth-held','data-depth-focus','data-depth-selecting','data-depth-fullscreen','data-depth-hover']
        .forEach(function(name){scene.restores.push(remember(host,name));});
      scenes.add(scene);byHost.set(host,scene);
      if(observer)observer.observe(host);if(resizeObserver)resizeObserver.observe(host);
      dirtyLayout=dirtyLocks=true;
    }
    function unregister(scene){
      if(hoveredControl&&scene.host.contains(hoveredControl))updateHoverControl(null);
      stopArrival(scene,true);
      if(observer)observer.unobserve(scene.host);if(resizeObserver)resizeObserver.unobserve(scene.host);
      restoreStyle(scene.host,scene.savedStyles);scene.restores.reverse().forEach(function(restore){restore();});
      if(pointerOwner===scene)pointerOwner=null;
      scenes.delete(scene);byHost.delete(scene.host);
    }
    function reconcile(){
      dirtyRegistry=false;
      scenes.forEach(function(scene){if(!scene.host.isConnected)unregister(scene);});
      document.querySelectorAll(selector).forEach(register);
      scenes.forEach(function(scene){scene.nested=!!scene.host.parentElement.closest('[data-depth-host]');});
    }
    function measure(){
      dirtyLayout=false;
      // All reads precede all writes. Nested images use layout offsets rather
      // than a projected rectangle inherited from a currently tilted article.
      scenes.forEach(function(scene){
        if(!scene.host.isConnected)return;
        var host=scene.host,parentHost=host.parentElement.closest('[data-depth-host]'),parentScene=parentHost&&byHost.get(parentHost);
        var x=0,y=0,node=host,b=null;
        if(scene.nested&&parentScene&&parentScene.bounds){
          while(node&&node!==parentHost){x+=node.offsetLeft;y+=node.offsetTop;node=node.offsetParent;}
          if(node===parentHost){
            for(var ancestor=host.parentElement;ancestor&&ancestor!==parentHost;ancestor=ancestor.parentElement){x-=ancestor.scrollLeft;y-=ancestor.scrollTop;}
            b={left:parentScene.bounds.left+x+parentHost.clientLeft-parentHost.scrollLeft,
              top:parentScene.bounds.top+y+parentHost.clientTop-parentHost.scrollTop,width:host.offsetWidth,height:host.offsetHeight};
          }
        }
        if(!b){var r=host.getBoundingClientRect();b={left:r.left+scrollX,top:r.top+scrollY,width:r.width,height:r.height};}
        scene.bounds=b;
        var computed=getComputedStyle(host);
        scene.rest=[parseFloat(computed.getPropertyValue('--depth-rest-rx'))||0,parseFloat(computed.getPropertyValue('--depth-rest-ry'))||0];
        if(!observer)scene.visible=b.top+b.height>scrollY&&b.top<scrollY+innerHeight;
      });
    }
    function selectionState(){
      var selection=window.getSelection(),range=selection&&!selection.isCollapsed&&selection.rangeCount?selection.getRangeAt(0):null;
      selectionPresent=!!range;
      if(selectionPresent){
        pointer.present=false;
        if(pointerOwner){pointerOwner.inside=false;pointerOwner.x=pointerOwner.y=0;pointerOwner=null;}
      }
      scenes.forEach(function(scene){scene.selecting=false;if(range)try{scene.selecting=range.intersectsNode(scene.host);}catch(error){}});
    }
    function locks(){
      dirtyLocks=false;modalOpen=!!document.querySelector('dialog[open]');
      var focused=document.activeElement;
      scenes.forEach(function(scene){
        scene.focused=!!focused&&focused!==document.body&&scene.host.contains(focused);
        scene.fullscreen=!!scene.host.querySelector(fullscreenSelector)||!!scene.host.closest(fullscreenSelector);
      });
      selectionState();
    }
    function write(scene,index,value,unit){
      var name=names[index],next=value.toFixed(index===10?4:2)+(unit||'');
      if(scene.written[name]!==next){scene.host.style.setProperty(name,next);scene.written[name]=next;}
    }
    function relayFrame(){
      // Geometry was measured in the read batch. Do not query layout again after
      // writing poses; the atmosphere consumes these damped numbers on its RAF.
      var dominant=null,best=-Infinity;
      if(!blocked())scenes.forEach(function(scene){
        if(!scene.visible||scene.fullscreen||scene.relayExcluded||!scene.bounds)return;
        var b=scene.bounds,overlap=Math.min(b.top+b.height,scrollY+innerHeight)-Math.max(b.top,scrollY);
        if(overlap<=0)return;
        var weight=scene.kind==='edition'||scene.kind==='image'?1.2:scene.kind==='reply'?1.1:scene.header ? .12 : scene.kind==='ledge' ? .3 : .7;
        var score=overlap/Math.max(1,Math.min(b.height,innerHeight))*weight-
          Math.abs(b.top+b.height*.5-scrollY-innerHeight*.5)/Math.max(1,innerHeight)*.15;
        if(scene===pointerOwner)score+=3;
        if(score>best){best=score;dominant=scene;}
      });
      var detail={active:!!dominant,id:null,kind:null,rx:0,ry:0,x:0,y:0,scroll:.5,lightX:50,lightY:50};
      if(dominant){
        var c=dominant.current;
        detail.id=dominant.host.dataset.depthId||dominant.host.id||null;detail.kind=dominant.header?'header':dominant.kind;
        detail.rx=dominant.rest[0]+c[0]+c[5];detail.ry=dominant.rest[1]+c[1];
        detail.x=c[2];detail.y=c[3]+c[6];detail.scroll=c[10];detail.lightX=c[8];detail.lightY=c[9];
        ['rx','ry','x','y','scroll','lightX','lightY'].forEach(function(name){detail[name]=Number(detail[name].toFixed(2));});
      }
      var signature=JSON.stringify(detail);
      lastFrame=detail;
      if(signature!==lastRelay){lastRelay=signature;window.dispatchEvent(new CustomEvent('liss:spatial-frame',{detail:Object.assign({},detail)}));}
    }
    function relaySurfaces(){
      var poses=[],signature=[!blocked()];
      scenes.forEach(function(scene){
        if(!scene.visible||scene.header||scene.fullscreen||!['edition','reply','reader'].includes(scene.kind))return;
        var c=scene.current,pose={host:scene.host,rx:Number((scene.rest[0]+c[0]+c[5]).toFixed(2)),ry:Number((scene.rest[1]+c[1]).toFixed(2)),lightX:Number(c[8].toFixed(2)),lightY:Number(c[9].toFixed(2)),held:blocked()||held(scene)||scene.focused};
        poses.push(pose);signature.push([scene.surfaceId,pose.rx,pose.ry,pose.lightX,pose.lightY,pose.held]);
      });
      lastSurfaceFrame={active:!blocked(),poses:poses};
      var next=JSON.stringify(signature);
      if(next!==lastSurfaceSignature){lastSurfaceSignature=next;window.dispatchEvent(new CustomEvent('liss:surface-frame',{detail:lastSurfaceFrame}));}
    }
    function paint(time){
      frame=0;if(closed)return;
      if(dirtyRegistry)reconcile();if(dirtyLayout)measure();if(dirtyLocks)locks();
      if(dirtyHitTest){
        dirtyHitTest=false;
        if(clientPoint.known&&fine.matches&&!blocked()&&!pressed){
          var hit=document.elementFromPoint(clientPoint.x,clientPoint.y);
          updateHoverControl(hit);
          if(pointerOwner&&(!hit||!pointerOwner.host.contains(hit))){pointerOwner.inside=false;pointerOwner.x=pointerOwner.y=0;pointerOwner=null;pointer.present=false;}
          if(pointer.present){pointer.x=clientPoint.x+scrollX;pointer.y=clientPoint.y+scrollY;}
        }
      }
      var dt=lastTime?Math.min(48,time-lastTime):16;lastTime=time;
      var blend=1-Math.exp(-dt/115),continueFrame=false;
      attr(html,'data-community-spatial',blocked()?'static':'ready');
      scenes.forEach(function(scene){
        if(!observer&&scene.bounds)scene.visible=scene.bounds.top+scene.bounds.height>scrollY&&scene.bounds.top<scrollY+innerHeight;
        var enabled=active(scene),frozen=held(scene),focused=scene.focused;
        attr(scene.host,'data-depth-visible',String(scene.visible));attr(scene.host,'data-depth-held',String(scene.held));
        attr(scene.host,'data-depth-focus',String(focused));attr(scene.host,'data-depth-selecting',String(scene.selecting));
        attr(scene.host,'data-depth-hover',String(scene.hoverControl));
        attr(scene.host,'data-depth-fullscreen',String(scene.fullscreen));attr(scene.host,'data-depth-active',String(enabled&&!frozen&&!focused));
        if(!scene.visible||reduce.matches||scene.fullscreen)stopArrival(scene,true);
        else if(!enabled||frozen)stopArrival(scene,false);
        else if(focused)stopArrival(scene,true);
        else if(scene.animation&&scene.animation.playState==='paused')scene.animation.play();
        if(scene.entering)startArrival(scene);
        if(!enabled&&!reduce.matches&&!scene.fullscreen)return;
        if(frozen&&!reduce.matches&&!scene.fullscreen)return;
        var b=scene.bounds,profile=profiles[scene.kind]||profiles.edition;
        var attenuation=scene.kind==='reader'?Math.min(.28,480/Math.max(480,b.height)):Math.min(1,650/Math.max(650,b.height));
        var pointerEnabled=enabled&&fine.matches&&!focused&&scene.inside;
        if(pointerEnabled&&pointerOwner===scene&&pointer.present){
          scene.x=clamp((pointer.x-b.left)/Math.max(1,b.width)*2-1,-1,1);
          scene.y=clamp((pointer.y-b.top)/Math.max(1,b.height)*2-1,-1,1);
        }
        var x=pointerEnabled?scene.x:0,y=pointerEnabled?scene.y:0;
        var progress=clamp(((scrollY+innerHeight*.5)-(b.top+b.height*.5))/(innerHeight*.5+b.height*.5),-1,1);
        var scrollGain=enabled&&!focused&&!scene.header?profile[5]*attenuation*(fine.matches?1:.42)*(scene.nested?.35:1):0;
        var values=[-y*profile[0]*attenuation,x*profile[1]*attenuation,x*profile[2]*attenuation,y*profile[3]*attenuation,
          pointerEnabled?profile[4]*attenuation:0,progress*2.2*scrollGain,-progress*14*scrollGain,(1-progress*progress)*20*scrollGain,
          50+x*22,50+y*18,(progress+1)*.5];
        if(scene.header)values=[-y*8,x*12,x*16,y*10,0,0,0,0,50,50,.5];
        if(reduce.matches||scene.fullscreen)values=[0,0,0,0,0,0,0,0,50,50,.5];
        var unsettled=false;
        values.forEach(function(value,index){
          var difference=value-scene.current[index];
          if(Math.abs(difference)>.008){scene.current[index]+=difference*blend;unsettled=true;}else scene.current[index]=value;
        });
        if(reduce.matches||scene.fullscreen){scene.current=values;unsettled=false;}
        if(scene.header){
          [scene.current[2],scene.current[3],scene.current[0],scene.current[1]].forEach(function(value,index){
            var next=value.toFixed(2)+(index<2?'px':'deg');
            if(scene.written[roomNames[index]]!==next){scene.host.style.setProperty(roomNames[index],next);scene.written[roomNames[index]]=next;}
          });
        }else{
          scene.current.forEach(function(value,index){write(scene,index,value,index===0||index===1||index===5?'deg':index===8||index===9?'%':index===10?'':'px');});
        }
        if(unsettled&&enabled)continueFrame=true;
      });
      relayFrame();
      relaySurfaces();
      if(continueFrame)schedule();else lastTime=0;
    }
    function sceneFor(node){
      var host=node&&node.nodeType===1?node.closest(selector):null;
      while(host){var scene=byHost.get(host);if(scene)return scene;host=host.parentElement&&host.parentElement.closest(selector);}return null;
    }
    function ancestors(node,callback){
      var host=node&&node.nodeType===1?node.closest(selector):null;
      while(host){var scene=byHost.get(host);if(scene)callback(scene);host=host.parentElement&&host.parentElement.closest(selector);}
    }
    function updateHoverControl(node){
      var control=node&&node.nodeType===1?node.closest('a,button,summary,label'):null;
      // A picture remains an exploratory surface. Only short text controls
      // hold their current pose; images freeze on actual pointerdown instead.
      if(control&&(control.matches('.community-image-trigger,.post-cover')||control.closest('.depth-image-host')||control.querySelector('img')))control=null;
      if(control===hoveredControl)return;
      hoveredControl=control;scenes.forEach(function(scene){scene.hoverControl=false;});
      if(control&&control.isConnected)ancestors(control,function(scene){scene.hoverControl=true;stopArrival(scene,false);});
    }
    function leavePointer(){
      pointer.present=false;clientPoint.known=false;updateHoverControl(null);
      if(pointerOwner){pointerOwner.inside=false;pointerOwner.x=pointerOwner.y=0;pointerOwner=null;}
      schedule();
    }
    function release(){
      pressed=false;selectionState();scenes.forEach(function(scene){scene.held=false;});dirtyLocks=true;schedule();
    }
    function releaseAfterClick(){
      if(!pressed&&!Array.from(scenes).some(function(scene){return scene.held;}))return;
      var timer=setTimeout(function(){timers.delete(timer);if(!closed)release();},0);timers.add(timer);
    }
    function gate(){
      if(closed)return;
      if(blocked()){
        leavePointer();scenes.forEach(function(scene){stopArrival(scene,reduce.matches);});
      }
      if(document.hidden){
        if(frame)cancelAnimationFrame(frame);frame=0;lastTime=0;attr(html,'data-community-spatial','static');
        scenes.forEach(function(scene){scene.held=false;scene.inside=false;scene.x=scene.y=0;attr(scene.host,'data-depth-active','false');stopArrival(scene,false);});
        pointerOwner=null;pointer.present=false;pressed=false;
      }else{dirtyLocks=true;dirtyLayout=true;schedule();}
    }
    var observer=window.IntersectionObserver?new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        var scene=byHost.get(entry.target);if(!scene)return;
        var previous=scene.visible;scene.visible=entry.isIntersecting;
        if(scene.visible&&!previous){if(scene.skipEntry)scene.skipEntry=false;else scene.entering=true;dirtyLayout=true;}
        if(!scene.visible){scene.inside=false;scene.x=scene.y=0;if(hoveredControl&&scene.host.contains(hoveredControl))updateHoverControl(null);stopArrival(scene,true);}
      });schedule();
    },{threshold:0,rootMargin:'160px 0px 160px 0px'}):null;
    var resizeObserver=window.ResizeObserver?new ResizeObserver(invalidate):null;
    document.addEventListener('pointermove',function(event){
      if(event.pointerType==='touch')return;
      clientPoint={x:event.clientX,y:event.clientY,known:true};
      if(fine.matches&&!blocked())updateHoverControl(event.target);
      if(!fine.matches||blocked()||pressed||selectionPresent)return;
      var scene=sceneFor(event.target);
      if(!scene&&!pointerOwner)return;
      if(pointerOwner!==scene){if(pointerOwner){pointerOwner.inside=false;pointerOwner.x=pointerOwner.y=0;}pointerOwner=scene;}
      pointer={x:event.pageX,y:event.pageY,present:!!scene};
      if(scene){scene.inside=true;if(event.target.closest(interactive)){scene.x=scene.y=0;scene.inside=false;}}
      schedule();
    },{passive:true,signal:signal});
    document.addEventListener('pointerover',function(event){
      if(event.pointerType==='touch'||!fine.matches||blocked())return;
      clientPoint={x:event.clientX,y:event.clientY,known:true};updateHoverControl(event.target);schedule();
    },{passive:true,signal:signal});
    document.addEventListener('pointerout',function(event){
      if(event.pointerType==='touch'||!fine.matches||blocked())return;
      updateHoverControl(event.relatedTarget);schedule();
    },{passive:true,signal:signal});
    document.addEventListener('pointerleave',leavePointer,{passive:true,signal:signal});
    document.addEventListener('pointerdown',function(event){
      if(!event.isPrimary||event.button!==0)return;
      ancestors(event.target,function(scene){pressed=true;scene.held=true;stopArrival(scene,false);});schedule();
    },{capture:true,passive:true,signal:signal});
    window.addEventListener('pointerup',releaseAfterClick,{passive:true,signal:signal});
    window.addEventListener('pointercancel',releaseAfterClick,{passive:true,signal:signal});
    window.addEventListener('blur',function(){windowActive=false;leavePointer();release();gate();},{signal:signal});
    window.addEventListener('focus',function(){windowActive=true;gate();},{signal:signal});
    document.addEventListener('focusin',function(){dirtyLocks=true;schedule();},{signal:signal});
    document.addEventListener('focusout',function(){dirtyLocks=true;schedule();},{signal:signal});
    document.addEventListener('selectionchange',function(){selectionState();schedule();},{signal:signal});
    document.addEventListener('compositionstart',function(event){ancestors(event.target,function(scene){scene.focused=true;stopArrival(scene,false);});schedule();},{signal:signal});
    document.addEventListener('compositionend',function(){dirtyLocks=true;schedule();},{signal:signal});
    document.addEventListener('scroll',function(event){if(event.target!==document)dirtyLayout=true;if(clientPoint.known)dirtyHitTest=true;schedule();},{capture:true,passive:true,signal:signal});
    window.addEventListener('resize',invalidate,{passive:true,signal:signal});
    if(window.visualViewport)window.visualViewport.addEventListener('resize',invalidate,{passive:true,signal:signal});
    document.addEventListener('load',invalidate,{capture:true,signal:signal});
    document.addEventListener('error',invalidate,{capture:true,signal:signal});
    document.addEventListener('toggle',function(){dirtyLocks=true;invalidate();},{capture:true,signal:signal});
    document.addEventListener('visibilitychange',gate,{signal:signal});
    reduce.addEventListener('change',gate,{signal:signal});
    fine.addEventListener('change',function(){leavePointer();gate();},{signal:signal});
    window.addEventListener('liss:motion-state',gate,{signal:signal});
    window.addEventListener('liss:spatial-request',function(){
      if(lastFrame)window.dispatchEvent(new CustomEvent('liss:spatial-frame',{detail:Object.assign({},lastFrame)}));else schedule();
    },{signal:signal});
    window.addEventListener('liss:surface-request',function(){
      if(lastSurfaceFrame)window.dispatchEvent(new CustomEvent('liss:surface-frame',{detail:lastSurfaceFrame}));else schedule();
    },{signal:signal});
    document.addEventListener('liss:depth-content',function(){dirtyRegistry=true;dirtyLocks=true;invalidate();},{signal:signal});
    document.addEventListener('liss:write',function(){dirtyLocks=true;invalidate();},{signal:signal});
    var stateObserver=new MutationObserver(gate);
    stateObserver.observe(html,{attributes:true,attributeFilter:['data-room-motion']});
    var contentObserver=new MutationObserver(function(records){
      records.forEach(function(record){
        if(record.type==='attributes'){dirtyLocks=true;dirtyLayout=true;return;}
        if(record.target.closest&&record.target.closest('.CodeMirror'))return;
        dirtyLayout=true;
        Array.from(record.addedNodes).forEach(function(node){if(node.nodeType===1&&(node.matches(selector)||node.querySelector(selector)))dirtyRegistry=true;});
        if(record.removedNodes.length)scenes.forEach(function(scene){if(!scene.host.isConnected)dirtyRegistry=true;});
      });schedule();
    });
    contentObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','open','hidden']});
    if(document.fonts)document.fonts.ready.then(function(){if(!closed)invalidate();});
    reconcile();schedule();
    dispose=function(){
      if(closed)return;closed=true;abort.abort();if(frame)cancelAnimationFrame(frame);frame=0;
      timers.forEach(clearTimeout);timers.clear();
      if(observer)observer.disconnect();if(resizeObserver)resizeObserver.disconnect();
      contentObserver.disconnect();stateObserver.disconnect();
      Array.from(scenes).forEach(unregister);
      restorers.reverse().forEach(function(restore){restore();});inserted.reverse().forEach(function(node){node.remove();});
      if(previousState===null)html.removeAttribute('data-community-spatial');else html.setAttribute('data-community-spatial',previousState);
    };
  }
  window.addEventListener('pagehide',function(){if(dispose)dispose();},{signal:lifetime.signal});
  window.addEventListener('pageshow',function(event){if(event.persisted)mount(true);},{signal:lifetime.signal});
  window[key]={destroy:function(){if(dispose)dispose();lifetime.abort();delete window[key];}};
  mount(false);
})();
