// QA for the level widget's trace, driven through the real UI.
//
//   npm run dev -- --port 5178 --strictPort     # in one shell
//   python3 scripts/trace-fixtures.py           # once, or after a payload change
//   npm run qa:trace                            # in another
//
//
// The Pyodide CDN is blocked by the environment's proxy, so the engine cannot
// run in this browser. Everything else is real: the real page, the real
// component, and payloads captured from the real engine (fixtures.py calls the
// same bridge functions exact-worker.js calls). Only the worker is a stand-in,
// and it replies with those payloads byte for byte -- including band spelled
// "vertical"/"horizontal", which is the shape that broke the first version.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const FIXTURES = `${ROOT}node_modules/.cache/trace-fixtures.json`;
let fixtures;
try {
  fixtures = JSON.parse(readFileSync(FIXTURES, 'utf8'));
} catch {
  console.error(`Missing ${FIXTURES}\nRun: python3 scripts/trace-fixtures.py`);
  process.exit(2);
}
const URL_BASE = process.env.QA_URL || 'http://localhost:5178/Scoubidou3D/mxn/';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const failedUrls = [];
page.on('requestfailed', r => failedUrls.push(`${r.url()} (${r.failure()?.errorText})`));

// Stand in for exact-worker.js, before any page script runs.
await page.addInitScript(({ result, traces }) => {
  const posted = [];
  window.__posted = posted;
  window.Worker = class FakeWorker {
    constructor() { this.onmessage = null; }
    postMessage(data) {
      posted.push(data);
      const reply = (msg) => setTimeout(() => this.onmessage?.({ data: msg }), 30);
      if (data.type === 'generate') reply({ type: 'result', id: data.id, result });
      if (data.type === 'trace') {
        const t = traces[String(data.band).toLowerCase().startsWith('v') ? 'v' : 'h'];
        reply({ type: 'trace-ready', id: data.id, ...t });
      }
    }
    terminate() {}
  };
}, fixtures);

await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.run-button', { timeout: 20000 });

// ---- run ----
await page.click('.run-button');
await page.waitForSelector('.diagram-card', { timeout: 20000 });
const cards = await page.$$('.diagram-card');
ok('a run renders one card per level', cards.length === 2, `${cards.length} cards`);

// ---- every level has its own widget ----
const heads = await page.$$('.level-widget-head');
ok('every level card carries a widget', heads.length === cards.length, `${heads.length} widgets`);

// ---- open L1 ----
const l1 = page.locator('.diagram-card', { hasText: 'L1' }).first();
await l1.locator('.level-widget-head').click();
await page.waitForSelector('.trace-panel canvas', { timeout: 20000 });
ok('opening the widget shows the trace (band key round-trips)', true);

const askedFor = await page.evaluate(() => window.__posted.filter(m => m.type === 'trace'));
ok('opening asked the worker for one trace', askedFor.length === 1,
   JSON.stringify(askedFor));
ok('it asked for the v band by default', askedFor[0]?.band === 'v', askedFor[0]?.band);

// ---- the canvas actually drew something ----
const painted = await page.evaluate(() => {
  const cv = document.querySelector('.trace-panel canvas');
  const ctx = cv.getContext('2d');
  const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4 * 97) {
    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  }
  return { colours: seen.size, w: cv.width, h: cv.height };
});
ok('the census is drawn, not blank', painted.colours > 5, `${painted.colours} distinct colours`);

// ---- the cell under the cursor is the combo the level adopted ----
const caption = async () => page.evaluate(() => {
  const cv = document.querySelector('.trace-panel canvas');
  return cv.__lastCaption ?? null;
});
const note = await page.locator('.trace-note').first().innerText();
ok('the note states the layout for this P', /441 combos, drawn 21×21/.test(note), note.slice(0, 90));

// ---- clicking a cell selects that combo ----
// Grid origin is (400, 34) in canvas pixels, cell is clamped; read it back from
// the note's own numbers and the canvas scale.
// The drawing publishes the layout it used, so the test addresses a cell
// without re-deriving metrics that live in the component.
const geom = await page.evaluate(() => {
  const cv = document.querySelector('.trace-panel canvas');
  const r = cv.getBoundingClientRect();
  return {
    left: r.left, top: r.top, cssW: r.width, cssH: r.height,
    backingW: cv.width, backingH: cv.height,
    dpr: Math.min(3, window.devicePixelRatio || 1),
    gridX: +cv.dataset.gridX, gridY: +cv.dataset.gridY, cell: +cv.dataset.cell,
    cols: +cv.dataset.cols, rows: +cv.dataset.rows,
  };
});
const CELL = geom.cell;
const clickCell = async (col, row) => {
  // The canvas draws in CSS pixels now, so its own coordinates are the page's.
  await page.mouse.click(geom.left + geom.gridX + col * CELL + CELL / 2,
                         geom.top + geom.gridY + row * CELL + CELL / 2);
  await page.waitForTimeout(60);
};
// row 17, col 19 is combo index 376 -> extensions (170, 190)
await clickCell(19, 17);
// Where did the red cursor box end up? Find its bounding box in canvas pixels
// and map it back to a cell: that is place() and unplace() agreeing through the
// renderer and the hit test, which is the pair check:trace pins down in theory.
const cursorCell = async () => page.evaluate(({ cell, gridX, gridY }) => {
  const cv = document.querySelector('.trace-panel canvas');
  // getImageData is in backing-store pixels; the drawing is in CSS pixels.
  const dpr = cv.width / cv.getBoundingClientRect().width;
  const { data } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
  let minX = 1e9, minY = 1e9;
  for (let y = 0; y < cv.height; y += 1) {
    for (let x = Math.floor(gridX * dpr); x < cv.width; x += 1) {
      const i = (y * cv.width + x) * 4;
      if (data[i] === 198 && data[i + 1] === 60 && data[i + 2] === 40) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
      }
    }
  }
  if (minX === 1e9) return null;
  return { col: Math.round((minX / dpr + 1 - gridX) / cell),
           row: Math.round((minY / dpr + 1 - gridY) / cell) };
}, { cell: CELL, gridX: geom.gridX, gridY: geom.gridY });
const landed = await cursorCell();
ok('clicking a cell moves the cursor to that cell',
   landed && landed.col === 19 && landed.row === 17, JSON.stringify(landed));

// ---- the legend filter dims ----
const dimCount = () => page.evaluate(() => {
  // #e6e1d4 is the dimmed cell. Count them across the grid rather than sampling
  // one pixel: filtering to ORDER leaves ORDER cells untouched, so a single
  // sample can sit on the one verdict that never changes.
  const cv = document.querySelector('.trace-panel canvas');
  const dpr = cv.width / cv.getBoundingClientRect().width;
  const { data } = cv.getContext('2d').getImageData(
    Math.round(+cv.dataset.gridX * dpr), Math.round(+cv.dataset.gridY * dpr),
    Math.round(+cv.dataset.cols * +cv.dataset.cell * dpr),
    Math.round(+cv.dataset.rows * +cv.dataset.cell * dpr));
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 230 && data[i + 1] === 225 && data[i + 2] === 212) n += 1;
  }
  return n;
});
const dimBefore = await dimCount();
await page.locator('.trace-legend button', { hasText: 'ORDER' }).first().click();
await page.waitForTimeout(120);
const dimAfter = await dimCount();
ok('a legend filter dims the cells that ended elsewhere', dimAfter > dimBefore + 1000,
   `${dimBefore} -> ${dimAfter} dimmed pixels`);
await page.locator('.trace-legend button', { hasText: 'ORDER' }).first().click();
await page.waitForTimeout(120);
ok('unfiltering restores them', Math.abs((await dimCount()) - dimBefore) < 50);

// ---- H/V switch asks for the other band ----
await page.locator('.trace-head button', { hasText: /^H$/ }).first().click();
await page.waitForTimeout(200);
const asked2 = await page.evaluate(() => window.__posted.filter(m => m.type === 'trace').map(m => m.band));
ok('H switches band and asks once for it', asked2.join(',') === 'v,h', asked2.join(','));
const noteH = await page.locator('.trace-note').first().innerText();
ok('the H band renders its own P = 1 layout', /21 combos, drawn 21×1/.test(noteH), noteH.slice(0, 80));

// ---- reopening does not re-ask ----
await l1.locator('.level-widget-head').click();          // close
await page.waitForTimeout(80);
await l1.locator('.level-widget-head').click();          // open again
await page.waitForSelector('.trace-panel canvas', { timeout: 10000 });
const asked3 = await page.evaluate(() => window.__posted.filter(m => m.type === 'trace').length);
ok('a cached band is not traced twice', asked3 === 2, `${asked3} requests`);

// ---- L0 explains itself instead of spinning ----
const l0 = page.locator('.diagram-card').first();
await l0.locator('.level-widget-head').click();
await page.waitForTimeout(150);
const l0text = await l0.locator('.level-widget-body').innerText();
ok('L0 says why it has no census', /starting stitch/i.test(l0text), l0text.slice(0, 80));
const askedAfterL0 = await page.evaluate(() => window.__posted.filter(m => m.type === 'trace').length);
ok('L0 does not ask for a trace', askedAfterL0 === 2, `${askedAfterL0} requests`);

// ---- layout: no card overlaps another ----
const boxes = await page.$$eval('.diagram-card', els => els.map(e => {
  const r = e.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}));
let overlaps = 0;
for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
  const A = boxes[a], B = boxes[b];
  if (A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h) overlaps += 1;
}
ok('no level card overlaps another', overlaps === 0, `${overlaps} overlaps`);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
ok('no horizontal overflow', !overflow);

// ---- the widget opens to the right of the diagram, not under it ----
const sides = await page.evaluate(() => {
  const card = document.querySelector('.diagram-card:has(.trace-panel)');
  const main = card.querySelector('.level-main').getBoundingClientRect();
  const wid = card.querySelector('.level-widget').getBoundingClientRect();
  return {
    mainRight: Math.round(main.right), widgetLeft: Math.round(wid.left),
    mainTop: Math.round(main.top), widgetTop: Math.round(wid.top),
    widgetW: Math.round(wid.width),
  };
});
ok('the widget sits to the right of the diagram',
   sides.widgetLeft >= sides.mainRight - 2, JSON.stringify(sides));
ok('and starts level with it, not below',
   Math.abs(sides.widgetTop - sides.mainTop) < 4,
   `main ${sides.mainTop} vs widget ${sides.widgetTop}`);

// ---- crisp: the backing store matches CSS pixels times the device ratio ----
const crisp = await page.evaluate(() => {
  const cv = document.querySelector('.trace-panel canvas');
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  return { cssW: Math.round(r.width), backingW: cv.width,
           want: Math.round(r.width * dpr), dpr };
});
ok('the canvas is not resampled (backing store = CSS x DPR)',
   Math.abs(crisp.backingW - crisp.want) <= 1, JSON.stringify(crisp));

// ---- 30% smaller than the old fixed design ----
ok('the drawing is 30% under the old 1120px design',
   crisp.cssW <= 784 + 1, `${crisp.cssW}px`);

// ---- the trace card is full width ----
const traceCardW = await page.$eval('.diagram-card:has(.trace-panel)', e => Math.round(e.getBoundingClientRect().width));
ok('the tracing card takes the whole row', traceCardW > 1000, `${traceCardW}px`);

await page.screenshot({ path: `${ROOT}node_modules/.cache/qa-trace.png`, fullPage: true });
// The page counts visits through gc.zgo.at, which this environment's proxy
// refuses. That is the sandbox, not the lab, so it is named and excused rather
// than allowed to mask a real error.
const OFFSITE = /gc\.zgo\.at|cdn\.jsdelivr\.net/;
const real = errors.filter(e => !OFFSITE.test(e) && !/Failed to load resource/.test(e));
ok('no page errors', real.length === 0, real.slice(0, 3).join(' | '));
const blocked = failedUrls.filter(u => !OFFSITE.test(u));
ok('nothing the lab needs failed to load', blocked.length === 0, blocked.join(', '));
if (failedUrls.length) console.log('  note: offsite blocked by the sandbox —', failedUrls.join(', '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
