// QA for the near-miss sort strip, driven through the real UI.
//
//   npm run dev -- --port 5179 --strictPort      # in one shell
//   python3 scripts/semi-fixtures.py             # once, or after a payload change
//   npm run qa:semi                              # in another
//
// Same arrangement as qa-trace-widget.mjs: the Pyodide CDN is blocked by the
// environment's proxy, so the worker is a stand-in that replies with payloads
// captured from the real bridge -- including the orderings, so the strip is
// checked against the lists the engine actually produces.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const FIXTURES = `${ROOT}node_modules/.cache/semi-fixtures.json`;
let fixtures;
try {
  fixtures = JSON.parse(readFileSync(FIXTURES, 'utf8'));
} catch {
  console.error(`Missing ${FIXTURES}\nRun: python3 scripts/semi-fixtures.py`);
  process.exit(2);
}
const URL_BASE = process.env.QA_URL || 'http://localhost:5179/Scoubidou3D/mxn/';
const KEYS = Object.keys(fixtures.sorts);

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

await page.addInitScript(({ result, scan, first, sorts }) => {
  const posted = [];
  window.__posted = posted;
  window.Worker = class FakeWorker {
    constructor() { this.onmessage = null; }
    postMessage(data) {
      posted.push(data);
      const reply = (msg) => setTimeout(() => this.onmessage?.({ data: msg }), 30);
      if (data.type === 'generate') reply({ type: 'result', id: data.id, result });
      if (data.type === 'semi-scan') reply({ type: 'semi-ready', id: data.id, ...scan });
      if (data.type === 'semi-select') reply({ type: 'semi-solution', id: data.id, ...first });
      if (data.type === 'semi-sort') {
        reply({ type: 'semi-sorted', id: data.id, ...sorts[data.key] });
      }
    }
    terminate() {}
  };
}, fixtures);

await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.run-button', { timeout: 20000 });
// The fixture is 3x1, and m is what decides how many H pairs the card reports.
await page.fill('#m', '3');
await page.fill('#n', '1');
await page.click('.run-button');
await page.waitForSelector('.diagram-card', { timeout: 20000 });

const l1 = page.locator('.diagram-card', { hasText: 'L1' }).first();

// ---- no sort strip until a band is flagged ----
ok('closed rings carry no sort buttons',
   await l1.locator('.semi-sorts').count() === 0);

// ---- flag the V band ----
await l1.locator('.semi-flag', { hasText: 'V' }).first().click();
await page.waitForSelector('.solution-nav.is-semi .semi-sorts', { timeout: 20000 });

// ---- the strip offers one button per key and nothing else ----
const labels = await l1.locator('.semi-sort').allInnerTexts();
ok('one sort button per engine key', labels.length === KEYS.length,
   `${labels.length} buttons: ${labels.join(' ')}`);
ok('they are the four named orders',
   labels.join(' ') === 'NEAR H V BEST', labels.join(' '));
ok('the group is captioned SORT',
   (await l1.locator('.semi-sorts i').first().innerText()) === 'SORT');

// ---- the steppers are gone ----
ok('no H± / V± steppers remain in the strip',
   await l1.locator('.semi-step').count() === 0);
const stepAsks = await page.evaluate(() => window.__posted.filter(m => m.type === 'semi-step'));
ok('nothing can ask the worker to step a band', stepAsks.length === 0);

// ---- the live order is lit, and only it ----
const litLabel = async () => {
  const on = l1.locator('.semi-sort.is-on');
  return (await on.count()) === 1 ? (await on.first().innerText()) : `${await on.count()} lit`;
};
ok('the order the list is in is the lit one', (await litLabel()) === 'NEAR',
   await litLabel());
ok('the lit button is not pressable — it would ask for the sort it has',
   await l1.locator('.semi-sort.is-on').first().isDisabled());
ok('the lit button stays legible rather than fading out',
   await l1.locator('.semi-sort.is-on').first()
     .evaluate(el => Number(getComputedStyle(el).opacity) > 0.9));

// ---- each button asks for its own key, and the lamp follows ----
for (const key of KEYS.filter(k => k !== 'near').concat('near')) {
  const label = { near: 'NEAR', h: 'H', v: 'V', best: 'BEST' }[key];
  await l1.locator('.semi-sort', { hasText: new RegExp(`^${label}$`) }).first().click();
  await page.waitForFunction(
    expected => document.querySelector('.semi-sort.is-on')?.textContent === expected,
    label, { timeout: 20000 });
  const asked = await page.evaluate(() => window.__posted.filter(m => m.type === 'semi-sort').at(-1));
  ok(`${label} asks the worker for key "${key}"`, asked?.key === key, JSON.stringify(asked));
  ok(`${label} becomes the lit order`, (await litLabel()) === label, await litLabel());
}

// ---- the card still says which band fell short, with the numbers behind it ----
const badge = l1.locator('.solution-nav.is-semi em').first();
ok('the near-miss badge still names the band it blames',
   /H ok · V short/.test(await badge.innerText()), await badge.innerText());
const tip = await badge.getAttribute('title');
ok('its tooltip carries the H, V and worst-pair numbers the sorts use',
   /H \d+px/.test(tip) && /V \d+px/.test(tip) && /worst pair \d+px/.test(tip), tip);

// ---- the strip fits the card rather than running off it ----
const fits = await l1.evaluate(card => {
  const strip = card.querySelector('.solution-nav.is-semi').getBoundingClientRect();
  const head = card.querySelector('.card-head').getBoundingClientRect();
  return { stripRight: Math.round(strip.right), headRight: Math.round(head.right),
           stripLeft: Math.round(strip.left), headLeft: Math.round(head.left) };
});
ok('the strip stays inside the card head', fits.stripRight <= fits.headRight + 1
   && fits.stripLeft >= fits.headLeft - 1, JSON.stringify(fits));

// ---- pressing the lit flag returns to closed rings, taking the strip with it ----
await l1.locator('.semi-flag.is-on').first().click();
await page.waitForFunction(() => !document.querySelector('.semi-sorts'), null, { timeout: 20000 });
ok('leaving near-miss mode removes the sort strip', true);

await page.screenshot({ path: `${ROOT}node_modules/.cache/qa-semi-sort.png`, fullPage: false });
// Same excuse as qa-trace-widget.mjs: the visit counter and the Pyodide CDN are
// both refused by this environment's proxy. That is the sandbox, not the lab, so
// they are named rather than allowed to mask a real error.
const OFFSITE = /gc\.zgo\.at|cdn\.jsdelivr\.net/;
const real = errors.filter(e => !OFFSITE.test(e) && !/Failed to load resource/.test(e));
ok('no page errors', real.length === 0, real.slice(0, 3).join(' | '));
const blocked = failedUrls.filter(u => !OFFSITE.test(u));
ok('nothing the lab needs failed to load', blocked.length === 0, blocked.join(', '));
if (failedUrls.length) console.log('  note: offsite blocked by the sandbox —', failedUrls.join(', '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
