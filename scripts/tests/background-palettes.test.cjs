/* Verify readable palette roles, separate mode choices and catalogue coverage. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const window={};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../app/static/community-background-palettes-v40.js'),'utf8'),{window});
const palettes=window.LissBackgroundPalettesV40;
const {environment,load}=require('./background-picker.test.cjs');
const env=environment();load(env,'community-background-palettes-v40.js');load(env,'community-background-candidates-v40.js');load(env,'community-backgrounds.js');
const catalogueIds=env.win.LissBackgrounds.list().map(entry=>entry.id);
function luminance(colour){const parts=colour.match(/^hsl\((\d+) (\d+)% (\d+)%/);assert.ok(parts,colour);const h=Number(parts[1])/30,s=Number(parts[2])/100,l=Number(parts[3])/100,a=s*Math.min(l,1-l);const rgb=[0,8,4].map(n=>{const k=(n+h)%12;return l-a*Math.max(-1,Math.min(k-3,9-k,1));});return rgb.map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);}
function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
let count=0,minButton=99,minReading=99;
assert.deepEqual([...palettes.ids].sort(),[...catalogueIds].sort(),'each selectable background has exactly one palette, without stale palettes');assert.equal(palettes.get('__proto__'),null);
for(const id of palettes.ids)for(const mode of ['light','dark']){
  const p=palettes.roles(id,mode);assert.ok(Object.isFrozen(p));
  const button=contrast(p.accent,p.ink),reading=contrast(p['reading-text'],p['reading-panel']);minButton=Math.min(minButton,button);minReading=Math.min(minReading,reading);
  assert.ok(button>=4.5,id+' '+mode+' button ink');assert.ok(reading>=7,id+' '+mode+' reading role');
  assert.notEqual(palettes.roles(id,'light').accent,palettes.roles(id,'dark').accent);count++;
}
const distinctive=new Set(palettes.ids.map(id=>palettes.roles(id,'dark').accent));assert.ok(distinctive.size>=30,'individual art directions keep distinct interface pigments');
env.win.LissBackgrounds.destroy();
console.log(JSON.stringify({passed:true,palettes:palettes.ids.length,modeChecks:count,minimumButtonContrast:Math.round(minButton*100)/100,minimumReadingRoleContrast:Math.round(minReading*100)/100,scope:'solid role colours; photographic contrast still needs visual review'}));
