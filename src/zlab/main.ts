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
import { BandKind, Gauge, band, blend, run } from './bands';

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
  reach: 0.95,
  round: 0.8,
  ramp: 2.4,
  showRuns: true,
  // Whether the turn folds the strap back on itself or just carries on and
  // rises. 'auto' reads it off the separation, which is the setting the other
  // two exist to argue about.
  mode: 'auto' as 'fold' | 'carry' | 'auto',
  handover: 90, // degrees; the middle of the changeover window in 'auto'
};

/** Whether this separation gets a fold or a carry-on. */
function folding(): boolean {
  if (state.mode === 'fold') return true;
  if (state.mode === 'carry') return false;
  return state.separation < state.handover;
}

const GAUGE = (): Gauge => ({
  width: 1.1,
  thickness: 0.26,
  step: state.step,
  round: state.round,
  reach: state.reach,
  // The one number that carries a builder from its fold-back form to its
  // straight-through one, and it is read off the separation rather than set:
  // the two are the same fact.
  k: blend(state.separation),
  fold: folding(),
  ramp: state.ramp,
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

  const built = band(state.kind, din, dout, g);
  if (state.showRuns) {
    const LEN = 5;
    // The run going in always meets the band at the joint. The one coming away
    // is displaced by whatever the band did — an oblique fold slides the strip
    // along its crease, so the two runs are not end to end.
    const inMesh = new THREE.Mesh(run(din, LEN, -g.step / 2, g), LACE);
    group.add(inMesh);
    const outMesh = new THREE.Mesh(
      run({ x: -dout.x, y: -dout.y }, LEN, g.step / 2, g),
      LACE,
    );
    outMesh.position.set(built.shiftOut.x, built.shiftOut.y, built.shiftOut.z);
    group.add(outMesh);
  }
  group.add(new THREE.Mesh(built.geom, BANDMAT));
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
    'Folds the strap about an oblique crease and rolls it a half turn, the way a belt folds. Developable, so nothing stretches or pinches — width and thickness carry straight through. It rolls onto a bight rather than a plain cylinder: straight out along the run for the leg length, round the tip, straight back, so the purple is the orange continued and the two layers stay a storey apart with a slot between them. The crease displaces the outgoing run sideways, as a real oblique fold does.',
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
    b.textContent = k === 'sweep' ? 'fold' : k;
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

  slider('Separation', state.separation, 0, 180, 1, (v) => {
    state.separation = v;
    // The blend is derived, so its readout is stale the moment this moves.
    const r = host.querySelector('.blend');
    if (r) r.textContent = `Blend ${blend(v).toFixed(2)}`;
    const f = host.querySelector('.mix');
    if (f) f.textContent = folding() ? 'Folding' : 'Carrying on';
  }, '°');
  slider('Storey step', state.step, 0.05, 1.5, 0.01, (v) => (state.step = v));
  slider('Corner round', state.round, 0, 1, 0.05, (v) => (state.round = v));
  slider('Ramp length', state.ramp, 0, 6, 0.1, (v) => (state.ramp = v));
  if (state.kind === 'sweep') {
    slider('Leg length', state.reach, 0, 4, 0.05, (v) => (state.reach = v));

    const modes = document.createElement('div');
    modes.className = 'kinds';
    (
      [
        ['fold', 'Fold'],
        ['auto', 'Auto'],
        ['carry', 'Carry on'],
      ] as Array<['fold' | 'auto' | 'carry', string]>
    ).forEach(([m, label]) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (state.mode === m) b.className = 'on';
      b.onclick = () => {
        state.mode = m;
        rebuild();
        ui();
      };
      modes.appendChild(b);
    });
    host.appendChild(modes);

    const why = document.createElement('p');
    why.className = 'note';
    why.textContent =
      state.mode === 'fold'
        ? 'Always folds the strap back on itself, however little the lace is actually turning.'
        : state.mode === 'carry'
          ? 'Never folds: the heading swings round in plan and the strip rises while it does. Honest over a small turn, and it pinches over a large one — which is what the fold is for.'
          : 'Folds below the handover angle and carries on above it. A switch, not a mix: both have to leave the band heading exactly along the outgoing run, and only the two exact builds do — anything part-way between them arrives pointing somewhere else. So the two shapes do not meet smoothly at the changeover, and where that seam is least objectionable is the thing to judge.';
    host.appendChild(why);

    if (state.mode === 'auto') {
      slider('Handover', state.handover, 0, 180, 1, (v) => {
        state.handover = v;
        rebuild();
        const r = host.querySelector('.mix');
        if (r) r.textContent = folding() ? 'Folding' : 'Carrying on';
      }, '°');
    }

    const mix = document.createElement('p');
    mix.className = 'note';
    const badge = document.createElement('b');
    badge.className = 'mix';
    badge.textContent = folding() ? 'Folding' : 'Carrying on';
    mix.appendChild(badge);
    mix.appendChild(
      document.createTextNode(
        ' at this separation. A fold doubles the strap back on itself; carrying on swings the' +
          ' heading round in plan and rises the storey while it does.',
      ),
    );
    host.appendChild(mix);
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

  const read = document.createElement('p');
  read.className = 'note';
  const badge = document.createElement('b');
  badge.className = 'blend';
  badge.textContent = `Blend ${blend(state.separation).toFixed(2)}`;
  read.appendChild(badge);
  read.appendChild(document.createTextNode(
    ' — 0 is the fold-back form, 1 the straight-through ramp. ' +
    'It follows the separation on a smoothstep, so the turn holds its shape through the tight angles and gives it up over the open ones. Ramp length is how far it draws out at 180°.',
  ));
  host.appendChild(read);

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
