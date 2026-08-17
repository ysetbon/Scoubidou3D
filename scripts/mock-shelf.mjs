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
// [h_extensions, v_extensions] exactly as the board shows them. `strands`
// makes the pick's ring REAL, which is what lets /mxn/ adopt it as level 1
// instead of searching: mocks/fixtures/judged-3x1-k-1.json is an actual
// engine ring for this size (committed, like fit-l1.json beside it). The
// 2×1 entry deliberately has only a placeholder ring, so it exercises the
// other path — the engine refuses the adoption and searches, and says so.
const judged31 = JSON.parse(
  readFileSync(join(ROOT, 'mocks', 'fixtures', 'judged-3x1-k-1.json'), 'utf8'));
const PICKS = [
  { m: 3, n: 1, k: -1, chooser: 'yonatan',
    ext: [judged31.hExt, judged31.vExt], strands: judged31.strands },
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
      // D1 numbers its placeholders — `?1, ?2, …` — and whether node:sqlite
      // understands that depends on the Node minor: 22.14 throws "column index
      // out of range" where 22.22 binds it fine. The shim owes the Worker
      // whatever D1 accepts, so numbered placeholders are rewritten to the
      // anonymous kind every version binds, and the args reordered to match
      // their occurrence order (which also handles a repeated ?N by
      // duplicating that arg).
      const order = [];
      const anon = sql.replace(/\?(\d+)/g, (_, num) => {
        order.push(Number(num) - 1);
        return '?';
      });
      const remap = args => order.length ? order.map(at => args[at]) : args;
      sql = anon;
      const make = args => ({
        bind: (...next) => make(remap(next.map(v => v === undefined ? null : v))),
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
for (const { m, n, k, chooser, ext, strands } of PICKS) {
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
      // The real ring when the entry carries one; a placeholder otherwise —
      // drawable, but not adoptable, which the engine detects and reports.
      strands: strands ?? [{ type: 'Strand', layer_name: '1_4',
                  start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, width: 46,
                  color: { r: 120, g: 120, b: 220 },
                  stroke_color: { r: 0, g: 0, b: 0 }, stroke_width: 4 }],
    }],
  };
  const reply = await api(`/cache/picks/${key}`, {
    method: 'PUT', body: gzipSync(Buffer.from(JSON.stringify(artifact))),
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Mxn-Codec': 'gzip' },
  });
  // Fatal, and loud. A mock that seeds nothing still serves a working page —
  // it just reports "no ★ best" for every size, which reads as a finding about
  // your shelf rather than as this script having failed. That happened.
  if (reply.status !== 201) {
    console.error(`\n  FAILED to seed ${m}×${n} k=${k}: HTTP ${reply.status}`);
    console.error(`  ${(await reply.text()).slice(0, 600)}\n`);
    console.error(`  node ${process.version}. This runs the real Worker over`);
    console.error('  node:sqlite, which is experimental and has changed across');
    console.error('  the 22.x line — if the message above is about SQL or a');
    console.error('  parameter, that is very likely the cause. Please paste it.\n');
    process.exit(1);
  }
  console.log(`  seeded ★ best  ${m}×${n} k=${k}  reach ${Math.max(...ext.flat())}`
    + (strands ? `  with its real ring (${strands.length} strands — L1 will be adopted)`
               : '  placeholder ring only (L1 will be searched, and the run says why)'));
}

// And read one back, because a 201 is the Worker saying it accepted the bytes,
// not the shelf saying it holds them.
{
  const listed = await (await api('/catalogue?prefix=picks/')).json();
  const count = listed.entries?.length ?? 0;
  if (count !== PICKS.length) {
    console.error(`\n  Seeded ${PICKS.length} but the catalogue lists ${count}.`);
    console.error(`  ${JSON.stringify(listed).slice(0, 400)}\n`);
    process.exit(1);
  }
  console.log(`  catalogue lists all ${count} — the shelf is real\n`);
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
