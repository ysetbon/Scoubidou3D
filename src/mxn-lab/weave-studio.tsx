"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Upstream the lab sits at the root of its own host, so its runtime assets were
// plain "/exact-worker.js" and "/extension-origin-l0.svg". Here it is one page
// of a project site published under /Scoubidou3D/, and those would resolve
// against ysetbon.github.io itself. BASE_URL carries whatever vite was built
// with — "/Scoubidou3D/" for Pages, "/" for a root build — so the page keeps
// working under either.
const LAB_BASE = `${import.meta.env.BASE_URL}mxn/`;

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

// Same formula as pick_extension_step(): the grid per pair is 0..ext_max in
// `step` increments, and pairs are independent.
function comboCount(step: number, pairs: number, extMax = MAX_PAIR_EXTENSION) {
  return Math.pow(Math.floor(extMax / step) + 1, Math.max(pairs, 1));
}

function autoStep(pairs: number, budget: number) {
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

function worstPairs(m: number, n: number) {
  return Math.max(Math.ceil((2 * m) / 2), Math.ceil((2 * n) / 2), 1);
}

type Point = { x: number; y: number };
type RGBA = { r: number; g: number; b: number; a?: number };
export type Strand = {
  type: "Strand" | "AttachedStrand" | "MaskedStrand";
  start: Point;
  end: Point;
  width: number;
  color: RGBA;
  stroke_color: RGBA;
  stroke_width: number;
  has_circles?: [boolean, boolean];
  start_line_visible?: boolean;
  end_line_visible?: boolean;
  layer_name: string;
  first_selected_strand?: string;
  second_selected_strand?: string;
  is_hidden?: boolean;
};
export type Stage = { level: number; k: number | null; label: string; strands: Strand[] };
type ProgressFrame = {
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
  across: number; expected: number; withinH: number; withinV: number;
  deficit: number; folded: boolean;
};
type SemiMeta = {
  level: number; count: number; listed?: number; truncated: boolean;
  grounded: boolean; refs?: number; reason?: string | null; items: SemiItem[];
  index: number; current?: SemiItem;
  /** 'near' is nearest-to-closing first, 'ext' is shortest extensions first. */
  key?: SemiKey;
};
type SemiKey = "near" | "ext";
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
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

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

function cssColor(color: RGBA | undefined, fallback = "#ffffff") {
  if (!color) return fallback;
  return `rgba(${color.r},${color.g},${color.b},${(color.a ?? 255) / 255})`;
}

export function allBounds(stages: Stage[]): Bounds {
  const finalStage = stages.at(-1);
  const points = (finalStage?.strands ?? [])
    .filter(strand => strand.type !== "MaskedStrand" && !strand.is_hidden)
    .flatMap(strand => [strand.start, strand.end]);
  if (!points.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return {
    minX: Math.min(...points.map(p => p.x)) - 80,
    minY: Math.min(...points.map(p => p.y)) - 80,
    maxX: Math.max(...points.map(p => p.x)) + 80,
    maxY: Math.max(...points.map(p => p.y)) + 80,
  };
}

function layerLevel(layerName: string) {
  const suffix = Number.parseInt(layerName.slice(layerName.lastIndexOf("_") + 1), 10);
  if (!Number.isFinite(suffix) || suffix <= 3) return 0;
  return Math.floor((suffix - 2) / 2);
}

function strandLevel(strand: Strand) {
  if (strand.type !== "MaskedStrand") return layerLevel(strand.layer_name);
  return Math.max(
    layerLevel(strand.first_selected_strand ?? ""),
    layerLevel(strand.second_selected_strand ?? ""),
  );
}

function bandPolygon(start: Point, end: Point, width: number) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length * width / 2;
  const ny = dx / length * width / 2;
  return [
    { x: start.x + nx, y: start.y + ny },
    { x: end.x + nx, y: end.y + ny },
    { x: end.x - nx, y: end.y - ny },
    { x: start.x - nx, y: start.y - ny },
  ];
}

export function drawExactStage(canvas: HTMLCanvasElement, stage: Stage, bounds: Bounds, showLabels = true, fixedSize?: number) {
  const rect = canvas.getBoundingClientRect();
  const dpr = fixedSize ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  const width = fixedSize ?? Math.max(1, rect.width);
  const height = fixedSize ?? Math.max(1, rect.height);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f2f2f7";
  ctx.fillRect(0, 0, width, height);

  const pad = 8;
  const sourceWidth = Math.max(1, bounds.maxX - bounds.minX);
  const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
  // ResizeObserver can fire while a card is between layouts and report a
  // width/height smaller than the padding. Keep the transform positive so
  // endpoint circles never receive a negative canvas radius.
  const usableWidth = Math.max(1, width - pad * 2);
  const usableHeight = Math.max(1, height - pad * 2);
  const scale = Math.max(0.001, Math.min(usableWidth / sourceWidth, usableHeight / sourceHeight));
  const offsetX = (width - sourceWidth * scale) / 2 - bounds.minX * scale;
  const offsetY = (height - sourceHeight * scale) / 2 - bounds.minY * scale;
  const point = (p: Point): Point => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY });

  const regular = stage.strands.filter(s => s.type !== "MaskedStrand" && !s.is_hidden);
  const byName = new Map(regular.map(s => [s.layer_name, s]));

  const strokeSegment = (start: Point, end: Point, color: string, lineWidth: number, cap: CanvasLineCap = "butt") => {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, lineWidth);
    ctx.lineCap = cap;
    ctx.stroke();
  };

  const addStrandShape = (target: CanvasRenderingContext2D, strand: Strand, shapeWidth: number) => {
    const start = point(strand.start);
    const end = point(strand.end);
    const polygon = bandPolygon(start, end, shapeWidth);
    target.moveTo(polygon[0].x, polygon[0].y);
    polygon.slice(1).forEach(vertex => target.lineTo(vertex.x, vertex.y));
    target.closePath();
    const radius = shapeWidth / 2;
    if (strand.has_circles?.[0]) {
      target.moveTo(start.x + radius, start.y);
      target.arc(start.x, start.y, radius, 0, Math.PI * 2, true);
    }
    if (strand.has_circles?.[1]) {
      target.moveTo(end.x + radius, end.y);
      target.arc(end.x, end.y, radius, 0, Math.PI * 2, true);
    }
  };

  // OpenStrandStudio paints one combined path for the body and caps. That
  // removes the antialiased join left by separately painting circles/lines.
  const drawStrandBody = (strand: Strand) => {
    const body = strand.width * scale;
    const outline = Math.max(1.25, strand.stroke_width * scale);
    ctx.beginPath();
    addStrandShape(ctx, strand, body + outline * 2);
    ctx.fillStyle = cssColor(strand.stroke_color, "#000000");
    ctx.fill();
    ctx.beginPath();
    addStrandShape(ctx, strand, body);
    ctx.fillStyle = cssColor(strand.color);
    ctx.fill();

    // OpenStrandStudio paints flat side-lines after the combined body path.
    // A regular Strand can show both; an AttachedStrand only shows its free
    // end. Circle endpoints suppress the corresponding side-line.
    const start = point(strand.start);
    const end = point(strand.end);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const px = -uy;
    const py = ux;
    const halfTotalWidth = (strand.width + strand.stroke_width * 2) * scale / 2;
    const outwardShift = strand.stroke_width * scale / 2;
    const drawSideLine = (anchor: Point, direction: -1 | 1) => {
      const center = {
        x: anchor.x + ux * outwardShift * direction,
        y: anchor.y + uy * outwardShift * direction,
      };
      strokeSegment(
        { x: center.x - px * halfTotalWidth, y: center.y - py * halfTotalWidth },
        { x: center.x + px * halfTotalWidth, y: center.y + py * halfTotalWidth },
        cssColor(strand.stroke_color, "#000000"),
        strand.stroke_width * scale,
        "butt",
      );
    };

    if (strand.type === "Strand" && (strand.start_line_visible ?? true) && !strand.has_circles?.[0]) {
      drawSideLine(start, -1);
    }
    if ((strand.end_line_visible ?? true) && !strand.has_circles?.[1]) {
      drawSideLine(end, 1);
    }
  };

  const scratch = document.createElement("canvas");
  scratch.width = pixelWidth;
  scratch.height = pixelHeight;
  const scratchContext = scratch.getContext("2d");

  const paintShapeIntersection = (first: Strand, firstWidth: number, second: Strand, secondWidth: number, color: string) => {
    if (!scratchContext) return;
    scratchContext.setTransform(1, 0, 0, 1, 0, 0);
    scratchContext.clearRect(0, 0, pixelWidth, pixelHeight);
    scratchContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    scratchContext.globalCompositeOperation = "source-over";
    scratchContext.beginPath();
    addStrandShape(scratchContext, first, firstWidth);
    scratchContext.fillStyle = color;
    scratchContext.fill();
    scratchContext.globalCompositeOperation = "destination-in";
    scratchContext.beginPath();
    addStrandShape(scratchContext, second, secondWidth);
    scratchContext.fillStyle = "#000";
    scratchContext.fill();
    scratchContext.globalCompositeOperation = "source-over";
    ctx.drawImage(scratch, 0, 0, pixelWidth, pixelHeight, 0, 0, width, height);
  };

  // Match MaskedStrand.paint: intersect complete body/cap shapes for the two
  // outer strokes (with a 2px raster guard that emulates vector boolean edges),
  // then intersect the first fill with the second strand's
  // +4 source-pixel safety expansion. Circles therefore participate too.
  const drawStrandMask = (mask: Strand) => {
    const first = mask.first_selected_strand ? byName.get(mask.first_selected_strand) : undefined;
    const second = mask.second_selected_strand ? byName.get(mask.second_selected_strand) : undefined;
    if (!first || !second) return;
    paintShapeIntersection(
      first,
      (first.width + first.stroke_width * 2) * scale,
      second,
      (second.width + second.stroke_width * 2) * scale + 2,
      cssColor(first.stroke_color, "#000000"),
    );
    paintShapeIntersection(
      first,
      first.width * scale,
      second,
      (second.width + second.stroke_width * 2 + 4) * scale,
      cssColor(first.color),
    );
  };

  // Complete each level before moving outward: its strands first, then its
  // crossing masks. Newer-level strands therefore cover every older mask.
  const masks = stage.strands.filter(s => s.type === "MaskedStrand" && !s.is_hidden);
  for (let level = 0; level <= stage.level; level += 1) {
    regular.filter(strand => strandLevel(strand) === level).forEach(drawStrandBody);
    masks.filter(mask => strandLevel(mask) === level).forEach(drawStrandMask);
  }

  if (!showLabels) return;

  // Label the newest ring exactly by its layer_name, as in the source diagrams.
  const suffixes = stage.level === 0 ? [2, 3] : [stage.level * 2 + 2, stage.level * 2 + 3];
  const newest = regular.filter(s => s.type === "AttachedStrand" &&
    suffixes.some(suffix => s.layer_name.endsWith(`_${suffix}`)));
  const sourceFontSize = sourceWidth / 30;
  const fontSize = sourceFontSize * scale;
  ctx.font = `700 ${fontSize}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  newest.forEach(strand => {
    const dx = strand.end.x - strand.start.x;
    const dy = strand.end.y - strand.start.y;
    const length = Math.hypot(dx, dy) || 1;
    const labelPoint = point({
      x: strand.end.x + (dx / length) * sourceFontSize * 1.4,
      y: strand.end.y + (dy / length) * sourceFontSize * 1.4,
    });
    ctx.lineWidth = sourceFontSize * .28 * scale;
    ctx.strokeStyle = "rgba(255,255,255,.96)";
    ctx.strokeText(strand.layer_name, labelPoint.x, labelPoint.y);
    ctx.fillStyle = "#11110f";
    ctx.fillText(strand.layer_name, labelPoint.x, labelPoint.y);
  });
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
  const [progressFrame, setProgressFrame] = useState<ProgressFrame | null>(null);
  const [copiedLevel, setCopiedLevel] = useState<number | null>(null);
  const [fullSizeLevels, setFullSizeLevels] = useState<Set<number>>(() => new Set());
  const [preferShortArms, setPreferShortArms] = useState(true);
  const [extStep, setExtStep] = useState<ExtStep>("auto");
  const [comboBudget, setComboBudget] = useState(DEFAULT_COMBO_BUDGET);
  const [ranKey, setRanKey] = useState<string | null>(null);
  const [solutions, setSolutions] = useState<Record<number, SolutionMeta>>({});
  const [semi, setSemi] = useState<Record<number, SemiMeta>>({});
  const [semiMode, setSemiMode] = useState<Record<number, boolean>>({});
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
    const worker = new Worker(`${LAB_BASE}exact-worker.js?v=semi-sort-v8`, { type: "module" });
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === "progress") {
        setStatus(message.message);
        return;
      }
      if (message.type === "candidate") {
        if (message.id === activeIdRef.current) {
          setProgressFrame(message as ProgressFrame);
        }
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
      if (message.type === "semi-ready") {
        setBrowsingLevel(null);
        const meta: SemiMeta = {
          level: message.level, count: message.count ?? 0,
          listed: message.listed, truncated: message.truncated === true,
          grounded: message.grounded === true, refs: message.refs,
          reason: message.reason,
          items: message.items ?? [], index: 0, key: message.key ?? "near",
        };
        setSemi(current => ({ ...current, [meta.level]: meta }));
        if (!meta.count) {
          setStatus(meta.reason
            ? `L${meta.level}: ${meta.reason}`
            : `L${meta.level}: every candidate closed the ring — no near-misses.`);
          setSemiMode(current => ({ ...current, [meta.level]: false }));
          return;
        }
        setStatus(`L${meta.level}: ${meta.count} near-miss${meta.count === 1 ? "" : "es"}${
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
        setStatus(message.key === "ext"
          ? `L${message.level} near-misses: shortest extensions first`
          : `L${message.level} near-misses: nearest to closing first`);
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
          setProgressFrame(null);
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
          setProgressFrame(null);
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
      setProgressFrame(null);
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
    setProgressFrame(null);
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

  // Both of these read the list the scan already built, so they are cheap and
  // the ring on screen only moves for a reason the reader asked for.
  const sortSemi = (level: number, key: SemiKey) => {
    if (!semi[level]) return;
    setBrowsingLevel(level);
    ensureWorker().postMessage({
      type: "semi-sort", id: activeIdRef.current, level, key,
    });
  };

  // One band at a time, the other held: "keep this V, show me the next H that
  // also falls short". The ‹ › arrows cannot ask that -- they walk the whole
  // list in sort order, mixing both bands and every extension together.
  const stepSemi = (level: number, band: "h" | "v", direction: 1 | -1) => {
    if (!semi[level]?.current) return;
    setBrowsingLevel(level);
    ensureWorker().postMessage({
      type: "semi-step", id: activeIdRef.current, level, band, direction,
    });
  };

  const toggleSemi = (level: number) => {
    const on = semiMode[level] === true;
    setSemiMode(current => ({ ...current, [level]: !on }));
    if (on) {
      // Back to closed rings: the card is showing near-miss geometry, so put
      // the complete solution the reader was on back on screen.
      browse(level, solutions[level]?.index ?? 0);
      return;
    }
    if (semi[level]) {
      browseSemi(level, semi[level].index);
      return;
    }
    setBrowsingLevel(level);
    setStatus(`Sweeping both bands for L${level} near-misses — every candidate against up to three partners that work…`);
    ensureWorker().postMessage({
      type: "semi-scan", id: activeIdRef.current, level,
    });
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
          {/* The busy state, and the whole of it: candidates as they are found,
              drawn small, in the results column — not the sidebar — so opening
              Advanced cannot bury it. This is where finished diagrams land too.
              It replaces a spinner that reported nothing beyond "not frozen";
              the sheet fills at whatever rate the search is managing. */}
          {busy && (
            <figure className="candidate-sheet" aria-label="Live search candidates">
              <figcaption>
                <span>
                  live candidates
                  {progressFrame ? ` · L${progressFrame.level} · k=${progressFrame.k}` : ""}
                </span>
                <b>{progressFrame?.phase ?? "starting search"}</b>
                <em>
                  {progressFrame && progressFrame.total > 0
                    ? `${progressFrame.completed.toLocaleString()} / ${progressFrame.total.toLocaleString()}`
                    : "preparing search"}
                  {progressFrame && progressFrame.valid > 0 ? ` · ${progressFrame.valid} valid` : ""}
                </em>
              </figcaption>
              <div className="sheet-stage">
                <CandidateSheet frame={progressFrame} />
                {/* aria-hidden: the engine status line already carries this
                    state politely, and ticking dots are not worth announcing. */}
                <div className="thinking-plaque" aria-hidden="true">thinking<ThinkingDots /></div>
              </div>
            </figure>
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
                          const onSemi = semiMode[stage.level] === true;
                          // k=0 has one configuration and nothing to sweep, so
                          // it gets neither list.
                          const canSemi = browsable(meta);
                          const semiButton = canSemi ? (
                            <button className={`semi-toggle ${onSemi ? "is-on" : ""}`} type="button"
                              onClick={() => toggleSemi(stage.level)} disabled={busyHere}
                              title={onSemi
                                ? "Back to rings that close"
                                : "Near-misses: one band held at a value that works, the other swept"}
                              aria-pressed={onSemi}
                              aria-label={`${onSemi ? "Show complete rings" : "Show near-misses"} for level ${stage.level}`}>◑</button>
                          ) : null;

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
                                      + (item.folded ? " · this band's own arms cross each other" : "")}>
                                    {item.band === "h" ? "V ok · H short" : "H ok · V short"}
                                    {" "}{item.across}/{item.expected}
                                  </em>
                                )}
                                <button type="button" onClick={() => browseSemi(stage.level, (near?.index ?? 0) + 1)}
                                  disabled={busyHere || !near || near.index + 1 >= near.count}
                                  aria-label={`Next near-miss for level ${stage.level}`}>›</button>
                                {/* One band at a time, the other held. The ‹ ›
                                    arrows walk the sorted list, which mixes
                                    both bands and every extension together;
                                    these ask the question the sweep is made of
                                    -- keep this V, what is the next H that also
                                    falls short? */}
                                {(["h", "v"] as const).map(band => {
                                  const held = band === "h" ? "V" : "H";
                                  const heldPx = item
                                    ? (band === "h" ? item.vExt : item.hExt).reduce((sum, e) => sum + e, 0)
                                    : 0;
                                  const herePx = item
                                    ? (band === "h" ? item.hExt : item.vExt).reduce((sum, e) => sum + e, 0)
                                    : 0;
                                  return ([-1, 1] as const).map(direction => (
                                    <button key={`${band}${direction}`} className="semi-step" type="button"
                                      onClick={() => stepSemi(stage.level, band, direction)}
                                      disabled={busyHere || !item}
                                      title={`${direction > 0 ? "Next" : "Previous"} ${band.toUpperCase()} extension `
                                        + `(now ${herePx}px), holding ${held} at ${heldPx}px`}
                                      aria-label={`${direction > 0 ? "Next" : "Previous"} ${band.toUpperCase()} extension for level ${stage.level}, ${held} held`}>
                                      {band.toUpperCase()}{direction > 0 ? "+" : "−"}
                                    </button>
                                  ));
                                })}
                                {/* Nearest-first is the queue's own order and
                                    the right default; shortest-first answers a
                                    different question -- of the rings that fail,
                                    which does it on the least string. */}
                                <button className="semi-sort" type="button"
                                  onClick={() => sortSemi(stage.level, near?.key === "ext" ? "near" : "ext")}
                                  disabled={busyHere || !near}
                                  title={near?.key === "ext"
                                    ? "Sorted by shortest extensions — click for nearest to closing"
                                    : "Sorted by nearest to closing — click for shortest extensions"}
                                  aria-label={`Sort level ${stage.level} near-misses by ${near?.key === "ext" ? "deficit" : "total extension"}`}>
                                  {near?.key === "ext" ? "SORT EXT" : "SORT NEAR"}
                                </button>
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
                                {semiButton}
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
                              {semiButton}
                            </span>
                          );
                        })()}
                        <button className="resize-level" type="button" onClick={() => toggleLevel(stage.level)} aria-pressed={compact} aria-controls={`level-panel-${stage.level}`} aria-label={`${compact ? "Make larger" : "Make smaller"} diagram for level ${stage.level}`} title={`${compact ? "Make diagram larger" : "Make diagram smaller"}`}>
                          {compact ? "+" : "−"}
                        </button>
                      </div>
                    </div>
                    <div id={`level-panel-${stage.level}`}>
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
