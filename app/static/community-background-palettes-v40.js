/* Authored interface pigments, separate from photographs and article identity. */
(function(){
  'use strict';
  var seeds={
    'crimson-camellia':[350,40,33,25,"绛红 · 蜜金","dark"],
    'dew-fern':[117,25,167,21,"蕨绿 · 雨青","dark"],
    'cedar-after-rain':[136,20,34,28,"杉绿 · 雾金","dark"],
    'moss-stone':[78,23,43,25,"苔橄榄 · 石金","dark"],
    'alpine-blue-hour':[221,28,270,18,"暮蓝 · 雪紫","dark"],
    'cloud-sailing':[204,24,39,16,"云蓝 · 暖灰","dark"],
    'moonlit-grass':[268,20,87,22,"月紫 · 草青","dark"],
    'ember-cup':[25,30,49,22,"陶赭 · 琥珀","dark"],
    'obsidian-shell':[292,20,210,16,"贝紫 · 银蓝","dark"],
    'folded-silk':[320,23,27,24,"绸莓 · 暖铜","dark"],
    'mineral-ink':[184,23,19,29,"墨青 · 矿赭","dark"],
    'amber-rain':[37,30,214,25,"雨金 · 夜蓝","dark"],
    mist:[164,26,38,20,'雾绿 · 亚麻'],line:[174,25,42,20,'青灰 · 沙金'],
    contour:[160,28,44,25,'青绿 · 古金'],prism:[211,30,278,24,'冰蓝 · 浅紫'],
    orbital:[205,25,39,25,'夜蓝 · 黄铜'],paper:[143,19,31,26,'鼠尾草 · 暖纸'],
    ribbons:[252,31,166,28,'鸢紫 · 碧绿'],constellation:[215,25,45,24,'星蓝 · 淡金'],
    spectrum:[266,28,172,28,'柔紫 · 绿松'],dunes:[38,28,186,23,'暖沙 · 远青'],
    'spectrum-botanical':[266,28,172,28,'柔紫 · 绿松'],
    'spectrum-ripples':[266,28,172,28,'柔紫 · 绿松'],
    'glass-weave':[191,23,38,21,'雾青 · 香槟'],'mercury-tide':[172,20,38,18,'银青 · 暖灰'],
    'opal-strata':[208,22,20,18,'晶蓝 · 砂粉'],
    'aurora-veil':[176,34,272,30,'极光 · 夜青','dark'],'prism-nebula':[262,34,322,30,'星云 · 绯紫','dark'],
    'bokeh-night':[190,32,300,28,'光斑 · 多彩','dark'],'silk-flow':[200,32,330,30,'丝光 · 流彩','dark'],'crystal-cavern':[205,34,280,30,'晶体 · 微光','dark'],'dusk-dunes':[28,36,285,30,'暮色 · 沙丘','dark'],'deep-current':[188,36,220,30,'深海 · 光束','dark'],'neon-rain':[320,36,190,32,'霓虹 · 雨夜','dark'],'lantern-field':[34,38,225,28,'灯火 · 星野','dark'],'tide-glow':[184,32,30,30,'夜港 · 辉光','dark'],
    'tidal-still':[196,25,38,22,'湾青 · 晨金','dark'],
    'satin-atrium':[202,21,36,19,'雾蓝 · 珍珠','light'],
    'sea-glass-study':[186,23,27,21,'烟青 · 杏光','dark'],
    'deepwater-hush':[195,28,166,22,'深水青 · 雾绿','dark'],
    'blue-hour-caustics':[207,28,188,18,'暮海蓝 · 水银','dark'],
    'quiet-aquamarine':[183,25,211,19,'澄青 · 岩蓝','dark'],
    'opal-ice-shelf':[191,28,316,22,'冰青 · 欧泊粉','dark'],
    'white-ice-shelf':[205,26,184,18,'澄蓝 · 冰白','dark'],
    'mirror-hall':[207,22,276,18,'银蓝 · 雾紫'],tideglass:[181,32,151,23,'水青 · 海绿'],
    'etched-metal':[210,17,40,18,'钢灰 · 香槟'],porcelain:[153,23,28,22,'青瓷 · 杏釉'],
    leather:[29,25,78,18,'砂褐 · 灰橄榄'],'cork-relief':[40,28,90,22,'木金 · 苔绿'],
    slate:[216,19,48,17,'岩蓝 · 矿金'],coast:[198,31,32,25,'海蓝 · 欧泊','dark'],
    'mineral-scroll':[177,27,39,28,'晶青 · 暖金','dark'],'ink-scroll':[202,19,52,22,'墨青 · 月白','dark'],
    earthrise:[213,28,42,17,'地球蓝 · 月岩','dark'],
    'opal-drift':[200,31,25,27,'冰蓝 · 蜜桃','light'],'opal-lagoon':[266,25,332,21,'浅紫 · 玫瑰','light'],
    'snow-lake':[207,21,43,16,'雪蓝 · 云白','light'],'ice-vault':[181,32,41,22,'透青 · 银金','light'],
    'jade-lake':[160,28,30,29,'碧玉 · 秋赭','light'],'reed-mist':[79,22,35,25,'苇绿 · 晨金','light'],
    sandbar:[187,34,37,24,'浅海青 · 白沙','light'],'water-light':[194,32,166,23,'深海蓝 · 透绿','dark'],
    'silver-city':[211,21,31,18,'银蓝 · 石灰','light'],'copper-city':[28,36,208,24,'暖铜 · 暮蓝','dark'],
    'fluted-glass':[252,23,322,18,'玻璃紫 · 冷银','light'],'glass-planes':[194,25,42,17,'烟青 · 银灰','dark'],
    'amber-arch':[29,37,175,25,'琥珀 · 深青','light'],'celadon-water':[153,22,34,19,'釉绿 · 米白','light'],
    'satin-metal':[211,17,40,15,'银钢 · 暖灰','light'],'paper-relief':[87,20,31,25,'纸绿 · 浅杏','light'],
    'slate-water':[213,19,67,19,'岩蓝 · 灰橄榄','dark'],'cork-garden':[38,29,83,22,'软木金 · 叶绿','light'],
    'leather-fold':[29,22,88,15,'皮革灰 · 砂米','light'],
    'noctilucent-sea':[190,32,222,24,'幽蓝 · 海玻璃','dark'],
    'lunar-glacier':[222,26,269,20,'冰蓝 · 月紫','dark'],
    'smoked-glass':[31,28,202,15,'烟晶 · 琥珀','dark'],
    'rain-mirror':[165,21,29,24,'雨青 · 镜铜','dark'],
    'ink-lake':[145,23,54,16,'墨绿 · 银灰','dark'],
    'amethyst-cove':[287,23,331,20,'紫晶 · 暗玫瑰','dark'],
    'obsidian-dunes':[34,22,216,15,'曜石 · 暖银','dark'],
    'abyssal-prism':[174,28,203,23,'深青 · 棱光','dark']
  },profiles=Object.create(null);
  Object.keys(seeds).forEach(function(id){var s=seeds[id];profiles[id]=Object.freeze({id:id,name:s[4],hue:s[0],saturation:s[1],warmHue:s[2],warmSaturation:s[3],readingTone:s[5]||null});});
  // Managed photographs borrow an authored pigment family, while keeping their
  // own identity. Read only the bounded public profile, never CSS from an upload.
  var authored=Object.assign(Object.create(null),profiles),site=window.LissBackgroundSite;
  function managedProfile(item){
    if(!item||item.kind!=='image'||typeof item.id!=='string'||!/^[a-z][a-z0-9-]{0,95}$/.test(item.id)||item.id==='__proto__'||item.id==='constructor')return null;
    var family=typeof item.paletteKey==='string'?authored[item.paletteKey]:null,p=family||item.palette;
    if(!p||typeof p!=='object')return null;
    var keys=['hue','saturation','warmHue','warmSaturation'],limits=[360,100,360,100];
    if(!keys.every(function(key,index){return typeof p[key]==='number'&&Number.isFinite(p[key])&&p[key]>=0&&p[key]<=limits[index];}))return null;
    var tone=item.readingTone||p.readingTone;
    return Object.freeze({id:item.id,name:typeof p.name==='string'?p.name.slice(0,80):'风景配色',hue:Math.round(p.hue)%360,saturation:Math.round(p.saturation),warmHue:Math.round(p.warmHue)%360,warmSaturation:Math.round(p.warmSaturation),readingTone:tone==='light'||tone==='dark'?tone:null});
  }
  if(site&&Array.isArray(site.entries))site.entries.forEach(function(item){var p=managedProfile(item);if(p)profiles[item.id]=p;});
  Object.freeze(profiles);
  function hsl(h,s,l,a){return 'hsl('+h+' '+s+'% '+l+'%'+(a===undefined?'':' / '+a)+')';}
  function roles(id,mode,readingTone){
    var p=profiles[id]||profiles.mist,light=mode==='light',pale=(readingTone||p.readingTone||(light?'light':'dark'))==='light',h=p.hue,s=p.saturation,w=p.warmHue,ws=p.warmSaturation;
    return Object.freeze({
      accent:hsl(h,s,light?28:74),hover:hsl(h,s,light?21:84),ink:hsl(h,Math.min(s,17),light?99:10),soft:hsl(h,Math.min(s,26),light?91:19),
      text:hsl(h,Math.min(s,12),light?16:92),muted:hsl(h,Math.min(s,13),light?33:75),subtle:hsl(h,Math.min(s,12),light?38:66),warm:hsl(w,ws,light?32:75),
      background:hsl(h,Math.min(s,16),light?96:8),surface:hsl(h,Math.min(s,12),light?98:13),line:hsl(h,Math.min(s,14),light?76:30),
      'reading-text':hsl(h,Math.min(s,19),pale?14:95),'reading-muted':hsl(h,Math.min(s,18),pale?29:87),
      'reading-accent':hsl(h,s,pale?27:78),'reading-hover':hsl(h,s,pale?19:87),'reading-ink':hsl(h,Math.min(s,12),pale?99:9),
      'reading-warm':hsl(w,ws,pale?30:80),'reading-halo':hsl(h,Math.min(s,12),pale?97:8,pale?.76:.64),'reading-halo-edge':hsl(h,Math.min(s,12),pale?97:8,pale?.47:.34),
      'reading-panel':hsl(h,Math.min(s,14),pale?96:9,pale?.7:.66)
    });
  }
  window.LissBackgroundPalettesV40=Object.freeze({get:function(id){return profiles[id]||null;},ids:Object.freeze(Object.keys(profiles)),roles:roles});
})();
