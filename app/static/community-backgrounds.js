/* Local preferences. Only the selected full-size background is requested. */
(function () {
  'use strict';
  var KEY='LissBackgrounds',STORE='liss-background-v24';
  if(window[KEY]&&window[KEY].destroy)window[KEY].destroy();
  var base=new URL('.',document.currentScript&&document.currentScript.src||new URL('/static/community-backgrounds.js',location.href).href);
  if(/\/bundles\/$/.test(base.pathname))base=new URL('../',base);
  var catalogue={
    'aurora-veil':{id:'aurora-veil',title:'极光夜幕',description:'星空下缓缓垂落的青绿与紫色极光',kind:'vector',style:'aurora-veil',bytes:0,theme:'极光 · 夜空',randomEligible:true},
    'prism-nebula':{id:'prism-nebula',title:'棱镜星云',description:'深空星云与一束穿过的七彩棱光',kind:'vector',style:'prism-nebula',bytes:0,theme:'星云 · 棱光',randomEligible:true},
    'bokeh-night':{id:'bokeh-night',title:'夜色光斑',description:'远近交叠的彩色光斑，中间留出安静的阅读区',kind:'vector',style:'bokeh-night',bytes:0,theme:'光斑 · 多彩',randomEligible:true},
    'tide-glow':{id:'tide-glow',title:'夜港辉光',description:'地平线上的彩色灯火倒映在夜色水面',kind:'vector',style:'tide-glow',bytes:0,theme:'夜港 · 辉光',randomEligible:true},
    'silk-flow':{id:'silk-flow',title:'丝光流彩',description:'几束丝绸般的彩色光带横贯夜色',kind:'vector',style:'silk-flow',bytes:0,theme:'丝光 · 流彩',randomEligible:true},
    'crystal-cavern':{id:'crystal-cavern',title:'晶洞微光',description:'从角落生长的晶体，内部透出冷暖微光',kind:'vector',style:'crystal-cavern',bytes:0,theme:'晶体 · 微光',randomEligible:true},
    'dusk-dunes':{id:'dusk-dunes',title:'暮色沙丘',description:'低垂的夕阳把层层沙脊勾出金边',kind:'vector',style:'dusk-dunes',bytes:0,theme:'暮色 · 沙丘',randomEligible:true},
    'deep-current':{id:'deep-current',title:'深海光束',description:'天光穿过深水，荧光微粒缓缓浮游',kind:'vector',style:'deep-current',bytes:0,theme:'深海 · 光束',randomEligible:true},
    'neon-rain':{id:'neon-rain',title:'霓虹雨夜',description:'雨丝掠过几团品红与青色的霓虹',kind:'vector',style:'neon-rain',bytes:0,theme:'霓虹 · 雨夜',randomEligible:true},
    'lantern-field':{id:'lantern-field',title:'灯笼星野',description:'暖色灯火从原野升起，飘向星空',kind:'vector',style:'lantern-field',bytes:0,theme:'灯火 · 星野',randomEligible:true},
    mist:{id:'mist',title:'柔光留白',description:'安静的光色与空间',kind:'vector',style:'mist',bytes:0},
    line:{id:'line',title:'流线素描',description:'少量曲线，轻盈的层次',kind:'vector',style:'line',bytes:0},
    contour:{id:'contour',title:'山形等高',description:'青绿地形与细密的等高线',kind:'vector',style:'contour',bytes:0},
    prism:{id:'prism',title:'棱镜折面',description:'冷暖交叠的安静切面',kind:'vector',style:'prism',bytes:0},
    orbital:{id:'orbital',title:'轨道手记',description:'弧线、刻度和遥远的圆心',kind:'vector',style:'orbital',bytes:0},
    paper:{id:'paper',title:'纸间山丘',description:'层叠纸景与柔和的投影',kind:'vector',style:'paper',bytes:0},
    ribbons:{id:'ribbons',title:'流彩织带',description:'几束低饱和颜色缓缓交织',kind:'vector',style:'ribbons',bytes:0},
    constellation:{id:'constellation',title:'星图余白',description:'稀疏星点与几条偶然的连线',kind:'vector',style:'constellation',bytes:0},
    spectrum:{id:'spectrum',title:'柔彩色域',description:'宽广留白中的三种轻柔色彩',kind:'vector',style:'spectrum',bytes:0},
    'spectrum-botanical':{id:'spectrum-botanical',title:'柔彩叶影',description:'柔彩色域间舒展的透光叶片与轻柔枝影',kind:'vector',style:'spectrum-botanical',bytes:0,theme:'柔彩 · 叶影'},
    'spectrum-ripples':{id:'spectrum-ripples',title:'柔彩浮纹',description:'柔彩色域上交叠的宽弧浮纹与玻璃折光',kind:'vector',style:'spectrum-ripples',bytes:0,theme:'柔彩 · 浮纹'},
    'glass-weave':{id:'glass-weave',title:'雾织玻璃',description:'蓝灰折面与香槟微光，留出安静的阅读空间',kind:'vector',style:'glass-weave',bytes:0,theme:'玻璃 · 雾青'},
    'mercury-tide':{id:'mercury-tide',title:'银湾回澜',description:'灰青镜湾与缓慢游移的银色反射',kind:'vector',style:'mercury-tide',bytes:0,theme:'镜面 · 银灰'},
    'opal-strata':{id:'opal-strata',title:'柔晶层岸',description:'低饱和冷暖光穿过半透明的岸线',kind:'vector',style:'opal-strata',bytes:0,theme:'玻璃 · 层岸'},
    dunes:{id:'dunes',title:'层峦暖沙',description:'温暖的轮廓，远近不同的山脊',kind:'vector',style:'dunes',bytes:0},
    'mirror-hall':{id:'mirror-hall',title:'镜廊微光',description:'三片镜面与有序的折光',kind:'vector',style:'mirror-hall',bytes:0},
    tideglass:{id:'tideglass',title:'潮汐玻璃',description:'透光水纹与轻柔的潮线',kind:'vector',style:'tideglass',bytes:0},
    'etched-metal':{id:'etched-metal',title:'银箔刻痕',description:'银色曲面与细密拉丝',kind:'vector',style:'etched-metal',bytes:0},
    porcelain:{id:'porcelain',title:'釉面流光',description:'温润釉色与缓缓游走的光',kind:'vector',style:'porcelain',bytes:0},
    leather:{id:'leather',title:'皮革压纹',description:'暖褐纹理与细致的缝线',kind:'vector',style:'leather',bytes:0},
    'cork-relief':{id:'cork-relief',title:'软木浮雕',description:'轻盈颗粒与有机起伏',kind:'vector',style:'cork-relief',bytes:0},
    slate:{id:'slate',title:'板岩层光',description:'冷灰切面与安静的矿物光',kind:'vector',style:'slate',bytes:0},
    "coast":{"id":"coast","title":"欧泊海岸","description":"熟悉的晶透海岸","kind":"image","src":"scenes/coast-v54-vosr2-3840.webp","bytes":861162,"width":3840,"height":2160,"tall":false,"enhancement":"VOSR2 (BF16 DiT/DINO; FP32 VAE)","originalWidth":1672,"originalHeight":941,"nativeHighResolution":false,"variants":[{"file":"scenes/coast-v54-vosr2-960.webp","width":960,"height":540,"bytes":93720},{"file":"scenes/coast-v54-vosr2-1440.webp","width":1440,"height":810,"bytes":191540},{"file":"scenes/coast-v54-vosr2-1920.webp","width":1920,"height":1080,"bytes":300158},{"file":"scenes/coast-v54-vosr2-2560.webp","width":2560,"height":1440,"bytes":464408},{"file":"scenes/coast-v54-vosr2-3840.webp","width":3840,"height":2160,"bytes":861162}],"scrollReserve":0,"autoDprCap":1.25,"thumbnail":"scenes/coast-v54-thumb.webp","revision":"v54","readingTone":"dark","anchorX":0.57,"mobileAnchorX":0.88,"anchorY":0.46},
    "mineral-scroll":{"id":"mineral-scroll","title":"晶湾微光","description":"两岸晶石、暗水与柔和倒影","kind":"image","src":"scenes/mineral-scroll-v54-vosr2-3840.webp","bytes":2394520,"width":3840,"height":2880,"tall":true,"enhancement":"VOSR2 (BF16 DiT/DINO; FP32 VAE)","originalWidth":793,"originalHeight":595,"nativeHighResolution":false,"variants":[{"file":"scenes/mineral-scroll-v54-vosr2-960.webp","width":960,"height":720,"bytes":216680},{"file":"scenes/mineral-scroll-v54-vosr2-1440.webp","width":1440,"height":1080,"bytes":440330},{"file":"scenes/mineral-scroll-v54-vosr2-1920.webp","width":1920,"height":1440,"bytes":734718},{"file":"scenes/mineral-scroll-v54-vosr2-2560.webp","width":2560,"height":1920,"bytes":1212786},{"file":"scenes/mineral-scroll-v54-vosr2-3840.webp","width":3840,"height":2880,"bytes":2394520}],"scrollReserve":0.12,"autoDprCap":1.25,"thumbnail":"scenes/mineral-scroll-v54-thumb.webp","revision":"v54","readingTone":"dark","anchorX":0.5,"mobileAnchorX":0.5,"anchorY":0.42,"sourceOriginalWidth":793,"sourceOriginalHeight":1983,"sourceCrop":[0,990,793,1585]},
    "ink-scroll":{"id":"ink-scroll","title":"雾谷月色","description":"山水、月光与一层薄雾","kind":"image","src":"scenes/ink-scroll-v54-vosr2-3840.webp","bytes":488940,"width":3840,"height":2880,"tall":true,"enhancement":"VOSR2 (BF16 DiT/DINO; FP32 VAE)","originalWidth":793,"originalHeight":595,"nativeHighResolution":false,"variants":[{"file":"scenes/ink-scroll-v54-vosr2-960.webp","width":960,"height":720,"bytes":67340},{"file":"scenes/ink-scroll-v54-vosr2-1440.webp","width":1440,"height":1080,"bytes":107790},{"file":"scenes/ink-scroll-v54-vosr2-1920.webp","width":1920,"height":1440,"bytes":171492},{"file":"scenes/ink-scroll-v54-vosr2-2560.webp","width":2560,"height":1920,"bytes":269280},{"file":"scenes/ink-scroll-v54-vosr2-3840.webp","width":3840,"height":2880,"bytes":488940}],"scrollReserve":0.12,"autoDprCap":1.25,"thumbnail":"scenes/ink-scroll-v54-thumb.webp","revision":"v54","readingTone":"dark","anchorX":0.5,"mobileAnchorX":0.5,"anchorY":0.42,"sourceOriginalWidth":793,"sourceOriginalHeight":1983,"sourceCrop":[0,0,793,595]},
    "earthrise":{"id":"earthrise","title":"地月之间","description":"阿波罗 8 号原照的 AI 增强衍生","kind":"image","src":"scenes/earthrise-v54-vosr2-3840.webp","width":3840,"height":3840,"tall":false,"anchorX":0.5,"anchorY":0.88,"credit":"NASA / Apollo 8 · AS08-14-2384 · VOSR2 AI 增强衍生","creditUrl":"https://www.nasa.gov/image-detail/as08-14-2384orig/","variants":[{"file":"scenes/earthrise-v54-vosr2-960.webp","width":960,"height":960,"bytes":18822},{"file":"scenes/earthrise-v54-vosr2-1440.webp","width":1440,"height":1440,"bytes":37956},{"file":"scenes/earthrise-v54-vosr2-1920.webp","width":1920,"height":1920,"bytes":61794},{"file":"scenes/earthrise-v54-vosr2-2560.webp","width":2560,"height":2560,"bytes":98800},{"file":"scenes/earthrise-v54-vosr2-3840.webp","width":3840,"height":3840,"bytes":182512}],"bytes":182512,"scrollReserve":0.12,"autoDprCap":1.25,"enhancement":"VOSR2 (BF16 DiT/DINO; FP32 VAE)","originalWidth":4136,"originalHeight":4136,"nativeHighResolution":false,"thumbnail":"scenes/earthrise-v54-thumb.webp","revision":"v54","readingTone":"dark","mobileAnchorX":0.5}
  };
  (window.LissBackgroundCandidatesV40||[]).forEach(function(e){
    if(e&&/^[a-z][a-z0-9-]+$/.test(e.id)&&(!catalogue[e.id]||catalogue[e.id].kind==='image')&&e.kind==='image'){
      // Keep catalogue ownership local so destroying/restarting this controller
      // never freezes or adds a palette to the shared source entries.
      var candidate=Object.assign({},e);
      if(e.variants)candidate.variants=e.variants.map(function(v){return Object.assign({},v);});
      catalogue[e.id]=candidate;
    }
  });
  var site=window.LissBackgroundSite;
  if(site&&Array.isArray(site.entries)){
    Object.keys(catalogue).forEach(function(id){if(catalogue[id].kind==='image')delete catalogue[id];});
    site.entries.forEach(function(e){
      if(!e||e.kind!=='image'||!/^[a-z][a-z0-9-]+$/.test(e.id)||catalogue[e.id]||!e.src)return;
      var candidate=Object.assign({},e);if(e.variants)candidate.variants=e.variants.map(function(v){return Object.assign({},v);});
      catalogue[e.id]=candidate;
    });
  }
  if(window.LissBackgroundPalettesV40)Object.keys(catalogue).forEach(function(id){catalogue[id].palette=window.LissBackgroundPalettesV40.get(id)||window.LissBackgroundPalettesV40.get(catalogue[id].paletteKey||id);});
  Object.setPrototypeOf(catalogue,null);Object.keys(catalogue).forEach(function(id){var e=catalogue[id];if(e.variants){e.variants.forEach(Object.freeze);Object.freeze(e.variants);}Object.freeze(e);});Object.freeze(catalogue);
  var listeners=new Set(),lifetime=new AbortController(),disposeUI=null,activeLoad=null,loadSerial=0;
  var reducedData=matchMedia('(prefers-reduced-data: reduce)'),reduce=matchMedia('(prefers-reduced-motion: reduce)');
  function saved(){try{var d=JSON.parse(localStorage.getItem(STORE)||'null');return d&&typeof d==='object'&&catalogue[d.id]?d:null;}catch(e){return null;}}
  function dataSaver(){return !!(reducedData.matches||(navigator.connection&&navigator.connection.saveData));}
  var defaultId=catalogue.coast?'coast':Object.keys(catalogue).find(function(id){return catalogue[id].kind==='image';})||'mist';
  function normalize(d){d=d||{};return{id:catalogue[d.id]?d.id:defaultId,quality:d.quality==='high'?'high':'auto',scroll:d.scroll!==false};}
  var stored=saved(),explicit=!!stored,visits=window.LissBackgroundVisitsV55&&window.LissBackgroundVisitsV55.create({catalogue:catalogue,site:site,signal:lifetime.signal}),current=visits?visits.read():normalize(stored);
  function entry(id){var e=catalogue[id]||catalogue.mist;return Object.assign({},e);}
  function read(){return Object.assign({},current,current.randomPool?{randomPool:current.randomPool.slice()}:{},{kind:catalogue[current.id].kind,explicit:explicit,dataSaver:dataSaver(),reducedMotion:reduce.matches});}
  function notify(){var value=read();listeners.forEach(function(fn){fn(value);});window.dispatchEvent(new CustomEvent('liss:background-change',{detail:value}));}
  function set(d){if(visits){var result=visits.apply(d);if(!result.ok)return Object.assign(read(),{error:result.message});current=result.value;}else{current=normalize(d);try{localStorage.setItem(STORE,JSON.stringify(current));}catch(e){}}explicit=true;notify();return read();}
  function resolution(choice,previous){
    choice=normalize(choice);var e=entry(choice.id);if(e.kind!=='image')return{id:e.id,url:'',width:0,height:0,bytes:0};
    var variants=e.variants?e.variants.slice():[];if(!variants.length){if(e.compact)variants.push({file:e.compact,width:960,height:540,bytes:e.compactBytes});variants.push({file:e.src,width:e.width,height:e.height,bytes:e.bytes});}
    var viewportHeight=Math.max(1,window.innerHeight||800);
    var vw=Math.max(1,window.innerWidth||1280)+200,vh=viewportHeight+200+viewportHeight*(e.scrollReserve||0),dpr=Math.max(1,window.devicePixelRatio||1);
    if(choice.quality!=='high'&&e.autoDprCap)dpr=Math.min(dpr,e.autoDprCap);
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
  function releaseBootstrap(){
    var html=document.documentElement;
    html.removeAttribute('data-background-bootstrap');
    ['--background-bootstrap-image','--background-bootstrap-size','--background-bootstrap-position'].forEach(function(name){html.style.removeProperty(name);});
  }
  function bootstrap(){
    // Start only the chosen, catalogue-validated image before the body parses.
    // This temporary native background uses the SAME URL as the live view.
    // No second JS Image or bitmap copy is created; native caches remain UA-owned.
    var choice=read(),e=entry(choice.id);if(e.kind!=='image')return;
    var r=resolution(choice),vw=Math.max(1,window.innerWidth||1280),vh=Math.max(1,window.innerHeight||800),cw=vw+200,ch=vh+200+vh*(e.scrollReserve||0);
    var scale=Math.max(cw/r.width,ch/r.height),w=r.width*scale,h=r.height*scale;
    var anchor=vw<700&&e.mobileAnchorX!==undefined?e.mobileAnchorX:e.anchorX===undefined?(vw<700?.88:.57):e.anchorX,vertical=e.anchorY===undefined?.46:e.anchorY;
    var html=document.documentElement;
    html.style.setProperty('--background-bootstrap-image','url("'+r.url+'")');
    html.style.setProperty('--background-bootstrap-size',w+'px '+h+'px');
    html.style.setProperty('--background-bootstrap-position',(-100-(w-cw)*anchor)+'px '+(e.tall?-100:-100-(h-ch)*vertical)+'px');
    html.dataset.backgroundBootstrap='image';
    load(choice,r).then(function(image){if(!image)releaseBootstrap();});
  }
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
    var abort=new AbortController(),signal=abort.signal,dialog=document.querySelector('[data-background-dialog]'),opener=null,skipReturnFocus=false;
    if(!dialog)return;
    var imageChoices=dialog.querySelector('.background-choices-images');
    if(imageChoices)Array.from(imageChoices.querySelectorAll('input')).forEach(function(input){if(!catalogue[input.value]||catalogue[input.value].kind!=='image')input.closest('label').remove();});
    if(imageChoices)Object.keys(catalogue).forEach(function(id){
      var e=catalogue[id];if(e.kind!=='image'||!e.thumbnail)return;
      var input=imageChoices.querySelector('input[value="'+id+'"]'),existing=!!input,label=existing?input.closest('label'):document.createElement('label');
      if(!existing){label.className='background-choice';input=document.createElement('input');input.type='radio';input.name='liss_background_v24';input.value=id;label.appendChild(input);}
      var thumb=label.querySelector('.background-thumb');
      if(!thumb){thumb=document.createElement('span');thumb.className='background-thumb';thumb.setAttribute('aria-hidden','true');label.appendChild(thumb);}
      var image=thumb.querySelector('img');if(!image){image=document.createElement('img');thumb.appendChild(image);}
      image.dataset.backgroundThumbnail=new URL(e.thumbnail,base).href;image.decoding='async';image.loading='lazy';image.alt='';image.width=360;image.height=240;
      var copy=label.querySelector('.background-choice-copy');if(!copy){copy=document.createElement('span');copy.className='background-choice-copy';label.appendChild(copy);}
      var title=document.createElement('strong');title.textContent=e.title;var description=document.createElement('small');description.textContent=e.theme||e.description;copy.replaceChildren(title,description);
      imageChoices.appendChild(label);
    });
    var radios=Array.from(dialog.querySelectorAll('[name=liss_background_v24]')),quality=dialog.querySelector('[data-background-quality]'),scroll=dialog.querySelector('[data-background-scroll]');
    var search=dialog.querySelector('[data-background-search]'),filters=Array.from(dialog.querySelectorAll('[data-background-filter]')),filter='all';
    var gallery=dialog.querySelector('.background-gallery'),groups=Array.from(dialog.querySelectorAll('.background-choices')),scenePreviews=null;
    var empty=dialog.querySelector('[data-background-empty]'),results=dialog.querySelector('[data-background-results]'),preview=dialog.querySelector('[data-background-preview]');
    var selectionTitle=dialog.querySelector('[data-background-selection-title]'),selectionDescription=dialog.querySelector('[data-background-selection-description]'),selectionState=dialog.querySelector('[data-background-selection-state]');
    var qualityRow=dialog.querySelector('[data-background-quality-row]'),credit=dialog.querySelector('[data-background-credit]');
    var randomSettings=dialog.querySelector('[data-background-random-settings]'),randomEnabled=dialog.querySelector('[data-background-random-enabled]'),randomBrowse=dialog.querySelector('[data-background-random-browse]'),randomCount=dialog.querySelector('[data-background-random-count]'),randomStatus=dialog.querySelector('[data-background-random-status]');
    var poolChoices=dialog.querySelector('[data-background-pool-choices]'),poolTools=dialog.querySelector('[data-background-pool-tools]'),filterRow=dialog.querySelector('.background-filter-row'),selectionPanel=dialog.querySelector('.background-selection'),poolInputs=[],poolView=false,poolDraft=[],poolMode='site';
    var applyButton=dialog.querySelector('[data-background-apply]'),viewerStart=dialog.querySelector('[data-background-viewer-start]');
    if(visits&&randomSettings&&poolChoices){
      randomSettings.hidden=false;poolChoices.replaceChildren();poolChoices.setAttribute('aria-label','参与随机的图片');
      Object.keys(catalogue).forEach(function(id){var e=catalogue[id];if(e.kind!=='image'&&!e.randomEligible)return;
        var label=document.createElement('label');label.className='background-choice background-pool-choice';var input=document.createElement('input');input.type='checkbox';input.name='liss_background_pool_v55';input.value=id;input.setAttribute('aria-label','将'+e.title+'加入随机范围');label.appendChild(input);
        var thumb=document.createElement('span');thumb.className='background-thumb';thumb.setAttribute('aria-hidden','true');var image=document.createElement('img');image.dataset.backgroundPoolThumbnail=new URL(e.thumbnail||e.src,base).href;image.decoding='async';image.loading='lazy';image.alt='';image.width=360;image.height=240;thumb.appendChild(image);label.appendChild(thumb);
        var copy=document.createElement('span');copy.className='background-choice-copy';var title=document.createElement('strong');title.textContent=e.title;var theme=document.createElement('small');theme.textContent=e.theme||e.description;copy.appendChild(title);copy.appendChild(theme);label.appendChild(copy);poolChoices.appendChild(label);poolInputs.push(input);
        input.addEventListener('change',function(){poolMode='custom';poolDraft=poolInputs.filter(function(node){return node.checked;}).map(function(node){return node.value;});randomDetail();},{signal:signal});
      });
    }
    function randomDetail(){
      if(!visits||!randomEnabled)return;
      if(randomCount)randomCount.textContent=poolDraft.length+'张';
      var invalid=randomEnabled.checked&&!poolDraft.length,message=invalid?'请至少选择一张图片，或关闭随机。':current.randomNotice||'';
      if(randomStatus){randomStatus.textContent=message;randomStatus.hidden=!message;}
      applyButton.disabled=invalid;if(viewerStart)viewerStart.disabled=invalid;
      applyButton.textContent=poolView?'保存随机范围':randomEnabled.checked?'保存并使用':'固定使用此背景';
    }
    function showPool(value){
      poolView=!!value;if(poolChoices)poolChoices.hidden=!poolView;if(poolTools)poolTools.hidden=!poolView;if(filterRow)filterRow.hidden=poolView;if(selectionPanel)selectionPanel.hidden=poolView;
      dialog.dataset.backgroundPoolView=String(poolView);if(randomBrowse)randomBrowse.setAttribute('aria-expanded',String(poolView));
      if(poolView&&scenePreviews)scenePreviews.releaseAll();filterCards();if(!poolView)detail();else randomDetail();
    }
    function updatePool(ids,mode){poolDraft=ids.slice();poolMode=mode;poolInputs.forEach(function(input){input.checked=poolDraft.indexOf(input.value)!==-1;});randomDetail();}
    function matchesKind(e,kind){return kind==='all'||kind===e.kind;}
    function paint(thumb,id){
      if(!window.LissBackgroundPreviewsV49||entry(id).kind!=='vector')return;
      if(!scenePreviews)scenePreviews=window.LissBackgroundPreviewsV49.create(gallery);
      scenePreviews.paint(thumb,entry(id),document.documentElement.dataset.theme==='light');
    }
    function thumbnails(){
      if(poolView){poolInputs.forEach(function(input){var label=input.closest('label'),image=label.querySelector('img');if(!label.hidden&&image&&!image.getAttribute('src'))image.src=image.dataset.backgroundPoolThumbnail;});return;}
      radios.forEach(function(input){
        var label=input.closest('label');if(label.hidden)return;
        var thumb=label.querySelector('.background-thumb'),image=thumb.querySelector('img[data-background-thumbnail]');
        if(image&&!image.getAttribute('src'))image.src=image.dataset.backgroundThumbnail;
        paint(thumb,input.value);
      });
    }
    function selected(){var radio=radios.find(function(r){return r.checked;});return catalogue[radio&&radio.value]?radio.value:current.id;}
    function paintPreview(e){
      if(!preview||!dialog.open||poolView)return;
      preview.className='background-selection-preview background-thumb background-thumb-'+e.id;
      if(preview.dataset.backgroundPreviewId===e.id){if(e.kind==='vector')paint(preview,e.id);return;}
      preview.dataset.backgroundPreviewId=e.id;if(scenePreviews)scenePreviews.clear(preview);preview.replaceChildren();
      if(e.kind==='image'&&e.thumbnail){var image=document.createElement('img');image.src=new URL(e.thumbnail,base).href;image.alt='';image.decoding='async';image.width=360;image.height=240;preview.appendChild(image);}
      else paint(preview,e.id);
    }
    function markCurrent(){
      radios.forEach(function(r){var label=r.closest('label');label.dataset.current=r.value===current.id?'true':'false';r.setAttribute('aria-label',entry(r.value).title);});
    }
    function detail(){
      var e=entry(selected());
      qualityRow.hidden=e.kind!=='image'||!(e.compact||e.variants&&e.variants.length>1);
      if(selectionTitle)selectionTitle.textContent=e.title;
      if(selectionDescription)selectionDescription.textContent=e.description;
      if(selectionState)selectionState.textContent=e.id===current.id?'正在使用':'选好后点击使用';
      paintPreview(e);markCurrent();
      scroll.disabled=reduce.matches;
      if(credit){credit.hidden=!e.credit;credit.textContent=e.credit||'';if(e.creditUrl)credit.href=e.creditUrl;else credit.removeAttribute('href');}
      randomDetail();
    }
    function filterCards(){
      var query=(search?search.value:'').trim().toLowerCase(),tokens=query.split(/\s+/).filter(Boolean),visible=0;
      (poolView?poolInputs:radios).forEach(function(input){
        var e=entry(input.value),label=input.closest('label'),haystack=[e.title,e.description,e.theme,e.palette&&e.palette.name].filter(Boolean).join(' ').toLowerCase();
        label.hidden=(!poolView&&!matchesKind(e,filter))||!tokens.every(function(token){return haystack.includes(token);});
        if(!label.hidden)visible++;
      });
      groups.forEach(function(group){group.hidden=poolView||!Array.from(group.querySelectorAll('.background-choice')).some(function(label){return !label.hidden;});});
      filters.forEach(function(button){button.setAttribute('aria-pressed',String(button.dataset.backgroundFilter===filter));});
      if(results)results.textContent=visible+' / '+(poolView?poolInputs.length:radios.length);
      if(empty)empty.hidden=visible>0;
      if(gallery)gallery.scrollTop=0;
      if(dialog.open)thumbnails();
    }
    function resetFilters(){filter='all';if(search)search.value='';filterCards();}
    function locateSelection(){
      if(poolView)showPool(false);
      resetFilters();var radio=radios.find(function(r){return r.checked;});
      if(radio){var label=radio.closest('label');if(typeof label.scrollIntoView==='function')label.scrollIntoView({block:'nearest'});}
    }
    function closeDialog(){if(scenePreviews)scenePreviews.releaseAll();if(typeof dialog.close==='function')dialog.close();else{dialog.removeAttribute('open');if(!skipReturnFocus&&opener&&opener.isConnected)opener.focus({preventScroll:true});}}
    function sync(){radios.forEach(function(r){r.checked=r.value===current.id;});quality.value=current.quality;scroll.checked=current.scroll;if(visits&&randomEnabled){randomEnabled.checked=current.random;updatePool(current.randomPool,current.randomPoolMode);}showPool(false);detail();}
    function openDialog(trigger){
      opener=trigger&&trigger.isConnected?trigger:document.querySelector('[data-background-open]');skipReturnFocus=false;
      sync();resetFilters();
      if(!dialog.open){if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}
      thumbnails();detail();locateSelection();
    }
    function apply(){var draft={id:selected(),quality:quality.value,scroll:scroll.checked};if(visits&&randomEnabled){draft.random=randomEnabled.checked;draft.randomPool=poolDraft;draft.randomPoolMode=poolMode;}var result=set(draft);if(result.error){if(randomStatus){randomStatus.textContent=result.error;randomStatus.hidden=false;}return false;}return true;}
    filters.forEach(function(button){
      var count=dialog.querySelector('[data-background-filter-count="'+button.dataset.backgroundFilter+'"]');
      if(count)count.textContent=String(radios.filter(function(input){return matchesKind(entry(input.value),button.dataset.backgroundFilter);}).length);
      button.addEventListener('click',function(){filter=button.dataset.backgroundFilter;filterCards();},{signal:signal});
    });
    if(search){search.addEventListener('input',function(event){if(!event.isComposing)filterCards();},{signal:signal});search.addEventListener('compositionend',filterCards,{signal:signal});}
    var reset=dialog.querySelector('[data-background-reset]');if(reset)reset.addEventListener('click',function(){resetFilters();search.focus();},{signal:signal});
    var locate=dialog.querySelector('[data-background-locate]');if(locate)locate.addEventListener('click',locateSelection,{signal:signal});
    document.querySelectorAll('[data-background-open]').forEach(function(button){button.hidden=false;button.addEventListener('click',function(){openDialog(button);},{signal:signal});});
    window.addEventListener('liss:background-picker-open',function(event){openDialog(event.detail&&event.detail.returnFocus);},{signal:signal});
    dialog.querySelectorAll('[data-background-close]').forEach(function(button){button.addEventListener('click',closeDialog,{signal:signal});});
    radios.forEach(function(r){r.addEventListener('change',detail,{signal:signal});});
    quality.addEventListener('change',detail,{signal:signal});
    applyButton.addEventListener('click',function(){if(apply())closeDialog();},{signal:signal});
    if(viewerStart)viewerStart.addEventListener('click',function(){if(!apply())return;skipReturnFocus=true;closeDialog();window.dispatchEvent(new CustomEvent('liss:background-viewer-open',{detail:{returnFocus:opener}}));},{signal:signal});
    if(visits&&randomEnabled){
      randomEnabled.addEventListener('change',randomDetail,{signal:signal});randomBrowse.addEventListener('click',function(){showPool(!poolView);},{signal:signal});
      [['back',function(){showPool(false);}],['all',function(){updatePool(poolInputs.map(function(input){return input.value;}),'custom');}],['none',function(){updatePool([],'custom');}],['default',function(){updatePool(visits.defaults().pool,'site');}]].forEach(function(action){var button=dialog.querySelector('[data-background-pool-'+action[0]+']');if(button)button.addEventListener('click',action[1],{signal:signal});});
    }
    dialog.addEventListener('click',function(event){if(event.target!==dialog)return;var r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog();},{signal:signal});
    dialog.addEventListener('close',function(){if(scenePreviews)scenePreviews.releaseAll();if(!skipReturnFocus&&opener&&opener.isConnected)opener.focus({preventScroll:true});},{signal:signal});
    function preferenceChanged(){markCurrent();if(dialog.open)detail();}
    listeners.add(preferenceChanged);reduce.addEventListener('change',detail,{signal:signal});
    window.addEventListener('liss:theme-change',function(){if(dialog.open){thumbnails();detail();}},{signal:signal});
    window.addEventListener('pagehide',function(){if(scenePreviews)scenePreviews.releaseAll();},{signal:signal});
    window.addEventListener('pageshow',function(event){if(event.persisted&&dialog.open){thumbnails();detail();}},{signal:signal});sync();filterCards();
    disposeUI=function(){if(scenePreviews)scenePreviews.destroy();listeners.delete(preferenceChanged);abort.abort();};
  }
  function adaptive(){if(!explicit&&!visits){current=normalize(null);notify();}}
  reducedData.addEventListener('change',adaptive,{signal:lifetime.signal});
  if(navigator.connection&&navigator.connection.addEventListener)navigator.connection.addEventListener('change',adaptive,{signal:lifetime.signal});
  var resizeTimer=0,dprWatch=null;
  function responsive(){if(resizeTimer)clearTimeout(resizeTimer);resizeTimer=setTimeout(function(){resizeTimer=0;window.dispatchEvent(new Event('liss:background-resolution'));},250);}
  function watchDPR(){if(dprWatch)dprWatch.removeEventListener('change',onDPR);dprWatch=matchMedia('(resolution: '+(window.devicePixelRatio||1)+'dppx)');dprWatch.addEventListener('change',onDPR);}
  function onDPR(){watchDPR();responsive();}watchDPR();window.addEventListener('resize',responsive,{passive:true,signal:lifetime.signal});
  window.addEventListener('liss:background-status',function(event){var d=event.detail;if(!d||d.id!==current.id)return;var message=d.state==='loading'?'正在准备 '+entry(d.id).title+'，原画面会保留。':d.state==='ready'?'已使用 '+entry(d.id).title+'。':d.state==='unavailable'?'图片暂时不可用，已使用柔光背景。':'';document.querySelectorAll('[data-background-announcement]').forEach(function(n){n.textContent=message;});},{signal:lifetime.signal});
  window.addEventListener('storage',function(event){if(event.key!==STORE)return;stored=saved();explicit=!!stored;current=visits?visits.sync(false):normalize(stored);notify();},{signal:lifetime.signal});
  window.addEventListener('pagehide',function(event){if(resizeTimer)clearTimeout(resizeTimer);resizeTimer=0;if(event.persisted)return;if(disposeUI)disposeUI();if(activeLoad&&!activeLoad.ready&&activeLoad.cancel)activeLoad.cancel();activeLoad=null;releaseBootstrap();},{signal:lifetime.signal});
  window.addEventListener('pageshow',function(event){if(!event.persisted)return;stored=saved();explicit=!!stored;current=visits?visits.sync(true):normalize(stored);notify();},{signal:lifetime.signal});
  window[KEY]={read:read,entry:entry,list:function(){return Object.keys(catalogue).map(entry);},set:set,randomDefaults:function(){return visits?visits.defaults():{enabled:false,pool:[]};},source:source,resolve:resolution,load:load,releaseBootstrap:releaseBootstrap,subscribe:function(fn){listeners.add(fn);return function(){listeners.delete(fn);};},inspect:function(){return{choice:read(),visit:visits?visits.inspect():null,request:activeLoad?{id:activeLoad.id,state:activeLoad.state,url:activeLoad.url,ready:activeLoad.ready}:null,retainedRequests:activeLoad?1:0};},destroy:function(){if(disposeUI)disposeUI();if(activeLoad&&!activeLoad.ready&&activeLoad.cancel)activeLoad.cancel();if(resizeTimer)clearTimeout(resizeTimer);if(dprWatch)dprWatch.removeEventListener('change',onDPR);activeLoad=null;listeners.clear();releaseBootstrap();lifetime.abort();delete window[KEY];}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountUI,{once:true,signal:lifetime.signal});else mountUI();
  bootstrap();
})();
