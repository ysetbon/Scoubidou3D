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
import { MAX_PAIR_EXTENSION, autoStep, worstPairs } from "../mxn-lab/search-cost";
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
// Which k values the grid draws, and at what step the shelf was searched.
//
// Both live here rather than in the page for the same reason everything else
// does: they are the two things that were wrong about a real shelf, and a check
// cannot reach them inside a React component.
// ---------------------------------------------------------------------------

/**
 * The k rows, decided by the shelf rather than by a constant.
 *
 * This was a hard-coded -4..5, justified from 4x4 (which admits -3..4) and 1x4
 * (which admits -4..5). Both true, and the conclusion still wrong: kLimits is
 * -(m+n-1)..m+n off the diagonal, so the union over sizes 1..4 is -6..7,
 * peaking at 3x4. Twelve legitimate cells had no row to be drawn on -- 4x2
 * k=-5 among them, which was on the real shelf at the time. For a page whose
 * whole argument is that an empty cell means nobody swept it, a cell it cannot
 * draw at all is the worst failure available.
 *
 * Two sources, unioned:
 *
 *  - every k actually present, which the caller should take from the UNFILTERED
 *    records so that changing hand or flags does not make rows appear and
 *    disappear underneath the reader;
 *  - every k admitted by a size that has any record at all, so a size you have
 *    started sweeping shows the gaps you could still fill rather than hiding
 *    them.
 *
 * Zero is always drawn: it is the degenerate row, and its being empty is a
 * statement rather than an absence.
 */
export function kRowsFor(records: Pick<AtlasRecord, "m" | "n" | "k">[]): number[] {
  const rows = new Set<number>([0]);
  const sizes = new Set<string>();
  records.forEach(record => {
    rows.add(record.k);
    sizes.add(`${record.m}x${record.n}`);
  });
  sizes.forEach(size => {
    const [m, n] = size.split("x").map(Number);
    const { min, max } = kLimits(m, n);
    for (let k = min; k <= max; k += 1) rows.add(k);
  });
  // An empty shelf still gets a grid to be empty in, rather than a bare header.
  if (rows.size === 1) [1, -1].forEach(k => rows.add(k));
  return [...rows].sort((a, b) => b - a);
}

/**
 * The extension-grid step the answers on the shelf were actually searched at.
 *
 * The page used to call autoStep() unconditionally, which is wrong for any
 * shelf swept at an explicit step -- and `eauto` and `e5` are different shelves
 * precisely because a resolved step is not the same search as an unresolved one
 * (cache.ts says so in as many words). A shelf swept at `e5-b100000000` walks
 * 41 values a pair; autoStep at that budget answers 10, which is 21 values, and
 * every combo count derived from it was out by more than fourteen times.
 *
 * `resolved` says which happened, because "step 5 because that is what was
 * asked for" and "step 10 because auto worked it out" are different claims and
 * the page should not make one while meaning the other.
 */
export function sweptGridStep(step: number | "auto", pairs: number, budget: number) {
  return step === "auto"
    ? { step: autoStep(pairs, budget), resolved: true }
    : { step, resolved: false };
}

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
 * because the shelf says so rather than because it sounded right: over the 27
 * cells of the bundled snapshot, adding it lifts R² from 0.46 to 0.51 on the
 * chosen extension, 0.22 to 0.29 on the needed ceiling and 0.60 to 0.72 on the
 * angle span. It separates 3×3 from 1×3, which `max` alone cannot — and 1×3 and
 * 3×1 do measure identically, so the pair that `max` conflates really is one
 * point.
 *
 * (`min(m, n)` fits identically to the last decimal, since max + min = m + n
 * spans the same space. `m·n` edges it on the ceiling and loses on the other
 * two, which is not enough to prefer a product nobody can read.)
 *
 * Those R² values are not good, and the page does not pretend otherwise: the
 * residual table is on screen beside the line for exactly this reason. What the
 * model is for is a bounded guess with an honest interval, not a law.
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
// The search envelope, as a file.
//
// The atlas shows, per cell, the smallest ceiling a band still works at and the
// angular width worth searching. Read across the shelf that is the size of the
// box the engine currently searches against the box it needs, and it is what
// would let a larger sweep be configured rather than guessed at — but it lives
// only as pixels, one cell at a time.
//
// Measured over the 26 cells of the first snapshot that had BOTH bands
// censused: every one needs 100px or less of the 0..200 grid, savings run 7x to
// 27x a cell, and the lot together is 169,806 combos against 13,389 — 12.7x.
//
// What this file may NOT claim, all of it carried in `caveats` so the argument
// travels with the numbers:
//
//   - The ceiling is not a per-run parameter. bridge.generate() takes ext_step
//     and combo_budget and nothing else; MAX_PAIR_EXTENSION is a module
//     constant. Acting on extCeiling means an engine edit, and it would have to
//     enter the cache key the way e5 does or capped and uncapped answers
//     collide under one key.
//   - The angle window is not even a kwarg. It is `initial +/- 20.0` as a
//     literal, so angleSpan here is information and nothing else.
//   - A level-1 ceiling understates a deep run: for level >= 2 the engine
//     escalates the ceiling x1.5 up to EXTENSION_CEILING_CAP while the winner
//     is pinned.
//
// And the trap the shape exists to prevent. A cell whose other band was over
// the trace ceiling has an UNKNOWN requirement, not a small one: 4x2 k=1
// computes to a 2401x saving off its measurable band's 20px while the four-pair
// band was never censused at all. Those carry status "lowerBound" and a null
// `needs` — never a number a reader could act on.
// ---------------------------------------------------------------------------

/**
 * What one band's search actually needed.
 *
 * Per band and not just per cell, because the two are not the same search and
 * their costs are not even the same order. H searches `n` pairs and V searches
 * `m` (see bandPairs), so at 4x2 the H band walks 21² = 441 combos and the V
 * band walks 21⁴ = 194,481 — a single combined figure would hide which of the
 * two is actually expensive, which is the thing a reader sizing a sweep needs
 * most.
 */
export type BandNeed = {
  pairs: number;
  /** Smallest ceiling this band still finds a valid ring at. */
  extCeiling: number;
  /** Largest extension appearing in any valid combo of this band. */
  extPeakValid: number;
  /** The union of angles that pass every test, for this band alone. */
  angleFrom: number;
  angleTo: number;
  angleSpan: number;
  /** The probe combo's own ±20° window, for comparison. */
  windowFrom: number;
  windowTo: number;
  combosNow: number;
  combosAtCeiling: number;
  saving: number;
};

/** One (m, n, k) on the shelf, and what its search actually needed. */
export type EnvelopeCell = {
  m: number;
  n: number;
  k: number;
  level: number;
  runKey: string;
  computedAt: string;
  flags: string;
  /**
   * `measured` — both bands censused, `needs` is real.
   * `lowerBound` — a band was over the trace ceiling; the true requirement is
   *   unknown and could be far higher, so `needs` is null.
   * `unmeasured` — no census loaded for either band.
   */
  status: "measured" | "lowerBound" | "unmeasured";
  pairs: number;
  step: number;
  /** True when the step was `auto` and this is what it resolved to. */
  stepResolved: boolean;
  chosen: { h: number[]; v: number[]; peak: number };
  bands: Partial<Record<Band, BandStat>>;
  needs: {
    /** Each band's own requirement, over its own pair count. Null if unmeasured. */
    h: BandNeed | null;
    v: BandNeed | null;
    /**
     * The cell as a whole — the larger of the two, because both bands share one
     * MAX_PAIR_EXTENSION and one window, so whichever asks for more is what a
     * search over this cell would have to be given.
     *
     * Null when a band was over the trace ceiling. Its requirement is unknown,
     * not small, and the measured band alone is a floor: at 4x2 that floor
     * computes to a 2401x saving off a 20px band while the four-pair band was
     * never censused at all. The per-band figures above stay, because what WAS
     * measured is still true — it is only the combination that cannot be had.
     */
    combined: {
      extCeiling: number;
      angleSpan: number;
      combosNow: number;
      combosAtCeiling: number;
      saving: number;
    } | null;
  };
};

export type SearchEnvelope = {
  generatedAt: string;
  source: string;
  cacheVersion: string;
  filter: Record<string, string | number | boolean>;
  /** The constants the recommendations are measured against. */
  engine: {
    maxPairExtension: number;
    extensionCeilingCap: number;
    angleWindowHalfWidth: number;
    angleStepDegrees: number;
  };
  cells: EnvelopeCell[];
  fits: Record<string, {
    terms: readonly string[]; coefficients: number[];
    r2: number; sd: number; n: number; maxPairs: number;
  } | null>;
  predicted: {
    m: number; n: number; k: number;
    extCeiling: Prediction | null;
    angleSpan: Prediction | null;
  }[];
  totals: {
    cells: number;
    cellsMeasured: number;
    combosNow: number;
    combosAtCeiling: number;
    saving: number;
  };
  caveats: string[];
};

/** Mirrors of the engine's own, so the file states what it was measured against. */
const EXTENSION_CEILING_CAP = 1200;
const ANGLE_WINDOW_HALF_WIDTH = 20;
const ANGLE_STEP_DEGREES = 0.5;

export const ENVELOPE_CAVEATS = [
  "extCeiling is NOT settable per run today. bridge.generate() accepts ext_step "
  + "and combo_budget only; MAX_PAIR_EXTENSION is a module constant in "
  + "mxn_continuation_next.py. Acting on these numbers needs an engine change, "
  + "and the ceiling would have to enter the cache key the way the ext step "
  + "already does — otherwise capped and uncapped answers collide under one key.",

  "angleSpan is informational only. The window is `initial +/- 20.0` as literals "
  + "in _compute_pair_angle_range; there is no parameter at any level. The "
  + "cheapest real angle saving would be coarsening ANGLE_STEP_DEGREES, which "
  + "halves the angle axis and is a one-line pass-through.",

  "These ceilings come from level-1 censuses and understate a deep run. For "
  + "level >= 2 the engine escalates: _search_group grows the ceiling x1.5 up to "
  + `EXTENSION_CEILING_CAP (${EXTENSION_CEILING_CAP}) while the winner is pinned.`,

  "A cell with status 'lowerBound' had one band over the trace ceiling. Its "
  + "requirement is UNKNOWN, not small — the refused band has more pairs and was "
  + "never censused. Do not read its measurable band as the cell's answer.",

  "Predicted rows marked extrapolated are past the largest size measured. The "
  + "interval widens with distance from the data on purpose.",

  "needs.h and needs.v are separate searches, not two views of one. The H band "
  + "holds n pairs and the V band holds m, so their grids differ by orders of "
  + "magnitude at a rectangle: at 2x3 k=1 the H band walks 9,261 combos and "
  + "needs 70px while the V band walks 441 and needs 30px. needs.combined takes "
  + "the larger of the two, because both bands share one MAX_PAIR_EXTENSION and "
  + "one window — but it is the per-band figures that say where the cost is.",
];

/**
 * Fold the shelf into the envelope.
 *
 * `valueOf`-equivalent logic on the bands is deliberately repeated rather than
 * imported from the page: both take the LARGER of the two bands, because a
 * ceiling that suits H and starves V is not a ceiling the search could be run
 * at, and a window narrow enough for H would cut off answers V still has.
 */
export function searchEnvelope(input: {
  generatedAt: string;
  source: string;
  cacheVersion: string;
  filter: Record<string, string | number | boolean>;
  /** One record per cell — the caller has already picked which. */
  cells: AtlasRecord[];
  bandsFor: (record: AtlasRecord) => Partial<Record<Band, BandStat>>;
  fits: Record<string, Fit | null>;
  /** Sizes to predict, beyond anything swept. */
  predictFor?: { m: number; n: number; k: number }[];
}): SearchEnvelope {
  const cells: EnvelopeCell[] = input.cells.map(record => {
    const bands = input.bandsFor(record);
    const pairs = worstPairs(record.m, record.n);
    const { step, resolved } = sweptGridStep(record.step, pairs, record.budget);
    const both = [bands.h, bands.v];
    const measured = both.filter(isMeasured);
    // Refused for being too big is not the same as absent, and only the first
    // makes the cell's requirement unknowable — a band that solved without a
    // search genuinely asks for nothing.
    const refused = both.some(stat => stat?.state === "unavailable" && stat.overCeiling);

    const status: EnvelopeCell["status"] = refused ? "lowerBound"
      : measured.length ? "measured"
      : "unmeasured";

    // Rounded up to the grid the search actually walks: a ceiling between two
    // steps buys nothing, because the grid lands on multiples of the step.
    const onGrid = (ceiling: number) =>
      Math.min(MAX_PAIR_EXTENSION, Math.ceil(ceiling / step) * step);

    const needFor = (band: Band): BandNeed | null => {
      const stat = bands[band];
      if (!isMeasured(stat)) return null;
      // This band's OWN pair count, not the cell's worst: H searches n and V
      // searches m, so the two bands of a 4x2 differ by a factor of 440.
      const ownPairs = bandPairs(band, record.m, record.n);
      const saving = ceilingSaving(ownPairs, step, onGrid(stat.extCeilingNeeded));
      return {
        pairs: ownPairs,
        extCeiling: stat.extCeilingNeeded,
        extPeakValid: stat.extPeakValid,
        angleFrom: stat.validLo,
        angleTo: stat.validHi,
        angleSpan: stat.validSpan,
        windowFrom: stat.windowLo,
        windowTo: stat.windowHi,
        combosNow: saving.now,
        combosAtCeiling: saving.proposed,
        saving: Math.round(saving.factor * 10) / 10,
      };
    };

    const needs: EnvelopeCell["needs"] = {
      h: needFor("h"),
      v: needFor("v"),
      combined: null,
    };
    if (status === "measured") {
      const extCeiling = Math.max(...measured.map(stat => stat.extCeilingNeeded));
      const angleSpan = Math.max(...measured.map(stat => stat.validSpan));
      const saving = ceilingSaving(pairs, step, onGrid(extCeiling));
      needs.combined = {
        extCeiling,
        angleSpan,
        combosNow: saving.now,
        combosAtCeiling: saving.proposed,
        saving: Math.round(saving.factor * 10) / 10,
      };
    }

    return {
      m: record.m, n: record.n, k: record.k, level: record.level,
      runKey: record.runKey, computedAt: record.computedAt,
      flags: `s${record.shortArms ? 1 : 0}-e${record.step}-b${record.budget}`,
      status, pairs, step, stepResolved: resolved,
      chosen: { h: record.hExt, v: record.vExt, peak: record.extPeak },
      bands, needs,
    };
  });

  const worthCounting = cells.filter(cell => cell.needs.combined);
  const combosNow = worthCounting.reduce((sum, cell) => sum + cell.needs.combined!.combosNow, 0);
  const combosAtCeiling = worthCounting
    .reduce((sum, cell) => sum + cell.needs.combined!.combosAtCeiling, 0);

  const fits: SearchEnvelope["fits"] = {};
  Object.entries(input.fits).forEach(([name, fit]) => {
    fits[name] = fit && {
      terms: fit.terms, coefficients: fit.coefficients,
      r2: fit.r2, sd: fit.sd, n: fit.n, maxPairs: fit.maxPairs,
    };
  });

  const predicted = (input.predictFor ?? []).map(at => ({
    ...at,
    extCeiling: input.fits.extCeilingNeeded?.predict(at.m, at.n, at.k) ?? null,
    angleSpan: input.fits.validSpan?.predict(at.m, at.n, at.k) ?? null,
  }));

  return {
    generatedAt: input.generatedAt,
    source: input.source,
    cacheVersion: input.cacheVersion,
    filter: input.filter,
    engine: {
      maxPairExtension: MAX_PAIR_EXTENSION,
      extensionCeilingCap: EXTENSION_CEILING_CAP,
      angleWindowHalfWidth: ANGLE_WINDOW_HALF_WIDTH,
      angleStepDegrees: ANGLE_STEP_DEGREES,
    },
    cells,
    fits,
    predicted,
    totals: {
      cells: cells.length,
      cellsMeasured: worthCounting.length,
      combosNow,
      combosAtCeiling,
      saving: combosAtCeiling ? Math.round((combosNow / combosAtCeiling) * 10) / 10 : 1,
    },
    caveats: ENVELOPE_CAVEATS,
  };
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
