/* A counting hand: walks one contiguous slice of a level's H x V pair
   product, so several of these can count one level in parallel.

   Deliberately dumb. It holds no session — everything a slice needs arrives
   in the job (bridge.export_count_job), and everything it learns goes back as
   the slice's own found-list. The main worker adopts the concatenated slices
   as the level's cache, in range order, which IS the serial walk's order. */
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.mjs";

let pyodide;
let initializing;

// bridge.py imports these relays at module load; a counting hand has no busy
// sheet to feed, so they are stubs rather than absences.
self.emitProgress = () => {};
self.emitFrame = () => {};
self.emitTrace = () => {};

async function prepare() {
  if (pyodide) return pyodide;
  if (initializing) return initializing;
  initializing = (async () => {
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
      // Same cache key as the main worker, so both fetch the same bridge.
      const url = new URL(`./py/${name}?v=maxk-legacy-v18`, import.meta.url);
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
  const data = event.data || {};
  try {
    if (data.type === "warm") {
      await prepare();
      self.postMessage({ type: "warm-ready" });
      return;
    }
    if (data.type !== "slice") return;
    const runtime = await prepare();
    // Chunked so progress can be reported mid-slice; the job string is cached
    // python-side, so re-entering costs a comparison, not a re-parse.
    const CHUNK = 500;
    runtime.globals.set("mxn_job", data.job);
    const found = [];
    for (let at = data.start; at < data.end; at += CHUNK) {
      const stop = Math.min(at + CHUNK, data.end);
      runtime.globals.set("mxn_from", at);
      runtime.globals.set("mxn_to", stop);
      const piece = JSON.parse(await runtime.runPythonAsync(
        "bridge.count_slice(mxn_job, mxn_from, mxn_to)"));
      found.push(...piece.found);
      self.postMessage({ type: "slice-progress", token: data.token,
                        scanned: stop - data.start, found: found.length });
    }
    self.postMessage({ type: "slice-done", token: data.token,
                      start: data.start, end: data.end, found });
  } catch (error) {
    self.postMessage({ type: "slice-error", token: data.token,
                      message: error instanceof Error ? error.message : String(error) });
  }
};
