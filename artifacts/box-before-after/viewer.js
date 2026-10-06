// Two copies of the studio's own view, one scene each: the box as the family builds
// it today, and the same box placed the way `box + strand` was placed.
//
// Nothing here is baked. Both sides are `StrandScene` fed by `boxStitchMN` — the
// builder the app's Browse grid calls — and the only difference between them is the
// last argument: `placed`. So the page cannot disagree with the app about either
// side, and it keeps comparing against whatever the family builds by default
// because "before" is asked for by name rather than being "whatever is current".
//
// The numbers under each canvas are read back off the built ribbons, not computed
// from the model: where each lace actually is at each crossing, in the engine's own
// world units, divided by one thickness.
import { StrandScene } from '../../src/scene/StrandScene';
import { boxStitchMN, BOX_MAX } from '../../src/model/boxmn';

const RUNG = 0.5; // a rung is half a thickness (PLANE_RUNGS in the panel)

const before = new StrandScene(document.getElementById('c-before'));
const after = new StrandScene(document.getElementById('c-after'));
const views = [before, after];
// 8×8 at fifteen levels is ~530 ribbons per side; two 2048² shadow maps each is
// what drops a machine without a GPU to a crawl, and the shadow says nothing about
// the over/unders. Every vertex stays where the app puts it.
views.forEach((v) => { v.renderer.shadowMap.enabled = false; });

// "Levels" is what the studio's Level panel counts — storeys. `boxStitchMN` counts
// rounds worked ON TOP of the starting stitch, so one level is the starting stitch
// alone and ten levels is nine rounds over it, exactly like the `Box stitch — 10
// levels` sample.
const state = { m: 3, n: 2, hand: 'rh', levels: 10, link: true };
const rounds = () => state.levels - 1;

const built = new Map();
function scene(placed) {
  const { m, n, hand, levels } = state;
  const key = `${placed}-${hand}-${m}x${n}-${levels}`;
  if (!built.has(key)) {
    if (built.size > 12) built.clear();
    built.set(
      key,
      boxStitchMN(m, n, `Box ${m}×${n} ${hand.toUpperCase()}, ${levels} levels${placed ? ', placed' : ''}`,
        hand, rounds(), placed),
    );
  }
  return built.get(key);
}

/** What the panel does with a scene's placements: rungs to thicknesses, then to the view. */
function place(view, sc) {
  const half = (r) => r * RUNG;
  const runs = Object.entries(sc.planes ?? {});
  view.setSublevels(runs.length ? new Map(runs.map(([id, r]) => [id, { in: half(r), out: half(r) }])) : null);
  const cross = Object.entries(sc.crossPlanes ?? {});
  view.setCrossingPlanes(cross.length ? new Map(cross.map(([k, r]) => [k, half(r)])) : null);
}

// ---- read the answer back off the engine --------------------------------------
function nearest(line, x, y) {
  let best = line[0];
  let d = Infinity;
  for (const p of line) {
    const q = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (q < d) { d = q; best = p; }
  }
  return best;
}

function measure(view, sc) {
  const th = view.getThicknessWorld();
  const lines = {};
  let lo = Infinity;
  let hi = -Infinity;
  for (const st of view.getScene().strands) {
    const l = view.getStrandCentrelineWorld(st.id);
    lines[st.id] = l;
    for (const p of l) { lo = Math.min(lo, p.z); hi = Math.max(hi, p.z); }
  }
  let woven = 0;
  let clear = 0; // the over lace sits about a full thickness (0.9 or more) above the under one
  let squeezed = 0; // over, but closer than 0.9 of a thickness: the ribbons share some height
  let inverted = 0; // the lace the weave calls "over" is the lower of the two
  let worst = Infinity;
  for (const c of view.getCrossPoints()) {
    if (!c.woven) continue;
    const over = c.overIndex === c.aIndex ? c.aId : c.bId;
    const under = over === c.aId ? c.bId : c.aId;
    // The glued joint of one lace with itself is counted as a crossing; it is not
    // a weave, and it would drown the figures.
    if (over.split('_')[0] === under.split('_')[0]) continue;
    const gap = (nearest(lines[over], c.x, c.y).z - nearest(lines[under], c.x, c.y).z) / th;
    woven++;
    worst = Math.min(worst, gap);
    if (gap < 0) inverted++;
    else if (gap < 0.9) squeezed++;
    else clear++;
  }
  const placed = Object.keys(sc.planes ?? {}).length + Object.keys(sc.crossPlanes ?? {}).length;
  return {
    strands: sc.strands.length,
    placed,
    woven,
    clear,
    squeezed,
    inverted,
    worst: woven ? worst : 0,
    height: (hi - lo) / th,
  };
}

const set = (id, text) => (document.getElementById(id).textContent = text);
const fmt = (n, d = 1) => n.toFixed(d).replace('-', '−');

function ledger(side, r) {
  set(`${side}-strands`, String(r.strands));
  set(`${side}-placed`, r.placed ? `${r.placed} placed` : 'none placed');
  set(`${side}-woven`, String(r.woven));
  set(`${side}-clear`, String(r.clear));
  set(`${side}-squeezed`, String(r.squeezed));
  set(`${side}-inverted`, String(r.inverted));
  set(`${side}-worst`, `${fmt(r.worst, 2)} th`);
  set(`${side}-height`, `${fmt(r.height, 1)} th`);
  document.getElementById(`${side}-inverted`).className = r.inverted ? 'bad' : 'good';
}

function paintTheme() {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  views.forEach((v) => v.setTheme(dark ? 'dark' : 'light'));
}

// ---- cameras: orbit one, the other follows ---------------------------------------
let syncing = false;
function copyCam(from, to) {
  to.camera.position.copy(from.camera.position);
  to.controls.target.copy(from.controls.target);
  to.camera.near = from.camera.near;
  to.camera.far = from.camera.far;
  to.camera.updateProjectionMatrix();
  to.controls.update();
}
function syncFrom(src) {
  if (syncing || !state.link) return;
  syncing = true;
  copyCam(src, src === before ? after : before);
  syncing = false;
}
before.controls.addEventListener('change', () => syncFrom(before));
after.controls.addEventListener('change', () => syncFrom(after));
function setCam(fn) {
  const was = state.link;
  state.link = false;
  views.forEach(fn);
  state.link = was;
  copyCam(before, after);
}
function side(v) {
  v.fitView();
  const d = v.camera.position.length() * 0.8;
  v.camera.position.set(0.15, -1.0, 0.22).normalize().multiplyScalar(d);
  v.controls.update();
}

let framed = '';
function render(refit) {
  const b = scene(false);
  const a = scene(true);
  before.setScene(b, false);
  place(before, b);
  after.setScene(a, false);
  place(after, a);
  const shape = `${state.hand}-${state.m}x${state.n}-${state.levels}`;
  if (refit || shape !== framed) {
    setCam((v) => v.fitView());
    framed = shape;
  }
  ledger('before', measure(before, b));
  ledger('after', measure(after, a));

  set('facename', `${state.m} × ${state.n}`);
  set('facemeta', `${state.hand === 'lh' ? 'left hand' : 'right hand'} · ${state.levels} level${state.levels === 1 ? '' : 's'}`);
  document.querySelectorAll('.cell').forEach((c) =>
    c.setAttribute('aria-pressed', String(+c.dataset.m === state.m && +c.dataset.n === state.n)));
  document.querySelectorAll('[data-hand]').forEach((c) =>
    c.setAttribute('aria-pressed', String(c.dataset.hand === state.hand)));
  document.querySelectorAll('[data-levels]').forEach((c) =>
    c.setAttribute('aria-pressed', String(+c.dataset.levels === state.levels)));
}

// ---- controls ----------------------------------------------------------------------
const grid = document.getElementById('grid');
let html = '<span class="ax corner">m→<br>n↓</span>';
for (let m = 1; m <= BOX_MAX; m++) html += `<span class="ax">${m}</span>`;
for (let n = 1; n <= BOX_MAX; n++) {
  html += `<span class="ax">${n}</span>`;
  for (let m = 1; m <= BOX_MAX; m++) {
    html += `<button type="button" class="cell" data-m="${m}" data-n="${n}"` +
      ` aria-pressed="false" aria-label="${m} by ${n}">${m}×${n}</button>`;
  }
}
grid.innerHTML = html;
grid.addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  state.m = +cell.dataset.m;
  state.n = +cell.dataset.n;
  render();
});
grid.addEventListener('keydown', (e) => {
  const cell = e.target.closest('.cell');
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!cell || !d) return;
  e.preventDefault();
  const m = Math.min(BOX_MAX, Math.max(1, +cell.dataset.m + d[0]));
  const n = Math.min(BOX_MAX, Math.max(1, +cell.dataset.n + d[1]));
  const next = grid.querySelector(`.cell[data-m="${m}"][data-n="${n}"]`);
  if (next) { next.focus(); state.m = m; state.n = n; render(); }
});
document.querySelectorAll('[data-hand]').forEach((b) =>
  b.addEventListener('click', () => { state.hand = b.dataset.hand; render(); }));
document.querySelectorAll('[data-levels]').forEach((b) =>
  b.addEventListener('click', () => { state.levels = +b.dataset.levels; render(); }));
document.getElementById('v-fit').addEventListener('click', () => setCam((v) => v.fitView()));
document.getElementById('v-side').addEventListener('click', () => setCam(side));
document.getElementById('v-plan').addEventListener('click', () => setCam((v) => v.topView()));
document.getElementById('link').addEventListener('click', (e) => {
  state.link = !state.link;
  e.currentTarget.setAttribute('aria-pressed', String(state.link));
  if (state.link) copyCam(before, after);
});

paintTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);
new MutationObserver(paintTheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});

window.__ba = { state, render, before, after }; // test hook
render(true);
document.getElementById('loading').remove();
