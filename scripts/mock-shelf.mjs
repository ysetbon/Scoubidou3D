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
// The 3×1 pick is copied from the public Cloudflare shelf when it is reachable,
// including the judged strands. Cache reads are public, so this needs no token.
// Offline, it falls back to the committed 8/12 engine ring and labels it as a
// mock fixture — never as Yonatan's 12/12 ring.
//
// Needs Node 22+ for node:sqlite.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

// fileURLToPath, not `.pathname`: on Windows a file URL's pathname is
// "/C:/Users/..." and joining that onto anything gives "C:\C:\Users\...",
// which is what the first person to run this on Windows got. Every path below
// goes through join() for the same reason.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE_DIR = join(ROOT, 'node_modules', '.cache');
const PORT = Number(process.env.MOCK_PORT || 5175);
const TOKEN = 'mock-token-long-enough-to-be-a-token';
// A judgement can change while retaining the same shelf key. Give every mock
// process a fresh API origin-path so a browser that cached yesterday's local
// pick cannot answer before this server sees the request.
const API_PATH = `/api-${process.pid}-${Date.now().toString(36)}`;
mkdirSync(CACHE_DIR, { recursive: true });

if (!existsSync(join(ROOT, 'dist', 'mxn', 'index.html'))) {
  console.error('No build yet. Run:  npm run build');
  process.exit(2);
}

// What to seed. The real shelf is the source of truth for the judged 3×1 ring;
// the committed fixture keeps the mock usable offline. The 2×1 entry
// deliberately has only a placeholder ring, so it exercises the refusal path.
const judged31 = JSON.parse(
  readFileSync(join(ROOT, 'mocks', 'fixtures', 'judged-3x1-k-1.json'), 'utf8'));
const PUBLIC_SHELF = (process.env.MOCK_PICKS_URL
  || 'https://mxn-solutions-api.ysetbon.workers.dev').replace(/\/+$/, '');
const PICK31_KEY = 'v3/lh-cw/3x1/-1/s1-eauto-b400000';

const fixtureJudgement = {
  id: 'mock-3x1--1', verdict: 'best', source: 'mock',
  chooser: 'mock fixture (not yonatan)', at: '2026-08-16T00:00:00Z',
  levels: [{ level: 1, h: { ext: judged31.hExt, angle: null },
             v: { ext: judged31.vExt, angle: null } }],
  audit: {
    crossings: judged31.across, expected: judged31.expected,
    stray: 2, broken: 0,
  },
  strands: judged31.strands,
};

async function publicBest31() {
  const response = await fetch(`${PUBLIC_SHELF}/cache/picks/${PICK31_KEY}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
  }
  const artifact = JSON.parse(bytes.toString('utf8'));
  const judgement = artifact.judgements?.find(item => item.verdict === 'best');
  const level = judgement?.levels?.find(item => item.level === 1);
  if (!judgement || !level || !judgement.strands?.length) {
    throw new Error('the ★ best is absent or carries no ring');
  }
  return judgement;
}

let judged31Best;
try {
  judged31Best = await publicBest31();
  console.log(`  fetched public ★ best  3×1 k=-1  by ${judged31Best.chooser}`
    + `  (${judged31Best.strands.length} strands)`);
} catch (error) {
  judged31Best = fixtureJudgement;
  console.warn(`  public ★ best unavailable (${error instanceof Error ? error.message : error})`);
  console.warn(`  using committed mock fixture ${judged31.across}/${judged31.expected}`
    + ' — this is NOT Yonatan’s ring');
}

const PICKS = [
  { m: 3, n: 1, k: -1, judgement: judged31Best },
  { m: 2, n: 1, k: -1, judgement: {
    id: 'mock-2x1--1', verdict: 'best', source: 'mock',
    chooser: 'mock refusal fixture', at: '2026-08-16T00:00:00Z',
    levels: [{ level: 1, h: { ext: [0], angle: null },
               v: { ext: [30, 80], angle: null } }],
    audit: { crossings: 8, expected: 8, stray: 0, broken: 0 },
    strands: [{ type: 'Strand', layer_name: '1_4',
      start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, width: 46,
      color: { r: 120, g: 120, b: 220 },
      stroke_color: { r: 0, g: 0, b: 0 }, stroke_width: 4 }],
  } },
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
for (const { m, n, k, judgement } of PICKS) {
  const key = `v3/lh-cw/${m}x${n}/${k}/s1-eauto-b400000`;
  const level = judgement.levels.find(item => item.level === 1);
  const ext = [level.h.ext, level.v.ext];
  const strands = judgement.strands;
  const artifact = {
    kind: 'picks', cacheVersion: 'v3',
    descriptor: { m, n, ks: [k], hand: 'lh', direction: 'cw',
                  shortArms: true, step: 'auto', budget: 400000 },
    judgements: [judgement],
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
  console.log(`  seeded ★ best  ${m}×${n} k=${k}  by ${judgement.chooser}`
    + `  reach ${Math.max(...ext.flat())}  (${strands.length} strands)`);
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
  if (url.pathname.startsWith(API_PATH)) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const init = { method: request.method, headers: request.headers };
    if (chunks.length) init.body = Buffer.concat(chunks);
    const reply = await api(`${url.pathname.slice(API_PATH.length) || '/'}${url.search}`, init);
    const headers = Object.fromEntries(reply.headers);
    headers['cache-control'] = 'no-store';
    response.writeHead(reply.status, headers);
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
  const query = new URLSearchParams({
    cache: `http://localhost:${PORT}${API_PATH}`,
    m: '3',
    n: '1',
    ks: '-1 -1 -1',
    pick: '1',
    reach: '1',
    run: '0',
    advanced: '1',
  });
  console.log(`\n  mock shelf up on :${PORT}\n`);
  console.log(`    ${base}/?${query}\n`);
  console.log('  The link loads M 3, N 1, KS -1 -1 -1, opens ADVANCED SEARCH,');
  console.log('  sizes from the judged ★ best, and lets each deeper level stop at');
  console.log("  the largest extension the finished level immediately below used.");
  console.log('  Just press RUN — the sidebar says which grid it chose.\n');
  console.log('  Then untick and Run again to compare against the full width.\n');
  console.log('  Pyodide still comes from the CDN, so this needs internet the');
  console.log('  first time the engine runs. Ctrl-C to stop.\n');
});
