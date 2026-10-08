// The 1×1 twist decided ONE LEVEL AT A TIME, with the reader in the loop.
//
// Every level is the landing law at the 56 px gap (`twistColumnTurns`): what is
// open at each step is how far out this level's folds sit — which is the turn
// into the next level — and where in height its fold ends and the next level's
// arms start. Earlier levels are locked as the reader left them. Nothing is
// guessed for them: the column is rebuilt on the studio's own view, read back off
// the ribbons, and Copy hands every decision, every note and the full coordinates
// of every locked level back — the coordinates are what Jev is given to propose
// the next level from.
import { StrandScene } from '../../src/scene/StrandScene';
import { twistColumnDecided } from '../../src/model/twistplaced';
import SUGGEST from './suggest.json';

const RUNG = 0.5;
const SCALE = 0.02;
const STEPS = 9; // nine folds take a column to level 10
const HALF = 28; // every arm sits 28 px off the centre (half the 56 px gap)
const EDGE = HALF + 23; // the crossing arm's far edge
const STORE = 'twist-1x1-steps';

const tipToTurn = (tip) => (2 * Math.atan(HALF / tip) * 180) / Math.PI;
const layer = (id) => Number(id.split('_')[1]);
const levelOf = (id) => (layer(id) < 4 ? 1 : Math.floor((layer(id) - 2) / 2) + 1);
const lace = (id) => id.split('_')[0];
/** The arms of level L — the strands whose ends are its folds. */
const armsOf = (L) => (L === 1 ? [2, 3] : [2 * L, 2 * L + 1]);

const fresh = (step) => ({ tip: 52, out: step === 2 ? 0 : -1, in: 1, note: '' }); // the box's planes: ends on -1, the next arms on +1, level 2's ends on 0
const state = { hand: 'rh', step: 1, only: true, locks: Array(STEPS).fill(null), cur: fresh(1), fold: -1 };
try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
  if (saved && Array.isArray(saved.locks) && saved.locks.length === STEPS) Object.assign(state, saved, { fold: -1 });
} catch { /* nothing saved: defaults */ }
// Levels the reader decided in the conversation, carried into the page so it
// opens where they left off. A lock already in this browser wins.
for (const k of SUGGEST?.locks ?? []) {
  if (!state.locks[k.level - 1]) state.locks[k.level - 1] = { tip: k.tipPx, out: k.foldEndsOn, in: k.nextArmsStartOn, note: k.note ?? '' };
}
if (state.locks[state.step - 1] && state.step < STEPS) {
  let s = 1;
  while (s < STEPS && state.locks[s - 1]) s++;
  state.step = s;
  state.cur = fresh(s);
}
// A suggestion I was handed for the step the reader is on wins over the default,
// but never over something the reader already set and left.
function applySuggestion() {
  const s = SUGGEST?.levels?.[String(state.step)];
  if (s && !state.locks[state.step - 1] && !state.cur.touched) state.cur = { ...state.cur, ...s.params, from: s.from };
}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ ...state, fold: -1 })); } catch { /* fine */ } };

const view = new StrandScene(document.getElementById('c'));
view.renderer.shadowMap.enabled = false;
const $ = (id) => document.getElementById(id);

/** What level i is set to: locked, or — for the step on screen — the controls. */
const at = (i) => (i === state.step ? state.cur : state.locks[i - 1] ?? fresh(i));

function build() {
  const levels = state.step + 1;
  const decisions = [];
  for (let i = 1; i < levels; i++) decisions.push({ tip: at(i).tip, out: at(i).out, in: at(i).in });
  return twistColumnDecided(levels, decisions, `Twist 1×1, level ${state.step} of 9`, state.hand);
}

function show(sc) {
  const keep = (id) => !state.only || levelOf(id) >= state.step;
  view.setScene({ ...sc, strands: sc.strands.map((s) => ({ ...s, visible: keep(s.id) })) }, false);
  const map = new Map(Object.entries(sc.planes ?? {}).map(([id, r]) => [id, { in: r * RUNG, out: r * RUNG }]));
  for (const [id, e] of Object.entries(sc.planeEnds ?? {})) {
    const rest = sc.planes?.[id] ?? 0;
    map.set(id, { in: (e.in ?? rest) * RUNG, out: (e.out ?? rest) * RUNG });
  }
  view.setSublevels(map.size ? map : null);
  const cross = Object.entries(sc.crossPlanes ?? {});
  view.setCrossingPlanes(cross.length ? new Map(cross.map(([k, r]) => [k, r * RUNG])) : null);
}

function nearest(line, x, y) {
  let best = line[0];
  let d = Infinity;
  for (const q of line) {
    const e = (q.x - x) ** 2 + (q.y - y) ** 2;
    if (e < d) { d = e; best = q; }
  }
  return best;
}

/** This level's fold ends, the next level's crossings, and any ribbons through each other. */
function readBack(sc) {
  const L = state.step;
  const lines = {};
  for (const s of sc.strands) lines[s.id] = view.getStrandCentrelineWorld(s.id);
  const th = view.getThicknessWorld();
  const rows = [];
  // the fold ends of level L, against the other lace's arms on level L
  const folds = [];
  for (const s of sc.strands) {
    if (levelOf(s.id) !== L || !armsOf(L).includes(layer(s.id))) continue;
    const E = lines[s.id][lines[s.id].length - 1];
    let g = Infinity;
    for (const t of sc.strands) {
      if (levelOf(t.id) !== L || lace(t.id) === lace(s.id) || layer(t.id) < 2) continue;
      for (const q of lines[t.id]) g = Math.min(g, Math.hypot(E.x - q.x, E.y - q.y) / SCALE - 23);
    }
    folds.push({ id: s.id, g });
  }
  const worst = Math.min(...folds.map((f) => f.g));
  rows.push(['Fold ends vs the arm they cross', folds.map((f) => `${f.id} ${f.g >= 0 ? '+' : '−'}${Math.abs(f.g).toFixed(0)}`).join(', ') + ' px', worst >= 0]);
  for (const lv of [L, L + 1]) {
    let n = 0, right = 0, tight = Infinity;
    for (const c of view.getCrossPoints()) {
      if (lace(c.aId) === lace(c.bId) || !c.woven || levelOf(c.aId) !== lv || levelOf(c.bId) !== lv) continue;
      const over = c.overIndex === c.aIndex ? c.aId : c.bId;
      const under = over === c.aId ? c.bId : c.aId;
      const gap = (nearest(lines[over], c.x, c.y).z - nearest(lines[under], c.x, c.y).z) / th;
      n++;
      if (gap > -0.05) right++;
      tight = Math.min(tight, gap);
    }
    rows.push([`Level ${lv} crossings`, n ? `${right} of ${n} with the top lace on top, tightest ${tight.toFixed(2)} th` : '—', right === n]);
  }
  // two ribbons through each other: centrelines within half a width in plan and less than 20 px in height
  const ids = sc.strands.filter((s) => levelOf(s.id) >= L).map((s) => s.id);
  const parent = Object.fromEntries(sc.strands.map((s) => [s.id, s.parentId]));
  const hits = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j];
      if (parent[a] === b || parent[b] === a) continue;
      if (levelOf(a) === 1 && levelOf(b) === 1) continue; // the block's own, as box + strand has them
      let w = 0;
      for (const P of lines[a]) for (const Q of lines[b]) {
        const dxy = Math.hypot(P.x - Q.x, P.y - Q.y) / SCALE;
        const dz = Math.abs(P.z - Q.z) / SCALE;
        if (dxy < 23 && dz < 20) w = Math.max(w, Math.min(23 - dxy, 20 - dz));
      }
      if (w > 3) hits.push(`${a}/${b} ${Math.round(w)} px`);
    }
  }
  rows.push(['Passing through', hits.length ? hits.join(', ') : 'none', !hits.length]);
  return { rows, folds, worst, hits };
}

/** Every strand up to the level above the one on screen, in plan and in height — what Jev is handed. */
function coordinates(sc) {
  const out = [];
  for (const s of sc.strands) {
    if (levelOf(s.id) > state.step + 1) continue;
    // the woven line, built for hidden strands too — a level hidden on screen still has its heights
    const line = view.wovenLines?.[sc.strands.indexOf(s)] ?? view.getStrandCentrelineWorld(s.id);
    const z = (q) => +(q.z / SCALE).toFixed(1);
    out.push({
      id: s.id,
      level: levelOf(s.id),
      locked: levelOf(s.id) < state.step,
      start: { x: +s.start.x.toFixed(1), y: +s.start.y.toFixed(1) },
      end: { x: +s.end.x.toFixed(1), y: +s.end.y.toFixed(1) },
      z: line ? { start: z(line[0]), mid: z(line[Math.floor(line.length / 2)]), end: z(line[line.length - 1]) } : null,
      parent: s.parentId,
    });
  }
  return out;
}

function stepper() {
  const host = $('stepper');
  host.textContent = '';
  for (let L = 1; L <= STEPS; L++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `Level ${L}`;
    b.setAttribute('aria-pressed', String(L === state.step));
    if (state.locks[L - 1]) b.classList.add('done');
    b.disabled = L > 1 && !state.locks[L - 2] && L !== state.step;
    b.addEventListener('click', () => go(L));
    host.appendChild(b);
  }
}

function rungs(host, options, value, set) {
  host.textContent = '';
  for (const r of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0';
    b.setAttribute('aria-pressed', String(r === value));
    b.addEventListener('click', () => set(r));
    host.appendChild(b);
  }
}

function controls() {
  const L = state.step;
  const c = state.cur;
  $('top-level').textContent = String(L + 1);
  $('this-title').textContent = `Level ${L}: its folds, and the turn into level ${L + 1}`;
  $('tip').value = String(c.tip);
  $('tipn').value = String(c.tip);
  $('derived').innerHTML =
    `Tip <b>${c.tip.toFixed(1)} px</b> out → level ${L + 1} turned <b>${tipToTurn(c.tip).toFixed(2)}°</b> from level ${L}` +
    ` · ${c.tip - EDGE >= 0 ? `${(c.tip - EDGE).toFixed(1)} px past` : `${(EDGE - c.tip).toFixed(1)} px short of`} the crossing arm's far edge` +
    (c.from ? `<br>Opened on <b>${c.from}</b>'s suggestion.` : '');
  $('out-label').textContent = `Level ${L}'s fold ends rest on`;
  $('in-label').textContent = `Level ${L + 1}'s arms start on`;
  rungs($('outs'), [-2, -1, 0, 1], c.out, (r) => { state.cur.out = r; touch(); });
  rungs($('ins'), [0, 1, 2, 3], c.in, (r) => { state.cur.in = r; touch(); });
  $('note').value = c.note ?? '';
  const marks = $('marks');
  marks.textContent = '';
  for (const [label, tip] of [['engine 38', 38], ['engine 48', 48], ['just clear 52', 52], ['current 60', 60]]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = label;
    b.addEventListener('click', () => { state.cur.tip = tip; touch(); });
    marks.appendChild(b);
  }
}

let current = null;
let framedStep = 0;
function render() {
  const sc = build();
  current = sc;
  show(sc);
  if (framedStep !== state.step) { frameLevel(); framedStep = state.step; }
  const r = readBack(sc);
  const host = $('read');
  host.textContent = '';
  for (const [k, v, ok] of r.rows) {
    const tr = document.createElement('tr');
    const a = document.createElement('td'); a.textContent = k;
    const b = document.createElement('td'); b.textContent = v; b.className = ok ? 'ok' : 'off';
    tr.append(a, b);
    host.appendChild(tr);
  }
  const clean = r.rows.every((x) => x[2]);
  $('verdict').textContent = clean ? `Level ${state.step} reads clean off the ribbons — whether it LOOKS right is yours to say.` : 'Something on this level reads wrong — see the red rows.';
  $('verdict').className = clean ? 'ok' : 'off';
  state.cur.readings = Object.fromEntries(r.rows.map(([k, v]) => [k, v]));
  foldButtons(r.folds);
  stepper();
  controls();
  for (const [attr, value] of [['hand', state.hand], ['only', String(state.only)]]) {
    document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  }
  $('out').value = output(sc);
  save();
}

function output(sc) {
  const locked = state.locks
    .map((k, i) => (k ? { level: i + 1, tipPx: k.tip, turnIntoNextDeg: +tipToTurn(k.tip).toFixed(2), foldEndsOn: k.out, nextArmsStartOn: k.in, note: k.note || undefined, readings: k.readings } : null))
    .filter(Boolean);
  return JSON.stringify({
    what: 'twist 1×1, decided level by level (tip = how far out a level folds; it sets the turn into the next level; heights in rungs of half a thickness)',
    hand: state.hand,
    locked,
    onScreen: { level: state.step, tipPx: state.cur.tip, turnIntoNextDeg: +tipToTurn(state.cur.tip).toFixed(2), foldEndsOn: state.cur.out, nextArmsStartOn: state.cur.in, note: state.cur.note || undefined, readings: state.cur.readings },
    coordinates: coordinates(sc),
  }, null, 1);
}

let timer = null;
function touch() {
  state.cur.touched = true;
  clearTimeout(timer);
  timer = setTimeout(render, 90);
  controls();
}

function go(L) {
  if (L === state.step) return;
  if (!state.locks[state.step - 1]) state.locks[state.step - 1] = null; // leaving unlocked: the controls are dropped
  state.step = L;
  state.cur = state.locks[L - 1] ? { ...state.locks[L - 1] } : fresh(L);
  applySuggestion();
  render();
}

// ---- the camera -------------------------------------------------------------
function frameLevel() {
  view.fitView();
}
function foldButtons(folds) {
  const host = $('folds');
  host.textContent = '';
  folds.forEach((f, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `Fold ${i + 1}`;
    b.title = `the fold at the end of ${f.id}`;
    b.setAttribute('aria-pressed', String(state.fold === i));
    b.addEventListener('click', () => { state.fold = i; aimAt(f.id); foldButtons(folds); });
    host.appendChild(b);
  });
}
function aimAt(id) {
  const line = view.getStrandCentrelineWorld(id);
  if (!line) return;
  const tip = line[line.length - 1];
  // look at the fold from outside the column and a little above, so the arm it crosses is in front of it
  let cx = 0, cy = 0, n = 0;
  for (const s of current.strands) {
    if (levelOf(s.id) !== state.step || layer(s.id) < 2) continue;
    const l = view.getStrandCentrelineWorld(s.id);
    if (!l) continue;
    cx += l[l.length - 1].x; cy += l[l.length - 1].y; n++;
  }
  cx /= n || 1; cy /= n || 1;
  let ox = tip.x - cx, oy = tip.y - cy;
  const ol = Math.hypot(ox, oy) || 1;
  ox /= ol; oy /= ol;
  view.controls.target.set(tip.x, tip.y, tip.z);
  view.camera.position.set(tip.x + ox * 2.6, tip.y + oy * 2.6, tip.z + 1.8);
  view.controls.update();
}

// ---- wiring -----------------------------------------------------------------
$('tip').addEventListener('input', (e) => { state.cur.tip = +e.target.value; touch(); });
$('tipn').addEventListener('change', (e) => {
  const v = Math.min(78, Math.max(34, +e.target.value));
  if (Number.isFinite(v)) { state.cur.tip = v; touch(); }
});
$('note').addEventListener('input', (e) => { state.cur.note = e.target.value; state.cur.touched = true; $('out').value = output(current); save(); });
$('lock').addEventListener('click', () => {
  state.locks[state.step - 1] = { ...state.cur };
  if (state.step < STEPS) go(state.step + 1);
  else render();
});
$('back').addEventListener('click', () => { if (state.step > 1) go(state.step - 1); });
for (const attr of ['hand', 'only']) {
  document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.addEventListener('click', () => {
    state[attr] = attr === 'only' ? b.dataset[attr] === 'true' : b.dataset[attr];
    if (attr === 'hand') framedStep = 0;
    render();
  }));
}
$('v-fit').addEventListener('click', () => { state.fold = -1; view.fitView(); });
$('v-plan').addEventListener('click', () => { state.fold = -1; view.topView(); });
$('v-side').addEventListener('click', () => {
  state.fold = -1;
  view.fitView();
  const t = view.controls.target;
  const d = view.camera.position.distanceTo(t);
  view.camera.position.set(t.x + 0.12 * d, t.y - 0.98 * d, t.z + 0.16 * d);
  view.controls.update();
});
$('copy').addEventListener('click', async () => {
  const out = $('out');
  const msg = $('copied');
  try {
    await navigator.clipboard.writeText(out.value);
    msg.textContent = 'Copied. Paste it to Claude.';
  } catch {
    out.focus();
    out.select();
    msg.textContent = 'Selected. Press Ctrl+C (⌘C) to copy.';
  }
});

function paintTheme() {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  view.setTheme(dark ? 'dark' : 'light');
}
paintTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);
new MutationObserver(paintTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

window.__st = { state, render, go }; // test hook
applySuggestion();
render();
$('loading').remove();
