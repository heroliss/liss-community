/* Runs the real catalogue loader. It does not need network or a browser.
   Native rendering and browser requests are independently checked in-browser. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
require('node:events').setMaxListeners(0);
const source=fs.readFileSync(path.resolve(__dirname,'../../app/static/community-backgrounds.js'),'utf8');
class Bus{constructor(){this.events=new Map();}addEventListener(type,fn,options={}){const set=this.events.get(type)||new Set();set.add(fn);this.events.set(type,set);if(options.signal)options.signal.addEventListener('abort',()=>set.delete(fn),{once:true});}removeEventListener(type,fn){this.events.get(type)?.delete(fn);}dispatchEvent(event){for(const fn of [...(this.events.get(event.type)||[])])fn(event);return true;}}
class CE{constructor(type,options={}){this.type=type;this.detail=options.detail;}}
function setup(options={}){
  const win=new Bus(),images=[],requests=[],media=new Map(),store=new Map();let decodes=0;
  if(options.saved)store.set('liss-background-v24',JSON.stringify(options.saved));
  win.innerWidth=options.width||1440;win.innerHeight=options.height||900;win.devicePixelRatio=options.dpr||1;
  const connection=new Bus();connection.saveData=!!options.saver;
  const doc=new Bus(),styleValues=new Map(),html={dataset:{},style:{setProperty:(k,v)=>styleValues.set(k,v),removeProperty:k=>styleValues.delete(k),getPropertyValue:k=>styleValues.get(k)||''},removeAttribute(n){if(n==='data-background-bootstrap')delete this.dataset.backgroundBootstrap;}};let uiQueries=0;Object.assign(doc,{currentScript:{src:options.scriptUrl||'http://localhost/static/community-backgrounds.js'},documentElement:html,readyState:options.head?'loading':'complete',querySelector:()=>{uiQueries++;return null;},querySelectorAll:()=>[]});
  class Img{constructor(){images.push(this);this.decoding='';this.url='';this.cancelled=false;this.decodeDeferred=options.decodeDeferred;}set src(url){this.url=url;requests.push(url);}get src(){return this.url;}removeAttribute(name){if(name==='src'){this.url='';this.cancelled=true;}}decode(){decodes++;if(this.decodeDeferred)return new Promise(resolve=>this.finishDecode=resolve);return Promise.resolve();}fire(){if(this.onload)this.onload();}}
  const localStorage={getItem:key=>{if(options.storageBlocked)throw Error('blocked');return store.get(key)||null;},setItem:(key,value)=>{if(options.storageBlocked)throw Error('blocked');store.set(key,value);}};
  const sandbox={window:win,document:doc,Image:Img,location:{href:'http://localhost/'},URL,AbortController,navigator:{connection},localStorage,CustomEvent:CE,Event:CE,setTimeout,clearTimeout,matchMedia:query=>{if(!media.has(query)){const m=new Bus();m.matches=query.includes('reduced-data')?!!options.reducedData:query.includes('reduced-motion')?!!options.reducedMotion:false;media.set(query,m);}return media.get(query);}};
  if(options.candidates){vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../app/static/community-background-palettes-v40.js'),'utf8'),sandbox,{filename:'community-background-palettes-v40.js'});vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../app/static/community-background-candidates-v40.js'),'utf8'),sandbox,{filename:'community-background-candidates-v40.js'});}
  vm.runInNewContext(source,sandbox,{filename:'community-backgrounds.js'});
  return{win,doc,html,styleValues,api:win.LissBackgrounds,images,requests,store,media,get uiQueries(){return uiQueries;},get decodes(){return decodes;}};
}
async function tick(){await Promise.resolve();await Promise.resolve();}
async function run(){
  const checks={},r=setup();checks.onlyChosenImagePreheated=r.images.length===1&&r.api.read().id==='coast'&&r.requests[0].includes('/scenes/coast-v54-vosr2-');
  const bundled=setup({scriptUrl:'http://localhost/static/bundles/background-head.1234567890abcdef.js'});checks.bundledImageUsesStaticRoot=bundled.requests[0].includes('/static/scenes/')&&!bundled.requests[0].includes('/bundles/scenes/');bundled.api.destroy();
  checks.catalogueCannotEscape=['__proto__','constructor','file:///private'].every(id=>r.api.entry(id).id==='mist');
  r.api.set({id:'__proto__',quality:'bad'});checks.invalidPreferenceCanonical=r.api.read().id==='coast'&&r.api.read().quality==='auto';
  r.api.entry('earthrise').variants[0].file='http://attacker.invalid/a.jpg';checks.frozenVariantCatalogue=r.api.resolve({id:'earthrise'}).url.includes('/static/scenes/earthrise-v54-vosr2-');
  let p1=r.api.load({id:'coast'}),first=r.images[0];let p2=r.api.load({id:'mineral-scroll'}),second=r.images[1];
  checks.supersededRequestCancelled=await p1===null&&first.cancelled;
  second.fire();checks.singleDecodedImage=(await p2)===second&&r.decodes===1;
  const count=r.images.length;same=r.api.load({id:'mineral-scroll'});checks.sameSourceShared=(await same)===second&&r.images.length===count&&r.decodes===1;
  await r.api.load({id:'mist'});checks.vectorReleasesRequest=r.api.inspect().retainedRequests===0;
  const bad=r.api.load({id:'coast'},{id:'coast',url:'https://untrusted.invalid/a.png'});checks.loadUsesWhitelist=!r.requests.at(-1).includes('untrusted');r.images.at(-1).fire();await bad;
  const q=setup({decodeDeferred:true});const a=q.api.load({id:'coast'});q.images[0].fire();await tick();const b=q.api.load({id:'ink-scroll'});checks.cancelDuringDecode=await a===null;q.images[0].finishDecode();await tick();checks.lateDecodeCannotReplace=q.api.inspect().request.id==='ink-scroll';q.api.load({id:'mist'});await b;
  const save=setup({saver:true});checks.saveDataOpalDefault=save.api.read().id==='coast'&&save.requests.length===1&&save.requests[0].includes('/scenes/coast-v54-vosr2-960.webp');
  const reduced=setup({reducedData:true});checks.reducedDataOpalDefault=reduced.api.read().id==='coast'&&reduced.requests.length===1&&reduced.requests[0].includes('/scenes/coast-v54-vosr2-960.webp');
  const explicit=setup({saver:true,saved:{id:'ink-scroll',quality:'high',scroll:false}});checks.manualChoiceWins=explicit.api.read().id==='ink-scroll'&&explicit.api.read().quality==='high'&&!explicit.api.read().scroll;
  const blocked=setup({storageBlocked:true,saver:true});blocked.api.set({id:'line'});checks.blockedStorageUsable=blocked.api.read().id==='line';
  const phone=setup({width:390,height:844,dpr:3});let resolution=phone.api.resolve({id:'earthrise',quality:'high'});checks.coverTimesDpr=resolution.width===3840&&resolution.requiredWidth===3436;
  const desktop=setup({width:1440,height:900,dpr:1});let smaller=desktop.api.resolve({id:'earthrise'});checks.desktopSmallestAdequate=smaller.width===1920;desktop.win.innerWidth=2560;desktop.win.innerHeight=1440;desktop.win.devicePixelRatio=2;let larger=desktop.api.resolve({id:'earthrise'},smaller);checks.monitorUpgrade=larger.width===3840;desktop.win.innerWidth=800;desktop.win.innerHeight=600;desktop.win.devicePixelRatio=1;checks.resizeDoesNotThrash=desktop.api.resolve({id:'earthrise'},larger).url===larger.url;
  checks.aiSourceHonesty=phone.api.resolve({id:'mineral-scroll',quality:'high'}).width===3840&&phone.api.entry('mineral-scroll').originalWidth===793&&phone.api.entry('mineral-scroll').nativeHighResolution===false&&phone.api.entry('coast').originalWidth===1672;
  const template=fs.readFileSync(path.resolve(__dirname,'../../app/templates/_backgrounds.html'),'utf8');
  const vectors=r.api.list().filter(entry=>entry.kind==='vector');
  checks.materialVectorCatalogue=vectors.length>0&&vectors.every(entry=>entry.style===entry.id&&r.api.source({id:entry.id})===''&&template.includes("('"+entry.id+"',"));
  checks.discardedImagesAbsent=['mirror-lake','glazed-folds','denali-dawn','cloud-facade'].every(id=>r.api.entry(id).id==='mist'&&!template.includes("('"+id+"',"));
  const low=setup({width:3840,height:2160,dpr:2,saver:true});checks.saveDataPicksSmallest=low.api.resolve({id:'earthrise'}).width===960&&low.api.resolve({id:'earthrise',quality:'high'}).width===3840;
  const before=r.images.length;const pending=r.api.load({id:'ink-scroll'});r.win.dispatchEvent({type:'pagehide'});checks.pagehideCancels=await pending===null&&r.api.inspect().retainedRequests===0&&r.images.length===before+1;
  const head=setup({head:true,saved:{id:'ink-scroll',quality:'auto',scroll:true}});checks.headNeedsNoBody=head.uiQueries===0&&head.images.length===1;checks.bootstrapUsesChosenWhitelist=head.html.dataset.backgroundBootstrap==='image'&&head.html.style.getPropertyValue('--background-bootstrap-image').includes('/static/scenes/ink-scroll-v54-vosr2-');const reuse=head.api.load(head.api.read());head.images[0].fire();const decoded=await reuse;checks.headAndAtmosphereShareImage=head.images.length===1&&decoded===head.images[0]&&head.decodes===1;head.api.releaseBootstrap();checks.bootstrapFullyReleased=!head.html.dataset.backgroundBootstrap&&head.styleValues.size===0;head.doc.dispatchEvent({type:'DOMContentLoaded'});checks.headMountsControlsOnDom=head.uiQueries===1;
  const kept=setup({saved:{id:'coast'}}),keptRequest=kept.api.load(kept.api.read());kept.images[0].fire();await keptRequest;kept.win.dispatchEvent({type:'pagehide',persisted:true});checks.bfcacheKeepsDecodedImage=kept.api.inspect().retainedRequests===1&&kept.api.inspect().request.ready&&!kept.images[0].cancelled;kept.win.dispatchEvent({type:'pageshow',persisted:true});const keptAgain=await kept.api.load(kept.api.read());checks.bfcacheRestoresWithoutReload=keptAgain===kept.images[0]&&kept.images.length===1&&kept.decodes===1;
  const pendingKeep=setup({saved:{id:'ink-scroll'}}),pendingKeepRequest=pendingKeep.api.load(pendingKeep.api.read());pendingKeep.win.dispatchEvent({type:'pagehide',persisted:true});checks.bfcachePendingLoadNotCancelled=pendingKeep.api.inspect().retainedRequests===1&&!pendingKeep.images[0].cancelled;pendingKeep.images[0].fire();await pendingKeepRequest;
  const failedHead=setup({head:true,saved:{id:'ink-scroll'}});failedHead.images[0].onerror();await tick();checks.failedBootstrapReleased=!failedHead.html.dataset.backgroundBootstrap&&failedHead.styleValues.size===0;
  const candidates=setup({candidates:true,width:390,height:844,dpr:3,head:true});
  const images=candidates.api.list().filter(entry=>entry.kind==='image'),additions=images.filter(entry=>entry.addedIn),retained=images.filter(entry=>entry.addedIn==='v40'),night=images.filter(entry=>entry.addedIn==='v41');
  const sourceImages=candidates.win.LissBackgroundCandidatesV40;
  checks.candidatesDoNotPrefetchFullArtwork=candidates.requests.length===1&&images.length>0;
  checks.imageCatalogueMatchesSource=sourceImages.length===new Set(sourceImages.map(entry=>entry.id)).size&&JSON.stringify(images.map(entry=>entry.id).sort())===JSON.stringify(sourceImages.map(entry=>entry.id).sort());
  checks.candidateSourceHonesty=images.every(entry=>entry.width===3840&&entry.originalWidth>0&&entry.originalHeight>0&&entry.nativeHighResolution===false&&entry.enhancement==='VOSR2 (BF16 DiT/DINO; FP32 VAE)'&&entry.revision==='v54');
  checks.retainedAllPriorAiImages=retained.length===19&&retained.every(entry=>entry.originalWidth===1536&&entry.originalHeight===1024&&entry.height===2560);
  checks.newDarkImagesHaveReadingPalette=night.length===8&&night.every(entry=>entry.readingTone==='dark'&&entry.palette.readingTone==='dark');
  checks.legacyEntriesUseNewOriginalSourceMasters=['coast','mineral-scroll','ink-scroll','earthrise'].every(id=>candidates.api.entry(id).src==='scenes/'+id+'-v54-vosr2-3840.webp')&&candidates.api.entry('coast').originalWidth===1672;
  checks.legacySceneryUsesModestLandscapeCrop=['mineral-scroll','ink-scroll'].every(id=>{const e=candidates.api.entry(id);return e.tall&&e.scrollReserve===.12&&e.height/e.width<.8&&e.originalWidth===793&&e.originalHeight>=529&&e.originalHeight<=595&&e.sourceOriginalWidth===793&&e.sourceOriginalHeight===1983&&e.sourceCrop.length===4;});
  const earthrise=candidates.api.entry('earthrise');checks.nasaDerivativeRetainsAttribution=earthrise.credit.includes('NASA / Apollo 8')&&earthrise.credit.includes('AI 增强衍生')&&earthrise.creditUrl==='https://www.nasa.gov/image-detail/as08-14-2384orig/'&&earthrise.originalWidth===4136&&earthrise.anchorY===.88;
  checks.everyBackgroundHasOwnPalette=candidates.api.list().every(entry=>entry.palette&&entry.palette.id===entry.id&&Object.isFrozen(entry.palette));
  checks.deliveryFilesExist=images.every(entry=>[entry.thumbnail,...entry.variants.map(v=>v.file)].every(file=>file.startsWith('scenes/')&&fs.existsSync(path.resolve(__dirname,'../../app/static',file))));
  const mobileCandidate=candidates.api.resolve({id:'opal-drift',quality:'auto'});
  checks.mobileAutoAvoidsLargestCandidate=mobileCandidate.width===2560&&candidates.api.resolve({id:'opal-drift',quality:'high'}).width===3840;
  checks.candidateHasModestScrollReserve=additions.every(entry=>entry.scrollReserve>0&&entry.scrollReserve<=.15&&entry.tall&&entry.height/entry.width<.8);
  const defaultImages=['tidal-still','satin-atrium','sea-glass-study'],defaultDrawings=['glass-weave','mercury-tide','opal-strata'];
  checks.newDefaultImageOptions=defaultImages.every(id=>{const entry=candidates.api.entry(id);return entry.id===id&&entry.kind==='image'&&entry.addedIn==='v43'&&entry.height/entry.width>=.6&&entry.height/entry.width<.8;});
  checks.newDefaultDrawingOptions=defaultDrawings.every(id=>{const entry=candidates.api.entry(id);return entry.id===id&&entry.kind==='vector'&&entry.style===id&&candidates.api.source({id})===''&&template.includes("('"+id+"',");});
  for(const item of[r,q,save,reduced,explicit,blocked,phone,desktop,low,head,kept,pendingKeep,failedHead,candidates])item.api.destroy();checks.destroyRemovesApi=!r.win.LissBackgrounds;
  for(const [name,value]of Object.entries(checks))assert.equal(value,true,name);
  const report={passed:true,checks,requests:r.requests};console.log(JSON.stringify(report,null,2));
}
let same;run().catch(error=>{console.error(error);process.exitCode=1;});
