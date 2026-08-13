"use client";

// The k atlas, at /mxn/ks/.
//
// /mxn/gpu/ fills a shelf and /mxn/ spends it one parameter set at a time.
// Nothing read it whole, so the question the shelf is best placed to answer was
// the one nobody could ask: for a given k, what happens as m and n grow?
//
// Two numbers are the point, and both are currently guesses in the engine:
//
//   the extension ceiling  MAX_PAIR_EXTENSION is 200 for every size. At 3x3
//                          nothing valid needs past 70; at 4x4 the engine picks
//                          200 itself. The grid is over-provisioned at the
//                          bottom of the range and binding at the top, and
//                          which of those a 5x5 is cannot be read off either
//                          end.
//   the angle range        not the +/-20 window. Each combo carries its own, so
//                          the union across a band runs wider than any one of
//                          them at 2x2 k=2 and uses a quarter of one at 3x3.
//
// So: read the shelf, fold it by k, draw how each k moves with size, fit it,
// and predict — with the residuals beside the line and anything past the
// largest size measured drawn as the guess it is.
//
// The page never computes. There is no Pyodide here and no engine: everything
// on screen was computed by the farm on someone's machine and is being read
// back. A shelf that is empty, unreachable or serving nonsense leaves an
// explained empty page, never a broken one — the lab's rule, and this page has
// even less excuse than the lab, which at least has an engine to fall back on.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  CACHE_URL_KEY, createCache, readCacheBase, writeSetting,
} from "../mxn-lab/cache";
import { kLimits } from "../mxn-farm/plan";
import {
  DEFAULT_COMBO_BUDGET, MAX_PAIR_EXTENSION, worstPairs,
} from "../mxn-lab/search-cost";
import { VERDICT_COLOUR, VERDICT_NAMES } from "../mxn-lab/trace-census";
import { allBounds, drawExactStage, type Bounds, type Stage } from "../mxn-lab/exact-draw";
import type { Band } from "../mxn-lab/trace-band";
import {
  bandPairs, ceilingSaving, describeFit, fitPoints, isMeasured, kRowsFor, sweptGridStep,
  type AtlasRecord, type BandStat, type Fit, type FitPoint,
} from "./model";
import {
  emptyShelf, fixtureShelf, liveShelf,
  type AtlasDump, type Shelf, type ShelfSummary,
} from "./shelf";

const SIDES = [1, 2, 3, 4];

const SIZES = SIDES.flatMap(m => SIDES.map(n => ({ m, n })));

type Metric = "extPeak" | "extCeilingNeeded" | "validSpan";

/** Enough to see the shape of the error without the panel becoming a listing. */
const RESIDUALS_SHOWN = 12;

const METRICS: { key: Metric; label: string; unit: string; hint: string }[] = [
  {
    key: "extPeak", label: "chosen ext", unit: "px",
    hint: "the longest single pair extension in the ring the engine settled on. "
      + "Read from the run alone, so every cell on the shelf has one.",
  },
  {
    key: "extCeilingNeeded", label: "needed ceiling", unit: "px",
    hint: "the smallest MAX_PAIR_EXTENSION that would still leave the band a valid "
      + "ring. Needs the census, so a cell has one only once its traces are loaded.",
  },
  {
    key: "validSpan", label: "angle span", unit: "°",
    hint: "the width of the union of angles that pass every test, across the whole "
      + "extension grid. Needs the census.",
  },
];

/** A cell is one size and one k. Levels and flag variants fold into it. */
const cellId = (m: number, n: number, k: number) => `${m}x${n}|${k}`;
const angleSlot = (record: AtlasRecord) => `${record.runKey}|L${record.level}`;

const inBand = (m: number, n: number, k: number) => {
  const { min, max } = kLimits(m, n);
  return k >= min && k <= max;
};

const fmt = (value: number, digits = 0) =>
  Number.isFinite(value) ? value.toFixed(digits) : "—";

// ---------------------------------------------------------------------------
// A small scatter, drawn the way everything else in this suite is drawn: by
// hand on a 2D canvas. The repo has no chart library and should not gain one
// for four axes.
// ---------------------------------------------------------------------------

type ChartPoint = { x: number; y: number; label: string; faint?: boolean };

function Scatter({
  points, fit, unit, xLabel, predictTo, k,
}: {
  points: ChartPoint[];
  fit: Fit | null;
  unit: string;
  xLabel: string;
  /** Draw the fitted line out to this x, hatched past the data. */
  predictTo: number;
  /** The line is a slice through the fit at one k — the one in the foreground. */
  k: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 260;
    const height = canvas.clientHeight || 180;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const pad = { left: 40, right: 10, top: 12, bottom: 24 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    // On the whole set, not the foreground: selecting a k whose own cells have
    // nothing to plot still leaves every other k worth drawing, and blanking
    // the chart there would hide a fit the panel below is quoting.
    if (!points.length) {
      context.fillStyle = "#69675f";
      context.font = "600 11px monospace";
      context.fillText("nothing measured yet", pad.left, pad.top + plotH / 2);
      return;
    }

    const xs = points.map(p => p.x).concat(predictTo);
    const ys = points.map(p => p.y);
    if (fit) {
      for (let x = 1; x <= predictTo; x += 1) {
        const at = fit.predict(x, x, k);
        ys.push(at.hi, at.lo);
      }
    }
    const xMin = Math.min(...xs) - 0.4;
    const xMax = Math.max(...xs) + 0.4;
    const yMin = Math.min(0, ...ys);
    const yMax = Math.max(...ys) * 1.05 || 1;
    const px = (x: number) => pad.left + ((x - xMin) / (xMax - xMin || 1)) * plotW;
    const py = (y: number) => pad.top + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;

    // Axes.
    context.strokeStyle = "#d7d0c0";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(pad.left, pad.top);
    context.lineTo(pad.left, pad.top + plotH);
    context.lineTo(pad.left + plotW, pad.top + plotH);
    context.stroke();
    context.fillStyle = "#69675f";
    context.font = "600 9px monospace";
    context.fillText(`${Math.round(yMax)}${unit}`, 4, pad.top + 8);
    context.fillText(`${Math.round(yMin)}${unit}`, 4, pad.top + plotH);
    context.fillText(xLabel, pad.left + plotW - 34, height - 6);

    // Where the evidence stops.
    if (fit && fit.maxPairs < xMax) {
      const edge = px(fit.maxPairs);
      context.fillStyle = "rgba(23, 23, 19, .05)";
      context.fillRect(edge, pad.top, pad.left + plotW - edge, plotH);
      context.strokeStyle = "#d7d0c0";
      context.setLineDash([3, 3]);
      context.beginPath();
      context.moveTo(edge, pad.top);
      context.lineTo(edge, pad.top + plotH);
      context.stroke();
      context.setLineDash([]);
    }

    // The fit, with its interval.
    if (fit) {
      // Whole sizes only. There is no 2.25×2.25, and evaluating the fit between
      // them is not merely pointless: kRel is k over its size's own band, and
      // that band steps as the size does, so a fractional x produces a genuine
      // discontinuity. Sampling at quarters drew it as a sawtooth — an artefact
      // of asking the model a question it has no answer to.
      const steps: { x: number; lo: number; hi: number; v: number }[] = [];
      for (let x = Math.max(1, Math.ceil(xMin)); x <= predictTo; x += 1) {
        const p = fit.predict(x, x, k);
        steps.push({ x, lo: p.lo, hi: p.hi, v: p.value });
      }
      context.fillStyle = "rgba(39, 107, 114, .12)";
      context.beginPath();
      steps.forEach((s, i) => (i ? context.lineTo(px(s.x), py(s.hi)) : context.moveTo(px(s.x), py(s.hi))));
      [...steps].reverse().forEach(s => context.lineTo(px(s.x), py(s.lo)));
      context.closePath();
      context.fill();
      context.strokeStyle = "#276b72";
      context.lineWidth = 1.5;
      context.beginPath();
      steps.forEach((s, i) => (i ? context.lineTo(px(s.x), py(s.v)) : context.moveTo(px(s.x), py(s.v))));
      context.stroke();
    }

    // The measured points last, so nothing is drawn over them.
    points.forEach(point => {
      context.fillStyle = point.faint ? "rgba(23, 23, 19, .16)" : "#171713";
      context.beginPath();
      context.arc(px(point.x), py(point.y), point.faint ? 2 : 3.4, 0, Math.PI * 2);
      context.fill();
    });
  }, [points, fit, unit, xLabel, predictTo, k]);

  return <canvas ref={ref} />;
}

// ---------------------------------------------------------------------------
// The drawings.
//
// drawExactStage is the lab's own renderer, lifted out of weave-studio.tsx so
// more than one panel could draw a ring — this is the third. Nothing about the
// geometry is recomputed here: these are the rings the engine settled on,
// stored with the run, read back and painted.
// ---------------------------------------------------------------------------

/** One ring, at a fixed pixel size, framed to itself. */
function Ring({ stage, bounds, size, label }: {
  stage: Stage;
  bounds: Bounds;
  size: number;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    // fixedSize rather than a ResizeObserver: a contact sheet is a lot of
    // canvases and they do not need to reflow, they need to be small and
    // identical. `--card` so the tiles sit on the panel rather than on a plate.
    if (canvas) drawExactStage(canvas, stage, bounds, false, size, "#fbf8ef");
  }, [stage, bounds, size]);
  return (
    <figure className="atlas-ring">
      <canvas ref={ref} width={size} height={size} />
      {label && <figcaption>{label}</figcaption>}
    </figure>
  );
}

/** The states a drawing can be in, said in words rather than by a spinner. */
function RingNote({ state, what }: { state: "idle" | "loading" | "missing"; what: string }) {
  if (state === "loading") return <p className="atlas-empty">reading {what}…</p>;
  if (state === "missing") {
    return (
      <p className="atlas-empty">
        No geometry for {what} on this shelf. The bundled snapshot carries drawings for a
        sample only — the strands of a whole shelf are tens of megabytes. Against the live
        Worker every cell has them.
      </p>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------

export function KAtlas({ forceFixture = false }: { forceFixture?: boolean } = {}) {
  const [base, setBase] = useState(() => readCacheBase("atlas"));
  const [useFixture, setUseFixture] = useState(() => {
    if (forceFixture) return true;
    try {
      return new URLSearchParams(window.location.search).get("data") === "mock";
    } catch {
      return false;
    }
  });
  const [dump, setDump] = useState<AtlasDump | null>(null);
  const [summary, setSummary] = useState<ShelfSummary | null>(null);
  const [records, setRecords] = useState<AtlasRecord[]>([]);
  const [angles, setAngles] = useState<Record<string, Partial<Record<Band, BandStat>>>>({});
  const [status, setStatus] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const [handDirection, setHandDirection] = useState("lh-cw");
  // "" until the shelf says which variant is commonest; "any" only if asked for.
  const [flags, setFlags] = useState("");
  const [levelFilter, setLevelFilter] = useState("1");
  // On by default: a ring that did not close is a real result and worth seeing,
  // but its extensions are not an observation of what a working search needs,
  // and letting them into the fit drags the line towards configurations that
  // answer nothing. Untick to put the failures back.
  const [healthyOnly, setHealthyOnly] = useState(true);
  const [metric, setMetric] = useState<Metric>("extPeak");
  const [selected, setSelected] = useState<string | null>(null);
  const [predict, setPredict] = useState({ m: 5, n: 5, k: 1 });
  const [geometry, setGeometry] = useState<Record<string, Stage[] | null>>({});
  const [drawing, setDrawing] = useState<Set<string>>(new Set());

  // The dump is fetched rather than imported: it is data, it changes without
  // the bundle changing, and it lives in public/ so that one copy serves both
  // this page's ?data=mock and mocks/ks-atlas.html. A standalone single-file
  // build has no server to fetch from, so an inlined copy wins if there is one.
  useEffect(() => {
    if (!useFixture || dump) return;
    let live = true;
    const url = `${import.meta.env.BASE_URL}mxn/ks-atlas.json`;
    const inlined = (window as { __KS_ATLAS_DUMP?: AtlasDump }).__KS_ATLAS_DUMP;
    if (inlined) {
      setDump(inlined);
      return;
    }
    fetch(url)
      .then(response => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then(body => live && setDump(body))
      .catch(() => live && setProblem(
        "The bundled dump is missing — run `npm run dump:ks` against your Worker.",
      ));
    return () => { live = false; };
  }, [useFixture, dump]);

  const shelf: Shelf = useMemo(() => {
    if (useFixture) {
      return dump
        ? fixtureShelf(dump, `${import.meta.env.BASE_URL}mxn/ks-atlas-geometry.json`)
        : emptyShelf("loading the bundled dump…");
    }
    if (!base) {
      return emptyShelf("no worker url — set one below, or switch to the bundled dump");
    }
    return liveShelf(createCache({ base, hostId: "atlas" }));
  }, [useFixture, dump, base]);

  const load = useCallback(async () => {
    setBusy(true);
    setProblem("");
    setStatus("reading the shelf…");
    setAngles({});
    try {
      const info = await shelf.summary();
      setSummary(info);
      const rows = await shelf.records((done, total) => setProgress({ done, total }));
      setRecords(rows);
      setProgress(null);
      setStatus(rows.length
        ? `${rows.length} level${rows.length === 1 ? "" : "s"} across ${info.runs} run${info.runs === 1 ? "" : "s"}`
        : "nothing on this shelf yet — sweep some sizes at /mxn/gpu/");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setStatus("");
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }, [shelf]);

  useEffect(() => { void load(); }, [load]);

  // --- filtering ----------------------------------------------------------

  // Off the unfiltered records on purpose — see kRowsFor. The grid keeps its
  // shape as the sidebar is worked; only what is IN the cells changes.
  const kRows = useMemo(() => kRowsFor(records), [records]);

  /**
   * The flag variants actually on the shelf, commonest first.
   *
   * Carried as objects rather than as the key string alone, because the step
   * and the budget are read back out of them for the prediction panel and
   * re-parsing a string this module just built would be a second opinion on a
   * grammar cache.ts already owns.
   */
  const flagChoices = useMemo(() => {
    const seen = new Map<string, { key: string; count: number; shortArms: boolean; step: number | "auto"; budget: number }>();
    records.forEach(r => {
      const key = `s${r.shortArms ? 1 : 0}-e${r.step}-b${r.budget}`;
      const held = seen.get(key);
      if (held) held.count += 1;
      else seen.set(key, { key, count: 1, shortArms: r.shortArms, step: r.step, budget: r.budget });
    });
    return [...seen.values()].sort((a, b) => b.count - a.count);
  }, [records]);

  /**
   * Which search the panel is describing.
   *
   * The selected variant when one is selected, the shelf's commonest otherwise.
   * Never a default constant: a page that quoted step "auto" at budget 400,000
   * over a shelf swept at `e5-b100000000` would be describing a search nobody
   * ran.
   */
  const variant = useMemo(
    () => flagChoices.find(choice => choice.key === flags) ?? flagChoices[0] ?? null,
    [flagChoices, flags],
  );

  // Land on the shelf's commonest variant once the records arrive. "any" mixes
  // two questions into one fit, which the sidebar warns about two inches away;
  // it stays available, it is just no longer what happens by default.
  //
  // The unset state is "" rather than "any", so that a reader who deliberately
  // chooses "any" is not immediately overruled by this.
  useEffect(() => {
    if (flags === "" && flagChoices.length) setFlags(flagChoices[0].key);
  }, [flagChoices, flags]);

  const shown = useMemo(() => records.filter(r => {
    if (`${r.hand}-${r.direction}` !== handDirection) return false;
    if (flags && flags !== "any"
      && `s${r.shortArms ? 1 : 0}-e${r.step}-b${r.budget}` !== flags) return false;
    if (levelFilter !== "all" && r.level !== Number(levelFilter)) return false;
    if (healthyOnly && !r.healthy) return false;
    return true;
  }), [records, handDirection, flags, levelFilter, healthyOnly]);

  /**
   * One record per cell, newest first.
   *
   * A cell can hold several: the same size and k at different levels, or the
   * same parameters swept twice under different flags. Newest wins for the
   * grid, and the cell panel lists the rest so nothing is hidden by the choice.
   */
  const cells = useMemo(() => {
    const out = new Map<string, AtlasRecord[]>();
    shown.forEach(r => {
      const id = cellId(r.m, r.n, r.k);
      const list = out.get(id);
      if (list) list.push(r);
      else out.set(id, [r]);
    });
    out.forEach(list => list.sort((a, b) => b.computedAt.localeCompare(a.computedAt)));
    return out;
  }, [shown]);

  const statFor = useCallback((record: AtlasRecord, band: Band) =>
    angles[angleSlot(record)]?.[band], [angles]);

  /**
   * A cell's value under the chosen metric.
   *
   * The two census metrics take the larger of the bands, which for both of them
   * is the conservative reading: a ceiling that suits H and starves V is not a
   * ceiling the search could be run at, and a window narrow enough for H would
   * cut off answers V still has. Whichever band asks for more is what a search
   * over this cell would have to be given.
   */
  const valueOf = useCallback((record: AtlasRecord, which: Metric): number => {
    if (which === "extPeak") return record.extPeak;
    const bands = [statFor(record, "h"), statFor(record, "v")];
    // A band the ceiling refused is not a band with no requirement — it is a
    // requirement nobody can measure. Taking the max over what is left would
    // quietly report a lower bound as a measurement, and at 4×n that is exactly
    // where the fit is being asked to extrapolate from. Unknown, and said so.
    //
    // A band that solved WITHOUT a search is different: it really does ask for
    // nothing, so the other band's answer is the cell's answer.
    if (bands.some(stat => stat?.state === "unavailable" && stat.overCeiling)) return NaN;
    const from = (stat: BandStat | undefined) =>
      (isMeasured(stat) ? (which === "validSpan" ? stat.validSpan : stat.extCeilingNeeded) : NaN);
    const values = bands.map(from).filter(Number.isFinite);
    return values.length ? Math.max(...values) : NaN;
  }, [statFor]);

  // --- loading censuses ---------------------------------------------------

  const loadAngles = useCallback(async (targets: AtlasRecord[]) => {
    const wanted = targets.filter(r => !angles[angleSlot(r)] && !r.degenerate);
    if (!wanted.length) return;
    setBusy(true);
    setProgress({ done: 0, total: wanted.length });
    let done = 0;
    let next = 0;
    const collected: Record<string, Partial<Record<Band, BandStat>>> = {};
    const workers = Array.from({ length: Math.min(3, wanted.length) }, async () => {
      for (;;) {
        const at = next;
        next += 1;
        if (at >= wanted.length) return;
        const record = wanted[at];
        collected[angleSlot(record)] = await shelf.angles(record).catch(() => ({}));
        done += 1;
        setProgress({ done, total: wanted.length });
      }
    });
    await Promise.all(workers);
    setAngles(current => ({ ...current, ...collected }));
    setProgress(null);
    setBusy(false);
  }, [angles, shelf]);

  // --- the drawings -------------------------------------------------------

  /**
   * Rings, per run, fetched only when a drawing is on screen.
   *
   * `null` in the map means "asked, and this shelf has none" — a real answer
   * and a different one from "not asked yet", which is the map having no entry.
   */
  const loadGeometry = useCallback(async (targets: AtlasRecord[]) => {
    const wanted = targets.filter(r => !(r.runKey in geometry));
    if (!wanted.length) return;
    setDrawing(current => new Set([...current, ...wanted.map(r => r.runKey)]));
    const collected: Record<string, Stage[] | null> = {};
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, wanted.length) }, async () => {
      for (;;) {
        const at = next;
        next += 1;
        if (at >= wanted.length) return;
        collected[wanted[at].runKey] = await shelf.geometry(wanted[at]).catch(() => null);
      }
    }));
    setGeometry(current => ({ ...current, ...collected }));
    setDrawing(current => {
      const rest = new Set(current);
      wanted.forEach(r => rest.delete(r.runKey));
      return rest;
    });
  }, [geometry, shelf]);

  // Selecting a cell pulls its own censuses, and only its own: the bulk load is
  // minutes of fetching and is something a reader asks for on purpose.
  useEffect(() => {
    if (!selected) return;
    const list = cells.get(selected);
    if (list?.[0]) {
      void loadAngles([list[0]]);
      // Its rings too: the filmstrip is one fetch for the whole sequence, and
      // it is the drawing of the thing the reader just clicked on.
      void loadGeometry([list[0]]);
    }
    // loadAngles closes over `angles`, which it also sets, so this effect does
    // re-run as each band arrives. That terminates because loadAngles drops
    // anything already loaded and returns before touching state at all.
  }, [selected, cells, loadAngles, loadGeometry]);

  // --- the fits -----------------------------------------------------------

  const fitFor = useCallback((which: Metric): Fit | null => {
    const points: FitPoint[] = [];
    cells.forEach((list, id) => {
      const record = list[0];
      // A k that searched nothing has no extensions, and its zero is the
      // absence of a measurement rather than a small one. Fitting through it
      // pulls the whole line down towards sizes that never asked a question.
      if (record.degenerate) return;
      const y = valueOf(record, which);
      if (!Number.isFinite(y)) return;
      points.push({
        m: record.m, n: record.n, k: record.k,
        pairs: worstPairs(record.m, record.n),
        y, label: id.replace("|", " · k="),
      });
    });
    return fitPoints(points);
  }, [cells, valueOf]);

  const fits = useMemo(() => ({
    extPeak: fitFor("extPeak"),
    extCeilingNeeded: fitFor("extCeilingNeeded"),
    validSpan: fitFor("validSpan"),
  }), [fitFor]);

  const selectedRecords = selected ? cells.get(selected) ?? [] : [];
  const record = selectedRecords[0] ?? null;
  const selectedK = record?.k ?? 1;

  const chartPoints = useCallback((which: Metric): ChartPoint[] => {
    const out: ChartPoint[] = [];
    cells.forEach((list, id) => {
      const row = list[0];
      if (row.degenerate) return;   // same reason as fitFor
      const y = valueOf(row, which);
      if (!Number.isFinite(y)) return;
      out.push({
        x: worstPairs(row.m, row.n), y,
        label: id,
        faint: record ? row.k !== record.k : false,
      });
    });
    return out;
  }, [cells, valueOf, record]);

  // --- render -------------------------------------------------------------

  const chip = (() => {
    if (problem) return { kind: "is-warn", lines: [problem] };
    if (useFixture) {
      return {
        kind: "is-fixture",
        lines: [
          `bundled dump${summary?.label ? ` · ${summary.label}` : ""}`,
          summary ? `${summary.runs} runs · ${summary.traces} bands · newest ${summary.newest.slice(0, 10)}` : "loading…",
        ],
      };
    }
    if (!base) return { kind: "is-warn", lines: ["no worker url configured"] };
    return {
      kind: "",
      lines: [
        base.replace(/^https?:\/\//, ""),
        summary
          ? `${summary.runs} runs on the shelf${summary.newest ? ` · newest ${summary.newest.slice(0, 10)}` : ""}`
          : "reading…",
        ...(summary?.truncated.length
          ? [`⚠ ${summary.truncated.length} prefix(es) came back full — the listing may be short`]
          : []),
      ],
    };
  })();

  const metricInfo = METRICS.find(entry => entry.key === metric)!;
  const prediction = fits[metric]?.predict(predict.m, predict.n, predict.k) ?? null;

  return (
    <div className="atlas">
      <header className="atlas-top">
        <a className="atlas-brand" href="../">
          <span className="atlas-mark">k</span>
          <span>
            <b>MXN · k ATLAS</b><br />
            <i>WHAT THE SHELF KNOWS ABOUT k</i>
          </span>
        </a>
        <div className="atlas-top-right">{status}</div>
      </header>

      <p className="atlas-lede">
        Every run <a href="../gpu/">the farm</a> has stored, read back at once and folded by k.
        The engine sizes its search with two constants that are guesses — the extension grid
        runs <b>0…{MAX_PAIR_EXTENSION}</b> per pair for every size, and the angle window
        is <b>±20°</b> — and the shelf is the only thing that can say what they should have
        been. Nothing here computes: if a cell is empty, nobody has swept it yet.
      </p>

      <div className="atlas-grid">
        <div className="atlas-col">
          <section className="atlas-panel">
            <h2>1 · Where it reads</h2>
            <div className={`atlas-chip ${chip.kind}`}>
              {chip.lines.map(line => <span key={line}>{line}</span>)}
            </div>
            <label className="atlas-field">
              <span>worker url</span>
              <input
                type="url" value={base} placeholder="https://…workers.dev"
                onChange={event => setBase(event.target.value.trim().replace(/\/+$/, ""))}
                onBlur={() => writeSetting(CACHE_URL_KEY, base)}
              />
            </label>
            <label className="atlas-check">
              <input
                type="checkbox" checked={useFixture}
                onChange={event => setUseFixture(event.target.checked)}
              />
              <span>
                read the bundled dump instead
                <br />
                <em style={{ color: "var(--muted)" }}>
                  a committed snapshot of the shelf — the page works with no network at all
                </em>
              </span>
            </label>
            <div className="atlas-modes">
              <button type="button" onClick={() => void load()} disabled={busy}>reload</button>
            </div>
            {progress && (
              <div className="atlas-progress">
                <i style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
              </div>
            )}
          </section>

          <section className="atlas-panel">
            <h2>2 · What to compare</h2>
            <label className="atlas-field">
              <span>hand and direction</span>
              <select value={handDirection} onChange={event => setHandDirection(event.target.value)}>
                {["lh-cw", "lh-ccw", "rh-cw", "rh-ccw"].map(hd => (
                  <option key={hd} value={hd}>{hd}</option>
                ))}
              </select>
            </label>
            <label className="atlas-field">
              <span>search flags</span>
              <select value={flags} onChange={event => setFlags(event.target.value)}>
                {!flagChoices.length && <option value="">nothing on the shelf</option>}
                {flagChoices.map(choice => (
                  <option key={choice.key} value={choice.key}>
                    {choice.key} · {choice.count}
                  </option>
                ))}
                <option value="any">any on the shelf</option>
              </select>
            </label>
            <p className="atlas-note">
              A step and a budget are part of what an answer <em>is</em> — <code>eauto</code> and
              <code> e20</code> are different searches even when auto resolves to 20. Mixing them in
              one fit compares two questions, so this starts on whichever the shelf holds most of.
            </p>
            {flags === "any" && flagChoices.length > 1 && (
              <p className="atlas-note">
                <b>{flagChoices.length} variants are being mixed.</b> The fit below is over answers
                from {flagChoices.map(choice => choice.key).join(" and ")} together, which were not
                the same search. Pick one to compare like with like.
              </p>
            )}
            <label className="atlas-field">
              <span>level</span>
              <select value={levelFilter} onChange={event => setLevelFilter(event.target.value)}>
                <option value="1">L1 only</option>
                <option value="all">every level</option>
                {[2, 3, 4, 5, 6, 7, 8].map(level => (
                  <option key={level} value={String(level)}>L{level} only</option>
                ))}
              </select>
            </label>
            <p className="atlas-note">
              L1 is the default because a k at level 2 or above is conditioned on the whole
              prefix that reached it. Those are real observations, but they are not a clean
              reading of what <em>this</em> k does.
            </p>
            <label className="atlas-check">
              <input
                type="checkbox" checked={healthyOnly}
                onChange={event => setHealthyOnly(event.target.checked)}
              />
              <span>rings that closed only</span>
            </label>
            <p className="atlas-note">
              On by default. A ring that did not close is a real result — <code>4×1 k=1</code> is
              one — but its extensions answer nothing, so letting them into the fit drags the
              line towards configurations that failed. Cells that searched nothing at all
              (<code>k = 0</code> and the bands solved without a search) are never fitted either
              way: their zero is a missing measurement, not a small one.
            </p>
          </section>

          <section className="atlas-panel">
            <h2>3 · Censuses</h2>
            <p className="atlas-note">
              Angles live in the trace artifacts, not the runs, so the grid arrives without them.
              Loading them all is one fetch per band per cell.
            </p>
            <button
              type="button" className="atlas-go" disabled={busy || !cells.size}
              onClick={() => void loadAngles([...cells.values()].map(list => list[0]))}
            >
              load censuses for {cells.size} cells
            </button>
            <p className="atlas-note">
              4×4 will come back <em>unavailable</em> however long you wait: 194,481 combos is over
              the trace ceiling, so no census for it exists or can. Its angle numbers are
              necessarily predicted.
            </p>
          </section>
        </div>

        <div className="atlas-col">
          <section className="atlas-panel">
            <h2>A · The k grid</h2>
            <div className="atlas-modes">
              {METRICS.map(entry => (
                <button
                  key={entry.key} type="button"
                  className={entry.key === metric ? "is-on" : ""}
                  onClick={() => setMetric(entry.key)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p className="atlas-note">{metricInfo.hint}</p>
            {metric !== "extPeak" && !Object.keys(angles).length && (
              <p className="atlas-note">
                <b>Nothing to show yet.</b> This one comes from the censuses, and none are
                loaded — press <em>load censuses</em> in the sidebar, or click any single cell
                to fetch just that one.
              </p>
            )}
            <div className="atlas-matrix">
              <table>
                <thead>
                  <tr>
                    <th />
                    {SIZES.map(size => (
                      <th key={`${size.m}x${size.n}`}>{size.m}×{size.n}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {kRows.map(k => (
                    <tr key={k}>
                      <th className="atlas-krow">k = {k > 0 ? `+${k}` : k}</th>
                      {SIZES.map(size => {
                        const id = cellId(size.m, size.n, k);
                        const list = cells.get(id);
                        const row = list?.[0];
                        if (!inBand(size.m, size.n, k)) {
                          return (
                            <td key={id}>
                              <span
                                className="atlas-cell is-outside"
                                title={`${size.m}×${size.n} does not admit k = ${k}`}
                              />
                            </td>
                          );
                        }
                        if (!row) {
                          return (
                            <td key={id}>
                              <a
                                className="atlas-cell is-empty" href="../gpu/"
                                title={`nothing stored for ${size.m}×${size.n} k = ${k} — sweep it at /mxn/gpu/`}
                              >
                                <b>·</b>
                              </a>
                            </td>
                          );
                        }
                        const value = valueOf(row, metric);
                        const pending = !Number.isFinite(value);
                        // Only the ceiling gets the hatch. "This band solved
                        // without a search" is also unavailable and is not a
                        // limit — marking it would say the opposite of the key.
                        const capped = [statFor(row, "h"), statFor(row, "v")]
                          .some(stat => stat?.state === "unavailable" && stat.overCeiling);
                        const scale = metric === "validSpan"
                          ? Math.min(1, value / 60)
                          : Math.min(1, value / MAX_PAIR_EXTENSION);
                        const classes = [
                          "atlas-cell",
                          selected === id ? "is-on" : "",
                          row.degenerate ? "is-degenerate" : "",
                          row.healthy ? "" : "is-sick",
                          pending ? "is-pending" : "",
                          capped ? "is-capped" : "",
                        ].filter(Boolean).join(" ");
                        return (
                          <td key={id}>
                            <button
                              type="button" className={classes}
                              style={{ "--s": pending ? 0 : scale } as CSSProperties}
                              onClick={() => setSelected(id)}
                              title={`${size.m}×${size.n} k=${k} · L${row.level} · `
                                + `${row.healthy ? "closed" : "did not close"} · `
                                + `computed ${row.computedAt.slice(0, 10)}`}
                            >
                              <b>
                                {row.degenerate ? "—"
                                  : pending ? (capped ? "?" : "·")
                                  : fmt(value, metric === "validSpan" ? 1 : 0)}
                              </b>
                              <i>
                                {row.degenerate ? "no search"
                                  : pending && capped ? "unmeasurable"
                                  : `L${row.level}`}
                              </i>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="atlas-legend">
              <span><i className="atlas-swatch" style={{ background: "rgba(39,107,114,.48)" }} /> darker = larger {metricInfo.unit}</span>
              <span><i className="atlas-swatch" style={{ borderColor: "var(--red)" }} /> did not close</span>
              <span><i className="atlas-swatch" style={{ background: "repeating-linear-gradient(45deg,transparent 0 4px,rgba(23,23,19,.2) 4px 5px)" }} /> a band is over the trace ceiling · <b>?</b> = unmeasurable, not unloaded</span>
              <span><i className="atlas-swatch" style={{ borderStyle: "dashed" }} /> not on the shelf</span>
              <span>· = outside this size's k band</span>
            </div>
          </section>

          <ContactSheet
            k={selectedK}
            rows={SIZES.map(size => cells.get(cellId(size.m, size.n, selectedK))?.[0])
              .filter((row): row is AtlasRecord => !!row && !row.degenerate)}
            geometry={geometry}
            drawing={drawing}
            onDraw={loadGeometry}
            metric={metricInfo}
            valueOf={valueOf}
            selected={selected}
            onPick={setSelected}
          />

          <section className="atlas-panel">
            <h2>C · How this k moves with size</h2>
            {record ? (
              <p className="atlas-note">
                Solid points are <b>k = {record.k}</b>; the faint ones are every other k on the
                shelf, for scale. The horizontal axis is <code>worstPairs(m, n) = max(m, n)</code>,
                which is what the extension grid is raised to — the shaded region is past anything
                measured.
              </p>
            ) : (
              <p className="atlas-note">Pick a cell above to bring its k forward.</p>
            )}
            <div className="atlas-charts">
              {METRICS.map(entry => (
                <div className="atlas-chart" key={entry.key}>
                  <h3>{entry.label} · {entry.unit}</h3>
                  <Scatter
                    points={chartPoints(entry.key)}
                    fit={fits[entry.key]}
                    unit={entry.unit}
                    xLabel="max(m,n)"
                    predictTo={Math.max(6, worstPairs(predict.m, predict.n))}
                    k={selectedK}
                  />
                  <p>
                    {fits[entry.key]
                      ? `R² ${fits[entry.key]!.r2.toFixed(2)} · ±${fits[entry.key]!.sd.toFixed(1)}${entry.unit} · ${fits[entry.key]!.n} points`
                      : "not enough on the shelf to fit"}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <CellPanel
            record={record}
            others={selectedRecords.slice(1)}
            h={record ? statFor(record, "h") : undefined}
            v={record ? statFor(record, "v") : undefined}
            stages={record ? geometry[record.runKey] : undefined}
            drawing={!!record && drawing.has(record.runKey)}
          />

          <section className="atlas-panel">
            <h2>E · The model, and what it predicts</h2>
            <p className="atlas-note">
              Ordinary least squares on <code>[1, pairs, m+n, |k|, kRel]</code>, where{" "}
              <code>kRel</code> is k placed in its own size's band — 2×1 admits −2…3 and 2×2
              admits −1…2, so a raw k is not the same thing at two sizes. <code>m+n</code> is
              in there because it separates 3×3 from 1×3, which <code>max(m,n)</code> alone
              cannot. The residuals are below because a fit over {fits[metric]?.n ?? 0} points
              is a sketch and should look like one.
            </p>
            {fits[metric] ? (
              <>
                <div className="atlas-formula">
                  <b>{metricInfo.label}</b> ≈ {describeFit(fits[metric]!, metricInfo.unit)}
                </div>
                <div className="atlas-pair">
                  <label className="atlas-field">
                    <span>m</span>
                    <input
                      type="number" min={1} max={12} value={predict.m}
                      onChange={event => setPredict(p => ({ ...p, m: Number(event.target.value) || 1 }))}
                    />
                  </label>
                  <label className="atlas-field">
                    <span>n</span>
                    <input
                      type="number" min={1} max={12} value={predict.n}
                      onChange={event => setPredict(p => ({ ...p, n: Number(event.target.value) || 1 }))}
                    />
                  </label>
                </div>
                <label className="atlas-field">
                  <span>
                    k · this size admits {kLimits(predict.m, predict.n).min}…
                    {kLimits(predict.m, predict.n).max}
                  </span>
                  <input
                    type="number" value={predict.k}
                    onChange={event => setPredict(p => ({ ...p, k: Number(event.target.value) || 0 }))}
                  />
                </label>
                <Prediction
                  metric={metricInfo}
                  prediction={prediction}
                  m={predict.m} n={predict.n} k={predict.k}
                  sweptStep={record?.step ?? variant?.step ?? "auto"}
                  budget={record?.budget ?? variant?.budget ?? DEFAULT_COMBO_BUDGET}
                />
                <h3 style={{ margin: "6px 0 0", font: "800 10px/1 monospace", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>
                  where it is most wrong
                </h3>
                <table className="atlas-table">
                  <thead>
                    <tr><th>cell</th><th>measured</th><th>fitted</th><th>off by</th></tr>
                  </thead>
                  <tbody>
                    {[...fits[metric]!.residuals]
                      .sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual))
                      .slice(0, RESIDUALS_SHOWN)
                      .map(row => (
                        <tr key={row.label}>
                          <td>{row.label}</td>
                          <td>{fmt(row.y, 1)}</td>
                          <td>{fmt(row.yhat, 1)}</td>
                          <td className={Math.abs(row.residual) > fits[metric]!.sd ? "is-off" : ""}>
                            {row.residual > 0 ? "+" : ""}{fmt(row.residual, 1)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {fits[metric]!.n > RESIDUALS_SHOWN && (
                  <p className="atlas-note">
                    The worst {RESIDUALS_SHOWN} of {fits[metric]!.n}. Everything below them fits
                    more closely than these do — the full set is the R² and the ± above.
                  </p>
                )}
              </>
            ) : (
              <p className="atlas-empty">
                Not enough on the shelf to fit {metricInfo.label} yet. Five coefficients want
                more than five points — and they want some <em>rectangles</em>: where m = n,
                <code> m+n</code> is exactly <code>2·pairs</code>, so a shelf of squares alone
                has no unique answer to give. Sweep more sizes at{" "}
                <a href="../gpu/">/mxn/gpu/</a>, or load the censuses if this metric needs them.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * One k, drawn at every size that has it.
 *
 * The panel the grid's numbers are an abstraction of. A row of the grid says
 * that k = 1 needs 10px at 1x1 and 200px at 4x4; this says what those two rings
 * actually look like, side by side, and the shape changing along the row is the
 * thing "how a k behaves as m and n grow" was always about.
 *
 * Each tile is framed to its own ring rather than to a shared scale. A 4x4 is
 * four times the span of a 1x1 and normalising them together would leave the
 * small ones as dots; what changes along the row is the shape, and the numbers
 * under each tile carry the size.
 */
function ContactSheet({
  k, rows, geometry, drawing, onDraw, metric, valueOf, selected, onPick,
}: {
  k: number;
  rows: AtlasRecord[];
  geometry: Record<string, Stage[] | null>;
  drawing: Set<string>;
  onDraw: (records: AtlasRecord[]) => void;
  metric: { key: Metric; label: string; unit: string };
  valueOf: (record: AtlasRecord, which: Metric) => number;
  selected: string | null;
  onPick: (id: string) => void;
}) {
  const asked = rows.filter(row => row.runKey in geometry);
  const busy = rows.some(row => drawing.has(row.runKey));

  return (
    <section className="atlas-panel">
      <h2>B · k = {k > 0 ? `+${k}` : k}, drawn at every size</h2>
      {!rows.length ? (
        <p className="atlas-empty">
          Nothing on the shelf at k = {k}. Pick a cell in the grid whose k has some sizes.
        </p>
      ) : (
        <>
          <p className="atlas-note">
            The rings the engine settled on, at this one k, across every size that has been
            swept. Each is framed to itself — a 4×4 spans four times a 1×1 and a shared scale
            would leave the small ones as dots — so what to read along the row is the{" "}
            <em>shape</em>, with the size and the {metric.label} underneath.
          </p>
          {asked.length < rows.length && (
            <button
              type="button" className="atlas-go" disabled={busy}
              onClick={() => onDraw(rows)}
            >
              {busy ? "reading the rings…" : `draw all ${rows.length} sizes`}
            </button>
          )}
          <div className="atlas-sheet">
            {rows.map(row => {
              const stages = geometry[row.runKey];
              const id = cellId(row.m, row.n, row.k);
              const value = valueOf(row, metric.key);
              // The final stage is the ring at this record's level — the one the
              // grid's number describes.
              const stage = stages?.find(s => s.level === row.level) ?? stages?.at(-1);
              return (
                <button
                  key={id} type="button"
                  className={`atlas-sheet-cell ${selected === id ? "is-on" : ""}`}
                  onClick={() => onPick(id)}
                  title={`${row.m}×${row.n} k=${row.k} · L${row.level}`}
                >
                  {stage
                    ? <Ring stage={stage} bounds={allBounds([stage])} size={116} />
                    : (
                      <span className="atlas-sheet-blank">
                        {drawing.has(row.runKey) ? "…"
                          : row.runKey in geometry ? "no geometry" : "not drawn"}
                      </span>
                    )}
                  <b>{row.m}×{row.n}</b>
                  <i>
                    {Number.isFinite(value)
                      ? `${fmt(value, metric.key === "validSpan" ? 1 : 0)}${metric.unit}`
                      : "—"}
                  </i>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function Prediction({
  metric, prediction, m, n, k, sweptStep, budget,
}: {
  metric: { key: Metric; label: string; unit: string };
  prediction: { value: number; lo: number; hi: number; extrapolated: boolean; beyond: number } | null;
  m: number; n: number; k: number;
  /** The step the shelf's own runs were swept at, as their key spells it. */
  sweptStep: number | "auto";
  budget: number;
}) {
  if (!prediction) return null;
  const admits = kLimits(m, n);
  const outOfBand = k < admits.min || k > admits.max;
  const pairs = worstPairs(m, n);
  const { step, resolved } = sweptGridStep(sweptStep, pairs, budget);
  const saving = metric.key === "validSpan"
    ? null
    : ceilingSaving(pairs, step, Math.ceil(prediction.hi / step) * step);

  return (
    <div className="atlas-predict-out">
      <div className="atlas-stats">
        <div className="atlas-stat">
          <span>{metric.label}</span>
          <strong>{fmt(prediction.value, 1)}{metric.unit}</strong>
          <em>{fmt(prediction.lo, 1)} … {fmt(prediction.hi, 1)}{metric.unit}</em>
        </div>
        <div className="atlas-stat">
          <span>pairs · step</span>
          <strong>{pairs} · {step}</strong>
          <em>
            max(m,n), and{" "}
            {resolved
              ? `the step auto resolves to at budget ${budget.toLocaleString()}`
              : "the step these answers were swept at"}
          </em>
        </div>
        {saving && (
          <div className="atlas-stat">
            <span>combos saved</span>
            <strong>{saving.factor >= 1.05 ? `${saving.factor.toFixed(1)}×` : "—"}</strong>
            <em>
              {saving.now.toLocaleString()} at {MAX_PAIR_EXTENSION}px →{" "}
              {saving.proposed.toLocaleString()} at the top of the interval
            </em>
          </div>
        )}
      </div>
      {outOfBand && (
        <span className="atlas-flag">
          {m}×{n} does not admit k = {k} — it admits {admits.min}…{admits.max}
        </span>
      )}
      {prediction.extrapolated ? (
        <span className="atlas-flag">
          extrapolated · {prediction.beyond} pair{prediction.beyond === 1 ? "" : "s"} past anything measured
        </span>
      ) : (
        <span className="atlas-flag is-calm">inside the measured range</span>
      )}
      {metric.key !== "validSpan" && prediction.hi > MAX_PAIR_EXTENSION && (
        <span className="atlas-flag">
          the interval runs past MAX_PAIR_EXTENSION ({MAX_PAIR_EXTENSION}px) — at this size the
          grid is the binding constraint, not the guess
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CellPanel({
  record, others, h, v, stages, drawing,
}: {
  record: AtlasRecord | null;
  others: AtlasRecord[];
  h: BandStat | undefined;
  v: BandStat | undefined;
  /** undefined = not asked yet, null = asked and this shelf has none. */
  stages: Stage[] | null | undefined;
  drawing: boolean;
}) {
  if (!record) {
    return (
      <section className="atlas-panel">
        <h2>D · The cell</h2>
        <p className="atlas-empty">Pick a cell in the grid.</p>
      </section>
    );
  }
  const ks = record.ks.join(" ");
  return (
    <section className="atlas-panel">
      <h2>
        D · {record.m}×{record.n} · k = {record.k} · L{record.level}
      </h2>
      <p className="atlas-note">
        From <code>{record.runKey}</code>, computed {record.computedAt.slice(0, 10)} in{" "}
        {record.seconds}s. {record.across}/{record.expected} crossings, {record.masks} masks,{" "}
        {record.healthy ? "the ring closed" : <b>the ring did not close</b>}.{" "}
        <a href={`../?m=${record.m}&n=${record.n}&ks=${encodeURIComponent(ks)}`}>
          open in the lab →
        </a>
        {others.length > 0 && ` · ${others.length} more record${others.length === 1 ? "" : "s"} in this cell`}
      </p>

      {record.degenerate && (
        <p className="atlas-note">
          <b>This k searched nothing.</b> Both bands came back with no extensions at all — for{" "}
          <code>k = 0</code> that is the continuation being preserved, and elsewhere it is a level
          that solved without a search. Either way there is one configuration and nothing to
          choose between, so there is no ceiling and no angle range here, and this cell is left
          out of the fits rather than counted as a zero.
        </p>
      )}
      <h3 style={{ margin: 0, font: "800 10px/1 monospace", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>
        every level of this sequence
      </h3>
      {stages?.length ? (
        <>
          <div className="atlas-strip">
            {stages.map(stage => (
              <Ring
                key={stage.level}
                stage={stage}
                // Framed to the LAST stage throughout, so the rings grow across
                // the strip instead of each being blown up to fill its own tile.
                // Here that is the point: the sequence is the subject.
                bounds={allBounds(stages)}
                size={132}
                label={`L${stage.level}${stage.k === null ? "" : ` · k = ${stage.k}`}`}
              />
            ))}
          </div>
          <p className="atlas-note">
            {record.ks.length > 1
              ? <>The whole <code>ks = {ks}</code> sequence, L0 upwards, on one frame so the
                growth is to scale. This is what the sidebar means by a k at level 2 or above
                being conditioned on the prefix that reached it — L{record.level} here is what
                it is <em>because</em> of the levels to its left.</>
              : <>One k, so two frames: the starting stitch and what k = {record.k} made of it.
                Sweep a sequence at <a href="../gpu/">/mxn/gpu/</a> to see ks compound.</>}
          </p>
        </>
      ) : (
        <RingNote
          state={drawing ? "loading" : stages === null ? "missing" : "idle"}
          what={`${record.m}×${record.n} k = ${record.k}`}
        />
      )}

      <h3 style={{ margin: 0, font: "800 10px/1 monospace", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>
        the extensions it chose
      </h3>
      <div className="atlas-bars">
        {([["H", record.hExt, h], ["V", record.vExt, v]] as const).map(([label, ext, stat]) => (
          ext.length ? ext.map((value, index) => (
            <div className="atlas-bar" key={`${label}${index}`}>
              <span>{label} pair {index + 1}</span>
              <span className="atlas-bar-track">
                <i className="atlas-bar-fill" style={{ width: `${(value / MAX_PAIR_EXTENSION) * 100}%` }} />
                {isMeasured(stat) && (
                  <i
                    className="atlas-bar-need"
                    style={{ left: `${(stat.extCeilingNeeded / MAX_PAIR_EXTENSION) * 100}%` }}
                    title={`${stat.extCeilingNeeded}px is the smallest ceiling this band still works at`}
                  />
                )}
              </span>
              <span>{value}px</span>
            </div>
          )) : (
            <div className="atlas-bar" key={label}>
              <span>{label}</span>
              <span className="atlas-bar-track" />
              <span>none</span>
            </div>
          )
        ))}
      </div>
      <p className="atlas-note">
        Bars run against the full 0…{MAX_PAIR_EXTENSION}px grid the search walks. The red rule is
        the smallest ceiling that band still finds a valid ring at — everything to its right is
        grid the search paid for and did not need. H searches {bandPairs("h", record.m, record.n)}{" "}
        pairs and V searches {bandPairs("v", record.m, record.n)}.
      </p>

      {(["h", "v"] as Band[]).map(band => {
        const stat = band === "h" ? h : v;
        return (
          <div key={band} style={{ display: "grid", gap: 8 }}>
            <h3 style={{ margin: 0, font: "800 10px/1 monospace", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>
              {band === "h" ? "horizontal" : "vertical"} band
            </h3>
            {!stat && <p className="atlas-empty">census not loaded</p>}
            {stat?.state === "unavailable" && (
              <p className="atlas-empty">
                unavailable — {stat.reason}
                {stat.combos ? ` (${stat.combos.toLocaleString()} combos)` : ""}
              </p>
            )}
            {isMeasured(stat) && <BandView stat={stat} />}
          </div>
        );
      })}
    </section>
  );
}

function BandView({ stat }: { stat: Extract<BandStat, { state: "measured" }> }) {
  // One track wide enough to hold both the window and the valid union, since
  // neither contains the other: the window is the probe combo's, and every
  // other combo's has moved.
  //
  // The window can be missing — a census can survive a plan that did not — and
  // one NaN here would put every percentage on the track at NaN, so the valid
  // range stands in rather than propagating.
  const hasWindow = Number.isFinite(stat.windowLo) && Number.isFinite(stat.windowHi);
  const lo = hasWindow ? Math.min(stat.windowLo, stat.validLo) : stat.validLo;
  const hi = hasWindow ? Math.max(stat.windowHi, stat.validHi) : stat.validHi;
  const span = hi - lo || 1;
  const pct = (value: number) => `${((value - lo) / span) * 100}%`;
  const width = (a: number, b: number) => `${((b - a) / span) * 100}%`;
  const totalCounts = stat.counts.reduce((sum, value) => sum + value, 0);

  return (
    <>
      <div className="atlas-stats">
        <div className="atlas-stat">
          <span>needed ceiling</span>
          <strong>{stat.extCeilingNeeded}px</strong>
          <em>cheapest valid combo's worst pair</em>
        </div>
        <div className="atlas-stat">
          <span>angle span</span>
          <strong>{stat.validSpan}°</strong>
          <em>{stat.validLo}° … {stat.validHi}°</em>
        </div>
        <div className="atlas-stat">
          <span>combos that work</span>
          <strong>{stat.combosValid.toLocaleString()}</strong>
          <em>of {stat.combos.toLocaleString()} · {((stat.combosValid / stat.combos) * 100).toFixed(1)}%</em>
        </div>
        <div className="atlas-stat">
          <span>in window</span>
          <strong>{(stat.inWindowShare * 100).toFixed(0)}%</strong>
          <em>the rest is the census's ±40° over-sweep</em>
        </div>
      </div>

      <div className="atlas-ruler">
        <div className="atlas-ruler-track">
          {hasWindow && (
            <i
              className="atlas-ruler-window"
              style={{ left: pct(stat.windowLo), width: width(stat.windowLo, stat.windowHi) }}
              title={`the probe combo's ±20° window: ${stat.windowLo}° … ${stat.windowHi}°`}
            />
          )}
          <i
            className="atlas-ruler-valid"
            style={{ left: pct(stat.validLo), width: width(stat.validLo, stat.validHi) }}
            title={`valid across every combo: ${stat.validLo}° … ${stat.validHi}°`}
          />
          {Number.isFinite(stat.bestLo) && (
            <i className="atlas-ruler-best" style={{ left: pct(stat.bestLo) }} title={`ranked picks from ${stat.bestLo}°`} />
          )}
          {Number.isFinite(stat.bestHi) && (
            <i className="atlas-ruler-best" style={{ left: pct(stat.bestHi) }} title={`ranked picks to ${stat.bestHi}°`} />
          )}
        </div>
        <div className="atlas-ruler-scale">
          <span>{lo.toFixed(0)}°</span>
          <span>grey = the probe's window · acid = valid anywhere · red = the ranked pick</span>
          <span>{hi.toFixed(0)}°</span>
        </div>
      </div>

      {totalCounts > 0 && (
        <>
          <div className="atlas-hist">
            {stat.counts.map((count, index) => (
              count > 0 ? (
                <i
                  key={VERDICT_NAMES[index]}
                  style={{ width: `${(count / totalCounts) * 100}%`, background: VERDICT_COLOUR[index] }}
                  title={`${VERDICT_NAMES[index]} · ${count.toLocaleString()}`}
                />
              ) : null
            ))}
          </div>
          <div className="atlas-hist-key">
            {stat.counts.map((count, index) => (
              count > 0 ? (
                <span key={VERDICT_NAMES[index]}>
                  <b style={{ color: VERDICT_COLOUR[index] }}>■</b> {VERDICT_NAMES[index]}{" "}
                  {((count / totalCounts) * 100).toFixed(1)}%
                </span>
              ) : null
            ))}
          </div>
        </>
      )}
    </>
  );
}
