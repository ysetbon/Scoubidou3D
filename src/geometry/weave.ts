// The weave: what turns a flat stack of ribbons into a real over/under basket.
//
// In OpenStrand Studio, over/under is faked with MASKS — a MaskedStrand paints
// its `first_selected_strand` on top of its `second_selected_strand` inside the
// region where they cross (masked_strand.py: the mask body is the intersection
// of the two stroked paths, drawn last so first-over-second reads as woven).
// A single lace can therefore go OVER some strands and UNDER others.
//
// Scoubidou3D makes that real. At every place two centerlines cross we know who
// is over and who is under (from a mask if one exists, otherwise from the layer
// order). This module (1) finds those crossings and (2) turns each strand's
// crossings into a smooth Z height field: the strand lifts by +amplitude where
// it goes over and dips by -amplitude where it goes under, easing back to its
// base height in between. Sweeping the ribbon along that undulating centerline
// makes the laces physically interlock.

import { Vec2 } from './vec';

/** A point where two centerline polylines cross, with the arc-length position
 *  (world units, measured from the start) at which it happens on each. */
export interface PolyCross {
  sA: number;
  sB: number;
  x: number;
  y: number;
}

/** Cumulative arc-length at each vertex of a polyline (arc[0] = 0). Also returns
 *  the total length. */
export function arcLengths(poly: Vec2[]): { cum: number[]; total: number } {
  const cum = new Array<number>(poly.length);
  cum[0] = 0;
  for (let i = 1; i < poly.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
  }
  return { cum, total: cum[poly.length - 1] ?? 0 };
}

const CROSS_EPS = 1e-6;

// 2D cross product (z-component of a×b).
function cross2(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/**
 * Every crossing point between two centerline polylines, with the arc-length
 * position on each. Handles curves (both are polylines) and multiple crossings
 * of the same pair. Near-duplicate hits at a shared vertex are merged.
 */
export function polylineCrossings(a: Vec2[], b: Vec2[]): PolyCross[] {
  if (a.length < 2 || b.length < 2) return [];
  const A = arcLengths(a);
  const B = arcLengths(b);
  const out: PolyCross[] = [];

  for (let i = 0; i < a.length - 1; i++) {
    const p = a[i];
    const rx = a[i + 1].x - p.x;
    const ry = a[i + 1].y - p.y;
    const segA = A.cum[i + 1] - A.cum[i];
    for (let j = 0; j < b.length - 1; j++) {
      const q = b[j];
      const sx = b[j + 1].x - q.x;
      const sy = b[j + 1].y - q.y;
      const denom = cross2(rx, ry, sx, sy);
      if (Math.abs(denom) < CROSS_EPS) continue; // parallel / collinear
      const qpx = q.x - p.x;
      const qpy = q.y - p.y;
      const t = cross2(qpx, qpy, sx, sy) / denom; // along segment A
      const u = cross2(qpx, qpy, rx, ry) / denom; // along segment B
      if (t < -CROSS_EPS || t > 1 + CROSS_EPS || u < -CROSS_EPS || u > 1 + CROSS_EPS) continue;
      out.push({
        sA: A.cum[i] + t * segA,
        sB: B.cum[j] + u * (B.cum[j + 1] - B.cum[j]),
        x: p.x + t * rx,
        y: p.y + t * ry,
      });
    }
  }

  // Merge crossings that land at (near) the same place on BOTH strands — a hit
  // that falls on a shared polyline vertex is reported by two adjacent segments.
  out.sort((c1, c2) => c1.sA - c2.sA);
  const merged: PolyCross[] = [];
  const mergeEps = Math.max(A.total, B.total) * 1e-4 + 1e-6;
  for (const c of out) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.sA - c.sA) < mergeEps && Math.abs(last.sB - c.sB) < mergeEps) continue;
    merged.push(c);
  }
  return merged;
}

/** A bump on a strand: at arc-length `s` the strand rises (or dips, if `height`
 *  is negative) by `height` world units at the peak, over a region of the given
 *  `radius` (world units). The amount is chosen per crossing so the over strand
 *  clears the under strand regardless of their base heights (see StrandScene). */
export interface Bump {
  s: number;
  radius: number;
  height: number;
}

// Raised-cosine pulse with finite support: 1 at d=0, smoothly 0 at |d|>=1.
// Finite support (unlike a gaussian) keeps a crossing's influence local, so a
// long strand crossing many others reads as distinct over/under dips.
function pulse(d: number): number {
  const a = Math.abs(d);
  if (a >= 1) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * a));
}

/**
 * The Z offset at each polyline vertex, given the strand's bumps. `cum` is the
 * cumulative arc-length of the SAME polyline the offsets will be applied to
 * (from arcLengths). Where bumps overlap, their heights add.
 */
export function heightField(cum: number[], bumps: Bump[]): number[] {
  const z = new Array<number>(cum.length).fill(0);
  if (bumps.length === 0) return z;
  for (let k = 0; k < cum.length; k++) {
    let h = 0;
    for (const b of bumps) {
      if (b.radius <= 0) continue;
      h += b.height * pulse((cum[k] - b.s) / b.radius);
    }
    z[k] = h;
  }
  return z;
}
