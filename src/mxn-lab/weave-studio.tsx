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

type Point = { x: number; y: number };
type RGBA = { r: number; g: number; b: number; a?: number };
type Strand = {
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
type Stage = { level: number; k: number | null; label: string; strands: Strand[] };
type ProgressFrame = {
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
type AuditRow = {
  level: number; k: number; expected: number; state: string;
  gap: [number, number]; ext: [number[], number[]];
  across: number; within: number; masks: number; stray: number; broken: number;
  applied: string[]; healthy: boolean;
};
type ExactResult = {
  m: number; n: number; ks: number[]; expected: number; seconds: number;
  rows: AuditRow[]; stages: Stage[];
};
type Params = { m: number; n: number; ks: number[]; key: string };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

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

function allBounds(stages: Stage[]): Bounds {
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

function drawExactStage(canvas: HTMLCanvasElement, stage: Stage, bounds: Bounds, showLabels = true, fixedSize?: number) {
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

export function ContinuationLab() {
  const [m, setM] = useState(2);
  const [n, setN] = useState(2);
  const [rawKs, setRawKs] = useState("1");
  const [result, setResult] = useState<ExactResult | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [status, setStatus] = useState("Preparing exact geometry…");
  const [busy, setBusy] = useState(false);
  const [progressFrame, setProgressFrame] = useState<ProgressFrame | null>(null);
  const [copiedLevel, setCopiedLevel] = useState<number | null>(null);
  const [fullSizeLevels, setFullSizeLevels] = useState<Set<number>>(() => new Set());
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
  const bounds = useMemo(() => result ? allBounds(result.stages) : null, [result]);
  const progressStage: Stage | null = progressFrame ? {
    level: progressFrame.level,
    k: progressFrame.k,
    label: progressFrame.phase,
    strands: progressFrame.strands,
  } : null;
  const progressBounds = progressStage ? allBounds([progressStage]) : null;

  const ensureWorker = () => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(`${LAB_BASE}exact-worker.js?v=unequal-families-v3`, { type: "module" });
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
      if (message.type === "result") {
        if (message.id === activeIdRef.current) {
          setFullSizeLevels(new Set());
          setResult(message.result as ExactResult);
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
      const id = ++activeIdRef.current;
      ensureWorker().postMessage({ type: "generate", id, m: params.m, n: params.n, ks: params.ks });
    };
  });

  useEffect(() => {
    return () => workerRef.current?.terminate();
  }, []);

  const paramsKey = `${m}:${n}:${ks.join(",")}`;
  useEffect(() => {
    if (inputError || !ks.length) return;
    const params = { m, n, ks: [...ks], key: paramsKey };
    const timer = window.setTimeout(() => dispatchRef.current(params), 650);
    return () => window.clearTimeout(timer);
  }, [paramsKey, inputError]);

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

      <section className="hero">
        <div><p className="eyebrow">Multi-level strand continuation</p><h1>Your geometry.<br />Every <em>Lᵥ.</em></h1></div>
        <p className="hero-copy">The browser now runs the same continuation calculation as the repository—actual endpoints, masks, extensions, relabel composition, and audit.</p>
      </section>

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
            {inputError && <div className="error-note" role="alert">{inputError}</div>}
            {engineError && <div className="error-note" role="alert">{engineError}</div>}
            {hasDeepMaxK && <div className="edge-note">Max-k beyond L1 is an open research edge in this commit and may fail its weave audit.</div>}
            <div className={`engine-status ${busy ? "is-busy" : ""}`} aria-live="polite"><span className="engine-pulse" />{status}</div>
            {busy && progressFrame && progressStage && progressBounds && (
              <figure className="search-preview" aria-label={`Live search candidate for level ${progressFrame.level}`}>
                <figcaption>
                  <span>live candidate · L{progressFrame.level} · k={progressFrame.k}</span>
                  <b>{progressFrame.phase}</b>
                  <em>
                    {progressFrame.total > 0
                      ? `${progressFrame.completed.toLocaleString()} / ${progressFrame.total.toLocaleString()}`
                      : "preparing search"}
                    {progressFrame.valid > 0 ? ` · ${progressFrame.valid} valid` : ""}
                  </em>
                </figcaption>
                <div className="search-preview-canvas">
                  <ExactCanvas
                    stage={progressStage}
                    bounds={progressBounds}
                    showLabels={false}
                    fixedSize={512}
                    label={`512 pixel low-quality search candidate for level ${progressFrame.level}`}
                  />
                </div>
              </figure>
            )}
            <div className="stats"><div className="stat"><strong>{ks.length || "—"}</strong><span>twist levels</span></div><div className="stat"><strong>{expected}</strong><span>crossings / ring</span></div></div>
            <p className="compute-note">The exact search runs locally in your browser. Deep or 3×3+ sequences can take several minutes.</p>
          </div>
        </aside>

        <div className="results">
          <div className="results-head"><h2>Calculated diagrams</h2><p>LH · CW · crossing anchor<br />same viewport at every stage</p></div>
          <figure className="origin-guide">
            <div className="origin-guide-copy">
              <span className="origin-kicker">L0 → L1 measurement origin</span>
              <h3>Extension starts at purple.</h3>
              <p>For every L0 arm, the outermost crossing with the other band is extension&nbsp;0. The L1 search moves outward from that purple point along the parent arm&apos;s axis.</p>
              <div className="origin-equation"><b>extension</b> = distance from <i>purple anchor</i> to the new L1 start</div>
              <div className="origin-legend"><span className="purple-key">purple · calculation origin</span><span className="red-key">red · old endpoint, not the origin</span></div>
            </div>
            <img src={`${LAB_BASE}extension-origin-l0.svg`} alt="L0 weave arms with purple dots marking the outermost crossings where L1 extension measurement starts, and red dots marking the old endpoints" />
          </figure>
          {!result || !bounds ? (
            <div className="calculation-panel"><div className="calculation-orbit" /><strong>{status}</strong><span>The images appear after the repository audit finishes.</span></div>
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

      <footer className="footer"><span>Calculation source · ysetbon/mxn · commit {COMMIT}</span><a href="..">← Scoubidou3D</a><a href="https://github.com/ysetbon/mxn" target="_blank" rel="noreferrer">View source ↗</a></footer>
    </main>
  );
}
