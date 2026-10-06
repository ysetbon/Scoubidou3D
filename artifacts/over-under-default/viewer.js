// One crossing, two strands at 90°, one storey. What does the studio do at it?
//
// Two StrandScene views — the same class the app runs. Left is the scene exactly
// as the app builds it with no mask and no placement: layer order decides, and the
// Depth slider's default sets the swing. Right is the same two strands under a
// different default. Nothing is drawn by this page; it only sets the same inputs
// the app already has (masks, Depth, placed crossing heights), so the geometry on
// both sides is the engine's own, and every number below is read back off it.
import { StrandScene } from '../../src/scene/StrandScene';

const YELLOW = { r: 245, g: 200, b: 55, a: 255 };
const ORANGE = { r: 226, g: 122, b: 38, a: 255 };
const STROKE = { r: 30, g: 30, b: 30, a: 255 };
const SCALE = 0.02; // source px -> world, as in StrandScene

function mk(id, start, end, color, width) {
  return {
    id, start, end,
    control_points: [{ ...start }, { ...start }],
    control_point_center: null,
    control_point_center_locked: false,
    triangleHasMoved: false,
    cp2Activated: false,
    width,
    stroke_width: 4,
    color,
    stroke_color: STROKE,
    thickness: null,
    visible: true,
    isMask: false,
    hasCircles: [false, false],
    parentId: null,
    parentSide: null,
  };
}

// h is drawn first (bottom layer), v second (top layer). 90° apart, crossing at
// their middles, no level break: one storey.
function twoStrands(maskVOver) {
  return {
    name: 'Two strands, 90°, one level',
    strands: [
      mk('h', { x: 150, y: 250 }, { x: 650, y: 250 }, ORANGE, 54),
      mk('v', { x: 400, y: 70 }, { x: 400, y: 430 }, YELLOW, 54),
    ],
    masks: maskVOver === null ? [] : [maskVOver ? { overId: 'v', underId: 'h' } : { overId: 'h', underId: 'v' }],
    levelBreaks: [],
  };
}

// Heights are placed in thicknesses off the storey floor — the unit the studio's
// own "place a crossing" uses. Key: <lower id>|<higher id>|<n>|<strand>.
const placed = (h, v) => new Map([['h|v|0|h', h], ['h|v|0|v', v]]);

// What each choice sets. `depth` is the Depth slider (source px; 0 = the floor the
// engine enforces so ribbons never pass through each other). `over` is who rides
// over: v is the higher layer, so true is today's answer.
const OPTIONS = {
  today: { label: 'Today', over: 'v', depth: 26, planes: null,
    blurb: 'Higher layer over. Each lace swings 26 px off the plane, so there is a clear thickness of air between them.' },
  touch: { label: 'Resting on it', over: 'v', depth: 0, planes: null,
    blurb: 'Same lace over, but the swing drops to the least that keeps them apart. The top lace rests on the bottom one instead of hovering over it.' },
  flat: { label: 'Under lace stays flat', over: 'v', depth: 26, planes: placed(0, 1),
    blurb: 'The lower lace lies flat on the plane and only the top lace arches over it, by exactly one thickness.' },
  first: { label: 'First drawn on top', over: 'h', depth: 26, planes: null,
    blurb: 'Reverse who is over: the lace drawn first rides over the one drawn later. Same heights as today.' },
};

function paintTheme(views) {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  views.forEach((v) => v.setTheme(dark ? 'dark' : 'light'));
}

const today = new StrandScene(document.getElementById('c-today'));
const prop = new StrandScene(document.getElementById('c-prop'));
const views = [today, prop];
views.forEach((v) => { v.renderer.shadowMap.enabled = false; });

const state = { opt: 'flat', link: true };

function apply(view, opt) {
  const o = OPTIONS[opt];
  view.setParams({ weaveDepth: o.depth });
  view.setScene(twoStrands(o.over === 'v' ? null : false), false);
  view.setCrossingPlanes(o.planes);
}

// ---- read the answer back off the engine ------------------------------------------
function nearest(line, x, y) {
  let best = line[0];
  let d = Infinity;
  for (const p of line) {
    const q = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (q < d) { d = q; best = p; }
  }
  return best;
}
const px = (w) => Math.round(w / SCALE);
const fmt = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);

function measure(view, host) {
  const cross = view.getCrossings()[0];
  const pt = view.getCrossPoints()[0];
  const thick = view.getThicknessWorld();
  const zs = {};
  for (const id of ['h', 'v']) zs[id] = nearest(view.getStrandCentrelineWorld(id), pt.x, pt.y).z;
  const overId = cross.overId;
  const underId = cross.underId;
  // Each lace's own resting height is its height at its free end, away from any crossing.
  const rest = {};
  for (const id of ['h', 'v']) rest[id] = view.getStrandCentrelineWorld(id)[0].z;
  const sep = zs[overId] - zs[underId];
  const air = sep - thick;
  const rows = [
    ['Over lace', `${overId} · ${fmt(px(zs[overId] - rest[overId]))} px`],
    ['Under lace', `${underId} · ${fmt(px(zs[underId] - rest[underId]))} px`],
    ['Centre to centre', `${px(sep)} px`],
    ['Air between', air >= 0 ? `${px(air)} px` : `overlap ${px(-air)} px`],
    ['Level', `${cross.levelA} and ${cross.levelB}${cross.woven ? ' · woven' : ''}`],
  ];
  host.textContent = '';
  for (const [k, v] of rows) {
    const d = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = v;
    d.append(dt, dd);
    host.appendChild(d);
  }
}

let first = true;
function render() {
  apply(today, 'today');
  apply(prop, state.opt);
  if (first) {
    low(today);
    syncFrom(today);
    first = false;
  }
  measure(today, document.getElementById('m-today'));
  measure(prop, document.getElementById('m-prop'));
  document.getElementById('prop-name').textContent = OPTIONS[state.opt].label;
  document.getElementById('prop-blurb').textContent = OPTIONS[state.opt].blurb;
  document.querySelectorAll('[data-opt]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.opt === state.opt)));
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
  copyCam(src, src === today ? prop : today);
  syncing = false;
}
today.controls.addEventListener('change', () => syncFrom(today));
prop.controls.addEventListener('change', () => syncFrom(prop));

function low(v) {
  v.fitView();
  const d = v.camera.position.length() * 0.75;
  v.camera.position.set(0.3, -1.0, 0.34).normalize().multiplyScalar(d);
  v.controls.update();
}
function setCam(fn) {
  const was = state.link;
  state.link = false;
  views.forEach(fn);
  state.link = was;
  copyCam(today, prop);
}
document.getElementById('v-low').addEventListener('click', () => setCam(low));
document.getElementById('v-tilt').addEventListener('click', () => setCam((v) => { v.fitView(); }));
document.getElementById('v-plan').addEventListener('click', () => setCam((v) => { v.topView(); }));
document.getElementById('link').addEventListener('click', (e) => {
  state.link = !state.link;
  e.currentTarget.setAttribute('aria-pressed', String(state.link));
  if (state.link) copyCam(today, prop);
});
document.querySelectorAll('[data-opt]').forEach((b) =>
  b.addEventListener('click', () => { state.opt = b.dataset.opt; render(); }));

const p = today.getParams();
document.getElementById('p-thick').textContent = p.thickness;
document.getElementById('p-depth').textContent = p.weaveDepth;
document.getElementById('p-depth2').textContent = p.weaveDepth;
document.getElementById('p-lift').textContent = p.layerGap;
document.getElementById('p-span').textContent = p.weaveSpan;

paintTheme(views);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => paintTheme(views));
new MutationObserver(() => paintTheme(views)).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});

render();
document.getElementById('loading').remove();
