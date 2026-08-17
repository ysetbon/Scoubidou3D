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
  CACHE_TOKEN_KEY, CACHE_URL_KEY, CACHE_VERSION, createCache, mergeJudgement,
  parsePicksKey, picksKey, runKey,
  readSetting, writeSetting,
  type Judgement, type JudgementSource, type PickBand,
  type RunDescriptor,
  type Verdict,
} from "../mxn-lab/cache";
// The two-store fold moved up to picks-shelf.ts when /mxn/ started asking the
// same question: one reading of "what has anybody said about these parameters",
// or the two pages drift and one draws a best the other has superseded.
import {
  JUDGEMENTS_KEY, readPicks, type Picks,
} from "../mxn-lab/picks-shelf";
// Imported rather than respelled: this page takes larger sizes than the lab
// does, and the number it is being larger THAN has to be the lab's own.
import { MAX_SIDE } from "../mxn-farm/plan";
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
  /**
   * Whether an engine graded this ring, as opposed to the page placing it.
   *
   * A ring applied from the knobs is real geometry — the same arithmetic the
   * diagram draws — but nothing has counted its crossings, and `woven.row`
   * is zeroed. Quoting that as an audit would be the page asserting a check it
   * never made, so the readouts ask this first.
   */
  audited: boolean;
};

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

const ksOf = (raw: string) => raw
  .replace(/[\u2212\u2013\u2014]/g, "-")
  .replace(/[\[\],_]/g, " ").trim().split(/\s+/)
  .map(Number).filter(Number.isInteger);

/**
 * The flags the fitter's own generate runs under. It sends none, so these are
 * the engine's defaults — spelled out here because they are part of the cache
 * key a judgement is saved beneath, and a judgement addressed to a different
 * search would be a judgement about a different ring.
 */
const DESCRIPTOR_FLAGS = { shortArms: true, step: "auto" as const, budget: 400_000 };

const CHOOSER_KEY = "mxn-fit-chooser";

/**
 * How large a size this page will take.
 *
 * `MAX_SIDE` is 4, and it is a LAB clamp rather than an engine one:
 * `bridge.generate` takes whatever m and n it is given. The lab caps at 4
 * because /mxn/ is a browsing tool over a shelf the farm filled, and a cached
 * answer nobody can reach is no answer.
 *
 * The fitter is the page where a size that is on nobody's shelf gets made by
 * hand, and the k boards at /mxn/ks/<k>/ ask for exactly that — their whole
 * point is the empty tiles, which run to 8×8. So this page takes 8, and says
 * plainly what is not known about the sizes past 4 rather than either refusing
 * them or pretending they are routine.
 */
const MAX_FIT_SIDE = 8;

/**
 * The parameter set the URL asks for, if it asks for one.
 *
 * `/mxn/fit/?m=3&n=2&ks=-1&hand=lh&direction=cw` opens the form already filled
 * in. The k boards at /mxn/ks/<k>/ are the caller this exists for: a tile with
 * nothing on it is a link to exactly this, so pressing a hole and starting to
 * edit is one click and no retyping.
 *
 * Every field is validated and a bad one is simply not applied, rather than
 * being coerced. A URL that half-parsed into a form the reader did not ask for
 * is worse than one that was ignored — the defaults below are a working page,
 * and `2x1 k=1` silently becoming `2x0` is not.
 *
 * `ks` is the sequence and `k` is accepted as an alias for the one-level case,
 * because a board cell IS the one-level case and writing `k=-1` by hand is what
 * anybody would try first.
 */
function askedFor() {
  let query: URLSearchParams;
  try {
    query = new URLSearchParams(window.location.search);
  } catch {
    return {};
  }
  const side = (name: string) => {
    const value = Number(query.get(name));
    return Number.isInteger(value) && value >= 1 && value <= MAX_FIT_SIDE ? value : undefined;
  };
  const ks = ksOf(query.get("ks") ?? query.get("k") ?? "");
  const hand = query.get("hand");
  const direction = query.get("direction");
  return {
    m: side("m"),
    n: side("n"),
    ksText: ks.length ? ks.join(" ") : undefined,
    hand: hand === "lh" || hand === "rh" ? (hand as "lh" | "rh") : undefined,
    direction: direction === "cw" || direction === "ccw"
      ? (direction as "cw" | "ccw") : undefined,
  };
}


/**
 * The parameter set a miss falls back to: the same size, hand and direction,
 * every k zero.
 *
 * k = 0 is the continuation that turns nowhere, so it is the one set that
 * plausibly exists for any size — and it is what a reader means by "just show
 * me one". Nothing else about the descriptor moves: a fallback that also
 * changed the hand would be answering a question nobody asked.
 */
function defaultOf(d: RunDescriptor): RunDescriptor {
  return { ...d, ks: d.ks.map(() => 0) };
}

/**
 * The ring a judgement carries, ready to draw.
 *
 * `Judgement.strands` is the whole ring as it was judged, so this is the entire
 * cost of putting a person's ★ best on screen — no Pyodide, no `generate`, no
 * `fit-weave`. Judgements saved before strands were stored return null here,
 * and those genuinely do need the engine.
 */
function stageOfJudgement(j: Judgement): Stage | null {
  const strands = j.strands as Strand[] | undefined;
  if (!Array.isArray(strands) || !strands.length) return null;
  return { level: j.levels[0]?.level ?? 1, k: null, label: "best", strands };
}

/**
 * How far another parameter set is from the one in the form. Lower is nearer.
 *
 * Only used to ORDER the shelf-wide search, so the substitute a reader is
 * offered is the most like what they asked for rather than whatever the
 * catalogue happened to list first. Size dominates hand, and hand dominates
 * depth, because that is the order in which a different value makes the ring a
 * different object.
 */
function nearness(want: RunDescriptor, got: RunDescriptor) {
  return (want.m === got.m && want.n === got.n ? 0 : 4)
    + (want.hand === got.hand && want.direction === got.direction ? 0 : 2)
    + (want.ks.length === got.ks.length ? 0 : 1);
}

/** One drawable ★ best, and which parameter set it belongs to. */
type Found = { stage: Stage; judgement: Judgement; from: string;
               descriptor: RunDescriptor; judgements: Judgement[] };

/** The most artifacts the shelf-wide search will fetch before giving up. */
const ANYWHERE_LIMIT = 16;

/**
 * The first judged ★ best anywhere — any size, any hand, any k.
 *
 * The last rung of the fallback, and the one that means a reader is never
 * handed a half-hour of engine as the only way to see a ring. A 4×1 is 194,502
 * extension combinations against a 2×2's 2,646; on a machine that is tens of
 * minutes of Pyodide, and pressing Run for it should be a decision rather than
 * the only option. So when neither the typed parameters nor the k = 0 default
 * has a best, this walks the catalogue and draws the first one it finds.
 *
 * Local judgements are searched first because they cost nothing and a ring
 * this browser judged is the one its reader most likely means. Each candidate
 * is read through readPicks rather than off the raw row, so mergeJudgement's
 * invariants apply and a locally-superseded best cannot come back as one.
 *
 * Bounded at ANYWHERE_LIMIT fetches and reported: an artifact carries a whole
 * ring, so an unbounded walk over a full shelf would be megabytes for a card
 * that is already a substitute. `alive` stops the walk when the parameters have
 * moved on under it.
 */
async function bestFromAnywhere(
  want: RunDescriptor, base: string, token: string,
  skip: string[], alive: () => boolean,
): Promise<{ found: Found | null; searched: number; skipped: number }> {
  const seen = new Set(skip);
  const tryOne = async (d: RunDescriptor, localOnly: boolean): Promise<Found | null> => {
    const picks = await readPicks(d, localOnly ? "" : base, token);
    const best = picks.judgements.find(j => j.verdict === "best");
    const stage = best ? stageOfJudgement(best) : null;
    return best && stage
      ? { stage, judgement: best, from: picks.from, descriptor: d,
          judgements: picks.judgements } : null;
  };

  let searched = 0;
  try {
    const rows = JSON.parse(readSetting(JUDGEMENTS_KEY) || "[]") as
      { key: string }[];
    const local = [...new Set(rows.map(r => r.key))]
      .map(key => parsePicksKey(key))
      .filter((p): p is NonNullable<typeof p> =>
        !!p && p.cacheVersion === CACHE_VERSION && !seen.has(picksKey(p.descriptor)))
      .sort((a, b) => nearness(want, a.descriptor) - nearness(want, b.descriptor));
    for (const { descriptor } of local) {
      if (!alive()) return { found: null, searched, skipped: 0 };
      seen.add(picksKey(descriptor));
      const found = await tryOne(descriptor, true);
      if (found) return { found, searched, skipped: 0 };
    }
  } catch { /* a torn local store is no judgements, not an error */ }

  if (!base) return { found: null, searched, skipped: 0 };
  let ordered: RunDescriptor[] = [];
  try {
    const entries = await createCache({ base, token }).catalogue("picks/", 200);
    ordered = entries
      .map(e => parsePicksKey(e.key))
      .filter((p): p is NonNullable<typeof p> =>
        !!p && p.cacheVersion === CACHE_VERSION && !seen.has(picksKey(p.descriptor)))
      .sort((a, b) => nearness(want, a.descriptor) - nearness(want, b.descriptor))
      .map(p => p.descriptor);
  } catch {
    return { found: null, searched, skipped: 0 };
  }
  const skipped = Math.max(0, ordered.length - ANYWHERE_LIMIT);
  for (const d of ordered.slice(0, ANYWHERE_LIMIT)) {
    if (!alive()) break;
    searched += 1;
    try {
      const found = await tryOne(d, false);
      if (found) return { found, searched, skipped };
    } catch { /* one unreadable artifact must not end the search */ }
  }
  return { found: null, searched, skipped };
}

/**
 * What the shelf has for the parameters in the form, found WITHOUT the engine.
 *
 * The fit's own best-fit lookup happens inside fitAt, which is behind
 * `generate` — so before this, a ★ best could never save anybody the Pyodide
 * boot it was stored to make unnecessary. This runs on load and on every
 * parameter change, reads `picks/v3/…` (a public GET; no token needed), and
 * draws the stored ring straight away.
 *
 * `substitute` marks a ring belonging to a DIFFERENT parameter set — the k = 0
 * default, or the nearest set anywhere on the shelf. It is never silently
 * adopted into the form: a diagram captioned with parameters it does not belong
 * to is the one thing this page must not do, so the card names the set it came
 * from and offers a button that puts those parameters in the fields.
 */
type Substitute = "default" | "anywhere";
type Preload =
  | { state: "off" }
  | { state: "looking"; where: string }
  | { state: "shown"; stage: Stage; judgement: Judgement; from: string;
      descriptor: RunDescriptor; substitute: Substitute | null }
  | { state: "ringless"; chooser: string }
  | { state: "absent"; reached: boolean; searched: number; skipped: number };

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
/**
 * The ring with every manually-placed band's arms moved to its knobs.
 *
 * Lifted out of the drawing code so that the diagram and the ring that gets
 * APPLIED are produced by one function. Two spellings of "where the knobs put
 * the arms" would drift, and the first symptom would be a preview of a ring
 * that is not the one adopted — which is the failure this page exists to not
 * have. `tint` is the only thing the diagram wants and the applied ring does
 * not: colouring is a reading aid, not geometry.
 */
function movedStrands(bands: FigureBand[], stage: Stage, tint: boolean) {
  const moved = new Map<string, { start: { x: number; y: number };
                                  end: { x: number; y: number };
                                  colour: ReturnType<typeof rgbaOf> | null }>();
  let focus: { inputs: FitBand; swept: ReturnType<typeof sweepAngle> } | null = null;
  for (const band of bands) {
    const starts = placeStarts(band.inputs, band.ext);
    const swept = sweepAngle(band.inputs, starts, band.angle);
    if (band.focus) focus = { inputs: band.inputs, swept };
    band.inputs.pairIndices.forEach(([li, ri], p) => {
      const colour = tint && band.focus
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
  return { strands, focus };
}

function drawManualRing(canvas: HTMLCanvasElement, bands: FigureBand[],
                        stage: Stage, bounds: Bounds) {
  const { strands, focus } = movedStrands(bands, stage, true);
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

/**
 * One line of the run timeline: what happened, and when.
 *
 * `at` is `performance.now()` rather than a wall clock, because the only
 * question this answers is how long each step took relative to pressing Run.
 */
type Note = { at: number; message: string; kind: "page" | "engine" };

function useWorker(onProgress: (message: string) => void) {
  const ref = useRef<Worker | null>(null);
  const waiting = useRef(new Map<number, {
    resolve: (value: any) => void; reject: (error: Error) => void; type: string;
  }>());
  const next = useRef(1);
  const [progress, setProgress] = useState("");
  // Held in a ref so the message handler is installed once and still calls the
  // caller's latest callback — re-installing it per render would drop replies.
  const report = useRef(onProgress);
  report.current = onProgress;

  useEffect(() => {
    // The version is not decoration. This file lives in public/ and is served
    // under a stable URL, so without it a browser keeps yesterday's worker and
    // answers today's page with it — and a message type added since is dropped
    // on the floor. That is what made "Open the knobs · no search" hang: the
    // cached worker had no fit-plan-now. BUMP THIS whenever the worker's
    // message vocabulary changes. src/mxn-lab/weave-studio.tsx does the same.
    const worker = new Worker(
      new URL(`${BASE}mxn/exact-worker.js?v=trace-plan-v25`, window.location.href),
      { type: "module" });
    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === "progress") {
        const message = String(data.message ?? "");
        setProgress(message);
        // Every one of these, kept. The engine reports its boot and its search
        // in detail and the page used to show only the latest, behind a status
        // line that outranked it — so the longest wait on the page looked like
        // a frozen string. The timeline is that stream, timestamped.
        report.current(message);
        return;
      }
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
  /**
   * The run timeline — what the page and the engine did, and when.
   *
   * Built because "it is still working" was the only thing a slow run could
   * say. The engine reports its Pyodide boot, its numpy load and each level it
   * calculates; the page knew all of it and drew none, because the status line
   * outranked the progress line. On a 2×1 the search is a second and the BOOT
   * is the wait, which is exactly the distinction a single frozen string
   * cannot make.
   */
  const [timeline, setTimeline] = useState<Note[]>([]);
  const clock = useRef(0);
  /** Start the clock, and drop whatever the last run left. */
  const restartClock = useCallback(() => {
    clock.current = performance.now();
    setTimeline([]);
  }, []);
  const note = useCallback((message: string, kind: Note["kind"] = "page") => {
    setTimeline(rows => {
      // The engine repeats a line while it works; a timeline of one message
      // 200 times is a worse answer than one line with a count.
      const last = rows[rows.length - 1];
      if (last && last.message === message && last.kind === kind) return rows;
      return [...rows, { at: performance.now() - clock.current, message, kind }];
    });
  }, []);
  const fromEngine = useCallback((message: string) => note(message, "engine"), [note]);

  const { ask, progress } = useWorker(fromEngine);
  // Read once, at the first render, so the preload below asks the shelf about
  // the parameters the URL named rather than about the defaults and then again
  // about the real ones a tick later.
  const [asked] = useState(askedFor);
  const [m, setM] = useState(asked.m ?? 2);
  const [n, setN] = useState(asked.n ?? 1);
  const [ksText, setKsText] = useState(asked.ksText ?? "1");
  const [hand, setHand] = useState<"lh" | "rh">(asked.hand ?? "lh");
  const [direction, setDirection] = useState<"cw" | "ccw">(asked.direction ?? "cw");
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

  // What the shelf already holds for the parameters in the form, before any
  // engine is asked. See the Preload type for why this exists.
  const [preload, setPreload] = useState<Preload>({ state: "off" });

  /**
   * Where the ring in the editor came from, and which parameter set it is about.
   *
   * Two things depend on knowing: a run the reader started themselves is never
   * replaced by a preload landing behind it, and a verdict is only offered when
   * the ring on screen belongs to the parameters in the form — filing a
   * judgement about one parameter set under another's key would be the page
   * telling the shelf something untrue.
   */
  type Editor = { from: "run" | "preload" | "fast"; key: string; descriptor: RunDescriptor;
                  /** The source the loaded judgement carried, when off the shelf. */
                  source?: JudgementSource };
  const [editor, setEditor] = useState<Editor | null>(null);
  // Mirrored so the preload effect can read it without listing it as a dep —
  // depending on it would re-run the whole lookup every time the editor moved.
  const editorRef = useRef<Editor | null>(editor);
  editorRef.current = editor;

  /** Every judgement anyone has made about the parameter set in the form. */
  const loadPicks = (): Promise<Picks> => readPicks(
    { m, n, ks, hand, direction, ...DESCRIPTOR_FLAGS },
    apiUrl.trim(), apiToken.trim());

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
   * Put a judged ring straight into the editor, with no engine anywhere.
   *
   * Every function behind the manual panel — placeStarts, sweepAngle, readAt,
   * followPair, fixOthers, and fitCandidates too — takes a FitBand and nothing
   * else. So the only reason editing a judged ring ever needed a run was that
   * the FitBand itself came from `bridge.fit_plan`, behind the browsing session
   * only `generate` opens. A judgement carrying its own plan needs none of it:
   * this is fitAt's setup with every `ask()` deleted.
   *
   * There is no "engine's own ring" in this mode, because no engine ran. The
   * judged ring IS the baseline — it is what the knobs reset to and what the
   * before/after card measures against — and the card is titled to say so
   * rather than claiming the engine drew it.
   *
   * What this cannot do is weave: only the engine rebuilds a ring and counts
   * its crossings, so *weave and audit* stays disabled until a Run has opened a
   * session. Everything else — the knobs, the live readouts, the diagram, the
   * candidate table — is live either way.
   */
  const openFromPreload = (f: Found): boolean => {
    const got = f.judgement.plan as Plan | undefined;
    if (!got || (!got.h && !got.v)) return false;
    const level = f.stage.level;
    const stage: Stage = { ...f.stage, k: got.k, label: "judged" };
    const lengths = {
      h: got.h?.unavailable ? [] : measure(stage.strands, got.h.names),
      v: got.v?.unavailable ? [] : measure(stage.strands, got.v.names),
    };
    // Where the judged ring holds each band, recovered off the ring itself —
    // the same `heading` the run path uses, for the same reason.
    const heldNow: Record<BandKey, ManualBand | null> = { h: null, v: null };
    for (const key of BANDS) {
      const inputs = got[key];
      if (!inputs || inputs.unavailable) continue;
      const angle = heading(stage.strands, inputs.names) ?? inputs.appliedAngle;
      if (angle !== null) heldNow[key] = { ext: [...inputs.applied], angle };
    }
    const a = f.judgement.audit;
    const row: AuditRow = {
      level, k: got.k, expected: a?.expected ?? 0, across: a?.crossings ?? 0,
      within: 0, masks: 0, stray: a?.stray ?? 0, broken: a?.broken ?? 0,
      healthy: !!a && a.crossings >= a.expected && a.stray === 0 && a.broken === 0,
      ext: [],
    };
    const woven: Woven = {
      level, crossings: row.across, row, strands: stage.strands,
      h: { ext: heldNow.h?.ext ?? [], angle: heldNow.h?.angle ?? null },
      v: { ext: heldNow.v?.ext ?? [], angle: heldNow.v?.angle ?? null },
    };
    const attempt: Attempt = { h: null, v: null, woven, lengths,
                               accepted: row.healthy, audited: !!a };
    const lists: Record<BandKey, Candidate[]> = { h: [], v: [] };
    for (const key of BANDS) {
      const inputs = got[key];
      if (!inputs || inputs.unavailable || isFlush(lengths[key])) continue;
      lists[key] = fitCandidates(inputs);
    }
    setFitLevel(level);
    setPlan(got);
    setStages([stage]);
    setAllStages([stage]);
    setAuditRows([row]);
    setBefore({ stage, lengths, woven });
    setAfter(attempt);
    setOrigin({ kind: "judged", verdict: "best", chooser: f.judgement.chooser,
                from: f.from });
    // No candidate was woven to get here — the ring was read. An empty list is
    // the true tally, and it also keeps the "what the audit said" panel closed,
    // which would otherwise log a weave that never happened.
    setAttempts([]);
    setCandidates(lists);
    setHeld(heldNow);
    setManual({
      h: heldNow.h ? { ext: [...heldNow.h.ext], angle: heldNow.h.angle } : null,
      v: heldNow.v ? { ext: [...heldNow.v.ext], angle: heldNow.v.angle } : null,
    });
    setTouched({ h: false, v: false });
    setAnchor({ h: 0, v: 0 });
    setFollowNote(""); setMismatch("");
    setPicks({ judgements: f.judgements, from: f.from, reached: true });
    setEditor({ from: "preload", key: picksKey(f.descriptor), descriptor: f.descriptor,
                source: f.judgement.source });
    setFailed(false);
    return true;
  };

  /**
   * Open the knobs on the typed parameters, without letting the search run.
   *
   * The band plan is the SPACE the search walks — pair origins and directions,
   * the arms' targets, the extension grid, the angle window, the gap bounds —
   * and none of it is a result of walking it. `bridge.fit_plan_now` grabs it at
   * the hook and stops the level there.
   *
   * Measured on this repo's engine: 0.13 s for a 4×1, against 280 s for the
   * generate `Run` waits on. Same plan, to the byte. What is given up is the
   * engine's own pick and its audit — so this opens with the arms where
   * `build_level_one` left them, no before/after comparison, and weaving still
   * behind Run. Everything the hand actually touches is live.
   */
  const openWithoutSearching = async () => {
    if (!ks.length) { setStatus("Give at least one k."); setFailed(true); return; }
    setBusy(true); setFailed(false);
    restartClock();
    note(`Knobs requested without a search · ${m}×${n} · k=${ks.join(", ")}`);
    setStatus("Reading the two bands — no search…");
    try {
      const began = performance.now();
      const got = await ask(
        { type: "fit-plan-now", m, n, ks, hand, direction }, "fit-plan-now-ready",
      ) as Plan & { strands: Strand[] };
      const secs = (performance.now() - began) / 1000;
      note(`Bands read in ${secs.toFixed(2)}s — the search was never run`);
      const level = got.level ?? 1;
      const stage: Stage = { level, k: got.k, label: "unsearched",
                             strands: got.strands };
      const lengths = {
        h: got.h?.unavailable ? [] : measure(stage.strands, got.h.names),
        v: got.v?.unavailable ? [] : measure(stage.strands, got.v.names),
      };
      const heldNow: Record<BandKey, ManualBand | null> = { h: null, v: null };
      for (const key of BANDS) {
        const inputs = got[key];
        if (!inputs || inputs.unavailable) continue;
        // No engine pick to quote, so the heading comes off the ring being
        // drawn — which is the page's preferred source anyway.
        const angle = heading(stage.strands, inputs.names) ?? inputs.appliedAngle;
        if (angle !== null) heldNow[key] = { ext: [...inputs.applied], angle };
      }
      const lists: Record<BandKey, Candidate[]> = { h: [], v: [] };
      for (const key of BANDS) {
        const inputs = got[key];
        if (!inputs || inputs.unavailable || isFlush(lengths[key])) continue;
        lists[key] = fitCandidates(inputs);
      }
      note(`${lists.h.length + lists.v.length} flush candidates solved in the page`);
      const d: RunDescriptor = { m, n, ks, hand, direction, ...DESCRIPTOR_FLAGS };
      setFitLevel(level);
      setPlan(got);
      setStages([stage]); setAllStages([stage]);
      // No search means no audit — and an audit row invented here would be the
      // page asserting a ring closes when nothing checked it.
      setAuditRows([]);
      setBefore({
        stage, lengths,
        woven: { level, crossings: 0, strands: stage.strands,
                 row: { level, k: got.k, expected: 0, across: 0, within: 0,
                        masks: 0, stray: 0, broken: 0, healthy: false, ext: [] },
                 h: { ext: heldNow.h?.ext ?? [], angle: heldNow.h?.angle ?? null },
                 v: { ext: heldNow.v?.ext ?? [], angle: heldNow.v?.angle ?? null } },
      });
      setAfter(null); setOrigin(null); setAttempts([]);
      setCandidates(lists);
      setHeld(heldNow);
      setManual({
        h: heldNow.h ? { ext: [...heldNow.h.ext], angle: heldNow.h.angle } : null,
        v: heldNow.v ? { ext: [...heldNow.v.ext], angle: heldNow.v.angle } : null,
      });
      setTouched({ h: false, v: false }); setAnchor({ h: 0, v: 0 });
      setFollowNote(""); setMismatch("");
      setEditor({ from: "fast", key: picksKey(d), descriptor: d, source: "hand" });
      setStatus(`Knobs open in ${secs.toFixed(2)}s — the search never ran. `
        + "Move the arms; press Run when you want the engine's own ring, its "
        + "audit, and the ability to weave.");
    } catch (error) {
      note("Reading the bands failed");
      setStatus(error instanceof Error ? error.message : String(error));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Look for a drawable ★ best on load, and on every parameter change.
   *
   * Deliberately the ONLY place on this page that reads the shelf without the
   * worker having been spoken to: no `postMessage` is sent, so Pyodide never
   * boots. Three rungs, nearest first, and the first that answers is drawn:
   *
   *   1. the typed parameters
   *   2. the k = 0 default for the same size and hand
   *   3. the nearest judged ★ best ANYWHERE on the shelf
   *
   * Rung 3 is what keeps a full run from ever being the only way to see a ring.
   * A 4×1 is 194,502 extension combinations against a 2×2's 2,646 — tens of
   * minutes of Pyodide — so pressing Run for one has to be a choice, and a page
   * that offered nothing else was not really offering one.
   *
   * The lookup is debounced because `k sequence` is a text field, and it is
   * guarded by a token because the answers can land out of order — a slow reply
   * about parameters that have since been typed over must not overwrite a fast
   * reply about the ones on screen. The same token stops rung 3's walk.
   */
  const preloadRun = useRef(0);
  useEffect(() => {
    const mine = preloadRun.current + 1;
    preloadRun.current = mine;
    if (!ks.length) { setPreload({ state: "off" }); return; }
    const wanted: RunDescriptor = { m, n, ks, hand, direction, ...DESCRIPTOR_FLAGS };
    const base = apiUrl.trim();
    const token = apiToken.trim();
    const timer = setTimeout(async () => {
      const current = () => mine === preloadRun.current;
      const look = async (d: RunDescriptor) => {
        const found = await readPicks(d, base, token);
        const best = found.judgements.find(j => j.verdict === "best") ?? null;
        return { picks: found, best, stage: best ? stageOfJudgement(best) : null };
      };
      const show = (f: Found, substitute: Substitute | null) => {
        setPreload({
          state: "shown", stage: f.stage, judgement: f.judgement, from: f.from,
          descriptor: f.descriptor, substitute,
        });
        // And straight into the editor, when the judgement carries its plan.
        // A run the reader started is never replaced, and a ring already open
        // is never reloaded — that would throw away knobs somebody had moved.
        const open = editorRef.current;
        if (open?.from === "run") return;
        if (open?.key === picksKey(f.descriptor)) return;
        openFromPreload(f);
      };
      setPreload({ state: "looking", where: "for a judged ★ best" });
      const began = performance.now();
      try {
        const asked = await look(wanted);
        if (!current()) return;
        if (asked.best && asked.stage) {
          show({ stage: asked.stage, judgement: asked.best, from: asked.picks.from,
                 descriptor: wanted, judgements: asked.picks.judgements }, null);
          return;
        }
        const spare = defaultOf(wanted);
        const tried = [picksKey(wanted)];
        if (picksKey(spare) !== picksKey(wanted)) {
          const other = await look(spare);
          if (!current()) return;
          if (other.best && other.stage) {
            show({ stage: other.stage, judgement: other.best, from: other.picks.from,
                   descriptor: spare, judgements: other.picks.judgements }, "default");
            return;
          }
          tried.push(picksKey(spare));
        }
        setPreload({ state: "looking", where: "for any judged ★ best on the shelf" });
        const anywhere = await bestFromAnywhere(wanted, base, token, tried, current);
        if (!current()) return;
        if (anywhere.found) {
          note(`Preload: nearest best anywhere, in ${
            ((performance.now() - began) / 1000).toFixed(2)}s — `
            + `${nameOf(anywhere.found.descriptor)}`);
          show(anywhere.found, "anywhere");
          return;
        }
        // A best that carries no ring is a different answer from no best at
        // all: one of them means "press Run and it will load", the other means
        // "press Run and it will search".
        if (asked.best) { setPreload({ state: "ringless", chooser: asked.best.chooser }); return; }
        setPreload({ state: "absent", reached: asked.picks.reached,
                     searched: anywhere.searched, skipped: anywhere.skipped });
      } catch {
        if (current()) {
          setPreload({ state: "absent", reached: false, searched: 0, skipped: 0 });
        }
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [m, n, ks, hand, direction, apiUrl, apiToken]);

  /** The preloaded ring's own frame — it has no run to share one with. */
  const preloadBounds = useMemo<Bounds | null>(
    () => preload.state === "shown" ? allBounds([preload.stage]) : null, [preload]);

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
    setFollowNote("");    try {
      const level = target;
      // Everything below asks the engine about a session `generate` opened. A
      // run served from the cache drew its diagrams without one, so the wait
      // happens here — and says so, because on a cache hit it is the whole of
      // what the reader is waiting for.
      const engine = session.current;
      const waitBegan = performance.now();
      if (engine && !engine.primed) {
        note(`Blocked on the browsing session before L${level} can be fitted`);
        setStatus("The cached run is drawn; waiting for the engine to open the "
          + "browsing session that fitting reads…");
      }
      await engine?.ready;
      if (engine && !engine.primed) {
        note(`Session wait: ${((performance.now() - waitBegan) / 1000).toFixed(1)}s`);
      }
      setStatus(`Reading L${level}'s two bands…`);
      const planBegan = performance.now();
      const got: Plan = await ask({ type: "fit-plan", level }, "fit-plan-ready");
      note(`fit-plan L${level} read in ${((performance.now() - planBegan) / 1000).toFixed(1)}s`);
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
      const picksBegan = performance.now();
      const shelf = await loadPicks();
      note(`Judgements read from ${shelf.from} in `
        + `${((performance.now() - picksBegan) / 1000).toFixed(2)}s — `
        + `${shelf.judgements.length} for these parameters`);
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
          audited: true,
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
          const attempt: Attempt = { h, v, woven, lengths, accepted: ok, audited: true };
          tried.push(attempt);
          setAttempts([...tried]);
          if (ok) { accepted = attempt; break outer; }
        }
      }
      note(`Candidate walk: ${tried.length} woven, `
        + `${accepted ? "one accepted" : "none accepted"}`);
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
    restartClock();
    note(`Run pressed · ${m}×${n} · k=${ks.join(", ")} · ${hand} · ${direction}`);
    try {
      // `generate` is the expensive half of a run — Pyodide boots and the exact
      // solver walks — and it is a pure function of the descriptor, so it is
      // exactly what a cache is for. The fitter's own descriptor is asked for
      // by key, and a MISS is written back, because the runs already on the
      // shelf were computed under different flags (`s1-e5-b100000000`) and
      // would never match the fitter's (`s1-eauto-b400000`). Without the write
      // the read could never hit and the cache would be decoration.
      const d: RunDescriptor = { m, n, ks, hand, direction, ...DESCRIPTOR_FLAGS };
      // From here the editor is the run's, and a preload landing behind it must
      // not take it back.
      setEditor({ from: "run", key: picksKey(d), descriptor: d });
      const shelf = apiUrl.trim()
        ? createCache({ base: apiUrl.trim(), token: apiToken.trim() }) : null;
      let result: { stages?: Stage[]; rows?: AuditRow[] } | null = null;
      if (!shelf) note("No worker url — the shelf is not consulted");
      if (shelf) {
        setStatus("Looking for a cached run…");
        note(`Asking the shelf for run/${runKey(d)}`);
        try {
          const artifact = await shelf.getRun(d);
          note(artifact?.result
            ? `Cached run HIT — computed ${artifact.computedAt.slice(0, 10)}`
              + `${artifact.seconds ? `, cost ${artifact.seconds.toFixed(1)}s then` : ""}`
            : "Cached run MISS — the engine has to compute it");
          if (artifact?.result) {
            result = artifact.result as { stages?: Stage[]; rows?: AuditRow[] };
            // The diagrams come free; the FITTING does not. The artifact holds
            // what the run returned, and fit_plan/fit_weave read what it left
            // in the engine, so the session is opened here and waited for in
            // fitAt — the levels are on screen while it boots.
            // THE thing a reader needs to see: the drawing is free and the
            // session is not. A cache hit still pays a whole generate here,
            // because fit_plan reads engine state the artifact does not hold.
            note("Levels drawn from the cache. Opening the browsing session — "
              + "this runs generate again, and it is the wait");
            openSession(d).then(
              () => note("Browsing session open — fitting can read its plan"),
              () => note("The session failed to open"));
            setStatus(`Cached run from ${artifact.computedAt.slice(0, 10)} — drawn without `
              + "the engine, which is now opening the session that fitting reads.");
          }
        } catch { /* a miss and an absent shelf are the same thing here */ }
      }
      if (result === null) {
        setStatus("Running the engine…");
        note("Running generate in the browser — Pyodide boots first, then the "
          + "exact search walks");
        const began = Date.now();
        // This generate IS the session — the run and the state fitting reads
        // are the same call — so it is registered rather than repeated.
        const computed = await openSession(d) as { stages?: Stage[]; rows?: AuditRow[] };
        result = computed;
        const seconds = (Date.now() - began) / 1000;
        note(`generate finished in ${seconds.toFixed(1)}s`);
        // Writing needs the token; reading does not. A failed write costs the
        // next run its speed-up and nothing else, so it is never fatal.
        if (shelf && apiToken.trim()) {
          try {
            await shelf.putRun({
              kind: "run", cacheVersion: CACHE_VERSION, descriptor: d,
              computedAt: new Date().toISOString(), seconds, result: computed,
            });
            note("Run written back to the shelf, so the next one reads it");
          } catch { note("Writing the run to the shelf failed"); }
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
    return all.length ? allBounds(all) : null;
  }, [stages, after, fitLevel]);

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
  };

  const resetManual = (key: BandKey, source: "engine" | "fitted") => {
    const target = source === "fitted"
      ? (after ? (key === "h" ? after.h : after.v) : null) ?? held[key]
      : held[key];
    if (!target) return;
    setManual(current => ({ ...current, [key]: { ext: [...target.ext], angle: target.angle } }));
    setTouched(current => ({ ...current, [key]: source === "fitted" }));
    setFollowNote("");
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

  /**
   * Apply the knobs: the ring you just made becomes the fitted ring.
   *
   * This used to be two presses behind the engine — *weave and audit*, then
   * *adopt as fitted* — and in the no-search mode there is no session, so the
   * first was permanently disabled and the second could never light. A hand
   * that had finished placing the arms had nowhere to put them.
   *
   * It needs no engine, because the ring is not in doubt: `movedStrands` is the
   * same arithmetic the diagram beside the knobs is already drawing, so what
   * lands in the "after" card is exactly the picture that was on screen. What
   * IS in doubt is whether the ring still closes, and that only `fit_weave` can
   * say — so the attempt is marked unaudited, the audit reads `—` rather than a
   * zeroed row, and when a session exists the engine is asked in the background
   * and the real count replaces it when it arrives. No button for that: a
   * verdict that can be fetched should not need to be requested.
   */
  const applyKnobs = async () => {
    if (!plan || !before) return;
    const bands: FigureBand[] = BANDS.flatMap(key => {
      const inputs = plan[key];
      const knobs = (touched[key] && manual[key]) || held[key];
      if (!inputs || inputs.unavailable || !knobs) return [];
      return [{ inputs, ext: knobs.ext, angle: knobs.angle, focus: false }];
    });
    if (!bands.length) return;
    const { strands } = movedStrands(bands, before.stage, false);
    const lengths = {
      h: plan.h?.unavailable ? [] : measure(strands, plan.h.names),
      v: plan.v?.unavailable ? [] : measure(strands, plan.v.names),
    };
    const asCandidate = (key: BandKey): Candidate | null => {
      const inputs = plan[key];
      const knobs = (touched[key] && manual[key]) || held[key];
      if (!inputs || inputs.unavailable || !knobs) return null;
      const r = readAt(inputs, knobs.ext, knobs.angle);
      return {
        ext: [...knobs.ext], angle: knobs.angle, star: r.lengths[0] ?? 0,
        lengths: r.lengths, gaps: r.gaps, margin: r.margin, delta: r.delta,
        totalExt: knobs.ext.reduce((a, b) => a + b, 0),
      };
    };
    const blank: AuditRow = {
      level: fitLevel, k: plan.k, expected: 0, across: 0, within: 0, masks: 0,
      stray: 0, broken: 0, healthy: false, ext: [],
    };
    const applied: Attempt = {
      h: asCandidate("h"), v: asCandidate("v"),
      woven: {
        level: fitLevel, crossings: 0, row: blank, strands,
        h: { ext: asCandidate("h")?.ext ?? [], angle: asCandidate("h")?.angle ?? null },
        v: { ext: asCandidate("v")?.ext ?? [], angle: asCandidate("v")?.angle ?? null },
      },
      lengths, accepted: true, audited: false,
    };
    setAfter(applied);
    setOrigin({ kind: "manual" });
    setFailed(false);
    note("Knobs applied — the ring on screen is the fitted ring");
    const engine = session.current;
    if (!engine) {
      setStatus("Applied. This is your ring — measured off the strands the "
        + "diagram drew. Nothing has audited it; press Run if you want the "
        + "engine to count its crossings.");
      return;
    }
    // A session exists, so the count is free to ask for. The ring is already on
    // screen; this only fills in the one number the page cannot work out.
    setStatus("Applied. Asking the engine to count its crossings…");
    try {
      await engine.ready;
      const woven = await ask({
        type: "fit-weave", level: fitLevel,
        hExt: applied.h?.ext ?? null, hAngle: applied.h?.angle ?? null,
        vExt: applied.v?.ext ?? null, vAngle: applied.v?.angle ?? null,
      }, "fit-weave-ready") as Woven;
      const ok = !!woven.row?.healthy;
      setAfter(current => current === applied
        ? { ...applied, woven, audited: true, accepted: ok,
            lengths: {
              h: plan.h?.unavailable ? [] : measure(woven.strands, plan.h.names),
              v: plan.v?.unavailable ? [] : measure(woven.strands, plan.v.names),
            } }
        : current);
      note(`Audited: ${woven.row.across}/${woven.row.expected} crossings`);
      setStatus(`Applied — and the engine counts ${woven.row.across}/`
        + `${woven.row.expected} crossings${ok ? ", so the ring closes" : ", so it does not close"}.`);
      setFailed(!ok);
    } catch {
      // The ring stays; only its verdict is missing, and that is what it says.
      note("The engine refused to weave it; the ring stands, unaudited");
      setStatus("Applied. The engine would not weave this configuration, so it "
        + "stays unaudited — the ring on screen is still exactly your knobs.");
    }
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
        accepted: !!woven.row?.healthy, audited: true,
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
  const judgedSource: JudgementSource = origin?.kind === "manual" ? "hand"
    // Untouched off the shelf, the geometry is the one that was already judged,
    // so it keeps the source it was judged under rather than claiming this
    // page's fitter produced it.
    : editor?.from === "preload" && editor.source ? editor.source
    : after ? "fitter" : "engine";

  const saveJudgement = async (verdict: Verdict) => {
    if (!plan || !before) return;
    const name = chooser.trim();
    if (!name) {
      setStatus("A verdict has one author, and it is a person — put a name in the chooser field.");
      setFailed(true);
      return;
    }
    const attempt = after;
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
      // And the band plan it was fitted against. Strands make the judgement
      // drawable with no engine; this makes it EDITABLE with no engine — the
      // manual panel is arithmetic over exactly these inputs, and the only
      // reason moving a judged ring ever needed a run was that the inputs
      // themselves came from bridge.fit_plan, behind a browsing session.
      plan,
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
    // The RING's parameters, not the form's: in preload mode the two can
    // differ, and a file named for what was typed rather than what it holds is
    // the same lie as a caption naming the wrong set.
    const d = editor?.descriptor ?? descriptor;
    const name = `mxn-${d.m}x${d.n}-k${d.ks.join("_")}-${d.hand}-${d.direction}-L${fitLevel}`;
    saveJson(`${name}-${today()}.json`, source ? source.woven.strands : before.stage.strands);
    saveJson(`${name}-${today()}.fit.json`, {
      params: { m: d.m, n: d.n, ks: d.ks, hand: d.hand, direction: d.direction },
      source: editor?.from === "preload" ? "judged ring read from the shelf" : "run",
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
      // The hand's own configuration, when a hand is what placed the ring.
      // `audited` says whether an engine ever counted its crossings — an
      // applied ring is real geometry either way, but only one of the two has
      // a verdict, and an export that blurred them would be worse than one
      // that omitted it.
      manual: origin?.kind === "manual" && after ? {
        applied: true,
        audited: after.audited,
        h: after.h ? { ext: after.h.ext, angle: after.h.angle } : "held",
        v: after.v ? { ext: after.v.ext, angle: after.v.angle } : "held",
        lengths: after.lengths,
        audit: after.audited ? after.woven.row : null,
      } : null,
    });
  };

  // The audit on screen, or nothing. In the no-search mode there IS no audit —
  // the baseline is a ring the engine never graded — and quoting its zeroed row
  // would read as "0 of 0 crossings, 0 stray", which is the page asserting a
  // check it never made. Weaving fills this in for real.
  // An applied ring carries a zeroed row until an engine counts it, so the
  // audit follows `audited` rather than the row's mere existence. Same rule as
  // the no-search baseline: no check made, nothing quoted.
  const health = (after?.audited ? after.woven.row : null)
    ?? (after ? null : editor?.from === "fast" ? null : before?.woven.row)
    ?? null;

  /** One parameter set, as a person reads it. */
  const nameOf = (d: RunDescriptor) => `${d.m}×${d.n} · k=${d.ks.join(", ")}`
    + ` · ${d.hand.toUpperCase()} · ${d.direction.toUpperCase()}`;

  /** The ring in the editor came off the shelf, not out of a run. */
  const fromShelf = editor?.from === "preload";
  /**
   * Whether a verdict may be written about what is on screen.
   *
   * A judgement is addressed by the parameters in the form, so offering one
   * about a ring belonging to a DIFFERENT set would file a true statement under
   * a false key. Adopting the substitute's parameters is what unlocks it, and
   * the runbar carries the button that does.
   */
  const judgeable = !fromShelf || editor?.key === picksKey(descriptor);
  /** Only the engine can weave, and only a run opens the session it needs. */
  const canWeave = !!session.current;

  /** What the shelf lookup found, in one line, beside the button it is about. */
  const preloadLine = (() => {
    switch (preload.state) {
      case "looking":
        return `Looking ${preload.where}…`;
      case "shown":
        if (preload.substitute === null) {
          return `★ best loaded from ${preload.from} — judged by ${
            preload.judgement.chooser}, drawn from the ring stored with the `
            + "judgement. No engine was run.";
        }
        return `No ★ best for these parameters. Showing ${
          preload.substitute === "default" ? "the k = 0 default"
            : "the nearest judged ring on the shelf"}, ${
          nameOf(preload.descriptor)} — judged by ${
          preload.judgement.chooser}, drawn without the engine.`;
      case "ringless":
        return `${preload.chooser} marked a ★ best for these parameters, but it was `
          + "saved before rings were stored with judgements — Run will weave it.";
      case "absent":
        return preload.reached
          ? "Nothing has been judged ★ best anywhere on the shelf"
            + `${preload.searched ? ` — ${preload.searched} parameter set${
              preload.searched === 1 ? "" : "s"} read${
              preload.skipped ? `, ${preload.skipped} more not read` : ""}` : ""}`
            + ". Run computes one."
          : "The shelf did not answer — Run computes in this browser.";
      default:
        return "";
    }
  })();

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
                <input id="fit-m" type="number" min={1} max={MAX_FIT_SIDE} value={m}
                  onChange={e => setM(Math.max(1, Math.min(MAX_FIT_SIDE, Number(e.target.value) || 1)))} />
              </div>
              <div>
                <label className="f" htmlFor="fit-n">n</label>
                <input id="fit-n" type="number" min={1} max={MAX_FIT_SIDE} value={n}
                  onChange={e => setN(Math.max(1, Math.min(MAX_FIT_SIDE, Number(e.target.value) || 1)))} />
              </div>
            </div>
            {(m > MAX_SIDE || n > MAX_SIDE) && (
              // Said once, at the point of typing it, rather than buried in a
              // doc: the engine takes this size, and nothing else knows what
              // happens next. /mxn/ and /mxn/gpu/ both stop at 4, so there is
              // no shelf to compare against and no measured run time either.
              <p className="hint beyond">
                Past {MAX_SIDE}×{MAX_SIDE}. The engine accepts this — <code>bridge.generate</code> takes
                any m and n — but nothing has swept it: the lab and the farm both stop at {MAX_SIDE},
                so there is no cached run to compare against and no measurement of how long the
                search takes. At 4×4 the engine already picks <code>MAX_PAIR_EXTENSION</code> itself,
                so bigger may be slow, may hit the ceiling, or may not close at all. Worth trying;
                not worth assuming.
              </p>
            )}
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
            <button className="go ghost" type="button" onClick={openWithoutSearching}
              disabled={busy}
              title={"The band plan is the space the search walks, not its result — "
                + "so the knobs are ready long before the walk finishes"}>
              Open the knobs · no search
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
            {preloadLine && (
              <p className="hint preloaded" data-state={preload.state}>{preloadLine}</p>
            )}
            {status && <p className={`status${failed ? " bad" : ""}`}>{status}</p>}
            {/* The engine's own line, BESIDE the status rather than under it.
                `status || progress` meant the page's summary silently outranked
                every word the engine said, for the whole of the longest wait it
                has — the Pyodide boot, the numpy load, each level calculated. */}
            {busy && progress && <p className="status engine">⟳ {progress}</p>}
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
              {/* A judgement is addressed by the parameters in the FORM. About a
                  ring belonging to another set that would be a true statement
                  filed under a false key, so the buttons wait for the two to
                  agree — which the runbar's adopt button is there to arrange. */}
              {(["valid", "best", "rejected"] as const).map(verdict => (
                <button key={verdict} type="button"
                  className={`verdict ${verdict === "valid" ? "good"
                    : verdict === "best" ? "star" : "no"}`}
                  disabled={!before || busy || !judgeable}
                  title={judgeable ? undefined
                    : "The ring on screen belongs to another parameter set — put its "
                      + "parameters in the form, or Run these, before judging it"}
                  onClick={() => saveJudgement(verdict)}>
                  {VERDICT_GLYPH[verdict]} {verdict}
                </button>
              ))}
            </div>
            <p className="hint">
              A verdict is about the ring on screen — right now the{" "}
              <em>{judgedSource === "hand" ? "manual" : fromShelf ? "judged"
                : judgedSource === "fitter" ? "fitted" : "engine's own"}</em>{" "}
              ring. It is held in this browser first, and with a Worker configured it is
              also written to <code>picks/{picksKey(descriptor)}</code> on the shelf and as
              a row in the D1 solutions table, so <code>/mxn/rate/</code> and a{" "}
              <code>?verdict=</code> query can find it. Only a person writes one.
              {!judgeable && editor && (
                <> <b>Not right now:</b> the ring on screen is{" "}
                <code>{nameOf(editor.descriptor)}</code> and the form says{" "}
                <code>{nameOf(descriptor)}</code>. One key, one ring.</>
              )}
            </p>
          </section>
        </div>

        <div className="results">
          {/*
            The shelf's own answer, before any engine. Hidden the moment a run
            produces a plan, because from then on the page has a live ring and
            two rings captioned "best" would be one too many.
          */}
          {!plan && preload.state === "shown" && (() => {
            const j = preload.judgement;
            const d = preload.descriptor;
            const audit = j.audit;
            const closes = !!audit && audit.crossings >= audit.expected
              && audit.stray === 0 && audit.broken === 0;
            const name = nameOf(d);
            /** Put the substitute's whole parameter set in the form. */
            const adopt = () => {
              setM(d.m); setN(d.n); setKsText(d.ks.join(", "));
              setHand(d.hand as "lh" | "rh");
              setDirection(d.direction as "cw" | "ccw");
            };
            return (
              <div className="panel hero">
                <header>
                  <strong>★ best · L{preload.stage.level} · no engine</strong>
                  <span>
                    read from {preload.from} and drawn from the strands stored with{" "}
                    {j.chooser}'s judgement
                  </span>
                  <span className="spacer" />
                  {audit && (
                    <span className={`chip ${closes ? "soft" : "warn"}`}>
                      {audit.crossings}/{audit.expected} crossings
                    </span>
                  )}
                  {preload.substitute && (
                    <span className="chip warn">not your parameters</span>
                  )}
                </header>
                <div className="body">
                  <div className="rings">
                    <RingFigure title={name} stage={preload.stage} bounds={preloadBounds}
                      caption={j.metrics
                        ? `Δ ${j.metrics.neighbour_delta.toFixed(2)} px` : ""} />
                    <div>
                      <p className="note" style={{ padding: 0 }}>
                        {preload.substitute ? (
                          <>
                            Nothing has been judged <b>★ best</b> for{" "}
                            <code>{m}×{n} · k={ks.join(", ")}</code>, so this is{" "}
                            {preload.substitute === "default"
                              ? <>the <code>k = {d.ks.join(", ")}</code> default for the same
                                 size and hand</>
                              : <>the nearest judged ring on the shelf</>}{" "}
                            — <em>a different parameter set</em>, shown so there is a ring on
                            screen rather than a wait. It is not put in the form by itself;
                            the button below does that.
                          </>
                        ) : (
                          <>
                            This is the ring <em>{j.chooser}</em> judged best for exactly the
                            parameters in the form, on {j.at.slice(0, 10)}
                            {j.note ? ` — “${j.note}”` : ""}. The judgement carried the whole
                            ring, so drawing it cost one GET and no engine at all.
                          </>
                        )}
                      </p>
                      {/* Reaching this card at all means the judgement carried
                          no plan — one that does opens the editor instead of
                          being drawn here. Saying which of the two it is beats
                          leaving a reader to wonder where the knobs went. */}
                      <p className="note" style={{ padding: "10px 0 0" }}>
                        This judgement was saved before plans were stored with them, so it
                        can be <em>drawn</em> without an engine but not <em>moved</em>: the
                        knobs are arithmetic over the band plan, and only{" "}
                        <code>bridge.fit_plan</code> can produce one, behind a run.{" "}
                        <em>Run</em> opens the knobs, the candidate table and the audit — and
                        judging the ring again afterwards stores the plan, so next time it
                        opens straight into the editor.
                      </p>
                      {preload.substitute && (
                        <button type="button" className="minibtn"
                          style={{ marginTop: 10 }} onClick={adopt}>
                          put {name} in the form
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <p className="note">
                  Drawn by <code>drawExactStage</code> off <code>Judgement.strands</code> —
                  the same renderer and the same strands every other card on this page uses,
                  read from <code>picks/{picksKey(d)}</code>. Reads on that key are public, so
                  no token is involved. The numbers beside it are the ones stored with the
                  judgement rather than measured here, because there is no live weave to
                  measure: press <em>Run</em> and everything on screen is measured again off a
                  ring the engine just built.
                </p>
              </div>
            );
          })()}

          {timeline.length > 0 && (
            <div className="panel">
              <header>
                <strong>Timeline</strong>
                <span>what happened, and how long each step took</span>
                <span className="spacer" />
                <span className="chip soft">
                  {(timeline[timeline.length - 1].at / 1000).toFixed(1)}s total
                </span>
                <button type="button" className="minibtn"
                  title="Copy the timeline, to paste somewhere it can be read"
                  onClick={() => navigator.clipboard?.writeText(
                    timeline.map(r => `${(r.at / 1000).toFixed(2).padStart(7)}s  `
                      + `${r.kind === "engine" ? "engine" : "page  "}  ${r.message}`)
                      .join("\n"))}>
                  copy
                </button>
              </header>
              <div className="body scroller" style={{ padding: "0 14px" }}>
                <table className="tl">
                  <tbody>
                    {timeline.map((row, index) => {
                      // The gap from the previous line is the number that
                      // actually names the slow step; the absolute time only
                      // says where in the run it happened.
                      const took = row.at - (index ? timeline[index - 1].at : 0);
                      return (
                        <tr key={index} className={took > 2000 ? "slow" : ""}>
                          <td className="num">{(row.at / 1000).toFixed(2)}s</td>
                          <td className="num">
                            {took >= 100 ? `+${(took / 1000).toFixed(2)}s` : ""}
                          </td>
                          <td className="l">
                            <span className={`tag ${row.kind === "engine" ? "eng" : "fit"}`}>
                              {row.kind}
                            </span>
                          </td>
                          <td className="l">{row.message}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="note">
                Every line the page and the engine produced, timestamped from the moment{" "}
                <em>Run</em> was pressed. The <b>+</b> column is the gap from the line above,
                which is the one that names the slow step; rows costing more than two seconds
                are marked. <em>engine</em> rows come from the worker itself — the Pyodide
                boot, the numpy load, each level calculated — and they used to be invisible,
                because the status line outranked them.
              </p>
            </div>
          )}

          {!plan && !busy && preload.state !== "shown" && (
            <p className="note" style={{ padding: 0 }}>
              Give a size, a k and a hand, and press <em>Run and fit</em>. The engine runs in
              this browser — the first run loads it, which takes a moment. Everything after
              that is arithmetic in the page. See <a href="https://github.com/ysetbon/Scoubidou3D/blob/main/docs/mxn-fit.md">docs/mxn-fit.md</a>.
            </p>
          )}

          {plan && (
            <>
              <div className="runbar">
                {/* The ring's OWN parameters, not the form's. In preload mode
                    the two can differ, and the heading over a diagram has to
                    name the diagram. */}
                <h1>{nameOf(editor?.descriptor ?? descriptor)}</h1>
                {fromShelf
                  ? <span className="chip ok">off the shelf · no engine</span>
                  : after
                    ? <span className="chip ok">fitted · proposed</span>
                    : <span className="chip warn">not fitted</span>}
                {!judgeable && editor && (
                  <>
                    <span className="chip warn">not your parameters</span>
                    <button type="button" className="minibtn"
                      title={"Put this ring's parameters in the form, so a verdict and a "
                        + "Run are about what is on screen"}
                      onClick={() => {
                        const d = editor.descriptor;
                        setM(d.m); setN(d.n); setKsText(d.ks.join(", "));
                        setHand(d.hand as "lh" | "rh");
                        setDirection(d.direction as "cw" | "ccw");
                      }}>
                      put {nameOf(editor.descriptor)} in the form
                    </button>
                  </>
                )}
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
                              : fromShelf
                                ? "the rest of the ring is drawn as it was judged"
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
                        <button type="button" disabled={busy || !after}
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
                        {/* One press, and it needs no engine. movedStrands is
                            the same arithmetic the diagram beside these knobs is
                            already drawing, so what lands in the "after" card is
                            exactly the picture on screen. Whether the ring still
                            CLOSES is the engine's to say, and when a session
                            exists it is asked in the background — a verdict that
                            can be fetched should not need to be requested. */}
                        <button type="button" className="mgo"
                          disabled={busy || !(touched.h || touched.v)}
                          title={canWeave
                            ? "Put this ring in the after card, and ask the engine to count its crossings"
                            : "Put this ring in the after card. Nothing has audited it — "
                              + "only Run opens the session that can."}
                          onClick={applyKnobs}>
                          Apply — this is the ring
                        </button>
                      </div>
                      </div>
                      </div>
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
                    {/* No engine ran in preload mode, so the baseline is the
                        judged ring itself and the card must not claim
                        otherwise. */}
                    <RingFigure
                      title={`L${fitLevel} · ${fromShelf ? "as judged" : "engine"}`}
                      stage={before?.stage ?? null}
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
                  {fromShelf
                    ? <>Both are the ring <em>{origin?.kind === "judged" ? origin.chooser
                        : "somebody"}</em> judged, read off the shelf — no engine has run, so
                       there is no separate engine baseline to show and the left-hand card
                       says <em>as judged</em> rather than pretending to one. </>
                    : <>Both are the engine's own output, and the right-hand card names where
                       its ring came from — a person's <b>★ best</b> with the chooser who
                       judged it, a ring <em>adopted by hand</em>, or <em>fitted</em> from the
                       candidate walk. </>}
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
                                  disabled={busy || !here || !before
                                    || (!j.strands && !canWeave)}
                                  onClick={() => loadJudgement(j)}
                                  title={!here ? `This judgement does not cover L${fitLevel}`
                                    : j.strands ? `Show ${j.chooser}'s ring, as stored`
                                    : canWeave ? `Weave ${j.chooser}'s ring and show it`
                                    : "This judgement stored no ring, so showing it needs "
                                      + "a weave — press Run first"}>
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
