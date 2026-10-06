// The 1×1 box at its SECOND level: today's unplaced build beside the level placed
// by hand in box-level2-editor, each on a copy of the studio's own view.
//
// The first level is settled — it is the box from `box + strand`, placed the way
// that sample was placed — and every candidate keeps it exactly; the page checks
// that against the sample on every load. The second level has no hand-placed
// reference in a sample, so it was placed by hand in box-level2-editor and built in.
//
// Nothing is baked. Every panel is `StrandScene` fed by `boxStitchMN` or by
// `SAMPLES['box-and-strand']`, and every figure is read back off the built ribbons.
import { StrandScene } from '../../src/scene/StrandScene';
import { SAMPLES } from '../../src/model/samples';
import { boxStitchMN, UPPER_PLANS } from '../../src/model/boxmn';

const RUNG = 0.5; // a rung is half a thickness (PLANE_RUNGS in the panel)

/** `box + strand` is a box and one more strand. Take the strand, and everything placed on it. */
function referenceBox() {
  const sc = SAMPLES['box-and-strand']();
  const drop = (id) => id === '3_1';
  const keep = (o) =>
    Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !k.split('|').some(drop)));
  return {
    ...sc,
    strands: sc.strands.filter((s) => !drop(s.id)),
    planes: keep(sc.planes),
    crossPlanes: keep(sc.crossPlanes),
  };
}

// The family numbers the weft's two arms the other way round from the sample:
// its `1_2` runs west from the slant's far end, which is the sample's `1_3`.
const HAND = { '1_2': '1_3', '1_3': '1_2' };
const asHand = (id) => HAND[id] ?? id;

const PANELS = [
  { id: 'before', name: 'Before', note: 'Today: nothing placed.', placed: false },
  ...['hand'].map((plan) => {
    const p = UPPER_PLANS[plan];
    return {
      id: plan,
      name: p.label,
      placed: true,
      plan,
      note: `Level 2: every arm rests on ${rung(p.rest)}; at a crossing the arm on top goes to ${rung(p.over)} and the one underneath to ${rung(p.under)}.`,
    };
  }),
];
function rung(r) {
  return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0';
}

// ---- panels -----------------------------------------------------------------------
const grid = document.getElementById('panels');
for (const p of PANELS) {
  const el = document.createElement('div');
  el.className = 'side';
  el.innerHTML =
    `<h2><b>${p.name}</b><span>${p.placed ? '?sample=box-placed-1x1-l2' : 'boxStitchMN(1, 1, …, 1)'}</span></h2>` +
    `<div class="stage"><canvas id="c-${p.id}"></canvas></div><p>${p.note}</p>`;
  grid.appendChild(el);
  p.view = new StrandScene(el.querySelector('canvas'));
  p.view.renderer.shadowMap.enabled = false;
  p.scene = boxStitchMN(1, 1, `Box 1×1 RH, 2 levels — ${p.name}`, 'rh', 1, p.placed, p.plan);
}
const views = PANELS.map((p) => p.view);
// Column heads follow the panels.
document.querySelectorAll('thead tr[data-cols]').forEach((tr) => {
  for (const p of PANELS) {
    const th = document.createElement('th');
    th.textContent = p.name;
    tr.appendChild(th);
  }
});
const reference = { view: new StrandScene(document.getElementById('c-ref')), scene: referenceBox() };
reference.view.renderer.shadowMap.enabled = false;
const level1 = { view: new StrandScene(document.getElementById('c-l1')), scene: boxStitchMN(1, 1, 'Box 1×1 RH, level 1, placed', 'rh', 0, true) };
level1.view.renderer.shadowMap.enabled = false;
const allViews = [...views, reference.view, level1.view];

/** What the panel does with a scene's placements: rungs to thicknesses, then to the view. */
function show(view, sc) {
  view.setScene(sc, false);
  const runs = Object.entries(sc.planes ?? {});
  view.setSublevels(
    runs.length ? new Map(runs.map(([id, r]) => [id, { in: r * RUNG, out: r * RUNG }])) : null);
  const cross = Object.entries(sc.crossPlanes ?? {});
  view.setCrossingPlanes(cross.length ? new Map(cross.map(([k, r]) => [k, r * RUNG])) : null);
}

function nearest(line, x, y) {
  let best = line[0];
  let d = Infinity;
  for (const p of line) {
    const q = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (q < d) { d = q; best = p; }
  }
  return best;
}

const layer = (id) => Number(id.split('_')[1]);
const storey = (id) => (layer(id) >= 4 ? 1 : 0);

/**
 * Every crossing of two different laces, keyed by sorted id: each lace's height in
 * rungs off the middle of the storey the crossing is on, and who the weave puts on top.
 */
function read(view, hand = (i) => i) {
  const th = view.getThicknessWorld();
  const out = new Map();
  for (const c of view.getCrossPoints()) {
    if (c.aId.split('_')[0] === c.bId.split('_')[0]) continue; // a lace's own glued joint
    const a = hand(c.aId);
    const b = hand(c.bId);
    const z = (id) => nearest(view.getStrandCentrelineWorld(id), c.x, c.y).z;
    const lo = Math.min(storey(c.aId), storey(c.bId));
    const plane = view.getStoreyPlane(lo);
    out.set([a, b].sort().join('|'), {
      [a]: (z(c.aId) - plane) / th / RUNG,
      [b]: (z(c.bId) - plane) / th / RUNG,
      over: hand(c.overIndex === c.aIndex ? c.aId : c.bId),
      woven: c.woven,
      between: storey(c.aId) !== storey(c.bId),
    });
  }
  return out;
}

const fmt = (n) => (n > 0.005 ? '+' : n < -0.005 ? '−' : '') + Math.abs(n).toFixed(2);

// ---- the first level: still the reference? -----------------------------------------
function level1Check(rowsByPanel) {
  show(reference.view, reference.scene);
  show(level1.view, level1.scene);
  const ref = read(reference.view);
  const host = document.getElementById('l1-rows');
  host.textContent = '';
  const tr = document.createElement('tr');
  const td = (t, cls) => { const e = document.createElement('td'); e.textContent = t; if (cls) e.className = cls; tr.appendChild(e); };
  td('Largest difference from the reference');
  const sources = [['level 1 alone', read(level1.view, asHand)], ...PANELS.map((p) => [p.name, rowsByPanel[p.id].hand])];
  for (const [, rows] of sources) {
    let worst = 0;
    let flipped = 0;
    for (const [key, r] of ref) {
      const g = rows.get(key);
      if (!g) { worst = Infinity; continue; }
      for (const id of key.split('|')) worst = Math.max(worst, Math.abs(g[id] - r[id]));
      if (g.over !== r.over) flipped++;
    }
    td(`${worst.toFixed(2)} rungs${flipped ? ` · ${flipped} flipped` : ''}`, worst <= 0.5 && !flipped ? 'ok' : 'off');
  }
  host.appendChild(tr);
}

// ---- the second level ---------------------------------------------------------------
function level2Table(rowsByPanel) {
  const keys = [...rowsByPanel.before.raw.entries()]
    .filter(([key, r]) => r.woven && key.split('|').every((id) => storey(id) === 1))
    .map(([key]) => key)
    .sort();
  const host = document.getElementById('l2-rows');
  host.textContent = '';
  for (const key of keys) {
    const tr = document.createElement('tr');
    const td = (t, cls) => { const e = document.createElement('td'); e.textContent = t; if (cls) e.className = cls; tr.appendChild(e); };
    td(key.replace('|', ' × '));
    for (const p of PANELS) {
      const r = rowsByPanel[p.id].raw.get(key);
      const under = key.split('|').find((id) => id !== r.over);
      const air = (r[r.over] - r[under]) / 2 - 1; // rungs to thicknesses, less one thickness
      td(`${r.over} ${fmt(r[r.over])} over ${under} ${fmt(r[under])} · ${air >= -0.05 ? `air ${Math.max(0, air).toFixed(2)}` : `overlap ${(-air).toFixed(2)}`}`,
        air < -0.55 ? 'off' : air < -0.05 ? 'mid' : 'ok');
    }
    host.appendChild(tr);
  }
}

/** Where a level-2 lace passes over a level-1 lace: how much air is left between them, in thicknesses. */
function stackRow(rowsByPanel) {
  const host = document.getElementById('stack-rows');
  host.textContent = '';
  const rows = [
    ['Closest level 2 comes to level 1', (p) => {
      const th = p.view.getThicknessWorld();
      let worst = Infinity;
      for (const c of p.view.getCrossPoints()) {
        if (storey(c.aId) === storey(c.bId)) continue;
        if (c.aId.split('_')[0] === c.bId.split('_')[0]) continue;
        const up = storey(c.aId) === 1 ? c.aId : c.bId;
        const down = up === c.aId ? c.bId : c.aId;
        const gap = (nearest(p.view.getStrandCentrelineWorld(up), c.x, c.y).z -
          nearest(p.view.getStrandCentrelineWorld(down), c.x, c.y).z) / th - 1;
        worst = Math.min(worst, gap);
      }
      return { text: worst >= -0.05 ? `air ${Math.max(0, worst).toFixed(2)} th` : `overlap ${(-worst).toFixed(2)} th`,
        cls: worst < -0.55 ? 'off' : worst < -0.05 ? 'mid' : 'ok' };
    }],
    ['Column height', (p) => {
      const th = p.view.getThicknessWorld();
      let lo = Infinity;
      let hi = -Infinity;
      for (const st of p.scene.strands) {
        for (const q of p.view.getStrandCentrelineWorld(st.id)) { lo = Math.min(lo, q.z); hi = Math.max(hi, q.z); }
      }
      return { text: `${((hi - lo) / th).toFixed(2)} th` };
    }],
    ['Placed', (p) => ({
      text: String(Object.keys(p.scene.planes ?? {}).length + Object.keys(p.scene.crossPlanes ?? {}).length || 'none'),
    })],
  ];
  for (const [label, f] of rows) {
    const tr = document.createElement('tr');
    const td = (t, cls) => { const e = document.createElement('td'); e.textContent = t; if (cls) e.className = cls; tr.appendChild(e); };
    td(label);
    for (const p of PANELS) { const r = f(p); td(r.text, r.cls); }
    host.appendChild(tr);
  }
}

function render() {
  const rowsByPanel = {};
  for (const p of PANELS) {
    show(p.view, p.scene);
    rowsByPanel[p.id] = { raw: read(p.view), hand: read(p.view, asHand) };
  }
  level1Check(rowsByPanel);
  level2Table(rowsByPanel);
  stackRow(rowsByPanel);
}

function paintTheme() {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  allViews.forEach((v) => v.setTheme(dark ? 'dark' : 'light'));
}

// ---- cameras: orbit one, the others follow ---------------------------------------
const state = { link: true };
let syncing = false;
function copyCam(from, to) {
  to.camera.position.copy(from.camera.position);
  to.controls.target.copy(from.controls.target);
  to.camera.near = from.camera.near;
  to.camera.far = from.camera.far;
  to.camera.updateProjectionMatrix();
  to.controls.update();
}
views.forEach((src) => src.controls.addEventListener('change', () => {
  if (syncing || !state.link) return;
  syncing = true;
  views.filter((v) => v !== src).forEach((v) => copyCam(src, v));
  syncing = false;
}));
function setCam(fn) {
  const was = state.link;
  state.link = false;
  views.forEach(fn);
  state.link = was;
  views.slice(1).forEach((v) => copyCam(views[0], v));
}
const side = (v) => {
  v.fitView();
  const d = v.camera.position.length() * 1.15;
  v.camera.position.set(0.12, -1.0, 0.16).normalize().multiplyScalar(d);
  v.controls.update();
};
document.getElementById('v-fit').addEventListener('click', () => setCam((v) => v.fitView()));
document.getElementById('v-side').addEventListener('click', () => setCam(side));
document.getElementById('v-plan').addEventListener('click', () => setCam((v) => v.topView()));
document.getElementById('link').addEventListener('click', (e) => {
  state.link = !state.link;
  e.currentTarget.setAttribute('aria-pressed', String(state.link));
  if (state.link) views.slice(1).forEach((v) => copyCam(views[0], v));
});

paintTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);
new MutationObserver(paintTheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});

window.__ba = { PANELS, render, read }; // test hook
render();
setCam((v) => v.fitView());
reference.view.fitView();
level1.view.fitView();
document.getElementById('loading').remove();
