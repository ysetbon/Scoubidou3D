// Turning "every size from here to there, every k from here to there" into a
// list of parameter sets.
//
// Kept apart from the page and free of React so it can be checked offline —
// `npm run check:plan` holds it to counts and shapes that are worked out by
// hand — because a planner that quietly drops a size is the kind of bug an
// overnight sweep hides until the morning, when the missing thing is missing
// and nothing anywhere says so. Every exclusion this makes is counted and
// reported rather than skipped in silence.

import { autoStep, worstCase, worstPairs } from "../mxn-lab/search-cost";
import { runKey, type RunDescriptor } from "../mxn-lab/cache";

/** The lab clamps m and n to this, and a cached answer nobody can reach is no answer. */
export const MAX_SIDE = 4;
/** The lab refuses more than this many levels in one run, for the same reason. */
export const MAX_LEVELS = 8;
/** A plan bigger than this is a mis-typed range rather than an intention. */
export const MAX_JOBS = 2000;

export type KsMode = "each" | "words" | "list";

export type SweepSpec = {
  mFrom: number; mTo: number;
  nFrom: number; nTo: number;
  ksMode: KsMode;
  /**
   * "each" and "words": where the k values come from. With `kFollowsSize` the
   * band is the one that size actually admits — 1×2 sweeps −2…3 while 2×2
   * sweeps −1…2, in the same plan — and `kFrom`/`kTo` are not read. Without it
   * every size draws from the typed range and whatever falls outside its own
   * band is counted and dropped.
   */
  kFollowsSize: boolean;
  kFrom: number; kTo: number;
  depth: number;
  /** "list": one k sequence per line, applied to every size. */
  ksText: string;
  hand: string;
  direction: string;
  shortArms: boolean;
  step: number | "auto";
  budget: number;
  wantTraces: boolean;
  /** Product cells per level the counting may walk. 0 walks all of them. */
  countCeiling: number;
  fastEngine: boolean;
};

export type PlanJob = {
  /** The run's own cache key, which is also its identity in the queue. */
  id: string;
  descriptor: RunDescriptor;
  m: number;
  n: number;
  ks: number[];
  hand: string;
  direction: string;
  shortArms: boolean;
  step: number | "auto";
  budget: number;
  /** The run's worst-case combo count: what the queue sorts cheapest-first on. */
  weight: number;
  wantTraces: boolean;
  countCeiling: number;
  fastEngine: boolean;
};

export type PlanResult = {
  jobs: PlanJob[];
  /** What was left out, and why. Counted rather than dropped quietly. */
  skipped: { reason: string; count: number }[];
  /** True when MAX_JOBS cut the plan short — the head of it is still valid. */
  truncated: boolean;
  /** Sum of the weights: the whole sweep's ceiling, in combos. */
  totalWeight: number;
};

/** The k range a size actually admits. Mirrors kLimits in weave-studio.tsx. */
export function kLimits(m: number, n: number) {
  return m === n ? { min: -(m - 1), max: m } : { min: -(m + n - 1), max: m + n };
}

/** One k sequence, from a line of text. Returns null when the line is not one. */
export function parseSequence(line: string): number[] | null {
  const cleaned = line.replace(/[[\],]/g, " ").trim();
  if (!cleaned) return null;
  const values = cleaned.split(/\s+/).map(Number);
  if (values.some(value => !Number.isInteger(value))) return null;
  return values;
}

/** Two k sequences of the same length, compared level by level. */
function compareKs(a: number[], b: number[]): number {
  for (let at = 0; at < a.length; at += 1) {
    if (a[at] !== b[at]) return a[at] - b[at];
  }
  return 0;
}

function range(from: number, to: number): number[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const values: number[] = [];
  for (let value = lo; value <= hi; value += 1) values.push(value);
  return values;
}

/**
 * The k values one size draws from.
 *
 * A typed range is one range for the whole sweep, so it is right for at most
 * one size in it: the band is −(m+n−1)…m+n off the diagonal and narrows to
 * −(m−1)…m on it, so a range that covers 2×2 exactly misses four of 2×1's ks.
 * Following the size asks each one its own band instead, which is what "every
 * k there is" means when the sweep is over sizes.
 */
export function kValuesFor(spec: SweepSpec, m: number, n: number): number[] {
  if (!spec.kFollowsSize) return range(spec.kFrom, spec.kTo);
  const limits = kLimits(m, n);
  return range(limits.min, limits.max);
}

/**
 * The k sequences one size gets, before the range check.
 *
 * - `each`  one sequence per k, that k held for every level. "k = 2, three
 *           levels deep" is the question a sweep over sizes usually means.
 * - `words` every sequence of that depth over the size's ks. It is the honest
 *           answer to "all the ks" and it is exponential, which is why the
 *           count is shown before anything is queued.
 * - `list`  what was typed, applied to every size.
 */
export function sequencesFor(spec: SweepSpec, m: number, n: number): number[][] {
  const depth = Math.max(1, Math.min(MAX_LEVELS, Math.trunc(spec.depth)));
  if (spec.ksMode === "list") {
    return spec.ksText.split("\n")
      .map(parseSequence)
      .filter((values): values is number[] => values !== null && values.length > 0);
  }
  const ks = kValuesFor(spec, m, n);
  if (spec.ksMode === "each") return ks.map(k => new Array(depth).fill(k));

  let words: number[][] = [[]];
  for (let at = 0; at < depth; at += 1) {
    const grown: number[][] = [];
    for (const word of words) for (const k of ks) grown.push([...word, k]);
    words = grown;
    // A depth-5 sweep over nine ks is 59,049 sequences per size. Stopping here
    // rather than at the job cap keeps the failure legible: the plan reports
    // the truncation against a number the reader chose.
    if (words.length > MAX_JOBS * 4) break;
  }
  return words;
}

/**
 * Expand a sweep into the parameter sets a farm will work through.
 *
 * Ordering is cheapest first — same key the queue claims on — so that a sweep
 * left running overnight has filled in the small sizes long before it reaches
 * the one 4×4, and stopping it early still leaves something useful behind.
 */
export function planSweep(spec: SweepSpec): PlanResult {
  const jobs: PlanJob[] = [];
  const skipped = new Map<string, number>();
  const note = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  const seen = new Set<string>();
  let truncated = false;

  // Sequences depend on a size only through the ks it draws from, so 1×2 and
  // 2×1 share one expansion and a typed range shares one across the sweep.
  // Worth holding: `words` is exponential and would otherwise be rebuilt for
  // every size in the range.
  const expansions = new Map<string, number[][]>();
  const sequencesAt = (m: number, n: number): number[][] => {
    const key = spec.ksMode === "list" ? "list" : kValuesFor(spec, m, n).join(" ");
    const held = expansions.get(key);
    if (held) return held;
    const made = sequencesFor(spec, m, n);
    expansions.set(key, made);
    return made;
  };

  for (const m of range(spec.mFrom, spec.mTo)) {
    for (const n of range(spec.nFrom, spec.nTo)) {
      if (m < 1 || n < 1 || m > MAX_SIDE || n > MAX_SIDE) {
        note(`size outside 1…${MAX_SIDE}`);
        continue;
      }
      const limits = kLimits(m, n);
      for (const ks of sequencesAt(m, n)) {
        if (!ks.length) continue;
        if (ks.length > MAX_LEVELS) { note(`more than ${MAX_LEVELS} levels`); continue; }
        // Out-of-range k is not a job that fails later, it is not a job. The
        // valid band narrows as a size gets squarer, so a sweep over one range
        // of ks legitimately covers different ks at different sizes. Nothing
        // reaches this when the band follows the size; a typed range and a
        // typed list both can.
        if (ks.some(k => k < limits.min || k > limits.max)) {
          note("k outside the size's valid range");
          continue;
        }
        const descriptor: RunDescriptor = {
          m, n, ks: [...ks],
          hand: spec.hand, direction: spec.direction,
          shortArms: spec.shortArms, step: spec.step, budget: spec.budget,
        };
        const id = runKey(descriptor);
        // The same parameters can be reached twice — a k that is valid at two
        // sizes, a list with a repeated line — and the queue keys on this id,
        // so a duplicate here would only be counted twice on screen.
        if (seen.has(id)) { note("duplicate parameters"); continue; }
        seen.add(id);
        if (jobs.length >= MAX_JOBS) { truncated = true; continue; }
        const step = spec.step === "auto"
          ? autoStep(worstPairs(m, n), spec.budget) : spec.step;
        jobs.push({
          id, descriptor, m, n, ks: [...ks],
          hand: spec.hand, direction: spec.direction,
          shortArms: spec.shortArms, step: spec.step, budget: spec.budget,
          weight: worstCase(m, n, ks.length, step).total,
          wantTraces: spec.wantTraces,
          countCeiling: Math.max(0, Math.trunc(spec.countCeiling)),
          fastEngine: spec.fastEngine,
        });
      }
    }
  }

  // Cheapest first, and everything after that so the order is total and a
  // replan produces the same queue. The ks tie-break is numeric rather than on
  // the id, because ids are strings and "-1" sorts before "-2" in a string —
  // which puts a queue nobody can read a reason into in front of the reader.
  jobs.sort((a, b) =>
    a.weight - b.weight
    || a.m - b.m || a.n - b.n
    || a.ks.length - b.ks.length
    || compareKs(a.ks, b.ks)
    || a.id.localeCompare(b.id));
  return {
    jobs,
    skipped: [...skipped].map(([reason, count]) => ({ reason, count })),
    truncated,
    totalWeight: jobs.reduce((sum, job) => sum + job.weight, 0),
  };
}
