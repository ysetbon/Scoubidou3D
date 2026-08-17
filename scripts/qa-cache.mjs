// QA for the precomputed-result cache, end to end.
//
//   python3 scripts/cache-fixtures.py    # once, or after an engine change
//   npm run build
//   npm run qa:cache
//
// Everything in this test is the real thing except Cloudflare. The Worker is
// worker-api/src/index.ts bundled and served over HTTP with node:sqlite behind
// its D1 binding; the site is the vite build out of dist/; the artifacts are
// what the engine actually produced for 2x2 ks 1 2 2; the browser is Chromium.
//
// What it is here to prove is the claim the whole cache rests on: that a page
// reading a stored answer shows the SAME thing a page that computed it would
// have, and shows it without waking the engine at all. So the assertions are on
// the oracle numbers from docs/mxn-lab.md — (40,10), (50,60), (60,50), every
// level a weave — and on there being no request to jsDelivr, which is the only
// way Pyodide can arrive. A cache that quietly served something else would pass
// a test that only checked that pictures appeared.
//
// Needs Node 22+ for node:sqlite. Shots land in node_modules/.cache/.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const ROOT = new URL('..', import.meta.url).pathname;
const CACHE_DIR = `${ROOT}node_modules/.cache`;
const FIXTURES = `${CACHE_DIR}/cache-fixtures`;
const PORT = Number(process.env.QA_PORT || 5199);
const TOKEN = 'qa-token-long-enough-to-be-a-token';
mkdirSync(CACHE_DIR, { recursive: true });

if (!existsSync(`${FIXTURES}/index.json`)) {
  console.error('No fixtures. Run: python3 scripts/cache-fixtures.py');
  process.exit(2);
}
if (!existsSync(`${ROOT}dist/mxn/index.html`)) {
  console.error('No build. Run: npm run build');
  process.exit(2);
}
const index = JSON.parse(readFileSync(`${FIXTURES}/index.json`, 'utf8'));

// ---- the Worker, with node:sqlite behind its D1 binding --------------------
execFileSync('npx', ['esbuild', 'worker-api/src/index.ts', '--bundle', '--format=esm',
  '--platform=node', `--outfile=${CACHE_DIR}/qa-worker.mjs`, '--log-level=warning'],
  { cwd: ROOT, stdio: 'inherit' });
const worker = (await import(`${CACHE_DIR}/qa-worker.mjs`)).default;

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(`${ROOT}worker-api/schema.sql`, 'utf8'));
const env = {
  ADMIN_TOKEN: TOKEN,
  ALLOWED_ORIGINS: `http://localhost:${PORT}`,
  CACHE_PUBLIC_READS: '1',
  DB: {
    prepare(sql) {
      const order = [];
      sql = sql.replace(/\?(\d+)/g, (_, num) => {
        order.push(Number(num) - 1);
        return '?';
      });
      const remap = args => order.length ? order.map(at => args[at]) : args;
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

// ---- seed the shelf --------------------------------------------------------
let seeded = 0;
async function put(key, file) {
  const body = gzipSync(readFileSync(`${FIXTURES}/${file}`));
  const response = await api(`/cache/${key}`, {
    method: 'PUT', body,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Mxn-Codec': 'gzip' },
  });
  if (response.status !== 201) throw new Error(`seeding ${key}: HTTP ${response.status}`);
  seeded += body.byteLength;
}
await put(`run/${index.key}`, index.run);
for (const [at, file] of Object.entries(index.traces)) {
  const [level, band] = at.split(':');
  await put(`trace/${index.key}/L${level}-${band}`, file);
}
console.log(`  seeded ${(seeded / 1024).toFixed(0)} kB of artifacts`);

// ---- one server: /api is the Worker, everything else is dist/ --------------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.py': 'text/plain',
};
const server = createServer(async (request, response) => {
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
  let path = join(`${ROOT}dist`, url.pathname.replace(/^\/Scoubidou3D/, ''));
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) { response.writeHead(404); response.end('not built'); return; }
  response.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
  response.end(readFileSync(path));
});
await new Promise(resolve => server.listen(PORT, resolve));

let pass = 0, fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

// Proxy-blind on purpose: in a sandboxed container an outbound proxy refuses
// CONNECT for localhost too, and every asset the QA needs is served from here.
const browser = await chromium.launch({ args: ['--no-proxy-server'] });
const base = `http://localhost:${PORT}/Scoubidou3D`;
const cacheArg = `cache=http://localhost:${PORT}/api`;

// Requests that leave this machine. The only one the site makes on its own is
// GoatCounter; Pyodide and NumPy come from jsDelivr, which is the whole point.
const offSite = url =>
  !url.includes(`localhost:${PORT}`) && !url.includes('zgo.at');

// ---- A · the lab, deep-linked, reading the shelf ---------------------------
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
  const errors = [];
  const external = [];
  const notFound = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (offSite(request.url())) external.push(request.url()); });
  page.on('response', reply => {
    if (reply.status() === 404) notFound.push(new URL(reply.url()).pathname);
  });

  const started = Date.now();
  await page.goto(`${base}/mxn/?${cacheArg}&m=2&n=2&ks=1%202%202`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.diagram-card', { timeout: 30000 });
  const elapsed = Date.now() - started;
  ok(`the cards land from the cache (${elapsed} ms)`, elapsed < 15000, `${elapsed} ms`);

  const levels = await page.$$eval('.diagram-card .level-title strong',
    nodes => nodes.map(node => node.textContent));
  ok('every stage is drawn',
    JSON.stringify(levels) === JSON.stringify(['L₀', 'L1', 'L2', 'L3']), JSON.stringify(levels));

  const chip = await page.$eval('.cache-chip', el => el.textContent);
  ok('and the page says so', /served from the cache/.test(chip), chip);

  // The oracle. A cache that served anything else would fail here.
  const ext = await page.$$eval('.exact-metrics .metric:nth-child(3) strong',
    nodes => nodes.map(node => node.textContent));
  ok('the extensions are the ones docs/mxn-lab.md pins',
    JSON.stringify(ext.slice(1)) === JSON.stringify(['(40, 10)', '(50, 60)', '(60, 50)']),
    JSON.stringify(ext));
  const corners = await page.$$eval('.canvas-corner', nodes => nodes.map(node => node.textContent));
  ok('and every level audits as a weave',
    corners.slice(1).every(corner => /· WEAVE$/.test(corner)), corners.join(' | '));

  // The browser's own run stops counting at 60,000 pairs, so a card reading an
  // exact 10,189 is a count only the farm could have finished.
  const nav = await page.$$eval('.solution-nav b', nodes => nodes.map(node => node.textContent));
  ok('the solution counts are exact rather than "2+"',
    nav.join(' ') === '1 / 10,189 1 / 2,297 1 / 2,298', nav.join(' '));

  ok('and Pyodide was never fetched', external.length === 0, external.slice(0, 3).join(', '));

  // ---- B · a level widget, also off the shelf ------------------------------
  await page.$$eval('.level-widget-head', nodes => nodes[3].click());
  await page.waitForSelector('.trace-panel, .trace-pending', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.trace-pending'),
    null, { timeout: 30000 });
  const status = await page.$eval('.engine-status', el => el.textContent);
  ok('a level census opens from the cache', /from the cache/.test(status), status);
  ok('still without the engine', external.length === 0, external.slice(0, 3).join(', '));
  ok('and the census panel drew its grid',
    await page.$('.trace-panel canvas') !== null);

  await page.screenshot({ path: `${CACHE_DIR}/qa-cache-lab.png` });
  // Nothing on this shelf has been judged, so the lab's picks read misses --
  // the ordinary state of a parameter set nobody has starred, exactly as a
  // missing run is (cache.ts). Chrome logs every failed fetch as a console
  // error, so the assertion below excuses a 404 and this one pins WHICH: a
  // miss on anything else is a real fault wearing the same clothes.
  ok('the only thing missing is judgements nobody has written',
    notFound.every(path => path.startsWith('/api/cache/picks/')), notFound.join(', '));
  ok('no page errors in the lab',
    errors.filter(error => !/ERR_|TUNNEL|404/.test(error)).length === 0,
    errors.slice(0, 3).join(' ~ '));
  await page.close();
}

// ---- A2 · same ks under other flags: the shelf variant is found and adopted -
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
  const external = [];
  page.on('request', request => { if (offSite(request.url())) external.push(request.url()); });
  // The shelf holds these ks at eauto-b400000 only. A reader asking at step 5,
  // budget 100000 misses that exact key — and must still get the stored answer,
  // with the step and budget fields updated to say what was actually loaded,
  // never a silent answer to a question the fields did not ask.
  await page.goto(`${base}/mxn/?${cacheArg}&m=2&n=2&ks=1%202%202&step=5&budget=100000`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.diagram-card', { timeout: 30000 });
  const chip = await page.$eval('.cache-chip', el => el.textContent);
  ok('a run stored under other flags is served', /served from the cache/.test(chip), chip);
  ok('still without the engine', external.length === 0, external.slice(0, 3).join(', '));
  const step = await page.$eval('#ext-step', el => el.value);
  const budget = await page.$eval('#combo-budget', el => el.value);
  ok('and the fields adopt what was loaded',
    step === 'auto' && budget === '400000', `step ${step} · budget ${budget}`);
  await page.close();
}

// ---- A3 · a person's ★ best, drawn in place of the engine's own pick ---------
//
// The rule the k boards are built around, on the page that draws the ring: a
// judgement outranks the run. Seeded under DIFFERENT search flags from the run
// on purpose -- the farm sweeps at one set and /mxn/fit/ always writes
// s1-eauto-b400000, and requiring them to match is exactly why a ★ best that
// was plainly visible at /mxn/ks/-1/ was invisible here.
{
  const run = JSON.parse(readFileSync(`${FIXTURES}/${index.run}`, 'utf8'));
  // A real ring, and visibly not L2's: L1's own strands, so a card drawing the
  // judgement instead of the run is telling the truth about geometry too.
  const judged = run.result.stages.find(stage => stage.level === 1).strands;
  const picks = {
    kind: 'picks', cacheVersion: 'v3',
    descriptor: { ...index.descriptor, step: 10 },
    judgements: [{
      id: 'qa-best', verdict: 'best', source: 'fitter', chooser: 'yonatan',
      at: '2026-08-16T00:00:00Z',
      levels: [{ level: 2, h: { ext: [70, 30], angle: -172.5 },
                 v: { ext: [20, 20], angle: 8.25 } }],
      audit: { crossings: 16, expected: 16, stray: 0, broken: 0 },
      strands: judged,
    }],
  };
  const body = gzipSync(Buffer.from(JSON.stringify(picks)));
  const seeding = await api('/cache/picks/v3/lh-cw/2x2/1_2_2/s1-e10-b400000', {
    method: 'PUT', body,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Mxn-Codec': 'gzip' },
  });
  ok('the shelf takes a picks artifact', seeding.status === 201, `HTTP ${seeding.status}`);

  const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
  const external = [];
  page.on('request', request => { if (offSite(request.url())) external.push(request.url()); });
  await page.goto(`${base}/mxn/?${cacheArg}&m=2&n=2&ks=1%202%202`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.judged-chip', { timeout: 30000 });

  const onCard = level => page.$eval(`.diagram-card:nth-child(${level + 1})`,
    card => ({
      chip: card.querySelector('.judged-chip b')?.textContent ?? null,
      button: card.querySelector('.judged-chip button')?.textContent ?? null,
      corner: card.querySelector('.canvas-corner').textContent,
      hExt: card.querySelector('.exact-metrics .metric:nth-child(3) strong').textContent,
      crossings: card.querySelector('.exact-metrics .metric:nth-child(2) strong').textContent,
      strip: [...card.querySelectorAll('.audit-strip span')].map(s => s.textContent),
      stale: !!card.querySelector('.solution-nav.is-stale'),
    }));

  const chips = await page.$$eval('.judged-chip', nodes => nodes.length);
  ok('exactly one card carries the judgement, and it is the level judged',
    chips === 1 && (await onCard(2)).chip === 'human pick', `${chips} chips`);

  const judgedCard = await onCard(2);
  ok('the ring on it is captioned as a person\'s, not as an audit',
    /^JUDGED BY YONATAN/.test(judgedCard.corner), judgedCard.corner);
  ok('the extensions under it are the JUDGEMENT\'s, not the run\'s',
    judgedCard.hExt === '(70, 30)', judgedCard.hExt);
  ok('the crossings are the ones the judgement carried',
    judgedCard.crossings === '16/16', judgedCard.crossings);
  ok('and what a judgement does not measure is a dash, never a zero',
    judgedCard.strip[0] === 'gap H/V\u2014' && judgedCard.strip[1] === 'within\u2014'
    && judgedCard.strip[2] === 'masks\u2014',
    judgedCard.strip.join(' | '));
  ok('the solution browser says its number is not the ring on screen',
    judgedCard.stale);
  ok('and no other level was touched',
    (await onCard(1)).hExt === '(40, 10)' && (await onCard(3)).hExt === '(60, 50)');
  ok('none of which woke the engine', external.length === 0,
    external.slice(0, 3).join(', '));

  // The rating dataset is about the run's own solutions. A judged ring carries
  // its own geometry and none of the audit row beside it, so banking it here
  // would file a person's ring under the engine's numbers.
  ok('and the star will not bank a judged ring as one of the run\'s solutions',
    await page.$eval('.diagram-card:nth-child(3) .save-solution',
      button => button.disabled));

  // The card itself rather than the viewport: what this section is about is
  // one card's chip, corner and numbers, and they are below the fold.
  await page.locator('.diagram-card:nth-child(3)')
    .screenshot({ path: `${CACHE_DIR}/qa-cache-picks.png` });

  // The engine's own answer, one press away and never hidden.
  await page.click('.diagram-card:nth-child(3) .judged-chip button');
  await page.waitForFunction(
    () => document.querySelector('.diagram-card:nth-child(3) .judged-chip b')
      ?.textContent !== 'human pick', null, { timeout: 5000 });
  const back = await onCard(2);
  ok('pressing engine puts the run\'s own ring and numbers back',
    back.hExt === '(50, 60)' && /WEAVE$/.test(back.corner)
    && back.strip[1] === 'within0',
    `${back.hExt} · ${back.corner} · ${back.strip[1]}`);
  ok('and the \u2605 best is offered rather than dropped',
    back.chip === '\u2605 best on the shelf' && back.button === '\u2605 best',
    `${back.chip} / ${back.button}`);

  await page.locator('.diagram-card:nth-child(3)')
    .screenshot({ path: `${CACHE_DIR}/qa-cache-picks-engine.png` });
  await page.close();
}

// ---- A4 · the reach cap is a different shelf, not a different view ----------
//
// The cap changes which ring a level settles on, so the one thing that must
// never happen is a run stored under it being served to a page that did not
// ask for it, or the other way round. The shelf here holds `2x2 [1,2,2]` at
// the ordinary flags only.
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
  const external = [];
  const asked = [];
  page.on('request', request => {
    if (offSite(request.url())) external.push(request.url());
    if (request.url().includes('/cache/run/')) asked.push(new URL(request.url()).pathname);
  });
  await page.goto(`${base}/mxn/?${cacheArg}&m=2&n=2&ks=1%202%202&reach=1`,
    { waitUntil: 'domcontentloaded' });
  // Attached rather than visible: the knob lives inside the collapsed
  // <details> for advanced search, which is where it belongs.
  await page.waitForSelector('#reach-cap', { state: 'attached', timeout: 20000 });
  ok('?reach=1 turns the cap on in the sidebar',
    await page.$eval('#reach-cap', box => box.checked));
  ok('and the run it looks for is the capped shelf, not the ordinary one',
    asked.some(path => path.endsWith('-r1')) && !asked.some(path => /b400000$/.test(path)),
    asked.join(', '));
  // Nothing capped is on this shelf, so the page must COMPUTE rather than
  // quietly serve the uncapped run sitting right next to it — which is the
  // whole reason findShelfVariant may vary a step but never this flag. Reaching
  // for Pyodide is the fallback working, not a fault.
  const chip = await page.$eval('.cache-chip', el => el.textContent);
  ok('a capped miss says miss instead of adopting the uncapped run',
    /computed here|nothing stored/.test(chip), chip);
  ok('and that is what sends it to the engine',
    external.some(url => url.includes('jsdelivr')), external.slice(0, 2).join(', '));
  await page.close();
}

{
  // And the default is still the default: no `reach` in the URL is the shelf
  // every key ever written lives on.
  const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
  const asked = [];
  page.on('request', request => {
    if (request.url().includes('/cache/run/')) asked.push(new URL(request.url()).pathname);
  });
  await page.goto(`${base}/mxn/?${cacheArg}&m=2&n=2&ks=1%202%202`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.diagram-card', { timeout: 30000 });
  await page.waitForSelector('#reach-cap', { state: 'attached', timeout: 20000 });
  ok('with no reach in the URL the cap is off',
    !(await page.$eval('#reach-cap', box => box.checked)));
  ok('and the ordinary key is what was asked for',
    asked.some(path => /b400000$/.test(path)) && !asked.some(path => path.endsWith('-r1')),
    asked.join(', '));
  await page.close();
}

// ---- C · the farm plans, queues and agrees with the Worker -----------------
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}/mxn/gpu/?${cacheArg}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.farm-panel', { timeout: 20000 });

  const planned = await page.$$eval('.farm-stats b', nodes => nodes.map(node => node.textContent));
  ok('the plan is counted before anything is queued',
    Number(planned[0].replace(/,/g, '')) > 0, planned.slice(0, 4).join(' | '));
  // Skips only exist when one typed range is asked to cover every size: the
  // default band-per-size mode never asks a size for a k it does not admit,
  // so an empty skip list there is correctness, not silence.
  await page.click('text=a range I type');
  await page.waitForSelector('.farm-skips li', { timeout: 10000 });
  const skips = await page.$$eval('.farm-skips li', nodes => nodes.map(node => node.textContent));
  ok('and ks outside a size\'s range are reported, not dropped in silence',
    skips.some(line => /valid range/.test(line)), JSON.stringify(skips));
  await page.click('text=the size’s own band');

  await page.fill('input[type="url"]', `http://localhost:${PORT}/api`);
  await page.fill('input[type="password"]', TOKEN);
  await page.click('text=Check the Worker');
  await page.waitForSelector('.farm-health, .farm-bad', { timeout: 15000 });
  const health = await page.$eval('.farm-health, .farm-bad', el => el.textContent);
  ok('the farm reaches the Worker', /^ok ·/.test(health), health);

  await page.click('text=Queue the plan');
  await page.waitForFunction(
    () => document.querySelectorAll('.farm-table tbody tr').length > 1, null, { timeout: 20000 });
  const rows = await page.$$eval('.farm-table tbody tr', nodes => nodes.length);
  const summary = await (await api('/farm/summary', {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })).json();
  ok('the queue fills, and the Worker agrees with the page',
    summary.summary.some(row => row.state === 'pending' && row.jobs === rows),
    `page ${rows} · worker ${JSON.stringify(summary.summary)}`);

  await page.screenshot({ path: `${CACHE_DIR}/qa-cache-farm.png` });
  ok('no page errors in the farm',
    errors.filter(error => !/ERR_|TUNNEL/.test(error)).length === 0, errors.slice(0, 3).join(' ~ '));
  await page.close();
}

// ---- D · with no cache configured, nothing changes -------------------------
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(`${base}/mxn/?cache=`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.run-button', { timeout: 20000 });
  ok('a page with no cache says nothing about one',
    await page.$('.cache-chip') === null);
  await page.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
