'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {cleanAssets} = require('../clean_assets.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'liss-asset-cleanup-'));
const outDir = path.join(root, 'bundles');
fs.mkdirSync(outDir);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function bundle(group, content) {
  const name = group + '.' + sha(content).slice(0, 16) + '.js';
  fs.writeFileSync(path.join(outDir, name), content);
  return name;
}
try {
  const current = bundle('runtime', 'window.current = true;');
  const stale = bundle('runtime', 'window.previous = true;');
  const unknown = bundle('retired', 'window.unknown = true;');
  const manifest = {schema: 1, groups: {runtime: {file: 'bundles/' + current, sha256: sha('window.current = true;')}}};
  const manifestPath = path.join(root, 'asset-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  fs.writeFileSync(path.join(outDir, 'notes.txt'), 'user notes');
  fs.writeFileSync(path.join(root, 'original.js'), 'source file');
  fs.mkdirSync(path.join(outDir, 'backup'));
  const report = cleanAssets(root);
  assert.deepEqual(report.files, [stale]);
  assert.equal(report.mode, 'dry-run');
  assert.equal(fs.existsSync(path.join(outDir, stale)), true, 'dry run preserves everything');
  assert.deepEqual(report.skipped.sort(), ['backup', 'notes.txt', unknown].sort());

  fs.writeFileSync(path.join(outDir, current), 'modified current asset');
  assert.throws(() => cleanAssets(root, true), /missing or modified/);
  assert.equal(fs.existsSync(path.join(outDir, stale)), true, 'invalid current bundle prevents cleanup');
  fs.writeFileSync(path.join(outDir, current), 'window.current = true;');
  const tampered = bundle('runtime', 'window.private = true;');
  fs.writeFileSync(path.join(outDir, tampered), 'user changed this file');
  assert.equal(cleanAssets(root).skipped.includes(tampered), true, 'a hash-looking name is insufficient without a matching digest');

  const removed = cleanAssets(root, true);
  assert.equal(removed.staleBundles, 1);
  assert.equal(fs.existsSync(path.join(outDir, stale)), false);
  for (const name of [current, unknown, tampered, 'notes.txt', 'backup']) assert.equal(fs.existsSync(path.join(outDir, name)), true);
  assert.equal(fs.readFileSync(path.join(root, 'original.js'), 'utf8'), 'source file');
  assert.equal(cleanAssets(root, true).staleBundles, 0, 'cleanup is idempotent');

  manifest.groups.runtime.file = '../outside.js';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => cleanAssets(root, true), /Invalid current bundle/);
  console.log('PASS asset cleanup: dry run, verified retention, tampering, unknown files, containment and idempotency.');
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.equal(path.basename(root).startsWith('liss-asset-cleanup-'), true);
  fs.rmSync(root, {recursive: true, force: true});
}
