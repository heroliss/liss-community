/* A bounded 2D optical water field. One fullscreen triangle, no scene graph,
   model assets or texture downloads. Motion is owned by the room controller. */
(function(){
  'use strict';
  var vertex='#version 300 es\nprecision highp float;out vec2 uv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0,1);}';
  var fragment=`#version 300 es
precision highp float;
in vec2 uv;out vec4 colour;
uniform vec2 resolution;uniform float clock;uniform float lightTheme;
void swell(vec2 p,vec2 direction,float amplitude,float speed,inout vec2 slope){float phase=dot(p,direction)+speed*clock;slope+=amplitude*cos(phase)*direction;}
vec2 surfaceSlope(vec2 p){vec2 slope=vec2(0.);swell(p,vec2(7.2,5.1),.024,.22,slope);swell(p,vec2(-4.7,9.3),.016,-.17,slope);swell(p,vec2(13.4,-6.2),.009,.13,slope);swell(p,vec2(28.,19.),.0035,.37,slope);swell(p,vec2(-35.,24.),.002,-.29,slope);return slope;}
vec2 hash22(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.xx+q.yz)*q.zy);}
float lightCells(vec2 p){
 vec2 q=p*10.;q+=1.15*vec2(sin(q.y*.72+clock*.17),sin(q.x*.67-clock*.13));q+=.38*vec2(sin(q.y*1.21+q.x*.28-clock*.11),sin(q.x*1.14-q.y*.31+clock*.09));vec2 cell=floor(q),f=fract(q);float first=9.,second=9.;
 for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 offset=vec2(float(i),float(j)),seed=hash22(cell+offset),point=.5+.38*sin(clock*.19+6.2831853*seed),delta=offset+point-f;float d=dot(delta,delta);if(d<first){second=first;first=d;}else second=min(second,d);}
 float edge=(sqrt(second)-sqrt(first));return exp(-edge*35.);
}
float softEllipse(vec2 p,vec2 center,vec2 size){return 1.-smoothstep(.86,1.02,length((p-center)/size));}
void main(){
 vec2 p=vec2((uv.x-.5)*resolution.x/resolution.y,uv.y-.5);
 p=mat2(.977,-.213,.213,.977)*p;
 float t=clock;vec2 slope=surfaceSlope(p);
 vec3 normal=normalize(vec3(-slope.x,.9,-slope.y));
 vec2 floorPoint=p+normal.xz*.095;
 float belt=exp(-pow((p.y-.22*p.x+.025)/.43,2.));
 vec3 deep=mix(vec3(.055,.155,.19),vec3(.53,.71,.72),lightTheme);
 vec3 shallows=mix(vec3(.14,.36,.40),vec3(.71,.83,.77),lightTheme);
 vec3 water=mix(deep,shallows,belt*.83);
 float sand=.5+.5*sin(floorPoint.x*2.8+floorPoint.y*1.4);
 water=mix(water,water*vec3(1.08,1.055,.93),sand*.22);
 // An illustrated focus network travels through the refracted floor field.
 // Analytic surface normals provide the broader moving reflection and depth.
 float caustic=lightCells(floorPoint)*belt;
 water+=mix(vec3(.17,.22,.18),vec3(.10,.13,.08),lightTheme)*caustic*.30;
 float reflection=pow(max(0.,dot(reflect(normalize(vec3(-.36,-1.,.24)),normal),normalize(vec3(.15,1.,.37)))),18.);
 float fresnel=pow(1.-max(0.,dot(normal,normalize(vec3(.12,1.,.35)))),3.);
 water+=vec3(.25,.34,.34)*reflection*.22+vec3(.18,.24,.27)*fresnel*.13;
 // A small submerged stone group supports the oblique composition at one edge.
 vec2 stone=vec2(.31,.23);float s1=softEllipse(floorPoint,stone,vec2(.043,.023));
 float s2=softEllipse(floorPoint,stone+vec2(.054,.026),vec2(.025,.017));
 float s3=softEllipse(floorPoint,stone+vec2(-.032,.039),vec2(.016,.010));
 water=mix(water,water*vec3(.66,.76,.75),max(s1,max(s2,s3))*.42);
 vec2 d=floorPoint-vec2(-.35,-.16);float rings=.5+.5*sin(length(d)*105.-t*.7);
 float ringFade=exp(-length(d)*11.)*.014;water+=vec3(rings*ringFade);
 float shade=.97+.025*dot(normal,normalize(vec3(-.4,1.,.3)));
 colour=vec4(clamp(water*shade,0.,1.),1.);
}`;
  function create(entry,camera){
    var root=document.createElement('div'),canvas=document.createElement('canvas');
    root.className='community-vector-scene community-procedural-scene scene40';root.dataset.vectorStyle='tideglass';root.dataset.sceneRevision='v40';root.dataset.sceneMotion='paused';root.setAttribute('aria-hidden','true');canvas.className='scene40-water';root.append(canvas);
    var gl=null,program=null,vao=null,shaders=[],closed=false,running=false,frame=0,last=0,time=0,field=null,signature='',draws=0,light=false,unavailable=false,fallbackCanvas=null;
    try{
      gl=canvas.getContext('webgl2',{alpha:false,antialias:false,powerPreference:'low-power'});if(!gl)throw Error('WebGL2 unavailable');
      function compile(type,text){var shader=gl.createShader(type);gl.shaderSource(shader,text);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));shaders.push(shader);return shader;}
      program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
      vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.useProgram(program);root.dataset.waterRenderer='webgl2';
    }catch(error){
      if(gl){shaders.forEach(function(shader){gl.deleteShader(shader);});if(program)gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();}
      root.remove();return window.LissSceneDesignsV40.create(Object.assign({},entry,{style:'tideglass',staticWater:true}),camera);
    }
    var loc={resolution:gl.getUniformLocation(program,'resolution'),clock:gl.getUniformLocation(program,'clock'),light:gl.getUniformLocation(program,'lightTheme')};
    function draw(){if(closed||unavailable||gl.isContextLost())return;gl.useProgram(program);gl.bindVertexArray(vao);gl.uniform2f(loc.resolution,canvas.width,canvas.height);gl.uniform1f(loc.clock,time);gl.uniform1f(loc.light,light?1:0);gl.drawArrays(gl.TRIANGLES,0,3);draws++;}
    function drawFallback(){if(!fallbackCanvas)return;fallbackCanvas.width=canvas.width;fallbackCanvas.height=canvas.height;window.LissSceneDesignsV40.paintThumbnail(fallbackCanvas,'tideglass',light);}
    function tick(now){frame=0;if(closed||!running)return;frame=requestAnimationFrame(tick);if(last&&now-last<1000/24-1)return;var dt=last?Math.min(.08,(now-last)/1000):0;last=now;time+=dt;draw();}
    function resize(width,height,isLight){
      if(closed)return;var next=[Math.round(width),Math.round(height),!!isLight,devicePixelRatio||1].join(':');if(next===signature)return field;signature=next;light=!!isLight;
      field={width:Math.max(1,width)+camera.overscan*2,height:Math.max(1,height)*camera.viewportSpan+camera.overscan*2,viewportSpan:camera.viewportSpan,overscan:camera.overscan,travel:Math.max(1,height)*(camera.viewportSpan-1),scrollRate:camera.scrollRate,viewBoxHeight:camera.viewBoxHeight};
      root.style.width=field.width+'px';root.style.height=field.height+'px';root.style.left=root.style.top=-camera.overscan+'px';root.style.right=root.style.bottom='auto';root.dataset.sceneTheme=light?'light':'dark';
      var scale=Math.min(1,devicePixelRatio||1,Math.sqrt((entry.preview?140000:650000)/(field.width*field.height)));canvas.width=Math.max(1,Math.floor(field.width*scale));canvas.height=Math.max(1,Math.floor(field.height*scale));if(unavailable)drawFallback();else{gl.viewport(0,0,canvas.width,canvas.height);draw();}return field;
    }
    function setMotion(value){if(closed)return;running=!!value&&!document.hidden&&!unavailable;root.dataset.sceneMotion=unavailable?'unavailable':running?'running':'paused';if(running&&!frame){last=0;frame=requestAnimationFrame(tick);}if(!running){cancelAnimationFrame(frame);frame=0;last=0;}}
    var lost=function(){unavailable=true;setMotion(false);root.dataset.waterRenderer='static-after-context-loss';canvas.style.opacity='0';fallbackCanvas=document.createElement('canvas');fallbackCanvas.className='scene40-paint';root.append(fallbackCanvas);drawFallback();};canvas.addEventListener('webglcontextlost',lost);
    return{element:root,resize:resize,setMotion:setMotion,inspect:function(){return{style:'tideglass',revision:'v40',technique:unavailable?'canvas2d-water-fallback':'webgl2-optical-field',field:field?Object.assign({},field):null,canvasPixels:canvas.width*canvas.height,canvasPixelBudget:entry.preview?140000:650000,draws:draws,ownRAF:!unavailable,imageRequests:0,glContexts:unavailable?0:1,decorativeMotion:{engine:unavailable?'static-fallback':'bounded-webgl',targetHz:24,running:running,continuousJS:running,fullSceneRotation:false}};},destroy:function(){if(closed)return;setMotion(false);closed=true;canvas.removeEventListener('webglcontextlost',lost);shaders.forEach(function(shader){gl.deleteShader(shader);});gl.deleteVertexArray(vao);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();canvas.width=canvas.height=1;if(fallbackCanvas)fallbackCanvas.width=fallbackCanvas.height=1;root.remove();}};
  }
  window.LissWaterFieldV40={create:create};
})();
