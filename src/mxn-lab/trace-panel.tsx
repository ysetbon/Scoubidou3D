// The trace panel: what the band search ruled out, and on which test.
//
// bridge.trace_level sends a verdict for every (combo, angle) the band could be
// asked about, including the angles outside the +/-20 degree window that the
// real search never reaches. Geometry is affine in the extensions, so only the
// census travels; the handful of points needed to draw one cell are recomputed
// here from the same inputs the engine used.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  allBounds, drawExactStage, type Bounds, type Stage, type Strand,
} from "./exact-draw";
import { bandKey } from "./trace-band";
import {
  BEST, OVERLAP, TOOFAR, VALID, VERDICT_BLURB,
  VERDICT_COLOUR, VERDICT_NAMES, WINDOW,
  comboCount, comboExt, placeStarts, sweepAngle, sweepCombo,
  type TraceInputs,
} from "./trace-census";
import { layoutFor } from "./trace-layout";

export type TracePayload = TraceInputs & {
  level: number;
  band: string;
  unavailable?: boolean;
  reason?: string;
  nStrands: number;
  verdicts: string;
  angle0: string;
  best: string;
  counts: number[];
  names: string[];
  applied: number[];
  /** The size of the job the census just did, as the plan reported it. */
  combos?: number;
  evaluations?: number;
  /** The applied combo already woven, embedded so the first view is instant. */
  weave?: TraceWeave;
};

/**
 * What the census is about to sweep, sent before it sweeps it.
 *
 * bridge.trace_plan costs the level replay alone — the census is the expensive
 * half — and carries the band search's own inputs: the extension grid it will
 * walk, its angle window and step, and the gap bounds it tests against. It is
 * what lets the pending sweep show this band rather than a drawing of one.
 */
export type TracePlan = TraceInputs & {
  level: number;
  band: string;
  unavailable?: boolean;
  reason?: string;
  nStrands: number;
  applied: number[];
  /** Combos, and combos × angles: the whole job, none of it skipped. */
  combos: number;
  evaluations: number;
  budget: number;
  overBudget: boolean;
  /** The probe combo's angle grid, and where the ±20° window sits inside it. */
  angleFrom: number;
  insideFrom: number;
  insideCount: number;
  windowLo: number;
  windowHi: number;
  sweepHalfWidth: number;
};

/** How far the worker's census has got, straight from inside the sweep. */
export type TraceProgress = {
  level: number;
  band: string;
  combosDone: number;
  combos: number;
  nAngles: number;
};

/**
 * The replay's own candidates, as the studio's frame store hands them over.
 *
 * Structural rather than imported: the studio imports this file, so a type
 * imported back from it would close a cycle for no gain. Any store whose
 * frames carry these fields will do.
 */
export type ReplayFeed = {
  get: () => ReplayFrame | null;
  subscribe: (listener: () => void) => () => void;
};
export type ReplayFrame = {
  level: number;
  phase: string;
  completed: number;
  total: number;
  /** Which band's trace replay produced it — "horizontal" or "vertical". */
  trace?: string | null;
  strands: Strand[];
};

/**
 * One traced cell, woven: the ring bridge.trace_weave materialised for a combo
 * and angle, with the audit the level card would print for it. An unavailable
 * entry is cached like a real one — the reason is its content, and a held
 * entry is what stops the panel asking for the same cell again.
 */
export type TraceWeave = {
  level: number;
  band: string;
  unavailable?: boolean;
  reason?: string;
  ext: number[];
  angle: number;
  crossings?: number;
  row?: { state: string; healthy: boolean; across: number; expected: number };
  strands?: Strand[];
};

/** One traced cell's identity, as the weave cache keys it on both sides. */
export const weaveKey = (ext: number[], angleDeg: number) =>
  `${ext.join(",")}@${angleDeg.toFixed(2)}`;

const COLOUR = VERDICT_COLOUR;
const BLURB = VERDICT_BLURB;

const SWEEP_W = 336;
const SWEEP_H = 242;

/** The verdict most of a combo's angles ended on, ignoring WINDOW. */
function modal(codes: number[]) {
  const tally = new Array(8).fill(0);
  codes.forEach(code => { if (code !== WINDOW) tally[code] += 1; });
  let best = WINDOW, top = -1;
  for (let c = 1; c < 8; c += 1) if (tally[c] > top) { top = tally[c]; best = c; }
  return best;
}

/**
 * The trace's busy state: the band being censused, swept here as it is swept
 * there.
 *
 * This used to be a schematic — three strands from a hash, a heading rocking
 * back and forth, verdicts drawn from a weighted table — which looked like
 * work without being any. It now runs on `plan`, the band search's own inputs,
 * which bridge.trace_plan sends as soon as the level replay recovers them and
 * long before the census finishes. Geometry is affine in the extensions, so
 * this walks the real combo grid, places the real arms, and applies the real
 * tests at the real angles: every cell it paints is a verdict the census will
 * paint the same colour.
 *
 * Two clocks, deliberately kept apart. The upper strip is this preview's own
 * position, which is honest about being local. The bar underneath is the
 * worker's, reported from inside the sweep, and is the one that answers how
 * much is left.
 */
export function TraceSweep({ band, level, plan, progress, replay, stage, bounds }: {
  band: "h" | "v";
  level?: number;
  /** The band's own inputs. Absent until the band search hands its grid over. */
  plan?: TracePlan;
  /** Where the worker's census has got to, if it has said yet. */
  progress?: TraceProgress;
  /** The replay's candidates, for the stretch before the plan exists. */
  replay?: ReplayFeed;
  /** The level's own ring, drawn until the first replay frame arrives. */
  stage?: Stage;
  bounds?: Bounds;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // Redrawn from refs rather than props so a message arriving mid-sweep does
  // not restart the drawing it arrives during.
  const liveProgress = useRef(progress);
  liveProgress.current = progress;
  const wantBand = band === "h" ? "horizontal" : "vertical";
  const frame = useSyncExternalStore(
    replay?.subscribe ?? (() => () => {}), replay?.get ?? (() => null));
  const liveFrame = useRef<ReplayFrame | null>(null);
  liveFrame.current = frame && frame.trace === wantBand
    && frame.level === level ? frame : null;

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return undefined;
    const slow = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const W = SWEEP_W, H = SWEEP_H;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = `${W}px`;
    cv.style.height = `${H}px`;

    const bandWord = band === "h" ? "horizontal" : "vertical";
    // Where each row of the drawing sits. Kept as constants because both
    // states — waiting for the plan, and sweeping — use the same frame.
    const VIEW = { x: 10, y: 10, w: W - 20, h: 112 };
    const CAPTION_Y = 136;
    const ANGLES_Y = 158, ANGLES_H = 12;
    const COMBOS_Y = 190, COMBOS_H = 14;
    const BAR_Y = 224, BAR_H = 9;

    const label = (text: string, x: number, y: number, colour = "#96917f",
                   weight = "600") => {
      ctx.font = `${weight} 9px ui-monospace, monospace`;
      ctx.fillStyle = colour;
      ctx.fillText(text, x, y);
    };
    const rightLabel = (text: string, y: number, colour = "#96917f") => {
      ctx.font = `600 9px ui-monospace, monospace`;
      ctx.fillStyle = colour;
      ctx.fillText(text, W - 10 - ctx.measureText(text).width, y);
    };
    const backdrop = (box: { x: number; y: number; w: number; h: number }) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#f4f0e6";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "#dcd6c8";
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    };

    let raf = 0;
    const t0 = performance.now();

    // ---- no plan yet: the band search has not handed its grid over ----
    // Not a dead box. The replay is a real search and relays its candidates,
    // so this draws the rings it is trying, at whatever rate it manages them,
    // and reports its own position. Until the first one lands it draws the
    // level's ring as it stands, which the page already has: there is no
    // moment where the widget has nothing true to show.
    if (!plan) {
      // The ring takes the room the strips will want later: nothing else is
      // known yet, and a box with a third of it blank reads as a widget that
      // failed rather than one that is waiting.
      const WAIT = { x: VIEW.x, y: VIEW.y, w: VIEW.w, h: 168 };
      const WAIT_CAPTION = 194;
      const off = document.createElement("canvas");
      let painted: Strand[] | null = null;
      const paint = (strands: Strand[]) => {
        if (painted === strands) return;
        painted = strands;
        const one: Stage = { level: level ?? 0, k: null, label: "replay",
                             strands };
        drawExactStage(off, one, bounds ?? allBounds([one]), false,
                       Math.round(WAIT.h * dpr), "#f4f0e6");
      };

      const draw = (now: number) => {
        raf = requestAnimationFrame(draw);
        const t = (now - t0) / 1000;
        const live = liveFrame.current;
        backdrop(WAIT);

        const strands = live?.strands ?? stage?.strands;
        if (strands?.length) {
          paint(strands);
          const side = WAIT.h - 8;
          ctx.drawImage(off, WAIT.x + (WAIT.w - side) / 2, WAIT.y + 4, side, side);
        }
        label(live
          ? `replaying L${level ?? ""} · ${live.phase}`
          : `replaying L${level ?? ""} · ${bandWord} band`,
          10, WAIT_CAPTION, "#7d7a70", "700");
        rightLabel(live && live.total > 0
          ? `${live.completed.toLocaleString()} / ${live.total.toLocaleString()} combos`
          : "the ring as it stands", WAIT_CAPTION);
        if (!live) label("waiting for the search to start", 10, WAIT_CAPTION + 12);

        ctx.fillStyle = "#e6e1d4";
        ctx.fillRect(10, BAR_Y, W - 20, BAR_H);
        if (live && live.total > 0) {
          // The replay's own search, which is a real fraction of a real total.
          ctx.fillStyle = "#c8c2b4";
          ctx.fillRect(10, BAR_Y, (W - 20) * Math.min(1, live.completed / live.total),
                       BAR_H);
          label("replaying…", 10, BAR_Y - 5);
          rightLabel("then the census over its grid", BAR_Y - 5);
        } else {
          // A shuttle, not a fill: with no position yet it must not read as a
          // fraction of anything.
          const span = (W - 20) * 0.28;
          const travel = (W - 20) - span;
          const phase = (t / (slow ? 4 : 2.2)) % 2;
          ctx.fillStyle = "#c8c2b4";
          ctx.fillRect(10 + travel * (phase < 1 ? phase : 2 - phase), BAR_Y,
                       span, BAR_H);
          label("replaying…", 10, BAR_Y - 5);
          rightLabel("no position reported yet", BAR_Y - 5);
        }
      };
      raf = requestAnimationFrame(draw);
      return () => cancelAnimationFrame(raf);
    }

    // ---- the band itself ----
    const nCombos = comboCount(plan);
    // The ±20° window: the angles the real search actually visits. The census
    // sweeps 40° past it on each side to show what it rules out; a preview of
    // the search itself has no reason to.
    const angles = Array.from({ length: plan.insideCount },
      (_, j) => plan.angleFrom + (plan.insideFrom + j) * plan.step);
    const verdicts = new Uint8Array(nCombos);      // 0 = not previewed yet
    const appliedIdx = (() => {
      if (!plan.applied?.length) return -1;
      let idx = 0;
      plan.applied.forEach(e => {
        idx = idx * plan.vals.length + Math.max(0, plan.vals.indexOf(e));
      });
      return idx < nCombos ? idx : -1;
    })();

    let cursor = 0;
    let shownIdx = 0;
    let shown = sweepCombo(plan, 0, angles);
    let shownAt = 0;
    // The preview must never be the reason the page stutters: the worker is
    // the thing doing the real work. One frame's batch is whatever fits in a
    // slice of a frame, measured rather than guessed.
    const SLICE_MS = slow ? 2 : 5;
    const SHOW_EVERY = slow ? 700 : 110;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (cursor < nCombos) {
        const until = performance.now() + SLICE_MS;
        do {
          const run = sweepCombo(plan, cursor, angles);
          // Scored the way the finished grid scores a combo: the angle it
          // settles on if it found one, else the test that ended the most of
          // its angles. The preview strip is then the same picture, cell for
          // cell, as the census panel that replaces it.
          verdicts[cursor] = run.verdicts.includes(VALID) ? BEST : modal(run.verdicts);
          if (now - shownAt >= SHOW_EVERY) {
            shown = run; shownIdx = cursor; shownAt = now;
          }
          cursor += 1;
        } while (cursor < nCombos && performance.now() < until);
      } else if (now - shownAt >= SHOW_EVERY) {
        // The grid is fully previewed and the worker is still censusing it.
        // Walk the map instead of redrawing it: every step is a real combo at
        // its own angle, which is the thing worth looking at while waiting.
        shownIdx = (shownIdx + 1) % nCombos;
        shown = sweepCombo(plan, shownIdx, angles);
        shownAt = now;
      }

      backdrop(VIEW);

      // ---- the arms, where this combo puts them ----
      const pts = [...shown.swept.starts, ...shown.swept.ends];
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const bx0 = Math.min(...xs), bx1 = Math.max(...xs);
      const by0 = Math.min(...ys), by1 = Math.max(...ys);
      const inset = 26;
      const sc = Math.min((VIEW.w - inset) / Math.max(bx1 - bx0, 1e-6),
                          (VIEW.h - inset) / Math.max(by1 - by0, 1e-6));
      const ox = VIEW.x + (VIEW.w - (bx1 - bx0) * sc) / 2;
      const oy = VIEW.y + (VIEW.h - (by1 - by0) * sc) / 2;
      const P = (p: number[]) => [ox + (p[0] - bx0) * sc, oy + (p[1] - by0) * sc];

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#5a5852";
      shown.swept.starts.forEach((s, i) => {
        const A = P(s), B = P(shown.swept.ends[i]);
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
      });
      // The gaps this combo is being judged on, each in the colour of the
      // bound it is inside or outside — the same test, the same palette, as
      // the finished panel draws.
      ctx.lineWidth = 1.5;
      shown.swept.gaps.forEach((gap, i) => {
        const s0 = shown.swept.starts[i], e0 = shown.swept.ends[i];
        const ux = e0[0] - s0[0], uy = e0[1] - s0[1];
        const nu = (ux * ux + uy * uy) || 1;
        const wx = shown.swept.starts[i + 1][0] - s0[0];
        const wy = shown.swept.starts[i + 1][1] - s0[1];
        const dot = (wx * ux + wy * uy) / nu;
        const A = P(shown.swept.starts[i + 1]);
        const B = P([s0[0] + dot * ux, s0[1] + dot * uy]);
        ctx.strokeStyle = gap < plan.minGap ? COLOUR[OVERLAP]
          : gap > plan.maxGap ? COLOUR[TOOFAR] : COLOUR[VALID];
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
      });

      const verdict = shown.verdicts[shown.pick];
      label(VERDICT_NAMES[verdict], 10, CAPTION_Y, COLOUR[verdict], "700");
      const named = ctx.measureText(VERDICT_NAMES[verdict]).width;
      label(` · gap must land in ${plan.minGap.toFixed(0)}–${
        plan.maxGap.toFixed(0)} px`, 10 + named, CAPTION_Y);
      rightLabel(`ext (${shown.ext.join(", ")}) · ${
        angles[shown.pick].toFixed(1)}°`, CAPTION_Y);

      // ---- this combo, against every angle in the window ----
      label(`this combo · ${plan.insideCount} angles at ${plan.step}°`, 10, ANGLES_Y - 5);
      const aw = (W - 20) / shown.verdicts.length;
      shown.verdicts.forEach((code, j) => {
        ctx.fillStyle = COLOUR[code];
        ctx.fillRect(10 + j * aw, ANGLES_Y, Math.max(aw, 1), ANGLES_H);
      });
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(10 + shown.pick * aw, ANGLES_Y - 3);
      ctx.lineTo(10 + shown.pick * aw, ANGLES_Y + ANGLES_H + 3);
      ctx.stroke();

      // ---- every combo, as this preview rules on it ----
      const swept = cursor >= nCombos;
      label(swept ? "every combo, previewed here" : "combos previewed here",
            10, COMBOS_Y - 5);
      rightLabel(swept
        ? `showing ${(shownIdx + 1).toLocaleString()} of ${nCombos.toLocaleString()}`
        : `${cursor.toLocaleString()} / ${nCombos.toLocaleString()}`, COMBOS_Y - 5);
      const cw = (W - 20) / nCombos;
      ctx.fillStyle = "#e6e1d4";
      ctx.fillRect(10, COMBOS_Y, W - 20, COMBOS_H);
      for (let i = 0; i < cursor; i += 1) {
        ctx.fillStyle = COLOUR[verdicts[i]];
        ctx.fillRect(10 + i * cw, COMBOS_Y, Math.max(cw, 1), COMBOS_H);
      }
      if (appliedIdx >= 0) {
        // Where the level's own answer sits in the grid, so the preview is
        // read against the combo the engine kept.
        ctx.strokeStyle = "#1a1a1a";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(10 + appliedIdx * cw + 0.5, COMBOS_Y - 2);
        ctx.lineTo(10 + appliedIdx * cw + 0.5, COMBOS_Y + COMBOS_H + 2);
        ctx.stroke();
      }
      // Which cell the drawing above is of, so the two read as one thing.
      ctx.strokeStyle = "#c63c28";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(10 + shownIdx * cw - 1, COMBOS_Y - 1,
                     Math.max(cw, 1) + 2, COMBOS_H + 2);

      // ---- the worker's own position ----
      const live = liveProgress.current;
      const done = live && live.combos ? live.combosDone / live.combos : 0;
      ctx.fillStyle = "#e6e1d4";
      ctx.fillRect(10, BAR_Y, W - 20, BAR_H);
      ctx.fillStyle = "#3474c4";
      ctx.fillRect(10, BAR_Y, (W - 20) * Math.min(1, done), BAR_H);
      label(live ? `census ${(done * 100).toFixed(0)}%` : "census starting…",
            10, BAR_Y - 5, "#3474c4", "700");
      rightLabel(`${plan.combos.toLocaleString()} combos × ${
        plan.nAngles} angles = ${plan.evaluations.toLocaleString()} tests`,
        BAR_Y - 5);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [band, level, plan, stage, bounds]);

  // aria-hidden: the pending text beside it already says what is happening,
  // and it says it politely rather than on every frame.
  return <canvas ref={ref} className="trace-sweep" aria-hidden="true" />;
}

const b64 = (s: string) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

/** One cell's geometry, recomputed the way the engine computes it. */
function geometry(t: TracePayload, comboIdx: number, angleDeg: number) {
  const ext = comboExt(t, comboIdx);
  return { ext, ...sweepAngle(t, placeStarts(t, ext), angleDeg) };
}

// The panel was laid out on a fixed 1120px canvas and left to CSS to stretch,
// which is what made it soft: a 1120px backing store blown up to 1300 CSS px
// resamples every line. It now draws at its own measured width, at device
// resolution, so nothing is scaled after the fact.
//
// DESIGN_W is that width at full size; the panel renders at 70% of it, which is
// the size it wants beside a diagram rather than under one.
const DESIGN_W = 1120;
const SCALE = 0.7;
const PANEL_W = Math.round(DESIGN_W * SCALE);

/** Everything the drawing measures, in CSS pixels, for a panel this wide. */
function metricsFor(width: number) {
  const k = width / DESIGN_W;
  return {
    k,
    gridX: Math.round(400 * k),
    gridY: Math.round(34 * k),
    pad: Math.round(16 * k),
    strand: { x: Math.round(16 * k), y: Math.round(34 * k),
              w: Math.round(360 * k), h: Math.round(300 * k) },
    // Under the strand view: the same combo woven into the ring, so the lines
    // above can be read against the weave they would actually produce.
    weave: { x: Math.round(16 * k), y: Math.round(368 * k),
             w: Math.round(360 * k), h: Math.round(300 * k) },
    gridMaxH: Math.round(560 * k),
    maxCell: Math.max(3, Math.round(14 * k)),
    strip: Math.round(26 * k),
    // Type stops shrinking before it stops being type; below this the labels
    // are decoration, and a smaller panel is not worth an unreadable one.
    body: Math.max(10, Math.round(12 * k)),
    lead: Math.max(11, Math.round(13 * k)),
  };
}

export function TracePanel({ data, weaves, onWeave, onClose, onBand, onShow }: {
  data: TracePayload;
  /** Woven cells for this level and band, keyed by weaveKey. */
  weaves?: Record<string, TraceWeave>;
  /** Ask for a cell's weave. Costs a ring replay, so calls are debounced. */
  onWeave?: (ext: number[], angleDeg: number) => void;
  onClose: () => void;
  onBand?: (band: "h" | "v") => void;
  /** Put the woven cell on the card's own diagram, at full size. */
  onShow?: (weave: TraceWeave) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // The panel draws at whatever width it is given, capped at PANEL_W, so a
  // narrow column shrinks the drawing rather than squashing it afterwards.
  const [width, setWidth] = useState(PANEL_W);
  const [combo, setCombo] = useState(0);
  const [angleIdx, setAngleIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [only, setOnly] = useState<number | null>(null);
  // Which question the grid's colours answer: how each combo ended over its
  // whole sweep, or how each one stands at the angle step the strip is on.
  // Touching the strip switches to the slice, because a reader who has just
  // picked an angle is asking about that angle rather than about the summary.
  const [atAngle, setAtAngle] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  // The weave preview's own backing store, blitted into the panel canvas so
  // the whole drawing stays one surface for clicks, capture and recording.
  const weaveCanvas = useRef<HTMLCanvasElement | null>(null);

  const { verdicts, angle0, best, E, nCombos } = useMemo(() => {
    const v = b64(data.verdicts);
    const a0 = new Float32Array(b64(data.angle0).buffer);
    const bs = new Int16Array(b64(data.best).buffer);
    const e = data.vals.length;
    return { verdicts: v, angle0: a0, best: bs, E: e, nCombos: e ** data.P };
  }, [data]);

  const layout = useMemo(() => layoutFor(data.P, E), [data.P, E]);
  const M = useMemo(() => metricsFor(width), [width]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.max(260, Math.min(PANEL_W, el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // One verdict per combo: the angle it settled on if it found one, else the
  // test that ended the most of its in-window angles.
  //
  // Note what this cannot be: a combo with any valid angle is BEST here, since
  // BEST *is* the valid angle its ranking picked, so no cell is ever VALID in
  // the summary. That is why a VALID filter reads through to BEST below rather
  // than dimming the whole grid.
  const cellCode = useMemo(() => {
    const out = new Uint8Array(nCombos);
    for (let i = 0; i < nCombos; i += 1) {
      if (best[i] >= 0) { out[i] = BEST; continue; }
      const row = verdicts.subarray(i * data.nAngles, (i + 1) * data.nAngles);
      const tally = new Array(8).fill(0);
      for (let j = 0; j < row.length; j += 1) if (row[j] !== WINDOW) tally[row[j]] += 1;
      let code = WINDOW, top = -1;
      for (let c = 1; c < 8; c += 1) if (tally[c] > top) { top = tally[c]; code = c; }
      out[i] = code;
    }
    return out;
  }, [verdicts, best, nCombos, data.nAngles]);

  const cell = useMemo(() => Math.max(1, Math.min(M.maxCell,
    Math.floor((width - M.gridX - M.pad) / layout.cols),
    Math.floor(M.gridMaxH / layout.rows))), [layout, M, width]);

  const gridH = layout.rows * cell;
  const stripY = M.gridY + gridH + M.body + Math.round(14 * M.k);
  const canvasH = Math.max(M.weave.y + M.weave.h + Math.round(20 * M.k),
                           stripY + M.strip + M.lead * 2 + 20);

  // The cell on screen, by the identity the weave cache keys on. `ext` is the
  // combo decoded the way geometry() decodes it; the angle is the strip's.
  const ext = useMemo(() => comboExt(data, combo), [combo, data]);
  const angleDeg = angle0[combo] + angleIdx * data.step;
  const weave = weaves?.[weaveKey(ext, angleDeg)];

  // Ask for the weave of whatever cell the reader settles on. Debounced, and
  // held entirely while playing or recording: at 24 combos a second the worker
  // would only ever be a queue of stale replays.
  const onWeaveRef = useRef(onWeave);
  useEffect(() => { onWeaveRef.current = onWeave; });
  useEffect(() => {
    if (!onWeaveRef.current || weave || playing || recording) return undefined;
    const id = window.setTimeout(() => onWeaveRef.current?.(ext, angleDeg), 250);
    return () => window.clearTimeout(id);
  }, [ext, angleDeg, weave, playing, recording]);

  // The pending text's ticking dots, on their own beat like ThinkingDots: a
  // cell stuck behind a long worker job still visibly waits rather than
  // reading as a panel that forgot to draw.
  const weavePending = !weave && !playing && !recording;
  const [weaveTick, setWeaveTick] = useState(0);
  useEffect(() => {
    if (!weavePending) return undefined;
    const slow = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = window.setInterval(() => setWeaveTick(v => v + 1), slow ? 900 : 380);
    return () => window.clearInterval(id);
  }, [weavePending]);

  const appliedIdx = useMemo(() => {
    let idx = 0;
    data.applied.forEach((e) => { idx = idx * E + Math.max(0, data.vals.indexOf(e)); });
    return idx < nCombos ? idx : -1;
  }, [data, E, nCombos]);

  // The verdict of the cell under the cursor, at the angle the strip is on.
  const verdictNow = verdicts[combo * data.nAngles + angleIdx];

  // One cell in a compass direction, which for P <= 2 is one extension of one
  // pair and above that the lowest digit the grid puts on that axis. Gutters in
  // a wrapped layout hold no combo, so a step walks over them rather than
  // stopping dead at one.
  const stepCell = (dx: number, dy: number) => {
    const from = layout.place(combo);
    for (let n = 1; n <= Math.max(layout.cols, layout.rows); n += 1) {
      const x = from.x + dx * n, y = from.y + dy * n;
      if (x < 0 || y < 0 || x >= layout.cols || y >= layout.rows) return;
      const i = layout.unplace(x, y);
      if (i != null && i < nCombos) { setCombo(i); return; }
    }
  };

  const stepAngle = (d: number) => {
    setAngleIdx(j => Math.max(0, Math.min(data.nAngles - 1, j + d)));
    // Same rule the strip's own click has: asking for an angle is asking the
    // grid about that angle.
    setAtAngle(true);
  };

  /**
   * Take the reader to where a verdict can actually be seen.
   *
   * A filter on its own only dims, which is no help when the cells it keeps are
   * somewhere else on the grid or at an angle step that is not on screen: the
   * VALID entry counts 276 cells and the reader was left looking at a map with
   * none of them. So a filter also travels — to the angle step holding the most
   * of that verdict, and to the nearest cell that has it there, which drags the
   * red box, the strand view and the weave preview along with it.
   */
  const reveal = (code: number) => {
    const n = data.nAngles;
    // BEST is the engine's own answer rather than a population, so revealing it
    // means the combo this level adopted at the angle it settled on.
    if (code === BEST && appliedIdx >= 0 && best[appliedIdx] >= 0) {
      setAtAngle(true);
      setAngleIdx(best[appliedIdx]);
      setCombo(appliedIdx);
      return;
    }
    const tally = new Int32Array(n);
    for (let i = 0; i < nCombos; i += 1) {
      const base = i * n;
      for (let j = 0; j < n; j += 1) if (verdicts[base + j] === code) tally[j] += 1;
    }
    let step = -1, top = 0;
    for (let j = 0; j < n; j += 1) if (tally[j] > top) { top = tally[j]; step = j; }
    if (step < 0) return;                          // not a verdict any angle holds
    const from = layout.place(combo);
    let pick = -1, near = Infinity;
    for (let i = 0; i < nCombos; i += 1) {
      if (verdicts[i * n + step] !== code) continue;
      const p = layout.place(i);
      const d = (p.x - from.x) ** 2 + (p.y - from.y) ** 2;
      if (d < near) { near = d; pick = i; }
    }
    setAtAngle(true);
    setAngleIdx(step);
    if (pick >= 0) setCombo(pick);
  };

  // Land on the combo the level adopted, and on its chosen angle.
  useEffect(() => {
    const idx = appliedIdx;
    if (idx >= 0) {
      setCombo(idx);
      setAngleIdx(best[idx] >= 0 ? best[idx] : 0);
    }
  }, [appliedIdx, best]);

  useEffect(() => {
    if (!playing) return undefined;
    const id = window.setInterval(() => {
      setCombo((c) => {
        const next = (c + 1) % nCombos;
        // Same rule the click has: on a slice the step is held, so the walk
        // compares combos at one step rather than reshading the grid 24 times
        // a second.
        if (!atAngle) setAngleIdx(best[next] >= 0 ? best[next] : 0);
        return next;
      });
    }, 1000 / 24);
    return () => window.clearInterval(id);
  }, [playing, nCombos, best, atAngle]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    // Backing store at device resolution, drawing in CSS pixels. Without this
    // the canvas is resampled by the browser and every rule goes soft.
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const W = width, H = canvasH;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    cv.style.width = `${W}px`;
    cv.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#f4f0e6";
    ctx.fillRect(0, 0, W, H);

    const g = geometry(data, combo, angleDeg);
    const verdict = verdicts[combo * data.nAngles + angleIdx];

    // ---- strand view ----
    const gx = M.strand.x, gy = M.strand.y, gw = M.strand.w, gh = M.strand.h;
    ctx.strokeStyle = "#c8c2b4";
    ctx.strokeRect(gx, gy, gw, gh);
    ctx.fillStyle = "#1a1a1a";
    ctx.font = `${M.body}px system-ui, sans-serif`;
    ctx.fillText("strands at this combo and angle", gx + 6, gy - 8);
    const pts = [...g.starts, ...g.ends];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs);
    const by0 = Math.min(...ys), by1 = Math.max(...ys);
    const inset = Math.round(48 * M.k);
    const sc = Math.min((gw - inset) / Math.max(bx1 - bx0, 1e-6),
                        (gh - inset) / Math.max(by1 - by0, 1e-6));
    const ox = gx + inset / 2 + ((gw - inset) - (bx1 - bx0) * sc) / 2;
    const oy = gy + inset / 2 + ((gh - inset) - (by1 - by0) * sc) / 2;
    const P = (p: number[]) => [ox + (p[0] - bx0) * sc, oy + (p[1] - by0) * sc];

    ctx.lineWidth = Math.max(2, 4 * M.k);
    ctx.strokeStyle = "#5a5852";
    g.starts.forEach((s, i) => {
      const A = P(s), B = P(g.ends[i]);
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
    });
    ctx.lineWidth = 2;
    g.gaps.forEach((gap, i) => {
      const ux = g.ends[i][0] - g.starts[i][0];
      const uy = g.ends[i][1] - g.starts[i][1];
      const nu = Math.hypot(ux, uy) || 1;
      const wx = g.starts[i + 1][0] - g.starts[i][0];
      const wy = g.starts[i + 1][1] - g.starts[i][1];
      const dot = (wx * ux + wy * uy) / (nu * nu);
      const foot = [g.starts[i][0] + dot * ux, g.starts[i][1] + dot * uy];
      const A = P(g.starts[i + 1]), B = P(foot);
      ctx.strokeStyle = gap < data.minGap ? COLOUR[OVERLAP]
        : gap > data.maxGap ? COLOUR[TOOFAR] : COLOUR[VALID];
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillText(gap.toFixed(0), (A[0] + B[0]) / 2 + 5, (A[1] + B[1]) / 2 - 4);
    });
    ctx.fillStyle = "#96917f";
    ctx.fillText(`gap must land in ${data.minGap.toFixed(0)}–${data.maxGap.toFixed(0)} px`,
                 gx + 6, gy + gh - Math.round(M.body * 0.6));

    // ---- weave pattern ----
    // The same cell woven into the ring, straight from the engine: the traced
    // band at this combo and angle, the other band held at the engine's pick.
    const wbx = M.weave.x, wby = M.weave.y, wbw = M.weave.w, wbh = M.weave.h;
    ctx.strokeStyle = "#c8c2b4";
    ctx.strokeRect(wbx, wby, wbw, wbh);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillText("weave pattern (this combo)", wbx + 6, wby - 8);
    if (weave && !weave.unavailable && weave.strands?.length) {
      const stage: Stage = { level: data.level, k: null, label: "traced cell",
                             strands: weave.strands };
      const off = weaveCanvas.current ?? document.createElement("canvas");
      weaveCanvas.current = off;
      const inset = Math.round(6 * M.k);
      const capH = M.body + Math.round(10 * M.k);
      const side = Math.min(wbw - inset * 2, wbh - inset - capH);
      drawExactStage(off, stage, allBounds([stage]), true,
                     Math.round(side * dpr), "#f4f0e6");
      ctx.drawImage(off, wbx + (wbw - side) / 2, wby + inset, side, side);
      if (weave.row) {
        const capY = wby + wbh - Math.round(M.body * 0.6);
        ctx.fillStyle = weave.row.healthy ? "#96917f" : "#c63c28";
        ctx.fillText(`${weave.row.state.toUpperCase()} · ${
          weave.row.healthy ? "WEAVE" : "NOT A WEAVE"}`, wbx + 6, capY);
        const cross = `${weave.row.across}/${weave.row.expected}`;
        ctx.fillText(cross, wbx + wbw - 6 - ctx.measureText(cross).width, capY);
      }
    } else {
      ctx.fillStyle = "#96917f";
      ctx.fillText(
        weave?.unavailable ? (weave.reason ?? "no weave for this band")
          : playing || recording ? "pause to weave the combo on screen"
          : `weaving this combo${".".repeat((weaveTick % 3) + 1)}`,
        wbx + 6, wby + wbh / 2);
    }

    // ---- combo grid ----
    ctx.fillStyle = "#1a1a1a";
    ctx.font = `${M.body}px system-ui, sans-serif`;
    // Kept short: the heading has one line the width of the grid, and the note
    // under the panel is where the qualification belongs.
    ctx.fillText(`every extension combo — ${atAngle
      ? `at angle step ${angleIdx + 1} / ${data.nAngles}`
      : "over each whole sweep"}`,
      M.gridX, M.gridY - Math.round(M.body * 0.6));
    // In the summary a combo that found a valid angle is drawn BEST, so asking
    // for VALID there means those cells; at an angle step the two are the
    // distinct things the census recorded and neither is redirected.
    const want = only != null && !atAngle && only === VALID ? BEST : only;
    for (let i = 0; i < nCombos; i += 1) {
      const code = atAngle ? verdicts[i * data.nAngles + angleIdx] : cellCode[i];
      const { x, y } = layout.place(i);
      const dim = want != null && code !== want;
      ctx.fillStyle = dim ? "#e6e1d4" : COLOUR[code];
      ctx.fillRect(M.gridX + x * cell, M.gridY + y * cell,
                   Math.max(cell - (cell > 3 ? 1 : 0), 1),
                   Math.max(cell - (cell > 3 ? 1 : 0), 1));
    }

    // Seams at each digit boundary, so the nesting stays countable when the
    // leading digits are not wrapped out into blocks of their own.
    ctx.strokeStyle = "#f4f0e6";
    layout.seams.forEach((span, tier) => {
      ctx.lineWidth = tier === 0 ? 2 : 1;
      for (let k = span; k < layout.cols; k += span) {
        ctx.beginPath();
        ctx.moveTo(M.gridX + k * cell - 0.5, M.gridY);
        ctx.lineTo(M.gridX + k * cell - 0.5, M.gridY + gridH);
        ctx.stroke();
      }
      for (let k = span; k < layout.rows; k += span) {
        ctx.beginPath();
        ctx.moveTo(M.gridX, M.gridY + k * cell - 0.5);
        ctx.lineTo(M.gridX + layout.cols * cell, M.gridY + k * cell - 0.5);
        ctx.stroke();
      }
    });

    if (appliedIdx >= 0) {
      // The combo the level actually adopted. Drawn as a ring rather than a
      // second box, so it never reads as the cursor sitting somewhere else.
      const a = layout.place(appliedIdx);
      const ax = M.gridX + a.x * cell + cell / 2 - 0.5;
      const ay = M.gridY + a.y * cell + cell / 2 - 0.5;
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ax, ay, Math.max(cell * 0.62, 4), 0, Math.PI * 2);
      ctx.stroke();
    }
    const cur = layout.place(combo);
    ctx.strokeStyle = "#c63c28";
    ctx.lineWidth = 2;
    ctx.strokeRect(M.gridX + cur.x * cell - 1, M.gridY + cur.y * cell - 1,
                   cell + 1, cell + 1);

    // ---- angle strip ----
    const sx = M.gridX, sy = stripY, sw = W - M.gridX - M.pad, sh = M.strip;
    ctx.fillStyle = "#1a1a1a";
    ctx.fillText("every angle inside this combo", sx, sy - Math.round(M.body * 0.6));
    const bw = sw / data.nAngles;
    for (let j = 0; j < data.nAngles; j += 1) {
      const code = verdicts[combo * data.nAngles + j];
      ctx.fillStyle = only != null && code !== only ? "#e6e1d4" : COLOUR[code];
      ctx.fillRect(sx + j * bw, sy, Math.max(bw, 1), sh);
    }
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx + angleIdx * bw, sy - 5);
    ctx.lineTo(sx + angleIdx * bw, sy + sh + 5);
    ctx.stroke();

    ctx.fillStyle = "#1a1a1a";
    ctx.font = `${M.lead}px system-ui, sans-serif`;
    ctx.fillText(`combo ${combo + 1} / ${nCombos}   ext (${g.ext.join(", ")})`
                 + `   angle ${angleDeg.toFixed(1)}°`, sx, sy + sh + M.lead + 6);
    ctx.fillStyle = COLOUR[verdict];
    ctx.fillText(`${data.names[verdict]} — ${BLURB[verdict]}`,
                 sx, sy + sh + M.lead * 2 + 12);
  }, [data, combo, angleIdx, angleDeg, verdicts, angle0, best, nCombos, only,
      atAngle, appliedIdx, layout, cellCode, cell, gridH, stripY, M, width,
      canvasH, weave, weaveTick, playing, recording]);

  const pick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv) return;
    // The canvas is drawn in CSS pixels, so a client offset is already in the
    // drawing's own units -- no backing-store scale to undo.
    const r = cv.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    if (x < M.gridX) return;
    if (y >= M.gridY && y < M.gridY + gridH) {
      const i = layout.unplace(Math.floor((x - M.gridX) / cell),
                              Math.floor((y - M.gridY) / cell));
      if (i == null || i >= nCombos) return;
      setCombo(i);
      // The strip always follows the grid. Which angle it lands on is the one
      // thing the two modes disagree about: on the summary the combo's own
      // pick is what the cell was drawn from, and on a slice the step is the
      // axis the whole grid shares, so moving it would recolour the picture
      // the reader is pointing at.
      if (!atAngle) setAngleIdx(best[i] >= 0 ? best[i] : 0);
    } else if (y >= stripY - 6 && y <= stripY + 32) {
      const j = Math.floor(((x - M.gridX) / (width - M.gridX - M.pad)) * data.nAngles);
      setAngleIdx(Math.max(0, Math.min(data.nAngles - 1, j)));
      // And the grid follows the strip: picking an angle is asking about that
      // angle, so the cells answer for it instead of for the whole sweep.
      setAtAngle(true);
    }
  };

  const record = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    if (recording) { recorder.current?.stop(); return; }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(cv.captureStream(24), { mimeType: "video/webm" });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      setRecording(false);
      setPlaying(false);
      const url = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `mxn-trace-L${data.level}-${data.band}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    };
    recorder.current = rec;
    rec.start();
    setRecording(true);
    setCombo(0);
    setPlaying(true);
  };

  const total = data.counts.reduce((a, b) => a + b, 0);
  const axes = useMemo(() => {
    if (data.P === 1) return "one row: pair 0 left to right";
    if (data.P === 2) return "row = pair 0, column = pair 1";
    if (layout.inner) return `each block is one value of pair 0; inside it, ${
      data.P === 3 ? "row = pair 1, column = pair 2"
        : "the remaining pairs de-interleave"}`;
    return "pairs 0 and 1 place the block, the rest place the cell inside it";
  }, [data.P, layout.inner]);

  return (
    <div className="trace-panel">
      <div className="trace-head">
        <strong>Trace · L{data.level} · {data.band} band</strong>
        <span>{total.toLocaleString()} evaluations, none skipped</span>
        {onBand && (["h", "v"] as const).map(b => (
          <button key={b} type="button" onClick={() => onBand(b)}
            aria-pressed={bandKey(data.band) === b}
            title={`Trace the ${b === "h" ? "horizontal" : "vertical"} band of this level`}>
            {b.toUpperCase()}
          </button>
        ))}
        <button type="button" onClick={() => setAtAngle(a => !a)} aria-pressed={atAngle}
          title={atAngle
            ? "Colour the grid by how each combo ended over its whole sweep"
            : "Colour the grid by where each combo stands at the strip's angle step"}>
          {atAngle ? "Whole sweep" : "At this angle"}
        </button>
        <button type="button" onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={record} aria-pressed={recording}>
          {recording ? "Stop recording" : "Record"}
        </button>
        <button type="button" onClick={onClose} aria-label="Close trace">×</button>
      </div>
      <div className="trace-canvas-wrap" ref={wrapRef}>
        {/* The layout the drawing used, so a test can address a cell without
            re-deriving metrics that live here. */}
        <canvas ref={canvasRef} onClick={pick}
          data-grid-x={M.gridX} data-grid-y={M.gridY} data-cell={cell}
          data-cols={layout.cols} data-rows={layout.rows}
          data-strip-y={stripY} data-strip-h={M.strip}
          data-combo={combo} data-angle={angleIdx}
          data-mode={atAngle ? "angle" : "sweep"} data-verdict={verdictNow}
          data-ext={JSON.stringify(ext)}
          data-weave-x={M.weave.x} data-weave-y={M.weave.y}
          data-weave-w={M.weave.w} data-weave-h={M.weave.h} />
      </div>
      {/* Step by step, for a reader who is comparing neighbours rather than
          hunting: one cell of the grid in a compass direction, one angle
          along the strip. The grid's axes are extensions, so ← → and ↑ ↓ are
          the extension pairs the layout puts on x and y. */}
      <div className="trace-steps">
        <span role="group" aria-label="Step the extension combo">
          <i aria-hidden="true">ext</i>
          <button type="button" onClick={() => stepCell(0, -1)}
            title="One cell up — the pair the grid puts on y"
            aria-label="Previous extension along the grid's y axis">↑</button>
          <button type="button" onClick={() => stepCell(-1, 0)}
            title="One cell left — the pair the grid puts on x"
            aria-label="Previous extension along the grid's x axis">←</button>
          <button type="button" onClick={() => stepCell(1, 0)}
            title="One cell right — the pair the grid puts on x"
            aria-label="Next extension along the grid's x axis">→</button>
          <button type="button" onClick={() => stepCell(0, 1)}
            title="One cell down — the pair the grid puts on y"
            aria-label="Next extension along the grid's y axis">↓</button>
        </span>
        <span role="group" aria-label="Step the angle">
          <i aria-hidden="true">angle</i>
          <button type="button" onClick={() => stepAngle(-1)} disabled={angleIdx === 0}
            title="One angle step back" aria-label="Previous angle step">‹</button>
          <button type="button" onClick={() => stepAngle(1)}
            disabled={angleIdx >= data.nAngles - 1}
            title="One angle step on" aria-label="Next angle step">›</button>
        </span>
        <em>{data.names[verdictNow]}</em>
        {/* The preview is 300px square beside a census; the card's diagram is
            the drawing everything else is read against. This sends the cell
            there. It waits on the weave rather than asking for one, because
            the cell on screen is already being fetched and a second request
            for the same ring would only queue behind it. */}
        {onShow && (
          <button type="button" className="show-on-card"
            disabled={!weave?.strands?.length || !weave?.row}
            onClick={() => weave && onShow(weave)}
            title={weave?.strands?.length
              ? "Draw this cell as the level's own diagram"
              : weave?.unavailable
                ? (weave.reason ?? "this cell has no weave to show")
                : "waiting for this cell to be woven"}>
            Show on main diagram
          </button>
        )}
      </div>
      <div className="trace-legend">
        {data.names.map((name, code) => (
          data.counts[code] ? (
            <button key={name} type="button"
              className={only === code ? "is-only" : ""}
              onClick={() => {
                if (only === code) { setOnly(null); return; }
                setOnly(code);
                reveal(code);
              }}
              title={`${BLURB[code]} — press to go to it`}>
              <i style={{ background: COLOUR[code] }} />
              <b>{name}</b>
              <span>{data.counts[code].toLocaleString()}</span>
              <em>{((100 * data.counts[code]) / total).toFixed(1)}%</em>
            </button>
          ) : null
        ))}
      </div>
      <p className="trace-note">
        {data.P} extension pair{data.P === 1 ? "" : "s"} × {E} extensions
        = {nCombos.toLocaleString()} combos, drawn {layout.cols}×{layout.rows}
        {" — "}{axes}. Red box is the combo being looked at, the ring is the one
        this level adopted. The grid and the strip move together: click a cell
        and the strip shows that combo, click the strip and the grid recolours
        to that angle step — every combo at the same point in its own sweep,
        which is a different number of degrees for each. <em>Whole sweep</em>{" "}
        puts the summary back, and the ext/angle steppers walk a cell or an
        angle at a time. A filter dims everything that did not end on that test
        and travels to it: to the angle step holding the most of that verdict
        and the nearest cell that has it, except BEST, which goes to the combo
        this level adopted at the angle it chose. On the summary, where a combo
        that found a valid angle is drawn BEST, VALID selects those cells. The
        band is replayed unpinned, so a square level 1 shows the search its V
        band would have run.
      </p>
    </div>
  );
}
