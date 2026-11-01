/* Explicit maintenance for unreferenced, content-addressed generated bundles. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const bundleName = /^([a-z][a-z0-9-]*)\.([a-f0-9]{16})\.(css|js)$/;

function planCleanup(staticDirectory) {
  const staticDir = path.resolve(staticDirectory);
  const outDir = path.join(staticDir, 'bundles');
  const directory = fs.lstatSync(outDir);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Bundle directory must be a real directory.');
  const manifestBytes = fs.readFileSync(path.join(staticDir, 'asset-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schema !== 1 || !manifest.groups || Array.isArray(manifest.groups) ||
      typeof manifest.groups !== 'object' || !Object.keys(manifest.groups).length) throw new Error('Invalid asset manifest.');
  const current = new Set();
  const groups = new Set(Object.keys(manifest.groups));
  for (const [group, asset] of Object.entries(manifest.groups)) {
    const filename = asset && typeof asset.file === 'string' ? asset.file : '';
    const name = filename.slice('bundles/'.length);
    const match = bundleName.exec(name);
    if (!filename.startsWith('bundles/') || !match || match[1] !== group ||
        !/^[a-f0-9]{64}$/.test(asset.sha256 || '') || match[2] !== asset.sha256.slice(0, 16)) throw new Error('Invalid current bundle entry.');
    const file = path.join(outDir, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || sha(fs.readFileSync(file)) !== asset.sha256) throw new Error('Current bundle is missing or modified. Run npm run build first.');
    current.add(name);
  }
  const stale = [];
  const skipped = [];
  for (const name of fs.readdirSync(outDir).sort()) {
    if (current.has(name)) continue;
    const file = path.resolve(outDir, name);
    const stat = fs.lstatSync(file);
    const match = bundleName.exec(name);
    // Preserve unfamiliar files, retired groups, links, folders and changed contents.
    if (path.dirname(file) !== outDir || !stat.isFile() || stat.isSymbolicLink() ||
        !match || !groups.has(match[1]) || sha(fs.readFileSync(file)).slice(0, 16) !== match[2]) {
      skipped.push(name);
      continue;
    }
    stale.push({name, bytes: stat.size, sha256: sha(fs.readFileSync(file))});
  }
  return {staticDir, outDir, manifestSha256: sha(manifestBytes), current: [...current].sort(), stale, skipped};
}

function cleanAssets(staticDir, write = false) {
  const plan = planCleanup(staticDir);
  if (write) {
    // Revalidate immediately before deletion; never clean against an obsolete manifest.
    const fresh = planCleanup(staticDir);
    if (JSON.stringify(fresh) !== JSON.stringify(plan)) throw new Error('Assets changed during cleanup. Retry after the build finishes.');
    for (const item of plan.stale) {
      const file = path.join(plan.outDir, item.name);
      const stat = fs.lstatSync(file);
      if (sha(fs.readFileSync(path.join(plan.staticDir, 'asset-manifest.json'))) !== plan.manifestSha256 ||
          !stat.isFile() || stat.isSymbolicLink() || sha(fs.readFileSync(file)) !== item.sha256) throw new Error('Assets changed during cleanup. Retry after the build finishes.');
      fs.unlinkSync(file);
    }
  }
  return {mode: write ? 'removed' : 'dry-run', currentBundles: plan.current.length,
    staleBundles: plan.stale.length, staleBytes: plan.stale.reduce((sum, item) => sum + item.bytes, 0),
    files: plan.stale.map(item => item.name), skipped: plan.skipped};
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--write')) throw new Error('Usage: node scripts/clean_assets.cjs [--write]');
    console.log(JSON.stringify(cleanAssets(path.resolve(__dirname, '..', 'app', 'static'), args.includes('--write')), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {planCleanup, cleanAssets};
