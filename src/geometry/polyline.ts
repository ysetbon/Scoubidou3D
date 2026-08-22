// Rounding the corners where one strand is glued to the next.
//
// A lace is swept by carrying a cross-section along its centreline, with the
// "across" axis taken perpendicular to the local heading. That works as long as
// the heading turns gradually. Where two strands meet at a sharp angle the
// concatenated centreline has a corner, and at a corner the heading changes in a
// single step: the perpendicular swings with it, so the cross-section pivots
// through most of a half-turn between one ring and the next and the ribbon comes
// out wrung — the flat face twisting edge-on and back.
//
// The fix is geometric rather than cosmetic. A real lace cannot turn a corner with
// no radius either — it bends through a bight. So we replace each corner with a
// short curve tangent to the runs on both sides. The heading then rotates over
// many samples instead of one and the cross-section follows it round.
//
// That works while the lace is BENDING. Past about 60° it is no longer bending but
// FOLDING, and a fold is a different thing entirely — see `foldsOf` at the foot of
// this file, and the turn that gets built there in geometry/fold.ts.

import { Vec3 } from './vec';

/** Corners gentler than this are left alone — a sampled curve is a polyline of
 *  very slight corners, and rounding those would soften the curve itself. */
const MIN_TURN = 0.35; // radians, ~20°

/** Sharper than this and the lace is not bending, it is FOLDING — see
 *  `foldsOf`. Well above anything a sampled curve produces. */
const FOLD_TURN = (60 * Math.PI) / 180;

// The corner is swept as a circular arc sampled at EQUAL ANGLES, so the heading
// advances by the same small amount at every step. Sampling by parameter instead
// (a Bezier, say) piles nearly all the rotation into one step at the apex of a
// sharp turn, which is the very thing that wrings the ribbon.
const STEP_ANGLE = (5 * Math.PI) / 180;
const MIN_ARC_STEPS = 6;

function turnAt(pts: Vec3[], i: number): number {
  const ax = pts[i].x - pts[i - 1].x;
  const ay = pts[i].y - pts[i - 1].y;
  const bx = pts[i + 1].x - pts[i].x;
  const by = pts[i + 1].y - pts[i].y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return 0;
  const dot = (ax * bx + ay * by) / (la * lb);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/** Cumulative in-plane length at each vertex. */
function arcOf(pts: Vec3[]): number[] {
  const cum = new Array<number>(pts.length);
  cum[0] = 0;
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return cum;
}

/** The point a given distance along the polyline (z carried along with it). */
function at(pts: Vec3[], cum: number[], s: number): Vec3 {
  if (s <= 0) return { ...pts[0] };
  const last = cum[cum.length - 1];
  if (s >= last) return { ...pts[pts.length - 1] };
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const span = cum[i] - cum[i - 1];
  const t = span > 1e-12 ? (s - cum[i - 1]) / span : 0;
  const a = pts[i - 1];
  const b = pts[i];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function unit(ax: number, ay: number): { x: number; y: number } {
  const l = Math.hypot(ax, ay);
  return l < 1e-12 ? { x: 1, y: 0 } : { x: ax / l, y: ay / l };
}

interface CornerPlan {
  index: number;
  s: number; // arc position of the corner
  turn: number; // deviation from straight, radians
  trim: number; // how far back along each run the arc starts
  radius: number;
}

/**
 * Replace sharp corners with circular arcs tangent to the runs on both sides.
 *
 * `targetRadius` is the bend we would like — half the lace width, so the inner
 * edge just avoids folding through itself. How much of it we get depends on the
 * corner: for a given trim distance T the tangent arc has radius
 * `T * tan((π - turn) / 2)`, which collapses as the turn approaches a full
 * reversal. So the trim needed for the target radius is computed per corner and
 * then clamped to the run actually available — sharper corners borrow more run,
 * and where there isn't enough the bend simply comes out tighter.
 *
 * A tight bend is the honest answer: a flat lace cannot turn 160° in-plane without
 * riding over itself, which is exactly what a real one does at a fold. What must
 * NOT happen is the heading jumping in one step, and that is what this prevents.
 */
export function roundCorners(pts: Vec3[], targetRadius: number): Vec3[] {
  if (pts.length < 3 || targetRadius <= 0) return pts;
  const cum = arcOf(pts);
  const total = cum[cum.length - 1];
  if (total <= 0) return pts;

  const corners: CornerPlan[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const turn = turnAt(pts, i);
    // Folds are left alone: they are creased, not bent (see `foldsOf`). Rounding
    // one would smear the crease into an arc the lace cannot physically make, and
    // would hide the fold from the sweep that knows how to build it.
    if (turn >= MIN_TURN && turn < FOLD_TURN) {
      corners.push({ index: i, s: cum[i], turn, trim: 0, radius: 0 });
    }
  }
  if (corners.length === 0) return pts;

  for (let c = 0; c < corners.length; c++) {
    const k = corners[c];
    // Run available on each side, shared with the neighbouring corner.
    const before = c === 0 ? k.s : (k.s - corners[c - 1].s) / 2;
    const after = c === corners.length - 1 ? total - k.s : (corners[c + 1].s - k.s) / 2;
    const halfAngle = Math.tan((Math.PI - k.turn) / 2); // large when nearly straight
    const wanted = targetRadius / Math.max(halfAngle, 1e-4);
    k.trim = Math.max(0, Math.min(wanted, before * 0.9, after * 0.9));
    k.radius = k.trim * halfAngle;
  }

  const out: Vec3[] = [];
  const push = (p: Vec3) => {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-7 && Math.abs(last.z - p.z) < 1e-7) return;
    out.push(p);
  };

  let cursor = 0; // arc position already emitted
  for (const k of corners) {
    if (k.trim <= 1e-6) continue;
    const sa = k.s - k.trim;
    const sb = k.s + k.trim;
    for (let i = 0; i < pts.length; i++) {
      if (cum[i] > cursor && cum[i] < sa) push(pts[i]);
    }
    const pa = at(pts, cum, sa);
    const pb = at(pts, cum, sb);
    push(pa);

    const din = unit(pts[k.index].x - pts[k.index - 1].x, pts[k.index].y - pts[k.index - 1].y);
    const dout = unit(pts[k.index + 1].x - pts[k.index].x, pts[k.index + 1].y - pts[k.index].y);
    const side = Math.sign(din.x * dout.y - din.y * dout.x) || 1; // which way it bends
    // Centre sits perpendicular to the incoming run, on the inside of the bend.
    const cx = pa.x + -din.y * side * k.radius;
    const cy = pa.y + din.x * side * k.radius;
    const a0 = Math.atan2(pa.y - cy, pa.x - cx);
    const sweep = k.turn * side;
    const steps = Math.max(MIN_ARC_STEPS, Math.ceil(k.turn / STEP_ANGLE));
    for (let n = 1; n < steps; n++) {
      const f = n / steps;
      const ang = a0 + sweep * f;
      push({
        x: cx + Math.cos(ang) * k.radius,
        y: cy + Math.sin(ang) * k.radius,
        z: pa.z + (pb.z - pa.z) * f,
      });
    }
    push(pb);
    cursor = sb;
  }
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] > cursor) push(pts[i]);
  }
  return out.length >= 2 ? out : pts;
}

// ---------------------------------------------------------------------------
// Folds
// ---------------------------------------------------------------------------
//
// A flat lace cannot turn a sharp corner the way a rope can. Bending 155° in its
// own plane would need the inner edge to shrink to nothing, and every attempt to
// draw it that way shows the strain: mitred to a point it throws a spike, cut off
// square it leaves a notch, swept round it pinches shut.
//
// A real lace does something else entirely — it FOLDS. Lay a paper strip down,
// bring it back on itself, and the strip creases along a straight line and comes
// away flat, full width, on the other side. Nothing bends and nothing narrows.
//
// So a fold is not a corner to be finished, it is a straight cut shared by two
// runs. The crease line bisects the two headings (reflecting one onto the other),
// and each run is cut off along it — one line, both cuts, so the two runs mate
// exactly. No gap to notch, no overlap to spike, and the lace keeps its full
// width straight through the fold.
//
// Crucially the lace is NOT severed there — but neither is the fold something a
// sweep can carry. The strip rolls a half turn about that crease, and rolling
// tilts its width clean out of horizontal, which the sweep's level ring frame
// cannot express. So a fold is where the centreline is CUT and a built turn
// spliced in (geometry/fold.ts). What this file supplies is where the cuts are
// and which way the two runs point through them.

/** The two runs meeting at a fold. */
export interface Fold {
  /** Index into the centreline of the vertex the lace folds at. */
  index: number;
  /** Unit headings of the runs arriving at and leaving the fold. */
  din: { x: number; y: number };
  dout: { x: number; y: number };
  /** Unit direction of the crease line itself, in the drawing plane: the
   *  bisector of the two headings, which reflects one onto the other. */
  crease: { x: number; y: number };
}

/**
 * Settle the height a lace steps through at each of its folds.
 *
 * A fold doubles the lace back over itself, so the two runs OVERLAP in the
 * drawing plane for a good way past the crease — a strip brought back on itself
 * at 155° covers the run it came off. Held at one height the two bodies pass
 * straight through each other, and the edge of one surfaces through the face of
 * the other as a lump. They have to be STACKED: exactly one thickness apart, the
 * returning run lying on the run it folded off.
 *
 * The weave, which knows nothing of folds, will often want much more than that —
 * the arm of a stitch can come in riding over everything and leave ducking under
 * everything, a drop of two thicknesses. Taking that literally turns the crease
 * into a cliff. So the step is capped at `stack` and the difference is eased back
 * into the runs on either side, over `reach` of in-plane length: the lace ramps to
 * the fold and ramps away from it, which is what it does in the hand.
 *
 * `stack` is how far apart the two runs are left AT the crease, and so it is also
 * the height of the face the fold turns on — the whole of what that turn shows.
 * One thickness is the two runs touching. A fold that also climbs a storey has a
 * storey's worth of step to place, and can carry more of it here rather than ramp
 * it away; see TURN_STACK in StrandScene.
 */
/**
 * Where a fold's crease is to be put, when something other than the incoming
 * heights decides. `mid` is the height of the crease itself; `half` is the
 * SIGNED half-step between the two runs, positive when the run leaving the fold
 * is the upper of the two.
 */
export interface FoldPlacement {
  mid: number;
  half: number;
}

export function easeFolds(
  pts: Vec3[],
  stack: number,
  reach: number,
  place?: (mid: number, zIn: number, zOut: number) => FoldPlacement,
): void {
  const folds = foldsOf(pts);
  if (folds.length === 0 || reach <= 0) return;
  const was = pts.map((p) => p.z); // read heights from before any easing

  for (const f of folds) {
    const i = f.index;
    const zIn = pts[i].zIn ?? was[i];
    const zOut = pts[i].zOut ?? was[i];
    let mid = (zIn + zOut) / 2;
    let half = Math.max(-stack, Math.min(stack, zOut - zIn)) / 2;
    // A caller may place the crease itself rather than inherit it from the runs
    // — the storey's sub-levels are a statement about where a turn belongs, and
    // the weave that set these heights knows nothing about them. `stack` still
    // wins: it is what the strap can physically roll to, and a target past it is
    // a target the lace cannot reach.
    if (place) {
      const want = place(mid, zIn, zOut);
      mid = want.mid;
      half = Math.max(-stack / 2, Math.min(stack / 2, want.half));
    }
    const toIn = mid - half;
    const toOut = mid + half;

    // Ease each side away from the fold, the correction fading out over `reach`.
    rampAway(pts, was, i, -1, toIn - zIn, reach);
    rampAway(pts, was, i, 1, toOut - zOut, reach);

    pts[i].zIn = toIn;
    pts[i].zOut = toOut;
    pts[i].z = mid;
  }
}

/** Walk a correction of `delta` back into the run leaving vertex `i` in direction
 *  `dir`, fading it out over `reach` of in-plane length. Heights are taken from
 *  `was` so several corrections can be planned against the same original run. */
function rampAway(
  pts: Vec3[],
  was: number[],
  i: number,
  dir: -1 | 1,
  delta: number,
  reach: number,
): void {
  if (Math.abs(delta) < 1e-9) return;
  let travelled = 0;
  for (let k = i + dir; k >= 0 && k < pts.length; k += dir) {
    travelled += Math.hypot(pts[k].x - pts[k - dir].x, pts[k].y - pts[k - dir].y);
    if (travelled >= reach) break;
    pts[k].z = was[k] + delta * (1 - travelled / reach);
  }
}

/**
 * Open the two runs of a fold APART, across themselves, over `reach` of length.
 *
 * The plan sibling of `rampAway`, and the price of a bight. A half-roll of
 * radius R that climbs `step` swings `sqrt(4R² - step²)` across the runs on its
 * way round — geometry, not a choice — so its two ends no longer meet the runs
 * where the runs are. Without this the turn is built with the offset and placed
 * as though it had none, and the joins tear open.
 *
 * It also removes a degeneracy on the way past. The studio pins both runs of a
 * dead fold-back on one line, which is exactly where `spliceFolds`'s 2x2 solve
 * goes singular and has to fall back to a limit. Spread them and the solve is
 * ordinary again.
 *
 * The two runs go opposite ways by half each, so the fold's own vertex stays
 * where the scene put it. Smoothstepped, because a lace that arrives along a
 * straight slope with a break at each end is the brace seen from a second angle.
 */
export function easeSpread(
  pts: Vec3[],
  offsetAt: (fold: Fold, index: number) => number,
  reach: number,
): void {
  const folds = foldsOf(pts);
  if (folds.length === 0 || reach <= 0) return;
  const was = pts.map((p) => ({ x: p.x, y: p.y }));

  folds.forEach((f, j) => {
    const off = offsetAt(f, j);
    if (Math.abs(off) < 1e-9) return;
    // Across the crease, which is the direction the roll actually swings in.
    const ax = -f.crease.y;
    const ay = f.crease.x;
    for (const dir of [-1, 1] as const) {
      const delta = (dir * off) / 2;
      let travelled = 0;
      for (let k = f.index + dir; k >= 0 && k < pts.length; k += dir) {
        travelled += Math.hypot(
          was[k].x - was[k - dir].x,
          was[k].y - was[k - dir].y,
        );
        if (travelled >= reach) break;
        const u = 1 - travelled / reach;
        const w = u * u * (3 - 2 * u);
        pts[k].x = was[k].x + ax * delta * w;
        pts[k].y = was[k].y + ay * delta * w;
      }
    }
  });
}

/**
 * Walk a lace up a height step it meets at a GENTLE joint.
 *
 * Two strands glued end to end can rest on different levels — that is what a
 * level break placed between them means. The concatenated centreline then carries
 * the whole step at the shared vertex, in no in-plane length at all.
 *
 * At a FOLD that is exactly right and `easeFolds` keeps it: the lace doubles back
 * and lies on the run it came off, and the crease is where it climbs. A gentle
 * joint has no crease to climb at, so the step has to be walked instead — the
 * joint is levelled to the midpoint and the difference ramped back into the runs
 * on either side, over `reach` of in-plane length. The lace rises to the joint and
 * carries on at the new height, which is what a real one does when it rides up
 * onto the storey below it.
 */
export function easeSteps(pts: Vec3[], reach: number): void {
  if (reach <= 0 || pts.length < 3) return;
  const was = pts.map((p) => p.z);

  for (let i = 1; i < pts.length - 1; i++) {
    const zIn = pts[i].zIn;
    const zOut = pts[i].zOut;
    if (zIn === undefined || zOut === undefined) continue; // not a joint
    if (Math.abs(zOut - zIn) < 1e-9) continue; // no step to walk
    if (turnAt(pts, i) >= FOLD_TURN) continue; // a fold — its crease is the step

    const mid = (zIn + zOut) / 2;
    rampAway(pts, was, i, -1, mid - zIn, reach);
    rampAway(pts, was, i, 1, mid - zOut, reach);
    pts[i].zIn = mid;
    pts[i].zOut = mid;
    pts[i].z = mid;
  }
}

/**
 * Collapse consecutive points that share a position in the drawing plane, taking
 * the average of their heights and keeping the two originals.
 *
 * A joint produces exactly such a pair: the two strands meeting there were woven
 * separately, so each brings its own height to the shared point. Keeping both
 * leaves a step with no length in the plane, and every heading here is read from
 * differences in the plane — so the heading at a joint comes out as neither
 * run's, and a fold does not register as a reversal at all.
 */
export function collapseJoints(centerline: Vec3[]): Vec3[] {
  const pts: Vec3[] = [];
  for (const p of centerline) {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) <= 1e-6) {
      last.zIn = last.zIn ?? last.z;
      last.zOut = p.zOut ?? p.z;
      last.z = (last.zIn + last.zOut) / 2;
      continue;
    }
    pts.push({ ...p });
  }
  return pts;
}

/** Find every fold in a centreline and work out the crease cut at each. */
export function foldsOf(pts: Vec3[], minTurn = FOLD_TURN): Fold[] {
  const out: Fold[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    if (turnAt(pts, i) < minTurn) continue;
    const din = unit(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const dout = unit(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    // The crease bisects the two headings: reflecting the incoming run about it
    // gives the outgoing one. Half the signed turn, so it stays well defined right
    // through a full reversal, where the crease squares up to both runs.
    const a0 = Math.atan2(din.y, din.x);
    let d = Math.atan2(dout.y, dout.x) - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const phi = a0 + d / 2;
    const m = { x: Math.cos(phi), y: Math.sin(phi) };
    out.push({ index: i, din, dout, crease: m });
  }
  return out;
}
