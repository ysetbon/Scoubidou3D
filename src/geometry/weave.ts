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
 * Segments of `b` filed into columns by x, so a segment of `a` only has to meet
 * the ones that could possibly be near it.
 *
 * Only worth building for a long polyline: below the threshold the plain double
 * loop is already cheaper than filling the columns. Null means "just walk them
 * all", which is what this did for its whole life.
 */
const GRID_MIN = 64;

interface Columns {
  cells: number[][];
  x0: number;
  cell: number;
  last: number;
}

function columnsOf(b: Vec2[]): Columns | null {
  const n = b.length - 1;
  if (n < GRID_MIN) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const q of b) {
    if (q.x < x0) x0 = q.x;
    if (q.x > x1) x1 = q.x;
  }
  const span = x1 - x0;
  if (!(span > 0) || !Number.isFinite(span)) return null; // a vertical line
  const count = Math.max(1, Math.min(n, Math.round(Math.sqrt(n))));
  const cell = span / count;
  const cells: number[][] = Array.from({ length: count }, () => []);
  const last = count - 1;
  for (let j = 0; j < n; j++) {
    const lo = Math.min(b[j].x, b[j + 1].x);
    const hi = Math.max(b[j].x, b[j + 1].x);
    const c0 = Math.max(0, Math.min(last, Math.floor((lo - x0) / cell)));
    const c1 = Math.max(0, Math.min(last, Math.floor((hi - x0) / cell)));
    for (let c = c0; c <= c1; c++) cells[c].push(j);
  }
  return { cells, x0, cell, last };
}

/**
 * Every crossing point between two centerline polylines, with the arc-length
 * position on each. Handles curves (both are polylines) and multiple crossings
 * of the same pair. Near-duplicate hits at a shared vertex are merged.
 *
 * The search is BROAD-PHASED, and only that: two segments whose boxes do not
 * touch cannot cross, so those pairs are skipped without being tested. The pairs
 * that remain get exactly the test they always got, in exactly the ascending
 * order the plain double loop walked them in, so the merge at the bottom sees
 * the list it has always seen. Nothing about which crossings are found changes.
 *
 * It matters because this is quadratic and the inputs got long: the studio's
 * Planes view runs it over whole merged laces, which on a ten-twist stitch are
 * three lines of ~2,300 points each, and a full pass was a quarter of a second.
 *
 * The box test is padded, because the narrow phase deliberately accepts a hit a
 * touch OUTSIDE either segment (`CROSS_EPS` is a fraction of the segment, not a
 * distance). The pad is that fraction turned back into a distance, so a pair the
 * narrow phase would have accepted is never rejected here.
 */
export function polylineCrossings(a: Vec2[], b: Vec2[]): PolyCross[] {
  if (a.length < 2 || b.length < 2) return [];
  const A = arcLengths(a);
  const B = arcLengths(b);
  const out: PolyCross[] = [];
  const nb = b.length - 1;

  const columns = columnsOf(b);
  // Which segments of `b` this segment of `a` has already collected — one pass
  // stamp, so a `b` segment filed into three columns is still tested once.
  const stamp = columns ? new Int32Array(nb).fill(-1) : null;
  const near: number[] = [];

  for (let i = 0; i < a.length - 1; i++) {
    const p = a[i];
    const rx = a[i + 1].x - p.x;
    const ry = a[i + 1].y - p.y;
    const segA = A.cum[i + 1] - A.cum[i];
    const ax0 = Math.min(p.x, a[i + 1].x);
    const ax1 = Math.max(p.x, a[i + 1].x);
    const ay0 = Math.min(p.y, a[i + 1].y);
    const ay1 = Math.max(p.y, a[i + 1].y);
    const padA = CROSS_EPS * (Math.abs(rx) + Math.abs(ry));

    let list: number[] | null = null;
    if (columns && stamp) {
      near.length = 0;
      const c0 = Math.max(0, Math.floor((ax0 - columns.x0) / columns.cell));
      const c1 = Math.min(columns.last, Math.floor((ax1 - columns.x0) / columns.cell));
      for (let c = c0; c <= c1; c++) {
        for (const j of columns.cells[c]) {
          if (stamp[j] === i) continue;
          stamp[j] = i;
          near.push(j);
        }
      }
      near.sort((m, n) => m - n);
      list = near;
    }

    const count = list ? list.length : nb;
    for (let k = 0; k < count; k++) {
      const j = list ? list[k] : k;
      const q = b[j];
      const sx = b[j + 1].x - q.x;
      const sy = b[j + 1].y - q.y;
      const pad = padA + CROSS_EPS * (Math.abs(sx) + Math.abs(sy)) + 1e-9;
      if (Math.min(q.x, b[j + 1].x) - pad > ax1 || Math.max(q.x, b[j + 1].x) + pad < ax0) continue;
      if (Math.min(q.y, b[j + 1].y) - pad > ay1 || Math.max(q.y, b[j + 1].y) + pad < ay0) continue;
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
  /** True when `z` is a DECLARED height — someone placed this passage — rather
   *  than one computed about a storey plane. A declared height is absolute: when
   *  a strand's resting base settles onto the terrain below and its computed
   *  anchors ride down with it, a declared one stays exactly where it was put. */
  declared?: boolean;
  /** The other side of this crossing — which strand, and where along it. Set
   *  for a computed anchor on a SAME-storey pair, and it is what lets the two
   *  anchors of one crossing ride the settled terrain by the SAME amount: the
   *  shift is the mean of the two strands' settle deltas, so the over/under gap
   *  stays exactly 2h whatever the terrain does. Each strand's own delta alone
   *  would leak the per-lace rank lift into the gap — the exact thing the
   *  "heights are absolute" rule at the anchor site exists to prevent. */
  mate?: { index: number; s: number };
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
 */
export function heightField(
  cum: number[],
  anchors: Anchor[],
  base: number | number[],
): number[] {
  // The resting plane is per VERTEX now, not per strand: a lace that comes out of
  // a fold onto a different plane from the one it went in on is resting at two
  // heights along its own length, with a ramp between them. A scalar is the
  // common case and stays one.
  const baseAt = typeof base === 'number' ? () => base : (k: number) => base[k];
  const z = new Array<number>(cum.length);
  for (let k = 0; k < cum.length; k++) z[k] = baseAt(k);
  if (anchors.length === 0) return z;
  for (let k = 0; k < cum.length; k++) {
    let envelope = 0; // how far off the base plane we are (un-sharpened)
    let weight = 0; // sharpened weights, so the nearest crossing wins
    let target = 0;
    for (const a of anchors) {
      if (a.radius <= 0) continue;
      const p = pulse((cum[k] - a.s) / a.radius);
      if (p <= 0) continue;
      envelope += p;
      const q = Math.pow(p, SHARPNESS);
      weight += q;
      target += a.z * q;
    }
    if (weight <= 0) continue; // no crossing nearby — stay on the base plane
    // Commit fully to the crossing height once the pulses reach full strength;
    // ease out of the base plane on the way in.
    const t = Math.min(1, envelope);
    z[k] = baseAt(k) * (1 - t) + (target / weight) * t;
  }
  return z;
}
