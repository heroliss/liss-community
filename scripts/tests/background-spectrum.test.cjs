/* Check that pattern variants retain the real spectrum renderer and the room's
   lifecycle contracts. Composition is verified separately in the browser. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const staticDir=path.resolve(__dirname,'../../app/static');
const baseSource=fs.readFileSync(path.join(staticDir,'community-procedural.js'),'utf8');
const extensionSource=fs.readFileSync(path.join(staticDir,'community-background-spectrum-v44.js'),'utf8');
let delegated=0,thumbnailDelegates=0,pathCount=0;
function node(tag){
  const properties={},context={paints:0,clearRect(){},setTransform(){},translate(){},rotate(){},scale(){},transform(){},resetTransform(){},beginPath(){},moveTo(){},lineTo(){},bezierCurveTo(){},quadraticCurveTo(){},ellipse(){},arc(){},closePath(){},fill(){this.paints++;},stroke(){this.paints++;},fillRect(){this.paints++;},save(){},restore(){},clip(){},createLinearGradient:gradient,createRadialGradient:gradient};
  const element={tag,children:[],dataset:{},className:'',attributes:{},width:1,height:1,removed:false,style:{setProperty(k,v){properties[k]=v;},getPropertyValue(k){return properties[k]||'';}},setAttribute(k,v){this.attributes[k]=v;},append(...children){this.children.push(...children);children.forEach(x=>x.parentElement=this);},appendChild(child){this.append(child);return child;},replaceChildren(...children){this.children=[];this.innerHTML='';this.append(...children);},remove(){this.removed=true;},getContext(kind){assert.equal(kind,'2d','decorative patterns do not open GL contexts');return context;},context};
  element.classList={add(...names){element.className=[...new Set(element.className.split(/\s+/).concat(names))].filter(Boolean).join(' ');}};
  return element;
}
function gradient(){return{addColorStop(position,colour){assert.ok(position>=0&&position<=1);assert.equal(typeof colour,'string');assert.ok(!colour.includes('NaN'));}};}
const oldRegistry={has:style=>style==='old',styles:['old'],create(){delegated++;return{delegated:true};},paintThumbnail(){thumbnailDelegates++;}};
const sandbox={window:{LissSceneDesignsV40:oldRegistry,devicePixelRatio:3},document:{createElement:node,createElementNS:(_,tag)=>node(tag)},Math,Path2D:class{constructor(data){assert.equal(typeof data,'string');assert.ok(data.length>0&&!data.includes('NaN'));pathCount++;}}};
vm.runInNewContext(baseSource,sandbox,{filename:'community-procedural.js'});
const original=sandbox.window.LissProceduralScenes;
const baseline=original.create({style:'spectrum'});
const colours=['a','b','c'].map(key=>baseline.element.style.getPropertyValue('--scene-'+key));
const baseShapes=baseline.element.children.map(x=>x.className);
assert.equal(baseShapes.length,3);
vm.runInNewContext(extensionSource,sandbox,{filename:'community-background-spectrum-v44.js'});
const procedural=sandbox.window.LissProceduralScenes,registry=sandbox.window.LissSceneDesignsV40,extension=sandbox.window.LissSpectrumStudiesV44;
assert.ok(extension,'pattern module registered');
assert.deepEqual(new Set(Array.from(extension.styles)),new Set(['spectrum-botanical','spectrum-ripples']));
assert.equal(registry.create({style:'old'},original.camera).delegated,true);assert.equal(delegated,1);
registry.paintThumbnail(node('canvas'),'old',false);assert.equal(thumbnailDelegates,1);
assert.ok(procedural.styles.includes('spectrum'),'the original remains independently selectable');
assert.equal(new Set(procedural.styles).size,procedural.styles.length,'the public style catalogue has no duplicates');
function allChildren(element){return element.children.flatMap(child=>[child,...allChildren(child)]);}
const paintServerIds=[];
for(const style of extension.styles){
  assert.ok(registry.has(style));assert.ok(procedural.styles.includes(style));
  const scene=procedural.create({id:style,style}),root=scene.element;
  assert.equal(root.dataset.vectorStyle,'spectrum','exact original CSS field is reused');
  assert.equal(root.dataset.spectrumPattern,style);
  assert.deepEqual(root.children.slice(0,3).map(x=>x.className),baseShapes,'original three colour fields survive');
  assert.deepEqual(['a','b','c'].map(key=>root.style.getPropertyValue('--scene-'+key)),colours,'base pigments are untouched');
  scene.resize(3840,2160,false);let state=scene.inspect();
  assert.ok(state.canvasPixels>=0&&state.canvasPixels<=2400000,'pattern pixels stay bounded at high DPR');
  assert.equal(state.ownRAF,false);assert.equal(state.glContexts,0);assert.equal(state.imageRequests,0);
  const before=state.patternDraws;scene.resize(3840,2160,false);assert.equal(scene.inspect().patternDraws,before,'unchanged layouts are cached');
  scene.setMotion(true);assert.equal(root.dataset.sceneMotion,'running');scene.setMotion(false);assert.equal(root.dataset.sceneMotion,'paused');
  assert.equal(scene.inspect().patternDraws,before,'motion control does not rebuild pattern geometry');
  scene.resize(390,844,true);assert.equal(root.dataset.sceneTheme,'light');assert.equal(scene.inspect().patternDraws,before+1,'viewport/theme change refreshes the pattern');
  assert.equal(root.attributes['aria-hidden'],'true');
  const art=allChildren(root).find(x=>x.tag==='svg');assert.ok(art&&art.innerHTML.includes('<path'),'SVG pattern geometry is present');
  for(const element of allChildren(root)){if(element.innerHTML)for(const match of element.innerHTML.matchAll(/id="([^"]+)"/g))paintServerIds.push(match[1]);}
  const thumbnail=node('canvas');thumbnail.width=360;thumbnail.height=225;const previousPaths=pathCount;
  registry.paintThumbnail(thumbnail,style,false);assert.equal(thumbnail.width,360);assert.equal(thumbnail.height,225);assert.ok(thumbnail.context.paints>0&&pathCount>previousPaths,'thumbnail carries actual pattern geometry');
  scene.destroy();scene.destroy();assert.equal(root.removed,true);
  const after=scene.inspect().patternDraws;scene.resize(900,800,false);scene.setMotion(true);assert.equal(scene.inspect().patternDraws,after);assert.equal(root.dataset.sceneMotion,'paused','destroyed scenes cannot restart');
}
assert.equal(new Set(paintServerIds).size,paintServerIds.length,'per-scene SVG paint servers are isolated');
const registered=registry;vm.runInNewContext(extensionSource,sandbox);assert.equal(sandbox.window.LissSceneDesignsV40,registered,'reloading the module is idempotent');
baseline.destroy();
console.log(JSON.stringify({passed:true,styles:Array.from(extension.styles),contracts:['real spectrum base retained','old renderer delegated','bounded pattern canvas','cached resize','room-owned motion','responsive/theme refresh','pattern thumbnails','isolated paint servers','idempotent cleanup and registration'],scope:'CPU/resource contracts; visual composition needs browser acceptance'}));
