/* Exercise the actual temporary viewer lifecycle, focus and keyboard behavior. */
'use strict';
const assert=require('node:assert/strict');
const {CustomEvent,append,key}=require('./background-picker.test.cjs');
const {setup,click}=require('./background-viewer-fixture.cjs');

function initialAttributes(env){return[env.skip,env.header,env.main,env.footer].map(node=>({node,aria:node.getAttribute('aria-hidden'),inert:node.hasAttribute('inert')}));}
function assertRestored(snapshot){for(const {node,aria,inert}of snapshot){assert.equal(node.getAttribute('aria-hidden'),aria,'restore pre-existing aria state');assert.equal(node.hasAttribute('inert'),inert,'restore pre-existing inert state');}}
function run(){
  const env=setup();assert.ok(env.api,'formal viewer API exists');const checks=[];
  assert.equal(env.api.read().active,false);assert.equal(env.root.hidden,true);assert.equal(env.sets.length,0);assert.equal(env.images.length,0);checks.push('default inactive and zero media requests');
  assert.equal(key(env,'ArrowRight').defaultPrevented,false);assert.equal(key(env,'s').defaultPrevented,false);assert.equal(env.sets.length,0);checks.push('inactive mode never captures page keys');
  env.api.open({returnFocus:env.opener});assert.equal(env.api.read().active,true);assert.equal(env.root.hidden,false);
  key(env,'ArrowRight');assert.equal(env.api.read().id,'noctilucent-sea');key(env,'ArrowRight');assert.equal(env.api.read().id,'mist');key(env,'ArrowLeft');assert.equal(env.api.read().id,'noctilucent-sea');checks.push('active arrows wrap through the catalogue');
  const before=env.sets.length;const input=append(env.doc.body,'input',{type:'search'});
  assert.equal(key(env,'ArrowRight',input).defaultPrevented,false);
  assert.equal(key(env,'ArrowRight',env.doc.body,{isComposing:true}).defaultPrevented,false);
  assert.equal(key(env,'ArrowRight',env.doc.body,{ctrlKey:true}).defaultPrevented,false);
  assert.equal(key(env,'s').defaultPrevented,false);assert.equal(env.sets.length,before);
  const dialog=append(env.doc.body,'dialog',{open:''});assert.equal(key(env,'ArrowLeft').defaultPrevented,false);assert.equal(key(env,'Escape').defaultPrevented,false);assert.equal(env.api.read().active,true);dialog.remove();checks.push('editing, IME, modifiers and open dialog keep native keys');
  const original=initialAttributes(env);click(env,'clear');assert.equal(env.api.read().onlyBackground,true);
  for(const {node}of original){assert.equal(node.inert,true);assert.equal(node.getAttribute('aria-hidden'),'true');}
  assert.equal(env.root.inert,false);assert.equal(env.root.hasAttribute('aria-hidden'),false);
  click(env,'clear');assert.equal(env.api.read().onlyBackground,false);assertRestored(original);checks.push('background-only excludes document content and restores exact attributes');
  click(env,'clear');let pickerEvent=null;env.win.addEventListener('liss:background-picker-open',event=>pickerEvent=event);
  const browse=click(env,'browse');assert.ok(pickerEvent,'picker reused via public event');assert.equal(env.api.read().onlyBackground,false);assertRestored(original);checks.push('opening picker restores interactive content first');
  env.doc.activeElement=browse;key(env,'Escape');assert.equal(env.api.read().active,false);assert.equal(env.root.hidden,true);assert.equal(env.doc.activeElement,env.opener);assertRestored(original);checks.push('Escape exits mode and restores focus');
  env.api.open({returnFocus:env.opener});click(env,'clear');env.win.dispatchEvent(new CustomEvent('pagehide',{persisted:true}));assert.equal(env.api.read().active,false);assertRestored(original);assert.ok(env.win.LissBackgroundViewer);env.api.open();assert.equal(env.api.read().active,true);checks.push('bfcache navigation clears mode without losing controller');
  env.api.destroy();assert.equal(env.win.LissBackgroundViewer,undefined);assertRestored(original);const finalSets=env.sets.length;key(env,'ArrowRight');assert.equal(env.sets.length,finalSets);assert.equal(env.subscribers.size,0);checks.push('destroy restores document and removes listeners');
  const legacy=setup('http://localhost/?q=keep&background_review=1&scene=noctilucent-sea#article-feed');
  assert.equal(legacy.api.read().active,false);assert.equal(legacy.root.hidden,true);assert.equal(legacy.api.read().id,'noctilucent-sea');assert.equal(legacy.sets.length,1);assert.equal(legacy.location.searchParams.get('q'),'keep');assert.equal(legacy.location.hash,'#article-feed');assert.equal(legacy.location.searchParams.has('scene'),false);assert.equal(legacy.location.searchParams.has('background_review'),false);legacy.api.destroy();checks.push('legacy link consumes whitelisted scene without enabling mode');
  const invalid=setup('http://localhost/?background_review=1&scene=__proto__');assert.equal(invalid.sets.length,0);assert.equal(invalid.api.read().active,false);invalid.api.destroy();checks.push('unrecognized deep link cannot become a background choice');
  console.log(JSON.stringify({passed:true,checks},null,2));
}
run();
