"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  allBounds, drawExactStage,
  type AuditRow, type Bounds, type Stage, type Strand,
} from "../mxn-lab/weave-studio";

// The lab's own settings, read back rather than asked for again. Rating is the
// same operator on the same machine; making them paste the token twice would
// only invite pasting it somewhere worse.
const API_KEY = "mxn-lab-api";
const TOKEN_KEY = "mxn-lab-token";

// Coarse at the ends, fine at the top: the interesting distinction when rating
// weaves is between "good" and "excellent", not between 30 and 40.
const SCORES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100];

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

/**
 * Angle and length of each arm this level added.
 *
 * The angle the search settled on is not stored -- describe() never recorded it
 * and the table has no column for it -- but it is the direction of the arms it
 * produced, so it can be measured back off the geometry. That also means this
 * works on rows saved before anyone thought to want it.
 */
function armDetails(strands: Strand[], level: number) {
  const wanted = new Set([`_${2 * level + 2}`, `_${2 * level + 3}`]);
  const arms = strands.filter(strand =>
    strand.type === "AttachedStrand" && !strand.is_hidden
    && [...wanted].some(suffix => strand.layer_name.endsWith(suffix)));

  return arms.map(arm => {
    const dx = arm.end.x - arm.start.x;
    const dy = arm.end.y - arm.start.y;
    // Undirected: an arm drawn end-to-start is the same line, and 181 deg would
    // read as a different answer from 1 deg for no reason.
    let angle = Math.atan2(dy, dx) * 180 / Math.PI;
    if (angle < 0) angle += 180;
    if (angle >= 180) angle -= 180;
    return {
      name: arm.layer_name,
      angle,
      length: Math.hypot(dx, dy),
      vertical: Math.abs(dy) > Math.abs(dx),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function meanAngle(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
  const [status, setStatus] = useState("Connect the dataset to start rating.");
  const [onlyUnrated, setOnlyUnrated] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setApiUrl(readSetting(API_KEY));
    setToken(readSetting(TOKEN_KEY));
  }, []);

  const base = apiUrl.replace(/\/+$/, "");
  const row = rows[cursor];

  const load = async () => {
    if (!base || !token) { setStatus("Enter the worker URL and admin token."); return; }
    setStatus("Loading…");
    try {
      const query = onlyUnrated ? "?unrated=1&limit=500" : "?limit=500";
      const response = await fetch(`${base}/solutions${query}`,
        { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { setStatus(`Dataset said HTTP ${response.status}.`); return; }
      const body = await response.json();
      const list: Row[] = body.solutions ?? [];
      setRows(list);
      setCursor(0);
      setStatus(list.length
        ? `${list.length} to rate. Keys: 0–9 sets 0–90, Q/W = 95/100, S skips, ←/→ moves.`
        : onlyUnrated ? "Nothing left unrated." : "The dataset is empty.");
    } catch {
      setStatus("Could not reach the dataset.");
    }
  };

  // The list endpoint deliberately omits geometry -- it would be megabytes
  // across 500 rows. Fetch the full row only for the one actually on screen.
  useEffect(() => {
    if (!row || !base || !token) { setDetail(null); return; }
    let cancelled = false;
    setDetail(null);
    fetch(`${base}/solutions/${encodeURIComponent(row.id)}`,
      { headers: { Authorization: `Bearer ${token}` } })
      .then(response => response.ok ? response.json() : null)
      .then(body => { if (!cancelled && body?.solution) setDetail(body.solution as Row); })
      .catch(() => { if (!cancelled) setStatus("Could not load that solution's geometry."); });
    return () => { cancelled = true; };
  }, [row?.id, base, token]);

  const submit = useCallback(async (value: number) => {
    const current = rows[cursor];
    if (!current || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`${base}/solutions/${encodeURIComponent(current.id)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ rating: value }),
      });
      if (!response.ok) { setStatus(`Rating rejected: HTTP ${response.status}.`); return; }
      setRows(list => list.map((entry, index) =>
        index === cursor ? { ...entry, rating: value } : entry));
      setStatus(`Rated ${value}/100.`);
      // A queue, not a browser: land on the next one without another click.
      setCursor(index => Math.min(index + 1, rows.length - 1));
    } catch {
      setStatus("Could not reach the dataset.");
    } finally {
      setSaving(false);
    }
  }, [rows, cursor, base, token, saving]);

  // Rating hundreds of rings by mouse is the slow part, so the whole scale is
  // one keystroke away and never needs a modifier.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const key = event.key.toLowerCase();
      if (key >= "0" && key <= "9") { event.preventDefault(); submit(Number(key) * 10); return; }
      if (key === "q") { event.preventDefault(); submit(95); return; }
      if (key === "w") { event.preventDefault(); submit(100); return; }
      if (key === "s") { event.preventDefault(); setCursor(i => Math.min(i + 1, rows.length - 1)); return; }
      if (key === "arrowright") { setCursor(i => Math.min(i + 1, rows.length - 1)); return; }
      if (key === "arrowleft") { setCursor(i => Math.max(i - 1, 0)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, rows.length]);

  const audit = parseJson<Partial<AuditRow>>(row?.audit, {});
  const hExt = parseJson<number[]>(row?.h_ext, []);
  const vExt = parseJson<number[]>(row?.v_ext, []);
  const ks = parseJson<number[]>(row?.ks_prefix, []);
  const parent = parseJson<Strand[]>(detail?.parent_strands, []);
  const solution = parseJson<Strand[]>(detail?.solution_strands, []);
  const arms = row ? armDetails(solution, row.level) : [];
  const hAngle = meanAngle(arms.filter(a => !a.vertical).map(a => a.angle));
  const vAngle = meanAngle(arms.filter(a => a.vertical).map(a => a.angle));

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
          {/* Everything needed to judge, above the fold and in one glance. */}
          <div className="rate-head">
            <h1>{row.m} × {row.n}</h1>
            <span className="chip">k = {row.k}</span>
            <span className="chip">L{row.level}</span>
            <span className="chip">ks [{ks.join(", ")}]</span>
            <span className="chip">#{row.solution_index}</span>
            <span className="chip total">total {row.total_ext}px</span>
            <span className={`chip ${row.healthy ? "ok" : "bad"}`}>
              {row.healthy ? "weave" : "NOT a weave"} · {audit.across}/{audit.expected} across
              {audit.within ? ` · within ${audit.within}` : ""}
              {audit.stray ? ` · stray ${audit.stray}` : ""}
              {audit.broken ? ` · broken ${audit.broken}` : ""}
            </span>
            {row.rating !== null && <span className="chip rated">rated {row.rating}</span>}
          </div>

          <div className="rate-body">
            <div className="rate-rings">
              {detail
                ? <>
                    <Ring strands={parent} label={`L${row.level - 1} base`} />
                    <Ring strands={solution} label={`L${row.level} solution`} />
                  </>
                : <p className="rate-status">Loading geometry…</p>}
            </div>

            <div className="rate-detail">
              <table>
                <tbody>
                  <tr><th>H ext</th><td>{hExt.length ? hExt.map((e, i) => <b key={i}>{e}</b>) : "—"}</td></tr>
                  <tr><th>V ext</th><td>{vExt.length ? vExt.map((e, i) => <b key={i}>{e}</b>) : "—"}</td></tr>
                  <tr><th>H angle</th><td>{hAngle === null ? "—" : `${hAngle.toFixed(2)}°`}</td></tr>
                  <tr><th>V angle</th><td>{vAngle === null ? "—" : `${vAngle.toFixed(2)}°`}</td></tr>
                  <tr><th>gaps</th><td>{audit.gap ? audit.gap.map(g => g.toFixed(2)).join(" / ") : "—"}</td></tr>
                  <tr><th>masks</th><td>{audit.masks ?? "—"}</td></tr>
                </tbody>
              </table>
              {/* Angles are measured back off the drawn arms: the search's own
                  angle was never stored, and saying where the number came from
                  matters more than hiding that it is derived. */}
              <details>
                <summary>{arms.length} arms · per-arm angle and length</summary>
                <ul>
                  {arms.map(arm => (
                    <li key={arm.name}>
                      <code>{arm.name}</code> {arm.vertical ? "V" : "H"}
                      {" "}{arm.angle.toFixed(2)}° · {Math.round(arm.length)}px
                    </li>
                  ))}
                </ul>
                <p>Angles measured from the drawn arms — the search does not record its own.</p>
              </details>
            </div>
          </div>

          <div className="rate-scores" role="group" aria-label="Score this solution">
            {SCORES.map(value => (
              <button key={value} type="button" disabled={saving}
                className={value >= 90 ? "high" : ""}
                onClick={() => submit(value)}>
                {value}
              </button>
            ))}
            <button type="button" className="skip" disabled={saving}
              onClick={() => setCursor(i => Math.min(i + 1, rows.length - 1))}>
              skip
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
