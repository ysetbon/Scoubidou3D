// What a curve is SHAPED like, as opposed to where it sits.
//
// This exists because the fold bench could say how TALL a turn was and nothing
// else. Its one turn measurement was `(|zOut - zIn| + thickness) / width` — a
// height over a width — and a height cannot tell a smooth bight from a curly
// brace, which is the single distinction the whole turn argument turns on.
//
// The distinction lives in the PLAN. A turn is a half-roll about an axis; with
// that axis horizontal the whole roll lies in a vertical plane, so seen from
// above the lace runs out to a point and comes straight back. That is the brace,
// and it is invisible to every measurement taken in elevation: the 3D radius is
// perfectly healthy, the height is exactly the storey, and the plan radius is
// zero. So the rows below are mostly plan rows, and the two that are not are
// there to say the plan rows are not lying.
//
// Everything here is discrete and takes a polyline, because that is what the
// builders produce. Nothing here knows what a lace is.

import { Vec3 } from './vec';

/** Radius of curvature through three points (the Menger circumradius). Infinite
 *  where they are collinear, which is a straight run and not a fault. */
function circumradius(a: Vec3, b: Vec3, c: Vec3): number {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const v = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const w = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const cr = {
    x: u.y * v.z - u.z * v.y,
    y: u.z * v.x - u.x * v.z,
    z: u.x * v.y - u.y * v.x,
  };
  const twiceArea = Math.hypot(cr.x, cr.y, cr.z);
  const lu = Math.hypot(u.x, u.y, u.z);
  const lv = Math.hypot(v.x, v.y, v.z);
  const lw = Math.hypot(w.x, w.y, w.z);
  if (twiceArea < 1e-18 || lu < 1e-12 || lv < 1e-12) return Infinity;
  return (lu * lv * lw) / (2 * twiceArea);
}

/** The radii of curvature along a polyline, one per interior vertex. `plan`
 *  flattens Z first, which is the whole point: a turn can be perfectly round in
 *  space and a cusp seen from above. */
export function radii(pts: Vec3[], plan: boolean): number[] {
  const out: number[] = [];
  const P = plan ? pts.map((p) => ({ x: p.x, y: p.y, z: 0 })) : pts;
  for (let i = 1; i < P.length - 1; i++) {
    const r = circumradius(P[i - 1], P[i], P[i + 1]);
    if (Number.isFinite(r)) out.push(r);
  }
  return out;
}

/**
 * How many times the curve's PLAN curvature changes sign.
 *
 * A helix, and any honest bight, never changes sign: it turns one way the whole
 * way round. A curly brace is defined by doing the opposite — out, back, out —
 * so it reverses twice. This is the second detector rather than the headline,
 * because at the studio's own default the brace has NO reversals: it is a cusp,
 * not an S. Reversals show up once the legs get a length and bend against the
 * tip, which is why it is worth watching while leg length is dragged.
 */
export function planSignChanges(pts: Vec3[], eps = 1e-9): number {
  let last = 0;
  let n = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const ux = pts[i].x - pts[i - 1].x;
    const uy = pts[i].y - pts[i - 1].y;
    const vx = pts[i + 1].x - pts[i].x;
    const vy = pts[i + 1].y - pts[i].y;
    const cross = ux * vy - uy * vx;
    if (Math.abs(cross) < eps) continue;
    const s = Math.sign(cross);
    if (last !== 0 && s !== last) n++;
    last = s;
  }
  return n;
}

/** Arc length of a polyline, world units. */
export function arcLength(pts: Vec3[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
  }
  return s;
}

/** Extent along each axis, world units. */
export function extent(pts: Vec3[]): { x: number; y: number; z: number } {
  if (pts.length === 0) return { x: 0, y: 0, z: 0 };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
    if (p.z < z0) z0 = p.z;
    if (p.z > z1) z1 = p.z;
  }
  return { x: x1 - x0, y: y1 - y0, z: z1 - z0 };
}

/**
 * How far the turn bulges SIDEWAYS in plan, world units — its extent across its
 * own dominant direction.
 *
 * This, and not the radius of curvature, is the honest headline for a turn. A
 * cusp's plan path is a straight line traversed twice, and along a straight line
 * every triple of samples is collinear, so the circumradius comes back
 * astronomically large rather than small: measured on the shipped builder the
 * median turn reported 3.6e12 lace widths, which reads as a magnificent bight
 * and means the exact opposite. The radius is only meaningful once there IS a
 * curve to measure.
 *
 * The bulge has no such failure mode. It is zero for a cusp, and 2R sin(alpha)
 * — the arm offset — for a tilted roll, going smoothly between the two.
 */
export function planBulge(pts: Vec3[]): number {
  if (pts.length < 2) return 0;
  // A frame along the turn's own first step, so "across" means across the run
  // rather than across the world.
  let dx = 0;
  let dy = 0;
  for (let i = 1; i < pts.length; i++) {
    dx = pts[i].x - pts[0].x;
    dy = pts[i].y - pts[0].y;
    if (Math.hypot(dx, dy) > 1e-9) break;
  }
  const L = Math.hypot(dx, dy);
  if (L < 1e-12) return 0;
  const ux = dx / L;
  const uy = dy / L;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    const across = (p.x - pts[0].x) * -uy + (p.y - pts[0].y) * ux;
    if (across < lo) lo = across;
    if (across > hi) hi = across;
  }
  return hi - lo;
}

/** Everything worth knowing about one turn's shape, in world units. The caller
 *  divides by a width or a thickness — which of the two is a real decision and
 *  is not made here. */
export interface TurnShape {
  /** Smallest radius of curvature in 3D. Constant along a true roll. */
  radius3D: number;
  /** Largest, so the caller can report `max / min`: a circular arc is 1.00, a
   *  crease spikes to infinity at one sample. */
  radius3DMax: number;
  /** How far the turn bulges across its own direction, seen from above. THE
   *  brace detector: zero means the turn has no plan extent at all. */
  bulge: number;
  /** Smallest radius of curvature seen from above, and only meaningful once
   *  `bulge` says there is a curve to measure. */
  planRadius: number;
  /** Plan-curvature reversals. 0 for any honest bight. */
  signChanges: number;
  /** Arc length of the turn's own centreline. */
  length: number;
  /** How far apart the turn leaves its two ends, in plan and in Z. */
  spanPlan: number;
  rise: number;
}

export function turnShape(line: Vec3[]): TurnShape {
  const r3 = radii(line, false);
  const rp = radii(line, true);
  const a = line[0];
  const b = line[line.length - 1];
  return {
    radius3D: r3.length ? Math.min(...r3) : Infinity,
    radius3DMax: r3.length ? Math.max(...r3) : Infinity,
    // A cusp has no finite plan radius anywhere along it — every triple is
    // collinear in plan — so an empty list is the strongest possible zero, not
    // a missing measurement.
    bulge: planBulge(line),
    planRadius: rp.length ? Math.min(...rp) : 0,
    signChanges: planSignChanges(line),
    length: arcLength(line),
    spanPlan: Math.hypot(b.x - a.x, b.y - a.y),
    rise: Math.abs(b.z - a.z),
  };
}
