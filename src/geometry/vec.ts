// Tiny 2D vector helpers, used by the curve-profile port. These mirror the
// vadd/vsub/vmul/vnorm/vdist helpers in OpenStrandJS's strand-renderer.js so the
// centerline we build here has the exact same shape as OpenStrand Studio's.

export interface Vec2 {
  x: number;
  y: number;
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
