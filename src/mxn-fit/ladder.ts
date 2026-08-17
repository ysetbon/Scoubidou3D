// The ladder: a stitch fixed one level at a time.
//
// A run is a stack of rings, and /mxn/fit/ has always fitted ONE of them. That
// is the right unit for a two-level stitch and the wrong one for a ten-level
// one, where the question a reader actually has is "how far up have I got, and
// what is left". This is that question as data — no React, no engine, no
// network — so it can be checked in node (`npm run check:ladder`).
//
// Three things live here, and they are all the same subject:
//
//   1 · READING A k SEQUENCE, including the compact `-1-1-1` a URL carries.
//   2 · WHERE ONE LEVEL BELONGS on the shelf, which is the ks PREFIX up to it.
//   3 · WHAT STATE EACH LEVEL IS IN, and what that makes the next move.
//
// The rule the whole file is built to keep: a level is only "fixed" when the
// levels above it were built on the ring that fixed it. Anything else is a
// proposal, and calling a proposal a fix is how a saved stack ends up
// describing a stitch nobody ever wove. See docs/mxn-fit.md § The ladder.

import type { Judgement, PickBand, RunDescriptor, Verdict } from "../mxn-lab/cache";
// The one tokeniser, shared with the farm and the lab's own links: the page
// that READS `?ks=-1-1-1` and the page that WRITES it have to agree about what
// that string is, or a link between them means two different stitches.
import { ksTokens } from "../mxn-farm/plan";

/**
 * A k sequence as numbers, skipping what is not one.
 *
 * Lenient where `parseSequence` is strict, because this backs a live text
 * field: half-typed input should narrow the sequence, not blank the page.
 */
export function ksOf(raw: string): number[] {
  return ksTokens(raw).map(Number).filter(Number.isInteger);
}

/** The parameter set a URL asks the fitter for, or the fields of it that parse. */
export type Asked = {
  m?: number; n?: number; ksText?: string;
  hand?: "lh" | "rh"; direction?: "cw" | "ccw";
};

/**
 * What `?m=2&n=1&ks=…&hand=lh&direction=cw` asks for.
 *
 * Out of the component so the exact URLs the k boards write can be asserted in
 * node rather than by opening the page — this is the seam that quietly turned a
 * ten-level request into a one-level one, and a bug that only shows up as "the
 * form has the wrong number in it" is worth a test that reads the URL.
 *
 * Every field is validated and a bad one is simply not applied rather than
 * coerced: a URL that half-parsed into a form the reader did not ask for is
 * worse than one that was ignored. `k` is accepted as an alias for `ks`,
 * because a board cell IS the one-level case.
 */
export function askedFrom(search: string, maxSide: number): Asked {
  let query: URLSearchParams;
  try {
    query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  } catch {
    return {};
  }
  const side = (name: string) => {
    const value = Number(query.get(name));
    return Number.isInteger(value) && value >= 1 && value <= maxSide
      ? value : undefined;
  };
  const ks = ksOf(query.get("ks") ?? query.get("k") ?? "");
  const hand = query.get("hand");
  const direction = query.get("direction");
  return {
    m: side("m"),
    n: side("n"),
    ksText: ks.length ? ks.join(" ") : undefined,
    hand: hand === "lh" || hand === "rh" ? hand : undefined,
    direction: direction === "cw" || direction === "ccw" ? direction : undefined,
  };
}

/**
 * Where the ring at one level belongs on the shelf.
 *
 * The engine's own identity, stated in bridge.generate: *the L1 of `[k, …]` is
 * the L1 of `[k]`* — level 1 depends on nothing but the size, the hand, the
 * direction and `ks[0]`. It generalises upward: the ring at level L of a run
 * depends on `ks[0…L−1]` and nothing above it, so the ring at L of a ten-level
 * `-1` run IS the top ring of the three-level run when L is 3.
 *
 * That is what makes the ladder work at all. A ★ best judged months ago on
 * `ks=-1` is this run's level 1, and it is found by asking the shelf for the
 * prefix rather than for the whole sequence — which would miss it, because the
 * key holds every k.
 */
export function prefixDescriptor(d: RunDescriptor, level: number): RunDescriptor {
  const cut = Math.max(1, Math.min(Math.trunc(level), d.ks.length));
  return { ...d, ks: d.ks.slice(0, cut) };
}

/** True when the descriptor already IS its own prefix at that level. */
export function isPrefixOfItself(d: RunDescriptor, level: number): boolean {
  return d.ks.length === Math.max(1, Math.min(Math.trunc(level), d.ks.length));
}

/**
 * What a level is, in one word.
 *
 * `fixed` is the only one that means the levels above stand on this ring.
 * `proposed` is a fit on screen that has not been adopted — real geometry,
 * and no consequence yet. `stale` is the one nobody would guess and everybody
 * needs: a level BELOW this one was adopted without a rebuild, so the ring
 * drawn here hangs off a parent that has since moved.
 *
 * `unbuilt` is the honest answer to "why can't I see L2": nothing has computed
 * it. The ladder used to simply leave those levels out, so a four-level
 * sequence with one level on screen read as *L1 of 1* — the page quietly
 * agreeing that the stitch was one level tall, which is not what was asked
 * for and looks exactly like the k sequence having been ignored.
 */
export type LevelState =
  | "fixed" | "pinned" | "proposed" | "engine" | "stale" | "unbuilt";

/** One level as it was fixed: the pick, and what the engine said about it. */
export type FixedLevel = {
  level: number;
  h: PickBand;
  v: PickBand;
  at: string;
  /** Whether the levels above were rebuilt on this ring when it was adopted. */
  rebuilt: boolean;
  /** Where the ring came from: a person's judgement, or this page's fit. */
  origin?: "judged" | "fitted" | "hand";
  /** Who judged it, when it came off the shelf. */
  chooser?: string;
  audit?: { crossings: number; expected: number; stray: number; broken: number };
  metrics?: { neighbour_delta: number; spread: number; gap_margin: number };
  /** The ring itself, so a saved stack carries what it is about. */
  strands?: unknown;
};

export type LadderRow = {
  level: number;
  k: number;
  state: LevelState;
  current: boolean;
  /** The audit as it stands: null where nothing has counted this level. */
  across: number | null;
  expected: number | null;
  closes: boolean;
  /** What the shelf holds for this level's own prefix, once it has been asked. */
  shelf: Verdict | null;
};

export type LadderInput = {
  ks: number[];
  fitLevel: number;
  /** Levels the run actually drew — a ladder cannot climb past them. */
  drawn: number[];
  audits: { level: number; across: number; expected: number; healthy: boolean }[];
  fixed: Record<number, FixedLevel>;
  /** Levels standing on a ring that has moved under them. */
  stale: number[];
  /** A fit is on screen for the level being fitted, and is not adopted. */
  proposed: boolean;
  /** Level 1 was adopted from a judged ★ best when the run was started. */
  pinned: boolean;
  /** What the shelf holds per level, where it has been asked. */
  shelf?: Record<number, Verdict>;
};

/**
 * The ladder, top of the stack last.
 *
 * Precedence matters and is stated once here: `stale` outranks everything,
 * because a level whose parent moved is not describable by whatever it was
 * before; then `fixed`; then the pin at L1; then a proposal on the level being
 * fitted; then the engine's own.
 */
export function ladderRows(input: LadderInput): LadderRow[] {
  const stale = new Set(input.stale);
  const audits = new Map(input.audits.map(row => [row.level, row]));
  const drawn = new Set(input.drawn);
  // Every level the k sequence asks for, always — the ladder is a picture of
  // the stitch that was requested, not of the part of it that happens to be
  // computed. What is missing is drawn as missing.
  const levels = input.ks.length
    ? input.ks.map((_, index) => index + 1)
    : [...input.drawn].sort((a, b) => a - b);
  return levels.map(level => {
    const fixed = input.fixed[level];
    const audit = audits.get(level);
    const state: LevelState =
      stale.has(level) ? "stale"
      : fixed ? "fixed"
      : level === 1 && input.pinned ? "pinned"
      : level === input.fitLevel && input.proposed ? "proposed"
      : drawn.has(level) ? "engine"
      : "unbuilt";
    const across = fixed?.audit?.crossings ?? audit?.across ?? null;
    const expected = fixed?.audit?.expected ?? audit?.expected ?? null;
    return {
      level,
      k: input.ks[level - 1],
      state,
      current: level === input.fitLevel,
      across,
      expected,
      closes: across !== null && expected !== null && across >= expected
        && (fixed?.audit ? fixed.audit.stray === 0 && fixed.audit.broken === 0
                         : audit?.healthy !== false),
      shelf: input.shelf?.[level] ?? null,
    };
  });
}

/** How far up the stack has been fixed, and what the next move is. */
export function stackSummary(rows: LadderRow[]) {
  const held = rows.filter(row => row.state === "fixed" || row.state === "pinned");
  const next = rows.find(row => row.state !== "fixed" && row.state !== "pinned")
    ?? null;
  return {
    fixed: held.length,
    total: rows.length,
    /** The lowest level not yet fixed — where the work goes next. */
    next: next ? next.level : null,
    complete: held.length === rows.length && rows.length > 0,
    /** Levels standing on a parent that moved; they have to be redone. */
    stale: rows.filter(row => row.state === "stale").map(row => row.level),
    /** Fixed levels whose ring the engine says does not close. */
    open: held.filter(row => !row.closes).map(row => row.level),
  };
}

/**
 * Every fixed level as one judgement's `levels` list.
 *
 * The type has always held a list, and the page has always written one entry.
 * A stack is what the list is FOR: one verdict about a stitch, with each
 * level's own pick under it, saved against the whole `ks` because that is what
 * it is about.
 *
 * Levels that were adopted WITHOUT a rebuild are refused rather than quietly
 * included. Their ring is real, but the levels above it were never built on it,
 * so a list holding both would be claiming a stitch that was never woven — the
 * one thing this page must not do.
 */
export function stackLevels(fixed: Record<number, FixedLevel>) {
  return Object.values(fixed)
    .filter(entry => entry.rebuilt || isTop(entry, fixed))
    .sort((a, b) => a.level - b.level)
    .map(entry => ({ level: entry.level, h: entry.h, v: entry.v }));
}

/**
 * A set of levels, named the way a reader would say it.
 *
 * `L1–L4` when they run without a gap, `L2, L5` when they do not — and the
 * difference matters here rather than being cosmetic: a stack that skips a
 * level is a real thing (the level below was somebody else's ring, or was
 * never fitted), and a label that smoothed it into a range would be claiming
 * levels nobody touched.
 */
export function levelSpan(levels: number[]): string {
  const sorted = [...new Set(levels)].sort((a, b) => a - b);
  if (!sorted.length) return "nothing";
  const runs = sorted.every((level, index) =>
    index === 0 || level === sorted[index - 1] + 1);
  if (runs && sorted.length > 1) return `L${sorted[0]}–L${sorted[sorted.length - 1]}`;
  return sorted.map(level => `L${level}`).join(", ");
}

/** The top of the stack has nothing above it, so it needs no rebuild. */
function isTop(entry: FixedLevel, fixed: Record<number, FixedLevel>) {
  return Object.values(fixed).every(other => other.level <= entry.level);
}

/**
 * The worst of the stack's own numbers.
 *
 * A stack is only as good as its weakest level: the widest neighbour Δ any
 * level has, the widest spread, and the tightest gap margin. Quoting the top
 * level's numbers for the whole stack would flatter it.
 */
export function stackMetrics(fixed: Record<number, FixedLevel>) {
  const rows = Object.values(fixed).map(entry => entry.metrics)
    .filter((m): m is NonNullable<typeof m> => !!m);
  if (!rows.length) return undefined;
  return {
    neighbour_delta: Math.max(...rows.map(m => m.neighbour_delta)),
    spread: Math.max(...rows.map(m => m.spread)),
    gap_margin: Math.min(...rows.map(m => m.gap_margin)),
  };
}

/** The audit of the ring a stack ends at: the top fixed level's own. */
export function stackAudit(fixed: Record<number, FixedLevel>) {
  const top = Object.values(fixed).sort((a, b) => b.level - a.level)[0];
  return top?.audit;
}

/**
 * Whether a judgement can be read back as a stack for this run.
 *
 * A judgement covering L1…L4 of a ten-level run is not a stack of that run; it
 * is a stack of its first four levels, and saying so is the difference between
 * "load it" and "load what it covers".
 */
export function judgementCovers(j: Judgement): number[] {
  return j.levels.map(entry => entry.level).sort((a, b) => a - b);
}
