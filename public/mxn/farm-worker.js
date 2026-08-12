/* One hand of the compute farm at /mxn/gpu/.
 *
 * The same Python engine the lab runs, driven headlessly: given one parameter
 * set it generates the run, walks every level's solution count to exact,
 * censuses every level's two bands, and PUTs each answer to the Cloudflare
 * Worker. Then it asks for the next one.
 *
 * Several of these run at once — one per core the operator is willing to give
 * up — and each holds its own Pyodide, because a Pyodide runtime is
 * single-threaded and the search inside it is one long synchronous call. That
 * is the whole of the parallelism: there is no shared state between hands, and
 * two hands working the same job would only duplicate it.
 *
 * Uploading from in here rather than posting artifacts back to the page is
 * deliberate. A census is megabytes; sending it through postMessage would
 * structured-clone it onto the UI thread of a tab that has to stay responsive
 * for hours, to do nothing with it but forward it. Keys are built on the page
 * (src/mxn-lab/cache.ts owns what a key IS) and arrive here as finished URLs,
 * so nothing about the cache's naming is duplicated in this file.
 */
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.mjs";

let pyodide;
let initializing;
/** Where the census being run has got to, for the page's status line. */
let traceWatch = null;

self.emitProgress = (message) => self.postMessage({ type: "job-progress", message });
// A farm has no busy sheet to fill, and a candidate frame costs a deepcopy of
// the working ring plus a JSON dump. bridge.FRAME_MIN_INTERVAL is raised below
// so the engine's gate rejects them before that cost is paid; this is the
// backstop for the handful it emits unconditionally at the end of a group.
self.emitFrame = () => {};
self.emitTrace = (payload) => {
  const data = JSON.parse(payload);
  if (data.kind !== "progress" || !traceWatch) return;
  self.postMessage({
    type: "job-progress",
    message: `${traceWatch} — ${data.combosDone.toLocaleString()}`
      + ` / ${data.combos.toLocaleString()} combos`,
    fraction: data.combos ? data.combosDone / data.combos : null,
  });
};

async function prepare(fastEngine) {
  if (pyodide) return pyodide;
  if (initializing) return initializing;
  initializing = (async () => {
    self.postMessage({ type: "job-progress", message: "loading the engine…" });
    const runtime = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/",
      stdout: () => {},
      stderr: () => {},
    });
    await runtime.loadPackage("numpy");
    const names = [
      "mxn_continuation_next.py",
      "mxn_lh_continuation.py",
      "mxn_trace.py",
      "mxn_rh_continuation.py",
      "mxn_lh_strech.py",
      "mxn_rh_stretch.py",
      "ui_utils.py",
      "bridge.py",
    ];
    runtime.FS.mkdirTree("/home/py");
    await Promise.all(names.map(async (name) => {
      // Resolved against this worker's own URL, and carrying the same cache key
      // exact-worker.js uses: the two load the identical engine and a farm that
      // silently ran an older copy would fill the shelf with answers the lab
      // then disagrees with.
      const url = new URL(`./py/${name}?v=trace-plan-v19`, import.meta.url);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load ${name}`);
      runtime.FS.writeFile(`/home/py/${name}`, await response.text());
    }));
    await runtime.runPythonAsync("import sys; sys.path.insert(0, '/home/py'); import bridge");
    // Never build a candidate preview: the gate is consulted before the engine
    // deepcopies anything, so this is a real saving rather than a dropped frame.
    await runtime.runPythonAsync("bridge.FRAME_MIN_INTERVAL = 1e9");
    if (fastEngine) {
      // Measured row-for-row identical to the default path and roughly four
      // times faster (docs/mxn-lab.md), and a census forces it on regardless.
      // On a farm the default path is simply time spent for nothing.
      await runtime.runPythonAsync(
        "import mxn_lh_continuation as _lh; _lh.FAST_ANGLE_SCAN = True");
    }
    pyodide = runtime;
    return runtime;
  })();
  return initializing;
}

// --------------------------------------------------------------------------
// Uploading.
//
// The other half of src/mxn-lab/cache.ts: same gzip, same private codec header,
// same reasoning about why the encoding is ours rather than Content-Encoding's.
// --------------------------------------------------------------------------

async function encode(value) {
  const raw = new TextEncoder().encode(JSON.stringify(value));
  if (typeof CompressionStream === "undefined") return { body: raw, codec: "identity" };
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"));
  return { body: new Uint8Array(await new Response(stream).arrayBuffer()), codec: "gzip" };
}

/**
 * PUT one artifact, with a few goes at it.
 *
 * A sweep runs for hours over a domestic connection, so a single dropped
 * request is the expected case rather than the exceptional one — and losing an
 * answer that cost twenty minutes to a blip nobody saw would be the worst
 * failure this thing has. Backoff is short because the alternative to waiting
 * is recomputing.
 */
async function upload(url, token, value) {
  const { body, codec } = await encode(value);
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "x-mxn-codec": codec,
        },
        body,
      });
      if (response.ok) return body.byteLength;
      const detail = await response.text().catch(() => "");
      lastError = new Error(`HTTP ${response.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
      // 4xx is the request being wrong, and it will be just as wrong next time.
      if (response.status >= 400 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`could not store ${url.split("/").slice(-2).join("/")}: ${lastError?.message ?? "unknown"}`);
}

// --------------------------------------------------------------------------
// The job.
// --------------------------------------------------------------------------

/** How many product cells one count_solutions call walks. */
const COUNT_CHUNK = 20_000;

/** k=0 has one configuration by construction; nothing to count or page. */
function browsable(meta) {
  return meta.enumerated === "full" || !(meta.reason ?? "").startsWith("k=0");
}

async function runJob(runtime, message, post) {
  const { job, upload: targets } = message;
  const started = performance.now();
  let bytes = 0;
  let artifacts = 0;

  runtime.globals.set("mxn_m", job.m);
  runtime.globals.set("mxn_n", job.n);
  runtime.globals.set("mxn_ks", job.ks);
  runtime.globals.set("mxn_short", job.shortArms !== false);
  runtime.globals.set("mxn_step", job.step === "auto" ? null : Number(job.step));
  runtime.globals.set("mxn_budget", job.budget ?? null);
  runtime.globals.set("mxn_hand", job.hand || "lh");
  runtime.globals.set("mxn_dir", job.direction || "cw");

  post({ message: `${job.m}×${job.n} ks ${job.ks.join(" ")} — searching`, phase: "generate" });
  const result = JSON.parse(await runtime.runPythonAsync(
    "bridge.generate(mxn_m, mxn_n, mxn_ks.to_py(), mxn_hand, mxn_dir,"
    + " prefer_short_arms=mxn_short, ext_step=mxn_step, combo_budget=mxn_budget)"
  ));

  // Counts, walked all the way. This is the difference between a cached card
  // reading "1 / 2+" and reading "1 / 10,189": the lab's own in-run counting is
  // capped at 60,000 pairs so a browser tab is never held hostage, and finishing
  // what it left is exactly the kind of patience a farm has and a reader has not.
  const ceiling = Number(job.countCeiling) || 0;
  for (const meta of result.solutions ?? []) {
    if (!meta || meta.level <= 0 || !browsable(meta)) continue;
    runtime.globals.set("mxn_level", meta.level);
    let reply = null;
    let spent = 0;
    while (!reply?.countExact) {
      if (ceiling && spent >= ceiling) break;
      runtime.globals.set("mxn_count_budget", COUNT_CHUNK);
      reply = JSON.parse(await runtime.runPythonAsync(
        "bridge.count_solutions(mxn_level, mxn_count_budget)"));
      spent += COUNT_CHUNK;
      post({
        phase: "count",
        message: `L${meta.level} — ${reply.count.toLocaleString()} closed rings in `
          + `${(reply.scanned ?? 0).toLocaleString()} / ${(reply.cells ?? 0).toLocaleString()} pairs`,
        fraction: reply.cells ? (reply.scanned ?? 0) / reply.cells : null,
      });
    }
    if (reply) {
      meta.count = reply.count;
      meta.countExact = reply.countExact;
      meta.healthy = reply.healthy;
    }
  }

  const runSeconds = (performance.now() - started) / 1000;
  // A null target means the run is already on the shelf. It is still computed —
  // it is what builds the session a census replays from, so there is no way to
  // fill in a missing band without it — but it is not stored twice.
  if (targets.run) {
    bytes += await upload(targets.run, targets.token, {
      kind: "run",
      cacheVersion: targets.cacheVersion,
      descriptor: job.descriptor,
      computedAt: new Date().toISOString(),
      seconds: Number(runSeconds.toFixed(1)),
      runner: targets.runner,
      result,
    });
    artifacts += 1;
    post({ phase: "stored", message: `run stored · ${runSeconds.toFixed(1)}s` });
  } else {
    post({ phase: "stored", message: `run already stored · ${runSeconds.toFixed(1)}s replayed` });
  }

  // The level widgets. A census is a replay plus two sweeps of the level, which
  // is the single slowest thing the lab ever asks a reader to wait through, and
  // it is per level AND per band — so it is most of what a farm is for.
  if (job.wantTraces !== false) {
    for (let level = 1; level <= job.ks.length; level += 1) {
      for (const band of ["h", "v"]) {
        const url = targets.traces[`${level}:${band}`];
        if (!url) continue;
        const at = performance.now();
        traceWatch = `L${level} ${band.toUpperCase()} census`;
        runtime.globals.set("mxn_level", level);
        runtime.globals.set("mxn_band", band);
        post({ phase: "trace", message: `${traceWatch} — replaying the level` });
        let plan = null;
        let census = null;
        try {
          plan = JSON.parse(await runtime.runPythonAsync("bridge.trace_plan(mxn_level, mxn_band)"));
          // An unavailable band is a real answer and worth storing: "this level
          // solved its H band without a search" and "4×4 is over the trace
          // ceiling" both cost a replay to discover, and a reader who opens
          // that widget should be told immediately rather than made to find out.
          census = plan.unavailable
            ? plan
            : JSON.parse(await runtime.runPythonAsync("bridge.trace_census(mxn_level, mxn_band)"));
        } catch (error) {
          // One band failing must not lose the level's other band, nor the run.
          census = {
            level, band, unavailable: true,
            reason: error instanceof Error ? error.message : String(error),
          };
          plan = plan ?? census;
        } finally {
          traceWatch = null;
        }
        bytes += await upload(url, targets.token, {
          kind: "trace",
          cacheVersion: targets.cacheVersion,
          descriptor: job.descriptor,
          level, band,
          computedAt: new Date().toISOString(),
          seconds: Number(((performance.now() - at) / 1000).toFixed(1)),
          runner: targets.runner,
          plan, census,
        });
        artifacts += 1;
        post({
          phase: "stored",
          message: `L${level} ${band.toUpperCase()} census stored`
            + (census.unavailable ? ` · ${census.reason}` : ""),
        });
      }
    }
  }

  return {
    seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
    bytes,
    artifacts,
    levels: job.ks.length,
    // Enough for the page's table to say something true about what was found
    // without holding the whole result.
    rows: (result.rows ?? []).map(row => ({
      level: row.level, k: row.k, healthy: row.healthy,
      across: row.across, expected: row.expected,
    })),
    counts: (result.solutions ?? []).map(meta => ({
      level: meta.level, count: meta.count ?? null,
      countExact: meta.countExact === true, healthy: meta.healthy ?? null,
    })),
  };
}

self.onmessage = async (event) => {
  const message = event.data || {};
  const post = (payload) => self.postMessage({ type: "job-progress", hand: message.hand, ...payload });

  if (message.type === "warm") {
    try {
      await prepare(message.fastEngine !== false);
      self.postMessage({ type: "warm-ready", hand: message.hand });
    } catch (error) {
      self.postMessage({
        type: "warm-failed", hand: message.hand,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (message.type !== "job") return;
  try {
    const runtime = await prepare(message.job.fastEngine !== false);
    const summary = await runJob(runtime, message, post);
    self.postMessage({ type: "job-done", hand: message.hand, id: message.job.id, ...summary });
  } catch (error) {
    self.postMessage({
      type: "job-failed", hand: message.hand, id: message.job?.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
