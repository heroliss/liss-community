/* Two pattern studies over the original spectrum. Its CSS colour fields and
   slow motion are reused unchanged; only the transparent artwork is new. */
(function(){
  'use strict';
  var procedural=window.LissProceduralScenes,previous=window.LissSceneDesignsV40;
  if(!procedural||!previous||window.LissSpectrumStudiesV44)return;
  var names=['spectrum-botanical','spectrum-ripples'],serial=0,colours=['#7963d5','#3ab6a5','#df8878'];
  function alpha(hex,a){var n=parseInt(hex.slice(1),16);return 'rgba('+[n>>16,(n>>8)&255,n&255,a].join(',')+')';}
  function geometry(style,w,h,light){
    var s=Math.min(w,h),shapes=[],gradients=[],shine=light?'#ffffff':'#d9ecec';
    function gradient(name,x1,y1,x2,y2,stops){gradients.push({name:name,x1:x1,y1:y1,x2:x2,y2:y2,stops:stops});return name;}
    function add(d,fill,stroke,width,cls){shapes.push({d:d,fill:fill,stroke:stroke,width:width||1,cls:cls||''});}
    function leaf(x,y,tx,ty,wide,c,index){
      x*=w;tx*=w;y*=h;ty*=h;wide*=s;
      var dx=tx-x,dy=ty-y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
      var face=gradient('leaf'+index,x+nx*wide,y+ny*wide,tx-nx*wide,ty-ny*wide,[[0,alpha(colours[c],light?.12:.15)],[.44,alpha(colours[c],light?.28:.31)],[.52,alpha(shine,light?.35:.22)],[.59,alpha(colours[(c+1)%3],light?.18:.23)],[1,alpha(colours[c],.035)]]);
      var d='M'+x+' '+y+'C'+(x+dx*.25+nx*wide)+' '+(y+dy*.25+ny*wide)+' '+(x+dx*.72+nx*wide*.9)+' '+(y+dy*.72+ny*wide*.9)+' '+tx+' '+ty+'C'+(x+dx*.65-nx*wide*.6)+' '+(y+dy*.65-ny*wide*.6)+' '+(x+dx*.16-nx*wide*.6)+' '+(y+dy*.16-ny*wide*.6)+' '+x+' '+y+'Z';
      add(d,face,alpha(colours[(c+1)%3],light?.17:.22),.7);
      add('M'+x+' '+y+'Q'+(x+dx*.50+nx*wide*.08)+' '+(y+dy*.50+ny*wide*.08)+' '+tx+' '+ty,null,alpha(shine,light?.24:.18),.7,'scene44-leaf-vein');
    }
    if(style==='spectrum-botanical'){
      // One loose frond enters from the upper right. Broad translucent leaves
      // share a stem, rather than scattered decorative dashes across the page.
      var inset=w<760?.11:.055;
      add('M'+w*(1.07-inset)+' -'+h*.07+'C'+w*(.95-inset)+' '+h*.12+' '+w*(.91-inset)+' '+h*.36+' '+w*(.99-inset)+' '+h*.69,null,alpha(colours[1],light?.29:.35),s*.0015);
      [[.987,.115,.805,.035,.049,0],[.964,.19,1.12,.09,.047,1],[.947,.275,.758,.145,.050,1],[.943,.36,1.125,.255,.052,0],[.952,.445,.772,.365,.049,2],[.968,.535,1.13,.49,.046,1],[.985,.625,.838,.578,.041,0]].forEach(function(p,i){p[0]-=inset;p[2]-=inset;leaf.apply(null,p.concat(i));});
      add('M-'+w*.08+' '+h*.72+'Q'+w*.06+' '+h*.84+' '+w*.27+' '+h*1.02,null,alpha(colours[2],light?.23:.28),s*.0013);
      [[.015,.797,.026,.633,.043,2],[.074,.846,.19,.735,.047,0],[.125,.888,.077,1.035,.039,1],[.188,.94,.308,.879,.038,2]].forEach(function(p,i){leaf.apply(null,p.concat(i+7));});
    }else{
      // Offset cut-glass crescents have a filled face and a polished shoulder.
      // Vary their width and opening so this reads as a printed ripple motif,
      // not an orbital diagram or a stack of thin concentric circles.
      for(var i=0;i<5;i++){
        var x=w*(1.045+i*.004),y=h*(.33+i*.006),rx=s*(.405-i*.058),ry=s*(.38-i*.049),gap=s*(.022+i*.0018);
        var d='M'+(x+rx*.37)+' '+(y-ry*.94)+'C'+(x-rx*.75)+' '+(y-ry*1.25)+' '+(x-rx*1.23)+' '+(y-ry*.05)+' '+(x-rx*.73)+' '+(y+ry*.72)+'C'+(x-rx*.31)+' '+(y+ry*1.19)+' '+(x+rx*.39)+' '+(y+ry*.96)+' '+(x+rx*.65)+' '+(y+ry*.52)+'C'+(x+rx*.22)+' '+(y+ry*.93-gap)+' '+(x-rx*.30)+' '+(y+ry*.96-gap)+' '+(x-rx*.64+gap)+' '+(y+ry*.62-gap)+'C'+(x-rx*1.07+gap)+' '+(y-ry*.02)+' '+(x-rx*.72+gap)+' '+(y-ry*1.08+gap)+' '+(x+rx*.37)+' '+(y-ry*.94)+'Z';
        var fill=gradient('ripple'+i,x-rx,y-ry,x+rx*.7,y+ry,[[0,alpha(colours[i%3],light?.10:.14)],[.33,alpha(colours[i%3],light?.28:.34)],[.48,alpha(shine,light?.37:.25)],[.57,alpha(colours[(i+1)%3],light?.24:.29)],[.81,alpha(colours[i%3],.08)],[1,alpha(colours[i%3],0)]]);
        add(d,fill,alpha(colours[(i+1)%3],light?.16:.20),.7,i<2?'scene44-ripple-face':'');
      }
      for(var j=0;j<3;j++){
        var xx=-s*.17-j*s*.012,yy=h*(.93+j*.022),r=s*(.245-j*.055),rr=r*.60;
        var echo='M'+(xx-r*.18)+' '+(yy-rr)+'C'+(xx+r*.61)+' '+(yy-rr*1.36)+' '+(xx+r*1.24)+' '+(yy-rr*.12)+' '+(xx+r*.79)+' '+(yy+rr*.78)+'L'+(xx+r*.72)+' '+(yy+rr*.66)+'C'+(xx+r*1.05)+' '+(yy-rr*.12)+' '+(xx+r*.54)+' '+(yy-rr*1.11)+' '+(xx-r*.18)+' '+(yy-rr)+'Z';
        add(echo,gradient('echo'+j,xx,yy-rr,xx+r,yy+rr,[[0,alpha(colours[2],.025)],[.36,alpha(colours[j%3],light?.22:.28)],[.52,alpha(shine,light?.27:.19)],[1,alpha(colours[1],.025)]]),null);
      }
    }
    return{gradients:gradients,shapes:shapes};
  }
  function markup(art,id){
    var defs=art.gradients.map(function(g){return '<linearGradient id="'+id+'-'+g.name+'" gradientUnits="userSpaceOnUse" x1="'+g.x1+'" y1="'+g.y1+'" x2="'+g.x2+'" y2="'+g.y2+'">'+g.stops.map(function(stop){return '<stop offset="'+stop[0]+'" stop-color="'+stop[1]+'"/>';}).join('')+'</linearGradient>';}).join('');
    return '<defs>'+defs+'</defs>'+art.shapes.map(function(p){return '<path d="'+p.d+'" fill="'+(p.fill?'url(#'+id+'-'+p.fill+')':'none')+'"'+(p.stroke?' stroke="'+p.stroke+'" stroke-width="'+p.width+'"':'')+(p.cls?' class="'+p.cls+'"':'')+' vector-effect="non-scaling-stroke"/>';}).join('');
  }
  function thumbnail(canvas,style,light){
    var ctx=canvas.getContext('2d',{alpha:true});if(!ctx)return;
    var w=canvas.width,h=canvas.height,art=geometry(style,w,h,!!light),fills=Object.create(null);ctx.clearRect(0,0,w,h);
    art.gradients.forEach(function(g){var fill=ctx.createLinearGradient(g.x1,g.y1,g.x2,g.y2);g.stops.forEach(function(stop){fill.addColorStop(stop[0],stop[1]);});fills[g.name]=fill;});
    art.shapes.forEach(function(p){var shape=new Path2D(p.d);if(p.fill){ctx.fillStyle=fills[p.fill];ctx.fill(shape);}if(p.stroke){ctx.strokeStyle=p.stroke;ctx.lineWidth=p.width;ctx.stroke(shape);}});
  }
  function create(entry){
    var style=entry.style,base=procedural.create({id:'spectrum',style:'spectrum',kind:'vector'}),root=base.element,svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),id='scene44-'+(++serial),last='',closed=false,draws=0;
    // Keep data-vector-style=spectrum: all original colour and motion rules
    // continue to target these exact three underlying CSS fields.
    root.dataset.spectrumPattern=style;root.dataset.sceneRevision='v44';svg.setAttribute('class','scene44-pattern');svg.setAttribute('aria-hidden','true');svg.setAttribute('preserveAspectRatio','none');root.appendChild(svg);
    function resize(width,height,light){
      if(closed)return;var field=base.resize(width,height,light),key=[Math.round(width),Math.round(height),!!light].join(':');if(key===last)return field;last=key;
      var art=geometry(style,field.width,Math.max(1,height)+procedural.camera.overscan*2,!!light);svg.setAttribute('viewBox','0 0 '+field.width+' '+field.height);svg.innerHTML=markup(art,id);draws++;return field;
    }
    return{element:root,resize:resize,setMotion:function(value){if(!closed)base.setMotion(value);},inspect:function(){var state=base.inspect();state.style=style;state.baseStyle='spectrum';state.revision='v44';state.technique='css-and-svg-pattern';state.patternDraws=draws;state.patternOnly=true;return state;},destroy:function(){if(closed)return;closed=true;svg.replaceChildren();base.destroy();}};
  }
  var extension={has:function(style){return names.indexOf(style)>=0;},styles:Object.freeze(names),create:create,paintThumbnail:thumbnail};
  window.LissSpectrumStudiesV44=Object.freeze(extension);
  window.LissSceneDesignsV40={has:function(style){return extension.has(style)||previous.has(style);},create:function(entry,camera){return extension.has(entry.style)?create(entry):previous.create(entry,camera);},styles:Object.freeze(previous.styles.concat(names)),paintThumbnail:function(canvas,style,light){return(extension.has(style)?extension:previous).paintThumbnail(canvas,style,light);}};
  window.LissProceduralScenes=Object.assign({},procedural,{styles:Object.freeze(procedural.styles.concat(names))});
})();
