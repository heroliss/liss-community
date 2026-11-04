/* Run the real picker controller against a small event/DOM fixture.
   Browser layout, native dialog behavior and actual image requests are checked in CUA. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
require('node:events').setMaxListeners(0);
const STATIC=path.resolve(__dirname,'../../app/static');
const PICKER_TEMPLATE=fs.readFileSync(path.resolve(__dirname,'../../app/templates/_backgrounds.html'),'utf8');
const FILTER_KINDS=[...PICKER_TEMPLATE.matchAll(/data-background-filter="([^"]+)"/g)].map(match=>match[1]);

class Bus {
  constructor(){this.events=new Map();}
  addEventListener(type,fn,options={}){if(options.signal?.aborted)return;const group=this.events.get(type)||new Set();group.add(fn);this.events.set(type,group);if(options.signal)options.signal.addEventListener('abort',()=>group.delete(fn),{once:true});}
  removeEventListener(type,fn){this.events.get(type)?.delete(fn);}
  dispatchEvent(event){event.target ||= this;event.currentTarget=this;event.preventDefault ||= function(){this.defaultPrevented=true;};event.stopPropagation ||= function(){this.stopped=true;};for(const fn of [...(this.events.get(event.type)||[])])fn(event);if(event.bubbles&&!event.stopped&&this.parentElement)this.parentElement.dispatchEvent(event);return !event.defaultPrevented;}
}
class CustomEvent {constructor(type,options={}){this.type=type;Object.assign(this,options);this.defaultPrevented=false;}}
function attributeName(key){return 'data-'+key.replace(/[A-Z]/g,m=>'-'+m.toLowerCase());}
function matchesSimple(node,selector){
  if(!node.tagName)return false;
  const not=[];selector=selector.replace(/:not\(([^)]+)\)/g,(_,s)=>{not.push(s);return '';});
  if(not.some(s=>matches(node,s)))return false;
  if(selector.includes(':checked')){if(!node.checked)return false;selector=selector.replace(':checked','');}
  if(selector.includes(':disabled')){if(!node.disabled)return false;selector=selector.replace(':disabled','');}
  const tag=selector.match(/^[a-z][\w-]*/i);if(tag&&node.tagName!==tag[0].toUpperCase())return false;
  for(const item of selector.matchAll(/#([\w-]+)|\.([\w-]+)/g)){if(item[1]&&node.id!==item[1])return false;if(item[2]&&!node.classList.contains(item[2]))return false;}
  for(const item of selector.matchAll(/\[([^\]\s=]+)(?:\s*([*^$]?=)\s*["']?([^\]"']*)["']?)?\]/g)){
    const value=node.getAttribute(item[1]);if(value===null)return false;
    if(item[2]==='='&&value!==item[3])return false;
    if(item[2]==='*='&&!value.includes(item[3]))return false;
    if(item[2]==='^='&&!value.startsWith(item[3]))return false;
    if(item[2]==='$='&&!value.endsWith(item[3]))return false;
  }
  return true;
}
function matches(node,selector){return selector.split(',').some(part=>{const pieces=part.trim().split(/\s+(?![^[]*\])/);let current=node;if(!matchesSimple(current,pieces.pop()))return false;while(pieces.length){const target=pieces.pop();current=current.parentElement;while(current&&!matchesSimple(current,target))current=current.parentElement;if(!current)return false;}return true;});}
class Element extends Bus {
  constructor(tag,doc){super();this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.parentElement=null;this.children=[];this.attributes=new Map();this._text='';this.value='';this.checked=false;this.disabled=false;this.scrollTop=0;this.dataset=new Proxy({}, {get:(_,key)=>this.getAttribute(attributeName(String(key)))??undefined,set:(_,key,value)=>{this.setAttribute(attributeName(String(key)),value);return true;},deleteProperty:(_,key)=>{this.removeAttribute(attributeName(String(key)));return true;}});const properties=new Map();this.style=new Proxy({setProperty:(k,v)=>properties.set(k,String(v)),getPropertyValue:k=>properties.get(k)||'',removeProperty:k=>properties.delete(k)},{get:(obj,k)=>k in obj?obj[k]:properties.get(k)||'',set:(_,k,v)=>{properties.set(k,String(v));return true;}});this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(' ');},remove:(...names)=>{this.className=this.className.split(/\s+/).filter(x=>!names.includes(x)).join(' ');},toggle:(name,force)=>{const on=force===undefined?!this.classList.contains(name):force;if(on)this.classList.add(name);else this.classList.remove(name);return on;}};}
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='value')this.value=String(value);if(name==='name')this.name=String(value);if(name==='type')this.type=String(value);}
  getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):null;}
  hasAttribute(name){return this.attributes.has(name);}
  removeAttribute(name){this.attributes.delete(name);}
  toggleAttribute(name,force){const on=force===undefined?!this.hasAttribute(name):force;if(on)this.setAttribute(name,'');else this.removeAttribute(name);return on;}
  get id(){return this.getAttribute('id')||'';}set id(v){this.setAttribute('id',v);}
  get name(){return this.attributes.get('name')||'';}set name(v){this.attributes.set('name',String(v));}
  get type(){return this.attributes.get('type')||'';}set type(v){this.attributes.set('type',String(v));}
  get value(){return this.type==='radio'||this.type==='checkbox'?this.attributes.get('value')??'on':this._value??'';}set value(v){this._value=String(v);if(this.type==='radio'||this.type==='checkbox')this.attributes.set('value',String(v));}
  get src(){return this.attributes.get('src')||'';}set src(v){this.attributes.set('src',String(v));}
  get className(){return this.getAttribute('class')||'';}set className(v){this.setAttribute('class',v);}
  get hidden(){return this.hasAttribute('hidden');}set hidden(v){this.toggleAttribute('hidden',!!v);}
  get inert(){return this.hasAttribute('inert');}set inert(v){this.toggleAttribute('inert',!!v);}
  get open(){return this.hasAttribute('open');}set open(v){this.toggleAttribute('open',!!v);}
  get isConnected(){let node=this;while(node){if(node===this.ownerDocument?.documentElement)return true;node=node.parentElement;}return false;}
  get isContentEditable(){return this.getAttribute('contenteditable')==='true';}
  get textContent(){return this._text+this.children.map(x=>x.textContent||'').join('');}set textContent(v){this._text=String(v??'');this.children=[];}
  get innerHTML(){return this.textContent;}set innerHTML(v){this.textContent=v;}
  appendChild(node){if(node.parentElement)node.remove();node.parentElement=this;this.children.push(node);return node;}
  append(...nodes){for(const node of nodes)this.appendChild(typeof node==='string'?this.ownerDocument.createTextNode(node):node);}
  replaceChildren(...nodes){this.children.forEach(node=>node.parentElement=null);this.children=[];this._text='';this.append(...nodes);}
  remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=null;}}
  contains(node){return node===this||this.children.some(x=>x.contains?.(node));}
  matches(selector){return matches(this,selector);}
  closest(selector){let node=this;while(node){if(node.matches?.(selector))return node;node=node.parentElement;}return null;}
  querySelectorAll(selector){const result=[];for(const child of this.children){if(child.matches?.(selector))result.push(child);result.push(...(child.querySelectorAll?.(selector)||[]));}return result;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  focus(){this.ownerDocument.activeElement=this;}
  getBoundingClientRect(){return{left:100,top:60,right:1100,bottom:800,width:1000,height:740};}
  scrollIntoView(){}
  showModal(){this.open=true;this.focus();}
  close(){this.open=false;this.dispatchEvent(new CustomEvent('close'));}
  click(){if(this.disabled)return;if(this.type==='radio'){for(const radio of this.ownerDocument.querySelectorAll('input[type=radio]'))if(radio.name===this.name)radio.checked=false;this.checked=true;this.dispatchEvent(new CustomEvent('change',{bubbles:true}));}else if(this.type==='checkbox'){this.checked=!this.checked;this.dispatchEvent(new CustomEvent('change',{bubbles:true}));}this.dispatchEvent(new CustomEvent('click',{bubbles:true}));}
}
class Document extends Bus {
  constructor(){super();this.documentElement=new Element('html',this);this.head=new Element('head',this);this.body=new Element('body',this);this.documentElement.append(this.head,this.body);this.activeElement=this.body;this.readyState='complete';this.currentScript={src:'http://localhost/static/community-backgrounds.js'};}
  createElement(tag){return new Element(tag,this);}
  createTextNode(text){return{nodeType:3,textContent:String(text),parentElement:null};}
  createDocumentFragment(){return new Element('fragment',this);}
  querySelectorAll(selector){const result=this.documentElement.matches(selector)?[this.documentElement]:[];return result.concat(this.documentElement.querySelectorAll(selector));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  getElementById(id){return this.querySelector('#'+id);}
}
function element(doc,tag,attrs={},text=''){const result=doc.createElement(tag);for(const [key,value]of Object.entries(attrs))result.setAttribute(key,value);if(text)result.textContent=text;return result;}
function append(parent,tag,attrs={},text=''){const node=element(parent.ownerDocument,tag,attrs,text);parent.append(node);return node;}
const VECTOR_IDS=[...PICKER_TEMPLATE.match(/<fieldset class="background-choices background-choices-vector">([\s\S]*?)<\/fieldset>/)[1].matchAll(/\('([^']+)'\s*,/g)].map(match=>match[1]);
function pickerFixture(doc){
  const opener=append(doc.body,'button',{'data-background-open':''},'选择背景');
  const dialog=append(doc.body,'dialog',{'data-background-dialog':'',id:'community-background-dialog'});
  append(dialog,'button',{'data-background-close':''},'关闭');
  const search=append(dialog,'input',{'data-background-search':'',type:'search'});
  for(const type of FILTER_KINDS)append(dialog,'button',{'data-background-filter':type,'aria-pressed':String(type==='all')},type);
  for(const type of FILTER_KINDS)append(dialog,'span',{'data-background-filter-count':type});
  append(dialog,'p',{'data-background-results':''});append(dialog,'p',{'data-background-empty':''});append(dialog,'button',{'data-background-reset':''});
  const gallery=append(dialog,'div',{class:'background-gallery'});
  const vectors=append(gallery,'fieldset',{class:'background-choices'}),images=append(gallery,'fieldset',{class:'background-choices background-choices-images'});
  for(const id of [...VECTOR_IDS,'coast','mineral-scroll','ink-scroll','earthrise']){
    const label=append(VECTOR_IDS.includes(id)?vectors:images,'label',{class:'background-choice'});
    const input=append(label,'input',{type:'radio',name:'liss_background_v24',value:id});input.checked=id==='coast';
    append(label,'span',{class:'background-thumb background-thumb-'+id});const copy=append(label,'span',{class:'background-choice-copy'});append(copy,'strong',{},id);append(copy,'small',{},id);
  }
  const selectionPanel=append(dialog,'aside',{class:'background-selection'}),selectionContent=append(selectionPanel,'div',{class:'background-selection-content'});
  for(const hook of ['selection-title','selection-description','selection-state'])append(selectionContent,'span',{['data-background-'+hook]:''});
  append(selectionContent,'div',{'data-background-preview':''});
  append(selectionContent,'button',{'data-background-locate':''});
  const qualityRow=append(selectionContent,'label',{'data-background-quality-row':''});const quality=append(qualityRow,'select',{'data-background-quality':''});quality.value='auto';
  const scroll=append(selectionContent,'input',{type:'checkbox','data-background-scroll':''});scroll.checked=true;
  append(selectionContent,'a',{'data-background-credit':''});
  append(dialog,'button',{'data-background-apply':''},'使用这个背景');append(selectionPanel,'button',{'data-background-viewer-start':''},'开启观景模式');
  return{opener,dialog,search,gallery,quality,scroll};
}
function environment(options={}){
  const doc=options.doc||new Document(),win=new Bus(),images=[],store=new Map(),writes=[],media=new Map();
  Object.assign(win,{innerWidth:1280,innerHeight:720,devicePixelRatio:1,scrollX:0,scrollY:200,scrollTo(arg,y){if(typeof arg==='object'){this.scrollX=arg.left||0;this.scrollY=arg.top||0;}else{this.scrollX=arg;this.scrollY=y;}}});
  const location=new URL(options.url||'http://localhost/');
  const history={state:null,replaceState(state,unused,url){this.state=state;if(url)location.href=new URL(url,location).href;}};
  const localStorage={getItem:key=>store.get(key)||null,setItem:(key,value)=>{store.set(key,String(value));writes.push({key,value:String(value)});},removeItem:key=>store.delete(key)};
  class Image {constructor(){images.push(this);}set src(value){this.url=value;}get src(){return this.url;}removeAttribute(name){if(name==='src')this.url='';}decode(){return Promise.resolve();}}
  const sandbox={window:win,document:doc,location,history,URL,Image,AbortController,CustomEvent,Event:CustomEvent,navigator:{},localStorage,sessionStorage:localStorage,setTimeout,clearTimeout,requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame(){},getComputedStyle:()=>({display:'block'}),matchMedia:query=>{if(!media.has(query)){const bus=new Bus();bus.matches=false;media.set(query,bus);}return media.get(query);}};
  Object.assign(win,{document:doc,location,history,localStorage,sessionStorage:localStorage,requestAnimationFrame:sandbox.requestAnimationFrame,cancelAnimationFrame:sandbox.cancelAnimationFrame});
  return{doc,win,images,store,writes,sandbox,location};
}
function load(env,file){vm.runInNewContext(fs.readFileSync(path.join(STATIC,file),'utf8'),env.sandbox,{filename:file});}
function input(node,value){node.value=value;node.dispatchEvent(new CustomEvent('input',{bubbles:true}));}
function change(node,value){node.value=value;node.dispatchEvent(new CustomEvent('change',{bubbles:true}));}
function key(env,name,target=env.doc.body,options={}){const event=new CustomEvent('keydown',{key:name,target,...options});env.doc.dispatchEvent(event);return event;}

async function run(){
  const env=environment(),ui=pickerFixture(env.doc);
  load(env,'community-background-palettes-v40.js');load(env,'community-background-candidates-v40.js');load(env,'community-backgrounds.js');
  const api=env.win.LissBackgrounds,checks=[];
  const visible=()=>ui.dialog.querySelectorAll('.background-choice').filter(node=>!node.hidden);
  const filter=kind=>ui.dialog.querySelector('[data-background-filter="'+kind+'"]').click();
  const choose=id=>ui.dialog.querySelectorAll('input[name=liss_background_v24]').find(node=>node.value===id).click();
  const selection=()=>ui.dialog.querySelectorAll('input[name=liss_background_v24]').find(node=>node.checked).value;
  const entries=api.list(),imageEntries=entries.filter(entry=>entry.kind==='image'),vectorEntries=entries.filter(entry=>entry.kind==='vector');
  assert.deepEqual(FILTER_KINDS,['all','image','vector'],'categories distinguish image and drawn backgrounds without a duplicate tone group');
  assert.equal(ui.dialog.querySelectorAll('input[name=liss_background_v24]').length,entries.length);
  assert.equal(env.images.length,1,'only current full image is preheated before opening');
  assert.equal(ui.dialog.querySelectorAll('img').every(node=>!node.src),true,'closed settings do not request thumbnails');
  checks.push(entries.length+' entries with deferred thumbnails and only current full image bootstrap');
  let notifications=0;api.subscribe(()=>notifications++);
  ui.opener.click();assert.equal(ui.dialog.open,true);assert.equal(selection(),'coast');assert.equal(visible().length,entries.length);
  filter('image');assert.equal(visible().length,imageEntries.length);
  for(const entry of imageEntries)assert.ok(visible().some(node=>node.querySelector('input').value===entry.id),'image category includes '+entry.id+' regardless of reading tone');
  filter('vector');assert.equal(visible().length,vectorEntries.length);
  checks.push('real category controls expose all '+imageEntries.length+' images together and '+vectorEntries.length+' drawings');
  filter('image');
  input(ui.search,'夜潮 幽蓝');assert.equal(visible().length,1);assert.equal(visible()[0].querySelector('input').value,'noctilucent-sea');
  input(ui.search,'不存在的背景');assert.equal(visible().length,0);assert.equal(ui.dialog.querySelector('[data-background-empty]').hidden,false);
  ui.dialog.querySelector('[data-background-reset]').click();assert.equal(visible().length,entries.length);assert.equal(ui.search.value,'');assert.equal(env.doc.activeElement,ui.search);
  ui.search.value='夜潮';ui.search.dispatchEvent(new CustomEvent('input',{bubbles:true,isComposing:true}));assert.equal(visible().length,entries.length,'IME draft waits for composition end');ui.search.dispatchEvent(new CustomEvent('compositionend',{bubbles:true}));assert.equal(visible().length,1);
  checks.push('token search, zero-result recovery and CJK composition work without committing');
  choose('noctilucent-sea');change(ui.quality,'high');ui.scroll.checked=false;
  assert.equal(api.read().id,'coast');assert.equal(notifications,0);assert.equal(env.writes.length,0);assert.equal(env.images.length,1);
  assert.equal(ui.dialog.querySelectorAll('img').every(node=>!node.src||node.src.endsWith('-thumb.webp')),true,'gallery and selection panel use only thumbnails');
  ui.dialog.querySelector('[data-background-close]').click();assert.equal(ui.dialog.open,false);assert.equal(env.doc.activeElement,ui.opener);assert.equal(api.read().quality,'auto');assert.equal(api.read().scroll,true);assert.equal(env.writes.length,0);
  checks.push('browsing and cancel preserve current background, quality, motion and storage');
  ui.opener.click();assert.equal(selection(),'coast');assert.equal(visible().length,entries.length);assert.equal(ui.search.value,'');assert.equal(ui.quality.value,'auto');assert.equal(ui.scroll.checked,true);
  choose('noctilucent-sea');change(ui.quality,'high');ui.scroll.checked=false;ui.dialog.querySelector('[data-background-apply]').click();
  assert.equal(api.read().id,'noctilucent-sea');assert.equal(api.read().quality,'high');assert.equal(api.read().scroll,false);assert.equal(notifications,1);assert.equal(env.writes.length,1);assert.equal(ui.dialog.open,false);
  assert.equal(JSON.parse(env.store.get('liss-background-v24')).id,'noctilucent-sea');checks.push('Apply commits selected draft exactly once');
  const returnFocus=append(env.doc.body,'button',{},'选择背景');let viewerEvent=null;env.win.addEventListener('liss:background-viewer-open',event=>viewerEvent=event);
  env.win.dispatchEvent(new CustomEvent('liss:background-picker-open',{detail:{returnFocus}}));assert.equal(ui.dialog.open,true);assert.equal(selection(),'noctilucent-sea');
  choose('earthrise');const credit=ui.dialog.querySelector('[data-background-credit]');assert.equal(credit.hidden,false);assert.match(credit.textContent,/NASA/);assert.equal(credit.href,api.entry('earthrise').creditUrl);
  choose('mist');assert.equal(credit.hidden,true);assert.equal(credit.getAttribute('href'),null,'switching away clears an unrelated source link');
  assert.equal(ui.dialog.querySelector('[data-background-quality-row]').hidden,true);ui.dialog.querySelector('[data-background-viewer-start]').click();
  assert.ok(viewerEvent);assert.equal(viewerEvent.detail.returnFocus,returnFocus);assert.equal(ui.dialog.open,false);assert.equal(api.read().id,'mist');assert.equal(notifications,2);assert.equal(env.writes.length,2);assert.equal(env.doc.activeElement,ui.dialog,'viewer hand-off does not focus opener before the viewer takes focus');
  checks.push('direct viewer entry preserves source credits, commits once and hands off return focus');
  api.destroy();
  ui.opener.click();assert.equal(ui.dialog.open,false);checks.push('destroy removes UI handlers');
  load(env,'community-backgrounds.js');
  const restarted=env.win.LissBackgrounds,radios=ui.dialog.querySelectorAll('input[name=liss_background_v24]');
  assert.equal(radios.length,entries.length);assert.equal(new Set(radios.map(node=>node.value)).size,entries.length);
  let repeatedNotifications=0;restarted.subscribe(()=>repeatedNotifications++);ui.opener.click();choose('coast');ui.dialog.querySelector('[data-background-apply]').click();assert.equal(restarted.read().id,'coast');assert.equal(repeatedNotifications,1);restarted.destroy();
  checks.push('controller restart keeps one choice per background and one Apply listener');
  console.log(JSON.stringify({passed:true,checks},null,2));
}
module.exports={Bus,CustomEvent,Element,Document,element,append,environment,pickerFixture,load,input,change,key,STATIC};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
