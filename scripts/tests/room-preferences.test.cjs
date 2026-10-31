// Runs the actual preferences controller. DOM layout, native BFCache and visual
// motion require browser acceptance; this checks preference and scope ownership.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
require('node:events').setMaxListeners(0);
const source=fs.readFileSync(path.resolve(__dirname,'../../app/static/community-room.js'),'utf8');
class Bus{
  constructor(){this.events=new Map();}
  addEventListener(type,fn,options={}){
    if(options.signal?.aborted)return;
    if(!this.events.has(type))this.events.set(type,new Set());
    const listeners=this.events.get(type);listeners.add(fn);
    options.signal?.addEventListener('abort',()=>listeners.delete(fn),{once:true});
  }
  dispatchEvent(event){for(const fn of [...(this.events.get(event.type)||[])])fn(event);}
  count(type){return this.events.get(type)?.size||0;}
}
class Node extends Bus{
  constructor(){super();this.dataset={};this.attrs=new Map();}
  setAttribute(name,value){this.attrs.set(name,String(value));}
  getAttribute(name){return this.attrs.get(name)??null;}
  removeAttribute(name){this.attrs.delete(name);}
  querySelector(){return null;}
}
function fixture({controls=0,stored=null,reduced=false,storageThrows=false}={}){
  const window=new Bus(),html=new Node(),reduce=new Bus(),observers=[],events=[],meta={content:''};
  reduce.matches=reduced;
  const buttons=Array.from({length:controls},()=>{
    const button=new Node(),icon=new Node(),iconPath=new Node(),label={textContent:''};
    button.hidden=true;button.icon=icon;button.iconPath=iconPath;button.label=label;
    icon.querySelector=selector=>selector==='path'?iconPath:null;
    button.querySelector=selector=>selector==='svg'?icon:selector==='[data-room-motion-label]'?label:null;
    return button;
  });
  const pending={textContent:'发布中'},form=new Node();form.setAttribute('aria-busy','true');form.querySelector=selector=>selector==='.form-pending'?pending:null;
  const document={documentElement:html,getElementById:id=>id==='theme-color'?meta:null,querySelectorAll:selector=>selector==='[data-room-motion-toggle]'?buttons:selector==='form[aria-busy]'&&form.attrs.has('aria-busy')?[form]:[]};
  const storage=new Map(stored===null?[]:[['liss-room-motion',stored]]),access={reads:0,writes:0};
  const localStorage={getItem(key){access.reads++;if(storageThrows)throw new Error('storage unavailable');return storage.get(key)??null;},setItem(key,value){access.writes++;if(storageThrows)throw new Error('storage unavailable');storage.set(key,String(value));}};
  class Observer{
    constructor(fn){this.fn=fn;this.active=false;observers.push(this);}
    observe(){this.active=true;}
    disconnect(){this.active=false;}
  }
  window.addEventListener('liss:motion-state',event=>events.push(JSON.parse(JSON.stringify(event.detail))));
  const context=vm.createContext({window,document,localStorage,AbortController,MutationObserver:Observer,matchMedia:()=>reduce,getComputedStyle:()=>({getPropertyValue:()=> ' #123456 '}),CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}}});
  const mount=()=>vm.runInContext(source,context,{filename:'community-room.js'});mount();
  return{window,html,reduce,buttons,storage,access,observers,events,meta,form,pending,mount,activeObservers:()=>observers.filter(observer=>observer.active).length,setReduced(value){reduce.matches=value;reduce.dispatchEvent({type:'change'});},storageEvent(value,key='liss-room-motion'){window.dispatchEvent({type:'storage',key,newValue:value});}};
}
const scenarios=[];
function test(name,fn){fn();scenarios.push(name);}
test('pages without controls ignore stale manual pause without changing storage',()=>{
  const f=fixture({stored:'paused'});assert.equal(f.html.dataset.roomMotion,'ready');assert.equal(f.access.reads,0);assert.equal(f.access.writes,0);assert.equal(f.storage.get('liss-room-motion'),'paused');assert.deepEqual(f.events.at(-1),{paused:false,reduced:false,blocked:false});
});
test('pages without controls initialize ordinary state and restore pending forms',()=>{
  const f=fixture();assert.equal(f.html.dataset.roomMotion,'ready');assert.equal(f.form.getAttribute('aria-busy'),null);assert.equal(f.pending.textContent,'');assert.equal(f.meta.content,'#123456');assert.equal(f.activeObservers(),1);
});
test('pages without controls follow initial system reduction and subsequent changes',()=>{
  const f=fixture({stored:'paused',reduced:true});assert.equal(f.html.dataset.roomMotion,'paused');assert.deepEqual(f.events.at(-1),{paused:false,reduced:true,blocked:true});f.setReduced(false);assert.equal(f.html.dataset.roomMotion,'ready');f.setReduced(true);assert.equal(f.html.dataset.roomMotion,'paused');assert.equal(f.access.writes,0);
});
test('pages without controls ignore pause and ready storage events',()=>{
  const f=fixture();f.storageEvent('paused');assert.equal(f.html.dataset.roomMotion,'ready');assert.equal(f.events.at(-1).paused,false);f.setReduced(true);f.storageEvent('ready');assert.equal(f.html.dataset.roomMotion,'paused');assert.deepEqual(f.events.at(-1),{paused:false,reduced:true,blocked:true});const count=f.events.length;f.storageEvent('paused','unrelated');assert.equal(f.events.length,count);
});
test('legacy controls preserve stored pause and synchronized labels',()=>{
  const f=fixture({controls:2,stored:'paused'});assert.equal(f.html.dataset.roomMotion,'paused');assert.equal(f.access.reads,1);for(const button of f.buttons){assert.equal(button.hidden,false);assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(button.getAttribute('aria-label'),'继续动效');assert.equal(button.label.textContent,'继续动效');assert.equal(button.icon.dataset.motionIcon,'play');}f.buttons[0].dispatchEvent({type:'click'});assert.equal(f.html.dataset.roomMotion,'ready');assert.equal(f.storage.get('liss-room-motion'),'ready');assert.equal(f.access.writes,1);assert(f.buttons.every(button=>button.getAttribute('aria-pressed')==='false'&&button.icon.dataset.motionIcon==='pause'));f.buttons[1].dispatchEvent({type:'click'});assert.equal(f.html.dataset.roomMotion,'paused');assert.equal(f.storage.get('liss-room-motion'),'paused');assert.equal(f.access.writes,2);
});
test('legacy controls follow cross-tab storage events without writing back',()=>{
  const f=fixture({controls:1});f.storageEvent('paused');assert.equal(f.html.dataset.roomMotion,'paused');assert.equal(f.buttons[0].label.textContent,'继续动效');f.storageEvent('ready');assert.equal(f.html.dataset.roomMotion,'ready');assert.equal(f.buttons[0].label.textContent,'暂停动效');f.storageEvent(null);assert.equal(f.html.dataset.roomMotion,'ready');assert.equal(f.access.writes,0);
});
test('system reduction disables legacy controls while preserving manual preference',()=>{
  const f=fixture({controls:1,stored:'paused',reduced:true}),button=f.buttons[0];assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-label'),'已遵循系统减少动态设置');assert.equal(button.label.textContent,'已减少动态');f.setReduced(false);assert.equal(button.disabled,false);assert.equal(f.html.dataset.roomMotion,'paused');f.storageEvent('ready');assert.equal(f.html.dataset.roomMotion,'ready');f.setReduced(true);assert.equal(f.html.dataset.roomMotion,'paused');assert.deepEqual(f.events.at(-1),{paused:false,reduced:true,blocked:true});
});
test('unavailable storage retains working preference controls',()=>{
  const f=fixture({controls:1,storageThrows:true});assert.equal(f.html.dataset.roomMotion,'ready');f.buttons[0].dispatchEvent({type:'click'});assert.equal(f.html.dataset.roomMotion,'paused');assert.equal(f.access.writes,1);
});
test('destroy releases preference listeners, observer and lifetime ownership',()=>{
  const f=fixture({controls:1}),controller=f.window.__lissRoomPreferences;controller.destroy();controller.destroy();assert.equal(f.window.__lissRoomPreferences,undefined);assert.equal(f.activeObservers(),0);assert.equal(f.window.count('storage'),0);assert.equal(f.window.count('pagehide'),0);assert.equal(f.window.count('pageshow'),0);assert.equal(f.reduce.count('change'),0);assert.equal(f.buttons[0].count('click'),0);const count=f.events.length;f.buttons[0].dispatchEvent({type:'click'});f.setReduced(true);f.storageEvent('paused');f.window.dispatchEvent({type:'pageshow',persisted:true});assert.equal(f.events.length,count);assert.equal(f.access.writes,0);
});
test('repeated script mount replaces prior scope with one live owner',()=>{
  const f=fixture({controls:1}),previous=f.window.__lissRoomPreferences;f.mount();assert.notEqual(f.window.__lissRoomPreferences,previous);assert.equal(f.activeObservers(),1);assert.equal(f.observers.length,2);assert.equal(f.window.count('storage'),1);assert.equal(f.window.count('pagehide'),1);assert.equal(f.window.count('pageshow'),1);assert.equal(f.reduce.count('change'),1);assert.equal(f.buttons[0].count('click'),1);const count=f.events.length;f.buttons[0].dispatchEvent({type:'click'});assert.equal(f.events.length,count+1);assert.equal(f.access.writes,1);assert.equal(f.html.dataset.roomMotion,'paused');
});
test('pagehide disposes work and persisted pageshow remounts current system state',()=>{
  const f=fixture({stored:'paused'});f.window.dispatchEvent({type:'pagehide'});f.window.dispatchEvent({type:'pagehide'});assert.equal(f.activeObservers(),0);assert.equal(f.window.count('storage'),0);assert.equal(f.reduce.count('change'),0);assert.equal(f.window.count('pageshow'),1);const count=f.events.length;f.setReduced(true);f.storageEvent('paused');assert.equal(f.events.length,count);f.window.dispatchEvent({type:'pageshow',persisted:false});assert.equal(f.activeObservers(),0);f.window.dispatchEvent({type:'pageshow',persisted:true});assert.equal(f.activeObservers(),1);assert.equal(f.html.dataset.roomMotion,'paused');assert.deepEqual(f.events.at(-1),{paused:false,reduced:true,blocked:true});f.setReduced(false);assert.equal(f.html.dataset.roomMotion,'ready');f.window.dispatchEvent({type:'pageshow',persisted:true});assert.equal(f.activeObservers(),1);assert.equal(f.reduce.count('change'),1);assert.equal(f.window.count('storage'),1);f.window.__lissRoomPreferences.destroy();assert.equal(f.activeObservers(),0);
});
test('BFCache remount re-reads legacy preference with one live click handler',()=>{
  const f=fixture({controls:1});f.window.dispatchEvent({type:'pagehide'});f.storage.set('liss-room-motion','paused');f.window.dispatchEvent({type:'pageshow',persisted:true});assert.equal(f.html.dataset.roomMotion,'paused');assert.equal(f.buttons[0].count('click'),1);f.buttons[0].dispatchEvent({type:'click'});assert.equal(f.html.dataset.roomMotion,'ready');assert.equal(f.access.writes,1);assert.equal(f.activeObservers(),1);
});
console.log(JSON.stringify({passed:true,count:scenarios.length,scenarios,scope:'Actual room preference controller in a VM; state, storage and lifecycle only. Native BFCache, layout and visual motion require browser acceptance.'},null,2));
