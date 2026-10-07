// The 1×1 twist before and after being put on the box's planes, beside the box.
//
// Three copies of the studio's own view: the 1×1 box as `boxStitchMN` places it,
// the twist as first decided (fold ends from level 2 up on +1, a height that came
// from a suggestion), and the twist on the box's planes. Every figure in the table
// is read off the built ribbons — the heights of each arm's start and end, the
// heights at its crossings, the gap at its fold ends — in rungs of half a
// thickness, so the three columns can be laid next to each other level by level.
import { StrandScene } from '../../src/scene/StrandScene';
import { boxStitchMN } from '../../src/model/boxmn';
import { TWIST_1X1_DECIDED, TWIST_1X1_DECIDED_BEFORE, twistColumnDecided } from '../../src/model/twistplaced';

const RUNG = 0.5;
const SCALE = 0.02;
const RUNG_PX = 13; // half a 26 px thickness
const W = 46;
const MAXL = 10;

const state = { levels: MAXL, hand: 'rh', focus: 2, link: true, fold: -1 };
const $ = (id) => document.getElementById(id);
const layer = (id) => Number(id.split('_')[1]);
const levelOf = (id) => (layer(id) < 4 ? 1 : Math.floor((layer(id) - 2) / 2) + 1);
const lace = (id) => id.split('_')[0];
const armsOf = (L) => (L === 1 ? [2, 3] : [2 * L, 2 * L + 1]);

const PANELS = [
  { key: 'box', name: 'Box 1×1', tag: 'the reference', note: 'boxStitchMN, placed: ends on −1.',
    build: () => boxStitchMN(1, 1, `Box 1×1 ${state.hand.toUpperCase()}`, state.hand, state.levels - 1, true, 'hand') },
  { key: 'before', name: 'Twist, before', tag: 'ends on +1', note: 'Your tips; fold ends of levels 2–9 on +1.',
    build: () => twistColumnDecided(state.levels, TWIST_1X1_DECIDED_BEFORE, `Twist before ${state.hand.toUpperCase()}`, state.hand) },
  { key: 'after', name: 'Twist, after', tag: 'box planes', note: 'Your tips; ends on −1 as the box, level 2 on 0.',
    build: () => twistColumnDecided(state.levels, TWIST_1X1_DECIDED, `Twist after ${state.hand.toUpperCase()}`, state.hand) },
];

const host = $('panels');
for (const p of PANELS) {
  const el = document.createElement('div');
  el.className = 'side';
  el.innerHTML = `<h3><b>${p.name}</b><span>${p.tag}</span></h3><div class="stage"><canvas id="c-${p.key}"></canvas></div><p>${p.note}</p>`;
  host.appendChild(el);
  p.view = new StrandScene(el.querySelector('canvas'));
  p.view.renderer.shadowMap.enabled = false;
}

function show(view, sc) {
  view.setScene(sc, false);
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

const rungText = (r) => (Math.abs(r) < 0.25 ? '0' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1).replace(/\.0$/, '')}`);

/** Per level, off the built ribbons: where its arms start and end, where its crossings sit, and its fold ends. */
function measure(p) {
  const { view, scene: sc } = p;
  const lines = {};
  sc.strands.forEach((s, i) => { lines[s.id] = view.wovenLines[i]; });
  const th = view.getThicknessWorld();
  const out = [];
  for (let L = 1; L <= state.levels; L++) {
    const plane = view.getStoreyPlane(L - 1) / SCALE;
    const rung = (z) => (z / SCALE - plane) / RUNG_PX;
    const arms = sc.strands.filter((s) => levelOf(s.id) === L && armsOf(L).includes(layer(s.id)));
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const start = mean(arms.map((s) => rung(lines[s.id][0].z)));
    const end = mean(arms.map((s) => rung(lines[s.id][lines[s.id].length - 1].z)));
    const tops = [], unders = [];
    for (const c of view.getCrossPoints()) {
      if (lace(c.aId) === lace(c.bId) || !c.woven || levelOf(c.aId) !== L || levelOf(c.bId) !== L) continue;
      const over = c.overIndex === c.aIndex ? c.aId : c.bId;
      const under = over === c.aId ? c.bId : c.aId;
      tops.push(rung(nearest(lines[over], c.x, c.y).z));
      unders.push(rung(nearest(lines[under], c.x, c.y).z));
    }
    let dz = Infinity, edge = Infinity;
    if (L < state.levels) {
      for (const s of arms) {
        const E = lines[s.id][lines[s.id].length - 1];
        for (const t of sc.strands) {
          if (levelOf(t.id) !== L || lace(t.id) === lace(s.id) || layer(t.id) < 2) continue;
          for (const q of lines[t.id]) {
            const g = Math.hypot(E.x - q.x, E.y - q.y) / SCALE - W / 2;
            if (g < edge) { edge = g; dz = Math.abs(E.z - q.z) / SCALE; }
          }
        }
      }
    }
    out.push({ L, start, end, top: tops.length ? mean(tops) : null, under: unders.length ? mean(unders) : null, dz, edge });
  }
  return out;
}

function render() {
  for (const p of PANELS) {
    p.scene = p.build();
    show(p.view, p.scene);
  }
  const shape = `${state.hand}-${state.levels}`;
  if (shape !== render.shape) { PANELS.forEach((p) => p.view.fitView()); render.shape = shape; state.fold = -1; }
  const m = Object.fromEntries(PANELS.map((p) => [p.key, measure(p)]));
  const body = $('rows');
  body.textContent = '';
  let differs = { before: 0, after: 0 };
  for (let i = 0; i < state.levels; i++) {
    const tr = document.createElement('tr');
    const ref = m.box[i];
    const cell = (t, off) => { const e = document.createElement('td'); e.textContent = t; e.className = 'cell' + (off ? ' off' : ''); tr.appendChild(e); };
    const first = document.createElement('td'); first.textContent = `Level ${i + 1}${i + 1 === MAXL ? ' (top)' : ''}`; tr.appendChild(first);
    const arms = (x) => `${rungText(x.start)} → ${rungText(x.end)}`;
    const cross = (x) => (x.top === null ? '—' : `${rungText(x.top)} / ${rungText(x.under)}`);
    const fold = (x) => (Number.isFinite(x.dz) ? `${x.dz.toFixed(0)} px · ${x.edge >= 0 ? '+' : '−'}${Math.abs(x.edge).toFixed(0)} px` : '—');
    const bad = (x) => Math.abs(x.start - ref.start) > 0.5 || Math.abs(x.end - ref.end) > 0.5 || (ref.top !== null && x.top !== null && (Math.abs(x.top - ref.top) > 0.5 || Math.abs(x.under - ref.under) > 0.5));
    const badFold = (x) => Number.isFinite(x.dz) && Number.isFinite(ref.dz) && x.dz < ref.dz - 9;
    const row = { box: m.box[i], before: m.before[i], after: m.after[i] };
    for (const k of ['box', 'before', 'after']) cell(arms(row[k]) + (k === 'after' && i === 1 ? ' (ends on 0)' : ''), k !== 'box' && i > 0 && !(k === 'after' && i === 1) && bad(row[k]));
    for (const k of ['box', 'before', 'after']) cell(cross(row[k]), false);
    for (const k of ['box', 'before', 'after']) cell(fold(row[k]), k !== 'box' && badFold(row[k]));
    for (const k of ['before', 'after']) if (i > 0 && !(k === 'after' && i === 1 && !badFold(row[k]) ) && (bad(row[k]) || badFold(row[k]))) differs[k]++;
    body.appendChild(tr);
  }
  $('verdict').textContent = `Against the box, levels 2–${state.levels}: the twist before differs on ${differs.before}, the twist after on ${differs.after}${differs.after === 0 ? ' (level 2 sits on 0 on purpose)' : ''}.`;
  $('verdict').className = differs.after === 0 ? 'ok' : 'off';
  buttons();
}

function buttons() {
  const lv = $('levels');
  if (!lv.children.length) {
    for (let L = 2; L <= MAXL; L++) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = String(L); b.dataset.n = String(L);
      b.addEventListener('click', () => { state.levels = L; state.focus = Math.min(state.focus, L - 1 || 1); render(); });
      lv.appendChild(b);
    }
    const fo = $('focus');
    for (let L = 1; L <= MAXL - 1; L++) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = String(L); b.dataset.n = String(L);
      b.addEventListener('click', () => { state.focus = L; render(); });
      fo.appendChild(b);
    }
    const fc = $('foldcam');
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = `Fold ${i + 1}`; b.dataset.i = String(i);
      b.addEventListener('click', () => { state.fold = i; aimAll(i); buttons(); });
      fc.appendChild(b);
    }
  }
  [...lv.children].forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.n === state.levels)));
  [...$('focus').children].forEach((b) => { b.setAttribute('aria-pressed', String(+b.dataset.n === state.focus)); b.disabled = +b.dataset.n >= state.levels; });
  [...$('foldcam').children].forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.i === state.fold)));
  document.querySelectorAll('[data-hand]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.hand === state.hand)));
  $('link').setAttribute('aria-pressed', String(state.link));
}

// ---- cameras ----------------------------------------------------------------
function aimAll(i) {
  for (const p of PANELS) {
    const L = Math.min(state.focus, state.levels - 1);
    const ids = armsOf(L).flatMap((l) => ['1', '2'].map((set) => `${set}_${l}`));
    const id = ids[i];
    const idx = p.scene.strands.findIndex((s) => s.id === id);
    const line = p.view.wovenLines[idx];
    if (!line) continue;
    const tip = line[line.length - 1];
    let cx = 0, cy = 0, n = 0;
    for (const sid of ids) {
      const l = p.view.wovenLines[p.scene.strands.findIndex((s) => s.id === sid)];
      if (l) { cx += l[l.length - 1].x; cy += l[l.length - 1].y; n++; }
    }
    cx /= n || 1; cy /= n || 1;
    let ox = tip.x - cx, oy = tip.y - cy;
    const ol = Math.hypot(ox, oy) || 1;
    ox /= ol; oy /= ol;
    p.view.controls.target.set(tip.x, tip.y, tip.z);
    p.view.camera.position.set(tip.x + ox * 2.6, tip.y + oy * 2.6, tip.z + 1.8);
    p.view.controls.update();
  }
}
let syncing = false;
for (const p of PANELS) {
  p.view.controls.addEventListener('change', () => {
    if (!state.link || syncing) return;
    syncing = true;
    const off = p.view.camera.position.clone().sub(p.view.controls.target);
    for (const q of PANELS) {
      if (q === p) continue;
      q.view.camera.position.copy(q.view.controls.target).add(off);
      q.view.camera.up.copy(p.view.camera.up);
      q.view.controls.update();
    }
    syncing = false;
  });
}
$('v-fit').addEventListener('click', () => { state.fold = -1; PANELS.forEach((p) => p.view.fitView()); buttons(); });
$('v-plan').addEventListener('click', () => { state.fold = -1; PANELS.forEach((p) => p.view.topView()); buttons(); });
$('v-side').addEventListener('click', () => {
  state.fold = -1;
  for (const p of PANELS) {
    p.view.fitView();
    const t = p.view.controls.target;
    const d = p.view.camera.position.distanceTo(t);
    p.view.camera.position.set(t.x + 0.12 * d, t.y - 0.98 * d, t.z + 0.16 * d);
    p.view.controls.update();
  }
  buttons();
});
$('link').addEventListener('click', () => { state.link = !state.link; buttons(); });
document.querySelectorAll('[data-hand]').forEach((b) => b.addEventListener('click', () => { state.hand = b.dataset.hand; render(); }));

function paintTheme() {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  for (const p of PANELS) p.view.setTheme(dark ? 'dark' : 'light');
}
paintTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);
new MutationObserver(paintTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

window.__pl = { state, render }; // test hook
render();
