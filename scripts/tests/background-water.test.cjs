/* Lifecycle/resource contracts only; actual shader compilation and visual
   quality are checked in the local browser. No browser or GPU is mocked as proof. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../../app/static/community-background-water-v40.js'),'utf8');
const camera={viewportSpan:1.42,overscan:80,scrollRate:.045,viewBoxHeight:1420};
function harness(options={}){
  const frames=new Map(),uniforms={},nodes=[],counts={draws:0,shadersDeleted:0,programsDeleted:0,arraysDeleted:0,lost:0,fallbackPaints:0,fallbackCreates:0};let id=0,now=1000;
  const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,TRIANGLES:5,
    createShader:()=>({}),shaderSource(){},compileShader(){},getShaderParameter:()=>!options.compileFails,getShaderInfoLog:()=> 'test compile failure',createProgram:()=>({}),attachShader(){},linkProgram(){},getProgramParameter:()=>true,createVertexArray:()=>({}),bindVertexArray(){},useProgram(){},getUniformLocation:(_,name)=>name,uniform2f(){},uniform1f:(name,value)=>uniforms[name]=value,drawArrays:()=>counts.draws++,viewport(){},isContextLost:()=>false,deleteShader:()=>counts.shadersDeleted++,deleteProgram:()=>counts.programsDeleted++,deleteVertexArray:()=>counts.arraysDeleted++,getExtension:()=>({loseContext:()=>counts.lost++})};
  function node(tag){const events=new Map(),n={tag,dataset:{},style:{},children:[],width:1,height:1,removed:false,setAttribute(){},append(child){this.children.push(child);},remove(){this.removed=true;},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),fire:name=>events.get(name)?.({}),getContext:()=>options.noGL?null:gl};nodes.push(n);return n;}
  const document={hidden:false,createElement:node},window={LissSceneDesignsV40:{create:(entry)=>{counts.fallbackCreates++;assert.equal(entry.staticWater,true);return{fallback:true};},paintThumbnail:()=>counts.fallbackPaints++}};
  const context={window,document,devicePixelRatio:3,requestAnimationFrame:fn=>{const key=++id;frames.set(key,fn);return key;},cancelAnimationFrame:key=>frames.delete(key)};
  vm.runInNewContext(source,context,{filename:'community-background-water-v40.js'});
  const scene=window.LissWaterFieldV40.create({id:'tideglass',style:'tideglass'},camera);
  function advance(ms){now+=ms;const batch=Array.from(frames.values());frames.clear();batch.forEach(fn=>fn(now));}
  return{scene,document,counts,frames,nodes,uniforms,advance};
}
const a=harness();
a.scene.resize(3840,2160,false);assert.ok(a.scene.inspect().canvasPixels<=650000,'4K display keeps a bounded decorative buffer');
assert.equal(a.frames.size,0,'mount starts with a still frame');
a.scene.setMotion(true);a.advance(0);const rendered=a.counts.draws;a.advance(10);assert.equal(a.counts.draws,rendered,'fast display refresh does not redraw every callback');a.advance(50);assert.ok(a.counts.draws>rendered);
a.scene.setMotion(false);assert.equal(a.frames.size,0,'pause removes the pending animation callback');const time=a.uniforms.clock;a.advance(60000);a.scene.setMotion(true);a.advance(0);assert.equal(a.uniforms.clock,time,'resume does not jump by time spent paused');
a.document.hidden=true;a.scene.setMotion(true);assert.equal(a.frames.size,0,'hidden document cannot start a water loop');a.document.hidden=false;a.scene.setMotion(true);
a.nodes[1].fire('webglcontextlost');assert.equal(a.frames.size,0);assert.ok(a.counts.fallbackPaints>0,'context loss retains a drawn water fallback');a.scene.setMotion(true);assert.equal(a.frames.size,0,'lost context cannot restart an empty animation loop');a.scene.resize(390,844,true);assert.ok(a.counts.fallbackPaints>1,'static fallback adapts to resize and theme');
a.scene.destroy();a.scene.destroy();assert.equal(a.frames.size,0);assert.equal(a.counts.shadersDeleted,2);assert.equal(a.counts.programsDeleted,1);assert.equal(a.counts.arraysDeleted,1);assert.equal(a.nodes[1].width,1);assert.equal(a.nodes[0].removed,true);
const b=harness({noGL:true});assert.equal(b.scene.fallback,true);assert.equal(b.counts.fallbackCreates,1);
const c=harness({compileFails:true});assert.equal(c.scene.fallback,true);assert.equal(c.counts.lost,1);
console.log(JSON.stringify({passed:true,scope:'CPU lifecycle only; no GPU visual claim',contracts:['bounded pixels','paced draws','pause','resume','hidden','context-loss fallback','teardown','GL unavailable','compile failure']}));
