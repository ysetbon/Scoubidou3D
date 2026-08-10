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
 * Measured on the real engine (public/mxn/py) with its process pool, native
 * CPython on 4 cores, serial as the reference:
 *
 *   2x2 [1]        0.32s -> 0.23s   1.4x
 *   2x2 [1,2,2]    3.21s -> 2.00s   1.6x
 *   3x3 [1]       28.20s -> 7.80s   3.6x
 *   3x2 [1]       30.17s -> 8.44s   3.6x
 *
 * Small searches are dominated by the per-level work that does not parallelise;
 * large ones are almost pure combo sweep. Solving Amdahl for each row gives a
 * parallel fraction that tracks the log of the total combo count, which is what
 * the fit below encodes. It is a rough guide, not a promise, and is labelled as
 * such wherever it is shown.
 */
const FIT_SLOPE = 0.195;
const FIT_INTERCEPT = -0.82;
const MAX_PARALLEL_FRACTION = 0.97;

export function parallelFraction(work: number): number {
  if (!Number.isFinite(work) || work <= 1) return 0;
  const p = FIT_SLOPE * Math.log(work) + FIT_INTERCEPT;
  return Math.min(Math.max(p, 0), MAX_PARALLEL_FRACTION);
}

/** Amdahl over the fitted parallel fraction. `work` is combos x levels. */
export function estimateSpeedup(work: number, workers: number): number {
  if (workers <= 1) return 1;
  const p = parallelFraction(work);
  return 1 / (1 - p + p / workers);
}

/** The engine leaves one core for the browser and caps at 8 (mxn_lh_continuation.py:2987). */
export function usableWorkers(cores: number | null): number {
  if (!cores || cores < 2) return 1;
  return Math.min(Math.max(cores - 1, 1), 8);
}
