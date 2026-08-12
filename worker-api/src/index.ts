/**
 * Dataset API and result cache for the MXN Continuation Lab.
 *
 * The lab is a static GitHub Pages site with no server, so this Worker is the
 * only place its work can be kept. It now does three things:
 *
 *   /solutions  holds rated rings — starred by hand, scored at /mxn/rate/ and
 *               /mxn/semi/. One writer, one token, no login.
 *   /cache      holds computed geometry: a run's whole result, and one level's
 *               one band traced. Written by /mxn/gpu/, read by /mxn/ so a page
 *               that would have spent twenty seconds in Pyodide spends one
 *               fetch instead.
 *   /farm       the queue /mxn/gpu/ works through, so an hours-long sweep can
 *               be closed, reopened, resumed and split across machines.
 *
 * Auth is a single bearer token, because there is exactly one writer. Every
 * write requires it, and so does every read of the dataset. Cache reads are the
 * one exception and are open by default: they are derived from a published
 * engine over published parameters, and the point of them is that a reader who
 * has configured nothing still gets the fast page. Set CACHE_PUBLIC_READS = "0"
 * to close them and the lab falls back to computing locally, which is what it
 * did before this existed.
 */

export interface Env {
  DB: D1Database;
  ADMIN_TOKEN: string;
  /** Comma-separated origins allowed to call this. */
  ALLOWED_ORIGINS?: string;
  /**
   * Optional artifact store. Present: every cache entry lives in R2, which has
   * no practical size ceiling. Absent: entries live in D1 as base64 text, which
   * measures as enough for every size the lab will run and says so loudly on
   * the day it is not.
   */
  CACHE?: R2Bucket;
  /** "0" closes cache reads behind the token. Anything else leaves them open. */
  CACHE_PUBLIC_READS?: string;
}

const DEFAULT_ORIGINS = "https://ysetbon.github.io,http://localhost:5173";

// D1 caps a single value at 2,000,000 bytes. base64 costs a third on top, so
// this is the largest gzipped artifact the no-R2 path can hold. Checked before
// the insert so the failure names the fix rather than surfacing as a SQL error.
//
// Nothing the lab will run is near it: the biggest census it will compute is a
// 3x3's, which is 3.1 MB of JSON and 48 kB once gzipped, because two thirds of
// a verdict grid is the same value repeated.
const D1_ARTIFACT_LIMIT = 1_400_000;

// How long a claimed farm job is held before another runner may take it. Long
// enough for a 4×4 census, short enough that a machine that went to sleep
// mid-run does not strand the queue.
const DEFAULT_LEASE_SECONDS = 3600;

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS)
    .split(",").map(value => value.trim()).filter(Boolean);
}

function publicReads(env: Env): boolean {
  return (env.CACHE_PUBLIC_READS ?? "1") !== "0";
}

/**
 * Echo the caller's origin when it is allowlisted; fall back to a read-only
 * wildcard for the cache.
 *
 * A blanket wildcard would let any page a browser happens to load read the
 * dataset with a token it stole from elsewhere. But the cache is meant to be
 * read by anyone, so an unknown origin gets `*` with the methods and headers
 * cut down to what a read needs — no Authorization in the allowed set, so a
 * cross-origin write cannot even be preflighted from there.
 */
function corsHeaders(request: Request, env: Env, openToAnyone = false): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Max-Age": "86400",
    // The codec is not a CORS-safelisted response header, so without this the
    // reader cannot tell a gzipped body from a plain one and every cross-origin
    // read fails to parse.
    "Access-Control-Expose-Headers": "X-Mxn-Codec,X-Mxn-Bytes,X-Mxn-Computed-At",
    Vary: "Origin",
  };
  if (origin && allowedOrigins(env).includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET,HEAD,POST,PUT,PATCH,OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization,X-Mxn-Codec";
  } else if (openToAnyone) {
    headers["Access-Control-Allow-Origin"] = "*";
    headers["Access-Control-Allow-Methods"] = "GET,HEAD,OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return headers;
}

function json(body: unknown, status: number, request: Request, env: Env, open = false) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request, env, open) },
  });
}

/**
 * Constant-time-ish comparison.
 *
 * Not a meaningful defence for a single-user token over the public internet,
 * but comparing with === leaks length and prefix through timing for free, and
 * avoiding that costs nothing.
 */
function tokenMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i += 1) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function authorised(request: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  const header = request.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return tokenMatches(header.slice(prefix.length), env.ADMIN_TOKEN);
}

type Incoming = Record<string, unknown>;

function asArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
}

// ---------------------------------------------------------------------------
// The cache.
//
// A key is the parameters that produced the answer, spelled out. Every segment
// is checked against the shape src/mxn-lab/cache.ts builds, so a token holder
// cannot scribble an arbitrary object name into the bucket by hand -- a typo
// in a client is a 400 rather than an entry nothing will ever look for.
// ---------------------------------------------------------------------------

const SEG_VERSION = /^v\d{1,3}$/;
const SEG_HAND_DIRECTION = /^(lh|rh)-(cw|ccw)$/;
const SEG_SIZE = /^[1-9][0-9]?x[1-9][0-9]?$/;
const SEG_KS = /^-?\d{1,3}(_-?\d{1,3}){0,15}$/;
const SEG_FLAGS = /^s[01]-e(auto|\d{1,4})-b\d{1,10}$/;
const SEG_LEVEL_BAND = /^L\d{1,3}-[hv]$/;

/** The storage key for a validated cache path, or null if it is not one. */
function cacheKey(kind: "run" | "trace", segments: string[]): string | null {
  const wanted = kind === "run" ? 5 : 6;
  if (segments.length !== wanted) return null;
  const [version, handDirection, size, ks, flags, levelBand] = segments;
  if (!SEG_VERSION.test(version)) return null;
  if (!SEG_HAND_DIRECTION.test(handDirection)) return null;
  if (!SEG_SIZE.test(size)) return null;
  if (!SEG_KS.test(ks)) return null;
  if (!SEG_FLAGS.test(flags)) return null;
  if (kind === "trace" && !SEG_LEVEL_BAND.test(levelBand)) return null;
  return `${kind}/${segments.join("/")}`;
}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  // Chunked: String.fromCharCode.apply over a megabyte-long array blows the
  // argument limit, and a per-byte loop over the same is measurably slower.
  for (let at = 0; at < view.length; at += 8192) {
    binary += String.fromCharCode(...view.subarray(at, at + 8192));
  }
  return btoa(binary);
}

function fromBase64(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

type StoredArtifact = { body: ArrayBuffer; codec: string; computedAt: string };

async function readArtifact(env: Env, key: string): Promise<StoredArtifact | null> {
  if (env.CACHE) {
    const object = await env.CACHE.get(key);
    if (!object) return null;
    return {
      body: await object.arrayBuffer(),
      codec: object.customMetadata?.codec ?? "identity",
      computedAt: object.customMetadata?.computedAt ?? object.uploaded.toISOString(),
    };
  }
  const row = await env.DB.prepare(
    "SELECT codec, computed_at, body FROM cache_entries WHERE key = ?1"
  ).bind(key).first<{ codec: string; computed_at: string; body: string }>();
  if (!row) return null;
  return { body: fromBase64(row.body), codec: row.codec, computedAt: row.computed_at };
}

/** Existence and size, without paying for the body. The farm asks this a lot. */
async function statArtifact(env: Env, key: string) {
  if (env.CACHE) {
    const object = await env.CACHE.head(key);
    if (!object) return null;
    return {
      bytes: object.size,
      codec: object.customMetadata?.codec ?? "identity",
      computedAt: object.customMetadata?.computedAt ?? object.uploaded.toISOString(),
    };
  }
  const row = await env.DB.prepare(
    "SELECT codec, bytes, computed_at FROM cache_entries WHERE key = ?1"
  ).bind(key).first<{ codec: string; bytes: number; computed_at: string }>();
  if (!row) return null;
  return { bytes: row.bytes, codec: row.codec, computedAt: row.computed_at };
}

async function writeArtifact(env: Env, key: string, body: ArrayBuffer, codec: string) {
  const computedAt = new Date().toISOString();
  if (env.CACHE) {
    await env.CACHE.put(key, body, {
      customMetadata: { codec, computedAt },
      httpMetadata: { contentType: "application/octet-stream" },
    });
    return { bytes: body.byteLength, computedAt };
  }
  if (body.byteLength > D1_ARTIFACT_LIMIT) {
    throw new Error(
      `artifact is ${body.byteLength} bytes; D1 holds at most ${D1_ARTIFACT_LIMIT}. `
      + "Bind an R2 bucket as CACHE (see worker-api/README.md) and redeploy."
    );
  }
  await env.DB.prepare(
    `INSERT OR REPLACE INTO cache_entries (key, codec, bytes, computed_at, body)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  ).bind(key, codec, body.byteLength, computedAt, toBase64(body)).run();
  return { bytes: body.byteLength, computedAt };
}

async function serveArtifact(key: string, request: Request, env: Env, open: boolean) {
  const headers = corsHeaders(request, env, open);
  if (request.method === "HEAD") {
    const stat = await statArtifact(env, key);
    if (!stat) return new Response(null, { status: 404, headers });
    return new Response(null, {
      status: 200,
      headers: {
        ...headers,
        "X-Mxn-Codec": stat.codec,
        "X-Mxn-Bytes": String(stat.bytes),
        "X-Mxn-Computed-At": stat.computedAt,
        "Cache-Control": "no-store",
      },
    });
  }
  const stored = await readArtifact(env, key);
  if (!stored) return json({ error: "not cached" }, 404, request, env, open);
  return new Response(stored.body, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "application/octet-stream",
      "X-Mxn-Codec": stored.codec,
      "X-Mxn-Bytes": String(stored.body.byteLength),
      "X-Mxn-Computed-At": stored.computedAt,
      // The key names every input, so the only thing that can change a body is
      // a recompute of the same parameters -- which the cache version in the
      // key is there to make unnecessary. An hour fresh keeps a deliberate
      // recompute from being invisible for a week; the stale window is what
      // makes the second visit instant.
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=604800",
    },
  });
}

async function storeArtifact(key: string, request: Request, env: Env) {
  const codec = (request.headers.get("X-Mxn-Codec") || "identity").toLowerCase();
  if (codec !== "gzip" && codec !== "identity") {
    return json({ error: "X-Mxn-Codec must be gzip or identity" }, 400, request, env);
  }
  const body = await request.arrayBuffer();
  if (!body.byteLength) return json({ error: "empty body" }, 400, request, env);
  const written = await writeArtifact(env, key, body, codec);
  return json({ key, ...written }, 201, request, env);
}

/** What is on the shelf, for the farm's resume check and the lab's status. */
async function listCatalogue(request: Request, env: Env, open: boolean) {
  const params = new URL(request.url).searchParams;
  const raw = params.get("prefix") ?? "";
  // Exactly the alphabet a key is built from, which notably has no dot in it —
  // so "../" is refused by the character set rather than by a special case, and
  // a prefix cannot name anything a key could not be.
  if (!/^[A-Za-z0-9_\-/]{0,200}$/.test(raw)) {
    return json({ error: "bad prefix" }, 400, request, env, open);
  }
  const limit = Math.min(Math.max(Number(params.get("limit")) || 500, 1), 1000);
  const prefix = raw.replace(/^\/+/, "");

  if (env.CACHE) {
    // `uploaded` rather than the customMetadata stamp: a listing does not fetch
    // metadata unless it is asked to, and when an entry was stored is close
    // enough to when it was computed for a catalogue. The exact stamp travels
    // inside the artifact, which is where anything that cares reads it.
    const listing = await env.CACHE.list({ prefix, limit });
    return json({
      store: "r2",
      truncated: listing.truncated,
      entries: listing.objects.map(object => ({
        key: object.key,
        bytes: object.size,
        computedAt: object.uploaded.toISOString(),
      })),
    }, 200, request, env, open);
  }
  // LIKE on the primary key uses its index, and _ and % are the only
  // metacharacters -- underscores are all over a ks segment, so they are
  // escaped rather than left to match any character.
  const pattern = `${prefix.replace(/[\\%_]/g, m => `\\${m}`)}%`;
  const rows = await env.DB.prepare(
    `SELECT key, bytes, computed_at AS computedAt FROM cache_entries
      WHERE key LIKE ?1 ESCAPE '\\' ORDER BY key LIMIT ${limit}`
  ).bind(pattern).all();
  return json({ store: "d1", truncated: false, entries: rows.results ?? [] },
    200, request, env, open);
}

// ---------------------------------------------------------------------------
// The farm queue.
//
// /mxn/gpu/ plans a sweep, pushes one row per parameter set, and then claims
// them one at a time. The queue is what makes the sweep survivable: a closed
// tab, a reboot or a second machine all pick up where the first left off,
// because the state of the work is here rather than in a page's memory.
//
// A job's id IS its cache key, so pushing the same plan twice adds nothing and
// a job that finished can be recognised without asking what it produced.
// ---------------------------------------------------------------------------

type JobRow = Record<string, unknown>;

function jobId(body: Incoming): string | null {
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return null;
  const segments = id.split("/");
  return cacheKey("run", segments) ? id : null;
}

async function pushJobs(request: Request, env: Env) {
  let body: Incoming;
  try {
    body = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, 400, request, env);
  }
  const batch = typeof body.batch === "string" && body.batch ? body.batch : "default";
  const jobs = Array.isArray(body.jobs) ? body.jobs as Incoming[] : [];
  if (!jobs.length) return json({ error: "jobs must be a non-empty array" }, 400, request, env);
  if (jobs.length > 250) return json({ error: "at most 250 jobs per request" }, 400, request, env);

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const job of jobs) {
    const id = jobId(job);
    if (!id) return json({ error: `bad job id: ${String(job.id).slice(0, 120)}` }, 400, request, env);
    // INSERT OR IGNORE, not REPLACE: re-pushing a plan must not reset the state
    // of a job that has already run, which is the whole of how resume works.
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO farm_jobs
         (id, batch, created_at, m, n, ks, hand, direction, short_arms, ext_step,
          combo_budget, levels, weight, want_traces, state, attempts)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'pending', 0)`
    ).bind(
      id, batch, now,
      Number(job.m) || 0, Number(job.n) || 0,
      JSON.stringify(asArray(job.ks)),
      typeof job.hand === "string" ? job.hand : "lh",
      typeof job.direction === "string" ? job.direction : "cw",
      job.shortArms === false ? 0 : 1,
      job.step === null || job.step === undefined ? "auto" : String(job.step),
      Number(job.budget) || 0,
      asArray(job.ks).length,
      Number(job.weight) || 0,
      job.wantTraces === false ? 0 : 1,
    ));
  }
  await env.DB.batch(statements);
  const counted = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM farm_jobs WHERE batch = ?1"
  ).bind(batch).first<{ n: number }>();
  return json({ batch, pushed: jobs.length, inBatch: counted?.n ?? 0 }, 201, request, env);
}

/**
 * Take the next job, atomically.
 *
 * One UPDATE with a subselect, so two runners racing cannot both win the same
 * row: SQLite applies the statement as a unit, and the second one's subselect
 * no longer sees a job whose state the first has already moved.
 *
 * A running job whose lease has expired is claimable again. That is the only
 * recovery a machine that went to sleep mid-census gets, and it is enough.
 * Cheapest first, so an overnight sweep has something to show early rather than
 * spending its first hour on the one 4×4 in the plan.
 */
async function claimJob(request: Request, env: Env) {
  let body: Incoming = {};
  try {
    body = await request.json();
  } catch {
    /* an empty claim is fine: the runner name and lease both have defaults */
  }
  const runner = (typeof body.runner === "string" && body.runner ? body.runner : "anonymous").slice(0, 64);
  const lease = Math.min(Math.max(Number(body.lease) || DEFAULT_LEASE_SECONDS, 60), 86_400);
  const batch = typeof body.batch === "string" && body.batch ? body.batch : null;
  const now = new Date();
  const nowText = now.toISOString();
  const until = new Date(now.getTime() + lease * 1000).toISOString();

  const row = await env.DB.prepare(
    `UPDATE farm_jobs
        SET state = 'running', runner = ?1, lease_until = ?2,
            attempts = attempts + 1, started_at = COALESCE(started_at, ?3),
            error = NULL
      WHERE id = (
        SELECT id FROM farm_jobs
         WHERE (state = 'pending' OR (state = 'running' AND lease_until < ?3))
           AND (?4 IS NULL OR batch = ?4)
         ORDER BY weight ASC, levels ASC, created_at ASC
         LIMIT 1)
      RETURNING *`
  ).bind(runner, until, nowText, batch).first<JobRow>();

  if (!row) return json({ job: null }, 200, request, env);
  return json({ job: row, leaseUntil: until }, 200, request, env);
}

/**
 * Report a job finished, failed, or back on the queue.
 *
 * The id travels in the body rather than the path because it IS a path — five
 * slash-separated segments — and an id percent-encoded into a URL is at the
 * mercy of every hop that might normalise %2F back into a separator on the way.
 */
async function reportJob(request: Request, env: Env) {
  let body: Incoming;
  try {
    body = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, 400, request, env);
  }
  const id = jobId(body);
  if (!id) return json({ error: "bad job id" }, 400, request, env);
  const state = String(body.state ?? "");
  if (!["pending", "done", "failed"].includes(state)) {
    return json({ error: "state must be pending, done or failed" }, 400, request, env);
  }
  const result = await env.DB.prepare(
    `UPDATE farm_jobs
        SET state = ?1, finished_at = ?2, seconds = ?3, bytes = ?4,
            artifacts = ?5, error = ?6, lease_until = NULL
      WHERE id = ?7`
  ).bind(
    state,
    state === "pending" ? null : new Date().toISOString(),
    Number.isFinite(Number(body.seconds)) ? Number(body.seconds) : null,
    Number.isFinite(Number(body.bytes)) ? Number(body.bytes) : null,
    Number.isFinite(Number(body.artifacts)) ? Number(body.artifacts) : null,
    typeof body.error === "string" ? body.error.slice(0, 500) : null,
    id,
  ).run();
  if (!result.meta.changes) return json({ error: "not found" }, 404, request, env);
  return json({ id, state }, 200, request, env);
}

async function listJobs(request: Request, env: Env) {
  const params = new URL(request.url).searchParams;
  const where: string[] = [];
  const binds: unknown[] = [];
  const batch = params.get("batch");
  if (batch) { where.push(`batch = ?${binds.length + 1}`); binds.push(batch); }
  const state = params.get("state");
  if (state && ["pending", "running", "done", "failed"].includes(state)) {
    where.push(`state = ?${binds.length + 1}`); binds.push(state);
  }
  const limit = Math.min(Math.max(Number(params.get("limit")) || 200, 1), 1000);
  const rows = await env.DB.prepare(
    `SELECT * FROM farm_jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY state = 'running' DESC, weight ASC, created_at ASC LIMIT ${limit}`
  ).bind(...binds).all();
  return json({ jobs: rows.results ?? [] }, 200, request, env);
}

async function summariseJobs(request: Request, env: Env) {
  const batch = new URL(request.url).searchParams.get("batch");
  const rows = await env.DB.prepare(
    `SELECT batch, state, COUNT(*) AS jobs, SUM(COALESCE(seconds, 0)) AS seconds,
            SUM(COALESCE(bytes, 0)) AS bytes, SUM(COALESCE(artifacts, 0)) AS artifacts
       FROM farm_jobs ${batch ? "WHERE batch = ?1" : ""}
      GROUP BY batch, state ORDER BY batch, state`
  ).bind(...(batch ? [batch] : [])).all();
  return json({ summary: rows.results ?? [] }, 200, request, env);
}

/**
 * Put jobs back on the queue.
 *
 * Not a delete: a failed job is a fact about a parameter set and the error it
 * carries is the only record of why. Requeueing keeps the row and the attempt
 * count, so a job that has failed four times is visibly different from one
 * nobody has tried.
 */
async function requeueJobs(request: Request, env: Env) {
  let body: Incoming = {};
  try {
    body = await request.json();
  } catch {
    /* everything below has a default */
  }
  const batch = typeof body.batch === "string" && body.batch ? body.batch : null;
  const which = String(body.which ?? "failed");
  if (!["failed", "running", "all"].includes(which)) {
    return json({ error: "which must be failed, running or all" }, 400, request, env);
  }
  const states = which === "all" ? ["failed", "running"] : [which];
  const placeholders = states.map((_, at) => `?${at + 1}`).join(",");
  const result = await env.DB.prepare(
    `UPDATE farm_jobs SET state = 'pending', lease_until = NULL, runner = NULL
      WHERE state IN (${placeholders})${batch ? ` AND batch = ?${states.length + 1}` : ""}`
  ).bind(...states, ...(batch ? [batch] : [])).run();
  return json({ requeued: result.meta.changes ?? 0 }, 200, request, env);
}

// ---------------------------------------------------------------------------
// The rated-solutions dataset. Unchanged.
// ---------------------------------------------------------------------------

/** Reject anything that would store a half-formed row. */
function validate(body: Incoming): string | null {
  for (const field of ["m", "n", "level", "k", "solution_index"]) {
    if (!Number.isInteger(body[field] as number)) return `${field} must be an integer`;
  }
  if (!body.parent_strands || !body.solution_strands) {
    return "parent_strands and solution_strands are both required";
  }
  if (!Array.isArray(body.parent_strands) || !Array.isArray(body.solution_strands)) {
    return "parent_strands and solution_strands must be arrays";
  }
  if (!body.audit || typeof body.audit !== "object") return "audit is required";
  return null;
}

async function createSolution(request: Request, env: Env) {
  let body: Incoming;
  try {
    body = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, 400, request, env);
  }
  const invalid = validate(body);
  if (invalid) return json({ error: invalid }, 400, request, env);

  const hExt = asArray(body.h_ext);
  const vExt = asArray(body.v_ext);
  const audit = body.audit as Record<string, unknown>;
  const id = typeof body.id === "string" && body.id ? body.id : crypto.randomUUID();

  // A row is a near-miss only if it says so. Anything written by a page that
  // predates near-misses is a closed ring, which is what the column default
  // already says — stating it here keeps INSERT OR REPLACE from blanking it.
  const kind = body.kind === "semi" ? "semi" : "complete";
  const band = kind === "semi" && (body.band === "h" || body.band === "v")
    ? body.band : null;
  const deficit = Number.isInteger(body.deficit as number)
    ? Math.max(0, body.deficit as number) : 0;
  const refs = Number.isInteger(body.refs as number)
    ? Math.max(0, body.refs as number) : 0;

  await env.DB.prepare(
    `INSERT OR REPLACE INTO solutions
       (id, created_at, hand, direction, m, n, level, k, ks_prefix,
        parent_strands, solution_strands, h_ext, v_ext, total_ext,
        audit, healthy, solution_index, kind, band, deficit, refs,
        rating, rated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
             ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)`
  ).bind(
    id,
    (body.created_at as string) || new Date().toISOString(),
    (body.hand as string) || "lh",
    (body.direction as string) || "cw",
    body.m, body.n, body.level, body.k,
    JSON.stringify(body.ks_prefix ?? []),
    JSON.stringify(body.parent_strands),
    JSON.stringify(body.solution_strands),
    JSON.stringify(hExt),
    JSON.stringify(vExt),
    hExt.concat(vExt).reduce((sum, value) => sum + value, 0),
    JSON.stringify(audit),
    audit.healthy ? 1 : 0,
    body.solution_index,
    kind, band, deficit, refs,
    Number.isInteger(body.rating as number) ? body.rating : null,
    Number.isInteger(body.rating as number) ? new Date().toISOString() : null,
  ).run();

  return json({ id }, 201, request, env);
}

async function listSolutions(request: Request, env: Env) {
  const params = new URL(request.url).searchParams;
  const where: string[] = [];
  const binds: unknown[] = [];
  for (const field of ["m", "n", "k", "level"]) {
    const raw = params.get(field);
    if (raw !== null && Number.isInteger(Number(raw))) {
      where.push(`${field} = ?${binds.length + 1}`);
      binds.push(Number(raw));
    }
  }
  if (params.get("unrated") === "1") where.push("rating IS NULL");
  if (params.get("healthy") === "1") where.push("healthy = 1");
  const kind = params.get("kind");
  if (kind === "semi" || kind === "complete") {
    where.push(`kind = ?${binds.length + 1}`);
    binds.push(kind);
  }
  const band = params.get("band");
  if (band === "h" || band === "v") {
    where.push(`band = ?${binds.length + 1}`);
    binds.push(band);
  }

  const limit = Math.min(Math.max(Number(params.get("limit")) || 100, 1), 500);
  // Closed rings sort shortest first; near-misses sort by how near they came,
  // because a ring one crossing short is the one most worth a person's eyes.
  // Both columns exist precisely so neither ordering is a JSON scan.
  const order = kind === "semi"
    ? "deficit ASC, total_ext ASC, created_at ASC"
    : "total_ext ASC, created_at ASC";
  const rows = await env.DB.prepare(
    `SELECT id, created_at, m, n, level, k, ks_prefix, h_ext, v_ext, total_ext,
            audit, healthy, solution_index, kind, band, deficit, refs, rating
       FROM solutions
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY ${order}
       LIMIT ${limit}`
  ).bind(...binds).all();

  return json({ solutions: rows.results ?? [] }, 200, request, env);
}

async function getSolution(id: string, request: Request, env: Env) {
  const row = await env.DB.prepare("SELECT * FROM solutions WHERE id = ?1")
    .bind(id).first();
  if (!row) return json({ error: "not found" }, 404, request, env);
  return json({ solution: row }, 200, request, env);
}

async function rateSolution(id: string, request: Request, env: Env) {
  let body: Incoming;
  try {
    body = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, 400, request, env);
  }
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 0 || rating > 100) {
    return json({ error: "rating must be an integer 0..100" }, 400, request, env);
  }
  const result = await env.DB.prepare(
    "UPDATE solutions SET rating = ?1, rated_at = ?2 WHERE id = ?3"
  ).bind(rating, new Date().toISOString(), id).run();

  if (!result.meta.changes) return json({ error: "not found" }, 404, request, env);
  return json({ id, rating }, 200, request, env);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const reading = request.method === "GET" || request.method === "HEAD";
    const cacheRoute = path.startsWith("/cache/") || path === "/catalogue";
    // Open to anyone means open to READ. Every write still needs the token,
    // including a write to a key that anyone may read back.
    const openRoute = publicReads(env) && cacheRoute;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env, openRoute) });
    }

    if (!(openRoute && reading) && !authorised(request, env)) {
      return json({ error: "unauthorised" }, 401, request, env, openRoute);
    }

    try {
      if (path === "/health") {
        // Proves the bindings work, not just that the Worker booted.
        const probe = await env.DB.prepare("SELECT COUNT(*) AS n FROM solutions").first();
        const queued = await env.DB.prepare(
          "SELECT state, COUNT(*) AS n FROM farm_jobs GROUP BY state"
        ).all().catch(() => ({ results: [] as unknown[] }));
        return json({
          ok: true,
          solutions: probe?.n ?? 0,
          artifactStore: env.CACHE ? "r2" : "d1",
          publicCacheReads: publicReads(env),
          farm: queued.results ?? [],
        }, 200, request, env);
      }

      // ---- the cache -----------------------------------------------------
      if (path.startsWith("/cache/run/") || path.startsWith("/cache/trace/")) {
        const kind = path.startsWith("/cache/run/") ? "run" as const : "trace" as const;
        const rest = path.slice(`/cache/${kind}/`.length).split("/");
        const key = cacheKey(kind, rest);
        if (!key) return json({ error: "bad cache key" }, 400, request, env, openRoute);
        if (reading) return await serveArtifact(key, request, env, openRoute);
        if (request.method === "PUT") return await storeArtifact(key, request, env);
        return json({ error: "method not allowed" }, 405, request, env, openRoute);
      }
      if (path === "/catalogue" && reading) {
        return await listCatalogue(request, env, openRoute);
      }

      // ---- the farm queue -------------------------------------------------
      if (path === "/farm/jobs" && request.method === "POST") return await pushJobs(request, env);
      if (path === "/farm/jobs" && request.method === "GET") return await listJobs(request, env);
      if (path === "/farm/claim" && request.method === "POST") return await claimJob(request, env);
      if (path === "/farm/summary" && request.method === "GET") return await summariseJobs(request, env);
      if (path === "/farm/requeue" && request.method === "POST") return await requeueJobs(request, env);
      if (path === "/farm/jobs" && request.method === "PATCH") return await reportJob(request, env);

      // ---- the rated dataset ----------------------------------------------
      if (path === "/solutions" && request.method === "POST") {
        return await createSolution(request, env);
      }
      if (path === "/solutions" && request.method === "GET") {
        return await listSolutions(request, env);
      }
      const match = path.match(/^\/solutions\/([^/]+)$/);
      if (match && request.method === "GET") {
        return await getSolution(decodeURIComponent(match[1]), request, env);
      }
      if (match && request.method === "PATCH") {
        return await rateSolution(decodeURIComponent(match[1]), request, env);
      }
      return json({ error: "not found" }, 404, request, env, openRoute);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Surfaced rather than swallowed: the most likely cause by far is that
      // schema.sql has not been applied to this database yet.
      return json({ error: message }, 500, request, env, openRoute);
    }
  },
};
