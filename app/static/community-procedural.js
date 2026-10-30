/* Ten local worlds. Raster art is drawn once; slow decorative motion is native
   compositor animation, paused by the room controller without a JavaScript clock. */
(function () {
  'use strict';
  var SVG='http://www.w3.org/2000/svg',serial=0;
  // The field is a little taller than the window, not a document-length
  // panorama. Its native camera can reveal another quiet layer as we read.
  var camera=Object.freeze({viewportSpan:1.42,overscan:80,scrollRate:.045,viewBoxHeight:1420});
  var palettes={
    mist:['#8bbbae','#779ab5','#cfbfa1'],line:['#9bc5b8','#789fba','#bdad88'],
    contour:['#77b8b4','#a99273','#7a9bb0'],prism:['#58a7c3','#9382d1','#d5a171'],
    orbital:['#85b8cf','#a4b9ad','#b8a17e'],paper:['#a9b8a0','#8eaaa4','#c0ae8f'],
    ribbons:['#7774d9','#43b4a6','#de9276'],constellation:['#8eb0ca','#b4b3a0','#a098bd'],
    spectrum:['#7963d5','#3ab6a5','#df8878'],dunes:['#baaa8a','#6f9d9e','#8297ae']
  };
  function element(tag,cls){var n=document.createElement(tag);n.className=cls;return n;}
  function seed(value){var n=value;return function(){n=(n*1664525+1013904223)>>>0;return n/4294967296;};}
  function svgMarkup(style,id){
    var defs='<defs><linearGradient id="'+id+'-a" x1="0" y1="0" x2="1" y2="1"><stop stop-color="var(--scene-a)" stop-opacity=".32"/><stop offset="1" stop-color="var(--scene-b)" stop-opacity=".05"/></linearGradient><linearGradient id="'+id+'-b"><stop stop-color="var(--scene-b)" stop-opacity=".04"/><stop offset=".55" stop-color="var(--scene-c)" stop-opacity=".25"/><stop offset="1" stop-color="var(--scene-a)" stop-opacity=".07"/></linearGradient></defs>';
    var art='';
    if(style==='line'){
      art='<g fill="none" stroke="url(#'+id+'-a)" stroke-width="1.6"><path d="M-100 760C320 1120 430 220 800 160S1430 390 1760-180"/><path d="M-100 815C240 1160 450 310 830 230S1450 450 1750-90"/></g><g fill="none" stroke="url(#'+id+'-b)" stroke-width="1.1"><path d="M-120 1390C240 1070 520 1480 950 1150S1500 1050 1730 870"/><path d="M-120 1434C240 1114 520 1524 950 1194S1500 1094 1730 914"/></g>';
    }else if(style==='contour'){
      for(var i=0;i<23;i++){var y=130+i*39;art+='<path d="M-120 '+y+'C180 '+(y-210)+' 220 '+(y+230)+' 550 '+(y+110)+'S1040 '+(y-300)+' 1360 '+(y-60)+'S1650 '+(y+80)+' 1790 '+(y-140)+'"/>';}
      art='<g fill="none" stroke="var(--scene-a)" stroke-opacity=".22" stroke-width="1.1">'+art+'</g><ellipse cx="1290" cy="210" rx="260" ry="180" fill="url(#'+id+'-b)"/>';
    }else if(style==='orbital'){
      art='<g fill="none" stroke="var(--scene-a)" stroke-opacity=".23"><ellipse cx="1250" cy="470" rx="470" ry="310" transform="rotate(-28 1250 470)"/><ellipse cx="1250" cy="470" rx="405" ry="260" transform="rotate(-28 1250 470)"/><path d="M782 575L1602 172M897 761L1472 190" stroke-opacity=".15"/><circle cx="1250" cy="470" r="98"/><path d="M1100 470h300M1250 320v300" stroke-opacity=".12"/></g><g class="procedural-orbit-satellites"><circle cx="894" cy="680" r="9" fill="var(--scene-c)" fill-opacity=".58"/><circle cx="1492" cy="231" r="5" fill="var(--scene-a)" fill-opacity=".7"/></g><path d="M-150 920Q170 650 500 858" fill="none" stroke="var(--scene-b)" stroke-opacity=".18"/><g fill="none" stroke="var(--scene-b)" stroke-opacity=".13"><ellipse cx="275" cy="1360" rx="410" ry="175" transform="rotate(18 275 1360)"/><path d="M-90 1225L655 1455"/></g>';
    }else if(style==='constellation'){
      var rand=seed(241019),points=[];
      for(var j=0;j<112;j++){var x=rand()*1700-50,y2=rand()*1520-50,r=rand()*1.8+.65;points.push([x,y2]);art+='<circle cx="'+x.toFixed(1)+'" cy="'+y2.toFixed(1)+'" r="'+r.toFixed(1)+'" fill="var(--scene-a)" fill-opacity="'+(.20+rand()*.33).toFixed(2)+'"/>';}
      for(var k=0;k<points.length;k+=4){var a=points[k],b=points[k+1];if(b&&Math.hypot(a[0]-b[0],a[1]-b[1])<440)art+='<path d="M'+a.join(' ')+'L'+b.join(' ')+'" stroke="var(--scene-b)" stroke-opacity=".16" stroke-width=".9"/>';}
      art+='<circle cx="1300" cy="180" r="65" fill="none" stroke="var(--scene-c)" stroke-opacity=".15"/><circle cx="1300" cy="180" r="6" fill="var(--scene-c)" fill-opacity=".6"/>';
    }else if(style==='dunes'){
      art='<path d="M-100 810Q160 390 490 694T1050 555T1730 668V1570H-100Z" fill="url(#'+id+'-a)"/><path d="M-100 930Q230 557 615 825T1230 690T1730 820V1570H-100Z" fill="url(#'+id+'-b)"/><path d="M-100 810Q160 390 490 694T1050 555T1730 668" fill="none" stroke="var(--scene-c)" stroke-opacity=".24"/><path d="M-100 930Q230 557 615 825T1230 690T1730 820" fill="none" stroke="var(--scene-a)" stroke-opacity=".20"/><path d="M-100 1300Q250 990 620 1190T1320 1160T1730 1240" fill="none" stroke="var(--scene-c)" stroke-opacity=".16"/><circle cx="1260" cy="200" r="110" fill="url(#'+id+'-b)"/>';
    }
    return defs+art;
  }
  function create(entry){
    var style=entry&&Object.prototype.hasOwnProperty.call(palettes,entry.style)?entry.style:'mist',root=element('div','community-vector-scene community-procedural-scene');
    root.dataset.vectorStyle=style;root.dataset.sceneMotion='paused';root.setAttribute('aria-hidden','true');
    var colors=palettes[style];colors.forEach(function(color,i){root.style.setProperty('--scene-'+String.fromCharCode(97+i),color);});
    var node=null,ctx=null,last='',draws=0,closed=false,pixels=0,motionRunning=false,field=null,id='scene-v27-'+(++serial);
    if(['line','contour','orbital','constellation','dunes'].indexOf(style)>=0){
      node=document.createElementNS(SVG,'svg');node.setAttribute('viewBox','0 0 1600 '+camera.viewBoxHeight);node.setAttribute('preserveAspectRatio','xMidYMid slice');node.setAttribute('class','procedural-vector-art');node.innerHTML=svgMarkup(style,id);root.appendChild(node);
    }else if(style==='ribbons'){
      node=element('canvas','procedural-ribbons');root.appendChild(node);try{ctx=node.getContext('2d',{alpha:true});}catch(error){ctx=null;}
      if(!ctx){node.remove();node=null;root.dataset.vectorStyle='spectrum';for(var f=0;f<3;f++)root.appendChild(element('span','procedural-shape procedural-shape-'+f));}
    }else{
      var count=style==='paper'?5:style==='prism'?4:3;
      for(var i=0;i<count;i++)root.appendChild(element('span','procedural-shape procedural-shape-'+i));
    }
    function resize(width,height,light){
      if(closed)return;var signature=[Math.round(width),Math.round(height),!!light,window.devicePixelRatio||1].join(':');if(signature===last)return field;last=signature;
      field={width:Math.max(1,width)+camera.overscan*2,height:Math.max(1,height)*camera.viewportSpan+camera.overscan*2,viewportSpan:camera.viewportSpan,overscan:camera.overscan,travel:Math.max(1,height)*(camera.viewportSpan-1),scrollRate:camera.scrollRate,viewBoxHeight:camera.viewBoxHeight};
      root.style.width=field.width+'px';root.style.height=field.height+'px';root.style.left=root.style.top=-camera.overscan+'px';root.style.right=root.style.bottom='auto';
      root.dataset.sceneTheme=light?'light':'dark';
      if(!ctx)return field;
      var w=field.width,h=field.height,ratio=Math.min(2,window.devicePixelRatio||1,Math.sqrt(2400000/(w*h)));
      node.width=Math.max(1,Math.floor(w*ratio));node.height=Math.max(1,Math.floor(h*ratio));pixels=node.width*node.height;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
      // Closed tapered ribbons have a lit face and a restrained edge, rather
      // than uniform grey rounded strokes. Colour lives mostly at the right
      // and lower edges; the opening copy retains a quiet central area.
      var bands=[
        {c:0,points:[[.50,-.12],[.39,.22,.92,.13,.97,.38],[1.01,.67,.42,.64,.43,1.13],[.50,1.13],[.47,.75,1.12,.79,1.05,.40],[.98,.04,.42,.17,.58,-.12]]},
        {c:2,points:[[-.10,.70],[.10,.48,.12,.79,.39,.87],[.58,.93,.85,.80,1.08,1.02],[1.08,1.11],[.82,.89,.62,1.05,.39,.95],[.09,.88,.14,.61,-.10,.80]]},
        {c:1,points:[[.88,-.12],[1.02,.21,.62,.17,.69,.50],[.73,.76,1.02,.71,1.03,.96],[1.12,.96],[1.10,.67,.82,.70,.77,.49],[.71,.25,1.16,.23,.96,-.12]]}
      ];
      bands.forEach(function(b,index){
        var gradient=ctx.createLinearGradient(w*.27,h*-.1,w*1.06,h*.96);
        gradient.addColorStop(0,colors[b.c]+'15');gradient.addColorStop(.24,colors[b.c]+(light?'68':'76'));gradient.addColorStop(.55,colors[b.c]+(light?'9c':'b0'));gradient.addColorStop(.76,colors[(b.c+1)%3]+(light?'62':'74'));gradient.addColorStop(1,colors[b.c]+'12');
        ctx.beginPath();b.points.forEach(function(p,i){if(!i)ctx.moveTo(p[0]*w,p[1]*h);else if(p.length===2)ctx.lineTo(p[0]*w,p[1]*h);else ctx.bezierCurveTo(p[0]*w,p[1]*h,p[2]*w,p[3]*h,p[4]*w,p[5]*h);});ctx.closePath();ctx.fillStyle=gradient;ctx.fill();ctx.strokeStyle=colors[b.c]+(light?'38':'45');ctx.lineWidth=.8;ctx.stroke();
      });
      // Fine folded spines supply depth cues without extra filters or buffers.
      ctx.lineWidth=1.1;ctx.strokeStyle=colors[0]+(light?'42':'5c');ctx.beginPath();ctx.moveTo(w*.55,h*-.05);ctx.bezierCurveTo(w*.43,h*.19,w*1.02,h*.11,w*1.01,h*.40);ctx.stroke();
      ctx.strokeStyle=colors[2]+(light?'45':'5c');ctx.beginPath();ctx.moveTo(-w*.03,h*.75);ctx.bezierCurveTo(w*.12,h*.58,w*.12,h*.86,w*.39,h*.91);ctx.stroke();draws++;return field;
    }
    function setMotion(running){if(closed)return;motionRunning=!!running;var state=motionRunning?'running':'paused';if(root.dataset.sceneMotion!==state)root.dataset.sceneMotion=state;}
    return{element:root,resize:resize,setMotion:setMotion,inspect:function(){return{style:style,technique:ctx?'canvas2d':node?'svg':'css',field:field?Object.assign({},field):null,canvasPixels:pixels,canvasPixelBudget:2400000,draws:draws,ownRAF:false,imageRequests:0,glContexts:0,decorativeMotion:{engine:'native-css-compositor',running:motionRunning,continuousJS:false,fullSceneRotation:false}};},destroy:function(){if(closed)return;closed=true;motionRunning=false;root.dataset.sceneMotion='paused';if(node&&ctx)node.width=node.height=1;root.remove();ctx=null;}};
  }
  window.LissProceduralScenes={create:create,styles:Object.freeze(Object.keys(palettes)),camera:camera};
})();
