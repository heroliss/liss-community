/* Settings are shared; a visit's chosen view belongs only to its browser tab. */
(function(){
  'use strict';
  var STORE='liss-background-v24',VISIT='liss-background-visit:v55',HANDOFF='liss-background-handoff:v55',TTL=15000;
  function get(storage,key){try{return JSON.parse(storage.getItem(key)||'null');}catch(error){return null;}}
  function put(storage,key,value){try{storage.setItem(key,JSON.stringify(value));}catch(error){}}
  function remove(storage,key){try{storage.removeItem(key);}catch(error){}}
  function create(options){
    var catalogue=options.catalogue,site=options.site||{},signal=options.signal,shared,tab;
    try{shared=localStorage;}catch(error){}try{tab=sessionStorage;}catch(error){}
    var images=Object.keys(catalogue).filter(function(id){return catalogue[id].kind==='image';});
    var defaults=site.defaultRandom||{},sitePool=Array.isArray(defaults.ids)?images.filter(function(id){return defaults.ids.indexOf(id)!==-1;}):images.slice();
    var fallback=sitePool[0]||images[0]||(catalogue.coast?'coast':'mist'),notice='';
    function validPool(pool){return images.filter(function(id){return pool.indexOf(id)!==-1;});}
    function normalize(raw){
      raw=raw&&typeof raw==='object'?raw:{};
      var custom=raw.randomPoolMode==='custom',original=Array.isArray(raw.randomPool)?raw.randomPool:[],pool=custom?validPool(original):sitePool.slice();
      var enabled=typeof raw.random==='boolean'?raw.random:defaults.enabled!==false;
      if(custom&&original.length&&!pool.length){custom=false;pool=sitePool.slice();notice='原随机范围已下架，已恢复站点默认范围。';}
      if(enabled&&!pool.length){enabled=false;notice=custom?'随机范围为空，已暂停随机。':'暂无可随机的图片，已暂停随机。';}
      return{id:catalogue[raw.id]?raw.id:fallback,quality:raw.quality==='high'?'high':'auto',scroll:raw.scroll!==false,random:enabled,randomPoolMode:custom?'custom':'site',randomPool:pool};
    }
    var rawPreferences=get(shared,STORE),preferences=normalize(rawPreferences),previous=get(tab,VISIT),url=new URL(location.href),stamp=String(window.performance&&window.performance.timeOrigin||window.__lissBackgroundDocumentStamp||(window.__lissBackgroundDocumentStamp=Date.now()+':'+Math.random()));
    function address(value){try{var u=new URL(value,location.href);u.hash='';return u.href;}catch(error){return '';}}
    var nav=window.performance&&window.performance.getEntriesByType&&window.performance.getEntriesByType('navigation')[0],type=nav&&nav.type||'navigate',referrer='';
    try{if(document.referrer)referrer=new URL(document.referrer).origin;}catch(error){}
    function tickets(storage){var value=get(storage,HANDOFF);return(Array.isArray(value)?value:value?[value]:[]).filter(function(item){return item&&Date.now()-item.at>=0&&Date.now()-item.at<TTL;});}
    var sharedAvailable=false;try{shared.getItem(HANDOFF);sharedAvailable=true;}catch(error){}
    // A shared ticket is consumed once across tabs. Its session copy is only a
    // fallback when shared storage is unavailable, never a second usable ticket.
    var pending=tickets(sharedAvailable?shared:tab),handoff=pending.find(function(value){return value.to===address(location.href)&&catalogue[value.id]&&(!referrer||referrer===url.origin);}),validHandoff=!!handoff;
    if(validHandoff){[tab,shared].forEach(function(storage){var remaining=tickets(storage).filter(function(value){return value.to!==handoff.to||value.at!==handoff.at||value.token!==handoff.token;});if(remaining.length)put(storage,HANDOFF,remaining);else remove(storage,HANDOFF);});}
    var reuse=previous&&catalogue[previous.id]&&(previous.documentStamp===stamp||type==='reload'||type==='back_forward'||referrer===url.origin||validHandoff);
    var internal=referrer===url.origin||validHandoff||type==='reload'||type==='back_forward';
    var reason=reuse?'continued-visit':internal?'internal-entry':'new-entry';
    function pick(pool,last){var choices=pool.length>1?pool.filter(function(id){return id!==last;}):pool;return choices[Math.min(choices.length-1,Math.floor(Math.random()*choices.length))]||fallback;}
    var last=previous&&catalogue[previous.id]?previous.id:rawPreferences&&catalogue[rawPreferences.id]?rawPreferences.id:null;
    var id=validHandoff?handoff.id:reuse?previous.id:internal?preferences.id:preferences.random?pick(preferences.randomPool,last):preferences.id;
    var token=validHandoff?handoff.token:reuse?previous.token:Date.now()+':'+Math.random(),visit={id:id,token:token,documentStamp:stamp};
    function saveVisit(){put(tab,VISIT,visit);}
    saveVisit();
    function read(){return{id:visit.id,quality:preferences.quality,scroll:preferences.scroll,random:preferences.random,randomPoolMode:preferences.randomPoolMode,randomPool:preferences.randomPool.slice(),randomNotice:notice};}
    function apply(change){
      change=change||{};var draft=Object.assign({},preferences,change);
      if(draft.random&&draft.randomPoolMode==='custom'&&(!Array.isArray(draft.randomPool)||!validPool(draft.randomPool).length))return{ok:false,message:'请至少选择一张图片，或关闭随机。'};
      notice='';preferences=normalize(draft);if(change.id!==undefined)visit.id=catalogue[change.id]?change.id:fallback;
      // Only a deliberate Apply/set writes preferences. Entrance draws never do.
      preferences.id=visit.id;put(shared,STORE,preferences);saveVisit();return{ok:true,value:read()};
    }
    function sync(restore){
      notice='';preferences=normalize(get(shared,STORE));
      if(restore){var kept=get(tab,VISIT);if(kept&&kept.token===visit.token&&catalogue[kept.id])visit.id=kept.id;}
      saveVisit();return read();
    }
    function transfer(target,newContext){
      var destination;try{destination=new URL(target,location.href);}catch(error){return;}
      if(destination.origin!==url.origin||!/^https?:$/.test(destination.protocol)||!newContext&&address(destination.href)===address(location.href))return;
      var value={to:address(destination.href),from:address(location.href),id:visit.id,token:visit.token,at:Date.now()};
      [tab,shared].forEach(function(storage){var pending=tickets(storage).filter(function(item){return item.to!==value.to;});pending.push(value);put(storage,HANDOFF,pending.slice(-8));});
    }
    function link(event){
      if(event.defaultPrevented||event.type==='click'&&event.button!==0||event.type==='auxclick'&&event.button!==1)return;
      var anchor=event.target&&event.target.closest&&event.target.closest('a[href]');if(!anchor||anchor.hasAttribute('download'))return;
      var target=anchor.target||anchor.getAttribute('target')||'',newContext=event.type==='auxclick'||event.ctrlKey||event.metaKey||event.shiftKey||target&&['_self','_top','_parent'].indexOf(target)===-1;transfer(anchor.href,newContext);
    }
    document.addEventListener('click',link,{capture:true,signal:signal});document.addEventListener('auxclick',link,{capture:true,signal:signal});
    document.addEventListener('submit',function(event){if(event.defaultPrevented||!event.target||event.target.method==='dialog')return;transfer(event.target.action||location.href,event.target.target==='_blank');},{capture:true,signal:signal});
    return{read:read,apply:apply,sync:sync,defaults:function(){return{enabled:defaults.enabled!==false&&!!sitePool.length,pool:sitePool.slice()};},inspect:function(){return{reason:reason,navigation:type,token:visit.token,id:visit.id};}};
  }
  window.LissBackgroundVisitsV55=Object.freeze({create:create});
})();
