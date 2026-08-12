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
await page.addInitScript(({ result, traces, plans, weaves }) => {
  const posted = [];
  window.__posted = posted;
  window.Worker = class FakeWorker {
    constructor() { this.onmessage = null; }
    postMessage(data) {
      posted.push(data);
      const reply = (msg) => setTimeout(() => this.onmessage?.({ data: msg }), 30);
      if (data.type === 'generate') reply({ type: 'result', id: data.id, result });
      if (data.type === 'trace') {
        // Four kinds of reply, as the real worker sends them: the replay's own
        // candidates while it runs, the plan its band search hands over, the
        // census's progress from inside the sweep, and the census. Slower than
        // the other replies, so the pending sweep is on screen long enough to
        // be asserted about.
        const key = String(data.band).toLowerCase().startsWith('v') ? 'v' : 'h';
        const plan = plans[key];
        const ring = result.stages.find(s => s.level === data.level)?.strands ?? [];
        [0, 1, 2].forEach(i => setTimeout(() => this.onmessage?.({
          data: { type: 'candidate', id: data.id, level: data.level, k: 1,
                  phase: `${plan.band} candidate`, trace: plan.band,
                  completed: (i + 1) * 120, total: 441, valid: i,
                  extensions: [], strands: ring },
        }), 30 + i * 90));
        setTimeout(() => this.onmessage?.({
          data: { type: 'trace-plan-ready', id: data.id, ...plan },
        }), 520);
        [0.25, 0.5, 0.75].forEach((at, i) => setTimeout(() => this.onmessage?.({
          data: { type: 'trace-progress', id: data.id,
                  level: plan.level, band: plan.band, nAngles: plan.nAngles,
                  combos: plan.combos, combosDone: Math.round(plan.combos * at) },
        }), 580 + i * 60));
        setTimeout(() => this.onmessage?.({
          data: { type: 'trace-ready', id: data.id, ...traces[key] },
        }), 900);
      }
      if (data.type === 'trace-weave') {
        // A real woven ring for the strands; ext and angle echo the request so
        // the reply lands in the cache slot the panel is watching.
        const w = weaves[String(data.band).toLowerCase().startsWith('v') ? 'v' : 'h'];
        reply({ type: 'trace-weave-ready', id: data.id, ...w,
                ext: data.ext, angle: data.angle });
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

// ---- closed, the widget is already on the right, not underneath ----
const shut = await page.evaluate(() => {
  const card = [...document.querySelectorAll('.diagram-card')].find(c => /L1/.test(c.textContent));
  const main = card.querySelector('.level-main').getBoundingClientRect();
  const wid = card.querySelector('.level-widget').getBoundingClientRect();
  return {
    left: Math.round(wid.left), mainRight: Math.round(main.right),
    top: Math.round(wid.top), mainTop: Math.round(main.top),
    w: Math.round(wid.width), h: Math.round(wid.height),
    mainH: Math.round(main.height),
  };
});
ok('closed, the widget is right of the diagram', shut.left >= shut.mainRight - 2,
   JSON.stringify(shut));
ok('closed, it is a rail rather than a footer',
   shut.w < 60 && shut.h > shut.mainH * 0.8, `${shut.w}x${shut.h} vs main ${shut.mainH} tall`);

// ---- open L1 ----
const l1 = page.locator('.diagram-card', { hasText: 'L1' }).first();
await l1.locator('.level-widget-head').click();

// ---- while the census computes, the sweep animation is on screen ----
await page.waitForSelector('.trace-pending .trace-sweep', { timeout: 5000 });
await page.waitForTimeout(120);
const sweepInk = await page.evaluate(() => {
  const cv = document.querySelector('.trace-pending .trace-sweep');
  if (!cv) return -1;
  const { data } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
  let inked = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Anything that is not the paper colour is the animation drawing.
    if (data[i + 3] && !(data[i] === 244 && data[i + 1] === 240 && data[i + 2] === 230)) inked += 1;
  }
  return inked;
});
ok('tracing shows the sweep animation, not bare text', sweepInk > 500, `${sweepInk} inked px`);

// ---- and it draws from the first moment, not after the replay ----
// The replay relays its own candidates, so the widget is never a dead box: the
// engine's set colours are on the canvas before any plan exists.
const ringPixels = () => page.evaluate(() => {
  const cv = document.querySelector('.trace-pending .trace-sweep');
  if (!cv) return -1;
  const { data } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
  let ring = 0;
  for (let i = 0; i < data.length; i += 4) {
    // The V sets' indigos: a ring on the canvas rather than text and a bar.
    if ((data[i] === 61 && data[i + 1] === 58 && data[i + 2] === 140)
      || (data[i] === 123 && data[i + 1] === 113 && data[i + 2] === 214)) ring += 1;
  }
  return ring;
});
let replayInk = 0;
for (let i = 0; i < 40 && replayInk <= 200; i += 1) {
  replayInk = await ringPixels();
  if (replayInk <= 200) await page.waitForTimeout(25);
}
ok('the replay draws real rings while it runs', replayInk > 200, `${replayInk} ring px`);

// ---- and it is drawn from the band, not from a schematic ----
// The plan lands before the census, and once it has the pending text can count
// the job in the engine's own numbers. 441 combos x 240 angles for this band.
let planned = true;
await page.waitForFunction(
  () => /105,840 tests/.test(document.querySelector('.trace-pending p')?.textContent ?? ''),
  { timeout: 5000 }).catch(() => { planned = false; });
ok('the plan sizes the wait in real numbers', planned,
   planned ? '' : await page.textContent('.trace-pending p'));

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

// ---- the engine's pick arrives already woven: instant, no request ----
// The payload embeds the applied combo's weave and the studio seeds the cache
// from it, so the box must be painted before the 250ms request debounce could
// even have fired — that is what proves the seeded key matches the panel's.
await page.waitForTimeout(120);
const weaveAsks = await page.evaluate(() => window.__posted.filter(m => m.type === 'trace-weave'));
ok('the default weave costs no worker round trip', weaveAsks.length === 0,
   `${weaveAsks.length} requests`);
const weavePaint = await page.evaluate(() => {
  const cv = document.querySelector('.trace-panel canvas');
  const dpr = cv.width / cv.getBoundingClientRect().width;
  const { data } = cv.getContext('2d').getImageData(
    Math.round(+cv.dataset.weaveX * dpr), Math.round(+cv.dataset.weaveY * dpr),
    Math.round(+cv.dataset.weaveW * dpr), Math.round(+cv.dataset.weaveH * dpr));
  // The engine's own set colours for this 2x1 stitch: white for the H sets,
  // the two indigos for V. Both bands present inside the box is the weave
  // being drawn rather than a placeholder.
  let white = 0, indigo = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) white += 1;
    if ((data[i] === 61 && data[i + 1] === 58 && data[i + 2] === 140)
      || (data[i] === 123 && data[i + 1] === 113 && data[i + 2] === 214)) indigo += 1;
  }
  return { white, indigo };
});
ok('the weave pattern is drawn instantly for the engine pick',
   weavePaint.white > 200 && weavePaint.indigo > 200, JSON.stringify(weavePaint));

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
// The canvas draws in CSS pixels, so a point inside the drawing is a point
// inside the element -- clicked through the locator, which scrolls the panel
// into view first. Page coordinates would not survive a locator click
// elsewhere in the panel scrolling the page under them.
const canvasBox = () => page.evaluate(() => {
  const cv = document.querySelector('.trace-panel canvas');
  return { gridX: +cv.dataset.gridX, gridY: +cv.dataset.gridY,
           cell: +cv.dataset.cell, stripY: +cv.dataset.stripY };
});
const clickAt = async (x, y) => {
  await page.locator('.trace-panel canvas').first().click({ position: { x, y } });
  await page.waitForTimeout(60);
};
const clickCell = async (col, row) => {
  const b = await canvasBox();
  await clickAt(b.gridX + col * b.cell + b.cell / 2, b.gridY + row * b.cell + b.cell / 2);
};

// What the panel is looking at, published by the drawing itself: which combo,
// which angle step, which question the grid's colours answer, and the verdict
// of the cell under the cursor.
const at = () => page.evaluate(() => {
  const cv = document.querySelector('.trace-panel canvas');
  return { combo: +cv.dataset.combo, angle: +cv.dataset.angle,
           mode: cv.dataset.mode, verdict: +cv.dataset.verdict };
});
const stepper = (group, glyph) => page.locator(
  `.trace-steps span[aria-label*="${group}"] button`, { hasText: glyph }).first();
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

// ---- and the weave preview follows the click ----
await page.waitForTimeout(600);
const weaveAsks2 = await page.evaluate(() =>
  window.__posted.filter(m => m.type === 'trace-weave').map(m => m.ext));
ok('clicking a cell asks to weave that combo',
   JSON.stringify(weaveAsks2.at(-1)) === JSON.stringify([170, 190]),
   JSON.stringify(weaveAsks2));

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

// ---- a filter travels to what it filters for ----
// On the summary every combo that found a valid angle is drawn BEST -- BEST is
// the valid angle its ranking picked -- so a literal VALID filter used to dim
// the whole grid with nothing left to look at. Pressing one now goes to the
// angle step holding the most of that verdict and lands the cursor on a cell
// that has it, which is what drags the strand view and the weave with it.
const gridPixels = await page.evaluate(() => {
  const cv = document.querySelector('.trace-panel canvas');
  const dpr = cv.width / cv.getBoundingClientRect().width;
  return Math.round(+cv.dataset.cols * +cv.dataset.cell * dpr)
       * Math.round(+cv.dataset.rows * +cv.dataset.cell * dpr);
});
const VALID = 6, BEST = 7;
await page.locator('.trace-legend button', { hasText: 'VALID' }).first().click();
await page.waitForTimeout(200);
const onValid = await at();
ok('pressing VALID goes to a cell that is VALID',
   onValid.verdict === VALID && onValid.mode === 'angle', JSON.stringify(onValid));
const dimValid = await dimCount();
ok('and the step it picked still has VALID cells lit',
   dimValid > dimBefore + 1000 && dimValid < gridPixels,
   `${dimValid} of ${gridPixels} grid pixels dimmed`);
// The weave request is debounced 250 ms, so give it room to be asked for.
await page.waitForTimeout(450);
const validWeave = await page.evaluate(() =>
  window.__posted.filter(m => m.type === 'trace-weave').at(-1));
ok('and the weave preview followed it there',
   JSON.stringify(validWeave.ext) === JSON.stringify(await page.evaluate(() => {
     const cv = document.querySelector('.trace-panel canvas');
     return JSON.parse(cv.dataset.ext);
   })), JSON.stringify(validWeave?.ext));
await page.locator('.trace-legend button', { hasText: 'VALID' }).first().click();
await page.waitForTimeout(120);

// BEST is the engine's own answer rather than a population, so it goes to the
// combo this level adopted -- the ringed cell -- at the angle it chose.
await page.locator('.trace-legend button', { hasText: 'BEST' }).first().click();
await page.waitForTimeout(200);
const onBest = await at();
ok('pressing BEST goes to the combo this level adopted',
   onBest.verdict === BEST && onBest.combo === 217, JSON.stringify(onBest));
await page.locator('.trace-legend button', { hasText: 'BEST' }).first().click();
await page.waitForTimeout(120);

// ---- the steppers walk a cell and an angle at a time ----
// The grid's axes are extension pairs: for P = 2 the x axis is pair 1, one
// combo index apart, and the y axis is pair 0, one row of 21 apart.
const beforeStep = await at();
await stepper('extension', '\u2192').click();
await page.waitForTimeout(80);
const rightOne = await at();
ok('the ext stepper moves one cell along x',
   rightOne.combo === beforeStep.combo + 1, `${beforeStep.combo} -> ${rightOne.combo}`);
await stepper('extension', '\u2193').click();
await page.waitForTimeout(80);
const downOne = await at();
ok('and one row along y', downOne.combo === rightOne.combo + 21,
   `${rightOne.combo} -> ${downOne.combo}`);
await stepper('extension', '\u2191').click();
await stepper('extension', '\u2190').click();
await page.waitForTimeout(80);
ok('and back again', (await at()).combo === beforeStep.combo);
await stepper('angle', '\u203a').click();
await page.waitForTimeout(80);
const angleOn = await at();
ok('the angle stepper moves one step and takes the grid with it',
   angleOn.angle === beforeStep.angle + 1 && angleOn.mode === 'angle',
   JSON.stringify(angleOn));
await stepper('angle', '\u2039').click();
await page.waitForTimeout(80);
ok('and back', (await at()).angle === beforeStep.angle);

// Back to the summary for what follows.
await page.locator('.trace-head button', { hasText: 'Whole sweep' }).first().click();
await page.waitForTimeout(120);

// ---- the grid and the strip move together ----
// A fingerprint of the grid, so "it recoloured" is a fact about the whole
// drawing rather than about one sampled cell.
const gridInk = () => page.evaluate(() => {
  const cv = document.querySelector('.trace-panel canvas');
  const dpr = cv.width / cv.getBoundingClientRect().width;
  const { data } = cv.getContext('2d').getImageData(
    Math.round(+cv.dataset.gridX * dpr), Math.round(+cv.dataset.gridY * dpr),
    Math.round(+cv.dataset.cols * +cv.dataset.cell * dpr),
    Math.round(+cv.dataset.rows * +cv.dataset.cell * dpr));
  let h = 0;
  for (let i = 0; i < data.length; i += 4) h = (h * 31 + data[i] + data[i + 1] * 3) % 1e9;
  return h;
});
// The grid drives the strip: another combo brings its own chosen angle with it.
// Cell (7, 10) is the combo this level adopted, which is one that found an
// angle -- a combo with no valid angle has nothing to move the strip to.
await clickCell(19, 17);            // somewhere else first: BEST left us on 217
const before = await at();
await clickCell(7, 10);
const moved = await at();
ok("clicking a cell moves the strip to that combo's own angle",
   moved.combo !== before.combo && moved.angle !== before.angle,
   `${JSON.stringify(before)} -> ${JSON.stringify(moved)}`);

// And the strip drives the grid.
const summaryInk = await gridInk();
const strip = await canvasBox();
await clickAt(strip.gridX + 150, strip.stripY + 8);
await page.waitForTimeout(90);
const sliced = await at();
const sliceInk = await gridInk();
ok('clicking the strip puts the grid on that angle step',
   sliced.mode === 'angle' && sliced.angle !== moved.angle, JSON.stringify(sliced));
ok('and the cells are recoloured for it', sliceInk !== summaryInk);

// On a slice the step is the axis every cell shares, so picking another combo
// must not drag it out from under the reader.
await clickCell(5, 5);
const held = await at();
ok('clicking a cell on a slice holds the angle step',
   held.angle === sliced.angle && held.combo !== sliced.combo,
   `${JSON.stringify(sliced)} -> ${JSON.stringify(held)}`);

await page.locator('.trace-head button', { hasText: 'Whole sweep' }).first().click();
await page.waitForTimeout(90);
await clickCell(7, 10);
const backInk = await gridInk();
const back = await at();
ok('and the toggle puts the summary back',
   back.mode === 'sweep' && backInk === summaryInk,
   `${JSON.stringify(back)}: ${summaryInk} -> ${sliceInk} -> ${backInk}`);

// ---- a traced cell can take the card's own diagram ----
// The card's drawing, as a fingerprint, and the number beside it: both have to
// move when a traced ring replaces the level's own, and both have to come back.
// Scoped to L1's card: L0 is the starting stitch, has no audit row, and is the
// one `.diagram-card` a bare selector would reach first.
const cardInk = () => page.evaluate(() => {
  const card = [...document.querySelectorAll('.diagram-card')].find(c => /L1/.test(c.textContent));
  const cv = card.querySelector('.level-main .canvas-wrap canvas');
  const { data } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
  let h = 0;
  for (let i = 0; i < data.length; i += 40) h = (h * 31 + data[i] + data[i + 1] * 3) % 1e9;
  return h;
});
const crossings = () => l1.locator('.exact-metrics .metric', { hasText: 'crossings' })
  .first().locator('strong').innerText();
const showBtn = page.locator('.trace-steps .show-on-card').first();

// The engine's own pick is a numbered solution, so showing it must not label
// the card as traced -- it belongs to the browser, not to an override.
await clickCell(7, 10);
await page.waitForTimeout(500);
await showBtn.click();
await page.waitForTimeout(200);
ok('showing the engine pick does not mark the card as traced',
   (await l1.locator('.traced-chip').count()) === 0);

// Any other cell is not a solution, so it says so and keeps the ring it moved.
const ownInk = await cardInk();
const ownCross = await crossings();
await clickCell(19, 17);
await page.waitForTimeout(600);
ok('the button waits for the cell to be woven', await showBtn.isEnabled());
await showBtn.click();
await page.waitForTimeout(300);
const chip = await l1.locator('.traced-chip').first().innerText().catch(() => '');
// What has to be true is that the cell on screen is the cell that reached the
// card. A pixel comparison cannot say so here: the stand-in worker answers
// every trace-weave with the one ring the fixture carries, so the drawing is
// the same picture whichever cell is asked for. The identity is the check.
const panelExt = await page.evaluate(() =>
  document.querySelector('.trace-panel canvas').dataset.ext);
ok('showing another cell puts that cell on the card and names it',
   /traced/i.test(chip)
   && chip.includes(`ext (${JSON.parse(panelExt).join(', ')})`),
   `${chip.replace(/\n/g, ' ')} vs panel ${panelExt}`);
ok('and the card reports the traced ring\'s own audit row',
   (await crossings()) === '8/8', await crossings());
ok('and the solution browser stops claiming the engine pick',
   (await l1.locator('.solution-nav.is-stale').count()) === 1
   && (await l1.locator('.solution-nav em').count()) === 0);

await l1.locator('.traced-chip button').first().click();
await page.waitForTimeout(300);
ok('back puts the level\'s own ring on the card again',
   (await l1.locator('.traced-chip').count()) === 0
   && (await cardInk()) === ownInk && (await crossings()) === ownCross);
// And the browser gets its claim back: while a traced cell held the diagram,
// "engine pick" was not a true label for what was drawn.
ok('and the solution browser stops being set back',
   (await l1.locator('.solution-nav.is-stale').count()) === 0
   && (await l1.locator('.solution-nav em').count()) > 0);

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
  const card = document.querySelector('.diagram-card:has(.level-widget.is-open)');
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
const traceCardW = await page.$eval('.diagram-card:has(.level-widget.is-open)', e => Math.round(e.getBoundingClientRect().width));
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
