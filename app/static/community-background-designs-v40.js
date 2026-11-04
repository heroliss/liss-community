/* Twelve authored backgrounds. The five approved originals stay in their own
   renderer. Canvas is repainted on size/theme changes; small light studies use
   native CSS and follow the atmosphere controller's motion/visibility state. */
(function(){
  'use strict';
  var styles=['contour','prism','orbital','paper','dunes','mirror-hall','tideglass','etched-metal','porcelain','leather','cork-relief','slate'];
  var serial=0;
  var themes={
    contour:{dark:['#142b2d','#325f5a','#75978a','#a39b75'],light:['#e5eee6','#a4c1b0','#7d9c8d','#b6a484']},
    prism:{dark:['#192933','#4b7282','#9285a4','#bba08d'],light:['#e7eff0','#abcbd2','#bdb2cf','#dbc6b5']},
    orbital:{dark:['#14242f','#5e8698','#a6b8b7','#b7a78c'],light:['#ebece5','#9eb7ba','#64838c','#b9a27a']},
    paper:{dark:['#232c2b','#485e56','#71847b','#a59680'],light:['#efede3','#d5dbcc','#acbfb0','#d3baa0']},
    dunes:{dark:['#252b2d','#756e60','#9d8e70','#638a8c'],light:['#eee7db','#d4c1a2','#b8a180','#a7babc']},
    'mirror-hall':{dark:['#1b2931','#6b8e9a','#adbbb9','#baaaa0'],light:['#e4eceb','#b2c5ca','#71929a','#c4b3a8']},
    tideglass:{dark:['#12343e','#428d96','#83b5ae','#c0c9b2'],light:['#d7e8e5','#83b5bc','#4e959c','#cbd7bc']},
    'etched-metal':{dark:['#282e33','#667c88','#b1b8b7','#b4a992'],light:['#e6e8e5','#b4c1c6','#738b97','#c7b99f']},
    porcelain:{dark:['#233333','#719d8e','#a4bfaf','#b9a69a'],light:['#eeeee5','#bad5c8','#7da798','#d5bdac']},
    leather:{dark:['#292b28','#716451','#a68a67','#b2a084'],light:['#ebe5d9','#cab69b','#a28a6d','#7e8e7c']},
    'cork-relief':{dark:['#2d3029','#7c785c','#ac9e76','#7f9271'],light:['#eee9da','#d0bd95','#b4a17d','#99ad89']},
    slate:{dark:['#1c2732','#495969','#7c8c9a','#b5ad98'],light:['#e6e8e6','#a4b0b5','#70828e','#b4ac98']}
  };
  function rng(value){return function(){value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};}
  function alpha(hex,a){var n=parseInt(hex.slice(1),16);return 'rgba('+[n>>16,(n>>8)&255,n&255,a].join(',')+')';}
  function gradient(ctx,x,y,x2,y2,stops){var g=ctx.createLinearGradient(x,y,x2,y2);stops.forEach(function(s){g.addColorStop(s[0],s[1]);});return g;}
  function polygon(ctx,points,fill,stroke){ctx.beginPath();points.forEach(function(p,i){if(i)ctx.lineTo(p[0],p[1]);else ctx.moveTo(p[0],p[1]);});ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}}
  function path(ctx,data,fill,stroke,width){var p=new Path2D(data);if(fill){ctx.fillStyle=fill;ctx.fill(p);}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width||1;ctx.stroke(p);}return p;}
  function ellipse(ctx,x,y,rx,ry,fill,stroke){ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}}
  function shadow(ctx,light,blur){ctx.shadowColor=light?'#26393822':'#00000045';ctx.shadowBlur=blur;ctx.shadowOffsetY=blur*.3;}
  function resetShadow(ctx){ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;}
  function grain(ctx,w,h,colour,count,seedValue,shape){var random=rng(seedValue);ctx.save();if(shape)ctx.clip(shape);for(var i=0;i<count;i++){var x=random()*w,y=random()*h;ctx.fillStyle=alpha(colour,.035+random()*.065);ctx.fillRect(x,y,.5+random()*1.7,.4+random()*1.1);}ctx.restore();}
  function base(ctx,w,h,p){ctx.fillStyle=p[0];ctx.fillRect(0,0,w,h);var glow=ctx.createRadialGradient(w*.88,h*.2,0,w*.88,h*.2,Math.max(w,h)*.75);glow.addColorStop(0,alpha(p[1],.065));glow.addColorStop(1,alpha(p[1],0));ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);}
  function loops(ctx,x,y,rx,ry,phase){ctx.beginPath();for(var i=0;i<=110;i++){var a=i*Math.PI/55,k=1+.08*Math.sin(3*a+phase)+.035*Math.cos(5*a-phase),px=x+rx*k*Math.cos(a),py=y+ry*k*Math.sin(a);if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py);}ctx.closePath();}
  function contour(ctx,w,h,p,light){
    var s=Math.min(w,h),cx=w*.98,cy=h*.32;
    for(var i=0;i<20;i++){var q=1-i*.037;loops(ctx,cx+i*1.4,cy+i*2.6,s*.53*q,s*.40*q,.6+i*.06);ctx.fillStyle=alpha(p[i%3===0?3:1],light?.025:.035);ctx.fill();ctx.strokeStyle=alpha(p[i%4===0?3:2],light?.32:.29);ctx.lineWidth=i%5===0?1.2:.65;ctx.stroke();}
    for(var j=0;j<9;j++){loops(ctx,w*.03-j*3,h*.88+j*5,s*(.23-j*.015),s*(.19-j*.012),1.7);ctx.strokeStyle=alpha(p[2],.19);ctx.lineWidth=.7;ctx.stroke();}
    path(ctx,'M'+w*.72+' '+h*.12+'C'+w*.67+' '+h*.32+' '+w*.85+' '+h*.46+' '+w*.77+' '+h*.72,null,alpha(p[3],.25),1.5);
    grain(ctx,w,h,p[2],260,401);
    return '<path class="scene40-contour-current" d="M'+w*.72+' '+h*.12+'C'+w*.67+' '+h*.32+' '+w*.85+' '+h*.46+' '+w*.77+' '+h*.72+'" fill="none" stroke="'+alpha(p[3],.5)+'" stroke-width="1.2" stroke-dasharray="8 110"/>';
  }
  function prism(ctx,w,h,p,light){
    var s=Math.min(w,h),x=w*.83,y=h*.32;
    var a=[[x-s*.12,y-s*.45],[x+s*.17,y-s*.38],[x+s*.35,y+s*.20],[x+s*.05,y+s*.12]],b=[[x+s*.17,y-s*.38],[x+s*.25,y-s*.43],[x+s*.43,y+s*.15],[x+s*.35,y+s*.20]];
    shadow(ctx,light,s*.027);polygon(ctx,a,gradient(ctx,x-s*.2,y-s*.4,x+s*.4,y+s*.2,[[0,alpha(p[1],.10)],[.37,alpha(p[2],.28)],[.56,alpha('#ffffff',light?.45:.16)],[.76,alpha(p[1],.33)],[1,alpha(p[3],.20)]]));resetShadow(ctx);
    polygon(ctx,b,gradient(ctx,x,y,x+s*.5,y,[[0,alpha(p[2],.35)],[.5,alpha(p[1],.18)],[1,alpha(p[3],.50)]]),alpha(p[2],.35));
    path(ctx,'M'+a[0]+'L'+a[3]+'L'+a[2],null,alpha('#eefbff',light?.8:.45),1.2);
    var c=[[w*.02,h*.76],[w*.17,h*.69],[w*.24,h*.86],[w*.09,h*.92]];polygon(ctx,c,gradient(ctx,0,h*.7,w*.3,h,[[0,alpha(p[3],.13)],[.48,alpha(p[2],.32)],[1,alpha(p[1],.08)]]),alpha(p[2],.32));
    path(ctx,'M'+w*.59+' '+h*.27+'L'+w*.89+' '+h*.38+'L'+w*.87+' '+h*.42+'L'+w*.56+' '+h*.29+'Z',gradient(ctx,w*.55,0,w*.9,0,[[0,alpha(p[1],0)],[.55,alpha(p[1],.10)],[.72,alpha(p[2],.16)],[1,alpha(p[3],.15)]]));
    return '<path class="scene40-prism-ray" d="M'+w*.58+' '+h*.285+'L'+w*.9+' '+h*.4+'" stroke="'+alpha(p[3],.28)+'" stroke-width="'+s*.014+'"/>';
  }
  function orbital(ctx,w,h,p,light){
    var s=Math.min(w,h),x=w*.9,y=h*.29,r=s*.285;
    ctx.save();ctx.translate(x,y);ctx.rotate(-.33);
    for(var i=0;i<3;i++){ellipse(ctx,0,0,r*(1-i*.13),r*.70*(1-i*.1),null,alpha(p[i===1?3:1],i===1?.24:.45));}
    for(var t=0;t<60;t++){var a=t*Math.PI/30,k=t%5===0?1.045:1.016;ctx.beginPath();ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r*.7);ctx.lineTo(Math.cos(a)*r*k,Math.sin(a)*r*.7*k);ctx.strokeStyle=alpha(p[t%5===0?3:2],t%5===0?.6:.24);ctx.lineWidth=t%5===0?1:.6;ctx.stroke();}
    ellipse(ctx,-r*.15,r*.05,r*.30,r*.30,gradient(ctx,-r*.4,-r*.2,r*.3,r*.3,[[0,alpha(p[2],.64)],[.32,alpha(p[1],.34)],[.6,alpha(p[0],.9)],[1,p[0]]]),alpha(p[2],.3));
    ctx.restore();
    path(ctx,'M'+w*.04+' '+h*.86+'L'+w*.25+' '+h*.86+'M'+w*.08+' '+h*.83+'V'+h*.89+'M'+w*.21+' '+h*.84+'V'+h*.88,null,alpha(p[2],.32),.75);
    for(var j=0;j<7;j++)ellipse(ctx,w*(.07+j*.035),h*(.77+(j%3)*.017),j===2?2:1.1,j===2?2:1.1,alpha(p[3],.4));
    return '<g class="scene40-orbit-hand" style="transform-origin:'+x+'px '+y+'px"><path d="M'+x+' '+y+'L'+(x+r*.81)+' '+(y-r*.25)+'" stroke="'+alpha(p[3],.5)+'" stroke-width=".8"/><circle cx="'+(x+r*.81)+'" cy="'+(y-r*.25)+'" r="3" fill="'+p[3]+'"/></g>';
  }
  function paper(ctx,w,h,p,light){
    var s=Math.min(w,h),silhouettes=[];
    for(var i=0;i<5;i++){
      var x=w*.99+i*s*.025,y=h*.30+i*s*.036;
      var d='M'+(x+s*.22)+' '+(y-s*.36)+'C'+(x-s*.13)+' '+(y-s*.25)+' '+(x-s*.32)+' '+(y+s*.03)+' '+(x-s*.20)+' '+(y+s*.20)+'C'+(x-s*.08)+' '+(y+s*.39)+' '+(x+s*.20)+' '+(y+s*.27)+' '+(x+s*.36)+' '+(y+s*.32)+'Z';
      shadow(ctx,light,14);var shape=path(ctx,d,gradient(ctx,x-s*.3,y,x+s*.1,y+s*.4,[[0,alpha(p[i%2?1:2],.90)],[1,p[0]]]),alpha('#ffffff',light?.46:.10));resetShadow(ctx);silhouettes.push(shape);
    }
    for(var j=0;j<3;j++){var y2=h*.88+j*s*.06;shadow(ctx,light,12);path(ctx,'M-'+s*.2+' '+y2+'C'+s*.06+' '+(y2-s*.26)+' '+s*.27+' '+(y2-s*.18)+' '+s*.40+' '+(y2+s*.05)+'L0 '+(y2+s*.26)+'Z',gradient(ctx,0,y2-s*.2,s*.3,y2+s*.2,[[0,alpha(p[j%2?3:1],.78)],[1,p[0]]]));resetShadow(ctx);}
    grain(ctx,w,h,p[3],650,1703);
    return '<ellipse class="scene40-paper-light" cx="'+w*.88+'" cy="'+h*.4+'" rx="'+s*.23+'" ry="'+s*.35+'" fill="url(#LIGHT)" opacity=".13"/>';
  }
  function dunes(ctx,w,h,p,light){
    var s=Math.min(w,h),ridges=[];
    for(var j=0;j<4;j++){
      var y=h*(.65+j*.068),d='M-'+w*.1+' '+(y+s*.04)+'C'+w*.17+' '+(y-s*.12)+' '+w*.4+' '+(y+s*.08)+' '+w*.60+' '+(y-s*.09)+'S'+w*.91+' '+(y-s*.23)+' '+w*1.10+' '+(y-s*.11)+'L'+w*1.10+' '+h*1.1+'H-'+w*.1+'Z';
      var g=gradient(ctx,0,y-s*.10,0,h*1.1,[[0,alpha(p[j===0?3:j%2?2:1],light?.7:.55)],[.3,alpha(p[j%2?1:2],.32)],[1,p[0]]]);
      path(ctx,d,g);ridges.push(d);
    }
    ctx.save();ctx.clip(new Path2D(ridges[2]));
    for(var n=0;n<26;n++){var yy=h*.79+n*s*.007;path(ctx,'M'+w*.61+' '+yy+'Q'+w*.86+' '+(yy-s*.16)+' '+w*1.07+' '+(yy-s*.08),null,alpha(p[3],light?.20:.13),.65);}
    ctx.restore();grain(ctx,w,h,p[2],350,490);
    return '<path class="scene40-dune-light" d="M'+w*.6+' '+h*.56+'Q'+w*.84+' '+h*.40+' '+w*1.07+' '+h*.51+'" fill="none" stroke="'+alpha(p[3],.16)+'" stroke-width="2"/>';
  }
  function mirror(ctx,w,h,p,light){
    var s=Math.min(w,h),floor=h*.72,quads=[];
    for(var i=0;i<3;i++){
      var x=w*(.68+i*.135),top=h*(.02+i*.07),wide=s*(.15-i*.014);
      var q=[[x,top],[x+wide,top+s*.02],[x+wide-s*.055,floor],[x-s*.065,floor-s*.027]];quads.push(q);
    }
    function panes(reflected){
      quads.forEach(function(q,i){
        shadow(ctx,light,reflected?0:13);polygon(ctx,q,gradient(ctx,q[0][0],0,q[1][0],0,[[0,alpha(p[2],.40)],[.06,alpha('#ffffff',light?.62:.34)],[.10,alpha(p[1],.18)],[.45,alpha(p[0],.70)],[.73,alpha(p[1],.48)],[1,alpha(p[2],.55)]]));resetShadow(ctx);
        ctx.save();ctx.beginPath();q.forEach(function(pt,k){if(k)ctx.lineTo(pt[0],pt[1]);else ctx.moveTo(pt[0],pt[1]);});ctx.closePath();ctx.clip();
        var xx=q[0][0],yy=floor*.47;
        path(ctx,'M'+(xx-s*.03)+' '+yy+'Q'+(xx+s*.04)+' '+(yy-s*.10)+' '+(xx+s*.13)+' '+(yy-s*.06)+'L'+(xx+s*.17)+' '+floor+'H'+(xx+s*.04)+'Z',alpha(p[3],.12));
        path(ctx,'M'+(xx+s*.08)+' '+h*.15+'L'+(xx+s*.035)+' '+floor,null,alpha(p[2],.4),1.3);ctx.restore();
        ctx.strokeStyle=alpha('#ecf4f2',light?.80:.50);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(q[0][0],q[0][1]);ctx.lineTo(q[3][0],q[3][1]);ctx.stroke();
      });
    }
    ctx.save();ctx.globalAlpha=.20;ctx.translate(0,floor*2);ctx.scale(1,-.52);ctx.translate(0,floor*(1/.52-1));panes(true);ctx.restore();panes(false);
    path(ctx,'M'+w*.61+' '+floor+'L'+w*1.08+' '+(floor+s*.014),null,alpha(p[2],.15),.8);
    var clips=quads.map(function(q){return '<polygon points="'+q.map(function(v){return v.join(',');}).join(' ')+'"/>';}).join('');
    return '<defs><clipPath id="MIRRORS">'+clips+'</clipPath></defs><g clip-path="url(#MIRRORS)"><path class="scene40-mirror-light" d="M'+w*.64+' 0L'+w*.73+' 0L'+w*.92+' '+h+'L'+w*.83+' '+h+'Z" fill="url(#SHINE)" opacity=".45"/></g>';
  }
  function metal(ctx,w,h,p,light){
    var s=Math.min(w,h),d='M-'+s*.08+' '+h*.12+'C'+s*.22+' '+h*.32+' '+s*.25+' '+h*.58+' '+s*.04+' '+h*.93+'L-'+s*.14+' '+h*1.1+'Z';
    shadow(ctx,light,24);var sheet=path(ctx,d,gradient(ctx,-s*.1,0,s*.25,0,[[0,p[1]],[.20,alpha(p[2],.65)],[.41,alpha('#ffffff',light?.75:.45)],[.50,alpha(p[1],.70)],[.7,alpha(p[0],.80)],[1,alpha(p[2],.55)]]));resetShadow(ctx);
    ctx.save();ctx.clip(sheet);var random=rng(4802);for(var i=0;i<390;i++){var yy=random()*h;path(ctx,'M-'+s*.1+' '+yy+'L'+s*.35+' '+(yy+s*.04),null,alpha(p[2],.035+random()*.10),.35);}ctx.restore();
    var d2='M'+w*.76+' '+h*1.04+'C'+w*.74+' '+h*.78+' '+w*.85+' '+h*.76+' '+w*1.06+' '+h*.68+'L'+w*1.1+' '+h*1.1+'Z';
    path(ctx,d2,gradient(ctx,w*.75,h*.8,w,h,[[0,alpha(p[3],.12)],[.38,alpha(p[2],.4)],[.42,alpha('#ffffff',light?.6:.3)],[.47,alpha(p[1],.24)],[1,p[0]]]));
    return '<path class="scene40-metal-light" d="'+d+'" fill="url(#LIGHT)" opacity=".24"/>';
  }
  function porcelain(ctx,w,h,p,light){
    var s=Math.min(w,h),x=w*.94,y=h*.28,r=s*.34;
    ctx.save();ctx.translate(x,y);ctx.rotate(.38);shadow(ctx,light,26);
    ellipse(ctx,0,0,r*.88,r,gradient(ctx,-r,-r,r,r,[[0,alpha(p[2],.9)],[.28,alpha('#edf3e8',light?.8:.45)],[.56,alpha(p[1],.92)],[1,alpha(p[3],.24)]]));resetShadow(ctx);
    ellipse(ctx,-r*.025,-r*.075,r*.69,r*.79,gradient(ctx,-r*.5,-r,r*.5,r,[[0,alpha(p[0],.95)],[.45,alpha(p[1],.35)],[1,alpha(p[2],.8)]]),alpha(p[2],.46));
    ctx.beginPath();ctx.ellipse(-r*.025,-r*.075,r*.73,r*.83,0,3.6,5.7);ctx.strokeStyle=alpha('#ffffff',light?.8:.38);ctx.lineWidth=2;ctx.stroke();
    var random=rng(927);for(var i=0;i<22;i++){var a=random()*Math.PI*2,rr=r*(.69+random()*.1);path(ctx,'M'+Math.cos(a)*rr+' '+Math.sin(a)*rr+'l'+(random()*8-4)+' '+(random()*10-5),null,alpha(p[2],.14),.5);}
    ctx.restore();
    ellipse(ctx,w*.03,h*.90,s*.18,s*.11,gradient(ctx,0,h*.78,s*.2,h,[[0,alpha(p[1],.15)],[.5,alpha(p[2],.48)],[1,p[0]]]),alpha(p[2],.25));
    return '<ellipse class="scene40-glaze-light" cx="'+x+'" cy="'+y+'" rx="'+r*.84+'" ry="'+r*.95+'" fill="url(#LIGHT)" opacity=".18"/>';
  }
  function leather(ctx,w,h,p,light){
    var s=Math.min(w,h),d='M-'+s*.2+' '+h*.20+'C'+s*.31+' '+h*.18+' '+s*.44+' '+h*.55+' '+s*.27+' '+h*.83+'C'+s*.18+' '+h*.98+' '+s*.07+' '+h*1.05+'-'+s*.2+' '+h*1.08+'Z';
    shadow(ctx,light,24);var piece=path(ctx,d,gradient(ctx,0,h*.25,s*.4,h*.7,[[0,alpha(p[1],.64)],[.45,alpha(p[2],.90)],[.7,alpha(p[1],.66)],[1,p[0]]]));resetShadow(ctx);
    grain(ctx,w,h,p[0],4000,9274,piece);
    ctx.save();ctx.setLineDash([2.4,5.5]);path(ctx,'M-'+s*.15+' '+h*.23+'C'+s*.27+' '+h*.24+' '+s*.39+' '+h*.56+' '+s*.23+' '+h*.81+'Q'+s*.12+' '+h*1.02+'-'+s*.15+' '+h*1.03,null,alpha(p[3],light?.75:.42),1);ctx.restore();
    var x=w*.93,y=h*.17;for(var j=0;j<7;j++){var yy=y+j*s*.025;path(ctx,'M'+(x-s*.14)+' '+yy+'Q'+x+' '+(yy+s*.09)+' '+(x+s*.16)+' '+(yy-s*.03),null,alpha(p[2],.13),1.2);}
    return '<path class="scene40-leather-light" d="'+d+'" fill="url(#LIGHT)" opacity=".10"/>';
  }
  function cork(ctx,w,h,p,light){
    var s=Math.min(w,h),x=w*.94,y=h*.37,r=s*.35,pts=[];
    pts.push([x-r*.2,y+r*.45]);for(var i=0;i<=38;i++){var a=Math.PI*(1.14+i*.022),k=1+.025*Math.sin(i*1.6);pts.push([x+r*k*Math.cos(a),y+r*k*Math.sin(a)]);}pts.push([x+r*.07,y+r*.43]);
    ctx.beginPath();pts.forEach(function(pt,j){if(j)ctx.lineTo(pt[0],pt[1]);else ctx.moveTo(pt[0],pt[1]);});ctx.closePath();
    var shape=new Path2D();pts.forEach(function(pt,j){if(j)shape.lineTo(pt[0],pt[1]);else shape.moveTo(pt[0],pt[1]);});shape.closePath();
    shadow(ctx,light,18);ctx.fillStyle=gradient(ctx,x-r,y-r,x+r,y+r,[[0,alpha(p[2],.75)],[.48,alpha(p[1],.93)],[1,alpha(p[3],.38)]]);ctx.fill(shape);resetShadow(ctx);
    ctx.save();ctx.clip(shape);var random=rng(888);for(var n=0;n<2200;n++){var xx=x-r+random()*r*2,yy=y-r+random()*r*1.5;ctx.fillStyle=alpha(n%3?p[0]:p[2],.05+random()*.1);ctx.fillRect(xx,yy,1+random()*4,1+random()*2.6);}
    for(var k=0;k<19;k++){var angle=Math.PI*(1.14+k*.047);path(ctx,'M'+(x-r*.06)+' '+(y+r*.4)+'Q'+(x+r*.32*Math.cos(angle))+' '+(y+r*.14)+' '+(x+r*Math.cos(angle))+' '+(y+r*Math.sin(angle)),null,alpha(p[0],.11),1);}
    ctx.restore();
    path(ctx,'M'+(x-r*.08)+' '+(y+r*.37)+'Q'+(x-r*.11)+' '+(y+r*.68)+' '+(x+r*.03)+' '+(y+r*.93),null,alpha(p[2],.42),2.5);
    for(var m=0;m<3;m++){shadow(ctx,light,8);ellipse(ctx,w*(.04+m*.065),h*(.87+(m%2)*.035),s*(.065-m*.008),s*(.085-m*.01),alpha(p[m%2?1:3],.38));resetShadow(ctx);}
    return '<ellipse class="scene40-cork-light" cx="'+x+'" cy="'+y+'" rx="'+r+'" ry="'+r*.8+'" fill="url(#LIGHT)" opacity=".12"/>';
  }
  function slate(ctx,w,h,p,light){
    var s=Math.min(w,h),shapes=[[[.91,-.08],[1.12,.04],[1.06,.60],[.75,.74],[.80,.39]],[[.81,.39],[1.06,.26],[1.12,.75],[.88,.88],[.71,.76]],[[.0,.74],[.19,.83],[.30,1.09],[-.08,1.1]]];
    shapes.forEach(function(q,i){var points=q.map(function(t){return[t[0]*w,t[1]*h];});shadow(ctx,light,22);polygon(ctx,points,gradient(ctx,w*.7,h*.2,w*1.07,h,[[0,alpha(p[1],.84)],[.52,alpha(p[i===1?2:1],.58)],[1,p[0]]]),alpha(p[2],.23));resetShadow(ctx);
      ctx.save();ctx.beginPath();points.forEach(function(pt,j){if(j)ctx.lineTo(pt[0],pt[1]);else ctx.moveTo(pt[0],pt[1]);});ctx.closePath();ctx.clip();var random=rng(300+i);for(var k=0;k<64;k++){var yy=random()*h;path(ctx,'M0 '+yy+'L'+w+' '+(yy-s*.23),null,alpha(p[2],.04+random()*.07),.45);}ctx.restore();
    });
    path(ctx,'M'+w*.82+' '+h*.30+'L'+w*.79+' '+h*.51+'L'+w*.86+' '+h*.62+'L'+w*.76+' '+h*.78,null,alpha(p[3],.40),1.1);
    return '<path class="scene40-slate-light" d="M'+w*.82+' '+h*.30+'L'+w*.79+' '+h*.51+'L'+w*.86+' '+h*.62+'L'+w*.76+' '+h*.78+'" fill="none" stroke="'+alpha(p[3],.45)+'" stroke-width="2"/>';
  }
  function tideStill(ctx,w,h,p,light){
    var s=Math.min(w,h);ctx.fillStyle=gradient(ctx,0,h,w,0,[[0,p[0]],[.45,p[1]],[1,p[0]]]);ctx.fillRect(0,0,w,h);
    for(var i=0;i<22;i++){var yy=h*.5+i*s*.018;path(ctx,'M-'+s*.1+' '+yy+'C'+w*.32+' '+(yy+s*.07)+' '+w*.60+' '+(yy-s*.28)+' '+w*1.1+' '+(yy-s*.22),null,alpha(p[2],.10+(i%3)*.03),i%3===0?2:.7);}
    ellipse(ctx,w*.9,h*.31,s*.045,s*.025,alpha(p[0],.5),alpha(p[3],.25));return '';
  }
  var painters={contour:contour,prism:prism,orbital:orbital,paper:paper,dunes:dunes,'mirror-hall':mirror,'tideglass':tideStill,'etched-metal':metal,porcelain:porcelain,leather:leather,'cork-relief':cork,slate:slate};
  function paint(canvas,style,width,height,light,ratio,layout){
    var ctx=canvas.getContext('2d',{alpha:false});if(!ctx)return '';
    canvas.width=Math.max(1,Math.floor(width*ratio));canvas.height=Math.max(1,Math.floor(height*ratio));ctx.setTransform(ratio,0,0,ratio,0,0);
    var p=themes[style][light?'light':'dark'];base(ctx,width,height,p);return painters[style](ctx,layout?layout.width:width,layout?layout.height:height,p,light)||'';
  }
  function create(entry,camera){
    var style=entry.style;
    if(style==='tideglass'&&!entry.staticWater&&window.LissWaterFieldV40)return window.LissWaterFieldV40.create(entry,camera);
    var root=document.createElement('div'),canvas=document.createElement('canvas'),overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');
    root.className='community-vector-scene community-procedural-scene scene40';root.dataset.vectorStyle=style;root.dataset.sceneRevision='v40';root.dataset.sceneMotion='paused';root.setAttribute('aria-hidden','true');
    canvas.className='scene40-paint';overlay.setAttribute('class','scene40-overlay');overlay.setAttribute('preserveAspectRatio','none');root.append(canvas,overlay);
    var key='',field=null,closed=false,draws=0,running=false,id='scene40-'+(++serial);
    function resize(width,height,light){
      if(closed)return;var sig=[Math.round(width),Math.round(height),!!light,devicePixelRatio||1].join(':');if(sig===key)return field;key=sig;
      field={width:Math.max(1,width)+camera.overscan*2,height:Math.max(1,height)*camera.viewportSpan+camera.overscan*2,viewportSpan:camera.viewportSpan,overscan:camera.overscan,travel:Math.max(1,height)*(camera.viewportSpan-1),scrollRate:camera.scrollRate,viewBoxHeight:camera.viewBoxHeight};
      root.style.width=field.width+'px';root.style.height=field.height+'px';root.style.left=root.style.top=-camera.overscan+'px';root.style.right=root.style.bottom='auto';root.dataset.sceneTheme=light?'light':'dark';
      var layout=style==='tideglass'?null:{width:field.width-camera.overscan*1.2,height:Math.max(1,height)+camera.overscan*2};
      var ratio=Math.min(1.5,devicePixelRatio||1,Math.sqrt((entry.preview?140000:2400000)/(field.width*field.height))),art=paint(canvas,style,field.width,field.height,light,ratio,layout);
      overlay.setAttribute('viewBox','0 0 '+field.width+' '+field.height);
      var defs='<defs><radialGradient id="'+id+'-LIGHT"><stop stop-color="white" stop-opacity=".30"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient><linearGradient id="'+id+'-SHINE"><stop stop-color="white" stop-opacity="0"/><stop offset=".48" stop-color="white" stop-opacity="0"/><stop offset=".52" stop-color="white" stop-opacity=".7"/><stop offset=".59" stop-color="white" stop-opacity="0"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient></defs>';
      overlay.innerHTML=defs+art.replaceAll('LIGHT',id+'-LIGHT').replaceAll('SHINE',id+'-SHINE').replaceAll('MIRRORS',id+'-MIRRORS');draws++;return field;
    }
    function setMotion(value){if(closed)return;running=!!value;root.dataset.sceneMotion=running?'running':'paused';}
    return{element:root,resize:resize,setMotion:setMotion,inspect:function(){return{style:style,revision:'v40',technique:'canvas2d-and-svg-light',field:field?Object.assign({},field):null,canvasPixels:canvas.width*canvas.height,canvasPixelBudget:entry.preview?140000:2400000,draws:draws,ownRAF:false,imageRequests:0,glContexts:0,decorativeMotion:{engine:'native-css',running:running,continuousJS:false,fullSceneRotation:false}};},destroy:function(){if(closed)return;closed=true;running=false;canvas.width=canvas.height=1;root.remove();}};
  }
  window.LissSceneDesignsV40={has:function(style){return styles.indexOf(style)>=0;},create:create,styles:Object.freeze(styles),paintThumbnail:function(canvas,style,light){paint(canvas,style,canvas.width,canvas.height,!!light,1);}};
})();
