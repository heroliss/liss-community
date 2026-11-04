/* Quiet glass studies for everyday reading. Authored Canvas surfaces are drawn
   only on resize/theme changes; native SVG reflections follow the room's pause
   controller. This extension leaves every existing background renderer intact. */
(function(){
  'use strict';
  var previous=window.LissSceneDesignsV40;
  if(!previous||window.LissDefaultSceneStudiesV43)return;
  var names=['glass-weave','mercury-tide','opal-strata'],serial=0,budget=2400000;
  var themes={
    'glass-weave':{dark:['#344b55','#789c9c','#a2b4bc','#b2a38e'],light:['#dce4e2','#9ab6b7','#c2d0d1','#c3b5a0']},
    'mercury-tide':{dark:['#344d50','#789995','#9caaa9','#b3a18a'],light:['#dce3df','#a8c0ba','#d0d6d0','#c6b69e']},
    'opal-strata':{dark:['#3a4b5b','#759c9a','#a1b2bd','#b4a198'],light:['#dfe3e4','#a8c4bf','#c4d0d7','#d2bdb2']}
  };
  function alpha(hex,a){var n=parseInt(hex.slice(1),16);return 'rgba('+[n>>16,(n>>8)&255,n&255,a].join(',')+')';}
  function gradient(ctx,x,y,xx,yy,stops){var g=ctx.createLinearGradient(x,y,xx,yy);stops.forEach(function(s){g.addColorStop(s[0],s[1]);});return g;}
  function path(ctx,d,fill,stroke,width){var p=new Path2D(d);if(fill){ctx.fillStyle=fill;ctx.fill(p);}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width||1;ctx.stroke(p);}return p;}
  function poly(ctx,points,fill){ctx.beginPath();points.forEach(function(v,i){if(i)ctx.lineTo(v[0],v[1]);else ctx.moveTo(v[0],v[1]);});ctx.closePath();ctx.fillStyle=fill;ctx.fill();}
  function wash(ctx,x,y,r,c,opacity){var g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,alpha(c,opacity));g.addColorStop(.5,alpha(c,opacity*.45));g.addColorStop(1,alpha(c,0));ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);}
  function shadow(ctx,p,light,s){ctx.shadowColor=alpha(p[0],light?.15:.4);ctx.shadowBlur=s*.025;ctx.shadowOffsetY=s*.012;}
  function resetShadow(ctx){ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;}
  function dust(ctx,w,h,p){var n=4308;for(var i=0;i<330;i++){n=(Math.imul(n,1664525)+1013904223)>>>0;var x=n/4294967296*w;n=(Math.imul(n,1664525)+1013904223)>>>0;var y=n/4294967296*h;ctx.fillStyle=alpha(p[2],.025+(i%3)*.008);ctx.fillRect(x,y,.6,.6);}}
  function base(ctx,w,h,p,light){ctx.fillStyle=p[0];ctx.fillRect(0,0,w,h);wash(ctx,w*.88,h*.29,Math.max(w,h)*.60,p[1],light?.16:.20);wash(ctx,w*.05,h*.88,Math.min(w,h)*.65,p[3],light?.10:.12);}
  function weave(ctx,w,h,p,light){
    var s=Math.min(w,h),x=w*.80,y=h*.28;
    // Three related cuts share one oblique direction. Their surfaces refract
    // muted neighbouring colours, with a thin polished lip only at the turns.
    var back='M'+(x-s*.10)+' '+(-s*.12)+'Q'+(x-s*.17)+' '+(y+s*.07)+' '+(x+s*.08)+' '+(y+s*.29)+'L'+(x+s*.42)+' '+(y+s*.51)+'L'+(x+s*.52)+' '+(y+s*.33)+'Q'+(x+s*.03)+' '+(y+s*.08)+' '+(x+s*.17)+' '+(-s*.12)+'Z';
    path(ctx,back,gradient(ctx,x-s*.1,0,x+s*.35,h*.7,[[0,alpha(p[1],.15)],[.28,alpha(p[2],.16)],[.53,alpha(p[1],.32)],[.8,alpha(p[3],.12)],[1,alpha(p[0],0)]]));
    var main='M'+w*1.07+' '+h*.13+'C'+w*.91+' '+h*.18+' '+w*.87+' '+h*.31+' '+w*.92+' '+h*.49+'L'+w*1.08+' '+h*.80+'L'+w*1.17+' '+h*.58+'Q'+w*.91+' '+h*.29+' '+w*1.16+' '+h*.24+'Z';
    shadow(ctx,p,light,s);var shape=path(ctx,main,gradient(ctx,w*.81,h*.18,w*1.08,h*.66,[[0,alpha(p[2],.12)],[.28,alpha(p[1],.26)],[.45,alpha(p[2],light?.43:.32)],[.5,alpha('#e5eeeb',light?.62:.36)],[.55,alpha(p[3],.17)],[.7,alpha(p[1],.44)],[1,alpha(p[0],.1)]]));resetShadow(ctx);
    ctx.save();ctx.clip(shape);poly(ctx,[[w*.84,h*.16],[w*1.07,h*.24],[w*.98,h*.45],[w*.89,h*.39]],alpha(p[0],.12));
    path(ctx,'M'+w*.88+' '+h*.18+'Q'+w*.83+' '+h*.36+' '+w*1.06+' '+h*.64,null,alpha(p[2],.25),s*.006);ctx.restore();
    path(ctx,'M'+w*1.07+' '+h*.13+'C'+w*.91+' '+h*.18+' '+w*.87+' '+h*.31+' '+w*.92+' '+h*.49,null,alpha('#e0e9e8',light?.57:.32),s*.0013);
    // A small distant fold balances the large cropped object without framing
    // the page or putting a bright subject beneath its opening paragraph.
    var low='M-'+s*.13+' '+h*.73+'Q'+s*.13+' '+h*.72+' '+s*.25+' '+h*.91+'L'+s*.16+' '+h*1.06+'Q'+s*.05+' '+h*.85+'-'+s*.13+' '+h*.89+'Z';
    path(ctx,low,gradient(ctx,0,h*.72,s*.20,h*1.02,[[0,alpha(p[2],.09)],[.35,alpha(p[1],.24)],[.48,alpha(p[3],.33)],[.51,alpha(p[2],.44)],[1,alpha(p[0],.02)]]));
    var glow='M'+w*.87+' '+h*.19+'Q'+w*.82+' '+h*.35+' '+w*1.06+' '+h*.67;
    return '<path class="scene43-weave-glint" d="'+glow+'" fill="none" stroke="url(#SHINE)" stroke-width="'+s*.009+'"/>';
  }
  function mercury(ctx,w,h,p,light){
    var s=Math.min(w,h),x=w*.91;
    // A concave liquid-metal shore, rather than a sphere: the broad face is
    // quiet, and the silver edge changes thickness as it turns into the bay.
    var outer='M'+w*1.08+' -'+s*.08+'C'+w*.97+' '+h*.16+' '+w*.75+' '+h*.25+' '+w*.77+' '+h*.49+'C'+w*.78+' '+h*.70+' '+w*.96+' '+h*.66+' '+w*1.10+' '+h*.90+'L'+w*1.20+' '+h*1.08+'V-'+s*.08+'Z';
    shadow(ctx,p,light,s);var shape=path(ctx,outer,gradient(ctx,w*.72,0,w*1.11,h*.44,[[0,alpha(p[0],.1)],[.18,alpha(p[2],.08)],[.30,alpha(p[2],.38)],[.36,alpha('#e2e8e3',light?.62:.51)],[.39,alpha(p[3],.42)],[.45,alpha(p[1],.52)],[.66,alpha(p[0],.20)],[1,alpha(p[2],.22)]]));resetShadow(ctx);
    ctx.save();ctx.clip(shape);wash(ctx,w*.93,h*.30,s*.39,p[3],.13);wash(ctx,w*1.06,h*.54,s*.30,p[0],.33);
    var seam='M'+w*1.04+' '+h*.03+'C'+w*.96+' '+h*.23+' '+w*.77+' '+h*.28+' '+w*.805+' '+h*.49+'C'+w*.83+' '+h*.66+' '+w*.98+' '+h*.67+' '+w*1.10+' '+h*.86;
    path(ctx,seam,null,alpha(p[0],.24),s*.014);path(ctx,seam,null,alpha(p[2],.30),s*.002);
    for(var i=0;i<5;i++){var yy=h*(.35+i*.016);path(ctx,'M'+w*.78+' '+yy+'Q'+w*.94+' '+(yy-s*.07)+' '+w*1.12+' '+(yy+s*.10),null,alpha(i%2?p[3]:p[2],.045),s*(.003+i*.001));}ctx.restore();
    path(ctx,'M'+w*1.08+' -'+s*.08+'C'+w*.97+' '+h*.16+' '+w*.75+' '+h*.25+' '+w*.77+' '+h*.49+'C'+w*.78+' '+h*.70+' '+w*.96+' '+h*.66+' '+w*1.10+' '+h*.90,null,alpha(p[2],light?.35:.28),s*.0012);
    var echo='M-'+s*.10+' '+h*.92+'C'+s*.07+' '+h*.76+' '+s*.22+' '+h*.89+' '+s*.30+' '+h*1.07+'L-'+s*.10+' '+h*1.12+'Z';
    path(ctx,echo,gradient(ctx,0,h*.85,s*.3,h*1.1,[[0,alpha(p[1],.10)],[.42,alpha(p[2],.28)],[.47,alpha(p[3],.28)],[.51,alpha(p[2],.12)],[1,alpha(p[0],0)]]));
    return '<path class="scene43-mercury-glint" d="'+seam+'" fill="none" stroke="url(#SHINE)" stroke-width="'+s*.018+'"/>';
  }
  function strata(ctx,w,h,p,light){
    var s=Math.min(w,h),outlines=[];
    // Receding translucent ledges sit on one side, with broad irregular faces
    // instead of a full-width stack of repeated waves.
    for(var i=0;i<4;i++){
      var x=w*(.88+i*.045),y=h*(.55+i*.062),d='M'+w*1.10+' '+(y-s*.32)+'C'+(x+s*.12)+' '+(y-s*.25)+' '+(x+s*.17)+' '+(y-s*.08)+' '+(x-s*.035)+' '+y+'Q'+(x-s*.23)+' '+(y+s*.11)+' '+(x-s*.13)+' '+(y+s*.30)+'L'+(x+s*.22)+' '+(y+s*.52)+'L'+w*1.13+' '+h*1.13+'Z';
      shadow(ctx,p,light,s*.68);var shape=path(ctx,d,gradient(ctx,x-s*.22,y-s*.15,x+s*.32,y+s*.42,[[0,alpha(p[i%2?3:2],light?.30:.24)],[.24,alpha(p[1],light?.24:.34)],[.46,alpha(p[i%2?2:3],.22)],[1,alpha(p[0],.10)]]));resetShadow(ctx);
      ctx.save();ctx.clip(shape);poly(ctx,[[x-s*.05,y],[x+s*.28,y-s*.09],[x+s*.18,y+s*.26],[x-s*.10,y+s*.18]],alpha(p[i%2?2:3],.06));ctx.restore();
      var edge='M'+w*1.10+' '+(y-s*.32)+'C'+(x+s*.12)+' '+(y-s*.25)+' '+(x+s*.17)+' '+(y-s*.08)+' '+(x-s*.035)+' '+y+'Q'+(x-s*.23)+' '+(y+s*.11)+' '+(x-s*.13)+' '+(y+s*.30);
      path(ctx,edge,null,alpha('#e4eeec',light?.44:.26),s*.001);path(ctx,edge,null,alpha(p[i%2?3:1],.22),s*.005);outlines.push(edge);
    }
    // A cropped upper-left shard gives the diagonal a beginning, but its low
    // contrast allows the navigation and title to remain the focal point.
    path(ctx,'M-'+s*.08+' '+h*.02+'Q'+s*.15+' '+h*.03+' '+s*.19+' '+h*.18+'L'+s*.08+' '+h*.28+'Q'+s*.02+' '+h*.13+'-'+s*.09+' '+h*.16+'Z',gradient(ctx,0,0,s*.22,h*.3,[[0,alpha(p[3],.12)],[.45,alpha(p[2],.18)],[.50,alpha(p[2],.3)],[1,alpha(p[1],.04)]]));
    return '<g class="scene43-strata-glint">'+outlines.slice(0,2).map(function(d){return '<path d="'+d+'" fill="none" stroke="url(#SHINE)" stroke-width="'+s*.005+'"/>';}).join('')+'</g>';
  }
  var painters={'glass-weave':weave,'mercury-tide':mercury,'opal-strata':strata};
  function paint(canvas,style,width,height,light,ratio,layout){
    var ctx=canvas.getContext('2d',{alpha:false});if(!ctx)return '';
    canvas.width=Math.max(1,Math.floor(width*ratio));canvas.height=Math.max(1,Math.floor(height*ratio));ctx.setTransform(ratio,0,0,ratio,0,0);
    var p=themes[style][light?'light':'dark'];base(ctx,width,height,p,light);
    var art=painters[style](ctx,layout?layout.width:width,layout?layout.height:height,p,light);dust(ctx,width,height,p);return art;
  }
  function create(entry,camera){
    var style=entry.style,root=document.createElement('div'),canvas=document.createElement('canvas'),overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');
    root.className='community-vector-scene community-procedural-scene scene43';root.dataset.vectorStyle=style;root.dataset.sceneRevision='v43';root.dataset.sceneMotion='paused';root.setAttribute('aria-hidden','true');
    canvas.className='scene43-paint';overlay.setAttribute('class','scene43-overlay');overlay.setAttribute('preserveAspectRatio','none');root.append(canvas,overlay);
    var key='',field=null,closed=false,draws=0,running=false,id='scene43-'+(++serial);
    function resize(width,height,light){
      if(closed)return;var sig=[Math.round(width),Math.round(height),!!light,window.devicePixelRatio||1].join(':');if(sig===key)return field;key=sig;
      field={width:Math.max(1,width)+camera.overscan*2,height:Math.max(1,height)*camera.viewportSpan+camera.overscan*2,viewportSpan:camera.viewportSpan,overscan:camera.overscan,travel:Math.max(1,height)*(camera.viewportSpan-1),scrollRate:camera.scrollRate,viewBoxHeight:camera.viewBoxHeight};
      root.style.width=field.width+'px';root.style.height=field.height+'px';root.style.left=root.style.top=-camera.overscan+'px';root.style.right=root.style.bottom='auto';root.dataset.sceneTheme=light?'light':'dark';
      var ratio=Math.min(1.5,window.devicePixelRatio||1,Math.sqrt((entry.preview?140000:budget)/(field.width*field.height))),layout={width:field.width-camera.overscan*.65,height:Math.max(1,height)+camera.overscan*2};
      var art=paint(canvas,style,field.width,field.height,light,ratio,layout);overlay.setAttribute('viewBox','0 0 '+field.width+' '+field.height);
      var p=themes[style][light?'light':'dark'];overlay.innerHTML='<defs><linearGradient id="'+id+'-SHINE" x1="0" y1="0" x2="1" y2="1"><stop stop-color="'+p[2]+'" stop-opacity="0"/><stop offset=".35" stop-color="'+p[2]+'" stop-opacity="0"/><stop offset=".52" stop-color="'+p[2]+'" stop-opacity=".48"/><stop offset=".68" stop-color="'+p[3]+'" stop-opacity="0"/><stop offset="1" stop-color="'+p[3]+'" stop-opacity="0"/></linearGradient></defs>'+art.replaceAll('SHINE',id+'-SHINE');draws++;return field;
    }
    function setMotion(value){if(closed)return;running=!!value;root.dataset.sceneMotion=running?'running':'paused';}
    return{element:root,resize:resize,setMotion:setMotion,inspect:function(){return{style:style,revision:'v43',technique:'canvas2d-and-svg-reflection',field:field?Object.assign({},field):null,canvasPixels:canvas.width*canvas.height,canvasPixelBudget:entry.preview?140000:budget,draws:draws,ownRAF:false,imageRequests:0,glContexts:0,decorativeMotion:{engine:'native-css',running:running,continuousJS:false,fullSceneRotation:false}};},destroy:function(){if(closed)return;closed=true;running=false;root.dataset.sceneMotion='paused';canvas.width=canvas.height=1;root.remove();}};
  }
  var extension={has:function(style){return names.indexOf(style)>=0;},create:create,styles:Object.freeze(names),paintThumbnail:function(canvas,style,light){paint(canvas,style,canvas.width,canvas.height,!!light,1);}};
  window.LissDefaultSceneStudiesV43=Object.freeze(extension);
  window.LissSceneDesignsV40={has:function(style){return extension.has(style)||previous.has(style);},create:function(entry,camera){return extension.has(entry.style)?create(entry,camera):previous.create(entry,camera);},styles:Object.freeze(previous.styles.concat(names)),paintThumbnail:function(canvas,style,light){return(extension.has(style)?extension:previous).paintThumbnail(canvas,style,light);}};
})();
