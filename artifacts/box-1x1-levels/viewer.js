// The 1×1 box built up one level at a time, 1 to 10, as settled: level 1 the box
// from `box + strand`, every level above as placed by hand in the level editors —
// arms resting on −1, crossings ±1, each fold ending on −1 below and starting on
// +1 above. One copy of the studio's own view, fed by `boxStitchMN` — the builder
// behind the `box-placed-1x1-l…` samples — so this page and the samples cannot
// disagree. For one level at a time: its own placement is listed from the scene,
// and a camera goes to the fold into it.
import { StrandScene } from '../../src/scene/StrandScene';
import { boxStitchMN } from '../../src/model/boxmn';

const RUNG = 0.5; // a rung is half a thickness
const W = 46; // ribbon width, px
const T = 26; // ribbon thickness, px
const SCALE = 0.02; // world units per source px

const state = { levels: 10, hand: 'rh', placed: true, only: false, m: 1, n: 1, focus: 10 };
const view = new StrandScene(document.getElementById('c'));
view.renderer.shadowMap.enabled = false;

const layer = (id) => Number(id.split('_')[1]);
const levelOf = (id) => (layer(id) < 4 ? 1 : Math.floor((layer(id) - 2) / 2) + 1);
const lace = (id) => id.split('_')[0];

function sceneNow() {
  const { levels, hand, placed, only, m, n } = state;
  const sc = boxStitchMN(m, n, `Box ${m}×${n} ${hand.toUpperCase()}, level ${levels}`, hand, levels - 1, placed, 'hand');
  return { ...sc, strands: sc.strands.map((s) => ({ ...s, visible: !only || levelOf(s.id) === levels })) };
}

/** What the studio's panel does with a scene's placements, ends included. */
function show(sc) {
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

/** Per level: its crossings (is the lace on top really on top, and do they touch?) and the folds out of it. */
function readLevels(sc) {
  const th = view.getThicknessWorld();
  const lines = {};
  for (const st of sc.strands) lines[st.id] = view.getStrandCentrelineWorld(st.id);
  const rows = [];
  for (let L = 1; L <= state.levels; L++) {
    let n = 0, right = 0, worst = Infinity;
    for (const c of view.getCrossPoints()) {
      if (lace(c.aId) === lace(c.bId) || levelOf(c.aId) !== L || levelOf(c.bId) !== L || !c.woven) continue;
      const over = c.overIndex === c.aIndex ? c.aId : c.bId;
      const under = over === c.aId ? c.bId : c.aId;
      const gap = (nearest(lines[over], c.x, c.y).z - nearest(lines[under], c.x, c.y).z) / th;
      n++;
      if (gap > -0.05) right++;
      worst = Math.min(worst, gap);
    }
    // the folds OUT of this level, into the one above
    let folds = 0, edge = Infinity, height = Infinity;
    if (L < state.levels) {
      for (const s of sc.strands) {
        if (levelOf(s.id) !== L || layer(s.id) < 2) continue;
        if (!sc.strands.some((t) => t.parentId === s.id)) continue;
        folds++;
        const E = lines[s.id][lines[s.id].length - 1];
        let best = { g: Infinity, dz: 0 };
        for (const t of sc.strands) {
          if (levelOf(t.id) !== L || lace(t.id) === lace(s.id)) continue;
          for (const q of lines[t.id]) {
            const g = Math.hypot(E.x - q.x, E.y - q.y) / SCALE - W / 2;
            if (g < best.g) best = { g, dz: Math.abs(E.z - q.z) / SCALE };
          }
        }
        if (best.g < edge) { edge = best.g; height = best.dz; }
      }
    }
    rows.push({ L, n, right, worst, folds, edge, height });
  }
  return rows;
}

function table(rows) {
  const host = document.getElementById('rows');
  host.textContent = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    const td = (t, cls) => { const e = document.createElement('td'); e.textContent = t; if (cls) e.className = cls; tr.appendChild(e); };
    td(`Level ${r.L}`);
    tr.tabIndex = 0;
    const pick = () => { state.focus = r.L; render(); };
    tr.addEventListener('click', pick);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    td(r.n ? `${r.right} of ${r.n} with the top lace on top` : '—', r.right === r.n ? 'ok' : 'off');
    td(r.n ? (r.worst >= 0.9 ? 'resting on each other' : r.worst > -0.05 ? `tightest ${r.worst.toFixed(2)} th` : 'one passes through') : '—');
    td(r.folds ? `${r.folds} folds · end ${Math.max(0, r.edge).toFixed(0)} px from the neighbour's edge, ${r.height.toFixed(0)} px in height` : r.L === state.levels ? 'top level: loose ends' : '—');
    host.appendChild(tr);
  }
}

/** The focused level's placement, listed from the scene the builder returned. */
function describe(sc, L) {
  const mine = (id) => levelOf(id) === L;
  const arms = sc.strands.filter((s) => mine(s.id) && layer(s.id) >= 2).map((s) => s.id);
  const uniq = (xs) => [...new Set(xs)].sort((a, b) => a - b);
  const sign = (r) => (r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0');
  const list = (xs) => (xs.length ? uniq(xs).map(sign).join(', ') : 'not placed');
  const rest = arms.map((id) => sc.planes?.[id]).filter((r) => r !== undefined);
  const cross = Object.entries(sc.crossPlanes ?? {})
    .filter(([k]) => k.split('|').slice(0, 2).every(mine) && L > 1).map(([, r]) => r);
  const startOf = arms.map((id) => sc.planeEnds?.[id]?.in).filter((r) => r !== undefined);
  const below = sc.strands.filter((s) => levelOf(s.id) === L - 1 && layer(s.id) >= 2).map((s) => s.id);
  const endOf = below.map((id) => sc.planeEnds?.[id]?.out ?? sc.planes?.[id]).filter((r) => r !== undefined);
  const rows = L === 1
    ? [['The box', 'the box from box + strand: vertical arms rest on −1, the slant underneath −3, an arm over a slant 0, the arm underneath at an arm crossing 0']]
    : [
      ['Its arms rest on', list(rest)],
      ['At each crossing', cross.length ? `the arm on top ${sign(Math.max(...cross))}, the arm underneath ${sign(Math.min(...cross))}` : 'not placed'],
      ['The fold into it', `the arm below ends on ${list(endOf)}, this arm starts on ${list(startOf)}`],
    ];
  const host = document.getElementById('this-level');
  host.textContent = '';
  for (const [k, v] of rows) {
    const tr = document.createElement('tr');
    const a = document.createElement('td'); a.textContent = k;
    const b = document.createElement('td'); b.textContent = v;
    tr.append(a, b);
    host.appendChild(tr);
  }
  document.getElementById('this-title').textContent = `Level ${L}${L === state.levels ? ' (the top)' : ''}`;
}

let framed = '';
function render() {
  const sc = sceneNow();
  show(sc);
  const shape = `${state.hand}-${state.m}x${state.n}-${state.levels}`;
  if (shape !== framed) { view.fitView(); framed = shape; }
  state.focus = Math.min(state.focus, state.levels);
  table(readLevels(sc));
  describe(sc, state.focus);
  document.querySelectorAll('#rows tr').forEach((tr, i) => tr.classList.toggle('focus', i + 1 === state.focus));
  document.getElementById('sample').textContent = `?sample=box-placed-${state.hand === 'lh' ? 'lh-' : ''}${state.m}x${state.n}-l${state.levels}`;
  for (const [attr, value] of [['levels', String(state.levels)], ['hand', state.hand], ['placed', String(state.placed)], ['only', String(state.only)], ['face', `${state.m}x${state.n}`]]) {
    document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  }
}

for (const attr of ['levels', 'hand', 'placed', 'only', 'face']) {
  document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset[attr];
    if (attr === 'face') [state.m, state.n] = v.split('x').map(Number);
    else state[attr] = attr === 'levels' ? +v : attr === 'hand' ? v : v === 'true';
    if (attr === 'levels') state.focus = state.levels;
    stopPlay();
    render();
  }));
}
// Step through: one level at a time with the arrow keys or the buttons, or let it build up.
function step(d) {
  state.levels = Math.min(10, Math.max(1, state.levels + d));
  state.focus = state.levels;
  render();
}
let timer = null;
function stopPlay() {
  if (timer) clearInterval(timer);
  timer = null;
  document.getElementById('play').setAttribute('aria-pressed', 'false');
  document.getElementById('play').textContent = 'Build up';
}
document.getElementById('prev').addEventListener('click', () => { stopPlay(); step(-1); });
document.getElementById('next').addEventListener('click', () => { stopPlay(); step(1); });
document.getElementById('play').addEventListener('click', () => {
  if (timer) { stopPlay(); return; }
  state.levels = 1;
  state.focus = 1;
  render();
  document.getElementById('play').setAttribute('aria-pressed', 'true');
  document.getElementById('play').textContent = 'Stop';
  timer = setInterval(() => {
    if (state.levels >= 10) { stopPlay(); return; }
    step(1);
  }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 1500 : 900);
});
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('button, input, select, textarea')) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { stopPlay(); step(1); e.preventDefault(); }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { stopPlay(); step(-1); e.preventDefault(); }
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
document.getElementById('v-fold').addEventListener('click', () => {
  // the turning end of the east weft arm one level below the one being looked at
  const L = Math.max(1, state.focus - 1);
  const id = L === 1 ? '1_2' : `1_${2 * L}`;
  const line = view.getStrandCentrelineWorld(id) ?? view.getStrandCentrelineWorld('1_2');
  const tip = line[line.length - 1];
  view.controls.target.set(tip.x, tip.y, tip.z);
  view.camera.position.set(tip.x + 5.6, tip.y - 3.4, tip.z + 3.4);
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

window.__lv = { state, render }; // test hook
render();
document.getElementById('loading').remove();
