// QA for the two busy-state widgets, driven through mocks/widgets.html.
//
//   npm run dev -- --port 5178 --strictPort     # in one shell
//   python3 scripts/mock-fixtures.py            # once, or after a payload change
//   npm run qa:widgets                          # in another
//
// The mock mounts the real components against real engine payloads, so what is
// asserted here is what the lab draws — only the worker is a stand-in. Shots
// land in node_modules/.cache/ for eyeballing.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = `${ROOT}node_modules/.cache`;
const URL_BASE = process.env.QA_URL || 'http://localhost:5178/Scoubidou3D/mocks/widgets.html';
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.trace-sweep', { timeout: 20000 });
await page.waitForSelector('.candidate-sheet', { timeout: 20000 });

// ---- A · the pending sweep ----
const facts = await page.$$eval('.mock-facts dd', nodes => nodes.map(n => n.textContent));
ok('the V band plan is the engine\'s own', facts.includes('441') && facts.includes('105,840'),
   facts.join(' | '));

const sweep = await page.$('.trace-sweep');
const canvasSize = await sweep.evaluate(el => [el.width, el.height, el.clientWidth]);
ok('the sweep draws at device resolution', canvasSize[0] > canvasSize[2],
   canvasSize.join('x'));

// The preview walks real combos, so the canvas must keep changing.
const shot1 = await sweep.screenshot();
await page.waitForTimeout(900);
const shot2 = await sweep.screenshot();
ok('the sweep is live', !shot1.equals(shot2));

// Pausing the stand-in census must not freeze the preview: the two clocks are
// deliberately separate.
await page.click('.mock-case:nth-of-type(1) .mock-toggle');
await page.waitForTimeout(500);
const shot3 = await sweep.screenshot();
await page.waitForTimeout(700);
ok('the preview keeps sweeping with the census paused',
   !shot3.equals(await sweep.screenshot()));
await page.click('.mock-case:nth-of-type(1) .mock-toggle');

// The replay state must draw nothing it does not know.
await page.click('.mock-case:nth-of-type(1) .mock-switch:nth-of-type(2) button');
await page.waitForTimeout(400);
ok('the replay state says so',
   (await page.textContent('.trace-pending p')).includes('Replaying L1'));
await page.screenshot({ path: `${SHOTS}/widget-sweep-replaying.png`, fullPage: false });
await page.click('.mock-case:nth-of-type(1) .mock-switch:nth-of-type(2) button:nth-of-type(2)');
await page.waitForTimeout(1600);
ok('the sweeping state counts the real job',
   (await page.textContent('.trace-pending p')).includes('105,840'));

// ---- B · the plaque ----
const plaque = await page.$('.thinking-plaque');
ok('the plaque still says thinking',
   (await plaque.textContent()).toLowerCase().includes('thinking'));
const scale = await page.textContent('.thinking-scale');
ok('the plaque carries the run ceiling', /≤ [\d,]+ combos/.test(scale), scale);
ok('the plaque names the group', /group \d+\/\d+/.test(scale), scale);

const widths = async () => page.$$eval('.thinking-track > *',
  nodes => nodes.map(n => n.style.width));
const before = await widths();
await page.waitForTimeout(900);
ok('the bar moves', JSON.stringify(before) !== JSON.stringify(await widths()),
   `${before} then ${await widths()}`);

// It must sit inside the sheet without swallowing it.
const box = await plaque.boundingBox();
const stage = await (await page.$('.sheet-stage')).boundingBox();
ok('the plaque covers a fraction of the sheet',
   (box.width * box.height) / (stage.width * stage.height) < 0.2,
   `${Math.round(100 * (box.width * box.height) / (stage.width * stage.height))}%`);

await page.screenshot({ path: `${SHOTS}/widget-mock.png`, fullPage: true });
await (await page.$('.candidate-sheet')).screenshot({ path: `${SHOTS}/widget-plaque.png` });
await sweep.screenshot({ path: `${SHOTS}/widget-sweep.png` });

ok('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed · shots in node_modules/.cache/`);
process.exit(fail ? 1 : 0);
