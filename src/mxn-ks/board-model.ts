// The k board, without a browser in it.
//
// /mxn/ks/ reads the whole shelf and folds it by k to fit a curve through it.
// This is the other half of the same question: hold k still, lay every size out
// as a plane, and draw what is actually known for each one. The atlas answers
// "what happens as m and n grow"; the board answers "what have we GOT, and
// where is the next hole".
//
// Everything here is pure and React-free for the reason model.ts is: the page,
// the check and anything that ever wants to dump a board all have to agree
// about which of two answers for one cell wins, and a rule that lives in a
// component is a rule only one caller has.
//
// The one rule worth naming up front, because the whole page exists to enforce
// it: A PERSON OUTRANKS THE ENGINE. A ★ best judged at /mxn/fit/ fills its tile
// even when the farm has since swept the same parameters, and no ordering by
// recency, source or completeness overturns that. The engine's answer is kept
// beside it rather than dropped -- seeing where a hand improved on the machine
// is most of what this board is for -- but it is never what is drawn.

import {
  CACHE_VERSION, descriptorPath, parsePicksKey, parseRunKey,
  type Judgement, type PickBand, type PicksArtifact, type RunDescriptor, type Verdict,
} from "../mxn-lab/cache";
import type { Stage, Strand } from "../mxn-lab/exact-draw";
import { kLimits } from "../mxn-farm/plan";
import type { AtlasRecord } from "./model";

/**
 * How far out the board goes.
 *
 * Eight because that is the plane a person can hold in their head and still
 * point at a hole in -- 64 tiles, of which a given k admits between 15 and all
 * of them. Nothing below stops at 8; SIDES is the only thing that knows.
 */
export const BOARD_MAX = 8;

export const SIDES = Array.from({ length: BOARD_MAX }, (_, at) => at + 1);

/**
 * Every k any size on this board can legally take.
 *
 * kLimits is `-(m+n-1)…m+n` off the diagonal, and `m+n` peaks at 15 for 8x7 --
 * so the union over the board is -14…15 and NOT the -(2·BOARD_MAX)…2·BOARD_MAX
 * that reading the formula quickly suggests. Thirty pages, one per k, and the
 * generator and the check both read this rather than a literal: a page missing
 * from the range is a k that silently has no board.
 */
export function boardKRange(): number[] {
  let min = 0;
  let max = 0;
  for (const m of SIDES) {
    for (const n of SIDES) {
      const limits = kLimits(m, n);
      min = Math.min(min, limits.min);
      max = Math.max(max, limits.max);
    }
  }
  return Array.from({ length: max - min + 1 }, (_, at) => min + at);
}

/** Whether this size can hold this k at all. An inadmissible cell is not a hole. */
export function admits(m: number, n: number, k: number): boolean {
  const { min, max } = kLimits(m, n);
  return k >= min && k <= max;
}

// ---------------------------------------------------------------------------
// What can fill a tile.
// ---------------------------------------------------------------------------

/**
 * The kinds, in the order they win.
 *
 * `rejected` sits below `engine` deliberately: somebody having ruled one ring
 * out says nothing about the ring the farm found, so a rejected judgement must
 * not blank a perfectly good engine answer. What it DOES do is colour the tile,
 * because "tried and thrown out" is a different piece of knowledge from "never
 * tried" and this board is about knowing which is which.
 */
export type EntryKind = "best" | "valid" | "engine" | "rejected";

const RANK: Record<EntryKind, number> = { best: 0, valid: 1, engine: 2, rejected: 3 };

/** Where the bytes came from. Reported, never used to break a tie. */
export type Origin = "shelf" | "file" | "browser";

export type BandPick = { ext: number[]; angle: number | null } | null;

/** One answer for one cell, whoever gave it. */
export type BoardEntry = {
  m: number;
  n: number;
  k: number;
  kind: EntryKind;
  origin: Origin;
  /** The cache key, or the file name, this was read out of. */
  from: string;
  /** Judged-at for a person, computed-at for the engine. ISO, may be "". */
  at: string;
  /** Who judged it. Absent on an engine entry, by construction. */
  chooser?: string;
  note?: string;
  descriptor: RunDescriptor;
  /** The sequence this came off. `[k]` for a board-native answer. */
  ks: number[];
  /** The ring itself, when the answer carried one. */
  strands: Strand[] | null;
  h: BandPick;
  v: BandPick;
  metrics?: { neighbour_delta: number; spread: number; gap_margin: number };
  audit?: { crossings: number; expected: number; stray: number; broken: number };
  /** Engine-only: what the run reported without a census. */
  run?: { extPeak: number; gapH: number; gapV: number; healthy: boolean; seconds: number };
};

/** What one tile is. */
export type BoardCell = {
  m: number;
  n: number;
  /** False when kLimits refuses this k here: hatched, and never a link. */
  admissible: boolean;
  /** Every answer known for this cell, best first. */
  entries: BoardEntry[];
  /** The one that gets drawn. Null on an empty or rejected-only cell. */
  chosen: BoardEntry | null;
  /** The engine's own answer, kept whether or not it won. */
  engine: BoardEntry | null;
  /** Set when somebody has ruled a ring out here. */
  rejected: BoardEntry | null;
  state: "handmade" | "engine" | "rejected" | "empty" | "outside";
};

/**
 * Sort every answer for a cell and say which one the tile is.
 *
 * Rank first and recency second, so a ★ best from 2024 still beats an engine
 * run from this morning -- which is the whole point -- while two judgements of
 * the same kind resolve to the later one. `chosen` skips `rejected` outright:
 * a tile is a picture of an answer somebody stands behind, and nobody stands
 * behind a ✗.
 */
export function foldCell(m: number, n: number, k: number, found: BoardEntry[]): BoardCell {
  if (!admits(m, n, k)) {
    return { m, n, admissible: false, entries: [], chosen: null, engine: null,
             rejected: null, state: "outside" };
  }
  const entries = [...found].sort((a, b) =>
    RANK[a.kind] - RANK[b.kind] || (b.at < a.at ? -1 : b.at > a.at ? 1 : 0));
  const chosen = entries.find(e => e.kind !== "rejected") ?? null;
  const engine = entries.find(e => e.kind === "engine") ?? null;
  const rejected = entries.find(e => e.kind === "rejected") ?? null;
  const state: BoardCell["state"] =
    !chosen && rejected ? "rejected"
    : !chosen ? "empty"
    : chosen.kind === "engine" ? "engine"
    : "handmade";
  return { m, n, admissible: true, entries, chosen, engine, rejected, state };
}

/** The whole plane, in reading order: n down, m across. */
export function foldBoard(k: number, entries: BoardEntry[]): BoardCell[] {
  const bins = new Map<string, BoardEntry[]>();
  for (const entry of entries) {
    if (entry.k !== k) continue;
    if (entry.m < 1 || entry.m > BOARD_MAX || entry.n < 1 || entry.n > BOARD_MAX) continue;
    const id = `${entry.m}x${entry.n}`;
    const bin = bins.get(id);
    if (bin) bin.push(entry); else bins.set(id, [entry]);
  }
  return SIDES.flatMap(n => SIDES.map(m => foldCell(m, n, k, bins.get(`${m}x${n}`) ?? [])));
}

/**
 * What the board says about itself in one line.
 *
 * `holes` counts admissible cells with nothing at all -- the number that goes
 * down as the board gets filled, and the one the "next hole" button walks.
 */
export function tallyBoard(cells: BoardCell[]) {
  const count = (state: BoardCell["state"]) => cells.filter(c => c.state === state).length;
  const admissible = cells.filter(c => c.admissible).length;
  return {
    admissible,
    outside: count("outside"),
    handmade: count("handmade"),
    engine: count("engine"),
    rejectedOnly: count("rejected"),
    holes: count("empty"),
    /** Cells a hand improved on a run the engine had already done. */
    improved: cells.filter(c => c.state === "handmade" && c.engine).length,
    drawable: cells.filter(c => c.chosen?.strands?.length).length,
  };
}

/** The next admissible cell with nothing on it, walking m fastest. */
export function nextHole(cells: BoardCell[], after?: { m: number; n: number }): BoardCell | null {
  const order = [...cells].sort((a, b) => a.n - b.n || a.m - b.m);
  const at = after ? order.findIndex(c => c.m === after.m && c.n === after.n) : -1;
  const rotated = at >= 0 ? [...order.slice(at + 1), ...order.slice(0, at + 1)] : order;
  return rotated.find(c => c.state === "empty") ?? null;
}

// ---------------------------------------------------------------------------
// Reading each artifact kind into an entry.
// ---------------------------------------------------------------------------

/**
 * The flags the fitter always writes.
 *
 * The farm's own runs use `s1-e5-b100000000`, so a run key and a picks key for
 * one size legitimately differ (docs/picks-shelf.md). Both are read; this is
 * only what a link into /mxn/fit/ will produce.
 */
export const FIT_FLAGS = { shortArms: true, step: "auto" as const, budget: 400_000 };

const strandsOf = (value: unknown): Strand[] | null =>
  Array.isArray(value) && value.length ? value as Strand[] : null;

const bandOf = (band: PickBand): BandPick =>
  band && Array.isArray(band.ext)
    ? { ext: band.ext.map(Number), angle: band.angle ?? null }
    : null;

/**
 * One judgement, as an answer for the board -- or null when it is not one.
 *
 * Two filters, and both matter. The judgement has to be about **level 1**,
 * because a fit judges one level at a time and a level 2 pick is conditioned on
 * the level below it: drawing it as this size's answer at this k would caption
 * one ring with another ring's parameters. And the sequence has to START at k,
 * because L1's search is k = ks[0] whatever follows it.
 */
export function entryFromJudgement(
  judgement: Judgement, descriptor: RunDescriptor, k: number,
  origin: Origin, from: string,
): BoardEntry | null {
  if (descriptor.ks[0] !== k) return null;
  const level = judgement.levels?.find(l => l.level === 1);
  if (!level) return null;
  const kind: EntryKind = judgement.verdict === "best" ? "best"
    : judgement.verdict === "rejected" ? "rejected" : "valid";
  return {
    m: descriptor.m, n: descriptor.n, k, kind, origin, from,
    at: judgement.at ?? "",
    chooser: judgement.chooser,
    note: judgement.note,
    descriptor, ks: descriptor.ks,
    strands: strandsOf(judgement.strands),
    h: bandOf(level.h), v: bandOf(level.v),
    metrics: judgement.metrics,
    audit: judgement.audit,
  };
}

/** Every board answer in one picks artifact. */
export function entriesFromPicks(
  artifact: PicksArtifact, k: number, origin: Origin, from: string,
): BoardEntry[] {
  const descriptor = artifact.descriptor;
  if (!descriptor) return [];
  return (artifact.judgements ?? [])
    .map(j => entryFromJudgement(j, descriptor, k, origin, from))
    .filter((e): e is BoardEntry => !!e);
}

/**
 * One folded run record, as the engine's answer for a cell.
 *
 * `level === 1` for the same reason a judgement must be: this board is one k,
 * and only L1's k is unconditioned. A run at `ks = [-1, 2]` still qualifies --
 * its L1 IS the `ks = [-1]` search -- and says so through `ks`, so the tile can
 * mark where it came from rather than implying a sweep nobody ran.
 */
export function entryFromRecord(record: AtlasRecord, k: number, origin: Origin): BoardEntry | null {
  if (record.level !== 1 || record.ks[0] !== k) return null;
  return {
    m: record.m, n: record.n, k, kind: "engine", origin,
    from: record.runKey,
    at: record.computedAt ?? "",
    descriptor: {
      m: record.m, n: record.n, ks: record.ks, hand: record.hand,
      direction: record.direction, shortArms: record.shortArms,
      step: record.step, budget: record.budget,
    },
    ks: record.ks,
    strands: null,
    h: { ext: record.hExt, angle: null },
    v: { ext: record.vExt, angle: null },
    run: {
      extPeak: record.extPeak, gapH: record.gapH, gapV: record.gapV,
      healthy: record.healthy, seconds: record.seconds,
    },
  };
}

/** The entry's ring, framed and labelled for drawExactStage. */
export function stageOf(entry: BoardEntry): Stage | null {
  if (!entry.strands?.length) return null;
  return {
    level: 1,
    k: entry.k,
    label: entry.kind === "engine" ? "engine" : `${entry.chooser ?? "hand"} · ${entry.kind}`,
    strands: entry.strands,
  };
}

/** Which hand-direction an entry belongs to, as the board's selector spells it. */
export const handKey = (d: { hand: string; direction: string }) => `${d.hand}-${d.direction}`;

// ---------------------------------------------------------------------------
// The link out.
// ---------------------------------------------------------------------------

/**
 * Where an empty tile sends you.
 *
 * Every knob /mxn/fit/ needs to open ready to weave, so pressing a hole and
 * starting to edit is one click and no typing. `ks` rather than `k` because the
 * fitter's field is a sequence -- a board cell is the one-level case of it, and
 * spelling it as the sequence means the same parameter reads the same way on
 * both pages.
 */
export function fitUrl(
  base: string, m: number, n: number, ks: number[], hand: string, direction: string,
): string {
  const query = new URLSearchParams({
    m: String(m), n: String(n), ks: ks.join(" "), hand, direction,
  });
  return `${base}mxn/fit/?${query}`;
}

/** The cell an entry (or a hole) is about, as a sentence. */
export const describeCell = (m: number, n: number, k: number) => `${m}×${n} · k ${k}`;

// ---------------------------------------------------------------------------
// Files off the reader's own machine.
//
// Five shapes are accepted, because five shapes exist in the wild and telling
// somebody their own export is the wrong file would be a page refusing to do
// the thing it is for. Every one of them is read into the same BoardEntry, so
// nothing downstream learns that a file was involved -- a ★ best in a dropped
// file outranks an engine run exactly as one on the shelf does.
// ---------------------------------------------------------------------------

export type LoadedFile = {
  name: string;
  shape: string;
  entries: BoardEntry[];
  /** Board answers that landed at a different k. Counted, not kept. */
  otherK: number;
  problem?: string;
};

/**
 * `mxn-2x1-k1_2-lh-cw-L1-2026-08-13.json` → its parameters.
 *
 * A bare ring export is an array of strands and carries no parameters at all,
 * so the file name is the only thing that can place it. Deliberately strict:
 * guessing a size for a ring puts a drawing on the wrong tile, and a tile is an
 * assertion about a parameter set.
 */
export function parseRingFileName(name: string): { descriptor: RunDescriptor; level: number } | null {
  const match = /^mxn-(\d+)x(\d+)-k(-?\d+(?:_-?\d+)*)-(lh|rh)-(cw|ccw)-L(\d+)\b/.exec(name);
  if (!match) return null;
  return {
    descriptor: {
      m: Number(match[1]), n: Number(match[2]),
      ks: match[3].split("_").map(Number),
      hand: match[4], direction: match[5], ...FIT_FLAGS,
    },
    level: Number(match[6]),
  };
}

type LocalRow = { key?: string; judgement?: Judgement };

/**
 * Read one dropped file into board answers.
 *
 * `k` is the board's own k: everything at another k is counted and dropped,
 * because a file of judgements is usually a whole shelf and silently folding
 * another k's ring into this board is the failure this argument cannot survive.
 */
export function entriesFromFile(name: string, text: string, k: number): LoadedFile {
  const nothing = (problem: string): LoadedFile =>
    ({ name, shape: "unreadable", entries: [], otherK: 0, problem });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return nothing("not JSON");
  }

  const all: BoardEntry[] = [];
  let otherK = 0;
  let shape = "";

  /** Count what a filter threw away, so the page can say so rather than shrug. */
  const take = (made: BoardEntry[], candidates: number) => {
    all.push(...made);
    otherK += Math.max(0, candidates - made.length);
  };

  const record = body as Record<string, unknown>;

  // 1 — a picks artifact, as cache.ts writes it and as `Get-MxnArtifact` reads
  //     one back off the shelf.
  if (record?.kind === "picks") {
    shape = "picks artifact";
    const artifact = body as PicksArtifact;
    take(entriesFromPicks(artifact, k, "file", name), artifact.judgements?.length ?? 0);
  }

  // 2 — the `mxn-fit-judgements` localStorage export: rows of {key, judgement},
  //     where the KEY carries the parameters and the judgement does not.
  else if (Array.isArray(body) && (body as LocalRow[]).some(r => r?.judgement && r?.key)) {
    shape = "judgement rows";
    const rows = body as LocalRow[];
    const made: BoardEntry[] = [];
    for (const row of rows) {
      if (!row?.judgement || typeof row.key !== "string") continue;
      const parsed = parsePicksKey(row.key) ?? parseRunKey(row.key);
      if (!parsed || parsed.cacheVersion !== CACHE_VERSION) continue;
      const entry = entryFromJudgement(row.judgement, parsed.descriptor, k, "file", name);
      if (entry) made.push(entry);
    }
    take(made, rows.length);
  }

  // 3 — an atlas dump, which is engine records and nothing a person said.
  else if (Array.isArray(record?.records)) {
    shape = "atlas dump";
    const records = record.records as AtlasRecord[];
    const made = records
      .map(r => entryFromRecord(r, k, "file"))
      .filter((e): e is BoardEntry => !!e);
    take(made, records.filter(r => r.level === 1).length);
  }

  // 4 — a *.fit.json: the knobs of one fit, with no ring. Worth reading anyway
  //     -- it is what says a cell HAS been fitted, and by whom.
  else if (record?.params && Array.isArray(record.bands)) {
    shape = "fit report";
    const params = record.params as { m: number; n: number; ks: number[]; hand: string; direction: string };
    const engine = record.engine as { level?: number } | undefined;
    const bands = record.bands as { band?: string; after?: { ext?: number[]; angle?: number | null };
                                    before?: { ext?: number[]; angle?: number | null } }[];
    const pick = (want: string): BandPick => {
      const found = bands.find(b => (b.band ?? "").toLowerCase().startsWith(want));
      const side = found?.after ?? found?.before;
      return side?.ext ? { ext: side.ext.map(Number), angle: side.angle ?? null } : null;
    };
    const level = engine?.level ?? 1;
    if (params && level === 1 && params.ks?.[0] === k
        && params.m >= 1 && params.n >= 1) {
      all.push({
        m: params.m, n: params.n, k, kind: "valid", origin: "file", from: name,
        at: typeof record.at === "string" ? record.at : "",
        chooser: "a fit report",
        descriptor: { m: params.m, n: params.n, ks: params.ks, hand: params.hand,
                      direction: params.direction, ...FIT_FLAGS },
        ks: params.ks, strands: null, h: pick("h"), v: pick("v"),
      });
    } else {
      otherK += 1;
    }
  }

  // 5 — a bare ring export: an array of strands, placed by its file name.
  else if (Array.isArray(body)) {
    shape = "ring export";
    const named = parseRingFileName(name);
    if (!named) {
      return { name, shape, entries: [], otherK: 0,
               problem: "a ring export carries no parameters, and this file name does not "
                 + "say which cell it is — rename it as the fitter does "
                 + "(mxn-2x1-k1-lh-cw-L1-….json)" };
    }
    if (named.level !== 1 || named.descriptor.ks[0] !== k) {
      otherK += 1;
    } else {
      all.push({
        m: named.descriptor.m, n: named.descriptor.n, k, kind: "valid",
        origin: "file", from: name, at: "", chooser: "a ring export",
        descriptor: named.descriptor, ks: named.descriptor.ks,
        strands: strandsOf(body), h: null, v: null,
      });
    }
  }

  if (!shape) return nothing("not a picks artifact, judgement list, atlas dump, fit report or ring");
  if (!all.length && !otherK) {
    return { name, shape, entries: [], otherK: 0, problem: `nothing in it is about k = ${k}` };
  }
  return { name, shape, entries: all, otherK };
}

/** The key a cell's descriptor addresses on the shelf, for showing and copying. */
export const cellKey = (d: RunDescriptor) => `${CACHE_VERSION}/${descriptorPath(d)}`;

/** The verdict glyphs, shared with the fitter's own vocabulary. */
export const KIND_GLYPH: Record<EntryKind, string> = {
  best: "★", valid: "✓", engine: "▣", rejected: "✗",
};

export const KIND_NAME: Record<EntryKind, string> = {
  best: "best", valid: "valid", engine: "engine", rejected: "rejected",
};

export type { Verdict };
