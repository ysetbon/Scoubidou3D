// The 1×1 box at its first level, three ways, on three copies of the studio's own
// view: the box from `box + strand` (the reference, 3_1 taken out), the box the
// family builds today, and the family's box placed the way the reference was.
//
// Nothing is baked. All three are `StrandScene`, fed by `SAMPLES['box-and-strand']`
// and by `boxStitchMN` — the app's own scenes — and the table is read back off the
// built ribbons: where each lace actually is at each crossing, in rungs (half a
// thickness) off the middle of the storey.
import { StrandScene } from '../../src/scene/StrandScene';
import { SAMPLES } from '../../src/model/samples';
import { boxStitchMN } from '../../src/model/boxmn';

const RUNG = 0.5; // a rung is half a thickness (PLANE_RUNGS in the panel)

/** `box + strand` is a box and one more strand. Take the strand, and everything placed on it. */
function referenceBox() {
  const sc = SAMPLES['box-and-strand']();
  const drop = (id) => id === '3_1';
  const keep = (o) =>
    Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !k.split('|').some(drop)));
  return {
    ...sc,
    name: 'box + strand, without 3_1',
    strands: sc.strands.filter((s) => !drop(s.id)),
    planes: keep(sc.planes),
    crossPlanes: keep(sc.crossPlanes),
  };
}

// The family numbers the weft's two arms the other way round from the sample:
// its `1_2` runs west from the slant's far end, which is the sample's `1_3`.
const HAND = { '1_2': '1_3', '1_3': '1_2' };
const asHand = (id) => HAND[id] ?? id;

const panels = [
  { id: 'ref', view: new StrandScene(document.getElementById('c-ref')), scene: referenceBox(), hand: (i) => i },
  { id: 'before', view: new StrandScene(document.getElementById('c-before')),
    scene: boxStitchMN(1, 1, 'Box 1×1 RH, first level', 'rh', 0, false), hand: asHand },
  { id: 'after', view: new StrandScene(document.getElementById('c-after')),
    scene: boxStitchMN(1, 1, 'Box 1×1 RH, first level, placed', 'rh', 0, true), hand: asHand },
];
const views = panels.map((p) => p.view);
const state = { link: true };

/** What the panel does with a scene's placements: rungs to thicknesses, then to the view. */
function place(view, sc) {
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

/** Every crossing of two different laces: sorted hand ids to each lace's height in rungs. */
function read(p) {
  const { view, hand } = p;
  const th = view.getThicknessWorld();
  const plane = view.getStoreyPlane(0);
  const out = new Map();
  for (const c of view.getCrossPoints()) {
    const a = hand(c.aId);
    const b = hand(c.bId);
    if (a.split('_')[0] === b.split('_')[0]) continue; // a lace's own glued joint
    const z = (id, hid) => (nearest(view.getStrandCentrelineWorld(id), c.x, c.y).z - plane) / th / RUNG;
    const over = hand(c.overIndex === c.aIndex ? c.aId : c.bId);
    out.set([a, b].sort().join('|'), { [a]: z(c.aId, a), [b]: z(c.bId, b), over });
  }
  return out;
}

const KINDS = {
  '1_1|2_1': 'slant · slant',
  '1_1|2_2': 'arm over slant', '1_1|2_3': 'arm over slant',
  '1_2|2_1': 'arm over slant', '1_3|2_1': 'arm over slant',
  '1_2|2_2': 'arm · arm', '1_2|2_3': 'arm · arm', '1_3|2_2': 'arm · arm', '1_3|2_3': 'arm · arm',
};
const fmt = (n) => (n > 0.005 ? '+' : n < -0.005 ? '−' : '') + Math.abs(n).toFixed(2);

function table(rows) {
  const host = document.getElementById('rows');
  host.textContent = '';
  const worst = { before: 0, after: 0 };
  for (const [key, kind] of Object.entries(KINDS)) {
    const tr = document.createElement('tr');
    const ref = rows.ref.get(key);
    const cell = (text, cls) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      tr.appendChild(td);
    };
    cell(key.replace('|', ' × '));
    cell(kind);
    const ids = key.split('|');
    cell(ids.map((id) => `${id} ${fmt(ref[id])}`).join(' · ') + `  (${ref.over} over)`);
    for (const side of ['before', 'after']) {
      const r = rows[side].get(key);
      const diff = Math.max(...ids.map((id) => Math.abs(r[id] - ref[id])));
      worst[side] = Math.max(worst[side], diff);
      const sameOver = r.over === ref.over;
      cell(ids.map((id) => `${id} ${fmt(r[id])}`).join(' · ') + `  (${r.over} over)`,
        diff <= 0.5 && sameOver ? 'ok' : 'off');
    }
    host.appendChild(tr);
  }
  document.getElementById('worst-before').textContent = `${worst.before.toFixed(2)} rungs`;
  document.getElementById('worst-after').textContent = `${worst.after.toFixed(2)} rungs`;
}

function render() {
  const rows = {};
  for (const p of panels) {
    p.view.setScene(p.scene, false);
    place(p.view, p.scene);
    rows[p.id] = read(p);
    document.getElementById(`${p.id}-strands`).textContent = String(p.scene.strands.length);
    document.getElementById(`${p.id}-placed`).textContent =
      Object.keys(p.scene.planes ?? {}).length + Object.keys(p.scene.crossPlanes ?? {}).length || 'none';
  }
  table(rows);
}

function paintTheme() {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  views.forEach((v) => v.setTheme(dark ? 'dark' : 'light'));
}

// ---- cameras: orbit one, the others follow ---------------------------------------
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
  const d = v.camera.position.length() * 0.8;
  v.camera.position.set(0.15, -1.0, 0.22).normalize().multiplyScalar(d);
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

window.__ba = { panels, render, read }; // test hook
render();
setCam((v) => v.fitView());
document.getElementById('loading').remove();
