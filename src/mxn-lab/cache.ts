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
 * Same job as the `trace-plan-v21` key in the worker URL, for the same reason
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

// --------------------------------------------------------------------------
// The third artifact kind: what a PERSON said about a parameter set's rings.
//
// A run is what the engine computed and a trace is one band censused; a picks
// artifact is every judgement anyone has made about that parameter set, on the
// same key grammar and the same shelf (docs/mxn-fit.md § Saving a judgement).
// One artifact per parameter set rather than one per verdict, because two keys
// — one holding the best, one holding the valid list — can disagree, and one
// key cannot: the invariants are enforced in mergeJudgement() at write time.
// --------------------------------------------------------------------------

export type Verdict = "valid" | "best" | "rejected";

/** Where a judged ring's geometry came from. A fact, so a machine may write it. */
export type JudgementSource = "fitter" | "engine" | "grid" | "hand";

/** One band of one level as a judgement pins it: the whole pick. */
export type PickBand = { ext: number[]; angle: number | null } | null;

export type Judgement = {
  id: string;
  /** What a person said. Never written by anything unattended. */
  verdict: Verdict;
  source: JudgementSource;
  /** Who said it. A judgement with no chooser is refused before it is sent. */
  chooser: string;
  at: string;
  note?: string;
  /** `(extensions, angle)` per band per level — enough to rebuild the ring. */
  levels: { level: number; h: PickBand; v: PickBand }[];
  metrics?: { neighbour_delta: number; spread: number; gap_margin: number };
  audit?: { crossings: number; expected: number; stray: number; broken: number };
  /** The judgement this one demoted from best, when marking a new best. */
  supersedes?: string;
  /** Optionally the whole ring, so /app/ can open it with no engine anywhere. */
  strands?: unknown;
  /**
   * Optionally the band plan the ring was fitted against — `bridge.fit_plan`'s
   * payload for its level, verbatim.
   *
   * `strands` makes a judgement *drawable* without an engine; this makes it
   * *editable* without one. Everything the fitter's manual panel does is
   * arithmetic over these inputs — origins, directions, pair indices, targets,
   * the angle window and the gap bounds — so with them stored, a reader can
   * open a judged ring and move it with no Pyodide anywhere. Without them the
   * only way to get a FitBand is `bridge.fit_plan`, which needs the browsing
   * session only `generate` opens, which is the whole run.
   *
   * A few KB: every field is O(arms), not O(the search grid). Judgements saved
   * before this carry none, so a reader is told to Run rather than shown knobs
   * that cannot exist.
   */
  plan?: unknown;
};

export type PicksArtifact = {
  kind: "picks";
  cacheVersion: string;
  descriptor: RunDescriptor;
  engineCommit?: string;
  runComputedAt?: string;
  judgements: Judgement[];
};

/**
 * Fold one judgement into a parameter set's artifact, holding the invariants.
 *
 * 1. At most one `best` — a new best demotes the old one to `valid` and records
 *    it in `supersedes`.
 * 2. `best` implies `valid` — a single verdict word, so this holds by shape.
 * 3. `best` and `rejected` are exclusive — rejecting the pick that is currently
 *    best replaces that best, so nothing is left pointing at a rejected ring.
 * 4. Only a person writes a verdict — a judgement with no chooser throws here,
 *    before any network is involved.
 *
 * A new judgement about the same pick replaces the old one — a judgement is
 * the last word about that ring, not a log line — and picks are compared by
 * their geometry, so re-judging a ring under a fresh id does not duplicate it.
 */
export function mergeJudgement(
  artifact: PicksArtifact | null,
  judgement: Judgement,
  descriptor: RunDescriptor,
  meta: { engineCommit?: string; runComputedAt?: string } = {},
): PicksArtifact {
  if (!judgement.chooser?.trim()) {
    throw new Error("a judgement needs a chooser — a verdict has one author, and it is a person");
  }
  if (!["valid", "best", "rejected"].includes(judgement.verdict)) {
    throw new Error(`not a verdict: ${String(judgement.verdict)}`);
  }
  const bandEq = (a: PickBand, b: PickBand) => {
    if (!a || !b) return !a === !b;
    return a.ext.length === b.ext.length
      && a.ext.every((e, i) => Math.abs(e - b.ext[i]) < 1e-6)
      && ((a.angle === null && b.angle === null)
          || (a.angle !== null && b.angle !== null && Math.abs(a.angle - b.angle) < 1e-6));
  };
  const samePick = (a: Judgement, b: Judgement) =>
    a.levels.length === b.levels.length
    && a.levels.every((la, i) => la.level === b.levels[i].level
      && bandEq(la.h, b.levels[i].h) && bandEq(la.v, b.levels[i].v));

  let kept = (artifact?.judgements ?? [])
    .filter(j => !samePick(j, judgement)).map(j => ({ ...j }));
  const next = { ...judgement };
  if (judgement.verdict === "best") {
    const old = kept.find(j => j.verdict === "best");
    if (old) next.supersedes = old.id;
    kept = kept.map(j => j.verdict === "best" ? { ...j, verdict: "valid" as Verdict } : j);
  }
  return {
    kind: "picks",
    cacheVersion: artifact?.cacheVersion ?? CACHE_VERSION,
    descriptor,
    engineCommit: meta.engineCommit ?? artifact?.engineCommit,
    runComputedAt: meta.runComputedAt ?? artifact?.runComputedAt,
    judgements: [next, ...kept],
  };
}

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

/**
 * A picks key is a run key under the `picks/` kind: the judgements are about
 * the parameter set as a whole, so they are addressed by exactly what a run is.
 */
export function picksKey(d: RunDescriptor): string {
  return `${CACHE_VERSION}/${descriptorPath(d)}`;
}

// --------------------------------------------------------------------------
// Reading a key back.
//
// The other direction of descriptorPath, and here rather than anywhere else for
// the reason the grammar itself is here: a key you can read is only useful if
// exactly one thing decides how to read it. /mxn/ks/ walks the whole catalogue
// and has nothing but the keys to say what each entry is about, and the lab's
// own findShelfVariant was already re-deriving half of this from a private
// regex. Two spellings of one grammar drift the first time either moves.
//
// Deliberately stricter than the Worker's validators in one place: the Worker
// accepts any `v\d{1,3}`, because storing something under a version it does not
// itself understand is fine. A reader cannot be so relaxed -- an artifact from
// an older engine answers a different question -- so the version comes back as
// a field for the caller to check rather than being silently accepted.
// --------------------------------------------------------------------------

/** A run key, taken apart. `cacheVersion` is whatever the key said. */
export type ParsedRunKey = { cacheVersion: string; descriptor: RunDescriptor };

/** A trace key: the same, plus which level and band it censused. */
export type ParsedTraceKey = ParsedRunKey & { level: number; band: Band };

const KEY_VERSION = /^v(\d{1,3})$/;
const KEY_HAND_DIRECTION = /^(lh|rh)-(cw|ccw)$/;
const KEY_SIZE = /^([1-9][0-9]?)x([1-9][0-9]?)$/;
const KEY_KS = /^-?\d{1,3}(_-?\d{1,3}){0,15}$/;
const KEY_FLAGS = /^s([01])-e(auto|\d{1,4})-b(\d{1,10})$/;
const KEY_LEVEL_BAND = /^L(\d{1,3})-([hv])$/;

function parseSegments(segments: string[]): ParsedRunKey | null {
  const [version, handDirection, size, ks, flags] = segments;
  const hd = KEY_HAND_DIRECTION.exec(handDirection ?? "");
  const wh = KEY_SIZE.exec(size ?? "");
  const fl = KEY_FLAGS.exec(flags ?? "");
  if (!KEY_VERSION.test(version ?? "") || !hd || !wh || !fl) return null;
  if (!KEY_KS.test(ks ?? "")) return null;
  return {
    cacheVersion: version,
    descriptor: {
      m: Number(wh[1]),
      n: Number(wh[2]),
      ks: ks.split(KS_SEPARATOR).map(Number),
      hand: hd[1],
      direction: hd[2],
      shortArms: fl[1] === "1",
      step: fl[2] === "auto" ? "auto" : Number(fl[2]),
      budget: Number(fl[3]),
    },
  };
}

/**
 * `run/v3/lh-cw/2x2/1_2_2/s1-eauto-b400000` → what produced it.
 *
 * The `run/` prefix is optional so this reads both a catalogue key, which
 * carries it, and the path runKey() builds, which does not.
 */
export function parseRunKey(key: string): ParsedRunKey | null {
  const segments = key.replace(/^\/+/, "").split("/");
  if (segments[0] === "run") segments.shift();
  if (segments.length !== 5) return null;
  return parseSegments(segments);
}

/** The same for `picks/…` — a run key under the judgements' own kind. */
export function parsePicksKey(key: string): ParsedRunKey | null {
  const segments = key.replace(/^\/+/, "").split("/");
  if (segments[0] === "picks") segments.shift();
  if (segments.length !== 5) return null;
  return parseSegments(segments);
}

/** The same for `trace/…/L3-v`. */
export function parseTraceKey(key: string): ParsedTraceKey | null {
  const segments = key.replace(/^\/+/, "").split("/");
  if (segments[0] === "trace") segments.shift();
  if (segments.length !== 6) return null;
  const lb = KEY_LEVEL_BAND.exec(segments[5]);
  if (!lb) return null;
  const parsed = parseSegments(segments.slice(0, 5));
  return parsed && { ...parsed, level: Number(lb[1]), band: lb[2] as Band };
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
  getPicks(d: RunDescriptor): Promise<PicksArtifact | null>;
  putPicks(a: PicksArtifact): Promise<number>;
  /** Whether an entry exists, without paying for its body. */
  hasRun(d: RunDescriptor): Promise<boolean>;
  hasTrace(d: RunDescriptor, level: number, band: string): Promise<boolean>;
  hasPicks(d: RunDescriptor): Promise<boolean>;
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
    getPicks: d => get(`/cache/picks/${picksKey(d)}`) as Promise<PicksArtifact | null>,
    putPicks: a => put(`/cache/picks/${picksKey(a.descriptor)}`, a),
    hasRun: d => head(`/cache/run/${runKey(d)}`),
    hasTrace: (d, level, band) => head(`/cache/trace/${traceKeyPath(d, level, band)}`),
    hasPicks: d => head(`/cache/picks/${picksKey(d)}`),
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
