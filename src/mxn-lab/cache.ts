// The precomputed-result cache, on both sides of it.
//
// The lab's engine runs in the reader's browser, which is the whole reason the
// page can live on GitHub Pages — and also the reason a 3×3 costs twenty
// seconds before the first card appears, and a level widget costs a replay plus
// two sweeps before it has anything to draw. None of that work depends on who
// is asking: `random.seed(0)`, one engine commit, one set of parameters, one
// answer. So it only has to be done once, anywhere, by anyone.
//
// /mxn/gpu/ is where it gets done — a machine left running for hours over a
// range of sizes — and this module is the shelf it puts the answers on and the
// shelf /mxn/ takes them off. Two artifacts per parameter set:
//
//   run    · what bridge.generate() returned, with every level's solution
//            count already walked to exact. This is the thinking.
//   trace  · what bridge.trace_plan() and bridge.trace_census() returned for
//            one level and one band, the engine's own pick already woven into
//            it. This is the level widget.
//
// Both are addressed by everything that determines them, so a cache hit is the
// same answer the browser would have computed, never a stale one. Nothing here
// is required: with no cache URL configured the lab computes locally exactly as
// it always has, which is what keeps the page honest as a static artefact.

import { bandKey, type Band } from "./trace-band";

/**
 * Bumped when the engine changes what it answers.
 *
 * Same job as the `trace-plan-v19` key in the worker URL, for the same reason
 * and with the same discipline: a reader whose browser is holding last month's
 * geometry under this month's key is worse off than one who computed it.
 */
export const CACHE_VERSION = "v3";

/** The URL and token fields the lab sidebar already writes. One Worker. */
export const CACHE_URL_KEY = "mxn-lab-api";
export const CACHE_TOKEN_KEY = "mxn-lab-token";

/**
 * Everything that decides what a run answers.
 *
 * `step` is kept as it was *given* — the literal "auto" rather than the number
 * auto resolves to. The engine's own ladder is per band, so passing a resolved
 * number where the page passed nothing is not the same search, and a cache
 * entry that quietly answered a different question would be worse than a miss.
 *
 * The vectorised angle scan (/mxn/fast/) is deliberately NOT in here: it is
 * measured row-for-row identical to the default path, and a census forces it on
 * whichever page asked. Keying on it would split one answer across two shelves.
 */
export type RunDescriptor = {
  m: number;
  n: number;
  ks: number[];
  hand: string;
  direction: string;
  shortArms: boolean;
  step: number | "auto";
  budget: number;
};

export type RunArtifact = {
  kind: "run";
  cacheVersion: string;
  descriptor: RunDescriptor;
  computedAt: string;
  /** Seconds of engine time this cost the machine that computed it. */
  seconds: number;
  runner?: string;
  /** bridge.generate()'s payload, counts firmed up. */
  result: unknown;
};

export type TraceArtifact = {
  kind: "trace";
  cacheVersion: string;
  descriptor: RunDescriptor;
  level: number;
  band: Band;
  computedAt: string;
  seconds: number;
  runner?: string;
  /** bridge.trace_plan(), or its `unavailable` reply. */
  plan: unknown;
  /** bridge.trace_census(), or its `unavailable` reply. */
  census: unknown;
};

/** One catalogue row, as /catalogue lists it. */
export type CatalogueEntry = {
  key: string;
  bytes: number;
  computedAt: string;
};

const KS_SEPARATOR = "_";

/**
 * The descriptor as a path, and the cache's whole notion of identity.
 *
 * Readable rather than hashed on purpose: a key you can read is a key you can
 * look for by hand when a run and a lab disagree about whether something is
 * cached. The Worker re-validates every segment against the shapes below, so a
 * write cannot name a key this function would not produce.
 */
export function descriptorPath(d: RunDescriptor): string {
  const ks = d.ks.map(k => String(Math.trunc(k))).join(KS_SEPARATOR);
  const flags = `s${d.shortArms ? 1 : 0}-e${d.step === "auto" ? "auto" : Math.trunc(d.step)}`
    + `-b${Math.trunc(d.budget)}`;
  return `${d.hand}-${d.direction}/${d.m}x${d.n}/${ks}/${flags}`;
}

/** The same identity for one level's one band. */
export function tracePath(d: RunDescriptor, level: number, band: string): string {
  return `${descriptorPath(d)}/L${Math.trunc(level)}-${bandKey(band)}`;
}

/**
 * The version rides in the path rather than being prefixed on the far side.
 *
 * The Worker stores what it is handed and validates the shape of it; deciding
 * WHICH shelf an answer belongs on is the engine's question, and the engine is
 * here. A version the Worker owned would have to be redeployed in step with
 * every page that reads it, and the two would drift the first time one of them
 * was not.
 */
export function runKey(d: RunDescriptor): string {
  return `${CACHE_VERSION}/${descriptorPath(d)}`;
}

export function traceKeyPath(d: RunDescriptor, level: number, band: string): string {
  return `${CACHE_VERSION}/${tracePath(d, level, band)}`;
}

/** How a descriptor reads in a sentence. */
export function describeRun(d: RunDescriptor): string {
  return `${d.m}×${d.n} · ks ${d.ks.join(" ")}`;
}

export function sameDescriptor(a: RunDescriptor, b: RunDescriptor): boolean {
  return descriptorPath(a) === descriptorPath(b);
}

// --------------------------------------------------------------------------
// Transport. The client compresses and the client decompresses, and what
// travels is opaque bytes under a header of our own.
//
// Content-Encoding would be the obvious way to do this and is the wrong one
// here: it is a hop-by-hop negotiation that a proxy, the Workers runtime and
// the browser may each rewrite, so a body that arrives already decoded and a
// body that arrives still gzipped are indistinguishable to the code reading it.
// A private header is not negotiated by anybody, which makes the round trip
// deterministic and, more to the point, testable with curl.
//
// A verdict census is a byte per (combo, angle) over a space that is two thirds
// WINDOW, so it deflates to a few per cent of itself; this is the difference
// between the widget arriving instantly and arriving after megabytes.
// --------------------------------------------------------------------------

export const CODEC_HEADER = "x-mxn-codec";

async function encode(value: unknown): Promise<{ body: Blob; codec: string }> {
  const raw = new Blob([new TextEncoder().encode(JSON.stringify(value))]);
  if (typeof CompressionStream === "undefined") return { body: raw, codec: "identity" };
  const stream = raw.stream().pipeThrough(new CompressionStream("gzip"));
  return { body: await new Response(stream).blob(), codec: "gzip" };
}

async function decode(response: Response): Promise<unknown> {
  const codec = (response.headers.get(CODEC_HEADER) || "identity").toLowerCase();
  if (codec !== "gzip") return response.json();
  if (typeof DecompressionStream === "undefined") {
    throw new Error("this browser cannot read gzipped cache entries");
  }
  const buffer = await response.arrayBuffer();
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).json();
}

// --------------------------------------------------------------------------
// Where the cache is.
// --------------------------------------------------------------------------

/**
 * localStorage, guarded.
 *
 * Same shape as the lab's own and src/model/customSamples.ts: private mode and
 * a full quota both throw, and neither is worth losing the page over.
 */
export function readSetting(key: string) {
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

export function writeSetting(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* private mode: the field simply will not persist */
  }
}

/**
 * The Worker URL to read the cache from, in order of who is most likely to be
 * right about it.
 *
 * `?cache=` wins so a URL can be tested without touching anyone's storage, and
 * `?cache=` with nothing after it turns the cache off for that load — which is
 * how you check that a page still computes what it claims to be reading.
 *
 * `data-cache` on the mount div is the site-wide default, and is what makes the
 * fast path work for a reader who has never configured anything. localStorage
 * is the operator's own, and comes first of the two because they set it.
 */
export function readCacheBase(hostId: string): string {
  try {
    const param = new URLSearchParams(window.location.search).get("cache");
    if (param !== null) return param.trim().replace(/\/+$/, "");
  } catch {
    /* no URL to read: fall through to the configured values */
  }
  const stored = readSetting(CACHE_URL_KEY).trim();
  if (stored) return stored.replace(/\/+$/, "");
  const attr = document.getElementById(hostId)?.dataset.cache?.trim() ?? "";
  return attr.replace(/\/+$/, "");
}

export function readCacheToken(): string {
  return readSetting(CACHE_TOKEN_KEY).trim();
}

export type CacheClient = {
  /** "" when nothing is configured, in which case every read answers null. */
  base: string;
  token: string;
  readable: boolean;
  writable: boolean;
  getRun(d: RunDescriptor): Promise<RunArtifact | null>;
  putRun(a: RunArtifact): Promise<number>;
  getTrace(d: RunDescriptor, level: number, band: string): Promise<TraceArtifact | null>;
  putTrace(a: TraceArtifact): Promise<number>;
  /** Whether an entry exists, without paying for its body. */
  hasRun(d: RunDescriptor): Promise<boolean>;
  hasTrace(d: RunDescriptor, level: number, band: string): Promise<boolean>;
  catalogue(prefix?: string, limit?: number): Promise<CatalogueEntry[]>;
  health(): Promise<Record<string, unknown>>;
};

/** How long a cache read may take before the page gives up and computes. */
const READ_TIMEOUT_MS = 12_000;
/** Writes carry megabytes and are nobody's critical path, so they get longer. */
const WRITE_TIMEOUT_MS = 120_000;

function withTimeout(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

export function createCache(options: { base?: string; token?: string; hostId?: string } = {}): CacheClient {
  const base = (options.base ?? readCacheBase(options.hostId ?? "lab")).replace(/\/+$/, "");
  const token = options.token ?? readCacheToken();

  const authHeaders = (): Record<string, string> =>
    token ? { Authorization: `Bearer ${token}` } : {};

  async function get(path: string): Promise<unknown | null> {
    if (!base) return null;
    const clock = withTimeout(READ_TIMEOUT_MS);
    try {
      const response = await fetch(`${base}${path}`, {
        headers: authHeaders(), signal: clock.signal,
      });
      // A miss is a 404 and is not an error: it is the ordinary state of a
      // parameter set nobody has computed yet.
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`cache read failed (HTTP ${response.status})`);
      return await decode(response);
    } finally {
      clock.done();
    }
  }

  async function head(path: string): Promise<boolean> {
    if (!base) return false;
    const clock = withTimeout(READ_TIMEOUT_MS);
    try {
      const response = await fetch(`${base}${path}`, {
        method: "HEAD", headers: authHeaders(), signal: clock.signal,
        // The farm asks this to decide whether to spend an hour, so it must be
        // the shelf's answer and not a copy the browser kept.
        cache: "no-store",
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clock.done();
    }
  }

  async function put(path: string, value: unknown): Promise<number> {
    if (!base) throw new Error("no cache URL is configured");
    if (!token) throw new Error("no admin token is configured");
    const { body, codec } = await encode(value);
    const clock = withTimeout(WRITE_TIMEOUT_MS);
    try {
      const response = await fetch(`${base}${path}`, {
        method: "PUT",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/octet-stream",
          [CODEC_HEADER]: codec,
        },
        body,
        signal: clock.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`cache write failed (HTTP ${response.status})${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
      }
      return body.size;
    } finally {
      clock.done();
    }
  }

  return {
    base,
    token,
    readable: !!base,
    writable: !!base && !!token,
    getRun: d => get(`/cache/run/${runKey(d)}`) as Promise<RunArtifact | null>,
    putRun: a => put(`/cache/run/${runKey(a.descriptor)}`, a),
    getTrace: (d, level, band) =>
      get(`/cache/trace/${traceKeyPath(d, level, band)}`) as Promise<TraceArtifact | null>,
    putTrace: a => put(`/cache/trace/${traceKeyPath(a.descriptor, a.level, a.band)}`, a),
    hasRun: d => head(`/cache/run/${runKey(d)}`),
    hasTrace: (d, level, band) => head(`/cache/trace/${traceKeyPath(d, level, band)}`),
    async catalogue(prefix = "", limit = 500) {
      const query = new URLSearchParams();
      if (prefix) query.set("prefix", prefix);
      query.set("limit", String(limit));
      const body = await get(`/catalogue?${query}`) as { entries?: CatalogueEntry[] } | null;
      return body?.entries ?? [];
    },
    async health() {
      const body = await get("/health") as Record<string, unknown> | null;
      return body ?? {};
    },
  };
}
