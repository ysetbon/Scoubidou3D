// A whole shelf on your own machine, so /mxn/ can be tried without Cloudflare.
//
//   npm run build
//   npm run mock:shelf          # then open the URL it prints
//
// Same arrangement as `npm run qa:cache` — the real Worker over node:sqlite,
// the real vite build out of dist/ — except this one stays up and seeds itself
// with what a judged ★ best looks like, instead of running assertions and
// exiting. It is here so "does sizing the search from the hand pick actually
// make [-1,-1,-1] fast?" is a question you answer by pressing Run, not by
// reading a table somebody else measured.
//
// Nothing here talks to the network. The pick it seeds is SYNTHETIC: the
// extensions are the real ones off the 3×1 k=−1 board — (62.55) and
// (55.75, 57.3, 27.5) — because those are what sizes the grid, but the ring is
// not yonatan's, so the card will draw a placeholder rather than his geometry.
// It is a rig for measuring the search, not for looking at the answer.
//
// Needs Node 22+ for node:sqlite.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

// fileURLToPath, not `.pathname`: on Windows a file URL's pathname is
// "/C:/Users/..." and joining that onto anything gives "C:\C:\Users\...",
// which is what the first person to run this on Windows got. Every path below
// goes through join() for the same reason.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE_DIR = join(ROOT, 'node_modules', '.cache');
const PORT = Number(process.env.MOCK_PORT || 5175);
const TOKEN = 'mock-token-long-enough-to-be-a-token';
mkdirSync(CACHE_DIR, { recursive: true });

if (!existsSync(join(ROOT, 'dist', 'mxn', 'index.html'))) {
  console.error('No build yet. Run:  npm run build');
  process.exit(2);
}

// What to seed. One entry per (size, k) you want a ★ best for; `ext` is
// [h_extensions, v_extensions] exactly as the board shows them.
const PICKS = [
  { m: 3, n: 1, k: -1, chooser: 'yonatan', ext: [[62.55], [55.75, 57.3, 27.5]] },
  { m: 2, n: 1, k: -1, chooser: 'yonatan', ext: [[0], [30, 80]] },
];

// ---- the Worker, with node:sqlite behind its D1 binding --------------------
const BUNDLE = join(CACHE_DIR, 'mock-worker.mjs');
// `npx` is npx.cmd on Windows and execFile does not find it without the
// extension; shell:true lets the platform resolve it either way.
execFileSync('npx', ['esbuild', 'worker-api/src/index.ts', '--bundle', '--format=esm',
  '--platform=node', `--outfile=${BUNDLE}`, '--log-level=warning'],
  { cwd: ROOT, stdio: 'inherit', shell: true });
// pathToFileURL, because import() of a bare "C:\..." path is not a valid
// specifier on Windows — it has to be a file:// URL.
const worker = (await import(pathToFileURL(BUNDLE).href)).default;

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(join(ROOT, 'worker-api', 'schema.sql'), 'utf8'));
const env = {
  ADMIN_TOKEN: TOKEN,
  ALLOWED_ORIGINS: `http://localhost:${PORT}`,
  CACHE_PUBLIC_READS: '1',
  DB: {
    prepare(sql) {
      const make = args => ({
        bind: (...next) => make(next.map(v => v === undefined ? null : v)),
        async first(column) {
          const row = db.prepare(sql).all(...args)[0] ?? null;
          return column && row ? row[column] : row;
        },
        async all() { return { results: db.prepare(sql).all(...args), success: true }; },
        async run() {
          if (/returning/i.test(sql)) {
            const rows = db.prepare(sql).all(...args);
            return { meta: { changes: rows.length }, results: rows };
          }
          return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } };
        },
      });
      return make([]);
    },
    async batch(statements) {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      return out;
    },
  },
};
const api = (path, init = {}) => worker.fetch(
  new Request(`https://api.test${path}`, init), env);

// ---- seed a ★ best per entry ----------------------------------------------
// The fitter's own flags, because that is what /mxn/fit/ writes and therefore
// where every real judgement lives: s1-eauto-b400000.
for (const { m, n, k, chooser, ext } of PICKS) {
  const key = `v3/lh-cw/${m}x${n}/${k}/s1-eauto-b400000`;
  const artifact = {
    kind: 'picks', cacheVersion: 'v3',
    descriptor: { m, n, ks: [k], hand: 'lh', direction: 'cw',
                  shortArms: true, step: 'auto', budget: 400000 },
    judgements: [{
      id: `mock-${m}x${n}-${k}`, verdict: 'best', source: 'fitter', chooser,
      at: '2026-08-16T00:00:00Z',
      levels: [{ level: 1, h: { ext: ext[0], angle: null },
                 v: { ext: ext[1], angle: null } }],
      audit: { crossings: 4 * m * n, expected: 4 * m * n, stray: 0, broken: 0 },
      // A placeholder ring: enough that the pick is drawable, honestly not the
      // judged geometry. The grid comes off the extensions above, not this.
      strands: [{ type: 'Strand', layer_name: '1_4',
                  start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, width: 46,
                  color: { r: 120, g: 120, b: 220 },
                  stroke_color: { r: 0, g: 0, b: 0 }, stroke_width: 4 }],
    }],
  };
  const reply = await api(`/cache/picks/${key}`, {
    method: 'PUT', body: gzipSync(Buffer.from(JSON.stringify(artifact))),
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Mxn-Codec': 'gzip' },
  });
  console.log(`  seeded ★ best  ${m}×${n} k=${k}  reach ${
    Math.max(...ext.flat())}  (HTTP ${reply.status})`);
}

// ---- one server: /api is the Worker, everything else is dist/ --------------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.py': 'text/plain', '.wasm': 'application/wasm',
};
createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api')) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const init = { method: request.method, headers: request.headers };
    if (chunks.length) init.body = Buffer.concat(chunks);
    const reply = await api(`${url.pathname.slice(4) || '/'}${url.search}`, init);
    response.writeHead(reply.status, Object.fromEntries(reply.headers));
    response.end(Buffer.from(await reply.arrayBuffer()));
    return;
  }
  let path = join(ROOT, 'dist', url.pathname.replace(/^\/Scoubidou3D/, ''));
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) { response.writeHead(404); response.end('not built'); return; }
  response.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
  response.end(readFileSync(path));
}).listen(PORT, () => {
  const base = `http://localhost:${PORT}/Scoubidou3D/mxn`;
  const cache = `cache=http://localhost:${PORT}/api`;
  console.log(`\n  mock shelf up on :${PORT}\n`);
  console.log(`    ${base}/?${cache}\n`);
  console.log('  Deliberately WITHOUT m/n/ks in the URL: those make the page run');
  console.log('  on load, which disables Run before you can tick anything. So:\n');
  console.log('    1. type  M 3   N 1   KS  -1 -1 -1');
  console.log('    2. open ADVANCED SEARCH, tick "size the search from the');
  console.log('       judged ★ best"');
  console.log('    3. press RUN — the sidebar says which grid it chose\n');
  console.log('  Then untick and Run again to compare against the full width.\n');
  console.log('  Pyodide still comes from the CDN, so this needs internet the');
  console.log('  first time the engine runs. Ctrl-C to stop.\n');
});
