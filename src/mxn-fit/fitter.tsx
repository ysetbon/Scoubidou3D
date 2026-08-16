"use client";

// The fitter, at /mxn/fit/. See docs/mxn-fit.md.
//
// Run, fit, sort, export. The engine is the lab's own — the same Pyodide worker
// under public/mxn/exact-worker.js, asked two new questions (fit-plan,
// fit-weave) — and the solving happens here, in the page, because it is a
// division per pair rather than a search.
//
// The one rule this page holds itself to: EVERY NUMBER IS MEASURED OFF THE RING
// IT IS DRAWN BESIDE. Arm lengths come from the strands the engine returned,
// through the same `hypot` a reader could do by hand, not from the extension
// and heading that were asked for. The two agree to 1e-13 (scripts/check-fit.py
// checks exactly that), and when they ever stop agreeing the page should say
// what is on screen rather than what it ordered.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  allBounds, drawExactStage, type Bounds, type Stage, type Strand,
} from "../mxn-lab/weave-studio";
import { saveJson, today } from "../mxn-lab/save-file";
import {
  VALID, VERDICT_NAMES, placeStarts, sweepAngle,
} from "../mxn-lab/trace-census";
import {
  CACHE_TOKEN_KEY, CACHE_URL_KEY, CACHE_VERSION, createCache, mergeJudgement, picksKey,
  readSetting, writeSetting,
  type Judgement, type PickBand, type PicksArtifact, type RunDescriptor,
  type Verdict,
} from "../mxn-lab/cache";
import {
  EXT_MAX, FLUSH_EPS, bySortKey, fitCandidates, fixOthers, followPair, isFlush,
  neighbourDelta, readAt, spread,
  type Candidate, type FitBand, type SortKey,
} from "./solve";

const BASE = import.meta.env.BASE_URL;

type BandKey = "h" | "v";
const BANDS: BandKey[] = ["h", "v"];
const BAND_NAME = { h: "horizontal", v: "vertical" } as const;

type Plan = { level: number; k: number; m: number; n: number;
              hand: string; direction: string; h: FitBand; v: FitBand };

/** One row of the engine's own audit, as `generate` and `fit_weave` report it. */
type AuditRow = {
  level: number; k: number | null; expected: number; across: number;
  within: number; masks: number; stray: number; broken: number;
  healthy: boolean; ext: number[][];
};

type Woven = {
  level: number; unavailable?: boolean; reason?: string;
  h: { ext: number[]; angle: number | null };
  v: { ext: number[]; angle: number | null };
  crossings: number;
  row: AuditRow;
  strands: Strand[];
};

/**
 * The heading a band was actually drawn at, off its first arm.
 *
 * `bridge.fit_plan` reports the adopted angle only where the level kept a
 * candidate list, and a seeded level — which is most levels above the first —
 * keeps none. The ring itself always knows: arm 0 is never one of the reversed
 * ones, so the direction it is drawn in IS the band's heading. Recovering it
 * this way is what lets the page hold a band exactly where the engine left it
 * on a level that cannot say where that was.
 */
function heading(strands: Strand[], names: string[]) {
  const first = strands.find(s => s.layer_name === names[0]);
  if (!first) return null;
  return (Math.atan2(first.end.y - first.start.y,
                     first.end.x - first.start.x) * 180) / Math.PI;
}

/** Arm lengths, off the ring as drawn. The only place a length is produced. */
function measure(strands: Strand[], names: string[]) {
  const by = new Map(strands.map(s => [s.layer_name, s]));
  const out: number[] = [];
  for (const name of names) {
    const s = by.get(name);
    if (!s) return [];
    out.push(Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y));
  }
  return out;
}

/** A row of the solutions table: a flush candidate, or the engine's own ring. */
type Row = {
  source: "fit" | "engine";
  ext: number[];
  angle: number;
  lengths: number[];
  margin: number;
  totalExt: number;
  order: number;
};

/** One attempt at a fitted ring, and what the engine's audit said about it. */
type Attempt = {
  h: Candidate | null;
  v: Candidate | null;
  woven: Woven;
  lengths: Record<BandKey, number[]>;
  accepted: boolean;
};

/** The judgements for one parameter set, and which stores answered for them. */
type Picks = { judgements: Judgement[]; from: string; reached: boolean };

/**
 * Where the ring in the "after" card came from.
 *
 * The card used to be captioned `fitted` whatever produced it, which stopped
 * being true the moment a person's ★ best could be what loaded: three very
 * different provenances were all being called the same thing.
 */
type Origin =
  | { kind: "judged"; verdict: Verdict; chooser: string; from: string }
  | { kind: "walk"; woven: number }
  | { kind: "manual" };

const VERDICT_GLYPH: Record<Verdict, string> = {
  best: "★", valid: "✓", rejected: "✗",
};

const ksOf = (raw: string) => raw.replace(/[[\],]/g, " ").trim().split(/\s+/)
  .map(Number).filter(Number.isInteger);

/**
 * The flags the fitter's own generate runs under. It sends none, so these are
 * the engine's defaults — spelled out here because they are part of the cache
 * key a judgement is saved beneath, and a judgement addressed to a different
 * search would be a judgement about a different ring.
 */
const DESCRIPTOR_FLAGS = { shortArms: true, step: "auto" as const, budget: 400_000 };

/** Where a person's judgements are held before (and beside) any network. */
const JUDGEMENTS_KEY = "mxn-fit-judgements";
const CHOOSER_KEY = "mxn-fit-chooser";

/** One band's manual configuration: the knobs, as the hand left them. */
type ManualBand = { ext: number[]; angle: number };

/** One colour per pair, so a slider and the arms it moves read as one thing. */
const PAIR_COLOURS = ["#276b72", "#924ab0", "#e28a1c", "#3474c4", "#c63c28", "#3a9c58"];

/** A pair's hex colour, in the RGBA shape the exact renderer speaks. */
const rgbaOf = (hex: string) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
  a: 255,
});

/**
 * The manual panel's own diagram: the REAL ring, with the band's arms moved to
 * where the knobs place them.
 *
 * This is `drawExactStage` — the renderer every ring card and `/mxn/` itself
 * draw with — handed the engine's own strands, except that the manual band's
 * arms are repositioned by the same `placeStarts`/`sweepAngle` arithmetic the
 * readouts are measured by. Bodies, outlines, end caps and the crossing masks
 * are all the real thing (a mask is an intersection of its two strands, so it
 * follows the moved arms by construction); the manual band is tinted one colour
 * per pair so a slider and the arms it moves read as one thing. On top: each
 * arm's target ringed, and any shortfall drawn as a dashed red line — the REACH
 * verdict drawn rather than only named.
 */
/** One band as the diagram should place it. `focus` is the band being edited. */
type FigureBand = { inputs: FitBand; ext: number[]; angle: number; focus: boolean };

/**
 * The ring with EVERY manually-placed band moved, not just the one on screen.
 *
 * The bands are edited one at a time but they close jointly, so a diagram that
 * showed only the selected band's knobs would redraw the other band from the
 * engine's weave — silently discarding, in the picture, work a hand had
 * already done. Switching bands would then appear to undo the previous band's
 * fit. So each band is placed from its own knobs here, and only the tinting
 * distinguishes them: the focused band takes the per-pair colours and the
 * target rings, the other keeps the strand colours it was drawn in.
 */
function drawManualRing(canvas: HTMLCanvasElement, bands: FigureBand[],
                        stage: Stage, bounds: Bounds) {
  const moved = new Map<string, { start: { x: number; y: number };
                                  end: { x: number; y: number };
                                  colour: ReturnType<typeof rgbaOf> | null }>();
  let focus: { inputs: FitBand; swept: ReturnType<typeof sweepAngle> } | null = null;
  for (const band of bands) {
    const starts = placeStarts(band.inputs, band.ext);
    const swept = sweepAngle(band.inputs, starts, band.angle);
    if (band.focus) focus = { inputs: band.inputs, swept };
    band.inputs.pairIndices.forEach(([li, ri], p) => {
      const colour = band.focus
        ? rgbaOf(PAIR_COLOURS[p % PAIR_COLOURS.length]) : null;
      for (const arm of [li, ri]) {
        if (arm === null || arm === undefined) continue;
        moved.set(band.inputs.names[arm], {
          start: { x: starts[arm][0], y: starts[arm][1] },
          end: { x: swept.ends[arm][0], y: swept.ends[arm][1] },
          colour,
        });
      }
    });
  }
  const strands = stage.strands.map(strand => {
    const to = moved.get(strand.layer_name);
    if (!to) return strand;
    return { ...strand, start: to.start, end: to.end,
             ...(to.colour ? { color: to.colour } : {}) };
  });
  drawExactStage(canvas, { ...stage, label: "manual", strands }, bounds, false);

  // The overlay shares drawExactStage's own transform (same pad, same fit), so
  // the rings and shortfall lines land exactly on the strands it just drew.
  const ctx = canvas.getContext("2d");
  if (!ctx || !focus) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const pad = 8;
  const sourceWidth = Math.max(1, bounds.maxX - bounds.minX);
  const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.max(0.001, Math.min(
    Math.max(1, width - pad * 2) / sourceWidth,
    Math.max(1, height - pad * 2) / sourceHeight));
  const offsetX = (width - sourceWidth * scale) / 2 - bounds.minX * scale;
  const offsetY = (height - sourceHeight * scale) / 2 - bounds.minY * scale;
  const at = (x: number, y: number) => [x * scale + offsetX, y * scale + offsetY] as const;

  const widthOf = new Map(stage.strands.map(s => [s.layer_name, s.width]));
  const { inputs, swept } = focus;
  inputs.pairIndices.forEach(([li, ri], p) => {
    const colour = PAIR_COLOURS[p % PAIR_COLOURS.length];
    for (const arm of [li, ri]) {
      if (arm === null || arm === undefined) continue;
      const [ex, ey] = swept.ends[arm];
      const [tx, ty] = inputs.targets[arm];
      const bodyWidth = (widthOf.get(inputs.names[arm]) ?? 40) * scale;
      if (Math.hypot(ex - tx, ey - ty) > 2) {
        ctx.beginPath();
        ctx.moveTo(...at(ex, ey));
        ctx.lineTo(...at(tx, ty));
        ctx.strokeStyle = "rgba(228, 81, 63, .85)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      const [cx, cy] = at(tx, ty);
      ctx.arc(cx, cy, Math.max(3, bodyWidth * 0.35), 0, Math.PI * 2);
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });
}

function ManualFigure({ bands, stage, bounds, caption }: {
  bands: FigureBand[]; stage: Stage | null; bounds: Bounds | null;
  caption: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !stage || !bounds || !bands.length) return;
    const draw = () => drawManualRing(canvas, bands, stage, bounds);
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [bands, stage, bounds]);
  return (
    <figure className="ring mfig">
      <figcaption><span>the ring, as the knobs place it</span><var>{caption}</var></figcaption>
      <canvas ref={ref} role="img" aria-label="manual ring diagram" />
    </figure>
  );
}

function useWorker() {
  const ref = useRef<Worker | null>(null);
  const waiting = useRef(new Map<number, {
    resolve: (value: any) => void; reject: (error: Error) => void; type: string;
  }>());
  const next = useRef(1);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    const worker = new Worker(new URL(`${BASE}mxn/exact-worker.js`, window.location.href),
                              { type: "module" });
    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === "progress") { setProgress(String(data.message ?? "")); return; }
      const held = waiting.current.get(data.id);
      if (!held) return;
      if (data.type === "error") {
        waiting.current.delete(data.id);
        held.reject(new Error(data.message || "the engine failed"));
        return;
      }
      if (data.type !== held.type) return;      // an interim message, not the reply
      waiting.current.delete(data.id);
      held.resolve(data.type === "result" ? data.result : data);
    };
    ref.current = worker;
    return () => { worker.terminate(); ref.current = null; };
  }, []);

  const ask = useCallback((message: Record<string, unknown>, replyType: string) => {
    const worker = ref.current;
    if (!worker) return Promise.reject(new Error("the engine is not running"));
    const id = next.current;
    next.current += 1;
    return new Promise<any>((resolve, reject) => {
      waiting.current.set(id, { resolve, reject, type: replyType });
      worker.postMessage({ ...message, id });
    });
  }, []);

  return { ask, progress };
}

function RingFigure({ title, stage, bounds, caption }: {
  title: string; stage: Stage | null; bounds: Bounds | null; caption: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !stage || !bounds) return;
    const draw = () => drawExactStage(canvas, stage, bounds, false);
    draw();
    // The canvas is sized in CSS, so a column that reflows has to redraw or the
    // ring is stretched. Same move the lab's own cards make.
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [stage, bounds]);
  return (
    <figure className="ring">
      <figcaption><span>{title}</span><var>{caption}</var></figcaption>
      <canvas ref={ref} role="img" aria-label={`${title} ring`} />
    </figure>
  );
}

function LengthBars({ before, after }: { before: number[]; after: number[] }) {
  // A broken axis, and it says so: a 12px stagger on a 230px arm is invisible
  // from zero, and the stagger is the whole subject.
  const all = before.concat(after).filter(Number.isFinite);
  if (!all.length) return null;
  const lo = Math.floor(Math.min(...all) - 4);
  const hi = Math.ceil(Math.max(...all) + 4);
  const at = (v: number) => `${(100 * (v - lo)) / (hi - lo)}%`;
  return (
    <div className="bars">
      <div className="bar"><i>arm</i><i>{lo}–{hi} px, not from zero</i><i /></div>
      {after.map((value, index) => (
        <div className="bar" key={index}>
          <i>#{index + 1}</i>
          <span>
            {before[index] !== undefined && (
              <u className="before" style={{ width: at(before[index]) }} />
            )}
            <u style={{ width: at(value) }} />
          </span>
          <b>{value.toFixed(2)}</b>
        </div>
      ))}
    </div>
  );
}

export function Fitter() {
  const { ask, progress } = useWorker();
  const [m, setM] = useState(2);
  const [n, setN] = useState(1);
  const [ksText, setKsText] = useState("1");
  const [hand, setHand] = useState<"lh" | "rh">("lh");
  const [direction, setDirection] = useState<"cw" | "ccw">("cw");
  const [sortKey, setSortKey] = useState<SortKey>("delta");
  const [band, setBand] = useState<BandKey>("v");

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  // Every level the run drew, which is what the page is really about: a stitch
  // is a stack of rings, and fitting one of them moves the one underneath.
  const [stages, setStages] = useState<Stage[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [fitLevel, setFitLevel] = useState(1);
  const [mismatch, setMismatch] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [before, setBefore] = useState<{ stage: Stage; lengths: Record<BandKey, number[]>;
                                         woven: Woven } | null>(null);
  const [after, setAfter] = useState<Attempt | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [picks, setPicks] = useState<Picks>({ judgements: [], from: "", reached: true });
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [candidates, setCandidates] = useState<Record<BandKey, Candidate[]>>(
    { h: [], v: [] });

  // The manual fit: the knobs, per band, and what weaving them said. `held` is
  // where the engine left each band — the value an untouched band is woven at,
  // and the value the knobs are reset to.
  const [held, setHeld] = useState<Record<BandKey, ManualBand | null>>({ h: null, v: null });
  const [manual, setManual] = useState<Record<BandKey, ManualBand | null>>({ h: null, v: null });
  const [touched, setTouched] = useState<Record<BandKey, boolean>>({ h: false, v: false });
  const [follow, setFollow] = useState(true);
  const [anchor, setAnchor] = useState<Record<BandKey, number>>({ h: 0, v: 0 });
  const [followNote, setFollowNote] = useState("");
  const [manualWoven, setManualWoven] = useState<Attempt | null>(null);

  // Everything the run drew, L0 included: the solutions row a judgement writes
  // stores the parent ring beside the judged one, and L1's parent is L0.
  const [allStages, setAllStages] = useState<Stage[]>([]);
  const [ranAt, setRanAt] = useState<string | null>(null);

  // The shelf. Same Worker, same two localStorage fields as the lab sidebar.
  const [apiUrl, setApiUrl] = useState(() => readSetting(CACHE_URL_KEY));
  const [apiToken, setApiToken] = useState(() => readSetting(CACHE_TOKEN_KEY));
  const [chooser, setChooser] = useState(() => readSetting(CHOOSER_KEY));
  const [judgeNote, setJudgeNote] = useState("");

  const ks = useMemo(() => ksOf(ksText), [ksText]);

  /**
   * The engine's browsing session for the run on screen.
   *
   * `generate` leaves each level's checkpoint, candidate lists and band inputs
   * in the worker's Python, and every fit call reads them: without that state
   * `bridge.fit_plan` raises "level N has no browsing session; run generate
   * first". A cached run artifact restores what a run RETURNED — the stages and
   * the audit rows, JSON — and not what it LEFT BEHIND, so a cache hit has to
   * open a session of its own before anything can be fitted.
   *
   * Held as a promise rather than awaited on the spot so the cached levels are
   * drawn straight away and the engine boots behind them; `fitAt` is the one
   * that waits, because it is the one that needs it.
   */
  const session = useRef<{ ready: Promise<unknown>; primed: boolean } | null>(null);

  /**
   * Open a session for `d`, or adopt the one a generate already in flight is
   * opening. Returns the same promise either way, so the caller that ran the
   * generate can still read its result.
   */
  const openSession = (d: RunDescriptor, running?: Promise<unknown>) => {
    const ready = running ?? ask(
      { type: "generate", m: d.m, n: d.n, ks: d.ks, hand: d.hand, direction: d.direction },
      "result");
    const entry = { ready, primed: false };
    session.current = entry;
    // A failed generate leaves no session, so it must not be remembered as one:
    // the next run gets to try again rather than inheriting the wreck. The
    // handler is also what keeps a background failure from surfacing as an
    // unhandled rejection — whoever awaits `ready` reports it.
    ready.then(
      () => { entry.primed = true; },
      () => { if (session.current === entry) session.current = null; },
    );
    return ready;
  };

  /**
   * Every judgement anyone has made about this parameter set.
   *
   * Read from the Cloudflare shelf when a Worker is configured, and either way
   * folded together with this browser's own local judgements — the local copy
   * is written first on every save, so it can hold a decision the shelf never
   * received. mergeJudgement holds the invariants while folding, so at most one
   * `best` survives and a rejected best never comes back. Neither store being
   * reachable is not an error: a fit must never be blocked by the database
   * being away, so an unreachable shelf reads as "no judgements there".
   */
  const loadPicks = async (): Promise<Picks> => {
    const d: RunDescriptor = { m, n, ks, hand, direction, ...DESCRIPTOR_FLAGS };
    let artifact: PicksArtifact | null = null;
    let from = "this browser";
    let reached = !apiUrl.trim();
    if (apiUrl.trim()) {
      try {
        artifact = await createCache({ base: apiUrl.trim(), token: apiToken.trim() })
          .getPicks(d);
        reached = true;
        if (artifact) from = "Cloudflare";
      } catch { /* the shelf being away must not block the fit */ }
    }
    try {
      const key = `picks/${picksKey(d)}`;
      const rows = JSON.parse(readSetting(JUDGEMENTS_KEY) || "[]") as
        { key: string; judgement: Judgement }[];
      for (const row of rows) {
        if (row.key !== key) continue;
        artifact = mergeJudgement(artifact, row.judgement, d);
        if (from !== "Cloudflare") from = "this browser";
        else from = "Cloudflare and this browser";
      }
    } catch { /* a torn local store reads as no judgements, not as an error */ }
    return { judgements: artifact?.judgements ?? [], from, reached };
  };

  /**
   * Fit one level of the stitch that is already in the worker's session.
   *
   * Separate from the run because a run is expensive and a level is not: the
   * session survives, so any level can be fitted, and re-fitted, without the
   * engine being asked to think again.
   */
  const fitAt = async (target: number, drawn: Stage[], audits: AuditRow[]) => {
    const stage = drawn.find(s => s.level === target);
    if (!stage) { setStatus(`the run came back without an L${target}`); setFailed(true); return; }
    setBusy(true);
    setFailed(false);
    setFitLevel(target);
    setPlan(null); setBefore(null); setAfter(null); setAttempts([]); setMismatch("");
    setOrigin(null);
    setHeld({ h: null, v: null }); setManual({ h: null, v: null });
    setTouched({ h: false, v: false }); setAnchor({ h: 0, v: 0 });
    setFollowNote(""); setManualWoven(null);
    try {
      const level = target;
      // Everything below asks the engine about a session `generate` opened. A
      // run served from the cache drew its diagrams without one, so the wait
      // happens here — and says so, because on a cache hit it is the whole of
      // what the reader is waiting for.
      const engine = session.current;
      if (engine && !engine.primed) {
        setStatus("The cached run is drawn; waiting for the engine to open the "
          + "browsing session that fitting reads…");
      }
      await engine?.ready;
      setStatus(`Reading L${level}'s two bands…`);
      const got: Plan = await ask({ type: "fit-plan", level }, "fit-plan-ready");
      setPlan(got);

      // "Before" is the engine's own ring, drawn from the run, and its lengths
      // are measured off it — no second weave and no recomputation.
      const beforeLengths = {
        h: got.h?.unavailable ? [] : measure(stage.strands, got.h.names),
        v: got.v?.unavailable ? [] : measure(stage.strands, got.v.names),
      };
      // Where the engine left each band, recovered from the ring it drew. This
      // is what a band that is NOT being fitted is held at. Holding it by
      // passing null instead would apply nothing at all on a seeded level, and
      // the ring would be audited unaligned — 6 crossings of 8 on a 2×1's L2,
      // against the 8 the engine actually produced.
      const held: Record<BandKey, { ext: number[]; angle: number } | null> =
        { h: null, v: null };
      for (const key of BANDS) {
        const inputs = got[key];
        if (!inputs || inputs.unavailable) continue;
        const angle = heading(stage.strands, inputs.names) ?? inputs.appliedAngle;
        if (angle !== null) held[key] = { ext: inputs.applied, angle };
      }
      setHeld(held);
      // The manual knobs open where the engine left the bands, so the first
      // drag is a change to a real ring rather than to an arbitrary zero.
      setManual({
        h: held.h ? { ext: [...held.h.ext], angle: held.h.angle } : null,
        v: held.v ? { ext: [...held.v.ext], angle: held.v.angle } : null,
      });
      const baseline = await ask({
        type: "fit-weave", level,
        hExt: held.h?.ext ?? null, hAngle: held.h?.angle ?? null,
        vExt: held.v?.ext ?? null, vAngle: held.v?.angle ?? null,
      }, "fit-weave-ready") as Woven;
      setBefore({ stage, lengths: beforeLengths, woven: baseline });

      // The baseline is the engine's own configuration, put back through the
      // engine — so it has to come out as the engine's own ring. If it does
      // not, the page is holding the bands somewhere other than where they
      // were, and every number after this is about a different ring. Said out
      // loud rather than absorbed.
      const engineRow = audits.find(r => r.level === target);
      if (engineRow && baseline.row
          && (baseline.row.across !== engineRow.across
              || baseline.row.healthy !== engineRow.healthy)) {
        setMismatch(`the ring rebuilt from L${target}'s own extensions audits `
          + `${baseline.row.across}/${baseline.row.expected}, while the run `
          + `reported ${engineRow.across}/${engineRow.expected} — treat what `
          + "follows with suspicion");
      }

      // Each band that needs fitting gets its own ordered list. A band whose
      // arms already agree is held where the engine left it: there is nothing
      // to fix, and moving it would only be a change to defend.
      const lists: Record<BandKey, Candidate[]> = { h: [], v: [] };
      for (const key of BANDS) {
        const inputs = got[key];
        if (!inputs || inputs.unavailable) continue;
        if (isFlush(beforeLengths[key])) continue;
        lists[key] = fitCandidates(inputs);
      }
      setCandidates(lists);

      // A person's word comes before any policy: if somebody has marked a
      // best ring for this parameter set — on the shelf, or in this browser's
      // own judgements — that ring is woven and audited first, and taken when
      // it still closes. Only without one (or when the stored best no longer
      // survives the audit, which is a finding worth saying) does the page
      // fall back to the default walk below.
      setStatus("Looking for a judged best fit…");
      const shelf = await loadPicks();
      setPicks(shelf);
      const best = shelf.judgements.find(j => j.verdict === "best");
      const bands = best?.levels.find(l => l.level === level);
      const pick = best && bands && (bands.h || bands.v)
        ? { h: bands.h, v: bands.v, chooser: best.chooser, from: shelf.from,
            strands: best.strands as Strand[] | undefined,
            audit: best.audit } : null;
      let pickNote = "";
      if (pick) {
        // The ring, if the judgement carried it. Re-weaving a ring somebody
        // already built is work nobody needs — the strands ARE the answer, and
        // the audit travelled with them. Judgements saved before this stored
        // no strands, so those still ask the engine.
        const stored: Woven | null = pick.strands && pick.audit
          ? {
              level,
              h: { ext: pick.h?.ext ?? [], angle: pick.h?.angle ?? null },
              v: { ext: pick.v?.ext ?? [], angle: pick.v?.angle ?? null },
              crossings: pick.audit.crossings,
              strands: pick.strands,
              row: {
                level, k: got.k, expected: pick.audit.expected,
                across: pick.audit.crossings, within: 0, masks: 0,
                stray: pick.audit.stray, broken: pick.audit.broken,
                healthy: pick.audit.crossings >= pick.audit.expected
                  && pick.audit.stray === 0 && pick.audit.broken === 0,
                ext: [],
              },
            }
          : null;
        setStatus(stored
          ? `Reading the ring ${pick.chooser} judged…`
          : `Weaving the best fit ${pick.chooser} judged…`);
        const woven = stored ?? await ask({
          type: "fit-weave", level,
          hExt: pick.h?.ext ?? held.h?.ext ?? null,
          hAngle: pick.h?.angle ?? held.h?.angle ?? null,
          vExt: pick.v?.ext ?? held.v?.ext ?? null,
          vAngle: pick.v?.angle ?? held.v?.angle ?? null,
        }, "fit-weave-ready") as Woven;
        const lengths = {
          h: got.h?.unavailable ? [] : measure(woven.strands, got.h.names),
          v: got.v?.unavailable ? [] : measure(woven.strands, got.v.names),
        };
        const ok = !!woven.row?.healthy
          && woven.row.across >= (baseline.row?.across ?? 0);
        const asCandidate = (key: BandKey): Candidate | null => {
          const inputs = got[key];
          const p = key === "h" ? pick.h : pick.v;
          if (!inputs || inputs.unavailable || !p || p.angle === null) return null;
          const r = readAt(inputs, p.ext, p.angle);
          return {
            ext: [...p.ext], angle: p.angle, star: r.lengths[0] ?? 0,
            lengths: r.lengths, gaps: r.gaps, margin: r.margin, delta: r.delta,
            totalExt: p.ext.reduce((a, b) => a + b, 0),
          };
        };
        const attempt: Attempt = {
          h: asCandidate("h"), v: asCandidate("v"), woven, lengths, accepted: ok,
        };
        setAttempts([attempt]);
        if (ok) {
          setAfter(attempt);
          setOrigin({ kind: "judged", verdict: "best", chooser: pick.chooser,
                      from: pick.from });
          setStatus(`Loaded the best fit from ${pick.from} — judged by ${pick.chooser}, `
            + `${stored ? "ring read as stored" : "re-woven"}`
            + ` (${woven.row.across}/${woven.row.expected} crossings).`);
          setBusy(false);
          return;
        }
        pickNote = `The best fit from ${pick.from} no longer survives the audit `
          + `(${woven.row?.across ?? 0}/${woven.row?.expected ?? "?"}) — fitting fresh. `;
      }

      if (!lists.h.length && !lists.v.length) {
        // Two very different reasons to have no candidates, and saying the
        // wrong one would be the page lying about the thing it is for.
        const stuck = BANDS.filter(key => !got[key]?.unavailable
          && beforeLengths[key].length && !isFlush(beforeLengths[key]));
        setStatus(pickNote + (stuck.length
          ? `${stuck.map(k => BAND_NAME[k]).join(" and ")} cannot be made flush: `
            + "every configuration that equalises its arms fails one of the "
            + "engine's own tests. The ring is unchanged."
          : beforeLengths.h.length || beforeLengths.v.length
            ? "Both bands are already flush — nothing to fit."
            : "Neither band was searched, so there is nothing to read."));
        setFailed(stuck.length > 0);
        setBusy(false);
        return;
      }

      // The walk. The bands close jointly, so a candidate is a PAIR, and the
      // engine's own audit is the acceptance test — measured, roughly one in
      // five otherwise-perfect candidates loses the ring crossings.
      const hList: (Candidate | null)[] = lists.h.length ? lists.h : [null];
      const vList: (Candidate | null)[] = lists.v.length ? lists.v : [null];
      const tried: Attempt[] = [];
      const CEILING = 24;
      let accepted: Attempt | null = null;
      outer:
      for (let i = 0; i < hList.length; i += 1) {
        for (let j = 0; j < vList.length; j += 1) {
          if (tried.length >= CEILING) break outer;
          const h = hList[i];
          const v = vList[j];
          setStatus(`Weaving candidate ${tried.length + 1}…`);
          const woven = await ask({
            type: "fit-weave", level,
            hExt: h?.ext ?? held.h?.ext ?? null,
            hAngle: h?.angle ?? held.h?.angle ?? null,
            vExt: v?.ext ?? held.v?.ext ?? null,
            vAngle: v?.angle ?? held.v?.angle ?? null,
          }, "fit-weave-ready") as Woven;
          const lengths = {
            h: got.h?.unavailable ? [] : measure(woven.strands, got.h.names),
            v: got.v?.unavailable ? [] : measure(woven.strands, got.v.names),
          };
          const ok = !!woven.row?.healthy
            && woven.row.across >= (baseline.row?.across ?? 0);
          const attempt: Attempt = { h, v, woven, lengths, accepted: ok };
          tried.push(attempt);
          setAttempts([...tried]);
          if (ok) { accepted = attempt; break outer; }
        }
      }
      setAfter(accepted);
      setOrigin(accepted ? { kind: "walk", woven: tried.length } : null);
      setStatus(pickNote + (accepted
        ? `Fitted, and the ring still closes — ${tried.length} candidate${
            tried.length === 1 ? "" : "s"} woven.`
        : `No flush ring survived the audit in ${tried.length} candidates. `
          + "The engine's own ring is unchanged."));
      setFailed(!accepted);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!ks.length) { setStatus("Give at least one k."); setFailed(true); return; }
    setBusy(true);
    setFailed(false);
    setStages([]); setPlan(null); setBefore(null); setAfter(null); setAttempts([]);
    try {
      // `generate` is the expensive half of a run — Pyodide boots and the exact
      // solver walks — and it is a pure function of the descriptor, so it is
      // exactly what a cache is for. The fitter's own descriptor is asked for
      // by key, and a MISS is written back, because the runs already on the
      // shelf were computed under different flags (`s1-e5-b100000000`) and
      // would never match the fitter's (`s1-eauto-b400000`). Without the write
      // the read could never hit and the cache would be decoration.
      const d: RunDescriptor = { m, n, ks, hand, direction, ...DESCRIPTOR_FLAGS };
      const shelf = apiUrl.trim()
        ? createCache({ base: apiUrl.trim(), token: apiToken.trim() }) : null;
      let result: { stages?: Stage[]; rows?: AuditRow[] } | null = null;
      if (shelf) {
        setStatus("Looking for a cached run…");
        try {
          const artifact = await shelf.getRun(d);
          if (artifact?.result) {
            result = artifact.result as { stages?: Stage[]; rows?: AuditRow[] };
            // The diagrams come free; the FITTING does not. The artifact holds
            // what the run returned, and fit_plan/fit_weave read what it left
            // in the engine, so the session is opened here and waited for in
            // fitAt — the levels are on screen while it boots.
            openSession(d);
            setStatus(`Cached run from ${artifact.computedAt.slice(0, 10)} — drawn without `
              + "the engine, which is now opening the session that fitting reads.");
          }
        } catch { /* a miss and an absent shelf are the same thing here */ }
      }
      if (result === null) {
        setStatus("Running the engine…");
        const began = Date.now();
        // This generate IS the session — the run and the state fitting reads
        // are the same call — so it is registered rather than repeated.
        const computed = await openSession(d) as { stages?: Stage[]; rows?: AuditRow[] };
        result = computed;
        const seconds = (Date.now() - began) / 1000;
        // Writing needs the token; reading does not. A failed write costs the
        // next run its speed-up and nothing else, so it is never fatal.
        if (shelf && apiToken.trim()) {
          try {
            await shelf.putRun({
              kind: "run", cacheVersion: CACHE_VERSION, descriptor: d,
              computedAt: new Date().toISOString(), seconds, result: computed,
            });
          } catch { /* the run is in hand; only the cache missed out */ }
        }
      }
      const payload: { stages?: Stage[]; rows?: AuditRow[] } = result;
      const drawn: Stage[] = (payload.stages ?? []).filter((s: Stage) => s.level >= 1);
      const audits: AuditRow[] = payload.rows ?? [];
      setStages(drawn);
      setAllStages(payload.stages ?? []);
      setRanAt(new Date().toISOString());
      setAuditRows(audits);
      setBusy(false);
      // The top level is the one a reader means by "the ring", so it is the one
      // fitted first; every other level is a click away.
      await fitAt(drawn.length ? drawn[drawn.length - 1].level : 1, drawn, audits);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setFailed(true);
      setBusy(false);
    }
  };

  // One frame for every card, so the levels can be read against each other:
  // a ring that grew is drawn bigger, rather than rescaled to look the same.
  const bounds = useMemo<Bounds | null>(() => {
    const all: Stage[] = [...stages];
    if (after) all.push({ level: fitLevel, k: null, label: "fitted", strands: after.woven.strands });
    if (manualWoven && manualWoven !== after) {
      all.push({ level: fitLevel, k: null, label: "manual", strands: manualWoven.woven.strands });
    }
    return all.length ? allBounds(all) : null;
  }, [stages, after, manualWoven, fitLevel]);

  const rows = useMemo<Row[]>(() => {
    const inputs = plan?.[band];
    if (!inputs || inputs.unavailable) return [];
    const list: Row[] = candidates[band].map((c, index) => ({
      source: "fit", ext: c.ext, angle: c.angle, lengths: c.lengths,
      margin: c.margin, totalExt: c.totalExt, order: index + 1,
    }));
    const engineLengths = before?.lengths[band] ?? [];
    if (engineLengths.length) {
      list.push({
        source: "engine", ext: inputs.applied, angle: inputs.appliedAngle ?? NaN,
        lengths: engineLengths, margin: NaN,
        totalExt: inputs.applied.reduce((a, b) => a + b, 0), order: 0,
      });
    }
    return list.sort(bySortKey<Row>(sortKey));
  }, [plan, band, candidates, before, sortKey]);

  const chosen = after ? (band === "h" ? after.h : after.v) : null;
  const beforeLengths = before?.lengths[band] ?? [];
  const afterLengths = after?.lengths[band] ?? [];

  // -------------------------------------------------------------------------
  // The manual fit. Every drag lands in applyManual, which is arithmetic in
  // the page: the engine is only asked when "weave and audit" is pressed.
  // -------------------------------------------------------------------------

  /**
   * Move a band's knobs. With follow on, the pair a hand moved is the anchor
   * and every other pair is re-solved to the arm length it now names — the
   * same `e = (A − L*) / B` the candidate walk inverts, anchored on a person's
   * choice. The angle knob re-solves around the last anchor, because turning
   * the heading moves both coefficients of every pair at once.
   */
  const applyManual = (key: BandKey, ext: number[], angle: number, anchorPair: number) => {
    const inputs = plan?.[key];
    if (!inputs || inputs.unavailable) return;
    let next = ext;
    let note = "";
    if (follow && inputs.P > 1) {
      const followed = followPair(inputs, ext, angle, anchorPair);
      next = followed.ext;
      if (followed.short.length) {
        note = `pair${followed.short.length > 1 ? "s" : ""} `
          + followed.short.map(p => p + 1).join(", ")
          + ` cannot reach ${followed.star.toFixed(1)} px inside 0…${EXT_MAX} px`
          + " at this heading — clamped, so the band is not flush";
      }
    }
    setManual(current => ({ ...current, [key]: { ext: next, angle } }));
    setTouched(current => ({ ...current, [key]: true }));
    setAnchor(current => ({ ...current, [key]: anchorPair }));
    setFollowNote(note);
    // The last audit was about the numbers before this drag; keeping it on
    // screen would caption one ring with another ring's verdict.
    setManualWoven(null);
  };

  const resetManual = (key: BandKey, source: "engine" | "fitted") => {
    const target = source === "fitted"
      ? (after ? (key === "h" ? after.h : after.v) : null) ?? held[key]
      : held[key];
    if (!target) return;
    setManual(current => ({ ...current, [key]: { ext: [...target.ext], angle: target.angle } }));
    setTouched(current => ({ ...current, [key]: source === "fitted" }));
    setFollowNote("");
    setManualWoven(null);
  };

  /**
   * The one-shot equaliser — the "static fix". With the coupling off, a hand
   * fixes one pair where it wants it and the other pairs stay put; when the
   * neighbour lengths disagree, this solves every OTHER pair's extension to
   * the arm length the fixed pair names — and, unlike the live coupling, it
   * answers for the geometry too. A flush solve that collides at the current
   * heading is not applied as-is: the fixed pair's extension is held exactly
   * and the heading moves the least it can to a placement where the flush
   * ring passes the geometric tests (fixOthers). Only when no heading in the
   * search window works does the plain flush answer land, said out loud.
   */
  const fixFromAnchor = (key: BandKey) => {
    const inputs = plan?.[key];
    const knobs = manual[key];
    if (!inputs || inputs.unavailable || !knobs || inputs.P < 2) return;
    const fixed = anchor[key];
    const solved = fixOthers(inputs, knobs.ext, knobs.angle, fixed);
    setManual(current => ({ ...current, [key]: { ext: solved.ext, angle: solved.angle } }));
    setTouched(current => ({ ...current, [key]: true }));
    setFollowNote(solved.valid
      ? ""
      : solved.short.length
        ? `pair${solved.short.length > 1 ? "s" : ""} `
          + solved.short.map(p => p + 1).join(", ")
          + ` cannot reach ${solved.star.toFixed(1)} px inside 0…${EXT_MAX} px`
          + " at this heading — clamped, so the band is not flush"
        : `no heading in the search window makes this flush ring legal with `
          + `pair ${fixed + 1} held at ${knobs.ext[fixed].toFixed(2)} px — `
          + "applied at the current heading; the readout shows what breaks");
    setStatus(!solved.valid
      ? (solved.short.length
        ? `Solved from pair ${fixed + 1}, but ${solved.short.length} pair${
            solved.short.length > 1 ? "s" : ""} clamped — see the panel.`
        : `Solved from pair ${fixed + 1}, but no heading makes it legal — see the panel.`)
      : solved.moved
        ? `Every other pair solved to pair ${fixed + 1}'s ${solved.star.toFixed(1)} px, `
          + `and the heading moved ${knobs.angle.toFixed(1)}° → ${solved.angle.toFixed(1)}° — `
          + "the nearest heading where the flush ring passes the geometry tests. "
          + "Weave and audit to ask the engine."
        : `Every other pair solved to pair ${fixed + 1}'s ${solved.star.toFixed(1)} px `
          + "— one division per pair. Weave and audit to ask the engine.");
    setFailed(false);
    setManualWoven(null);
  };

  /**
   * Both bands as the diagram should place them, the selected one focused.
   *
   * The band switch changes which set of knobs is on screen, not which work
   * survives: a band is included here whenever it has knobs at all, so the V
   * band a hand already moved stays moved while the H band is being edited,
   * and the reverse. Memoised because ManualFigure redraws on identity.
   */
  const figureBands = useMemo<FigureBand[]>(() => {
    if (!plan) return [];
    return BANDS.flatMap(key => {
      const inputs = plan[key];
      const knobs = manual[key];
      if (!inputs || inputs.unavailable || !knobs) return [];
      return [{ inputs, ext: knobs.ext, angle: knobs.angle, focus: key === band }];
    });
  }, [plan, manual, band]);

  /** What the knobs measure as right now, before any engine is asked. */
  const manualReadout = useMemo(() => {
    const inputs = plan?.[band];
    const current = manual[band];
    if (!inputs || inputs.unavailable || !current) return null;
    return readAt(inputs, current.ext, current.angle);
  }, [plan, band, manual]);

  /** Weave the manual configuration and let the engine's audit grade it. */
  const weaveManual = async () => {
    if (!plan || !before) return;
    const config: Record<BandKey, ManualBand | null> = {
      h: touched.h && manual.h ? manual.h : held.h,
      v: touched.v && manual.v ? manual.v : held.v,
    };
    setBusy(true);
    setFailed(false);
    setStatus("Weaving the manual configuration…");
    try {
      const woven = await ask({
        type: "fit-weave", level: fitLevel,
        hExt: config.h?.ext ?? null, hAngle: config.h?.angle ?? null,
        vExt: config.v?.ext ?? null, vAngle: config.v?.angle ?? null,
      }, "fit-weave-ready") as Woven;
      const lengths = {
        h: plan.h?.unavailable ? [] : measure(woven.strands, plan.h.names),
        v: plan.v?.unavailable ? [] : measure(woven.strands, plan.v.names),
      };
      const ok = !!woven.row?.healthy
        && woven.row.across >= (before.woven.row?.across ?? 0);
      // The manual pick, in the candidate's own shape, so the audit log and
      // the export read it exactly as they read a walked candidate.
      const asCandidate = (key: BandKey): Candidate | null => {
        const inputs = plan[key];
        if (!inputs || inputs.unavailable || !(touched[key] && manual[key])) return null;
        const m = manual[key]!;
        const r = readAt(inputs, m.ext, m.angle);
        return {
          ext: [...m.ext], angle: m.angle, star: r.lengths[0] ?? 0,
          lengths: r.lengths, gaps: r.gaps, margin: r.margin, delta: r.delta,
          totalExt: m.ext.reduce((a, b) => a + b, 0),
        };
      };
      setManualWoven({ h: asCandidate("h"), v: asCandidate("v"), woven, lengths, accepted: ok });
      setStatus(ok
        ? `The manual ring closes — ${woven.row.across}/${woven.row.expected} crossings. `
          + "Adopt it and the stats, the export and a judgement all read it."
        : `The audit refused the manual ring — ${woven.row.across}/${woven.row.expected} `
          + `crossings against the engine's ${before.woven.row?.across ?? "?"}. `
          + "The knobs and the numbers are unchanged; move them and weave again.");
      setFailed(!ok);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  /** Make the manual ring the fitted one, so everything downstream reads it. */
  const adoptManual = () => {
    if (!manualWoven?.accepted) return;
    setAfter(manualWoven);
    setOrigin({ kind: "manual" });
    setAttempts(current => [...current, manualWoven]);
    setStatus("Manual ring adopted as the fitted ring.");
    setFailed(false);
  };

  // -------------------------------------------------------------------------
  // Judgements. What a person says about the ring on screen, written local
  // first and then — with a Worker configured — to picks/v3/… on the shelf and
  // as a verdict-carrying row in the D1 solutions table.
  // -------------------------------------------------------------------------

  const descriptor = useMemo<RunDescriptor>(() => (
    { m, n, ks, hand, direction, ...DESCRIPTOR_FLAGS }
  ), [m, n, ks, hand, direction]);

  /** Re-read the shelf without re-running the engine — after setting a url. */
  const refreshPicks = async () => {
    setBusy(true);
    setStatus("Reading the judgements…");
    const shelf = await loadPicks();
    setPicks(shelf);
    setFailed(!shelf.reached);
    setStatus(shelf.judgements.length
      ? `${shelf.judgements.length} judgement${shelf.judgements.length === 1 ? "" : "s"}`
        + ` from ${shelf.from}.`
      : shelf.reached ? "No judgements for these parameters yet."
        : "The worker url did not answer — showing this browser's judgements only.");
    setBusy(false);
  };

  /**
   * Weave one judgement's pick and show it as the fitted ring.
   *
   * The auto-load on Run takes the ★ best and stops; this is how any OTHER
   * judgement gets looked at — somebody else's, an older one, or a ✓ valid you
   * want to compare against the best. It re-weaves rather than trusting the
   * stored metrics, so what the card shows is a ring the engine just built, and
   * the audit line under it is this weave's own.
   */
  const loadJudgement = async (j: Judgement) => {
    if (!plan || !before) return;
    const bands = j.levels.find(l => l.level === fitLevel);
    if (!bands || (!bands.h && !bands.v)) {
      setStatus(`${j.chooser}'s ${j.verdict} judgement does not cover L${fitLevel}.`);
      setFailed(true);
      return;
    }
    setBusy(true);
    setFailed(false);
    setStatus(j.strands
      ? `Reading ${j.chooser}'s ${j.verdict} ring…`
      : `Weaving ${j.chooser}'s ${j.verdict} ring…`);
    try {
      const stored: Woven | null = j.strands && j.audit
        ? {
            level: fitLevel,
            h: { ext: bands.h?.ext ?? [], angle: bands.h?.angle ?? null },
            v: { ext: bands.v?.ext ?? [], angle: bands.v?.angle ?? null },
            crossings: j.audit.crossings,
            strands: j.strands as Strand[],
            row: {
              level: fitLevel, k: plan.k, expected: j.audit.expected,
              across: j.audit.crossings, within: 0, masks: 0,
              stray: j.audit.stray, broken: j.audit.broken,
              healthy: j.audit.crossings >= j.audit.expected
                && j.audit.stray === 0 && j.audit.broken === 0,
              ext: [],
            },
          }
        : null;
      const woven = stored ?? await ask({
        type: "fit-weave", level: fitLevel,
        hExt: bands.h?.ext ?? held.h?.ext ?? null,
        hAngle: bands.h?.angle ?? held.h?.angle ?? null,
        vExt: bands.v?.ext ?? held.v?.ext ?? null,
        vAngle: bands.v?.angle ?? held.v?.angle ?? null,
      }, "fit-weave-ready") as Woven;
      const lengths = {
        h: plan.h?.unavailable ? [] : measure(woven.strands, plan.h.names),
        v: plan.v?.unavailable ? [] : measure(woven.strands, plan.v.names),
      };
      const asCandidate = (key: BandKey): Candidate | null => {
        const inputs = plan[key];
        const p = key === "h" ? bands.h : bands.v;
        if (!inputs || inputs.unavailable || !p || p.angle === null) return null;
        const r = readAt(inputs, p.ext, p.angle);
        return {
          ext: [...p.ext], angle: p.angle, star: r.lengths[0] ?? 0,
          lengths: r.lengths, gaps: r.gaps, margin: r.margin, delta: r.delta,
          totalExt: p.ext.reduce((a, b) => a + b, 0),
        };
      };
      const attempt: Attempt = {
        h: asCandidate("h"), v: asCandidate("v"), woven, lengths,
        accepted: !!woven.row?.healthy,
      };
      setAfter(attempt);
      setOrigin({ kind: "judged", verdict: j.verdict, chooser: j.chooser,
                  from: picks.from });
      setAttempts(current => [...current, attempt]);
      setStatus(`${VERDICT_GLYPH[j.verdict]} ${j.chooser}'s ${j.verdict} ring, woven`
        + ` — ${woven.row.across}/${woven.row.expected} crossings`
        + `${woven.row.healthy ? "" : ", and it does not close"}.`);
      setFailed(!woven.row?.healthy);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  /** The ring a verdict would be about: manual if woven, else fitted, else engine's. */
  const judgedSource = manualWoven ? "hand" as const
    : after ? "fitter" as const : "engine" as const;

  const saveJudgement = async (verdict: Verdict) => {
    if (!plan || !before) return;
    const name = chooser.trim();
    if (!name) {
      setStatus("A verdict has one author, and it is a person — put a name in the chooser field.");
      setFailed(true);
      return;
    }
    const attempt = manualWoven ?? after;
    const pickOf = (key: BandKey): PickBand => {
      const inputs = plan[key];
      if (!inputs || inputs.unavailable) return null;
      const c = attempt ? (key === "h" ? attempt.h : attempt.v) : null;
      const source = c ?? held[key];
      return source ? { ext: [...source.ext], angle: source.angle }
                    : { ext: [...inputs.applied], angle: inputs.appliedAngle };
    };
    // Metrics off the geometry being judged, measured the same way the table
    // measures it: worst neighbour Δ and spread across the bands, and the
    // tightest gap margin either band has.
    let delta = 0, spr = 0, margin = Infinity;
    for (const key of BANDS) {
      const inputs = plan[key];
      if (!inputs || inputs.unavailable) continue;
      const lengths = attempt ? attempt.lengths[key] : before.lengths[key];
      if (lengths.length) {
        delta = Math.max(delta, neighbourDelta(lengths));
        spr = Math.max(spr, spread(lengths));
      }
      const pick = pickOf(key);
      if (pick && pick.angle !== null) {
        margin = Math.min(margin, readAt(inputs, pick.ext, pick.angle).margin);
      }
    }
    const row = attempt ? attempt.woven.row : before.woven.row;
    const at = new Date().toISOString();
    const judgement: Judgement = {
      id: `j-${at.replace(/\D/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`,
      verdict, source: judgedSource, chooser: name, at,
      ...(judgeNote.trim() ? { note: judgeNote.trim() } : {}),
      levels: [{ level: fitLevel, h: pickOf("h"), v: pickOf("v") }],
      metrics: { neighbour_delta: delta, spread: spr,
                 gap_margin: Number.isFinite(margin) ? margin : 0 },
      audit: { crossings: row.across, expected: row.expected,
               stray: row.stray, broken: row.broken },
      // The ring itself, not just the knobs that make it. A judgement holding
      // only extensions and an angle can be re-woven, but only by an engine —
      // so reading one back cost a Pyodide boot for a ring somebody had
      // already built. Stored, the diagram is drawable the moment the
      // judgement is read. Costs a few KB per judgement; buys the wait.
      strands: attempt ? attempt.woven.strands : before.stage.strands,
    };

    // Local first, always: a wrong URL or a bad token must lose the upload,
    // never the decision.
    let heldLocally = true;
    try {
      const rows = JSON.parse(readSetting(JUDGEMENTS_KEY) || "[]");
      rows.push({ key: `picks/${picksKey(descriptor)}`, judgement });
      writeSetting(JUDGEMENTS_KEY, JSON.stringify(rows));
    } catch {
      heldLocally = false;
    }

    const reports: string[] = [heldLocally
      ? "held locally" : "local copy failed (storage full or blocked)"];
    if (apiUrl.trim()) {
      setBusy(true);
      setStatus("Writing the judgement to the shelf…");
      const cache = createCache({ base: apiUrl.trim(), token: apiToken.trim() });
      try {
        const existing = await cache.getPicks(descriptor);
        const merged = mergeJudgement(existing, judgement, descriptor,
          ranAt ? { runComputedAt: ranAt } : {});
        await cache.putPicks(merged);
        reports.push(`shelf: picks/${picksKey(descriptor)} now holds `
          + `${merged.judgements.length} judgement${merged.judgements.length === 1 ? "" : "s"}`);
      } catch (error) {
        reports.push(`shelf: ${error instanceof Error ? error.message : String(error)}`);
      }
      // And the queryable half: the same verdict as a solutions row, so
      // "every human-valid ring across sizes" stays one GET.
      try {
        const parent = allStages.find(s => s.level === fitLevel - 1);
        if (!parent) {
          reports.push("D1 row skipped: the run kept no parent ring for this level");
        } else {
          const response = await fetch(`${apiUrl.trim().replace(/\/+$/, "")}/solutions`, {
            method: "POST",
            headers: { "Content-Type": "application/json",
                       Authorization: `Bearer ${apiToken.trim()}` },
            body: JSON.stringify({
              id: judgement.id, created_at: at, hand, direction, m, n,
              level: fitLevel, k: plan.k, ks_prefix: ks.slice(0, fitLevel),
              parent_strands: parent.strands,
              solution_strands: attempt ? attempt.woven.strands : before.stage.strands,
              h_ext: row.ext?.[0] ?? [], v_ext: row.ext?.[1] ?? [],
              audit: row, solution_index: 0, rating: null,
              kind: "complete", band: null, deficit: 0, refs: 0,
              verdict, verdict_by: name, verdict_at: at, source: judgedSource,
            }),
          });
          reports.push(response.ok ? "D1 row written"
            : `D1 refused the row (HTTP ${response.status})`);
        }
      } catch {
        reports.push("D1 unreachable");
      }
      setBusy(false);
    } else {
      reports.push("no Worker URL — the shelf and D1 were not written");
    }
    writeSetting(CHOOSER_KEY, name);
    const glyph = verdict === "best" ? "★" : verdict === "valid" ? "✓" : "✗";
    setStatus(`${glyph} ${verdict} saved · ${reports.join(" · ")}`);
    setFailed(!heldLocally);
  };

  const exportRing = () => {
    if (!plan || !before) return;
    const source = after ?? null;
    const name = `mxn-${m}x${n}-k${ks.join("_")}-${hand}-${direction}-L${fitLevel}`;
    saveJson(`${name}-${today()}.json`, source ? source.woven.strands : before.stage.strands);
    saveJson(`${name}-${today()}.fit.json`, {
      params: { m, n, ks, hand, direction },
      engine: { level: fitLevel, k: plan.k },
      fitted: !!source,
      policy: { target: "flush", ext: "continuous", angle: "window", tie: "longest" },
      bands: BANDS.filter(key => !plan[key]?.unavailable).map(key => ({
        band: BAND_NAME[key],
        arms: plan[key].nStrands,
        pairs: plan[key].P,
        names: plan[key].names,
        before: {
          ext: plan[key].applied, angle: plan[key].appliedAngle,
          lengths: before.lengths[key],
          neighbourDelta: neighbourDelta(before.lengths[key]),
          spread: spread(before.lengths[key]),
        },
        after: source ? {
          ext: (key === "h" ? source.h : source.v)?.ext ?? plan[key].applied,
          angle: (key === "h" ? source.h : source.v)?.angle ?? plan[key].appliedAngle,
          lengths: source.lengths[key],
          neighbourDelta: neighbourDelta(source.lengths[key]),
          spread: spread(source.lengths[key]),
        } : null,
      })),
      audit: {
        before: before.woven.row, after: source ? source.woven.row : null,
        candidatesWoven: attempts.length,
      },
      // The hand's own configuration, whether or not it was adopted: a manual
      // weave a person walked away from is still the record of what they tried.
      manual: manualWoven ? {
        adopted: after === manualWoven,
        accepted: manualWoven.accepted,
        h: manualWoven.h ? { ext: manualWoven.h.ext, angle: manualWoven.h.angle } : "held",
        v: manualWoven.v ? { ext: manualWoven.v.ext, angle: manualWoven.v.angle } : "held",
        lengths: manualWoven.lengths,
        audit: manualWoven.woven.row,
      } : null,
    });
  };

  const health = after?.woven.row ?? before?.woven.row ?? null;

  return (
    <div>
      <div className="masthead">
        <a className="brand" href="..">
          <span className="brand-mark">S3</span>
          <span>MXN Fitter<small>/MXN/FIT/</small></span>
        </a>
        <nav className="mast-links">
          <a href="..">← lab</a><a href="../ks/">ks</a><a href="../gpu/">gpu</a>
        </nav>
      </div>

      <div className="workspace">
        <div className="controls">
          <section>
            <h2 className="kicker">Parameters</h2>
            <div className="field row2">
              <div>
                <label className="f" htmlFor="fit-m">m</label>
                <input id="fit-m" type="number" min={1} max={4} value={m}
                  onChange={e => setM(Math.max(1, Math.min(4, Number(e.target.value) || 1)))} />
              </div>
              <div>
                <label className="f" htmlFor="fit-n">n</label>
                <input id="fit-n" type="number" min={1} max={4} value={n}
                  onChange={e => setN(Math.max(1, Math.min(4, Number(e.target.value) || 1)))} />
              </div>
            </div>
            <div className="field">
              <label className="f" htmlFor="fit-ks">k sequence</label>
              <input id="fit-ks" type="text" value={ksText}
                onChange={e => setKsText(e.target.value)} />
            </div>
            <div className="field row2">
              <div>
                <label className="f">hand</label>
                <div className="seg">
                  {(["lh", "rh"] as const).map(value => (
                    <button key={value} type="button" aria-pressed={hand === value}
                      onClick={() => setHand(value)}>{value.toUpperCase()}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="f">direction</label>
                <div className="seg">
                  {(["cw", "ccw"] as const).map(value => (
                    <button key={value} type="button" aria-pressed={direction === value}
                      onClick={() => setDirection(value)}>{value.toUpperCase()}</button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="kicker">Run</h2>
            <button className="go" type="button" onClick={run} disabled={busy}>
              {busy ? "Working…"
                : apiUrl.trim() ? "Run · load best from Cloudflare"
                : "Run · load best fit"}
            </button>
            <button className="go ghost" type="button" onClick={exportRing}
              disabled={!before}>Export</button>
            <p className="hint">
              The ring somebody judged <b>★ best</b> for these parameters is what
              loads: {apiUrl.trim()
                ? <>from the Cloudflare shelf, and from this browser's own
                   judgements, folded together.</>
                : <>from this browser's own judgements — set a worker url below to
                   read the Cloudflare shelf too.</>}{" "}
              Without a best it fits fresh: exactly-flush candidates offered to the
              engine's audit longest-arm first, because the ring closes when one
              band's arms reach across the other.
            </p>
            {(status || progress) && (
              <p className={`status${failed ? " bad" : ""}`}>{status || progress}</p>
            )}
          </section>

          <section>
            <h2 className="kicker">Judgement</h2>
            <div className="field">
              <label className="f" htmlFor="fit-api">worker url</label>
              <input id="fit-api" type="url" placeholder="https://….workers.dev" value={apiUrl}
                onChange={e => { setApiUrl(e.target.value); writeSetting(CACHE_URL_KEY, e.target.value.trim()); }} />
            </div>
            <div className="field">
              <label className="f" htmlFor="fit-token">admin token</label>
              <input id="fit-token" type="password" placeholder="ADMIN_TOKEN" value={apiToken}
                onChange={e => { setApiToken(e.target.value); writeSetting(CACHE_TOKEN_KEY, e.target.value.trim()); }} />
            </div>
            <div className="field">
              <label className="f" htmlFor="fit-chooser">chooser — who is judging</label>
              <input id="fit-chooser" type="text" placeholder="your name" value={chooser}
                onChange={e => setChooser(e.target.value)} />
            </div>
            <div className="field">
              <label className="f" htmlFor="fit-note">note</label>
              <input id="fit-note" type="text" placeholder="why (optional)" value={judgeNote}
                onChange={e => setJudgeNote(e.target.value)} />
            </div>
            <div className="verdicts">
              <button type="button" className="verdict good" disabled={!before || busy}
                onClick={() => saveJudgement("valid")}>✓ valid</button>
              <button type="button" className="verdict star" disabled={!before || busy}
                onClick={() => saveJudgement("best")}>★ best</button>
              <button type="button" className="verdict no" disabled={!before || busy}
                onClick={() => saveJudgement("rejected")}>✗ rejected</button>
            </div>
            <p className="hint">
              A verdict is about the ring on screen — right now the{" "}
              <em>{judgedSource === "hand" ? "manual" : judgedSource === "fitter" ? "fitted" : "engine's own"}</em>{" "}
              ring. It is held in this browser first, and with a Worker configured it is
              also written to <code>picks/{picksKey(descriptor)}</code> on the shelf and as
              a row in the D1 solutions table, so <code>/mxn/rate/</code> and a{" "}
              <code>?verdict=</code> query can find it. Only a person writes one.
            </p>
          </section>
        </div>

        <div className="results">
          {!plan && !busy && (
            <p className="note" style={{ padding: 0 }}>
              Give a size, a k and a hand, and press <em>Run and fit</em>. The engine runs in
              this browser — the first run loads it, which takes a moment. Everything after
              that is arithmetic in the page. See <a href="https://github.com/ysetbon/Scoubidou3D/blob/main/docs/mxn-fit.md">docs/mxn-fit.md</a>.
            </p>
          )}

          {plan && (
            <>
              <div className="runbar">
                <h1>{m}×{n} · k={ks.join(", ")} · {hand.toUpperCase()} · {direction.toUpperCase()}</h1>
                {after
                  ? <span className="chip ok">fitted · proposed</span>
                  : <span className="chip warn">not fitted</span>}
                <span className="chip soft">fitting L{fitLevel} of {stages.length}</span>
                {health && (
                  <span className={`chip ${health.healthy ? "soft" : "warn"}`}>
                    {health.across}/{health.expected} crossings
                  </span>
                )}
                {mismatch && <span className="chip warn">baseline disagrees</span>}
                <div className="tabs">
                  {BANDS.map(key => (
                    <button key={key} type="button" aria-pressed={band === key}
                      onClick={() => setBand(key)}>
                      {key.toUpperCase()} band
                      {plan[key]?.unavailable ? " · none" : ` · ${plan[key].nStrands} arms`}
                    </button>
                  ))}
                </div>
              </div>

              {mismatch && <p className="alarm">Baseline check failed — {mismatch}.</p>}

              <div className="stats">
                <div className="stat">
                  <b>Neighbour Δ</b>
                  <div className={`big ${afterLengths.length
                    ? (neighbourDelta(afterLengths) < 0.01 ? "good" : "") : ""}`}>
                    {afterLengths.length
                      ? `${neighbourDelta(afterLengths).toFixed(2)} px`
                      : "—"}
                  </div>
                  <span className="was">
                    was {beforeLengths.length ? neighbourDelta(beforeLengths).toFixed(2) : "—"} px
                  </span>
                </div>
                <div className="stat">
                  <b>Arm length</b>
                  <div className="big">
                    {afterLengths.length ? `${afterLengths[0].toFixed(1)} px` : "—"}
                  </div>
                  <span className="was">
                    {afterLengths.length ? `all ${afterLengths.length} arms` : "not fitted"}
                  </span>
                </div>
                <div className="stat">
                  <b>Candidates woven</b>
                  <div className="big">{attempts.length}</div>
                  <span className="was">
                    {attempts.filter(a => !a.accepted).length} refused by the audit
                  </span>
                </div>
                <div className="stat">
                  <b>Ring audit</b>
                  <div className={`big ${health?.healthy ? "good" : "bad"}`}>
                    {health ? `${health.across}/${health.expected}` : "—"}
                  </div>
                  <span className="was">
                    {health ? `${health.stray} stray · ${health.broken} broken` : ""}
                  </span>
                </div>
              </div>

              {plan[band] && !plan[band].unavailable && manual[band] && (() => {
                const inputs = plan[band];
                const knobs = manual[band]!;
                const other: BandKey = band === "h" ? "v" : "h";
                const angleLo = Math.min(inputs.windowLo ?? -180, knobs.angle) - 25;
                const angleHi = Math.max(inputs.windowHi ?? 180, knobs.angle) + 25;
                const armName = (p: number) => {
                  const [li, ri] = inputs.pairIndices[p];
                  return ri === null || ri === undefined
                    ? inputs.names[li]
                    : `${inputs.names[li]}+${inputs.names[ri]}`;
                };
                const setAngle = (value: number) => {
                  if (Number.isFinite(value)) applyManual(band, knobs.ext, value, anchor[band]);
                };
                const setExt = (p: number, value: number) => {
                  if (!Number.isFinite(value)) return;
                  const next = [...knobs.ext];
                  next[p] = Math.min(EXT_MAX, Math.max(0, value));
                  applyManual(band, next, knobs.angle, p);
                };
                const read = manualReadout;
                return (
                  <div className="panel hero">
                    <header>
                      <strong>Manual fit — {BAND_NAME[band]} band</strong>
                      <span>
                        drag the heading and each pair's extension; every number is
                        measured live, and the engine audits on demand
                      </span>
                      <span className="spacer" />
                      <button type="button" className="follow" aria-pressed={follow}
                        onClick={() => setFollow(value => !value)}
                        title={follow
                          ? "Coupled: moving one pair re-solves the others to its arm length. Press to move pairs one at a time instead."
                          : "Independent: each pair moves alone. Press to couple them again."}>
                        <i aria-hidden="true" />
                        {follow
                          ? `coupled — pairs follow pair ${anchor[band] + 1}`
                          : "independent — each pair moves alone"}
                      </button>
                    </header>
                    <div className="body">
                      <div className="mgrid">
                      <div>
                        <ManualFigure bands={figureBands}
                          stage={before?.stage ?? null} bounds={bounds}
                          caption={read ? `Δ ${read.delta.toFixed(2)} px` : ""} />
                        <div className="mlegend">
                          {knobs.ext.map((_, p) => (
                            <span key={p}>
                              <u style={{ background: PAIR_COLOURS[p % PAIR_COLOURS.length] }} />
                              pair {p + 1}
                            </span>
                          ))}
                          <span><u className="dashline" /> gap to target</span>
                          <span>
                            {touched[other] && manual[other]
                              ? `the ${BAND_NAME[other]} band is drawn where you left it`
                              : "the rest of the ring is drawn as the engine wove it"}
                          </span>
                        </div>
                      </div>
                      <div>
                      <div className="mrow">
                        <i>angle</i>
                        <input type="range" min={angleLo} max={angleHi} step={0.01}
                          value={knobs.angle} aria-label="band angle"
                          onChange={e => setAngle(Number(e.target.value))} />
                        <input className="mnum" type="number" step={0.01}
                          value={Number(knobs.angle.toFixed(2))}
                          onChange={e => setAngle(Number(e.target.value))} />
                        <b className={read && !read.inWindow ? "bad" : ""}>
                          {read ? (read.inWindow ? "in its ±20° window" : "off window") : ""}
                        </b>
                      </div>
                      {knobs.ext.map((value, p) => (
                        <div className="mrow" key={p}>
                          <i>{follow && anchor[band] === p ? "⚓ " : ""}pair {p + 1} · {armName(p)}</i>
                          <input type="range" min={0} max={EXT_MAX} step={0.05}
                            value={value} aria-label={`pair ${p + 1} extension`}
                            onChange={e => setExt(p, Number(e.target.value))} />
                          <input className="mnum" type="number" min={0} max={EXT_MAX} step={0.05}
                            value={Number(value.toFixed(2))}
                            onChange={e => setExt(p, Number(e.target.value))} />
                          <b>
                            {read ? `${(read.lengths[inputs.pairIndices[p][0]] ?? 0).toFixed(1)} px` : ""}
                          </b>
                        </div>
                      ))}
                      {read && (
                        <div className="mread">
                          <span>Δ neigh{" "}
                            <b className={read.delta < 0.01 ? "good" : ""}>{read.delta.toFixed(2)} px</b>
                          </span>
                          <span>spread <b>{read.spread.toFixed(2)} px</b></span>
                          <span>gap margin{" "}
                            <b className={read.margin < 0 ? "bad" : ""}>{read.margin.toFixed(2)} px</b>
                          </span>
                          <span>geometry{" "}
                            <b className={read.verdict === VALID ? "good" : "bad"}>
                              {VERDICT_NAMES[read.verdict] ?? "?"}
                            </b>
                          </span>
                        </div>
                      )}
                      {followNote && <p className="mwarn">{followNote}</p>}
                      <div className="mbtns">
                        <button type="button" disabled={busy}
                          onClick={() => resetManual(band, "engine")}>reset to engine</button>
                        <button type="button" disabled={busy || !after || after === manualWoven}
                          onClick={() => resetManual(band, "fitted")}>load fitted</button>
                        <button type="button" className="mfix"
                          disabled={busy || inputs.P < 2 || !read || read.delta <= FLUSH_EPS}
                          title={read && read.delta > FLUSH_EPS
                            ? `Solve every other pair's extension to pair ${anchor[band] + 1}'s arm length — `
                              + "moving the heading the least it can if the flush answer collides"
                            : "Lights up when neighbouring arms disagree"}
                          onClick={() => fixFromAnchor(band)}>
                          fix others from pair {anchor[band] + 1}
                        </button>
                        <button type="button" className="mgo"
                          disabled={busy || !(touched.h || touched.v)}
                          onClick={weaveManual}>Weave and audit</button>
                        <button type="button"
                          disabled={busy || !manualWoven?.accepted || after === manualWoven}
                          onClick={adoptManual}>
                          {after === manualWoven ? "adopted" : "adopt as fitted"}
                        </button>
                      </div>
                      </div>
                      </div>
                      {manualWoven && (
                        <div className="rings" style={{ marginTop: 14 }}>
                          <RingFigure title="manual · woven"
                            stage={{ level: fitLevel, k: plan.k, label: "manual",
                                     strands: manualWoven.woven.strands }}
                            bounds={bounds}
                            caption={`${manualWoven.woven.row.across}/${manualWoven.woven.row.expected}`
                              + ` crossings · ${manualWoven.accepted ? "accepted" : "refused"}`} />
                          <div>
                            <LengthBars before={beforeLengths}
                              after={manualWoven.lengths[band]} />
                          </div>
                        </div>
                      )}
                    </div>
                    <p className="note">
                      The switch in the header picks how the pairs move. <em>Coupled</em>:
                      moving one pair re-solves the others live to the arm length it names
                      (<code>L = A(a) − B(a)·e</code>, so each answer is one division), and
                      moving the angle re-solves them around the anchored pair.{" "}
                      <em>Independent</em>: each pair moves alone and the others hold still —
                      and once the neighbouring arms disagree, <em>fix others from pair N</em>{" "}
                      lights up and solves every other pair from the one you fixed —
                      holding that pair exactly, and moving the heading the smallest
                      amount that lets the flush ring pass the geometric tests when the
                      answer at the current heading would collide. Switching bands changes
                      which knobs are on screen, not what you have already moved: the
                      diagram places <em>both</em> bands from their own knobs, so the band
                      you are not editing stays where you left it. The diagram is the real ring — the same renderer as
                      every card on this page, with this band's arms moved to the knobs — but
                      what the page cannot decide alone is whether the ring still closes,
                      which is what <em>weave and audit</em> asks the engine. An untouched
                      band is woven where the engine left it.
                    </p>
                  </div>
                );
              })()}

              <div className="panel">
                <header>
                  <strong>L{fitLevel}, before and after</strong>
                  <span>the level being fitted, and what the fit did to it</span>
                </header>
                <div className="body">
                  <div className="rings">
                    <RingFigure title={`L${fitLevel} · engine`} stage={before?.stage ?? null}
                      bounds={bounds}
                      caption={beforeLengths.length
                        ? `Δ ${neighbourDelta(beforeLengths).toFixed(2)} px` : ""} />
                    <RingFigure
                      title={!after ? "fitted — none accepted"
                        : origin?.kind === "judged"
                          ? `L${fitLevel} · ${VERDICT_GLYPH[origin.verdict]} ${origin.verdict}`
                            + ` · ${origin.chooser}`
                        : origin?.kind === "manual" ? `L${fitLevel} · adopted by hand`
                        : `L${fitLevel} · fitted`}
                      stage={after
                        ? { level: fitLevel, k: plan.k, label: "fitted", strands: after.woven.strands }
                        : null}
                      bounds={bounds}
                      caption={afterLengths.length
                        ? `Δ ${neighbourDelta(afterLengths).toFixed(2)} px` : ""} />
                  </div>
                  <LengthBars before={beforeLengths} after={afterLengths} />
                </div>
                <p className="note">
                  Both are the engine's own output, and the right-hand card names where its
                  ring came from — a person's <b>★ best</b> with the chooser who judged it,
                  a ring <em>adopted by hand</em>, or <em>fitted</em> from the candidate walk.
                  The lengths beside them are measured off
                  those strands rather than recomputed from the extensions that were asked for,
                  so what is quoted is what is drawn. Fitting a level slides its arms along
                  their parents, which <em>lengthens the level below by the same amount</em> —
                  so the card for L{Math.max(1, fitLevel - 1)} above is part of the answer too,
                  not context.
                </p>
              </div>
            </>
          )}

          {/* The run's own diagrams do not wait on the fit, and must not: a
              cached run has its stages the moment the shelf answers, while the
              engine is still opening the browsing session every fit call reads.
              Gated on the plan, the stitch appeared only after that wait — and
              the cache bought the reader nothing. */}
          {stages.length > 0 && (
              <div className="panel">
                <header>
                  <strong>Every level</strong>
                  <span>
                    the run's own diagrams, the fitted level as it now stands —
                    press one to fit that level instead
                  </span>
                  <span className="spacer" />
                  <span className="chip soft">{stages.length} level{stages.length === 1 ? "" : "s"}</span>
                </header>
                <div className="body">
                  <div className="levels">
                    {stages.map(s => {
                      // The fitted level shows the ring that is actually applied,
                      // not the one the run first drew — otherwise the strip
                      // contradicts the card above it about the same level.
                      const isFitted = s.level === fitLevel && !!after;
                      return (
                        <button key={s.level} type="button" className="level"
                          aria-pressed={s.level === fitLevel} disabled={busy}
                          onClick={() => { if (s.level !== fitLevel) fitAt(s.level, stages, auditRows); }}
                          title={isFitted ? `L${s.level}, as fitted` : `Fit L${s.level}`}>
                          <RingFigure title={`L${s.level}${s.k === null ? "" : ` · k=${s.k}`}`}
                            stage={isFitted
                              ? { ...s, label: "fitted", strands: after!.woven.strands } : s}
                            bounds={bounds}
                            caption={isFitted ? "fitted"
                              : s.level === fitLevel ? "fitting" : ""} />
                        </button>
                      );
                    })}
                  </div>
                </div>
                <p className="note">
                  Each card is the stitch as it stood at that level, drawn by{" "}
                  <code>drawExactStage</code> — the same renderer <code>/mxn/</code> uses, off
                  the same strands. They share one frame, so a ring that grew is drawn bigger
                  rather than rescaled to look the same. The level being fitted shows the ring
                  that is applied right now, so it agrees with the card above it.
                </p>
              </div>
          )}

          {plan && (
            <>
              <div className="panel">
                <header>
                  <strong>Judged rings</strong>
                  <span>
                    what people decided about these parameters — press one to weave it
                    and see it
                  </span>
                  <span className="spacer" />
                  <span className={`chip ${picks.reached ? "soft" : "warn"}`}>
                    {picks.judgements.length} from {picks.from || "nowhere yet"}
                  </span>
                  <button type="button" className="minibtn" disabled={busy}
                    onClick={refreshPicks}
                    title="Re-read the shelf without re-running the engine">
                    reload
                  </button>
                </header>
                <div className="body scroller" style={{ padding: "0 14px" }}>
                  {picks.judgements.length === 0 ? (
                    <p className="note" style={{ padding: "12px 0" }}>
                      Nothing judged for these parameters yet.{" "}
                      {apiUrl.trim()
                        ? "Mark a ring ✓ valid or ★ best in the sidebar and it lands here."
                        : "Set a worker url in the sidebar to read the Cloudflare shelf."}
                    </p>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th className="l">verdict</th><th className="l">chooser</th>
                          <th className="l">when</th><th className="l">levels</th>
                          <th>Δ neigh</th><th>margin</th><th>crossings</th><th />
                        </tr>
                      </thead>
                      <tbody>
                        {picks.judgements.map(j => {
                          const here = j.levels.some(l => l.level === fitLevel);
                          const shown = origin?.kind === "judged"
                            && origin.chooser === j.chooser && origin.verdict === j.verdict;
                          return (
                            <tr key={j.id} className={shown ? "applied" : ""}>
                              <td className="l">
                                <span className={`tag ${j.verdict === "best" ? "fit" : "eng"}`}>
                                  {VERDICT_GLYPH[j.verdict]} {j.verdict}
                                </span>
                              </td>
                              <td className="l">{j.chooser}</td>
                              <td className="l">{j.at.slice(0, 10)}</td>
                              <td className="l">{j.levels.map(l => `L${l.level}`).join(" ")}</td>
                              <td className="num">
                                {j.metrics ? j.metrics.neighbour_delta.toFixed(2) : "—"}
                              </td>
                              <td className="num">
                                {j.metrics ? j.metrics.gap_margin.toFixed(2) : "—"}
                              </td>
                              <td className="num">
                                {j.audit ? `${j.audit.crossings}/${j.audit.expected}` : "—"}
                              </td>
                              <td className="num">
                                <button type="button" className="minibtn"
                                  disabled={busy || !here || !before}
                                  onClick={() => loadJudgement(j)}
                                  title={here ? `Weave ${j.chooser}'s ring and show it`
                                    : `This judgement does not cover L${fitLevel}`}>
                                  {shown ? "shown" : "show"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                <p className="note">
                  Read from the Cloudflare shelf when a worker url is set, folded with this
                  browser's own judgements either way — the local copy is written first on
                  every save, so a decision the shelf never received still shows here. Pressing
                  <em> show</em> re-weaves the pick through the engine rather than trusting the
                  numbers stored with it, so the ring on screen and the crossings under it are
                  this weave's own. The <b>★ best</b> is what <em>Run</em> loads by itself; this
                  is how the others get looked at.
                </p>
              </div>

              <div className="panel">
                <header>
                  <strong>{BAND_NAME[band]} band</strong>
                  <span>
                    {plan[band]?.unavailable
                      ? plan[band].reason
                      : `${plan[band].nStrands} arms · ${plan[band].P} pairs · gaps ${
                          plan[band].minGap}–${plan[band].maxGap} px`}
                  </span>
                  <span className="spacer" />
                  <span className="chip soft">{candidates[band].length} flush candidates</span>
                </header>
                <div className="body scroller" style={{ padding: "0 14px" }}>
                  <table>
                    <thead>
                      <tr>
                        <th className="l">#</th><th className="l">source</th>
                        <th>ext</th><th>angle</th><th>arm lengths</th>
                        {([["delta", "Δ neigh"], ["spread", "spread"],
                           ["margin", "margin"], ["ext", "total ext"]] as const).map(
                          ([key, label]) => (
                            <th key={key} title={`sort by ${label}`}
                              className={`sortable${sortKey === key ? " sorted" : ""}`}
                              onClick={() => setSortKey(key)}>{label}</th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 12).map((row, index) => {
                        const isChosen = !!chosen && row.source === "fit"
                          && row.ext.every((e, i) => Math.abs(e - chosen.ext[i]) < 1e-9)
                          && Math.abs(row.angle - chosen.angle) < 1e-9;
                        return (
                          <tr key={index}
                            className={isChosen ? "applied" : row.source === "engine" ? "engine" : ""}>
                            <td className="l num">{index + 1}</td>
                            <td className="l">
                              {row.source === "engine"
                                ? <span className="tag eng">engine</span>
                                : isChosen ? <span className="tag fit">applied</span> : "flush"}
                            </td>
                            <td className="num">
                              {row.ext.map(e => e.toFixed(row.source === "engine" ? 0 : 2)).join(", ")}
                            </td>
                            <td className="num">
                              {Number.isFinite(row.angle) ? `${row.angle.toFixed(2)}°` : "—"}
                            </td>
                            <td className="num">{row.lengths.map(v => v.toFixed(1)).join(" · ")}</td>
                            <td className="num"><b>{neighbourDelta(row.lengths).toFixed(2)}</b></td>
                            <td className="num">{spread(row.lengths).toFixed(2)}</td>
                            <td className="num">
                              {Number.isFinite(row.margin) ? row.margin.toFixed(2) : "—"}
                            </td>
                            <td className="num">{row.totalExt.toFixed(0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="note">
                  Every <em>flush</em> row makes this band's arms exactly the same length; they
                  differ in which length, and at what heading. Click a numeric heading to rank
                  by it; the sort reads the geometry on screen, so it means the same before a
                  fit and after one. A band that is already flush has no candidates and is
                  left where the engine put it.
                </p>
              </div>

              {attempts.length > 0 && (
                <div className="panel">
                  <header>
                    <strong>What the audit said</strong>
                    <span>each candidate pair, woven and measured by the engine</span>
                  </header>
                  <div className="body">
                    <p className="log">
                      {attempts.map((attempt, index) => (
                        <span key={index}>
                          <b>{index + 1}.</b>{" "}
                          {attempt.h ? `H ${attempt.h.ext.map(e => e.toFixed(1)).join(", ")} @ ${attempt.h.angle.toFixed(1)}°`
                            : <span className="dim">H held</span>}
                          {" · "}
                          {attempt.v ? `V ${attempt.v.ext.map(e => e.toFixed(1)).join(", ")} @ ${attempt.v.angle.toFixed(1)}°`
                            : <span className="dim">V held</span>}
                          {" → "}
                          <span className={attempt.accepted ? "" : "bad"}>
                            {attempt.woven.row.across}/{attempt.woven.row.expected} crossings
                            {attempt.accepted ? " · accepted" : " · refused"}
                          </span>
                          <br />
                        </span>
                      ))}
                    </p>
                  </div>
                  <p className="note">
                    The bands are searched independently and the ring closes jointly, so this
                    list is not a formality: a band fitted perfectly can still cost the ring
                    crossings, and the first pair the audit accepts is the one that is applied.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <p className="footer">
        The fitter · part of the <a href="..">MXN Continuation Lab</a>. The engine runs in your
        browser; nothing is uploaded. Read{" "}
        <a href="https://github.com/ysetbon/Scoubidou3D/blob/main/docs/mxn-fit.md">docs/mxn-fit.md</a>{" "}
        for what it does and where it refuses.
      </p>
    </div>
  );
}
