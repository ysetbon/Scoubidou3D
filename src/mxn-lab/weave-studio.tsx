"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  allBounds, drawExactStage,
  type Bounds, type Stage, type Strand,
} from "./exact-draw";
import { traceKey } from "./trace-band";
import {
  TracePanel, TraceSweep, weaveKey,
  type TracePayload, type TracePlan, type TraceProgress, type TraceWeave,
} from "./trace-panel";

// The renderer moved to exact-draw.ts so the trace panel can use it too; these
// stay exported from here because /mxn/rate/ already imports them from here.
export { allBounds, drawExactStage };
export type { Bounds, Stage, Strand };

// Upstream the lab sits at the root of its own host, so its runtime assets were
// plain "/exact-worker.js" and "/extension-origin-l0.svg". Here it is one page
// of a project site published under /Scoubidou3D/, and those would resolve
// against ysetbon.github.io itself. BASE_URL carries whatever vite was built
// with — "/Scoubidou3D/" for Pages, "/" for a root build — so the page keeps
// working under either.
const LAB_BASE = `${import.meta.env.BASE_URL}mxn/`;

// /mxn/ and /mxn/fast/ mount the same component against the same engine files;
// the page says which angle-scan path to use via data-engine on #lab, and the
// choice rides to Pyodide on the worker URL. Two links, one build, so an A/B
// compares the scan and nothing else.
const FAST_ENGINE = document.getElementById("lab")?.dataset.engine === "fast";

const COMMIT = "984d9ed";
const PRESETS = ["1", "1 1 -1", "1 1 -1 -1 -1 -1 -1", "1 1 1", "1 -1 1 -1", "-1 -1"];

// Mirrors of the engine's own search constants, used only to show the cost of a
// run before it starts. Keep in step with MAX_PAIR_EXTENSION, COMBO_BUDGET and
// _get_alignment_combo_limit in the Python.
const MAX_PAIR_EXTENSION = 200;
const DEFAULT_COMBO_BUDGET = 400_000;
const ENGINE_COMBO_LIMIT = 10_000_000;
const EXT_STEP_CHOICES = ["auto", "20", "10", "5"] as const;
type ExtStep = (typeof EXT_STEP_CHOICES)[number];
// The ladder pick_extension_step() walks, finest first. 5 is offered as an
// explicit choice above but is deliberately not in the auto ladder, exactly as
// in the Python — adding it there changes what every existing stitch picks.
const EXT_STEPS = [10, 20, 25, 40, 50, 100];

// The busy indicator is a contact sheet of the candidates the engine actually
// produced. Tiles are drawn at twice their 72px slot so they stay crisp on a
// retina panel while costing a fraction of a full-size card render.
const SHEET_TILES = 24;
const TILE_PIXELS = 144;

// How many woven trace cells to keep per level-and-band. Each is a full strand
// list; forty covers a scrubbing session while keeping the cache tens of
// kilobytes rather than unbounded.
const TRACE_WEAVE_CACHE = 40;

// Same formula as pick_extension_step(): the grid per pair is 0..ext_max in
// `step` increments, and pairs are independent.
export function comboCount(step: number, pairs: number, extMax = MAX_PAIR_EXTENSION) {
  return Math.pow(Math.floor(extMax / step) + 1, Math.max(pairs, 1));
}

export function autoStep(pairs: number, budget: number) {
  for (const step of EXT_STEPS) {
    if (comboCount(step, pairs) <= budget) return step;
  }
  return EXT_STEPS[EXT_STEPS.length - 1];
}

// A level's two search groups hold 2m and 2n arms, paired outside-in, so the
// worst group is the one with more pairs.
// k=0 preserves the continuation and has exactly one solution by construction.
// Anything else can be paged through, even if the level was solved from a seed
// and has to enumerate on the first click.
function browsable(meta: { enumerated: string; reason?: string | null }) {
  return meta.enumerated === "full" || !(meta.reason ?? "").startsWith("k=0");
}

export function worstPairs(m: number, n: number) {
  return Math.max(Math.ceil((2 * m) / 2), Math.ceil((2 * n) / 2), 1);
}

// How a near-miss list can be ordered. Four named buttons rather than one
// button that cycled: the label on a cycling toggle says where the list IS
// while the click says where it goes, so H and V were never a question the
// strip could be asked directly -- it only ever offered "by deficit" or "by
// both extensions added together", and a sum over the held band and the swept
// one sorts an H list partly by the number the sweep is holding still.
//
// Keys must match bridge.SEMI_KEYS; the ordering itself lives in Python beside
// the list, because only its head crosses the worker boundary.
const SEMI_SORTS = [
  { key: "near", label: "NEAR", hint: "nearest to closing first — fewest crossings missing" },
  { key: "h", label: "H", hint: "best H answers first — shortest H extension, worst H pair breaking the tie" },
  { key: "v", label: "V", hint: "best V answers first — shortest V extension, worst V pair breaking the tie" },
  { key: "best", label: "BEST", hint: "best solution first — the ring whose longest single pair extension is the shortest" },
] as const;
type SemiKey = (typeof SEMI_SORTS)[number]["key"];

export type ProgressFrame = {
  /** The generation this candidate belongs to, so a requeued run can tell its
      own frames from the ones still draining out of the previous search. */
  id: number;
  level: number;
  k: number;
  phase: string;
  completed: number;
  total: number;
  valid: number;
  angle?: number | null;
  extensions: number[];
  strands: Strand[];
  /** Set when the frame comes from a trace replay, naming the band traced. */
  trace?: string | null;
};
export type AuditRow = {
  level: number; k: number; expected: number; state: string;
  gap: [number, number]; ext: [number[], number[]];
  across: number; within: number; masks: number; stray: number; broken: number;
  applied: string[]; healthy: boolean;
};
type SolutionMeta = {
  level: number;
  enumerated: "none" | "full";
  reason?: string | null;
  hCount: number; vCount: number; candidates: number;
  enginePick: number; index: number; truncated: boolean;
  count?: number; countExact?: boolean;
};
type ExactResult = {
  m: number; n: number; ks: number[]; expected: number; seconds: number;
  rows: AuditRow[]; stages: Stage[]; solutions?: SolutionMeta[];
};
/**
 * One near-miss: a ring that did not close, with the blame on one band.
 *
 * `band` is the band that was varied. The other one was held at a value taken
 * from a ring that DOES close, so "H failed" here means this H value failed
 * against a V that is known to work — not merely that the pair happened not to
 * close, which says nothing about either side.
 */
type SemiItem = {
  band: "h" | "v"; index: number; h: number; v: number;
  /** How many distinct working partners this value failed against. */
  refs: number;
  ext: number[]; heldExt: number[]; angle: number | null; gap: number | null;
  hExt: number[]; vExt: number[]; total: number;
  /** The ring's longest single pair extension — what the BEST order minimises. */
  peak: number;
  across: number; expected: number; withinH: number; withinV: number;
  deficit: number; folded: boolean;
};
type SemiMeta = {
  level: number; count: number; listed?: number; truncated: boolean;
  grounded: boolean; refs?: number; reason?: string | null; items: SemiItem[];
  index: number; current?: SemiItem;
  /** Which band this list was swept for — the ⚑ that produced it. */
  band: Band;
  /** Which of SEMI_SORTS the list is currently in. */
  key?: SemiKey;
};
type Band = "h" | "v";
type SavedSolution = {
  id: string; created_at: string; hand: string; direction: string;
  m: number; n: number; level: number; k: number; ks_prefix: number[];
  parent_strands: Strand[]; solution_strands: Strand[];
  h_ext: number[]; v_ext: number[];
  audit: AuditRow; solution_index: number; rating: number | null;
  kind: "complete" | "semi"; band: "h" | "v" | null; deficit: number;
  refs: number;
};

const SAVE_KEY = "mxn-lab-solutions";
const API_KEY = "mxn-lab-api";
const TOKEN_KEY = "mxn-lab-token";

// The dataset API is optional. Without it the star still works, locally — the
// lab is a static page and must keep working with no backend at all.
function readSetting(key: string) {
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeSetting(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* private mode: the field simply will not persist */
  }
}

// Same guarded shape as src/model/customSamples.ts: private mode and a full
// quota both throw, and neither is worth losing the page over.
function readSaved(): SavedSolution[] {
  try {
    return JSON.parse(window.localStorage.getItem(SAVE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeSaved(rows: SavedSolution[]) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
}
type Params = {
  m: number; n: number; ks: number[]; key: string;
  preferShortArms: boolean; extStep: number | null; comboBudget: number;
};

function parseKs(raw: string) {
  const cleaned = raw.replace(/[\[\],]/g, " ").trim();
  if (!cleaned) return { values: [] as number[], error: "Add at least one k value." };
  const tokens = cleaned.split(/\s+/);
  const values = tokens.map(Number);
  const bad = tokens.find((_, index) => !Number.isInteger(values[index]));
  if (bad) return { values: [] as number[], error: `“${bad}” is not an integer.` };
  if (values.length > 8) return { values, error: "Keep an exact browser run to 8 levels or fewer." };
  return { values, error: null as string | null };
}

function kLimits(m: number, n: number) {
  return m === n ? { min: -(m - 1), max: m } : { min: -(m + n - 1), max: m + n };
}

function suffixLabel(level: number) {
  if (level === 0) return "_1 + _2/_3";
  const source = 2 * level;
  const target = source + 2;
  return `_${source}/_${source + 1} → _${target}/_${target + 1}`;
}

function ExactCanvas({ stage, bounds, showLabels = true, label, fixedSize }: { stage: Stage; bounds: Bounds; showLabels?: boolean; label?: string; fixedSize?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const redraw = () => drawExactStage(canvas, stage, bounds, showLabels, fixedSize);
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [stage, bounds, showLabels, fixedSize]);
  return <canvas ref={ref} role="img" aria-label={label ?? `Exact continuation diagram level ${stage.level}`} />;
}

function formatExtensions(values: number[]) {
  return values.length ? `(${values.join(", ")})` : "—";
}

/**
 * The ticking dots on the "thinking" plaque.
 *
 * Deliberately on their own beat rather than the engine's: when a search
 * stalls the tiles behind the plaque freeze and the dots keep going, which is
 * the difference between a slow band and a hung worker. Its own component so a
 * dot does not re-render the sheet.
 */
function ThinkingDots() {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const slow = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = window.setInterval(() => setCount(value => (value % 3) + 1), slow ? 900 : 380);
    return () => window.clearInterval(id);
  }, []);
  return <i>{".".repeat(count)}</i>;
}

/**
 * The live frame, held OUTSIDE React state on purpose. The engine now emits
 * up to ~28 frames a second, and a setState per frame on the lab component
 * would re-render every diagram card on the page at that rate. The store
 * notifies only the components that subscribed — the busy figure — so a
 * frame costs one small subtree render no matter how big the results grid is.
 */
export type FrameStore = {
  get: () => ProgressFrame | null;
  set: (next: ProgressFrame | null) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createFrameStore(): FrameStore {
  let frame: ProgressFrame | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => frame,
    set: next => { frame = next; listeners.forEach(listener => listener()); },
    subscribe: listener => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/**
 * The last SHEET_TILES candidates, drawn small — the busy state's whole
 * content. These are real search output, so the rate the sheet fills at IS the
 * search rate: a slow band visibly slows it.
 *
 * Tiles are written imperatively into a fixed pool of canvases instead of
 * being re-rendered from a state array, so one candidate costs one small
 * canvas draw no matter how full the sheet already is.
 */
function CandidateSheet({ frame }: { frame: ProgressFrame | null }) {
  const tiles = useRef<(HTMLCanvasElement | null)[]>([]);
  const cursor = useRef(0);
  const runId = useRef<number | null>(null);

  useEffect(() => {
    if (!frame) return;
    // A requeued run reuses this mounted sheet, so wipe the previous
    // generation's tiles rather than interleaving two searches.
    if (frame.id !== runId.current) {
      runId.current = frame.id;
      cursor.current = 0;
      tiles.current.forEach(tile => {
        if (!tile) return;
        tile.getContext("2d")?.clearRect(0, 0, tile.width, tile.height);
        tile.classList.add("is-void");
        tile.classList.remove("is-fresh");
      });
    }
    const canvas = tiles.current[cursor.current % SHEET_TILES];
    if (!canvas) return;
    const stage: Stage = {
      level: frame.level,
      k: frame.k,
      label: frame.phase,
      strands: frame.strands,
    };
    drawExactStage(canvas, stage, allBounds([stage]), false, TILE_PIXELS);
    tiles.current.forEach(tile => tile?.classList.remove("is-fresh"));
    canvas.classList.remove("is-void");
    canvas.classList.add("is-fresh");
    cursor.current += 1;
  }, [frame]);

  return (
    <div className="sheet-grid" aria-hidden="true">
      {Array.from({ length: SHEET_TILES }, (_, index) => (
        <canvas key={index} className="is-void" ref={element => { tiles.current[index] = element; }} />
      ))}
    </div>
  );
}

/**
 * How much searching this run can possibly do.
 *
 * Every level searches both groups, and a group is the extension grid the
 * engine will walk: (ext_max / step + 1) choices per pair, pairs independent —
 * the same formula pick_extension_step() sizes a run with. It is a ceiling,
 * not a forecast: the search stops a group early when it has what it needs, so
 * the run finishes at or before this. That is the point of showing it. A bar
 * against a number that can be beaten is a promise the engine can keep.
 */
export function worstCase(m: number, n: number, levels: number, step: number) {
  const perLevel = comboCount(step, m) + comboCount(step, n);
  return { perLevel, groups: levels * 2, total: perLevel * levels };
}

/** Which group of the run a frame belongs to, counting from one. */
function groupIndex(frame: ProgressFrame) {
  const vertical = frame.phase.toLowerCase().startsWith("v");
  return (frame.level - 1) * 2 + (vertical ? 2 : 1);
}

/**
 * The busy state, and the whole of it: candidates as they are found, drawn
 * small, in the results column — not the sidebar — so opening Advanced cannot
 * bury it. It replaces a spinner that reported nothing beyond "not frozen";
 * the sheet fills at whatever rate the search is managing. Its own component
 * so the per-frame renders stop at this figure instead of the whole lab.
 *
 * The plaque carries the run's whole scale: the group's own bar, the ceiling
 * every group is measured against, and how many groups are left. Dots alone
 * said the tab had not frozen; they never said whether the wait was ten
 * seconds or ten minutes, which is the question anyone watching it has.
 */
export function LiveCandidateFigure({ store, worst }: {
  store: FrameStore;
  /** The run's ceiling, from the parameters it was started with. */
  worst: { perLevel: number; groups: number; total: number };
}) {
  const frame = useSyncExternalStore(store.subscribe, store.get);
  const group = frame ? groupIndex(frame) : 0;
  const within = frame && frame.total > 0
    ? Math.min(1, frame.completed / frame.total) : 0;
  // Groups already behind this one count as done: the engine finishes a group
  // before it starts the next, so a finished group is finished work whether or
  // not it walked its whole grid.
  const reached = worst.groups
    ? Math.min(1, (Math.max(0, group - 1) + within) / worst.groups) : 0;
  // A high-water mark, because the group number is read off the phase and the
  // engine is free to take a level's two groups in either order. Work already
  // done does not become undone, so the run bar never walks backwards.
  // Kept per generation: a requeued run reuses this figure, and its first
  // frame must not inherit the last search's mark.
  const high = useRef({ id: -1, at: 0 });
  if (frame && frame.id !== high.current.id) high.current = { id: frame.id, at: 0 };
  if (reached > high.current.at) high.current.at = reached;
  const overall = high.current.at;

  return (
    <figure className="candidate-sheet" aria-label="Live search candidates">
      <figcaption>
        <span>
          live candidates
          {frame ? ` · L${frame.level} · k=${frame.k}` : ""}
        </span>
        <b>{frame?.phase ?? "starting search"}</b>
        <em>
          {frame && frame.total > 0
            ? `${frame.completed.toLocaleString()} / ${frame.total.toLocaleString()}`
            : "preparing search"}
          {frame && frame.valid > 0 ? ` · ${frame.valid} valid` : ""}
        </em>
      </figcaption>
      <div className="sheet-stage">
        <CandidateSheet frame={frame} />
        {/* aria-hidden: the engine status line already carries this state
            politely, and a bar that moves every frame is not worth announcing.
            Kept to one plaque-width column so it covers no more of the sheet
            than the word "thinking" did. */}
        <div className="thinking-plaque" aria-hidden="true">
          <span className="thinking-word">thinking<ThinkingDots /></span>
          {/* Two bars, one track: the pale fill is the whole run against its
              ceiling, the solid one is the group being searched now. */}
          <span className="thinking-track">
            <i className="thinking-run" style={{ width: `${overall * 100}%` }} />
            <b className="thinking-group" style={{ width: `${within * 100}%` }} />
          </span>
          <span className="thinking-scale">
            {frame && frame.total > 0
              ? `${Math.round(within * 100)}% of group ${group}/${worst.groups}`
              : `group 1/${worst.groups}`}
            <em>≤ {worst.total.toLocaleString()} combos</em>
          </span>
        </div>
      </div>
    </figure>
  );
}

export function ContinuationLab() {
  const [m, setM] = useState(2);
  const [n, setN] = useState(2);
  const [rawKs, setRawKs] = useState("1");
  const [result, setResult] = useState<ExactResult | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  // Nothing runs until Run is pressed, so the first thing the page says has to
  // be an instruction rather than a progress report.
  const [status, setStatus] = useState("Set m, n and ks, then press Run");
  const [busy, setBusy] = useState(false);
  // Deliberately not useState: see FrameStore. useState(createFrameStore)
  // makes the factory the lazy initialiser, so one store per mount.
  const [frameStore] = useState(createFrameStore);
  // The trace replay's own candidates, kept out of the run's store so a widget
  // and the busy sheet never draw each other's frames. One store rather than
  // one per level: the worker takes messages in order, so only one replay is
  // ever in flight, and each frame says which band it belongs to.
  const [traceFrameStore] = useState(createFrameStore);
  // What the run in flight could cost at worst. Frozen at dispatch; see below.
  const [runScale, setRunScale] = useState(() => worstCase(2, 2, 1, 20));
  const [copiedLevel, setCopiedLevel] = useState<number | null>(null);
  const [fullSizeLevels, setFullSizeLevels] = useState<Set<number>>(() => new Set());
  const [preferShortArms, setPreferShortArms] = useState(true);
  const [extStep, setExtStep] = useState<ExtStep>("auto");
  const [comboBudget, setComboBudget] = useState(DEFAULT_COMBO_BUDGET);
  const [ranKey, setRanKey] = useState<string | null>(null);
  const [solutions, setSolutions] = useState<Record<number, SolutionMeta>>({});
  const [semi, setSemi] = useState<Record<number, SemiMeta>>({});
  // Which band's near-misses a level is showing, if any. A level is either on
  // closed rings or on one band's shortfalls — never on both at once, because
  // the two ⚑ ask different questions of the same level.
  const [semiMode, setSemiMode] = useState<Record<number, Band | undefined>>({});
  const [openWidgets, setOpenWidgets] = useState<Set<number>>(() => new Set());
  // One trace per level and band. A trace costs a replay of the level plus
  // two sweeps of it, so closing the widget keeps what it found.
  const [traces, setTraces] = useState<Record<string, TracePayload>>({});
  // What the census is about to sweep, and how far into it the worker is.
  // Both land while the widget is still waiting, which is what the pending
  // sweep is drawn from — see TraceSweep.
  const [tracePlans, setTracePlans] = useState<Record<string, TracePlan>>({});
  const [traceProgress, setTraceProgress] = useState<Record<string, TraceProgress>>({});
  const [traceFailed, setTraceFailed] = useState<Record<string, string>>({});
  const [traceBand, setTraceBand] = useState<Record<number, Band>>({});
  // Woven previews of traced cells, keyed by trace then by combo-and-angle.
  // Each one is a full strand list, so the per-trace map is trimmed rather
  // than allowed to hold every cell a long session scrubs through.
  const [traceWeaves, setTraceWeaves] = useState<Record<string, Record<string, TraceWeave>>>({});
  const [browsingLevel, setBrowsingLevel] = useState<number | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [healthyOnly, setHealthyOnly] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  // The viewport is derived from the LAST stage, so once a browsed level
  // changes geometry every card would rescale on each arrow click. Freeze it
  // for the lifetime of one generate.
  const boundsRef = useRef<Bounds | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const busyRef = useRef(false);
  const pendingRef = useRef<Params | null>(null);
  const activeIdRef = useRef(0);
  const dispatchRef = useRef<(params: Params) => void>(() => {});

  const parsed = useMemo(() => parseKs(rawKs), [rawKs]);
  const limits = kLimits(m, n);
  const rangeError = parsed.values.find(k => k < limits.min || k > limits.max);
  const inputError = parsed.error ?? (rangeError !== undefined
    ? `k = ${rangeError} is outside the valid range ${limits.min}…${limits.max}.`
    : null);
  const ks = inputError ? [] : parsed.values;
  const expected = 4 * m * n;
  const hasDeepMaxK = ks.some((k, index) => index > 0 && k === limits.max);
  const worstPairCount = worstPairs(m, n);
  const resolvedStep = extStep === "auto" ? autoStep(worstPairCount, comboBudget) : Number(extStep);
  const estimatedCombos = comboCount(resolvedStep, worstPairCount);
  const overEngineLimit = estimatedCombos > ENGINE_COMBO_LIMIT;
  const paramsKey = `${m}:${n}:${ks.join(",")}:${preferShortArms}:${extStep}:${comboBudget}`;
  const staleParams = ranKey !== null && ranKey !== paramsKey && !busy;
  // Frozen at the end of a run: browsing changes a level's geometry, and a
  // viewport recomputed from the last stage would rescale every card per click.
  const bounds = useMemo(
    () => result ? (boundsRef.current ?? allBounds(result.stages)) : null,
    [result]);

  const ensureWorker = () => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(
      `${LAB_BASE}exact-worker.js?v=trace-plan-v15${FAST_ENGINE ? "&engine=fast" : ""}`,
      { type: "module" },
    );
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === "progress") {
        setStatus(message.message);
        return;
      }
      if (message.type === "candidate") {
        if (message.id !== activeIdRef.current) return;
        // A trace replay is a real search and relays its candidates too. They
        // are tagged with the band being traced so they land in the level
        // widget that asked for them rather than in the run's busy sheet.
        (message.trace ? traceFrameStore : frameStore).set(message as ProgressFrame);
        return;
      }
      if (message.type === "solution") {
        setBrowsingLevel(null);
        if (message.meta) {
          setSolutions(current => ({ ...current, [message.meta.level]: {
            ...current[message.meta.level], ...message.meta,
            count: message.count, countExact: message.countExact,
          } }));
        }
        if (message.row && message.strands) {
          setResult(current => {
            if (!current) return current;
            return {
              ...current,
              stages: current.stages.map(stage => stage.level === message.level
                ? { ...stage, strands: message.strands } : stage),
              rows: current.rows.map(row => row.level === message.level
                ? message.row : row),
            };
          });
        }
        return;
      }
      // The band's own inputs, ahead of the census that sweeps them. The
      // pending widget draws from these; an unavailable band is left to the
      // trace-ready that follows, which carries the same reason.
      if (message.type === "trace-plan-ready") {
        if (!message.unavailable) {
          setTracePlans(current => ({
            ...current, [traceKey(message.level, message.band)]: message as TracePlan,
          }));
        }
        return;
      }
      if (message.type === "trace-progress") {
        setTraceProgress(current => ({
          ...current, [traceKey(message.level, message.band)]: message as TraceProgress,
        }));
        return;
      }
      if (message.type === "trace-ready") {
        setBrowsingLevel(null);
        // message.band is the engine's spelling ("horizontal"), not the page's
        // ("h"); traceKey collapses both onto one key.
        const key = traceKey(message.level, message.band);
        if (message.unavailable) {
          setStatus(`L${message.level}: ${message.reason}`);
          setTraceFailed(current => ({
            ...current, [key]: message.reason || "This band cannot be traced.",
          }));
          return;
        }
        setTraces(current => ({ ...current, [key]: message as TracePayload }));
        // The payload carries the engine's pick already woven — the cell the
        // panel lands on first. Seeding it here is what makes the default
        // preview instant instead of a debounce plus a worker round trip.
        const seeded = (message as TracePayload).weave;
        if (seeded?.ext) {
          setTraceWeaves(current => ({ ...current, [key]: {
            ...current[key], [weaveKey(seeded.ext, seeded.angle)]: seeded,
          } }));
        }
        setStatus(`L${message.level} ${message.band} band traced — nothing skipped.`);
        return;
      }
      if (message.type === "trace-weave-ready") {
        // Unavailable replies are cached too: they carry the reason, and a
        // cached entry is what stops the panel asking for the same cell again.
        const key = traceKey(message.level, message.band);
        const cellKey = weaveKey(message.ext ?? [], message.angle ?? 0);
        setTraceWeaves(current => {
          const forTrace = { ...current[key], [cellKey]: message as TraceWeave };
          const held = Object.keys(forTrace);
          if (held.length > TRACE_WEAVE_CACHE) delete forTrace[held[0]];
          return { ...current, [key]: forTrace };
        });
        return;
      }
      if (message.type === "semi-ready") {
        setBrowsingLevel(null);
        const meta: SemiMeta = {
          level: message.level, count: message.count ?? 0,
          listed: message.listed, truncated: message.truncated === true,
          grounded: message.grounded === true, refs: message.refs,
          reason: message.reason, band: message.band === "v" ? "v" : "h",
          items: message.items ?? [], index: 0, key: message.key ?? "near",
        };
        setSemi(current => ({ ...current, [meta.level]: meta }));
        if (!meta.count) {
          setStatus(meta.reason
            ? `L${meta.level}: ${meta.reason}`
            : `L${meta.level}: every ${meta.band.toUpperCase()} candidate closed the ring — no ${meta.band.toUpperCase()} near-misses.`);
          setSemiMode(current => ({ ...current, [meta.level]: undefined }));
          return;
        }
        setStatus(`L${meta.level}: ${meta.count} ${meta.band.toUpperCase()} near-miss${meta.count === 1 ? "" : "es"}${
          meta.truncated ? " (list truncated)" : ""}${
          meta.grounded ? "" : " — no complete ring to compare against, so the band labels are not proof"}`);
        // The scan only measures; showing the first one is a second call.
        setBrowsingLevel(meta.level);
        ensureWorker().postMessage({
          type: "semi-select", id: activeIdRef.current, level: meta.level, index: 0,
        });
        return;
      }
      // A reorder moves the same rings around; the one on screen is still the
      // right one, so nothing is redrawn and only its position changes.
      if (message.type === "semi-sorted") {
        setBrowsingLevel(null);
        setSemi(current => ({ ...current, [message.level]: {
          ...current[message.level],
          items: message.items ?? [], listed: message.listed,
          index: message.index, count: message.count, key: message.key,
        } }));
        setStatus(`L${message.level} near-misses: ${
          SEMI_SORTS.find(sort => sort.key === message.key)?.hint
          ?? "nearest to closing first"}`);
        return;
      }
      if (message.type === "semi-solution") {
        setBrowsingLevel(null);
        if (message.item === undefined) {
          setStatus(message.reason || "No near-miss at that position.");
          return;
        }
        setSemi(current => ({ ...current, [message.level]: {
          ...current[message.level],
          index: message.index, count: message.count,
          current: message.item as SemiItem,
        } }));
        setResult(current => {
          if (!current) return current;
          return {
            ...current,
            stages: current.stages.map(stage => stage.level === message.level
              ? { ...stage, strands: message.strands } : stage),
            rows: current.rows.map(row => row.level === message.level
              ? message.row : row),
          };
        });
        return;
      }
      if (message.type === "count-ready") {
        setSolutions(current => ({ ...current, [message.level]: {
          ...current[message.level], count: message.count,
          countExact: message.countExact,
        } }));
        return;
      }
      if (message.type === "result") {
        if (message.id === activeIdRef.current) {
          setFullSizeLevels(new Set());
          setResult(message.result as ExactResult);
          boundsRef.current = allBounds((message.result as ExactResult).stages);
          const meta: Record<number, SolutionMeta> = {};
          for (const entry of ((message.result as ExactResult).solutions ?? [])) {
            meta[entry.level] = entry;
          }
          setSolutions(meta);
          // A new run invalidates every near-miss list: they index into the
          // candidate lists of the session that has just been replaced.
          setSemi({});
          setSemiMode({});
          setTraces({});
          setTracePlans({});
          setTraceProgress({});
          setTraceFailed({});
          traceFrameStore.set(null);
          setTraceBand({});
          setTraceWeaves({});
          setOpenWidgets(new Set());
          frameStore.set(null);
          setEngineError(null);
          setStatus(`Exact calculation complete · ${message.result.seconds}s`);
        }
        busyRef.current = false;
        setBusy(false);
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) dispatchRef.current(pending);
        return;
      }
      if (message.type === "error") {
        if (message.id === activeIdRef.current) {
          setEngineError(message.message || "The exact engine could not finish this case.");
          frameStore.set(null);
          setStatus("Calculation stopped");
        }
        busyRef.current = false;
        setBusy(false);
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) dispatchRef.current(pending);
      }
    };
    workerRef.current = worker;
    return worker;
  };

  useEffect(() => {
    dispatchRef.current = (params: Params) => {
      if (busyRef.current) {
        pendingRef.current = params;
        setStatus("Current calculation finishing · new values queued…");
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setEngineError(null);
      frameStore.set(null);
      // The ceiling the busy figure measures against, taken from the values
      // this run was dispatched with rather than from whatever is in the
      // fields now — the two part company the moment anyone types during a run.
      setRunScale(worstCase(
        params.m, params.n, params.ks.length,
        params.extStep ?? autoStep(worstPairs(params.m, params.n), params.comboBudget)));
      setStatus("Loading the exact MXN engine…");
      setRanKey(params.key);
      const id = ++activeIdRef.current;
      ensureWorker().postMessage({
        type: "generate", id, m: params.m, n: params.n, ks: params.ks,
        preferShortArms: params.preferShortArms,
        extStep: params.extStep,
        comboBudget: params.comboBudget,
      });
    };
  });

  useEffect(() => {
    setSavedCount(readSaved().length);
    setApiUrl(readSetting(API_KEY));
    setApiToken(readSetting(TOKEN_KEY));
    return () => workerRef.current?.terminate();
  }, []);

  const runNow = () => {
    if (inputError || !ks.length) return;
    dispatchRef.current({
      m, n, ks: [...ks], key: paramsKey,
      preferShortArms,
      extStep: extStep === "auto" ? null : Number(extStep),
      comboBudget,
    });
  };

  // Stop is a hard kill: the search is one synchronous runPythonAsync call, so
  // the worker cannot read a cancel message while it is running. Terminating
  // discards the Pyodide runtime, which the next Run has to rebuild.
  const stopNow = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    activeIdRef.current += 1;
    busyRef.current = false;
    pendingRef.current = null;
    setBusy(false);
    frameStore.set(null);
    setStatus("Stopped · the engine reloads on the next run");
  };

  // Browsing reuses the session the last generate built, so it deliberately
  // does NOT go through busyRef/pendingRef — that queue is for whole runs and
  // would swallow an arrow click.
  const browse = (level: number, index: number) => {
    const meta = solutions[level];
    if (!meta || !browsable(meta) || index < 0) return;
    setBrowsingLevel(level);
    if (meta.enumerated === "none") {
      setStatus(`Enumerating solutions for L${level} — this runs one extra search…`);
    }
    ensureWorker().postMessage({
      type: "select", id: activeIdRef.current, level, index, healthyOnly,
    });
  };

  // Near-misses reuse the browse lane for the same reason: they read the
  // session the last generate built, and must not be queued behind a run.
  const browseSemi = (level: number, index: number) => {
    const near = semi[level];
    if (!near || index < 0 || index >= near.count) return;
    setBrowsingLevel(level);
    ensureWorker().postMessage({
      type: "semi-select", id: activeIdRef.current, level, index,
    });
  };

  // Reads the list the scan already built, so it is cheap and the ring on
  // screen only moves for a reason the reader asked for: a reorder keeps it
  // selected by identity and only its position changes.
  const sortSemi = (level: number, key: SemiKey) => {
    if (!semi[level] || semi[level].key === key) return;
    setBrowsingLevel(level);
    ensureWorker().postMessage({
      type: "semi-sort", id: activeIdRef.current, level, key,
    });
  };

  // One ⚑ per band. Pressing the band already on turns near-misses off; pressing
  // the other one swaps the question, which is a fresh sweep — the list in the
  // session holds one band at a time, so the H list cannot answer for V.
  const toggleSemi = (level: number, band: Band) => {
    const on = semiMode[level];
    if (on === band) {
      // Back to closed rings: the card is showing near-miss geometry, so put
      // the complete solution the reader was on back on screen.
      setSemiMode(current => ({ ...current, [level]: undefined }));
      browse(level, solutions[level]?.index ?? 0);
      return;
    }
    setSemiMode(current => ({ ...current, [level]: band }));
    const near = semi[level];
    if (near && near.band === band) {
      browseSemi(level, near.index);
      return;
    }
    const held = band === "h" ? "V" : "H";
    setBrowsingLevel(level);
    setStatus(`Sweeping the ${band.toUpperCase()} band for L${level} near-misses — every ${band.toUpperCase()} candidate against up to three ${held} partners that work…`);
    ensureWorker().postMessage({
      type: "semi-scan", id: activeIdRef.current, level, band,
    });
  };

  // Replays the level and sweeps it twice over, so it is only ever asked for
  // by opening a widget -- never as part of a generate.
  const requestTrace = (level: number, band: Band) => {
    const key = traceKey(level, band);
    if (traces[key] || traceFailed[key]) return;
    setBrowsingLevel(level);
    // The widget draws the replay's frames; last time's must not be the first
    // thing it shows this time.
    traceFrameStore.set(null);
    setStatus(`Tracing the L${level} ${band === "h" ? "horizontal" : "vertical"} band — every combo against every angle…`);
    ensureWorker().postMessage({
      type: "trace", id: activeIdRef.current, level, band,
    });
  };

  const showBand = (level: number, band: Band) => {
    setTraceBand(current => ({ ...current, [level]: band }));
    requestTrace(level, band);
  };

  // One traced cell, woven. Costs a checkpoint replay in the worker, so the
  // panel debounces its requests and cached cells are never asked for twice.
  const requestTraceWeave = (level: number, band: Band, ext: number[], angleDeg: number) => {
    const cached = traceWeaves[traceKey(level, band)];
    if (cached && cached[weaveKey(ext, angleDeg)]) return;
    ensureWorker().postMessage({
      type: "trace-weave", id: activeIdRef.current, level, band,
      ext, angle: angleDeg,
    });
  };

  const toggleWidget = (level: number) => {
    const opening = !openWidgets.has(level);
    setOpenWidgets(current => {
      const next = new Set(current);
      if (!next.delete(level)) next.add(level);
      return next;
    });
    // L0 is the starting stitch: it is not aligned, so it has no band search to
    // trace. Every other level opens on the band it was last shown at.
    if (opening && level > 0) requestTrace(level, traceBand[level] ?? "v");
  };

  const saveSolution = (stage: Stage) => {
    if (!result) return;
    const row = result.rows[stage.level - 1];
    const parent = result.stages.find(other => other.level === stage.level - 1);
    if (!row || !parent) return;
    // What the star banks depends on which list the card is showing. A
    // near-miss carries the band it is blaming and how far short it fell,
    // because without those the row is just a broken ring nobody can grade.
    const near = semiMode[stage.level] ? semi[stage.level]?.current : undefined;
    const entry: SavedSolution = {
      id: `${result.m}x${result.n}-k${row.k}-L${stage.level}-${near ? "semi-" : ""}${Date.now()}`,
      created_at: new Date().toISOString(),
      hand: "lh", direction: "cw",
      m: result.m, n: result.n, level: stage.level, k: row.k,
      ks_prefix: result.ks.slice(0, stage.level),
      parent_strands: parent.strands,
      solution_strands: stage.strands,
      h_ext: row.ext[0], v_ext: row.ext[1],
      audit: row,
      solution_index: near
        ? (semi[stage.level]?.index ?? 0)
        : (solutions[stage.level]?.index ?? 0),
      rating: null,
      kind: near ? "semi" : "complete",
      band: near ? near.band : null,
      deficit: near ? near.deficit : 0,
      refs: near ? near.refs : 0,
    };
    const rows = readSaved();
    rows.push(entry);
    const ok = writeSaved(rows);
    setSavedCount(ok ? rows.length : savedCount);
    // The word follows the button. "Saved a solution" after pressing 🚩 reads
    // as confirmation that the wrong thing was banked, which is exactly the
    // doubt the two glyphs exist to remove.
    const what = near
      ? `L${stage.level} near-miss ${entry.solution_index} 🚩`
      : `L${stage.level} solution ${entry.solution_index} ⭐`;
    setStatus(ok
      ? `Saved ${what} · ${rows.length} held locally`
      : "Could not save — browser storage is full or blocked");

    // A configured API is an ADDITION to the local copy, never a replacement:
    // if the network or the token is wrong, the star must not silently lose the
    // solution it just claimed to save.
    if (!apiUrl || !apiToken) return;
    fetch(`${apiUrl.replace(/\/+$/, "")}/solutions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify(entry),
    }).then(response => {
      setStatus(response.ok
        ? `Saved ${what} to the dataset · rate it at ${near ? "/mxn/semi/" : "/mxn/rate/"}`
        : `Held locally · dataset rejected it (HTTP ${response.status})`);
    }).catch(() => {
      setStatus("Held locally · dataset unreachable");
    });
  };

  const downloadDataset = () => {
    const rows = readSaved();
    const blob = new Blob([JSON.stringify(rows, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mxn-solutions.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const setDimension = (setter: (value: number) => void, value: string) => {
    const next = Number(value);
    if (Number.isInteger(next)) setter(Math.max(1, Math.min(4, next)));
  };

  const copyStageJson = async (stage: Stage) => {
    const json = JSON.stringify(stage.strands, null, 2);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = json;
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }
    setCopiedLevel(stage.level);
    window.setTimeout(() => setCopiedLevel(current => current === stage.level ? null : current), 1800);
  };

  const toggleLevel = (level: number) => {
    setFullSizeLevels(current => {
      const next = new Set(current);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  return (
    <main className="shell">
      <header className="masthead">
        {/* A link rather than a div, which the standalone lab had no need of:
            here the lab is one page of a site, and the masthead is where a
            reader looks for the way back. Preflight makes an anchor inherit
            colour and drop its underline, so .brand still renders as before. */}
        <a className="brand" href=".."><span className="brand-mark">MXN</span><span>Continuation Lab<small>EXACT REPOSITORY GEOMETRY</small></span></a>
        <div className="commit"><span>synced to PR #4</span> {COMMIT}</div>
      </header>

      <section className="workspace" aria-label="Exact diagram generator">
        <aside className="controls">
          <div className="controls-inner">
            <div className="section-kicker"><h2>Parameters</h2><span className="live">exact engine</span></div>
            <div className="field-row">
              <div className="field"><label htmlFor="m">m <span>H pairs</span></label><div className="number-wrap"><input id="m" type="number" min="1" max="4" value={m} onChange={e => setDimension(setM, e.target.value)} /></div></div>
              <div className="field"><label htmlFor="n">n <span>V pairs</span></label><div className="number-wrap"><input id="n" type="number" min="1" max="4" value={n} onChange={e => setDimension(setN, e.target.value)} /></div></div>
            </div>
            <div className="field">
              <label htmlFor="ks">ks <span>one rotation / level</span></label>
              <textarea id="ks" value={rawKs} onChange={e => setRawKs(e.target.value)} spellCheck={false} aria-describedby="k-range" />
              <div className="preset-row" aria-label="Example sequences">{PRESETS.map(preset => <button className="preset" type="button" key={preset} onClick={() => setRawKs(preset)}>{preset}</button>)}</div>
            </div>
            <div id="k-range" className="range-note">Valid k range: <strong>{limits.min}…{limits.max}</strong> · zero preserves the continuation.</div>

            {/* Step, budget and the short-arms preference used to sit in the open
                column and pushed Run below the fold on a laptop. Defaults cover
                ordinary runs; open Advanced when the search needs a finer grid
                or a higher combo ceiling. */}
            <details className="advanced-settings">
              <summary>
                Advanced search
                <em>
                  step {extStep === "auto" ? `auto (${resolvedStep})` : extStep}
                  {" · "}
                  budget {comboBudget.toLocaleString()}
                </em>
              </summary>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="ext-step">step <span>extension grid</span></label>
                  <div className="number-wrap">
                    <select id="ext-step" value={extStep} onChange={e => setExtStep(e.target.value as ExtStep)}>
                      {EXT_STEP_CHOICES.map(choice => (
                        <option key={choice} value={choice}>
                          {choice === "auto" ? `auto (${resolvedStep})` : choice}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="combo-budget">budget <span>combos / group</span></label>
                  <div className="number-wrap">
                    <input
                      id="combo-budget" type="number" min="1000" step="1000"
                      value={comboBudget}
                      onChange={e => {
                        const next = Number(e.target.value);
                        if (Number.isFinite(next) && next >= 1000) setComboBudget(Math.floor(next));
                      }}
                    />
                  </div>
                </div>
              </div>
              <label className="toggle-line" htmlFor="short-arms">
                <input
                  id="short-arms" type="checkbox" checked={preferShortArms}
                  onChange={e => setPreferShortArms(e.target.checked)}
                />
                <span>prefer shorter arms</span>
              </label>
              <label className="toggle-line" htmlFor="healthy-only">
                <input id="healthy-only" type="checkbox" checked={healthyOnly}
                  onChange={e => setHealthyOnly(e.target.checked)} />
                <span>browse healthy solutions only</span>
              </label>
              <div className={`range-note ${overEngineLimit ? "is-warning" : ""}`}>
                {estimatedCombos.toLocaleString()} combos in the largest group
                {" "}({worstPairCount} {worstPairCount === 1 ? "pair" : "pairs"} at step {resolvedStep})
                {overEngineLimit && <><br /><strong>Over the engine&rsquo;s {ENGINE_COMBO_LIMIT.toLocaleString()} combo limit — the search will refuse. Raise the step.</strong></>}
              </div>
            </details>
            {overEngineLimit && (
              <div className="range-note is-warning">
                Over the engine&rsquo;s {ENGINE_COMBO_LIMIT.toLocaleString()} combo limit — open Advanced and raise the step.
              </div>
            )}

            <div className="run-row">
              <button type="button" className="run-button" onClick={runNow} disabled={busy || !!inputError || !ks.length}>
                Run
              </button>
              <button type="button" className="stop-button" onClick={stopNow} disabled={!busy}>
                Stop
              </button>
            </div>
            {staleParams && <div className="range-note">Parameters changed since this run — press Run to recalculate.</div>}
            <div className="run-row">
              <button type="button" className="stop-button" onClick={downloadDataset} disabled={!savedCount}>
                Download {savedCount || ""} saved
              </button>
            </div>
            <details className="api-settings">
              <summary>dataset API {apiUrl && apiToken ? "· connected" : "· local only"}</summary>
              <div className="field">
                <label htmlFor="api-url">worker url</label>
                <input id="api-url" type="url" placeholder="https://….workers.dev" value={apiUrl}
                  onChange={e => { setApiUrl(e.target.value); writeSetting(API_KEY, e.target.value); }} />
              </div>
              <div className="field">
                <label htmlFor="api-token">admin token</label>
                <input id="api-token" type="password" placeholder="ADMIN_TOKEN" value={apiToken}
                  onChange={e => { setApiToken(e.target.value); writeSetting(TOKEN_KEY, e.target.value); }} />
              </div>
              <p className="compute-note">Kept in this browser only, never in the repository. ⭐ and 🚩 always save locally as well.</p>
            </details>

            {inputError && <div className="error-note" role="alert">{inputError}</div>}
            {engineError && <div className="error-note" role="alert">{engineError}</div>}
            {hasDeepMaxK && <div className="edge-note">Max-k beyond L1 is an open research edge in this commit and may fail its weave audit.</div>}
            <div className={`engine-status ${busy ? "is-busy" : ""}`} aria-live="polite"><span className="engine-pulse" />{status}</div>
            <div className="stats"><div className="stat"><strong>{ks.length || "—"}</strong><span>twist levels</span></div><div className="stat"><strong>{expected}</strong><span>crossings / ring</span></div></div>
            <p className="compute-note">The exact search runs locally in your browser. Deep or 3×3+ sequences can take several minutes.</p>
          </div>
        </aside>

        <div className="results">
          {/* The busy figure renders itself from the frame store — frames
              arrive too fast to route through this component's state. This is
              where finished diagrams land too. */}
          {busy && <LiveCandidateFigure store={frameStore} worst={runScale} />}
          {!result || !bounds ? (
            busy ? null : (
              <div className="calculation-panel"><div className="calculation-orbit" /><strong>{status}</strong><span>The images appear after the repository audit finishes.</span></div>
            )
          ) : (
            <div className={`sequence ${busy ? "sequence-updating" : ""}`}>
              {result.stages.map(stage => {
                const row = stage.level ? result.rows[stage.level - 1] : null;
                const compact = !fullSizeLevels.has(stage.level);
                const widgetOpen = openWidgets.has(stage.level);
                return (
                  <article className={`diagram-card ${compact ? "is-compact" : ""}`} key={`${result.m}-${result.n}-${result.ks.join("-")}-${stage.level}`}>
                    <div className="card-head">
                      <div className="level-title"><strong>{stage.level === 0 ? "L₀" : `L${stage.level}`}</strong><span>{stage.label}</span></div>
                      <div className="card-actions">
                        <span className={`k-chip ${stage.k === 0 ? "preserve" : ""}`}>{stage.k === null ? `${result.m} × ${result.n}` : `k = ${stage.k}`}</span>
                        <button className={`copy-json ${copiedLevel === stage.level ? "is-copied" : ""}`} type="button" onClick={() => copyStageJson(stage)} aria-label={`Copy JSON for level ${stage.level}`}>
                          {copiedLevel === stage.level ? "Copied ✓" : "Copy JSON"}
                        </button>
                        {stage.level > 0 && (() => {
                          const meta = solutions[stage.level];
                          if (!meta) return null;
                          const busyHere = browsingLevel === stage.level;
                          const near = semi[stage.level];
                          const band = semiMode[stage.level];
                          const onSemi = band !== undefined;
                          // k=0 has one configuration and nothing to sweep, so
                          // it gets neither list.
                          const canSemi = browsable(meta);
                          // One flag per band, and nothing else: a near-miss is
                          // always blamed on one band, so "show me the H ones"
                          // and "show me the V ones" are the two questions a
                          // level card can be asked. A single toggle answered
                          // both at once and left the reader to spot the band
                          // on each row as they walked the mixed list.
                          const semiFlags = canSemi ? (["h", "v"] as const).map(side => {
                            const held = side === "h" ? "V" : "H";
                            const active = band === side;
                            return (
                              <button key={`flag-${side}`} className={`semi-flag ${active ? "is-on" : ""}`}
                                type="button" onClick={() => toggleSemi(stage.level, side)} disabled={busyHere}
                                title={active
                                  ? `Back to rings that close`
                                  : `${side.toUpperCase()} near-misses: ${held} held at a value that closes, ${side.toUpperCase()} swept`}
                                aria-pressed={active}
                                aria-label={`${active ? "Show complete rings" : `Show ${side.toUpperCase()} band near-misses`} for level ${stage.level}`}>
                                ⚑<i>{side.toUpperCase()}</i>
                              </button>
                            );
                          }) : null;

                          if (onSemi) {
                            const item = near?.current;
                            return (
                              <span className="solution-nav is-semi">
                                <button type="button" onClick={() => browseSemi(stage.level, (near?.index ?? 0) - 1)}
                                  disabled={busyHere || !near || near.index === 0}
                                  aria-label={`Previous near-miss for level ${stage.level}`}>‹</button>
                                <b>{busyHere || !near ? "…"
                                  : `${near.index + 1} / ${near.count}${near.truncated ? "+" : ""}`}</b>
                                {item && (
                                  <em className={item.band === "h" ? "band-h" : "band-v"}
                                    title={`${item.deficit} crossing${item.deficit === 1 ? "" : "s"} short against `
                                      + `${item.refs} partner${item.refs === 1 ? "" : "s"} that do close`
                                      + (item.folded ? " · this band's own arms cross each other" : "")
                                      // The numbers the sort keys are built out of. They used to be
                                      // readable only from the H± tooltips, which are gone, and
                                      // without them a reader cannot see why one row sorts above
                                      // another.
                                      + ` · H ${item.hExt.reduce((sum, e) => sum + e, 0)}px`
                                      + ` · V ${item.vExt.reduce((sum, e) => sum + e, 0)}px`
                                      + ` · worst pair ${item.peak}px`}>
                                    {item.band === "h" ? "V ok · H short" : "H ok · V short"}
                                    {" "}{item.across}/{item.expected}
                                  </em>
                                )}
                                <button type="button" onClick={() => browseSemi(stage.level, (near?.index ?? 0) + 1)}
                                  disabled={busyHere || !near || near.index + 1 >= near.count}
                                  aria-label={`Next near-miss for level ${stage.level}`}>›</button>
                                {/* Four orders, one lit. NEAR is the sweep's own
                                    and stays the default; H and V rank one band's
                                    answer by that band's own string, which is the
                                    question the ⚑ next to them asked; BEST ranks
                                    by the worst single pair, so the ring nothing
                                    had to be stretched far for comes first. */}
                                <span className="semi-sorts" role="group"
                                  aria-label={`Sort level ${stage.level} near-misses`}>
                                  <i aria-hidden="true">SORT</i>
                                  {SEMI_SORTS.map(sort => {
                                    const active = (near?.key ?? "near") === sort.key;
                                    return (
                                      <button key={sort.key} className={`semi-sort ${active ? "is-on" : ""}`}
                                        type="button" onClick={() => sortSemi(stage.level, sort.key)}
                                        disabled={busyHere || !near || active}
                                        aria-pressed={active}
                                        title={`${active ? "Sorted" : "Sort"}: ${sort.hint}`}
                                        aria-label={`Sort level ${stage.level} near-misses: ${sort.hint}`}>
                                        {sort.label}
                                      </button>
                                    );
                                  })}
                                </span>
                                {/* A flag, not the star. The two buttons do the
                                    same thing to different objects and land in
                                    different queues, and a ring that fell short
                                    is flagged for someone to look at rather than
                                    kept for being good. Same glyph for both was
                                    the whole reason near-misses looked like they
                                    were not saving: the star that was pressed
                                    was the other one. */}
                                <button className="save-solution save-semi" type="button" onClick={() => saveSolution(stage)}
                                  disabled={!item}
                                  title="Flag this near-miss for rating — goes to /mxn/semi/"
                                  aria-label={`Flag level ${stage.level} near-miss for the dataset`}>🚩</button>
                                {semiFlags}
                              </span>
                            );
                          }
                          if (!canSemi) {
                            return <span className="solution-note" title={meta.reason ?? ""}>one solution</span>;
                          }
                          const shown = meta.count === undefined
                            ? `${meta.index + 1}`
                            : `${meta.index + 1} / ${meta.count}${meta.countExact ? "" : "+"}`;
                          return (
                            <span className="solution-nav">
                              <button type="button" onClick={() => browse(stage.level, meta.index - 1)}
                                disabled={busyHere || meta.index === 0}
                                aria-label={`Previous solution for level ${stage.level}`}>‹</button>
                              <b>{busyHere ? "…" : shown}</b>
                              {meta.index === meta.enginePick && <em>engine pick</em>}
                              <button type="button" onClick={() => browse(stage.level, meta.index + 1)}
                                disabled={busyHere}
                                aria-label={`Next solution for level ${stage.level}`}>›</button>
                              <button className="save-solution" type="button" onClick={() => saveSolution(stage)}
                                title="Save this closed ring for rating — goes to /mxn/rate/"
                                aria-label={`Save level ${stage.level} solution to the dataset`}>⭐</button>
                              {semiFlags}
                            </span>
                          );
                        })()}
                        <button className="resize-level" type="button" onClick={() => toggleLevel(stage.level)} aria-pressed={compact} aria-controls={`level-panel-${stage.level}`} aria-label={`${compact ? "Make larger" : "Make smaller"} diagram for level ${stage.level}`} title={`${compact ? "Make diagram larger" : "Make diagram smaller"}`}>
                          {compact ? "+" : "−"}
                        </button>
                      </div>
                    </div>
                    <div id={`level-panel-${stage.level}`} className="level-body">
                      <div className="level-main">
                      <div className="canvas-wrap exact-canvas"><ExactCanvas stage={stage} bounds={bounds} /><span className="canvas-corner">{row ? `${row.state} · ${row.healthy ? "WEAVE" : "NOT A WEAVE"}` : "starting stitch"}</span></div>
                      <div className="card-foot exact-metrics">
                        <div className="metric"><span>suffixes</span><strong>{suffixLabel(stage.level)}</strong></div>
                        <div className="metric"><span>crossings</span><strong>{row ? `${row.across}/${row.expected}` : "—"}</strong></div>
                        <div className="metric"><span>H extensions</span><strong>{row ? formatExtensions(row.ext[0]) : "—"}</strong></div>
                        <div className="metric"><span>V extensions</span><strong>{row ? formatExtensions(row.ext[1]) : "—"}</strong></div>
                      </div>
                      {row && <div className="audit-strip">
                        <span><b>gap H/V</b>{row.gap[0].toFixed(2)} / {row.gap[1].toFixed(2)}</span>
                        <span><b>within</b>{row.within}</span>
                        <span><b>masks</b>{row.masks}</span>
                        <span><b>stray</b>{row.stray}</span>
                        <span><b>broken</b>{row.broken}</span>
                        <em>{row.applied.length ? row.applied.join(" · ") : "k-based groups"}</em>
                      </div>}
                      </div>
                      {/* The level widget: a column of the card, to the right of
                          the diagram. Closed it is a rail on that edge; open it
                          one per Lᵥ and opened or closed per card, so two
                          levels can be held open side by side rather than the
                          page having a single panel that only ever describes
                          the last thing clicked. Its contents are still to be
                          decided; the drawer, its state and its place on the
                          card are what is settled here. */}
                      <div className={`level-widget ${widgetOpen ? "is-open" : ""}`}>
                        <button type="button" className="level-widget-head"
                          onClick={() => toggleWidget(stage.level)}
                          aria-expanded={widgetOpen}
                          aria-controls={`level-widget-${stage.level}`}>
                          <b>L{stage.level === 0 ? "₀" : stage.level} widget</b>
                          <span>{widgetOpen ? "close" : "open"}</span>
                          <i aria-hidden="true">{widgetOpen ? "−" : "+"}</i>
                        </button>
                        {widgetOpen && (
                          <div className="level-widget-body" id={`level-widget-${stage.level}`}>
                            {(() => {
                              if (stage.level === 0) {
                                return <p>L₀ is the starting stitch. It is built, not
                                  searched, so there is no band census to show.</p>;
                              }
                              const band = traceBand[stage.level] ?? "v";
                              const key = traceKey(stage.level, band);
                              const payload = traces[key];
                              const failed = traceFailed[key];
                              if (payload) {
                                return <TracePanel data={payload}
                                  weaves={traceWeaves[key]}
                                  onWeave={(ext, angleDeg) =>
                                    requestTraceWeave(stage.level, band, ext, angleDeg)}
                                  onClose={() => toggleWidget(stage.level)}
                                  onBand={b => showBand(stage.level, b)} />;
                              }
                              return (
                                <div className="trace-pending">
                                  {/* The band itself, swept here while the
                                      worker sweeps it there: real combos, real
                                      angles, and the worker's own position
                                      under them. A failed band explains itself
                                      instead. */}
                                  {!failed && <TraceSweep band={band}
                                    level={stage.level}
                                    plan={tracePlans[key]}
                                    progress={traceProgress[key]}
                                    replay={traceFrameStore}
                                    stage={stage} bounds={bounds} />}
                                  {/* Once the plan lands the wait can be
                                      described in the band's own numbers
                                      rather than in the shape of the job. */}
                                  <p>{failed ?? (tracePlans[key]
                                    ? `Sweeping all ${tracePlans[key].combos.toLocaleString()} extension `
                                      + `combos of L${stage.level}'s ${band === "h" ? "horizontal" : "vertical"} `
                                      + `band against ${tracePlans[key].nAngles} angles each — `
                                      + `${tracePlans[key].evaluations.toLocaleString()} tests, none skipped.`
                                    : `Replaying L${stage.level} and sweeping every combo of its `
                                      + `${band === "h" ? "horizontal" : "vertical"} band against every angle…`)}</p>
                                  <div className="trace-pending-actions">
                                    {(["h", "v"] as const).map(b => (
                                      <button key={b} type="button" aria-pressed={band === b}
                                        onClick={() => showBand(stage.level, b)}>{b.toUpperCase()}</button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="method">
        <div className="method-head"><h2>Calculated, not approximated</h2><p>Each image is rendered from the strand JSON produced by the current Python engine. Mask patches are intersected as stroke and fill paths at the engine-selected crossings, and the visible layer labels come from the calculated ring.</p></div>
        <div className="method-grid">
          <div className="method-step"><b>1</b><h3>Generate</h3><p>Build the starting stitch with the repository’s LH engine.</p></div>
          <div className="method-step"><b>2</b><h3>Align</h3><p>Search real pair extensions and headings for each k.</p></div>
          <div className="method-step"><b>3</b><h3>Audit</h3><p>Check across, within, masks, stray, and broken crossings.</p></div>
          <div className="method-step"><b>4</b><h3>Render</h3><p>Draw actual endpoints, widths, colors, masks, and labels.</p></div>
        </div>
      </section>

      <footer className="footer"><span>Calculation source · ysetbon/mxn · commit {COMMIT}</span><a href="..">← Scoubidou3D</a><a href="rate/">Categoriser →</a><a href="semi/">Near-misses →</a><a href="https://github.com/ysetbon/mxn" target="_blank" rel="noreferrer">View source ↗</a></footer>
    </main>
  );
}
