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
  bySortKey, fitCandidates, isFlush, neighbourDelta, spread,
  type Candidate, type FitBand, type SortKey, type Tie,
} from "./solve";

const BASE = import.meta.env.BASE_URL;

type BandKey = "h" | "v";
const BANDS: BandKey[] = ["h", "v"];
const BAND_NAME = { h: "horizontal", v: "vertical" } as const;

type Plan = { level: number; k: number; m: number; n: number;
              hand: string; direction: string; h: FitBand; v: FitBand };

type Woven = {
  level: number; unavailable?: boolean; reason?: string;
  h: { ext: number[]; angle: number | null };
  v: { ext: number[]; angle: number | null };
  crossings: number;
  row: { across: number; expected: number; within: number; masks: number;
         stray: number; broken: number; healthy: boolean; ext: number[][] };
  strands: Strand[];
};

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

const ksOf = (raw: string) => raw.replace(/[[\],]/g, " ").trim().split(/\s+/)
  .map(Number).filter(Number.isInteger);

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
  const [tie, setTie] = useState<Tie>("longest");
  const [sortKey, setSortKey] = useState<SortKey>("delta");
  const [band, setBand] = useState<BandKey>("v");

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [before, setBefore] = useState<{ stage: Stage; lengths: Record<BandKey, number[]>;
                                         woven: Woven } | null>(null);
  const [after, setAfter] = useState<Attempt | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [candidates, setCandidates] = useState<Record<BandKey, Candidate[]>>(
    { h: [], v: [] });

  const ks = useMemo(() => ksOf(ksText), [ksText]);
  const level = ks.length;

  const run = async () => {
    if (!ks.length) { setStatus("Give at least one k."); setFailed(true); return; }
    setBusy(true);
    setFailed(false);
    setPlan(null); setBefore(null); setAfter(null); setAttempts([]);
    try {
      setStatus("Running the engine…");
      const result = await ask({ type: "generate", m, n, ks, hand, direction }, "result");
      const stage = (result.stages ?? []).find((s: Stage) => s.level === level);
      if (!stage) throw new Error(`the run came back without an L${level}`);

      setStatus("Reading both bands…");
      const got: Plan = await ask({ type: "fit-plan", level }, "fit-plan-ready");
      setPlan(got);

      // "Before" is the engine's own ring, drawn from the run, and its lengths
      // are measured off it — no second weave and no recomputation.
      const beforeLengths = {
        h: got.h?.unavailable ? [] : measure(stage.strands, got.h.names),
        v: got.v?.unavailable ? [] : measure(stage.strands, got.v.names),
      };
      const baseline = await ask({ type: "fit-weave", level }, "fit-weave-ready") as Woven;
      setBefore({ stage, lengths: beforeLengths, woven: baseline });

      // Each band that needs fitting gets its own ordered list. A band whose
      // arms already agree is held where the engine left it: there is nothing
      // to fix, and moving it would only be a change to defend.
      const lists: Record<BandKey, Candidate[]> = { h: [], v: [] };
      for (const key of BANDS) {
        const inputs = got[key];
        if (!inputs || inputs.unavailable) continue;
        if (isFlush(beforeLengths[key])) continue;
        lists[key] = fitCandidates(inputs, { tie });
      }
      setCandidates(lists);
      if (!lists.h.length && !lists.v.length) {
        setStatus(beforeLengths.h.length || beforeLengths.v.length
          ? "Both bands are already flush — nothing to fit."
          : "Neither band was searched, so there is nothing to read.");
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
            hExt: h?.ext ?? null, hAngle: h?.angle ?? null,
            vExt: v?.ext ?? null, vAngle: v?.angle ?? null,
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
      setStatus(accepted
        ? `Fitted, and the ring still closes — ${tried.length} candidate${
            tried.length === 1 ? "" : "s"} woven.`
        : `No flush ring survived the audit in ${tried.length} candidates. `
          + "The engine's own ring is unchanged.");
      setFailed(!accepted);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const bounds = useMemo<Bounds | null>(() => {
    const stages: Stage[] = [];
    if (before) stages.push(before.stage);
    if (after) stages.push({ level, k: null, label: "fitted", strands: after.woven.strands });
    return stages.length ? allBounds(stages) : null;
  }, [before, after, level]);

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

  const exportRing = () => {
    if (!plan || !before) return;
    const source = after ?? null;
    const name = `mxn-${m}x${n}-k${ks.join("_")}-${hand}-${direction}-L${level}`;
    saveJson(`${name}-${today()}.json`, source ? source.woven.strands : before.stage.strands);
    saveJson(`${name}-${today()}.fit.json`, {
      params: { m, n, ks, hand, direction },
      engine: { level, k: plan.k },
      fitted: !!source,
      policy: { target: "flush", ext: "continuous", angle: "window", tie },
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
            <h2 className="kicker">Fit policy</h2>
            <div className="field">
              <label className="f" htmlFor="fit-tie">order the candidates by</label>
              <select id="fit-tie" value={tie}
                onChange={e => setTie(e.target.value as Tie)}>
                <option value="longest">longest common arm</option>
                <option value="margin">widest gap margin</option>
                <option value="least-ext">least total extension</option>
                <option value="near-engine">nearest the engine's own pick</option>
              </select>
            </div>
            <p className="hint">
              Every candidate is exactly flush; this is the order they are offered to the
              engine's audit in. <code>longest</code> is the default because the ring closes
              when one band's arms reach across the other — <code>margin</code> reads safer
              and measurably is not.
            </p>
          </section>

          <section>
            <h2 className="kicker">Sort</h2>
            <div className="field">
              <label className="f" htmlFor="fit-sort">rank the table by</label>
              <select id="fit-sort" value={sortKey}
                onChange={e => setSortKey(e.target.value as SortKey)}>
                <option value="delta">neighbour length Δ</option>
                <option value="spread">length spread (max − min)</option>
                <option value="margin">gap margin</option>
                <option value="ext">total pair extension</option>
                <option value="engine">the order they were offered</option>
              </select>
            </div>
            <button className="go" type="button" onClick={run} disabled={busy}>
              {busy ? "Working…" : "Run and fit"}
            </button>
            <button className="go ghost" type="button" onClick={exportRing}
              disabled={!before}>Export</button>
            {(status || progress) && (
              <p className={`status${failed ? " bad" : ""}`}>{status || progress}</p>
            )}
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
                <span className="chip soft">L{level} of {ks.length}</span>
                {health && (
                  <span className={`chip ${health.healthy ? "soft" : "warn"}`}>
                    {health.across}/{health.expected} crossings
                  </span>
                )}
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

              <div className="panel">
                <header>
                  <strong>The ring, before and after</strong>
                  <span>drawn by the studio's own renderer, from the strands the engine returned</span>
                </header>
                <div className="body">
                  <div className="rings">
                    <RingFigure title="engine" stage={before?.stage ?? null} bounds={bounds}
                      caption={beforeLengths.length
                        ? `Δ ${neighbourDelta(beforeLengths).toFixed(2)} px` : ""} />
                    <RingFigure
                      title={after ? "fitted" : "fitted — none accepted"}
                      stage={after
                        ? { level, k: plan.k, label: "fitted", strands: after.woven.strands }
                        : null}
                      bounds={bounds}
                      caption={afterLengths.length
                        ? `Δ ${neighbourDelta(afterLengths).toFixed(2)} px` : ""} />
                  </div>
                  <LengthBars before={beforeLengths} after={afterLengths} />
                </div>
                <p className="note">
                  Both rings are the engine's own output, drawn by{" "}
                  <code>drawExactStage</code> — the same renderer <code>/mxn/</code> uses. The
                  lengths beside them are measured off those strands rather than recomputed
                  from the extensions that were asked for, so what is quoted is what is drawn.
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
                        <th className={sortKey === "delta" ? "sorted" : ""}
                          onClick={() => setSortKey("delta")}>Δ neigh</th>
                        <th className={sortKey === "spread" ? "sorted" : ""}
                          onClick={() => setSortKey("spread")}>spread</th>
                        <th className={sortKey === "margin" ? "sorted" : ""}
                          onClick={() => setSortKey("margin")}>margin</th>
                        <th className={sortKey === "ext" ? "sorted" : ""}
                          onClick={() => setSortKey("ext")}>total ext</th>
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
                  differ in which length, and at what heading. The sort reads the geometry on
                  screen, so it means the same before a fit and after one. A band that is
                  already flush has no candidates and is left where the engine put it.
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
