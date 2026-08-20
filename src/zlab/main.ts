// Z band lab: one lace, one turn, and the turn built three different ways.
//
// The studio's fold is not imported here on purpose. This page exists to ask
// what the turn IS, and the studio's answer carries seven rounds of correction
// with it; anything reusing it would inherit the assumptions rather than test
// them.
//
// The control that matters is SEPARATION: the angle between the two runs,
// measured at the joint between the rays they send out from it. Sweep it and
// the three builders separate — every one of them is fine in the middle of the
// range, and they disagree at the ends, which is where a real lace is.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BandKind, Gauge, band, run, runTrim } from './bands';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const stage = document.getElementById('stage') as HTMLElement;
const host = document.getElementById('lab') as HTMLElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(4, -6, 8);
scene.add(key);

const grid = new THREE.GridHelper(24, 24, 0x4a4133, 0x322b21);
grid.rotation.x = Math.PI / 2;
grid.position.z = -1.6;
scene.add(grid);

const group = new THREE.Group();
scene.add(group);

const state = {
  separation: 0, // degrees; 0 is a dead fold-back, 180 is straight through
  kind: 'bridge' as BandKind,
  step: 0.5,
  reach: 1.2,
  round: 0.8,
  showRuns: true,
};

const GAUGE = (): Gauge => ({
  width: 1.1,
  thickness: 0.26,
  step: state.step,
  round: state.round,
  reach: state.reach,
});

const LACE = new THREE.MeshStandardMaterial({
  color: 0xe27a26,
  roughness: 0.5,
  metalness: 0.04,
  side: THREE.DoubleSide,
});
const BANDMAT = new THREE.MeshStandardMaterial({
  color: 0x8f6ad8,
  roughness: 0.5,
  metalness: 0.04,
  side: THREE.DoubleSide,
});

function rebuild(): void {
  for (const child of [...group.children]) {
    group.remove(child);
    const m = child as THREE.Mesh;
    m.geometry?.dispose();
  }
  const g = GAUGE();
  const sep = (state.separation * Math.PI) / 180;
  // Incoming heads +x. The outgoing leaves at `sep` from the ray the incoming
  // sends back, so 0 stacks it straight on top and 180 carries straight on.
  const din = { x: 1, y: 0 };
  const dout = { x: -Math.cos(sep), y: Math.sin(sep) };

  const trim = runTrim(state.kind, g);
  if (state.showRuns) {
    const LEN = 5;
    for (const [d, z] of [
      [din, -g.step / 2],
      [{ x: -dout.x, y: -dout.y }, g.step / 2],
    ] as Array<[{ x: number; y: number }, number]>) {
      const mesh = new THREE.Mesh(run(d, LEN, z, g), LACE);
      // A swept turn eats into the runs; the others leave them whole.
      if (trim > 0) mesh.position.set(-d.x * trim, -d.y * trim, 0);
      group.add(mesh);
    }
  }
  group.add(new THREE.Mesh(band(state.kind, din, dout, g), BANDMAT));
}

function frame(): void {
  const box = new THREE.Box3().setFromObject(group);
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
  const d = r / Math.sin((camera.fov * Math.PI) / 360) / 0.85;
  camera.up.set(0, 0, 1);
  camera.position.set(c.x + d * 0.45, c.y - d * 0.78, c.z + d * 0.35);
  controls.target.copy(c);
  controls.update();
}

function resize(): void {
  // Measured off the STAGE, never off the canvas: the canvas's own size is an
  // output of this function, and reading it back in makes the layout chase
  // itself bigger every frame.
  const w = stage.clientWidth || innerWidth;
  const h = stage.clientHeight || innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ---- controls --------------------------------------------------------------

const NOTES: Record<BandKind, string> = {
  bridge:
    'Lofts straight from one run’s end face to the other’s. Uses nothing but those two faces — no crease, no bisector, no outward normal. Cleanest at a dead fold-back, thinnest near straight-through.',
  sweep:
    'Bends the lace and sweeps the section round the bend. The only one that is physically what a lace does; the only one that moves the runs, since the last of each is no longer straight.',
  cap: 'Stands a stub of lace on end between the two run faces, on the bisector of their width axes. Needs no outward normal, so it survives a dead fold-back — but it reads as a joint, not as bending.',
};

function ui(): void {
  host.innerHTML = '';
  const h = document.createElement('h1');
  h.textContent = 'Z band lab';
  host.appendChild(h);

  const lead = document.createElement('p');
  lead.className = 'lead';
  lead.textContent =
    'Separation is the angle between the two runs at the joint. 0° is a dead fold-back — the outgoing run lies straight on top of the incoming one. 180° is the lace carrying straight on.';
  host.appendChild(lead);

  const row = document.createElement('div');
  row.className = 'kinds';
  (['bridge', 'sweep', 'cap'] as BandKind[]).forEach((k) => {
    const b = document.createElement('button');
    b.textContent = k;
    if (state.kind === k) b.className = 'on';
    b.onclick = () => {
      state.kind = k;
      rebuild();
      frame();
      ui();
    };
    row.appendChild(b);
  });
  host.appendChild(row);

  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = NOTES[state.kind];
  host.appendChild(note);

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    set: (v: number) => void,
    suffix = '',
  ): void => {
    const wrap = document.createElement('label');
    wrap.className = 'slider';
    const head = document.createElement('span');
    head.textContent = label;
    const val = document.createElement('var');
    val.textContent = value.toFixed(step < 1 ? 2 : 0) + suffix;
    head.appendChild(val);
    wrap.appendChild(head);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.oninput = () => {
      const v = parseFloat(input.value);
      val.textContent = v.toFixed(step < 1 ? 2 : 0) + suffix;
      set(v);
      rebuild();
    };
    wrap.appendChild(input);
    host.appendChild(wrap);
  };

  slider('Separation', state.separation, 0, 180, 1, (v) => (state.separation = v), '°');
  slider('Storey step', state.step, 0.05, 1.5, 0.01, (v) => (state.step = v));
  slider('Corner round', state.round, 0, 1, 0.05, (v) => (state.round = v));
  if (state.kind === 'sweep') {
    slider('Bend reach', state.reach, 0.2, 4, 0.05, (v) => (state.reach = v));
  }

  const toggle = document.createElement('label');
  toggle.className = 'check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = state.showRuns;
  cb.onchange = () => {
    state.showRuns = cb.checked;
    rebuild();
  };
  toggle.appendChild(cb);
  toggle.appendChild(document.createTextNode(' Show the runs'));
  host.appendChild(toggle);

  const foot = document.createElement('p');
  foot.className = 'note';
  foot.textContent =
    'The band is purple so it can be told from the runs. Drag to orbit. Sweep the separation to 0 — that is the case the studio’s fold cannot place, because at 0 the two runs share one footprint and there is no in-plane outward left to build along.';
  host.appendChild(foot);
}

ui();
rebuild();
resize();
frame();
addEventListener('resize', () => {
  resize();
});
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
