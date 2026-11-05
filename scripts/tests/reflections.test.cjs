/* Exercise the shipped controller. Optics/pixels are separately browser-tested. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../../app/static/community-reflections.js'),'utf8');
let assertions=0;
function check(name,condition){assert.ok(condition,name);assertions++;}
function emitter(extra={}){return Object.assign({events:new Map(),addEventListener(name,fn,options={}){if(options.signal?.aborted)return;const record={fn,once:options.once};const list=this.events.get(name)||[];list.push(record);this.events.set(name,list);options.signal?.addEventListener('abort',()=>{const i=list.indexOf(record);if(i>=0)list.splice(i,1);},{once:true});},fire(name,event={}){for(const record of [...(this.events.get(name)||[])]){record.fn(event);if(record.once){const list=this.events.get(name);list.splice(list.indexOf(record),1);}}}},extra);}
function style(){const values=new Map();return {setProperty(name,value){values.set(name,value);},removeProperty(name){values.delete(name);},getPropertyValue(name){return values.get(name)||'';}};}
function node(cls=''){return emitter({nodeType:1,className:cls,dataset:{},style:style(),children:[],isConnected:true,setAttribute(){},appendChild(child){this.children.push(child);child.parent=this;},remove(){this.isConnected=false;if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);}});}
function mount(options={}){
  let now=1000,id=0;const raf=new Map(),timers=new Map(),queries=new Map(),observers=[];
  const water=node(),mirror=node(),ordinary=node();water.dataset.material='water';mirror.dataset.material='mirror';ordinary.dataset.material='glass';
  const hosts=[water,mirror,ordinary];hosts.forEach(host=>{host.shell=node('material-shell');host.querySelector=()=>host.shell;host.getBoundingClientRect=()=>({left:0,top:0,width:500,height:250});});
  const choice={id:'coast',kind:'image',dataSaver:false};let sourceURL='http://localhost:8896/static/scenes/coast.webp';
  const scene=node();scene.style.setProperty('--scene-a','#8bbbae');scene.style.setProperty('--scene-b','#779ab5');scene.style.setProperty('--scene-c','#cfbfa1');
  const window=emitter({LissBackgrounds:{read:()=>({...choice}),source:()=>sourceURL}});
  const document=emitter({hidden:false,body:node(),documentElement:node(),baseURI:'http://localhost:8896/',querySelector:()=>scene,querySelectorAll:()=>hosts.filter(host=>host.isConnected&&['mirror','water'].includes(host.dataset.material)),createElement:()=>node()});
  function matchMedia(query){if(!queries.has(query))queries.set(query,emitter({matches:!!options[query]}));return queries.get(query);}
  class IntersectionObserver{constructor(callback){this.callback=callback;observers.push(this);}observe(target){this.callback([{target,isIntersecting:true}]);}unobserve(){}disconnect(){}}
  class MutationObserver{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){}}
  const context={window,document,matchMedia,IntersectionObserver,MutationObserver,AbortController,URL,location:{origin:'http://localhost:8896'},getComputedStyle:element=>element.style,performance:{now:()=>now},requestAnimationFrame:fn=>{const key=++id;raf.set(key,fn);return key;},cancelAnimationFrame:key=>raf.delete(key),setTimeout:(fn,delay)=>{const key=++id;timers.set(key,{fn,time:now+delay});return key;},clearTimeout:key=>timers.delete(key)};
  const run=()=>vm.runInNewContext(source,context,{filename:'community-reflections.js'});run();
  const flush=()=>{let n=0;while(raf.size){const batch=[...raf];raf.clear();batch.forEach(([,fn])=>fn(now));if(++n>150)throw Error('Controller did not settle');}return n;};
  const pointer=(host,x,y,pressed=false)=>host.fire(pressed?'pointerdown':'pointermove',{clientX:x,clientY:y,pointerType:'mouse'});
  function advance(ms){now+=ms;for(const [key,item]of [...timers])if(item.time<=now){timers.delete(key);item.fn();}}
  const preference=(query,matches)=>{const target=matchMedia(query);target.matches=matches;target.fire('change');};
  return {window,document,water,mirror,ordinary,choice,scene,queries,raf,timers,observers,flush,pointer,advance,preference,run,setURL(value){sourceURL=value;},inspect:()=>window.__lissCommunityReflections.inspect()};
}
const app=mount();
check('mounts only the two opt-in surfaces',app.inspect().mounted===2&&app.ordinary.shell.children.length===0);
check('mounts exactly three inert optical leaves per surface',app.water.shell.children.length===3&&app.mirror.shell.children.length===3);
check('uses the same-origin selected scene',app.water.dataset.opticalImage==='true'&&app.water.shell.style.getPropertyValue('--optical-scene-image').includes('/static/scenes/coast.webp'));
check('idle mount has no render loop',app.raf.size===0);
app.pointer(app.mirror,450,200);app.flush();
check('mirror reflection responds without moving the host',parseFloat(app.mirror.shell.style.getPropertyValue('--optical-x'))>10&&!app.mirror.style.getPropertyValue('transform'));
check('pointer easing reaches an idle state',app.raf.size===0);
app.mirror.fire('pointerleave');app.flush();
check('mirror reflection returns to rest on leave',app.mirror.shell.style.getPropertyValue('--optical-x')==='0.00px');
app.pointer(app.water,40,60);app.flush();
check('water pointer creates a ripple',app.inspect().activeRipples===1);
check('moving water has a restrained optical impulse',app.water.shell.children[2].children[0].style.getPropertyValue('--ripple-force')==='.5'&&app.water.shell.children[2].children[0].style.getPropertyValue('--ripple-size')==='152px');
app.pointer(app.water,40,60,true);app.flush();
check('pressing water creates a stronger optical impulse',app.water.shell.children[2].children.at(-1).style.getPropertyValue('--ripple-force')==='.84'&&app.water.shell.children[2].children.at(-1).style.getPropertyValue('--ripple-size')==='198px');
app.advance(250);app.pointer(app.water,44,62);app.flush();
check('time throttle suppresses near stationary ripples',app.inspect().activeRipples===2);
app.advance(100);
app.pointer(app.water,240,110);app.flush();
check('distant pointer travel replaces oldest ripple',app.inspect().activeRipples===2&&app.timers.size===2);
app.advance(350);app.pointer(app.water,242,111);app.flush();
check('travel threshold suppresses tiny movement after throttle',app.inspect().activeRipples===2);
for(let i=0;i<9;i++){app.pointer(app.water,50+i*30,90,true);app.flush();}
check('a long gesture keeps at most two live ripples',app.inspect().activeRipples===2&&app.water.shell.children[2].children.length===2&&app.timers.size===2);
app.water.shell.children[2].children[0].fire('animationend',{pseudoElement:''});
check('the outer ring ending keeps the later rings alive',app.inspect().activeRipples===2&&app.timers.size===2);
app.water.shell.children[2].children[0].fire('animationend',{pseudoElement:'::after'});
check('animation completion frees ripple and timer',app.inspect().activeRipples===1&&app.timers.size===1);
app.advance(2000);
check('bounded timeout also cleans cancelled animations',app.inspect().activeRipples===0&&app.timers.size===0);
app.pointer(app.water,130,120,true);app.preference('(prefers-reduced-motion: reduce)',true);app.flush();
check('reduced motion clears existing rings and cancels pointer work',app.inspect().activeRipples===0&&app.water.shell.style.getPropertyValue('--optical-x')==='0.00px');
app.pointer(app.water,400,200,true);check('reduced motion prevents new impulses',app.inspect().activeRipples===0&&app.raf.size===0);
app.preference('(prefers-reduced-motion: reduce)',false);app.flush();app.preference('(pointer: coarse)',true);app.flush();app.pointer(app.water,400,200,true);
check('coarse pointer keeps static surfaces',app.inspect().activeRipples===0&&app.raf.size===0);
app.preference('(pointer: coarse)',false);app.flush();app.preference('(forced-colors: active)',true);app.flush();app.pointer(app.water,400,200,true);
check('forced colors avoids decorative impulse work',app.inspect().activeRipples===0&&app.raf.size===0);
app.preference('(forced-colors: active)',false);app.flush();app.pointer(app.water,300,200,true);app.document.hidden=true;app.document.fire('visibilitychange');
check('hidden page stops and releases active impulses',app.inspect().activeRipples===0&&app.raf.size===0);
app.document.hidden=false;app.document.fire('visibilitychange');app.flush();
app.setURL('https://untrusted.invalid/scene.png');app.window.fire('liss:background-change');app.flush();
check('cross-origin image is never used as a reflection',app.inspect().environment==='sky'&&app.water.dataset.opticalImage==='false');
app.setURL('http://localhost:8896/static/scenes/ink.webp');app.window.fire('liss:background-change');app.flush();app.window.fire('liss:background-status',{detail:{id:'coast',state:'unavailable'}});app.flush();
check('failed environment drops to native sky instead of broken image',app.inspect().environment==='sky');
app.window.fire('liss:background-status',{detail:{id:'coast',state:'ready'}});app.flush();
check('successful image retry restores the selected scene',app.inspect().environment==='scene-image');
app.choice.kind='vector';app.window.fire('liss:background-change');app.flush();
check('procedural scene contributes its selected palette',app.water.shell.style.getPropertyValue('--optical-scene-a')==='#8bbbae'&&app.water.dataset.opticalImage==='false');
app.choice.kind='image';app.choice.dataSaver=true;app.window.fire('liss:background-change');app.flush();
check('data saver keeps native sky without replaying image',app.inspect().environment==='sky');
app.window.fire('pagehide');app.pointer(app.water,200,200,true);
check('pagehide suspends work without breaking bfcache',app.inspect().suspended&&app.inspect().activeRipples===0);
app.window.fire('pageshow');app.flush();check('pageshow resumes idempotently',!app.inspect().suspended&&app.inspect().mounted===2&&app.water.shell.children.length===3);
const mutation=app.observers.find(observer=>observer.constructor.name==='MutationObserver');
app.water.dataset.material='glass';mutation.callback([{type:'attributes',attributeName:'data-material'}]);app.flush();
check('changing back to a prior material removes optical leaves and metadata',app.inspect().mounted===1&&app.water.shell.children.length===0&&!app.water.dataset.optics);
app.water.dataset.material='water';mutation.callback([{type:'attributes',attributeName:'data-material'}]);app.flush();check('appearance preview remounts the new material once',app.inspect().mounted===2&&app.water.shell.children.length===3);
app.mirror.isConnected=false;mutation.callback([{type:'childList',addedNodes:[],removedNodes:[app.mirror]}]);app.flush();
check('removed host releases leaves and state',app.inspect().mounted===1&&app.mirror.shell.children.length===0);
app.run();check('controller replacement disposes its previous leaves',app.inspect().mounted===1&&app.water.shell.children.length===3);
app.pointer(app.water,250,200,true);app.window.__lissCommunityReflections.destroy();
check('destroy cleans rings, callbacks, leaves and public handle',!app.window.__lissCommunityReflections&&app.water.shell.children.length===0&&app.raf.size===0&&app.timers.size===0);
console.log(JSON.stringify({passed:true,assertions,limits:'VM lifecycle and interaction coverage; rendered appearance requires browser verification.'}));
