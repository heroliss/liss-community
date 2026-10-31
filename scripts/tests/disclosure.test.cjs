// Deterministic controller scenarios. This does not emulate native layout,
// rendering or accessibility and is supplemented by the documented browser acceptance checks.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const repo=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(repo,'app/static/community-disclosure.js'),'utf8');
class Hub{
  constructor(){this.listeners={};}
  addEventListener(t,fn,o={}){(this.listeners[t]??=[]).push({fn,o});}
  dispatchEvent(e){e.target??=this;for(const l of this.listeners[e.type]||[])if(!l.o.signal?.aborted)l.fn(e);return!e.defaultPrevented;}
}
function fixture({open=false,animate=true}={}){
  const observers=[];
  class Node extends Hub{
    constructor(tag){super();this.tagName=tag.toUpperCase();this.attrs={};this.dataset={};this.nodes=[];this.className='';const v={};this.style={getPropertyValue:k=>v[k]||'',getPropertyPriority:()=>'',setProperty:(k,x)=>v[k]=x,removeProperty:k=>delete v[k]};}
    setAttribute(k,v){this.attrs[k]=String(v);} removeAttribute(k){delete this.attrs[k];} hasAttribute(k){return k in this.attrs;}
    appendChild(n){this.nodes.push(n);n.parent=this;return n;} remove(){this.parent.nodes=this.parent.nodes.filter(n=>n!==this);}
    contains(n){return n===this||this.nodes.some(x=>x.contains(n));} closest(){return null;}
    focus(){doc.activeElement=this;this.focused=true;root.dispatchEvent({type:'focusin',target:this});}
  }
  const root=new Node('details'),summary=root.appendChild(new Node('summary')),body=root.appendChild(new Node('div')),input=body.appendChild(new Node('textarea'));
  root.id='write';let actualOpen=open;
  Object.defineProperty(root,'open',{get:()=>actualOpen,set:v=>{const changed=actualOpen!==!!v;actualOpen=!!v;if(changed)for(const o of observers)if(o.nodes.includes(root))o.pending=true;}});
  root.querySelector=s=>s===':scope>summary'?summary:s===':scope>.composer-content'?body:null;
  body.current=null;body.natural=1000;body.animations=[];
  const used=k=>body.current?.[k]??body.style.getPropertyValue(k.replace(/[A-Z]/g,x=>'-'+x.toLowerCase()))??'';
  body.getBoundingClientRect=()=>({height:!root.open?0:Math.max(parseFloat(used('height'))||body.natural,parseFloat(used('paddingTop'))||0)+0});
  if(animate)body.animate=(frames,options)=>{
    body.current={...frames[0]};const a={frames,options,cancelled:false,onfinish:null,oncancel:null,cancel(){this.cancelled=true;body.current=null;},at(height,paddingTop=30,paddingBottom=27){body.current={height:height+'px',paddingTop:paddingTop+'px',paddingBottom:paddingBottom+'px'};},finish(){body.current={...frames.at(-1)};this.onfinish?.();}};body.animations.push(a);return a;
  };
  const doc=new Hub();doc.hidden=false;doc.activeElement=null;doc.documentElement=new Node('html');doc.querySelectorAll=()=>[root];doc.createElement=t=>new Node(t);
  const win=new Hub(),reduce=new Hub();reduce.matches=false;
  class Observer{constructor(cb){this.cb=cb;this.nodes=[];this.pending=false;observers.push(this);}observe(n){this.nodes.push(n);}disconnect(){this.nodes=[];this.pending=false;}}
  function flush(){let count=0;while(observers.some(o=>o.pending)){assert(++count<10,'mutation observer remains finite');for(const o of observers){if(o.pending){o.pending=false;o.cb([]);}}}}
  const context={window:win,document:doc,matchMedia:()=>reduce,MutationObserver:Observer,AbortController,CustomEvent:class{constructor(type,o={}){this.type=type;Object.assign(this,o);}},getComputedStyle:()=>({height:body.current?.height||body.style.getPropertyValue('height')||'auto',paddingTop:body.current?.paddingTop||body.style.getPropertyValue('padding-top')||'30px',paddingBottom:body.current?.paddingBottom||body.style.getPropertyValue('padding-bottom')||'27px'}),requestAnimationFrame(){throw Error('No RAF is expected');}};
  vm.runInNewContext(source,context,{filename:'community-disclosure.js'});
  const inspect=()=>win.__lissCommunityDisclosure.inspect().states[0];
  function click(extra={}){const e={type:'click',button:0,target:summary,preventDefault(){this.defaultPrevented=true;},...extra};summary.dispatchEvent(e);flush();return e;}
  return{root,summary,body,input,doc,win,reduce,flush,inspect,click,animation:()=>body.animations.at(-1),notify:()=>root.dispatchEvent({type:'toggle',target:root})};
}
const passed=[];function test(name,fn){fn();passed.push(name);}
test('native closed state is preserved at mount',()=>{let f=fixture();assert(!f.root.open);assert.equal(f.body.animations.length,0);});
test('server validation open state is not replayed',()=>{let f=fixture({open:true});assert(f.root.open);assert.equal(f.body.animations.length,0);});
test('summary opens from zero and restores inline styles',()=>{let f=fixture();assert(f.click().defaultPrevented);let a=f.animation();assert.equal(a.frames[0].height,'0px');assert.equal(a.frames[0].paddingTop,'0px');assert.equal(a.frames[1].height,'1000px');a.finish();assert.equal(f.inspect().phase,'idle');assert.equal(f.body.style.getPropertyValue('height'),'');assert(f.root.open);});
test('quick reverse starts from visible sampled height',()=>{let f=fixture();f.click();let first=f.animation();first.at(340,14,12);f.click();assert(first.cancelled);assert.equal(f.animation().frames[0].height,'340px');assert.equal(f.animation().frames[1].height,'0px');assert(f.body.hasAttribute('inert'));f.animation().finish();assert(!f.root.open);assert(!f.body.hasAttribute('inert'));});
test('navigation .open then synchronous liss:write still animates',()=>{let f=fixture();f.root.open=true;f.doc.dispatchEvent({type:'liss:write',detail:{target:f.root}});f.flush();assert.equal(f.animation().frames[0].height,'0px');assert.equal(f.inspect().phase,'opening');});
test('external .open mutation animates before native toggle',()=>{let f=fixture();f.root.open=true;f.flush();assert.equal(f.animation().frames[0].height,'0px');f.notify();assert.equal(f.body.animations.length,1);});
test('external close reopens briefly for finite reveal then closes',()=>{let f=fixture({open:true});f.root.open=false;f.flush();assert(f.root.open);assert.equal(f.animation().frames[0].height,'1000px');assert.equal(f.inspect().phase,'closing');f.notify();assert.equal(f.body.animations.length,1);f.animation().finish();f.flush();assert(!f.root.open);assert.equal(f.inspect().phase,'idle');});
test('opening interrupts close at its current height',()=>{let f=fixture({open:true});f.click();f.animation().at(440,15,14);f.click();assert.equal(f.animation().frames[0].height,'440px');assert.equal(f.animation().frames[1].height,'1000px');assert(!f.body.hasAttribute('inert'));});
test('pause finishes to the requested final state',()=>{let f=fixture();f.click();f.doc.documentElement.dataset.roomMotion='paused';f.win.dispatchEvent({type:'liss:motion-state'});assert(f.root.open);assert(!f.inspect().animating);assert.equal(f.body.style.getPropertyValue('overflow'),'');});
test('pause reconciles external close before observer microtask',()=>{let f=fixture({open:true});f.root.open=false;f.doc.documentElement.dataset.roomMotion='paused';f.win.dispatchEvent({type:'liss:motion-state'});assert(!f.root.open);assert.equal(f.inspect().target,false);f.flush();assert(!f.root.open);});
test('resize reconciles external close during reveal',()=>{let f=fixture();f.click();f.animation().at(320);f.root.open=false;f.win.dispatchEvent({type:'resize'});assert(!f.root.open);assert(!f.inspect().animating);f.flush();assert(!f.root.open);});
test('resize reconciles external open before observer microtask',()=>{let f=fixture();f.root.open=true;f.win.dispatchEvent({type:'resize'});assert(f.root.open);assert.equal(f.inspect().target,true);assert(!f.inspect().animating);});
test('reduced motion has immediate native end state',()=>{let f=fixture();f.reduce.matches=true;f.click();assert(f.root.open);assert.equal(f.body.animations.length,0);});
test('real editor focus event settles without initiating focus',()=>{let f=fixture();f.click();f.doc.dispatchEvent({type:'liss:write-focus',detail:{target:f.root}});assert(!f.inspect().animating);assert.equal(f.doc.activeElement,null);});
test('content focus removes clipping immediately',()=>{let f=fixture();f.click();f.root.dispatchEvent({type:'focusin',target:f.input});assert(!f.inspect().animating);assert.equal(f.body.style.getPropertyValue('overflow'),'');});
test('collapse returns focus from content to its summary',()=>{let f=fixture({open:true});f.doc.activeElement=f.input;f.click();assert.equal(f.doc.activeElement,f.summary);});
test('modified click and nested action are preserved',()=>{let f=fixture();assert(!f.click({ctrlKey:true}).defaultPrevented);assert(!f.root.open);let action={contains:n=>n===action};f.summary.appendChild(action);assert(!f.click({target:{closest:()=>action}}).defaultPrevented);assert(!f.root.open);});
test('unsupported animation leaves native click unhandled',()=>{let f=fixture({animate:false});assert(!f.click().defaultPrevented);assert(!f.root.open);f.root.open=true;f.flush();assert(f.root.open);});
test('destroy removes decorations and transient state',()=>{let f=fixture();f.click();f.win.__lissCommunityDisclosure.destroy();assert.equal(f.summary.nodes.length,0);assert.equal(f.body.style.getPropertyValue('height'),'');assert(!f.body.hasAttribute('inert'));assert(f.root.open);});
test('pagehide followed by destroy is idempotent',()=>{let f=fixture();f.click();let events=0;f.doc.addEventListener('liss:depth-content',()=>events++);f.win.dispatchEvent({type:'pagehide'});assert.equal(events,1);f.win.__lissCommunityDisclosure.destroy();assert.equal(events,1);assert.equal(f.summary.nodes.length,0);});
test('BFCache remount disposes old scope once',()=>{let f=fixture();f.click();let events=0;f.doc.addEventListener('liss:depth-content',()=>events++);f.win.dispatchEvent({type:'pagehide'});f.win.dispatchEvent({type:'pageshow',persisted:true});assert.equal(events,1);assert.equal(f.summary.nodes.length,2);assert(f.inspect().open);});
test('opening has intentional 420 ms floor and 760 ms cap',()=>{let f=fixture();f.body.natural=150;f.click();assert.equal(f.animation().options.duration,420);f.animation().finish();f.click();f.animation().finish();f.body.natural=2400;f.click();assert.equal(f.animation().options.duration,760);});
test('normal 1000 px reveal uses 550 ms opening and 450 ms closing',()=>{let f=fixture();f.click();assert.equal(f.animation().options.duration,550);f.animation().finish();f.click();assert.equal(f.animation().options.duration,450);});
test('closing floor and cap remain bounded after interruption',()=>{let f=fixture({open:true});f.body.natural=2400;f.click();assert.equal(f.animation().options.duration,560);f.animation().at(100,4,3);f.click();f.animation().at(100,4,3);f.click();assert.equal(f.animation().options.duration,320);});
const result={passed:true,count:passed.length,scenarios:passed,scope:'Deterministic VM controller scenarios only; real browser layout and animation acceptance remain required.'};
console.log(JSON.stringify(result,null,2));
