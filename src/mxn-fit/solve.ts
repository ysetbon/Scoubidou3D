// The fit itself: which extensions make a band's arms the same length.
//
// No search, and no engine. Arm length is affine in the extension of the arm's
// own pair, the two arms of a pair are always the same length, so a band of 2q
// arms has q lengths and q knobs — and making them equal is one division per
// pair. What that leaves is a two-parameter family of exact answers (the angle,
// and the length they all take), which is what this walks.
//
// Everything here is a pure function over the payload `bridge.fit_plan`
// returns, which is `mxn_trace.plan` — the same TraceInputs the trace panel
// already draws from. So the fit costs nothing but arithmetic and can be
// checked in node, against committed engine output, with no browser and no
// Pyodide (`npm run check:fit`).
//
// What this CANNOT decide is whether the ring still closes. The two bands are
// searched independently and the ring closes jointly, so a band fitted
// perfectly can cost the ring crossings — measured, on a 2×1: the widest-margin
// point of the V band's own curve drops it from 8 crossings to 6. That is why
// this returns an ORDERED LIST rather than an answer, and why the page walks it
// through bridge.fit_weave and takes the first candidate the engine's own audit
// accepts. See docs/mxn-fit.md § Where it refuses.

import {
  VALID, placeStarts, sweepAngle, type TraceInputs,
} from "../mxn-lab/trace-census";

/** What `bridge.fit_plan` adds to a band's TraceInputs. */
export type FitBand = TraceInputs & {
  band: "horizontal" | "vertical";
  /** How many arms the band holds — `2q`. */
  nStrands: number;
  /** The window of the combo the plan probed, which is where the walk starts. */
  windowLo: number;
  windowHi: number;
  unavailable?: boolean;
  reason?: string;
  /** The extensions this level adopted. */
  applied: number[];
  /** The angle it adopted, where the level kept a candidate list to read it off. */
  appliedAngle: number | null;
  /** The band's arms, in the band's own order — the names to measure on a ring. */
  names: string[];
};

/** The engine's own ceiling on one pair's extension (MAX_PAIR_EXTENSION). */
export const EXT_MAX = 200;

/** Below this a band counts as flush already, and is left alone. */
export const FLUSH_EPS = 0.01;

export type Tie = "longest" | "margin" | "least-ext" | "near-engine";

export type FitOptions = {
  /** How the ordered list is ordered. Default "longest" — see rank(). */
  tie?: Tie;
  /** Per-pair extension ceiling. */
  extMax?: number;
  /** Keep candidates whose angle is outside their own ±20° window. */
  offWindow?: boolean;
  /** Snap extensions to this grid, or leave them continuous. */
  snap?: number | null;
  /** How many candidates to hand back. Each one costs a weave to audit. */
  limit?: number;
};

// ---------------------------------------------------------------------------
// The engine's own two conventions, ported exactly.
// ---------------------------------------------------------------------------

/**
 * The angle window one placement is searched in.
 *
 * `ANGLE_MODE` is `"first_strand"`, so this is strand 0's own heading from its
 * EXTENDED start, ±20°. It moves with the extensions, which is the thing that
 * is easy to get wrong: the window a plan reports is the one belonging to the
 * combo it probed, and a level's adopted angle can sit outside it. Every
 * candidate here is judged against its own.
 */
export function windowFor(inputs: TraceInputs, starts: [number, number][]) {
  const ref = (Math.atan2(inputs.targets[0][1] - starts[0][1],
                          inputs.targets[0][0] - starts[0][0]) * 180) / Math.PI;
  return [ref - 20, ref + 20] as const;
}

/** `_build_angle_values`: the grid the engine steps, in hundredths of a degree. */
export function angleValues(lo: number, hi: number, step: number) {
  const by = Math.max(1, Math.round(step * 100));
  const out: number[] = [];
  for (let h = Math.trunc(lo * 100); h <= Math.trunc(hi * 100); h += by) {
    out.push(h / 100);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The solve.
// ---------------------------------------------------------------------------

/** Arm lengths at one placement and heading — `proj` in mxn_trace. */
export function lengthsAt(inputs: TraceInputs, ext: number[], angleDeg: number) {
  return sweepAngle(inputs, placeStarts(inputs, ext), angleDeg).proj;
}

/**
 * `L_p(e) = A_p − B_p·e`, per pair, at this heading.
 *
 * Read off two placements rather than fitted: the relationship is affine to
 * floating-point noise (checked, `2×10⁻¹⁴` over a 100px slide), so two points
 * determine it exactly and there is nothing to estimate.
 */
export function coefficients(inputs: TraceInputs, angleDeg: number) {
  const zero = lengthsAt(inputs, new Array(inputs.P).fill(0), angleDeg);
  const one = lengthsAt(inputs, new Array(inputs.P).fill(1), angleDeg);
  const A: number[] = [];
  const B: number[] = [];
  inputs.pairIndices.forEach(([li], p) => {
    A[p] = zero[li];
    B[p] = zero[li] - one[li];
  });
  return { A, B };
}

/** The common lengths reachable at this heading without leaving `0…extMax`. */
export function starRange(A: number[], B: number[], extMax: number) {
  let lo = -Infinity;
  let hi = Infinity;
  for (let p = 0; p < A.length; p += 1) {
    if (Math.abs(B[p]) < 1e-9) return null;       // no leverage: see the note
    // e = (A − L*) / B, and e must sit in [0, extMax]. Which way that bounds
    // L* depends on the sign of the leverage, so both ends are taken as a pair.
    const a = A[p] - B[p] * extMax;
    const b = A[p];
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
  }
  return hi > lo ? ([lo, hi] as const) : null;
}

/** The extensions that make every pair's arms exactly `star` long, or null. */
export function flushExt(inputs: TraceInputs, angleDeg: number, star: number,
                         extMax = EXT_MAX) {
  const { A, B } = coefficients(inputs, angleDeg);
  const ext: number[] = [];
  for (let p = 0; p < inputs.P; p += 1) {
    if (Math.abs(B[p]) < 1e-9) return null;
    const e = (A[p] - star) / B[p];
    if (e < -1e-9 || e > extMax + 1e-9) return null;
    ext.push(Math.min(extMax, Math.max(0, e)));
  }
  return ext;
}

export const neighbourDelta = (L: number[]) =>
  L.length < 2 ? 0 : Math.max(...L.slice(1).map((x, i) => Math.abs(x - L[i])));

export const spread = (L: number[]) => Math.max(...L) - Math.min(...L);

export const gapMargin = (inputs: TraceInputs, gaps: number[]) =>
  Math.min(Math.min(...gaps) - inputs.minGap, inputs.maxGap - Math.max(...gaps));

export type Candidate = {
  ext: number[];
  angle: number;
  /** The length every arm takes. */
  star: number;
  lengths: number[];
  gaps: number[];
  margin: number;
  delta: number;
  totalExt: number;
};

/**
 * Every exact-flush configuration this band admits, best first.
 *
 * The walk is over headings and common lengths, because those are the two free
 * parameters; the extensions follow from them. Each candidate is then put
 * through the engine's own tests unmodified — reach, degeneracy, order,
 * overlap, too-far — and through its own angle window, and only survivors are
 * returned.
 *
 * The order is the caller's policy, and it is a preference rather than a
 * verdict: the page audits candidates in this order and takes the first ring
 * that still closes.
 */
export function fitCandidates(inputs: FitBand, options: FitOptions = {}) {
  const {
    tie = "longest", extMax = EXT_MAX, offWindow = false, snap = null,
    limit = 48,
  } = options;

  // Headings: the probe window, widened by the most any window can travel. A
  // window is centred on arm 0's heading, and extending its pair swings that
  // heading, so candidates exist either side of the probe's own ±20°.
  const lo = inputs.windowLo ?? -180;
  const hi = inputs.windowHi ?? 180;
  const found: Candidate[] = [];
  const seen = new Set<string>();

  for (let angle = lo - 25; angle <= hi + 25; angle += inputs.step) {
    const { A, B } = coefficients(inputs, angle);
    const range = starRange(A, B, extMax);
    if (!range) continue;
    // A fixed number of samples across the reachable band of lengths rather
    // than a fixed step: the reachable band is a few pixels wide at some
    // headings and hundreds at others, and a fixed step would over-sample one
    // and miss the other entirely.
    const STEPS = 96;
    for (let i = 0; i <= STEPS; i += 1) {
      const star = range[0] + ((range[1] - range[0]) * i) / STEPS;
      let ext = flushExt(inputs, angle, star, extMax);
      if (!ext) continue;
      if (snap) ext = ext.map(e => Math.min(extMax, Math.max(0, Math.round(e / snap) * snap)));

      const starts = placeStarts(inputs, ext);
      if (!offWindow) {
        const [wlo, whi] = windowFor(inputs, starts);
        if (angle < wlo || angle > whi) continue;
      }
      const swept = sweepAngle(inputs, starts, angle);
      if (swept.verdict !== VALID) continue;
      // Snapping breaks flushness; unsnapped it is exact by construction, and
      // this is the assertion of that rather than a tolerance being allowed.
      const delta = neighbourDelta(swept.proj);
      if (!snap && delta > 1e-6) continue;

      const key = `${ext.map(e => e.toFixed(2)).join(",")}@${angle.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        ext, angle, star: swept.proj[0], lengths: swept.proj, gaps: swept.gaps,
        margin: gapMargin(inputs, swept.gaps), delta,
        totalExt: ext.reduce((a, b) => a + b, 0),
      });
    }
  }

  found.sort(rank(tie, inputs));
  return found.slice(0, limit);
}

/**
 * How the candidate list is ordered.
 *
 * "longest" is the default, and it is the default because of what breaks: the
 * ring closes when the arms of one band reach across the other, so the longest
 * flush arms are the ones most likely to survive the joint audit. "margin"
 * reads like the safer choice and measurably is not — on a 2×1 the widest-margin
 * point of the V curve is one of the points that loses the ring two crossings.
 */
function rank(tie: Tie, inputs: FitBand) {
  const applied = inputs.applied ?? [];
  const near = (c: Candidate) =>
    c.ext.reduce((sum, e, i) => sum + Math.abs(e - (applied[i] ?? 0)), 0);
  return (a: Candidate, b: Candidate) => {
    switch (tie) {
      case "margin": return b.margin - a.margin || b.star - a.star;
      case "least-ext": return a.totalExt - b.totalExt || b.margin - a.margin;
      case "near-engine": return near(a) - near(b) || b.margin - a.margin;
      case "longest":
      default: return b.star - a.star || b.margin - a.margin;
    }
  };
}

/** Is this band already the same length all the way across? */
export const isFlush = (lengths: number[], eps = FLUSH_EPS) =>
  lengths.length < 2 || neighbourDelta(lengths) <= eps;

// ---------------------------------------------------------------------------
// The manual fit. Same algebra as the walk above, driven by a hand instead of
// a policy: a person moves one knob and the arithmetic answers what the other
// knobs would have to do about it.
// ---------------------------------------------------------------------------

/** What one manual configuration measures as, before any engine is asked. */
export type Readout = {
  lengths: number[];
  gaps: number[];
  delta: number;
  spread: number;
  margin: number;
  /** mxn_trace's own verdict index — VALID means every geometric test passed. */
  verdict: number;
  /** Whether the angle sits inside its own ±20° window at these extensions. */
  inWindow: boolean;
};

/**
 * Measure an arbitrary `(ext, angle)`, exactly as a candidate is measured.
 *
 * This is the manual panel's whole feedback loop: every drag lands here, and
 * everything it reports is computed off the same `sweepAngle` the census and
 * the candidate walk use — so a configuration a hand finds reads the same as
 * one the walk found, and neither flatters the other.
 */
export function readAt(inputs: FitBand, ext: number[], angleDeg: number): Readout {
  const starts = placeStarts(inputs, ext);
  const swept = sweepAngle(inputs, starts, angleDeg);
  const [wlo, whi] = windowFor(inputs, starts);
  return {
    lengths: swept.proj,
    gaps: swept.gaps,
    delta: neighbourDelta(swept.proj),
    spread: spread(swept.proj),
    margin: gapMargin(inputs, swept.gaps),
    verdict: swept.verdict,
    inWindow: angleDeg >= wlo - 1e-9 && angleDeg <= whi + 1e-9,
  };
}

export type Follow = {
  ext: number[];
  /** The arm length the anchor pair set, which the others were solved to. */
  star: number;
  /** Pairs that could not reach it — clamped to 0…extMax, or without leverage. */
  short: number[];
};

/**
 * Re-solve every other pair to the length the anchor pair's arms now have.
 *
 * `L_p = A_p − B_p·e_p`, so the anchor's extension names a length and each
 * other pair's extension follows by one division — the same equation the
 * candidate walk inverts, anchored on a person's choice instead of a sampled
 * `L*`. A pair whose answer leaves `0…extMax` is clamped and reported rather
 * than silently landed somewhere flush-looking; a pair with no leverage at
 * this heading (`B_p ≈ 0`) cannot follow at all and is reported the same way.
 */
export function followPair(inputs: FitBand, ext: number[], angleDeg: number,
                           anchor: number, extMax = EXT_MAX): Follow {
  const { A, B } = coefficients(inputs, angleDeg);
  const star = A[anchor] - B[anchor] * ext[anchor];
  const next = [...ext];
  const short: number[] = [];
  for (let p = 0; p < inputs.P; p += 1) {
    if (p === anchor) continue;
    if (Math.abs(B[p]) < 1e-9) { short.push(p); continue; }
    const e = (A[p] - star) / B[p];
    if (e < -1e-9 || e > extMax + 1e-9) short.push(p);
    next[p] = Math.min(extMax, Math.max(0, e));
  }
  return { ext: next, star, short };
}

/**
 * Rank a set of rings by how well neighbouring arms agree — the sort.
 *
 * Reads the geometry it is given rather than a score computed earlier, so it
 * means the same thing before a fit and after one, and on a human-blessed
 * category as on a machine-generated list.
 */
export type SortKey = "delta" | "spread" | "margin" | "ext" | "engine";

export function bySortKey<T extends { lengths: number[]; margin: number;
                                      totalExt: number; order?: number }>(
  key: SortKey,
) {
  return (a: T, b: T) => {
    switch (key) {
      case "spread": return spread(a.lengths) - spread(b.lengths);
      case "margin": return b.margin - a.margin;
      case "ext": return a.totalExt - b.totalExt;
      case "engine": return (a.order ?? 0) - (b.order ?? 0);
      case "delta":
      default:
        return neighbourDelta(a.lengths) - neighbourDelta(b.lengths)
            || b.margin - a.margin;
    }
  };
}
