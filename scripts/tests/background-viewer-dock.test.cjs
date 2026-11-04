/* Exercise idle/reveal behavior and footer geometry against the real module.
   Layout pixels and native focus remain a separate browser acceptance check. */
'use strict';
const assert=require('node:assert/strict');
const {append,key,load}=require('./background-picker.test.cjs');
const {setup,click,CustomEvent}=require('./background-viewer-fixture.cjs');

function pointer(env,type,target=env.doc.body,coordinates={}){
  target.testHovered=type==='pointerenter'?true:type==='pointerleave'?false:target.testHovered;
  target.dispatchEvent(new CustomEvent(type,{bubbles:type!=='pointerenter'&&type!=='pointerleave',pointerType:'mouse',clientX:0,clientY:0,...coordinates}));
}
function idle(env,ms=2401){env.clock.advance(ms);env.clock.flushFrames();}
function show(env){env.api.open({returnFocus:env.opener});env.clock.flushFrames();}
function assertShown(env){assert.equal(env.api.read().collapsed,false);assert.equal(env.dock.inert,false);assert.notEqual(env.dock.getAttribute('aria-hidden'),'true');}
function assertCollapsed(env){assert.equal(env.api.read().collapsed,true);assert.equal(env.dock.inert,true);assert.equal(env.dock.getAttribute('aria-hidden'),'true');assert.equal(env.dock.contains(env.doc.activeElement),false,'hidden controls never retain focus');}
function assertFooterGap(env){const dock=env.dock.getBoundingClientRect(),footer=env.footer.getBoundingClientRect();assert.ok(dock.bottom<=footer.top-11.99,'dock stays at least 12px above footer');}

function run(){
  const checks=[];
  {
    const env=setup();assert.equal(env.clock.timers.size,0);assert.equal(env.clock.frames.size,0);
    pointer(env,'pointermove',env.doc.body,{clientX:640,clientY:700});assert.equal(env.api.read().active,false);
    show(env);assertShown(env);assert.equal(env.dock.contains(env.doc.activeElement),true,'opening still places useful focus');
    idle(env);assertCollapsed(env);idle(env,100);assertCollapsed(env);
    assert.equal(env.reveal.getAttribute('aria-expanded'),'false');
    checks.push('programmatic opening focus does not block idle collapse or immediately reopen');
    env.api.destroy();
  }
  {
    const env=setup();show(env);idle(env);assertCollapsed(env);
    pointer(env,'pointermove',env.doc.body,{clientX:15,clientY:20});assertCollapsed(env);
    const handle=env.reveal.getBoundingClientRect();
    pointer(env,'pointermove',env.doc.body,{pointerType:'touch',clientX:handle.left+10,clientY:handle.top+10});assertCollapsed(env);
    pointer(env,'pointermove',env.doc.body,{clientX:handle.left+10,clientY:handle.top+10});assertShown(env);
    pointer(env,'pointerenter',env.dock);idle(env,10000);assertShown(env);
    pointer(env,'pointerleave',env.dock);idle(env);assertCollapsed(env);
    click(env,'reveal','touch');assertShown(env);click(env,'collapse','touch');assertCollapsed(env);
    checks.push('nearby mouse and touch-friendly handle reveal; hover holds; explicit collapse works');
    env.api.destroy();
  }
  {
    for(const activation of ['Enter',' ']){
      const env=setup();show(env);idle(env);assertCollapsed(env);
      assert.equal(env.doc.activeElement,env.reveal,'idle focus moves to the surviving handle');
      key(env,activation,env.reveal);env.reveal.click();assertShown(env);
      assert.equal(env.doc.activeElement,env.root.querySelector('[data-review-previous]'));
      idle(env,10000);assertShown(env);
      env.api.destroy();
    }
    checks.push('Enter and Space on the surviving handle restore a keyboard-pinned control panel');
  }
  {
    const env=setup();show(env);pointer(env,'pointerenter',env.dock);
    click(env,'collapse');assertCollapsed(env);
    // Hiding a hovered element itself causes pointerleave; that event is not
    // evidence that the person moved the pointer away from the reveal region.
    pointer(env,'pointerleave',env.dock);
    const handle=env.reveal.getBoundingClientRect();
    pointer(env,'pointermove',env.doc.body,{clientX:handle.left+10,clientY:handle.top+10});assertCollapsed(env);
    pointer(env,'pointermove',env.doc.body,{clientX:10,clientY:20});
    pointer(env,'pointermove',env.doc.body,{clientX:handle.left+10,clientY:handle.top+10});assertShown(env);
    checks.push('manual collapse survives its own pointerleave until the pointer genuinely leaves and returns');
    env.api.destroy();
  }
  {
    const env=setup();show(env);
    key(env,'Tab');const next=env.root.querySelector('[data-review-next]');next.testKeyboardFocus=true;next.focus();idle(env,10000);assertShown(env);
    env.opener.focus();idle(env);assertCollapsed(env);
    click(env,'reveal');env.details.open=true;env.details.dispatchEvent(new CustomEvent('toggle'));idle(env,10000);assertShown(env);
    env.details.open=false;env.details.dispatchEvent(new CustomEvent('toggle'));idle(env);assertCollapsed(env);
    checks.push('keyboard focus and expanded background details keep usable controls visible');
    env.api.destroy();
  }
  {
    const env=setup();show(env);const dialog=append(env.doc.body,'dialog',{open:''});idle(env,10000);assertShown(env);
    dialog.close();dialog.remove();idle(env);assertCollapsed(env);
    checks.push('an open modal cannot strand its return focus in an auto-hidden dock');
    env.api.destroy();
  }
  {
    const env=setup();show(env);assert.equal(env.api.read().placement,'bottom');
    env.footerAt(600);for(let i=0;i<40;i++)env.win.dispatchEvent(new CustomEvent('scroll'));
    assert.equal(env.clock.frames.size,1,'scroll bursts share one pending frame');env.clock.flushFrames();
    assert.equal(env.api.read().placement,'above-footer');assertFooterGap(env);assert.equal(env.clock.frames.size,0,'layout does not start a continuous RAF loop');
    const normalScrolls=env.scrolls.length;
    env.details.open=true;env.details.dispatchEvent(new CustomEvent('toggle'));env.clock.flushFrames();
    assert.equal(env.scrolls.length,normalScrolls,'details do not scroll when the protected band already has enough room');
    env.details.open=false;env.details.dispatchEvent(new CustomEvent('toggle'));env.clock.flushFrames();
    env.footerAt(1200);env.win.dispatchEvent(new CustomEvent('scroll'));env.clock.flushFrames();assert.equal(env.api.read().placement,'bottom');
    env.resize(390,844);env.dockHeight(128);env.footerAt(500);env.win.dispatchEvent(new CustomEvent('scroll'));env.clock.flushFrames();assertFooterGap(env);
    checks.push('footer avoidance preserves a real gap at desktop/mobile dimensions and coalesces scroll');
    env.api.destroy();
  }
  {
    const env=setup();env.win.scrollY=1000;show(env);env.footerAt(20,900);env.win.dispatchEvent(new CustomEvent('scroll'));env.clock.flushFrames();
    assert.equal(env.api.read().placement,'parked');assertCollapsed(env);assertFooterGap(env);
    const initialScroll=env.win.scrollY,handle=env.reveal.getBoundingClientRect();
    pointer(env,'pointermove',env.doc.body,{clientX:handle.left+10,clientY:handle.top+10});
    assert.equal(env.win.scrollY,initialScroll,'hover never scrolls the page to make room');assertCollapsed(env);
    click(env,'reveal');env.clock.flushFrames();assert.ok(env.win.scrollY<initialScroll,'explicit reveal makes space before the footer');assertShown(env);assertFooterGap(env);
    assert.ok(env.dock.getBoundingClientRect().top>=0,'active panel fits in the visible space');
    const footerAfterReveal=env.footer.getBoundingClientRect().top;
    env.details.open=true;env.details.dispatchEvent(new CustomEvent('toggle'));env.clock.flushFrames();
    assert.ok(env.footer.getBoundingClientRect().top>footerAfterReveal,'explicit details make further room above the protected dock');
    assert.ok(parseFloat(env.root.style.getPropertyValue('--viewer-info-space'))>=200,'details receive useful space above the dock instead of a clipped strip');
    assertFooterGap(env);idle(env,10000);assertShown(env);
    checks.push('a viewport-filling footer parks instead of clamping onto content; explicit reveal safely makes room');
    env.api.destroy();
  }
  {
    // Real scrolling can quantize an intended fractional offset. A footer
    // near the fit threshold still has to leave a usable, collision-free dock.
    const env=setup(undefined,{width:320,height:360,dockHeight:116,integerScroll:true});
    env.win.scrollY=1000;env.footerAt(69.7,620);show(env);
    assert.equal(env.api.read().placement,'parked');assertCollapsed(env);
    click(env,'reveal');env.clock.flushFrames();
    assert.equal(Number.isInteger(env.win.scrollY),true,'fixture uses integer native scroll positions');
    assert.notEqual(env.api.read().placement,'parked','fractional footer coordinates cannot strand an explicitly opened dock');
    assertShown(env);assertFooterGap(env);
    assert.ok(env.dock.getBoundingClientRect().top>=0,'revealed dock remains inside the visible band');
    checks.push('fractional footer geometry remains revealable when native scroll positions are rounded');
    env.api.destroy();
  }
  {
    const env=setup();show(env);env.footerAt(300);env.win.dispatchEvent(new CustomEvent('scroll'));env.clock.flushFrames();assertFooterGap(env);
    click(env,'clear');env.clock.flushFrames();assert.equal(env.api.read().onlyBackground,true);assert.equal(env.api.read().placement,'bottom','invisible footer does not lift the panel');
    click(env,'clear');env.clock.flushFrames();assert.equal(env.api.read().onlyBackground,false);assertFooterGap(env);
    checks.push('background-only mode ignores the hidden footer and restores protection with the document');
    env.api.destroy();
  }
  {
    const env=setup();show(env);env.win.dispatchEvent(new CustomEvent('scroll'));
    env.doc.hidden=true;env.doc.dispatchEvent(new CustomEvent('visibilitychange'));
    assert.equal(env.clock.frames.size,0);assert.equal(env.clock.timers.size,0);idle(env,10000);
    env.doc.hidden=false;env.doc.dispatchEvent(new CustomEvent('visibilitychange'));env.clock.flushFrames();idle(env);assertCollapsed(env);
    checks.push('backgrounded pages suspend pending geometry and idle work and resume without extra loops');
    env.api.destroy();
  }
  {
    const env=setup();show(env);const original=env.api;
    load(env,'community-background-review-v40.js');const replacement=env.win.LissBackgroundViewer;
    assert.notEqual(replacement,original);assert.equal(env.clock.frames.size,0);assert.equal(env.clock.timers.size,0);assert.equal(env.subscribers.size,1);
    env.api=replacement;show(env);const count=env.sets.length;click(env,'next');assert.equal(env.sets.length,count+1,'restart installs one selection listener');
    assert.equal(env.win.events.get('scroll')?.size,1,'restart installs one active scroll listener');
    checks.push('controller restart replaces timers, geometry listeners and control handlers instead of duplicating them');
    env.api.destroy();
  }
  {
    const env=setup();show(env);env.win.dispatchEvent(new CustomEvent('scroll'));assert.ok(env.clock.frames.size||env.clock.timers.size);
    env.api.close();assert.equal(env.clock.frames.size,0);assert.equal(env.clock.timers.size,0);assert.equal(env.doc.activeElement,env.opener);
    assert.equal(env.win.events.get('scroll')?.size||0,0,'inactive viewer has no active scroll listener');
    show(env);env.win.dispatchEvent(new CustomEvent('scroll'));env.win.dispatchEvent(new CustomEvent('pagehide',{persisted:true}));
    assert.equal(env.clock.frames.size,0);assert.equal(env.clock.timers.size,0);assert.equal(env.api.read().active,false);
    show(env);env.api.destroy();assert.equal(env.clock.frames.size,0);assert.equal(env.clock.timers.size,0);assert.equal(env.subscribers.size,0);assert.equal(env.win.LissBackgroundViewer,undefined);
    checks.push('close, BFCache navigation and destroy cancel pending work and detach active geometry listeners');
  }
  console.log(JSON.stringify({passed:true,checks},null,2));
}
run();
