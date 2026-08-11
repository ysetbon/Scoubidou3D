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
      const url = new URL(`./py/${name}?v=semi-band-v11`, import.meta.url);
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
  generate: async (runtime, data) => {
    const { m, n, ks, preferShortArms, extStep, comboBudget } = data;
    runtime.globals.set("mxn_m", m);
    runtime.globals.set("mxn_n", n);
    runtime.globals.set("mxn_ks", ks);
    // Undefined from an older cached page must not become Python None for the
    // boolean, so fall back to the same default the engine uses.
    runtime.globals.set("mxn_short", preferShortArms !== false);
    runtime.globals.set("mxn_step", extStep ?? null);
    runtime.globals.set("mxn_budget", comboBudget ?? null);
    return ["result", await runtime.runPythonAsync(
      "bridge.generate(mxn_m, mxn_n, mxn_ks.to_py(), 'lh', 'cw',"
      + " prefer_short_arms=mxn_short, ext_step=mxn_step, combo_budget=mxn_budget)"
    )];
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
    return ["count-ready", await runtime.runPythonAsync(
      "bridge.count_solutions(mxn_level)"
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
  trace: async (runtime, data) => {
    runtime.globals.set("mxn_level", data.level);
    runtime.globals.set("mxn_band", data.band);
    return ["trace-ready", await runtime.runPythonAsync(
      "bridge.trace_level(mxn_level, mxn_band)"
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
    const [replyType, json] = await handler(runtime, data);
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
