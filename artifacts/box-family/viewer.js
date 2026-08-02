// The page's own little studio: unpack the baked meshes, put them under an orbit
// camera, and let the size buttons swap which face you are holding.
//
// Everything here is presentation. The geometry arrived already built by the app
// (artifacts/lib/bake.mjs), so nothing in this file can make a slack stitch look
// tight or a tight one look slack.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import DATA from './.work/data.json';
import SPEC from './artifact.json';

const HOST = document.getElementById('stage');
const canvas = document.getElementById('c');
const FACES = SPEC.sample.faces;
const PACK = DATA.variants.box;
// The faces, each with the depths that were baked for it. Mesh weight is the
// only reason they differ — a ten-round 3×2 is 2 MB on its own — so the slider
// runs as deep as each face goes and says how deep that is.
const KEYS = [];
for (const f of FACES) if (!KEYS.includes(f.key)) KEYS.push(f.key);
const DEPTH = {};
for (const k of KEYS) DEPTH[k] = FACES.filter((f) => f.key === k).map((f) => f.rounds).sort((a, b) => a - b);

// ---- unpacking --------------------------------------------------------------
function bytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function inflate(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function buildGroup(scene, raw) {
  const group = new THREE.Group();
  for (const p of scene.parts) {
    const q = new Int16Array(raw.slice(p.posOff, p.posOff + p.posCount * 2).buffer);
    const pos = new Float32Array(p.posCount);
    for (let i = 0; i < p.posCount; i++) {
      const k = i % 3;
      pos[i] = (q[i] + 32767) * scene.scale[k] + scene.lo[k];
    }
    const width = p.idx16 ? 2 : 4;
    const ib = raw.slice(p.idxOff, p.idxOff + p.idxCount * width).buffer;
    const idx = p.idx16 ? new Uint16Array(ib) : new Uint32Array(ib);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    geom.computeVertexNormals();

    // Match the studio's own materials. The outline is a slightly fatter shell
    // shown BACK side only, so all you see of it is the rim behind the body.
    const side = p.side === 2 ? THREE.DoubleSide : p.side === 1 ? THREE.BackSide : THREE.FrontSide;
    const material = p.basic
      ? new THREE.MeshBasicMaterial({
          color: new THREE.Color(p.color),
          side,
          polygonOffset: p.polygonOffset,
          polygonOffsetFactor: 4,
          polygonOffsetUnits: 4,
        })
      : new THREE.MeshStandardMaterial({
          color: new THREE.Color(p.color),
          roughness: 0.5,
          metalness: 0.04,
          side,
        });
    const mesh = new THREE.Mesh(geom, material);
    if (p.outline) mesh.renderOrder = -1;
    group.add(mesh);
  }
  return group;
}

// ---- the scene --------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
camera.up.set(0, 0, 1); // Z is up, as it is in the studio
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 1.25));
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(4, -7, 9);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.45);
fill.position.set(-6, 4, 2);
scene.add(fill);

const groups = {};
const boxes = {};
let current = null;
let face = FACES[0];
let view = 'all';

// Each face is a different size AND a different shape, so unlike a before/after
// page there is no shared frame to hold: the camera reframes on whichever one you
// picked. A bounding sphere is no good here — a 1×8 is a strip and a 5×5 is a
// plate, and the sphere round either is mostly air — so this fits the eight
// corners of the box itself, against both the vertical field and the horizontal
// one, and takes whichever is tighter.
// And it looks ACROSS the long axis rather than down it. A 1×8 is a strip: from
// the three-quarter view a square face wants, you are looking along its length and
// it foreshortens to a sliver. Turning the azimuth a quarter for the tall faces
// puts the long axis across the screen, where there is room for it.
const ALL = [new THREE.Vector3(0.3, -0.86, 0.41), new THREE.Vector3(0.86, -0.3, 0.41)];
const TOP = [new THREE.Vector3(0.02, -0.16, 1), new THREE.Vector3(0.16, -0.02, 1)];
ALL.concat(TOP).forEach((v) => v.normalize());

function frame(mode) {
  if (mode) view = mode;
  const box = boxes[face.id];
  const mid = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const quarter = size.y > size.x ? 1 : 0;
  const dir = (view === 'top' ? TOP : ALL)[quarter];
  const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();
  const vTan = Math.tan((camera.fov * Math.PI) / 360);
  const hTan = vTan * Math.max(0.5, camera.aspect);

  let dist = 0;
  const c = new THREE.Vector3();
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        c.set(x, y, z).sub(mid);
        const towards = c.dot(dir);
        dist = Math.max(
          dist,
          towards + Math.abs(c.dot(up)) / vTan,
          towards + Math.abs(c.dot(right)) / hTan,
        );
      }
    }
  }
  dist *= 1.1;

  controls.target.copy(mid);
  camera.position.copy(mid).addScaledVector(dir, dist);
  camera.near = Math.max(0.02, dist / 200);
  camera.far = dist * 40;
  camera.updateProjectionMatrix();
  controls.update();
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.view === view)));
}

const set = (id, text) => (document.getElementById(id).textContent = text);

function show(id) {
  face = FACES.find((f) => f.id === id);
  if (current) scene.remove(current);
  current = groups[face.id];
  scene.add(current);
  document.querySelectorAll('[data-face]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.face === face.key)));

  const depths = DEPTH[face.key];
  const slider = document.getElementById('depth');
  slider.max = String(depths[depths.length - 1]);
  slider.value = String(face.rounds);
  slider.disabled = depths.length < 2;

  const { m, n, rounds } = face;
  set('facename', `${m} × ${n}`);
  set('depth-n', rounds);
  set('depth-of', depths[depths.length - 1]);
  set('ribbons', m + n);
  set('strands', 3 * (m + n) + 2 * (m + n) * rounds);
  set('masks', 2 * m * n * (rounds + 1));
  set('footprint', `${112 * (m + 1)} × ${112 * (n + 1)}`);
  const load = Math.max(m, n) / Math.min(m, n);
  const badge = document.getElementById('load');
  badge.textContent = load === 1 ? 'balanced — every ribbon binds the same' :
    `${load.toFixed(load % 1 ? 1 : 0)}× — one ribbon does that much more of the binding`;
  badge.className = load === 1 ? 'ok' : 'off';
  set('hand', face.hand === 'lh' ? 'left hand · cw' : 'right hand · ccw');
  frame();
}

/** Nearest baked depth at or below what the slider asks for. */
function at(key, rounds) {
  const depths = DEPTH[key];
  let want = depths[0];
  for (const d of depths) if (d <= rounds) want = d;
  return FACES.find((f) => f.key === key && f.rounds === want).id;
}

function resize() {
  const r = HOST.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}

function paint() {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  scene.background = new THREE.Color(dark ? 0x14110e : 0xf5efdf);
}

let spin = !matchMedia('(prefers-reduced-motion: reduce)').matches;

function tick() {
  requestAnimationFrame(tick);
  if (spin) {
    const a = 0.0022;
    const o = camera.position.clone().sub(controls.target);
    const c = Math.cos(a);
    const s = Math.sin(a);
    camera.position.set(
      controls.target.x + o.x * c - o.y * s,
      controls.target.y + o.x * s + o.y * c,
      camera.position.z,
    );
  }
  controls.update();
  renderer.render(scene, camera);
}

(async () => {
  const raw = await inflate(bytes(PACK.blob));
  for (const f of FACES) {
    groups[f.id] = buildGroup(PACK.meta[f.id], raw);
    boxes[f.id] = new THREE.Box3().setFromObject(groups[f.id]);
  }
  show(face.id);
  paint();
  resize();
  frame('all');
  tick();
  document.getElementById('loading').remove();

  addEventListener('resize', resize);
  new ResizeObserver(resize).observe(HOST);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);
  new MutationObserver(paint).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  document.querySelectorAll('[data-face]').forEach((b) =>
    b.addEventListener('click', () => show(at(b.dataset.face, face.rounds))));
  document.getElementById('depth').addEventListener('input', (e) =>
    show(at(face.key, Number(e.target.value))));
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => frame(b.dataset.view)));

  const spinButton = document.getElementById('spin');
  const paintSpin = () => {
    spinButton.setAttribute('aria-pressed', String(spin));
    spinButton.textContent = spin ? 'Spinning' : 'Spin';
  };
  paintSpin();
  spinButton.addEventListener('click', () => {
    spin = !spin;
    paintSpin();
  });
  // Taking hold of the model stops the turntable — you are driving now.
  canvas.addEventListener('pointerdown', () => {
    spin = false;
    paintSpin();
  });
})();
