// Fold mocks/widgets.html into one self-contained file.
//
//   node scripts/build-mock.mjs [out.html]     # default: node_modules/.cache/widgets-standalone.html
//
// Same components, same engine payloads, no dev server and no network: the
// bundle, the stylesheets and the fixtures are all inlined, so the mock can be
// opened straight off disk or handed to someone who has never checked the
// repository out. The dev-served mocks/widgets.html stays the one to work in;
// this is for sending.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = process.argv[2] || `${ROOT}node_modules/.cache/widgets-standalone.html`;

const result = await build({
  entryPoints: [`${ROOT}src/mxn-lab/mock-widgets.tsx`],
  bundle: true,
  format: 'iife',
  minify: true,
  jsx: 'automatic',
  target: 'es2020',
  write: false,
  outdir: 'out',
  loader: { '.css': 'css' },
  // import.meta.env.BASE_URL is vite's; nothing the mock renders reads it, but
  // the studio module it imports from does at load time.
  define: { 'import.meta.env.BASE_URL': '"/"' },
});

const js = result.outputFiles.find(f => f.path.endsWith('.js'))?.text ?? '';
const css = result.outputFiles.find(f => f.path.endsWith('.css'))?.text ?? '';

// The harness chrome lives in the mock page's own <style>; take it verbatim so
// the standalone copy and the dev-served one look the same.
const page = readFileSync(`${ROOT}mocks/widgets.html`, 'utf8');
const chrome = page.slice(page.indexOf('<style>') + 7, page.indexOf('</style>'));

const fixtures = {
  'trace-plan-l1.json': JSON.parse(
    readFileSync(`${ROOT}mocks/fixtures/trace-plan-l1.json`, 'utf8')),
  'candidates-l1.json': JSON.parse(
    readFileSync(`${ROOT}mocks/fixtures/candidates-l1.json`, 'utf8')),
};

const html = `<title>MXN Lab — busy-state widgets</title>
<style>${css}</style>
<style>${chrome}</style>
<div id="mock"></div>
<script>window.__MOCK_FIXTURES=${
  JSON.stringify(fixtures).replace(/</g, '\\u003c')};</script>
<script>${js}</script>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log('wrote', OUT, html.length, 'bytes');
