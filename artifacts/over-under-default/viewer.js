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

// THE PLANES. The studio's panel places a lace on a ladder of seven rungs; a rung is
// half a strand thickness, so rung 0 is the middle of the storey, ±2 its floor and
// ceiling, and ±1 the halves between. A run plane (`setSublevels`) says where a whole
// lace rests. A crossing plane (`setCrossingPlanes`) says where it sits at one
// passage, and it outranks the run plane there. Both take the panel's value, which is
// the rung over two, in thicknesses off the storey middle.
const RUNGS = [
  { rung: 3, name: 'above this storey', note: 'clears its ceiling' },
  { rung: 2, name: 'top of this storey', note: 'floor of the next' },
  { rung: 1, name: 'upper half', note: 'rests on −1' },
  { rung: 0, name: 'middle', note: '' },
  { rung: -1, name: 'lower half', note: 'carries +1' },
  { rung: -2, name: 'floor of this storey', note: 'top of the one below' },
  { rung: -3, name: 'below this storey', note: 'hangs under the floor' },
];
const rungName = (r) => RUNGS.find((x) => x.rung === r).name;
const half = (r) => r / 2; // thicknesses off the storey middle

// What each choice sets. `h` and `v` are the rungs each lace is placed on, null for
// not placed. `cross` also places the crossing itself on those rungs, which is what
// makes the contact exact: a run plane alone still gets the weave swing on top.
// `over` is who rides over: v is the higher layer, so v is today's answer.
const OPTIONS = {
  today: { label: 'Today', over: 'v', h: null, v: null, cross: false, depth: 26,
    blurb: 'No plane placed on either lace. Higher layer over, and each lace swings 26 px off the storey plane, so there is a clear thickness of air between them.' },
  meet: { label: 'Meet in the middle', over: 'v', h: -1, v: 1, cross: true, depth: 26,
    blurb: 'Orange on the lower half, yellow on the upper half. Each sits half a thickness from the middle, so the surfaces meet exactly.' },
  low: { label: 'Both low', over: 'v', h: -2, v: 0, cross: true, depth: 26,
    blurb: 'Orange on the floor, yellow on the middle. They touch exactly, and the whole crossing sits in the lower half of the storey, leaving the upper half free for the next lace.' },
  high: { label: 'Both high', over: 'v', h: 0, v: 2, cross: true, depth: 26,
    blurb: 'Orange on the middle, yellow on the ceiling. They touch exactly, with the crossing in the upper half and the lower half free underneath.' },
  spread: { label: 'Floor and ceiling', over: 'v', h: -2, v: 2, cross: false, depth: 26,
    blurb: 'Orange on the floor, yellow on the ceiling. A full thickness of air, which is what today\'s swing gives, but declared, so it holds for any Depth.' },
  clear: { label: 'Half a thickness clear', over: 'v', h: -2, v: 1, cross: false, depth: 26,
    blurb: 'Orange on the floor, yellow on the upper half. Three rungs apart, so 13 px of daylight and no weave swing needed.' },
  meetFlip: { label: 'Meet, orange on top', over: 'h', h: 1, v: -1, cross: true, depth: 26,
    blurb: 'The same exact contact with the roles swapped: orange on the upper half, yellow on the lower half.' },
  first: { label: 'First drawn on top', over: 'h', h: null, v: null, cross: false, depth: 26,
    blurb: 'No planes placed. Only who is over changes: the lace drawn first rides over, with today\'s heights.' },
  custom: { label: 'Your own', over: 'v', h: -1, v: 1, cross: true, depth: 26,
    blurb: 'Pick a rung for each lace and who is over.' },
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

const state = { opt: 'meet', link: true };

function apply(view, o) {
  view.setParams({ weaveDepth: o.depth });
  view.setScene(twoStrands(o.over === 'v' ? null : false), false);
  const rungs = { h: o.h, v: o.v };
  const placed = Object.entries(rungs).filter(([, r]) => r !== null);
  // Nothing placed is null, not an empty map: a declared map turns the fold easing
  // off, so "no planes" has to reach the scene as no map at all.
  view.setSublevels(
    placed.length ? new Map(placed.map(([id, r]) => [id, { in: half(r), out: half(r) }])) : null,
  );
  view.setCrossingPlanes(
    o.cross && placed.length
      ? new Map(placed.map(([id, r]) => [`h|v|0|${id}`, half(r)]))
      : null,
  );
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
  const plane = view.getStoreyPlane(0); // the middle of the storey both laces are on
  const sep = zs[overId] - zs[underId];
  const air = sep - thick;
  const rows = [
    ['Over lace', `${overId} ${fmt(px(zs[overId] - plane))} px · moves ${fmt(px(zs[overId] - rest[overId]))}`],
    ['Under lace', `${underId} ${fmt(px(zs[underId] - plane))} px · moves ${fmt(px(zs[underId] - rest[underId]))}`],
    ['Centre to centre', `${Math.abs(px(sep))} px`],
    ['Air between', sep < 0 ? 'placed upside down' : air >= 0 ? `${px(air)} px` : `overlap ${px(-air)} px`],
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

// ---- the ladder: which planes this build uses ------------------------------------
function ladder(host, o, jsonHost) {
  host.textContent = '';
  for (const r of RUNGS) {
    const row = document.createElement('div');
    row.className = 'rung' + (r.rung % 2 === 0 ? ' major' : '');
    const n = document.createElement('b');
    n.textContent = (r.rung > 0 ? '+' : r.rung < 0 ? '−' : '') + Math.abs(r.rung);
    const label = document.createElement('span');
    label.textContent = r.name;
    row.append(n, label);
    for (const id of ['h', 'v']) {
      if (o[id] === r.rung) {
        const chip = document.createElement('i');
        chip.className = 'lace ' + id;
        chip.textContent = id;
        row.appendChild(chip);
      }
    }
    host.appendChild(row);
  }
  const planes = {};
  const cross = {};
  for (const id of ['h', 'v']) {
    if (o[id] === null) continue;
    planes[id] = o[id];
    if (o.cross) cross[`h|v|0|${id}`] = o[id];
  }
  const none = Object.keys(planes).length === 0;
  jsonHost.textContent = none
    ? 'planes: none placed\ncrossPlanes: none placed'
    : `planes: ${JSON.stringify(planes)}\ncrossPlanes: ${Object.keys(cross).length ? JSON.stringify(cross) : 'none placed'}`;
}

function syncPicker(o) {
  document.getElementById('sel-h').value = o.h === null ? 'none' : String(o.h);
  document.getElementById('sel-v').value = o.v === null ? 'none' : String(o.v);
  document.getElementById('sel-over').value = o.over;
  document.getElementById('sel-cross').checked = !!o.cross;
}

let first = true;
function render() {
  const o = OPTIONS[state.opt];
  apply(today, OPTIONS.today);
  apply(prop, o);
  if (first) {
    low(today);
    syncFrom(today);
    first = false;
  }
  measure(today, document.getElementById('m-today'));
  measure(prop, document.getElementById('m-prop'));
  ladder(document.getElementById('lad-today'), OPTIONS.today, document.getElementById('json-today'));
  ladder(document.getElementById('lad-prop'), o, document.getElementById('json-prop'));
  document.getElementById('prop-name').textContent = o.label;
  document.getElementById('prop-blurb').textContent = o.blurb;
  syncPicker(o);
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

// The picker: any rung for either lace, and who is over. Touching it makes the build "Your own".
const selH = document.getElementById('sel-h');
const selV = document.getElementById('sel-v');
for (const sel of [selH, selV]) {
  sel.add(new Option('not placed', 'none'));
  for (const r of RUNGS) sel.add(new Option(`${r.rung > 0 ? '+' : r.rung < 0 ? '−' : ''}${Math.abs(r.rung)} · ${r.name}`, String(r.rung)));
}
function fromPicker() {
  const v = (el) => (el.value === 'none' ? null : Number(el.value));
  OPTIONS.custom.h = v(selH);
  OPTIONS.custom.v = v(selV);
  OPTIONS.custom.over = document.getElementById('sel-over').value;
  OPTIONS.custom.cross = document.getElementById('sel-cross').checked;
  state.opt = 'custom';
  render();
}
for (const id of ['sel-h', 'sel-v', 'sel-over', 'sel-cross']) {
  document.getElementById(id).addEventListener('change', fromPicker);
}

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

window.__ou = { state, render, OPTIONS }; // test hook
render();
document.getElementById('loading').remove();
