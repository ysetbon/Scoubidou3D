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
import { Auto, AutoView, autoCarries, autoDial, autoLean } from './autoview';

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
  // rises. Fold and Square are the same builder — they are the two ends of the
  // lean below, and the buttons are presets for it rather than modes of their
  // own.
  mode: 'auto' as 'turn' | 'auto' | 'carry',
  lean: 0, // 0 creases on the bisector, 1 square to the strap; set by hand
  // Auto's own numbers, and which of the three drawings of them is on show.
  // The drawing is a view and nothing else: all three edit this one object, so
  // switching between them changes what is on screen and not what is built.
  auto: { lo: 48, hi: 61, carry: 126, cap: 0.25 } as Auto,
  autoView: 'curve' as AutoView,
};

/** The lace's width, in the same units the gauge uses. */
const LACE_WIDTH = 1.1;

/**
 * Where in the fold family this separation sits: 0 the crease on the bisector,
 * 1 the crease square to the strap.
 *
 * Set by hand unless Auto is on, and Auto phases it as the separation asks. A
 * dead fold-back wants the bisector — and it does not matter, since at 0 the
 * bisector IS square to the strap and both ends of the family are the same
 * hairpin. The peak wants square, because there the bisector crease is far
 * enough off square that the tip stands taller than the storey it climbs and
 * flares into a shell. Straight-through wants the bisector again, where it has
 * already flattened into a shallow oblique step and is carrying on in all but
 * name.
 *
 * So the lean rises to the peak and falls away, and nothing is ever switched:
 * every value of it is a real crease angle with a real developable tip.
 */
function leanNow(): number {
  return state.mode === 'auto' ? autoLean(state.auto, state.separation) : state.lean;
}

/** Whether this separation is carrying on rather than folding at all. */
function carryingNow(): boolean {
  if (state.mode === 'carry') return true;
  return state.mode === 'auto' && autoCarries(state.auto, state.separation);
}

const GAUGE = (): Gauge => ({
  width: LACE_WIDTH,
  thickness: 0.26,
  step: state.step,
  round: state.round,
  reach: state.reach,
  // The one number that carries a builder from its fold-back form to its
  // straight-through one, and it is read off the separation rather than set:
  // the two are the same fact.
  k: blend(state.separation),
  lean: leanNow(),
  carryOn: carryingNow(),
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

/** What the turn is doing right now, in a sentence. */
function turnNote(): string {
  if (state.mode === 'carry') {
    return (
      'Never folds: the heading swings round in plan and the strip rises while it does. A flat' +
      ' strap cannot really bend in its own plane — over a small turn nobody can tell, over a' +
      ' large one it pinches, which is what the fold is for.'
    );
  }
  const lean = leanNow();
  if (state.mode === 'auto' && autoCarries(state.auto, state.separation)) {
    return (
      `Auto — carrying on at this separation, past the carry angle. The lace has stopped folding:` +
      ' the heading swings round in plan and the strip rises while it does. The lean is back on the' +
      ' bisector before the handover, because an exact fold there has already flattened into a' +
      ' shallow oblique step — which is the closest a fold ever gets to a ramp, and so the smallest' +
      ' gap to hand over across.'
    );
  }
  if (state.mode === 'auto') {
    return (
      `Auto — lean ${lean.toFixed(2)} at this separation. Three grips on the track: the two` +
      ' shoulders of the square window, and the angle past which the lace stops folding and carries' +
      ' on. Drag the red marker to move the separation itself. Square influence below sets how far' +
      ' towards square the crease ever swings, and the curve view lets you drag the plateau instead.' +
      ' The three drawings are views of the same numbers, so switching between them changes nothing' +
      ' but the picture. The shell angle is NOT one of the settings: it is 2·asin(step ÷ width),' +
      ' read off the storey step and the lace, and it marks where an exact fold starts standing' +
      ' taller than the storey it climbs. It goes red when the left shoulder sits to the right of' +
      ' it, because every angle in between is then getting a fold that flares. Drag that shoulder' +
      ' left to clear it — or raise the storey step, which moves the shell angle right instead.'
    );
  }
  if (state.lean === 0) {
    return (
      'Fold — the crease on the bisector. The tip turns the heading the whole way and the legs' +
      ' run dead straight, so the strip never bends in its own plane at all.'
    );
  }
  if (state.lean === 1) {
    return (
      'Square — the crease square to the strap. The tip stays a clean ⊂ at any separation, and' +
      ' the legs bend in plan to give back the half turn the runs did not ask for.'
    );
  }
  return (
    'Between the two: the crease sits part way from the bisector towards square, and the legs' +
    ' take exactly what the tip does not.'
  );
}

/** Move a slider that something OTHER than the slider has just changed. */
function setSliderShown(label: string, value: number, text: string): void {
  const wrap = [...host.querySelectorAll('label.slider')].find((w) =>
    w.querySelector('span')?.textContent?.startsWith(label),
  );
  if (!wrap) return;
  const input = wrap.querySelector('input');
  if (input) input.value = String(value);
  const read = wrap.querySelector('var');
  if (read) read.textContent = text;
}

/** Repaint whichever Auto drawing is on show, if any. */
let autoPaint: (() => void) | null = null;
const repaintAuto = (): void => {
  if (autoPaint) autoPaint();
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
    // The blend is derived, and so is Auto's lean, so both readouts are stale
    // the moment this moves.
    const r = host.querySelector('.blend');
    if (r) r.textContent = `Blend ${blend(v).toFixed(2)}`;
    const w = host.querySelector('.why');
    if (w) w.textContent = turnNote();
    repaintAuto();
  }, '°');
  slider('Storey step', state.step, 0.05, 1.5, 0.01, (v) => {
    state.step = v;
    // The shell threshold is read off the step, so Auto's drawing of it is
    // stale the moment this moves.
    repaintAuto();
  });
  slider('Corner round', state.round, 0, 1, 0.05, (v) => (state.round = v));
  slider('Ramp length', state.ramp, 0, 6, 0.1, (v) => (state.ramp = v));
  if (state.kind === 'sweep') {
    slider('Leg length', state.reach, 0, 4, 0.05, (v) => (state.reach = v));

    const modes = document.createElement('div');
    modes.className = 'kinds';
    (
      [
        ['Fold', 'turn', 0],
        ['Square', 'turn', 1],
        ['Auto', 'auto', null],
        ['Carry on', 'carry', null],
      ] as Array<[string, 'turn' | 'auto' | 'carry', number | null]>
    ).forEach(([label, m, preset]) => {
      const b = document.createElement('button');
      b.textContent = label;
      // Fold and Square light up when the lean is actually sitting on their end
      // of it, not merely when they were the last thing pressed — the slider can
      // move it off them, and a lit button that is no longer true is worse than
      // none lit at all.
      const on =
        state.mode !== m ? false : preset === null ? true : state.lean === preset;
      if (on) b.className = 'on';
      b.onclick = () => {
        state.mode = m;
        if (preset !== null) state.lean = preset;
        rebuild();
        ui();
      };
      modes.appendChild(b);
    });
    host.appendChild(modes);

    const why = document.createElement('p');
    why.className = 'note why';
    why.textContent = turnNote();
    host.appendChild(why);

    if (state.mode === 'auto') {
      const views = document.createElement('div');
      views.className = 'kinds';
      (
        [
          ['bar', 'Bar'],
          ['curve', 'Curve'],
          ['dial', 'Dial'],
        ] as Array<[AutoView, string]>
      ).forEach(([v, name]) => {
        const b = document.createElement('button');
        b.textContent = name;
        if (state.autoView === v) b.className = 'on';
        // Only the drawing changes. `state.auto` is not touched, so the strand
        // on screen carries straight across the switch.
        b.onclick = () => {
          state.autoView = v;
          ui();
        };
        views.appendChild(b);
      });
      host.appendChild(views);

      const dial = autoDial(
        state.autoView,
        state.auto,
        () => {
          rebuild();
          repaintAuto();
          const note = host.querySelector('.why');
          if (note) note.textContent = turnNote();
        },
        // The graphic can drive the separation too, so cause and effect are
        // under one hand. The slider is the same number and has to be told.
        (deg) => {
          if (deg === state.separation) return;
          state.separation = deg;
          setSliderShown('Separation', deg, `${deg}°`);
          const r = host.querySelector('.blend');
          if (r) r.textContent = `Blend ${blend(deg).toFixed(2)}`;
          rebuild();
          repaintAuto();
          const note = host.querySelector('.why');
          if (note) note.textContent = turnNote();
        },
      );
      host.appendChild(dial.el);
      autoPaint = () => dial.paint(state.separation, state.step, LACE_WIDTH);
      autoPaint();

      // How square the crease ever swings, as a control of its own rather than
      // a gesture hidden inside one of the three drawings. It is the number the
      // whole panel is really about, and it was reachable in exactly one view.
      slider('Square influence', state.auto.cap, 0, 1, 0.05, (v) => {
        state.auto.cap = v;
        repaintAuto();
        const note = host.querySelector('.why');
        if (note) note.textContent = turnNote();
      });
    } else {
      autoPaint = null;
    }

    if (state.mode === 'turn') {
      slider('Lean', state.lean, 0, 1, 0.05, (v) => {
        state.lean = v;
        // The lamps and the note are both claims about the lean, so they go
        // stale the moment it moves.
        const row = host.querySelectorAll('.kinds')[1];
        if (row) {
          row.children[0].className = v === 0 ? 'on' : '';
          row.children[1].className = v === 1 ? 'on' : '';
        }
        const note = host.querySelector('.why');
        if (note) note.textContent = turnNote();
      });

      const mix = document.createElement('p');
      mix.className = 'note';
      mix.textContent =
        'The two buttons are the ends of this slider, not builds of their own. Lean 0 creases on the bisector: the tip turns the heading the whole way and the legs run' +
        ' dead straight. Developable end to end — and past 2·asin(step/width), 54° at this gauge,' +
        ' the crease is far enough off square that the tip stands taller than the storey it climbs' +
        ' and flares into a shell. Lean 1 creases square to the strap instead: the tip stays a' +
        ' clean ⊂ at any separation, with the width axis flat all the way round, but a square' +
        ' crease turns the heading a full half turn and the runs rarely want one, so the legs bend' +
        ' in plan to give back the difference — half each, the one thing a flat strap cannot really' +
        ' do. Everything between is a real crease angle with a real developable tip; only which of' +
        ' the tip and the legs does the turning changes.';
      host.appendChild(mix);
    }
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
