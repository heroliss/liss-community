/* The room's real perspective geometry. One bounded WebGL canvas feeds the
   atmosphere compositor and its glass edge sampler; text remains native DOM.
   Reflections/refraction are an art-directed environment approximation. */
(function () {
  'use strict';
  var API = 'LissCrystalScene';
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function identity() { return [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]; }
  function multiply(a,b) {
    var out = new Float32Array(16);
    for(var c=0;c<4;c++)for(var r=0;r<4;r++)for(var k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];
    return out;
  }
  function normalize(a) { var l=Math.hypot(a[0],a[1],a[2])||1;return a.map(function(v){return v/l;}); }
  function cross(a,b) { return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
  function dot(a,b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
  function look(eye, target) {
    var z=normalize(eye.map(function(v,i){return v-target[i];})),x=normalize(cross([0,1,0],z)),y=cross(z,x);
    return [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1];
  }
  function perspective(aspect) {
    var f=1/Math.tan(48*Math.PI/360),n=.1,z=90;
    return [f/aspect,0,0,0,0,f,0,0,0,0,(z+n)/(n-z),-1,0,0,2*z*n/(n-z),0];
  }
  var vertex = [
    'attribute vec3 aPosition;attribute vec3 aNormal;attribute vec2 aUV;',
    'uniform mat4 uVP;uniform float uMirror;varying vec3 vPosition;varying vec3 vNormal;varying vec2 vUV;',
    'void main(){vec3 p=aPosition,n=aNormal;if(uMirror>0.5){p.y=-3.6-p.y;n.y=-n.y;}',
    'vPosition=p;vNormal=n;vUV=aUV;gl_Position=uVP*vec4(p,1.0);}'
  ].join('\n');
  var fragment = [
    'precision highp float;varying vec3 vPosition;varying vec3 vNormal;varying vec2 vUV;',
    'uniform vec3 uEye;uniform vec3 uTint;uniform vec2 uResolution;uniform float uLight;uniform float uKind;uniform float uMirror;uniform float uQuiet;',
    'vec3 environment(vec3 d){float top=smoothstep(-.4,.9,d.y);vec3 c=mix(vec3(.12,.20,.24),vec3(.48,.66,.73),top);',
    'vec3 centre=normalize(vec3(-.6,.8,.25)),axis=normalize(cross(centre,vec3(0.,0.,1.))),vertical=cross(centre,axis);',
    'float bx=dot(d,axis),by=dot(d,vertical);float box=(1.-smoothstep(.23,.30,abs(bx)))*(1.-smoothstep(.048,.075,abs(by)))*smoothstep(.50,.72,dot(d,centre));',
    'float strip=pow(max(0.,dot(d,normalize(vec3(.8,.45,-.45)))),48.);',
    'return c+vec3(.70,.84,.86)*box+vec3(.44,.62,.74)*strip;}',
    'float grain(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}',
    'vec3 ground(vec3 p){float distanceFog=exp(-max(0.,-p.z)*.07);',
    'float pool=exp(-dot(p.xz-vec2(1.3,-2.),p.xz-vec2(1.3,-2.))*.035);',
    'float caustic=exp(-pow((p.x-4.3)*.52,2.)-pow((p.z+3.5)*.15,2.));',
    'vec3 c=mix(vec3(.065,.105,.135),vec3(.14,.21,.235),pool);c+=mix(vec3(.10,.21,.25),uTint*.37,pool)*caustic*.12;',
    'float contact=exp(-pow((p.x-4.8)*.63,2.)-pow((p.z+3.)*.16,2.));c*=1.-contact*.22;',
    'return mix(vec3(.018,.031,.039),c,distanceFog);}',
    'void main(){vec3 N=normalize(vNormal),V=normalize(uEye-vPosition);if(dot(N,V)<0.)N=-N;',
    'float ndv=max(0.,dot(N,V));float fresnel=.035+.965*pow(1.-ndv,4.5);',
    'float fog=exp(-max(0.,length(uEye-vPosition)-7.)*.045);vec3 rgb;float alpha;',
    'if(uKind<.5){rgb=ground(vPosition);float halo=exp(-pow((vPosition.x-1.5)*.19,2.)-pow((vPosition.z+1.)*.13,2.));',
    'rgb=mix(rgb,environment(reflect(-V,vec3(0.,1.,0.))),.11)+vec3(.022,.038,.041)*halo;alpha=(1.-smoothstep(5.,35.,length(vPosition.xz)))*.63;',
    'if(uLight>.5)rgb=mix(vec3(.66,.76,.75),vec3(.84,.88,.85),1.-halo*.6);',
    '}else{vec3 R=reflect(-V,N);vec3 reflected=environment(R);vec3 refracted=refract(-V,N,1./1.46);',
    'float t=(-1.8-vPosition.y)/min(-.015,refracted.y);vec3 below=ground(vPosition+refracted*clamp(t,0.,35.));',
    'float bevel=pow(1.-min(min(vUV.x,1.-vUV.x),min(vUV.y,1.-vUV.y))*2.,18.);',
    'float edge=max(fresnel,bevel*.82);float broad=pow(max(0.,dot(N,normalize(vec3(-.4,.75,.6)))),18.);',
    'rgb=mix(below*.45+uTint*.25,reflected,clamp(edge*.76+.22,0.,1.));',
    'rgb+=uTint*(edge*.26+broad*.16);rgb+=vec3(.43,.63,.69)*bevel*.48;',
    'vec2 screen=gl_FragCoord.xy/max(uResolution,vec2(1.));float outer=1.-smoothstep(.10,.31,min(screen.x,1.-screen.x));',
    'rgb+=vec3(.10,.18,.21)*edge*outer;alpha=(.105+edge*.64+broad*.075)*fog;',
    'if(uKind>1.5){alpha*=.60;rgb*=.90;}',
    'if(uLight>.5){rgb=mix(vec3(.52,.68,.72),vec3(.88,.96,.94),edge*.72+.18);alpha*=.70;}',
    'if(uMirror>.5){alpha*=.42*exp(-abs(vPosition.y+1.8)*.34);rgb*=.90;}',
    '}',
    // Stable screen-space dither avoids temporal shimmer and breaks 8-bit ramps.
    'rgb+=(grain(gl_FragCoord.xy)-.5)/255.;',
    'alpha*=uQuiet;gl_FragColor=vec4(max(vec3(0.),rgb),clamp(alpha,0.,.73));}'
  ].join('\n');

  function create() {
    var canvas=document.createElement('canvas'),gl=canvas.getContext('webgl',{alpha:true,antialias:true,depth:true,premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
    if(!gl)return null;
    var shaders=[],buffers=[],meshes=[],program,closed=false,lost=false,error=null,frames=0,pixels=0,mobile=false;
    function shader(type,source){var s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)||'Crystal scene shader compile failed');return s;}
    try{program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Crystal scene link failed');}
    catch(e){error=String(e.message||e);shaders.forEach(function(s){gl.deleteShader(s);});if(program)gl.deleteProgram(program);return null;}
    var uniforms={};['VP','Mirror','Eye','Tint','Resolution','Light','Kind','Quiet'].forEach(function(n){uniforms[n]=gl.getUniformLocation(program,'u'+n);});
    var attributes=['aPosition','aNormal','aUV'].map(function(n){return gl.getAttribLocation(program,n);});
    function mesh(point,us,vs,kind){var values=[];
      function push(u,v){var p=point(u,v),eps=.0005,pu=point(clamp(u+eps,0,1),v),pv=point(u,clamp(v+eps,0,1));
        if(u>.999){pu=point(u-eps,v);pu=pu.map(function(x,i){return 2*p[i]-x;});}if(v>.999){pv=point(u,v-eps);pv=pv.map(function(x,i){return 2*p[i]-x;});}
        var n=normalize(cross(pu.map(function(x,i){return x-p[i];}),pv.map(function(x,i){return x-p[i];})));values.push(p[0],p[1],p[2],n[0],n[1],n[2],u,v);}
      for(var y=0;y<vs;y++)for(var x=0;x<us;x++){var u=x/us,v=y/vs,U=(x+1)/us,V=(y+1)/vs;push(u,v);push(U,v);push(u,V);push(U,v);push(U,V);push(u,V);}
      var buffer=gl.createBuffer();buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STATIC_DRAW);var m={buffer:buffer,count:values.length/8,kind:kind};meshes.push(m);return m;
    }
    // A single curved wall, a quiet rear window and their reflecting ground
    // make one room. No intersecting tubes, rings or near fins compete with
    // the article silhouettes or introduce lines across the reading plane.
    var floor=mesh(function(u,v){return [(u-.5)*62,-1.8,8-v*56];},1,1,0);
    var distant=mesh(function(u,v){var a=-1.22+u*2.44;return [Math.sin(a)*10.5,-1.8+v*(7.5+Math.sin(u*Math.PI)*.4),-14+Math.cos(a)*1.2];},60,8,2);
    var curve=mesh(function(u,v){var a=-.95+u*1.35;return [7.8-Math.cos(a)*3.4,-1.8+v*(9.2+Math.sin(u*Math.PI)*1.4),-5.8+Math.sin(a)*9.3];},56,9,1);
    var objects=[distant,curve];
    gl.useProgram(program);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,0);
    function resize(width,height,isMobile){mobile=!!isMobile;var limit=mobile?400000:800000,scale=Math.min(window.devicePixelRatio||1,1,Math.sqrt(limit/Math.max(1,width*height)));canvas.width=Math.max(1,Math.floor(width*scale));canvas.height=Math.max(1,Math.floor(height*scale));pixels=canvas.width*canvas.height;gl.viewport(0,0,canvas.width,canvas.height);}
    function bind(m){gl.bindBuffer(gl.ARRAY_BUFFER,m.buffer);[3,3,2].forEach(function(size,i){gl.enableVertexAttribArray(attributes[i]);gl.vertexAttribPointer(attributes[i],size,gl.FLOAT,false,32,[0,12,24][i]);});gl.uniform1f(uniforms.Kind,m.kind);gl.drawArrays(gl.TRIANGLES,0,m.count);}
    function render(state){if(closed||lost)return false;try{
      var x=clamp(state.x||0,-1,1),y=clamp(state.y||0,-1,1),scroll=clamp(state.scroll||0,0,1),rx=clamp(state.rx||0,-35,35),ry=clamp(state.ry||0,-35,35);
      var eye=[x*.9-ry*.012,1.8-y*.45+scroll*.18,10.3-scroll*1.1],aim=[.45+x*.09,1.35+y*.07,-3.8-scroll*1.2];
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);gl.uniformMatrix4fv(uniforms.VP,false,multiply(perspective(canvas.width/canvas.height),look(eye,aim)));gl.uniform3fv(uniforms.Eye,eye);gl.uniform3fv(uniforms.Tint,(state.tint||[130,190,200]).map(function(c){return c/255;}));gl.uniform2f(uniforms.Resolution,canvas.width,canvas.height);gl.uniform1f(uniforms.Light,state.light?1:0);gl.uniform1f(uniforms.Quiet,mobile ? .76 : 1);
      gl.depthMask(false);gl.uniform1f(uniforms.Mirror,1);objects.forEach(bind);
      gl.uniform1f(uniforms.Mirror,0);gl.depthMask(true);bind(floor);gl.depthMask(false);objects.forEach(bind);gl.depthMask(true);frames++;return true;
    }catch(e){error=String(e.message||e);return false;}}
    function onLost(e){e.preventDefault();lost=true;}canvas.addEventListener('webglcontextlost',onLost,false);
    return {canvas:canvas,resize:resize,render:render,inspect:function(){return {renderer:'webgl-perspective-geometry',contexts:1,frames:frames,pixels:pixels,pixelBudget:mobile?400000:800000,meshes:meshes.length,triangles:meshes.reduce(function(n,m){return n+m.count/3;},0),stableDither:true,lost:lost,error:error};},destroy:function(){if(closed)return;closed=true;canvas.removeEventListener('webglcontextlost',onLost);buffers.forEach(function(b){gl.deleteBuffer(b);});shaders.forEach(function(s){gl.deleteShader(s);});gl.deleteProgram(program);canvas.width=canvas.height=1;}};
  }
  window[API]={create:create};
})();
