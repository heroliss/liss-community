/* Native-resolution scenery behind the conversation. The browser composites
   the glass directly; this controller never takes a bitmap of a card's view. */
(function () {
  'use strict';
  var key='__lissCommunityAtmosphere';
  if(window[key]&&typeof window[key].destroy==='function')window[key].destroy();
  var lifetime=new AbortController(),dispose=null,inspectState=null,backgrounds=window.LissBackgrounds;
  function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
  function mount(){
    if(dispose)dispose();
    if(!document.body||!document.body.classList.contains('community-room'))return;
    var body=document.body,html=document.documentElement,abort=new AbortController(),signal=abort.signal;
    var reduce=matchMedia('(prefers-reduced-motion: reduce)'),reducedData=matchMedia('(prefers-reduced-data: reduce)'),fine=matchMedia('(hover:hover) and (pointer:fine)'),forced=matchMedia('(forced-colors: active)');
    var wrapper=document.createElement('div');wrapper.className='community-atmosphere';wrapper.setAttribute('aria-hidden','true');wrapper.inert=true;
    wrapper.style.cssText='position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;';
    var landscapeWindow=document.createElement('div');landscapeWindow.className='community-landscape-window';
    wrapper.appendChild(landscapeWindow);body.insertBefore(wrapper,body.firstChild);
    wrapper.dataset.sceneRenderer='native-vector';
    var hadClass=body.classList.contains('has-atmosphere');body.classList.add('has-atmosphere');
    var frame=0,lastTime=0,closed=false,dirty=true,dirtySize=true;
    var width=1,height=1,padding=100,mobile=false,light=false;
    var current=[0,0,0],target=[0,0,0],pointer=[0,0],scrollPixels=Math.max(0,window.scrollY||0),scrollPixelTarget=scrollPixels;
    // The spatial controller is the single owner of card poses. Its dominant
    // pose only moves this small counter-camera and the room's supporting light.
    var scene=[0,0,50,40,0],sceneTarget=scene.slice();
    var activeWindow=true,pressed=false,editing=false,selection=false,modal=false,releaseTimer=0,resizeObserver=null;
    var sizeSignature='',nativeFrames=0,landscapeImage=null;
    var selectedChoice=backgrounds?backgrounds.read():{id:'mist',kind:'vector',quality:'auto',scroll:true};
    var appliedEntry=backgrounds?backgrounds.entry(selectedChoice.id):{id:'mist',kind:'vector',style:'mist'};
    var landscapeStatus='unrequested',landscapeSerial=0,landscapeResolution=null,pendingResolution=null,unsubscribeBackground=null;
    var landscapeGeometry=null,vectorGeometry=null,vectorScene=null,proceduralScene=null,scrollRange=1;
    function nativeVector(entry){
      vectorGeometry=null;
      if(proceduralScene){proceduralScene.destroy();proceduralScene=null;}
      if(window.LissProceduralScenes){proceduralScene=window.LissProceduralScenes.create(entry);vectorScene=proceduralScene.element;landscapeWindow.replaceChildren(vectorScene);return;}
      var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 1600 1000');svg.setAttribute('preserveAspectRatio','xMidYMid slice');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','community-vector-scene');svg.dataset.vectorStyle=entry.style||'mist';
      svg.innerHTML='<defs><radialGradient id="room-v24-glow"><stop stop-color="var(--accent)" stop-opacity=".17"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></radialGradient><linearGradient id="room-v24-line"><stop stop-color="var(--accent)" stop-opacity="0"/><stop offset=".38" stop-color="var(--accent)" stop-opacity=".24"/><stop offset=".8" stop-color="var(--accent)" stop-opacity=".12"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><ellipse cx="1320" cy="170" rx="650" ry="580" fill="url(#room-v24-glow)"/><ellipse cx="80" cy="800" rx="560" ry="600" fill="url(#room-v24-glow)"/><g class="community-vector-lines" fill="none" stroke="url(#room-v24-line)"><path d="M-120 750C240 1030 350 260 750 140S1370 430 1720-150" stroke-width="2.5"/><path d="M-100 812C180 1100 440 340 780 214S1370 500 1750-50" stroke-width="1"/></g>';
      landscapeWindow.replaceChildren(svg);vectorScene=svg;
    }
    function stop(){if(frame)cancelAnimationFrame(frame);frame=0;lastTime=0;}
    function paused(){return html.dataset.roomMotion==='paused';}
    function held(){return pressed||editing||selection||modal||!activeWindow;}
    function savingData(){return !!(reducedData.matches||(backgrounds&&backgrounds.read&&backgrounds.read().dataSaver)||(navigator.connection&&navigator.connection.saveData));}
    function blocked(){return closed||document.hidden||forced.matches||reduce.matches||savingData()||paused()||held();}
    function schedule(){if(!closed&&!document.hidden&&!frame)frame=requestAnimationFrame(paint);}
    function syncProceduralMotion(){
      var running=!!proceduralScene&&!blocked(),state=running?'running':'paused';
      if(wrapper.dataset.sceneMotion!==state)wrapper.dataset.sceneMotion=state;
      if(proceduralScene&&proceduralScene.setMotion)proceduralScene.setMotion(running);
    }
    function freeze(){stop();target=current.slice();sceneTarget=scene.slice();scrollPixelTarget=scrollPixels;syncProceduralMotion();}
    function scrollPosition(){return selectedChoice.scroll?clamp(Math.max(0,window.scrollY||0)/Math.max(1,scrollRange),0,1):current[2];}
    function ensureScene(imageMode){
      // A photograph is the room's real view, not a canvas to repaint with
      // abstract glass geometry. Foreground DOM materials own the 3D objects.
      wrapper.dataset.sceneRenderer=imageMode?'native-image':'native-vector';
    }
    function applyBackground(choice,resolution){
      selectedChoice=choice;var entry=backgrounds?backgrounds.entry(choice.id):{id:'mist',kind:'vector',style:'mist'},serial=++landscapeSerial;
      syncProceduralMotion();
      if(!choice.scroll)scrollPixelTarget=scrollPixels;
      if(entry.kind!=='image'||!backgrounds){
        if(backgrounds)backgrounds.load(choice);
        nativeVector(entry);landscapeImage=null;landscapeGeometry=null;landscapeResolution=pendingResolution=null;
        landscapeStatus='vector';appliedEntry=entry;wrapper.dataset.sceneArt='vector';ensureScene(false);
        sizeSignature='';dirtySize=dirty=true;syncProceduralMotion();schedule();return;
      }
      var resolved=resolution||backgrounds.resolve(choice);pendingResolution=resolved;landscapeStatus='loading';
      backgrounds.load(choice,resolved).then(function(image){
        if(closed||serial!==landscapeSerial)return;
        pendingResolution=null;
        if(!image){landscapeImage=null;landscapeGeometry=null;landscapeResolution=null;landscapeStatus='unavailable';appliedEntry={id:'mist',kind:'vector',style:'mist'};nativeVector(appliedEntry);wrapper.dataset.sceneArt='vector';ensureScene(false);}
        else{if(proceduralScene){proceduralScene.destroy();proceduralScene=null;}landscapeImage=image;vectorScene=null;vectorGeometry=null;landscapeResolution=resolved;landscapeStatus='ready';appliedEntry=entry;image.className='community-landscape-image';image.alt='';image.setAttribute('aria-hidden','true');landscapeWindow.replaceChildren(image);wrapper.dataset.sceneArt='image';ensureScene(true);}
        sizeSignature='';dirtySize=dirty=true;syncProceduralMotion();schedule();
      });
    }
    function upgradeResolution(){
      if(!backgrounds||appliedEntry.kind!=='image'||!landscapeResolution)return;
      var next=backgrounds.resolve(selectedChoice,landscapeResolution);
      if(next.url!==landscapeResolution.url&&(!pendingResolution||next.url!==pendingResolution.url))applyBackground(selectedChoice,next);
    }
    function readLocks(){
      var focused=document.activeElement;
      editing=!!(focused&&focused.closest&&focused.closest('input,textarea,select,[contenteditable="true"],.CodeMirror,.editor-toolbar'));
      var selected=window.getSelection();selection=!!(selected&&!selected.isCollapsed);
      modal=!!document.querySelector('dialog[open],.CodeMirror-fullscreen,.editor-preview-active-side');
    }
    function gate(){
      if(closed)return;
      readLocks();wrapper.dataset.atmosphereState=document.hidden?'hidden':forced.matches?'contrast':reduce.matches?'reduced':savingData()?'saving':paused()?'paused':held()?'held':'ready';
      syncProceduralMotion();
      if(document.hidden||forced.matches){freeze();return;}
      if(reduce.matches){current=[0,0,0];target=current.slice();scene=[0,0,50,40,0];sceneTarget=scene.slice();dirty=true;schedule();return;}
      if(savingData()||paused()||held()){freeze();if(dirty||dirtySize)schedule();return;}
      target[0]=fine.matches?pointer[0]:0;target[1]=fine.matches?pointer[1]:0;target[2]=scrollPosition();if(selectedChoice.scroll)scrollPixelTarget=Math.max(0,window.scrollY||0);schedule();
    }
    function resize(){
      dirtySize=false;
      var bounds=wrapper.getBoundingClientRect();width=Math.max(1,bounds.width);height=Math.max(1,bounds.height);mobile=width<700;
      light=html.dataset.theme==='light';scrollRange=Math.max(1,document.documentElement.scrollHeight-height);if(!blocked())target[2]=scrollPosition();
      if(proceduralScene)vectorGeometry=proceduralScene.resize(width,height,light);
      else if(vectorScene){
        // A missing optional drawing factory still leaves the quiet fallback
        // with a bounded field, rather than an undersized moving viewport.
        vectorGeometry={width:width+160,height:height*1.42+160,overscan:80,travel:height*.42,scrollRate:.045};
        vectorScene.style.width=vectorGeometry.width+'px';vectorScene.style.height=vectorGeometry.height+'px';vectorScene.style.left=vectorScene.style.top='-80px';vectorScene.style.right=vectorScene.style.bottom='auto';vectorScene.setAttribute('viewBox','0 0 1600 1420');
      }
      landscapeGeometry=null;
      if(landscapeImage){
        var CW=width+padding*2,CH=height+padding*2,IW=landscapeImage.naturalWidth,IH=landscapeImage.naturalHeight,scale=Math.max(CW/IW,CH/IH),fullW=IW*scale,fullH=IH*scale;
        var anchor=appliedEntry.anchorX===undefined?(mobile ? .88 : .57):appliedEntry.anchorX,vertical=appliedEntry.anchorY===undefined ? .46 : appliedEntry.anchorY;
        var left=-padding-(fullW-CW)*anchor,top=appliedEntry.tall?-padding:-padding-(fullH-CH)*vertical;
        landscapeGeometry={width:fullW,height:fullH,left:left,top:top,scale:scale,travel:appliedEntry.tall?Math.max(0,fullH-CH):0};
        landscapeImage.style.width=fullW+'px';landscapeImage.style.height=fullH+'px';landscapeImage.style.left=left+'px';landscapeImage.style.top=top+'px';landscapeImage.style.opacity='1';
      }
      var signature=[width,height,light,appliedEntry.id,landscapeResolution&&landscapeResolution.url].join(':');if(signature===sizeSignature)return;sizeSignature=signature;
      dirty=true;
    }
    function drawNative(){
      var coarse=fine.matches?1:.45,dx=current[0]*5*coarse-scene[1]*.24,dy=current[1]*5*.65*coarse+scene[0]*.24-scene[4]*2;
      // A long picture no longer sweeps its entire height over one document.
      // Fifty-five picture pixels per 1000 CSS scroll pixels is a slow, bounded
      // counter-camera; changing article length does not change that speed.
      var travel=landscapeGeometry?Math.min(landscapeGeometry.travel,Math.max(0,scrollPixels)*.055):0;
      if(landscapeImage&&landscapeGeometry)landscapeImage.style.transform='translate3d('+dx.toFixed(2)+'px,'+(dy-current[2]*13-travel).toFixed(2)+'px,0)';
      // A small, native-resolution drawing field uses the same absolute-scroll
      // principle. It never loops or resets at the document's lower edge, and
      // its explicit overscan leaves room for both the camera and local leaves.
      else if(vectorScene){var vectorTravel=vectorGeometry?Math.min(vectorGeometry.travel,Math.max(0,scrollPixels)*vectorGeometry.scrollRate):0;vectorScene.style.transform='translate3d('+dx.toFixed(2)+'px,'+(dy-vectorTravel).toFixed(2)+'px,0)';}
      nativeFrames++;dirty=false;
    }
    function paint(now){
      frame=0;if(closed||document.hidden)return;
      if(dirtySize)resize();
      var unsettled=false,elapsed=lastTime?Math.min(50,now-lastTime):16;lastTime=now;
      if(!blocked()){
        var blend=1-Math.exp(-elapsed/170);current.forEach(function(value,index){var difference=target[index]-value;if(Math.abs(difference)>.002){current[index]+=difference*blend;unsettled=true;}else current[index]=target[index];});
        var sceneBlend=1-Math.exp(-elapsed/225);scene.forEach(function(value,index){var difference=sceneTarget[index]-value;if(Math.abs(difference)>.015){scene[index]+=difference*sceneBlend;unsettled=true;}else scene[index]=sceneTarget[index];});
        var scrollDifference=scrollPixelTarget-scrollPixels;if(Math.abs(scrollDifference)>.08){scrollPixels+=scrollDifference*blend;unsettled=true;}else scrollPixels=scrollPixelTarget;
      }
      // Native image/vector camera motion settles after input. Decorative
      // vector motion is compositor animation, not another JS frame loop.
      drawNative();
      if(unsettled&&!blocked())schedule();else lastTime=0;
    }
    function invalidate(){dirtySize=true;dirty=true;schedule();}
    document.addEventListener('pointermove',function(event){if(event.pointerType==='touch'||!fine.matches||blocked())return;pointer=[clamp(event.clientX/Math.max(1,width)*2-1,-1,1),clamp(event.clientY/Math.max(1,height)*2-1,-1,1)];target[0]=pointer[0];target[1]=pointer[1];schedule();},{passive:true,signal:signal});
    document.addEventListener('pointerleave',function(){pointer=[0,0];if(!blocked()){target[0]=target[1]=0;schedule();}},{passive:true,signal:signal});
    document.addEventListener('pointerdown',function(event){if(event.isPrimary&&event.button===0){pressed=true;freeze();}},{capture:true,passive:true,signal:signal});
    function release(){if(releaseTimer)clearTimeout(releaseTimer);releaseTimer=setTimeout(function(){releaseTimer=0;pressed=false;gate();},0);}
    window.addEventListener('pointerup',release,{passive:true,signal:signal});window.addEventListener('pointercancel',release,{passive:true,signal:signal});
    document.addEventListener('scroll',function(){if(!blocked()){target[2]=scrollPosition();if(selectedChoice.scroll)scrollPixelTarget=Math.max(0,window.scrollY||0);schedule();}},{passive:true,signal:signal});
    document.addEventListener('focusin',gate,{signal:signal});document.addEventListener('focusout',function(){queueMicrotask(gate);},{signal:signal});
    document.addEventListener('selectionchange',gate,{signal:signal});document.addEventListener('visibilitychange',gate,{signal:signal});
    window.addEventListener('blur',function(){activeWindow=false;pressed=false;gate();},{signal:signal});window.addEventListener('focus',function(){activeWindow=true;gate();},{signal:signal});
    window.addEventListener('resize',invalidate,{passive:true,signal:signal});if(window.visualViewport)window.visualViewport.addEventListener('resize',invalidate,{passive:true,signal:signal});
    reduce.addEventListener('change',gate,{signal:signal});reducedData.addEventListener('change',gate,{signal:signal});forced.addEventListener('change',gate,{signal:signal});
    if(navigator.connection&&navigator.connection.addEventListener)navigator.connection.addEventListener('change',gate,{signal:signal});
    fine.addEventListener('change',function(){pointer=[0,0];if(!fine.matches)current[0]=current[1]=0;dirty=true;gate();},{signal:signal});
    window.addEventListener('liss:motion-state',gate,{signal:signal});window.addEventListener('liss:theme-change',function(){sizeSignature='';dirtySize=true;dirty=true;schedule();},{signal:signal});
    window.addEventListener('liss:background-resolution',function(){upgradeResolution();if(proceduralScene)invalidate();},{signal:signal});
    window.addEventListener('liss:spatial-frame',function(event){
      var detail=event.detail;if(!detail||detail.active===false){sceneTarget=scene.slice();return;}if(blocked())return;
      function value(name,fallback,min,max){var number=Number(detail[name]);return Number.isFinite(number)?clamp(number,min,max):fallback;}
      sceneTarget=[value('rx',0,-35,35),value('ry',0,-35,35),value('lightX',50,0,100),value('lightY',40,0,100),value('scroll',0,0,1)];schedule();
    },{signal:signal});
    var stateObserver=new MutationObserver(function(entries){if(entries.some(function(entry){return entry.attributeName==='data-theme';})){dirtySize=true;dirty=true;}gate();});stateObserver.observe(html,{attributes:true,attributeFilter:['data-theme','data-room-motion']});
    var dialogObserver=new MutationObserver(gate);dialogObserver.observe(body,{attributes:true,subtree:true,attributeFilter:['open']});
    if(window.ResizeObserver){resizeObserver=new ResizeObserver(invalidate);resizeObserver.observe(wrapper);resizeObserver.observe(body);}
    nativeVector({style:'mist'});wrapper.dataset.sceneArt='vector';if(backgrounds)unsubscribeBackground=backgrounds.subscribe(function(choice){applyBackground(choice);});applyBackground(selectedChoice);
    readLocks();if(!reduce.matches&&!paused())current[2]=target[2]=scrollPosition();gate();window.dispatchEvent(new Event('liss:spatial-request'));
    inspectState=function(){var procedural=proceduralScene?proceduralScene.inspect():null;if(procedural)procedural.scrollCamera={mode:'absolute-bounded',scrollOffset:vectorGeometry?Math.min(vectorGeometry.travel,Math.max(0,scrollPixels)*vectorGeometry.scrollRate):0,scrollRate:vectorGeometry?vectorGeometry.scrollRate:0,enabled:!!selectedChoice.scroll};return{renderer:wrapper.dataset.sceneRenderer,nativeFrames:nativeFrames,sceneFrames:0,composites:0,framePending:!!frame,state:wrapper.dataset.atmosphereState,width:width,height:height,scene:scene.slice(),camera:current.slice(),crystal:null,samplingEnabled:false,backgroundCompositePixels:0,compositeColorBytes:0,compositor:{enabled:false,hdr:false},procedural:procedural,landscape:{id:selectedChoice.id,appliedId:appliedEntry.id,state:landscapeStatus,ready:!!landscapeImage,width:landscapeImage?landscapeImage.naturalWidth:0,height:landscapeImage?landscapeImage.naturalHeight:0,resolution:landscapeResolution,nativeLayer:!!landscapeImage,travel:landscapeGeometry?landscapeGeometry.travel:0,scrollOffset:landscapeGeometry?Math.min(landscapeGeometry.travel,Math.max(0,scrollPixels)*.055):0,scrollRate:.055,progress:current[2],scrollRange:scrollRange,alpha:1,geometryAlpha:0,decodedImageBytes:landscapeImage?landscapeImage.naturalWidth*landscapeImage.naturalHeight*4:0}};};
    dispose=function(){
      if(closed)return;closed=true;stop();abort.abort();stateObserver.disconnect();dialogObserver.disconnect();
      landscapeSerial++;if(unsubscribeBackground)unsubscribeBackground();if(proceduralScene)proceduralScene.destroy();proceduralScene=null;landscapeWindow.replaceChildren();landscapeImage=null;landscapeGeometry=null;vectorGeometry=null;vectorScene=null;
      if(resizeObserver)resizeObserver.disconnect();if(releaseTimer)clearTimeout(releaseTimer);
      wrapper.remove();if(!hadClass)body.classList.remove('has-atmosphere');inspectState=null;
    };
  }
  window.addEventListener('pagehide',function(){if(dispose)dispose();},{signal:lifetime.signal});window.addEventListener('pageshow',function(event){if(event.persisted)mount();},{signal:lifetime.signal});
  window[key]={inspect:function(){return inspectState?inspectState():{mounted:false};},destroy:function(){if(dispose)dispose();lifetime.abort();delete window[key];}};mount();
})();
