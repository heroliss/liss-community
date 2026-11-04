/* A deterministic DOM, clock and geometry harness for the real viewer module. */
'use strict';
const assert=require('node:assert/strict');
const {CustomEvent,append,environment,load}=require('./background-picker.test.cjs');

function setup(url,options={}){
  const env=environment({url}),{doc,win,sandbox}=env;
  let now=0,serial=0;
  const timers=new Map(),frames=new Map(),scrolls=[];
  function advance(ms){
    const until=now+ms;let steps=0;
    for(;;){
      const next=[...timers].filter(([,job])=>job.at<=until).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
      if(!next)break;assert.ok(++steps<1000,'timer queue does not spin');
      now=next[1].at;timers.delete(next[0]);next[1].fn();
    }
    now=until;
  }
  function flushFrames(){
    const queued=[...frames];frames.clear();for(const [,fn]of queued)fn(now);
  }
  const setTimer=(fn,delay=0)=>{const id=++serial;timers.set(id,{fn,at:now+Math.max(0,delay)});return id;};
  const clearTimer=id=>timers.delete(id),requestFrame=fn=>{const id=++serial;frames.set(id,fn);return id;},cancelFrame=id=>frames.delete(id);
  Object.assign(sandbox,{setTimeout:setTimer,clearTimeout:clearTimer,requestAnimationFrame:requestFrame,cancelAnimationFrame:cancelFrame,performance:{now:()=>now}});
  Object.assign(win,{setTimeout:setTimer,clearTimeout:clearTimer,requestAnimationFrame:requestFrame,cancelAnimationFrame:cancelFrame});
  Object.assign(doc,{hidden:false,hasFocus:()=>true});
  doc.documentElement.parentElement=doc;
  doc.parentElement=win;
  const createElement=doc.createElement.bind(doc);
  doc.createElement=function(tag){
    const node=createElement(tag);
    const originalMatches=node.matches.bind(node);
    node.matches=function(selector){
      if(selector===':hover')return!!node.testHovered;
      if(selector===':focus-within')return node.contains(doc.activeElement);
      if(selector===':focus-visible')return!!node.testKeyboardFocus&&doc.activeElement===node;
      return originalMatches(selector);
    };
    node.focus=function(){
      if(doc.activeElement===node)return;
      const old=doc.activeElement;doc.activeElement=node;
      old?.dispatchEvent(new CustomEvent('focusout',{bubbles:true,relatedTarget:node}));
      node.dispatchEvent(new CustomEvent('focusin',{bubbles:true,relatedTarget:old}));
    };
    node.blur=function(){if(doc.activeElement===node)doc.body.focus();};
    node.close=function(){
      node.open=false;node.dispatchEvent(new CustomEvent('close'));
      // The shared Bus has bubbling only. Native dialog close is captured by
      // document listeners even though that event does not bubble.
      doc.dispatchEvent(new CustomEvent('close',{target:node}));
    };
    return node;
  };
  win.innerWidth=options.width||1280;win.innerHeight=options.height||720;
  doc.documentElement.clientWidth=win.innerWidth;doc.documentElement.clientHeight=win.innerHeight;
  let footerDocumentTop=win.scrollY+2000,footerHeight=340,dockHeight=options.dockHeight||78;
  const skip=append(doc.body,'a',{class:'skip-link',href:'#main-content'},'跳到正文');
  const header=append(doc.body,'header',{class:'site-header','aria-hidden':'false'});
  const opener=append(header,'button',{'data-background-open':''},'选择背景');
  const main=append(doc.body,'main',{class:'site-main',id:'main-content',inert:''});
  const footer=append(doc.body,'footer',{class:'site-footer','aria-hidden':'true'});
  const root=append(doc.body,'section',{'data-background-viewer':'','data-background-review':'',class:'scene-review',hidden:'',tabindex:'-1'});
  const reveal=append(root,'button',{'data-review-reveal':'','aria-expanded':'false','aria-controls':'community-background-viewer-dock',hidden:''},'观景');
  const dock=append(root,'div',{'data-review-dock':'',id:'community-background-viewer-dock'});
  for(const hook of ['title','count','description'])append(dock,'span',{['data-review-'+hook]:''});
  for(const hook of ['previous','next','clear','browse','exit','theme','collapse'])append(dock,'button',{['data-review-'+hook]:''},hook);
  const details=append(dock,'details',{'data-review-details':''});
  for(const hook of ['info-title','info-description','material'])append(details,'span',{['data-review-'+hook]:''});
  for(const hook of ['source','palette','credit'])append(details,hook==='credit'?'a':'span',{['data-review-'+hook]:''});
  append(root,'p',{'data-review-status':'',role:'status'});
  function rectangle(left,top,width,height){return{left,top,right:left+width,bottom:top+height,width,height,x:left,y:top};}
  footer.getBoundingClientRect=()=>rectangle(0,footerDocumentTop-win.scrollY,win.innerWidth,footerHeight);
  // The real CSS consumes this property. The narrow fixture still measures the
  // full control height while a queued scroll event changes its bottom offset.
  const bottom=()=>(win.innerWidth<=600?10:14)+(parseFloat(root.style.getPropertyValue('--viewer-footer-lift')||dock.style.getPropertyValue('--viewer-footer-lift'))||0);
  dock.getBoundingClientRect=()=>{const width=Math.min(780,win.innerWidth-24);return rectangle((win.innerWidth-width)/2,win.innerHeight-bottom()-dockHeight,width,dockHeight);};
  reveal.getBoundingClientRect=()=>rectangle(win.innerWidth/2-44,win.innerHeight-46,88,32);
  root.getBoundingClientRect=()=>rectangle(0,0,win.innerWidth,win.innerHeight);
  sandbox.getComputedStyle=node=>({
    display:node.hidden?'none':'block',
    visibility:doc.body.classList.contains('scene-viewer-clear')&&node===footer?'hidden':'visible',
    bottom:bottom()+'px',
    getPropertyValue:name=>node.style.getPropertyValue(name),
  });
  win.scrollTo=function(arg,y){
    const x=typeof arg==='object'?arg.left||0:arg,top=typeof arg==='object'?arg.top||0:y;
    this.scrollX=x;this.scrollY=options.integerScroll?Math.round(top):top;scrolls.push({x,top:this.scrollY});
    win.dispatchEvent(new CustomEvent('scroll'));
  };
  const entries=[
    {id:'mist',title:'柔光留白',description:'安静的光色与空间',kind:'vector'},
    {id:'coast',title:'欧泊海岸',description:'晶透海岸',kind:'image',width:3840,height:2162,originalWidth:1672,originalHeight:941,enhancement:'SeedVR2-3B INT8 ConvRot'},
    {id:'noctilucent-sea',title:'夜潮幽蓝',description:'深蓝海岸与轻微发光的潮线',kind:'image',width:3840,height:2560,originalWidth:1536,originalHeight:1024,enhancement:'SeedVR2-3B INT8 ConvRot'},
  ];
  let choice={id:'coast',quality:'auto',scroll:true};const subscribers=new Set(),sets=[];
  win.LissBackgrounds={list:()=>entries.map(x=>({...x})),entry:id=>({...entries.find(x=>x.id===id)}),read:()=>({...choice}),set:value=>{choice={...choice,...value};sets.push({...choice});subscribers.forEach(fn=>fn({...choice}));return{...choice};},subscribe:fn=>{subscribers.add(fn);return()=>subscribers.delete(fn);}};
  const forbiddenStorage=new Proxy({},{get(){throw Error('temporary viewer must not access storage');}});
  sandbox.localStorage=forbiddenStorage;sandbox.sessionStorage=forbiddenStorage;win.localStorage=forbiddenStorage;win.sessionStorage=forbiddenStorage;
  opener.focus();load(env,'community-background-review-v40.js');
  return{...env,root,dock,reveal,details,opener,skip,header,main,footer,sets,subscribers,api:win.LissBackgroundViewer,clock:{advance,flushFrames,timers,frames,now:()=>now},scrolls,
    footerAt(top,height=340){footerDocumentTop=win.scrollY+top;footerHeight=height;},
    resize(width,height){win.innerWidth=width;win.innerHeight=height;doc.documentElement.clientWidth=width;doc.documentElement.clientHeight=height;win.dispatchEvent(new CustomEvent('resize'));},
    dockHeight(value){dockHeight=value;},
  };
}
function click(env,hook,pointerType='mouse'){
  const node=env.root.querySelector('[data-review-'+hook+']');assert.ok(node,hook+' control');
  node.dispatchEvent(new CustomEvent('pointerdown',{bubbles:true,pointerType}));node.focus();node.click();
  node.dispatchEvent(new CustomEvent('pointerup',{bubbles:true,pointerType}));return node;
}
module.exports={setup,click,CustomEvent};
