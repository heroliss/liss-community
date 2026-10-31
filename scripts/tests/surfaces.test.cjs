/* Execute the real controller's URL resolution before its optional renderer mounts.
   Browser/GPU rendering is verified separately; these cases catch bundle path drift. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'app/static/community-surfaces.js'), 'utf8');
const cases = [
  {
    name: 'sourceAtRoot',
    script: 'http://localhost:8896/static/community-surfaces.js?v=0123456789abcdef',
    expected: 'http://localhost:8896/static/textures/material-v22/normal-roughness.png'
  },
  {
    name: 'bundleAtRoot',
    script: 'http://localhost:8896/static/bundles/runtime.0123456789abcdef.js',
    expected: 'http://localhost:8896/static/textures/material-v22/normal-roughness.png'
  },
  {
    name: 'sourceWithMountPrefix',
    script: 'https://forum.example.test/nested/forum/static/community-surfaces.js?v=0123456789abcdef',
    expected: 'https://forum.example.test/nested/forum/static/textures/material-v22/normal-roughness.png'
  },
  {
    name: 'bundleWithMountPrefix',
    script: 'https://forum.example.test/nested/forum/static/bundles/runtime.0123456789abcdef.js?v=preview',
    expected: 'https://forum.example.test/nested/forum/static/textures/material-v22/normal-roughness.png'
  },
  {
    name: 'bundleOnStaticOrigin',
    script: 'https://cdn.example.test/assets/bundles/runtime.0123456789abcdef.js',
    expected: 'https://cdn.example.test/assets/textures/material-v22/normal-roughness.png'
  }
];

const checks = {};
for (const scenario of cases) {
  const resolved = [];
  class ObservedURL extends URL {
    constructor(value, base) {
      super(value, base);
      resolved.push(this.href);
    }
  }
  // No body is deliberate: mount() exits before needing WebGL or a fake renderer.
  // The resource location still runs as part of the actual controller startup.
  const window = { addEventListener() {} };
  const document = {
    currentScript: { src: scenario.script },
    baseURI: 'https://forum.example.test/nested/forum/post/42',
    body: null
  };
  vm.runInNewContext(source, { window, document, URL: ObservedURL, AbortController }, {
    filename: 'community-surfaces.js'
  });
  const textures = resolved.filter(url => url.endsWith('/normal-roughness.png'));
  assert.deepEqual(textures, [scenario.expected], scenario.name);
  assert.equal(window.__lissCommunitySurfaces.inspect().failures, 0, scenario.name);
  window.__lissCommunitySurfaces.destroy();
  assert.equal(window.__lissCommunitySurfaces, undefined, scenario.name);
  checks[scenario.name] = true;
}
assert.equal(fs.existsSync(path.join(root, 'app/static/textures/material-v22/normal-roughness.png')), true);
checks.textureExists = true;
console.log(JSON.stringify({ passed: true, checks }, null, 2));
