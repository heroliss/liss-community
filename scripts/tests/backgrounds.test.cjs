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
  vm.runInNewContext(source,sandbox,{filename:'community-backgrounds.js'});
  return{win,doc,html,styleValues,api:win.LissBackgrounds,images,requests,store,media,get uiQueries(){return uiQueries;},get decodes(){return decodes;}};
}
async function tick(){await Promise.resolve();await Promise.resolve();}
async function run(){
  const checks={},r=setup();checks.onlyChosenImagePreheated=r.images.length===1&&r.api.read().id==='coast'&&r.requests[0].includes('/scenes/coast-v25-ai-');
  const bundled=setup({scriptUrl:'http://localhost/static/bundles/background-head.1234567890abcdef.js'});checks.bundledImageUsesStaticRoot=bundled.requests[0].includes('/static/scenes/')&&!bundled.requests[0].includes('/bundles/scenes/');bundled.api.destroy();
  checks.catalogueCannotEscape=['__proto__','constructor','file:///private'].every(id=>r.api.entry(id).id==='mist');
  r.api.set({id:'__proto__',quality:'bad'});checks.invalidPreferenceCanonical=r.api.read().id==='coast'&&r.api.read().quality==='auto';
  r.api.entry('earthrise').variants[0].file='http://attacker.invalid/a.jpg';checks.frozenVariantCatalogue=r.api.resolve({id:'earthrise'}).url.includes('/static/scenes/earthrise-v24-');
  let p1=r.api.load({id:'coast'}),first=r.images[0];let p2=r.api.load({id:'mineral-scroll'}),second=r.images[1];
  checks.supersededRequestCancelled=await p1===null&&first.cancelled;
  second.fire();checks.singleDecodedImage=(await p2)===second&&r.decodes===1;
  const count=r.images.length;same=r.api.load({id:'mineral-scroll'});checks.sameSourceShared=(await same)===second&&r.images.length===count&&r.decodes===1;
  await r.api.load({id:'mist'});checks.vectorReleasesRequest=r.api.inspect().retainedRequests===0;
  const bad=r.api.load({id:'coast'},{id:'coast',url:'https://untrusted.invalid/a.png'});checks.loadUsesWhitelist=!r.requests.at(-1).includes('untrusted');r.images.at(-1).fire();await bad;
  const q=setup({decodeDeferred:true});const a=q.api.load({id:'coast'});q.images[0].fire();await tick();const b=q.api.load({id:'ink-scroll'});checks.cancelDuringDecode=await a===null;q.images[0].finishDecode();await tick();checks.lateDecodeCannotReplace=q.api.inspect().request.id==='ink-scroll';q.api.load({id:'mist'});await b;
  const save=setup({saver:true});checks.saveDataOpalDefault=save.api.read().id==='coast'&&save.requests.length===1&&save.requests[0].includes('/scenes/coast-v25-ai-960.webp');
  const reduced=setup({reducedData:true});checks.reducedDataOpalDefault=reduced.api.read().id==='coast'&&reduced.requests.length===1&&reduced.requests[0].includes('/scenes/coast-v25-ai-960.webp');
  const explicit=setup({saver:true,saved:{id:'ink-scroll',quality:'high',scroll:false}});checks.manualChoiceWins=explicit.api.read().id==='ink-scroll'&&explicit.api.read().quality==='high'&&!explicit.api.read().scroll;
  const blocked=setup({storageBlocked:true,saver:true});blocked.api.set({id:'line'});checks.blockedStorageUsable=blocked.api.read().id==='line';
  const phone=setup({width:390,height:844,dpr:3});let resolution=phone.api.resolve({id:'earthrise'});checks.coverTimesDpr=resolution.width===3840&&resolution.requiredWidth===3132;
  const desktop=setup({width:1440,height:900,dpr:1});let smaller=desktop.api.resolve({id:'earthrise'});checks.desktopSmallestAdequate=smaller.width===1920;desktop.win.innerWidth=2560;desktop.win.innerHeight=1440;desktop.win.devicePixelRatio=2;let larger=desktop.api.resolve({id:'earthrise'},smaller);checks.monitorUpgrade=larger.width===3840;desktop.win.innerWidth=800;desktop.win.innerHeight=600;desktop.win.devicePixelRatio=1;checks.resizeDoesNotThrash=desktop.api.resolve({id:'earthrise'},larger).url===larger.url;
  checks.aiSourceHonesty=phone.api.resolve({id:'mineral-scroll',quality:'high'}).width===3172&&phone.api.entry('mineral-scroll').originalWidth===793&&phone.api.entry('mineral-scroll').nativeHighResolution===false&&phone.api.entry('coast').originalWidth===1672;
  const template=fs.readFileSync(path.resolve(__dirname,'../../app/templates/_backgrounds.html'),'utf8');
  const materialVectors=['mirror-hall','tideglass','etched-metal','porcelain','leather','cork-relief','slate'];
  checks.materialVectorCatalogue=materialVectors.every(id=>r.api.entry(id).kind==='vector'&&r.api.entry(id).style===id&&r.api.source({id})===''&&template.includes("('"+id+"',"));
  checks.discardedImagesAbsent=['mirror-lake','glazed-folds','denali-dawn','cloud-facade'].every(id=>r.api.entry(id).id==='mist'&&!template.includes("('"+id+"',"));
  const low=setup({width:3840,height:2160,dpr:2,saver:true});checks.saveDataPicksSmallest=low.api.resolve({id:'earthrise'}).width===960&&low.api.resolve({id:'earthrise',quality:'high'}).width===3840;
  const before=r.images.length;const pending=r.api.load({id:'ink-scroll'});r.win.dispatchEvent({type:'pagehide'});checks.pagehideCancels=await pending===null&&r.api.inspect().retainedRequests===0&&r.images.length===before+1;
  const head=setup({head:true,saved:{id:'ink-scroll',quality:'auto',scroll:true}});checks.headNeedsNoBody=head.uiQueries===0&&head.images.length===1;checks.bootstrapUsesChosenWhitelist=head.html.dataset.backgroundBootstrap==='image'&&head.html.style.getPropertyValue('--background-bootstrap-image').includes('/static/scenes/ink-v25-ai-');const reuse=head.api.load(head.api.read());head.images[0].fire();const decoded=await reuse;checks.headAndAtmosphereShareImage=head.images.length===1&&decoded===head.images[0]&&head.decodes===1;head.api.releaseBootstrap();checks.bootstrapFullyReleased=!head.html.dataset.backgroundBootstrap&&head.styleValues.size===0;head.doc.dispatchEvent({type:'DOMContentLoaded'});checks.headMountsControlsOnDom=head.uiQueries===1;
  const kept=setup({saved:{id:'coast'}}),keptRequest=kept.api.load(kept.api.read());kept.images[0].fire();await keptRequest;kept.win.dispatchEvent({type:'pagehide',persisted:true});checks.bfcacheKeepsDecodedImage=kept.api.inspect().retainedRequests===1&&kept.api.inspect().request.ready&&!kept.images[0].cancelled;kept.win.dispatchEvent({type:'pageshow',persisted:true});const keptAgain=await kept.api.load(kept.api.read());checks.bfcacheRestoresWithoutReload=keptAgain===kept.images[0]&&kept.images.length===1&&kept.decodes===1;
  const pendingKeep=setup({saved:{id:'ink-scroll'}}),pendingKeepRequest=pendingKeep.api.load(pendingKeep.api.read());pendingKeep.win.dispatchEvent({type:'pagehide',persisted:true});checks.bfcachePendingLoadNotCancelled=pendingKeep.api.inspect().retainedRequests===1&&!pendingKeep.images[0].cancelled;pendingKeep.images[0].fire();await pendingKeepRequest;
  const failedHead=setup({head:true,saved:{id:'ink-scroll'}});failedHead.images[0].onerror();await tick();checks.failedBootstrapReleased=!failedHead.html.dataset.backgroundBootstrap&&failedHead.styleValues.size===0;
  for(const item of[r,q,save,reduced,explicit,blocked,phone,desktop,low,head,kept,pendingKeep,failedHead])item.api.destroy();checks.destroyRemovesApi=!r.win.LissBackgrounds;
  for(const [name,value]of Object.entries(checks))assert.equal(value,true,name);
  const report={passed:true,checks,requests:r.requests};console.log(JSON.stringify(report,null,2));
}
let same;run().catch(error=>{console.error(error);process.exitCode=1;});
