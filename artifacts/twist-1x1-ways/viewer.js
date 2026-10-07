// The 1×1 twist with its turn opened up, level by level.
//
// A twist column turns every level by one angle (50.03° on the 1×1). Here each
// level gets its own: slider L is how far level L is turned from level L − 1. The
// column is rebuilt on every change by `twistColumnTurnsPlaced` — the twist's own
// construction with that one number per level, placed by the box rules — on the
// studio's own view, and read back: which crossings have the right lace on top,
// which arms the landing law left too short to cross their band, and which ribbons
// pass through each other. Copy hands back the angles exactly.
import { StrandScene } from '../../src/scene/StrandScene';
import { twistColumnTurnsPlaced, twistColumnTurns, TWIST_LEVEL2_END } from '../../src/model/twistplaced';
import { boxPlacements } from '../../src/model/boxmn';
import { INDIGO, WEFT, columnTurn } from '../../src/model/twofan';
import { ringColumn } from '../../src/model/ringcolumn';
import RING from './engine-ring.json';

const RUNG = 0.5;
const SCALE = 0.02;
const MAXL = 10;
const DEFAULT = +columnTurn(1, 1).toFixed(2);
const STORE = 'twist-1x1-ways';
const HALF = 28; // half the 56 px gap between a lace's two arms: every arm sits 28 px off the centre
const EDGE = HALF + 23; // the far edge of the arm it crosses: 51 px from the centre
/** The landing law on the 1×1: a fold tip sits HALF·cot(θ/2) from the centre when the next level is turned θ. */
const tipOf = (deg) => HALF / Math.tan((deg * Math.PI) / 360);
const turnFor = (tip) => (2 * Math.atan(HALF / tip) * 180) / Math.PI;
// Where the engine's own 1×1 rings put it: 72.9° out of the block (tip 38), then ~60.6° (tip 48).
const ENGINE_TURNS = [72.9, ...Array(MAXL - 2).fill(60.6)];
const PRESETS = {
  current: { label: 'Current build', turns: Array(MAXL - 1).fill(DEFAULT) },
  engine: { label: 'Engine turns', turns: ENGINE_TURNS },
  clear: { label: 'Tips just clear', turns: Array(MAXL - 1).fill(+turnFor(EDGE + 1).toFixed(2)) },
};

const layer = (id) => Number(id.split('_')[1]);
const levelOf = (id) => (layer(id) < 4 ? 1 : Math.floor((layer(id) - 2) / 2) + 1);
const lace = (id) => id.split('_')[0];

const state = { levels: MAXL, hand: 'rh', build: 'fix', only: false, source: 'turns', turns: Array(MAXL - 1).fill(DEFAULT), focus: null };
try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
  if (saved && Array.isArray(saved.turns) && saved.turns.length === MAXL - 1) Object.assign(state, saved, { focus: null });
} catch { /* nothing saved, or no storage: defaults */ }
const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ ...state, focus: null })); } catch { /* fine */ } };

const view = new StrandScene(document.getElementById('c'));
view.renderer.shadowMap.enabled = false;

function engineScene() {
  const sc = ringColumn(RING, state.levels - 1, `Engine rings, ${state.levels} levels`, { first: WEFT[0], second: INDIGO }, state.hand);
  if (state.build === 'none') return sc;
  const pl = boxPlacements(sc, 1, false, 'hand');
  if (state.build === 'fix' && state.levels > 2) {
    const ends = { ...(pl.planeEnds ?? {}) };
    for (const s of sc.strands) if (layer(s.id) === 4 || layer(s.id) === 5) ends[s.id] = { ...ends[s.id], out: TWIST_LEVEL2_END };
    pl.planeEnds = ends;
  }
  return { ...sc, ...pl };
}

function build() {
  if (state.source === 'engine') return engineScene();
  const rad = state.turns.map((d) => (d * Math.PI) / 180);
  const name = `Twist 1×1 ${state.hand.toUpperCase()}, ${state.levels} levels, turns by level`;
  const sc = state.build === 'none'
    ? twistColumnTurns(1, 1, state.levels, rad, name, state.hand)
    : twistColumnTurnsPlaced(1, 1, state.levels, rad, name, state.hand, state.build === 'fix');
  return sc;
}

function show(sc) {
  const shown = { ...sc, strands: sc.strands.map((s) => ({ ...s, visible: !state.only || levelOf(s.id) === state.levels })) };
  view.setScene(shown, false);
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

/** Everything read back off the built ribbons, by level. */
function readBack(sc) {
  const th = view.getThicknessWorld();
  const L = {};
  for (const s of sc.strands) L[s.id] = view.getStrandCentrelineWorld(s.id);
  const per = {};
  for (let l = 1; l <= state.levels; l++) per[l] = { n: 0, right: 0, hits: [], short: [] };
  for (const c of view.getCrossPoints()) {
    if (lace(c.aId) === lace(c.bId) || !c.woven) continue;
    const over = c.overIndex === c.aIndex ? c.aId : c.bId;
    const under = over === c.aId ? c.bId : c.aId;
    const g = (nearest(L[over], c.x, c.y).z - nearest(L[under], c.x, c.y).z) / th;
    const p = per[levelOf(over)];
    if (!p) continue;
    p.n++;
    if (g > -0.05) p.right++;
  }
  // Two ribbons pass through each other where their centrelines come within a
  // ribbon's half-width in plan (23 px) and less than most of a thickness in height
  // (20 px). Glued neighbours — an arm and the one it carries on from — are skipped.
  const ids = sc.strands.map((s) => s.id);
  const parent = Object.fromEntries(sc.strands.map((s) => [s.id, s.parentId]));
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      if (parent[a] === b || parent[b] === a) continue;
      let worst = 0;
      for (const P of L[a]) {
        for (const Q of L[b]) {
          const dxy = Math.hypot(P.x - Q.x, P.y - Q.y) / SCALE;
          const dz = Math.abs(P.z - Q.z) / SCALE;
          if (dxy < 23 && dz < 20) worst = Math.max(worst, Math.min(23 - dxy, 20 - dz));
        }
      }
      if (worst > 3) per[Math.max(levelOf(a), levelOf(b))].hits.push({ a, b, px: Math.round(worst), lo: Math.min(levelOf(a), levelOf(b)) });
    }
  }
  for (const s of sc.short ?? []) per[s.level]?.short.push(s);
  // How far each level's fold ends sit from the neighbouring arm's edge, off the ribbons: negative is inside it.
  for (let l = 1; l < state.levels; l++) {
    let edge = Infinity;
    for (const s of sc.strands) {
      if (levelOf(s.id) !== l || layer(s.id) < 2 || !sc.strands.some((t) => t.parentId === s.id)) continue;
      const E = L[s.id][L[s.id].length - 1];
      for (const t of sc.strands) {
        if (levelOf(t.id) !== l || lace(t.id) === lace(s.id)) continue;
        for (const q of L[t.id]) edge = Math.min(edge, Math.hypot(E.x - q.x, E.y - q.y) / SCALE - 23);
      }
    }
    per[l].edge = edge;
  }
  return per;
}

const fmt = (d) => `${(+d).toFixed(2)}°`;

function sliders() {
  const host = document.getElementById('turns');
  host.textContent = '';
  for (let L = 2; L <= MAXL; L++) {
    const row = document.createElement('div');
    row.className = 'turn' + (L > state.levels ? ' off' : '');
    const label = document.createElement('label');
    label.htmlFor = `t${L}`;
    label.textContent = `Level ${L}`;
    const range = document.createElement('input');
    range.type = 'range'; range.id = `t${L}`; range.min = '5'; range.max = '85'; range.step = '0.25';
    range.value = String(state.turns[L - 2]);
    range.disabled = L > state.levels;
    const num = document.createElement('input');
    num.type = 'number'; num.id = `n${L}`; num.min = '5'; num.max = '85'; num.step = '0.25';
    num.value = String(state.turns[L - 2]);
    num.disabled = L > state.levels;
    num.setAttribute('aria-label', `Level ${L} turn in degrees`);
    const out = document.createElement('span');
    out.className = 'state';
    out.id = `s${L}`;
    const set = (v) => {
      const x = Math.min(85, Math.max(5, Number(v)));
      if (!Number.isFinite(x)) return;
      state.turns[L - 2] = x;
      range.value = String(x);
      num.value = String(x);
      schedule();
    };
    range.addEventListener('input', () => set(range.value));
    num.addEventListener('change', () => set(num.value));
    row.append(label, range, num, out);
    host.appendChild(row);
  }
}

function table(per) {
  const host = document.getElementById('rows');
  host.textContent = '';
  let clean = true;
  for (let L = 1; L <= state.levels; L++) {
    const p = per[L];
    const tr = document.createElement('tr');
    const td = (t, cls) => { const e = document.createElement('td'); e.textContent = t; if (cls) e.className = cls; tr.appendChild(e); };
    td(`Level ${L}`);
    td(state.source === 'engine' ? (L === 1 ? '—' : fmt(ENGINE_TURNS[L - 2])) : (L === 1 ? '—' : fmt(state.turns[L - 2])));
    const tip = state.source === 'engine' ? (L === 1 ? 38 : 48) : (L < state.levels ? tipOf(state.turns[L - 1]) : null);
    td(tip === null ? 'loose ends' : `${tip.toFixed(0)} px`);
    const ed = p.edge;
    td(Number.isFinite(ed) ? `${ed >= 0 ? '+' : '−'}${Math.abs(ed).toFixed(0)} px` : '—', Number.isFinite(ed) ? (ed >= 0 ? 'ok' : 'off') : '');
    td(p.n ? `${p.right} of ${p.n}` : '—', p.right === p.n ? 'ok' : 'off');
    td(p.short.length ? `${p.short.length} under it` : 'meets it');
    const own = p.hits.filter((h) => !(L === 1 && h.lo === 1));
    const lvl1 = p.hits.length - own.length;
    td(own.length
      ? own.slice(0, 3).map((h) => `${h.a}/${h.b} ${h.px}px`).join(', ') + (own.length > 3 ? ` +${own.length - 3}` : '')
      : (lvl1 ? `none (level 1's own: ${lvl1})` : 'none'), own.length ? 'off' : 'ok');
    host.appendChild(tr);
    if (L > 1 && (own.length || p.right !== p.n || (Number.isFinite(p.edge) && p.edge < 0))) clean = false;
    const s = document.getElementById(`s${L}`);
    if (s) {
      const bad = own.length || p.right !== p.n || (Number.isFinite(p.edge) && p.edge < 0);
      s.textContent = bad ? 'collides' : 'clean';
      s.className = 'state ' + (bad ? 'off' : 'ok');
    }
  }
  const verdict = document.getElementById('verdict');
  verdict.textContent = clean ? `Levels 2–${state.levels}: nothing collides, every crossing right, every fold end clear of the arm it crosses.` : 'Something collides or a fold end sits inside the arm it crosses — see the red rows.';
  verdict.className = clean ? 'ok' : 'off';
}

function output() {
  return JSON.stringify({
    what: 'twist 1×1, turn per level (degrees: how far each level is turned from the one below)',
    hand: state.hand,
    levels: state.levels,
    build: { fix: 'box rules + twist fix', box: 'box rules only', none: 'unplaced' }[state.build],
    source: state.source === 'engine' ? 'the engine\'s own rings (ysetbon/mxn, 1×1 k=1)' : 'turns by level (landing law, 56 px gap)',
    tipsPx: Object.fromEntries(state.turns.slice(0, state.levels - 1).map((t, i) => [`level${i + 1}`, +tipOf(t).toFixed(1)])),
    turnsDeg: Object.fromEntries(state.turns.slice(0, state.levels - 1).map((t, i) => [`level${i + 2}`, +t])),
  }, null, 2);
}

let refit = true;
function render() {
  const sc = build();
  show(sc);
  if (refit) { view.fitView(); refit = false; }
  table(readBack(sc));
  document.getElementById('out').value = output();
  for (const [attr, value] of [['levels', String(state.levels)], ['hand', state.hand], ['build', state.build], ['only', String(state.only)], ['source', state.source]]) {
    document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  }
  save();
}
let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(render, 120);
}

for (const attr of ['levels', 'hand', 'build', 'only', 'source']) {
  document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset[attr];
    state[attr] = attr === 'levels' ? +v : attr === 'only' ? v === 'true' : v;
    if (attr === 'levels' || attr === 'hand') refit = true;
    sliders();
    render();
  }));
}
document.getElementById('all').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  document.getElementById('all-n').textContent = fmt(v);
  state.turns = state.turns.map(() => v);
  sliders();
  schedule();
});
document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
  state.turns = [...PRESETS[b.dataset.preset].turns];
  state.source = 'turns';
  document.getElementById('all').value = String(state.turns[1]);
  document.getElementById('all-n').textContent = fmt(state.turns[1]);
  sliders();
  render();
}));
document.getElementById('reset').addEventListener('click', () => {
  state.turns = Array(MAXL - 1).fill(DEFAULT);
  document.getElementById('all').value = String(DEFAULT);
  document.getElementById('all-n').textContent = fmt(DEFAULT);
  sliders();
  render();
});
document.getElementById('copy').addEventListener('click', async () => {
  const out = document.getElementById('out');
  const msg = document.getElementById('copied');
  try {
    await navigator.clipboard.writeText(out.value);
    msg.textContent = 'Copied. Paste it to Claude.';
  } catch {
    out.focus();
    out.select();
    msg.textContent = 'Selected. Press Ctrl+C (⌘C) to copy.';
  }
});
document.getElementById('v-fit').addEventListener('click', () => view.fitView());
document.getElementById('v-plan').addEventListener('click', () => view.topView());
document.getElementById('v-side').addEventListener('click', () => {
  view.fitView();
  const t = view.controls.target;
  const d = view.camera.position.distanceTo(t);
  view.camera.position.set(t.x + 0.12 * d, t.y - 0.98 * d, t.z + 0.16 * d);
  view.controls.update();
});

function paintTheme() {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  view.setTheme(dark ? 'dark' : 'light');
}
paintTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);
new MutationObserver(paintTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

document.getElementById('all').value = String(state.turns[0]);
document.getElementById('all-n').textContent = fmt(state.turns[0]);
document.getElementById('default').textContent = fmt(DEFAULT);
window.__tw = { state, render }; // test hook
sliders();
render();
document.getElementById('loading').remove();
