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
//
// It keeps the one piece of engine STATE the real worker has: the browsing
// session `bridge.generate` opens and every fit call reads. Faking it is what
// lets this catch a page that fits without having opened one — the real engine
// answers that with "level N has no browsing session; run generate first", and
// a stub that happily replied anyway would hide it (see the cached-run check
// at the bottom). `delay` slows the generate so a run drawn from the cache can
// be told apart from one drawn by the engine.
const STUB = ({ size, delay }) => {
  let sessioned = false;
  window.__stubGenerates = 0;
  class StubWorker {
    constructor() { this.onmessage = null; }
    postMessage(data) {
      // Counted so the preload checks at the end can assert the thing they are
      // really about: that a ★ best on the shelf is drawn without the engine
      // being asked anything at all.
      window.__engineCalls = (window.__engineCalls ?? 0) + 1;
      const reply = (message) => setTimeout(() => {
        this.onmessage?.({ data: { id: data.id, ...message } });
      }, 0);
      if (data.type === 'generate') {
        window.__stubGenerates += 1;
        // The ring a remembered or judged L1 hands to generate, kept so the
        // restore checks can assert it was actually sent — and echoed back as
        // adopted, which is what bridge.generate reports for a ring whose
        // layer names match.
        window.__l1ring = data.level1Ring ?? null;
        // The real engine narrates its boot before it answers. The timeline is
        // built out of exactly these, so the stub has to send one or the check
        // below would be asserting against a silence the engine never keeps.
        setTimeout(() => this.onmessage?.({
          data: { type: 'progress', message: 'Loading the exact MXN engine…' } }), 0);
        setTimeout(() => {
          sessioned = true;
          this.onmessage?.({ data: { id: data.id, type: 'result',
            result: { stages: size.stages, rows: size.rows,
                      level1Adopted: !!data.level1Ring } } });
        }, delay);
      } else if (!sessioned && data.type !== 'fit-plan-now') {
        reply({ type: 'error',
                message: `level ${data.level} has no browsing session; run generate first` });
      } else if (data.type === 'fit-plan-now') {
        // The fast path takes no session — that is its whole point — so it is
        // answered BEFORE the `!sessioned` guard above would refuse it. The
        // fixture's own L1 plan, plus a ring to draw, is exactly the shape
        // bridge.fit_plan_now returns.
        reply({ type: 'fit-plan-now-ready', ...size.plans['1'],
                level: 1, strands: size.stages.find(s => s.level === 1).strands });
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
      } else if (data.type === 'fit-adopt') {
        // Adopting is a real search per level above, which a stub cannot do —
        // so it answers with the run's own rows and diagrams for those levels,
        // which is the SHAPE of the reply without any claim about the search.
        // What that still proves is the bookkeeping: the page must not count a
        // level as fixed until the engine has been asked, and must count it
        // once it has. The rebuild itself is checked in Python, against the
        // engine, by scripts/check-fit-stack.py.
        window.__stubAdopts = (window.__stubAdopts ?? 0) + 1;
        const from = data.level;
        reply({
          type: 'fit-adopt-ready', level: from, unavailable: false,
          rebuilt: data.rebuild !== false, seconds: 0,
          row: size.baseline.row,
          rows: size.rows.filter(r => r.level >= from),
          stages: size.stages.filter(s => s.level >= from),
          stale: data.rebuild === false
            ? size.stages.filter(s => s.level > from).map(s => s.level) : [],
          adopted: [from],
        });
      }
    }
    terminate() {}
  }
  window.Worker = StubWorker;
};

const STUB_SIZE = {
  // Every level's diagram, as the run drew them.
  stages: size.stages,
  plans: size.plans,
  rows: size.rows,
  baseline: size.before,
  held: { h: size.held.h.ext ?? null, v: size.held.v.ext ?? null },
};

await page.addInitScript(STUB, { size: STUB_SIZE, delay: 0 });

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

// The timeline. A slow run used to say "Working…" and nothing else, because
// the status line outranked every word the engine said — so the one question a
// reader had (WHICH step is slow?) had no answer on the page at all.
const tl = await page.evaluate(() => {
  const panel = [...document.querySelectorAll('.panel')].find(p =>
    /timeline/i.test(p.querySelector('header strong')?.textContent ?? ''));
  return {
    rows: [...(panel?.querySelectorAll('.tl tr') ?? [])].map(r =>
      [...r.querySelectorAll('td')].map(t => t.textContent.trim())),
    copy: !!panel && [...panel.querySelectorAll('.minibtn')]
      .some(b => /copy/i.test(b.textContent)),
  };
});
ok('a run leaves a timeline', tl.rows.length >= 3, `${tl.rows.length} rows`);
ok('it starts from the press', /Run pressed/.test(tl.rows[0]?.[3] ?? ''),
  tl.rows[0]?.[3] ?? '(empty)');
// The whole point: the engine's own words reach the page now.
ok("the engine's own progress is recorded, not swallowed by the status line",
  tl.rows.some(r => r[2] === 'engine'),
  tl.rows.filter(r => r[2] === 'engine').map(r => r[3]).join(' · ') || '(none)');
ok('every row is timestamped from the press',
  tl.rows.every(r => /^\d+\.\d\ds$/.test(r[0] ?? '')),
  tl.rows.map(r => r[0]).join(' '));
ok('and the timeline can be copied out', tl.copy);

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
const hero = await page.evaluate(() => {
  // The panel that follows the stats — deliberately not ".results .panel",
  // which the diagnostic timeline now takes. The claim is about the hero's
  // place in the WORK, not its place in the document.
  const first = document.querySelector('.stats ~ .panel');
  const canvas = document.querySelector('.mfig canvas');
  const sample = () => {
    if (!canvas) return '';
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let acc = 0;
    for (let i = 0; i < data.length; i += 4 * 61) acc = (acc * 31 + data[i]) >>> 0;
    return String(acc);
  };
  const distinct = () => {
    if (!canvas) return 0;
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4 * 97) {
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return seen.size;
  };
  return {
    firstIsManual: !!first && /manual fit/i.test(first.querySelector('header strong')?.textContent ?? ''),
    inked: distinct(),
    hash: sample(),
  };
});
ok('the manual panel is the first thing under the stats', hero.firstIsManual);
ok('its diagram is drawn, not blank', hero.inked > 3, `${hero.inked} colours`);
ok('and measures the configuration live', /Δ neigh/.test(knobs.read),
  knobs.read.slice(0, 60));
ok('follow is on by default', knobs.follow === 'true');
ok('the three verdict buttons are on the page', knobs.verdicts === 3);

// The ladder. A stitch is a stack of rings, and until fit_adopt existed this
// page could only ever propose about one of them: every fit was woven against
// the ring the RUN built underneath, so fitting L1 and moving to L2 left L2
// standing on the engine's L1. What is asserted here is the bookkeeping that
// makes "fix L1, then L2, then L3" mean something — that a level is only
// counted as fixed once the engine has been asked to rebuild the levels above
// it on that ring, and that the page says which levels those are.
const topLevelOfRun = Math.max(...size.stages.map(s => s.level));
const ladder = await page.evaluate(() => {
  const rungs = [...document.querySelectorAll('.ladder .rung')];
  return {
    count: rungs.length,
    states: rungs.map(r => r.dataset.state),
    text: rungs.map(r => r.textContent.replace(/\s+/g, ' ').trim()),
    current: rungs.findIndex(r => r.dataset.current) + 1,
    // The rungs must be a column of separate boxes. `.fixed` in preflight.css
    // is Tailwind's `position: fixed`, and a rung classed with its own state
    // stacked three levels into one row — visible only in a screenshot.
    overlapping: (() => {
      const tops = rungs.map(r => Math.round(r.getBoundingClientRect().top));
      return tops.length !== new Set(tops).size;
    })(),
    fixLabel: document.querySelector('.ladder-act .primary')?.textContent ?? '',
    stackButton: [...document.querySelectorAll('.controls .go')]
      .some(b => /save the stack/i.test(b.textContent)),
  };
});
ok('the ladder has a rung per level', ladder.count === size.ks.length,
  `${ladder.count} rungs for ks ${size.ks.join(',')}`);
ok('every rung says what state its level is in',
  ladder.states.every(s => s && s.length > 0), ladder.states.join(' · '));
ok('and the rungs are a column, not a pile', !ladder.overlapping);
ok('nothing is fixed before anything has been fixed',
  !ladder.states.some(s => /\bfixed\b/.test(s)), ladder.states.join(' · '));
ok('the level being fitted is the current rung',
  ladder.current === Math.max(...size.stages.map(s => s.level)),
  `rung ${ladder.current}`);
ok('the fix button names what it will rebuild',
  /^Fix L\d/.test(ladder.fixLabel), ladder.fixLabel);
ok('and the stack cannot be saved before a level is fixed', !ladder.stackButton);

if (ladder.count) {
  await page.click('.ladder-act .primary');
  await page.waitForTimeout(1200);
  const fixedNow = await page.evaluate(() => {
    const rungs = [...document.querySelectorAll('.ladder .rung')];
    return {
      states: rungs.map(r => r.dataset.state),
      text: rungs.map(r => r.textContent.replace(/\s+/g, ' ').trim()),
      overlapping: (() => {
        const tops = rungs.map(r => Math.round(r.getBoundingClientRect().top));
        return tops.length !== new Set(tops).size;
      })(),
      chip: [...document.querySelectorAll('.panel header .chip')]
        .map(c => c.textContent).find(t => /of \d+ fixed/.test(t)) ?? '',
      status: document.querySelector('.status')?.textContent ?? '',
      stackButton: [...document.querySelectorAll('.controls .go')]
        .map(b => b.textContent).find(t => /save the stack/i.test(t)) ?? '',
      adopts: window.__stubAdopts ?? 0,
    };
  });
  ok('fixing asks the engine to adopt the ring', fixedNow.adopts === 1,
    `${fixedNow.adopts} adopt call(s)`);
  ok('the fixed level reads as fixed on the ladder',
    fixedNow.states.some(s => /\bfixed\b/.test(s)), fixedNow.states.join(' · '));
  ok('and a fixed rung stays in the column', !fixedNow.overlapping);
  ok('and the header counts it', /1 of \d+ fixed/.test(fixedNow.chip),
    fixedNow.chip || '(no chip)');
  ok('the status says what was fixed and what it cost',
    /fixed/.test(fixedNow.status), fixedNow.status.slice(0, 110));
  // Named for the levels it actually covers — L2 alone here, because L1 was
  // never fixed. A button offering "L1–L2" would be claiming a level nobody
  // touched, which is the same lie as filing the stack under the wrong key.
  ok('and the stack can now be saved, named for the levels it covers',
    fixedNow.stackButton.trim().endsWith(`L${topLevelOfRun}`)
    && !/L1–/.test(fixedNow.stackButton),
    fixedNow.stackButton || '(absent)');
  // The fix must survive the tab: it is written to this browser's storage,
  // keyed by the run, so the next Run of these parameters can stand on it.
  const stored = await page.evaluate(() =>
    localStorage.getItem('mxn-fit-fixed') ?? '');
  ok('and the fix is remembered in this browser, keyed by the run',
    stored.includes(`v3/lh-cw/${size.m}x${size.n}/${size.ks.join('_')}`),
    stored.slice(0, 80) || '(nothing stored)');
}

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
  // The diagram is the panel's other half: a drag has to redraw it, or the
  // picture is captioning numbers it no longer shows.
  const redrawn = await page.evaluate(() => {
    const canvas = document.querySelector('.mfig canvas');
    if (!canvas) return '';
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let acc = 0;
    for (let i = 0; i < data.length; i += 4 * 61) acc = (acc * 31 + data[i]) >>> 0;
    return String(acc);
  });
  ok('and the diagram redraws under the drag', redrawn !== hero.hash,
    `${hero.hash} → ${redrawn}`);

  // The other half of the switch: independent mode. Toggled off, a pair moves
  // alone — and once the arms disagree, the static fix lights up and solves
  // every other pair from the fixed one, one division per pair.
  await page.click('.follow');
  const toggled = await page.evaluate(() =>
    document.querySelector('.follow')?.getAttribute('aria-pressed') ?? '');
  ok('the switch turns the coupling off', toggled === 'false');
  const still = await page.evaluate(() =>
    document.querySelectorAll('.mrow .mnum')[2].value);
  await page.locator('.mrow .mnum').nth(1).fill('100');
  await page.waitForTimeout(300);
  const alone = await page.evaluate(() => ({
    other: document.querySelectorAll('.mrow .mnum')[2].value,
    fixEnabled: (() => {
      const b = document.querySelector('.mfix');
      return !!b && !b.disabled;
    })(),
  }));
  ok('independent: moving pair 1 leaves pair 2 alone', alone.other === still,
    `pair 2 stays ${still}`);
  ok('the fix button lights when the arms disagree', alone.fixEnabled);
  await page.click('.mfix');
  await page.waitForTimeout(300);
  const fixed = await page.evaluate(() => ({
    other: document.querySelectorAll('.mrow .mnum')[2].value,
    read: document.querySelector('.mread')?.textContent ?? '',
    warn: document.querySelector('.mwarn')?.textContent ?? '',
  }));
  const fixedDelta = Number.parseFloat((fixed.read.match(/Δ neigh (\d+\.\d+)/) ?? [])[1] ?? 'NaN');
  ok('fixing solves the others from the fixed pair — or reports the clamp',
    (fixed.other !== alone.other && fixedDelta < 0.01) || fixed.warn.length > 0,
    `pair 2: ${alone.other} → ${fixed.other} · Δ ${fixedDelta}${fixed.warn ? ' · clamped' : ''}`);
  // The fix answers for the geometry too: a flush ring that collides is not a
  // fix, so the landed configuration has to read VALID — or the panel has to
  // say out loud why no heading could make it so.
  ok('and the fixed ring passes the geometry tests — or says why not',
    /geometry\s*VALID/.test(fixed.read.replace(/\s+/g, ' ')) || fixed.warn.length > 0,
    fixed.warn ? fixed.warn.slice(0, 80) : fixed.read.slice(0, 80));
}

// A judged best is the fit policy now. Seed this browser's own judgements
// with a ★ best whose pick is exactly where the engine held the bands — the
// one configuration the stub can weave — reload, and the page has to load it
// instead of walking candidates, naming the store and the chooser. The policy
// dropdown it replaced has to be gone.
const topLevel = Math.max(...size.stages.map(s => s.level));
await page.evaluate(({ key, judgement }) => {
  localStorage.setItem('mxn-fit-judgements', JSON.stringify([{ key, judgement }]));
}, {
  key: `picks/v3/lh-cw/${size.m}x${size.n}/${size.ks.join('_')}/s1-eauto-b400000`,
  judgement: {
    id: 'j-qa-best', verdict: 'best', source: 'hand', chooser: 'qa',
    at: '2026-08-16T00:00:00.000Z',
    levels: [{
      level: topLevel,
      // Extensions the stub will NOT weave — deliberately not the held ones.
      h: size.held.h.ext ? { ext: size.held.h.ext.map(e => e + 7), angle: null } : null,
      v: size.held.v.ext ? { ext: size.held.v.ext.map(e => e + 7), angle: null } : null,
    }],
    // The ring itself, and an audit to caption it. Deliberately NOT the
    // extensions the stub would agree to weave: the stub refuses every weave
    // except the baseline, so if this loads at all it can only be because the
    // stored strands were read rather than an engine asked. That refusal is
    // the assertion — a stub cannot fake a ring it declines to build.
    audit: { crossings: size.before.row.across, expected: size.before.row.expected,
             stray: 0, broken: 0 },
    strands: size.before.strands,
  },
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('button.go');
await page.fill('#fit-m', String(size.m));
await page.fill('#fit-n', String(size.n));
await page.fill('#fit-ks', size.ks.join(' '));
await page.click('button.go');
await page.waitForTimeout(1500);
const judged = await page.evaluate(() => ({
  status: document.querySelector('.status')?.textContent ?? '',
  dropdownsGone: !document.querySelector('#fit-tie') && !document.querySelector('#fit-sort'),
  button: document.querySelector('button.go')?.textContent ?? '',
  sortable: document.querySelectorAll('th.sortable').length,
  pointerOnPlainHeaders: [...document.querySelectorAll('th:not(.sortable)')]
    .some(th => getComputedStyle(th).cursor === 'pointer'),
}));
ok('a judged ★ best loads instead of the candidate walk',
  /Loaded the best fit/.test(judged.status) && /judged by qa/.test(judged.status),
  judged.status.slice(0, 110));
// And it loaded WITHOUT an engine: the seeded pick names extensions the stub
// refuses to weave, so reaching "ring read as stored" proves the strands
// stored with the judgement were used instead of a weave being asked for.
ok('a judgement carrying its ring is read, not re-woven',
  /ring read as stored/.test(judged.status), judged.status.slice(0, 110));
// The "after" card has to name where its ring came from. Captioning a person's
// ★ best as plain "fitted" was the page calling three provenances one thing.
const provenance = await page.evaluate(() => {
  const figures = [...document.querySelectorAll('.rings figure figcaption span')];
  return {
    after: figures.map(f => f.textContent).find(t => /best|fitted|adopted/i.test(t)) ?? '',
    levelCaptions: [...document.querySelectorAll('.levels figcaption var')]
      .map(v => v.textContent),
    judged: document.querySelectorAll('.panel table tbody tr td .tag').length,
    rowChooser: [...document.querySelectorAll('.panel table tbody tr')]
      .map(tr => tr.textContent).find(t => /qa/.test(t)) ?? '',
  };
});
ok('the after card names the ★ best and who judged it',
  /★ best/.test(provenance.after) && /qa/.test(provenance.after),
  provenance.after);
// The level strip must agree with the card above it about the same level.
ok('the fitted level in the strip says fitted, not fitting',
  provenance.levelCaptions.includes('fitted'),
  provenance.levelCaptions.join(' · ') || '(no captions)');
// And the judged-rings panel lists the judgement, chooser and all.
ok('the judged-rings panel lists the judgement',
  provenance.judged >= 1 && /qa/.test(provenance.rowChooser),
  provenance.rowChooser.replace(/\s+/g, ' ').slice(0, 80));

// Pressing "show" re-weaves that judgement and reports the engine's own count.
const showable = page.locator('tr', { has: page.locator('.tag') })
  .locator('button.minibtn').first();
if (await showable.count()) {
  await showable.click();
  await page.waitForTimeout(600);
  const shown = await page.evaluate(() => ({
    status: document.querySelector('.status')?.textContent ?? '',
    label: document.querySelector('tr.applied .minibtn')?.textContent ?? '',
  }));
  ok('pressing show weaves that judgement and reports the crossings',
    /crossings/.test(shown.status) && /qa/.test(shown.status),
    shown.status.slice(0, 90));
  ok('and the row it came from is marked as the one on screen',
    /shown/i.test(shown.label), shown.label.trim() || '(unmarked)');
}
ok('the fit-policy and sort dropdowns are gone', judged.dropdownsGone);
// The run button names what it does: with no worker url configured it must not
// claim to read Cloudflare, because it cannot.
ok('the run button says it loads the best fit, without claiming Cloudflare',
  /load best/i.test(judged.button) && !/cloudflare/i.test(judged.button),
  judged.button.trim());
// The sort survived the dropdown as clickable headings — and only the columns
// that sort may offer a pointer.
ok('the numeric columns are still sortable by clicking them', judged.sortable === 4,
  `${judged.sortable} sortable headings`);
ok('non-sorting headers do not pretend to be clickable',
  !judged.pointerOnPlainHeaders);

// With a worker url set, the button names the shelf it will read.
await page.fill('#fit-api', 'https://example.workers.dev');
await page.waitForTimeout(200);
const labelled = await page.evaluate(() =>
  document.querySelector('button.go')?.textContent ?? '');
ok('and names Cloudflare once a worker url is set', /cloudflare/i.test(labelled),
  labelled.trim());

// Switching bands changes which knobs are shown, not what has been moved. The
// V band was dragged above; on the H band, the diagram has to still be drawing
// that moved V band. Proven by difference: hash the H-band diagram with the V
// band moved, then reset V to the engine and hash it again. If the other band
// were redrawn from the engine's weave either way, the two would be identical.
const hashFigure = () => page.evaluate(() => {
  const canvas = document.querySelector('.mfig canvas');
  if (!canvas) return '';
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  let acc = 0;
  for (let i = 0; i < data.length; i += 4 * 61) acc = (acc * 31 + data[i]) >>> 0;
  return String(acc);
});
const bandTab = name => page.locator('.tabs button', { hasText: new RegExp(`^${name} band`) });
// This runs after the reload above, so the earlier drags are gone: move the V
// band again here, and the check owns its own setup.
await bandTab('V').click();
await page.waitForTimeout(300);
await page.locator('.mrow .mnum').nth(1).fill('120');
await page.waitForTimeout(400);
await bandTab('H').click();
await page.waitForTimeout(400);
const hWithMovedV = await hashFigure();
const legend = await page.evaluate(() =>
  document.querySelector('.mlegend')?.textContent ?? '');
ok('the legend says the other band is held where it was left',
  /vertical band is drawn where you left it/i.test(legend),
  legend.replace(/\s+/g, ' ').slice(-60));

await bandTab('V').click();
await page.waitForTimeout(300);
await page.locator('.mbtns button', { hasText: 'reset to engine' }).click();
await page.waitForTimeout(300);
await bandTab('H').click();
await page.waitForTimeout(400);
const hWithEngineV = await hashFigure();
ok('the diagram keeps the other band where the hand left it',
  hWithMovedV !== hWithEngineV && hWithMovedV !== '',
  `H-band diagram: V moved ${hWithMovedV} vs V reset ${hWithEngineV}`);

// ---------------------------------------------------------------------------
// The preload: a judged ★ best drawn on load, with no engine and no Run.
//
// The whole point of storing the ring inside a judgement was that reading one
// back should not cost a Pyodide boot — and until now it did anyway, because
// the best-fit lookup lived behind `generate`. These checks assert the fix the
// only way that means anything: the ring is on screen AND the worker was never
// spoken to. The stub counts its own messages, so "zero" is checkable.
// ---------------------------------------------------------------------------
const preloadKey = ks => `picks/v3/lh-cw/${size.m}x${size.n}/${ks.join('_')}/s1-eauto-b400000`;
const judgementFor = chooser => ({
  id: `j-qa-${chooser}`, verdict: 'best', source: 'hand', chooser,
  at: '2026-08-16T00:00:00.000Z',
  levels: [{ level: topLevel, h: null, v: null }],
  metrics: { neighbour_delta: 0.5, spread: 0.5, gap_margin: 1 },
  audit: { crossings: size.before.row.across, expected: size.before.row.expected,
           stray: 0, broken: 0 },
  strands: size.before.strands,
});
const zeroKs = size.ks.map(() => 0);
const strangeKs = size.ks.map(k => k + 3);

await page.evaluate(({ own, spare, ownKey, spareKey }) => {
  // No worker url: the shelf is unreachable from a sandbox, and the local
  // store exercises exactly the same readPicks path.
  localStorage.removeItem('mxn-lab-api');
  localStorage.setItem('mxn-fit-judgements', JSON.stringify([
    { key: ownKey, judgement: own }, { key: spareKey, judgement: spare },
  ]));
}, {
  own: judgementFor('qa'), spare: judgementFor('qa-default'),
  ownKey: preloadKey(size.ks), spareKey: preloadKey(zeroKs),
});

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('button.go');
await page.fill('#fit-m', String(size.m));
await page.fill('#fit-n', String(size.n));
await page.fill('#fit-ks', size.ks.join(' '));
// The lookup is debounced by 400ms, so this waits for it rather than racing it.
await page.waitForTimeout(1400);
const preloaded = await page.evaluate(() => {
  const panel = document.querySelector('.results .panel.hero');
  const canvas = panel?.querySelector('canvas');
  const inked = () => {
    if (!canvas) return 0;
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4 * 97) seen.add(`${data[i]},${data[i+1]},${data[i+2]}`);
    return seen.size;
  };
  return {
    title: panel?.querySelector('header strong')?.textContent ?? '',
    header: panel?.querySelector('header')?.textContent ?? '',
    line: document.querySelector('.hint.preloaded')?.textContent ?? '',
    fallbackChip: !!panel && /not your parameters/.test(panel.querySelector('header')?.textContent ?? ''),
    inked: inked(),
    engineCalls: window.__engineCalls ?? 0,
    prompt: document.body.textContent.includes('press Run and fit'),
  };
});
ok('a judged ★ best is drawn on load, with no Run pressed',
  /★ best/.test(preloaded.title) && preloaded.inked > 3,
  `${preloaded.title.trim()} · ${preloaded.inked} colours`);
ok('and the engine was never asked — no message reached the worker',
  preloaded.engineCalls === 0, `${preloaded.engineCalls} worker message(s)`);
ok('the sidebar says where the ring came from and who judged it',
  /judged by qa\b/.test(preloaded.line) && /No engine was run/.test(preloaded.line),
  preloaded.line.replace(/\s+/g, ' ').slice(0, 110));
ok('it is the typed parameters, so it is not flagged as a substitute',
  !preloaded.fallbackChip);
ok('and the "press Run" prompt gives way to the ring', !preloaded.prompt);

// Now parameters nobody judged: the k = 0 default stands in, says so, and does
// not quietly rewrite the field it is standing in for.
await page.fill('#fit-ks', strangeKs.join(' '));
await page.waitForTimeout(1400);
const fell = await page.evaluate(() => ({
  header: document.querySelector('.results .panel.hero header')?.textContent ?? '',
  line: document.querySelector('.hint.preloaded')?.textContent ?? '',
  ks: document.querySelector('#fit-ks')?.value ?? '',
  button: [...document.querySelectorAll('.results .panel.hero .minibtn')]
    .map(b => b.textContent.trim())[0] ?? '',
  engineCalls: window.__engineCalls ?? 0,
}));
ok('parameters with no best fall back to the k = 0 default',
  /not your parameters/.test(fell.header) && /qa-default/.test(fell.line),
  fell.line.replace(/\s+/g, ' ').slice(0, 110));
ok('the fallback does not silently rewrite the k field',
  fell.ks.replace(/[\s,]+/g, ' ').trim() === strangeKs.join(' '),
  `k stayed ${fell.ks}`);
ok('and it offers a button that does', /put .+ in the form/.test(fell.button), fell.button);
ok('the fallback cost no engine either', fell.engineCalls === 0,
  `${fell.engineCalls} worker message(s)`);

if (fell.button) {
  await page.locator('.results .panel.hero .minibtn').first().click();
  await page.waitForTimeout(1400);
  const adopted = await page.evaluate(() => ({
    ks: document.querySelector('#fit-ks')?.value ?? '',
    header: document.querySelector('.results .panel.hero header')?.textContent ?? '',
  }));
  ok('pressing it puts k = 0 in the form, and the card stops being a substitute',
    /0/.test(adopted.ks) && !/not your parameters/.test(adopted.header),
    `k = ${adopted.ks}`);
}

// The third rung. Nothing judged for the typed parameters and nothing for the
// k = 0 default either, but SOMETHING judged elsewhere — here a different size
// and the other hand. That has to stand in rather than leaving a full run as
// the only way to see a ring, which on a 4×1 is 194,502 combinations.
await page.evaluate(({ key, judgement }) => {
  localStorage.setItem('mxn-fit-judgements', JSON.stringify([{ key, judgement }]));
}, {
  key: `picks/v3/rh-ccw/${size.m + 1}x${size.n}/9/s1-eauto-b400000`,
  judgement: judgementFor('qa-elsewhere'),
});
await page.fill('#fit-ks', strangeKs.map(k => k + 2).join(' '));
await page.waitForTimeout(1600);
const elsewhere = await page.evaluate(() => ({
  header: document.querySelector('.results .panel.hero header')?.textContent ?? '',
  figure: document.querySelector('.results .panel.hero figcaption span')?.textContent ?? '',
  line: document.querySelector('.hint.preloaded')?.textContent ?? '',
  button: document.querySelector('.results .panel.hero .minibtn')?.textContent.trim() ?? '',
  m: document.querySelector('#fit-m')?.value ?? '',
  engineCalls: window.__engineCalls ?? 0,
}));
ok('a best judged for OTHER parameters stands in rather than a full run',
  /not your parameters/.test(elsewhere.header) && /qa-elsewhere/.test(elsewhere.line),
  elsewhere.line.replace(/\s+/g, ' ').slice(0, 120));
ok('and the card names the parameter set it actually belongs to',
  new RegExp(`${size.m + 1}×${size.n}`).test(elsewhere.figure)
  && /RH · CCW/.test(elsewhere.figure), elsewhere.figure);
ok('the shelf-wide search cost no engine either', elsewhere.engineCalls === 0,
  `${elsewhere.engineCalls} worker message(s)`);
ok('and it did not touch the size in the form', elsewhere.m === String(size.m),
  `m stayed ${elsewhere.m}`);
if (elsewhere.button) {
  await page.locator('.results .panel.hero .minibtn').first().click();
  await page.waitForTimeout(1600);
  const took = await page.evaluate(() => ({
    m: document.querySelector('#fit-m')?.value ?? '',
    hand: document.querySelector('.seg button[aria-pressed=true]')?.textContent ?? '',
    header: document.querySelector('.results .panel.hero header')?.textContent ?? '',
  }));
  ok('its button adopts the whole parameter set, not just the k',
    took.m === String(size.m + 1) && /RH/.test(took.hand)
    && !/not your parameters/.test(took.header),
    `m ${took.m} · hand ${took.hand.trim()}`);
}

// A parameter set nobody has judged at all: the page must say so rather than
// show a ring, and must still not reach for the engine on its own.
await page.evaluate(() => localStorage.setItem('mxn-fit-judgements', '[]'));
// A k sequence different from every one used above, so the lookup re-fires
// however the button check above left the field.
await page.fill('#fit-ks', strangeKs.map(k => k + 1).join(' '));
await page.waitForTimeout(1400);
const nothing = await page.evaluate(() => ({
  panel: !!document.querySelector('.results .panel.hero'),
  line: document.querySelector('.hint.preloaded')?.textContent ?? '',
  engineCalls: window.__engineCalls ?? 0,
}));
ok('with nothing judged anywhere the page says so and draws no ring',
  !nothing.panel && /Nothing has been judged/.test(nothing.line),
  nothing.line.replace(/\s+/g, ' ').slice(0, 110));
ok('and still runs no engine until Run is pressed', nothing.engineCalls === 0,
  `${nothing.engineCalls} worker message(s)`);

// ---------------------------------------------------------------------------
// A judgement that carries its PLAN opens the editor, with no run at all.
//
// Drawing a judged ring needed only its strands; moving one needs the band
// plan — origins, directions, pair indices, targets, the angle window — which
// until now arrived only from bridge.fit_plan, behind a browsing session. With
// the plan stored beside the strands the whole manual panel is reachable off
// one GET, because every function under it (placeStarts, sweepAngle, readAt,
// followPair, fixOthers, fitCandidates) takes a FitBand and nothing else.
//
// The stub's message counter is again what makes this checkable rather than
// plausible: knobs on screen AND zero messages to the worker.
// ---------------------------------------------------------------------------
await page.evaluate(({ key, judgement }) => {
  localStorage.setItem('mxn-fit-judgements', JSON.stringify([{ key, judgement }]));
}, {
  key: preloadKey(size.ks),
  judgement: { ...judgementFor('qa-planned'), plan: size.plans[String(topLevel)] },
});
await page.fill('#fit-m', String(size.m));
await page.fill('#fit-n', String(size.n));
await page.fill('#fit-ks', size.ks.join(' '));
await page.waitForTimeout(1600);
const edited = await page.evaluate(() => ({
  knobs: document.querySelectorAll('.mrow').length,
  nums: [...document.querySelectorAll('.mrow .mnum')].map(i => i.value),
  read: document.querySelector('.mread')?.textContent ?? '',
  heading: document.querySelector('.runbar h1')?.textContent ?? '',
  shelfChip: [...document.querySelectorAll('.runbar .chip')]
    .some(c => /off the shelf/i.test(c.textContent)),
  baseline: [...document.querySelectorAll('.rings figcaption span')]
    .map(s => s.textContent).find(t => /as judged|engine/.test(t)) ?? '',
  weave: (() => {
    const b = [...document.querySelectorAll('.mbtns button')]
      .find(x => /weave and audit/i.test(x.textContent));
    return b ? { text: b.textContent.trim(), disabled: b.disabled } : null;
  })(),
  apply: (() => {
    const b = [...document.querySelectorAll('.mbtns button')]
      .find(x => /apply/i.test(x.textContent));
    return b ? { text: b.textContent.trim(), disabled: b.disabled } : null;
  })(),
  rows: document.querySelectorAll('.panel table tbody tr').length,
  engineCalls: window.__engineCalls ?? 0,
}));
ok('a judgement carrying its plan opens the editor with no run',
  edited.knobs >= 2, `${edited.knobs} knob rows`);
ok('and the engine was still never asked', edited.engineCalls === 0,
  `${edited.engineCalls} worker message(s)`);
ok('the knobs open where the judged ring holds the bands',
  edited.nums.length >= 2 && edited.nums.every(v => v !== ''), edited.nums.join(', '));
ok('the live readout measures the judged configuration',
  /Δ neigh/.test(edited.read), edited.read.replace(/\s+/g, ' ').slice(0, 60));
ok('the runbar says the ring came off the shelf', edited.shelfChip);
ok('the baseline card says "as judged", not "engine"',
  /as judged/.test(edited.baseline) && !/· engine/.test(edited.baseline),
  edited.baseline);
// Weave-and-audit is gone: one press applies the knobs, and the engine is asked
// for the crossings only when a session already exists. What survives from the
// old claim is the part that mattered — the editor never offers a dead control.
ok('the editor offers apply, and does not offer a weave it cannot do',
  !!edited.apply && !edited.weave,
  `${edited.apply?.text?.trim() ?? '(no apply)'}${edited.weave ? ' · weave still present' : ''}`);

// Moving a knob has to move the numbers and the diagram, with no engine.
if (edited.knobs >= 3) {
  const before = await page.evaluate(() => ({
    other: document.querySelectorAll('.mrow .mnum')[2].value,
    read: document.querySelector('.mread')?.textContent ?? '',
  }));
  await page.locator('.mrow .mnum').nth(1).fill('130');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    other: document.querySelectorAll('.mrow .mnum')[2].value,
    read: document.querySelector('.mread')?.textContent ?? '',
    engineCalls: window.__engineCalls ?? 0,
    inked: (() => {
      const c = document.querySelector('.mfig canvas');
      if (!c) return 0;
      const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4 * 97) seen.add(`${data[i]},${data[i+1]},${data[i+2]}`);
      return seen.size;
    })(),
  }));
  ok('the coupling re-solves the other pair on a shelf-loaded ring',
    after.other !== before.other, `pair 2: ${before.other} → ${after.other}`);
  ok('and the readout follows it', after.read !== before.read,
    after.read.replace(/\s+/g, ' ').slice(0, 60));
  ok('the manual diagram is drawn from the judged strands, not blank',
    after.inked > 3, `${after.inked} colours`);
  ok('and none of that touched the engine either', after.engineCalls === 0,
    `${after.engineCalls} worker message(s)`);
}

// ---------------------------------------------------------------------------
// A run served from the cache still has to be fittable.
//
// The run artifact holds what `generate` RETURNED — stages and audit rows, all
// JSON. Every fit call reads what it LEFT BEHIND: the level checkpoints and
// band inputs that live in the engine's own memory. A cache hit that skipped
// the generate skipped the session with it, and the first fit died on "level 1
// has no browsing session; run generate first" — which the stub above now
// answers with, so this check can only pass if the session is opened.
//
// A fresh page, because the cache is read off a worker url in localStorage and
// this needs its own; the generate is slowed so the cached diagrams can be
// seen landing BEFORE the engine answers, which is the whole point of keeping
// the cache rather than deleting the read.
{
  const cachedPage = await browser.newPage({ viewport: { width: 1440, height: 1300 } });
  const cachedErrors = [];
  cachedPage.on('pageerror', e => cachedErrors.push(String(e)));
  await cachedPage.addInitScript(STUB, { size: STUB_SIZE, delay: 900 });
  await cachedPage.addInitScript(() =>
    localStorage.setItem('mxn-lab-api', 'https://example.workers.dev'));

  let runReads = 0;
  await cachedPage.route('**/cache/run/**', route => {
    runReads += 1;
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        kind: 'run', cacheVersion: 'v3',
        descriptor: { m: size.m, n: size.n, ks: size.ks, hand: 'lh', direction: 'cw',
                      shortArms: true, step: 'auto', budget: 400000 },
        computedAt: '2026-08-01T00:00:00.000Z', seconds: 12,
        result: { stages: size.stages, rows: size.rows },
      }),
    });
  });
  // Nothing else on the shelf: the judgements read has to miss, not hang.
  await cachedPage.route('**/cache/picks/**', route => route.fulfill({ status: 404, body: '' }));

  await cachedPage.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
  await cachedPage.waitForSelector('button.go');
  await cachedPage.fill('#fit-m', String(size.m));
  await cachedPage.fill('#fit-n', String(size.n));
  await cachedPage.fill('#fit-ks', size.ks.join(' '));
  await cachedPage.click('button.go');
  // Mid-flight: the engine has not answered yet, so anything on screen came
  // from the artifact.
  await cachedPage.waitForTimeout(400);
  const early = await cachedPage.evaluate(() => ({
    levels: document.querySelectorAll('.levels .level').length,
    status: document.querySelector('.status')?.textContent ?? '',
  }));
  ok('a cached run draws its levels before the engine answers', early.levels > 0,
    `${early.levels} cards · ${early.status.slice(0, 70)}`);

  await cachedPage.waitForTimeout(2500);
  const settled = await cachedPage.evaluate(() => ({
    status: document.querySelector('.status')?.textContent ?? '',
    knobs: document.querySelectorAll('.mrow').length,
    generates: window.__stubGenerates,
  }));
  ok('the cached run was read, not recomputed', runReads > 0, `${runReads} cache read(s)`);
  ok('and a cache hit still opens the browsing session the fit reads',
    !/no browsing session/.test(settled.status), settled.status.slice(0, 110));
  ok('so the fit reads its plan on top of a cached run', settled.knobs >= 2,
    `${settled.knobs} knob rows · one generate: ${settled.generates === 1}`);
  ok('no page errors on the cached-run path', cachedErrors.length === 0,
    cachedErrors.slice(0, 2).join(' | '));
  await cachedPage.close();
}

// ---------------------------------------------------------------------------
// The knobs without the search.
//
// The band plan is the space the search walks, not its result, so it exists
// before a single combination is tried — measured at 0.13s for a 4×1 against
// 280s for the generate Run waits on. This asserts the page uses that: knobs on
// screen with NO generate, which is checkable because the stub counts them.
// ---------------------------------------------------------------------------
{
  const fast = await browser.newPage({ viewport: { width: 1440, height: 1300 } });
  const fastErrors = [];
  fast.on('pageerror', e => fastErrors.push(String(e)));
  await fast.addInitScript(STUB, { size: STUB_SIZE, delay: 4000 });
  await fast.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
  await fast.waitForSelector('button.go');
  await fast.fill('#fit-m', String(size.m));
  await fast.fill('#fit-n', String(size.n));
  await fast.fill('#fit-ks', size.ks.join(' '));
  await fast.locator('button.go', { hasText: /no search/i }).click();
  await fast.waitForTimeout(1200);
  const opened = await fast.evaluate(() => ({
    knobs: document.querySelectorAll('.mrow').length,
    read: document.querySelector('.mread')?.textContent ?? '',
    generates: window.__stubGenerates ?? 0,
    status: document.querySelector('.status')?.textContent ?? '',
    // A search that never ran has no audit, and inventing one would be the
    // page asserting a ring closes when nothing checked it.
    audit: [...document.querySelectorAll('.stat')]
      .find(s => /ring audit/i.test(s.textContent))?.textContent ?? '',
  }));
  ok('the knobs open without the search running', opened.knobs >= 2,
    `${opened.knobs} knob rows`);
  ok('and no generate was asked for at all', opened.generates === 0,
    `${opened.generates} generate(s)`);
  ok('the readouts are live on the unsearched plan', /Δ neigh/.test(opened.read),
    opened.read.replace(/\s+/g, ' ').slice(0, 60));
  ok('the page says the search never ran', /never ran/.test(opened.status),
    opened.status.slice(0, 100));
  ok('and it claims no audit it did not do', /—/.test(opened.audit),
    opened.audit.replace(/\s+/g, ' ').slice(0, 60));
  // Dragging a knob has to move the numbers — the whole point is that this is
  // a working editor, not a picture of one.
  if (opened.knobs >= 3) {
    const before = await fast.evaluate(() =>
      document.querySelector('.mread')?.textContent ?? '');
    await fast.locator('.mrow .mnum').nth(1).fill('150');
    await fast.waitForTimeout(300);
    const after = await fast.evaluate(() => ({
      read: document.querySelector('.mread')?.textContent ?? '',
      generates: window.__stubGenerates ?? 0,
    }));
    ok('dragging an arm re-measures, still with no engine',
      after.read !== before && after.generates === 0,
      after.read.replace(/\s+/g, ' ').slice(0, 60));
  }
  ok('no page errors on the no-search path', fastErrors.length === 0,
    fastErrors.slice(0, 2).join(' | '));
  await fast.close();
}

// A stale cached worker is the realistic failure for any message type added
// after a deploy, and it used to be a permanent silent hang: the dispatcher
// returned without answering, so the page's promise never settled. This drives
// exactly that — a worker that knows nothing — and asserts the page comes back
// with something a reader can act on rather than sitting on "Working…".
{
  const stale = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const staleErrors = [];
  stale.on('pageerror', e => staleErrors.push(String(e)));
  await stale.addInitScript(() => {
    class Deaf {
      constructor() { this.onmessage = null; }
      // The old dispatcher's exact behaviour for a type it does not know.
      postMessage() {}
      terminate() {}
    }
    window.Worker = Deaf;
  });
  await stale.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
  await stale.waitForSelector('button.go');
  await stale.locator('button.go', { hasText: /no search/i }).click();
  await stale.waitForTimeout(1500);
  const stuck = await stale.evaluate(() => ({
    busy: !!document.querySelector('button.go')?.disabled,
    status: document.querySelector('.status')?.textContent ?? '',
  }));
  // The page cannot invent an answer, so it stays busy — but the REAL worker
  // now replies with an error instead of silence, which is what turns this
  // from a hang into a message. Asserted at the worker, below.
  ok('a deaf worker leaves the page waiting, which is why the worker must answer',
    stuck.busy, stuck.status.slice(0, 80) || '(no status)');
  await stale.close();
}
// The worker's own contract, read off the shipped file rather than mocked:
// an unknown type has to produce an error reply, and the fitter has to ask for
// a versioned URL so a cached worker is not what answers.
{
  const src = readFileSync(`${ROOT}public/mxn/exact-worker.js`, 'utf8');
  const unknown = src.slice(src.indexOf('const handler = HANDLERS[data.type]'));
  ok('the worker answers an unknown message type instead of dropping it',
    /if \(!handler\) \{[\s\S]{0,400}?type: "error"/.test(unknown),
    /if \(!handler\) return;/.test(unknown) ? 'still returns silently' : 'replies with an error');
  const fitter = readFileSync(`${ROOT}src/mxn-fit/fitter.tsx`, 'utf8');
  ok('and the fitter asks for a versioned worker, so a cached one cannot answer',
    /exact-worker\.js\?v=/.test(fitter),
    (fitter.match(/exact-worker\.js\?v=[\w.-]+/) ?? ['(unversioned)'])[0]);
}

// Apply. The hand finishes placing the arms and one press puts that exact ring
// in the after card — no weave, no adopt, and in the no-search mode no session
// to weave with. What it must NOT do is claim an audit nobody ran.
{
  const ap = await browser.newPage({ viewport: { width: 1440, height: 1300 } });
  const apErrors = [];
  ap.on('pageerror', e => apErrors.push(String(e)));
  await ap.addInitScript(STUB, { size: STUB_SIZE, delay: 0 });
  await ap.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
  await ap.waitForSelector('button.go');
  await ap.fill('#fit-m', String(size.m));
  await ap.fill('#fit-n', String(size.n));
  await ap.fill('#fit-ks', size.ks.join(' '));
  await ap.locator('button.go', { hasText: /no search/i }).click();
  await ap.waitForTimeout(1200);
  const gone = await ap.evaluate(() => ({
    weave: [...document.querySelectorAll('.mbtns button')]
      .some(b => /weave and audit/i.test(b.textContent)),
    adopt: [...document.querySelectorAll('.mbtns button')]
      .some(b => /adopt as fitted/i.test(b.textContent)),
    apply: [...document.querySelectorAll('.mbtns button')]
      .find(b => /apply/i.test(b.textContent))?.disabled,
  }));
  ok('weave and audit is gone from the knobs', !gone.weave);
  ok('and so is adopt as fitted', !gone.adopt);
  ok('apply waits until a knob has been moved', gone.apply === true);
  // Move an arm, apply, and the after card has to hold that exact ring.
  await ap.locator('.mrow .mnum').nth(1).fill('120');
  await ap.waitForTimeout(300);
  const armed = await ap.evaluate(() => [...document.querySelectorAll('.mbtns button')]
    .find(b => /apply/i.test(b.textContent))?.disabled);
  ok('and lights up once one has', armed === false);
  await ap.locator('.mbtns button', { hasText: /apply/i }).click();
  await ap.waitForTimeout(800);
  const applied = await ap.evaluate(() => {
    const cards = [...document.querySelectorAll('.rings figure')];
    const after = cards[1];
    const canvas = after?.querySelector('canvas');
    const inked = () => {
      if (!canvas) return 0;
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4 * 97) seen.add(`${data[i]},${data[i+1]},${data[i+2]}`);
      return seen.size;
    };
    return {
      title: after?.querySelector('figcaption span')?.textContent ?? '',
      inked: inked(),
      generates: window.__stubGenerates ?? 0,
      audit: [...document.querySelectorAll('.stat')]
        .find(s => /ring audit/i.test(s.textContent))?.textContent ?? '',
      status: document.querySelector('.status')?.textContent ?? '',
    };
  });
  ok('apply fills the after card with a drawn ring',
    applied.inked > 3 && /adopted by hand|hand/i.test(applied.title),
    `${applied.title.trim()} · ${applied.inked} colours`);
  ok('and it did so with no engine at all', applied.generates === 0,
    `${applied.generates} generate(s)`);
  ok('and claims no audit, because nothing audited it', /—/.test(applied.audit),
    applied.audit.replace(/\s+/g, ' ').slice(0, 60));
  ok('the status says the ring stands but is ungraded',
    /audited|crossings|Run/i.test(applied.status), applied.status.slice(0, 90));
  ok('no page errors on the apply path', apErrors.length === 0,
    apErrors.slice(0, 2).join(' | '));
  await ap.close();
}

// ---------------------------------------------------------------------------
// A level 1 fixed here is remembered, and the next Run stands on it.
//
// This is the report that produced the whole store: fix L1 by hand, come back,
// and the run rebuilt the engine's default under it — the ladder starting over
// with nothing anywhere saying so. So a saved stack is seeded the way fixLevel
// writes one, the page reloaded, and Run pressed. What has to happen: the
// generate is handed the saved ring as level1Ring, the ladder's first rung
// reads as fixed · placed by hand again, and the run opens at L2 — the level
// the reader was about to edit on top of that L1.
// ---------------------------------------------------------------------------
{
  const back = await browser.newPage({ viewport: { width: 1440, height: 1300 } });
  const backErrors = [];
  back.on('pageerror', e => backErrors.push(String(e)));
  await back.addInitScript(STUB, { size: STUB_SIZE, delay: 0 });
  const fixedKey = `v3/lh-cw/${size.m}x${size.n}/${size.ks.join('_')}/s1-eauto-b400000`;
  await back.addInitScript(stack => {
    localStorage.setItem('mxn-fit-fixed', JSON.stringify([stack]));
  }, {
    key: fixedKey, at: '2026-08-18T00:00:00.000Z', ks: size.ks,
    levels: [{
      level: 1,
      h: size.held.h.ext ? { ext: size.held.h.ext, angle: null } : null,
      v: size.held.v.ext ? { ext: size.held.v.ext, angle: null } : null,
      at: '2026-08-18T00:00:00.000Z', rebuilt: true, origin: 'hand',
      audit: { crossings: size.before.row.across,
               expected: size.before.row.expected, stray: 0, broken: 0 },
      strands: size.stages.find(s => s.level === 1).strands,
    }],
  });
  await back.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
  await back.waitForSelector('button.go');
  await back.fill('#fit-m', String(size.m));
  await back.fill('#fit-n', String(size.n));
  await back.fill('#fit-ks', size.ks.join(' '));
  await back.click('button.go');
  await back.waitForTimeout(1500);
  const restored = await back.evaluate(() => {
    const rungs = [...document.querySelectorAll('.ladder .rung')];
    return {
      ring: window.__l1ring,
      states: rungs.map(r => r.dataset.state),
      first: rungs[0]?.textContent.replace(/\s+/g, ' ').trim() ?? '',
      current: rungs.findIndex(r => r.dataset.current) + 1,
    };
  });
  ok('the run hands the remembered L1 to generate as the ring to adopt',
    !!restored.ring && Array.isArray(restored.ring.strands)
    && restored.ring.strands.length > 0,
    restored.ring ? `${restored.ring.strands.length} strands` : '(no ring sent)');
  ok('the first rung reads as fixed · placed by hand again',
    restored.states[0] === 'fixed' && /placed by hand/.test(restored.first),
    restored.first.slice(0, 60));
  ok('and the run opens at L2, on top of the restored L1',
    restored.current === 2, `rung ${restored.current}`);
  ok('no page errors on the remembered-fix path', backErrors.length === 0,
    backErrors.slice(0, 2).join(' | '));
  await back.close();
}

ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
if (network.length) console.log(`  note  ${network.length} resource(s) blocked by the environment, not the page`);

await page.screenshot({ path: `${SHOTS}/fit-page.png`, fullPage: true });
console.log(`\n  shot: ${SHOTS}/fit-page.png`);
console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nall ${pass} checks passed`);
await browser.close();
process.exit(fail ? 1 : 0);
