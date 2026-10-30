/* A small local preference catalogue. Browsing choices never requests artwork. */
(function () {
  'use strict';
  var KEY='LissBackgrounds',STORE='liss-background-v24';
  if(window[KEY]&&window[KEY].destroy)window[KEY].destroy();
  var base=new URL('.',document.currentScript&&document.currentScript.src||new URL('/static/community-backgrounds.js',location.href).href);
  var catalogue={
    mist:{id:'mist',title:'柔光留白',description:'安静的光色与空间',kind:'vector',style:'mist',bytes:0},
    line:{id:'line',title:'流线素描',description:'少量曲线，轻盈的层次',kind:'vector',style:'line',bytes:0},
    coast:{id:'coast',title:'欧泊海岸',description:'熟悉的晶透海岸',kind:'image',src:'scenes/crystal-archipelago-v23.webp',compact:'scenes/crystal-archipelago-v24-compact.webp',bytes:153710,compactBytes:51266,width:1672,height:941,tall:false},
    'mineral-scroll':{id:'mineral-scroll',title:'晶石长卷',description:'沿着暖光与水面向深处走',kind:'image',src:'scenes/mineral-scroll-v24.webp',bytes:287786,width:793,height:1983,tall:true},
    'ink-scroll':{id:'ink-scroll',title:'雾谷月色',description:'山水、月光与一层薄雾',kind:'image',src:'scenes/ink-scroll-v24.webp',bytes:214700,width:793,height:1983,tall:true},
    earthrise:{id:'earthrise',title:'地月之间',description:'阿波罗 8 号的窗外',kind:'image',src:'scenes/earthrise-v24-3840.webp',width:4136,height:4136,tall:false,anchorX:.5,anchorY:.88,credit:'NASA / Apollo 8 · AS08-14-2384',creditUrl:'https://www.nasa.gov/image-detail/as08-14-2384orig/',variants:[
      {file:'scenes/earthrise-v24-960.webp',width:960,height:960,bytes:11722},
      {file:'scenes/earthrise-v24-1440.webp',width:1440,height:1440,bytes:22746},
      {file:'scenes/earthrise-v24-1920.webp',width:1920,height:1920,bytes:36126},
      {file:'scenes/earthrise-v24-2560.webp',width:2560,height:2560,bytes:58432},
      {file:'scenes/earthrise-v24-3840.webp',width:3840,height:3840,bytes:121158}
    ]}
  };
  Object.setPrototypeOf(catalogue,null);Object.keys(catalogue).forEach(function(id){var e=catalogue[id];if(e.variants){e.variants.forEach(Object.freeze);Object.freeze(e.variants);}Object.freeze(e);});Object.freeze(catalogue);
  var listeners=new Set(),lifetime=new AbortController(),disposeUI=null,activeLoad=null,loadSerial=0;
  var reducedData=matchMedia('(prefers-reduced-data: reduce)'),reduce=matchMedia('(prefers-reduced-motion: reduce)');
  function saved(){try{var d=JSON.parse(localStorage.getItem(STORE)||'null');return d&&typeof d==='object'&&catalogue[d.id]?d:null;}catch(e){return null;}}
  function dataSaver(){return !!(reducedData.matches||(navigator.connection&&navigator.connection.saveData));}
  function normalize(d){d=d||{};return{id:catalogue[d.id]?d.id:(dataSaver()?'mist':'coast'),quality:d.quality==='high'?'high':'auto',scroll:d.scroll!==false};}
  var stored=saved(),explicit=!!stored,current=normalize(stored);
  function entry(id){var e=catalogue[id]||catalogue.mist;return Object.assign({},e);}
  function read(){return Object.assign({},current,{kind:catalogue[current.id].kind,explicit:explicit,dataSaver:dataSaver(),reducedMotion:reduce.matches});}
  function notify(){var value=read();listeners.forEach(function(fn){fn(value);});window.dispatchEvent(new CustomEvent('liss:background-change',{detail:value}));}
  function set(d){current=normalize(d);explicit=true;try{localStorage.setItem(STORE,JSON.stringify(current));}catch(e){}notify();return read();}
  function resolution(choice,previous){
    choice=normalize(choice);var e=entry(choice.id);if(e.kind!=='image')return{id:e.id,url:'',width:0,height:0,bytes:0};
    var variants=e.variants?e.variants.slice():[];if(!variants.length){if(e.compact)variants.push({file:e.compact,width:960,height:540,bytes:e.compactBytes});variants.push({file:e.src,width:e.width,height:e.height,bytes:e.bytes});}
    var vw=Math.max(1,window.innerWidth||1280)+200,vh=Math.max(1,window.innerHeight||800)+200,dpr=Math.max(1,window.devicePixelRatio||1);
    var scale=Math.max(vw/e.width,vh/e.height),requiredW=e.width*scale*dpr,requiredH=e.height*scale*dpr;
    var selected=variants[variants.length-1];
    if(choice.quality!=='high'){
      if(dataSaver())selected=variants[0];
      else for(var i=0;i<variants.length;i++){if(variants[i].width>=requiredW&&variants[i].height>=requiredH){selected=variants[i];break;}}
    }
    var result={id:e.id,url:new URL(selected.file,base).href,width:selected.width,height:selected.height,bytes:selected.bytes,quality:choice.quality,requiredWidth:Math.ceil(requiredW),requiredHeight:Math.ceil(requiredH),sourceLimited:selected.width<requiredW||selected.height<requiredH};
    // Window/monitor changes can upgrade an image, but do not fetch a lower
    // variant after a small resize. Explicit Apply starts a new choice.
    if(previous&&previous.id===result.id&&previous.quality===result.quality&&previous.width>result.width)return previous;
    return result;
  }
  function source(choice){return resolution(choice).url;}
  function status(id,state){window.dispatchEvent(new CustomEvent('liss:background-status',{detail:{id:id,state:state}}));}
  function load(choice,selectedResolution){
    choice=normalize(choice);var e=entry(choice.id),resolved=resolution(choice),url=resolved.url;
    // A public consumer may request one of this entry's responsive variants;
    // preferences and callers never become arbitrary network/image URLs.
    if(selectedResolution&&selectedResolution.id===e.id){var files=e.variants?e.variants.map(function(v){return v.file;}):[e.src,e.compact].filter(Boolean);if(files.some(function(file){return new URL(file,base).href===selectedResolution.url;}))url=selectedResolution.url;}
    if(activeLoad&&activeLoad.url===url&&activeLoad.state!=='unavailable')return activeLoad.promise;
    if(activeLoad&&activeLoad.cancel&&!activeLoad.ready)activeLoad.cancel();
    activeLoad=null;
    if(e.kind!=='image'||!url)return Promise.resolve(null);
    var request={id:choice.id,url:url,serial:++loadSerial,ready:false,state:'loading',image:null,promise:null,cancel:null};
    activeLoad=request;status(choice.id,'loading');
    request.promise=new Promise(function(resolve){
      if(typeof Image!=='function'){request.state='unavailable';resolve(null);return;}
      var image=new Image(),finished=false,cancelled=false;request.image=image;image.decoding='async';
      function done(result,state){if(finished)return;finished=true;request.ready=!!result;request.state=state;image.onload=image.onerror=null;if(activeLoad===request)status(request.id,state);resolve(result);}
      request.cancel=function(){if(finished)return;cancelled=true;image.onload=image.onerror=null;image.removeAttribute('src');done(null,'cancelled');};
      image.onload=function(){var decoded=typeof image.decode==='function'?image.decode():Promise.resolve();decoded.then(function(){done(cancelled?null:image,cancelled?'cancelled':'ready');},function(){done(null,'unavailable');});};
      image.onerror=function(){done(null,'unavailable');};
      image.src=url;
    });
    return request.promise;
  }
  function mountUI(){
    if(disposeUI)disposeUI();
    var abort=new AbortController(),signal=abort.signal,dialog=document.querySelector('[data-background-dialog]'),opener=null;
    if(!dialog)return;
    var radios=Array.from(dialog.querySelectorAll('[name=liss_background_v24]')),quality=dialog.querySelector('[data-background-quality]'),scroll=dialog.querySelector('[data-background-scroll]');
    var note=dialog.querySelector('[data-background-note]'),qualityRow=dialog.querySelector('[data-background-quality-row]'),motionNote=dialog.querySelector('[data-background-motion-note]'),credit=dialog.querySelector('[data-background-credit]');
    function selected(){var radio=radios.find(function(r){return r.checked;});return catalogue[radio&&radio.value]?radio.value:current.id;}
    function detail(){var e=entry(selected()),r=resolution({id:e.id,quality:quality.value,scroll:scroll.checked});qualityRow.hidden=e.kind!=='image'||!(e.compact||e.variants&&e.variants.length>1);note.textContent=e.kind==='vector'?'不下载背景图片。':(e.tall?'原图 '+e.width+' × '+e.height:'按屏幕载入 '+r.width+' × '+r.height)+' · 约 '+Math.round(r.bytes/1024)+' KB，仅在使用时载入。';scroll.disabled=reduce.matches;motionNote.textContent=reduce.matches?'已遵循系统的减少动态设置。':'长卷随页面缓慢展开，关闭后画卷保持原位。';if(credit){credit.hidden=!e.credit;credit.textContent=e.credit||'';if(e.creditUrl)credit.href=e.creditUrl;else credit.removeAttribute('href');}}
    function closeDialog(){if(typeof dialog.close==='function')dialog.close();else{dialog.removeAttribute('open');if(opener&&opener.isConnected)opener.focus({preventScroll:true});}}
    function sync(){radios.forEach(function(r){r.checked=r.value===current.id;});quality.value=current.quality;scroll.checked=current.scroll;detail();}
    document.querySelectorAll('[data-background-open]').forEach(function(button){button.hidden=false;button.addEventListener('click',function(){opener=button;sync();if(typeof dialog.showModal==='function'){dialog.showModal();}else{dialog.setAttribute('open','');}},{signal:signal});});
    dialog.querySelectorAll('[data-background-close]').forEach(function(button){button.addEventListener('click',closeDialog,{signal:signal});});
    radios.forEach(function(r){r.addEventListener('change',detail,{signal:signal});});
    quality.addEventListener('change',detail,{signal:signal});
    dialog.querySelector('[data-background-apply]').addEventListener('click',function(){set({id:selected(),quality:quality.value,scroll:scroll.checked});closeDialog();},{signal:signal});
    dialog.addEventListener('click',function(event){if(event.target!==dialog)return;var r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog();},{signal:signal});
    dialog.addEventListener('close',function(){if(opener&&opener.isConnected)opener.focus({preventScroll:true});},{signal:signal});
    reduce.addEventListener('change',detail,{signal:signal});sync();
    disposeUI=function(){abort.abort();};
  }
  function adaptive(){if(!explicit){current=normalize(null);notify();}}
  reducedData.addEventListener('change',adaptive,{signal:lifetime.signal});
  if(navigator.connection&&navigator.connection.addEventListener)navigator.connection.addEventListener('change',adaptive,{signal:lifetime.signal});
  var resizeTimer=0,dprWatch=null;
  function responsive(){if(resizeTimer)clearTimeout(resizeTimer);resizeTimer=setTimeout(function(){resizeTimer=0;window.dispatchEvent(new Event('liss:background-resolution'));},250);}
  function watchDPR(){if(dprWatch)dprWatch.removeEventListener('change',onDPR);dprWatch=matchMedia('(resolution: '+(window.devicePixelRatio||1)+'dppx)');dprWatch.addEventListener('change',onDPR);}
  function onDPR(){watchDPR();responsive();}watchDPR();window.addEventListener('resize',responsive,{passive:true,signal:lifetime.signal});
  window.addEventListener('liss:background-status',function(event){var d=event.detail;if(!d||d.id!==current.id)return;var message=d.state==='loading'?'正在准备 '+entry(d.id).title+'，原画面会保留。':d.state==='ready'?'已使用 '+entry(d.id).title+'。':d.state==='unavailable'?'图片暂时不可用，已使用柔光背景。':'';document.querySelectorAll('[data-background-announcement]').forEach(function(n){n.textContent=message;});},{signal:lifetime.signal});
  window.addEventListener('storage',function(event){if(event.key!==STORE)return;stored=saved();explicit=!!stored;current=normalize(stored);notify();},{signal:lifetime.signal});
  window.addEventListener('pagehide',function(){if(disposeUI)disposeUI();if(activeLoad&&!activeLoad.ready&&activeLoad.cancel)activeLoad.cancel();activeLoad=null;},{signal:lifetime.signal});
  window.addEventListener('pageshow',function(event){if(!event.persisted)return;stored=saved();explicit=!!stored;current=normalize(stored);mountUI();notify();},{signal:lifetime.signal});
  window[KEY]={read:read,entry:entry,set:set,source:source,resolve:resolution,load:load,subscribe:function(fn){listeners.add(fn);return function(){listeners.delete(fn);};},inspect:function(){return{choice:read(),request:activeLoad?{id:activeLoad.id,state:activeLoad.state,url:activeLoad.url,ready:activeLoad.ready}:null,retainedRequests:activeLoad?1:0};},destroy:function(){if(disposeUI)disposeUI();if(activeLoad&&!activeLoad.ready&&activeLoad.cancel)activeLoad.cancel();if(resizeTimer)clearTimeout(resizeTimer);if(dprWatch)dprWatch.removeEventListener('change',onDPR);activeLoad=null;listeners.clear();lifetime.abort();delete window[KEY];}};
  mountUI();
})();
