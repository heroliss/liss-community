/* Resource/lifecycle contracts for the default studies; browser screenshots
   remain the acceptance evidence for composition, colour and surface quality. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../../app/static/community-background-defaults-v43.js'),'utf8');
const camera={viewportSpan:1.42,overscan:80,scrollRate:.045,viewBoxHeight:1420};
let delegated=0,thumbnails=0;
function node(tag){
  const ctx={setTransform(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},stroke(){},save(){},restore(){},clip(){},createLinearGradient(){return{addColorStop(){}};},createRadialGradient(){return{addColorStop(){}};}};
  return{tag,dataset:{},style:{},children:[],width:1,height:1,removed:false,attributes:{},setAttribute(k,v){this.attributes[k]=v;},append(...children){this.children.push(...children);},remove(){this.removed=true;},getContext(){return ctx;}};
}
const old={has:id=>id==='old',styles:['old'],create(){delegated++;return{old:true};},paintThumbnail(){thumbnails++;}};
const sandbox={window:{LissSceneDesignsV40:old,devicePixelRatio:3},document:{createElement:node,createElementNS:(_,tag)=>node(tag)},Path2D:class{constructor(d){assert.equal(typeof d,'string');assert.ok(!d.includes('NaN'));}},Math};
vm.runInNewContext(source,sandbox,{filename:'community-background-defaults-v43.js'});
const api=sandbox.window.LissSceneDesignsV40,extension=sandbox.window.LissDefaultSceneStudiesV43;
assert.ok(api.has('old'),'existing renderer membership survives the extension');
assert.equal(api.create({style:'old'},camera).old,true);assert.equal(delegated,1);
api.paintThumbnail(node('canvas'),'old',false);assert.equal(thumbnails,1);
assert.equal(new Set(api.styles).size,api.styles.length,'scene registry contains no duplicate styles');
const ids=[];
for(const style of extension.styles){
  assert.ok(api.has(style));const scene=api.create({style},camera);assert.equal(scene.element.dataset.sceneMotion,'paused');
  scene.resize(3840,2160,false);let state=scene.inspect();assert.ok(state.canvasPixels<=state.canvasPixelBudget,'4K display does not allocate a 4K decorative canvas');
  assert.equal(state.ownRAF,false);assert.equal(state.glContexts,0);assert.equal(state.imageRequests,0);
  const count=state.draws;scene.resize(3840,2160,false);assert.equal(scene.inspect().draws,count,'unchanged layout does not repaint');
  scene.setMotion(true);assert.equal(scene.element.dataset.sceneMotion,'running');scene.setMotion(false);assert.equal(scene.element.dataset.sceneMotion,'paused');assert.equal(scene.inspect().draws,count,'motion state does not redraw Canvas');
  scene.resize(390,844,true);assert.equal(scene.inspect().draws,count+1,'mobile/theme change repaints the still surface');assert.equal(scene.element.dataset.sceneTheme,'light');
  assert.equal(scene.element.attributes['aria-hidden'],'true');
  ids.push(scene.element.children[1].innerHTML.match(/id="([^"]+)"/)[1]);
  const canvas=node('canvas');canvas.width=360;canvas.height=225;api.paintThumbnail(canvas,style,false);assert.equal(canvas.width,360);assert.equal(canvas.height,225);
  scene.destroy();scene.destroy();assert.equal(scene.element.removed,true);assert.equal(scene.element.children[0].width,1);assert.equal(scene.element.children[0].height,1);
  scene.resize(1200,900,false);scene.setMotion(true);assert.equal(scene.inspect().draws,count+1,'disposed scenes cannot restart');assert.equal(scene.element.dataset.sceneMotion,'paused');
}
assert.equal(new Set(ids).size,ids.length,'SVG paint servers are isolated per scene');
vm.runInNewContext(source,sandbox);assert.equal(sandbox.window.LissSceneDesignsV40,api,'loading twice does not wrap the existing registry twice');
console.log(JSON.stringify({passed:true,styles:Array.from(extension.styles),contracts:['existing-scene delegation','bounded pixels','cached resize','native-motion pause','responsive/theme repaint','thumbnail routing','isolated SVG ids','idempotent destroy','idempotent registration'],scope:'CPU lifecycle; composition and colour require real browser review'}));
