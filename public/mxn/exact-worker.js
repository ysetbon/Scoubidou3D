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
      const url = new URL(`./py/${name}?v=short-arms-v4`, import.meta.url);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load ${name}`);
      runtime.FS.writeFile(`/home/py/${name}`, await response.text());
    }));
    await runtime.runPythonAsync("import sys; sys.path.insert(0, '/home/py'); import bridge");
    pyodide = runtime;
    return runtime;
  })();
  return initializing;
}

self.onmessage = async (event) => {
  if (event.data?.type !== "generate") return;
  const { id, m, n, ks, preferShortArms, extStep, comboBudget } = event.data;
  activeGenerationId = id;
  try {
    const runtime = await prepare();
    runtime.globals.set("mxn_m", m);
    runtime.globals.set("mxn_n", n);
    runtime.globals.set("mxn_ks", ks);
    // Undefined from an older cached page must not become Python None for the
    // boolean, so fall back to the same default the engine uses.
    runtime.globals.set("mxn_short", preferShortArms !== false);
    runtime.globals.set("mxn_step", extStep ?? null);
    runtime.globals.set("mxn_budget", comboBudget ?? null);
    const json = await runtime.runPythonAsync(
      "bridge.generate(mxn_m, mxn_n, mxn_ks.to_py(), 'lh', 'cw',"
      + " prefer_short_arms=mxn_short, ext_step=mxn_step, combo_budget=mxn_budget)"
    );
    self.postMessage({ type: "result", id, result: JSON.parse(json) });
  } catch (error) {
    self.postMessage({
      type: "error",
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
