"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  allBounds, drawExactStage,
  type AuditRow, type Bounds, type Stage, type Strand,
} from "../mxn-lab/weave-studio";

// The lab's own settings, read back rather than asked for again. Rating is the
// same operator on the same machine; making them paste the token twice would
// only invite pasting it somewhere worse.
const API_KEY = "mxn-lab-api";
const TOKEN_KEY = "mxn-lab-token";

type Row = {
  id: string; created_at: string;
  m: number; n: number; level: number; k: number;
  ks_prefix: string; h_ext: string; v_ext: string; total_ext: number;
  audit: string; healthy: number; solution_index: number;
  rating: number | null;
  /** Only present on the single-row endpoint. */
  parent_strands?: string;
  solution_strands?: string;
};

function readSetting(key: string) {
  try { return window.localStorage.getItem(key) || ""; } catch { return ""; }
}

function writeSetting(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch { /* private mode */ }
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** One ring, drawn on its own frozen viewport. */
function Ring({ strands, label }: { strands: Strand[]; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stage: Stage = useMemo(
    () => ({ level: 1, k: null, label, strands }), [strands, label]);
  const bounds: Bounds = useMemo(() => allBounds([stage]), [stage]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => drawExactStage(canvas, stage, bounds, false);
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [stage, bounds]);
  return (
    <figure className="ring">
      <figcaption>{label}</figcaption>
      <canvas ref={ref} role="img" aria-label={label} />
    </figure>
  );
}

export function Categoriser() {
  const [apiUrl, setApiUrl] = useState("");
  const [token, setToken] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState(0);
  const [detail, setDetail] = useState<Row | null>(null);
  const [score, setScore] = useState(50);
  const [status, setStatus] = useState("Connect the dataset to start rating.");
  const [onlyUnrated, setOnlyUnrated] = useState(true);

  useEffect(() => {
    setApiUrl(readSetting(API_KEY));
    setToken(readSetting(TOKEN_KEY));
  }, []);

  const base = apiUrl.replace(/\/+$/, "");
  const auth = { Authorization: `Bearer ${token}` };

  const load = async () => {
    if (!base || !token) { setStatus("Enter the worker URL and admin token."); return; }
    setStatus("Loading…");
    try {
      const query = onlyUnrated ? "?unrated=1&limit=500" : "?limit=500";
      const response = await fetch(`${base}/solutions${query}`, { headers: auth });
      if (!response.ok) { setStatus(`Dataset said HTTP ${response.status}.`); return; }
      const body = await response.json();
      const list: Row[] = body.solutions ?? [];
      setRows(list);
      setCursor(0);
      setStatus(list.length
        ? `${list.length} solution${list.length === 1 ? "" : "s"} to rate.`
        : onlyUnrated ? "Nothing left unrated." : "The dataset is empty.");
    } catch {
      setStatus("Could not reach the dataset.");
    }
  };

  // The list endpoint deliberately omits geometry -- it would be megabytes.
  // Fetch the full row only for the one actually on screen.
  useEffect(() => {
    const row = rows[cursor];
    if (!row || !base || !token) { setDetail(null); return; }
    let cancelled = false;
    setDetail(null);
    setScore(row.rating ?? 50);
    fetch(`${base}/solutions/${encodeURIComponent(row.id)}`, { headers: auth })
      .then(response => response.ok ? response.json() : null)
      .then(body => { if (!cancelled && body?.solution) setDetail(body.solution as Row); })
      .catch(() => { if (!cancelled) setStatus("Could not load that solution's geometry."); });
    return () => { cancelled = true; };
  }, [rows, cursor, base, token]);

  const submit = async (value: number) => {
    const row = rows[cursor];
    if (!row) return;
    setStatus("Saving…");
    try {
      const response = await fetch(`${base}/solutions/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ rating: value }),
      });
      if (!response.ok) { setStatus(`Rating rejected: HTTP ${response.status}.`); return; }
      setRows(current => current.map((entry, index) =>
        index === cursor ? { ...entry, rating: value } : entry));
      setStatus(`Rated ${value}/100.`);
      // Rating is a queue, not a browser: step on so the next one is in front
      // of you without another click.
      if (cursor < rows.length - 1) setCursor(cursor + 1);
    } catch {
      setStatus("Could not reach the dataset.");
    }
  };

  const row = rows[cursor];
  const audit = parseJson<Partial<AuditRow>>(row?.audit, {});
  const hExt = parseJson<number[]>(row?.h_ext, []);
  const vExt = parseJson<number[]>(row?.v_ext, []);
  const ks = parseJson<number[]>(row?.ks_prefix, []);
  const parent = parseJson<Strand[]>(detail?.parent_strands, []);
  const solution = parseJson<Strand[]>(detail?.solution_strands, []);

  return (
    <main className="shell">
      <header className="masthead">
        <a className="brand" href=".."><span className="brand-mark">M</span>
          <span>MXN<small>categoriser</small></span></a>
        <span className="commit">{rows.length ? `${cursor + 1} / ${rows.length}` : "—"}</span>
      </header>

      <section className="rate-bar">
        <input type="url" placeholder="https://….workers.dev" value={apiUrl}
          onChange={e => { setApiUrl(e.target.value); writeSetting(API_KEY, e.target.value); }} />
        <input type="password" placeholder="admin token" value={token}
          onChange={e => { setToken(e.target.value); writeSetting(TOKEN_KEY, e.target.value); }} />
        <label className="toggle-line">
          <input type="checkbox" checked={onlyUnrated}
            onChange={e => setOnlyUnrated(e.target.checked)} />
          <span>unrated only</span>
        </label>
        <button type="button" className="run-button" onClick={load}>Load</button>
      </section>

      <p className="rate-status">{status}</p>

      {row && (
        <section className="rate-card">
          <div className="rate-head">
            <strong>{row.m} × {row.n} · k = {row.k} · L{row.level}</strong>
            <span>ks [{ks.join(", ")}] · solution #{row.solution_index}</span>
            <span>H ({hExt.join(", ")}) V ({vExt.join(", ")}) · total <b>{row.total_ext}</b></span>
            <span className={row.healthy ? "ok" : "bad"}>
              {audit.across}/{audit.expected} across · within {audit.within} ·
              stray {audit.stray} · broken {audit.broken}
            </span>
          </div>

          <div className="rate-rings">
            {detail
              ? <>
                  <Ring strands={parent} label={`L${row.level - 1} — what it was built on`} />
                  <Ring strands={solution} label={`L${row.level} — this solution`} />
                </>
              : <p className="rate-status">Loading geometry…</p>}
          </div>

          <div className="rate-score">
            <input type="range" min={0} max={100} value={score}
              onChange={e => setScore(Number(e.target.value))}
              aria-label="Score out of 100" />
            <b>{score}</b>
            <button type="button" className="run-button" onClick={() => submit(score)}>
              Save {score}
            </button>
            <button type="button" className="stop-button"
              onClick={() => setCursor(Math.min(cursor + 1, rows.length - 1))}>
              Skip
            </button>
            {row.rating !== null && <em>already rated {row.rating}</em>}
          </div>

          <div className="rate-quick">
            {[0, 25, 50, 75, 100].map(value => (
              <button key={value} type="button" onClick={() => { setScore(value); submit(value); }}>
                {value}
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
