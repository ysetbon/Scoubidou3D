// Tiny 2D vector helpers, used by the curve-profile port. These mirror the
// vadd/vsub/vmul/vnorm/vdist helpers in OpenStrandJS's strand-renderer.js so the
// centerline we build here has the exact same shape as OpenStrand Studio's.

export interface Vec2 {
  x: number;
  y: number;
}

// A point on a woven centerline: the drawing-plane position (x, y) plus the
// out-of-plane height (z) the weave gives it at that point. Flat strands have
// z constant; a woven strand's z rises where it goes over and dips where it
// goes under.
export interface Vec3 {
  x: number;
  y: number;
  z: number;
  /**
   * Where two strands are glued they share a point in the drawing plane, but each
   * was woven separately and so arrives with its own height. Collapsing the pair
   * leaves the mean in `z`, and keeps the two originals here — a FOLD needs to
   * know which way the lace steps as it doubles back (ribbon.ts).
   */
  zIn?: number;
  zOut?: number;
  /**
   * The thickness axis to sweep with HERE, when the point knows better than the
   * sweep can work out.
   *
   * The sweep normally derives "up" from the local gradient, which is right for
   * a run and undefined for a half-turn tip — there the path goes straight up,
   * the gradient is infinite and the strip is in the middle of rolling right
   * over. A turn built by `zTurn` therefore carries its own frame, and the sweep
   * uses it instead of guessing. Absent everywhere else, so nothing changes.
   */
  up?: { x: number; y: number; z: number };
}

export const vadd = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const vsub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const vmul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const vdist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function vnorm(a: Vec2): Vec2 {
  const len = Math.hypot(a.x, a.y);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: a.x / len, y: a.y / len };
}
