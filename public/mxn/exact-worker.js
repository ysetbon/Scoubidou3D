/* Runs the repository's Python geometry engine off the UI thread. */
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.mjs";
let pyodide;
let initializing;
let activeGenerationId = 0;

self.emitProgress = (message) => self.postMessage({ type: "progress", message });
self.emitFrame = (payload) => self.postMessage({
  type: "candidate",
  id: activeGenerationId,
  ...JSON.parse(payload),
});
// A trace is two long synchronous calls, so it speaks from inside them: the
// plan the moment the band search hands its grid over, then where the census
// has got to. `kind` says which; the page routes on the message type.
self.emitTrace = (payload) => {
  const data = JSON.parse(payload);
  self.postMessage({
    type: data.kind === "plan" ? "trace-plan-ready" : "trace-progress",
    id: activeGenerationId,
    ...data,
  });
};

async function prepare() {
  if (pyodide) return pyodide;
  if (initializing) return initializing;
  initializing = (async () => {
    self.postMessage({ type: "progress", message: "Loading the exact MXN engine…" });
    const runtime = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/",
      stdout: () => {},
      stderr: (line) => self.postMessage({ type: "engine-log", message: line }),
    });
    self.postMessage({ type: "progress", message: "Loading the numerical search kernel…" });
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
      // Resolved against this worker's own URL rather than the site root: the
      // lab is published under a project-site sub-path, where "/py/..." would
      // miss. Keeps the cache key in step with the one in the Worker URL.
      const url = new URL(`./py/${name}?v=trace-plan-v30`, import.meta.url);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load ${name}`);
      runtime.FS.writeFile(`/home/py/${name}`, await response.text());
    }));
    await runtime.runPythonAsync("import sys; sys.path.insert(0, '/home/py'); import bridge");
    // /mxn/fast/ passes engine=fast on this worker's own URL. It selects the
    // vectorised angle scan, which returns the same winner as the default path
    // (verified against the docs/mxn-lab.md oracle) with the per-angle Python
    // loop batched. Nothing else about the run changes.
    if (new URL(self.location.href).searchParams.get("engine") === "fast") {
      await runtime.runPythonAsync(
        "import mxn_lh_continuation as _lh; _lh.FAST_ANGLE_SCAN = True");
      self.postMessage({ type: "progress", message: "Vectorised angle scan enabled." });
    }
    pyodide = runtime;
    // The counting hands can load their own runtimes while the reader is
    // still parameterising; by the first run they are already warm.
    ensureCountPool();
    return runtime;
  })();
  return initializing;
}

// The counting hands: sibling workers that each walk one contiguous slice of
// a level's pair product. Spawned once and kept; each holds its own Pyodide,
// so the pool is small and warmed while the engine itself is still loading.
let countPool = null;
let tokenSeq = 0;
function ensureCountPool() {
  if (countPool !== null) return countPool;
  const cores = Math.max(1, (self.navigator?.hardwareConcurrency || 4) - 1);
  const size = Math.min(3, cores);
  countPool = size < 2 ? [] : Array.from({ length: size }, () => {
    const worker = new Worker(
      new URL("./count-worker.js?v=trace-plan-v30", import.meta.url),
      { type: "module" });
    worker.postMessage({ type: "warm" });
    return worker;
  });
  return countPool;
}

/** One slice on one hand; resolves to its found-list, rejects on slice-error. */
function runSlice(worker, job, start, end, onProgress) {
  const token = ++tokenSeq;
  return new Promise((resolve, reject) => {
    const listener = (event) => {
      const msg = event.data || {};
      if (msg.token !== token) return;
      if (msg.type === "slice-progress") { onProgress(msg.scanned, msg.found); return; }
      worker.removeEventListener("message", listener);
      if (msg.type === "slice-done") resolve(msg);
      else reject(new Error(msg.message || "slice failed"));
    };
    worker.addEventListener("message", listener);
    worker.postMessage({ type: "slice", token, job, start, end });
  });
}

/** The four values a fit places its two bands with, as one JSON string. */
function fitBands(data) {
  return JSON.stringify({
    hExt: data.hExt ?? null, hAngle: data.hAngle ?? null,
    vExt: data.vExt ?? null, vAngle: data.vAngle ?? null,
  });
}

const HANDLERS = {
  generate: async (runtime, data, post) => {
    const { m, n, ks, preferShortArms, extStep, comboBudget, reachFromPrevious,
            level1Extensions } = data;
    runtime.globals.set("mxn_m", m);
    runtime.globals.set("mxn_n", n);
    runtime.globals.set("mxn_ks", ks);
    // Undefined from an older cached page must not become Python None for the
    // boolean, so fall back to the same default the engine uses.
    runtime.globals.set("mxn_short", preferShortArms !== false);
    runtime.globals.set("mxn_step", extStep ?? null);
    runtime.globals.set("mxn_budget", comboBudget ?? null);
    // Same guard as mxn_short: absent from an older cached page means off, and
    // off is what the engine has always done.
    runtime.globals.set("mxn_reach", reachFromPrevious === true);
    // `[h_ext, v_ext]` from a stored single-k run, or null. The page reads it
    // off the shelf; the engine only replays it. See bridge.generate.
    // JSON text, never a JS null: a null arrives in Python as JsNull,
    // which is not None and has no .to_py(). See bridge.l1_from_json.
    // The grid a judged best implies, 0 for absent. Scalars, not a
    // structure: nothing here can arrive as JsNull.
    runtime.globals.set("mxn_hstep", Number(data.handStep) || 0);
    runtime.globals.set("mxn_hceil", Number(data.handCeiling) || 0);
    // The judged ring itself, JSON text, "" absent — same boundary rule.
    runtime.globals.set("mxn_l1ring", data.level1Ring ? JSON.stringify(data.level1Ring) : "");
    // Preserve the adopted ring's arms: the levels above are welded at its
    // arm ends as placed, unsearched. Boolean scalar, same guard as mxn_short:
    // absent from an older cached page means off.
    runtime.globals.set("mxn_preserve", data.preserveArms === true);
    runtime.globals.set("mxn_l1", level1Extensions ? JSON.stringify(level1Extensions) : "");
    // The lab and the farm have only ever asked for lh/cw and send neither, so
    // the defaults keep them identical; /mxn/fit/ sends both, because "for any
    // k, m, n, lh, rh" is the thing it is for.
    runtime.globals.set("mxn_hand", data.hand ?? "lh");
    runtime.globals.set("mxn_direction", data.direction ?? "cw");
    const parsed = JSON.parse(await runtime.runPythonAsync(
      "bridge.generate(mxn_m, mxn_n, mxn_ks.to_py(), mxn_hand, mxn_direction,"
      + " prefer_short_arms=mxn_short, ext_step=mxn_step, combo_budget=mxn_budget,"
      + " reach_from_previous=mxn_reach,"
      + " level1_pin=bridge.l1_from_json(mxn_l1),"
      + " hand_step=mxn_hstep, hand_ceiling=mxn_hceil,"
      + " level1_ring=bridge.l1_ring_from_json(mxn_l1ring),"
      + " preserve_arms=mxn_preserve)"
    ));
    // Count every level's solutions BEFORE the result posts, so the cards land
    // with `1 / total` already exact — the counting is part of the thinking,
    // not a number that climbs afterwards. Slices go to the counting hands in
    // parallel where the pool exists; the serial walk is the fallback and the
    // small-product path. count-progress is the UI's feed; the prose line
    // rides along for the status bar. Capped so a huge product cannot hold
    // the run hostage — a level left inexact says so and is finished by the
    // page's background chain.
    const COUNT_CHUNK = 500;
    const COUNT_CEILING = 60000;
    let spent = 0;
    // A PLACED ladder is nobody's to browse, and counting one is worse than
    // pointless. Its L1 was adopted whole and every level above was welded at
    // that ring's arm ends, so NO level has a candidate list -- and counting a
    // level without one means re-solving it (export_count_job falls back to
    // enumerate_level), which is the exact search this run refused to do.
    // Worse, the counting happens BEFORE the result posts, so it is also why
    // the knobs sat behind "Working…": measured on a 4-level 2x1 loaded from
    // a file, ~10s of a 12.7s run, all of it spent on a browser the page does
    // not show for these levels. The reader wants L2's knobs, not a census.
    const census = data.preserveArms !== true;
    if (!census) {
      post("progress", { message: "Levels welded at the fixed ring's arms — "
        + "no solutions to count, opening the knobs" });
    }
    for (const meta of (census ? parsed.solutions ?? [] : [])) {
      if (!meta || meta.level <= 0) continue;
      if (meta.enumerated !== "full" && (meta.reason ?? "").startsWith("k=0")) continue;
      runtime.globals.set("mxn_level", meta.level);
      const progress = (scanned, cells, count) => {
        post("count-progress", { level: meta.level, scanned, cells, count });
        post("progress", { message: `Counting L${meta.level}'s solutions — `
          + `${count.toLocaleString()} closed in ${scanned.toLocaleString()}`
          + ` of ${cells.toLocaleString()} pairs…` });
      };

      let reply = null;
      const pool = ensureCountPool();
      if (pool.length >= 2) {
        // Parallel: export once, split [0, cells) evenly across the hands,
        // adopt the concatenation. Any slice failing drops this level to the
        // serial path with nothing adopted.
        try {
          const job = await runtime.runPythonAsync("bridge.export_count_job(mxn_level)");
          const parsedJob = JSON.parse(job);
          const cells = parsedJob.hCands.length * parsedJob.vCands.length;
          if (cells > 0 && cells <= COUNT_CEILING - spent) {
            const per = Math.ceil(cells / pool.length);
            const perSlice = pool.map(() => ({ scanned: 0, found: 0 }));
            const pieces = await Promise.all(pool.map((worker, at) => {
              const start = at * per;
              const end = Math.min(cells, start + per);
              if (start >= end) return Promise.resolve({ start, end, found: [] });
              return runSlice(worker, job, start, end, (scanned, found) => {
                perSlice[at] = { scanned, found };
                progress(perSlice.reduce((sum, s) => sum + s.scanned, 0), cells,
                         perSlice.reduce((sum, s) => sum + s.found, 0));
              });
            }));
            spent += cells;
            runtime.globals.set("mxn_slices", JSON.stringify(
              pieces.map(({ start, end, found }) => ({ start, end, found }))));
            reply = JSON.parse(await runtime.runPythonAsync(
              "bridge.adopt_count(mxn_level, mxn_slices)"));
          }
        } catch {
          reply = null;   // a hand failed: count this level serially instead
        }
      }

      while (!reply?.countExact && spent < COUNT_CEILING) {
        runtime.globals.set("mxn_count_budget", COUNT_CHUNK);
        reply = JSON.parse(await runtime.runPythonAsync(
          "bridge.count_solutions(mxn_level, mxn_count_budget)"));
        spent += COUNT_CHUNK;
        progress(reply.scanned ?? 0, reply.cells ?? 0, reply.count);
      }
      if (reply) {
        meta.count = reply.count;
        meta.countExact = reply.countExact;
        meta.healthy = reply.healthy;
      }
      if (!reply?.countExact) {
        post("progress", { message: `L${meta.level}'s solution count continues`
          + " in the background." });
      }
    }
    return ["result", JSON.stringify(parsed)];
  },
  select: async (runtime, data) => {
    runtime.globals.set("mxn_level", data.level);
    runtime.globals.set("mxn_index", data.index);
    runtime.globals.set("mxn_healthy", data.healthyOnly === true);
    runtime.globals.set("mxn_cursor", data.cursor ?? null);
    return ["solution", await runtime.runPythonAsync(
      "bridge.select_solution(mxn_level, mxn_index, mxn_healthy, mxn_cursor)"
    )];
  },
  count: async (runtime, data) => {
    runtime.globals.set("mxn_level", data.level);
    // The worker runs one message at a time, so the round size is the longest
    // a click can wait behind the counting. The page passes a small budget and
    // chains rounds instead.
    runtime.globals.set("mxn_count_budget", data.budget ?? null);
    return ["count-ready", await runtime.runPythonAsync(
      "bridge.count_solutions(mxn_level, mxn_count_budget)"
    )];
  },
  // Near-misses. The scan is a marginal sweep of one band against a partner
  // taken from a complete ring, so it costs len(band) replays rather than the
  // product -- seconds, not minutes, but still long enough that the page asks
  // for it explicitly instead of doing it after every run. The page asks per
  // band because that is the question it puts on screen; a null band sweeps
  // both, as the offline callers want.
  "semi-scan": async (runtime, data) => {
    runtime.globals.set("mxn_level", data.level);
    runtime.globals.set("mxn_band", data.band ?? null);
    return ["semi-ready", await runtime.runPythonAsync(
      "bridge.scan_semicomplete(mxn_level, mxn_band)"
    )];
  },
  // Reordering reads the list the scan already built, so it replays no ring:
  // it is list arithmetic, not search. The key is one of bridge.SEMI_KEYS --
  // nearest to closing, best H answers, best V answers, or best solution.
  "semi-sort": async (runtime, data) => {
    runtime.globals.set("mxn_level", data.level);
    runtime.globals.set("mxn_key", data.key);
    return ["semi-sorted", await runtime.runPythonAsync(
      "bridge.sort_semicomplete(mxn_level, mxn_key)"
    )];
  },
  // The full census of one band: every combo against every angle, including the
  // ones outside the +/-20 window that the real search never reaches. It replays
  // the level and then sweeps it twice over, so it is asked for explicitly and
  // never runs as part of a generate.
  //
  // Sent in two parts. The plan costs the replay alone and carries the band's
  // own geometry and the size of the job, so the page can draw the real sweep
  // and a real ceiling while the census -- the expensive half -- is still
  // running. Progress arrives on its own from inside the sweep, via emitTrace.
  trace: async (runtime, data, post) => {
    runtime.globals.set("mxn_level", data.level);
    runtime.globals.set("mxn_band", data.band);
    const plan = JSON.parse(await runtime.runPythonAsync(
      "bridge.trace_plan(mxn_level, mxn_band)"
    ));
    post("trace-plan-ready", plan);
    // An unavailable band has nothing to census; the reason is the whole reply.
    if (plan.unavailable) return ["trace-ready", JSON.stringify(plan)];
    return ["trace-ready", await runtime.runPythonAsync(
      "bridge.trace_census(mxn_level, mxn_band)"
    )];
  },
  // One traced cell, materialised: the traced band at that combo and angle,
  // the other band held at the engine's pick, woven and audited. Reads the
  // session trace_level primed, so it costs a checkpoint replay per call.
  "trace-weave": async (runtime, data) => {
    runtime.globals.set("mxn_level", data.level);
    runtime.globals.set("mxn_band", data.band);
    runtime.globals.set("mxn_ext", data.ext);
    runtime.globals.set("mxn_angle", data.angle);
    return ["trace-weave-ready", await runtime.runPythonAsync(
      "bridge.trace_weave(mxn_level, mxn_band, mxn_ext.to_py(), mxn_angle)"
    )];
  },
  // The fitter, /mxn/fit/. Two calls, and the page does the solving between
  // them: fit-plan hands it both bands' inputs, it works out the extensions
  // that flush each band, and fit-weave applies a candidate pair and audits the
  // ring it makes. The bands close jointly, so the page walks its own ordered
  // list through fit-weave rather than trusting one answer (docs/mxn-fit.md).
  "fit-plan": async (runtime, data) => {
    runtime.globals.set("mxn_level", data.level);
    return ["fit-plan-ready", await runtime.runPythonAsync(
      "bridge.fit_plan(mxn_level)"
    )];
  },
  // The knobs, without the search. fit-plan waits for a whole generate because
  // it also wants the engine's own pick; a reader who is about to move the arms
  // by hand is paying 194,481 combinations on a 4x1 for an answer they are
  // replacing. The plan itself is ready in 0.13 s (docs/mxn-fit.md).
  "fit-plan-now": async (runtime, data) => {
    runtime.globals.set("mxn_m", data.m);
    runtime.globals.set("mxn_n", data.n);
    runtime.globals.set("mxn_ks", data.ks);
    runtime.globals.set("mxn_hand", data.hand);
    runtime.globals.set("mxn_direction", data.direction);
    return ["fit-plan-now-ready", await runtime.runPythonAsync(
      "bridge.fit_plan_now(mxn_m, mxn_n, mxn_ks.to_py(), mxn_hand, mxn_direction)"
    )];
  },
  // The two bands a fit places, as JSON text — never as four globals that can
  // each be a JS null. `null` for a band means "leave it where the engine left
  // it", which is what a band that is already flush, or was never searched,
  // asks for; set raw it arrives in Python as JsNull, and the `is None` guard
  // that used to stand here was false for it and dereferenced it anyway. See
  // bridge.fit_bands_from_json.
  "fit-weave": async (runtime, data) => {
    runtime.globals.set("mxn_level", data.level);
    runtime.globals.set("mxn_fit_bands", fitBands(data));
    return ["fit-weave-ready", await runtime.runPythonAsync(
      "bridge.fit_weave(mxn_level, *bridge.fit_bands_from_json(mxn_fit_bands))"
    )];
  },
  // Adopting: the fitted ring becomes this level's ring, and every level above
  // it is BUILT AGAIN from it. That is the difference between a proposal about
  // one level and a stitch fixed one level at a time — without it, fitting L1
  // and then moving to L2 leaves L2 standing on the engine's L1, and the two
  // fits never coexist in a ring. Costs a real search per level above, which is
  // why the page asks for it explicitly. See docs/mxn-fit.md § The ladder.
  "fit-adopt": async (runtime, data) => {
    runtime.globals.set("mxn_level", data.level);
    runtime.globals.set("mxn_fit_bands", fitBands(data));
    runtime.globals.set("mxn_rebuild", data.rebuild !== false);
    // The ring being fixed is a person's (hand or judged): weld the rebuilt
    // levels at ITS arm ends, unsearched, instead of re-laying them.
    runtime.globals.set("mxn_preserve", data.preserveArms === true);
    return ["fit-adopt-ready", await runtime.runPythonAsync(
      "bridge.fit_adopt(mxn_level, *bridge.fit_bands_from_json(mxn_fit_bands),"
      + " rebuild=mxn_rebuild, preserve_arms=mxn_preserve)"
    )];
  },
  "semi-select": async (runtime, data) => {
    runtime.globals.set("mxn_level", data.level);
    runtime.globals.set("mxn_index", data.index);
    return ["semi-solution", await runtime.runPythonAsync(
      "bridge.select_semicomplete(mxn_level, mxn_index)"
    )];
  },
};

self.onmessage = async (event) => {
  const data = event.data || {};
  const handler = HANDLERS[data.type];
  // An unknown type used to return silently, which meant the page's promise
  // for it never settled and the tab sat on "Working…" forever with nothing
  // said. The realistic cause is a CACHED worker: this file is served from
  // public/ under a stable URL, so a browser holding yesterday's copy answers
  // today's page and simply drops any message type that was added since.
  // Failing loudly turns a permanent hang into one line a reader can act on.
  if (!handler) {
    self.postMessage({
      type: "error",
      id: data.id,
      message: `this engine worker does not understand "${data.type}" — it is `
        + "probably a cached copy from an older deploy. Reload the page "
        + "bypassing the cache (Ctrl+Shift+R).",
    });
    return;
  }
  const { id } = data;
  // Only a fresh generate invalidates in-flight frames; a browse reuses the
  // session the last generate built, so it must not move the generation id.
  if (data.type === "generate") activeGenerationId = id;
  try {
    const runtime = await prepare();
    // Handlers that have something to say before they finish post it through
    // here, so the id and the envelope stay in one place.
    const post = (replyType, payload) =>
      self.postMessage({ type: replyType, id, ...payload });
    const [replyType, json] = await handler(runtime, data, post);
    const payload = JSON.parse(json);
    self.postMessage(
      replyType === "result"
        ? { type: "result", id, result: payload }
        : { type: replyType, id, ...payload }
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
