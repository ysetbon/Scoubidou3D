// The fold bench, second bench: the SHAPE of a turn — measured, and driven.
//
// The first bench (`src/foldbench/`) holds the five systems that decide a lace's
// HEIGHT against each other — weave, fold, layers, levels, lace — and it is good
// at that. What it cannot do is say whether a turn is a smooth bight or a curly
// brace, because its only turn measurement is `(|dz| + thickness) / width`: a
// height over a width. Every brace and every bight of the same storey measure
// identically under it.
//
// THE DISTINCTION IS IN THE PLAN, and this is why the page exists. A turn is a
// half-roll about an axis. `foldTurn` holds that axis horizontal — it must,
// because the ruling of the roll IS the strap's width axis and the runs' width
// axes are horizontal — so the whole half-roll lies in a VERTICAL PLANE. Seen
// from above the lace therefore runs out to a point and comes straight back.
// Measured here on the shipped builder at the box-stitch gauge: a true cusp at a
// dead fold-back, and 1.8% to 8% of a lace width elsewhere, against a reference
// lanyard whose plan radius is 100% of its own cross-section.
//
// The radius is not a parameter either. `const h = Math.max(g.step / 2, 1e-4)`
// (fold.ts) is simultaneously the roll radius, the turn's height and its whole
// plan extent, and `g.width` appears in no centreline expression anywhere in
// that file. So the lace's width cannot affect how round its own turn is, and no
// slider on the first bench can change that — which is exactly the thing this
// page is built to show rather than assert.
//
// BIGHT RADIUS is the control that fixes it, and it is the reason this page is
// not just an instrument. Above `step / 2` the roll axis tilts out of horizontal
// by `acos(step / 2R)`: the climb stays exactly one storey, the curvature stays
// constant at `1/R`, the surface stays an exactly developable cylinder — and the
// plan opens out into a real arc. At 0 the turn is `step / 2` with a flat axis,
// which reproduces the shipped geometry vertex for vertex.
//
// The price is real and is shown rather than hidden: the turn's two ends move
// apart across the runs by `sqrt(4R² - step²)`, which `spliceFolds` now spends
// on the two run cut points instead of discarding. So a bight costs plan room,
// and the ARM OFFSET row says how much.
//
// Every other row here is a shape row, most of them taken in plan, and each one
// carries the reference lanyard's own value beside it.

import * as THREE from 'three';
import { RenderParams, StrandScene } from '../scene/StrandScene';
import { makeSample } from '../model/samples';
import { parseSceneText } from '../model/sceneIO';
import { turnShape, type TurnShape } from '../geometry/measure';

// ---- the reference ---------------------------------------------------------
//
// Measured off the lanyard FBX: 55,854 verts, one swept round cord. Only the
// three MEASURED numbers are stored; everything else is computed from them here,
// so a transcription cannot drift from its source.
//
// The lanyard is a HELIX, and a helix has two radii which are not
// interchangeable. Its plan projection is a circle of radius `a`; its 3D radius
// of curvature is `(a² + c²) / a` with `c = pitch / 2π`, which is always the
// larger. A turn's plan radius is comparable to the first and never to the
// second — confusing them is a mistake worth naming, because it flatters the
// model by a factor of about two.
const REF = (() => {
  const d = 10.7; // cord diameter, source units — measured
  const p = 20.0; // round pitch, exactly periodic — measured
  const W = 32.0; // braid width across — measured
  const takeup = 3.491; // lace length / column height
  const a = (Math.sqrt((takeup * p) ** 2 - p * p)) / (2 * Math.PI); // helix radius
  const c = p / (2 * Math.PI);
  return {
    cord: d,
    planRadius: a / d, //  0.995 cord diameters — what a turn's plan radius must reach
    // Half a round of the helix bulges sideways by its own plan radius, so the
    // bulge target and the radius target are the same number here.
    bulge: a / d,
    radius3D: ((a * a + c * c) / a) / d, //  1.084 — its 3D radius of curvature
    storey: p / d, //  1.869 cross-sections per round
    width: W / d, //  2.991 across
    climb: (Math.atan(p / (2 * Math.PI * a)) * 180) / Math.PI, // 16.65 degrees
    signChanges: 0, // a helix never reverses
    constancy: 1, // and its curvature never varies
  };
})();

const SCENES: Array<{ key: string; label: string; note: string }> = [
  // The default has to load on its own and has to be worth looking at: four
  // storeys is the smallest scene with a stack to read, and its turns are the
  // dead fold-backs where the cusp is worst.
  { key: 'box-stitch-4', label: 'Box stitch — 4 levels', note: 'the default: a stack small enough to read' },
  { key: 'box-stitch-10', label: 'Box stitch — 10 levels', note: '40 turns, 36 of them climbing' },
  { key: 'twist-stitch-10', label: 'Twist stitch — 10 twists', note: 'the round stitch — what the lanyard actually is' },
  { key: 'box-stitch', label: 'Box stitch — starting stitch', note: 'four turns, no storeys' },
  { key: 'fold-pair', label: 'One lace, one turn', note: 'a single turn, nothing else' },
  { key: 'ring-2x1-k1111-lh', label: 'Fitted ring 2x1', note: 'the widest turns in the samples' },
];

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const bench = document.getElementById('bench') as HTMLElement;

const view = new StrandScene(canvas);
view.setTheme('dark');

let sceneKey = SCENES[0].key;
view.setScene(makeSample(sceneKey));

// ---- measuring -------------------------------------------------------------

interface Reading {
  turns: number;
  /** Smallest sideways bulge over every turn, in lace widths. THE brace
   *  detector: 0 is a cusp, and it has no failure mode on a straight path the
   *  way a radius does. */
  bulgeMin: number;
  /** The median turn's bulge. */
  bulgeMed: number;
  /** Worst plan radius, reported only where there is a curve to measure. */
  planMin: number;
  /** 3D radius, min over turns, lace widths. */
  r3Min: number;
  /** Worst curvature constancy over a turn: max/min. 1.00 is a circular arc. */
  constancy: number;
  /** Plan-curvature reversals, worst over turns. */
  flips: number;
  /** The strap's inner edge distance from its own roll axis, thicknesses. At or
   *  below 0 the inner half sweeps through the axis. */
  inner: number;
  /** Span over rise, median — translation-free, so no width-vs-thickness call.
   *  The lanyard reads 2.13, and it is the row a bight radius is tuned onto. */
  spanRise: number;
  /** How far the turn's two ends move apart across the runs, worst, lace widths
   *  — the whole price of a bight. */
  offset: number;
  /** The shortest run between two folds, lace widths. A bight has to FIT: it
   *  needs about 2R of run plus its own offset, and the sample stitches are
   *  small. */
  shortestRun: number;
  held: Array<{ lead: string; text: string }>;
}

const median = (a: number[]): number => {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

function measure(): Reading {
  const p = view.getParams();
  const turns = view.getTurnCenterlines();
  const shapes: Array<{ s: TurnShape; w: number; t: number; step: number }> = turns.map((t) => ({
    s: turnShape(t.line),
    w: t.width,
    t: t.thickness,
    step: t.step,
  }));

  const bulge = shapes.map((x) => x.s.bulge / x.w);
  const planR = shapes.map((x) => x.s.planRadius / x.w);
  const r3 = shapes.map((x) => x.s.radius3D / x.w);
  const constancy = shapes.map((x) =>
    Number.isFinite(x.s.radius3DMax) && x.s.radius3D > 1e-12 ? x.s.radius3DMax / x.s.radius3D : Infinity,
  );
  const flips = shapes.map((x) => x.s.signChanges);
  // The roll's radius is step/2 and the section is laid on the inward radial, so
  // the inner edge sits at step/2 - t/2. That is the quantity the studio's own
  // roll floor of ONE thickness drives to exactly zero.
  const inner = shapes.map((x) => (x.s.radius3D - x.t / 2) / x.t);
  const spanRise = shapes.map((x) => (x.s.rise > 1e-9 ? x.s.spanPlan / x.s.rise : 0));
  // sqrt(4R^2 - step^2) per turn, in lace widths, taken from what was built.
  const offset = shapes.map((x) => {
    const R = Math.max(x.s.radius3D, x.step / 2);
    return Math.sqrt(Math.max(0, 4 * R * R - x.step * x.step)) / x.w;
  });
  // The run each turn has to live in: the plan distance between consecutive
  // folds along a lace. A bight needs roughly 2R of it plus its own offset, and
  // the sample stitches are not large — so this is the row that says whether the
  // scene can hold the turn being asked for.
  const FOLD_TURN = (150 * Math.PI) / 180;
  let shortest = Infinity;
  for (const L of view.laceCenterlines) {
    const P = L.line;
    let last = 0;
    let run = 0;
    for (let i = 1; i < P.length; i++) {
      run += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
      if (i < P.length - 1) {
        const ax = P[i].x - P[i - 1].x, ay = P[i].y - P[i - 1].y;
        const bx = P[i + 1].x - P[i].x, by = P[i + 1].y - P[i].y;
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
        if (la < 1e-9 || lb < 1e-9) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
        if (ang >= FOLD_TURN) {
          if (last > 0) shortest = Math.min(shortest, (run - last) / L.width);
          last = run;
        }
      }
    }
  }

  const held: Array<{ lead: string; text: string }> = [];
  if (shapes.length > 0) {
    const worst = Math.min(...bulge);
    if (worst < 0.02) {
      held.push({
        lead: 'Structural: ',
        text:
          'the plan radius is zero because the roll axis is horizontal, which puts the whole half-roll in a ' +
          'vertical plane. No control on this page can change that — the radius is step/2 in fold.ts and the ' +
          'lace’s width is not in the expression. Tilting the axis is a geometry change, not a setting.',
      });
    }
    const tight = Math.min(...inner);
    if (tight <= 0.001) {
      held.push({
        lead: 'Inverted: ',
        text:
          'the strap’s inner edge is at or through its own roll axis. The studio floors the roll at ONE ' +
          'thickness, which puts the inner edge at exactly zero — one thickness is the cusp, not the minimum. ' +
          'Raise Thickness or Storey height to lift it off.',
      });
    }
  }
  if (view.laceCenterlines.some((L) => L.width * p.turnRoll - L.thickness < L.thickness)) {
    held.push({
      lead: 'Held: ',
      text: 'Roll cap is at its floor — one thickness, which is also where the inner edge reaches zero.',
    });
  }

  return {
    turns: shapes.length,
    bulgeMin: shapes.length ? Math.min(...bulge) : 0,
    bulgeMed: median(bulge),
    planMin: shapes.length ? Math.min(...planR) : 0,
    r3Min: shapes.length ? Math.min(...r3) : 0,
    constancy: shapes.length ? Math.max(...constancy) : 1,
    flips: shapes.length ? Math.max(...flips) : 0,
    inner: shapes.length ? Math.min(...inner) : 0,
    spanRise: median(spanRise),
    offset: shapes.length ? Math.max(...offset) : 0,
    shortestRun: Number.isFinite(shortest) ? shortest : 0,
    held,
  };
}

// ---- the turn overlay ------------------------------------------------------
//
// The rows say a turn has no plan extent; this draws the same centrelines so
// that claim can be looked at rather than believed. Every turn's own curve, in
// place, over the lace — and its plan shadow dropped to a common floor, which is
// where a cusp gives itself away as a straight line.

const marks = new THREE.Group();
view.scene.add(marks);
let showTurns = true;
let showShadow = true;

/** Drawn THROUGH the lace, not behind it. The whole point of the overlay is to
 *  compare the curve against the body it belongs to, and from directly above —
 *  the one view where a cusp is unmistakable — an occluded line is invisible. */
function overlay(g: THREE.BufferGeometry, color: number): THREE.Line {
  const m = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
  const line = new THREE.Line(g, m);
  line.renderOrder = 999;
  return line;
}

function clearMarks(): void {
  for (const c of [...marks.children]) {
    marks.remove(c);
    const o = c as THREE.Line;
    o.geometry?.dispose();
    (o.material as THREE.Material)?.dispose();
  }
}

function drawTurns(): void {
  clearMarks();
  if (!showTurns && !showShadow) return;
  const turns = view.getTurnCenterlines();
  if (turns.length === 0) return;
  let floor = Infinity;
  for (const t of turns) for (const p of t.line) floor = Math.min(floor, p.z);
  floor -= 0.25;

  for (const t of turns) {
    if (t.line.length < 2) continue;
    if (showTurns) {
      const g = new THREE.BufferGeometry().setFromPoints(
        t.line.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
      );
      marks.add(overlay(g, 0x8fc79a));
    }
    if (showShadow) {
      const g = new THREE.BufferGeometry().setFromPoints(
        t.line.map((p) => new THREE.Vector3(p.x, p.y, floor)),
      );
      marks.add(overlay(g, 0x7fb6e8));
    }
  }
  view.renderer.render(view.scene, view.camera);
}

// ---- cameras ---------------------------------------------------------------
//
// Fit looks down at an angle and Top looks straight through the stack; neither
// shows a turn's plan extent against its height. Plan and Elevation are the two
// views the argument is actually conducted in, so they are buttons.

function footprint(): { cx: number; cy: number; r: number } | null {
  const lines = view.laceCenterlines;
  if (lines.length === 0) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const L of lines) {
    for (const p of L.line) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
  }
  if (!Number.isFinite(x0)) return null;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: Math.max(x1 - x0, y1 - y0) / 2 + 0.4 };
}

function zBand(): { lo: number; hi: number } {
  const planes = view.getLevelPlanes();
  if (planes.length === 0) return { lo: -0.5, hi: 0.5 };
  return {
    lo: Math.min(...planes.map((p) => p.under)),
    hi: Math.max(...planes.map((p) => p.over)),
  };
}

function look(dir: [number, number, number]): void {
  const foot = footprint();
  if (!foot) return;
  const { lo, hi } = zBand();
  const cz = (lo + hi) / 2;
  const cam = view.camera;
  const span = Math.max(foot.r * 2, hi - lo, 0.5);
  const dist = (span / (2 * Math.tan((cam.fov * Math.PI) / 360))) * 1.6;
  cam.up.set(0, 0, 1);
  cam.position.set(foot.cx + dir[0] * dist, foot.cy + dir[1] * dist, cz + dir[2] * dist);
  view.controls.target.set(foot.cx, foot.cy, cz);
  cam.lookAt(view.controls.target);
  view.controls.update();
  view.renderer.render(view.scene, cam);
}

// ---- panel -----------------------------------------------------------------

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function section(host: HTMLElement, title: string, note?: string): HTMLElement {
  const s = el('section');
  const h = el('h2');
  h.appendChild(el('span', undefined, title));
  if (note) h.appendChild(el('em', undefined, note));
  s.appendChild(h);
  host.appendChild(s);
  return s;
}

function slider(
  host: HTMLElement,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  note: string,
  set: (v: number) => void,
): void {
  const wrap = el('label', 'slider');
  const head = el('span');
  head.appendChild(el('b', undefined, label));
  const val = el('var', undefined, String(value));
  head.appendChild(val);
  wrap.appendChild(head);
  const input = el('input') as HTMLInputElement;
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = String(v);
    set(v);
    paint();
  });
  wrap.appendChild(input);
  wrap.appendChild(el('small', undefined, note));
  host.appendChild(wrap);
}

function check(host: HTMLElement, label: string, on: boolean, set: (v: boolean) => void, note?: string): void {
  const wrap = el('label', 'check');
  const input = el('input') as HTMLInputElement;
  input.type = 'checkbox';
  input.checked = on;
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => {
    set(input.checked);
    paint();
  });
  wrap.appendChild(input);
  wrap.appendChild(el('span', undefined, label));
  host.appendChild(wrap);
  if (note) host.appendChild(el('small', 'note', note));
}

const param = (patch: Partial<RenderParams>): void => view.setParams(patch);

let readBody: HTMLTableSectionElement | null = null;
let verdictEl: HTMLElement | null = null;
let hasEl: HTMLElement | null = null;

function build(): void {
  bench.textContent = '';
  const p = view.getParams();

  bench.appendChild(el('h1', undefined, 'Fold bench 2'));
  bench.appendChild(
    el(
      'p',
      'lead',
      'What shape a turn is, not how tall. Every row is measured off the turn the splice actually built, ' +
        'and most of them are taken in plan — because that is the only place a bight and a brace differ.',
    ),
  );

  // ---- scene ----
  const sc = section(bench, 'Scene');
  const sel = el('select') as HTMLSelectElement;
  for (const s of SCENES) {
    const o = el('option') as HTMLOptionElement;
    o.value = s.key;
    o.textContent = s.label;
    if (s.key === sceneKey) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    sceneKey = sel.value;
    view.setScene(makeSample(sceneKey));
    paint();
  });
  sc.appendChild(sel);

  const file = el('input') as HTMLInputElement;
  file.type = 'file';
  file.accept = '.json,application/json';
  file.style.display = 'none';
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      view.setScene(parseSceneText(await f.text(), f.name.replace(/\.json$/i, '')));
      sceneKey = '';
      paint();
    } catch (e) {
      window.alert('Could not read that file: ' + (e as Error).message);
    }
    file.value = '';
  });
  const openBtn = el('button', 'filebtn', 'Open a scene file…');
  openBtn.addEventListener('click', () => file.click());
  sc.appendChild(openBtn);
  sc.appendChild(file);

  hasEl = el('div', 'has');
  sc.appendChild(hasEl);

  const cams = el('div', 'row');
  for (const [label, go] of [
    ['Fit', () => view.fitView()],
    ['Plan', () => look([0, 0, 1])],
    ['Elevation', () => look([0, -1, 0])],
    ['Side', () => look([-1, 0, 0])],
  ] as Array<[string, () => void]>) {
    const b = el('button', undefined, label);
    b.addEventListener('click', go);
    cams.appendChild(b);
  }
  sc.appendChild(cams);

  // ---- the turn ----
  const turn = section(bench, 'Turn', 'what the bend is made of');
  slider(turn, 'Bight radius', p.bightRadius, 0, 2, 0.02,
    'How ROUND the bend is, in lace widths — the control the turn never had. At 0 the radius is whatever ' +
      'the storey gives (step ÷ 2) with a flat roll axis, which is the shipped geometry exactly and is also ' +
      'the cusp. Above it the axis tilts, the climb stays one storey, and the plan opens into a real arc. ' +
      'Watch plan bulge and span ÷ rise: this is the only slider that moves them.',
    (v) => param({ bightRadius: v }));
  slider(turn, 'Roll cap', p.turnRoll, 0.4, 4, 0.05,
    'The widest a turn may measure, in lace widths. It caps the roll’s HEIGHT — and its floor of one ' +
      'thickness is exactly where the strap’s inner edge reaches its own axis, so the bottom of this range ' +
      'is inside the inverted regime rather than below it.',
    (v) => param({ turnRoll: v }));
  slider(turn, 'Ramp length', p.turnRamp, 0.02, 2, 0.02,
    'How far an oblique crease may walk the strip sideways as it rolls. Moves where the crease sits, ' +
      'never how round it is.',
    (v) => param({ turnRamp: v }));
  slider(turn, 'Leg length', p.turnLeg, 0, 2, 0.05,
    'The straight legs either side of the tip. Watch the reversals row while you drag: the legs bend ' +
      'against the tip, so a long leg is what actually puts an S in the plan. It cannot go below 0 — the ' +
      'splice has no way to place a nose behind its joint.',
    (v) => param({ turnLeg: v }));
  check(turn, 'Draw each turn’s centreline', showTurns, (v) => { showTurns = v; },
    'The green curve is the turn the splice built, in place.');
  check(turn, 'Drop its plan shadow', showShadow, (v) => { showShadow = v; },
    'The blue curve is the same centreline flattened to one floor. A bight casts an arc; a brace casts a ' +
      'straight line, which is the whole finding in one picture.');

  // ---- lace and storey ----
  const lace = section(bench, 'Lace & storey', 'the scale it is judged against');
  slider(lace, 'Thickness', p.thickness, 2, 120, 1,
    'Source units. The roll’s radius is half the storey and the storey is a multiple of this, so this is ' +
      'the only slider that moves the turn’s radius at all — and it moves its height by exactly as much.',
    (v) => param({ thickness: v }));
  slider(lace, 'Width scale', p.widthScale, 0.2, 3, 0.05,
    'Multiplies every strand’s width. Note what it does NOT do: the width appears in no centreline ' +
      'expression in the turn builder, so the plan radius row will not move.',
    (v) => param({ widthScale: v }));
  slider(lace, 'Storey height', p.storeyStep, 0.5, 6, 0.1,
    'How tall one storey is, in thicknesses. The lanyard measures 1.87.',
    (v) => param({ storeyStep: v }));

  // ---- weave ----
  const weave = section(bench, 'Weave', 'what sets the step at a fold');
  check(weave, 'Interlock at crossings', p.weave, (v) => param({ weave: v }));
  slider(weave, 'Depth', p.weaveDepth, 0, 120, 1,
    'How far apart a crossing leaves two laces. It reaches the turn indirectly: the step a fold climbs is ' +
      'whatever Z-gap the weave left there, and that step is the radius.',
    (v) => param({ weaveDepth: v }));
  slider(weave, 'Layer lift', p.layerGap, 0, 80, 1,
    'What separates two laces that overlap without crossing.',
    (v) => param({ layerGap: v }));

  // ---- look ----
  const look2 = section(bench, 'Look');
  check(look2, 'Outline', p.outline, (v) => param({ outline: v }));
  check(look2, 'Round ends', p.roundCaps, (v) => param({ roundCaps: v }));
  check(look2, 'Grid', p.showGrid, (v) => param({ showGrid: v }));

  // ---- readouts ----
  const read = section(bench, 'Shape of the worst turn', 'live');
  const table = el('table', 'read');
  const head = el('thead');
  const hr = el('tr');
  for (const h of ['', 'now', 'lanyard']) hr.appendChild(el('th', undefined, h));
  head.appendChild(hr);
  table.appendChild(head);
  readBody = el('tbody') as HTMLTableSectionElement;
  table.appendChild(readBody);
  read.appendChild(table);

  verdictEl = el('div');
  read.appendChild(verdictEl);

  paint();
}

function row(label: string, now: string, cls: string, ref: string, sep = false): void {
  if (!readBody) return;
  const tr = el('tr', sep ? 'sep' : undefined);
  tr.appendChild(el('td', undefined, label));
  tr.appendChild(el('td', cls, now));
  tr.appendChild(el('td', 'ref', ref));
  readBody.appendChild(tr);
}

function paint(): void {
  const m = measure();

  if (hasEl) {
    hasEl.textContent = '';
    const scene = view.getScene();
    const bits: Array<[string, boolean]> = [
      [`${scene.strands.length} strands`, true],
      [`${m.turns} turns`, m.turns > 0],
      [`${scene.levelBreaks.length} level breaks`, scene.levelBreaks.length > 0],
      [`${scene.masks.length} masks`, scene.masks.length > 0],
    ];
    for (const [text, live] of bits) hasEl.appendChild(el('b', live ? 'live' : undefined, text));
  }

  if (readBody) {
    readBody.textContent = '';
    if (m.turns === 0) {
      row('no turns in this scene', '—', 'warn', '—');
    } else {
      // The headline. Everything else is here to say this row is not lying.
      row('plan bulge, worst turn', m.bulgeMin.toFixed(3) + ' w',
        m.bulgeMin < 0.02 ? 'bad' : m.bulgeMin < REF.bulge * 0.5 ? 'warn' : 'good',
        REF.bulge.toFixed(2) + ' w', true);
      row('plan bulge, median turn', m.bulgeMed.toFixed(3) + ' w',
        m.bulgeMed < 0.02 ? 'bad' : m.bulgeMed < REF.bulge * 0.5 ? 'warn' : 'good',
        REF.bulge.toFixed(2) + ' w');
      // A radius along a straight line is not large, it is undefined — so it is
      // only printed once the bulge says there is a curve under it.
      row('plan radius', m.bulgeMin < 0.02 ? 'no curve' : m.planMin.toFixed(3) + ' w',
        m.bulgeMin < 0.02 ? 'bad' : 'good', REF.planRadius.toFixed(2) + ' w');
      row('3D radius', m.r3Min.toFixed(3) + ' w', 'good', REF.radius3D.toFixed(2) + ' (helix)', true);
      row('curvature constancy', m.constancy.toFixed(2),
        m.constancy < 1.05 ? 'good' : m.constancy < 1.5 ? 'warn' : 'bad', REF.constancy.toFixed(2), true);
      row('plan reversals', String(m.flips),
        m.flips === 0 ? 'good' : 'bad', String(REF.signChanges));
      row('inner edge clearance', m.inner.toFixed(3) + ' t',
        m.inner <= 0.001 ? 'bad' : m.inner < 0.25 ? 'warn' : 'good', '> 0', true);
      // The same finding from the other side: a turn with no plan extent leaves
      // its two ends at the same place in plan, so the span is zero however far
      // it climbed.
      row('span ÷ rise', m.spanRise.toFixed(2),
        Math.abs(m.spanRise - 2.13) < 0.35 ? 'good' : m.spanRise < 0.05 ? 'bad' : 'warn', '2.13', true);
      // The price, and whether the scene can pay it.
      row('arm offset', m.offset.toFixed(2) + ' w', m.offset < 0.01 ? 'good' : 'warn', '—', true);
      row('shortest run', m.shortestRun.toFixed(2) + ' w',
        m.shortestRun > m.offset + 0.2 ? 'good' : 'bad', 'must exceed the offset');
      row('storey height', view.getParams().storeyStep.toFixed(2) + ' t',
        Math.abs(view.getParams().storeyStep - REF.storey) < 0.15 ? 'good' : 'warn',
        REF.storey.toFixed(2) + ' t');
    }
  }

  drawTurns();

  if (verdictEl) {
    verdictEl.textContent = '';
    const line = (strong: string, rest: string) => {
      const q = el('p', 'verdict');
      q.appendChild(el('b', undefined, strong));
      q.append(rest);
      verdictEl!.appendChild(q);
    };
    if (m.turns > 0) {
      if (m.bulgeMin < 0.02) {
        line('This is the brace. ',
          'The worst turn has no plan extent at all — from above it runs out to a point and comes straight ' +
            'back. Switch on the plan shadow and look: it is a straight line. Nothing on this page fixes it, ' +
            'and that is the finding.');
      } else {
        line('A real bight. ',
          `Worst bulge ${m.bulgeMin.toFixed(2)} lace widths against the lanyard's ${REF.bulge.toFixed(2)}.`);
      }
    }
    line('Plan bulge is the row that matters',
      ': a turn can be perfectly round in space and still be a cusp seen from above, because the roll axis ' +
        'is horizontal and the whole roll lies in a vertical plane. The 3D radius row is there to show ' +
        'exactly that — it looks healthy while the plan row reads zero.');
    for (const h of m.held) line(h.lead, h.text);
  }
}

build();
view.fitView();

// Dev handle, mirroring the studio's `window.__scoubidou` and the first bench's
// `window.__bench` — it is how this page's own numbers were taken.
if (import.meta.env.DEV) {
  (window as unknown as { __bench2: unknown }).__bench2 = { view, measure, paint, REF, scene: () => sceneKey };
}

window.addEventListener('resize', () => paint());
