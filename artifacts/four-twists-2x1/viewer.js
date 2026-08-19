// The page's own studio — and here that is meant literally.
//
// A baked artifact replays meshes a headless studio built for it. This one
// cannot: the point of the page is that you can take hold of a point and move
// it, and a mesh has no points to take hold of. So the page carries
// `StrandScene` — the studio's own view, the same class the app runs, with the
// same move tool — and builds the ring in the browser. The promise a bake makes
// by construction ("the page cannot disagree with the app") this keeps by
// identity: there is no second implementation, because it IS the app.
import * as THREE from 'three';
import { StrandScene } from '../../src/scene/StrandScene';
import { connectedEndpoints, pointsClose, setEndpoint } from '../../src/model/connections';
import { syncPassiveCp2, updateControlCenter } from '../../src/model/controlPoints';
import { sceneToJson } from '../../src/model/sceneIO';
import { armsOf, buildRing, cutTo, ROUNDS } from './ring-scene';

const canvas = document.getElementById('c');
const view = new StrandScene(canvas);
// The grid is the app's drawing plane; on a page about how high things stand it
// only competes with the model. Every vertex stays where the app puts it.
view.setParams({ showGrid: false });

let ring = buildRing();
let showing = ROUNDS; // the storey on top, or FLAT
let flat = false;
let picked = null; // the arm whose joint the nudger moves

const $ = (id) => document.getElementById(id);
const HEIGHT = $('height');
const COUNT = $('count');
const VERDICT = $('verdict');
const CAPTION = $('caption');
const EXT = $('ext');
const ARMS = $('arms');
const STATUS = $('status');

// ---- what is on screen ------------------------------------------------------
function shown() {
  return cutTo(ring, flat ? ROUNDS : showing, !flat);
}

/** How tall the model stands, in storeys: one storey is two strand thicknesses,
 *  which is what the app itself steps a level by. Measured off the meshes, so
 *  the number cannot drift away from the model it describes. */
function storeysTall() {
  const box = new THREE.Box3().setFromObject(view.strandGroup);
  if (!isFinite(box.min.z)) return 0;
  const step = view.getLevelStep() * 0.02; // source units -> world, as StrandScene scales
  return (box.max.z - box.min.z) / step;
}

function paintReadout() {
  const scene = view.getScene();
  COUNT.textContent = scene.strands.length;
  HEIGHT.textContent = storeysTall().toFixed(2);
  const breaks = scene.levelBreaks.length;
  VERDICT.textContent = flat
    ? 'four rounds, one plane'
    : `${breaks} break${breaks === 1 ? '' : 's'} in the stack`;
  VERDICT.className = flat ? 'bad' : 'ok';
  CAPTION.textContent = flat
    ? 'The ring as the lab hands it over: no level breaks, so every round rests on the same plane and the four of them read as one thick round.'
    : showing === 0
      ? 'The block alone — three laces crossing, the ground floor. No break yet: there is nothing above it to lift.'
      : `The block plus ${showing} round${showing === 1 ? '' : 's'} of k = −1, each one a storey up. Every crossing is woven inside its own storey.`;
  paintExtension();
}

function paintButtons() {
  document.querySelectorAll('[data-scene]').forEach((b) => {
    const want = b.dataset.scene === 'FLAT' ? flat : !flat && Number(b.dataset.scene) === showing;
    b.setAttribute('aria-pressed', String(want));
  });
  document.querySelectorAll('[data-tool]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.tool === view.getMode())));
}

/** Refill the arm picker with the storey on top — those are the points a level
 *  is normally dialled at, and the ones the fit moved last. */
function paintArms() {
  const storey = flat ? ROUNDS : showing;
  const arms = armsOf(ring, storey).filter((id) => ring.scene.strands.find((s) => s.id === id)?.parentId);
  ARMS.innerHTML = '';
  for (const id of arms) {
    const option = document.createElement('option');
    option.value = id;
    const parent = ring.scene.strands.find((s) => s.id === id).parentId;
    option.textContent = `${id} · welds on ${parent}`;
    ARMS.append(option);
  }
  ARMS.disabled = arms.length === 0;
  if (!arms.includes(picked)) picked = arms[0] ?? null;
  if (picked) ARMS.value = picked;
  document.querySelectorAll('[data-nudge]').forEach((b) => (b.disabled = !picked));
}

/** Where the picked arm's joint sits along the arm it leaves — the lab's
 *  extension, measured from the parent's own start. */
function extensionOf(id) {
  const child = ring.scene.strands.find((s) => s.id === id);
  if (!child || !child.parentId) return null;
  const parent = ring.scene.strands.find((s) => s.id === child.parentId);
  if (!parent) return null;
  const along = Math.hypot(
    child.start.x - parent.start.x,
    child.start.y - parent.start.y,
  );
  return { child, parent, along };
}

function paintExtension() {
  const at = picked && extensionOf(picked);
  EXT.textContent = at ? `${at.along.toFixed(1)} px along ${at.parent.id}` : '—';
}

// ---- moving a joint ---------------------------------------------------------
/**
 * Slide the picked arm's joint along the arm it leaves.
 *
 * This is the app's own endpoint move, with the direction fixed: every endpoint
 * glued to that point goes with it (so the weld stays welded and the storey
 * above keeps hanging off it), and a control point that sat on the junction
 * stays on it, which is what keeps a straight strand straight. Along the parent
 * is the direction that means something — it is the extension the fit dials —
 * and constraining it is the difference between adjusting a stitch and nudging
 * a point somewhere in the plane. Drag with **Move points** for the latter.
 */
function nudge(px) {
  const at = picked && extensionOf(picked);
  if (!at) return;
  const { child, parent } = at;
  const vx = parent.end.x - parent.start.x;
  const vy = parent.end.y - parent.start.y;
  const len = Math.hypot(vx, vy) || 1;
  const anchor = { x: child.start.x, y: child.start.y };
  const to = { x: anchor.x + (vx / len) * px, y: anchor.y + (vy / len) * px };

  const scene = ring.scene;
  const index = scene.strands.indexOf(child);
  for (const ref of connectedEndpoints(scene, index, 0)) {
    const s = scene.strands[ref.index];
    const pinned = [
      pointsClose(s.control_points[0], anchor),
      pointsClose(s.control_points[1], anchor),
    ];
    const centred = !!s.control_point_center && pointsClose(s.control_point_center, anchor);
    setEndpoint(s, ref.side, to);
    if (pinned[0]) s.control_points[0] = { ...to };
    if (pinned[1]) s.control_points[1] = { ...to };
    if (centred && s.control_point_center) s.control_point_center = { ...to };
    if (ref.side === 1) syncPassiveCp2(s);
    updateControlCenter(s);
  }
  say(`${picked} moved ${px > 0 ? '+' : ''}${px} px along ${parent.id}`);
  render(false);
}

// ---- the page ---------------------------------------------------------------
let says = 0;
function say(text) {
  STATUS.textContent = text;
  const mine = ++says;
  setTimeout(() => {
    if (mine === says) STATUS.textContent = '';
  }, 4000);
}

function paintTheme() {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  view.setTheme(dark ? 'dark' : 'light');
}

let framed = '';
function render(refit) {
  view.setScene(shown(), false);
  // Refit when the shape changes, not when a point moves: a joint sliding under
  // a camera that keeps still is the thing worth watching.
  const shape = flat ? 'flat' : `S${showing}`;
  if (refit || shape !== framed) {
    view.fitView();
    framed = shape;
  }
  paintButtons();
  paintArms();
  paintReadout();
}

function step(to) {
  if (to === 'FLAT') {
    flat = true;
  } else {
    flat = false;
    showing = Math.max(0, Math.min(ROUNDS, to));
  }
  render(false);
}

document.querySelectorAll('[data-scene]').forEach((b) =>
  b.addEventListener('click', () => step(b.dataset.scene === 'FLAT' ? 'FLAT' : Number(b.dataset.scene))));

document.querySelectorAll('[data-tool]').forEach((b) =>
  b.addEventListener('click', () => {
    view.setMode(b.dataset.tool);
    paintButtons();
    say(b.dataset.tool === 'move' ? 'Grab a point and drag it.' : 'Drag to orbit.');
  }));

/** Edge on, at the distance the app's own fit picked — the view a storey is
 *  visible in, and the one this page is really about. */
function sideView() {
  view.fitView();
  const target = view.controls.target;
  const dist = view.camera.position.distanceTo(target);
  const dir = new THREE.Vector3(0.1, -0.99, 0.08).normalize();
  view.camera.position.copy(target).addScaledVector(dir, dist * 0.85);
  view.camera.updateProjectionMatrix();
  view.controls.update();
}

document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.view === 'top') view.topView();
    else if (b.dataset.view === 'side') sideView();
    else view.fitView();
    document.querySelectorAll('[data-view]').forEach((o) =>
      o.setAttribute('aria-pressed', String(o === b)));
  }));

document.querySelectorAll('[data-nudge]').forEach((b) =>
  b.addEventListener('click', () => nudge(Number(b.dataset.nudge))));

ARMS.addEventListener('change', () => {
  picked = ARMS.value;
  paintExtension();
});

$('reset').addEventListener('click', () => {
  ring = buildRing();
  picked = null;
  render(true);
  say('Back to the ring as it was fitted.');
});

$('copy').addEventListener('click', async () => {
  const text = sceneToJson(ring.scene);
  try {
    await navigator.clipboard.writeText(text);
    say(`Copied — ${ring.scene.strands.length} strands, ${ring.scene.levelBreaks.length} level breaks.`);
  } catch {
    // Clipboard access can be refused inside a frame; fall back to a selection
    // the reader can copy themselves rather than losing the edit.
    const box = $('json');
    box.value = text;
    box.hidden = false;
    box.select();
    say('Clipboard refused — the scene is selected below, copy it from there.');
  }
});

// ← / → step through the storeys, which is the whole point of the rail.
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.key === 'ArrowRight') step(flat ? 'FLAT' : showing === ROUNDS ? 'FLAT' : showing + 1);
  else if (e.key === 'ArrowLeft') step(flat ? ROUNDS : showing - 1);
});

// An edit made with the move tool is an edit to the ring, so the numbers follow.
view.onSceneChanged = () => paintReadout();

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);
new MutationObserver(paintTheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});

// What the ring itself reports, once its joints are closed and its storeys in.
$('joints').textContent = `${ring.joints.welded}/${ring.joints.declared}`;
$('pieces').textContent = ring.pieces;
$('runs').textContent = ring.runs.length;

paintTheme();
render(true);
$('loading').remove();
