/* Visit policy uses the real head helper; picker assertions use its real DOM controller. */
'use strict';
const assert=require('node:assert/strict');
const {environment,load,pickerFixture,append,CustomEvent,input}=require('./background-picker.test.cjs');
const STORE='liss-background-v24',VISIT='liss-background-visit:v55',HANDOFF='liss-background-handoff:v55';
const catalogue={coast:{id:'coast',kind:'image'},lake:{id:'lake',kind:'image'},ice:{id:'ice',kind:'image'},mist:{id:'mist',kind:'vector'}};
const checks=[];
let stamp=100;
function storage(map,writes=[]){return{getItem:key=>map.get(key)||null,setItem:(key,value)=>{map.set(key,String(value));writes.push({key,value:String(value)});},removeItem:key=>map.delete(key)};}
function visit(options={}){
  const env=environment({url:options.url||'http://localhost/'}),shared=options.shared||new Map(),tab=options.tab||new Map(),sharedWrites=[],tabWrites=[];
  const ls=storage(shared,sharedWrites),ss=storage(tab,tabWrites);if(options.saved)shared.set(STORE,JSON.stringify(options.saved));
  env.sandbox.localStorage=env.win.localStorage=options.blocked?{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}}:ls;
  env.sandbox.sessionStorage=env.win.sessionStorage=ss;env.doc.referrer=options.referrer||'';
  env.win.performance={timeOrigin:options.stamp||++stamp,getEntriesByType:()=>[{type:options.type||'navigate'}]};env.sandbox.Math=Object.create(Math);env.sandbox.Math.random=()=>options.random===undefined?0:options.random;
  load(env,'community-background-visits-v55.js');const abort=new AbortController();
  const controller=env.win.LissBackgroundVisitsV55.create({catalogue:options.catalogue||catalogue,site:options.site,signal:abort.signal});
  return{...env,controller,shared,tab,sharedWrites,tabWrites,destroy:()=>abort.abort()};
}
const fresh=visit({saved:{id:'coast',quality:'high',scroll:false}});
const firstChoices=[0,.5,.999].map(random=>{const first=visit({random});const id=first.controller.read().id;first.destroy();return id;});assert.deepEqual(firstChoices,['coast','lake','ice'],'a genuinely fresh visitor can receive every image, including the fallback');
assert.equal(fresh.controller.read().random,true);assert.equal(fresh.controller.read().id,'lake');assert.equal(fresh.controller.read().quality,'high');assert.equal(fresh.controller.read().scroll,false);assert.deepEqual([...fresh.controller.read().randomPool],['coast','lake','ice']);assert.equal(fresh.sharedWrites.length,0);assert.equal(fresh.tabWrites.length,1);
checks.push('legacy fixed preferences retain quality/motion while random defaults on, images alone form its pool, and entrance draws never write shared preferences');
for(const config of [{type:'reload'},{type:'back_forward'},{referrer:'http://localhost/post/1'},{stamp:fresh.win.performance.timeOrigin}]){const env=visit({...config,shared:fresh.shared,tab:new Map(fresh.tab)});assert.equal(env.controller.read().id,'lake');env.destroy();}
const external=visit({shared:fresh.shared,tab:fresh.tab});assert.equal(external.controller.read().id,'coast');assert.equal(external.controller.inspect().reason,'new-entry');
checks.push('reload, Back/Forward, same-site MPA navigation and repeated initialization retain a visit; a new no-referrer entrance draws again without repeating');
const link=append(external.doc.body,'a',{href:'http://localhost/post/2#comments'});link.href='http://localhost/post/2#comments';external.doc.dispatchEvent(new CustomEvent('click',{target:link,button:0,ctrlKey:true}));assert.ok(external.shared.has(HANDOFF));
const newTab=visit({url:'http://localhost/post/2',shared:external.shared,referrer:'http://localhost/'});assert.equal(newTab.controller.read().id,'coast');assert.equal(newTab.controller.inspect().reason,'internal-entry');assert.equal(external.shared.has(HANDOFF),false);
const direct=visit({url:'http://localhost/post/2',shared:external.shared,tab:external.tab});assert.equal(direct.controller.read().id,'lake','source session copy cannot reuse an already consumed cross-tab ticket');
external.doc.dispatchEvent(new CustomEvent('auxclick',{target:link,button:1}));const noRef=visit({url:'http://localhost/post/2',shared:external.shared});assert.equal(noRef.controller.read().id,'coast');
checks.push('Ctrl/middle-click same-site tabs and no-referrer handoffs preserve the actual visit picture; a target-specific ticket is consumed only once across tabs');
const expired=new Map(external.shared);expired.set(HANDOFF,JSON.stringify({to:'http://localhost/post/3',id:'ice',token:'expired',at:Date.now()-16000}));const stale=visit({shared:expired,url:'http://localhost/post/3'});assert.notEqual(stale.controller.read().id,'ice');
const hostile=new Map(external.shared);hostile.set(HANDOFF,JSON.stringify({to:'http://localhost/post/4',id:'ice',token:'fresh',at:Date.now()}));const outside=visit({shared:hostile,url:'http://localhost/post/4',referrer:'https://external.example/'});assert.notEqual(outside.controller.read().id,'ice');
checks.push('expired tickets and externally referred entrances cannot inherit an internal handoff');
const own=visit(),ownStart=own.controller.read().id,other=visit({shared:own.shared});other.controller.apply({id:'ice',random:true,randomPoolMode:'custom',randomPool:['coast','ice'],quality:'high'});own.controller.sync(false);assert.equal(own.controller.read().id,ownStart);assert.equal(own.controller.read().quality,'high');assert.deepEqual([...own.controller.read().randomPool],['coast','ice']);assert.equal(own.controller.read().random,true);
own.controller.apply({id:'mist'});assert.equal(own.controller.read().random,true);assert.equal(own.controller.read().id,'mist');const paused=own.controller.apply({id:'mist',random:false});assert.equal(paused.ok,true);assert.equal(own.controller.read().random,false);
checks.push('cross-tab settings synchronize without copying another tab’s picture; manual scene changes preserve random until explicitly switched off');
const before=own.sharedWrites.length,bad=own.controller.apply({random:true,randomPoolMode:'custom',randomPool:[]});assert.equal(bad.ok,false);assert.equal(own.sharedWrites.length,before);assert.equal(own.controller.read().random,false);
const empty=visit({saved:{id:'coast',random:true,randomPoolMode:'custom',randomPool:[]}});assert.equal(empty.controller.read().random,false);assert.equal(empty.controller.read().randomPool.length,0);assert.match(empty.controller.read().randomNotice,/为空/);
const partial=visit({saved:{random:true,randomPoolMode:'custom',randomPool:['deleted','ice']}});assert.deepEqual([...partial.controller.read().randomPool],['ice']);assert.equal(partial.controller.read().randomPoolMode,'custom');
const gone=visit({saved:{random:true,randomPoolMode:'custom',randomPool:['deleted']},site:{defaultRandom:{enabled:true,ids:['lake']}}});assert.deepEqual([...gone.controller.read().randomPool],['lake']);assert.equal(gone.controller.read().id,'lake');assert.match(gone.controller.read().randomNotice,/已下架/);
const noImages=visit({catalogue:{mist:catalogue.mist}});assert.equal(noImages.controller.read().id,'mist');assert.equal(noImages.controller.read().random,false);
const blocked=visit({blocked:true});assert.equal(blocked.controller.apply({id:'ice'}).ok,true);
checks.push('empty custom pools are never silently refilled; Apply rejects empty enabled pools, deleted IDs are filtered, all-deleted pools visibly recover, and blocked storage/zero images remain usable');
const same=append(fresh.doc.body,'a',{href:'http://localhost/#write'});same.href='http://localhost/#write';fresh.shared.delete(HANDOFF);fresh.doc.dispatchEvent(new CustomEvent('click',{target:same,button:0}));assert.equal(fresh.shared.has(HANDOFF),false);
fresh.doc.dispatchEvent(new CustomEvent('click',{target:same,button:0,ctrlKey:true}));const sameTab=visit({shared:fresh.shared,referrer:'http://localhost/'});assert.equal(sameTab.controller.read().id,'lake');sameTab.destroy();
for(const path of ['/post/10','/post/11']){const anchor=append(fresh.doc.body,'a',{href:'http://localhost'+path});anchor.href='http://localhost'+path;fresh.doc.dispatchEvent(new CustomEvent('auxclick',{target:anchor,button:1}));}
for(const path of ['/post/11','/post/10']){const opened=visit({shared:fresh.shared,url:'http://localhost'+path,referrer:'http://localhost/'});assert.equal(opened.controller.read().id,'lake');opened.destroy();}
assert.equal(fresh.shared.has(HANDOFF),false);checks.push('fresh randomness includes the fallback; same-URL new tabs inherit their source while ordinary hashes do not hand off, and multiple different target tabs consume independent tickets');

// Add only the new controls to the established fixture; all controller/UI code is real.
const env=environment(),ui=pickerFixture(env.doc),tab=new Map();env.sandbox.sessionStorage=env.win.sessionStorage=storage(tab);env.doc.referrer='';env.win.performance={timeOrigin:9999,getEntriesByType:()=>[{type:'navigate'}]};
const settings=append(ui.dialog,'div',{'data-background-random-settings':''});const enabled=append(settings,'input',{type:'checkbox','data-background-random-enabled':''});const browse=append(settings,'button',{'data-background-random-browse':''});append(browse,'span',{'data-background-random-count':''});const message=append(ui.dialog,'p',{'data-background-random-status':''});
const tools=append(ui.dialog,'div',{'data-background-pool-tools':''});for(const name of ['back','all','none','default'])append(tools,'button',{['data-background-pool-'+name]:''});const pool=append(ui.gallery,'fieldset',{'data-background-pool-choices':''});
load(env,'community-background-palettes-v40.js');load(env,'community-background-candidates-v40.js');load(env,'community-background-visits-v55.js');load(env,'community-backgrounds.js');const api=env.win.LissBackgrounds,start=api.read().id;
// An admin may put any built-in drawn scene in the site default, not only the aurora set.
const vectorPool=visit({site:{defaultRandom:{enabled:true,ids:['mist']}}});assert.equal(vectorPool.controller.read().id,'mist');assert.deepEqual([...vectorPool.controller.read().randomPool],['mist']);
checks.push('a site default list may name any built-in drawn scene');
// v60: 51 photos plus 10 drawn aurora scenes can join the draw; the untouched site default is the aurora set.
assert.equal(api.read().random,true);assert.equal(pool.querySelectorAll('input').length,61);assert.equal(env.writes.length,0);ui.opener.click();assert.equal(enabled.checked,true);browse.click();assert.equal(ui.dialog.dataset.backgroundPoolView,'true');
ui.dialog.querySelector('[data-background-pool-none]').click();assert.equal(ui.dialog.querySelector('[data-background-apply]').disabled,true);assert.match(message.textContent,/至少/);assert.equal(api.read().randomPool.length,10);assert.equal(api.read().id,start);
const check=pool.querySelectorAll('input')[0];check.click();assert.equal(ui.dialog.querySelector('[data-background-apply]').disabled,false);assert.equal(api.read().randomPool.length,10);ui.dialog.querySelector('[data-background-close]').click();assert.equal(env.writes.length,0);
ui.opener.click();browse.click();assert.equal(pool.querySelectorAll('input').filter(node=>node.checked).length,10);input(ui.search,'夜潮 幽蓝');assert.equal(pool.querySelectorAll('label').filter(node=>!node.hidden).length,1);
ui.dialog.querySelector('[data-background-pool-none]').click();check.click();ui.dialog.querySelector('[data-background-apply]').click();assert.equal(api.read().id,start);assert.equal(api.read().random,true);assert.deepEqual([...api.read().randomPool],[check.value]);assert.equal(env.writes.filter(w=>w.key===STORE).length,1);
ui.opener.click();enabled.click();ui.dialog.querySelector('[data-background-apply]').click();assert.equal(api.read().random,false);assert.equal(api.read().id,start);
let painted=[],releases=0;env.win.LissBackgroundPreviewsV49={create:()=>({paint(node){painted.push(node);},clear(){},releaseAll(){releases++;},destroy(){releases++;}})};api.set({id:'mist'});ui.opener.click();browse.click();assert.ok(releases>0);
// Drawn scenes in the pool have no image file: they are painted like the gallery, never given a broken <img src=".../undefined">.
const poolLabels=pool.querySelectorAll('label'),drawnPool=poolLabels.filter(label=>api.entry(label.querySelector('input').value).kind==='vector');assert.equal(drawnPool.length,10);
for(const label of drawnPool){const thumb=label.querySelector('.background-thumb');assert.ok(!label.querySelector('img'),'a drawn pool tile cannot request an image');assert.ok(painted.includes(thumb),'a visible drawn pool tile is painted');}
for(const label of poolLabels.filter(label=>!drawnPool.includes(label))){const image=label.querySelector('img');assert.ok(image&&image.src&&!/undefined/.test(image.src),'a photo pool tile loads its thumbnail');}
const preview=ui.dialog.querySelector('[data-background-preview]');painted=[];env.win.dispatchEvent(new CustomEvent('liss:theme-change'));assert.ok(!painted.includes(preview),'a hidden drawing detail cannot allocate a preview while editing the image pool');assert.ok(painted.length>0,'drawn pool tiles repaint for the new theme');
checks.push('drawn scenes in the random pool show painted previews instead of broken image thumbnails');ui.dialog.querySelector('[data-background-close]').click();api.destroy();assert.equal(env.doc.events.get('click')?.size||0,0);assert.equal(env.doc.events.get('auxclick')?.size||0,0);
checks.push('the real picker keeps pool checkboxes separate from the current radio, searches pool thumbnails, rejects empty Apply, restores cancelled drafts, and explicitly fixes the current picture');

const managed=environment();managed.doc.readyState='loading';managed.win.LissBackgroundSite={revision:2,entries:[{id:'custom-lake',kind:'image',title:'新湖面',description:'已发布图片',width:3840,height:2560,src:'/background-assets/custom-lake/3840.webp',thumbnail:'/background-assets/custom-lake/thumb.webp',variants:[{file:'/background-assets/custom-lake/960.webp',width:960,height:640},{file:'/background-assets/custom-lake/3840.webp',width:3840,height:2560}]}],defaultRandom:{enabled:true,ids:['custom-lake']}};load(managed,'community-background-visits-v55.js');load(managed,'community-backgrounds.js');assert.equal(managed.win.LissBackgrounds.list().filter(e=>e.kind==='image').length,1);assert.equal(managed.win.LissBackgrounds.read().id,'custom-lake');assert.equal(managed.win.LissBackgrounds.entry('coast').id,'mist');assert.match(managed.images[0].src,/localhost\/background-assets\/custom-lake\//);managed.win.LissBackgrounds.destroy();
checks.push('an authoritative server catalogue removes disabled builtins and exposes a new same-origin uploaded image at bootstrap without rebuilding JavaScript');
for(const item of [fresh,external,newTab,direct,noRef,stale,outside,own,other,empty,partial,gone,noImages,blocked])item.destroy();
console.log(JSON.stringify({passed:true,checks},null,2));
