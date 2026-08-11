// The trace panel: what the band search ruled out, and on which test.
//
// bridge.trace_level sends a verdict for every (combo, angle) the band could be
// asked about, including the angles outside the +/-20 degree window that the
// real search never reaches. Geometry is affine in the extensions, so only the
// census travels; the handful of points needed to draw one cell are recomputed
// here from the same inputs the engine used.
import { useEffect, useMemo, useRef, useState } from "react";

import { layoutFor } from "./trace-layout";

export type TracePayload = {
  level: number;
  band: string;
  unavailable?: boolean;
  reason?: string;
  P: number;
  vals: number[];
  nAngles: number;
  step: number;
  nStrands: number;
  minGap: number;
  maxGap: number;
  verdicts: string;
  angle0: string;
  best: string;
  counts: number[];
  names: string[];
  origins: ([number, number] | null)[][];
  directions: number[][];
  pairIndices: [number, number | null][];
  targets: [number, number][];
  applied: number[];
};

// Verdict codes, in the order mxn_trace applies the tests. REACH, DEGEN and
// ORDER are drawn straight from the census by index, so only the codes this
// file names explicitly are bound here.
const WINDOW = 0;
const REACH = 1, DEGEN = 2, ORDER = 3;
const OVERLAP = 4, TOOFAR = 5, VALID = 6, BEST = 7;

const COLOUR = [
  "#b0aca0", "#c63c28", "#781414", "#e28a1c",
  "#924ab0", "#3474c4", "#3a9c58", "#d4a81e",
];
const BLURB = [
  "outside the ±20° window — the real search never tries it",
  "a strand cannot reach its target at this angle",
  "a strand's line collapsed",
  "the gaps disagree in sign — the strands run out of order",
  "a gap is below the minimum — too close to fit",
  "a gap is above the maximum — the band has pulled apart",
  "every test passed",
  "the angle this combo's ranking selects",
];

const b64 = (s: string) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

/** One cell's geometry, recomputed the way the engine computes it. */
function geometry(t: TracePayload, comboIdx: number, angleDeg: number) {
  const E = t.vals.length;
  const ext: number[] = [];
  let rest = comboIdx;
  for (let p = t.P - 1; p >= 0; p -= 1) { ext[p] = t.vals[rest % E]; rest = Math.floor(rest / E); }

  const starts: [number, number][] = t.targets.map(() => [0, 0]);
  t.pairIndices.forEach(([li, ri], p) => {
    const [lnx, lny, rnx, rny] = t.directions[p];
    const [lo, ro] = t.origins[p];
    if (lo) starts[li] = [lo[0] + ext[p] * lnx, lo[1] + ext[p] * lny];
    if (ri != null && ro) starts[ri] = [ro[0] + ext[p] * rnx, ro[1] + ext[p] * rny];
  });

  const d = starts.map((s, i) => [t.targets[i][0] - s[0], t.targets[i][1] - s[1]]);
  const ref = Math.atan2(d[0][1], d[0][0]);
  const a = (angleDeg * Math.PI) / 180;
  const ends: [number, number][] = [];
  const proj: number[] = [];
  d.forEach((di, i) => {
    const pos = di[0] * Math.cos(ref) + di[1] * Math.sin(ref) >= 0;
    const sa = pos ? a : a + Math.PI;
    const pr = di[0] * Math.cos(sa) + di[1] * Math.sin(sa);
    proj.push(pr);
    ends.push([starts[i][0] + pr * Math.cos(sa), starts[i][1] + pr * Math.sin(sa)]);
  });

  const gaps: number[] = [];
  for (let i = 0; i < starts.length - 1; i += 1) {
    const ldx = ends[i][0] - starts[i][0];
    const ldy = ends[i][1] - starts[i][1];
    const ll = Math.hypot(ldx, ldy) || 1;
    const vx = starts[i + 1][0] - starts[i][0];
    const vy = starts[i + 1][1] - starts[i][1];
    gaps.push(Math.abs((ldy * vx - ldx * vy) / ll));
  }
  return { ext, starts, ends, gaps, proj };
}

/** The legend's glyph, drawn on a canvas. Colour is redundant with the fill. */
function glyph(ctx: CanvasRenderingContext2D, x: number, y: number,
               code: number, r: number, colour: string) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = Math.max(1, r / 2.4);
  ctx.lineCap = "butt";
  ctx.beginPath();
  if (code === OVERLAP) {
    ctx.moveTo(x - r * 0.34, y - r); ctx.lineTo(x - r * 0.34, y + r);
    ctx.moveTo(x + r * 0.34, y - r); ctx.lineTo(x + r * 0.34, y + r);
    ctx.stroke();
  } else if (code === TOOFAR) {
    ctx.moveTo(x - r, y - r); ctx.lineTo(x - r, y + r);
    ctx.moveTo(x + r, y - r); ctx.lineTo(x + r, y + r);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.stroke();
  } else if (code === VALID) {
    ctx.moveTo(x - r, y); ctx.lineTo(x - r * 0.3, y + r * 0.9);
    ctx.lineTo(x + r, y - r); ctx.stroke();
  } else if (code === BEST) {
    for (let i = 0; i < 10; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? r : r * 0.45;
      const px = x + rad * Math.cos(a), py = y + rad * Math.sin(a);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  } else if (code === ORDER || code === DEGEN) {
    ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
    ctx.moveTo(x - r, y + r); ctx.lineTo(x + r, y - r);
    ctx.stroke();
    if (code === ORDER) {
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, Math.PI * 2); ctx.stroke();
    }
  } else if (code === REACH) {
    ctx.moveTo(x - r, y); ctx.lineTo(x + r * 0.1, y); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x + r * 0.6, y, r * 0.42, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.lineWidth = 1;
    ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    ctx.beginPath(); ctx.moveTo(x - r, y + r); ctx.lineTo(x + r, y - r); ctx.stroke();
  }
  ctx.restore();
}

const GRID_X = 400, GRID_Y = 34;      // the grid's origin inside the canvas
const CANVAS_W = 1120;
const GRID_MAX_H = 560;
const GLYPH_MIN_CELL = 12;            // below this a per-cell glyph is mud

export function TracePanel({ data, onClose, onBand }: {
  data: TracePayload;
  onClose: () => void;
  onBand?: (band: "h" | "v") => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [combo, setCombo] = useState(0);
  const [angleIdx, setAngleIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [only, setOnly] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);

  const { verdicts, angle0, best, E, nCombos } = useMemo(() => {
    const v = b64(data.verdicts);
    const a0 = new Float32Array(b64(data.angle0).buffer);
    const bs = new Int16Array(b64(data.best).buffer);
    const e = data.vals.length;
    return { verdicts: v, angle0: a0, best: bs, E: e, nCombos: e ** data.P };
  }, [data]);

  const layout = useMemo(() => layoutFor(data.P, E), [data.P, E]);

  // One verdict per combo: the angle it settled on if it found one, else the
  // test that ended the most of its in-window angles.
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

  const cell = useMemo(() => Math.max(1, Math.min(14,
    Math.floor((CANVAS_W - GRID_X - 16) / layout.cols),
    Math.floor(GRID_MAX_H / layout.rows))), [layout]);

  // Below the per-cell glyph size, label whole regions instead: the biggest
  // areas, at most two per verdict. Twenty-one identical ORDER glyphs, one per
  // block of a P = 3 band, say nothing the first one did not.
  const labels = useMemo(() => {
    if (cell >= GLYPH_MIN_CELL) return [];
    const { cols, rows } = layout;
    const at = (x: number, y: number) => {
      const i = layout.unplace(x, y);
      return i == null ? -1 : cellCode[i];
    };
    const seen = new Uint8Array(cols * rows);
    const found: { code: number; x: number; y: number; area: number }[] = [];
    const min = Math.max(6, Math.floor((cols * rows) / 300));
    for (let y0 = 0; y0 < rows; y0 += 1) {
      for (let x0 = 0; x0 < cols; x0 += 1) {
        if (seen[y0 * cols + x0]) continue;
        const code = at(x0, y0);
        seen[y0 * cols + x0] = 1;
        if (code < 0) continue;
        const queue = [[x0, y0]];
        const cells: number[][] = [];
        while (queue.length) {
          const [x, y] = queue.pop() as number[];
          cells.push([x, y]);
          const near = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
          for (const [nx, ny] of near) {
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            if (seen[ny * cols + nx]) continue;
            if (at(nx, ny) !== code) continue;
            seen[ny * cols + nx] = 1;
            queue.push([nx, ny]);
          }
        }
        if (cells.length < min) continue;
        const cx = cells.reduce((s, p) => s + p[0], 0) / cells.length;
        const cy = cells.reduce((s, p) => s + p[1], 0) / cells.length;
        const pick = cells.reduce((bestCell, p) =>
          (p[0] - cx) ** 2 + (p[1] - cy) ** 2 < (bestCell[0] - cx) ** 2 + (bestCell[1] - cy) ** 2
            ? p : bestCell, cells[0]);
        found.push({ code, x: pick[0], y: pick[1], area: cells.length });
      }
    }
    found.sort((a, b) => b.area - a.area);
    const perCode = new Map<number, number>();
    return found.filter(f => {
      const n = perCode.get(f.code) ?? 0;
      if (n >= 2) return false;
      perCode.set(f.code, n + 1);
      return true;
    }).slice(0, 8);
  }, [layout, cellCode, cell]);

  const gridH = layout.rows * cell;
  const canvasH = Math.max(400, GRID_Y + gridH + 120);
  const stripY = GRID_Y + gridH + 32;

  const appliedIdx = useMemo(() => {
    let idx = 0;
    data.applied.forEach((e) => { idx = idx * E + Math.max(0, data.vals.indexOf(e)); });
    return idx < nCombos ? idx : -1;
  }, [data, E, nCombos]);

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
        setAngleIdx(best[next] >= 0 ? best[next] : 0);
        return next;
      });
    }, 1000 / 24);
    return () => window.clearInterval(id);
  }, [playing, nCombos, best]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = cv.width, H = cv.height;
    ctx.fillStyle = "#f4f0e6";
    ctx.fillRect(0, 0, W, H);

    const angleDeg = angle0[combo] + angleIdx * data.step;
    const g = geometry(data, combo, angleDeg);
    const verdict = verdicts[combo * data.nAngles + angleIdx];

    // ---- strand view ----
    const gx = 16, gy = 34, gw = 360, gh = 300;
    ctx.strokeStyle = "#c8c2b4";
    ctx.strokeRect(gx, gy, gw, gh);
    ctx.fillStyle = "#1a1a1a";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText("strands at this combo and angle", gx + 6, gy - 8);
    const pts = [...g.starts, ...g.ends];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs);
    const by0 = Math.min(...ys), by1 = Math.max(...ys);
    const sc = Math.min((gw - 48) / Math.max(bx1 - bx0, 1e-6),
                        (gh - 48) / Math.max(by1 - by0, 1e-6));
    const ox = gx + 24 + ((gw - 48) - (bx1 - bx0) * sc) / 2;
    const oy = gy + 24 + ((gh - 48) - (by1 - by0) * sc) / 2;
    const P = (p: number[]) => [ox + (p[0] - bx0) * sc, oy + (p[1] - by0) * sc];

    ctx.lineWidth = 4;
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
                 gx + 6, gy + gh - 8);

    // ---- combo grid ----
    ctx.fillStyle = "#1a1a1a";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText("every extension combo", GRID_X, GRID_Y - 8);
    for (let i = 0; i < nCombos; i += 1) {
      const code = cellCode[i];
      const { x, y } = layout.place(i);
      const dim = only != null && code !== only;
      ctx.fillStyle = dim ? "#e6e1d4" : COLOUR[code];
      ctx.fillRect(GRID_X + x * cell, GRID_Y + y * cell,
                   Math.max(cell - (cell > 3 ? 1 : 0), 1),
                   Math.max(cell - (cell > 3 ? 1 : 0), 1));
      if (cell >= GLYPH_MIN_CELL && !dim) {
        glyph(ctx, GRID_X + x * cell + cell / 2, GRID_Y + y * cell + cell / 2,
              code, cell * 0.28, "#1a1a1a");
      }
    }

    // Seams at each digit boundary, so the nesting stays countable when the
    // leading digits are not wrapped out into blocks of their own.
    ctx.strokeStyle = "#f4f0e6";
    layout.seams.forEach((span, tier) => {
      ctx.lineWidth = tier === 0 ? 2 : 1;
      for (let k = span; k < layout.cols; k += span) {
        ctx.beginPath();
        ctx.moveTo(GRID_X + k * cell - 0.5, GRID_Y);
        ctx.lineTo(GRID_X + k * cell - 0.5, GRID_Y + gridH);
        ctx.stroke();
      }
      for (let k = span; k < layout.rows; k += span) {
        ctx.beginPath();
        ctx.moveTo(GRID_X, GRID_Y + k * cell - 0.5);
        ctx.lineTo(GRID_X + layout.cols * cell, GRID_Y + k * cell - 0.5);
        ctx.stroke();
      }
    });

    // A region names itself, once, when the cells are too small to each carry
    // a glyph of their own.
    labels.forEach(({ code, x, y }) => {
      const cx = GRID_X + x * cell + cell / 2, cy = GRID_Y + y * cell + cell / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.fillStyle = "#f4f0e6";
      ctx.fill();
      ctx.strokeStyle = "#c8c2b4";
      ctx.lineWidth = 1;
      ctx.stroke();
      glyph(ctx, cx, cy, code, 6, "#1a1a1a");
    });

    if (appliedIdx >= 0) {
      // The combo the level actually adopted. Drawn as a ring rather than a
      // second box, so it never reads as the cursor sitting somewhere else --
      // and never as a star, which now means BEST on the cells themselves.
      const a = layout.place(appliedIdx);
      const ax = GRID_X + a.x * cell + cell / 2 - 0.5;
      const ay = GRID_Y + a.y * cell + cell / 2 - 0.5;
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ax, ay, Math.max(cell * 0.62, 4), 0, Math.PI * 2);
      ctx.stroke();
    }
    const cur = layout.place(combo);
    ctx.strokeStyle = "#c63c28";
    ctx.lineWidth = 2;
    ctx.strokeRect(GRID_X + cur.x * cell - 1, GRID_Y + cur.y * cell - 1,
                   cell + 1, cell + 1);

    // ---- angle strip ----
    const sx = GRID_X, sy = stripY, sw = W - GRID_X - 16, sh = 26;
    ctx.fillStyle = "#1a1a1a";
    ctx.fillText("every angle inside this combo", sx, sy - 8);
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
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(`combo ${combo + 1} / ${nCombos}   ext (${g.ext.join(", ")})`
                 + `   angle ${angleDeg.toFixed(1)}°`, sx, sy + sh + 24);
    ctx.fillStyle = COLOUR[verdict];
    ctx.fillText(`${data.names[verdict]} — ${BLURB[verdict]}`, sx, sy + sh + 44);
  }, [data, combo, angleIdx, verdicts, angle0, best, nCombos, only, appliedIdx,
      layout, cellCode, cell, labels, gridH, stripY]);

  const pick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * cv.width;
    const y = ((ev.clientY - r.top) / r.height) * cv.height;
    if (x < GRID_X) return;
    if (y >= GRID_Y && y < GRID_Y + gridH) {
      const i = layout.unplace(Math.floor((x - GRID_X) / cell),
                              Math.floor((y - GRID_Y) / cell));
      if (i != null && i < nCombos) { setCombo(i); setAngleIdx(best[i] >= 0 ? best[i] : 0); }
    } else if (y >= stripY - 6 && y <= stripY + 32) {
      const j = Math.floor(((x - GRID_X) / (cv.width - GRID_X - 16)) * data.nAngles);
      setAngleIdx(Math.max(0, Math.min(data.nAngles - 1, j)));
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
            aria-pressed={data.band === b}
            title={`Trace the ${b === "h" ? "horizontal" : "vertical"} band of this level`}>
            {b.toUpperCase()}
          </button>
        ))}
        <button type="button" onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={record} aria-pressed={recording}>
          {recording ? "Stop recording" : "Record"}
        </button>
        <button type="button" onClick={onClose} aria-label="Close trace">×</button>
      </div>
      <canvas ref={canvasRef} width={CANVAS_W} height={canvasH} onClick={pick} />
      <div className="trace-legend">
        {data.names.map((name, code) => (
          data.counts[code] ? (
            <button key={name} type="button"
              className={only === code ? "is-only" : ""}
              onClick={() => setOnly(only === code ? null : code)}
              title={BLURB[code]}>
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
        this level adopted. Click the grid to jump to a combo, or the strip to
        scrub angles. A filter dims everything that did not end on that test.
        The band is replayed unpinned, so a square level 1 shows the search its
        V band would have run.
      </p>
    </div>
  );
}
