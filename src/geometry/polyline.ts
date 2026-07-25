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
// It gets worse the sharper the corner, and a folded lace is the sharp case: an
// arm folded back across the middle of a stitch turns about 155°, near enough to
// a full reversal that the heading is briefly undefined.
//
// The fix is geometric rather than cosmetic. A real lace cannot turn a corner with
// no radius either — it bends through a bight. So we replace each corner with a
// short curve tangent to the runs on both sides. The heading then rotates over
// many samples instead of one, the cross-section follows it round, and the sweep
// stays flat all the way through the fold.

import { Vec3 } from './vec';

/** Corners gentler than this are left alone — a sampled curve is a polyline of
 *  very slight corners, and rounding those would soften the curve itself. */
const MIN_TURN = 0.35; // radians, ~20°

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
export function roundCorners(input: Vec3[], targetRadius: number): Vec3[] {
  if (input.length < 3 || targetRadius <= 0) return input;
  // Collapse points that share a position in the drawing plane but sit at
  // different heights. A joint produces exactly that: the two strands meeting
  // there were woven separately, so each brings its own z to the shared point. Left
  // in, the pair makes a zero-length step, every measure of "which way is the lace
  // heading" divides by it, and the corner becomes invisible — which is why sharp
  // joints were being swept raw no matter how the rounding was tuned.
  const pts: Vec3[] = [];
  for (const p of input) {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-6) {
      last.z = (last.z + p.z) / 2;
      continue;
    }
    pts.push({ ...p });
  }
  if (pts.length < 3) return input;
  const cum = arcOf(pts);
  const total = cum[cum.length - 1];
  if (total <= 0) return pts;

  const corners: CornerPlan[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const turn = turnAt(pts, i);
    if (turn >= MIN_TURN) corners.push({ index: i, s: cum[i], turn, trim: 0, radius: 0 });
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
