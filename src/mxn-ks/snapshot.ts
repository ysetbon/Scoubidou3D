// What the atlas remembers between visits.
//
// Reading the shelf is the expensive thing this page does. Against the live
// Worker it is 32 catalogue requests and then one fetch per run — minutes on a
// full shelf — and even the bundled dump is 76 kB over the network before a
// single cell can be drawn. None of that changes between two visits to the same
// source, so the last read is kept and a revisit draws from it having asked
// nobody anything.
//
// localStorage rather than a cookie: a cookie is capped around 4 kB and is
// re-sent to the server on every request for the site, and what is stored here
// is a shelf. Same guarded access as cache.ts uses for its own settings —
// private mode and a full quota both throw, and neither is worth losing the
// page over.
//
// One slot, keyed by where it was read from. That key is the whole design: a
// reader who ticks "read the bundled dump instead" is putting the same question
// to a different source, the key stops matching, and the page reads for real.
// So the only two things that cost a fetch are toggling that box and pressing
// reload — which is exactly what the reload button is for.
//
// What is NOT kept here: the geometry dump (public/mxn/ks-atlas-geometry.json,
// two megabytes — over the storage budget, and the browser's own HTTP cache
// already serves the repeat) and the per-cell censuses off a live shelf, which
// are lazy by design and belong to whichever cell a reader opened.

import { CACHE_VERSION, readSetting, writeSetting } from "../mxn-lab/cache";
import type { AtlasRecord } from "./model";
import type { AtlasDump, ShelfSummary } from "./shelf";

/** The source key for the committed dump. Anything else is a Worker URL. */
export const FIXTURE_KEY = "bundled-dump";

const SLOT = "mxn-ks-atlas-snapshot";

/**
 * Which source the slot holds, on its own so that answering "not this one"
 * costs a string compare.
 *
 * The body carries the same key and is still checked against it after parsing;
 * this is a doormat, not the lock. It earns its place because the worker URL
 * field asks that question on every keystroke, and parsing a megabyte of
 * records per character typed is a page that stutters as you type.
 */
const KEY_SLOT = "mxn-ks-atlas-snapshot-at";

const stamp = (key: string) => `${CACHE_VERSION}|${key}`;

/**
 * How much JSON is worth keeping.
 *
 * localStorage is about 5 MB for the whole origin and the lab's own settings
 * live in it too, so a shelf big enough to crowd it out is simply not saved and
 * the next visit reads for real. The committed dump is 76 kB and a 69-run
 * shelf's records are smaller than that, so this is a backstop against a farm
 * that has grown by an order of magnitude, not a limit anyone meets today.
 */
const LIMIT = 2_000_000;

export type AtlasSnapshot = {
  /** CACHE_VERSION at save time. A bump means the numbers answer something else. */
  version: string;
  /** FIXTURE_KEY, or the Worker URL this was read from. */
  key: string;
  savedAt: string;
  summary: ShelfSummary;
  /**
   * The whole dump, for the bundled source only.
   *
   * Kept rather than just its records because the dump IS the fixture shelf:
   * its `bands` are what the census panel reads, and restoring records alone
   * would give a page whose grid is full and whose cells all say "not in this
   * dump". Records are not stored twice — fixtureShelf.records() answers
   * dump.records verbatim, so `records` below is left off when this is set.
   */
  dump?: AtlasDump;
  /** The folded records, for a live shelf — which has no dump to fold them from. */
  records?: AtlasRecord[];
};

/** The rows a snapshot carries, wherever it happens to keep them. */
export function snapshotRecords(held: AtlasSnapshot): AtlasRecord[] {
  const rows = held.dump ? held.dump.records : held.records;
  return Array.isArray(rows) ? rows : [];
}

/**
 * The last read of this source, or null to go and read it.
 *
 * Null for anything doubtful — a different key, an older cache version, a
 * half-written string, a shape from before this file existed. A snapshot is an
 * optimisation, and the failure mode of one that cannot be trusted is to spend
 * the fetch it was there to save.
 */
export function readSnapshot(key: string): AtlasSnapshot | null {
  if (!key) return null;
  if (readSetting(KEY_SLOT) !== stamp(key)) return null;
  const raw = readSetting(SLOT);
  if (!raw) return null;
  try {
    const held = JSON.parse(raw) as AtlasSnapshot;
    if (!held || held.version !== CACHE_VERSION || held.key !== key) return null;
    if (!held.summary || !snapshotRecords(held).length) return null;
    return held;
  } catch {
    return null;
  }
}

/**
 * Keep this read for next time.
 *
 * The slot is cleared before it is written, so a body that is over the limit or
 * that the quota refuses leaves nothing behind rather than leaving the previous
 * source's read in place — stale numbers under a matching key would be the one
 * way this file could tell a lie.
 */
export function writeSnapshot(snapshot: AtlasSnapshot) {
  forgetSnapshot();
  let body: string;
  try {
    body = JSON.stringify(snapshot);
  } catch {
    return;
  }
  if (body.length > LIMIT) return;
  // Body first, key second. writeSetting swallows a quota refusal, so a body
  // that did not fit leaves the key pointing at an empty slot — which reads
  // back as no snapshot, which is the answer that costs a fetch rather than
  // the one that shows the wrong shelf.
  writeSetting(SLOT, body);
  writeSetting(KEY_SLOT, stamp(snapshot.key));
}

export function forgetSnapshot() {
  writeSetting(KEY_SLOT, "");
  writeSetting(SLOT, "");
}

/** How the page says a reading is a saved one. `savedAt` is an ISO string. */
export function savedWhen(savedAt: string) {
  return savedAt ? savedAt.slice(0, 16).replace("T", " ") : "earlier";
}
