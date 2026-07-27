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
function boxStitchRounds(rounds: number, name: string, spiral = false): Scene3D {
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

// 4c) The TWIST stitch, worked on a 2x1 starting stitch — three laces instead of
//     the box stitch's two, and a column that TURNS as it climbs.
//
//     THE FACE. Seen from above, a stitch is one flat woven face: four arms lying
//     side by side across it (the warp — two from the gold lace, two from the
//     teal) and two arms lying through it (the weft — both from the orange lace),
//     so every stitch is 4 x 2 = eight crossings. Four arms one way and two the
//     other is what makes the face twice as long as it is deep, which is the 2x1
//     the starting stitch is named for: the box stitch is the 1x1 case, four arms
//     round a square.
//
//     THE WEAVE. A weft arm crosses all four warp arms in a row and goes OVER,
//     under, OVER, under along the way; the other weft arm runs the other
//     direction and so lands on the opposite phase. That is plain weave, and it
//     comes out as exactly FOUR masks a stitch — the other four crossings the
//     layer order already has right, since every warp arm is laid above both weft
//     arms.
//
//     THE TWIST. Each arm folds back across the face, and the face it folds onto
//     is the same face TURNED by `TURN`. That is the whole stitch: nothing about
//     the weave changes from one level to the next, the frame it is woven in just
//     keeps rotating, and ten stitches wind the column round most of a full turn.
//     A fold lands in its lace's OTHER slot — the two arms of a lace trade places
//     every level, which is why an arm's direction reverses AND swings by `TURN`
//     each time.
//
//     HOW FAR A FOLD REACHES is not a free choice, and this is the one thing the
//     stitch will not forgive. A fold starts at the tip the arm left behind one
//     level down, in the PREVIOUS frame — so unless that tip was dropped exactly
//     on the line the arm is about to fold along, the arm starts off its own line
//     and lies at an angle to the three arms beside it. Every reach here is
//     therefore SOLVED, not picked: `reach()` returns the one length that lands a
//     tip on its own successor's line. Get it right and all four warp arms of a
//     level are exactly parallel, both weft arms are exactly parallel, and the
//     face stays a rigid rectangle all the way up; get it wrong by a little and
//     the arms fan by a few degrees a level. It also explains why an arm's two
//     folds are not the same length: crossing the face outward and inward against
//     the same turn are different distances (105 and 135 at these settings).
//
//     WHY THE TURN IS 28° AND NOT 26°. Solved reaches put every warp tip on ONE
//     circle round the column and every weft tip on another — a tidy envelope, and
//     a hazard, because junction detection (connections.ts) glues endpoints purely
//     by coincidence in the drawing plane and cannot see the storeys that really
//     keep two tips apart. On one circle, two tips five levels apart can land on
//     the same spot and fuse four strand-ends into a fork. Fitting each hand-built
//     twist as a rigid turn of the starting stitch's eight crossings gives 24.6°
//     and 26.0°; at 26° exactly, tips five levels apart land 0.8 units apart and
//     the column breaks into pieces. 28° is the nearest turn that keeps every pair
//     of distinct tips ~5 units apart over ten twists, and it sits inside the band
//     the hand-built scene actually measures (its warp arms fit 32-37°, its weft
//     arms 23°; freehand, the two disagree). `twistStitch(2, …)` reproduces that
//     scene fold for fold and mask for mask, on a tidied-up version of it.
function twistStitch(twists: number, name: string): Scene3D {
  const w = 54;
  const cx = 400;
  const cy = 270;
  const G = 60; // across the face: the gap between neighbouring warp lines
  const V = 70; // through the face: the gap between the two weft lines
  const E = 44; // how far a pinned run pokes past the far edge before its arm folds off it
  const TAIL = 130; // the top stitch is never folded again — its six ends are the loose tails
  const TURN = (28 * Math.PI) / 180; // how far the whole face turns from one level to the next

  const COS = Math.cos(TURN);
  const SIN = Math.sin(TURN);
  const ACROSS = 1.5 * G; // half the woven face, across it (the outer warp lines)
  const THROUGH = V / 2; //  half the woven face, through it (the two weft lines)

  // A point given in the stitch's OWN frame at level `n`: `a` measured across the
  // face — the way the weft arms run — and `b` through it. The frame turns by
  // TURN a level, and that turn is the entire difference from the box stitch.
  const at = (n: number, a: number, b: number): Point => {
    const t = TURN * n;
    const c = Math.cos(t);
    const s = Math.sin(t);
    return { x: cx + a * c - b * s, y: cy + a * s + b * c };
  };

  // One of the six places an arm can lie in the face. An arm lying here runs ALONG
  // its own line and sits `off` to the side of the middle; `dir` is which way along
  // the line it travels, fixed for the slot, so an arm reverses simply by moving to
  // its lace's other slot. `band` is the half-width of the woven part it must clear.
  interface Slot {
    warp: boolean;
    off: number;
    dir: -1 | 1;
  }
  const slot = (warp: boolean, off: number, dir: -1 | 1): Slot => ({ warp, off, dir });
  const on = (s: Slot, n: number, along: number): Point =>
    (s.warp ? at(n, s.off, along) : at(n, along, s.off));
  const band = (s: Slot): number => (s.warp ? THROUGH : ACROSS);

  // How far the arm in `s` must reach for its tip to land exactly on `next`'s line
  // one level up — the fold's whole length, solved rather than chosen.
  //
  // A turn of TURN takes frame-n coordinates (a, b) to (a·cos + b·sin, −a·sin +
  // b·cos), so a slot's offset one level up is `off·cos ± along·sin`: plus for a
  // warp slot, whose offset is the `a` of the pair, minus for a weft slot, whose
  // offset is the `b`. Setting that equal to `next.off` and solving for `along`
  // leaves one length, and it is the only one that keeps the face rigid.
  const reach = (s: Slot, next: Slot): number =>
    (next.off - s.off * COS) / ((s.warp ? 1 : -1) * s.dir * SIN);
  /** Where the arm lying in this slot ends: on its own line, `along` out from the middle. */
  const tip = (s: Slot, n: number, along: number): Point => on(s, n, s.dir * along);
  /** Where the starting stitch's pinned run hands this slot its first arm. */
  const entry = (s: Slot): Point => on(s, 0, -s.dir * (band(s) + E));

  // The four warp slots in order across the face, then the two weft slots. Their
  // travel directions alternate, which is what puts the two weft arms on opposite
  // phases of the same plain weave.
  const W0 = slot(true, ACROSS, -1);
  const W1 = slot(true, 0.5 * G, 1);
  const W2 = slot(true, -0.5 * G, -1);
  const W3 = slot(true, -ACROSS, 1);
  const V0 = slot(false, -THROUGH, -1);
  const V1 = slot(false, THROUGH, 1);
  // Bottom of the layer stack first: both weft arms, then all four warp arms, so
  // that every crossing the masks DON'T name comes out warp-over-weft.
  const FACE = [V0, V1, W0, W1, W2, W3];

  // A lace: its pinned run across the middle and the two arms folded off its ends.
  // `arms[i]` is the arm currently lying in `slots[i]`, and every level the two
  // trade places — which is the fold.
  interface Arm {
    at: Point;
    last: string;
    side: 0 | 1;
  }
  interface Lace {
    set: number;
    color: RGBA;
    slots: [Slot, Slot];
    arms: [Arm, Arm];
    /** Which arm the starting stitch folded first — the hand-built scene's own order. */
    first: 0 | 1;
  }
  const lace = (set: number, color: RGBA, a: Slot, b: Slot, first: 0 | 1): Lace => ({
    set,
    color,
    slots: [a, b],
    arms: [
      { at: entry(a), last: `${set}_1`, side: 1 },
      { at: entry(b), last: `${set}_1`, side: 0 },
    ],
    first,
  });
  // The orange lace is the weft; the teal and gold ones are the warp, a pair of
  // neighbouring slots each. Listed in the order the starting stitch lays them.
  const LACES: Lace[] = [
    lace(1, ORANGE, V0, V1, 0),
    lace(3, TEAL, W0, W1, 0),
    lace(2, YELLOW, W2, W3, 1),
  ];

  const strands: Strand3D[] = [];
  const masks: MaskLink[] = [];
  const levelBreaks: number[] = [];
  const nextId: Record<number, number> = { 1: 1, 2: 1, 3: 1 };

  // The three laces pinned across each other, each running from one of its slots'
  // entries to the other's — the slant that offsets its two arms from each other.
  for (const l of [...LACES].sort((a, b) => a.set - b.set)) {
    strands.push(mk(`${l.set}_1`, entry(l.slots[1]), entry(l.slots[0]), l.color, { width: w }));
  }

  // Lay one arm in each of the six slots, weave the eight crossings, and hand each
  // arm on to its lace's other slot ready for the level above.
  const stitch = (level: number, order: Slot[]): void => {
    const holder = new Map<Slot, { lace: Lace; index: 0 | 1 }>();
    for (const l of LACES) {
      holder.set(l.slots[0], { lace: l, index: 0 });
      holder.set(l.slots[1], { lace: l, index: 1 });
    }
    const laid = new Map<Slot, string>();
    for (const s of order) {
      const { lace: l, index } = holder.get(s)!;
      const a = l.arms[index];
      // Every fold but the last reaches exactly as far as the fold above it needs
      // it to; the top one is never folded again, so it just runs out as a tail.
      const next = l.slots[index === 0 ? 1 : 0];
      const along = level === twists ? band(s) + TAIL : reach(s, next);
      const id = `${l.set}_${++nextId[l.set]}`;
      strands.push(
        mk(id, { ...a.at }, tip(s, level, along), l.color, {
          width: w,
          parentId: a.last,
          parentSide: a.side,
        }),
      );
      laid.set(s, id);
      a.at = tip(s, level, along);
      a.last = id;
      a.side = 1; // every later fold hangs off the END of the fold before it
    }
    // Plain weave, in the four places the layer order gets it wrong: each weft arm
    // rides over the first and third warp arm it meets, and the stacking already
    // has it under the second and fourth.
    masks.push({ overId: laid.get(V0)!, underId: laid.get(W0)! });
    masks.push({ overId: laid.get(V0)!, underId: laid.get(W2)! });
    masks.push({ overId: laid.get(V1)!, underId: laid.get(W3)! });
    masks.push({ overId: laid.get(V1)!, underId: laid.get(W1)! });
    // The arms swap slots: that swap IS the fold, and with the frame turned it is
    // also what makes an arm leave in a new direction rather than doubling back.
    for (const l of LACES) l.arms.reverse();
  };

  // The starting stitch. Its six arms fold off the pinned runs rather than off
  // each other, and one lace folded its second arm first when this was built by
  // hand, so the order is given per lace rather than straight down the face.
  stitch(0, LACES.flatMap((l) => (l.first === 0 ? l.slots : [l.slots[1], l.slots[0]])));
  for (let level = 1; level <= twists; level++) {
    levelBreaks.push(strands.length); // every twist rests one storey above the last
    stitch(level, FACE);
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

export const SAMPLES: Record<string, () => Scene3D> = {
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

export const SAMPLE_LABELS: Array<{ key: string; label: string }> = [
  { key: 'two-crossing', label: 'Two crossing strands' },
  { key: 'box-stitch', label: 'Box stitch — starting stitch' },
  { key: 'box-stitch-10', label: 'Box stitch — 10 levels' },
  { key: 'box-stitch-15', label: 'Box stitch — 15 levels' },
  { key: 'round-stitch-10', label: 'Round stitch — 10 levels' },
  { key: 'twist-stitch-10', label: 'Twist stitch — 10 twists' },
  { key: 'braid-3', label: 'Three-strand braid' },
  { key: 'braid-4', label: 'Four-strand flat braid' },
  { key: 'diagonal', label: 'Diagonal basket' },
  { key: 'woven-mat', label: 'Woven mat' },
  { key: 'curved-stack', label: 'Curved ribbon weave' },
];

export function makeSample(key: string): Scene3D {
  return (SAMPLES[key] ?? twoCrossing)();
}
