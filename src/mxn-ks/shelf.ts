// Where the atlas gets its numbers.
//
// One interface, two implementations, and the page never learns which it has.
// That is what lets mocks/ks-atlas.html run the real page against a committed
// dump with no network and no engine -- the same arrangement mocks/widgets.html
// makes when it stands in for the Pyodide worker.
//
// The live side is a reader and only a reader. Writing to the shelf stays at
// /mxn/gpu/, where it is deliberately a button someone presses.

import {
  CACHE_VERSION, parseRunKey,
  type CacheClient, type CatalogueEntry, type RunArtifact, type TraceArtifact,
} from "../mxn-lab/cache";
import type { Band } from "../mxn-lab/trace-band";
import type { Stage } from "../mxn-lab/exact-draw";
import {
  bandStatFrom, recordsFromRun, type AtlasRecord, type BandStat,
} from "./model";

/** Sizes the lab will accept, and so the only sizes worth asking about. */
const SIDES = [1, 2, 3, 4];
const HAND_DIRECTIONS = ["lh-cw", "lh-ccw", "rh-cw", "rh-ccw"];

/** What /catalogue will return in one request. Matched to the Worker's clamp. */
const PAGE = 1000;

export type ShelfSummary = {
  runs: number;
  traces: number;
  newest: string;
  /** Prefixes that came back exactly full, so their listing may be short. */
  truncated: string[];
  source: "live" | "fixture";
  label: string;
};

export type Shelf = {
  summary(): Promise<ShelfSummary>;
  /** Every run on the shelf, folded to one record per level. */
  records(onProgress?: (done: number, total: number) => void): Promise<AtlasRecord[]>;
  /** One record's two bands, read and derived. */
  angles(record: AtlasRecord): Promise<Partial<Record<Band, BandStat>>>;
  /**
   * One run's rings, L0 upwards, or null when this shelf has none for it.
   *
   * Separate from records() and lazy on purpose. The geometry is the bulk of a
   * run — 28 kB for a 1x1 and 231 kB for a three-level 2x2, against a 1 kB run
   * with it removed — and most readers never open a drawing. Everything the
   * grid, the charts and the fit need arrives without it.
   */
  geometry(record: AtlasRecord): Promise<Stage[] | null>;
};

// ---------------------------------------------------------------------------
// The live shelf.
// ---------------------------------------------------------------------------

/**
 * Enumerate with narrow prefixes, never one broad one.
 *
 * /catalogue clamps `limit` at 1000, and its D1 branch answers
 * `truncated: false` unconditionally -- including when it returned exactly the
 * limit (worker-api/src/index.ts). One `run/v3/` prefix over a full shelf would
 * therefore report the first thousand keys as the whole thing, and every number
 * on the page would be quietly computed over a slice. Sixteen sizes times four
 * hand-directions is 32 bounded requests instead, and a prefix that does come
 * back exactly full is reported rather than trusted.
 */
async function listRuns(cache: CacheClient) {
  const entries: CatalogueEntry[] = [];
  const truncated: string[] = [];
  const prefixes = HAND_DIRECTIONS.flatMap(hd =>
    SIDES.flatMap(m => SIDES.map(n => `run/${CACHE_VERSION}/${hd}/${m}x${n}/`)));
  await pooled(prefixes, 6, async prefix => {
    const page = await cache.catalogue(prefix, PAGE).catch(() => [] as CatalogueEntry[]);
    if (page.length >= PAGE) truncated.push(prefix);
    entries.push(...page);
  });
  return { entries, truncated };
}

/** A bounded worker pool. Dozens of small fetches, not hundreds at once. */
async function pooled<T>(items: T[], width: number, run: (item: T) => Promise<void>) {
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

export function liveShelf(cache: CacheClient): Shelf {
  let listed: { entries: CatalogueEntry[]; truncated: string[] } | null = null;
  const list = async () => (listed ??= await listRuns(cache));

  return {
    async summary() {
      const { entries, truncated } = await list();
      const newest = entries.reduce((latest, e) => (e.computedAt > latest ? e.computedAt : latest), "");
      return {
        runs: entries.length,
        // Zero, and honestly so: the catalogue is walked for runs only, and
        // traces are fetched per cell when a reader asks. Counting them up
        // front would mean a second full listing to answer a question the page
        // does not put on screen for a live shelf.
        traces: 0,
        newest,
        truncated,
        source: "live",
        label: cache.base,
      };
    },

    async records(onProgress) {
      const { entries } = await list();
      const out: AtlasRecord[] = [];
      let done = 0;
      await pooled(entries, 4, async entry => {
        const parsed = parseRunKey(entry.key);
        done += 1;
        onProgress?.(done, entries.length);
        // A key from an older engine answers a different question. Skipped
        // rather than folded in: the shelf may hold both across a version bump.
        if (!parsed || parsed.cacheVersion !== CACHE_VERSION) return;
        const artifact = await cache.getRun(parsed.descriptor).catch(() => null);
        const result = (artifact as RunArtifact | null)?.result;
        if (!result) return;   // one unreadable body is a missing cell, not a dead page
        out.push(...recordsFromRun(
          entry.key, parsed.descriptor, artifact?.computedAt ?? entry.computedAt,
          result as Parameters<typeof recordsFromRun>[3],
        ));
      });
      return out;
    },

    async angles(record) {
      const descriptor = {
        m: record.m, n: record.n, ks: record.ks,
        hand: record.hand, direction: record.direction,
        shortArms: record.shortArms, step: record.step, budget: record.budget,
      };
      const bands: Band[] = ["h", "v"];
      const out: Partial<Record<Band, BandStat>> = {};
      await Promise.all(bands.map(async band => {
        const artifact = await cache
          .getTrace(descriptor, record.level, band)
          .catch(() => null) as TraceArtifact | null;
        if (!artifact) {
          out[band] = { state: "unavailable", reason: "no census on the shelf for this band" };
          return;
        }
        out[band] = bandStatFrom(
          band, record.m, record.n,
          artifact.plan as Parameters<typeof bandStatFrom>[3],
          artifact.census as Parameters<typeof bandStatFrom>[4],
        );
      }));
      return out;
    },

    /**
     * The run again, this time for the half of it records() threw away.
     *
     * A second fetch rather than holding every run's geometry in memory from
     * the first: a full shelf is tens of megabytes of strands and a reader
     * opens a drawing for a handful of cells. The Worker answers with
     * `max-age=3600`, so the browser serves the repeat out of its own cache and
     * the round trip is usually not one.
     */
    async geometry(record) {
      const parsed = parseRunKey(record.runKey);
      if (!parsed) return null;
      const artifact = await cache.getRun(parsed.descriptor).catch(() => null) as RunArtifact | null;
      const stages = (artifact?.result as { stages?: Stage[] } | undefined)?.stages;
      return Array.isArray(stages) ? stages : null;
    },
  };
}

// ---------------------------------------------------------------------------
// The fixture shelf.
// ---------------------------------------------------------------------------

/**
 * What scripts/ks-dump.ts writes.
 *
 * Two tiers, because the honest whole is too big to commit. Every band's
 * derived stat is carried -- that is a few hundred bytes and is what the grid,
 * the charts and the fit all read. A handful of full censuses are carried as
 * well, so the cell panel's verdict histogram is drawn from real bytes on at
 * least a few cells rather than from a summary of them everywhere.
 */
export type AtlasDump = {
  generatedAt: string;
  source: string;
  cacheVersion: string;
  runs: number;
  truncated?: string[];
  records: AtlasRecord[];
  /** `${runKey}|L${level}-${band}` → the stat derived at dump time. */
  bands: Record<string, BandStat>;
};

export const bandSlot = (record: AtlasRecord, band: Band) =>
  `${record.runKey}|L${record.level}-${band}`;

/**
 * The drawings, in a file of their own.
 *
 * Deliberately not part of AtlasDump. The atlas dump is tens of kB and every
 * reader pays for it; the geometry is megabytes and most readers never open a
 * drawing. Splitting them is what lets the grid arrive instantly and the rings
 * arrive only when asked for.
 */
export type GeometryDump = {
  generatedAt: string;
  source: string;
  /** run key → the run's stages, L0 upwards. */
  stages: Record<string, Stage[]>;
};

export function fixtureShelf(dump: AtlasDump, geometryUrl?: string): Shelf {
  // Fetched once, on the first drawing anyone opens, and shared from then on.
  let pending: Promise<GeometryDump | null> | null = null;
  const geometryDump = () => (pending ??= (geometryUrl
    ? fetch(geometryUrl)
      .then(response => (response.ok ? response.json() : null))
      .catch(() => null)
    : Promise.resolve(null)));

  return fixtureShelfWith(dump, geometryDump);
}

function fixtureShelfWith(
  dump: AtlasDump,
  geometryDump: () => Promise<GeometryDump | null>,
): Shelf {
  return {
    async summary() {
      return {
        runs: dump.runs ?? dump.records.length,
        traces: Object.keys(dump.bands ?? {}).length,
        newest: dump.records.reduce((latest, r) => (r.computedAt > latest ? r.computedAt : latest), ""),
        truncated: dump.truncated ?? [],
        source: "fixture",
        label: dump.source,
      };
    },
    async records() {
      return dump.records;
    },
    async angles(record) {
      const out: Partial<Record<Band, BandStat>> = {};
      (["h", "v"] as Band[]).forEach(band => {
        out[band] = dump.bands?.[bandSlot(record, band)]
          ?? { state: "unavailable", reason: "not in this dump" };
      });
      return out;
    },
    async geometry(record) {
      // A snapshot carries drawings for a sample, not for everything: the whole
      // shelf's strands are tens of megabytes and do not belong in a
      // repository. A cell outside the sample answers null, and the page says
      // so rather than spinning.
      const geometry = await geometryDump();
      return geometry?.stages?.[record.runKey] ?? null;
    },
  };
}

/** A shelf with nothing on it, for a page opened with no cache configured. */
export function emptyShelf(reason: string): Shelf {
  return {
    async summary() {
      return { runs: 0, traces: 0, newest: "", truncated: [], source: "live", label: reason };
    },
    async records() { return []; },
    async angles() { return {}; },
    async geometry() { return null; },
  };
}
