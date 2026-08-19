// The page's own little studio: unpack the baked meshes, put them under an orbit
// camera, and step the ring up one storey at a time.
//
// Everything here is presentation. The geometry arrived already built by the app
// (artifacts/lib/bake.mjs), so nothing in this file can lift a storey that the
// model does not lift, or flatten one it does.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import DATA from './.work/data.json';

const HOST = document.getElementById('stage');
const canvas = document.getElementById('c');
const META = DATA.variants.built.meta;

// Strand counts per scene, so the readout can quote the model rather than the
// mesh list: the block, then six arms a storey.
const STRANDS = { S0: 9, S1: 15, S2: 21, S3: 27, S4: 33, FLAT: 33 };

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
let current = null;
let showing = 'S4';

const HEIGHT = document.getElementById('height');
const COUNT = document.getElementById('count');
const VERDICT = document.getElementById('verdict');
const CAPTION = document.getElementById('caption');

/** How tall the model stands, in storeys, straight off its own bounding box.
 *  One storey is 1.04 world units — two strand thicknesses at the app's own
 *  scale — so this is the model answering the question, not the page. */
function storeysTall(group) {
  const box = new THREE.Box3().setFromObject(group);
  return (box.max.z - box.min.z) / 1.04;
}

function show(which) {
  if (current) scene.remove(current);
  showing = which;
  current = groups[which];
  scene.add(current);
  const flat = which === 'FLAT';
  document.querySelectorAll('[data-scene]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.scene === which)));
  COUNT.textContent = STRANDS[which];
  HEIGHT.textContent = storeysTall(current).toFixed(2);
  const breaks = flat ? 0 : Number(which.slice(1));
  VERDICT.textContent = flat
    ? 'four rounds, one plane'
    : `${breaks} break${breaks === 1 ? '' : 's'} in the stack`;
  VERDICT.className = flat ? 'bad' : 'ok';
  CAPTION.textContent = flat
    ? 'The ring as the lab hands it over: no level breaks, so every round rests on the same plane and the four of them read as one thick round.'
    : which === 'S0'
      ? 'The block alone — three laces crossing, the ground floor. No break yet: there is nothing above it to lift.'
      : `The block plus ${which.slice(1)} round${which === 'S1' ? '' : 's'} of k = −1, each one a storey up. Every crossing is woven inside its own storey.`;
}

// Frame on the FULL ring, so stepping through the storeys grows the model inside
// a fixed shot instead of rescaling it every time.
let frameBox = null;
let view = 'all';

const DIRECTIONS = {
  all: new THREE.Vector3(0.34, -0.86, 0.38),
  side: new THREE.Vector3(0.08, -0.99, 0.05),
  top: new THREE.Vector3(0.0, -0.04, 1),
};

function frame(mode) {
  if (mode) view = mode;
  const size = frameBox.getSize(new THREE.Vector3());
  const mid = frameBox.getCenter(new THREE.Vector3());
  // The bounding SPHERE would frame a ring that is much wider than it is tall
  // from too far back, so each view takes the radius it actually needs.
  let radius = size.length() * 0.42;
  if (view === 'top') radius = Math.max(size.x, size.y) * 0.55;
  if (view === 'side') radius = Math.max(Math.max(size.x, size.y) * 0.42, size.z * 0.62);
  const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.02;
  const dir = DIRECTIONS[view].clone().normalize();
  controls.target.copy(mid);
  camera.position.copy(mid).addScaledVector(dir, dist);
  camera.near = Math.max(0.02, dist / 200);
  camera.far = dist * 40;
  camera.updateProjectionMatrix();
  controls.update();
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.view === view)));
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
  scene.background = new THREE.Color(dark ? 0x16130f : 0xf3ecdb);
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
  const raw = await inflate(bytes(DATA.variants.built.blob));
  for (const [id, packed] of Object.entries(META)) groups[id] = buildGroup(packed, raw);

  frameBox = new THREE.Box3().setFromObject(groups.S4);
  // The two heights the note quotes are measured off the meshes themselves, so
  // the prose cannot drift away from the model it is describing.
  document.getElementById('hFull').textContent = storeysTall(groups.S4).toFixed(1);
  document.getElementById('hFlat').textContent = storeysTall(groups.FLAT).toFixed(1);
  show('S4');
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

  document.querySelectorAll('[data-scene]').forEach((b) =>
    b.addEventListener('click', () => show(b.dataset.scene)));
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => frame(b.dataset.view)));

  // ← / → step through the storeys, which is the whole point of the rail.
  addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const order = ['S0', 'S1', 'S2', 'S3', 'S4', 'FLAT'];
    const at = order.indexOf(showing);
    const next = order[Math.min(order.length - 1, Math.max(0, at + (e.key === 'ArrowRight' ? 1 : -1)))];
    if (next !== showing) show(next);
  });

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
