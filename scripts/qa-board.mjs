// QA for the k boards at /mxn/ks/<k>/, driven against a stubbed shelf.
//
//   npm run dev -- --port 5179 --strictPort     # in one shell
//   npm run qa:board                            # in another
//
// The real page, with the Worker replaced by a route handler that answers out
// of `mocks/fixtures/fit-l1.json` — real engine strands, so what the tiles draw
// is a ring rather than a shape invented for a test. Nothing here needs Pyodide
// and nothing here computes: the board never does either.
//
// What this covers that `npm run check:board` cannot, because the ladder is
// checked in node and the page is not: that a ★ best actually reaches the
// screen as the drawn tile, that the engine's rival answer is still visible on
// the same cell, that a hole is a link to /mxn/fit/ carrying the right
// parameters, that an inadmissible tile is NOT a link, and that a file dropped
// through the file input lands on its cell.
//
// The stub serves `identity` bytes — plain JSON with no x-mxn-codec header —
// which cache.ts's decode() accepts. Gzip is what the Worker does; being able
// to read both is the point of the header existing.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = `${ROOT}node_modules/.cache`;
const BASE = process.env.QA_URL || 'http://localhost:5179/Scoubidou3D';
mkdirSync(SHOTS, { recursive: true });

const K = -1;
const API = 'https://qa.invalid';

const fixture = JSON.parse(readFileSync(`${ROOT}mocks/fixtures/fit-l1.json`, 'utf8'));
const sample = Object.values(fixture.sizes)[0];
const STRANDS = sample.stages[0].strands;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

// --- the stubbed shelf -----------------------------------------------------
//
// 3x2 has BOTH a ★ best and an engine run — the cell the whole page is about.
// 4x4 has only a run. 2x2 has only a ✗. Everything else is a hole, and 1x1 is
// inadmissible at k = -1 (it admits 0…1).

const flags = 's1-eauto-b400000';
const picksKey = (m, n) => `picks/v3/lh-cw/${m}x${n}/${K}/${flags}`;
const runKey = (m, n) => `run/v3/lh-cw/${m}x${n}/${K}/s1-e5-b100000000`;

const judgement = (verdict, chooser, at, withRing = true) => ({
  id: `${verdict}-${at}`, verdict, source: 'fitter', chooser, at,
  levels: [{ level: 1, h: { ext: [40, 10], angle: -172.5 }, v: { ext: [20], angle: 8.25 } }],
  audit: { crossings: 8, expected: 8, stray: 0, broken: 0 },
  ...(withRing ? { strands: STRANDS } : {}),
});

const picksBody = (m, n, judgements) => ({
  kind: 'picks', cacheVersion: 'v3',
  descriptor: { m, n, ks: [K], hand: 'lh', direction: 'cw',
                shortArms: true, step: 'auto', budget: 400000 },
  judgements,
});

const runBody = (m, n) => ({
  kind: 'run', cacheVersion: 'v3',
  descriptor: { m, n, ks: [K], hand: 'lh', direction: 'cw',
                shortArms: true, step: 5, budget: 100000000 },
  computedAt: '2026-08-16T00:00:00Z', seconds: 91,
  result: {
    rows: [{ level: 1, k: K, ext: [[60, 40], [60]], gap: [12, 9],
             across: 8, expected: 8, masks: 2, healthy: true }],
    stages: [{ level: 1, k: K, label: 'engine', strands: STRANDS }],
  },
});

const PICKS = {
  [picksKey(3, 2)]: picksBody(3, 2, [judgement('best', 'yonatan', '2024-01-01T00:00:00Z')]),
  [picksKey(2, 1)]: picksBody(2, 1, [judgement('valid', 'yonatan', '2026-05-05T00:00:00Z')]),
  [picksKey(2, 2)]: picksBody(2, 2, [judgement('rejected', 'yonatan', '2026-06-06T00:00:00Z', false)]),
};
const RUNS = { [runKey(3, 2)]: runBody(3, 2), [runKey(4, 4)]: runBody(4, 4) };

const stamped = key => ({ key, bytes: 4096, computedAt: '2026-08-16T00:00:00Z' });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });

await page.route('**/*', async route => {
  const url = route.request().url();
  if (!url.startsWith(API)) return route.fallback();
  const path = url.slice(API.length);
  const json = body => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
  if (path.startsWith('/catalogue')) {
    const prefix = new URL(url).searchParams.get('prefix') ?? '';
    const keys = [...Object.keys(PICKS), ...Object.keys(RUNS)].filter(k => k.startsWith(prefix));
    return json({ store: 'r2', truncated: false, entries: keys.map(stamped) });
  }
  const key = decodeURIComponent(path.replace(/^\/cache\//, ''));
  const body = PICKS[key] ?? RUNS[key];
  return body ? json(body) : route.fulfill({ status: 404, body: '{}' });
});

// The page's own default Worker is the real one; ?cache= is how every page in
// this suite is pointed somewhere else.
await page.goto(`${BASE}/mxn/ks/${K}/?cache=${encodeURIComponent(API)}`,
  { waitUntil: 'networkidle' });

// readCacheBase() reads the host's data-cache attribute, and ?cache= is the
// lab's override. Set the field directly if the query did not take.
const shownBase = await page.inputValue('.board-field input[placeholder*="workers.dev"]')
  .catch(() => '');
if (shownBase !== API) {
  await page.fill('.board-field input[placeholder*="workers.dev"]', API);
  await page.click('.board-go:has-text("reload")');
}
await page.waitForFunction(() => document.querySelectorAll('.board-tile.is-best').length > 0,
  null, { timeout: 20000 });
await page.waitForTimeout(1200);

console.log(`k = ${K} board, stubbed shelf\n`);

// --- what the tiles say ----------------------------------------------------

const tiles = await page.evaluate(() => {
  const read = node => ({
    className: node.className,
    text: node.textContent.replace(/\s+/g, ' ').trim(),
    href: node.getAttribute('href'),
    tag: node.tagName,
    canvases: node.querySelectorAll('canvas').length,
  });
  return [...document.querySelectorAll('.board-tile')].map(read);
});
const tileFor = (m, n) => tiles.find(t => t.text.startsWith(`${m}×${n}`));

ok('the board draws all 64 sizes', tiles.length === 64, `${tiles.length} tiles`);

{
  const cell = tileFor(3, 2);
  ok('a cell with BOTH a ★ best and an engine run draws the ★ best',
    cell?.className.includes('is-best'), cell?.className);
  ok('and it carries the chooser rather than the engine\'s figures',
    cell?.text.includes('yonatan'), cell?.text);
  ok('and it is marked as having beaten a run the engine had already done',
    cell?.text.includes('·↑'), cell?.text);
  ok('the ★ best tile actually draws its ring', cell?.canvases === 1,
    `${cell?.canvases} canvas`);
}

ok('a ✓ valid with no ★ best fills its tile', tileFor(2, 1)?.className.includes('is-valid'),
  tileFor(2, 1)?.className);
ok('a cell the engine alone holds is drawn as the engine\'s',
  tileFor(4, 4)?.className.includes('is-engine'), tileFor(4, 4)?.className);
ok('a cell with nothing but a ✗ is marked rejected, not left empty',
  tileFor(2, 2)?.className.includes('is-rejected'), tileFor(2, 2)?.className);

// --- absence, which is what a board is mostly made of ----------------------

{
  const outside = tileFor(1, 1);
  ok('1x1 is hatched at k = -1 rather than drawn as a hole',
    outside?.className.includes('is-outside'), outside?.className);
  ok('and an inadmissible tile is NOT a link — there is nothing to fit there',
    outside?.tag === 'DIV' && !outside?.href, `<${outside?.tag}> href=${outside?.href}`);
  ok('it says which k that size does admit', outside?.text.includes('0…1'), outside?.text);
}

{
  const hole = tileFor(5, 5);
  ok('an empty admissible tile is a link to the fitter',
    hole?.tag === 'A' && hole?.href?.includes('/mxn/fit/'), hole?.href);
  ok('carrying that cell\'s own m, n and k',
    hole?.href?.includes('m=5') && hole?.href?.includes('n=5')
    && hole?.href?.includes('ks=-1'), hole?.href);
}

// --- the tally and the cell panel -----------------------------------------

// Read the number and the label apart rather than off one string: the markup
// puts them in sibling elements with no whitespace between, so a text match
// would be asserting about the CSS.
const tally = await page.evaluate(() =>
  [...document.querySelectorAll('.board-tally li')].map(li => ({
    count: li.querySelector('b')?.textContent.trim(),
    label: li.querySelector('span')?.textContent.replace(/\s+/g, ' ').trim(),
  })));
const counted = label => tally.find(row => row.label?.startsWith(label))?.count;
const summary = tally.map(row => `${row.count} ${row.label}`).join(' | ');
ok('the tally reports the one cell where a hand beat the engine',
  counted('where a hand beat') === '1', summary);
// Four cells hold something (3x2 ★, 2x1 ✓, 4x4 engine, 2x2 ✗) out of the 63
// sizes that admit k = -1, so 59 are holes and 1x1 is not one of them.
ok('and counts the holes apart from the sizes that cannot hold this k',
  counted('holes') === '59' && counted('sizes that cannot') === '1', summary);
ok('a rejected cell is counted as tried, not as untouched',
  counted('tried and ruled out') === '1', summary);

await page.click('.board-tile.is-best');
await page.waitForTimeout(400);
const panel = await page.evaluate(() => {
  const entries = [...document.querySelectorAll('.board-entry')];
  return {
    count: entries.length,
    kinds: entries.map(e => e.querySelector('header b')?.textContent.trim()),
    text: document.querySelector('.board-col:last-child .board-panel:last-child')
      ?.textContent.replace(/\s+/g, ' ').trim() ?? '',
  };
});
ok('opening the cell shows every answer for it, not just the winner',
  panel.count === 2, `${panel.count} entries: ${panel.kinds.join(', ')}`);
ok('with the person\'s first and the engine\'s second',
  panel.kinds[0]?.includes('best') && panel.kinds[1]?.includes('engine'),
  panel.kinds.join(' then '));
ok('and the cell says which k that size admits',
  panel.text.includes('-4…5'), panel.text.slice(0, 120));

// --- a file off the reader's own machine -----------------------------------

const dropped = JSON.stringify(picksBody(6, 6,
  [judgement('best', 'from-a-file', '2020-01-01T00:00:00Z')])
  // The descriptor has to name the cell the file is about.
  , null, 1).replace('"m": 6', '"m": 6');
await page.setInputFiles('.board-field input[type="file"]', {
  name: 'my-picks.json', mimeType: 'application/json', buffer: Buffer.from(dropped),
});
await page.waitForTimeout(800);
const fromFile = await page.evaluate(() =>
  [...document.querySelectorAll('.board-tile')]
    .map(t => t.textContent.replace(/\s+/g, ' ').trim())
    .find(t => t.startsWith('6×6')));
ok('a picks file loaded from the machine fills its tile',
  fromFile?.includes('from-a-file'), fromFile);

const listed = await page.evaluate(() =>
  document.querySelector('.board-files li')?.textContent.replace(/\s+/g, ' ').trim() ?? '');
ok('and the file is listed with what was read out of it',
  listed.includes('my-picks.json') && listed.includes('picks artifact'), listed);

// --- the k strip -----------------------------------------------------------

const strip = await page.evaluate(() => ({
  count: document.querySelectorAll('.board-k').length,
  here: document.querySelector('.board-k.is-on')?.textContent.trim(),
  first: document.querySelector('.board-k')?.getAttribute('href'),
}));
ok('every k has a place on the strip', strip.count === 30, `${strip.count} boards`);
ok('and this one is held', strip.here === '-1', strip.here);
ok('the strip links sideways to the other boards', strip.first === '../-14/', strip.first);

await page.screenshot({ path: `${SHOTS}/qa-board.png`, fullPage: true });
console.log(`\n  shot: ${SHOTS}/qa-board.png`);

// --- the loop closed: a hole, followed, opens the fitter on that cell -------
//
// The half a link cannot prove on its own. /mxn/fit/ read no URL parameters at
// all before the boards existed, so an href that looks right and a page that
// ignores it would be a tile that quietly sends everybody to 2x1 k=1.

{
  const href = await page.getAttribute(
    '.board-tile.is-hole:not(.is-rejected)', 'href');
  const opened = await browser.newPage();
  await opened.goto(new URL(href, BASE + '/').toString(), { waitUntil: 'domcontentloaded' });
  await opened.waitForSelector('.seg button', { timeout: 20000 });
  await opened.waitForTimeout(1500);
  const form = await opened.evaluate(() => ({
    m: document.querySelector('#fit-m')?.value,
    n: document.querySelector('#fit-n')?.value,
    ks: document.querySelector('#fit-ks')?.value,
    pressed: [...document.querySelectorAll('.seg button')]
      .filter(b => b.getAttribute('aria-pressed') === 'true')
      .map(b => b.textContent.trim()).join(' '),
  }));
  const wanted = new URL(href, 'http://x/').searchParams;
  ok('following a hole opens the fitter already on that cell',
    form.m === wanted.get('m') && form.n === wanted.get('n')
    && form.ks === wanted.get('ks'),
    `${form.m}×${form.n} ks ${form.ks} vs ${wanted.get('m')}×${wanted.get('n')} ks ${wanted.get('ks')}`);
  ok('with the hand and direction the board was filtered to',
    form.pressed === 'LH CW', form.pressed);
  await opened.close();
}

await browser.close();
console.log(`\n${fail ? `${fail} check(s) failed, ${pass} passed`
                      : `all ${pass} checks passed`}`);
process.exit(fail ? 1 : 0);
