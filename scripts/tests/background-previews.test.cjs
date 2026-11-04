/* Scene identity, lazy allocation and teardown contracts. Real composition is
   accepted separately in the existing browser, not inferred from DOM mocks. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const fixture=require('./background-picker.test.cjs');
const env=fixture.environment(),doc=env.doc,gallery=fixture.append(doc.body,'div',{}),observers=[],resizers=[],made=[],copied=[];
class IntersectionObserver{
  constructor(callback,options){this.callback=callback;this.options=options;this.nodes=new Set();observers.push(this);}
  observe(node){this.nodes.add(node);}unobserve(node){this.nodes.delete(node);}disconnect(){this.nodes.clear();}
  deliver(node,isIntersecting){this.callback([{target:node,isIntersecting}]);}
}
class ResizeObserver{
  constructor(callback){this.callback=callback;this.nodes=new Set();resizers.push(this);}
  observe(node){this.nodes.add(node);}unobserve(node){this.nodes.delete(node);}disconnect(){this.nodes.clear();}
}
const nativeCreate=doc.createElement.bind(doc);
doc.createElement=function(tag){const node=nativeCreate(tag);if(tag==='canvas')node.getContext=()=>({drawImage(source){copied.push({source,width:source.width,height:source.height});}});return node;};
env.sandbox.IntersectionObserver=IntersectionObserver;env.sandbox.ResizeObserver=ResizeObserver;
let roomColour='#0d1415',roomBackground='room-ground';
env.sandbox.getComputedStyle=()=>({background:roomBackground,backgroundColor:roomColour,getPropertyValue:()=>roomColour});
env.win.LissProceduralScenes={create(entry){
  const root=doc.createElement('div'),canvas=doc.createElement('canvas');canvas.className='actual-paint';root.append(canvas);
  const call={entry,root,canvas,motion:[],resizes:[],destroyed:0};made.push(call);
  return{element:root,setMotion(value){call.motion.push(value);},resize(...args){call.resizes.push(args);canvas.width=380;canvas.height=340;root.style.left='-80px';root.style.width='1440px';},inspect(){return{glContexts:entry.id==='tideglass'?1:0};},destroy(){call.destroyed++;canvas.width=canvas.height=1;root.remove();}};
}};
vm.runInNewContext(fs.readFileSync(path.join(fixture.STATIC,'community-background-previews-v49.js'),'utf8'),env.sandbox);
const pool=env.win.LissBackgroundPreviewsV49.create(gallery),a=fixture.append(gallery,'span',{}),b=fixture.append(gallery,'span',{}),detail=fixture.append(doc.body,'span',{});
const entry=id=>({id,style:id,kind:'vector'}),checks=[];
pool.paint(a,entry('line'),false);assert.equal(made.length,0);assert.equal(pool.inspect().retainedScenes,0);
assert.equal(observers[0].options.root,gallery);observers[0].deliver(a,true);
assert.equal(made.length,1);assert.equal(made[0].entry.style,'line');assert.equal(made[0].entry.preview,true);assert.deepEqual(made[0].resizes,[[1280,720,false]]);assert.deepEqual(made[0].motion,[false]);
assert.equal(pool.inspect().ownRAF,false);assert.equal(a.children[0].style.backgroundColor,'#0d1415');assert.equal(a.dataset.scenePreviewReady,'true');checks.push('offscreen tiles allocate nothing; visible tiles use the actual paused scene factory');
pool.paint(a,entry('line'),false);resizers[0].callback([{target:a}]);assert.equal(made.length,1);assert.equal(made[0].resizes.length,1);checks.push('repeated painting and tile resize reuse one fixed desktop composition');
const oldStage=a.children[0];roomColour='#152b28';roomBackground='custom-room-ground';pool.paint(a,entry('line'),false);
assert.equal(a.children[0],oldStage);assert.equal(oldStage.style.background,'custom-room-ground');assert.equal(oldStage.style.backgroundColor,'#152b28');assert.equal(oldStage.style.getPropertyValue('--bg'),'#152b28');assert.equal(made.length,1);assert.equal(made[0].destroyed,0);assert.equal(made[0].resizes.length,1);
checks.push('same-mode custom pigment refreshes room ground while retaining the existing scene buffer');
pool.paint(a,entry('line'),true);assert.equal(made[0].destroyed,1);assert.equal(made.length,2);assert.deepEqual(made[1].resizes,[[1280,720,true]]);checks.push('theme changes dispose the previous still and use the live light renderer');
observers[0].deliver(a,false);assert.equal(made[1].destroyed,1);assert.equal(a.children.length,0);assert.equal(a.dataset.scenePreviewReady,undefined);checks.push('leaving the gallery viewport releases retained scene buffers');
pool.paint(b,entry('tideglass'),false);observers[0].deliver(b,true);const water=made.at(-1);
assert.equal(water.destroyed,1);assert.equal(copied.length,1);assert.equal(copied[0].width,380);assert.equal(copied[0].height,340);
const copiedRoot=b.children[0].children[0];assert.equal(copiedRoot.style.left,'-80px');assert.equal(copiedRoot.children[0].width,380);assert.equal(copiedRoot.children[0].className,'actual-paint');assert.equal(pool.inspect().persistentWebGLContexts,0);checks.push('water uses one real optical frame and immediately releases its WebGL context');
pool.paint(detail,entry('spectrum-botanical'),true);assert.equal(made.at(-1).entry.style,'spectrum-botanical');assert.equal(detail.dataset.scenePreviewReady,'true');checks.push('selection detail uses the same factory without waiting for gallery intersection');
pool.clear(detail);assert.equal(detail.children.length,0);assert.equal(made.at(-1).destroyed,1);
pool.releaseAll();assert.equal(pool.inspect().tracked,0);assert.equal(pool.inspect().retainedScenes,0);assert.equal(b.children.length,0);assert.equal(observers[0].nodes.size,0);assert.equal(resizers[0].nodes.size,0);checks.push('clear and dialog close release DOM, scenes and both observers');
pool.paint(a,entry('mist'),false);assert.equal(observers.length,2);observers[1].deliver(a,true);assert.equal(a.dataset.scenePreviewReady,'true');pool.destroy();const count=made.length;pool.paint(a,entry('mist'),false);assert.equal(made.length,count);assert.equal(a.children.length,0);checks.push('a closed dialog can reopen; a destroyed controller cannot allocate again');

// Exercise every real factory with the preview flag. A 4K/DPR host must not
// turn a small tile into a full-screen buffer; unsupported GL uses its actual
// shipped fallback. Geometry quality remains a browser acceptance check.
const real=fixture.environment(),realCreate=real.doc.createElement.bind(real.doc);
const gradient=()=>({addColorStop(){}}),context=new Proxy({createLinearGradient:gradient,createRadialGradient:gradient},{get:(target,key)=>target[key]||(()=>{})});
real.doc.createElement=function(tag){const node=realCreate(tag);node.getContext=kind=>kind==='2d'?context:null;return node;};
real.doc.createElementNS=(_,tag)=>real.doc.createElement(tag);
real.sandbox.Path2D=class{moveTo(){}lineTo(){}closePath(){}};real.sandbox.devicePixelRatio=3;real.win.devicePixelRatio=3;
real.sandbox.requestAnimationFrame=()=>{throw Error('Static preview must not start an animation clock');};
for(const file of ['community-background-water-v40.js','community-background-designs-v40.js','community-background-defaults-v43.js','community-procedural.js','community-background-spectrum-v44.js'])fixture.load(real,file);
const realIds=Array.from(real.win.LissProceduralScenes.styles);assert.equal(realIds.length,22);
for(const style of realIds)for(const light of [false,true]){
  const scene=real.win.LissProceduralScenes.create({id:style,style,kind:'vector',preview:true});scene.setMotion(false);scene.resize(1280,720,light);
  const state=scene.inspect();assert.equal(state.style,style);assert.ok(state.canvasPixels<=140000,style+' preview pixel budget');assert.equal(state.field.overscan,80);assert.equal(state.field.viewportSpan,1.42);assert.equal(state.decorativeMotion.running,false);scene.destroy();
}
checks.push('all 22 actual scene factories retain the page camera and stay under 140k pixels in both themes');

// The picker must release observers on every dismissal path, including a
// cached history navigation which intentionally keeps the page controller.
const controls=fixture.environment(),ui=fixture.pickerFixture(controls.doc),calls={paint:[],release:0,clear:0,destroy:0};
controls.win.LissBackgroundPreviewsV49={create:()=>({paint(node,item,light){calls.paint.push({id:item.id,light});},clear(){calls.clear++;},releaseAll(){calls.release++;},destroy(){calls.destroy++;}})};
fixture.load(controls,'community-background-palettes-v40.js');fixture.load(controls,'community-background-candidates-v40.js');fixture.load(controls,'community-backgrounds.js');
ui.opener.click();ui.dialog.querySelector('input[value="spectrum-botanical"]').click();const initialPaints=calls.paint.length;
assert.ok(calls.paint.some(item=>item.id==='line'));assert.ok(calls.paint.some(item=>item.id==='spectrum-botanical'));assert.equal(controls.writes.length,0);
controls.doc.documentElement.dataset.theme='light';controls.win.dispatchEvent(new fixture.CustomEvent('liss:theme-change'));assert.ok(calls.paint.length>initialPaints);assert.equal(calls.paint.at(-1).light,true);
controls.win.dispatchEvent(new fixture.CustomEvent('pagehide',{persisted:true}));assert.ok(calls.release>0);const beforeResume=calls.paint.length;controls.win.dispatchEvent(new fixture.CustomEvent('pageshow',{persisted:true}));assert.ok(calls.paint.length>beforeResume);
const beforeClose=calls.release;ui.dialog.querySelector('[data-background-close]').click();assert.ok(calls.release>beforeClose);assert.equal(controls.writes.length,0);controls.win.LissBackgrounds.destroy();assert.equal(calls.destroy,1);
checks.push('picker refreshes both sides on theme/resume and releases stills on cancel, BFCache and dispose without saving a draft');
console.log(JSON.stringify({passed:true,checks},null,2));
