// What the shelf knows about k, as arithmetic.
//
// Everything on /mxn/ks/ that is not a pixel is in here, and nothing in here
// touches React or the network. Three callers want it and the third is the
// reason it is a module rather than part of the page:
//
//   src/mxn-ks/atlas.tsx   draws it
//   scripts/ks-dump.ts     derives a fixture from a real Cloudflare shelf
//   scripts/check-atlas.ts holds it to worked examples
//
// A fixture derived by different arithmetic than the page uses would make the
// offline mock a lie about the live page, which is the one thing a mock must
// never be.
//
// The two quantities this exists to produce are the ones the engine currently
// guesses:
//
//   extCeilingNeeded  the smallest MAX_PAIR_EXTENSION that would still leave a
//                     band one valid ring. The grid runs to 200 for every size;
//                     at 3x3 nothing valid needs past 70, and at 4x4 the engine
//                     picks 200 itself. Neither is guessable from the other.
//   validSpan         the angular width actually worth searching. NOT the +/-20
//                     window: each combo carries its own window, so the union
//                     across a band runs wider than any one of them (2x2 k=2)
//                     or uses a fraction of one (3x3 k=1, 9.1 of 40 degrees).

import { kLimits } from "../mxn-farm/plan";
import { MAX_PAIR_EXTENSION, worstPairs } from "../mxn-lab/search-cost";
import {
  BEST, VALID, WINDOW, comboExt, type TraceInputs,
} from "../mxn-lab/trace-census";
import type { Band } from "../mxn-lab/trace-band";
import type { RunDescriptor } from "../mxn-lab/cache";

// ---------------------------------------------------------------------------
// Which band holds which count.
//
// Measured, not assumed, and it is the opposite of what the lab's sidebar says.
// m=3 n=2 gives the H band 2 pairs and the V band 3; m=1 n=3 gives H 3 and V 1.
// So the H band searches n pairs and the V band searches m. The sidebar labels
// m as "H pairs", which is harmless everywhere it is used today -- worstPairs is
// max(m,n) and worstCase sums the two, both symmetric under the swap -- and
// fatal here, where every number on the page is filed under a band AND a size.
//
// check-atlas.ts pins this against a real census so it cannot drift back.
// ---------------------------------------------------------------------------

export const bandPairs = (band: Band, m: number, n: number) => (band === "h" ? n : m);

// ---------------------------------------------------------------------------
// The record: one level of one run.
//
// Not one per run. `ks = [1,2,2]` is three observations of k, and folding them
// into one would throw away the two that are not the first. They are not
// equivalent observations either -- a k at level 3 is conditioned on the whole
// prefix that reached it -- which is why `level` is carried and why the page
// defaults to level 1 only.
// ---------------------------------------------------------------------------

export type AtlasRecord = {
  /** The catalogue key this came off, so any number can be traced to a body. */
  runKey: string;
  m: number;
  n: number;
  k: number;
  level: number;
  levels: number;
  ks: number[];
  hand: string;
  direction: string;
  shortArms: boolean;
  step: number | "auto";
  budget: number;
  computedAt: string;
  /** Engine seconds the whole run cost the machine that computed it. */
  seconds: number;
  /** H holds n pairs, V holds m. See bandPairs. */
  hExt: number[];
  vExt: number[];
  /** The worst single pair in the ring: what the extension grid had to reach. */
  extPeak: number;
  extTotal: number;
  gapH: number;
  gapV: number;
  across: number;
  expected: number;
  masks: number;
  healthy: boolean;
  /** k = 0 preserves the continuation: one configuration, no search, no ext. */
  degenerate: boolean;
  /** Filled in only once this record's traces have been read. */
  angle?: Partial<Record<Band, BandStat>>;
};

/**
 * What one band's census says, once.
 *
 * `unavailable` is a real answer and is kept as one. "4x4 is over the trace
 * ceiling" and "this band solved without a search" both cost a level replay to
 * discover, and a page that showed them as an empty cell would be inviting the
 * reader to go and compute what has already been decided.
 */
export type BandStat =
  | {
      state: "unavailable";
      reason: string;
      combos?: number;
      /**
       * True when the census was refused for being too big, as opposed to there
       * being nothing to census.
       *
       * The two read very differently to a reader — "4×4 is over the trace
       * ceiling, and always will be" against "this level solved its H band
       * without a search, so there is nothing to show" — and only the first is
       * a limit worth marking on a grid. bridge.py distinguishes them by what
       * it puts in the reply: `_over_ceiling` carries the combo count it was
       * refusing and `_no_search` does not.
       */
      overCeiling?: boolean;
    }
  | {
      state: "measured";
      pairs: number;
      combos: number;
      /** Combos with at least one valid angle. */
      combosValid: number;
      /** The PROBE combo's +/-20 window. Every other combo's has moved. */
      windowLo: number;
      windowHi: number;
      /** The union of angles that pass every test, across all combos. */
      validLo: number;
      validHi: number;
      validSpan: number;
      /** Where the engine's own ranking lands, across all combos. */
      bestLo: number;
      bestHi: number;
      /** Smallest ceiling that still leaves this band a valid ring. */
      extCeilingNeeded: number;
      /** Largest pair extension appearing in any valid combo. */
      extPeakValid: number;
      /** Per pair, the extensions that appear in some valid combo. */
      perPair: { lo: number; hi: number }[];
      /** The 8-verdict histogram, as the census counted it. */
      counts: number[];
      /** Share of swept cells that were inside some combo's own window. */
      inWindowShare: number;
    };

export const isMeasured = (
  stat: BandStat | undefined,
): stat is Extract<BandStat, { state: "measured" }> => stat?.state === "measured";

// ---------------------------------------------------------------------------
// Folding a run artifact into records.
// ---------------------------------------------------------------------------

/** One level of bridge.generate()'s payload. */
type AuditRow = {
  level: number;
  k: number;
  expected: number;
  gap: [number, number];
  ext: [number[], number[]];
  across: number;
  masks: number;
  healthy: boolean;
};

type RunResult = { m: number; n: number; ks: number[]; seconds?: number; rows?: AuditRow[] };

const peak = (values: number[]) => values.reduce((most, v) => Math.max(most, v), 0);
const total = (values: number[]) => values.reduce((sum, v) => sum + v, 0);

/**
 * A run artifact's rows, as one record per level.
 *
 * The descriptor is trusted over the payload for m, n and ks: the key is what
 * the shelf is indexed by, and an artifact whose body disagreed with its key
 * would be filed under the key regardless.
 */
export function recordsFromRun(
  runKey: string,
  descriptor: RunDescriptor,
  computedAt: string,
  result: RunResult,
): AtlasRecord[] {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  return rows.map(row => {
    const hExt = Array.isArray(row.ext?.[0]) ? row.ext[0] : [];
    const vExt = Array.isArray(row.ext?.[1]) ? row.ext[1] : [];
    return {
      runKey,
      m: descriptor.m,
      n: descriptor.n,
      k: row.k,
      level: row.level,
      levels: descriptor.ks.length,
      ks: descriptor.ks,
      hand: descriptor.hand,
      direction: descriptor.direction,
      shortArms: descriptor.shortArms,
      step: descriptor.step,
      budget: descriptor.budget,
      computedAt,
      seconds: Number(result.seconds) || 0,
      hExt,
      vExt,
      extPeak: Math.max(peak(hExt), peak(vExt)),
      extTotal: total(hExt) + total(vExt),
      gapH: Number(row.gap?.[0]) || 0,
      gapV: Number(row.gap?.[1]) || 0,
      across: row.across ?? 0,
      expected: row.expected ?? 0,
      masks: row.masks ?? 0,
      healthy: !!row.healthy,
      // k = 0 comes back with no extensions at all on either band, because
      // there is exactly one configuration and nothing to search.
      degenerate: row.k === 0 || (hExt.length === 0 && vExt.length === 0),
    };
  });
}

// ---------------------------------------------------------------------------
// Deriving a band from its census.
// ---------------------------------------------------------------------------

/** What a trace artifact carries, in the parts this module reads. */
export type CensusLike = TraceInputs & {
  unavailable?: boolean;
  reason?: string;
  overBudget?: boolean;
  verdicts?: string;
  angle0?: string;
  best?: string;
  counts?: number[];
  combos?: number;
};

export type PlanLike = {
  unavailable?: boolean;
  reason?: string;
  overBudget?: boolean;
  combos?: number;
  windowLo?: number;
  windowHi?: number;
};

const decodeBytes = (text: string) => {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
};

/**
 * One band's numbers, or the reason there are none.
 *
 * Three things about the census make this less obvious than it looks:
 *
 *  - **The angle axis is ragged.** A cell is (combo, angleIndex) but the angle
 *    it stands for is `angle0[combo] + angleIndex * step`, and angle0 moves per
 *    combo because the window is recomputed as the arms move. Reading the axis
 *    as if it were shared would put every angle in the wrong place except the
 *    probe combo's.
 *  - **WINDOW cells are context, not results.** The census sweeps 40 degrees
 *    past each combo's own window so the panel can show where the window sits;
 *    the real search never tries them. They are excluded from everything except
 *    the share reported below, which is the only place their count means
 *    something.
 *  - **BEST is valid.** It is the angle the ranking selected, not a separate
 *    outcome, so dropping it would undercount every band by one cell per combo.
 */
export function bandStatFrom(
  band: Band,
  m: number,
  n: number,
  plan: PlanLike | null | undefined,
  census: CensusLike | null | undefined,
): BandStat {
  const refused = (source: PlanLike | CensusLike | null | undefined) =>
    !source || source.unavailable || source.overBudget;
  if (refused(plan) && refused(census)) {
    const reason = plan?.reason || census?.reason
      || "no census on the shelf for this band";
    const combos = plan?.combos ?? census?.combos;
    return { state: "unavailable", reason, combos, overCeiling: combos !== undefined };
  }
  if (refused(census) || !census?.verdicts || !census?.angle0) {
    const combos = census?.combos ?? plan?.combos;
    return {
      state: "unavailable",
      reason: census?.reason || "the census was refused",
      combos,
      overCeiling: combos !== undefined,
    };
  }

  const P = census.P;
  const nAngles = census.nAngles;
  const step = census.step;
  const verdicts = decodeBytes(census.verdicts);
  const angle0 = new Float32Array(decodeBytes(census.angle0).buffer);
  const combos = Math.floor(verdicts.length / Math.max(nAngles, 1));

  let validLo = Infinity;
  let validHi = -Infinity;
  let bestLo = Infinity;
  let bestHi = -Infinity;
  let combosValid = 0;
  let extCeilingNeeded = Infinity;
  let extPeakValid = 0;
  let inWindow = 0;
  const perPair = Array.from({ length: P }, () => ({ lo: Infinity, hi: -Infinity }));

  for (let c = 0; c < combos; c += 1) {
    const base = c * nAngles;
    const start = angle0[c];
    let any = false;
    for (let a = 0; a < nAngles; a += 1) {
      const verdict = verdicts[base + a];
      if (verdict !== WINDOW) inWindow += 1;
      if (verdict !== VALID && verdict !== BEST) continue;
      const angle = start + a * step;
      if (angle < validLo) validLo = angle;
      if (angle > validHi) validHi = angle;
      if (verdict === BEST) {
        if (angle < bestLo) bestLo = angle;
        if (angle > bestHi) bestHi = angle;
      }
      any = true;
    }
    if (!any) continue;
    combosValid += 1;
    const ext = comboExt(census, c);
    const worst = peak(ext);
    if (worst < extCeilingNeeded) extCeilingNeeded = worst;
    if (worst > extPeakValid) extPeakValid = worst;
    ext.forEach((value, p) => {
      if (value < perPair[p].lo) perPair[p].lo = value;
      if (value > perPair[p].hi) perPair[p].hi = value;
    });
  }

  if (!combosValid) {
    return {
      state: "unavailable",
      reason: "the census found no valid angle anywhere in the grid",
      combos,
    };
  }

  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    state: "measured",
    pairs: bandPairs(band, m, n),
    combos,
    combosValid,
    windowLo: round(Number(plan?.windowLo ?? NaN)),
    windowHi: round(Number(plan?.windowHi ?? NaN)),
    validLo: round(validLo),
    validHi: round(validHi),
    validSpan: round(validHi - validLo),
    bestLo: Number.isFinite(bestLo) ? round(bestLo) : NaN,
    bestHi: Number.isFinite(bestHi) ? round(bestHi) : NaN,
    extCeilingNeeded,
    extPeakValid,
    perPair: perPair.map(pair => ({
      lo: Number.isFinite(pair.lo) ? pair.lo : 0,
      hi: Number.isFinite(pair.hi) ? pair.hi : 0,
    })),
    counts: census.counts ?? [],
    inWindowShare: combos * nAngles ? inWindow / (combos * nAngles) : 0,
  };
}

// ---------------------------------------------------------------------------
// The fit.
//
// Ordinary least squares on a four-column design matrix, solved by Gaussian
// elimination on the normal equations. Deliberately the smallest thing that
// answers the question: the whole shelf is dozens of points, not thousands, and
// a fit over a dozen points is a sketch. It is drawn as one -- every residual
// is on screen beside the line, and anything past the largest size measured is
// marked rather than quoted.
// ---------------------------------------------------------------------------

/**
 * k, placed in its own size's band.
 *
 * The only way k values compare across sizes at all. 2x1 admits -2..3 and 2x2
 * admits -1..2, so a raw k=2 is the top of one band and the middle of the
 * other; regressing on the raw value would be fitting two different things to
 * one coefficient.
 */
export function kRelative(m: number, n: number, k: number) {
  const { min, max } = kLimits(m, n);
  return max === min ? 0 : (k - min) / (max - min);
}

export type FitPoint = { m: number; n: number; k: number; pairs: number; y: number; label: string };

/**
 * The predictors, and why these four.
 *
 * `pairs` is `max(m, n)` — what the extension grid is raised to, so it is the
 * axis the cost actually moves along. `m+n` is the total, and it is here
 * because the shelf says so rather than because it sounded right: over the
 * measured cells, adding it lifts R² from 0.66 to 0.85 on the chosen extension,
 * 0.68 to 0.74 on the needed ceiling and 0.52 to 0.68 on the angle span. It
 * separates 3×3 from 1×3, which `max` alone cannot — and 1×3 and 3×1 do measure
 * identically, so the pair that `max` conflates really is one point.
 *
 * (`min(m, n)` fits identically to the last decimal, since max + min = m + n
 * spans the same space. `m·n` is a shade better on extensions and worse on
 * angles, which is not enough to prefer a product nobody can read.)
 *
 * Both k terms earn their place: dropping either loses R² on every target.
 *
 * What is deliberately NOT fitted is the window's centre. It is an angle near
 * ±180°, so it wraps, and a straight line through a circular quantity is wrong
 * by construction rather than merely inaccurate — measured, it fits at R² 0.37
 * with an 80° residual, which is the arithmetic complaining.
 */
// Parenthesised because describeFit prints these next to a coefficient and a
// dot: "60.09·m+n" reads as 60.09·m, plus n.
export const FIT_TERMS = ["1", "pairs", "(m+n)", "|k|", "kRel"] as const;

const designRow = (m: number, n: number, k: number, pairs: number) =>
  [1, pairs, m + n, Math.abs(k), kRelative(m, n, k)];

export type Fit = {
  terms: readonly string[];
  coefficients: number[];
  n: number;
  r2: number;
  /** Residual standard deviation, in the units of y. */
  sd: number;
  maxResidual: number;
  /** The largest pair count in the data. Past it, prediction is extrapolation. */
  maxPairs: number;
  residuals: { label: string; y: number; yhat: number; residual: number }[];
  predict(m: number, n: number, k: number): Prediction;
};

export type Prediction = {
  value: number;
  lo: number;
  hi: number;
  /** True when the size asked about is larger than anything in the fit. */
  extrapolated: boolean;
  /** How many pair counts past the data this is, 0 when inside it. */
  beyond: number;
};

/** Solve `A x = b` for a small symmetric A, with partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const size = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < size; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < size; r += 1) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null;   // singular: not enough spread
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < size; r += 1) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= size; c += 1) M[r][c] -= factor * M[col][c];
    }
  }
  // Gauss-Jordan leaves a diagonal matrix, so each unknown is one division.
  return M.map((row, i) => row[size] / row[i]);
}

/**
 * Fit y over the points, or null when there is not enough to fit.
 *
 * Null rather than a shrugging answer: four coefficients from three points is
 * an interpolation dressed as a model, and the page says "not enough on the
 * shelf yet" instead, which is both true and actionable -- it means go and
 * sweep more at /mxn/gpu/.
 */
export function fitPoints(points: FitPoint[]): Fit | null {
  const used = points.filter(p => Number.isFinite(p.y));
  const width = FIT_TERMS.length;
  if (used.length < width + 1) return null;

  const X = used.map(p => designRow(p.m, p.n, p.k, p.pairs));
  const y = used.map(p => p.y);
  const XtX = Array.from({ length: width }, (_, i) =>
    Array.from({ length: width }, (_, j) => X.reduce((sum, row) => sum + row[i] * row[j], 0)));
  const Xty = Array.from({ length: width }, (_, i) =>
    X.reduce((sum, row, r) => sum + row[i] * y[r], 0));
  const coefficients = solve(XtX, Xty);
  if (!coefficients) return null;

  const evaluate = (row: number[]) => row.reduce((sum, v, i) => sum + v * coefficients[i], 0);
  const residuals = used.map((p, i) => {
    const yhat = evaluate(X[i]);
    return { label: p.label, y: p.y, yhat, residual: p.y - yhat };
  });
  const mean = y.reduce((sum, v) => sum + v, 0) / y.length;
  const ssTotal = y.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  const ssResidual = residuals.reduce((sum, r) => sum + r.residual ** 2, 0);
  const dof = Math.max(used.length - width, 1);
  const sd = Math.sqrt(ssResidual / dof);
  const maxPairs = used.reduce((most, p) => Math.max(most, p.pairs), 0);

  return {
    terms: FIT_TERMS,
    coefficients,
    n: used.length,
    r2: ssTotal > 0 ? 1 - ssResidual / ssTotal : 1,
    sd,
    maxResidual: residuals.reduce((most, r) => Math.max(most, Math.abs(r.residual)), 0),
    maxPairs,
    residuals,
    predict(m, n, k) {
      const pairs = worstPairs(m, n);
      const value = evaluate(designRow(m, n, k, pairs));
      const beyond = Math.max(0, pairs - maxPairs);
      // Two standard deviations inside the data, widened by half again for
      // every pair count past it. An honest interval cannot narrow as it
      // leaves the evidence, and a reader who sees a band grow understands
      // "we do not know" without being told.
      const width2 = 2 * sd * (1 + 0.5 * beyond);
      return { value, lo: value - width2, hi: value + width2, extrapolated: beyond > 0, beyond };
    },
  };
}

/** The fitted model as a sentence, for the panel that shows its workings. */
export function describeFit(fit: Fit, unit = "") {
  const [b0, ...rest] = fit.coefficients;
  const parts = rest.map((coefficient, i) => {
    const term = FIT_TERMS[i + 1];
    const sign = coefficient < 0 ? "−" : "+";
    return `${sign} ${Math.abs(coefficient).toFixed(2)}·${term}`;
  });
  return `${b0.toFixed(2)} ${parts.join(" ")}${unit ? ` ${unit}` : ""}`;
}

// ---------------------------------------------------------------------------
// What a predicted ceiling would buy.
// ---------------------------------------------------------------------------

/**
 * The combo count at a proposed ceiling against the one in force.
 *
 * This is the whole point of predicting a ceiling, so the page shows it as
 * arithmetic rather than as a claim: (ceiling/step + 1) ** pairs, which is
 * pick_extension_step's own formula through search-cost.ts.
 */
export function ceilingSaving(pairs: number, step: number, ceiling: number) {
  const grid = (extMax: number) => (Math.floor(Math.max(extMax, 0) / step) + 1) ** Math.max(pairs, 1);
  const now = grid(MAX_PAIR_EXTENSION);
  const proposed = grid(Math.min(Math.max(ceiling, 0), MAX_PAIR_EXTENSION));
  return { now, proposed, factor: proposed > 0 ? now / proposed : 1 };
}
