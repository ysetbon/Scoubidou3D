// Getting the board's answers, from the three places they live.
//
//   picks/v3/…   what a person judged at /mxn/fit/. Small, and carries its ring.
//   run/v3/…     what the farm swept at /mxn/gpu/. Large, and its ring is most
//                of that, so the key is read first and the body only when a
//                tile is actually going to be drawn.
//   localStorage this browser's own judgements, which /mxn/fit/ writes BEFORE
//                it writes the shelf. A pick made two minutes ago on a page
//                with no Worker configured exists only here, and a board that
//                could not see it would be answering "did my ★ best save?" with
//                a confident no.
//
// Two things this file is careful about, both learned the hard way elsewhere in
// the repo:
//
// THE CATALOGUE CAN LIE. /catalogue clamps `limit` at 1000 and its D1 branch
// answers `truncated: false` unconditionally, so a prefix that comes back
// exactly full may be a slice presenting itself as a shelf. shelf.ts pays 32
// bounded requests to avoid it; a board that also walked 64 sizes would pay 256,
// so this walks four and SUBDIVIDES any that comes back full. Same guarantee,
// four requests in the ordinary case.
//
// A MISSING BODY IS A MISSING CELL, not a dead page. Every read is caught
// individually, and what could not be read is reported rather than shown as an
// empty tile -- on a page whose entire argument is "an empty tile means nobody
// has been here", a fetch failure drawn as a hole is the one unrecoverable lie.

import {
  CACHE_VERSION, parsePicksKey, parseRunKey, readSetting,
  type CacheClient, type CatalogueEntry, type Judgement,
  type PicksArtifact, type RunArtifact, type RunDescriptor,
} from "../mxn-lab/cache";
import type { Stage } from "../mxn-lab/exact-draw";
import { recordsFromRun } from "./model";
import {
  BOARD_MAX, entriesFromPicks, entryFromJudgement, entryFromRecord,
  type BoardEntry,
} from "./board-model";

const HAND_DIRECTIONS = ["lh-cw", "lh-ccw", "rh-cw", "rh-ccw"];

/** Matched to the Worker's own clamp, so "exactly full" is detectable. */
const PAGE = 1000;

/** Where /mxn/fit/ holds a judgement before, and beside, any network. */
const JUDGEMENTS_KEY = "mxn-fit-judgements";

/** A bounded pool. Dozens of small fetches, never hundreds at once. */
export async function pooled<T>(items: T[], width: number, run: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(width, items.length) }, async () => {
    for (;;) {
      const at = next;
      next += 1;
      if (at >= items.length) return;
      await run(items[at]);
    }
  });
  await Promise.all(workers);
}

export type KeyList = {
  /** Keys whose descriptor is on this board at this k. */
  wanted: { key: string; descriptor: RunDescriptor; computedAt: string }[];
  /** Prefixes that came back exactly full even after subdividing. */
  truncated: string[];
  /** Everything the prefix held, at any k — for saying how big the shelf is. */
  seen: number;
};

/**
 * List one kind, narrowing only where the answer might be short.
 *
 * The subdivision is per size rather than per anything else because size is the
 * segment that actually spreads a real shelf out: one hand-direction at one
 * size is a handful of k sequences, and 64 of those is a number of requests
 * worth paying only when the broad answer came back suspicious.
 */
export async function listKind(
  cache: CacheClient, kind: "picks" | "run", k: number,
  parse: (key: string) => { cacheVersion: string; descriptor: RunDescriptor } | null,
): Promise<KeyList> {
  const wanted: KeyList["wanted"] = [];
  const truncated: string[] = [];
  const rows: CatalogueEntry[] = [];

  const walk = async (prefix: string, mayRefine: boolean) => {
    const page = await cache.catalogue(prefix, PAGE).catch(() => null);
    if (!page) return;
    if (page.length >= PAGE && mayRefine) {
      // The broad answer is a slice, or is indistinguishable from one. Ask
      // again, narrowly, and keep nothing from the suspicious page.
      const sizes = [];
      for (let m = 1; m <= BOARD_MAX; m += 1) {
        for (let n = 1; n <= BOARD_MAX; n += 1) sizes.push(`${prefix}${m}x${n}/`);
      }
      await pooled(sizes, 6, async narrow => { await walk(narrow, false); });
      return;
    }
    if (page.length >= PAGE) truncated.push(prefix);
    rows.push(...page);
  };

  await pooled(HAND_DIRECTIONS.map(hd => `${kind}/${CACHE_VERSION}/${hd}/`), 4,
    prefix => walk(prefix, true));

  for (const row of rows) {
    const parsed = parse(row.key);
    // A key from an older engine answers a different question, and a size off
    // the board is somebody else's sweep. Both are skipped rather than folded.
    if (!parsed || parsed.cacheVersion !== CACHE_VERSION) continue;
    const d = parsed.descriptor;
    if (d.ks[0] !== k) continue;
    if (d.m < 1 || d.m > BOARD_MAX || d.n < 1 || d.n > BOARD_MAX) continue;
    wanted.push({ key: row.key, descriptor: d, computedAt: row.computedAt });
  }
  return { wanted, truncated, seen: rows.length };
}

export type BoardRead = {
  entries: BoardEntry[];
  /** Keys listed but whose body would not come back. Reported on the page. */
  unreadable: string[];
  truncated: string[];
  /** run keys on the board at this k, whose bodies have not been fetched yet. */
  pendingRuns: { key: string; descriptor: RunDescriptor; computedAt: string }[];
  picksSeen: number;
  runsSeen: number;
};

/**
 * Everything a person has said about this k, with the rings they said it about.
 *
 * Picks bodies ARE fetched up front, unlike runs: a judgement is a few kB even
 * carrying its whole ring, the picks shelf is one artifact per parameter set
 * rather than per level, and these are the answers the board exists to put
 * first. Waiting for them is the page loading; waiting for the runs would be
 * the page hanging.
 */
export async function readPicksSide(
  cache: CacheClient, k: number, onProgress?: (done: number, total: number) => void,
): Promise<{ entries: BoardEntry[]; unreadable: string[]; truncated: string[]; seen: number }> {
  const listed = await listKind(cache, "picks", k, parsePicksKey);
  const entries: BoardEntry[] = [];
  const unreadable: string[] = [];
  let done = 0;
  await pooled(listed.wanted, 6, async row => {
    const artifact = await cache.getPicks(row.descriptor).catch(() => null) as PicksArtifact | null;
    done += 1;
    onProgress?.(done, listed.wanted.length);
    if (!artifact) { unreadable.push(row.key); return; }
    // The descriptor is taken from the KEY, not from the body: the key is what
    // addressed the artifact, and a body whose descriptor disagreed with where
    // it is stored would put a ring on a tile it is not about.
    entries.push(...entriesFromPicks(
      { ...artifact, descriptor: row.descriptor }, k, "shelf", row.key));
  });
  return { entries, unreadable, truncated: listed.truncated, seen: listed.seen };
}

/** Which run keys are on this board — the list, not the bodies. */
export async function listRunSide(cache: CacheClient, k: number) {
  return listKind(cache, "run", k, parseRunKey);
}

/**
 * One run's body, folded into the engine's answer and its drawing.
 *
 * Both come out of one fetch because they come out of one artifact: asking for
 * the numbers and then asking again for the ring would pay twice for the same
 * 240 kB. `recordsFromRun` is the atlas's own folding, so the engine numbers on
 * this board and on /mxn/ks/ cannot drift.
 */
export async function readRun(
  cache: CacheClient, key: string, descriptor: RunDescriptor, computedAt: string, k: number,
): Promise<{ entry: BoardEntry | null; stages: Stage[] | null }> {
  const artifact = await cache.getRun(descriptor).catch(() => null) as RunArtifact | null;
  const result = artifact?.result as Parameters<typeof recordsFromRun>[3] | undefined;
  if (!result) return { entry: null, stages: null };
  const records = recordsFromRun(key, descriptor, artifact?.computedAt ?? computedAt, result);
  const level1 = records.find(r => r.level === 1) ?? null;
  const entry = level1 ? entryFromRecord(level1, k, "shelf") : null;
  const stages = (result as { stages?: Stage[] }).stages;
  const stage = Array.isArray(stages) ? stages : null;
  // L0 is the plain grid every run starts from; L1 is the first continuation
  // and the one this board is about. Indexed by level rather than by position,
  // because a run that stored them in another order would otherwise draw the
  // wrong ring under the right label.
  const drawn = stage?.filter(s => s.level === 1) ?? null;
  if (entry && drawn?.length) entry.strands = drawn[0].strands;
  return { entry, stages: stage };
}

/**
 * This browser's own judgements, read straight out of localStorage.
 *
 * No network, so it is free and it is first: a board that has just been opened
 * beside a /mxn/fit/ tab shows what that tab saved, whether or not the Worker
 * ever heard about it. A torn store reads as no judgements rather than as an
 * error -- the same bargain readPicks makes in the fitter.
 */
export function readBrowserSide(k: number): BoardEntry[] {
  let rows: { key?: string; judgement?: Judgement }[] = [];
  try {
    rows = JSON.parse(readSetting(JUDGEMENTS_KEY) || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const entries: BoardEntry[] = [];
  for (const row of rows) {
    if (!row?.judgement || typeof row.key !== "string") continue;
    const parsed = parsePicksKey(row.key);
    if (!parsed || parsed.cacheVersion !== CACHE_VERSION) continue;
    const entry = entryFromJudgement(row.judgement, parsed.descriptor, k, "browser", "this browser");
    if (entry) entries.push(entry);
  }
  return entries;
}
