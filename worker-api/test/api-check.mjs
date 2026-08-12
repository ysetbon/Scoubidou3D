/*
 * Runs the Worker, off Cloudflare.
 *
 * The dataset half of this Worker was written where Cloudflare was unreachable
 * and shipped as reviewed code whose first deploy was its first test. The cache
 * and the farm queue are a lot more surface than that was — a storage layer
 * with two backends, a key validator, an atomic claim under a lease, and a CORS
 * policy that is deliberately different for reads and writes — and none of it
 * is the kind of thing to find out about from a browser console.
 *
 * So: the real `fetch` handler, against a real SQLite (node:sqlite) behind a D1
 * shim and a Map behind an R2 shim, driven with real Request objects. Every
 * route, both storage backends, and the cases that are supposed to be refused.
 *
 *   cd worker-api && npm test          (needs Node 22+ for node:sqlite)
 *
 * What this does NOT prove is that D1 and R2 behave exactly as the shims do.
 * The SQL is real and runs against real SQLite, which is the part with teeth;
 * the shims are thin on purpose so that what they stand in for stays obvious.
 */
import { DatabaseSync } from "node:sqlite";
import { gzipSync, gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const worker = (await import(here("../.work/worker.mjs"))).default;

const TOKEN = "test-token-that-is-long-enough";
const ORIGIN = "https://ysetbon.github.io";

let failures = 0;
const ok = (what, condition, detail = "") => {
  if (condition) console.log(`ok    ${what}`);
  else {
    failures += 1;
    console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ""}`);
  }
};
const eq = (what, got, want) =>
  ok(what, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// --------------------------------------------------------------------------
// The shims.
// --------------------------------------------------------------------------

function d1(db) {
  const prepare = (sql, args = []) => ({
    bind: (...next) => prepare(sql, next.map(v => v === undefined ? null : v)),
    async first(column) {
      const row = db.prepare(sql).all(...args)[0] ?? null;
      return column && row ? row[column] : row;
    },
    async all() {
      return { results: db.prepare(sql).all(...args), success: true };
    },
    async run() {
      // RETURNING statements have to be stepped as a query or SQLite hands back
      // nothing; everything else reports its change count.
      if (/returning/i.test(sql)) {
        const rows = db.prepare(sql).all(...args);
        return { meta: { changes: rows.length }, results: rows };
      }
      const info = db.prepare(sql).run(...args);
      return { meta: { changes: Number(info.changes) } };
    },
  });
  return {
    prepare: sql => prepare(sql),
    async batch(statements) {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      return out;
    },
  };
}

function r2() {
  const held = new Map();
  return {
    async put(key, body, options) {
      held.set(key, {
        body: Buffer.from(body),
        customMetadata: options?.customMetadata ?? {},
        uploaded: new Date(),
      });
    },
    async get(key) {
      const entry = held.get(key);
      if (!entry) return null;
      return {
        arrayBuffer: async () =>
          entry.body.buffer.slice(entry.body.byteOffset, entry.body.byteOffset + entry.body.byteLength),
        customMetadata: entry.customMetadata,
        uploaded: entry.uploaded,
      };
    },
    async head(key) {
      const entry = held.get(key);
      if (!entry) return null;
      return { size: entry.body.byteLength, customMetadata: entry.customMetadata, uploaded: entry.uploaded };
    },
    async list({ prefix = "", limit = 1000 }) {
      const objects = [...held.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, limit)
        .map(([key, entry]) => ({ key, size: entry.body.byteLength, uploaded: entry.uploaded }));
      return { objects, truncated: false };
    },
    _held: held,
  };
}

function makeEnv({ withR2 = true, publicReads = true } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(here("../schema.sql"), "utf8"));
  return {
    DB: d1(db),
    ADMIN_TOKEN: TOKEN,
    ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`,
    CACHE: withR2 ? r2() : undefined,
    CACHE_PUBLIC_READS: publicReads ? "1" : "0",
    _db: db,
  };
}

const call = (env, path, init = {}) => {
  const { auth, origin, ...rest } = init;
  const headers = new Headers(rest.headers ?? {});
  if (auth !== false) headers.set("Authorization", `Bearer ${TOKEN}`);
  if (origin) headers.set("Origin", origin);
  return worker.fetch(new Request(`https://api.test${path}`, { ...rest, headers }), env);
};

const RUN_KEY = "v2/lh-cw/2x2/1_2_2/s1-eauto-b400000";
const TRACE_KEY = `${RUN_KEY}/L3-v`;
const ARTIFACT = {
  kind: "run", cacheVersion: "v2", computedAt: "2026-08-12T00:00:00Z", seconds: 2.5,
  descriptor: { m: 2, n: 2, ks: [1, 2, 2], hand: "lh", direction: "cw", shortArms: true, step: "auto", budget: 400000 },
  result: { rows: [{ level: 1, healthy: true }], stages: [], solutions: [] },
};

// --------------------------------------------------------------------------
// Auth and CORS.
// --------------------------------------------------------------------------

{
  const env = makeEnv();
  eq("no token is 401 on the dataset", (await call(env, "/solutions", { auth: false })).status, 401);
  eq("a wrong token is 401",
    (await worker.fetch(new Request("https://api.test/health", {
      headers: { Authorization: "Bearer nope" },
    }), env)).status, 401);

  const health = await call(env, "/health");
  const body = await health.json();
  ok("health proves the bindings", health.status === 200 && body.ok === true, JSON.stringify(body));
  eq("health names the artifact store", body.artifactStore, "r2");
  eq("health says reads are public", body.publicCacheReads, true);

  const known = await call(env, "/cache/run/" + RUN_KEY, { method: "OPTIONS", origin: ORIGIN });
  eq("an allowlisted origin is echoed", known.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  ok("and may write", (known.headers.get("Access-Control-Allow-Methods") ?? "").includes("PUT"));

  const stranger = await call(env, "/cache/run/" + RUN_KEY, {
    method: "OPTIONS", origin: "https://somewhere.example",
  });
  eq("an unknown origin gets the wildcard for the cache",
    stranger.headers.get("Access-Control-Allow-Origin"), "*");
  eq("and only read methods",
    stranger.headers.get("Access-Control-Allow-Methods"), "GET,HEAD,OPTIONS");
  ok("and cannot even preflight an Authorization header",
    !(stranger.headers.get("Access-Control-Allow-Headers") ?? "").includes("Authorization"));

  const strangerDataset = await call(env, "/solutions", {
    method: "OPTIONS", origin: "https://somewhere.example",
  });
  ok("the dataset is not opened to an unknown origin at all",
    strangerDataset.headers.get("Access-Control-Allow-Origin") === null);
}

// --------------------------------------------------------------------------
// The cache, over R2 and over D1, with the same expectations.
// --------------------------------------------------------------------------

for (const store of ["r2", "d1"]) {
  const env = makeEnv({ withR2: store === "r2" });
  const gz = gzipSync(Buffer.from(JSON.stringify(ARTIFACT)));

  const put = await call(env, `/cache/run/${RUN_KEY}`, {
    method: "PUT", body: gz, headers: { "X-Mxn-Codec": "gzip" },
  });
  eq(`[${store}] a run stores`, put.status, 201);

  const miss = await call(env, "/cache/run/v2/lh-cw/3x3/1/s1-eauto-b400000", { auth: false });
  eq(`[${store}] an uncomputed parameter set is a 404, not an error`, miss.status, 404);

  const hit = await call(env, `/cache/run/${RUN_KEY}`, { auth: false });
  eq(`[${store}] a public read is allowed`, hit.status, 200);
  eq(`[${store}] and says how the body is encoded`, hit.headers.get("X-Mxn-Codec"), "gzip");
  ok(`[${store}] and exposes that header cross-origin`,
    (hit.headers.get("Access-Control-Expose-Headers") ?? "").includes("X-Mxn-Codec"));
  const back = JSON.parse(gunzipSync(Buffer.from(await hit.arrayBuffer())).toString());
  eq(`[${store}] and round-trips the artifact exactly`, back, ARTIFACT);
  ok(`[${store}] and is cacheable by the browser`,
    (hit.headers.get("Cache-Control") ?? "").includes("max-age="));

  const head = await call(env, `/cache/run/${RUN_KEY}`, { method: "HEAD", auth: false });
  eq(`[${store}] HEAD answers without a body`, head.status, 200);
  eq(`[${store}] and reports the size`, head.headers.get("X-Mxn-Bytes"), String(gz.byteLength));
  eq(`[${store}] and is never served from a browser cache`,
    head.headers.get("Cache-Control"), "no-store");

  const trace = await call(env, `/cache/trace/${TRACE_KEY}`, {
    method: "PUT", body: gzipSync(Buffer.from(JSON.stringify({ kind: "trace" }))),
    headers: { "X-Mxn-Codec": "gzip" },
  });
  eq(`[${store}] a census stores under its level and band`, trace.status, 201);

  eq(`[${store}] a write without a token is refused`,
    (await call(env, `/cache/run/${RUN_KEY}`, { method: "PUT", body: gz, auth: false })).status, 401);
  eq(`[${store}] a key that is not one this repo builds is refused`,
    (await call(env, "/cache/run/v2/lh-cw/2x2/1/s1-eauto", { method: "PUT", body: gz })).status, 400);
  eq(`[${store}] a run key with a trace tail is refused`,
    (await call(env, `/cache/run/${TRACE_KEY}`, { method: "PUT", body: gz })).status, 400);
  eq(`[${store}] an unknown codec is refused`,
    (await call(env, `/cache/run/${RUN_KEY}`, {
      method: "PUT", body: gz, headers: { "X-Mxn-Codec": "brotli" },
    })).status, 400);
  eq(`[${store}] an empty body is refused`,
    (await call(env, `/cache/run/${RUN_KEY}`, { method: "PUT", body: new Uint8Array(0) })).status, 400);

  const catalogue = await (await call(env, "/catalogue?prefix=run/v2/lh-cw/2x2", { auth: false })).json();
  eq(`[${store}] the catalogue names the store`, catalogue.store, store);
  eq(`[${store}] and lists what is on the shelf`,
    catalogue.entries.map(entry => entry.key), [`run/${RUN_KEY}`]);
  eq(`[${store}] a prefix with a path escape is refused`,
    (await call(env, "/catalogue?prefix=../etc")).status, 400);
}

// D1 without R2 has a ceiling, and it has to name the fix rather than surface
// as a SQL error about an oversized value.
{
  const env = makeEnv({ withR2: false });
  const huge = Buffer.alloc(1_500_000, 7);
  const response = await call(env, `/cache/run/${RUN_KEY}`, { method: "PUT", body: huge });
  const body = await response.json();
  eq("an artifact too big for D1 is refused", response.status, 500);
  ok("and the refusal says to bind R2", /R2/.test(body.error), body.error);
}

// Reads can be closed, and then the lab falls back to computing locally.
{
  const env = makeEnv({ publicReads: false });
  await call(env, `/cache/run/${RUN_KEY}`, {
    method: "PUT", body: gzipSync(Buffer.from("{}")), headers: { "X-Mxn-Codec": "gzip" },
  });
  eq("with public reads off, an anonymous read is 401",
    (await call(env, `/cache/run/${RUN_KEY}`, { auth: false })).status, 401);
  eq("and the token still reads it",
    (await call(env, `/cache/run/${RUN_KEY}`)).status, 200);
}

// --------------------------------------------------------------------------
// The farm queue.
// --------------------------------------------------------------------------

{
  const env = makeEnv();
  const job = (ks, weight) => ({
    id: `v2/lh-cw/2x2/${ks.join("_")}/s1-eauto-b400000`,
    m: 2, n: 2, ks, hand: "lh", direction: "cw",
    shortArms: true, step: "auto", budget: 400000, weight, wantTraces: true,
  });

  const pushed = await call(env, "/farm/jobs", {
    method: "POST",
    body: JSON.stringify({ batch: "sweep-1", jobs: [job([1, 2], 484), job([1], 242)] }),
  });
  eq("a plan queues", pushed.status, 201);
  eq("and reports the batch size", (await pushed.json()).inBatch, 2);

  const again = await call(env, "/farm/jobs", {
    method: "POST", body: JSON.stringify({ batch: "sweep-1", jobs: [job([1], 242)] }),
  });
  eq("pushing the same plan again adds nothing", (await again.json()).inBatch, 2);

  eq("a job id that is not a run key is refused",
    (await call(env, "/farm/jobs", {
      method: "POST", body: JSON.stringify({ batch: "x", jobs: [{ ...job([1], 1), id: "../etc/passwd" }] }),
    })).status, 400);

  const first = await (await call(env, "/farm/claim", {
    method: "POST", body: JSON.stringify({ runner: "hand-1", batch: "sweep-1" }),
  })).json();
  eq("the cheapest job is claimed first", JSON.parse(first.job.ks), [1]);
  eq("and it is marked running", first.job.state, "running");

  const second = await (await call(env, "/farm/claim", {
    method: "POST", body: JSON.stringify({ runner: "hand-2", batch: "sweep-1" }),
  })).json();
  eq("a second hand gets a different job", JSON.parse(second.job.ks), [1, 2]);

  const empty = await (await call(env, "/farm/claim", {
    method: "POST", body: JSON.stringify({ runner: "hand-3", batch: "sweep-1" }),
  })).json();
  eq("and a third gets nothing rather than a duplicate", empty.job, null);

  eq("a finished job reports back",
    (await call(env, "/farm/jobs", {
      method: "PATCH",
      body: JSON.stringify({ id: first.job.id, state: "done", seconds: 12.5, bytes: 4096, artifacts: 7 }),
    })).status, 200);
  eq("a failed job reports back",
    (await call(env, "/farm/jobs", {
      method: "PATCH", body: JSON.stringify({ id: second.job.id, state: "failed", error: "boom" }),
    })).status, 200);
  eq("an unknown state is refused",
    (await call(env, "/farm/jobs", {
      method: "PATCH", body: JSON.stringify({ id: first.job.id, state: "elsewhere" }),
    })).status, 400);

  // A Pyodide traceback opens with the same _pyodide/_base.py frames every time
  // and names the exception on its last line, so a long one has to keep its
  // tail: clipping to the front alone stores the half that is identical on
  // every failure and drops the half that says what happened.
  const traceback = 'Traceback (most recent call last):\n'
    + '  File "/lib/python314.zip/_pyodide/_base.py", line 597, in eval_code_async\n'.repeat(40)
    + 'MemoryError: the thing that actually went wrong';
  await call(env, "/farm/jobs", {
    method: "PATCH",
    body: JSON.stringify({ id: second.job.id, state: "failed", error: traceback }),
  });
  const kept = (await (await call(env, "/farm/jobs?batch=sweep-1&state=failed")).json())
    .jobs[0].error;
  ok("a long traceback keeps the line naming the exception",
    kept.includes("MemoryError: the thing that actually went wrong"), kept.slice(-80));
  ok("and still opens where the traceback opens",
    kept.startsWith("Traceback (most recent call last):"), kept.slice(0, 60));
  ok("and is bounded rather than stored whole",
    kept.length < traceback.length && kept.length <= 1300, String(kept.length));

  const summary = (await (await call(env, "/farm/summary?batch=sweep-1")).json()).summary;
  eq("the summary counts by state",
    Object.fromEntries(summary.map(row => [row.state, row.jobs])), { done: 1, failed: 1 });
  eq("and totals what was stored",
    summary.find(row => row.state === "done").bytes, 4096);

  const requeued = await (await call(env, "/farm/requeue", {
    method: "POST", body: JSON.stringify({ batch: "sweep-1", which: "failed" }),
  })).json();
  eq("requeueing puts the failure back", requeued.requeued, 1);

  const listed = (await (await call(env, "/farm/jobs?batch=sweep-1")).json()).jobs;
  eq("and the row keeps its attempt count",
    listed.find(row => row.id === second.job.id).attempts, 1);
  eq("the queue lists both jobs", listed.length, 2);

  eq("the queue is not readable without the token",
    (await call(env, "/farm/jobs", { auth: false })).status, 401);
}

// --------------------------------------------------------------------------
// The dataset, unchanged by any of this.
// --------------------------------------------------------------------------

{
  const env = makeEnv();
  const row = {
    id: "test-1", m: 2, n: 2, level: 1, k: 1, solution_index: 0,
    parent_strands: [], solution_strands: [{ layer_name: "1_1" }],
    h_ext: [40, 10], v_ext: [40, 10],
    audit: { healthy: true, across: 16, expected: 16 },
  };
  eq("a solution stores",
    (await call(env, "/solutions", { method: "POST", body: JSON.stringify(row) })).status, 201);
  const listed = (await (await call(env, "/solutions?m=2&n=2")).json()).solutions;
  eq("and lists back", listed.length, 1);
  eq("with its total extension computed on write", listed[0].total_ext, 100);
  eq("a rating lands",
    (await call(env, "/solutions/test-1", { method: "PATCH", body: JSON.stringify({ rating: 80 }) })).status, 200);
  eq("an out-of-range rating does not",
    (await call(env, "/solutions/test-1", { method: "PATCH", body: JSON.stringify({ rating: 900 }) })).status, 400);
  eq("a half-formed row does not",
    (await call(env, "/solutions", { method: "POST", body: JSON.stringify({ m: 2 }) })).status, 400);
  eq("an unknown route is a 404",
    (await call(env, "/nowhere")).status, 404);
}

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
