// Jev, fixed: full coordinates of every level below, the reader's notes, the
// candidates' own coordinates, and three parameters (tip, fold-end rung, next-start rung).
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import fs from 'fs';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const S = '/tmp/claude-0/-home-user-Scoubidou3D/cce33b8d-6061-5f4c-8981-6631887cc2ff/scratchpad/';
const locksFile = process.argv[2]; // optional: the reader's Copy JSON
const prior = locksFile ? JSON.parse(fs.readFileSync(locksFile, 'utf8')) : { locked: [] };
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('file:///home/user/Scoubidou3D/artifacts/built/twist-1x1-steps.html');
await p.waitForTimeout(2000);
const step = prior.locked.length + 1;
const ask = (payload) => JSON.parse(execFileSync('python3', [new URL('./jev_ask.py', import.meta.url).pathname], { input: JSON.stringify(payload), encoding: 'utf8' }));
const evalCand = (c) => p.evaluate(([locked, step, c]) => {
  const st = window.__st.state;
  st.locks = Array(9).fill(null);
  for (const k of locked) st.locks[k.level - 1] = { tip: k.tipPx, out: k.foldEndsOn, in: k.nextArmsStartOn, note: k.note ?? '' };
  st.step = step; st.cur = { tip: c.tip, out: c.out, in: c.in, note: '' };
  window.__st.render();
  const o = JSON.parse(document.getElementById('out').value);
  return { readings: o.onScreen.readings, coordinates: o.coordinates };
}, [prior.locked, step, c]);
// stage 1: the tip, heights at their defaults
const def = { out: step === 2 ? 0 : -1, in: 1 };
const tips = []; for (let t = 42; t <= 66; t += 2) tips.push(t);
const below = (await evalCand({ tip: 52, ...def })).coordinates.filter(c => c.locked);
const cands = {};
for (const tip of tips) {
  const r = await evalCand({ tip, ...def });
  cands[String(tip)] = { tip_px: tip, turn_into_next_deg: +(2 * Math.atan(28 / tip) * 180 / Math.PI).toFixed(2), readings: r.readings,
    new_strands: r.coordinates.filter(c => !c.locked).map(({ id, level, start, end, z }) => ({ id, level, start, end, z })) };
}
const notes = prior.locked.filter(k => k.note).map(k => ({ level: k.level, note: k.note }));
// What the reader actually chose at each level, against what was suggested to them. Their
// choice is the ground truth: a suggestion they overrode is a suggestion that was wrong.
const sugg = JSON.parse(fs.readFileSync(new URL('../suggest.json', import.meta.url), 'utf8'));
const history = prior.locked.map(k => ({ level: k.level, reader_chose: { tip_px: k.tipPx, fold_ends_on: k.foldEndsOn, next_arms_start_on: k.nextArmsStartOn },
  was_suggested: sugg.levels?.[String(k.level)]?.params ?? null }));
const base = { stitch: '1x1 twist, two laces (sets 1 and 2), each level is 4 arms in a # at a 56 px gap, ribbon 46 px wide and 26 px thick; levels stack one storey (52 px) apart',
  deciding_level: step, levels_below_coordinates: below, reader_notes: notes, reader_choices_so_far: history,
  rule: 'The reader is the judge. Where the reader overrode a suggestion, continue THEIR choices, not the suggestion.' };
const r1 = ask({ state: { ...base, candidates: cands }, question: `Which fold-tip reach for level ${step}? (it sets the turn into level ${step + 1})`,
  goal: 'Pick the candidate whose new strands continue the column below as a real twist: the arms of the new level should sit on the level below the way the earlier levels sit on theirs, no ribbon passing through another, every crossing woven with the right lace on top. Use the coordinates, not only the readings, and respect the reader notes.',
  choices: Object.fromEntries(Object.entries(cands).map(([k, v]) => [k, `tip ${k} px, turn ${v.turn_into_next_deg} deg; readings: ${JSON.stringify(v.readings)}`])) });
const tip = +r1.choice;
// stage 2: the heights at that tip
const hc = {};
for (const out of [-2, -1, 0, 1]) for (const inn of [0, 1, 2, 3]) {
  const r = await evalCand({ tip, out, in: inn });
  hc[`${out}|${inn}`] = { readings: r.readings, z_new: r.coordinates.filter(c => !c.locked).map(c => ({ id: c.id, z: c.z })) };
}
const r2 = ask({ state: { ...base, tip_px: tip, candidates: hc }, question: `At tip ${tip}, where should level ${step}'s fold ends rest and level ${step + 1}'s arms start (rungs of half a thickness)?`,
  goal: 'The fold must rise from this level to the next without the ribbon passing through the arm it crosses or the level below, and without leaving a gap a real lace would not have.',
  choices: Object.fromEntries(Object.entries(hc).map(([k, v]) => { const [o, i] = k.split('|'); return [k, `ends on ${o}, next starts on ${i}; readings: ${JSON.stringify(v.readings)}`]; })) });
const [out, inn] = r2.choice.split('|').map(Number);
const top = (r) => Object.entries(r.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (${(v * 100).toFixed(0)}%)`).join(', ');
const res = { step, tip, out, in: inn, tipTop3: top(r1), heightTop3: top(r2), conf: [r1.confidence, r2.confidence] };
console.log(JSON.stringify(res));
const sug = JSON.parse(fs.readFileSync('/home/user/Scoubidou3D/artifacts/twist-1x1-steps/suggest.json', 'utf8'));
sug.levels[String(step)] = { params: { tip, out, in: inn }, from: `Jev (tip: ${top(r1)}; heights: ${top(r2)})` };
fs.writeFileSync('/home/user/Scoubidou3D/artifacts/twist-1x1-steps/suggest.json', JSON.stringify(sug, null, 1) + '\n');
await b.close();
