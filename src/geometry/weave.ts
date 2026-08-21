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

/**
 * An ABSOLUTE height the strand must reach at one crossing: at arc-length `s` the
 * strand should sit at height `z`, over a region of the given `radius` (world
 * units).
 *
 * Absolute — not a nudge — is the important part. A mask can put a bottom-of-the-
 * stack strand over a top-of-the-stack one, and the resolved height must be the
 * same whether the two strands are neighbours in the layer panel or ten layers
 * apart. A relative correction ("lift by however much closes the gap") makes the
 * displacement depend on the stack distance, so the same mask reads differently
 * at every crossing and a lace masked over several strands ramps instead of
 * riding flat.
 */
export interface Anchor {
  s: number;
  radius: number;
  z: number;
}

// Raised-cosine pulse with finite support: 1 at d=0, smoothly 0 at |d|>=1.
// Finite support (unlike a gaussian) keeps a crossing's influence local, so a
// long strand crossing many others reads as distinct over/under dips.
function pulse(d: number): number {
  const a = Math.abs(d);
  if (a >= 1) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * a));
}

// How sharply the NEAREST crossing dominates the blend. A plain pulse-weighted
// average is fine when crossings are far apart, but in a tight knot several
// crossings sit inside one pulse radius, and averaging them equally drags every
// strand toward the same middle height — the over/under of each individual
// crossing dissolves. Raising the averaging weights to a power keeps the crossing
// you are actually passing through in charge, while the envelope below stays on
// the un-sharpened pulse so the ribbon still rises and falls smoothly.
const SHARPNESS = 3;

// Anchors closer together than this share one height rather than fighting over
// it — two laces crossing at the same point, which is common where three or more
// meet. As a fraction of the pulse radius.
const COINCIDENT = 1e-3;

/**
 * The height at each polyline vertex: `base` away from every crossing, easing to
 * the anchored heights across each crossing. `cum` is the cumulative arc-length
 * of the SAME polyline the heights will be applied to (from arcLengths).
 *
 * Overlapping anchors BLEND rather than add. Adding is what breaks a dense weave:
 * two neighbouring crossings that pull opposite ways would cancel or double
 * instead of resolving. Blending also gives the right answer for free where
 * several strands cross at one point — the top lace lands at +h, the bottom at
 * -h, and one caught between them settles in the middle.
 *
 * The blend is EXACT AT EACH CROSSING, and that is not a nicety. An anchor says
 * where the lace has to be for the ribbon under it to fit, so a blend that only
 * heads towards it is a crossing that does not close. A plain weighted average
 * never arrives: at the anchor's own position it carries the neighbours' heights
 * too, and where a lace goes over here and under a little further on, the two
 * pull opposite ways and it reaches neither. Measured on a starting box stitch
 * that cost up to half a thickness — enough for the two ribbons to lie inside
 * each other once the swing was no longer twice what it needed to be.
 *
 * Dividing the weights by `1 - pulse` fixes it, and cheaply: the weight runs
 * away as a sample approaches an anchor, so that anchor takes the sample over
 * completely, while everywhere else the falloff is the one it always was. The
 * far side of the argument still holds — a crossing halfway between two others
 * still averages them.
 */
export function heightField(cum: number[], anchors: Anchor[], base: number): number[] {
  const z = new Array<number>(cum.length).fill(base);
  if (anchors.length === 0) return z;
  for (let k = 0; k < cum.length; k++) {
    let envelope = 0; // how far off the base plane we are (un-sharpened)
    let weight = 0; // sharpened weights, so the nearest crossing wins
    let target = 0;
    // A sample sitting ON a crossing takes that crossing's height and no other.
    // Several of them together — three laces meeting at a point — average, which
    // is the same answer the runaway weights converge to and avoids dividing by
    // a zero they would otherwise reach.
    let onW = 0;
    let onZ = 0;
    for (const a of anchors) {
      if (a.radius <= 0) continue;
      const p = pulse((cum[k] - a.s) / a.radius);
      if (p <= 0) continue;
      envelope += p;
      if (p >= 1 - COINCIDENT) {
        onW++;
        onZ += a.z;
        continue;
      }
      const q = Math.pow(p, SHARPNESS) / (1 - p);
      weight += q;
      target += a.z * q;
    }
    if (onW === 0 && weight <= 0) continue; // no crossing nearby — stay on the base plane
    const blended = onW > 0 ? onZ / onW : target / weight;
    // Commit fully to the crossing height once the pulses reach full strength;
    // ease out of the base plane on the way in.
    const t = Math.min(1, envelope);
    z[k] = base * (1 - t) + blended * t;
  }
  return z;
}
