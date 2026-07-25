// Built-in demo scenes. Coordinates are in the same pixel space OpenStrand
// Studio uses (roughly a 800x500 region), so these sit naturally alongside
// imported .json files. Palette echoes the yellow/orange/white plastic-lacing
// lanyards that inspired the 3D treatment.

import { MaskLink, Point, RGBA, Scene3D, Strand3D } from './types';

const YELLOW: RGBA = { r: 245, g: 200, b: 55, a: 255 };
const ORANGE: RGBA = { r: 226, g: 122, b: 38, a: 255 };
const WHITE: RGBA = { r: 240, g: 240, b: 240, a: 255 };
const TEAL: RGBA = { r: 60, g: 170, b: 175, a: 255 };
const STROKE: RGBA = { r: 30, g: 30, b: 30, a: 255 };

let uid = 0;

interface StrandOpts {
  width?: number;
  cp1?: Point;
  cp2?: Point;
  /** Lineage for a strand grown off another with Attach (OSS `1_1` -> `1_2`). */
  parentId?: string;
  parentSide?: 0 | 1;
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
    // Occupancy is derived from the geometry on load (connections.recomputeOccupancy),
    // so shared endpoints become junctions without being declared here.
    hasCircles: [false, false],
    parentId: opts.parentId ?? null,
    parentSide: opts.parentSide ?? null,
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

// 4) The box stitch (square stitch), at the starting stitch.
//
//    Two laces are crossed and pinned, and their four arms are lettered A/B/C/D —
//    A and C the two ends of one lace, B and D the two ends of the other, which is
//    why the instructions say to fold an arm over "lanyard B-D", naming a whole
//    lace. Then each arm is folded back across the middle in turn, the last one
//    tucking under the first.
//
//    Every fold turns one arm into its own strand hanging off the middle, so each
//    lace ends up as THREE runs: the short original pinned segment, plus an arm
//    attached at each of its two ends. That short middle segment sits at an angle,
//    and that angle is what offsets the two arms from each other — no U-turn is
//    needed, the fold is simply the arm leaving the middle in a new direction. It
//    is the OpenStrand shape exactly: base strand `1_1`, arms `1_2` and `1_3`.
//
//    The two laces' runs cross NINE times, and it takes only ONE mask (see below).
//    Geometry from a scene built by hand in the app, so the proportions are a real
//    stitch rather than an idealised diagram.
function boxStitch(): Scene3D {
  const w = 54;

  // The four joins. Each cord's two arms hang off the two ends of its middle run,
  // so naming the shared points keeps the attachments exact.
  const o1 = { x: 330, y: 302 }; // orange middle start — arm 1_2 folds off here
  const o2 = { x: 460, y: 229 }; // orange middle end   — arm 1_3 folds off here
  const y1 = { x: 352, y: 201 }; // gold middle start   — arm 2_3 folds off here
  const y2 = { x: 435, y: 328 }; // gold middle end     — arm 2_2 folds off here

  // Bottom of the layer stack first, which is the order the arms were folded in.
  const strands: Strand3D[] = [
    // The two original laces, still pinned across each other (fig. 1). Short,
    // because the folding has already eaten most of their length.
    mk('1_1', { ...o1 }, { ...o2 }, ORANGE, { width: w }),
    mk('2_1', { ...y1 }, { ...y2 }, YELLOW, { width: w }),
    // The four folded arms, each attached to one end of its own middle run.
    mk('1_2', { ...o1 }, { x: 683, y: 270 }, ORANGE, { width: w, parentId: '1_1', parentSide: 0 }),
    mk('2_2', { ...y2 }, { x: 404, y: 17 }, YELLOW, { width: w, parentId: '2_1', parentSide: 1 }),
    mk('1_3', { ...o2 }, { x: 150, y: 267 }, ORANGE, { width: w, parentId: '1_1', parentSide: 1 }),
    mk('2_3', { ...y1 }, { x: 407, y: 476 }, YELLOW, { width: w, parentId: '2_1', parentSide: 0 }),
  ];

  // Just one. The nine crossings are otherwise resolved by the layer order — the
  // arms were folded in that order, so stacking already tells the truth almost
  // everywhere. The single exception is the move that locks the stitch, where the
  // last arm has to dive back UNDER the first one folded; that contradicts the
  // stacking, so it needs a mask. Exactly how it works in OpenStrand Studio: you
  // mask a crossing only where the natural order is wrong.
  const masks: MaskLink[] = [{ overId: '1_2', underId: '2_3' }];

  return { name: 'Box stitch — starting stitch', strands, masks };
}

// 5) A flat braid of `count` laces — the plait you get by repeatedly swapping a
//    lace with its neighbour, which for three laces is the ordinary hair plait.
//
//    Each lace is a chain of straight segments: one per row, running from the
//    column it starts the row in to the column it ends in. Consecutive segments
//    share an endpoint, so a lace is one continuous piece exactly as if it had been
//    grown with Attach.
//
//    Every swap is one crossing and takes one mask. The lace moving RIGHT passes
//    over the one moving left, every time — which is all "a braid" means, and it
//    alternates each lace between over and under without anything else being said.
function flatBraid(count: number, rows: number, name: string): Scene3D {
  const cols: number[] = [];
  const gap = 52;
  const x0 = 400 - ((count - 1) * gap) / 2;
  for (let c = 0; c < count; c++) cols.push(x0 + c * gap);
  const y0 = 90;
  const dy = 62;
  const palette = [YELLOW, ORANGE, TEAL, WHITE, { r: 210, g: 90, b: 110, a: 255 }];

  // Which column each lace occupies, updated row by row.
  const at = Array.from({ length: count }, (_, i) => i);
  const strands: Strand3D[] = [];
  const masks: MaskLink[] = [];
  const id = (lace: number, row: number) => `${lace + 1}_${row + 1}`;

  for (let row = 0; row < rows; row++) {
    // Alternate which neighbours trade places, so the weave steps sideways.
    const first = row % 2; // 0: swap (0,1),(2,3)…  1: swap (1,2),(3,4)…
    const next = at.slice();
    for (let c = first; c + 1 < count; c += 2) {
      const left = at.indexOf(c);
      const right = at.indexOf(c + 1);
      next[left] = c + 1;
      next[right] = c;
      // The one travelling right goes over.
      masks.push({ overId: id(left, row), underId: id(right, row) });
    }
    for (let lace = 0; lace < count; lace++) {
      strands.push(
        mk(
          id(lace, row),
          { x: cols[at[lace]], y: y0 + row * dy },
          { x: cols[next[lace]], y: y0 + (row + 1) * dy },
          palette[lace % palette.length],
          row === 0 ? { width: 46 } : { width: 46, parentId: id(lace, row - 1), parentSide: 1 },
        ),
      );
    }
    for (let lace = 0; lace < count; lace++) at[lace] = next[lace];
  }
  return { name, strands, masks };
}

// 6) A diagonal basket — the woven mat turned 45°, so the laces run corner to
//    corner. Same checkerboard of over/unders, a noticeably different fabric.
function diagonalWeave(): Scene3D {
  const strands: Strand3D[] = [];
  const masks: MaskLink[] = [];
  const n = 5;
  const step = 62;
  const reach = 210;
  const cx = 400;
  const cy = 280;
  for (let i = 0; i < n; i++) {
    // Spread each family ACROSS its own direction, not along it.
    const d = ((i - (n - 1) / 2) * step) / Math.SQRT2;
    // One family runs down-right; its spacing runs down-left, and vice versa.
    strands.push(
      mk(`a${i}`, { x: cx + d - reach, y: cy - d - reach }, { x: cx + d + reach, y: cy - d + reach },
        i % 2 ? ORANGE : YELLOW, { width: 46 }),
    );
    strands.push(
      mk(`b${i}`, { x: cx + d + reach, y: cy + d - reach }, { x: cx + d - reach, y: cy + d + reach },
        i % 2 ? WHITE : TEAL, { width: 46 }),
    );
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      masks.push((i + j) % 2 === 0 ? { overId: `a${i}`, underId: `b${j}` } : { overId: `b${j}`, underId: `a${i}` });
    }
  }
  return { name: 'Diagonal basket', strands, masks };
}

export const SAMPLES: Record<string, () => Scene3D> = {
  'two-crossing': twoCrossing,
  'box-stitch': boxStitch,
  'braid-3': () => flatBraid(3, 7, 'Three-strand braid'),
  'braid-4': () => flatBraid(4, 7, 'Four-strand flat braid'),
  'diagonal': diagonalWeave,
  'woven-mat': wovenMat,
  'curved-stack': curvedStack,
};

export const SAMPLE_LABELS: Array<{ key: string; label: string }> = [
  { key: 'two-crossing', label: 'Two crossing strands' },
  { key: 'box-stitch', label: 'Box stitch — starting stitch' },
  { key: 'braid-3', label: 'Three-strand braid' },
  { key: 'braid-4', label: 'Four-strand flat braid' },
  { key: 'diagonal', label: 'Diagonal basket' },
  { key: 'woven-mat', label: 'Woven mat' },
  { key: 'curved-stack', label: 'Curved ribbon weave' },
];

export function makeSample(key: string): Scene3D {
  return (SAMPLES[key] ?? twoCrossing)();
}
