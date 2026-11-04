'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../../app/static/community-background-palettes-v40.js'),'utf8');
function palettes(entries){const window={LissBackgroundSite:{revision:3,entries}};vm.runInNewContext(source,{window});return window.LissBackgroundPalettesV40;}
const plain=palettes([]),managed=palettes([
  {id:'upload-ice',kind:'image',paletteKey:'opal-ice-shelf',readingTone:'light'},
  {id:'upload-fern',kind:'image',palette:{hue:112,saturation:24,warmHue:35,warmSaturation:20,name:'蕨绿',readingTone:'dark'}},
  {id:'unsafe-css',kind:'image',palette:{hue:'0);url(https://invalid/)',saturation:20,warmHue:30,warmSaturation:20}},
  {id:'invalid-number',kind:'image',palette:{hue:20,saturation:Infinity,warmHue:30,warmSaturation:20}},
  {id:'constructor',kind:'image',paletteKey:'coast'},
  {id:'not-an-image',kind:'vector',paletteKey:'coast'},
]);
assert.equal(managed.get('upload-ice').id,'upload-ice');
assert.equal(managed.get('upload-ice').hue,plain.get('opal-ice-shelf').hue);
assert.equal(managed.get('upload-ice').readingTone,'light');
assert.equal(managed.get('upload-fern').hue,112);
assert.equal(managed.roles('upload-ice','dark')['reading-panel'],plain.roles('opal-ice-shelf','dark','light')['reading-panel']);
assert.equal(managed.get('unsafe-css'),null);assert.equal(managed.get('invalid-number'),null);
assert.equal(managed.get('constructor'),null);assert.equal(managed.get('not-an-image'),null);
assert.ok(Object.isFrozen(managed.get('upload-ice')));
assert.ok(managed.ids.includes('upload-ice')&&managed.ids.includes('coast')&&managed.ids.includes('mist'));
for(const id of plain.ids)assert.equal(JSON.stringify(managed.get(id)),JSON.stringify(plain.get(id)),'authored profile stays intact: '+id);
console.log(JSON.stringify({passed:true,scope:'managed photograph pigments, bounded numeric roles, authored library retained'}));
