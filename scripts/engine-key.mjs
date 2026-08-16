// The engine-file key, and the thing that stops it going stale.
//
//   node scripts/engine-key.mjs --check     # CI: fail if it is out of step
//   node scripts/engine-key.mjs --write     # record the current state
//
// WHY THIS EXISTS. public/mxn/*.js and public/mxn/py/*.py are served verbatim
// under stable URLs — Vite hashes bundle assets, not public/ files — so the
// only thing that stops a browser answering today's page with last month's
// engine is the `?v=` key the workers and the pages put on those URLs.
//
// It has failed twice, the same way both times. `bridge.fit_plan_now` shipped
// without the key being bumped, so every browser holding a cached `bridge.py`
// ran a worker that HAD the new handler against a module that did not have the
// function, and the page reported:
//
//     AttributeError: module 'bridge' has no attribute 'fit_plan_now'
//
// Nothing in the build could have caught that, because nothing in the build
// knew the two were related. Now it does: the key is recorded here beside a
// hash of the engine files it refers to, and CI refuses a commit that changes
// one without the other. The rule is a sentence — CHANGE THE PYTHON, BUMP THE
// KEY — and this is what makes forgetting it loud.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const MANIFEST = `${ROOT}scripts/engine-key.json`;
const PY_DIR = `${ROOT}public/mxn/py`;

// Every place the key is written. A partial bump is worse than none: it splits
// one engine across two cache entries and the pages disagree about which they
// are running.
const SITES = [
  'public/mxn/exact-worker.js',
  'public/mxn/count-worker.js',
  'public/mxn/farm-worker.js',
  'src/mxn-lab/weave-studio.tsx',
  'src/mxn-farm/farm.tsx',
  'src/mxn-fit/fitter.tsx',
];

/** The engine as the browser would receive it: every .py, name and contents. */
function hashEngine() {
  const hash = createHash('sha256');
  for (const name of readdirSync(PY_DIR).filter(f => f.endsWith('.py')).sort()) {
    hash.update(name);
    hash.update(readFileSync(`${PY_DIR}/${name}`));
  }
  return hash.digest('hex').slice(0, 16);
}

/** Every distinct `?v=` value across the sites, so a partial bump is visible. */
function keysInUse() {
  const found = new Map();
  for (const site of SITES) {
    const text = readFileSync(`${ROOT}${site}`, 'utf8');
    for (const [, key] of text.matchAll(/[?&]v=([\w.-]+)/g)) {
      if (!found.has(key)) found.set(key, []);
      found.get(key).push(site);
    }
  }
  return found;
}

const sha = hashEngine();
const keys = keysInUse();

if (process.argv.includes('--write')) {
  const [key] = [...keys.keys()];
  writeFileSync(MANIFEST, `${JSON.stringify({ key, sha }, null, 2)}\n`);
  console.log(`recorded ${key} for engine ${sha}`);
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const problems = [];

if (keys.size !== 1) {
  problems.push(
    `the engine-file key is not one value — a partial bump splits one engine\n`
    + `    across two cache entries and the pages disagree about which they hold:\n`
    + [...keys].map(([k, where]) => `      ${k}  ${where.join(', ')}`).join('\n'));
} else {
  const [key] = [...keys.keys()];
  if (sha !== manifest.sha && key === manifest.key) {
    problems.push(
      `public/mxn/py changed but the engine-file key did not.\n`
      + `    Every browser holding a cached .py would run it against the new\n`
      + `    workers — which is how "module 'bridge' has no attribute …" reaches\n`
      + `    a reader. Bump ${key} in all ${SITES.length} sites, then:\n`
      + `      node scripts/engine-key.mjs --write`);
  } else if (key !== manifest.key || sha !== manifest.sha) {
    problems.push(
      `the key and the engine moved; record them:\n`
      + `      node scripts/engine-key.mjs --write\n`
      + `    (have ${key}/${sha}, recorded ${manifest.key}/${manifest.sha})`);
  }
}

if (problems.length) {
  console.error(`\n  engine-key: ${problems.join('\n\n  engine-key: ')}\n`);
  process.exit(1);
}
console.log(`engine-key: ${manifest.key} matches engine ${sha} across ${SITES.length} sites`);
