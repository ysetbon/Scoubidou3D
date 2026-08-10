/* What this browser can actually bring to the search, and what it cannot.
 *
 * The lab's engine is CPython compiled to WebAssembly (exact-worker.js), so the
 * honest answer to "will my machine go faster" is narrower than the hardware
 * suggests: the search runs on one wasm thread and has no route to the GPU.
 * This module detects the machine anyway and says so explicitly, because a
 * reader looking at a spinner deserves to know which of those limits is theirs.
 */

export type Machine = {
  /** navigator.hardwareConcurrency, or null where the browser withholds it. */
  cores: number | null;
  platform: string;
  isMac: boolean;
  /** Renderer string from WebGL. Safari masks this; null means "not offered". */
  gpu: string | null;
  /** Apple's own silicon reports itself in the renderer string. */
  appleSilicon: boolean;
  webgpu: boolean;
  /** Cross-origin isolation gates SharedArrayBuffer, which gates wasm threads.
   *  GitHub Pages cannot send the COOP/COEP headers that turn this on. */
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
};

/** How many cores the search uses today, regardless of how many exist.
 *  bridge.py pins the engine to one worker under Emscripten: Web Workers have
 *  no Python subprocesses, so the engine's own process pool cannot start. */
export const CORES_IN_USE = 1;

function readGpu(): { gpu: string | null; appleSilicon: boolean } {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return { gpu: null, appleSilicon: false };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    // Unmasked is the useful one ("Apple M2 Pro"); the masked fallback is
    // usually just "WebKit WebGL", which tells a reader nothing.
    const raw = ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    const gpu = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    return { gpu, appleSilicon: !!gpu && /Apple\s*(GPU|M\d)/i.test(gpu) };
  } catch {
    return { gpu: null, appleSilicon: false };
  }
}

export function detectMachine(): Machine {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const platform = nav.platform || "unknown";
  const { gpu, appleSilicon } = readGpu();
  return {
    cores: typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    platform,
    isMac: /Mac/i.test(platform) || /Macintosh/i.test(nav.userAgent),
    gpu,
    appleSilicon,
    webgpu: "gpu" in nav,
    crossOriginIsolated: typeof crossOriginIsolated !== "undefined" && crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
  };
}

/* ---- What the cores would be worth, if the search could reach them ----
 *
 * Measured on the real engine (public/mxn/py) with its own process pool, native
 * CPython, serial as the reference. 13 sizes x {2,3,4} workers, and every
 * parallel run agreed with serial exactly. Speedups at 4 workers:
 *
 *   2x2 [0]      0.04s -> 0.04s  1.0x     2x3 [1]   30.71s ->  8.02s  3.8x
 *   2x2 [1]      0.22s -> 0.23s  1.0x     3x2 [1]   30.25s ->  8.34s  3.6x
 *   1x1 [1]      0.28s -> 0.18s  1.6x     3x3 [1]   29.46s ->  7.83s  3.8x
 *   2x2 [1,2,2]  3.28s -> 2.06s  1.6x     3x3 [-1]  35.92s ->  8.83s  4.1x
 *   2x2 [-1]     1.61s -> 0.63s  2.6x     1x3 [1]   56.76s -> 16.86s  3.4x
 *   1x2 [1]      3.08s -> 1.13s  2.7x     3x1 [1]   58.17s -> 15.35s  3.8x
 *
 * There is no predicting which band a run lands in from its combo count: 2x2
 * [1] and 2x2 [-1] sweep the same 441 combos and came out at 1.0x and 2.6x.
 * What separates them is how long the run takes -- k changes the cost of each
 * combo, not how many there are -- and that is not known until it has run.
 *
 * So this reports the measured band and names the discriminator, rather than
 * fitting a curve to a variable that demonstrably does not carry the signal.
 * An earlier version of this file fitted parallel fraction to log(combos); the
 * two 441-combo rows above are what retired it.
 */

/** Efficiency band for runs long enough to amortise splitting: the 4-worker
 *  rows above at 3.4x-4.1x are 0.84-1.02 of linear. Held slightly conservative. */
const EFFICIENCY_LOW = 0.8;
const EFFICIENCY_HIGH = 0.95;
/** Below this the measured rows cluster at 1.0x-1.6x: fixed per-level work
 *  dominates and there is nothing worth splitting. */
export const SUB_SECOND_CEILING = 1.6;

export type SpeedupBand = { low: number; high: number };

/** What the idle cores would be worth on a run that takes more than a few
 *  seconds. Short runs do not reach this; see SUB_SECOND_CEILING. */
export function estimateSpeedup(workers: number): SpeedupBand {
  if (workers <= 1) return { low: 1, high: 1 };
  return { low: workers * EFFICIENCY_LOW, high: workers * EFFICIENCY_HIGH };
}

/** The engine leaves one core for the browser and caps at 8 (mxn_lh_continuation.py:2987). */
export function usableWorkers(cores: number | null): number {
  if (!cores || cores < 2) return 1;
  return Math.min(Math.max(cores - 1, 1), 8);
}
