// The fold bench: every system that decides where a lace sits, on one panel,
// over a real scene, with the numbers it is producing shown as you drag.
//
// This is not the Z band lab (`src/zlab/`). That page invents its two runs so
// it can ask what a turn IS, in isolation, across the whole range of
// separations — and inventing the runs is exactly why it can show no weave, no
// joints, no layers and no storeys. Those only exist in the model.
//
// So this bench does the opposite: it runs the STUDIO's pipeline on a real
// scene and puts the five systems that fight over a lace's height side by side —
//
//   LACE     how wide and how thick, which sets the scale everything else is
//            judged against, and which a storey is defined in terms of
//   FOLD     what happens where a lace doubles back and changes storey
//   WEAVE    what happens where two laces cross
//   LAYERS   what keeps two laces apart when they overlap WITHOUT crossing
//   LEVELS   what puts one storey above another
//
// They interact, and that is the whole point. A storey is two thicknesses, so
// dragging Thickness moves the fold. The weave is capped by the storey, so a
// scene with a level break resolves its crossings differently from one without.
// Reading any of them alone is how a setting that looks right on one scene
// turns out wrong on the next.
//
// The readouts are the reason this is a bench rather than a second studio.
// Every one of them is geometry, not pixels, so they cost nothing to recompute
// and update live on the drag; and PIN holds a column of them so a change can
// be judged against where it started rather than against memory.

import { RenderParams, StrandScene } from '../scene/StrandScene';
import { makeSample } from '../model/samples';
import { parseSceneText } from '../model/sceneIO';
import { Vec3 } from '../geometry/vec';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const bench = document.getElementById('bench') as HTMLElement;

const SCALE = 0.02; // source units -> world, as StrandScene uses
const FOLD_TURN = (60 * Math.PI) / 180;

/**
 * The scenes worth standing at the bench, and what each one actually exercises.
 *
 * Curated rather than the whole sample list, and ordered by how much is in
 * play: a reading taken on a scene with no folds says nothing about folds, and
 * the fastest way to stop that happening is to say what each scene has before
 * it is opened.
 */
const SCENES: Array<{ key: string; label: string; has: string }> = [
  { key: 'two-crossing', label: 'Two crossing strands', has: 'weave' },
  { key: 'woven-mat', label: 'Woven mat', has: 'weave' },
  { key: 'diagonal', label: 'Diagonal basket', has: 'weave' },
  { key: 'fold-pair', label: 'One lace, one turn', has: 'fold, joints' },
  { key: 'box-stitch', label: 'Box stitch — starting stitch', has: 'everything but levels' },
  { key: 'box-stitch-10', label: 'Box stitch — 10 levels', has: 'everything' },
  { key: 'twist-stitch-10', label: 'Twist stitch — 10 twists', has: 'everything, densest' },
  { key: 'ring-2x1-k1111-lh', label: 'Fitted ring 2x1', has: 'everything, widest turns' },
];

const view = new StrandScene(canvas);
view.setTheme('dark');

let sceneKey = 'box-stitch-10';
view.setScene(makeSample(sceneKey));

// ---- measuring --------------------------------------------------------------

interface Reading {
  crossings: number;
  airMin: number;
  airMed: number;
  airMax: number;
  folds: number;
  rollMax: number;
  tiltMax: number;
  steepShare: number;
  /** Which knob is currently being overruled by something else, if any. A
   *  reader who drags a control and sees nothing move needs to be told what is
   *  holding it, or the bench has taught them the control is broken. */
  held: string[];
}

const median = (xs: number[]): number => (xs.length ? xs[xs.length >> 1] : 0);

/** Where two segments cross in plan, and the height of each there. */
function cross(a1: Vec3, a2: Vec3, b1: Vec3, b2: Vec3): { za: number; zb: number } | null {
  const ax = a2.x - a1.x;
  const ay = a2.y - a1.y;
  const bx = b2.x - b1.x;
  const by = b2.y - b1.y;
  const den = ax * by - ay * bx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((b1.x - a1.x) * by - (b1.y - a1.y) * bx) / den;
  const u = ((b1.x - a1.x) * ay - (b1.y - a1.y) * ax) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { za: a1.z + (a2.z - a1.z) * t, zb: b1.z + (b2.z - b1.z) * u };
}

function turnAt(p: Vec3[], i: number): number {
  const ax = p[i].x - p[i - 1].x;
  const ay = p[i].y - p[i - 1].y;
  const bx = p[i + 1].x - p[i].x;
  const by = p[i + 1].y - p[i].y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
}

/**
 * What the current settings are actually producing.
 *
 * AIR is the one that says whether the weave closed: the distance between a
 * lace riding over and the lace under it, less the distance at which they would
 * be resting on each other, in thicknesses. Zero is resting. Positive is
 * daylight between them; negative is the two lying inside each other.
 *
 * Only pairs on the SAME level are counted. Two laces a storey apart cross in
 * plan and nowhere else — the level break has already said one passes above the
 * other, and the weave is deliberately not asked to resolve them — so counting
 * those reports a storey as a gap that failed to close.
 *
 * ROLL is the fold's side of it: how wide a turn measures, gap plus a thickness
 * of lace either side, against the lace's own width.
 */
function measure(): Reading {
  const p = view.getParams();
  const strands = view.getScene().strands;
  const lines = view.getWovenCenterlines();
  const levels = view.getStrandLevels();
  const thick = (i: number): number => (strands[i].thickness ?? p.thickness) * SCALE;

  const air: number[] = [];
  for (let a = 0; a < lines.length; a++) {
    const A = lines[a];
    if (!A) continue;
    for (let b = a + 1; b < lines.length; b++) {
      const B = lines[b];
      if (!B) continue;
      if (levels[a] !== levels[b]) continue;
      for (let i = 1; i < A.length; i++) {
        for (let j = 1; j < B.length; j++) {
          const h = cross(A[i - 1], A[i], B[j - 1], B[j]);
          if (!h) continue;
          const rest = (thick(a) + thick(b)) / 2;
          air.push((Math.abs(h.za - h.zb) - rest) / rest);
        }
      }
    }
  }
  air.sort((x, y) => x - y);

  const rolls: number[] = [];
  let tiltMax = 0;
  let steep = 0;
  let segs = 0;
  for (const L of view.laceCenterlines) {
    const P = L.line;
    for (let i = 1; i < P.length; i++) {
      const run = Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
      if (run < 1e-9) continue;
      const deg = (Math.atan(Math.abs((P[i].z - P[i - 1].z) / run)) * 180) / Math.PI;
      tiltMax = Math.max(tiltMax, deg);
      segs++;
      if (deg > 30) steep++;
    }
    for (let i = 1; i < P.length - 1; i++) {
      if (turnAt(P, i) < FOLD_TURN) continue;
      const zIn = P[i].zIn ?? P[i].z;
      const zOut = P[i].zOut ?? P[i].z;
      rolls.push((Math.abs(zOut - zIn) + L.thickness) / L.width);
    }
  }

  // What is currently overruling a control. These mirror the two caps in
  // StrandScene — `weaveAmplitude`'s storey cap and `TURN_ROLL_DEFAULT`'s floor —
  // and exist because both of them make a slider go quiet, which is otherwise
  // indistinguishable from a broken one.
  const held: string[] = [];
  if (view.getScene().levelBreaks.length > 0 && p.weave && p.weaveDepth > p.thickness) {
    held.push(
      'Depth is held at resting by the storey — a crossing has to fit inside one, ' +
        'so past a thickness the slider stops mattering. Open a scene with no level breaks to see it move.',
    );
  }
  if (view.laceCenterlines.some((L) => L.width * p.turnRoll - L.thickness < L.thickness)) {
    held.push(
      'Roll cap is at its floor — one thickness, the two runs touching, which is the least a fold can be. ' +
        'Below this the slider cannot shrink the turn any further.',
    );
  }

  return {
    crossings: air.length,
    airMin: air[0] ?? 0,
    airMed: median(air),
    airMax: air[air.length - 1] ?? 0,
    folds: rolls.length,
    rollMax: rolls.length ? Math.max(...rolls) : 0,
    tiltMax,
    steepShare: segs ? (100 * steep) / segs : 0,
    held,
  };
}

// ---- the panel --------------------------------------------------------------

let pinned: Reading | null = null;
let readBody: HTMLTableSectionElement | null = null;
let verdictEl: HTMLElement | null = null;
let hasEl: HTMLElement | null = null;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

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
    const v = Number(input.value);
    val.textContent = input.value;
    set(v);
    paint();
  });
  wrap.appendChild(input);
  wrap.appendChild(el('small', undefined, note));
  host.appendChild(wrap);
}

function check(
  host: HTMLElement,
  label: string,
  on: boolean,
  set: (v: boolean) => void,
): void {
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
}

const param = (patch: Partial<RenderParams>): void => view.setParams(patch);

function build(): void {
  bench.textContent = '';
  const p = view.getParams();

  bench.appendChild(el('h1', undefined, 'Fold bench'));
  bench.appendChild(
    el(
      'p',
      'lead',
      'Every system that decides where a lace sits, over one real scene. They interact — a storey is two thicknesses, so Thickness moves the fold, and the weave is capped by the storey.',
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
    pinned = null;
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
      pinned = null;
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
    ['Top', () => view.topView()],
  ] as Array<[string, () => void]>) {
    const b = el('button', undefined, label);
    b.addEventListener('click', go);
    cams.appendChild(b);
  }
  sc.appendChild(cams);

  // ---- lace ----
  const lace = section(bench, 'Lace', 'sets the scale');
  slider(lace, 'Thickness', p.thickness, 2, 120, 1,
    'Source units. A storey is two of these, so this moves the fold and the weave with it.',
    (v) => param({ thickness: v }));
  slider(lace, 'Width scale', p.widthScale, 0.2, 3, 0.05,
    'Multiplies every strand’s drawn width. The unit the roll cap is measured in.',
    (v) => param({ widthScale: v }));

  // ---- fold ----
  const fold = section(bench, 'Fold', 'at a storey turn');
  slider(fold, 'Ramp length', p.turnRamp, 0, 3, 0.05,
    'World units. Four times this is the furthest an oblique crease may walk the strip sideways as it rolls.',
    (v) => param({ turnRamp: v }));
  slider(fold, 'Leg length', p.turnLeg, 0, 2, 0.05,
    'The straight legs either side of the tip. At 0 the turn is the bare knuckle and the crease sits on the bisector whatever the lean says.',
    (v) => param({ turnLeg: v }));
  slider(fold, 'Roll cap', p.turnRoll, 0.4, 4, 0.05,
    'The widest a turn may measure, in lace widths. What the crease refuses, the runs ramp — watch the steepest run below.',
    (v) => param({ turnRoll: v }));

  // ---- weave ----
  const weave = section(bench, 'Weave', 'where two laces cross');
  check(weave, 'Interlock at crossings', p.weave, (v) => param({ weave: v }));
  slider(weave, 'Depth', p.weaveDepth, 0, 120, 1,
    'How far apart a crossing leaves the two laces, centre to centre. One thickness is them resting on each other; it cannot go below that.',
    (v) => param({ weaveDepth: v }));
  slider(weave, 'Span', p.weaveSpan, 0.4, 3, 0.05,
    'How far a crossing’s influence reaches along the lace, in crossing widths.',
    (v) => param({ weaveSpan: v }));

  // ---- layers ----
  const layers = section(bench, 'Layers', 'overlapping, not crossing');
  slider(layers, 'Layer lift', p.layerGap, 0, 80, 1,
    'What separates two laces that overlap but never cross. Nothing to do with the weave, and it is why two arms can rest at different heights.',
    (v) => param({ layerGap: v }));

  // ---- look ----
  const look = section(bench, 'Look');
  check(look, 'Outline', p.outline, (v) => param({ outline: v }));
  check(look, 'Round ends', p.roundCaps, (v) => param({ roundCaps: v }));
  check(look, 'Grid', p.showGrid, (v) => param({ showGrid: v }));

  // ---- readouts ----
  const read = section(bench, 'What that measures', 'live');
  const table = el('table', 'read');
  const head = el('thead');
  const hr = el('tr');
  for (const h of ['', 'now', 'pinned']) hr.appendChild(el('th', undefined, h));
  head.appendChild(hr);
  table.appendChild(head);
  readBody = el('tbody');
  table.appendChild(readBody);
  read.appendChild(table);

  verdictEl = el('div');
  read.appendChild(verdictEl);

  const acts = el('div', 'row');
  const pinBtn = el('button', undefined, 'Pin these');
  pinBtn.addEventListener('click', () => {
    pinned = measure();
    paint();
  });
  const copyBtn = el('button', undefined, 'Copy settings');
  copyBtn.addEventListener('click', async () => {
    const q = view.getParams();
    const text = JSON.stringify(
      {
        scene: sceneKey || '(imported)',
        thickness: q.thickness,
        widthScale: q.widthScale,
        turnRamp: q.turnRamp,
        turnLeg: q.turnLeg,
        turnRoll: q.turnRoll,
        weave: q.weave,
        weaveDepth: q.weaveDepth,
        weaveSpan: q.weaveSpan,
        layerGap: q.layerGap,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied';
      window.setTimeout(() => (copyBtn.textContent = 'Copy settings'), 1200);
    } catch {
      window.prompt('Copy these:', text);
    }
  });
  acts.append(pinBtn, copyBtn);
  read.appendChild(acts);

  paint();
}

/** How a number reads: air wants 0, and either side of it is a different fault. */
function airClass(v: number): string {
  if (Math.abs(v) < 0.06) return 'good';
  return v > 0 ? 'warn' : 'bad';
}

function row(label: string, now: string, nowCls: string, was: string, sep = false): void {
  if (!readBody) return;
  const tr = el('tr', sep ? 'sep' : undefined);
  tr.appendChild(el('td', undefined, label));
  tr.appendChild(el('td', nowCls, now));
  tr.appendChild(el('td', 'pin', was));
  readBody.appendChild(tr);
}

function paint(): void {
  const m = measure();
  const P = pinned;
  const f2 = (v: number): string => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);

  if (hasEl) {
    hasEl.textContent = '';
    const scene = view.getScene();
    const joints = scene.strands.filter((s) => s.parentId).length;
    const bits: Array<[string, boolean]> = [
      [`${scene.strands.length} strands`, true],
      [`${m.crossings} crossings`, m.crossings > 0],
      [`${m.folds} turns`, m.folds > 0],
      [`${joints} joints`, joints > 0],
      [`${scene.levelBreaks.length} level breaks`, scene.levelBreaks.length > 0],
      [`${scene.masks.length} masks`, scene.masks.length > 0],
    ];
    for (const [text, live] of bits) hasEl.appendChild(el('b', live ? 'live' : undefined, text));
  }

  if (readBody) {
    readBody.textContent = '';
    row('air, tightest', f2(m.airMin), airClass(m.airMin), P ? f2(P.airMin) : '—');
    row('air, typical', f2(m.airMed), airClass(m.airMed), P ? f2(P.airMed) : '—');
    row('air, loosest', f2(m.airMax), airClass(m.airMax), P ? f2(P.airMax) : '—');
    row('widest turn', m.rollMax.toFixed(2), m.rollMax > 1.8 ? 'warn' : 'good',
      P ? P.rollMax.toFixed(2) : '—', true);
    row('steepest run', `${m.tiltMax.toFixed(0)}°`, m.tiltMax > 45 ? 'warn' : 'good',
      P ? `${P.tiltMax.toFixed(0)}°` : '—');
    row('run over 30°', `${m.steepShare.toFixed(0)}%`, m.steepShare > 25 ? 'warn' : 'good',
      P ? `${P.steepShare.toFixed(0)}%` : '—');
  }

  if (verdictEl) {
    verdictEl.textContent = '';
    const line = (strong: string, rest: string) => {
      const p = el('p', 'verdict');
      p.appendChild(el('b', undefined, strong));
      p.append(rest);
      verdictEl!.appendChild(p);
    };
    if (m.crossings === 0) {
      line('No crossings here', ' — the air rows say nothing about this scene.');
    }
    if (m.folds === 0) {
      line('No turns here', ' — widest turn says nothing about this scene.');
    }
    line(
      'Air is in thicknesses',
      ': 0 is a lace resting on the one under it, + is daylight between them, − is the two lying' +
        ' inside each other. Widest turn is in lace widths. What a turn refuses to carry the runs ramp,' +
        ' so tightening Roll cap pushes the last two rows up.',
    );
    for (const h of m.held) line('Held: ', h);
  }
}

build();

// The panel is rebuilt on a scene change only to reset the sliders to whatever
// the new scene's params are; the readouts repaint on their own.
window.addEventListener('resize', () => paint());
