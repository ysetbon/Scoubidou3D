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
    // A sample that ships bent has already "moved its triangle", so it opens with
    // the full handle set rather than pretending to be untouched.
    triangleHasMoved: !!(opts.cp1 || opts.cp2),
    cp2Activated: !!opts.cp2,
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
    levelBreaks: [],
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
  return { name: 'Woven mat', strands, masks, levelBreaks: [] };
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
  return { name: 'Curved ribbon weave', masks: [], levelBreaks: [], strands };
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

  return { name: 'Box stitch — starting stitch', strands, masks, levelBreaks: [] };
}

// 4b) The box stitch, worked for as many ROUNDS as you like — the square lanyard
//     you actually end up with, a column of stitches instead of the first one.
//
//     The starting stitch above is round one. Every round after it is the same
//     four moves again: each arm folds back across the middle in turn, and the
//     four folds interlock in one flat square before the next round is laid on
//     top. So the whole thing is described by three rules, repeated:
//
//     GEOMETRY. Seen from above, every round is the SAME square. The four arms
//     run along its four edges — the two orange arms on the bottom and top, the
//     two gold ones on the left and right — so they cross at the square's four
//     corners, and a fold's far end pokes a little past the corner before turning
//     back. That overhang creeps outward by `GROW` a round at a time; nothing
//     needs it to, but two folds ending on exactly the same point would be read
//     as one junction by everything downstream (connections.ts glues by
//     coincidence), and a stitch that fans out by a hair is what a real one does
//     anyway.
//
//     ORDER. The four arms fold in a rotation around the square, and the rotation
//     REVERSES each round: A,D,B,C then C,B,D,A then A,D,B,C… That alternation is
//     what makes this the BOX stitch — keep turning the same way every round and
//     the same four moves give you the round (spiral) stitch instead.
//
//     WEAVE. Within a round the fold order already tells the truth at three of
//     the four corners: each arm was laid on top of the one before it, so with
//     folds x, y, z, w it gives y over x, z over y, w over z. The fourth corner is
//     the move that locks the stitch — w tucks back UNDER x, closing the cycle —
//     and that one contradicts the stacking, so it takes exactly ONE mask per
//     round. Rounds don't interlock with each other at all; they rest on each
//     other, which is what the LEVEL BREAK between them says (levels.ts).
function boxStitchRounds(rounds: number, name: string): Scene3D {
  const w = 54;
  const cx = 400;
  const cy = 268;
  const Q = 33; // half the woven square: how far each arm's run sits from the middle
  const E = 26; // how far the pinned middle runs past the square before an arm folds off it
  const TIP = 40; // a fold's overhang past the far corner
  const SPLAY = 3; // …give or take this much, so no two folds end on the same point
  const TAIL = 120; // the last round isn't folded again — its four ends are the loose tails

  // An arm: the line it lives on, and where along that line it folds. `base` is
  // the end of the pinned middle it hangs off; `u` is the way its FIRST fold
  // travels; distances are measured along `u` from `base`.
  interface Arm {
    key: string;
    set: 1 | 2;
    color: RGBA;
    base: Point;
    u: Point;
    count: number; // how many folds it has made so far
    at: Point; // its current free end
    last: string; // id of the strand its next fold hangs off
    side: 0 | 1; // which side of that strand
  }

  const bottom = cy + Q;
  const top = cy - Q;
  const left = cx - Q;
  const right = cx + Q;

  const arm = (key: string, set: 1 | 2, color: RGBA, base: Point, u: Point, last: string, side: 0 | 1): Arm => ({
    key, set, color, base, u, count: 0, at: { ...base }, last, side,
  });

  // The two laces, pinned across each other. Each runs corner to corner of the
  // square and out the far side by `E`, and its two ends are where its two arms
  // fold off — which is exactly the OSS shape: `1_1` with arms grown on both ends.
  const A = arm('A', 1, ORANGE, { x: left - E, y: bottom }, { x: 1, y: 0 }, '1_1', 0);
  const B = arm('B', 1, ORANGE, { x: right + E, y: top }, { x: -1, y: 0 }, '1_1', 1);
  const C = arm('C', 2, YELLOW, { x: left, y: top - E }, { x: 0, y: 1 }, '2_1', 0);
  const D = arm('D', 2, YELLOW, { x: right, y: bottom + E }, { x: 0, y: -1 }, '2_1', 1);

  const strands: Strand3D[] = [
    mk('1_1', { ...A.base }, { ...B.base }, ORANGE, { width: w }),
    mk('2_1', { ...C.base }, { ...D.base }, YELLOW, { width: w }),
  ];
  const masks: MaskLink[] = [];
  const levelBreaks: number[] = [];
  const nextId = { 1: 1, 2: 1 };

  // Where an arm's `n`th fold ends: past the far corner on the way out, past the
  // near one on the way back. The span between the two corners is `2Q`, and the
  // middle it folds off takes up `E` of the outward leg.
  const foldEnd = (a: Arm, n: number, over: number): Point => {
    const t = n % 2 === 0 ? E + 2 * Q + over : E - over;
    return { x: a.base.x + a.u.x * t, y: a.base.y + a.u.y * t };
  };

  // How far an arm's `n`th fold reaches past the corner.
  //
  // An arm goes out on its even folds and back on its odd ones, so it is only
  // the folds of the SAME parity that land near each other — and if two of them
  // landed on exactly the same point, everything downstream would read that
  // point as one junction and glue four strand-ends into a fork
  // (connections.ts glues by coincidence, and it cannot see the storeys that
  // actually keep them apart). So each same-parity fold gets its own slot, and
  // the slots are spread SYMMETRICALLY about `TIP`: the early rounds sit a hair
  // tighter, the late ones a hair looser, and the column stays the same width
  // all the way up. Spreading them in one direction instead — which is what this
  // did at first — fans the stitch out by nearly a lace width over ten rounds.
  const evens = Math.ceil(rounds / 2);
  const odds = Math.floor(rounds / 2);
  const overhang = (n: number): number => {
    const slot = Math.floor(n / 2);
    const slots = n % 2 === 0 ? evens : odds;
    return TIP + (slot - (slots - 1) / 2) * SPLAY;
  };

  for (let round = 0; round < rounds; round++) {
    // The rotation around the square, reversed every other round.
    const order = round % 2 === 0 ? [A, D, B, C] : [C, B, D, A];
    // Everything from this round up rests one storey higher than the last one.
    if (round > 0) levelBreaks.push(strands.length);

    const laid: string[] = [];
    for (const a of order) {
      const over = round === rounds - 1 ? TAIL : overhang(a.count);
      const end = foldEnd(a, a.count, over);
      const id = `${a.set}_${++nextId[a.set]}`;
      strands.push(
        mk(id, { ...a.at }, end, a.color, {
          width: w,
          parentId: a.last,
          parentSide: a.side,
        }),
      );
      laid.push(id);
      a.count++;
      a.at = end;
      a.last = id;
      a.side = 1; // every later fold hangs off the END of the fold before it
    }
    // The one crossing the stacking gets wrong: the last arm folded dives back
    // under the first, which is the move that closes the round.
    masks.push({ overId: laid[0], underId: laid[3] });
  }

  return { name, strands, masks, levelBreaks };
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
  return { name, strands, masks, levelBreaks: [] };
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
  return { name: 'Diagonal basket', strands, masks, levelBreaks: [] };
}

export const SAMPLES: Record<string, () => Scene3D> = {
  'two-crossing': twoCrossing,
  'box-stitch': boxStitch,
  'box-stitch-10': () => boxStitchRounds(10, 'Box stitch — 10 levels'),
  'braid-3': () => flatBraid(3, 7, 'Three-strand braid'),
  'braid-4': () => flatBraid(4, 7, 'Four-strand flat braid'),
  'diagonal': diagonalWeave,
  'woven-mat': wovenMat,
  'curved-stack': curvedStack,
};

export const SAMPLE_LABELS: Array<{ key: string; label: string }> = [
  { key: 'two-crossing', label: 'Two crossing strands' },
  { key: 'box-stitch', label: 'Box stitch — starting stitch' },
  { key: 'box-stitch-10', label: 'Box stitch — 10 levels' },
  { key: 'braid-3', label: 'Three-strand braid' },
  { key: 'braid-4', label: 'Four-strand flat braid' },
  { key: 'diagonal', label: 'Diagonal basket' },
  { key: 'woven-mat', label: 'Woven mat' },
  { key: 'curved-stack', label: 'Curved ribbon weave' },
];

export function makeSample(key: string): Scene3D {
  return (SAMPLES[key] ?? twoCrossing)();
}
