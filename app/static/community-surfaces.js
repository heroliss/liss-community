/* A single shared WebGL micro-surface atlas. DOM text keeps its own 3D plane.
   Normal/roughness maps + Cook-Torrance/GGX lighting are real shader inputs;
   the CSS backdrop and the atmosphere sampler provide approximate glass
   transmission/refraction. This is not a full scene ray tracer. */
(function () {
  'use strict';
  var KEY = '__lissCommunitySurfaces';
  if (window[KEY] && window[KEY].destroy) window[KEY].destroy();
  var scriptURL = document.currentScript && document.currentScript.src;
  var textureURL = new URL('textures/material-v22/normal-roughness.png', scriptURL || document.baseURI).href;
  var lifetime = new AbortController(), dispose = null;
  var metrics = { contexts: 0, frames: 0, tiles: 0, copies: 0, textureReady: false, lost: false, failures: 0, lastError: null, active: 0, maxAtlasPixels: 0 };
  var inspectState = function () { return Object.assign({}, metrics); };
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  var vertex = [
    'attribute vec2 aPosition;',
    'varying vec2 vUv;',
    'void main(){vUv=vec2(aPosition.x*.5+.5,.5-aPosition.y*.5);gl_Position=vec4(aPosition,0.,1.);}'
  ].join('\n');
  var fragment = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uMap;',
    'uniform vec2 uSize,uAngles,uLight;',
    'uniform vec3 uBase,uAccent;',
    'uniform float uKind,uMode,uAccentMix,uReadingLimit;',
    'const float PI=3.14159265;',
    'float sq(float x){return x*x;}',
    'vec3 linearRGB(vec3 value){return mix(value/12.92,pow((value+.055)/1.055,vec3(2.4)),step(vec3(.04045),value));}',
    'vec3 displayRGB(vec3 value){return mix(value*12.92,1.055*pow(max(value,vec3(.0000001)),vec3(1./2.4))-.055,step(vec3(.0031308),value));}',
    'vec3 rotateNormal(vec3 n){',
    ' float cx=cos(uAngles.x),sx=sin(uAngles.x),cy=cos(uAngles.y),sy=sin(uAngles.y);',
    ' vec3 y=vec3(cy*n.x+sy*n.z,n.y,-sy*n.x+cy*n.z);',
    ' return normalize(vec3(y.x,cx*y.y-sx*y.z,sx*y.y+cx*y.z));',
    '}',
    'vec3 fresnel(float cosine,vec3 f0){return f0+(1.-f0)*pow(1.-cosine,5.);}',
    'vec3 specular(vec3 N,vec3 V,vec3 L,float rough,vec3 f0,bool anisotropic){',
    ' vec3 H=normalize(V+L);float nv=max(dot(N,V),.02),nl=max(dot(N,L),.02),nh=max(dot(N,H),.001);',
    ' float alpha=max(.035,rough*rough),distribution;',
    ' if(anisotropic){',
    '  vec3 T=normalize(rotateNormal(vec3(1.,0.,0.))-N*dot(rotateNormal(vec3(1.,0.,0.)),N));',
    '  vec3 B=normalize(cross(N,T));float ax=.085,ay=max(.30,rough*1.6);',
    '  distribution=1./(PI*ax*ay*sq(sq(dot(H,T)/ax)+sq(dot(H,B)/ay)+nh*nh));',
    ' }else{float a2=alpha*alpha;distribution=a2/(PI*sq(nh*nh*(a2-1.)+1.));}',
    ' float k=sq(rough+1.)/8.;float geometry=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k);',
    ' return distribution*geometry*fresnel(max(dot(V,H),0.),f0)/max(4.*nv*nl,.001);',
    '}',
    'void main(){',
    ' vec2 uv=vUv;vec2 tile=vec2(mod(uKind,2.),step(1.5,uKind));',
    ' vec2 micro=fract(uv*uSize/(uKind>1.5&&uKind<2.5?155.:190.));',
    ' vec4 data=texture2D(uMap,tile*.5+vec2(.0059)+micro*.4882);',
    ' vec2 detail=data.rg*2.-1.;float strength=uKind<.5?.20:uKind<1.5?.48:uKind<2.5?.85:.70;',
    ' vec2 edgeDistance=min(uv,1.-uv)*uSize;',
    ' float bevel=1.-smoothstep(0.,uKind<.5?9.:uKind<1.5?15.:uKind<2.5?3.:7.,min(edgeDistance.x,edgeDistance.y));',
    ' vec2 bevelNormal=vec2(0.);',
    ' if(edgeDistance.x<edgeDistance.y)bevelNormal.x=(uv.x<.5?-1.:1.);else bevelNormal.y=(uv.y<.5?1.:-1.);',
    ' vec3 N=rotateNormal(normalize(vec3(detail.x*strength+bevelNormal.x*bevel*.26,detail.y*strength+bevelNormal.y*bevel*.26,1.)));',
    ' vec2 p=vec2((uv.x-.5)*clamp(uSize.x/uSize.y,.35,2.8),.5-uv.y);',
    ' vec3 V=normalize(vec3(-p,2.8));vec3 L=normalize(vec3(uLight.x*1.9-p.x,uLight.y*1.35+.8-p.y,1.9));',
    ' float nl=max(dot(N,L),0.),nv=max(dot(N,V),.01);',
    ' vec3 substrate=uBase;',
    ' if(uAccentMix>.1)substrate=mix(substrate,vec3(dot(substrate,vec3(.2126,.7152,.0722))),.85);',
    ' vec3 base=mix(substrate,uAccent,uAccentMix);float rough=data.b;',
    ' vec3 reflectionTint=mix(vec3(1.,.98,.92),uAccent,uAccentMix>.1?.32:.18);',
    ' vec3 R=reflect(-V,N);',
    ' float softbox=exp(-sq((R.x-uLight.x*.32)/.66)-sq((R.y-uLight.y*.18-.32)/.22));',
    ' vec3 color;float opacity;',
    ' if(uKind<.5){',
    '  vec3 S=specular(N,V,L,max(.10,rough),vec3(.04),false);',
    '  float energy=dot(S,vec3(.2126,.7152,.0722));',
    '  float grazing=.04+.96*pow(1.-nv,5.);',
    '  color=mix(vec3(.68,.82,.91),uAccent,uAccentMix>.1?.35:.20)+reflectionTint*softbox*.22;',
    '  opacity=clamp(.018+grazing*.28+energy*.12+softbox*.095,0.,.24);',
    ' }else if(uKind<1.5){',
    '  vec3 S=specular(N,V,L,max(.25,rough),vec3(.045),false);',
    '  color=base*(.58+nl*.45)*(data.a*.32+.72)+S*reflectionTint*.42+reflectionTint*softbox*.20;',
    '  opacity=1.;',
    ' }else if(uKind<2.5){',
    '  float sigma=rough*rough,A=1.-.5*sigma/(sigma+.33),B=.45*sigma/(sigma+.09);',
    '  vec3 vp=V-N*nv,lp=L-N*nl;float azimuth=max(dot(normalize(vp+vec3(.0001)),normalize(lp+vec3(.0001))),0.);',
    '  float alpha=max(acos(clamp(nv,0.,1.)),acos(clamp(nl,0.,1.))),beta=min(acos(clamp(nv,0.,1.)),acos(clamp(nl,0.,1.)));',
    '  float diffuse=nl*(A+B*azimuth*sin(alpha)*tan(beta));',
    '  color=base*(.70+diffuse*.34)*(.72+data.a*.38);opacity=1.;',
    ' }else{',
    '  vec3 S=specular(N,V,L,rough,mix(vec3(.48,.57,.64),uAccent,.20),true);',
    '  float ribbon=exp(-sq((R.x-uLight.x*.30)/.18)-sq((R.y-.20)/.95));',
    '  color=base*(.60+nl*.23)*(data.a*.20+.84)+S*.32+reflectionTint*ribbon*.23;',
    '  opacity=1.;',
    ' }',
    ' if(uKind>.5){',
    '  float readPool=smoothstep(0.,.055,uv.x)*(1.-smoothstep(.945,1.,uv.x));',
    '  vec3 energy=linearRGB(max(color,vec3(0.)));',
    '  energy/=max(1.,max(max(energy.r,energy.g),energy.b));',
    '  float luminance=dot(energy,vec3(.2126,.7152,.0722));',
    '  if(uMode>.5){',
    '   float floorLight=mix(.50,uReadingLimit,readPool);',
    '   energy=mix(energy,vec3(1.),clamp((floorLight-luminance)/max(1.-luminance,.0001),0.,1.));',
    '  }else energy*=min(1.,mix(.16,uReadingLimit,readPool)/max(luminance,.0001));',
    '  color=displayRGB(energy);',
    ' }',
    ' gl_FragColor=vec4(color,opacity);',
    '}'
  ].join('\n');

  function mount() {
    if (dispose) dispose();
    if (!document.body || !document.body.classList.contains('community-room')) return;
    var body = document.body, html = document.documentElement;
    var abort = new AbortController(), signal = abort.signal;
    var reduce = matchMedia('(prefers-reduced-motion: reduce)'), fine = matchMedia('(hover:hover) and (pointer:fine)'), forced = matchMedia('(forced-colors:active)');
    var atlas = document.createElement('canvas'), gl = null, resources = null, mapImage = null;
    var scenes = [], byHost = new WeakMap(), observers = [], frame = 0, lastDraw = 0, closed = false, lost = false;
    var registryDirty = true, metadataDirty = true, layoutDirty = true, forceStatic = false;
    var pressed = false, editing = false, selecting = false, modal = false, windowActive = true, releaseTimer = 0;
    var tileWidth = 512, tileHeight = 256, maximum = 6, lightMode = false, ambient = [.62,.76,.72];
    var io = null, ro = null, mutationObserver = null, stateObserver = null;
    var parserCanvas = document.createElement('canvas'); parserCanvas.width = parserCanvas.height = 1;
    var parser = parserCanvas.getContext('2d', { willReadFrequently: true });
    var kinds = ['glass','ceramic','paper','metal'];
    var selector = '[data-material]:is([data-depth-kind="edition"],[data-depth-kind="reply"],[data-depth-kind="reader"])';
    function locked() { return pressed || editing || selecting || modal || !windowActive; }
    function blocked() { return reduce.matches || html.dataset.roomMotion === 'paused' || locked(); }
    function stop() { if (frame) cancelAnimationFrame(frame); frame = 0; }
    function schedule(staticFrame) {
      if (staticFrame) forceStatic = true;
      if (closed || lost || forced.matches || document.hidden || (blocked() && !forceStatic) || frame) return;
      frame = requestAnimationFrame(paint);
    }
    function readLocks() {
      var focused = document.activeElement;
      editing = !!(focused && focused.closest && focused.closest('input,textarea,select,[contenteditable="true"],.CodeMirror,.editor-toolbar'));
      var selection = window.getSelection(); selecting = !!(selection && !selection.isCollapsed);
      modal = !!document.querySelector('dialog[open],.CodeMirror-fullscreen,.editor-preview-active-side');
    }
    function gate() {
      if (closed) return;
      readLocks();
      if (document.hidden || forced.matches || locked() || html.dataset.roomMotion === 'paused') { stop(); return; }
      if (reduce.matches) {
        scenes.forEach(function (scene) { scene.rx = scene.ry = 0; scene.lx = 50; scene.ly = 35; scene.dirty = true; });
        schedule(true); return;
      }
      schedule(false); window.dispatchEvent(new Event('liss:surface-request'));
    }
    function parseColor(value, fallback) {
      if (!value || !parser) return fallback.slice();
      parser.clearRect(0,0,1,1); parser.fillStyle = '#000'; parser.fillStyle = value.trim(); parser.fillRect(0,0,1,1);
      var pixel = parser.getImageData(0,0,1,1).data; return [pixel[0]/255,pixel[1]/255,pixel[2]/255];
    }
    function luminance(color) {
      return color.map(function(value){return value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2.4);})
        .reduce(function(sum,value,index){return sum+value*[.2126,.7152,.0722][index];},0);
    }
    function releaseScene(scene) {
      if (io) io.unobserve(scene.host); if (ro) ro.unobserve(scene.surface);
      scene.canvas.width = scene.canvas.height = 1; scene.canvas.remove(); byHost.delete(scene.host);
      if (scene.previous === null) scene.host.removeAttribute('data-surface-renderer'); else scene.host.setAttribute('data-surface-renderer',scene.previous);
    }
    function scan() {
      registryDirty = false;
      scenes = scenes.filter(function (scene) {
        if (scene.host.isConnected && kinds.indexOf(scene.host.dataset.material) !== -1 && scene.shell.isConnected) return true;
        releaseScene(scene); return false;
      });
      document.querySelectorAll(selector).forEach(function (host) {
        if (byHost.has(host)) return;
        var surface = host.querySelector(':scope > .depth-scroll > .depth-arrival > .depth-surface');
        var shell = surface && surface.querySelector(':scope > .material-shell');
        if (!shell) return;
        var canvas = document.createElement('canvas'); canvas.className = 'material-coating'; canvas.setAttribute('aria-hidden','true');
        canvas.width = canvas.height = 1; var context = canvas.getContext('2d', { alpha: true }); if (!context) return;
        shell.appendChild(canvas);
        var scene = { host: host, surface: surface, shell: shell, canvas: canvas, context: context, previous: host.getAttribute('data-surface-renderer'),
          kind: 0, visible: !io, ratio: 0, held: false, dirty: true, metadata: true, rx: 0, ry: 0, lx: 50, ly: 35,
          width: 500, height: 300, base: [.1,.2,.2], accent: ambient.slice(), accentMix: 0, readingLimit: .045 };
        scenes.push(scene); byHost.set(host,scene); if (io) io.observe(host); if (ro) ro.observe(surface);
      });
      layoutDirty = metadataDirty = true;
    }
    function readMetadata() {
      lightMode = html.dataset.theme === 'light';
      if (metadataDirty) ambient = parseColor(getComputedStyle(body).getPropertyValue('--accent'),[.62,.76,.72]);
      scenes.forEach(function (scene) {
        if (!scene.visible || (!metadataDirty && !scene.metadata)) return;
        var style = getComputedStyle(scene.host), kind = Math.max(0,kinds.indexOf(scene.host.dataset.material));
        var palette = lightMode ? [[.78,.86,.91],[.72,.84,.66],[.87,.79,.61],[.63,.72,.81]] : [[.12,.20,.28],[.10,.25,.17],[.25,.21,.13],[.16,.22,.30]];
        scene.kind = kind; scene.base = palette[kind];
        var custom = !!scene.host.dataset.themeColor;
        // A draft/page hue must not recolor another author's unthemed post.
        var ownAccent=parseColor(style.getPropertyValue('--accent'),[.64,.87,.72]);
        scene.accent = custom ? parseColor(style.getPropertyValue('--appearance-accent'),ownAccent) : ownAccent;
        scene.accentMix = custom ? (kind === 2 ? .30 : kind === 3 ? .34 : .44) : .035;
        var foreground=['--text','--muted','--subtle','--accent'].map(function(name){
          return luminance(parseColor(style.getPropertyValue(name),lightMode?[.30,.35,.32]:[.67,.70,.68]));
        });
        // Opaque materials own their reading background. A shared exposure
        // scale, not independent channel clipping, keeps its chromaticity.
        scene.readingLimit=lightMode?clamp((4.5*(Math.max.apply(Math,foreground)+.05)-.05)+.025,.62,.96):
          clamp(((Math.min.apply(Math,foreground)+.05)/4.5-.05)*.92,.018,.085);
        if (!scene.hasPose) { scene.rx = parseFloat(style.getPropertyValue('--depth-rest-rx')) || 0; scene.ry = parseFloat(style.getPropertyValue('--depth-rest-ry')) || 0; }
        scene.metadata = false; scene.dirty = true;
      });
      metadataDirty = false;
    }
    function readLayout() {
      scenes.forEach(function (scene) {
        if (!scene.visible) return;
        scene.width = Math.max(1,scene.surface.offsetWidth); scene.height = Math.max(1,scene.surface.offsetHeight);
      }); layoutDirty = false;
    }
    function compile(type, source) {
      var shader = gl.createShader(type); gl.shaderSource(shader,source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) { var log = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(log || 'Material shader compile failed'); }
      return shader;
    }
    function createResources() {
      var vs = compile(gl.VERTEX_SHADER,vertex), fs = compile(gl.FRAGMENT_SHADER,fragment), program = gl.createProgram();
      gl.attachShader(program,vs); gl.attachShader(program,fs); gl.linkProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(program,gl.LINK_STATUS)) { gl.deleteProgram(program); throw new Error('Material shader link failed'); }
      var buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      var texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      var uniforms = {}; ['uMap','uSize','uAngles','uLight','uBase','uAccent','uKind','uMode','uAccentMix','uReadingLimit'].forEach(function (name) { uniforms[name] = gl.getUniformLocation(program,name); });
      return { program: program, buffer: buffer, texture: texture, position: gl.getAttribLocation(program,'aPosition'), uniforms: uniforms, ready: false };
    }
    function uploadMap() {
      if (!resources || !mapImage || !mapImage.complete || !mapImage.naturalWidth || lost || closed) return;
      gl.bindTexture(gl.TEXTURE_2D,resources.texture); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,mapImage); gl.generateMipmap(gl.TEXTURE_2D);
      resources.ready = true; metrics.textureReady = true; scenes.forEach(function (scene) { scene.dirty = true; }); schedule(true);
    }
    function configureAtlas() {
      var coarse = !fine.matches || window.innerWidth < 700;
      tileWidth = coarse ? 256 : 512; tileHeight = 256; maximum = coarse ? 4 : 6;
      var w = tileWidth * 2, h = tileHeight * (maximum / 2);
      if (atlas.width !== w) atlas.width = w; if (atlas.height !== h) atlas.height = h;
      metrics.maxAtlasPixels = Math.max(metrics.maxAtlasPixels,w*h);
    }
    function render(items) {
      var r = resources, u = r.uniforms;
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.enable(gl.SCISSOR_TEST); gl.useProgram(r.program);
      gl.bindBuffer(gl.ARRAY_BUFFER,r.buffer); gl.enableVertexAttribArray(r.position); gl.vertexAttribPointer(r.position,2,gl.FLOAT,false,0,0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,r.texture); gl.uniform1i(u.uMap,0);
      items.forEach(function (scene,index) {
        var x = index % 2 * tileWidth, y = atlas.height - (Math.floor(index/2)+1)*tileHeight;
        gl.viewport(x,y,tileWidth,tileHeight); gl.scissor(x,y,tileWidth,tileHeight); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        // CSS has a downward Y axis; the shader's tangent space is Y-up.
        gl.uniform2f(u.uSize,scene.width,scene.height); gl.uniform2f(u.uAngles,-scene.rx*Math.PI/180,scene.ry*Math.PI/180);
        gl.uniform2f(u.uLight,(scene.lx-50)/50,(50-scene.ly)/50); gl.uniform3fv(u.uBase,scene.base); gl.uniform3fv(u.uAccent,scene.accent);
        gl.uniform1f(u.uKind,scene.kind); gl.uniform1f(u.uMode,lightMode?1:0); gl.uniform1f(u.uAccentMix,scene.accentMix);gl.uniform1f(u.uReadingLimit,scene.readingLimit);
        gl.drawArrays(gl.TRIANGLES,0,6); metrics.tiles++;
      });
      items.forEach(function (scene,index) {
        if (scene.canvas.width !== tileWidth) scene.canvas.width = tileWidth;
        if (scene.canvas.height !== tileHeight) scene.canvas.height = tileHeight;
        scene.context.clearRect(0,0,tileWidth,tileHeight);
        scene.context.drawImage(atlas,index%2*tileWidth,Math.floor(index/2)*tileHeight,tileWidth,tileHeight,0,0,tileWidth,tileHeight);
        if (scene.host.dataset.surfaceRenderer !== 'webgl') scene.host.dataset.surfaceRenderer = 'webgl';
        scene.dirty = false; metrics.copies++;
      }); metrics.frames++;
    }
    function paint(now) {
      frame = 0;
      if (closed || lost || document.hidden || forced.matches || (blocked() && !forceStatic)) return;
      if (registryDirty) scan(); if (layoutDirty) readLayout(); readMetadata();
      if (!resources || !resources.ready) { forceStatic = false; return; }
      var statically = forceStatic; forceStatic = false;
      var visible = scenes.filter(function (scene) { return scene.visible && scene.host.isConnected && scene.host.dataset.depthFullscreen !== 'true'; });
      metrics.active = visible.length;
      var items = visible.filter(function (scene) { return scene.dirty && (statically || !scene.held); }).sort(function (a,b) { return b.ratio-a.ratio; }).slice(0,maximum);
      if (!items.length) return;
      // Material light responds at 24fps (18 on touch); card geometry remains
      // on the original native-rate controller. No work survives settling.
      var interval = 1000/(fine.matches ? 24 : 18);
      if (!statically && lastDraw && now-lastDraw < interval) { schedule(false); return; }
      render(items); lastDraw = now;
      if (!blocked() && visible.some(function (scene) { return scene.dirty && !scene.held; })) schedule(false);
    }
    function metadata(target) {
      if (target && byHost.has(target)) { var scene = byHost.get(target); scene.metadata = scene.dirty = true; }
      else { metadataDirty = true; scenes.forEach(function (scene) { scene.metadata = scene.dirty = true; }); }
      schedule(true);
    }
    function onPose(event) {
      var detail = event.detail;
      if (!detail || !detail.active) { stop(); return; }
      if (blocked() || document.hidden) return;
      (detail.poses || []).forEach(function (pose) {
        var scene = byHost.get(pose.host); if (!scene) return;
        scene.held = !!pose.held;
        if (scene.held) return;
        function number(name,fallback,min,max){var value=Number(pose[name]);return Number.isFinite(value)?clamp(value,min,max):fallback;}
        var next = [number('rx',0,-60,60),number('ry',0,-60,60),number('lightX',50,0,100),number('lightY',35,0,100)];
        if (!scene.hasPose || Math.abs(next[0]-scene.rx)>.08 || Math.abs(next[1]-scene.ry)>.08 || Math.abs(next[2]-scene.lx)>.35 || Math.abs(next[3]-scene.ly)>.35) {
          scene.rx=next[0];scene.ry=next[1];scene.lx=next[2];scene.ly=next[3];scene.dirty=true;scene.hasPose=true;
        }
      }); schedule(false);
    }
    function restoreFallback() {
      scenes.forEach(function (scene) { scene.canvas.width=scene.canvas.height=1; if(scene.previous===null)scene.host.removeAttribute('data-surface-renderer');else scene.host.setAttribute('data-surface-renderer',scene.previous); });
    }
    try {
      gl = atlas.getContext('webgl',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
      if (!gl) { metrics.failures++; metrics.lastError='WebGL unavailable'; return; }
      metrics.contexts++; configureAtlas(); resources = createResources();
    } catch (error) { metrics.failures++;metrics.lastError=String(error.message||error).slice(0,400); if(gl) { var failed=gl.getExtension('WEBGL_lose_context');if(failed)failed.loseContext(); } return; }
    atlas.addEventListener('webglcontextlost',function (event) { event.preventDefault(); lost=true;metrics.lost=true;metrics.textureReady=false;stop();restoreFallback(); },{signal:signal});
    atlas.addEventListener('webglcontextrestored',function () {
      if (closed) return; lost=false;metrics.lost=false;
      try { resources=createResources();uploadMap(); } catch(error) { metrics.failures++;metrics.lastError=String(error.message||error).slice(0,400);lost=true;restoreFallback(); }
    },{signal:signal});
    if (window.IntersectionObserver) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var scene=byHost.get(entry.target);if(!scene)return;scene.visible=entry.isIntersecting;scene.ratio=entry.intersectionRatio||0;
          if(scene.visible){scene.dirty=scene.metadata=true;layoutDirty=true;}else scene.canvas.width=scene.canvas.height=1;
        });schedule(false);
      },{rootMargin:'100px',threshold:[0,.1,.5,1]});observers.push(io);
    }
    if (window.ResizeObserver) {
      ro = new ResizeObserver(function (entries) {
        entries.forEach(function (entry) { scenes.forEach(function (scene) {
          if(scene.surface!==entry.target)return;
          var box=entry.borderBoxSize, size=box&&(box[0]||box);
          scene.width=Math.max(1,size?size.inlineSize:entry.target.offsetWidth);scene.height=Math.max(1,size?size.blockSize:entry.target.offsetHeight);scene.dirty=true;
        }); });
        schedule(false);
      });observers.push(ro);
    }
    mutationObserver = new MutationObserver(function (entries) {
      var changed=false;
      entries.forEach(function (entry) {
        if(entry.type==='attributes'&&entry.attributeName==='data-material'){var scene=byHost.get(entry.target);if(scene)scene.metadata=scene.dirty=true;else registryDirty=true;changed=true;}
        if(entry.type==='attributes'&&entry.attributeName==='data-depth-fullscreen'){changed=true;}
        if(entry.type==='childList'&&Array.from(entry.addedNodes).concat(Array.from(entry.removedNodes)).some(function(node){return node.nodeType===1&&((node.matches&&node.matches(selector))||(node.querySelector&&node.querySelector(selector)));})){registryDirty=true;changed=true;}
      });if(changed)schedule(true);
    });mutationObserver.observe(body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-material','data-depth-fullscreen']});observers.push(mutationObserver);
    stateObserver = new MutationObserver(function (entries) { if(entries.some(function(entry){return entry.attributeName==='data-theme';}))metadata();gate(); });
    stateObserver.observe(html,{attributes:true,attributeFilter:['data-theme','data-room-motion']});observers.push(stateObserver);
    var dialogObserver=new MutationObserver(gate);dialogObserver.observe(body,{subtree:true,attributes:true,attributeFilter:['open']});observers.push(dialogObserver);
    window.addEventListener('liss:surface-frame',onPose,{signal:signal});
    document.addEventListener('liss:appearance-change',function(event){metadata(event.detail&&event.detail.target);},{signal:signal});
    window.addEventListener('liss:theme-change',function(){metadata();},{signal:signal});
    window.addEventListener('liss:motion-state',gate,{signal:signal});
    document.addEventListener('focusin',gate,{signal:signal});document.addEventListener('focusout',function(){queueMicrotask(gate);},{signal:signal});
    document.addEventListener('selectionchange',gate,{signal:signal});document.addEventListener('visibilitychange',gate,{signal:signal});
    document.addEventListener('pointerdown',function(event){if(event.isPrimary&&event.button===0){pressed=true;stop();}},{capture:true,passive:true,signal:signal});
    function release(){if(releaseTimer)clearTimeout(releaseTimer);releaseTimer=setTimeout(function(){releaseTimer=0;pressed=false;gate();},0);}
    window.addEventListener('pointerup',release,{passive:true,signal:signal});window.addEventListener('pointercancel',release,{passive:true,signal:signal});
    window.addEventListener('blur',function(){windowActive=false;pressed=false;gate();},{signal:signal});window.addEventListener('focus',function(){windowActive=true;gate();},{signal:signal});
    window.addEventListener('resize',function(){configureAtlas();layoutDirty=true;scenes.forEach(function(scene){scene.dirty=true;});schedule(true);},{passive:true,signal:signal});
    reduce.addEventListener('change',gate,{signal:signal});forced.addEventListener('change',gate,{signal:signal});
    fine.addEventListener('change',function(){configureAtlas();scenes.forEach(function(scene){scene.dirty=true;});schedule(true);},{signal:signal});
    mapImage = new Image(); mapImage.onload = uploadMap; mapImage.onerror = function(){metrics.failures++;metrics.lastError='Material normal map could not be loaded';};mapImage.src=textureURL;
    scan();readLocks();schedule(true);window.dispatchEvent(new Event('liss:surface-request'));
    inspectState = function () { return Object.assign({},metrics,{registered:scenes.length,framePending:!!frame,atlasWidth:atlas.width,atlasHeight:atlas.height,visible:scenes.filter(function(scene){return scene.visible;}).length,
      materials:scenes.filter(function(scene){return scene.visible;}).slice(0,8).map(function(scene){return {kind:kinds[scene.kind],accent:scene.accent,accentMix:scene.accentMix,readingLimit:scene.readingLimit};})}); };
    dispose = function () {
      if(closed)return;closed=true;stop();abort.abort();if(releaseTimer)clearTimeout(releaseTimer);observers.forEach(function(observer){observer.disconnect();});
      if(mapImage){mapImage.onload=mapImage.onerror=null;mapImage.removeAttribute('src');}
      scenes.forEach(releaseScene);scenes=[];
      if(resources&&!lost){gl.deleteTexture(resources.texture);gl.deleteBuffer(resources.buffer);gl.deleteProgram(resources.program);}
      var lose=gl.getExtension('WEBGL_lose_context');if(lose)lose.loseContext();atlas.width=atlas.height=1;parserCanvas.width=parserCanvas.height=1;
      resources=null;metrics.active=0;metrics.textureReady=false;
    };
  }
  window.addEventListener('pagehide',function(){if(dispose)dispose();},{signal:lifetime.signal});
  window.addEventListener('pageshow',function(event){if(event.persisted)mount();},{signal:lifetime.signal});
  window[KEY]={destroy:function(){if(dispose)dispose();lifetime.abort();delete window[KEY];},inspect:function(){return inspectState();}};
  mount();
})();
