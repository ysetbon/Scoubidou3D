// The page's own little studio: unpack the baked meshes, put them under an orbit
// camera, and let one button swap the whole model between the two builds.
//
// Everything here is presentation. The geometry arrived already built by the app
// (artifacts/lib/bake.mjs), so nothing in this file can make a broken model look
// whole or a whole one look broken.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import DATA from './.work/data.json';

const HOST = document.getElementById('stage');
const canvas = document.getElementById('c');
const LEVEL = DATA.show;

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

function buildGroup(meta, raw) {
  const group = new THREE.Group();
  const level = meta[LEVEL];
  for (const p of level.parts) {
    const q = new Int16Array(raw.slice(p.posOff, p.posOff + p.posCount * 2).buffer);
    const pos = new Float32Array(p.posCount);
    for (let i = 0; i < p.posCount; i++) {
      const k = i % 3;
      pos[i] = (q[i] + 32767) * level.scale[k] + level.lo[k];
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

function show(which) {
  if (current) scene.remove(current);
  current = groups[which];
  scene.add(current);
  document.querySelectorAll('[data-variant]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.variant === which)));
  document.getElementById('meshcount').textContent = current.children.length;
  const verdict = document.getElementById('verdict');
  verdict.textContent = which === 'after' ? 'one ribbon per lace' : 'each lace in four pieces';
  verdict.className = which === 'after' ? 'ok' : 'bad';
}

// Frame on the UNION of the variants, so switching never moves the camera and a
// stray piece that only one of them has is still inside the shot.
let frameBox = null;
let view = 'all';

function frame(mode) {
  if (mode) view = mode;
  const size = frameBox.getSize(new THREE.Vector3());
  const mid = frameBox.getCenter(new THREE.Vector3());
  let radius = size.length() * 0.5;
  let lift = 0.41;
  if (view === 'top') {
    mid.z = frameBox.max.z - 1.25;
    radius = Math.max(size.x, size.y) * 0.72;
    lift = 0.3;
  }
  const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.06;
  controls.target.copy(mid);
  camera.position.set(mid.x + dist * 0.3, mid.y - dist * 0.86, mid.z + dist * lift);
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
  for (const [id, payload] of Object.entries(DATA.variants)) {
    groups[id] = buildGroup(payload.meta, await inflate(bytes(payload.blob)));
  }
  frameBox = Object.values(groups).reduce(
    (box, g) => box.union(new THREE.Box3().setFromObject(g)),
    new THREE.Box3(),
  );
  show('after');
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

  document.querySelectorAll('[data-variant]').forEach((b) =>
    b.addEventListener('click', () => show(b.dataset.variant)));
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
