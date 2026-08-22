// Built-in demo scenes. Coordinates are in the same pixel space OpenStrand
// Studio uses (roughly a 800x500 region), so these sit naturally alongside
// imported .json files. Palette echoes the yellow/orange/white plastic-lacing
// lanyards that inspired the 3D treatment.

import { MaskLink, Point, RGBA, Scene3D, Strand3D } from './types';
import { BOX_COLUMN_SAMPLES, BOX_LABELS, BOX_SAMPLES } from './boxmn';
import { PLACED_LABELS, PLACED_SAMPLES } from './placedScenes';
import { SWIRL_LABELS, SWIRL_SAMPLES } from './swirl';
import { TWOFAN_COLUMN_SAMPLES, TWOFAN_LABELS, TWOFAN_SAMPLES } from './twofan';

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

// 3) The woven mat again, but with every lace BOWED instead of ruled straight —
//    a soft basket. It is the one sample that puts both halves of the port under
//    load at once: the centerline comes from OSS's eased two-segment curve
//    (bezier.ts), and the over/unders come from a checkerboard of masks, so a
//    ribbon has to lift and dip while it is already bending. Straight laces can
//    hide a curve bug and a single crossing can hide a weave bug; this hides
//    neither.
//
//    Each lace carries its control points at a fixed offset either side of the
//    middle, which is what gives every one the same gentle S and keeps the fabric
//    reading as a weave rather than a tangle.
function curvedStack(): Scene3D {
  const strands: Strand3D[] = [];
  const masks: MaskLink[] = [];
  const n = 3;
  const w = 50;
  const BOW = 72; // how far the control points sit off the lace's own line
  const ys = [165, 270, 375];
  const xs = [250, 400, 550];

  for (let i = 0; i < n; i++) {
    const y = ys[i];
    strands.push(
      mk(`h${i}`, { x: 130, y }, { x: 670, y }, i % 2 ? ORANGE : YELLOW, {
        width: w,
        cp1: { x: 285, y: y - BOW },
        cp2: { x: 515, y: y + BOW },
      }),
    );
  }
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    strands.push(
      mk(`v${i}`, { x, y: 110 }, { x, y: 430 }, i % 2 ? WHITE : TEAL, {
        width: w,
        cp1: { x: x + BOW, y: 190 },
        cp2: { x: x - BOW, y: 350 },
      }),
    );
  }
  // Same checkerboard as the straight mat: at crossing (row i, col j) the
  // horizontal rides over when i+j is even, otherwise the vertical does.
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      masks.push((i + j) % 2 === 0 ? { overId: `h${i}`, underId: `v${j}` } : { overId: `v${j}`, underId: `h${i}` });
    }
  }
  return { name: 'Curved ribbon weave', masks, levelBreaks: [], strands };
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
//     the same four moves give you the round (spiral) stitch instead, which is
//     what `spiral` asks for. Everything else about the two is identical: same
//     square, same four folds, same one mask a round, same strand and junction
//     counts. What the reversal changes is the column's PERIOD: reversing makes
//     the over/unders repeat every two rounds, and not reversing makes them
//     repeat every one.
//
//     What neither one does is turn. An arm keeps to its own edge of the square
//     for every round, so both columns rise straight; a real round stitch
//     corkscrews because the whole square rotates a little each round, and that
//     rotation is not modelled here. The ordering that causes it is.
//
//     WEAVE. Within a round the fold order already tells the truth at three of
//     the four corners: each arm was laid on top of the one before it, so with
//     folds x, y, z, w it gives y over x, z over y, w over z. The fourth corner is
//     the move that locks the stitch — w tucks back UNDER x, closing the cycle —
//     and that one contradicts the stacking, so it takes exactly ONE mask per
//     round. Rounds don't interlock with each other at all; they rest on each
//     other, which is what the LEVEL BREAK between them says (levels.ts).
export function boxStitchRounds(rounds: number, name: string, spiral = false): Scene3D {
  const w = 54;
  const cx = 400;
  const cy = 268;
  const Q = 33; // half the woven square: how far each arm's run sits from the middle
  const E = 26; // how far the pinned middle runs past the square before an arm folds off it
  const TIP = 40; // a fold's overhang past the far corner
  const SPREAD = 14; // …give or take, over all the folds of one arm and one parity
  const SPLAY = 2; // …and never closer than this, or two folds read as one point
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
  //
  // The slots share a FIXED total spread rather than a fixed step, so adding
  // rounds packs them closer instead of widening the stitch — down to `SPLAY`
  // apart, which is as close as they can sit and still be told apart by the
  // one-pixel snap that decides what is glued to what (connections.ts).
  const evens = Math.ceil(rounds / 2);
  const odds = Math.floor(rounds / 2);
  const overhang = (n: number): number => {
    const slot = Math.floor(n / 2);
    const slots = n % 2 === 0 ? evens : odds;
    if (slots < 2) return TIP;
    const step = Math.max(SPLAY, SPREAD / (slots - 1));
    return TIP + (slot - (slots - 1) / 2) * step;
  };

  for (let round = 0; round < rounds; round++) {
    // The rotation around the square, reversed every other round — unless this
    // is the round stitch, which never turns back.
    const order = spiral || round % 2 === 0 ? [A, D, B, C] : [C, B, D, A];
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

// 4c) The TWIST stitch — three laces on a 2x1 face, and a column that TURNS as it
//     climbs. Unlike every other sample here, this one is not an idealised
//     diagram: it is a scene built BY HAND in the app, carried on upward.
//
//     THE FACE. Seen from above, a stitch is one flat woven face: four arms lying
//     side by side across it (the warp — two gold, two teal) and two arms lying
//     through it (the weft — both orange), so every stitch is 4 x 2 = eight
//     crossings and warp never crosses warp. Four arms one way and two the other
//     is what makes the face twice as long as it is deep, which is the 2x1 the
//     starting stitch is named for; the box stitch is the 1x1 case.
//
//     THE WEAVE. A weft arm crosses all four warp arms in a row and goes OVER,
//     under, OVER, under along the way; the other weft arm runs the other
//     direction and lands on the opposite phase. Plain weave. The layer order
//     already has half of it right — every warp arm is laid above both weft arms —
//     so it takes exactly FOUR masks a stitch.
//
//     THE TWIST, AND WHY THIS SAMPLE IS GROWN RATHER THAN DRAWN. Level n+1 is
//     level n turned by TURN about C, slot for slot, which in ids is simply
//     "+2": `1_8` is `1_6` turned, `3_9` is `3_7` turned. Everything else follows
//     — a fold hangs off its lace's OTHER arm one level down, so an arm reverses
//     AND swings by TURN each time, and the masks repeat by slot.
//
//     Turning the hand-built stitch, rather than re-deriving it, is the whole
//     point. An idealised version reaches every fold the same distance and the
//     column comes out a smooth cylinder; a real one does not. In `START` below
//     the six folds of a stitch run 461, 405, 211, 267, 303 and 272 units, and
//     rotation carries that unevenness up the column unchanged, which is what
//     makes the stack read as scoubidou instead of as a lathe part.
//
//     WORKING A STITCH EATS THE TAIL. The top stitch's six ends are loose tails,
//     drawn long. Work another stitch on top and those ends stop being tails:
//     they become the junctions the new folds hang off, and they pull in to
//     `turn(the ends one level further down)`. `grow` does exactly that before
//     laying the new level, which is why the last level of any twist count is the
//     only one with long ends.
//
//     TURN is 26°, measured: fitting each of the hand-built scene's two twists as
//     a rigid turn of the starting stitch's eight crossing points gives 24.6° and
//     26.0°. C is the mean of its three levels' crossing centroids. Its own drift
//     of about (-9, -2) a level is NOT carried up — that is freehand wobble, and
//     keeping it would lean the column by most of a lace width over ten stitches.
function twistStitch(twists: number, name: string): Scene3D {
  const TURN = (26 * Math.PI) / 180;
  const C: Point = { x: 474.5, y: 304.0 };

  // The hand-built scene: a 2x1 starting stitch with two twist stitches on it,
  // in the app's own layer order. [id, start, end, parent, side].
  type Row = [string, number, number, number, number, string | null, 0 | 1 | null];
  const START: Row[] = [
    ['1_1', 354.66, 329.14, 620.41, 287.83, null, null],
    ['2_1', 399.99, 222.79, 457.00, 392.74, null, null],
    ['3_1', 511.38, 231.06, 566.90, 386.61, null, null],
    ['1_2', 620.41, 287.83, 325.36, 268.39, '1_1', 1],
    ['1_3', 354.66, 329.14, 624.97, 341.70, '1_1', 0],
    ['3_2', 566.90, 386.61, 550.50, 238.00, '3_1', 1],
    ['3_3', 511.38, 231.06, 537.98, 416.32, '3_1', 0],
    ['2_2', 399.99, 222.79, 406.99, 378.45, '2_1', 0],
    ['2_3', 457.00, 392.74, 420.50, 197.19, '2_1', 1],
    ['1_4', 624.97, 341.70, 343.12, 200.03, '1_3', 1],
    ['1_5', 325.36, 268.39, 585.67, 393.74, '1_2', 1],
    ['3_4', 537.98, 416.32, 582.42, 274.29, '3_3', 1],
    ['3_5', 550.50, 238.00, 455.80, 403.33, '3_2', 1],
    ['2_4', 406.99, 378.45, 498.78, 187.05, '2_2', 1],
    ['2_5', 420.50, 197.19, 348.98, 335.31, '2_3', 1],
    ['1_6', 585.67, 393.74, 284.69, 44.17, '1_5', 1],
    ['1_7', 343.12, 200.03, 602.19, 511.53, '1_4', 1],
    ['3_6', 455.80, 403.33, 640.56, 301.14, '3_5', 1],
    ['3_7', 582.42, 274.29, 347.25, 400.86, '3_4', 1],
    ['2_6', 348.98, 335.31, 616.41, 193.01, '2_5', 1],
    ['2_7', 498.78, 187.05, 255.17, 308.30, '2_4', 1],
  ];
  // Its four masks a stitch, by slot: each weft arm rides over the first and third
  // warp arm it meets and the layer order has it under the second and fourth.
  const STARTMASKS: Array<[string, string]> = [
    ['1_2', '3_2'], ['1_2', '2_3'], ['1_3', '2_2'], ['1_3', '3_3'],
    ['1_4', '3_4'], ['1_4', '2_4'], ['1_5', '2_5'], ['1_5', '3_5'],
    ['1_6', '3_6'], ['1_6', '2_6'], ['1_7', '2_7'], ['1_7', '3_7'],
  ];
  const LACE: Record<string, { color: RGBA; width: number }> = {
    '1': { color: ORANGE, width: 54 },
    '2': { color: YELLOW, width: 54 },
    '3': { color: TEAL, width: 46 },
  };

  const turn = (p: Point): Point => {
    const c = Math.cos(TURN);
    const s = Math.sin(TURN);
    const x = p.x - C.x;
    const y = p.y - C.y;
    return { x: C.x + x * c - y * s, y: C.y + x * s + y * c };
  };

  const strands: Strand3D[] = START.map(([id, sx, sy, ex, ey, parentId, parentSide]) => {
    const set = LACE[id[0]];
    return mk(id, { x: sx, y: sy }, { x: ex, y: ey }, set.color, {
      width: set.width,
      parentId: parentId ?? undefined,
      parentSide: parentSide ?? undefined,
    });
  });
  const masks: MaskLink[] = STARTMASKS.map(([overId, underId]) => ({ overId, underId }));
  const levelBreaks: number[] = [9, 15];

  // One more stitch: turn the top one, and pull the ends it was resting on in.
  const grow = (): void => {
    const top = strands.slice(-6); // laid in slot order: V0 V1 W0 W1 W2 W3
    const below = strands.slice(-12, -6); // the same six slots, one level down
    const laid = top.map((s, i) => {
      // the arm this fold continues is its lace's OTHER arm on the top level
      const sibling = top[i % 2 ? i - 1 : i + 1];
      const [lace, n] = s.id.split('_');
      return mk(`${lace}_${Number(n) + 2}`, turn(s.start), turn(s.end), s.color, {
        width: s.width,
        parentId: sibling.id,
        parentSide: 1,
      });
    });
    // The top stitch is worked now, not loose: its tails become the junctions the
    // new folds hang off, which is exactly where turning the level below puts them.
    top.forEach((s, i) => {
      s.end = turn(below[i].end);
    });
    levelBreaks.push(strands.length);
    strands.push(...laid);
    const [v0, v1, w0, w1, w2, w3] = laid;
    masks.push(
      { overId: v0.id, underId: w0.id },
      { overId: v0.id, underId: w2.id },
      { overId: v1.id, underId: w3.id },
      { overId: v1.id, underId: w1.id },
    );
  };

  for (let n = 2; n < twists; n++) grow();

  return { name, strands, masks, levelBreaks };
}


// 4d) The twist stitch for ANY m x n face, built from the law rather than from a
//     hand-built scene — see docs/twist-stitch/deriving-the-turn.md.
//
//     An m x n stitch is a column whose woven face is an m-by-n rectangle of
//     cells, so it has 2(m+n) arms round its perimeter: 2m WARP arms side by side
//     across the face, 2n WEFT arms through it, m+n laces, 4mn crossings and 2mn
//     masks a level. `twistStitch` above is the 2x1 case, carried up from a scene
//     built by hand; this one derives every number instead.
//
//     THE LAW. An arm must lie ALONG its own line, and its near end is the tip its
//     lace left behind one level down — a point placed in the PREVIOUS frame. So
//     the tip a fold leaves has to land on the line its lace folds onto next.
//     Turning by TURN takes an offset `o` and an along-coordinate `x` to
//     `o·cos ± x·sin`; setting that equal to the sibling line's offset and solving
//     leaves one answer. Its magnitude is the reach, and its SIGN is the direction
//     the arm travels — an arm has no freedom about which way it runs.
//
//     THE TURN. What is left is how far each fold is pulled through, and the bound
//     it cannot escape is that an arm must cross the band it is woven through.
//     Taking that as an equality gives the tightest stitch: with the laces laid
//     snug, tan(TURN/2) = 1 / (M + sqrt(M² + 2(N−1))) for M and N the longer and
//     shorter side. It collapses to 1/(2m) for an m x 1 and to 1/2 — 53.13°, the
//     box stitch — for the 1x1, and it says the turn is set mostly by the LONGER
//     side: 3x1, 3x2 and 3x3 all turn about eighteen degrees.
//
//     THE WEAVE is the one thing the geometry does NOT fix: a face is a grid, so
//     over-under-over-under can start either way and the complement of a plain
//     weave is another plain weave. The hand-built 2x1 pins it — read by position,
//     its outermost weft line goes UNDER the outermost warp line — so a weft line
//     rides over the warp lines of OPPOSITE parity, counting both from outside in.
export function twistStitchMN(m: number, n: number, twists: number, name: string): Scene3D {
  const w = 54;
  const G = w; // across the face: the gap between neighbouring warp lines
  const V = w; // through it: the gap between neighbouring weft lines
  const cx = 400;
  const cy = 300;

  // THE TURN. Over the run of the face, a fold migrates exactly one lace width:
  // one width sideways for max(m,n) widths of travel. Everything else here is
  // solved; this is the one statement about the craft, and it is measured, not
  // fitted — it is the only form that hits BOTH angles anyone has actually built:
  // 45.00° for a 1×1 and 26.57° against the hand-built 2×1's 26°. (The earlier
  // snug-limit form missed both, at 53.13° and 28.07°, by solving a stricter
  // version of the same idea — see docs/twist-stitch/attempts/2026-07-snug-turn.)
  const TURN = Math.atan(1 / Math.max(m, n));
  const c = Math.cos(TURN);
  const s = Math.sin(TURN);

  // A slot is one of the 2(m+n) lines an arm can lie on: `off` is how far it sits
  // from the middle across its own direction, and `dir` which way along it the arm
  // travels — solved below, never chosen.
  interface Slot {
    warp: boolean;
    off: number;
    dir: number;
  }
  const slots: Slot[] = [];
  for (let i = 0; i < 2 * n; i++) slots.push({ warp: false, off: (n - 0.5 - i) * V, dir: 0 });
  for (let j = 0; j < 2 * m; j++) slots.push({ warp: true, off: (m - 0.5 - j) * G, dir: 0 });
  const NW = 2 * n; // where the warp slots start — the layer order is weft, then warp

  // Each lace owns an ADJACENT pair of lines in its own family, so a fold always
  // migrates by exactly one gap whatever m and n are.
  const sib: number[] = [];
  const laces: Array<{ set: number; pair: [number, number] }> = [];
  for (let p = 0; p < n; p++) laces.push({ set: 1 + p, pair: [2 * p, 2 * p + 1] });
  for (let p = 0; p < m; p++) laces.push({ set: 1 + n + p, pair: [NW + 2 * p, NW + 2 * p + 1] });
  for (const l of laces) {
    sib[l.pair[0]] = l.pair[1];
    sib[l.pair[1]] = l.pair[0];
  }
  const laceOf: number[] = [];
  for (const l of laces) for (const k of l.pair) laceOf[k] = l.set;

  // A point on slot `k`'s line, `along` out from the middle, before the level turn.
  const on = (k: number, along: number): Point => {
    const sl = slots[k];
    return sl.warp ? { x: cx + sl.off, y: cy + along } : { x: cx + along, y: cy + sl.off };
  };
  /** Half the band this arm has to cross, plus half a width to clear its far edge. */
  const band = (k: number): number => (slots[k].warp ? (n - 0.5) * V : (m - 0.5) * G) + w / 2;
  /** The law: the one length that lands this tip on its sibling's line one level up. */
  const solved = (k: number): number =>
    (slots[sib[k]].off - slots[k].off * c) / ((slots[k].warp ? 1 : -1) * s);

  const reach: number[] = slots.map((_, k) => solved(k));
  slots.forEach((sl, k) => {
    sl.dir = reach[k] >= 0 ? 1 : -1;
    reach[k] = Math.abs(reach[k]);
  });
  // How far the pinned run pokes past the face before its loop turns back. This is
  // a CLEARANCE, not a length that scales with the face: the loop of a snug stitch
  // sits half a width clear of the band it turns around whatever m and n are. The
  // hand-built 2×1 measures 133 across / 81 through against 135 / 81 for w/2.
  const E = w / 2;
  const TAIL = 1.5 * Math.max(...reach); // the top stitch is never folded again

  const turned = (p: Point, level: number): Point => {
    const t = TURN * level;
    const cc = Math.cos(t);
    const ss = Math.sin(t);
    const x = p.x - cx;
    const y = p.y - cy;
    return { x: cx + x * cc - y * ss, y: cy + x * ss + y * cc };
  };
  const tip = (k: number, level: number, along: number): Point =>
    turned(on(k, slots[k].dir * along), level);
  const entry = (k: number): Point => on(k, -slots[k].dir * (band(k) + E));

  const PALETTE: RGBA[] = [
    ORANGE, YELLOW, TEAL, WHITE,
    { r: 210, g: 90, b: 110, a: 255 },
    { r: 140, g: 160, b: 210, a: 255 },
    { r: 150, g: 195, b: 120, a: 255 },
    { r: 190, g: 140, b: 200, a: 255 },
  ];
  const colour = (set: number): RGBA => PALETTE[(set - 1) % PALETTE.length];

  const strands: Strand3D[] = [];
  const masks: MaskLink[] = [];
  const levelBreaks: number[] = [];
  const nextId: Record<number, number> = {};

  // The laces pinned across each other, each running from one of its lines' entry
  // points to the other's — the slant that offsets its two arms from each other.
  for (const l of laces) {
    nextId[l.set] = 1;
    strands.push(mk(`${l.set}_1`, entry(l.pair[1]), entry(l.pair[0]), colour(l.set), { width: w }));
  }

  interface Arm {
    at: Point;
    last: string;
    side: 0 | 1;
  }
  const arm: Arm[] = [];
  for (const l of laces) {
    arm[l.pair[0]] = { at: entry(l.pair[0]), last: `${l.set}_1`, side: 1 };
    arm[l.pair[1]] = { at: entry(l.pair[1]), last: `${l.set}_1`, side: 0 };
  }

  for (let level = 0; level <= twists; level++) {
    if (level > 0) levelBreaks.push(strands.length);
    const laid: string[] = [];
    for (let k = 0; k < slots.length; k++) {
      const set = laceOf[k];
      const a = arm[k];
      const along = level === twists ? band(k) + TAIL : reach[k];
      const end = tip(k, level, along);
      const id = `${set}_${++nextId[set]}`;
      strands.push(mk(id, { ...a.at }, end, colour(set), { width: w, parentId: a.last, parentSide: a.side }));
      laid[k] = id;
      a.at = end;
      a.last = id;
      a.side = 1;
    }
    for (let i = 0; i < NW; i++) {
      for (let j = NW; j < slots.length; j++) {
        if (i % 2 !== (j - NW) % 2) masks.push({ overId: laid[i], underId: laid[j] });
      }
    }
    for (const l of laces) {
      const t = arm[l.pair[0]];
      arm[l.pair[0]] = arm[l.pair[1]];
      arm[l.pair[1]] = t;
    }
  }

  return { name, strands, masks, levelBreaks };
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

/**
 * The whole m x n twist family, generated. Every shape from 1x1 to `TWIST_MAX`
 * squared is a real sample you can open — `twist-3x2-10` and the rest — but they
 * do NOT all go in the dropdown, which would be unusable at 64 entries. The
 * browser (Browse… in the Scene panel) lists them as a grid instead, and
 * `SAMPLE_LABELS` keeps only the handful worth naming.
 */
export const TWIST_MAX = 8;
export interface TwistShape {
  key: string;
  m: number;
  n: number;
  /** The turn the law gives this face, in degrees — what the grid quotes. */
  turn: number;
  /**
   * How far the loosest arm hangs past the band it crosses, in lace widths.
   *
   * The 64 are NOT 64 equally good stitches and the grid should not pretend they
   * are. One turn has to serve two families whose bands are m and n widths deep,
   * so the family crossing the shallower one is left with arm it does not need —
   * about `|m − n|` widths of it, free air. On the diagonal it is under a width;
   * at 1×8 it is seven, and only a fifth of each of those arms is inside the
   * weave at all. Nothing is broken there — every crossing is real — but the
   * thing has stopped being a woven column and become ribbons round a spine.
   */
  slack: number;
  /**
   * How much more binding one lace does than another: `max(m,n)/min(m,n)`. A
   * lace of the smaller family is in `4·max` crossings a level, one of the
   * larger in `4·min`. At 1×6 the single lace is in ALL 24 of them, so the
   * stitch hangs off one piece of plastic.
   */
  load: number;
}
export const TWIST_FAMILY: TwistShape[] = (() => {
  const out: TwistShape[] = [];
  const w = 54;
  for (let m = 1; m <= TWIST_MAX; m++) {
    for (let n = 1; n <= TWIST_MAX; n++) {
      const t = Math.atan(1 / Math.max(m, n));
      const c = Math.cos(t);
      const s = Math.sin(t);
      // the loosest arm of either family, measured against the band it crosses
      let slack = 0;
      for (const warp of [false, true]) {
        const cnt = warp ? m : n;
        const band = (warp ? n : m) * w;
        for (let i = 0; i < 2 * cnt; i++) {
          const off = (cnt - 0.5 - i) * w;
          const sib = ((cnt - 0.5 - (i % 2 === 0 ? i + 1 : i - 1)) * w);
          const reach = Math.abs((sib - off * c) / ((warp ? 1 : -1) * s));
          slack = Math.max(slack, (reach - band) / w);
        }
      }
      out.push({
        key: `twist-${m}x${n}-10`,
        m,
        n,
        turn: (t * 180) / Math.PI,
        slack,
        load: Math.max(m, n) / Math.min(m, n),
      });
    }
  }
  return out;
})();

const FAMILY_SAMPLES: Record<string, () => Scene3D> = Object.fromEntries(
  TWIST_FAMILY.map((s) => [s.key, () => twistStitchMN(s.m, s.n, 10, `Twist stitch — ${s.m}×${s.n}, 10 twists`)]),
);

export const SAMPLES: Record<string, () => Scene3D> = {
  ...FAMILY_SAMPLES,
  ...TWOFAN_SAMPLES,
  ...TWOFAN_COLUMN_SAMPLES,
  ...SWIRL_SAMPLES,
  ...BOX_SAMPLES,
  ...BOX_COLUMN_SAMPLES,
  ...PLACED_SAMPLES,
  'two-crossing': twoCrossing,
  'box-stitch': boxStitch,
  'box-stitch-10': () => boxStitchRounds(10, 'Box stitch — 10 levels'),
  'box-stitch-15': () => boxStitchRounds(15, 'Box stitch — 15 levels'),
  'round-stitch-10': () => boxStitchRounds(10, 'Round stitch — 10 levels', true),
  'twist-stitch-10': () => twistStitch(10, 'Twist stitch — 10 twists'),
  'braid-3': () => flatBraid(3, 7, 'Three-strand braid'),
  'braid-4': () => flatBraid(4, 7, 'Four-strand flat braid'),
  'diagonal': diagonalWeave,
  'woven-mat': wovenMat,
  'curved-stack': curvedStack,
};

/**
 * What the dropdown and the project site list, in order, with the group each sits in.
 *
 * FOUR STITCHES ARE DELIBERATELY ABSENT, on the same terms as
 * `SHOW_ORIGINAL_TWIST_FAMILY` in panel.ts: nothing is deleted, the generators
 * still run and `?sample=` still opens every one of them — they are only off the
 * list. They are `round-stitch-10`, `twist-stitch-10`, `twist-3x1-10` and
 * `twist-2x2-10`.
 *
 * The three twists go because the browser's grid already has that face, built to
 * the 1xn reference (twofan.ts) rather than to the single-turn law — and where
 * the two disagree it is the reference that is right, which is why the grid the
 * browser shows is the two-fan one. Listing the older build of a face beside the
 * grid offers a choice between them that isn't a real choice.
 *
 * The round stitch goes because it is not one. `boxStitchRounds(…, spiral)` gets
 * the ORDERING right — the rotation never reverses, so the column repeats every
 * round instead of every two — but a real round stitch also corkscrews, and this
 * one does not: the square never turns, so the column rises straight (see the
 * ORDER note on `boxStitchRounds`). What actually turns is the twist family, and
 * that is where anyone looking for a turning column should land.
 */
export const SAMPLE_LABELS: Array<{ key: string; label: string; group: string }> = [
  { key: 'two-crossing', label: 'Two crossing strands', group: 'Basics' },
  { key: 'box-stitch', label: 'Box stitch — starting stitch', group: 'Stitches' },
  { key: 'box-stitch-10', label: 'Box stitch — 10 levels', group: 'Stitches' },
  { key: 'box-stitch-15', label: 'Box stitch — 15 levels', group: 'Stitches' },
  { key: 'braid-3', label: 'Three-strand braid', group: 'Braids' },
  { key: 'braid-4', label: 'Four-strand flat braid', group: 'Braids' },
  { key: 'diagonal', label: 'Diagonal basket', group: 'Weaves' },
  { key: 'woven-mat', label: 'Woven mat', group: 'Weaves' },
  { key: 'curved-stack', label: 'Curved ribbon weave', group: 'Weaves' },
  // The 1xn reference's stitch, alongside the single-turn one rather than replacing
  // it: two fans, two angles. See docs/twist-stitch/attempts/1xn-reference/.
  ...TWOFAN_LABELS,
  // The same starting stitch at k = 0, closed rather than twisted. Only the eight
  // square faces are named; the browser grid has all 64. See docs/box-stitch-mxn/.
  ...SWIRL_LABELS,
  ...BOX_LABELS,
  // Not generators but records: a ring somebody placed round by round and a
  // column somebody worked storey by storey, storeys and all. See
  // placedScenes.ts.
  ...PLACED_LABELS,
];

export function makeSample(key: string): Scene3D {
  return (SAMPLES[key] ?? twoCrossing)();
}
