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

// 4) The box stitch (square stitch) — the first stitch of the classic two-colour
//    lanyard, i.e. the tutorial worked through to "pull all lanyards evenly to
//    create your first stitch".
//
//    Two cords are crossed and their four arms lettered A/B/C/D, with A-C one cord
//    and B-D the other. The stitch is: fold A over B-D, fold B over A, fold C over
//    B-D, then fold D over C AND UNDER A, and pull tight. Each folded arm crosses
//    the centre and exits the far side, so the four returns form a woven square.
//
//    That last move is the whole point of the knot, and it is CYCLIC: A over D,
//    D over C, C over B, B over A. Every arm rides over one neighbour and dives
//    under the other, so no layer order can express it — a rigid stack always has
//    a topmost strand, and this square has none. It only holds together because
//    each crossing is decided on its own, which is exactly what mask layers do.
function boxStitch(): Scene3D {
  const cx = 400;
  const cy = 300;
  const w = 44; // lace width
  const d = 24; // half-offset of each return leg from centre -> a tight square
  const reach = 175; // how far the arms stick out

  const strands: Strand3D[] = [
    // Cord 1 (green): A folded west->east along the top, C folded east->west along
    // the bottom.
    mk('A', { x: cx - reach, y: cy - d }, { x: cx + reach, y: cy - d }, GREEN, { width: w }),
    mk('C', { x: cx + reach, y: cy + d }, { x: cx - reach, y: cy + d }, GREEN, { width: w }),
    // Cord 2 (gold): B folded north->south down the right, D folded south->north
    // up the left.
    mk('B', { x: cx + d, y: cy - reach }, { x: cx + d, y: cy + reach }, GOLD, { width: w }),
    mk('D', { x: cx - d, y: cy + reach }, { x: cx - d, y: cy - reach }, GOLD, { width: w }),
  ];

  // One mask per corner of the square, walked around the pinwheel. Each arm is
  // named first (over) exactly once and second (under) exactly once.
  const masks: MaskLink[] = [
    { overId: 'A', underId: 'D' }, // top-left
    { overId: 'B', underId: 'A' }, // top-right
    { overId: 'C', underId: 'B' }, // bottom-right
    { overId: 'D', underId: 'C' }, // bottom-left — "fold D over C and under A"
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
