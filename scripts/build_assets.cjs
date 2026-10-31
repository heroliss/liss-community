/* Keep source order and URLs intact while making independently cacheable bundles. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const staticDir = path.join(root, 'app', 'static');
const outDir = path.join(staticDir, 'bundles');
const groups = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'sources.json'), 'utf8'));
const checkOnly = process.argv.includes('--check');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

(async () => {
  const result = {schema: 1, tool: 'esbuild@0.28.2', groups: {}};
  const outputs = [];
  for (const [name, files] of Object.entries(groups)) {
    const extension = path.extname(files[0]);
    const inputs = files.map(file => {
      const resolved = path.resolve(staticDir, file);
      if (!resolved.startsWith(staticDir + path.sep) || path.extname(file) !== extension) throw new Error('Invalid asset input');
      return fs.readFileSync(resolved);
    });
    let contents;
    if (extension === '.css') {
      const css = await esbuild.build({
        stdin: {contents: files.map(file => '@import "./' + file + '";').join('\n'), resolveDir: staticDir, loader: 'css'},
        outfile: path.join(outDir, name + '.css'), bundle: true, write: false,
        minify: true, target: ['chrome110', 'firefox115', 'safari16.4'], legalComments: 'none',
        plugins: [{name: 'preserve-local-media', setup(build) {
          build.onResolve({filter: /\.(woff2?|png|webp|svg|jpe?g)(\?.*)?$/}, args => {
            if (/^(https?:|data:)/.test(args.path)) return {path: args.path, external: true};
            const resolved = path.resolve(args.resolveDir, args.path);
            if (!resolved.startsWith(staticDir + path.sep)) throw new Error('Media URL escapes static directory');
            return {path: '../' + path.relative(staticDir, resolved).split(path.sep).join('/'), external: true};
          });
        }}]
      });
      contents = Buffer.from(css.outputFiles[0].contents);
    } else {
      const js = await esbuild.transform(inputs.map((data, index) => '\n/* ' + files[index] + ' */\n' + data.toString('utf8') + '\n;').join('\n'), {
        loader: 'js', minify: true, target: 'es2022', legalComments: 'none', charset: 'utf8'
      });
      contents = Buffer.from(js.code);
    }
    const filename = 'bundles/' + name + '.' + sha(contents).slice(0, 16) + extension;
    result.groups[name] = {
      file: filename, sha256: sha(contents), bytes: contents.length,
      sourceBytes: inputs.reduce((sum, data) => sum + data.length, 0),
      gzipBytes: zlib.gzipSync(contents, {level: 9}).length,
      sources: Object.fromEntries(files.map((file, index) => [file, sha(inputs[index])]))
    };
    outputs.push([path.join(staticDir, filename), contents]);
  }
  const manifestFile = path.join(staticDir, 'asset-manifest.json');
  const serialized = JSON.stringify(result, null, 2) + '\n';
  if (checkOnly) {
    if (!fs.existsSync(manifestFile) || fs.readFileSync(manifestFile, 'utf8') !== serialized) throw new Error('Asset manifest is stale. Run npm run build.');
    for (const [file, contents] of outputs) if (!fs.existsSync(file) || !fs.readFileSync(file).equals(contents)) throw new Error('Missing or stale bundle: ' + file);
    console.log('Asset manifest and all ' + outputs.length + ' bundles match current source.');
  } else {
    fs.mkdirSync(outDir, {recursive: true});
    for (const [file, contents] of outputs) fs.writeFileSync(file, contents);
    fs.writeFileSync(manifestFile, serialized);
    console.log(JSON.stringify(Object.fromEntries(Object.entries(result.groups).map(([name, value]) => [name, {
      sourceBytes: value.sourceBytes, bytes: value.bytes, gzipBytes: value.gzipBytes
    }])), null, 2));
  }
})().catch(error => {console.error(error.message); process.exitCode = 1;});
