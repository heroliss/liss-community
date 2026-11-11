/* Aurora v60 scenes: four dark, colourful backgrounds drawn for the glass UI.
   Each is painted once per size/theme on Canvas 2D (no image requests, no
   WebGL); a native CSS shimmer follows the room's motion controller. Existing
   renderers stay intact; this module only extends LissSceneDesignsV40. */
(function(){
  'use strict';
  var previous=window.LissSceneDesignsV40;
  if(!previous||window.LissAuroraScenesV60)return;
  var names=['aurora-veil','prism-nebula','bokeh-night','tide-glow','silk-flow','crystal-cavern','dusk-dunes','deep-current','neon-rain','lantern-field'],budget=2400000;
  var palettes={
    'aurora-veil':{dark:{base:['#050913','#0a1222','#0d1a2a'],colors:['#3fe0b0','#36c4e8','#8b6cf0','#e07fd8']},light:{base:['#eef4f6','#e2ecf3','#dfe6f1'],colors:['#4fc7a5','#4aa8d6','#8f7ae0','#d48bcf']}},
    'prism-nebula':{dark:{base:['#06070f','#0c0b1d','#120f26'],colors:['#7d5cf2','#e26bc9','#2fb7e6','#f2b45c']},light:{base:['#f2f1f8','#ebe7f4','#e6e0f1'],colors:['#8c74e8','#d97fc2','#4ab0dc','#e8b46c']}},
    'bokeh-night':{dark:{base:['#05090f','#0a1219','#0b1720'],colors:['#6ee8e3','#30aff8','#e27ee8','#facf4e','#fd8358','#c8ec60']},light:{base:['#f1f5f6','#e8eff1','#e3ecef'],colors:['#57cbc6','#4aa5e0','#d48bd8','#e6c157','#ea8c6a','#a9c95a']}},
    'silk-flow':{dark:{base:['#07080f','#0d0f1d','#131026'],colors:['#5ee6d6','#7b8cff','#ff8fb8','#ffd08a']},light:{base:['#f3f2f8','#ece8f4','#e7e2f1'],colors:['#4fc9bb','#7486f0','#ec8fb2','#eec17e']}},
    'crystal-cavern':{dark:{base:['#05070d','#0a0f1c','#0d1424'],colors:['#7fd6ff','#a98bff','#5cf0d0','#ff9ad5']},light:{base:['#eef3f8','#e5ecf5','#dee6f2'],colors:['#5bb6e6','#9a84ec','#4fcfb4','#e38cc0']}},
    'dusk-dunes':{dark:{base:['#0b0a14','#1c1224','#2a1626'],colors:['#ffb36b','#ff7f8e','#b77cff','#4b6bd6']},light:{base:['#f8efe9','#f3e3e0','#ecdbe0'],colors:['#f0a466','#ec8090','#a984e8','#6b84d6']}},
    'deep-current':{dark:{base:['#020910','#05141f','#071c2a'],colors:['#4fe3e6','#3d9bff','#9dfff0','#7b6cff']},light:{base:['#e9f4f7','#ddedf3','#d3e7ef'],colors:['#3fc5c8','#4a95e8','#7fdccd','#7d72e6']}},
    'neon-rain':{dark:{base:['#05050b','#0b0a16','#0f0d1d'],colors:['#ff4fa3','#38e1ff','#a26bff','#ffd166']},light:{base:['#f4f2f8','#ece9f3','#e6e2ef'],colors:['#e5559a','#3ec2e0','#9a74ea','#e8be62']}},
    'lantern-field':{dark:{base:['#05070f','#0a1020','#0e1530'],colors:['#ffb347','#ffd27a','#ff8a5c','#6f8cff']},light:{base:['#f5f1ea','#eee9e2','#e6e4ea'],colors:['#ec9f3e','#e8bf68','#ea8055','#7489e6']}},
    'tide-glow':{dark:{base:['#04070d','#0a1220','#061019'],colors:['#36d2c8','#6a86f2','#d679d6','#f3a85c']},light:{base:['#eef3f7','#e4ecf3','#dce8ee'],colors:['#46bdb5','#7a90e6','#cd85cd','#e6a96a']}}
  };
  function rng(seed){var n=seed>>>0;return function(){n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
  function rgba(hex,a){var n=parseInt(hex.slice(1),16);return 'rgba('+[n>>16,(n>>8)&255,n&255,a].join(',')+')';}
  function wash(ctx,x,y,r,c,a){var g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,rgba(c,a));g.addColorStop(.45,rgba(c,a*.42));g.addColorStop(1,rgba(c,0));ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);}
  function backdrop(ctx,w,h,p){var g=ctx.createLinearGradient(0,0,w*.3,h);g.addColorStop(0,p.base[0]);g.addColorStop(.55,p.base[1]);g.addColorStop(1,p.base[2]);ctx.fillStyle=g;ctx.fillRect(0,0,w,h);}
  function stars(ctx,w,h,count,light,seed,top){
    if(light)return;var r=rng(seed);
    for(var i=0;i<count;i++){var x=r()*w,y=r()*h*(top||1),s=r(),a=.18+s*.6;ctx.fillStyle='rgba(225,236,255,'+a.toFixed(3)+')';var size=s>.97?1.6:s>.85?1.1:.7;ctx.fillRect(x,y,size,size);
      if(s>.985){wash(ctx,x,y,6,'#dbe8ff',.35);}}
  }
  function grain(ctx,w,h,light){var r=rng(91);ctx.fillStyle=light?'rgba(20,30,40,.025)':'rgba(255,255,255,.018)';for(var i=0;i<900;i++)ctx.fillRect(r()*w,r()*h,1,1);}
  function blurred(ctx,px,draw){ctx.save();ctx.filter='blur('+Math.max(1,px).toFixed(1)+'px)';draw();ctx.restore();}

  function auroraVeil(ctx,w,h,p,light){
    var s=Math.min(w,h);stars(ctx,w,h,520,light,7,.85);
    // Curtains: many thin vertical strokes along drifting curves, coloured from
    // green at the hem to violet at the top, then softened together.
    var curtains=[[.12,.95,.22,0,1],[.38,1.25,.18,1,2],[.62,.9,.26,2,3]];
    blurred(ctx,s*.012,function(){
      curtains.forEach(function(c,k){
        var base=h*c[2],r=rng(31+k*13);ctx.globalCompositeOperation=light?'multiply':'screen';
        for(var x=-w*.05;x<w*1.05;x+=Math.max(2,w/520)){
          var t=x/w,wave=Math.sin((t*c[1]+k*.37)*Math.PI*2)*h*.06+Math.sin((t*3.1+k)*Math.PI)*h*.025;
          var top=base+wave-h*(.18+.1*Math.sin(t*7+k)),hem=base+wave+h*.16+r()*h*.02;
          var strength=Math.max(0,Math.sin((t-c[0]+.5)*Math.PI))*(.55+.45*r());
          var g=ctx.createLinearGradient(0,top,0,hem);
          g.addColorStop(0,rgba(p.colors[c[4]],0));g.addColorStop(.45,rgba(p.colors[c[4]],(light?.10:.16)*strength));g.addColorStop(.86,rgba(p.colors[c[3]],(light?.20:.34)*strength));g.addColorStop(1,rgba(p.colors[c[3]],0));
          ctx.fillStyle=g;ctx.fillRect(x,top,Math.max(2,w/520)+.6,hem-top);
        }
      });
      ctx.globalCompositeOperation='source-over';
    });
    wash(ctx,w*.5,h*1.04,s*.9,p.colors[1],light?.12:.16);
    // A low ridge line keeps the sky above a quiet horizon.
    ctx.beginPath();ctx.moveTo(0,h*.86);for(var i=0;i<=24;i++){var xx=w*i/24;ctx.lineTo(xx,h*(.84+Math.sin(i*1.7)*.012+Math.sin(i*.6)*.02));}ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();
    ctx.fillStyle=light?'rgba(170,190,205,.45)':'rgba(4,8,14,.82)';ctx.fill();
  }
  function prismNebula(ctx,w,h,p,light){
    var s=Math.min(w,h),r=rng(53);stars(ctx,w,h,640,light,11);
    blurred(ctx,s*.03,function(){
      ctx.globalCompositeOperation=light?'multiply':'screen';
      for(var i=0;i<26;i++){var c=p.colors[i%3],x=w*(.55+r()*.5),y=h*(.05+r()*.55),rad=s*(.12+r()*.28);wash(ctx,x,y,rad,c,(light?.08:.12)*(.5+r()));}
      for(var j=0;j<10;j++){wash(ctx,w*(r()*.35),h*(.65+r()*.4),s*(.1+r()*.2),p.colors[(j+1)%3],light?.06:.09);}
      ctx.globalCompositeOperation='source-over';
    });
    // A prism beam: narrow spectral bands crossing from the upper left.
    var spectrum=['#ff6b8a','#ffb15c','#ffe066','#7be495','#4cc9f0','#7d6cf2'];
    blurred(ctx,s*.008,function(){
      ctx.save();ctx.translate(w*.08,h*.02);ctx.rotate(Math.atan2(h*.55,w*.9));ctx.globalCompositeOperation=light?'multiply':'screen';
      var len=Math.hypot(w,h)*1.1,band=s*.012;
      spectrum.forEach(function(c,i){var g=ctx.createLinearGradient(0,0,len,0);g.addColorStop(0,rgba(c,0));g.addColorStop(.25,rgba(c,light?.18:.24));g.addColorStop(.62,rgba(c,light?.08:.11));g.addColorStop(1,rgba(c,0));ctx.fillStyle=g;ctx.fillRect(0,i*band*(1+i*.18),len,band*(1.2+i*.2));});
      ctx.restore();
    });
    wash(ctx,w*.08,h*.04,s*.18,'#ffffff',light?.15:.22);
  }
  function bokehNight(ctx,w,h,p,light){
    var s=Math.min(w,h),r=rng(77);stars(ctx,w,h,220,light,19);
    wash(ctx,w*.85,h*.2,s*.8,p.colors[1],light?.08:.12);wash(ctx,w*.1,h*.9,s*.7,p.colors[2],light?.07:.1);
    // Three depth layers: large soft discs far back, crisp rings in front. The
    // middle of the page stays calmer for reading.
    [[s*.02,24,.09,.18],[s*.008,30,.06,.11],[s*.002,22,.035,.06]].forEach(function(layer,depth){
      blurred(ctx,layer[0],function(){
        ctx.globalCompositeOperation=light?'multiply':'screen';
        for(var i=0;i<layer[1];i++){
          var side=r()<.5,x=side?w*(.62+r()*.42):w*(-.04+r()*.34),y=h*(r()*1.05),rad=s*(layer[2]+r()*(layer[3]-layer[2])),c=p.colors[Math.floor(r()*p.colors.length)];
          var g=ctx.createRadialGradient(x,y,rad*.1,x,y,rad);g.addColorStop(0,rgba(c,(light?.08:.12)));g.addColorStop(.82,rgba(c,(light?.12:.2)));g.addColorStop(.94,rgba(c,(light?.2:.34)*(depth===2?1:.7)));g.addColorStop(1,rgba(c,0));
          ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,rad,0,Math.PI*2);ctx.fill();
        }
        ctx.globalCompositeOperation='source-over';
      });
    });
  }
  function tideGlow(ctx,w,h,p,light){
    var s=Math.min(w,h),horizon=h*.6,r=rng(29);stars(ctx,w,horizon,420,light,23,.95);
    // Coloured light sources along the horizon, each with a reflection column.
    var lights=[[.18,0],[.43,1],[.66,2],[.88,3]];
    blurred(ctx,s*.02,function(){
      ctx.globalCompositeOperation=light?'multiply':'screen';
      lights.forEach(function(l){wash(ctx,w*l[0],horizon,s*.32,p.colors[l[1]],light?.14:.2);});
      var band=ctx.createLinearGradient(0,horizon-h*.05,0,horizon+h*.03);band.addColorStop(0,'rgba(0,0,0,0)');band.addColorStop(.6,rgba(p.colors[0],light?.14:.22));band.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=band;ctx.fillRect(0,horizon-h*.05,w,h*.08);
      ctx.globalCompositeOperation='source-over';
    });
    // Water: darker below the line, with reflection streaks that break apart.
    var water=ctx.createLinearGradient(0,horizon,0,h);water.addColorStop(0,light?'rgba(205,220,232,.55)':'rgba(3,7,13,.55)');water.addColorStop(1,light?'rgba(190,206,220,.8)':'rgba(2,5,9,.88)');ctx.fillStyle=water;ctx.fillRect(0,horizon,w,h-horizon);
    ctx.globalCompositeOperation=light?'multiply':'screen';
    lights.forEach(function(l){
      for(var y=horizon+2;y<h;y+=Math.max(2,h/260)){
        var depth=(y-horizon)/(h-horizon),spread=s*(.02+depth*.09),x=w*l[0]+(r()-.5)*spread*1.4,len=spread*(.6+r()*1.4);
        ctx.fillStyle=rgba(p.colors[l[1]],(light?.18:.32)*(1-depth)*(.4+r()*.6));ctx.fillRect(x-len/2,y,len,Math.max(1,h/700));
      }
    });
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle=light?'rgba(255,255,255,.5)':'rgba(220,235,255,.22)';ctx.fillRect(0,horizon,w,1);
  }
  function silkFlow(ctx,w,h,p,light){
    var s=Math.min(w,h);stars(ctx,w,h,160,light,41);
    // Wide silk ribbons sweep across the room; each has a lit crest and a shaded fold.
    [[.15,.08,0,1],[.42,.11,1,2],[.7,.09,2,3],[.9,.07,3,0]].forEach(function(r,k){
      var y0=h*r[0],amp=h*r[1],c1=p.colors[r[2]],c2=p.colors[r[3]],thick=s*(.16-k*.02);
      ctx.save();ctx.globalCompositeOperation=light?'multiply':'screen';
      for(var layer=0;layer<26;layer++){
        var off=(layer/25-.5)*thick,t=layer/25;ctx.beginPath();
        for(var x=-w*.05;x<=w*1.05;x+=w/80){var u=x/w,y=y0+off+Math.sin(u*Math.PI*1.6+k*1.3)*amp+Math.sin(u*Math.PI*3.4+k)*amp*.35+off*Math.sin(u*Math.PI*2+k)*.6;if(x<=-w*.05)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
        var crest=Math.pow(Math.sin(t*Math.PI),3);ctx.strokeStyle=rgba(t<.5?c1:c2,(light?.05:.07)+crest*(light?.08:.12));ctx.lineWidth=thick/22;ctx.stroke();
      }
      ctx.restore();
    });
    blurred(ctx,s*.04,function(){ctx.globalCompositeOperation=light?'multiply':'screen';wash(ctx,w*.3,h*.35,s*.5,p.colors[1],light?.08:.12);wash(ctx,w*.75,h*.6,s*.5,p.colors[2],light?.07:.1);ctx.globalCompositeOperation='source-over';});
  }
  function crystalCavern(ctx,w,h,p,light){
    var s=Math.min(w,h),r=rng(61);stars(ctx,w,h,200,light,43);
    blurred(ctx,s*.05,function(){ctx.globalCompositeOperation=light?'multiply':'screen';wash(ctx,w*.86,h*.82,s*.7,p.colors[1],light?.1:.16);wash(ctx,w*.1,h*.15,s*.6,p.colors[0],light?.08:.12);ctx.globalCompositeOperation='source-over';});
    // Clusters of faceted shards rise from the lower right and hang from the upper left.
    function shard(x,y,len,width,angle,c){
      var dx=Math.cos(angle),dy=Math.sin(angle),nx=-dy,ny=dx,tipX=x+dx*len,tipY=y+dy*len;
      var pts=[[x+nx*width,y+ny*width],[x+dx*len*.82+nx*width*.75,y+dy*len*.82+ny*width*.75],[tipX,tipY],[x+dx*len*.82-nx*width*.75,y+dy*len*.82-ny*width*.75],[x-nx*width,y-ny*width]];
      var g=ctx.createLinearGradient(x+nx*width,y+ny*width,x-nx*width,y-ny*width);g.addColorStop(0,rgba(c,light?.18:.28));g.addColorStop(.48,rgba('#ffffff',light?.3:.22));g.addColorStop(.52,rgba(c,light?.22:.4));g.addColorStop(1,rgba(c,light?.06:.1));
      ctx.beginPath();pts.forEach(function(pt,i){if(i)ctx.lineTo(pt[0],pt[1]);else ctx.moveTo(pt[0],pt[1]);});ctx.closePath();ctx.fillStyle=g;ctx.fill();
      ctx.strokeStyle=rgba('#e8f6ff',light?.35:.25);ctx.lineWidth=1;ctx.stroke();
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(tipX,tipY);ctx.strokeStyle=rgba('#ffffff',light?.25:.18);ctx.stroke();
      wash(ctx,tipX,tipY,s*.025,c,light?.2:.4);
    }
    ctx.save();ctx.globalCompositeOperation=light?'multiply':'screen';
    for(var i=0;i<11;i++)shard(w*(.72+r()*.3),h*(1.02+r()*.05),s*(.18+r()*.32),s*(.02+r()*.025),-Math.PI/2+(r()-.5)*.9,p.colors[i%4]);
    for(var j=0;j<7;j++)shard(w*(r()*.28),-h*.02,s*(.1+r()*.22),s*(.015+r()*.02),Math.PI/2+(r()-.5)*.8,p.colors[(j+1)%4]);
    ctx.restore();
  }
  function duskDunes(ctx,w,h,p,light){
    var s=Math.min(w,h);
    var sky=ctx.createLinearGradient(0,0,0,h*.7);sky.addColorStop(0,light?'#e9e2f2':'#0d0b1c');sky.addColorStop(.6,rgba(p.colors[2],light?.25:.3));sky.addColorStop(1,rgba(p.colors[1],light?.35:.4));ctx.fillStyle=sky;ctx.fillRect(0,0,w,h*.7);
    stars(ctx,w,h*.4,180,light,47);
    blurred(ctx,s*.02,function(){wash(ctx,w*.32,h*.6,s*.5,p.colors[0],light?.4:.55);wash(ctx,w*.32,h*.6,s*.09,'#fff1d6',light?.6:.8);});
    // Dune ridges in receding layers, each lit along its crest by the low sun.
    for(var k=0;k<5;k++){
      var base=h*(.58+k*.085),amp=h*(.05-k*.006);ctx.beginPath();ctx.moveTo(0,h);
      for(var x=0;x<=w;x+=w/60){var u=x/w;ctx.lineTo(x,base-Math.sin(u*Math.PI*(1.2+k*.4)+k*1.7)*amp-Math.sin(u*Math.PI*3+k)*amp*.3);}
      ctx.lineTo(w,h);ctx.closePath();
      var g=ctx.createLinearGradient(0,base-amp,0,h),col=k<2?p.colors[2]:k<4?p.colors[3]:'#06060e';
      g.addColorStop(0,rgba(col,light?.5:Math.min(.95,.62+k*.07)));g.addColorStop(1,light?rgba('#d8cfe0',.9):'#05050b');ctx.fillStyle=g;ctx.fill();
      ctx.strokeStyle=rgba(p.colors[0],(light?.3:.45)*(1-k*.17));ctx.lineWidth=1.2;ctx.stroke();
    }
  }
  function deepCurrent(ctx,w,h,p,light){
    var s=Math.min(w,h),r=rng(71);
    blurred(ctx,s*.012,function(){
      ctx.globalCompositeOperation=light?'multiply':'screen';
      // God rays fanning down from a bright patch of surface.
      for(var i=0;i<14;i++){
        var x=w*(.35+r()*.5),spread=s*(.04+r()*.08),len=h*(.7+r()*.4),tilt=(r()-.5)*w*.25;
        var g=ctx.createLinearGradient(x,0,x+tilt,len);g.addColorStop(0,rgba(p.colors[2],light?.18:.22));g.addColorStop(.6,rgba(p.colors[0],light?.05:.07));g.addColorStop(1,rgba(p.colors[0],0));
        ctx.beginPath();ctx.moveTo(x-spread*.3,0);ctx.lineTo(x+spread*.3,0);ctx.lineTo(x+tilt+spread,len);ctx.lineTo(x+tilt-spread,len);ctx.closePath();ctx.fillStyle=g;ctx.fill();
      }
      wash(ctx,w*.6,-h*.02,s*.45,p.colors[2],light?.25:.32);
      ctx.globalCompositeOperation='source-over';
    });
    // Bioluminescent motes drifting at different depths.
    ctx.save();ctx.globalCompositeOperation=light?'multiply':'screen';
    for(var j=0;j<140;j++){var x=r()*w,y=h*(.25+r()*.75),size=s*(.002+r()*.006),c=p.colors[j%4===3?3:j%2];wash(ctx,x,y,size*4,c,light?.25:.5);ctx.fillStyle=rgba('#e9ffff',light?.4:.7);ctx.fillRect(x,y,1,1);}
    ctx.restore();
  }
  function neonRain(ctx,w,h,p,light){
    var s=Math.min(w,h),r=rng(83);
    blurred(ctx,s*.06,function(){
      ctx.globalCompositeOperation=light?'multiply':'screen';
      [[.12,.3,0],[.85,.22,1],[.7,.7,2],[.25,.8,3],[.5,.45,1]].forEach(function(n){wash(ctx,w*n[0],h*n[1],s*(.28+r()*.12),p.colors[n[2]],light?.16:.28);});
      ctx.globalCompositeOperation='source-over';
    });
    // Rain: thin slanted streaks that pick up the neon colour.
    ctx.save();ctx.globalCompositeOperation=light?'multiply':'screen';
    for(var i=0;i<900;i++){var x=r()*w*1.1,y=r()*h,len=s*(.02+r()*.06),c=p.colors[Math.floor(r()*4)];ctx.strokeStyle=rgba(r()<.6?'#cfe6ff':c,.12+r()*(light?.12:.2));ctx.lineWidth=r()<.1?1.4:.7;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-len*.18,y+len);ctx.stroke();}
    ctx.restore();
    var floorY=h*.86,g=ctx.createLinearGradient(0,floorY,0,h);g.addColorStop(0,rgba(p.colors[0],light?.1:.18));g.addColorStop(1,rgba(p.colors[1],0));ctx.fillStyle=g;ctx.fillRect(0,floorY,w,h-floorY);
  }
  function lanternField(ctx,w,h,p,light){
    var s=Math.min(w,h),r=rng(97);stars(ctx,w,h*.7,380,light,53);
    var ground=ctx.createLinearGradient(0,h*.7,0,h);ground.addColorStop(0,rgba(p.colors[3],light?.15:.12));ground.addColorStop(1,light?'rgba(200,200,215,.6)':'#03040a');ctx.fillStyle=ground;ctx.fillRect(0,h*.7,w,h*.3);
    // Lanterns rise from the lower edge and thin out upward; nearer ones are larger and softer.
    ctx.save();ctx.globalCompositeOperation=light?'multiply':'screen';
    for(var i=0;i<70;i++){
      var depth=r(),x=w*(r()<.5?r()*.4:.6+r()*.4),y=h*(.35+Math.pow(r(),.6)*.65),size=s*(.006+depth*.02),c=p.colors[Math.floor(r()*3)];
      (function(x,y,size,c,depth){blurred(ctx,depth*s*.006,function(){wash(ctx,x,y,size*5,c,light?.18:.32);var g=ctx.createLinearGradient(x,y-size*1.3,x,y+size*1.3);g.addColorStop(0,rgba('#fff3d6',light?.5:.9));g.addColorStop(1,rgba(c,light?.5:.85));ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(x,y,size*.8,size*1.2,0,0,Math.PI*2);ctx.fill();});})(x,y,size,c,depth);
    }
    ctx.restore();
  }
  var painters={'aurora-veil':auroraVeil,'prism-nebula':prismNebula,'bokeh-night':bokehNight,'tide-glow':tideGlow,'silk-flow':silkFlow,'crystal-cavern':crystalCavern,'dusk-dunes':duskDunes,'deep-current':deepCurrent,'neon-rain':neonRain,'lantern-field':lanternField};
  function paint(canvas,style,width,height,light,ratio,layout){
    var ctx=canvas.getContext('2d',{alpha:false});if(!ctx)return;
    canvas.width=Math.max(1,Math.floor(width*ratio));canvas.height=Math.max(1,Math.floor(height*ratio));ctx.setTransform(ratio,0,0,ratio,0,0);
    var p=palettes[style][light?'light':'dark'];backdrop(ctx,width,height,p);
    painters[style](ctx,layout?layout.width:width,layout?layout.height:height,p,light);grain(ctx,width,height,light);
  }
  function create(entry,camera){
    var style=entry.style,root=document.createElement('div'),canvas=document.createElement('canvas'),shimmer=document.createElement('div');
    root.className='community-vector-scene community-procedural-scene scene60';root.dataset.vectorStyle=style;root.dataset.sceneRevision='v60';root.dataset.sceneMotion='paused';root.setAttribute('aria-hidden','true');
    canvas.className='scene60-paint';shimmer.className='scene60-shimmer';root.append(canvas,shimmer);
    var key='',field=null,closed=false,draws=0,running=false;
    function resize(width,height,light){
      if(closed)return;var sig=[Math.round(width),Math.round(height),!!light,window.devicePixelRatio||1].join(':');if(sig===key)return field;key=sig;
      field={width:Math.max(1,width)+camera.overscan*2,height:Math.max(1,height)*camera.viewportSpan+camera.overscan*2,viewportSpan:camera.viewportSpan,overscan:camera.overscan,travel:Math.max(1,height)*(camera.viewportSpan-1),scrollRate:camera.scrollRate,viewBoxHeight:camera.viewBoxHeight};
      root.style.width=field.width+'px';root.style.height=field.height+'px';root.style.left=root.style.top=-camera.overscan+'px';root.style.right=root.style.bottom='auto';root.dataset.sceneTheme=light?'light':'dark';
      var ratio=Math.min(1.5,window.devicePixelRatio||1,Math.sqrt((entry.preview?140000:budget)/(field.width*field.height)));
      paint(canvas,style,field.width,field.height,light,ratio,{width:field.width,height:Math.max(1,height)+camera.overscan*2});draws++;return field;
    }
    function setMotion(value){if(closed)return;running=!!value;root.dataset.sceneMotion=running?'running':'paused';}
    return{element:root,resize:resize,setMotion:setMotion,
      inspect:function(){return{style:style,revision:'v60',technique:'canvas2d-and-css-shimmer',field:field?Object.assign({},field):null,canvasPixels:canvas.width*canvas.height,canvasPixelBudget:entry.preview?140000:budget,draws:draws,ownRAF:false,imageRequests:0,glContexts:0,decorativeMotion:{engine:'native-css',running:running,continuousJS:false,fullSceneRotation:false}};},
      destroy:function(){if(closed)return;closed=true;running=false;root.dataset.sceneMotion='paused';canvas.width=canvas.height=1;root.remove();}};
  }
  var extension={has:function(style){return names.indexOf(style)>=0;},create:create,styles:Object.freeze(names),paintThumbnail:function(canvas,style,light){paint(canvas,style,canvas.width,canvas.height,!!light,1);}};
  window.LissAuroraScenesV60=Object.freeze(extension);
  if(window.LissProceduralScenes)window.LissProceduralScenes=Object.assign({},window.LissProceduralScenes,{styles:Object.freeze(window.LissProceduralScenes.styles.concat(names))});
  window.LissSceneDesignsV40={has:function(style){return extension.has(style)||previous.has(style);},create:function(entry,camera){return extension.has(entry.style)?create(entry,camera):previous.create(entry,camera);},styles:Object.freeze(previous.styles.concat(names)),paintThumbnail:function(canvas,style,light){return(extension.has(style)?extension:previous).paintThumbnail(canvas,style,light);}};
})();
