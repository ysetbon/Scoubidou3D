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
  fold: boolean; // too sharp to bend in-plane — turn it in depth instead
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
export function roundCorners(pts: Vec3[], targetRadius: number, halfThickness = 0): Vec3[] {
  if (pts.length < 3 || targetRadius <= 0) return pts;
  const cum = arcOf(pts);
  const total = cum[cum.length - 1];
  if (total <= 0) return pts;

  const corners: CornerPlan[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const turn = turnAt(pts, i);
    if (turn >= MIN_TURN) corners.push({ index: i, s: cum[i], turn, trim: 0, radius: 0, fold: false });
  }
  if (corners.length === 0) return pts;

  // Clearance the lace needs to pass over its own outgoing run.
  const lift = Math.max(halfThickness * 2.1, targetRadius * 0.35);

  for (let c = 0; c < corners.length; c++) {
    const k = corners[c];
    // Run available on each side, shared with the neighbouring corner.
    const before = c === 0 ? k.s : (k.s - corners[c - 1].s) / 2;
    const after = c === corners.length - 1 ? total - k.s : (corners[c + 1].s - k.s) / 2;
    const halfAngle = Math.tan((Math.PI - k.turn) / 2); // large when nearly straight
    const wanted = targetRadius / Math.max(halfAngle, 1e-4);
    k.trim = Math.max(0, Math.min(wanted, before * 0.9, after * 0.9));
    k.radius = k.trim * halfAngle;
    // A bend tighter than the lace is half wide sweeps its inner edge past the
    // centreline and out the far side — the surface turns through itself and reads
    // as a bowtie. No radius fixes that; the lace simply cannot make the turn in
    // the plane. Such a corner becomes a FOLD, turned in DEPTH instead: the lace
    // rides up over its own outgoing run and comes back down. In the vertical
    // plane the turn only has to clear the lace's THICKNESS, not its width, which
    // is why there is room for it where an in-plane bend has none.
    if (halfThickness > 0 && k.radius < targetRadius * 0.85) {
      k.fold = true;
      k.trim = Math.max(0, Math.min(lift * 1.1, before * 0.9, after * 0.9));
    }
  }

  const out: Vec3[] = [];
  const push = (p: Vec3) => {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-7 && Math.abs(last.z - p.z) < 1e-7) return;
    out.push(p);
  };

  // Height the lace is currently carrying because of a fold, and how far it still
  // has to settle back down. A fold leaves the lace on top of itself; it relaxes
  // back to its woven height once the two runs have drawn apart, which keeps a
  // fold from shifting the over/unders further along.
  let carry = 0;
  let carryFrom = 0;
  const settle = targetRadius * 4;
  const heightAt = (s: number): number => {
    if (carry === 0) return 0;
    const f = Math.min(1, Math.max(0, (s - carryFrom) / settle));
    return carry * (1 - f * f * (3 - 2 * f)); // smoothstep back to the base height
  };

  let cursor = 0; // arc position already emitted
  for (let c = 0; c < corners.length; c++) {
    const k = corners[c];
    if (k.trim <= 1e-6) continue;
    const sa = k.s - k.trim;
    const sb = k.s + k.trim;
    for (let i = 0; i < pts.length; i++) {
      if (cum[i] > cursor && cum[i] < sa) push({ ...pts[i], z: pts[i].z + heightAt(cum[i]) });
    }
    const pa0 = at(pts, cum, sa);
    const pb0 = at(pts, cum, sb);
    const pa = { ...pa0, z: pa0.z + heightAt(sa) };
    push(pa);

    const din = unit(pts[k.index].x - pts[k.index - 1].x, pts[k.index].y - pts[k.index - 1].y);
    const dout = unit(pts[k.index + 1].x - pts[k.index].x, pts[k.index + 1].y - pts[k.index].y);

    if (k.fold) {
      // Alternate which way successive folds go, so a lace that folds twice — both
      // arms of a stitch hanging off one middle run — comes back to where it began
      // instead of climbing away.
      const dir = c % 2 === 0 ? -1 : 1;
      const pb = { ...pb0, z: pb0.z + heightAt(sb) + dir * lift };
      // Cubic through the fold: leaves along the incoming run, arrives along the
      // outgoing one, and because the two ends are separated in depth it loops over
      // rather than pinching in the plane.
      const reach = Math.max(k.trim, lift) * 1.25;
      const c1 = { x: pa.x + din.x * reach, y: pa.y + din.y * reach, z: pa.z + dir * lift * 0.55 };
      const c2 = { x: pb.x - dout.x * reach, y: pb.y - dout.y * reach, z: pb.z + dir * lift * 0.05 };
      const steps = 22;
      for (let n = 1; n < steps; n++) {
        const t = n / steps;
        const mt = 1 - t;
        const w0 = mt * mt * mt;
        const w1 = 3 * mt * mt * t;
        const w2 = 3 * mt * t * t;
        const w3 = t * t * t;
        push({
          x: w0 * pa.x + w1 * c1.x + w2 * c2.x + w3 * pb.x,
          y: w0 * pa.y + w1 * c1.y + w2 * c2.y + w3 * pb.y,
          z: w0 * pa.z + w1 * c1.z + w2 * c2.z + w3 * pb.z,
        });
      }
      push(pb);
      carry = heightAt(sb) + dir * lift;
      carryFrom = sb;
    } else {
      const pb = { ...pb0, z: pb0.z + heightAt(sb) };
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
    }
    cursor = sb;
  }
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] > cursor) push({ ...pts[i], z: pts[i].z + heightAt(cum[i]) });
  }
  return out.length >= 2 ? out : pts;
}
