#!/usr/bin/env node
// Build a standalone artifact page.
//
//   npm run artifact -- twist-level-9
//
// The output is ONE self-contained HTML file under artifacts/built/: no CDN, no
// fetch, no sibling assets. That is not a preference — the pages are published to
// claude.ai/code/artifact, where a strict CSP blocks every external host — but it
// is also what makes them worth keeping. Open one in five years and it still runs.
//
// The steps, in order:
//   1. scenes  — the artifact's own scenes.ts writes the scenes it wants to show
//   2. bake    — a headless studio builds those scenes and hands back its meshes
//   3. pack    — quantise, deflate, base64
//   4. bundle  — esbuild rolls three.js and the viewer into one script
//   5. inline  — drop that script into the page shell
//
// An artifact may instead be LIVE: no scenes, no bake, no pack. The page carries
// the app's own scene builder and StrandScene, and builds what it shows in the
// browser. That is for a page whose subject is a FAMILY too big to bake — all 64
// box faces at ten rounds each is 640 scenes and hundreds of MB — and it keeps
// the same promise a different way: the meshes still come from the app's own
// renderer, because the page is running it.
//
// A variant with a `swap` is baked against a DIFFERENT revision of a source file,
// which is how a before/after page shows a real regression rather than a drawing
// of one. The file is restored afterwards, and the build refuses to start if that
// file has uncommitted changes — losing your work to a doc build would be rude.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bake } from './lib/bake.mjs';
import { pack } from './lib/pack.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.ARTIFACT_PORT ?? 5181);
const URL_BASE = `http://localhost:${PORT}/Scoubidou3D`;

const name = process.argv[2];
if (!name) {
  console.error('usage: npm run artifact -- <name>   (e.g. twist-level-9)');
  process.exit(1);
}
const dir = `${HERE}${name}`;
if (!existsSync(`${dir}/artifact.json`)) {
  console.error(`no artifact at artifacts/${name}/ — expected artifact.json there`);
  process.exit(1);
}

const spec = JSON.parse(readFileSync(`${dir}/artifact.json`, 'utf8'));
const work = `${dir}/.work`;
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

// ---- 0. don't build over anyone's work --------------------------------------
const swapped = [...new Set((spec.variants ?? []).flatMap((v) => Object.keys(v.swap ?? {})))];
const dirty = git('status', '--porcelain', '--', ...(swapped.length ? swapped : ['.']))
  .split('\n')
  .filter(Boolean);
if (swapped.length && dirty.length) {
  console.error('these files are swapped during the build and have uncommitted changes:');
  for (const line of dirty) console.error('  ' + line);
  console.error('commit or stash them first.');
  process.exit(1);
}

// ---- the dev server ----------------------------------------------------------
// window.__scoubidou only exists in dev; production builds strip it.
async function reachable() {
  try {
    return (await fetch(`${URL_BASE}/app/`)).ok;
  } catch {
    return false;
  }
}

async function serve() {
  if (await reachable()) return null;
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, BROWSER: 'none' },
  });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await reachable()) return child;
  }
  child.kill();
  throw new Error(`vite did not come up on :${PORT}`);
}

// ---- build -------------------------------------------------------------------
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

console.log(`artifact ${name}`);
let server = null;
try {
  if (spec.live) {
    console.log('  live — no scenes to bake; the page builds its own');
  } else {
  // 1. scenes
    execFileSync(
      'npx',
      ['esbuild', `${dir}/scenes.ts`, '--bundle', '--platform=node', '--format=esm',
        `--outfile=${work}/scenes.mjs`, '--log-level=warning'],
      { cwd: ROOT, stdio: 'inherit' },
    );
    execFileSync('node', [`${work}/scenes.mjs`, `${work}/scenes`, JSON.stringify(spec.sample)],
      { cwd: ROOT, stdio: 'inherit' });
  
    server = await serve();
  
    // 2 + 3. bake each variant, swapping sources where it asks for it
    const variants = {};
    for (const variant of spec.variants) {
      for (const [file, ref] of Object.entries(variant.swap ?? {})) {
        writeFileSync(`${ROOT}/${file}`, git('show', `${ref}:${file}`));
      }
      try {
        // vite needs a beat to notice a swapped file before the page reloads onto it
        if (variant.swap) await new Promise((r) => setTimeout(r, 1500));
        // `show` names the scene to keep. A page that flips between several — a
        // family rather than a before/after — names them all, and omitting it
        // keeps every scene the bake produced.
        const want = spec.show == null ? null : [spec.show].flat();
        const packed = pack(await bake(`${work}/scenes`, { url: URL_BASE }), want);
        variants[variant.id] = { meta: packed.meta, blob: packed.blob };
        const meshes = Object.values(packed.meta).reduce((n, s) => n + s.parts.length, 0);
        console.log(
          `  ${variant.id.padEnd(7)} ${Object.keys(packed.meta).length} scene(s), ${meshes} meshes, ` +
            `${(packed.rawBytes / 1048576).toFixed(2)} MB -> ${(packed.blob.length / 1048576).toFixed(2)} MB`,
        );
      } finally {
        for (const file of Object.keys(variant.swap ?? {})) git('checkout', '--', file);
      }
    }
    writeFileSync(`${work}/data.json`, JSON.stringify({ show: spec.show, variants }));
  }

  // 4. bundle
  execFileSync(
    'npx',
    ['esbuild', `${dir}/viewer.js`, '--bundle', '--minify', '--format=iife',
      `--outfile=${work}/viewer.js`, '--loader:.json=json', '--log-level=warning'],
    { cwd: ROOT, stdio: 'inherit' },
  );

  // 5. inline
  const script = readFileSync(`${work}/viewer.js`, 'utf8');
  if (script.includes('</script')) throw new Error('the bundle would break out of its script tag');
  const shell = readFileSync(`${dir}/page.html`, 'utf8');
  if (!shell.includes('__VIEWER__')) throw new Error('page.html has no __VIEWER__ placeholder');
  mkdirSync(`${HERE}built`, { recursive: true });
  const out = `${HERE}built/${name}.html`;
  writeFileSync(out, shell.replace('__VIEWER__', () => script));
  console.log(`  -> artifacts/built/${name}.html  ${(readFileSync(out).length / 1048576).toFixed(2)} MB`);
} finally {
  if (server) server.kill();
}
