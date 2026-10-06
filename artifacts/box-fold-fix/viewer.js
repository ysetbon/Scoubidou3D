// The fold-end contact, and candidate fixes, on the studio's own view.
//
// Once a level has another level above it, the end of each of its arms turns back
// and carries on as the arm above. That end sits 32 px past the neighbouring arm's
// centre (`POKE`), a ribbon is 46 wide, so the turning end touches the arm beside
// it. Four panels: today, the same box with the fold stops pushed out by two
// amounts, and one that lifts the tips instead. Every panel is `StrandScene` fed by
// `boxStitchMN`. The figures are distances from each turning end, read back off
// the built ribbons; the judgement is the picture, which is why there is a camera
// that goes straight to a fold end.
import { StrandScene } from '../../src/scene/StrandScene';
import { boxStitchMN } from '../../src/model/boxmn';

const RUNG = 0.5; // a rung is half a thickness
const W = 46; // ribbon width, px
const T = 26; // ribbon thickness, px
const SCALE = 0.02; // world units per px

const OPTIONS = [
  { id: 'today', name: 'Today', stop: 0, lift: 0, note: 'Fold stops 32 px past the neighbouring arm\'s centre.' },
  { id: 'stop16', name: 'Stops out 16 px', stop: 16, lift: 0, note: 'The fold stops move 16 px further out. Nothing else changes.' },
  { id: 'stop28', name: 'Stops out 28 px', stop: 28, lift: 0, note: 'The fold stops move 28 px further out: room for the curl as well.' },
  { id: 'lift', name: 'Tips lifted', stop: 0, lift: 2, note: 'Footprint unchanged. The last stretch of every folding arm rises two rungs, a full thickness, towards the next level.' },
];
const state = { levels: 3, hand: 'rh', link: true };

const panels = OPTIONS.map((o) => {
  const el = document.createElement('div');
  el.className = 'side';
  el.innerHTML = `<h2><b>${o.name}</b><span id="w-${o.id}"></span></h2><div class="stage"><canvas id="c-${o.id}"></canvas></div><p>${o.note}</p><dl class="ledger" id="l-${o.id}"></dl>`;
  document.getElementById('panels').appendChild(el);
  const view = new StrandScene(el.querySelector('canvas'));
  view.renderer.shadowMap.enabled = false;
  return { ...o, view };
});
const views = panels.map((p) => p.view);

function sceneFor(o) {
  const { levels, hand } = state;
  return boxStitchMN(1, 1, `Box 1×1 ${hand.toUpperCase()}, ${levels} levels — ${o.name}`, hand, levels - 1, true, 'hand', o.stop);
}

function place(view, sc, o) {
  const folding = (id) => levelOf(id) < state.levels && Number(id.split('_')[1]) >= 2;
  const runs = Object.entries(sc.planes ?? {});
  const map = new Map(runs.map(([id, r]) => [id, { in: r * RUNG, out: r * RUNG }]));
  // The lift is a preview: a ramp along the arm, which a saved scene's per-layer
  // rung cannot say. The arm keeps its own rest and rises towards its end.
  if (o.lift) {
    for (const st of sc.strands) {
      if (!folding(st.id)) continue;
      const rest = (sc.planes?.[st.id] ?? 0) * RUNG;
      map.set(st.id, { in: rest, out: rest + o.lift * RUNG });
    }
  }
  view.setSublevels(map.size ? map : null);
  const cross = Object.entries(sc.crossPlanes ?? {});
  view.setCrossingPlanes(cross.length ? new Map(cross.map(([k, r]) => [k, r * RUNG])) : null);
}

const layer = (id) => Number(id.split('_')[1]);
const levelOf = (id) => (layer(id) < 4 ? 1 : Math.floor((layer(id) - 2) / 2) + 1);

/**
 * Where each turning end sits against the arm beside it, on its own level.
 *
 * The end of an arm is a point; the arm beside it is a ribbon 46 wide and 26 thick.
 * Two numbers say how close they are: how far the end is from the neighbour's NEAR
 * EDGE as seen from above, and how far it is from the neighbour's height. A turning
 * ribbon needs about half a thickness (13 px) of room to curl, so a tip that is less
 * than that from the edge, and less than a thickness from the height, is touching.
 */
function contact(view, sc) {
  const top = state.levels;
  const lines = {};
  for (const st of sc.strands) lines[st.id] = view.getStrandCentrelineWorld(st.id);
  let gap = Infinity;
  let dzAt = 0;
  let touching = 0;
  let folds = 0;
  for (const s of sc.strands) {
    if (layer(s.id) < 2 || levelOf(s.id) >= top) continue;
    folds++;
    const line = lines[s.id];
    const E = line[line.length - 1];
    let best = { g: Infinity, dz: 0 };
    for (const t of sc.strands) {
      if (levelOf(t.id) !== levelOf(s.id) || t.id.split('_')[0] === s.id.split('_')[0]) continue;
      for (const q of lines[t.id]) {
        const g = Math.hypot(E.x - q.x, E.y - q.y) / SCALE - W / 2;
        if (g < best.g) best = { g, dz: Math.abs(E.z - q.z) / SCALE };
      }
    }
    if (best.g < gap) { gap = best.g; dzAt = best.dz; }
    if (best.g < T / 2 && best.dz < T) touching++;
  }
  return { folds, touching, gap, dz: dzAt };
}

function ledger(o, r) {
  const host = document.getElementById(`l-${o.id}`);
  host.textContent = '';
  const rows = [
    ['Fold ends touching', `${r.touching} of ${r.folds}`, r.touching ? 'bad' : 'good'],
    ['Nearest end to a neighbour\'s edge', `${Math.max(0, r.gap).toFixed(0)} px`, r.gap < T / 2 ? 'bad' : 'good'],
    ['…and its height from that neighbour', `${r.dz.toFixed(0)} px`, r.dz < T ? 'bad' : 'good'],
  ];
  for (const [k, v, cls] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    if (cls) dd.className = cls;
    host.append(dt, dd);
  }
}

function render() {
  for (const p of panels) {
    const sc = sceneFor(p);
    p.scene = sc;
    p.view.setScene(sc, false);
    place(p.view, sc, p);
    ledger(p, contact(p.view, sc));
  }
  document.querySelectorAll('[data-levels]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.levels === state.levels)));
  document.querySelectorAll('[data-hand]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.hand === state.hand)));
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
  const d = v.camera.position.length() * 1.05;
  v.camera.position.set(0.15, -1.0, 0.22).normalize().multiplyScalar(d);
  v.controls.update();
};
/** Close on the turning end of the east weft arm one level below the top, from the side it can be seen. */
function foldEnd(v) {
  const sc = state.levels >= 3 ? 2 : 1;
  const id = `1_${2 + 2 * (sc - 1)}`; // the weft arm of the level below the top: _2 at level 1, _4 at level 2
  const L = v.getStrandCentrelineWorld(id) ?? v.getStrandCentrelineWorld('1_2');
  const tip = L[L.length - 1];
  v.fitView();
  v.controls.target.set(tip.x, tip.y, tip.z);
  const d = 3.6;
  v.camera.position.set(tip.x + d * 0.75, tip.y - d * 0.45, tip.z + d * 0.5);
  v.controls.update();
}
document.getElementById('v-fit').addEventListener('click', () => setCam((v) => v.fitView()));
document.getElementById('v-side').addEventListener('click', () => setCam(side));
document.getElementById('v-plan').addEventListener('click', () => setCam((v) => v.topView()));
document.getElementById('v-fold').addEventListener('click', () => setCam(foldEnd));
document.getElementById('link').addEventListener('click', (e) => {
  state.link = !state.link;
  e.currentTarget.setAttribute('aria-pressed', String(state.link));
  if (state.link) views.slice(1).forEach((v) => copyCam(views[0], v));
});
document.querySelectorAll('[data-levels]').forEach((b) => b.addEventListener('click', () => { state.levels = +b.dataset.levels; render(); setCam((v) => v.fitView()); }));
document.querySelectorAll('[data-hand]').forEach((b) => b.addEventListener('click', () => { state.hand = b.dataset.hand; render(); setCam((v) => v.fitView()); }));

paintTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);
new MutationObserver(paintTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

window.__ff = { state, render, panels, contact }; // test hook
render();
setCam((v) => v.fitView());
document.getElementById('loading').remove();
