/* A single shared WebGL micro-surface atlas. DOM text keeps its own 3D plane.
   Normal/roughness maps + Cook-Torrance/GGX lighting are real shader inputs;
   one native CSS backdrop supplies the glass face; separate CSS side planes
   supply thickness. No background bitmap is sampled through the edge. */
(function () {
  'use strict';
  var KEY = '__lissCommunitySurfaces';
  if (window[KEY] && window[KEY].destroy) window[KEY].destroy();
  var scriptURL = document.currentScript && document.currentScript.src;
  var textureURL = new URL('textures/material-v22/normal-roughness.png', scriptURL || document.baseURI).href;
  var lifetime = new AbortController(), dispose = null;
  var metrics = { version: 'room-material-v30', encoding: 'srgb8-sdr', dither: 'stable-object-space', bevelNormal: 'material-specific-flat-chamfer-or-soft-shoulder', shapeProfiles: ['crystal-plane','ceramic-rim','paper-sheet','folded-metal','leather-pad','cork-cut','slate-cleft'], transmission: 'native-backdrop', edgeSampling: false, antialias: 'analytic-rounded-coverage', lighting: 'upper-left-area-key+ambient', pigment: 'shared-css-gpu', materialContrast: 'intrinsic-grain-in-reading-budget', materialKinds: 7, atlasSources: 4, contexts: 0, frames: 0, tiles: 0, copies: 0, textureReady: false, lost: false, failures: 0, lastError: null, active: 0, maxAtlasPixels: 0 };
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
    'uniform vec2 uSize,uAngles,uLight,uTileSize;',
    'uniform mat3 uWorld;',
    'uniform vec4 uCorners;',
    'uniform vec3 uBase,uAccent;',
    'uniform float uKind,uMode,uAccentMix,uReadingLimit;',
    'const float PI=3.14159265;',
    'float sq(float x){return x*x;}',
    'vec3 linearRGB(vec3 value){return mix(value/12.92,pow((value+.055)/1.055,vec3(2.4)),step(vec3(.04045),value));}',
    'vec3 displayRGB(vec3 value){return mix(value*12.92,1.055*pow(max(value,vec3(.0000001)),vec3(1./2.4))-.055,step(vec3(.0031308),value));}',
    'vec3 rotateNormal(vec3 n){',
    ' float cx=cos(uAngles.x),sx=sin(uAngles.x),cy=cos(uAngles.y),sy=sin(uAngles.y);',
    ' vec3 y=vec3(cy*n.x+sy*n.z,n.y,-sy*n.x+cy*n.z);',
    ' return normalize(uWorld*vec3(y.x,cx*y.y-sx*y.z,sx*y.y+cx*y.z));',
    '}',
    'vec3 fresnel(float cosine,vec3 f0){return f0+(1.-f0)*pow(1.-cosine,5.);}',
    // Object-space, not time-based grain: it breaks 8-bit contouring without
    // sparkling when the pointer or camera is at rest. This remains SDR.
    'float dither(vec2 p){return fract(52.9829189*fract(dot(floor(p),vec2(.06711056,.00583715))))-.5;}',
    // Stable, band-limited cells. New materials reuse the existing four map
    // tiles; two cheap object-space noise fields need no texture or frame loop.
    'float hash21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}',
    'float noise21(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+vec2(1.,1.)),f.x),f.y);}',
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
    // IDs 4/5/6 are leather/cork/slate. Explicit tile remapping prevents a
    // new material from sampling beyond the existing 2x2 normal atlas.
    ' vec2 uv=vUv;float atlasKind=uKind<3.5?uKind:uKind<4.5?1.:uKind<5.5?2.:3.;',
    ' vec2 tile=vec2(mod(atlasKind,2.),step(1.5,atlasKind));',
    ' vec2 micro=fract(uv*uSize/(atlasKind>1.5&&atlasKind<2.5?155.:190.));',
    ' vec4 data=texture2D(uMap,tile*.5+vec2(.0059)+micro*.4882);',
    ' vec2 physical=uv*min(uSize,uTileSize*1.5);float coarse=.5,fineGrain=.5,strata=0.;',
    ' if(uKind>3.5){coarse=noise21(physical/12.);fineGrain=noise21(physical/3.6+vec2(19.7,4.9));strata=sin(physical.y*.108+sin(physical.x*.018)*1.35);}',
    ' vec2 detail=data.rg*2.-1.;float strength=uKind<.5?.115:uKind<1.5?.48:uKind<2.5?.78:uKind<3.5?.72:uKind<4.5?.88:uKind<5.5?.54:.66;',
    ' vec2 edgeDistance=min(uv,1.-uv)*uSize;',
    // Hard materials have a flat chamfer, not the same cylindrical shoulder
    // on every left/right edge. Only ceramic and leather keep a soft roll.
    ' float bevelWidth=uKind<.5?2.4:uKind<1.5?15.:uKind<2.5?1.1:uKind<3.5?1.6:uKind<4.5?10.:uKind<5.5?1.3:1.8;',
    ' vec2 edgeWeight;',
    ' if((uKind>.5&&uKind<1.5)||(uKind>3.5&&uKind<4.5))edgeWeight=1.-smoothstep(vec2(0.),vec2(bevelWidth),edgeDistance);',
    ' else edgeWeight=(1.-smoothstep(vec2(bevelWidth-.55),vec2(bevelWidth+.55),edgeDistance))*.78;',
    ' float bevel=max(edgeWeight.x,edgeWeight.y);',
    ' vec2 bevelNormal=vec2((uv.x<.5?-1.:1.)*edgeWeight.x,(uv.y<.5?1.:-1.)*edgeWeight.y);',
    ' float bevelLength=length(bevelNormal);bevelNormal=bevelLength>.0001?bevelNormal/bevelLength:vec2(0.);',
    ' float normalDepth=uKind<.5?.13:uKind<1.5?.40:uKind<2.5?.035:uKind<3.5?.12:uKind<4.5?.24:uKind<5.5?.075:.14;',
    // A handled paper sheet is flat except for its small bottom-right curl.
    // A full-height crease used to make even paper look like a bent panel.
    ' vec2 paperCorner=(1.-uv)*uSize;',
    ' float paperCurl=exp(-sq((paperCorner.x+paperCorner.y-26.)/3.2))*(1.-smoothstep(28.,36.,max(paperCorner.x,paperCorner.y)));',
    ' vec2 formNormal=uKind>1.5&&uKind<2.5?vec2(-.055,.045)*paperCurl:vec2(0.);',
    ' if(uKind>3.5&&uKind<4.5)formNormal=vec2((uv.x-.5)*.18,(.5-uv.y)*.14)+vec2(coarse-.5,fineGrain-.5)*.10;',
    ' if(uKind>4.5&&uKind<5.5)formNormal=vec2(fineGrain-.5,coarse-.5)*.03;',
    ' if(uKind>5.5)formNormal=vec2(strata*.012,strata*.035+(coarse-.5)*.025);',
    ' vec3 N=rotateNormal(normalize(vec3(detail.x*strength+bevelNormal.x*bevel*normalDepth+formNormal.x,detail.y*strength+bevelNormal.y*bevel*normalDepth+formNormal.y,1.)));',
    ' vec2 p=vec2((uv.x-.5)*clamp(uSize.x/uSize.y,.35,2.8),.5-uv.y);',
    // A room-space key stays above/left as the card and its normal rotate.
    // The pointer only modulates its position slightly; it does not carry a
    // second light from one card edge to the other.
    ' vec3 V=normalize(vec3(-p,2.8));vec3 L=normalize(vec3(-1.15-p.x*.12,1.25-p.y*.12,2.4));',
    ' float nl=max(dot(N,L),0.),nv=max(dot(N,V),.01);',
    ' vec3 base=uBase;float rough=data.b;',
    ' vec3 reflectionTint=mix(vec3(1.,.98,.92),uAccent,uAccentMix>.1?.32:.18);',
    ' vec3 R=reflect(-V,N);',
    ' float softbox=exp(-sq((R.x+.38)/.34)-sq((R.y-.42)/.50));',
    ' vec3 edgeDirection=bevelLength>.0001?vec3(bevelNormal,0.):vec3(0.,0.,1.);',
    ' float edgeLight=bevelLength>.0001?max(dot(rotateNormal(edgeDirection),L),0.):0.;',
    ' vec3 color;float opacity;float intrinsic=.5;',
    ' if(uKind<.5){',
    '  vec3 S=specular(N,V,L,max(.075,rough*.82),vec3(.04),false);',
    '  float energy=dot(S,vec3(.2126,.7152,.0722));',
    '  float grazing=.04+.96*pow(1.-nv,5.);',
    // One broad key reflection and weak ambient fill. Only key-facing bevels
    // catch the strong polished edge; the opposite side absorbs light.
    '  float keyWindow=exp(-sq((R.x+R.y*.20+.36)/.13)-sq((R.y-.24)/.72));',
    '  float reflected=softbox*.045+keyWindow*.11;',
    '  float innerInterface=exp(-sq((min(edgeDistance.x,edgeDistance.y)-bevelWidth*.72)/.6));',
    '  float rim=bevel*(.006+edgeLight*(.10+grazing*.32+keyWindow*.30))+innerInterface*(.003+edgeLight*keyWindow*.05);',
    '  vec3 cool=mix(vec3(.82,.94,1.),uAccent,uAccentMix>.1?.16:.035);',
    '  vec3 warm=vec3(1.,.965,.875);',
    '  color=mix(cool,warm,clamp(keyWindow*.16,0.,.16))+reflectionTint*softbox*.07;',
    '  float faceReflection=clamp(.009+grazing*.19+min(energy,.5)*.06+reflected,0.,.135);',
    '  opacity=clamp(faceReflection+rim,0.,.44);',
    ' }else if(uKind<1.5){',
    // Ceramic is a thick domed glaze: a wide soft pool with a rounded shoulder,
    // while the matte pits use the already loaded normal/roughness atlas.
    '  vec3 S=specular(N,V,L,clamp(rough*.85,.20,.42),vec3(.045),false);',
    '  float glazePool=exp(-sq((R.x+.30)/.48)-sq((R.y-.40)/.58));',
    '  float glazeShoulder=smoothstep(0.,12.,min(edgeDistance.x,edgeDistance.y));',
    '  color=base*(.44+nl*.67)*(.80+data.a*.29)*(.91+glazeShoulder*.09)+S*reflectionTint*.38+reflectionTint*glazePool*.075;',
    '  intrinsic=clamp((data.a-.81)*18.+.5,0.,1.);',
    '  opacity=1.;',
    ' }else if(uKind<2.5){',
    '  float sigma=rough*rough,A=1.-.5*sigma/(sigma+.33),B=.45*sigma/(sigma+.09);',
    '  vec3 vp=V-N*nv,lp=L-N*nl;float azimuth=max(dot(normalize(vp+vec3(.0001)),normalize(lp+vec3(.0001))),0.);',
    '  float alpha=max(acos(clamp(nv,0.,1.)),acos(clamp(nl,0.,1.))),beta=min(acos(clamp(nv,0.,1.)),acos(clamp(nl,0.,1.)));',
    '  float diffuse=nl*(A+B*azimuth*sin(alpha)*tan(beta));',
    '  vec2 fibreScale=min(uSize,uTileSize*1.5);',
    '  float fibres=sin(uv.y*fibreScale.y*.59+sin(uv.x*fibreScale.x*.043)*1.4)*sin(uv.x*fibreScale.x*.17);',
    // Fibres and the small corner curl remain attached to the sheet rather
    // than shimmering in screen space during scroll.
    '  float foldShade=1.-.045*paperCurl;',
    '  color=base*(.57+diffuse*.54)*(.76+data.a*.34+fibres*.10)*foldShade;opacity=1.;',
    '  intrinsic=clamp((data.a-.81)*2.8+.5+fibres*.18,0.,1.);',
    ' }else if(uKind<3.5){',
    '  vec3 S=specular(N,V,L,rough,mix(vec3(.48,.57,.64),uAccent,.20),true);',
    // Anodised metal has an elongated, directional reflection. Its machining
    // bands are deliberately broader than a subpixel line at atlas resolution.
    '  float ribbon=exp(-sq((R.x+.39)/.14)-sq((R.y-.36)/.95));',
    '  float brush=.96+.04*sin(uv.y*min(uSize.y,uTileSize.y)*1.35+data.a*2.);',
    '  color=base*(.47+nl*.55)*(.83+data.a*.25)*brush+S*.38+reflectionTint*ribbon*.13;',
    '  intrinsic=clamp((data.a-.81)*3.5+.5+(brush-.96)*4.,0.,1.);',
    '  opacity=1.;',
    ' }else if(uKind<4.5){',
    // Leather: shallow pebble recesses keep their contrast at every pose;
    // a broad, low-energy grazing response replaces a painted white stripe.
    '  float pebble=clamp(.20+coarse*.48+fineGrain*.40,0.,1.);',
    '  float pore=smoothstep(.23,.60,fineGrain);',
    '  vec3 S=specular(N,V,L,clamp(.56+rough*.24,.56,.84),vec3(.035),false);',
    '  color=base*(.64+nl*.48)*(.69+pebble*.38)+S*reflectionTint*.13+reflectionTint*softbox*.013;',
    '  intrinsic=clamp(.12+pebble*.73+pore*.12+(data.a-.81)*1.3,0.,1.);',
    '  opacity=1.;',
    ' }else if(uKind<5.5){',
    // Cork is pressed angular fragments, not connected dark cloud noise. A
    // small skewed cell field breaks up the warm flecks, while rare pores and
    // shallow normals keep the surface dry and quiet underneath reading ink.
    '  vec2 chipUV=vec2(physical.x+physical.y*.31,physical.y*.92)/5.6+vec2(coarse-.5,fineGrain-.5)*.26;',
    '  vec2 chipCell=floor(chipUV),chipLocal=fract(chipUV);',
    '  float chipSeed=hash21(chipCell+vec2(7.1,13.7));',
    '  float facet=smoothstep(-.06,.06,chipLocal.y-chipLocal.x*(.70+chipSeed*.40)-.12);',
    '  float chip=clamp(.14+chipSeed*.74+(facet-.5)*.10+(fineGrain-.5)*.10,0.,1.);',
    '  float pore=1.-smoothstep(.055,.145,fineGrain);',
    '  color=base*(.74+nl*.35)*(.82+chip*.18-pore*.045)*(vec3(1.025,1.,.945)+vec3(.035,-.008,-.03)*(chip-.5));',
    '  color+=specular(N,V,L,.92,vec3(.018),false)*reflectionTint*.035;',
    '  intrinsic=clamp(.28+chip*.47-pore*.06+(data.a-.81)*.55,0.,1.);',
    '  opacity=1.;',
    ' }else{',
    // Slate: quiet wavy cleavage strata and scattered mica, with a hard
    // bevel. Specular is tight and sparse instead of metal's full ribbon.
    '  float layers=.5+.5*strata;',
    '  float mica=smoothstep(.72,.88,fineGrain);',
    '  vec3 S=specular(N,V,L,clamp(.69+rough*.18,.69,.88),vec3(.055),false);',
    '  color=base*(.58+nl*.56)*(.76+layers*.17+coarse*.13)+S*reflectionTint*(.10+mica*.15);',
    '  intrinsic=clamp(.17+layers*.32+coarse*.36+mica*.14+(data.a-.81)*1.6,0.,1.);',
    '  opacity=1.;',
    ' }',
    ' if(uKind>.5){',
    // Exposure used to relax across both outer 5.5% strips. Those two broad
    // bright columns made every material look rolled backward, irrespective
    // of its actual normal. Only the physical, key-facing bevel may now use
    // extra dark-mode headroom; the reading face has one uniform budget.
    '  float readPool=uMode>.5?1.:1.-clamp(bevel*edgeLight,0.,1.);',
    '  vec3 energy=linearRGB(max(color,vec3(0.)));',
    '  energy/=max(1.,max(max(energy.r,energy.g),energy.b));',
    '  float luminance=dot(energy,vec3(.2126,.7152,.0722));',
    '  if(uMode>.5){',
    '   float floorLight=mix(.50,uReadingLimit,readPool);',
    // The old hard ceiling/floor made every bright/dark microfacet converge
    // on one luminance. Reserve intrinsic material variation inside that same
    // reading budget; directional lighting changes exposure, not the grain.
    '   float targetLight=floorLight+(1.-floorLight)*(.28+.65*intrinsic)*(.8+.2*luminance);',
    '   energy=mix(energy*min(1.,targetLight/max(luminance,.0001)),vec3(1.),clamp((targetLight-luminance)/max(1.-luminance,.0001),0.,1.));',
    '  }else{',
    '   float ceiling=mix(.16,uReadingLimit,readPool);',
    '   float textureStrength=uKind<1.5?.16:uKind<2.5?.30:uKind<3.5?.24:uKind<4.5?.39:uKind<5.5?.33:.36;',
    '   float exposure=luminance/(luminance+ceiling*.7);',
    '   float targetLight=ceiling*(.62+.30*exposure)*(1.-textureStrength+textureStrength*intrinsic);',
    '   energy*=targetLight/max(luminance,.0001);',
    '  }',
    '  color=displayRGB(energy);',
    ' }',
    ' color=clamp(color+vec3(dither(uv*uSize)*.85/255.),0.,1.);',
    ' if(uKind<.5)opacity=clamp(opacity+dither(uv*uSize+vec2(37.,113.))*.40/255.,0.,1.);',
    // A fullscreen quad has no geometric edge for MSAA to sample. Instead,
    // evaluate the actual rounded face contour, with coverage bounded in CSS
    // pixels even on a very tall article's deliberately small lighting tile.
    ' float radius=uv.x<.5?(uv.y<.5?uCorners.x:uCorners.w):(uv.y<.5?uCorners.y:uCorners.z);',
    ' radius=min(radius,min(uSize.x,uSize.y)*.5);',
    ' vec2 edgePoint=abs((uv-.5)*uSize)-(uSize*.5-vec2(radius));',
    ' float contour=length(max(edgePoint,vec2(0.)))+min(max(edgePoint.x,edgePoint.y),0.)-radius;',
    ' float aa=clamp(max(uSize.x/uTileSize.x,uSize.y/uTileSize.y)*.65,.65,1.35);',
    ' float coverage=1.-smoothstep(-aa,.30,contour);',
    ' gl_FragColor=vec4(color,opacity*coverage);',
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
    var kinds = ['glass','ceramic','paper','metal','leather','cork','slate'];
    var selector = '[data-material]:is([data-depth-kind="edition"],[data-depth-kind="reply"],[data-depth-kind="reader"],[data-depth-kind="ledge"],[data-depth-kind="workspace"],[data-depth-kind="identity"],[data-depth-kind="crystal"])';
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
        metadataDirty=true;
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
    function linear(value){return value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2.4);}
    function display(value){return value<=.0031308?value*12.92:1.055*Math.pow(value,1/2.4)-.055;}
    function pigment(base,accent,amount,limit) {
      var color=base.map(function(value,index){return linear(value*(1-amount)+accent[index]*amount);});
      var lightness=color.reduce(function(sum,value,index){return sum+value*[.2126,.7152,.0722][index];},0);
      if(lightMode&&lightness<limit)color=color.map(function(value){return value+(1-value)*(limit-lightness)/Math.max(.0001,1-lightness);});
      if(!lightMode&&lightness>limit*.88)color=color.map(function(value){return value*limit*.88/Math.max(.0001,lightness);});
      return color.map(function(value){return clamp(display(value),0,1);});
    }
    function worldNormal(host) {
      var Matrix=window.DOMMatrixReadOnly||window.DOMMatrix,identity=[1,0,0,0,1,0,0,0,1];
      if(!Matrix)return identity;
      try{
        var combined=new Matrix();
        for(var node=host;node&&node!==body;node=node.parentElement){
          var value=getComputedStyle(node).transform;
          if(value&&value!=='none')combined=new Matrix(value).multiply(combined);
        }
        // Inverse-transpose transforms normals correctly even if a responsive
        // host has a static scale. Translation and perspective are excluded.
        var inverse=combined.inverse();
        var normal=[inverse.m11,inverse.m21,inverse.m31,inverse.m12,inverse.m22,inverse.m32,inverse.m13,inverse.m23,inverse.m33];
        return normal.every(Number.isFinite)?normal:identity;
      }catch(error){return identity;}
    }
    function releaseScene(scene) {
      if (io) io.unobserve(scene.host); if (ro) ro.unobserve(scene.surface);
      scene.canvas.width = scene.canvas.height = 1; scene.canvas.remove(); byHost.delete(scene.host);
      if (scene.previous === null) scene.host.removeAttribute('data-surface-renderer'); else scene.host.setAttribute('data-surface-renderer',scene.previous);
      if(scene.previousPigment)scene.host.style.setProperty('--surface-pigment',scene.previousPigment,scene.previousPigmentPriority);else scene.host.style.removeProperty('--surface-pigment');
    }
    function scan() {
      registryDirty = false;
      scenes = scenes.filter(function (scene) {
        if (scene.host.isConnected && kinds.indexOf(scene.host.dataset.material) !== -1 && scene.shell.isConnected) return true;
        releaseScene(scene); return false;
      });
      document.querySelectorAll(selector).forEach(function (host) {
        if (byHost.has(host)) return;
        // Account portals have their own single console shell. Their stable
        // inner form deliberately has no second glass body or lighting tile.
        if (host.dataset.depthKind === 'workspace' && host.closest('.portal-console')) return;
        var surface = host.querySelector(':scope > .depth-scroll > .depth-arrival > .depth-surface');
        var shell = surface && surface.querySelector(':scope > .material-shell');
        if (!shell) return;
        var canvas = document.createElement('canvas'); canvas.className = 'material-coating'; canvas.setAttribute('aria-hidden','true');
        canvas.width = canvas.height = 1; var context = canvas.getContext('2d', { alpha: true }); if (!context) return;
        shell.appendChild(canvas);
        var scene = { host: host, surface: surface, shell: shell, canvas: canvas, context: context, previous: host.getAttribute('data-surface-renderer'),
          previousPigment:host.style.getPropertyValue('--surface-pigment'),previousPigmentPriority:host.style.getPropertyPriority('--surface-pigment'),
          kind: 0, visible: !io, ratio: 0, held: false, dirty: true, metadata: true, painted:false,rx: 0, ry: 0, lx: 50, ly: 35,
          width: 500, height: 300, radii: [18,31,22,14], base: [.1,.2,.2], accent: ambient.slice(), accentMix: 0, readingLimit: .045 };
        scenes.push(scene); byHost.set(host,scene); if (io) io.observe(host); if (ro) ro.observe(surface);
      });
      layoutDirty = metadataDirty = true;
    }
    function readMetadata() {
      lightMode = html.dataset.theme === 'light';
      if (metadataDirty) ambient = parseColor(getComputedStyle(body).getPropertyValue('--accent'),[.62,.76,.72]);
      var pigments=[];
      scenes.forEach(function (scene) {
        if (!scene.visible || (!metadataDirty && !scene.metadata)) return;
        var style = getComputedStyle(scene.host), faceStyle=getComputedStyle(scene.surface), kind = Math.max(0,kinds.indexOf(scene.host.dataset.material));
        scene.radii=['border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius'].map(function(name){var value=parseFloat(faceStyle.getPropertyValue(name));return Number.isFinite(value)?Math.max(0,value):14;});
        var palette = lightMode ? [[.78,.86,.91],[.72,.84,.66],[.87,.79,.61],[.63,.72,.81],[.77,.67,.57],[.85,.75,.57],[.69,.73,.77]] : [[.12,.20,.28],[.10,.25,.17],[.25,.21,.13],[.16,.22,.30],[.29,.17,.12],[.34,.26,.14],[.17,.21,.25]];
        scene.kind = kind; scene.base = parseColor(style.getPropertyValue('--material-base'),palette[kind]);scene.world=worldNormal(scene.host);
        var custom = !!scene.host.dataset.themeColor;
        // A draft/page hue must not recolor another author's unthemed post.
        var ownAccent=parseColor(style.getPropertyValue('--accent'),[.64,.87,.72]);
        scene.accent = custom ? parseColor(style.getPropertyValue('--appearance-accent'),ownAccent) : ownAccent;
        scene.accentMix = custom ? [ .24,.09,.06,.12,.075,.045,.07 ][kind] : .018;
        var foreground=['--text','--muted','--subtle','--accent'].map(function(name){
          return luminance(parseColor(style.getPropertyValue(name),lightMode?[.30,.35,.32]:[.67,.70,.68]));
        });
        // Opaque materials own their reading background. A shared exposure
        // scale, not independent channel clipping, keeps its chromaticity.
        scene.readingLimit=lightMode?clamp((4.5*(Math.max.apply(Math,foreground)+.05)-.05)+.025,.62,.96):
          clamp(((Math.min.apply(Math,foreground)+.05)/4.5-.05)*.92,.018,.085);
        if(kind>0){scene.base=pigment(scene.base,scene.accent,scene.accentMix,scene.readingLimit);pigments.push(scene);}
        if (!scene.hasPose) { scene.rx = parseFloat(style.getPropertyValue('--depth-rest-rx')) || 0; scene.ry = parseFloat(style.getPropertyValue('--depth-rest-ry')) || 0; }
        scene.metadata = false; scene.dirty = true;
      });
      // The CSS loading/context-loss face and the GPU share this pigment.
      // Writes follow the complete metadata read batch, never a pointer frame.
      pigments.forEach(function(scene){scene.host.style.setProperty('--surface-pigment','rgb('+scene.base.map(function(c){return Math.round(c*255);}).join(',')+')');});
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
      var uniforms = {}; ['uMap','uSize','uAngles','uWorld','uLight','uTileSize','uCorners','uBase','uAccent','uKind','uMode','uAccentMix','uReadingLimit'].forEach(function (name) { uniforms[name] = gl.getUniformLocation(program,name); });
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
        gl.uniformMatrix3fv(u.uWorld,false,scene.world||[1,0,0,0,1,0,0,0,1]);
        gl.uniform2f(u.uTileSize,tileWidth,tileHeight);gl.uniform4fv(u.uCorners,scene.radii);
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
        scene.painted=true;scene.dirty = false; metrics.copies++;
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
      // Drain finite first/metadata frames, including >6 visible leaves while
      // paused. A pose becoming idle must never strand a CSS loading face.
      if (visible.some(function (scene) { return scene.dirty && (statically||!scene.held); })) schedule(statically);
    }
    function metadata(target) {
      if (target && byHost.has(target)) { var scene = byHost.get(target); scene.metadata = scene.dirty = true; }
      else { metadataDirty = true; scenes.forEach(function (scene) { scene.metadata = scene.dirty = true; }); }
      schedule(true);
    }
    function onPose(event) {
      var detail = event.detail;
      if (!detail || !detail.active) return;
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
      scenes.forEach(function (scene) { scene.canvas.width=scene.canvas.height=1;scene.painted=false; if(scene.previous===null)scene.host.removeAttribute('data-surface-renderer');else scene.host.setAttribute('data-surface-renderer',scene.previous); });
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
          if(scene.visible){scene.dirty=scene.metadata=true;layoutDirty=true;}else{scene.canvas.width=scene.canvas.height=1;scene.painted=false;if(scene.previous===null)scene.host.removeAttribute('data-surface-renderer');else scene.host.setAttribute('data-surface-renderer',scene.previous);}
        });schedule(true);
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
    window.addEventListener('resize',function(){configureAtlas();layoutDirty=metadataDirty=true;scenes.forEach(function(scene){scene.dirty=true;});schedule(true);},{passive:true,signal:signal});
    reduce.addEventListener('change',gate,{signal:signal});forced.addEventListener('change',gate,{signal:signal});
    fine.addEventListener('change',function(){configureAtlas();scenes.forEach(function(scene){scene.dirty=true;});schedule(true);},{signal:signal});
    mapImage = new Image(); mapImage.onload = uploadMap; mapImage.onerror = function(){metrics.failures++;metrics.lastError='Material normal map could not be loaded';};mapImage.src=textureURL;
    scan();readLocks();schedule(true);window.dispatchEvent(new Event('liss:surface-request'));
    inspectState = function () { return Object.assign({},metrics,{registered:scenes.length,framePending:!!frame,atlasWidth:atlas.width,atlasHeight:atlas.height,visible:scenes.filter(function(scene){return scene.visible;}).length,
      materials:scenes.filter(function(scene){return scene.visible;}).slice(0,8).map(function(scene){return {kind:kinds[scene.kind],accent:scene.accent,accentMix:scene.accentMix,pigment:scene.base,readingLimit:scene.readingLimit,painted:scene.painted,dirty:scene.dirty,world:scene.world};})}); };
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
