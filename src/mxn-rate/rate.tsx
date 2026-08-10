"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  drawExactStage,
  type AuditRow, type Bounds, type Stage, type Strand,
} from "../mxn-lab/weave-studio";

// The lab's own settings, read back rather than asked for again. Rating is the
// same operator on the same machine; making them paste the token twice would
// only invite pasting it somewhere worse.
const API_KEY = "mxn-lab-api";
const TOKEN_KEY = "mxn-lab-token";

// Coarse at the bottom, fine at the top: the distinction that matters when
// judging a weave is between good and excellent, not between 30 and 40.
const SCORES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100];

// Ten rings on screen at once. Each card carries two canvases and one geometry
// fetch, so this is the point where a page still loads briskly but a sitting
// gets through a meaningful batch without paging.
const PAGE = 10;

type Kind = "complete" | "semi";

type Row = {
  id: string; created_at: string;
  m: number; n: number; level: number; k: number;
  ks_prefix: string; h_ext: string; v_ext: string; total_ext: number;
  audit: string; healthy: number; solution_index: number;
  rating: number | null;
  /** 'complete' on rows written before near-misses existed. */
  kind?: string;
  /** For a near-miss, the band the shortfall is attributed to. */
  band?: string | null;
  deficit?: number;
  /** How many distinct working partners the band's value failed against. */
  refs?: number;
  /** Only present on the single-row endpoint. */
  parent_strands?: string;
  solution_strands?: string;
};

/**
 * What the two queues are for, in the words the page uses.
 *
 * The distinction is not cosmetic. On /mxn/rate/ the ring closes and the score
 * says how good a weave it is. On /mxn/semi/ the ring does NOT close, and the
 * score is about one band only: the other was held at a value taken from a ring
 * that does close, so a high score here is a claim that the engine rejected a
 * set of extensions it should have kept.
 */
const QUEUES = {
  complete: {
    chip: "CATEGORIZER",
    help: "Hover or arrow to a row, then 0–9 scores 0–90, Q 95, W 100, S skips. Rating moves to the next row.",
    empty: "Nothing left unrated.",
    other: { href: "../semi/", label: "Near-misses →" },
  },
  semi: {
    chip: "NEAR-MISSES",
    help: "These rings do not close. Score the marked band's numbers only — the other band was held at values taken from rings that do close, so 100 means the search threw away extensions it should have kept.",
    empty: "No unrated near-misses.",
    other: { href: "../rate/", label: "Closed rings →" },
  },
} as const;

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
 * Crop to the ring, with a little air around it.
 *
 * The lab's allBounds pads a flat 80 units and measures centrelines only, which
 * on a small ring is more white than stitch. Here the box is the drawn extent —
 * endpoints plus half a strand width, so the band itself is not clipped — grown
 * by a share of its own size, then squared. Squaring matters because
 * drawExactStage fits by the tighter axis and centres: bounds that are not the
 * canvas's aspect put the difference back as white.
 */
function tightBounds(strands: Strand[], marginRatio = 0.07): Bounds {
  const visible = strands.filter(s => s.type !== "MaskedStrand" && !s.is_hidden);
  const points = visible.flatMap(s => [s.start, s.end]);
  if (!points.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };

  const half = Math.max(...visible.map(s => s.width ?? 0), 0) / 2;
  const minX = Math.min(...points.map(p => p.x)) - half;
  const maxX = Math.max(...points.map(p => p.x)) + half;
  const minY = Math.min(...points.map(p => p.y)) - half;
  const maxY = Math.max(...points.map(p => p.y)) + half;

  const side = Math.max(maxX - minX, maxY - minY) * (1 + marginRatio * 2);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { minX: cx - side / 2, minY: cy - side / 2, maxX: cx + side / 2, maxY: cy + side / 2 };
}

/**
 * Angle and length of each arm this level added.
 *
 * The angle the search settled on is not stored — describe() never recorded it
 * and the table has no column for it — so it is measured back off the geometry.
 * That also means it works on rows saved before anyone thought to want it.
 */
function armDetails(strands: Strand[], level: number) {
  const wanted = [`_${2 * level + 2}`, `_${2 * level + 3}`];
  return strands
    .filter(s => s.type === "AttachedStrand" && !s.is_hidden
      && wanted.some(suffix => s.layer_name.endsWith(suffix)))
    .map(arm => {
      const dx = arm.end.x - arm.start.x;
      const dy = arm.end.y - arm.start.y;
      // Undirected: an arm drawn end-to-start is the same line, and 181 deg
      // would read as a different answer from 1 deg for no reason.
      let angle = Math.atan2(dy, dx) * 180 / Math.PI;
      if (angle < 0) angle += 180;
      return { name: arm.layer_name, angle, length: Math.hypot(dx, dy), vertical: Math.abs(dy) > Math.abs(dx) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function meanAngle(values: number[]) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

function Ring({ strands, tag }: { strands: Strand[]; tag: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stage: Stage = useMemo(
    () => ({ level: 1, k: null, label: tag, strands }), [strands, tag]);
  const bounds = useMemo(() => tightBounds(strands), [strands]);
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
      <span className="ring-tag">{tag}</span>
      <canvas ref={ref} role="img" aria-label={`${tag} ring`} />
    </figure>
  );
}

function Card({ row, detail, kind, focused, saving, onRate, onFocus }: {
  row: Row; detail: Row | undefined; kind: Kind; focused: boolean; saving: boolean;
  onRate: (value: number) => void; onFocus: () => void;
}) {
  const audit = parseJson<Partial<AuditRow>>(row.audit, {});
  const hExt = parseJson<number[]>(row.h_ext, []);
  const vExt = parseJson<number[]>(row.v_ext, []);
  const ks = parseJson<number[]>(row.ks_prefix, []);
  const semi = kind === "semi";
  const blamed = row.band === "h" || row.band === "v" ? row.band : null;
  const parent = parseJson<Strand[]>(detail?.parent_strands, []);
  const solution = parseJson<Strand[]>(detail?.solution_strands, []);
  const arms = armDetails(solution, row.level);
  const hAngle = meanAngle(arms.filter(a => !a.vertical).map(a => a.angle));
  const vAngle = meanAngle(arms.filter(a => a.vertical).map(a => a.angle));

  return (
    <article
      className={`card ${focused ? "is-focused" : ""} ${row.rating !== null ? "is-rated" : ""} ${semi ? "is-semi" : ""}`}
      onMouseEnter={onFocus}
      onFocusCapture={onFocus}
    >
      <div className="card-ident">
        <h2>{row.m} × {row.n}</h2>
        <span className="chip">k = {row.k}</span>
        <span className="chip">L{row.level}</span>
        <span className="chip">ks [{ks.join(", ")}]</span>
        <span className="chip">#{row.solution_index}</span>
        <span className="chip chip-total">{row.total_ext}px</span>
        {semi ? (
          <>
            {/* The band under judgement leads, because it is the whole question
                the card is asking. Everything after it is context. */}
            <span className={`chip chip-band band-${blamed ?? "x"}`}>
              {blamed === "h" ? "Judge H · V held good"
                : blamed === "v" ? "Judge V · H held good"
                : "Band not recorded"}
            </span>
            <span className="chip chip-bad">
              {audit.across}/{audit.expected}
              {row.deficit ? ` · ${row.deficit} short` : ""}
            </span>
            {/* One working partner is weak evidence, three is strong. The card
                says which it is rather than letting the score imply certainty
                the scan never had. */}
            <span className="chip" title="distinct working partners this value failed against">
              vs {row.refs ?? 0} good {row.refs === 1 ? "partner" : "partners"}
            </span>
          </>
        ) : (
          <span className={`chip ${row.healthy ? "chip-good" : "chip-bad"}`}>
            {row.healthy ? "Weave" : "NOT a weave"} {audit.across}/{audit.expected}
          </span>
        )}
        {row.rating !== null && <span className="chip chip-rated">Rated {row.rating}</span>}
      </div>

      <div className="card-body">
        <div className="card-rings">
          {detail ? <Ring strands={parent} tag="BASE" /> : <div className="ring is-empty" />}
          <span className="card-arrow" aria-hidden="true">→</span>
          {detail ? <Ring strands={solution} tag="SOLUTION" /> : <div className="ring is-empty" />}
        </div>

        <dl className="card-metrics">
          <div className={blamed === "h" ? "is-judged" : ""}><dt>H EXT</dt><dd className="nums">{hExt.length ? hExt.map((e, i) => <b key={i}>{e}</b>) : "—"}</dd></div>
          <div className={blamed === "v" ? "is-judged" : ""}><dt>V EXT</dt><dd className="nums">{vExt.length ? vExt.map((e, i) => <b key={i}>{e}</b>) : "—"}</dd></div>
          <div className={blamed === "h" ? "is-judged" : ""}><dt>H ANGLE</dt><dd>{hAngle === null ? "—" : `${hAngle.toFixed(2)}°`}</dd></div>
          <div className={blamed === "v" ? "is-judged" : ""}><dt>V ANGLE</dt><dd>{vAngle === null ? "—" : `${vAngle.toFixed(2)}°`}</dd></div>
          {/* Two averages, one per band -- the engine records no gap per pair,
              so this does not pretend to show one. */}
          <div><dt>AVG GAP</dt><dd>{audit.gap
            ? `H ${audit.gap[0].toFixed(2)} · V ${audit.gap[1].toFixed(2)}` : "—"}</dd></div>
          {semi
            /* On a near-miss, a band whose own arms cross each other is
               malformed on its own terms — that is worth a 0 without looking
               any further, so it gets a slot of its own. */
            ? <div className={audit.within ? "is-judged" : ""}><dt>WITHIN</dt><dd>{audit.within ?? "—"}</dd></div>
            : <div><dt>MASKS</dt><dd>{audit.masks ?? "—"}</dd></div>}
        </dl>
      </div>

      <div className="card-scale" role="group" aria-label={`Score ${row.m} by ${row.n} solution`}>
        {SCORES.map(value => (
          <button key={value} type="button" disabled={saving}
            className={`${value >= 90 ? "is-high" : ""} ${row.rating === value ? "is-picked" : ""}`}
            onClick={() => onRate(value)}>{value}</button>
        ))}
      </div>
    </article>
  );
}

export function Categoriser({ kind = "complete" }: { kind?: Kind }) {
  const queue = QUEUES[kind];
  const [apiUrl, setApiUrl] = useState("");
  const [token, setToken] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [details, setDetails] = useState<Record<string, Row>>({});
  const [page, setPage] = useState(0);
  const [focus, setFocus] = useState(0);
  const [status, setStatus] = useState("");
  const [onlyUnrated, setOnlyUnrated] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setApiUrl(readSetting(API_KEY));
    setToken(readSetting(TOKEN_KEY));
  }, []);

  const base = apiUrl.replace(/\/+$/, "");
  const urlOk = /^https?:\/\/.+/.test(base);
  const tokenOk = token.length > 8;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageRows = useMemo(
    () => rows.slice(page * PAGE, page * PAGE + PAGE), [rows, page]);

  const load = async () => {
    if (!urlOk || !tokenOk) { setStatus("Enter the worker URL and admin token."); return; }
    setStatus("Loading…");
    try {
      const query = new URLSearchParams({ kind, limit: "500" });
      if (onlyUnrated) query.set("unrated", "1");
      const response = await fetch(`${base}/solutions?${query}`,
        { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { setStatus(`Dataset said HTTP ${response.status}.`); return; }
      const list: Row[] = (await response.json()).solutions ?? [];
      setRows(list);
      setPage(0);
      setFocus(0);
      setStatus(list.length ? ""
        : onlyUnrated ? queue.empty
        : kind === "semi" ? "No near-misses saved yet — star one in the lab’s ◑ mode."
        : "The dataset is empty.");
    } catch {
      setStatus("Could not reach the dataset.");
    }
  };

  // The list endpoint omits geometry -- it would be megabytes across 500 rows.
  // Pull it for the ten actually on screen, in parallel, and keep what arrives
  // so paging back is instant.
  useEffect(() => {
    if (!urlOk || !tokenOk) return;
    let cancelled = false;
    const missing = pageRows.filter(r => !details[r.id]);
    if (!missing.length) return;
    Promise.all(missing.map(r =>
      fetch(`${base}/solutions/${encodeURIComponent(r.id)}`,
        { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.ok ? res.json() : null)
        .then(body => body?.solution as Row | undefined)
        .catch(() => undefined)))
      .then(fetched => {
        if (cancelled) return;
        setDetails(current => {
          const next = { ...current };
          for (const entry of fetched) if (entry) next[entry.id] = entry;
          return next;
        });
      });
    return () => { cancelled = true; };
  }, [pageRows, base, token, urlOk, tokenOk, details]);

  const rate = useCallback(async (id: string, value: number) => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch(`${base}/solutions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ rating: value }),
      });
      if (!response.ok) { setStatus(`Rating rejected: HTTP ${response.status}.`); return; }
      setRows(list => list.map(e => e.id === id ? { ...e, rating: value } : e));
      setStatus("");
      // Rating a card hands the keyboard to the next one, so a whole page can
      // be cleared without touching the mouse.
      setFocus(f => Math.min(f + 1, pageRows.length - 1));
    } catch {
      setStatus("Could not reach the dataset.");
    } finally {
      setSaving(false);
    }
  }, [base, token, saving, pageRows.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const current = pageRows[focus];
      const key = event.key.toLowerCase();
      if (current && key >= "0" && key <= "9") { event.preventDefault(); rate(current.id, Number(key) * 10); return; }
      if (current && key === "q") { event.preventDefault(); rate(current.id, 95); return; }
      if (current && key === "w") { event.preventDefault(); rate(current.id, 100); return; }
      if (key === "s" || key === "arrowdown") { event.preventDefault(); setFocus(f => Math.min(f + 1, pageRows.length - 1)); return; }
      if (key === "arrowup") { event.preventDefault(); setFocus(f => Math.max(f - 1, 0)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageRows, focus, rate]);

  const rated = rows.filter(r => r.rating !== null).length;

  return (
    <div className={`cat ${kind === "semi" ? "cat-semi" : ""}`}>
      <header className="cat-top">
        <a className="cat-brand" href="..">
          <span className="cat-mark">M</span>
          <b>MXN</b>
          <span className="cat-chip-solid">{queue.chip}</span>
        </a>
        <a className="cat-switch" href={queue.other.href}>{queue.other.label}</a>
        <span className="cat-progress">
          {rows.length ? `${rated} / ${rows.length} rated · page ${page + 1} of ${pages}` : "—"}
        </span>
      </header>

      <section className="cat-conn">
        <label className="cat-field">
          <span>API URL</span>
          <span className="cat-input">
            <input type="url" placeholder="https://….workers.dev" value={apiUrl}
              onChange={e => { setApiUrl(e.target.value); writeSetting(API_KEY, e.target.value); }} />
            {urlOk && <b className="cat-ok" aria-label="looks valid">✓</b>}
          </span>
        </label>
        <label className="cat-field">
          <span>API KEY</span>
          <span className="cat-input">
            <input type="password" placeholder="admin token" value={token}
              onChange={e => { setToken(e.target.value); writeSetting(TOKEN_KEY, e.target.value); }} />
            {tokenOk && <b className="cat-ok" aria-label="present">✓</b>}
          </span>
        </label>
        <label className="cat-check">
          <input type="checkbox" checked={onlyUnrated}
            onChange={e => setOnlyUnrated(e.target.checked)} />
          <span>Unrated only</span>
        </label>
        <button type="button" className="cat-load" onClick={load}>LOAD →</button>
      </section>

      <p className="cat-status">
        {status || (rows.length ? queue.help : "Connect the dataset and press Load.")}
      </p>

      <div className="cat-list">
        {pageRows.map((row, index) => (
          <Card key={row.id} row={row} detail={details[row.id]} kind={kind}
            focused={index === focus} saving={saving}
            onRate={value => rate(row.id, value)}
            onFocus={() => setFocus(index)} />
        ))}
      </div>

      {rows.length > 0 && (
        <nav className="cat-nav">
          <button type="button" disabled={page === 0}
            onClick={() => { setPage(p => Math.max(p - 1, 0)); setFocus(0); }}>← Previous 10</button>
          <span>Showing <b>{page * PAGE + 1}</b>–{Math.min((page + 1) * PAGE, rows.length)} of {rows.length}</span>
          <button type="button" disabled={page >= pages - 1}
            onClick={() => { setPage(p => Math.min(p + 1, pages - 1)); setFocus(0); }}>Next 10 →</button>
        </nav>
      )}
    </div>
  );
}
