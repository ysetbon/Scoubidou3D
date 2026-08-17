"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  CACHE_TOKEN_KEY, CACHE_URL_KEY, CACHE_VERSION,
  createCache, parseRunKey, readSetting, writeSetting,
  type CatalogueEntry, type RunArtifact, type RunDescriptor, type TraceArtifact,
} from "./cache";
import {
  allBounds, drawExactStage,
  type Bounds, type Stage, type Strand,
} from "./exact-draw";
import {
  auditOfPick, findPrefixBests, findShelfBest, reachOfPick,
  type CardAudit, type JudgedPick,
} from "./picks-shelf";
import {
  DEFAULT_COMBO_BUDGET, ENGINE_COMBO_LIMIT,
  autoStep, comboCount, handGrid, worstCase, worstPairs,
} from "./search-cost";
import { bandKey, traceKey } from "./trace-band";
import {
  TracePanel, TraceSweep, weaveKey,
  type TracePayload, type TracePlan, type TraceProgress, type TraceWeave,
} from "./trace-panel";

// The renderer moved to exact-draw.ts so the trace panel can use it too; these
// stay exported from here because /mxn/rate/ already imports them from here.
export { allBounds, drawExactStage };
export type { Bounds, Stage, Strand };
// Likewise the search-cost arithmetic, which /mxn/gpu/ needs without the lab
// attached to it: mocks/widgets.html already imports these four from here.
export { autoStep, comboCount, worstCase, worstPairs };

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

// Where precomputed answers live, if anywhere. See cache.ts.
//
// `data-cache` on #lab is the site-wide default and is what makes the fast path
// work for a reader who has configured nothing — it is empty in this repository
// because a deployment's address does not belong in it. `?cache=` overrides
// everything so a URL can be tried without touching anyone's storage, and
// `?cache=` with nothing after it turns the cache off, which is how you check
// that the page still computes what it claims to be reading.
const CACHE_ATTR = document.getElementById("lab")?.dataset.cache?.trim() ?? "";
const PAGE_QUERY = new URLSearchParams(window.location.search);
const CACHE_PARAM = PAGE_QUERY.get("cache");
const OPEN_ADVANCED_FROM_URL = PAGE_QUERY.get("advanced") === "1";

const COMMIT = "984d9ed";
const PRESETS = ["1", "1 1 -1", "1 1 -1 -1 -1 -1 -1", "1 1 1", "1 -1 1 -1", "-1 -1"];

const EXT_STEP_CHOICES = ["auto", "20", "10", "5"] as const;
type ExtStep = (typeof EXT_STEP_CHOICES)[number];

// The busy indicator is a contact sheet of the candidates the engine actually
// produced. Tiles are drawn at twice their 72px slot so they stay crisp on a
// retina panel while costing a fraction of a full-size card render.
const SHEET_TILES = 24;
const TILE_PIXELS = 144;

// How many woven trace cells to keep per level-and-band. Each is a full strand
// list; forty covers a scrubbing session while keeping the cache tens of
// kilobytes rather than unbounded.
const TRACE_WEAVE_CACHE = 40;

// k=0 preserves the continuation and has exactly one solution by construction.
// A seeded engine level can enumerate on the first click. An adopted human ring
// cannot: it has no engine candidate list, and building one would search L1.
function browsable(meta: {
  enumerated: string; enumerable?: boolean; reason?: string | null;
}) {
  return meta.enumerable !== false
    && (meta.enumerated === "full" || !(meta.reason ?? "").startsWith("k=0"));
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
type CountProgress = { scanned: number; cells: number; count: number };
export type AuditRow = {
  level: number; k: number; expected: number; state: string;
  gap: [number, number]; ext: [number[], number[]];
  across: number; within: number; masks: number; stray: number; broken: number;
  applied: string[]; healthy: boolean;
};
type SolutionMeta = {
  level: number;
  enumerated: "none" | "full";
  enumerable?: boolean;
  reason?: string | null;
  hCount: number; vCount: number; candidates: number;
  enginePick: number; index: number; truncated: boolean;
  count?: number; countExact?: boolean;
  /** How many of `count` audit as weaves. Arrives with the exact count. */
  healthy?: number;
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
// The dataset API is optional. Without it the star still works, locally — the
// lab is a static page and must keep working with no backend at all. The same
// two fields now also say where the result cache is, which is why the keys and
// the guarded accessors live in cache.ts: /mxn/gpu/ writes them too.
const API_KEY = CACHE_URL_KEY;
const TOKEN_KEY = CACHE_TOKEN_KEY;

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
  /** Cap each level past the first at the reach the levels below it used. */
  reachFromPrevious: boolean;
  /** The grid a judged ★ best implies: 0 for "search the full width". */
  handStep: number;
  handCeiling: number;
  /** The judged L1 ring itself, when the pick carries one: adopted, not searched. */
  level1Ring: { strands: unknown[]; h_ext: number[]; v_ext: number[] } | null;
};

function parseKs(raw: string) {
  const cleaned = raw
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/[\[\],_]/g, " ")
    .trim();
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
 * A run's audit row as the card reads it.
 *
 * The card now draws two kinds of ring — what the engine computed, and what a
 * person judged — and the two carry different amounts of measurement. Both go
 * through CardAudit so the numbers under a diagram always describe the ring
 * that is on it; see auditOfPick in picks-shelf.ts for the other half.
 */
function auditOfRow(row: AuditRow | null): CardAudit | null {
  return row ? {
    across: row.across, expected: row.expected, ext: row.ext, gap: row.gap,
    within: row.within, masks: row.masks, stray: row.stray, broken: row.broken,
    applied: row.applied,
  } : null;
}

/**
 * A judged ring as a one-card result, for the run=0 path that must not wake
 * the engine. L2 and L3 are not invented: we only have what a person judged.
 */
function previewFromPicks(
  picks: Record<number, JudgedPick>, d: RunDescriptor,
): ExactResult | null {
  const levels = Object.keys(picks).map(Number).sort((a, b) => a - b);
  const stages: Stage[] = [];
  const rows: AuditRow[] = [];
  const solutions: SolutionMeta[] = [];
  for (const level of levels) {
    const pick = picks[level];
    const k = d.ks[level - 1] ?? d.ks[0];
    stages.push({
      level, k, strands: pick.strands,
      label: `★ best by ${pick.judgement.chooser}`,
    });
    const audit = pick.judgement.audit;
    rows[level - 1] = {
      level, k, state: "judged",
      expected: audit?.expected ?? 4 * d.m * d.n,
      gap: [0, 0], ext: [pick.hExt, pick.vExt],
      across: audit?.crossings ?? 0, within: 0, masks: 0,
      stray: audit?.stray ?? 0, broken: audit?.broken ?? 0,
      applied: [], healthy: false,
    };
    solutions.push({
      level, enumerated: "none", enumerable: false,
      reason: "adopted ring · no engine list",
      hCount: 0, vCount: 0, candidates: 0,
      enginePick: 0, index: 0, truncated: false,
    });
  }
  if (!stages.length) return null;
  const expected = rows.find(Boolean)?.expected ?? 4 * d.m * d.n;
  return { m: d.m, n: d.n, ks: [...d.ks], expected, seconds: 0,
    rows, stages, solutions };
}

/** A number nobody measured is a dash, never a zero. */
function measured(value: number | null) {
  return value === null ? "—" : String(value);
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
export function LiveCandidateFigure({ store, worst, counting }: {
  store: FrameStore;
  /** The run's ceiling, from the parameters it was started with. */
  worst: { perLevel: number; groups: number; total: number };
  counting?: Record<number, CountProgress>;
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
  const counts = Object.entries(counting ?? {})
    .map(([level, value]) => ({ level: Number(level), ...value }))
    .sort((a, b) => a.level - b.level);
  const activeCount = counts[counts.length - 1];
  const countingNow = activeCount !== undefined;
  const countCells = counts.reduce((sum, value) => sum + value.cells, 0);
  const countScanned = counts.reduce((sum, value) => sum + value.scanned, 0);
  const countOverall = countCells ? Math.min(1, countScanned / countCells) : 0;
  const countWithin = activeCount?.cells
    ? Math.min(1, activeCount.scanned / activeCount.cells) : 0;
  const shownOverall = countingNow ? countOverall : overall;
  const shownWithin = countingNow ? countWithin : within;

  return (
    <figure className="candidate-sheet" aria-label="Live search candidates">
      <figcaption>
        <span>
          {countingNow ? "solution count" : "live candidates"}
          {countingNow
            ? ` · L${activeCount.level}`
            : frame ? ` · L${frame.level} · k=${frame.k}` : ""}
        </span>
        <b>{countingNow
          ? "search complete · counting exact totals"
          : frame?.phase ?? "starting search"}</b>
        <em>
          {countingNow
            ? `${activeCount.count.toLocaleString()} closed · `
              + `${activeCount.scanned.toLocaleString()} / ${activeCount.cells.toLocaleString()} pairs`
            : frame && frame.total > 0
            ? `${frame.completed.toLocaleString()} / ${frame.total.toLocaleString()}`
            : "preparing search"}
          {!countingNow && frame && frame.valid > 0 ? ` · ${frame.valid} valid` : ""}
        </em>
      </figcaption>
      <div className="sheet-stage">
        <CandidateSheet frame={frame} />
        {/* aria-hidden: the engine status line already carries this state
            politely, and a bar that moves every frame is not worth announcing.
            Kept to one plaque-width column so it covers no more of the sheet
            than the word "thinking" did. */}
        <div className="thinking-plaque" aria-hidden="true">
          <span className="thinking-word">
            {countingNow ? "counting" : "thinking"}<ThinkingDots />
          </span>
          {/* Two bars, one track: the pale fill is the whole run against its
              ceiling, the solid one is the group being searched now. */}
          <span className="thinking-track">
            <i className="thinking-run" style={{ width: `${shownOverall * 100}%` }} />
            <b className="thinking-group" style={{ width: `${shownWithin * 100}%` }} />
          </span>
          <span className="thinking-scale">
            {countingNow
              ? `${Math.round(countWithin * 100)}% of L${activeCount.level}`
              : frame && frame.total > 0
              ? `${Math.round(within * 100)}% of group ${group}/${worst.groups}`
              : `group 1/${worst.groups}`}
            <em>{countingNow
              ? `${countScanned.toLocaleString()} / ${countCells.toLocaleString()} pairs before cards`
              : `≤ ${worst.total.toLocaleString()} combos`}</em>
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
  // Off by default, and deliberately: it changes which ring a level settles on,
  // and what the engine ships is still what a reader gets unless they ask.
  const [reachFromPrevious, setReachFromPrevious] = useState(false);
  // Search on the grid a judged ★ best implies rather than the engine's full
  // width. Off by default: it is a different search, and it needs a pick.
  const [handFromPick, setHandFromPick] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(OPEN_ADVANCED_FROM_URL);
  /** What the last resolve found, for the sidebar. */
  const [handNote, setHandNote] = useState("");
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
  // Which traced cell a level's diagram is showing instead of its own ring, and
  // the ring it displaced. Both are per level, because two widgets can be open.
  const [tracedShown, setTracedShown] = useState<Record<number, TraceWeave>>({});
  const [tracedRing, setTracedRing] =
    useState<Record<number, { strands: Strand[]; row: AuditRow }>>({});
  // A person's ★ best for a level, and the run's own ring it displaced. Same
  // shape as the traced pair above, for the same reason: going back has to
  // return the level's OWN ring rather than whatever replaced it last.
  const [judgedShown, setJudgedShown] = useState<Record<number, JudgedPick>>({});
  const [judgedRing, setJudgedRing] = useState<Record<number, Strand[]>>({});
  /** What the shelf holds for the run on screen, applied or not. */
  const [shelfBest, setShelfBest] = useState<Record<number, JudgedPick>>({});
  /** What the picks lookup found, for the sidebar. "" until one has run. */
  const [picksNote, setPicksNote] = useState("");
  // The in-run counting, level by level, for the strip under the busy sheet:
  // the walk's position and what it has found so far.
  const [counting, setCounting] = useState<Record<number, CountProgress>>({});
  /** Forget an override without putting anything back: for when something else
   *  has already replaced the ring on the card. */
  const clearTraced = (level: number) => {
    setTracedShown(current => {
      if (!current[level]) return current;
      const next = { ...current };
      delete next[level];
      return next;
    });
    setTracedRing(current => {
      if (!current[level]) return current;
      const next = { ...current };
      delete next[level];
      return next;
    });
  };
  /** The same for a judged ring, for when the worker has just sent another. */
  const clearJudged = (level: number) => {
    setJudgedShown(current => {
      if (!current[level]) return current;
      const next = { ...current };
      delete next[level];
      return next;
    });
    setJudgedRing(current => {
      if (!current[level]) return current;
      const next = { ...current };
      delete next[level];
      return next;
    });
  };
  /** Every judged ring forgotten: a new run is about different parameters. */
  const clearJudgedAll = () => {
    setJudgedShown({});
    setJudgedRing({});
    setShelfBest({});
    setPicksNote("");
  };
  const [browsingLevel, setBrowsingLevel] = useState<number | null>(null);
  const [savedCount, setSavedCount] = useState(() => readSaved().length);
  const [healthyOnly, setHealthyOnly] = useState(false);
  // Read at first render rather than in an effect: the deep-link handler below
  // dispatches a run on mount, and a URL that only arrives on the second render
  // would send that run past the cache and into the engine.
  const [apiUrl, setApiUrl] = useState(() => readSetting(API_KEY));
  const [apiToken, setApiToken] = useState(() => readSetting(TOKEN_KEY));
  // What the last Run found on the shelf. "off" is the state of a page with no
  // cache configured, which is every page until someone configures one.
  const [cacheState, setCacheState] =
    useState<"off" | "looking" | "hit" | "miss">("off");
  /** Whether this run's L1 was replayed off a stored single-k run. */
  const [l1Replayed, setL1Replayed] = useState(false);
  const [cachedRun, setCachedRun] =
    useState<{ computedAt: string; seconds: number } | null>(null);
  const [publishing, setPublishing] = useState(false);
  // The viewport is derived from the LAST stage, so once a browsed level
  // changes geometry every card would rescale on each arrow click. Freeze it
  // for the lifetime of one generate.
  const boundsRef = useRef<Bounds | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const busyRef = useRef(false);
  const pendingRef = useRef<Params | null>(null);
  const activeIdRef = useRef(0);
  // Which parameter set the worker's Python session is holding, if any.
  //
  // A cached run paints the cards with nothing behind them: the geometry is
  // real and the numbers are real, but Pyodide has never seen this size. Every
  // control that reads the session — the solution browser, the ⚑ sweeps, an
  // uncached census, a woven trace cell — therefore has to warm one first, and
  // says so while it does. Warming is a full generate; it is just no longer the
  // thing standing between a reader and the first picture.
  const sessionRef = useRef<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  /** The generate that is only warming a session, not producing what is shown. */
  const warmIdRef = useRef<number | null>(null);
  /** What to do once it lands. One deep: a second click replaces the first. */
  const afterWarmRef = useRef<(() => void) | null>(null);
  const lastParamsRef = useRef<Params | null>(null);
  const ranKeyRef = useRef<string | null>(null);
  // Levels whose exact solution count is still to be firmed up, drained one
  // request at a time so a click never queues behind the whole product.
  const countQueueRef = useRef<number[]>([]);
  // Cells per counting round. The worker takes one message at a time, so this
  // is the most replays a click can be stuck behind while the count thinks in
  // the background. A replay is ~5 ms, not the 1 ms the folklore said, so the
  // round is tiny on purpose — the chain supplies the persistence, and a few
  // hundred extra messages cost milliseconds against the replays they space.
  const COUNT_ROUND = 24;
  const dispatchRef = useRef<(params: Params) => void>(() => {});
  const loadJudgedRef = useRef<(d: RunDescriptor, id: number, preview?: boolean) => void>(() => {});

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
  const paramsKey = `${m}:${n}:${ks.join(",")}:${preferShortArms}:${extStep}:${comboBudget}`
    + `:${reachFromPrevious}:${handFromPick}`;
  const staleParams = ranKey !== null && ranKey !== paramsKey && !busy;
  // Frozen at the end of a run: browsing changes a level's geometry, and a
  // viewport recomputed from the last stage would rescale every card per click.
  const bounds = useMemo(
    () => result ? (boundsRef.current ?? allBounds(result.stages)) : null,
    [result]);

  // One client per (url, token). Held on a ref as well, because the run and
  // trace paths are async and must use the client the page has now rather than
  // the one captured when the click happened.
  const cache = useMemo(() => createCache({
    base: CACHE_PARAM ?? (apiUrl || CACHE_ATTR),
    token: apiToken,
    hostId: "lab",
  }), [apiUrl, apiToken]);
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  /** The parameters a cache entry is addressed by, from a dispatched run. */
  const descriptorFor = (params: Params): RunDescriptor => ({
    m: params.m, n: params.n, ks: [...params.ks],
    hand: "lh", direction: "cw",
    shortArms: params.preferShortArms,
    step: params.extStep ?? "auto",
    budget: params.comboBudget,
    reachFromPrevious: params.reachFromPrevious,
    handCeiling: params.handCeiling || undefined,
    handAdopted: !!params.level1Ring,
  });

  /**
   * Level 1's extensions off a stored single-k run, when there is one.
   *
   * Level 1 depends on nothing but m, n, ks[0], the hand, the direction and the
   * search flags — the same fact bridge.generate's own `level1_for_k` relies on
   * within a single run — so the L1 of `[-1, -1, -1]` IS the L1 of the stored
   * `[-1]`. Replaying it rather than searching for it again is verified
   * bit-for-bit (ring hash and every audit number, on 3×1, 2×1 and 2×2) and
   * took 3×1 `[-1,-1,-1]` from 170.5s to 134.7s.
   *
   * The one thing it costs is L1's own solution browser in this run: a pinned
   * attempt evaluates the single combo it was told to use, so there is no list
   * to page through. That enumeration is not lost — the single-k run it came
   * from has it in full — and the card says where to find it.
   */
  const level1For = async (params: Params): Promise<number[][] | null> => {
    if (params.ks.length < 2 || !cacheRef.current.readable) return null;
    try {
      const stored = await cacheRef.current.getRun(
        { ...descriptorFor(params), ks: [params.ks[0]] });
      const ext = (stored?.result as ExactResult | undefined)?.rows?.[0]?.ext;
      return Array.isArray(ext) && ext.length === 2 ? ext : null;
    } catch {
      return null;   // a shelf that is away just means the level is searched
    }
  };

  /**
   * Any stored variant of these m/n/ks, when the exact step and budget missed.
   *
   * The step and budget are part of a run's identity — a sweep at step 5 is a
   * different search from one at auto, and the shelf keeps them apart on
   * purpose (see cache.ts). But a reader who types m, n and ks is asking about
   * the size, not about a step: if a sweep stored these ks under any flags,
   * loading that beats twenty seconds of local compute. The page then ADOPTS
   * the stored flags into its own fields, so what is on screen is never an
   * answer to a question the fields did not ask.
   */
  const findShelfVariant = async (params: Params) => {
    const ksPath = params.ks.map(k => String(Math.trunc(k))).join("_");
    const prefix = `run/${CACHE_VERSION}/lh-cw/${params.m}x${params.n}/${ksPath}/`;
    // The prefix stops at the ks, so this lists BOTH shelves for this size --
    // capped and not. The flag filter below is what keeps them apart.
    let entries: CatalogueEntry[];
    try {
      entries = await cacheRef.current.catalogue(prefix, 50);
    } catch {
      return null;   // no catalogue is the same as an empty one
    }
    const variants = entries.flatMap(entry => {
      // parseRunKey rather than a regex of our own: cache.ts owns the grammar
      // in both directions, and a second reading of it here would drift.
      const parsed = parseRunKey(entry.key);
      if (!parsed || parsed.cacheVersion !== CACHE_VERSION) return [];
      const step = String(parsed.descriptor.step);
      // The step select only offers these values; adopting one it cannot show
      // would leave the fields unable to say what is on screen.
      if (!(EXT_STEP_CHOICES as readonly string[]).includes(step)) return [];
      // The reach cap is the one flag a variant may NOT differ on. A step and a
      // budget describe how the grid was walked, and a reader who typed m, n
      // and ks is asking about the size rather than about a step -- but the cap
      // decides which ring a level settles on, so adopting across it would
      // answer a question nobody asked and, worse, make ticking the box appear
      // to do nothing: the uncapped run is always there to be adopted instead.
      if (!!parsed.descriptor.reachFromPrevious !== params.reachFromPrevious) return [];
      // Same rule for the hand-sized shelves: a run searched inside a pick's
      // reach — or standing on its ring outright — answers a different
      // question from a full-width run, in both directions.
      if ((parsed.descriptor.handCeiling ?? 0) !== (params.handCeiling || 0)) return [];
      if (!!parsed.descriptor.handAdopted !== !!params.level1Ring) return [];
      return [{
        shortArms: parsed.descriptor.shortArms,
        step: step as ExtStep,
        budget: parsed.descriptor.budget,
        reach: !!parsed.descriptor.reachFromPrevious,
        computedAt: entry.computedAt,
      }];
    });
    variants.sort((a, b) =>
      Number(b.shortArms === params.preferShortArms)
        - Number(a.shortArms === params.preferShortArms)
      || b.computedAt.localeCompare(a.computedAt));
    return variants[0] ?? null;
  };

  /** Everything a new run invalidates, minus the result itself. */
  const clearDerived = () => {
    clearJudgedAll();
    setSemi({});
    setSemiMode({});
    setTraces({});
    setTracePlans({});
    setTraceProgress({});
    setTraceFailed({});
    traceFrameStore.set(null);
    setTraceBand({});
    setTraceWeaves({});
    setTracedShown({});
    setTracedRing({});
    setCounting({});
    setOpenWidgets(new Set());
  };

  const ensureWorker = () => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(
      `${LAB_BASE}exact-worker.js?v=trace-plan-v29${FAST_ENGINE ? "&engine=fast" : ""}`,
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
        // The browser is putting a ring on the card, so whatever the trace
        // widget or the shelf had put there is gone -- and the ring it
        // displaced with it.
        clearTraced(message.level);
        clearJudged(message.level);
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
        clearTraced(message.level);
        clearJudged(message.level);
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
      if (message.type === "count-progress") {
        if (message.id !== activeIdRef.current) return;
        setCounting(current => ({ ...current, [message.level]: {
          scanned: message.scanned, cells: message.cells, count: message.count,
        } }));
        return;
      }
      if (message.type === "count-ready") {
        if (message.id !== activeIdRef.current) return;   // a newer run owns the worker
        setSolutions(current => ({ ...current, [message.level]: {
          ...current[message.level], count: message.count,
          countExact: message.countExact, healthy: message.healthy,
        } }));
        // The engine's count walk is budget-bounded and resumable, so drive it:
        // the same level again until its count is exact, then the next level
        // waiting. One request in flight at a time — anything the reader asks
        // for slots in between rounds instead of behind all of them.
        if (!message.countExact) {
          workerRef.current?.postMessage({
            type: "count", id: message.id, level: message.level, budget: COUNT_ROUND,
          });
        } else {
          const next = countQueueRef.current.shift();
          if (next !== undefined) {
            workerRef.current?.postMessage({
              type: "count", id: message.id, level: next, budget: COUNT_ROUND,
            });
          }
        }
        return;
      }
      if (message.type === "result") {
        if (message.id === activeIdRef.current) {
          const payload = message.result as ExactResult;
          const warming = warmIdRef.current === message.id;
          warmIdRef.current = null;
          // The session is now this parameter set's, whichever kind of generate
          // just landed. Browsing, sweeping and tracing all read it.
          sessionRef.current = ranKeyRef.current;
          setSessionReady(true);

          if (warming) {
            // A warm behind cards that came from the cache. It is the same
            // computation over the same inputs — `random.seed(0)`, one engine —
            // so the geometry it produced is the geometry already on screen,
            // and replacing it would only make every card flicker and throw
            // away any traced cell a reader had pushed onto one.
            setSolutions(current => {
              const merged: Record<number, SolutionMeta> = {};
              for (const entry of payload.solutions ?? []) {
                const held = current[entry.level];
                merged[entry.level] = {
                  ...entry,
                  // A count the cache already walked to the end is not made
                  // less exact by a warm whose in-run counting stopped at its
                  // own ceiling.
                  count: held?.countExact ? held.count : entry.count,
                  countExact: held?.countExact || entry.countExact,
                  healthy: held?.countExact ? held.healthy : entry.healthy,
                  index: held?.index ?? entry.index,
                };
              }
              return merged;
            });
            setCounting({});
            frameStore.set(null);
            setEngineError(null);
            setStatus("Engine warm — browsing, near-misses and uncached censuses are live");
          } else {
            setFullSizeLevels(new Set());
            setResult(payload);
            boundsRef.current = allBounds(payload.stages);
            const meta: Record<number, SolutionMeta> = {};
            for (const entry of (payload.solutions ?? [])) {
              meta[entry.level] = entry;
            }
            setSolutions(meta);
            // A new run invalidates every near-miss list: they index into the
            // candidate lists of the session that has just been replaced.
            clearDerived();
            frameStore.set(null);
            setEngineError(null);
            setStatus(`Exact calculation complete · ${message.result.seconds}s`);
            // And what a PERSON has said about these parameters, which the
            // engine has no way to know. A warm gets none of this: its cards
            // are already on screen, judged ring and all.
            setL1Replayed(!!(payload as { level1Replayed?: boolean }).level1Replayed);
            const ran = lastParamsRef.current;
            if (ran) loadJudgedRef.current(descriptorFor(ran), message.id);
          }

          // Firm every count up front. The engine counts lazily — a browser
          // reading "2+" is paging a list whose end nobody has looked for —
          // so each browsable level's count is walked to exact, level by
          // level, starting now rather than on the first arrow press.
          const toCount = (payload.solutions ?? [])
            // Never manufacture a candidate list merely to put an exact number
            // on the card. Seeded levels enumerate only after an explicit
            // browser click; adopted levels are not enumerable at all.
            .filter(entry => entry.level > 0 && entry.enumerated === "full"
              && !entry.countExact)
            .map(entry => entry.level);
          countQueueRef.current = toCount.slice(1);
          if (toCount.length) {
            workerRef.current?.postMessage({
              type: "count", id: message.id, level: toCount[0], budget: COUNT_ROUND,
            });
          }
        }
        busyRef.current = false;
        setBusy(false);
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) {
          // A new run replaces whatever was waiting on the warm: the action was
          // about a parameter set that is no longer on screen.
          afterWarmRef.current = null;
          dispatchRef.current(pending);
          return;
        }
        const then = afterWarmRef.current;
        afterWarmRef.current = null;
        if (then) then();
        return;
      }
      if (message.type === "error") {
        if (message.id === activeIdRef.current) {
          setEngineError(message.message || "The exact engine could not finish this case.");
          frameStore.set(null);
          setCounting({});
          setBrowsingLevel(null);
          setStatus("Calculation stopped");
        }
        warmIdRef.current = null;
        // Whatever was queued behind a warm cannot run: there is no session.
        afterWarmRef.current = null;
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
        params.handStep || params.extStep
          || autoStep(worstPairs(params.m, params.n), params.comboBudget),
        params.handCeiling || undefined));
      setRanKey(params.key);
      ranKeyRef.current = params.key;
      lastParamsRef.current = params;
      sessionRef.current = null;
      setSessionReady(false);
      setCachedRun(null);
      setL1Replayed(false);
      clearJudgedAll();
      afterWarmRef.current = null;
      warmIdRef.current = null;
      const id = ++activeIdRef.current;

      const toEngine = (level1Extensions: number[][] | null = null) => {
        setStatus(level1Extensions
          ? "Loading the exact MXN engine — L1 comes off the shelf…"
          : "Loading the exact MXN engine…");
        ensureWorker().postMessage({
          type: "generate", id, m: params.m, n: params.n, ks: params.ks,
          preferShortArms: params.preferShortArms,
          extStep: params.extStep,
          comboBudget: params.comboBudget,
          reachFromPrevious: params.reachFromPrevious,
          level1Extensions,
          handStep: params.handStep,
          handCeiling: params.handCeiling,
          level1Ring: params.level1Ring,
        });
      };

      /** The engine, with L1 read off the shelf first when it is there. */
      const toEngineWithL1 = () => {
        level1For(params).then(ext => {
          if (id !== activeIdRef.current) return;
          // Deliberately NOT setL1Replayed here. Having FETCHED a combo is not
          // having replayed one: the engine takes a pinned seed only when that
          // combo is a valid configuration for the level, and falls back to the
          // full search when it is not. The run says which happened, in
          // `level1Replayed`, and that is what the card is allowed to claim.
          toEngine(ext);
        }).catch(() => { if (id === activeIdRef.current) toEngine(); });
      };

      // The shelf first. An entry is addressed by every parameter that decides
      // the answer, so a hit is the same result this browser would have spent
      // the next twenty seconds producing — with every level's solution count
      // already walked to the end, which the browser's own run stops short of.
      if (!cacheRef.current.readable) {
        setCacheState("off");
        toEngine();
        return;
      }
      setCacheState("looking");
      setStatus("Looking for a stored answer…");
      const adoptRun = (artifact: RunArtifact, note: string | null) => {
        const payload = artifact.result as ExactResult;
        setCacheState("hit");
        setL1Replayed(!!(payload as { level1Replayed?: boolean }).level1Replayed);
        setCachedRun({ computedAt: artifact.computedAt, seconds: artifact.seconds });
        setFullSizeLevels(new Set());
        setResult(payload);
        boundsRef.current = allBounds(payload.stages);
        const meta: Record<number, SolutionMeta> = {};
        for (const entry of (payload.solutions ?? [])) meta[entry.level] = entry;
        setSolutions(meta);
        clearDerived();
        frameStore.set(null);
        busyRef.current = false;
        setBusy(false);
        setStatus(`From the cache · computed ${artifact.computedAt.slice(0, 10)}`
          + ` in ${artifact.seconds}s` + (note ? ` · ${note}` : ", served in one fetch"));
        // The run is what the engine said; this is what a person said. Asked
        // off the artifact's OWN descriptor, so an adopted variant looks for
        // judgements about the parameters actually on screen.
        loadJudgedRef.current(artifact.descriptor, id);
        const queued = pendingRef.current;
        pendingRef.current = null;
        if (queued) dispatchRef.current(queued);
      };

      cacheRef.current.getRun(descriptorFor(params)).then(async artifact => {
        if (id !== activeIdRef.current) return;   // a newer run owns the page
        if (artifact?.result) {
          adoptRun(artifact, null);
          return;
        }
        // The exact step and budget missed; a sweep may still have stored
        // these m/n/ks under different ones.
        const variant = await findShelfVariant(params);
        if (id !== activeIdRef.current) return;
        if (!variant) {
          setCacheState("miss");
          toEngineWithL1();
          return;
        }
        const adopted: Params = {
          m: params.m, n: params.n, ks: [...params.ks],
          key: `${params.m}:${params.n}:${params.ks.join(",")}`
            + `:${variant.shortArms}:${variant.step}:${variant.budget}`
            + `:${variant.reach}`,
          preferShortArms: variant.shortArms,
          extStep: variant.step === "auto" ? null : Number(variant.step),
          comboBudget: variant.budget,
          reachFromPrevious: variant.reach,
          handStep: params.handStep, handCeiling: params.handCeiling,
          level1Ring: params.level1Ring,
        };
        const stored = await cacheRef.current.getRun(descriptorFor(adopted));
        if (id !== activeIdRef.current) return;
        if (!stored?.result) {
          setCacheState("miss");
          toEngineWithL1();
          return;
        }
        // Make the fields say what is on screen: the level traces, the session
        // warm and the next Run all follow the adopted values from here on.
        setPreferShortArms(variant.shortArms);
        setExtStep(variant.step);
        setComboBudget(variant.budget);
        setReachFromPrevious(variant.reach);
        setRanKey(adopted.key);
        ranKeyRef.current = adopted.key;
        lastParamsRef.current = adopted;
        adoptRun(stored, `stored at step ${variant.step}, `
          + `budget ${variant.budget.toLocaleString()} — fields updated to match`);
      }).catch(error => {
        if (id !== activeIdRef.current) return;
        // A cache that is unreachable, misconfigured or serving nonsense must
        // never be the reason the page stops working. It falls back to the only
        // thing it ever had, which is doing the work here.
        setCacheState("miss");
        setStatus(`Cache unavailable (${error instanceof Error ? error.message : error}) — computing locally`);
        toEngine();
      });
    };
  });

  useEffect(() => () => workerRef.current?.terminate(), []);

  /**
   * The grid a judged ★ best implies for these parameters, or none.
   *
   * Resolved BEFORE the run is dispatched, not during it, because the ceiling
   * is part of the cache key: a run searched on a pick's grid is a different
   * answer from one searched on the engine's full width, and the shelf has to
   * be asked for the right one. The pick is looked up for `[ks[0]]` — the
   * single-k set it was judged on — since that is where a hand ever fits a ring.
   */
  const resolveHandGrid = async (
    base: Params,
  ): Promise<{ step: number; ceiling: number; note: string;
               ring: Params["level1Ring"] }> => {
    const none = { step: 0, ceiling: 0, note: "", ring: null };
    const client = cacheRef.current;
    try {
      const found = await findShelfBest(
        { ...descriptorFor(base), ks: [base.ks[0]] },
        client.base, client.token, () => true);
      const pick = found.pick;
      const reach = pick && reachOfPick(pick);
      if (!pick || !reach) {
        return { ...none, note: `no ★ best for ${base.m}×${base.n} ks ${base.ks[0]}`
          + " — searching the full width" };
      }
      const grid = handGrid(reach, worstPairs(base.m, base.n), base.comboBudget);
      // The ring itself, when the pick carries one and is about level 1: the
      // L1 of [k, ...] IS the L1 of [k], so the judged ring is not a hint for
      // the search, it is the answer, and level 1 is adopted rather than
      // searched. The engine guards the adoption (layer names must match) and
      // reports a fallback, so a stale or foreign ring degrades to the grid.
      const ring = pick.level === 1 && pick.strands.length
        ? { strands: pick.strands as unknown[], h_ext: pick.hExt, v_ext: pick.vExt }
        : null;
      const deeper = base.reachFromPrevious
        ? `deeper levels start at 0…${grid.ceiling}, step ${grid.step}, then cap`
          + " at the largest extension the finished level immediately below used"
        : `deeper levels search 0…${grid.ceiling} at step ${grid.step}`;
      return { step: grid.step, ceiling: grid.ceiling, ring,
        note: ring
          ? `★ best by ${pick.judgement.chooser} — L1 adopted from the judged`
            + ` ring; ${deeper}`
          : `★ best by ${pick.judgement.chooser} reaches ${reach} —`
            + ` searching 0…${grid.ceiling} at step ${grid.step} (the judgement`
            + " carries no ring, so L1 is searched too)" };
    } catch {
      return { ...none, note: "the picks shelf is away — searching the full width" };
    }
  };

  const runNow = async () => {
    if (inputError || !ks.length) return;
    const base: Params = {
      m, n, ks: [...ks], key: paramsKey,
      preferShortArms,
      extStep: extStep === "auto" ? null : Number(extStep),
      comboBudget,
      reachFromPrevious,
      handStep: 0, handCeiling: 0, level1Ring: null,
    };
    if (!handFromPick) {
      setHandNote("");
      dispatchRef.current(base);
      return;
    }
    setStatus("Looking for a judged ★ best to size the search…");
    const grid = await resolveHandGrid(base);
    setHandNote(grid.note);
    dispatchRef.current({ ...base, handStep: grid.step, handCeiling: grid.ceiling,
                          level1Ring: grid.ring });
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
    // The session died with the runtime. Cards drawn from the cache stay on
    // screen and stay true; what they lose is the ability to be browsed, which
    // the next thing that needs it will warm again.
    sessionRef.current = null;
    warmIdRef.current = null;
    afterWarmRef.current = null;
    setSessionReady(false);
    setBusy(false);
    setBrowsingLevel(null);
    frameStore.set(null);
    setStatus("Stopped · the engine reloads on the next run");
  };

  /**
   * Put what this browser has just computed on the shelf.
   *
   * The farm at /mxn/gpu/ is the bulk producer, but a run done here is the same
   * artifact, and a reader who has just waited twenty seconds for a size nobody
   * had queued may as well be the last person who has to. Every census already
   * open goes with it, since those are what the level widgets read.
   *
   * Deliberately a button rather than automatic: a write to the operator's own
   * Cloudflare account is not something a page should do because someone pressed
   * Run.
   */
  const publishRun = async () => {
    const params = lastParamsRef.current;
    if (!result || !params || !cacheRef.current.writable || publishing) return;
    setPublishing(true);
    const descriptor = descriptorFor(params);
    const stamp = new Date().toISOString();
    try {
      let bytes = await cacheRef.current.putRun({
        kind: "run", cacheVersion: CACHE_VERSION, descriptor,
        computedAt: stamp, seconds: result.seconds, runner: "lab", result,
      });
      let stored = 1;
      for (const [key, census] of Object.entries(traces)) {
        const [levelText, bandText] = key.split(":");
        bytes += await cacheRef.current.putTrace({
          kind: "trace", cacheVersion: CACHE_VERSION, descriptor,
          level: Number(levelText), band: bandKey(bandText),
          computedAt: stamp, seconds: 0, runner: "lab",
          plan: tracePlans[key] ?? null, census,
        });
        stored += 1;
      }
      setCacheState("hit");
      setCachedRun({ computedAt: stamp, seconds: result.seconds });
      setStatus(`Published ${stored} artifact${stored === 1 ? "" : "s"} · `
        + `${(bytes / 1024).toFixed(0)} kB · this size now loads from the cache`);
    } catch (error) {
      setStatus(`Could not publish — ${error instanceof Error ? error.message : error}`);
    } finally {
      setPublishing(false);
    }
  };

  /**
   * A parameter set named in the URL, run on arrival unless `run=0` asks only
   * to populate the controls for a reproducible manual check.
   *
   * /mxn/gpu/ links every finished job here, and the point of the link is that
   * the thing it opens is instant. Ignored unless m, n and ks are all present
   * and all valid — a half-formed query should leave the page as it found it
   * rather than run something nobody asked for.
   */
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const wantM = Number(query.get("m"));
    const wantN = Number(query.get("n"));
    const wantKs = query.get("ks") ?? "";
    if (!Number.isInteger(wantM) || !Number.isInteger(wantN) || !wantKs.trim()) return;
    const clamp = (value: number) => Math.max(1, Math.min(4, value));
    const nextM = clamp(wantM);
    const nextN = clamp(wantN);
    const parsedQuery = parseKs(wantKs);
    if (parsedQuery.error || !parsedQuery.values.length) return;
    const range = kLimits(nextM, nextN);
    if (parsedQuery.values.some(k => k < range.min || k > range.max)) return;

    const rawStep = query.get("step") ?? "auto";
    const nextStep: ExtStep = (EXT_STEP_CHOICES as readonly string[]).includes(rawStep)
      ? rawStep as ExtStep : "auto";
    const nextBudget = Number(query.get("budget")) || DEFAULT_COMBO_BUDGET;
    const nextShort = query.get("short") !== "0";
    // Opt-in in the URL as it is in the sidebar: `reach=1` and nothing else
    // turns it on, so every link written before it exists still means the
    // search the engine ships.
    const nextReach = query.get("reach") === "1";
    const populateOnly = query.get("run") === "0";
    const nextHandFromPick = populateOnly && query.get("pick") === "1";

    setM(nextM);
    setN(nextN);
    setRawKs(parsedQuery.values.join(" "));
    setExtStep(nextStep);
    setComboBudget(nextBudget);
    setPreferShortArms(nextShort);
    setReachFromPrevious(nextReach);
    setHandFromPick(nextHandFromPick);
    // A mock or a reproducible manual check can populate every control without
    // starting Pyodide. This leaves Run enabled so the pick-sized path is still
    // exercised by the same button press as a normal user run.
    if (populateOnly) {
      setStatus("Settings loaded — press Run");
      // The L1 of [k, k, k] IS the L1 of [k], and that ring is already on the
      // picks shelf. Drawing it costs one GET and no engine, so the card a
      // person judged is on screen before anyone presses Run — which is the
      // whole point of this URL: to see whether Yonatan's ★ best actually
      // loaded, not to stare at an empty results column until a search.
      const id = ++activeIdRef.current;
      const descriptor: RunDescriptor = {
        m: nextM, n: nextN, ks: parsedQuery.values,
        hand: "lh", direction: "cw",
        shortArms: nextShort,
        step: nextStep === "auto" ? "auto" : Number(nextStep),
        budget: nextBudget,
        reachFromPrevious: nextReach,
      };
      loadJudgedRef.current(descriptor, id, true);
      return;
    }
    dispatchRef.current({
      m: nextM, n: nextN, ks: parsedQuery.values,
      key: `${nextM}:${nextN}:${parsedQuery.values.join(",")}:${nextShort}:${nextStep}:${nextBudget}`
        + `:${nextReach}`,
      preferShortArms: nextShort,
      extStep: nextStep === "auto" ? null : Number(nextStep),
      comboBudget: nextBudget,
      reachFromPrevious: nextReach,
      // A deep link never resolves a pick: that is a fetch, and this effect
      // runs on mount to put a picture up fast. Press Run to size from a ★.
      handStep: 0, handCeiling: 0, level1Ring: null,
    });
  }, []);

  /**
   * Run something that needs the engine's session, warming one if there is none.
   *
   * A cached run puts real cards on screen without Pyodide ever having seen the
   * size, so every control that reads the session has to go through here. The
   * warm is an ordinary generate — the busy sheet and its ceiling appear exactly
   * as they would have — and the action follows the moment it lands. What has
   * changed is only when the wait happens: before, it stood between a reader and
   * the first picture; now it stands between them and the second question.
   *
   * The action is held one deep. A second click while a warm is in flight
   * replaces the first, because it is the second one the reader is looking at.
   *
   * Every caller of this is something a reader deliberately pressed. That is
   * the rule that keeps it honest — a warm is twenty seconds of engine and it
   * covers the results column while it runs, so `requestTraceWeave`, which the
   * panel calls as the cursor moves, checks `sessionCold()` itself instead.
   */
  const sessionCold = () =>
    sessionRef.current === null || sessionRef.current !== ranKeyRef.current;

  const withSession = (action: () => void) => {
    if (!sessionCold()) {
      action();
      return;
    }
    const params = lastParamsRef.current;
    if (!params) return;
    afterWarmRef.current = action;
    if (busyRef.current) {
      setStatus("Engine busy — this follows when it lands");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setEngineError(null);
    frameStore.set(null);
    setRunScale(worstCase(
      params.m, params.n, params.ks.length,
      params.handStep || params.extStep
        || autoStep(worstPairs(params.m, params.n), params.comboBudget),
      params.handCeiling || undefined));
    const id = ++activeIdRef.current;
    warmIdRef.current = id;
    setStatus(`These cards came from the cache — warming the engine over ${params.m}×${params.n} `
      + "so this level can be searched…");
    ensureWorker().postMessage({
      type: "generate", id, m: params.m, n: params.n, ks: params.ks,
      preferShortArms: params.preferShortArms,
      extStep: params.extStep,
      comboBudget: params.comboBudget,
      reachFromPrevious: params.reachFromPrevious,
      handStep: params.handStep,
      handCeiling: params.handCeiling,
      // Deliberately no level1Ring and no level1Extensions: a warm exists to
      // open a browsable session, and an adopted level has nothing to browse.
      // Deliberately no level1Extensions. A warm exists to open the session the
      // browser, the sweeps and an uncached census read, and a replayed level
      // has no candidate list to browse — warming into one would be warming
      // into exactly the thing the reader pressed an arrow to get.
    });
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
    withSession(() => ensureWorker().postMessage({
      type: "select", id: activeIdRef.current, level, index, healthyOnly,
    }));
  };

  // Near-misses reuse the browse lane for the same reason: they read the
  // session the last generate built, and must not be queued behind a run.
  const browseSemi = (level: number, index: number) => {
    const near = semi[level];
    if (!near || index < 0 || index >= near.count) return;
    setBrowsingLevel(level);
    withSession(() => ensureWorker().postMessage({
      type: "semi-select", id: activeIdRef.current, level, index,
    }));
  };

  // Reads the list the scan already built, so it is cheap and the ring on
  // screen only moves for a reason the reader asked for: a reorder keeps it
  // selected by identity and only its position changes.
  const sortSemi = (level: number, key: SemiKey) => {
    if (!semi[level] || semi[level].key === key) return;
    setBrowsingLevel(level);
    withSession(() => ensureWorker().postMessage({
      type: "semi-sort", id: activeIdRef.current, level, key,
    }));
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
    withSession(() => ensureWorker().postMessage({
      type: "semi-scan", id: activeIdRef.current, level, band,
    }));
  };

  /** A stored census, put where a computed one would have gone. */
  const adoptCachedTrace = (artifact: TraceArtifact, level: number, band: Band) => {
    const key = traceKey(level, band);
    const census = artifact.census as TracePayload | undefined;
    const plan = artifact.plan as TracePlan | undefined;
    // An unavailable band is a real answer and worth having cached: "this level
    // solved its H band without a search" and "4×4 is over the trace ceiling"
    // both cost a level replay to find out.
    if (!census || census.unavailable) {
      setTraceFailed(current => ({
        ...current, [key]: census?.reason || "This band cannot be traced.",
      }));
      setStatus(`L${level} ${band.toUpperCase()}: ${census?.reason ?? "not traceable"} (from the cache)`);
      return;
    }
    if (plan && !plan.unavailable) {
      setTracePlans(current => ({ ...current, [key]: plan }));
    }
    setTraces(current => ({ ...current, [key]: census }));
    // The census carries the engine's own pick already woven, so the panel's
    // first weave preview is on screen at the same moment the grid is — with
    // no session, no replay and no round trip.
    const seeded = census.weave;
    if (seeded?.ext) {
      setTraceWeaves(current => ({ ...current, [key]: {
        ...current[key], [weaveKey(seeded.ext, seeded.angle)]: seeded,
      } }));
    }
    setBrowsingLevel(null);
    setStatus(`L${level} ${band === "h" ? "horizontal" : "vertical"} band census · from the cache`);
  };

  // Replays the level and sweeps it twice over, so it is only ever asked for
  // by opening a widget -- never as part of a generate. It is also the single
  // slowest thing the lab asks anyone to wait through, which is why the shelf
  // is asked first: a censused level opens instantly and never wakes Pyodide.
  const requestTrace = (level: number, band: Band) => {
    const key = traceKey(level, band);
    if (traces[key] || traceFailed[key]) return;
    setBrowsingLevel(level);
    // The widget draws the replay's frames; last time's must not be the first
    // thing it shows this time.
    traceFrameStore.set(null);

    const toEngine = () => {
      setStatus(`Tracing the L${level} ${band === "h" ? "horizontal" : "vertical"} band — every combo against every angle…`);
      withSession(() => ensureWorker().postMessage({
        type: "trace", id: activeIdRef.current, level, band,
      }));
    };

    const params = lastParamsRef.current;
    if (!cacheRef.current.readable || !params) {
      toEngine();
      return;
    }
    setStatus(`Looking for a stored L${level} ${band.toUpperCase()} census…`);
    cacheRef.current.getTrace(descriptorFor(params), level, band).then(artifact => {
      if (params !== lastParamsRef.current) return;   // a newer run owns the page
      if (artifact) adoptCachedTrace(artifact, level, band);
      else toEngine();
    }).catch(() => toEngine());
  };

  const showBand = (level: number, band: Band) => {
    setTraceBand(current => ({ ...current, [level]: band }));
    requestTrace(level, band);
  };

  // One traced cell, woven. Costs a checkpoint replay in the worker, so the
  // panel debounces its requests and cached cells are never asked for twice.
  //
  // The one session-reading action that will NOT warm a cold engine: the panel
  // asks for this as the cursor moves, and starting a twenty-second generate
  // because someone dragged across a census would be doing work nobody asked
  // for. The engine's own pick is woven into the cached census and is on screen
  // regardless; the rest of the grid says what it needs.
  const requestTraceWeave = (level: number, band: Band, ext: number[], angleDeg: number) => {
    const cached = traceWeaves[traceKey(level, band)];
    if (cached && cached[weaveKey(ext, angleDeg)]) return;
    if (sessionCold()) {
      setStatus("Weaving another cell needs the engine — step a solution or press ⚑ to warm it");
      return;
    }
    withSession(() => ensureWorker().postMessage({
      type: "trace-weave", id: activeIdRef.current, level, band,
      ext, angle: angleDeg,
    }));
  };

  /**
   * Put the cell the widget is looking at on the card's own diagram.
   *
   * The weave preview is 300px square beside a census; the card's diagram is
   * the drawing everything else on the page is read against, and until now the
   * only rings that could reach it were the ones the worker sent — a solution
   * or a near-miss. A traced cell has the same two things those messages carry,
   * the strands and the audit row, so it takes the same path.
   *
   * The engine's own pick is the one cell that is also a numbered solution, and
   * a diagram showing it while the browser reads some other index would be a
   * lie about which ring is on screen. So that cell is shown by walking the
   * browser to `enginePick` rather than by overriding anything: the number and
   * the drawing then agree, and they agree on the engine's answer. Every other
   * cell is not a solution at all, and says so on the card rather than borrowing
   * a number that belongs to a different ring.
   */
  const showTraced = (level: number, w: TraceWeave) => {
    if (!w.strands?.length || !w.row) return;
    // A judged ring put back first, so the ring this holds to return to is the
    // one the run produced rather than somebody's ★ best.
    if (judgedShown[level]) restoreJudged(level);
    const seeded = traces[traceKey(level, w.band)]?.weave;
    const isEnginePick = !!seeded?.ext
      && weaveKey(seeded.ext, seeded.angle) === weaveKey(w.ext, w.angle);
    const meta = solutions[level];

    if (isEnginePick) {
      restoreTraced(level);
      if (meta && browsable(meta) && meta.index !== meta.enginePick) {
        browse(level, meta.enginePick);
      }
      setStatus(`L${level} diagram: the engine's own pick`
        + (meta ? ` — solution ${meta.enginePick + 1}` : ""));
      return;
    }

    setResult(current => {
      if (!current) return current;
      // The level's own ring is kept once, on the first override, so going back
      // returns to what the run produced rather than to the previous override.
      setTracedRing(held => held[level] ? held : { ...held, [level]: {
        strands: current.stages.find(s => s.level === level)?.strands ?? [],
        row: current.rows[level - 1],
      } });
      return {
        ...current,
        stages: current.stages.map(stage => stage.level === level
          ? { ...stage, strands: w.strands as Strand[] } : stage),
        rows: current.rows.map(row => row.level === level ? w.row as AuditRow : row),
      };
    });
    setTracedShown(current => ({ ...current, [level]: w }));
    setStatus(`L${level} diagram: traced cell — ext (${w.ext.join(", ")}) `
      + `at ${w.angle.toFixed(1)}°, ${w.row.healthy ? "a weave" : "not a weave"}`);
  };

  /** Back to the ring the run produced for this level. */
  const restoreTraced = (level: number) => {
    const held = tracedRing[level];
    if (held) {
      setResult(current => current ? {
        ...current,
        stages: current.stages.map(stage => stage.level === level
          ? { ...stage, strands: held.strands } : stage),
        rows: current.rows.map(row => row.level === level ? held.row : row),
      } : current);
    }
    clearTraced(level);
  };

  /**
   * Put a person's ★ best on the level it is about.
   *
   * The rule the k boards are built around (docs/mxn-ks-board.md) — A PERSON
   * OUTRANKS THE ENGINE — applied on the card that draws the ring. A judgement
   * carries its whole ring, so this costs no Pyodide, no `generate` and no fit:
   * the strands go onto the stage and the numbers under them come from the
   * judgement rather than from the run, because the run's audit describes a
   * different ring and printing it here would caption one answer with another's
   * measurements.
   *
   * `result.rows` is deliberately NOT rewritten, unlike showTraced: a traced
   * cell arrives with a full audit row the engine computed for it, and a
   * judgement carries four numbers and no gaps, no `within` and no masks.
   * Faking the rest as zeroes would be indistinguishable from having measured
   * them. The card reads through CardAudit instead and prints a dash.
   *
   * The engine's own ring is one press away and never hidden — a page that
   * quietly showed something other than what the engine computed is a page that
   * cannot be trusted about anything else it draws.
   */
  const showJudged = (level: number, pick: JudgedPick) => {
    if (judgedShown[level]) return;
    // One override at a time on a card: a traced cell put back first, so what
    // this holds to return to is the level's own ring and not that cell.
    if (tracedShown[level]) restoreTraced(level);
    setResult(current => {
      if (!current) return current;
      // Inside the updater, because the run this is about may have been set in
      // the same batch: the `result` this render closed over is the previous
      // one. A judgement naming a level the run does not have changes nothing
      // and is not recorded as shown, which would be a chip on no card.
      const stage = current.stages.find(entry => entry.level === level);
      if (!stage) return current;
      setJudgedRing(held => held[level] ? held : { ...held, [level]: stage.strands });
      setJudgedShown(held => ({ ...held, [level]: pick }));
      return {
        ...current,
        stages: current.stages.map(entry => entry.level === level
          ? { ...entry, strands: pick.strands } : entry),
      };
    });
  };

  /** Back to the engine's own ring for this level. */
  const restoreJudged = (level: number) => {
    const held = judgedRing[level];
    if (held) {
      setResult(current => current ? {
        ...current,
        stages: current.stages.map(stage => stage.level === level
          ? { ...stage, strands: held } : stage),
      } : current);
    }
    clearJudged(level);
  };

  /**
   * Ask the shelf what a person has said about the run that just landed.
   *
   * Walks parent ks directories as well as the exact sequence: L1 of
   * `[-1, -1, -1]` IS the L1 of `[-1]`, and that is where a hand actually
   * presses ★ best. Asking only the deep key is how a page showing 3×1
   * `[-1, -1, -1]` used to report no human pick for a size whose k board
   * plainly showed Yonatan's.
   *
   * `allowPreview` is the run=0 path: there is no engine result yet, and the
   * judged L1 ring is enough to put a card on screen. A shelf that is away
   * leaves whatever was already showing exactly where it is.
   */
  const loadJudged = async (d: RunDescriptor, id: number, allowPreview = false) => {
    try {
      const client = cacheRef.current;
      const found = await findPrefixBests(
        d, client.base, client.token, () => id === activeIdRef.current);
      if (id !== activeIdRef.current) return;
      const picks = found.byLevel;
      const levels = Object.keys(picks).map(Number).sort((a, b) => a - b);
      if (!levels.length) {
        if (found.ringless) {
          // hasRing = False in docs/picks-shelf.md: judged before rings were
          // stored in a pick. Said out loud rather than passed over, because
          // the fix — re-press ★ best at /mxn/fit/ — is a thing a reader can do.
          setPicksNote(`★ best by ${found.ringless.chooser} — saved without its`
            + " ring, so only /mxn/fit/ can draw it");
        }
        return;
      }
      setShelfBest(picks);
      const credit = levels
        .map(level => `L${level} by ${picks[level].judgement.chooser}`)
        .join(", ");
      setPicksNote(`★ best on ${credit} · from ${picks[levels[0]].from}`);
      setResult(current => {
        if (!current) {
          if (!allowPreview) return current;
          const preview = previewFromPicks(picks, d);
          if (!preview) return current;
          boundsRef.current = allBounds(preview.stages);
          const shown: Record<number, JudgedPick> = {};
          const meta: Record<number, SolutionMeta> = {};
          for (const stage of preview.stages) {
            shown[stage.level] = picks[stage.level];
          }
          for (const entry of preview.solutions ?? []) meta[entry.level] = entry;
          setJudgedShown(shown);
          setSolutions(meta);
          setStatus(`★ best on ${credit} — press Run for the rest of the sequence`);
          return preview;
        }
        const rings: Record<number, Strand[]> = {};
        let next = current;
        for (const level of levels) {
          const pick = picks[level];
          const stage = next.stages.find(entry => entry.level === level);
          if (!stage) continue;
          rings[level] = stage.strands;
          next = {
            ...next,
            stages: next.stages.map(entry => entry.level === level
              ? { ...entry, strands: pick.strands } : entry),
          };
        }
        if (Object.keys(rings).length) {
          setJudgedRing(held => ({ ...held, ...rings }));
          setJudgedShown(held => ({ ...held, ...picks }));
        }
        return next;
      });
    } catch { /* the shelf being away must not cost anybody their run */ }
  };
  // Both callers are closures the worker and the dispatcher captured on an
  // earlier render, so these go through refs for the same reason cacheRef does.
  const showJudgedRef = useRef(showJudged);
  showJudgedRef.current = showJudged;
  loadJudgedRef.current = loadJudged;

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
    // A judged ring on the card is not one of this run's solutions: it carries
    // its own geometry and none of the audit row beside it, so banking
    // `stage.strands` under `result.rows` would file a person's ring with the
    // engine's numbers and an index belonging to a ring nobody is looking at.
    // It also already has a home -- picks/v3/…, where it was judged.
    if (judgedShown[stage.level]) {
      setStatus(`L${stage.level} is showing a judged ★ best, which is already`
        + " saved on the picks shelf — press engine to star this run's own ring");
      return;
    }
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
            <details className="advanced-settings" open={advancedOpen}
              onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
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
              {/* The ceiling, learned rather than escalated. A level past the
                  first ordinarily walks its extension ceiling up to 200px
                  because a deeper ring "sits further out"; measured, it does
                  not need to. 3×1 [-1,-1] L2: 54s to (190, 190, 70) escalating,
                  4.9s to (50, 0, 0) capped, at the same 10/12 crossings.
                  Off by default because it changes which ring the level
                  settles on -- which is also why it is in the cache key. */}
              <label className="toggle-line" htmlFor="reach-cap">
                <input
                  id="reach-cap" type="checkbox" checked={reachFromPrevious}
                  onChange={e => setReachFromPrevious(e.target.checked)}
                />
                <span>learn each level&rsquo;s reach from the ones below it</span>
              </label>
              {/* The grid a hand fitted, rather than the one the engine walks.
                  A judged ring sits off the grid entirely — 3×1 k=−1 was judged
                  at (62.55) and (55.75, 57.3, 27.5) — so its numbers cannot be
                  searched for. What they can do is say where to look, and the
                  ceiling that buys pays for resolution: 0…70 at step 5 is 3,375
                  combos where 0…200 at step 5 is 68,921. */}
              <label className="toggle-line" htmlFor="hand-grid">
                <input
                  id="hand-grid" type="checkbox" checked={handFromPick}
                  onChange={e => setHandFromPick(e.target.checked)}
                />
                <span>size the search from the judged &#9733; best</span>
              </label>
              {handNote && <p className="range-note">{handNote}</p>}
              {reachFromPrevious && (
                <p className="range-note">
                  Levels past the first stop at the longest arm the levels below
                  them used, instead of escalating to 200px. Much faster on a
                  repeated k, and a different ring — stored under its own cache
                  key, never mixed with the ordinary search.
                </p>
              )}
              <label className="toggle-line" htmlFor="healthy-only">
                <input id="healthy-only" type="checkbox" checked={healthyOnly}
                  onChange={e => setHealthyOnly(e.target.checked)} />
                <span>browse healthy solutions only</span>
              </label>
              <div className={`range-note ${overEngineLimit ? "is-warning" : ""}`}>
                {handFromPick
                  ? "combos are sized from the ★ best at Run — the count below is the full-width ceiling"
                  : null}{handFromPick ? " · " : ""}{estimatedCombos.toLocaleString()} combos in the largest group
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
            {/* Where the run on screen came from. A page with no cache
                configured never shows this, which is every page until someone
                configures one. */}
            {cacheState !== "off" && (
              <div className={`cache-chip is-${cacheState}`}>
                <b>
                  {cacheState === "looking" ? "checking the cache"
                    : cacheState === "hit" ? "served from the cache"
                    : "computed here"}
                </b>
                {cacheState === "hit" && cachedRun && (
                  <span>
                    precomputed {cachedRun.computedAt.slice(0, 10)} in {cachedRun.seconds}s
                    {sessionReady ? " · engine warm" : " · engine cold until you browse"}
                  </span>
                )}
                {cacheState === "miss" && (
                  <span>nothing stored for these parameters — {
                    cache.writable ? "publish it below" : "queue it at /mxn/gpu/"}</span>
                )}
              </div>
            )}

            {/* What a PERSON said about these parameters, which is a different
                shelf from the run and a different kind of answer. Shown
                whether or not a cache is configured: a judgement is written to
                this browser first, so a ★ best pressed two minutes ago with no
                Worker set exists and should still be found. */}
            {picksNote && <div className="picks-chip"><b>the picks shelf</b><span>{picksNote}</span></div>}

            {/* Why L1 has no solution browser in this run, and where the one it
                does have lives. Saying only "one solution" there would read as
                a fact about the geometry rather than about this artifact. */}
            {l1Replayed && result && (
              <div className="picks-chip">
                <b>L1 came off the shelf</b>
                <span>
                  Replayed from the stored <code>ks {result.ks[0]}</code> run —
                  the same ring, without searching for it again. Its solution
                  browser is on that run: <a href={`?m=${result.m}&n=${result.n}`
                    + `&ks=${encodeURIComponent(String(result.ks[0]))}`}>open
                  {" "}{result.m}×{result.n} ks {result.ks[0]}</a>.
                </span>
              </div>
            )}

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
              {/* The same URL serves the result cache. Publishing is a button
                  rather than something Run does on its own: a write to someone's
                  Cloudflare account should be asked for. */}
              <div className="run-row">
                <button type="button" className="stop-button" onClick={publishRun}
                  disabled={!cache.writable || !result || busy || publishing}
                  title={cache.writable
                    ? "Store this run, and every census already open, so /mxn/ loads it instantly"
                    : "Needs a worker url and an admin token"}>
                  {publishing ? "Publishing…" : `Publish run${
                    Object.keys(traces).length ? ` + ${Object.keys(traces).length} censuses` : ""}`}
                </button>
              </div>
              <p className="compute-note">
                The same Worker holds precomputed runs and censuses. <a href="gpu/">The
                compute farm</a> fills it over a whole range of sizes; this button
                adds the one on screen.
              </p>
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
          {busy && <LiveCandidateFigure store={frameStore} worst={runScale}
            counting={counting} />}
          {/* Counting is the tail of the thinking: the search is done, the
              cards are not out yet, and this is what the wait is buying — a
              bar per level, its position in the pair product, and the count
              growing as it closes rings. */}
          {busy && Object.keys(counting).length > 0 && (
            <div className="count-strip" role="status" aria-label="Counting solutions">
              {Object.entries(counting).map(([lvl, c]) => (
                <div className="count-row" key={lvl}>
                  <b>counting L{lvl} solutions</b>
                  <span className="count-track">
                    <i style={{ width: `${Math.min(100,
                      (100 * c.scanned) / Math.max(1, c.cells)).toFixed(1)}%` }} />
                  </span>
                  <em>{c.count.toLocaleString()} closed
                    {" · "}{c.scanned.toLocaleString()} / {c.cells.toLocaleString()} pairs</em>
                </div>
              ))}
            </div>
          )}
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
                // Which ring is actually on this card, and therefore which
                // numbers belong under it. Two things can displace the run's
                // own: a traced cell, and a person's judged ★ best.
                const judged = judgedShown[stage.level];
                const best = shelfBest[stage.level];
                const audit = judged ? auditOfPick(judged) : auditOfRow(row);
                const displaced = tracedShown[stage.level] ? "a traced cell"
                  : judged ? "a person's ★ best" : undefined;
                const notThis = (what: string) =>
                  displaced && `The diagram is showing ${displaced}, not this ${what}`;
                return (
                  <article className={`diagram-card ${compact ? "is-compact" : ""}`} key={`${result.m}-${result.n}-${result.ks.join("-")}-${stage.level}`}>
                    <div className="card-head">
                      <div className="level-title"><strong>{stage.level === 0 ? "L₀" : `L${stage.level}`}</strong><span>{stage.label}</span></div>
                      <div className="card-actions">
                        <span className={`k-chip ${stage.k === 0 ? "preserve" : ""}`}>{stage.k === null ? `${result.m} × ${result.n}` : `k = ${stage.k}`}</span>
                        {/* A traced cell is not a numbered solution, so while
                            one is on the diagram the card says which cell it is
                            rather than leaving the solution browser next to it
                            to be read as its label. */}
                        {tracedShown[stage.level] && (
                          <span className="traced-chip">
                            <b>traced</b>
                            <i>ext ({tracedShown[stage.level].ext.join(", ")}) ·{" "}
                              {tracedShown[stage.level].angle.toFixed(1)}°</i>
                            <button type="button" onClick={() => restoreTraced(stage.level)}
                              title="Put this level's own ring back on the diagram">
                              back
                            </button>
                          </span>
                        )}
                        {/* A person outranks the engine, and the card says
                            who — the same rule the k boards are built around
                            (docs/mxn-ks-board.md), here on the drawing itself.
                            The engine's own ring is one press away and is
                            never hidden, in either direction. */}
                        {best && (
                          <span className="judged-chip">
                            <b>{judged ? "human pick" : "★ best on the shelf"}</b>
                            <i>{best.judgement.chooser}
                              {best.judgement.at
                                ? ` · ${best.judgement.at.slice(0, 10)}` : ""}</i>
                            <button type="button"
                              onClick={() => judged
                                ? restoreJudged(stage.level)
                                : showJudged(stage.level, best)}
                              title={judged
                                ? "Put the engine's own ring back on this level"
                                : "Draw the judged ★ best on this level"}>
                              {judged ? "engine" : "★ best"}
                            </button>
                          </span>
                        )}
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
                              <span className={`solution-nav is-semi${
                                displaced ? " is-stale" : ""}`}
                                title={notThis("near-miss")}>
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
                            return <span className="solution-note" title={meta.reason ?? ""}>
                              {meta.enumerable === false ? "adopted ring · no engine list" : "one solution"}
                            </span>;
                          }
                          // The denominator is the list being paged: all
                          // closed rings, or the weaves among them when the
                          // healthy-only filter is on and their total is known.
                          const denom = healthyOnly && meta.healthy !== undefined
                            ? meta.healthy : meta.count;
                          const shown = denom === undefined
                            ? `${meta.index + 1}`
                            : `${meta.index + 1} / ${denom.toLocaleString()}${
                              meta.countExact ? "" : "+"}`;
                          return (
                            <span className={`solution-nav${
                              displaced ? " is-stale" : ""}`}
                              title={notThis("solution")}>
                              <button type="button" onClick={() => browse(stage.level, meta.index - 1)}
                                disabled={busyHere || meta.index === 0}
                                aria-label={`Previous solution for level ${stage.level}`}>‹</button>
                              <b>{busyHere ? "…" : shown}</b>
                              {meta.index === meta.enginePick && !displaced
                                && <em>engine pick</em>}
                              {/* With the count exact the list has a real end,
                                  so the arrow stops there instead of walking
                                  into a "no solution at that position". */}
                              <button type="button" onClick={() => browse(stage.level, meta.index + 1)}
                                disabled={busyHere || (meta.countExact === true
                                  && denom !== undefined && meta.index + 1 >= denom)}
                                aria-label={`Next solution for level ${stage.level}`}>›</button>
                              {/* The split the single number hides: every ring
                                  here closed (valid), and this many of them
                                  audit as weaves. */}
                              {meta.countExact && meta.healthy !== undefined
                                && meta.count !== undefined && (
                                <i className="nav-split" title={`All ${
                                  meta.count.toLocaleString()} solutions close (valid); ${
                                  meta.healthy.toLocaleString()} of them audit as weaves`}>
                                  {meta.healthy.toLocaleString()} weave{meta.healthy === 1 ? "" : "s"}
                                </i>
                              )}
                              <button className="save-solution" type="button" onClick={() => saveSolution(stage)}
                                disabled={!!judged}
                                title={judged
                                  ? "This card is showing a judged ★ best, which is already on the picks shelf — press engine to star the run's own ring"
                                  : "Save this closed ring for rating — goes to /mxn/rate/"}
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
                      <div className="canvas-wrap exact-canvas"><ExactCanvas stage={stage} bounds={bounds} /><span className="canvas-corner">{
                        judged ? `JUDGED BY ${judged.judgement.chooser.toUpperCase()}`
                          : row ? `${row.state} · ${row.healthy ? "WEAVE" : "NOT A WEAVE"}`
                          : "starting stitch"}</span></div>
                      <div className="card-foot exact-metrics">
                        <div className="metric"><span>suffixes</span><strong>{suffixLabel(stage.level)}</strong></div>
                        <div className="metric"><span>crossings</span><strong>{
                          audit && audit.across !== null
                            ? `${audit.across}/${measured(audit.expected)}` : "—"}</strong></div>
                        <div className="metric"><span>H extensions</span><strong>{audit?.ext ? formatExtensions(audit.ext[0]) : "—"}</strong></div>
                        <div className="metric"><span>V extensions</span><strong>{audit?.ext ? formatExtensions(audit.ext[1]) : "—"}</strong></div>
                      </div>
                      {audit && <div className="audit-strip">
                        <span><b>gap H/V</b>{audit.gap
                          ? `${audit.gap[0].toFixed(2)} / ${audit.gap[1].toFixed(2)}` : "—"}</span>
                        <span><b>within</b>{measured(audit.within)}</span>
                        <span><b>masks</b>{measured(audit.masks)}</span>
                        <span><b>stray</b>{measured(audit.stray)}</span>
                        <span><b>broken</b>{measured(audit.broken)}</span>
                        {/* A judgement carries four numbers and no grouping,
                            so the strip says where the rest of the row went
                            rather than leaving five dashes unexplained. */}
                        <em>{audit.applied === null
                          ? "a judged ring — the run's own numbers are not this ring's"
                          : audit.applied.length ? audit.applied.join(" · ") : "k-based groups"}</em>
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
                                  onBand={b => showBand(stage.level, b)}
                                  onShow={w => showTraced(stage.level, w)} />;
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

      <footer className="footer"><span>Calculation source · ysetbon/mxn · commit {COMMIT}</span><a href="..">← Scoubidou3D</a><a href="gpu/">Compute farm →</a><a href="rate/">Categoriser →</a><a href="semi/">Near-misses →</a><a href="https://github.com/ysetbon/mxn" target="_blank" rel="noreferrer">View source ↗</a></footer>
    </main>
  );
}
