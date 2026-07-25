// Built-in demo scenes. Coordinates are in the same pixel space OpenStrand
// Studio uses (roughly a 800x500 region), so these sit naturally alongside
// imported .json files. Palette echoes the yellow/orange/white plastic-lacing
// lanyards that inspired the 3D treatment.

import { MaskLink, Point, RGBA, Scene3D, Strand3D } from './types';

const YELLOW: RGBA = { r: 245, g: 200, b: 55, a: 255 };
const ORANGE: RGBA = { r: 226, g: 122, b: 38, a: 255 };
const WHITE: RGBA = { r: 240, g: 240, b: 240, a: 255 };
const TEAL: RGBA = { r: 60, g: 170, b: 175, a: 255 };
// The green/gold pairing of the classic two-colour lanyard tutorials.
const GREEN: RGBA = { r: 46, g: 158, b: 107, a: 255 };
const GOLD: RGBA = { r: 240, g: 196, b: 52, a: 255 };
const STROKE: RGBA = { r: 30, g: 30, b: 30, a: 255 };

let uid = 0;

interface StrandOpts {
  width?: number;
  cp1?: Point;
  cp2?: Point;
}

// A straight strand: OSS treats a strand as a straight line when both control
// points sit on the start (see bezier.ts buildProfile line-mode).
function mk(id: string, start: Point, end: Point, color: RGBA, opts: StrandOpts = {}): Strand3D {
  return {
    id: id || `s${uid++}`,
    start,
    end,
    control_points: [opts.cp1 ?? { ...start }, opts.cp2 ?? { ...start }],
    control_point_center: null,
    control_point_center_locked: false,
    width: opts.width ?? 46,
    stroke_width: 4,
    color,
    stroke_color: STROKE,
    thickness: null,
    visible: true,
    isMask: false,
    // Every seed strand is a free base strand: both endpoints open for attaching.
    hasCircles: [false, false],
    parentId: null,
    parentSide: null,
  };
}

// 1) Two crossing strands — the canonical "Y over X" demo. Vertical (yellow) is
//    the top layer, so with no mask the weave lifts it over the horizontal
//    (orange) at their crossing purely from the layer order.
function twoCrossing(): Scene3D {
  return {
    name: 'Two crossing strands',
    masks: [],
    strands: [
      mk('1_1', { x: 120, y: 250 }, { x: 680, y: 250 }, ORANGE, { width: 54 }),
      mk('2_1', { x: 400, y: 90 }, { x: 400, y: 410 }, YELLOW, { width: 54 }),
    ],
  };
}

// 2) A basket / woven mat — horizontal and vertical laces that truly interlock.
//    A checkerboard of masks makes each strand ride OVER some crossings and duck
//    UNDER others (impossible with layer order alone, since every vertical would
//    otherwise sit entirely above every horizontal). This is exactly what OSS
//    masks encode, now realised as real depth.
function wovenMat(): Scene3D {
  const strands: Strand3D[] = [];
  const masks: MaskLink[] = [];
  const ys = [150, 215, 280, 345];
  const xs = [200, 330, 460, 590];
  const w = 46;
  for (let i = 0; i < 4; i++) {
    strands.push(mk(`h${i}`, { x: 140, y: ys[i] }, { x: 660, y: ys[i] }, i % 2 ? ORANGE : YELLOW, { width: w }));
    strands.push(mk(`v${i}`, { x: xs[i], y: 110 }, { x: xs[i], y: 390 }, i % 2 ? WHITE : TEAL, { width: w }));
  }
  // Checkerboard over/under: at crossing (row i, col j) the horizontal rides over
  // when i+j is even, otherwise the vertical does.
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const h = `h${i}`;
      const v = `v${j}`;
      masks.push((i + j) % 2 === 0 ? { overId: h, underId: v } : { overId: v, underId: h });
    }
  }
  return { name: 'Woven mat', strands, masks };
}

// 3) Three bowed ribbons that sweep across one another — a soft curved weave.
//    They start on separate rows (so the flat ends don't overlap) but bow enough
//    to cross in the middle, where the weave lifts and dips them over each other.
function curvedStack(): Scene3D {
  const cols = [YELLOW, ORANGE, WHITE];
  const strands: Strand3D[] = [];
  for (let i = 0; i < 3; i++) {
    const y = 170 + i * 80;
    strands.push(
      mk(`${i + 1}_1`, { x: 130, y }, { x: 670, y }, cols[i], {
        width: 50,
        cp1: { x: 300, y: y - 120 + i * 40 },
        cp2: { x: 500, y: y + 120 - i * 40 },
      }),
    );
  }
  return { name: 'Curved ribbon weave', masks: [], strands };
}

// 4) The box stitch (square stitch) — the classic two-colour lanyard tutorial
//    worked through step 7, "pull all lanyards evenly to create your first
//    stitch".
//
//    Setup (figs. 1-2): two cords are crossed and pinned, and their four arms are
//    lettered A/B/C/D. A and C are the two ends of ONE cord, B and D the two ends
//    of the other — which is why the instructions talk about folding an arm over
//    "lanyard B-D", naming the whole cord.
//
//    The stitch (figs. 3-6): fold A over B-D, fold B over A, fold C over B-D, then
//    fold D over C AND UNDER A. Every arm folds 180° across the centre, and each
//    fold leaves a BIGHT — a U-turn — behind it. So each cord runs:
//
//        tip -> its folded return -> bight -> the original pinned centre run
//            -> bight -> the other folded return -> other tip
//
//    Three parallel runs per cord, joined end to end into one continuous lace (the
//    app glues them at their shared endpoints, as with any attached strand). The
//    two cords' runs cross nine times, and the four folded returns form the woven
//    square you can see in the middle of fig. 7, with both centre runs buried
//    underneath it.
//
//    "Fold D over C and under A" is the move that locks the stitch, and it makes
//    the four returns CYCLIC: A over D, D over C, C over B, B over A. Every arm
//    rides over one neighbour and dives under the other, so the square has no
//    topmost strand and no layer ordering can express it. It holds together only
//    because each crossing is decided on its own — which is what mask layers do.
function boxStitch(): Scene3D {
  const cx = 400;
  const cy = 300;
  const w = 34; // lace width
  // Spacing between one cord's three parallel runs. It has to clear the width
  // comfortably: each bight turns a full 180° across this gap, so a spacing near
  // the width would fold the ribbon back through itself.
  const d = 72;
  const b = 145; // how far the bights sit from the centre
  const t = 215; // how far the free tips stick out
  // How far a bight bulges past its turn. Counter-intuitively this wants to stay
  // SMALLER than the gap it spans: the turn is roughly elliptical, so its apex
  // radius is about (d/2)^2 / bow, and pushing the bulge further out makes the
  // apex sharper until the ribbon folds back through itself.
  const bow = 30;

  const strands: Strand3D[] = [
    // --- Cord 1 (green): tip A, round the west bight, through the centre, round
    //     the east bight, out to tip C.
    mk('A', { x: cx + t, y: cy - d }, { x: cx - b, y: cy - d }, GREEN, { width: w }),
    mk('A_bight', { x: cx - b, y: cy - d }, { x: cx - b, y: cy }, GREEN, {
      width: w,
      cp1: { x: cx - b - bow, y: cy - d },
      cp2: { x: cx - b - bow, y: cy },
    }),
    mk('AC_mid', { x: cx - b, y: cy }, { x: cx + b, y: cy }, GREEN, { width: w }),
    mk('C_bight', { x: cx + b, y: cy }, { x: cx + b, y: cy + d }, GREEN, {
      width: w,
      cp1: { x: cx + b + bow, y: cy },
      cp2: { x: cx + b + bow, y: cy + d },
    }),
    mk('C', { x: cx + b, y: cy + d }, { x: cx - t, y: cy + d }, GREEN, { width: w }),

    // --- Cord 2 (gold): the same lace shape, turned a quarter turn.
    mk('B', { x: cx + d, y: cy + t }, { x: cx + d, y: cy - b }, GOLD, { width: w }),
    mk('B_bight', { x: cx + d, y: cy - b }, { x: cx, y: cy - b }, GOLD, {
      width: w,
      cp1: { x: cx + d, y: cy - b - bow },
      cp2: { x: cx, y: cy - b - bow },
    }),
    mk('BD_mid', { x: cx, y: cy - b }, { x: cx, y: cy + b }, GOLD, { width: w }),
    mk('D_bight', { x: cx, y: cy + b }, { x: cx - d, y: cy + b }, GOLD, {
      width: w,
      cp1: { x: cx, y: cy + b + bow },
      cp2: { x: cx - d, y: cy + b + bow },
    }),
    mk('D', { x: cx - d, y: cy + b }, { x: cx - d, y: cy - t }, GOLD, { width: w }),
  ];

  // One mask per crossing — nine in all, straight off the instructions.
  const masks: MaskLink[] = [
    // "Fold A over lanyard B-D."
    { overId: 'A', underId: 'BD_mid' },
    // "Fold B over A" — and B crosses the A-C cord on its way.
    { overId: 'B', underId: 'A' },
    { overId: 'B', underId: 'AC_mid' },
    // "Fold C over B-D" — over B's return and over the centre run.
    { overId: 'C', underId: 'B' },
    { overId: 'C', underId: 'BD_mid' },
    // "Fold D over C and under A" — the lock.
    { overId: 'D', underId: 'C' },
    { overId: 'D', underId: 'AC_mid' },
    { overId: 'A', underId: 'D' },
    // Fig. 1: the original pinned crossing, green laid across gold.
    { overId: 'AC_mid', underId: 'BD_mid' },
  ];

  return { name: 'Box stitch — first stitch', strands, masks };
}

export const SAMPLES: Record<string, () => Scene3D> = {
  'two-crossing': twoCrossing,
  'box-stitch': boxStitch,
  'woven-mat': wovenMat,
  'curved-stack': curvedStack,
};

export const SAMPLE_LABELS: Array<{ key: string; label: string }> = [
  { key: 'two-crossing', label: 'Two crossing strands' },
  { key: 'box-stitch', label: 'Box stitch — first stitch' },
  { key: 'woven-mat', label: 'Woven mat' },
  { key: 'curved-stack', label: 'Curved ribbon weave' },
];

export function makeSample(key: string): Scene3D {
  return (SAMPLES[key] ?? twoCrossing)();
}
