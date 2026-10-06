// The 1×1 box, levels 1 to 4, as settled: level 1 the box from `box + strand`, and
// every level above as placed by hand in the level editors — arms resting on −1,
// crossings ±1, each fold ending on −1 below and starting on +1 above. One copy of
// the studio's own view, fed by `boxStitchMN` — the builder behind the
// `box-placed-…` samples — so this page and the samples cannot disagree.
import { StrandScene } from '../../src/scene/StrandScene';
import { boxStitchMN, BOX_MAX } from '../../src/model/boxmn';

const RUNG = 0.5; // a rung is half a thickness
const W = 46; // ribbon width, px
const T = 26; // ribbon thickness, px
const SCALE = 0.02; // world units per source px

const state = { levels: 4, hand: 'rh', placed: true, only: false, m: 1, n: 1 };
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
    td(r.n ? `${r.right} of ${r.n} with the top lace on top` : '—', r.right === r.n ? 'ok' : 'off');
    td(r.n ? (r.worst >= 0.9 ? 'resting on each other' : r.worst > -0.05 ? `tightest ${r.worst.toFixed(2)} th` : 'one passes through') : '—');
    td(r.folds ? `${r.folds} folds · end ${Math.max(0, r.edge).toFixed(0)} px from the neighbour's edge, ${r.height.toFixed(0)} px in height` : r.L === state.levels ? 'top level: loose ends' : '—');
    host.appendChild(tr);
  }
}

let framed = '';
function render() {
  const sc = sceneNow();
  show(sc);
  const shape = `${state.hand}-${state.m}x${state.n}-${state.levels}`;
  if (shape !== framed) { view.fitView(); framed = shape; }
  table(readLevels(sc));
  // Which studio sample is this exact build: the Browse grid's column at ten levels,
  // the single round at two, and the placed 1×1 / 2×1 samples at every depth.
  const { m, n, hand, levels, placed } = state;
  const face = `${m}x${n}`;
  const key = !placed ? null
    : levels === 10 ? `box-col-${hand}-${face}-10`
      : levels === 2 ? `box-${hand}-${face}`
        : (face === '1x1' || face === '2x1') ? `box-placed-${hand === 'lh' ? 'lh-' : ''}${face}-l${levels}` : null;
  document.getElementById('sample').textContent = key ? `?sample=${key}` : '';
  for (const [attr, value] of [['levels', String(state.levels)], ['hand', state.hand], ['placed', String(state.placed)], ['only', String(state.only)], ['face', `${state.m}x${state.n}`]]) {
    document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  }
}

// The 8×8 face picker: m across, n down, the same grid the studio's Browse panel lays
// the family out on.
const grid = document.getElementById('grid');
let cells = '<span class="ax corner">m→<br>n↓</span>';
for (let m = 1; m <= BOX_MAX; m++) cells += `<span class="ax">${m}</span>`;
for (let n = 1; n <= BOX_MAX; n++) {
  cells += `<span class="ax">${n}</span>`;
  for (let m = 1; m <= BOX_MAX; m++) {
    cells += `<button type="button" class="cell" data-face="${m}x${n}" aria-pressed="false" aria-label="${m} by ${n}">${m}×${n}</button>`;
  }
}
grid.innerHTML = cells;

for (const attr of ['levels', 'hand', 'placed', 'only', 'face']) {
  document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset[attr];
    if (attr === 'face') [state.m, state.n] = v.split('x').map(Number);
    else state[attr] = attr === 'levels' ? +v : attr === 'hand' ? v : v === 'true';
    render();
  }));
}
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
  // the turning end of the east weft arm one level below the top
  const L = Math.max(1, state.levels - 1);
  const id = L === 1 ? '1_2' : `1_${2 * L}`;
  const line = view.getStrandCentrelineWorld(id) ?? view.getStrandCentrelineWorld('1_2');
  const tip = line[line.length - 1];
  view.controls.target.set(tip.x, tip.y, tip.z);
  view.camera.position.set(tip.x + 4.2, tip.y - 2.6, tip.z + 2.6);
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
