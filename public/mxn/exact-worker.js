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
      const url = new URL(`./py/${name}?v=trace-plan-v17`, import.meta.url);
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
    return runtime;
  })();
  return initializing;
}

const HANDLERS = {
  generate: async (runtime, data, post) => {
    const { m, n, ks, preferShortArms, extStep, comboBudget } = data;
    runtime.globals.set("mxn_m", m);
    runtime.globals.set("mxn_n", n);
    runtime.globals.set("mxn_ks", ks);
    // Undefined from an older cached page must not become Python None for the
    // boolean, so fall back to the same default the engine uses.
    runtime.globals.set("mxn_short", preferShortArms !== false);
    runtime.globals.set("mxn_step", extStep ?? null);
    runtime.globals.set("mxn_budget", comboBudget ?? null);
    const parsed = JSON.parse(await runtime.runPythonAsync(
      "bridge.generate(mxn_m, mxn_n, mxn_ks.to_py(), 'lh', 'cw',"
      + " prefer_short_arms=mxn_short, ext_step=mxn_step, combo_budget=mxn_budget)"
    ));
    // Count every level's solutions BEFORE the result posts, so the cards land
    // with `1 / total` already exact — the counting is part of the thinking,
    // not a number that climbs afterwards. Chunked so the busy line can
    // narrate, and capped so a huge product cannot hold the run hostage; a
    // level left inexact is finished by the page's background chain.
    const COUNT_CHUNK = 500;
    const COUNT_CEILING = 30000;
    let spent = 0;
    for (const meta of parsed.solutions ?? []) {
      if (!meta || meta.level <= 0) continue;
      if (meta.enumerated !== "full" && (meta.reason ?? "").startsWith("k=0")) continue;
      let reply = null;
      while (spent < COUNT_CEILING) {
        runtime.globals.set("mxn_level", meta.level);
        runtime.globals.set("mxn_count_budget", COUNT_CHUNK);
        reply = JSON.parse(await runtime.runPythonAsync(
          "bridge.count_solutions(mxn_level, mxn_count_budget)"));
        spent += COUNT_CHUNK;
        post("progress", { message: `Counting L${meta.level}'s solutions — `
          + `${reply.count.toLocaleString()} closed in `
          + `${(reply.scanned ?? 0).toLocaleString()} of `
          + `${(reply.cells ?? 0).toLocaleString()} pairs…` });
        if (reply.countExact) break;
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
  if (!handler) return;
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
