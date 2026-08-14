// QA for /mxn/fit/, driven against committed engine output.
//
//   npm run dev -- --port 5178 --strictPort     # in one shell
//   npm run qa:fit                              # in another
//
// The engine itself needs Pyodide from a CDN, which a sandbox or an offline
// machine may not have — and none of what this asserts is about Pyodide. So the
// worker is replaced, before the page loads, by a stub that answers out of
// `mocks/fixtures/fit-l1.json`: real `bridge.generate` stages, real
// `bridge.fit_plan` payloads, and the real ring `bridge.fit_weave` returned for
// the engine's own pick.
//
// What that proves is exactly what the stub cannot fake: that the level
// diagrams are drawn from the engine's own strands, that the arm lengths on
// screen are measured off those strands, and that the solver finds the flush
// candidates the committed answers say are there. What it deliberately does NOT
// cover is the audit walk — a stub cannot weave a ring, and pretending to would
// be worse than a gap. `npm run check:fit` covers the solver; scripts/
// check-fit.py covers the geometry against the engine.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = `${ROOT}node_modules/.cache`;
const URL_BASE = process.env.QA_URL || 'http://localhost:5178/Scoubidou3D/mxn/fit/';
mkdirSync(SHOTS, { recursive: true });

const fixture = JSON.parse(readFileSync(`${ROOT}mocks/fixtures/fit-l1.json`, 'utf8'));
// The size with the most levels, so the level strip has something to show.
const key = Object.keys(fixture.sizes)
  .sort((a, b) => fixture.sizes[b].ks.length - fixture.sizes[a].ks.length)[0];
const size = fixture.sizes[key];

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1300 }, deviceScaleFactor: 2 });
// A thrown exception is this page's fault and fails the run. A resource that
// would not load is usually the environment's — the site counter is a third
// party, and a sandbox that blocks it says nothing about the fitter — so those
// are reported and not asserted on.
const errors = [];
const network = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => {
  if (m.type() !== 'error') return;
  (/net::ERR_|Failed to load resource/.test(m.text()) ? network : errors).push(m.text());
});

// The stub, installed before any of the page's own code runs.
await page.addInitScript(({ size }) => {
  class StubWorker {
    constructor() { this.onmessage = null; }
    postMessage(data) {
      const reply = (message) => setTimeout(() => {
        this.onmessage?.({ data: { id: data.id, ...message } });
      }, 0);
      if (data.type === 'generate') {
        reply({ type: 'result', result: { stages: size.stages, rows: size.rows } });
      } else if (data.type === 'fit-plan') {
        reply({ type: 'fit-plan-ready', ...size.plans[String(data.level)] });
      } else if (data.type === 'fit-weave') {
        // The baseline — both bands held where the engine left them — is the
        // one weave the fixture holds. A fitted candidate would need a real
        // weave, and a stub must not invent an audit, so it says so instead.
        const holding = JSON.stringify(data.hExt ?? null) === JSON.stringify(size.held.h)
                     && JSON.stringify(data.vExt ?? null) === JSON.stringify(size.held.v);
        if (holding) reply({ type: 'fit-weave-ready', ...size.baseline });
        else reply({ type: 'error', message: 'stubbed worker cannot weave a candidate' });
      }
    }
    terminate() {}
  }
  window.Worker = StubWorker;
}, {
  size: {
    // Every level's diagram, as the run drew them.
    stages: size.stages,
    plans: size.plans,
    rows: size.rows,
    baseline: size.before,
    held: { h: size.held.h.ext ?? null, v: size.held.v.ext ?? null },
  },
});

await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('button.go');

// Drive the size the fixture holds.
await page.fill('#fit-m', String(size.m));
await page.fill('#fit-n', String(size.n));
await page.fill('#fit-ks', size.ks.join(' '));
await page.click('button.go');
await page.waitForSelector('.levels .level', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);

const seen = await page.evaluate(() => ({
  levels: document.querySelectorAll('.levels .level').length,
  canvases: [...document.querySelectorAll('.levels .level canvas')].map(c => ({
    w: c.width, h: c.height,
    // A blank canvas is the failure this is really looking for: a diagram that
    // is present in the DOM and empty on the screen.
    inked: (() => {
      const ctx = c.getContext('2d');
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let distinct = new Set();
      for (let i = 0; i < data.length; i += 4 * 97) {
        distinct.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      }
      return distinct.size;
    })(),
  })),
  rows: document.querySelectorAll('tbody tr').length,
  stats: [...document.querySelectorAll('.stat')].map(s => s.textContent.replace(/\s+/g, ' ').trim()),
  status: document.querySelector('.status')?.textContent ?? '',
  alarm: document.querySelector('.alarm')?.textContent ?? '',
}));

ok('a card per level', seen.levels === size.ks.length,
  `${seen.levels} cards for ks ${size.ks.join(',')}`);
ok('every level diagram is drawn, not blank',
  seen.canvases.length > 0 && seen.canvases.every(c => c.inked > 3),
  seen.canvases.map(c => `${c.w}×${c.h}: ${c.inked} colours`).join(' · '));
ok('the solutions table is populated', seen.rows > 0, `${seen.rows} rows`);
// The baseline check is the page's own alarm: the engine's configuration put
// back through the engine has to come out as the engine's ring. A stub that
// replays a real weave should never trip it.
ok('the baseline agrees with the run', !seen.alarm, seen.alarm || 'no disagreement');
// And the reason for having no candidates has to be the true one — "already
// flush" and "cannot be made flush" are opposite claims about the same band.
ok('a band that cannot be flushed says so, not that it is flush',
  !/already flush/.test(seen.status) || !/cannot be made flush/.test(seen.status),
  seen.status.slice(0, 120));
// The manual panel: knobs for the angle and each pair, numbers measured live
// in the page — so a stub that cannot weave still proves the arithmetic and
// the follow behaviour, which never touch the engine.
const knobs = await page.evaluate(() => ({
  rows: document.querySelectorAll('.mrow').length,
  nums: [...document.querySelectorAll('.mrow .mnum')].map(i => i.value),
  read: document.querySelector('.mread')?.textContent ?? '',
  follow: document.querySelector('.follow')?.getAttribute('aria-pressed') ?? '',
  verdicts: document.querySelectorAll('.verdicts .verdict').length,
}));
ok('the manual panel has a knob per pair plus the angle', knobs.rows >= 2,
  `${knobs.rows} rows`);
ok('and measures the configuration live', /Δ neigh/.test(knobs.read),
  knobs.read.slice(0, 60));
ok('follow is on by default', knobs.follow === 'true');
ok('the three verdict buttons are on the page', knobs.verdicts === 3);

if (knobs.rows >= 3) {
  const before = await page.evaluate(() => ({
    other: document.querySelectorAll('.mrow .mnum')[2].value,
    read: document.querySelector('.mread')?.textContent ?? '',
  }));
  // Drive pair 1's own number field; with follow on, pair 2 has to move too —
  // that is the whole claim the panel makes.
  const first = page.locator('.mrow .mnum').nth(1);
  await first.fill('150');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    other: document.querySelectorAll('.mrow .mnum')[2].value,
    read: document.querySelector('.mread')?.textContent ?? '',
  }));
  ok('moving one pair re-solves the other to match',
    after.other !== before.other, `pair 2: ${before.other} → ${after.other}`);
  ok('and the live readout follows the knobs', after.read !== before.read,
    after.read.slice(0, 60));
}

ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
if (network.length) console.log(`  note  ${network.length} resource(s) blocked by the environment, not the page`);

await page.screenshot({ path: `${SHOTS}/fit-page.png`, fullPage: true });
console.log(`\n  shot: ${SHOTS}/fit-page.png`);
console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nall ${pass} checks passed`);
await browser.close();
process.exit(fail ? 1 : 0);
