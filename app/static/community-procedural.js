/* Local worlds. Raster art is drawn once; slow decorative motion is native
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
    spectrum:['#7963d5','#3ab6a5','#df8878'],dunes:['#baaa8a','#6f9d9e','#8297ae'],
    'mirror-hall':['#91bfd2','#9395c8','#d9aaa5'],tideglass:['#6fc7bc','#6e9ec6','#abd5cb'],
    'etched-metal':['#ceb990','#819fb6','#d6aa7a'],
    porcelain:['#91cbb7','#8ea8cf','#dda69f'],leather:['#bb916d','#906f63','#d1aa80'],
    'cork-relief':['#c5a779','#91a17d','#d2b47e'],slate:['#899bc3','#7c789e','#afb6bd']
  };
  // The same pale pigment almost disappears against the light room. These
  // are material-tinted inks, not a brightness filter over the whole scene.
  var materialLightPalettes={
    'mirror-hall':['#5e92aa','#747da8','#b9827e'],tideglass:['#379992','#4e81ab','#76b2aa'],
    'etched-metal':['#a18861','#6887a1','#b68c5f'],porcelain:['#5ca795','#758db8','#bf7f78'],
    leather:['#a76e4d','#805e55','#bd8d59'],'cork-relief':['#aa864e','#7a915e','#bd955a'],
    slate:['#617aa7','#6d678f','#8796a4']
  };
  function element(tag,cls){var n=document.createElement(tag);n.className=cls;return n;}
  function seed(value){var n=value;return function(){n=(n*1664525+1013904223)>>>0;return n/4294967296;};}
  function contourLoop(cx,cy,rx,ry,phase){
    var path='';for(var n=0;n<=64;n++){var angle=n*Math.PI/32,variation=1+.045*Math.sin(3*angle+phase)+.028*Math.sin(5*angle-phase*.7),x=cx+rx*Math.cos(angle)*variation,y=cy+ry*Math.sin(angle)*variation;path+=(n?'L':'M')+x.toFixed(1)+' '+y.toFixed(1);}return path+'Z';
  }
  function prismMesh(id){
    var random=seed(62048),rows=6,cols=8,points=[],art='<g class="procedural-facets" stroke-width=".7" stroke-linejoin="round">',colors=['a','b','c'];
    for(var row=0;row<rows;row++){var line=[];for(var col=0;col<cols;col++)line.push([(-220+col*280+(col===0?0:(random()-.5)*105)).toFixed(1),(-110+row*310+(row===0?0:(random()-.5)*105)).toFixed(1)]);points.push(line);}
    var index=0;for(var y=0;y<rows-1;y++)for(var x=0;x<cols-1;x++){var a=points[y][x],b=points[y][x+1],c=points[y+1][x],d=points[y+1][x+1],tris=(x+y)%2?[[a,b,c],[b,d,c]]:[[a,b,d],[a,d,c]];tris.forEach(function(tri){var color=colors[(index*2+Math.floor(index/3))%3],opacity=(.032+random()*.055).toFixed(3);art+='<polygon points="'+tri.map(function(p){return p.join(',');}).join(' ')+'" fill="var(--scene-'+color+')" fill-opacity="'+opacity+'" stroke="var(--scene-'+color+')" stroke-opacity=".06"/>';index++;});}
    return art+'</g><path d="M-220 820L'+points[2][1].join(' ')+'L'+points[1][2].join(' ')+'L'+points[2][3].join(' ')+'L'+points[1][4].join(' ')+'" fill="none" stroke="var(--scene-a)" stroke-opacity=".11" stroke-width="1"/><ellipse cx="1290" cy="290" rx="420" ry="320" fill="url(#'+id+'-glow)" opacity=".5"/>';
  }
  function materialMarkup(style,id){
    // Material forms travel across the field; highlights and textures stay
    // subdued where the opening copy needs contrast.
    var defs='<defs><linearGradient id="'+id+'-material" x1="0" y1="0" x2="1" y2="1"><stop stop-color="var(--scene-a)" stop-opacity=".02"/><stop offset=".42" stop-color="var(--scene-b)" stop-opacity=".22"/><stop offset=".74" stop-color="var(--scene-a)" stop-opacity=".12"/><stop offset="1" stop-color="var(--scene-c)" stop-opacity=".03"/></linearGradient>'+
      '<linearGradient id="'+id+'-polish" x1="0" y1="0" x2="1" y2="0"><stop stop-color="white" stop-opacity="0"/><stop offset=".42" stop-color="var(--scene-a)" stop-opacity=".04"/><stop offset=".52" stop-color="white" stop-opacity=".14"/><stop offset=".59" stop-color="var(--scene-c)" stop-opacity=".03"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient>'+
      '<radialGradient id="'+id+'-depth"><stop stop-color="var(--scene-a)" stop-opacity=".28"/><stop offset=".66" stop-color="var(--scene-b)" stop-opacity=".10"/><stop offset="1" stop-color="var(--scene-b)" stop-opacity="0"/></radialGradient></defs>';
    if(style==='mirror-hall'){
      return defs+'<defs><linearGradient id="'+id+'-mirror-reflection" x1="0" y1="0" x2="0" y2="1"><stop stop-color="var(--scene-a)" stop-opacity=".22"/><stop offset="1" stop-color="var(--scene-b)" stop-opacity="0"/></linearGradient><clipPath id="'+id+'-mirror-floor"><rect x="0" y="698" width="1600" height="722"/></clipPath></defs>'+
        '<path d="M-70-70H1690V1490H-70Z" fill="url(#'+id+'-depth)" opacity=".12"/>'+
        '<path d="M-60-70H510L367 698H-60Z" fill="var(--scene-b)" fill-opacity=".055"/>'+
        '<path d="M-60 1490H520L367 698H-60Z" fill="var(--scene-a)" fill-opacity=".055"/>'+
        '<g id="'+id+'-mirror-panes" class="procedural-hall-architecture">'+
        '<path d="M535-65L1005-65L1153 698H777Z" fill="url(#'+id+'-material)"/>'+
        '<path d="M1165-65L1700-65V698H1202Z" fill="var(--scene-b)" fill-opacity=".11"/>'+
        '<path d="M407 59L543 59L684 698H455Z" fill="var(--scene-c)" fill-opacity=".08"/>'+
        '<path d="M541-65L777 698M1005-65L1153 698M1165-65L1202 698M405 59L455 698" fill="none" stroke="var(--scene-a)" stroke-opacity=".15" stroke-width="1.4"/>'+
        '<path d="M718 105L889 105L1000 698H815Z" fill="var(--scene-a)" fill-opacity=".09" stroke="var(--scene-c)" stroke-opacity=".21" stroke-width="2"/>'+
        '<path d="M1274 184L1428 184L1428 698H1274Z" fill="var(--scene-a)" fill-opacity=".07" stroke="var(--scene-a)" stroke-opacity=".18" stroke-width="2"/>'+
        '</g><path d="M-40 693C430 692 911 690 1660 694" fill="none" stroke="var(--scene-c)" stroke-opacity=".15" stroke-width="1.6"/>'+
        '<g clip-path="url(#'+id+'-mirror-floor)"><use href="#'+id+'-mirror-panes" transform="translate(0 1390) scale(1 -1)" opacity=".28"/>'+
        '<rect x="0" y="700" width="1600" height="720" fill="url(#'+id+'-mirror-reflection)" opacity=".3"/>'+
        '<path d="M-70 872C440 865 1000 881 1690 866M-70 1052C467 1040 1080 1070 1690 1045M-70 1260C454 1240 1097 1283 1690 1250" fill="none" stroke="var(--scene-a)" stroke-opacity=".10" stroke-width="1"/></g>'+
        '<g class="procedural-hall-glint"><path d="M260-60L300-60L820 1460L745 1460Z" fill="url(#'+id+'-polish)" opacity=".26"/>'+
        '<path d="M944-60L990-60L1360 1460L1290 1460Z" fill="url(#'+id+'-polish)" opacity=".34"/></g>';
    }
    if(style==='tideglass'){
      var caustics='',waveSeed=seed(9071);
      for(var row=0;row<4;row++)for(var col=0;col<7;col++){
        var x=-100+col*265+(waveSeed()-.5)*52,y=785+row*176+(waveSeed()-.5)*35;
        var span=210+waveSeed()*70,sag=25+waveSeed()*45,opacity=col<3?.11:.21;
        caustics+='<path d="M'+x.toFixed(1)+' '+y.toFixed(1)+'C'+(x+span*.22).toFixed(1)+' '+(y-sag).toFixed(1)+' '+(x+span*.62).toFixed(1)+' '+(y+sag).toFixed(1)+' '+(x+span).toFixed(1)+' '+(y-12).toFixed(1)+'" fill="none" stroke="url(#'+id+'-caustic)" stroke-opacity="'+opacity+'" stroke-width="'+(4+waveSeed()*5).toFixed(1)+'" stroke-linecap="round"/>';
        if((row+col)%2===0)caustics+='<path d="M'+(x+span*.38).toFixed(1)+' '+(y+6).toFixed(1)+'Q'+(x+span*.47).toFixed(1)+' '+(y+73).toFixed(1)+' '+(x+span*.63).toFixed(1)+' '+(y+149).toFixed(1)+'" fill="none" stroke="var(--scene-c)" stroke-opacity="'+(opacity*.47).toFixed(3)+'" stroke-width="1.4"/>';
      }
      return defs+'<defs><linearGradient id="'+id+'-water" x1="0" y1="0" x2=".72" y2="1"><stop stop-color="var(--scene-a)" stop-opacity=".02"/><stop offset=".38" stop-color="var(--scene-a)" stop-opacity=".22"/><stop offset="1" stop-color="var(--scene-b)" stop-opacity=".34"/></linearGradient>'+
        '<linearGradient id="'+id+'-caustic" x1="0" y1="0" x2="1" y2="0"><stop stop-color="var(--scene-a)" stop-opacity=".06"/><stop offset=".5" stop-color="white" stop-opacity=".72"/><stop offset="1" stop-color="var(--scene-b)" stop-opacity=".05"/></linearGradient>'+
        '<clipPath id="'+id+'-waterclip"><path d="M-80 680C270 634 470 706 750 654S1284 591 1690 651V1500H-80Z"/></clipPath></defs>'+
        '<path d="M-80 680C270 634 470 706 750 654S1284 591 1690 651V1500H-80Z" fill="url(#'+id+'-water)"/>'+
        '<path d="M-80 680C270 634 470 706 750 654S1284 591 1690 651" fill="none" stroke="var(--scene-c)" stroke-opacity=".19" stroke-width="1.5"/>'+
        '<path d="M-80 712C275 665 486 735 765 685S1289 626 1690 684" fill="none" stroke="var(--scene-b)" stroke-opacity=".08" stroke-width="10"/>'+
        '<g clip-path="url(#'+id+'-waterclip)"><path d="M-100 1075C275 1042 525 1119 788 1048S1290 974 1700 1035V1500H-100Z" fill="var(--scene-b)" fill-opacity=".08"/>'+
        '<g class="procedural-tide-caustics">'+caustics+'</g>'+
        '<g class="procedural-tide-sheen"><path d="M-80 688C270 644 480 715 762 663S1290 602 1700 663L1700 708C1300 654 1062 659 777 720S268 701-80 745Z" fill="url(#'+id+'-polish)" opacity=".62"/></g></g>'+
        '<ellipse cx="1120" cy="1190" rx="690" ry="310" fill="url(#'+id+'-depth)" opacity=".28"/>';
    }
    if(style==='etched-metal'){
      var scratches='';
      var random=seed(4503);
      for(var i=0;i<28;i++){
        var x=-70+random()*1710,y=550+random()*830,len=24+random()*120;
        scratches+='<path d="M'+x.toFixed(1)+' '+y.toFixed(1)+'l'+len.toFixed(1)+' -'+(len*.16).toFixed(1)+'" stroke="var(--scene-'+(i%4===0?'c':'a')+')" stroke-opacity="'+(i%6===0?'.23':'.10')+'" stroke-width="'+(i%6===0?'1.1':'.6')+'"/>';
      }
      return defs+'<defs><pattern id="'+id+'-brush" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-9)"><path d="M1 0V9M4.5 0V9M7 0V9" fill="none" stroke="var(--scene-a)" stroke-opacity=".16" stroke-width=".55"/></pattern>'+
        '<linearGradient id="'+id+'-foil" x1="0" y1="0" x2="1" y2=".25"><stop stop-color="var(--scene-b)" stop-opacity=".02"/><stop offset=".37" stop-color="var(--scene-a)" stop-opacity=".13"/><stop offset=".58" stop-color="var(--scene-c)" stop-opacity=".26"/><stop offset=".68" stop-color="var(--scene-b)" stop-opacity=".10"/><stop offset="1" stop-color="var(--scene-a)" stop-opacity=".18"/></linearGradient></defs>'+
        '<path d="M-80 900L453 690L803 832L188 1500H-80Z" fill="var(--scene-a)" fill-opacity=".09"/>'+
        '<path d="M437-70H1670L1440 723L788 830Z" fill="url(#'+id+'-foil)"/>'+
        '<path d="M788 830L1440 723L1670 1460L188 1500Z" fill="url(#'+id+'-material)" opacity=".90"/>'+
        '<path d="M-80 900L453 690L803 832L188 1500H-80Z" fill="url(#'+id+'-brush)" opacity=".67"/>'+
        '<path d="M437-70H1670L1440 723L788 830Z" fill="url(#'+id+'-brush)" opacity=".74"/>'+
        '<path d="M788 830L1440 723L1670 1460L188 1500Z" fill="url(#'+id+'-brush)" opacity=".60"/>'+
        '<path d="M-80 900L453 690L803 832L1440 723" fill="none" stroke="var(--scene-c)" stroke-opacity=".15" stroke-width="1.2"/>'+
        '<path d="M788 830L188 1500M1440 723L1670 1460" fill="none" stroke="var(--scene-a)" stroke-opacity=".11" stroke-width="1.6"/>'+
        '<g fill="none">'+scratches+'</g>'+
        '<g class="procedural-metal-glint"><path d="M610-90L679-90L1140 1490L1045 1490Z" fill="url(#'+id+'-polish)" opacity=".39"/>'+
        '<path d="M1050-90L1125-90L1580 1490L1480 1490Z" fill="url(#'+id+'-polish)" opacity=".30"/></g>';
    }
    if(style==='porcelain'){
      return defs+'<defs><radialGradient id="'+id+'-glaze" cx=".34" cy=".28" r=".85"><stop stop-color="var(--scene-c)" stop-opacity=".17"/><stop offset=".25" stop-color="var(--scene-c)" stop-opacity=".26"/><stop offset=".69" stop-color="var(--scene-a)" stop-opacity=".20"/><stop offset="1" stop-color="var(--scene-b)" stop-opacity=".06"/></radialGradient><linearGradient id="'+id+'-porcelain-rim" x1="0" y1="0" x2=".85" y2="1"><stop stop-color="white" stop-opacity=".18"/><stop offset=".46" stop-color="var(--scene-a)" stop-opacity=".23"/><stop offset=".67" stop-color="var(--scene-b)" stop-opacity=".10"/><stop offset="1" stop-color="white" stop-opacity=".11"/></linearGradient></defs>'+
        '<path d="M-110 881C248 816 374 884 633 1049C936 1243 1229 952 1770 770V1510H-110Z" fill="url(#'+id+'-glaze)" opacity=".43"/>'+
        '<ellipse cx="1212" cy="488" rx="614" ry="365" transform="rotate(-16 1212 488)" fill="url(#'+id+'-glaze)" stroke="url(#'+id+'-porcelain-rim)" stroke-width="5" opacity=".82"/>'+
        '<ellipse cx="1212" cy="488" rx="520" ry="287" transform="rotate(-16 1212 488)" fill="none" stroke="var(--scene-b)" stroke-opacity=".16" stroke-width="2.5"/>'+
        '<path d="M653 522C804 371 1098 208 1413 237C1530 249 1623 314 1704 382" fill="none" stroke="white" stroke-opacity=".11" stroke-width="7" stroke-linecap="round"/>'+
        '<path d="M-90 1048C168 973 328 988 523 1134S841 1366 1132 1282" fill="none" stroke="url(#'+id+'-porcelain-rim)" stroke-width="42" opacity=".34"/>'+
        '<path d="M-90 1019C166 955 347 981 531 1112S844 1330 1101 1255" fill="none" stroke="var(--scene-a)" stroke-opacity=".27" stroke-width="2.4"/>'+
        '<g fill="none" stroke="var(--scene-b)" stroke-opacity=".15" stroke-width="1"><path d="M974 361l45 21 17 59 43 26m-43-26 61-18 32 20M1399 569l-19 35 35 32 11 40m-11-40 47-13"/><path d="M209 1130l33 12 18 30 42 9m-42-9-22 29M855 1170l34 13 9 25 38 7"/></g>'+
        '<g class="procedural-porcelain-glaze"><path d="M777 449C1016 224 1437 203 1655 414" fill="none" stroke="url(#'+id+'-polish)" stroke-width="90" opacity=".52"/><path d="M-76 1048C296 942 461 1108 681 1225" fill="none" stroke="white" stroke-opacity=".07" stroke-width="15"/></g>';
    }
    if(style==='leather'){
      return defs+'<defs><linearGradient id="'+id+'-hide" x1="0" y1="0" x2="1" y2=".8"><stop stop-color="var(--scene-c)" stop-opacity=".03"/><stop offset=".36" stop-color="var(--scene-a)" stop-opacity=".18"/><stop offset=".72" stop-color="var(--scene-a)" stop-opacity=".25"/><stop offset="1" stop-color="var(--scene-b)" stop-opacity=".09"/></linearGradient><pattern id="'+id+'-grain" width="15" height="13" patternUnits="userSpaceOnUse" patternTransform="rotate(-17)"><path d="M2 4q2-2 4 .2M10 10q2-1 3 .5" fill="none" stroke="var(--scene-b)" stroke-opacity=".18" stroke-width=".85" stroke-linecap="round"/><circle cx="7" cy="8" r=".7" fill="var(--scene-c)" fill-opacity=".15"/></pattern></defs>'+
        '<path d="M515-75C670 186 744 468 908 657S1298 766 1700 566V1510H-90V1116C163 1062 338 990 386 810S374 153 515-75Z" fill="url(#'+id+'-hide)"/>'+
        '<path d="M515-75C670 186 744 468 908 657S1298 766 1700 566V1510H-90V1116C163 1062 338 990 386 810S374 153 515-75Z" fill="url(#'+id+'-grain)" opacity=".72"/>'+
        '<path d="M502-70C657 176 719 481 888 674S1288 789 1700 591" fill="none" stroke="var(--scene-c)" stroke-opacity=".17" stroke-width="1.7"/>'+
        '<path d="M-84 1111C160 1046 330 990 387 807" fill="none" stroke="var(--scene-b)" stroke-opacity=".31" stroke-width="3"/>'+
        '<path d="M-80 1195C260 1120 550 1271 791 1110S1365 888 1700 960" fill="none" stroke="var(--scene-b)" stroke-opacity=".15" stroke-width="68"/>'+
        '<path d="M-80 1161C256 1084 541 1232 781 1082S1359 855 1700 920" fill="none" stroke="var(--scene-c)" stroke-opacity=".38" stroke-width="2.5"/>'+
        '<g class="procedural-leather-seam" fill="none"><path d="M-80 1183C256 1106 541 1254 781 1104S1359 877 1700 942" stroke="var(--scene-c)" stroke-opacity=".34" stroke-width="1.8" stroke-dasharray="5 11"/><path d="M-80 1210C269 1136 550 1280 791 1125S1367 908 1700 971" stroke="var(--scene-b)" stroke-opacity=".18" stroke-width="1.2"/><path d="M537 22C633 266 739 500 907 651" stroke="var(--scene-c)" stroke-opacity=".20" stroke-width="1.5" stroke-dasharray="5 11"/></g>'+
        '<path d="M-80 1325C263 1243 512 1390 792 1206S1387 987 1700 1089" fill="none" stroke="url(#'+id+'-polish)" stroke-width="67" opacity=".42"/>';
    }
    if(style==='cork-relief'){
      var pores='',rand=seed(8271);
      for(var p=0;p<240;p++){
        var px=-60+rand()*1740,py=340+rand()*1170,r=(.8+rand()*4.8).toFixed(1);
        pores+='<ellipse cx="'+px.toFixed(1)+'" cy="'+py.toFixed(1)+'" rx="'+r+'" ry="'+(r*(.38+rand()*.36)).toFixed(1)+'" fill="var(--scene-'+(p%6===0?'b':'c')+')" fill-opacity="'+(p%9===0?'.31':'.19')+'" transform="rotate(-12 '+px.toFixed(1)+' '+py.toFixed(1)+')"/>';
      }
      var corkEdge='M-80 782C94 746 215 765 379 713l22-10 18 3C597 655 683 672 825 618l18-8 16 2C1012 562 1112 571 1251 518l15-11 22 3C1440 465 1532 480 1690 489';
      return defs+'<defs><linearGradient id="'+id+'-cork" x1="0" y1="0" x2=".9" y2="1"><stop stop-color="var(--scene-c)" stop-opacity=".08"/><stop offset=".4" stop-color="var(--scene-a)" stop-opacity=".27"/><stop offset="1" stop-color="var(--scene-b)" stop-opacity=".15"/></linearGradient><clipPath id="'+id+'-corkclip"><path d="'+corkEdge+'V1500H-80Z"/></clipPath></defs>'+
        '<path d="'+corkEdge+'V1500H-80Z" fill="url(#'+id+'-cork)"/>'+
        '<path d="'+corkEdge+'" transform="translate(0 15)" fill="none" stroke="var(--scene-b)" stroke-opacity=".12" stroke-width="7" stroke-linejoin="round"/>'+
        '<path d="'+corkEdge+'" fill="none" stroke="var(--scene-c)" stroke-opacity=".19" stroke-width="1.2" stroke-linejoin="round"/>'+
        '<g clip-path="url(#'+id+'-corkclip)"><g class="procedural-cork-grain">'+pores+'</g>'+
        '<path d="M-80 995C231 924 355 985 616 882S1126 788 1690 765M-80 1252C194 1168 502 1231 728 1090S1270 1008 1690 916" fill="none" stroke="var(--scene-b)" stroke-opacity=".22" stroke-width="3"/>'+
        '<path d="M-80 1024C233 950 375 1017 629 904S1148 818 1690 789M-80 1280C198 1195 507 1257 741 1111S1285 1032 1690 945" fill="none" stroke="var(--scene-c)" stroke-opacity=".18" stroke-width="1.3"/></g>'+
        '<path d="M-80 1374C257 1291 560 1403 800 1220S1286 1165 1690 1102" fill="none" stroke="var(--scene-a)" stroke-opacity=".12" stroke-width="48"/>';
    }
    if(style==='slate'){
      return defs+'<defs><linearGradient id="'+id+'-slate-face" x1="0" y1="0" x2=".16" y2="1"><stop stop-color="var(--scene-c)" stop-opacity=".12"/><stop offset=".57" stop-color="var(--scene-b)" stop-opacity=".24"/><stop offset="1" stop-color="var(--scene-a)" stop-opacity=".09"/></linearGradient></defs>'+
        '<path d="M692-95L1690-45L1680 417L1130 579L557 433Z" fill="url(#'+id+'-slate-face)"/>'+
        '<path d="M385 564L1125 550L1685 413L1730 707L1182 884L482 808L-80 920V744Z" fill="var(--scene-b)" fill-opacity=".17"/>'+
        '<path d="M-80 902L480 789L1178 872L1730 700V1091L1185 1206L487 1091L-80 1204Z" fill="url(#'+id+'-material)" opacity=".93"/>'+
        '<path d="M-80 1204L486 1081L1180 1193L1730 1082V1510H-80Z" fill="url(#'+id+'-slate-face)" opacity=".82"/>'+
        '<path d="M-80 744L385 564L1125 550L1685 413M-80 902L480 789L1178 872L1730 700M-80 1204L487 1091L1185 1206L1730 1091" fill="none" stroke="var(--scene-c)" stroke-opacity=".20" stroke-width="1.6"/>'+
        '<path d="M-80 760L390 580L1130 565L1690 428M-80 919L485 808L1182 890L1730 720M-80 1220L488 1111L1186 1226L1730 1111" fill="none" stroke="var(--scene-b)" stroke-opacity=".14" stroke-width="1"/>'+
        '<g fill="none" stroke="var(--scene-a)" stroke-opacity=".20" stroke-width="1"><path d="M643 68L1241 93M586 171L1391 212M619 292L1504 309M698 364L1333 388M116 830L774 725M403 773L1020 722M402 960L1147 1021M-50 1045L691 911M493 1304L1439 1388M55 1366L1097 1274"/><path d="M1079 56l-27 104 38 91-33 61m-33 291-61 84 43 52-31 74m-758 98 32 80-42 47 21 77m778-175 43 79-29 53 32 41" stroke-opacity=".34"/></g>'+
        '<g class="procedural-slate-light"><path d="M596 585L1173 566L1645 431L1350 531L820 692Z" fill="url(#'+id+'-polish)" opacity=".36"/><path d="M-70 944L477 810L1130 898L724 961Z" fill="url(#'+id+'-polish)" opacity=".40"/></g>';
    }
    return '';
  }
  function svgMarkup(style,id){
    var defs='<defs><linearGradient id="'+id+'-a" x1="0" y1="0" x2="1" y2="1"><stop stop-color="var(--scene-a)" stop-opacity=".32"/><stop offset="1" stop-color="var(--scene-b)" stop-opacity=".05"/></linearGradient><linearGradient id="'+id+'-b"><stop stop-color="var(--scene-b)" stop-opacity=".04"/><stop offset=".55" stop-color="var(--scene-c)" stop-opacity=".25"/><stop offset="1" stop-color="var(--scene-a)" stop-opacity=".07"/></linearGradient><radialGradient id="'+id+'-glow"><stop stop-color="var(--scene-a)" stop-opacity=".23"/><stop offset="1" stop-color="var(--scene-a)" stop-opacity="0"/></radialGradient></defs>';
    var art='';
    if(style==='line'){
      art='<g fill="none" stroke="url(#'+id+'-a)" stroke-width="1.6"><path d="M-100 760C320 1120 430 220 800 160S1430 390 1760-180"/><path d="M-100 815C240 1160 450 310 830 230S1450 450 1750-90"/></g><g fill="none" stroke="url(#'+id+'-b)" stroke-width="1.1"><path d="M-120 1390C240 1070 520 1480 950 1150S1500 1050 1730 870"/><path d="M-120 1434C240 1114 520 1524 950 1194S1500 1094 1730 914"/></g>';
    }else if(style==='contour'){
      art='<path d="'+contourLoop(1310,530,615,475,.4)+'" fill="url(#'+id+'-glow)" opacity=".55"/>';
      for(var i=0;i<11;i++){var d=contourLoop(1310-i*5,530+i*7,615-i*45,475-i*34,.4+i*.065);art+='<path d="'+d+'" fill="none" stroke="var(--scene-'+(i%3===1?'b':'a')+')" stroke-opacity="'+(i%3===0?.29:.19)+'" stroke-width="'+(i%4===0?1.4:.9)+'"/>';}
      for(var j=0;j<5;j++)art+='<path d="'+contourLoop(120,1290,310-j*40,175-j*24,.6+j*.09)+'" fill="none" stroke="var(--scene-c)" stroke-opacity=".14" stroke-width=".9"/>';
      art+='<circle cx="1258" cy="586" r="5" fill="var(--scene-c)" fill-opacity=".39"/>';
    }else if(style==='prism'){
      art=prismMesh(id);
    }else if(style==='orbital'){
      art='<g transform="rotate(-24 1250 470)" fill="none"><ellipse cx="1250" cy="470" rx="530" ry="326" stroke="var(--scene-a)" stroke-opacity=".25"/><ellipse cx="1250" cy="470" rx="475" ry="283" stroke="var(--scene-b)" stroke-opacity=".18" stroke-dasharray="3 9"/><ellipse cx="1250" cy="470" rx="411" ry="242" stroke="var(--scene-a)" stroke-opacity=".19"/><ellipse cx="1250" cy="470" rx="330" ry="184" stroke="var(--scene-c)" stroke-opacity=".12"/>';
      for(var tick=0;tick<48;tick++){var angle=tick*Math.PI/24,x1=1250+530*Math.cos(angle),y1=470+326*Math.sin(angle),scale=tick%6===0?1.052:1.019,x2=1250+530*scale*Math.cos(angle),y3=470+326*scale*Math.sin(angle);art+='<path d="M'+x1.toFixed(1)+' '+y1.toFixed(1)+'L'+x2.toFixed(1)+' '+y3.toFixed(1)+'" stroke="var(--scene-'+(tick%6===0?'c':'a')+')" stroke-opacity="'+(tick%6===0?.33:.18)+'" stroke-width="'+(tick%6===0?1.5:.8)+'"/>';}
      art+='</g><circle cx="1250" cy="470" r="90" fill="url(#'+id+'-glow)"/><circle cx="1250" cy="470" r="32" fill="none" stroke="var(--scene-a)" stroke-opacity=".26"/><circle cx="1250" cy="470" r="3" fill="var(--scene-c)" fill-opacity=".65"/><g fill="none" stroke="var(--scene-b)" stroke-opacity=".21"><path d="M744 1010h258m-258-11v22m258-22v22"/><path d="M90 1200h420M90 1192v16M510 1192v16"/><ellipse cx="210" cy="1270" rx="280" ry="127" transform="rotate(19 210 1270)" stroke-opacity=".13"/></g><g class="procedural-orbit-satellites"><circle cx="894" cy="680" r="9" fill="var(--scene-c)" fill-opacity=".58"/><circle cx="1492" cy="231" r="5" fill="var(--scene-a)" fill-opacity=".7"/></g>';
    }else if(['mirror-hall','tideglass','etched-metal','porcelain','leather','cork-relief','slate'].indexOf(style)>=0){
      art=materialMarkup(style,id);
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
    if(['line','contour','prism','orbital','constellation','dunes','mirror-hall','tideglass','etched-metal','porcelain','leather','cork-relief','slate'].indexOf(style)>=0){
      node=document.createElementNS(SVG,'svg');node.setAttribute('viewBox','0 0 1600 '+camera.viewBoxHeight);node.setAttribute('preserveAspectRatio','xMidYMid slice');node.setAttribute('class','procedural-vector-art');node.innerHTML=svgMarkup(style,id);root.appendChild(node);
    }else if(style==='ribbons'){
      node=element('canvas','procedural-ribbons');root.appendChild(node);try{ctx=node.getContext('2d',{alpha:true});}catch(error){ctx=null;}
      if(!ctx){node.remove();node=null;root.dataset.vectorStyle='spectrum';for(var f=0;f<3;f++)root.appendChild(element('span','procedural-shape procedural-shape-'+f));}
    }else{
      var count=style==='paper'?5:3;
      for(var i=0;i<count;i++)root.appendChild(element('span','procedural-shape procedural-shape-'+i));
    }
    function resize(width,height,light){
      if(closed)return;var signature=[Math.round(width),Math.round(height),!!light,window.devicePixelRatio||1].join(':');if(signature===last)return field;last=signature;
      field={width:Math.max(1,width)+camera.overscan*2,height:Math.max(1,height)*camera.viewportSpan+camera.overscan*2,viewportSpan:camera.viewportSpan,overscan:camera.overscan,travel:Math.max(1,height)*(camera.viewportSpan-1),scrollRate:camera.scrollRate,viewBoxHeight:camera.viewBoxHeight};
      root.style.width=field.width+'px';root.style.height=field.height+'px';root.style.left=root.style.top=-camera.overscan+'px';root.style.right=root.style.bottom='auto';
      root.dataset.sceneTheme=light?'light':'dark';
      var sceneColors=light&&materialLightPalettes[style]?materialLightPalettes[style]:colors;
      sceneColors.forEach(function(color,index){root.style.setProperty('--scene-'+String.fromCharCode(97+index),color);});
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
