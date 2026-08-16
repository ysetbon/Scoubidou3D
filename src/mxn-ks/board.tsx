"use client";

// The k board, at /mxn/ks/-1 (and /mxn/ks/1, /mxn/ks/-2, … — one page per k).
//
// /mxn/ks/ holds the SIZE still and asks what happens across k. This holds K
// still and asks what happens across size: one k, the whole 8x8 plane, and in
// every tile the ring that is currently the best known answer for that cell.
//
// The rule the page is built around:
//
//     A PERSON OUTRANKS THE ENGINE.
//
// A ★ best judged at /mxn/fit/ fills its tile even when the farm has since
// swept the same parameters — no recency, no completeness and no source
// overturns it. The engine's own answer stays visible underneath rather than
// being dropped, because "where did a hand improve on the machine" is most of
// what a board like this is for.
//
// Three things it must not get wrong, and all three are about ABSENCE, which is
// what a board of mostly-empty tiles is really made of:
//
//   an inadmissible cell is not a hole. kLimits refuses k = -1 at 1x1, so that
//   tile is hatched and is not a link. Sending somebody to fit a ring that
//   cannot exist would be the worst failure available to a page whose whole
//   argument is "an empty tile means nobody has been here".
//
//   a cell is ks = [k] at LEVEL 1. A judgement at L2 is conditioned on the
//   level below it and is not this cell's answer. A RUN at ks = [-1, 2] is
//   different: its L1 is the ks = [-1] search, so it counts — and says where it
//   came from rather than implying a sweep nobody ran.
//
//   a fetch that failed is not an empty cell. Every unreadable key is listed on
//   the page. A hole has to mean nobody has been here, or the board says
//   nothing at all.
//
// The page never computes. There is no Pyodide here and no engine: everything
// drawn was either judged by a person at /mxn/fit/ or swept by the farm at
// /mxn/gpu/, and is being read back.

import {
  useCallback, useEffect, useMemo, useRef, useState, type DragEvent,
} from "react";

import {
  CACHE_URL_KEY, createCache, readCacheBase, readSetting, writeSetting,
  type CacheClient, type RunDescriptor,
} from "../mxn-lab/cache";
import { kLimits } from "../mxn-farm/plan";
import { allBounds, drawExactStage, type Bounds, type Stage } from "../mxn-lab/exact-draw";
import { saveJson, today } from "../mxn-lab/save-file";
import {
  BOARD_MAX, KIND_GLYPH, KIND_NAME, SIDES, boardKRange, cellKey,
  describeCell, entriesFromFile, fitUrl, foldBoard, handKey, nextHole, stageOf,
  tallyBoard, type BoardCell, type BoardEntry, type LoadedFile,
} from "./board-model";
import {
  listRunSide, pooled, readBrowserSide, readPicksSide, readRun,
} from "./board-shelf";

const BASE = import.meta.env.BASE_URL;

const HAND_DIRECTIONS = ["lh-cw", "lh-ccw", "rh-cw", "rh-ccw"];

/** One slot per k, so two boards do not overwrite each other's dropped files. */
const FILES_SLOT = (k: number) => `mxn-ks-board-files-${k}`;

/**
 * How much dropped JSON is worth keeping between visits.
 *
 * localStorage is about 5 MB for the whole origin and the lab's own settings
 * live in it too. A judgement carrying its ring is a few kB, so a working set
 * of dropped picks fits easily; a dumped shelf of everything does not, and is
 * held in memory for the session instead — said on screen rather than silently.
 */
const FILES_LIMIT = 1_500_000;

const cellId = (m: number, n: number) => `${m}x${n}`;

const short = (at: string) => (at ? at.slice(0, 16).replace("T", " ") : "—");

const fmt = (value: number | undefined, digits = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";

/** `[40, 10]` → `40 · 10`, and an empty band → `—`. */
const extText = (ext: number[] | undefined) =>
  ext?.length ? ext.map(e => fmt(e)).join(" · ") : "—";

// ---------------------------------------------------------------------------
// The drawing.
//
// drawExactStage is the lab's own renderer, lifted out of weave-studio.tsx so
// that more than one page could draw a ring. Each tile is framed to ITSELF: an
// 8x8 spans many times a 1x1 and one shared frame would leave the small ones as
// specks, so what to read across the board is the shape, with the numbers
// underneath saying the scale.
// ---------------------------------------------------------------------------

function Ring({ stage, size, background = "#fbf8ef" }: {
  stage: Stage; size: number; background?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const bounds: Bounds = useMemo(() => allBounds([stage]), [stage]);
  useEffect(() => {
    const canvas = ref.current;
    // A fixed pixel size rather than a measured one: these are dozens of small
    // canvases and they do not need to reflow, they need to be cheap.
    if (canvas) drawExactStage(canvas, stage, bounds, false, size, background);
  }, [stage, bounds, size, background]);
  return <canvas ref={ref} width={size} height={size} />;
}

// ---------------------------------------------------------------------------
// One tile.
// ---------------------------------------------------------------------------

function Tile({ cell, k, size, selected, onSelect }: {
  cell: BoardCell;
  k: number;
  size: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { m, n } = cell;

  if (!cell.admissible) {
    const { min, max } = kLimits(m, n);
    return (
      <div
        className="board-tile is-outside"
        title={`${m}×${n} admits k ${min}…${max}, so k = ${k} is not a ring that exists here`}
      >
        <b>{m}×{n}</b>
        <i>k ∉ {min}…{max}</i>
      </div>
    );
  }

  if (cell.state === "empty" || cell.state === "rejected") {
    const href = fitUrl(BASE, m, n, [k], "lh", "cw");
    return (
      <a
        className={`board-tile is-hole${cell.state === "rejected" ? " is-rejected" : ""}`}
        href={href}
        target="_blank"
        rel="noopener"
        title={cell.state === "rejected"
          ? `${cell.rejected?.chooser ?? "somebody"} ruled a ring out here and nothing has `
            + `replaced it — open the fitter at ${describeCell(m, n, k)} and try again`
          : `nobody has been to ${describeCell(m, n, k)} — open the fitter here`}
      >
        <b>{m}×{n}</b>
        <span className="board-plus">{cell.state === "rejected" ? "✗" : "+"}</span>
        <i>{cell.state === "rejected" ? "rejected · fit again" : "fit this"}</i>
      </a>
    );
  }

  const entry = cell.chosen!;
  const stage = stageOf(entry);
  const improved = entry.kind !== "engine" && !!cell.engine;

  return (
    <button
      type="button"
      className={`board-tile is-${entry.kind}${selected ? " is-on" : ""}`}
      onClick={onSelect}
      title={`${describeCell(m, n, k)} — ${KIND_NAME[entry.kind]}`
        + (entry.chooser ? `, judged by ${entry.chooser}` : "")
        + (improved ? " · the engine also swept this one" : "")}
    >
      <span className="board-tile-top">
        <b>{m}×{n}</b>
        <em>{KIND_GLYPH[entry.kind]}</em>
      </span>
      <span className="board-art">
        {stage
          ? <Ring stage={stage} size={size} />
          : <span className="board-noring" style={{ width: size, height: size }}>
              {entry.kind === "engine" ? "run on the shelf" : "no ring stored"}
            </span>}
      </span>
      <i>
        {entry.kind === "engine"
          ? `ext ${fmt(entry.run?.extPeak)}`
          : entry.chooser ?? "hand"}
        {improved ? " ·↑" : ""}
      </i>
    </button>
  );
}

// ---------------------------------------------------------------------------
// The page.
// ---------------------------------------------------------------------------

export function KBoard({ k }: { k: number }) {
  const [base, setBase] = useState(() => readCacheBase("board"));
  const [handDirection, setHandDirection] = useState("lh-cw");

  const [shelfEntries, setShelfEntries] = useState<BoardEntry[]>([]);
  const [browserEntries, setBrowserEntries] = useState<BoardEntry[]>(() => readBrowserSide(k));
  const [files, setFiles] = useState<LoadedFile[]>([]);

  const [runList, setRunList] = useState<{ key: string; descriptor: RunDescriptor; computedAt: string }[]>([]);
  const [runBodies, setRunBodies] = useState<Record<string, BoardEntry>>({});

  const [status, setStatus] = useState("");
  const [problem, setProblem] = useState("");
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const [truncated, setTruncated] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [drawEngine, setDrawEngine] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tileSize, setTileSize] = useState(88);
  const [filesKept, setFilesKept] = useState(true);

  /** Set when a read is superseded, so a slow reply cannot overwrite a fast one. */
  const readToken = useRef(0);
  /** Flipped to stop the engine-drawing pool without unmounting the page. */
  const stopDrawing = useRef(false);

  const cache: CacheClient | null = useMemo(
    () => (base ? createCache({ base, hostId: "board" }) : null), [base]);

  // --- dropped files, remembered -------------------------------------------

  useEffect(() => {
    try {
      const held = JSON.parse(readSetting(FILES_SLOT(k)) || "[]") as LoadedFile[];
      if (Array.isArray(held) && held.length) setFiles(held);
    } catch { /* a torn slot reads as no files, not as an error */ }
  }, [k]);

  const keepFiles = useCallback((next: LoadedFile[]) => {
    let body = "";
    try {
      body = JSON.stringify(next);
    } catch {
      setFilesKept(false);
      return;
    }
    if (body.length > FILES_LIMIT) {
      // Cleared rather than left holding the previous set: a slot that no longer
      // matches what is on screen is worse than an empty one.
      writeSetting(FILES_SLOT(k), "");
      setFilesKept(false);
      return;
    }
    writeSetting(FILES_SLOT(k), body);
    setFilesKept(true);
  }, [k]);

  // --- reading the shelf ----------------------------------------------------

  const read = useCallback(async () => {
    if (!cache) {
      setProblem("No worker url — put one in the field below, or drop a picks file "
        + "exported from /mxn/fit/ onto the board.");
      return;
    }
    const mine = readToken.current + 1;
    readToken.current = mine;
    stopDrawing.current = true;
    setBusy(true);
    setProblem("");
    setStatus("Reading the judgements…");
    setProgress(null);
    try {
      const picks = await readPicksSide(cache, k, (done, total) => {
        if (mine === readToken.current) setProgress({ done, total });
      });
      if (mine !== readToken.current) return;
      setShelfEntries(picks.entries);
      setBrowserEntries(readBrowserSide(k));
      setUnreadable(picks.unreadable);
      setStatus(`${picks.entries.length} judgement${picks.entries.length === 1 ? "" : "s"} `
        + `at k = ${k} · listing the engine's runs…`);

      const runs = await listRunSide(cache, k);
      if (mine !== readToken.current) return;
      setRunList(runs.wanted);
      setRunBodies({});
      setTruncated([...picks.truncated, ...runs.truncated]);
      setProgress(null);
      setStatus(`${picks.entries.length} judgement${picks.entries.length === 1 ? "" : "s"} · `
        + `${runs.wanted.length} engine run${runs.wanted.length === 1 ? "" : "s"} at k = ${k}`);
    } catch (error) {
      if (mine !== readToken.current) return;
      setProblem(`The shelf would not answer — ${(error as Error).message}. `
        + "Reads are public, so this is a URL or a network, not a token.");
    } finally {
      if (mine === readToken.current) setBusy(false);
    }
  }, [cache, k]);

  useEffect(() => { void read(); }, [read]);

  // --- the engine's bodies, fetched behind the board ------------------------

  /**
   * Fill in the runs, cheapest question first.
   *
   * The catalogue said WHICH cells the farm has swept, which is enough to paint
   * the board; a run's body is up to 240 kB and most of that is the ring, so it
   * is fetched afterwards and in a bounded pool, with the tiles filling in as
   * they land. A cell whose tile a person already won is fetched last: its ring
   * is not what will be drawn, only the "the engine also did this one" note.
   */
  useEffect(() => {
    if (!cache || !drawEngine || !runList.length) return;
    const mine = readToken.current;
    stopDrawing.current = false;
    let live = true;

    const handmade = new Set(shelfEntries.concat(browserEntries)
      .filter(e => e.kind === "best" || e.kind === "valid")
      .map(e => cellId(e.m, e.n)));
    const queue = runList
      .filter(row => !runBodies[row.key])
      .sort((a, b) =>
        Number(handmade.has(cellId(a.descriptor.m, a.descriptor.n)))
        - Number(handmade.has(cellId(b.descriptor.m, b.descriptor.n))));
    if (!queue.length) return;

    let done = 0;
    setProgress({ done: 0, total: queue.length });
    void pooled(queue, 3, async row => {
      if (!live || stopDrawing.current || mine !== readToken.current) return;
      const { entry } = await readRun(cache, row.key, row.descriptor, row.computedAt, k);
      done += 1;
      if (!live || mine !== readToken.current) return;
      setProgress({ done, total: queue.length });
      if (entry) setRunBodies(held => ({ ...held, [row.key]: entry }));
    }).then(() => {
      if (live && mine === readToken.current) setProgress(null);
    });

    return () => { live = false; };
    // runBodies is deliberately not a dependency: it is what this effect writes,
    // and depending on it would restart the pool on every tile that lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, drawEngine, runList, k, shelfEntries, browserEntries]);

  // --- folding --------------------------------------------------------------

  const fileEntries = useMemo(() => files.flatMap(f => f.entries), [files]);

  /**
   * Every answer known for this k, from all four places, filtered to one hand.
   *
   * The hand-direction filter is not cosmetic: an `lh-cw` ring and an `rh-ccw`
   * ring at the same size are different objects, and a board that mixed them
   * would be four boards drawn on top of each other. Which other hands hold
   * something is reported per cell instead.
   */
  const entries = useMemo(() => {
    const runEntries = runList.map(row =>
      runBodies[row.key] ?? {
        m: row.descriptor.m, n: row.descriptor.n, k, kind: "engine" as const,
        origin: "shelf" as const, from: row.key, at: row.computedAt,
        descriptor: row.descriptor, ks: row.descriptor.ks,
        strands: null, h: null, v: null,
      });
    return [...shelfEntries, ...browserEntries, ...fileEntries, ...runEntries];
  }, [shelfEntries, browserEntries, fileEntries, runList, runBodies, k]);

  const onHand = useMemo(
    () => entries.filter(e => handKey(e.descriptor) === handDirection), [entries, handDirection]);

  const cells = useMemo(() => foldBoard(k, onHand), [k, onHand]);
  const tally = useMemo(() => tallyBoard(cells), [cells]);

  /** Which other hand-directions hold anything, so a filter cannot hide a shelf. */
  const otherHands = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      const key = handKey(entry.descriptor);
      if (key === handDirection) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries, handDirection]);

  const current = useMemo(
    () => cells.find(c => cellId(c.m, c.n) === selected) ?? null, [cells, selected]);

  // --- files ----------------------------------------------------------------

  const absorb = useCallback(async (list: FileList | File[]) => {
    const read = await Promise.all([...list].map(async file => {
      try {
        return entriesFromFile(file.name, await file.text(), k);
      } catch {
        return { name: file.name, shape: "unreadable", entries: [], otherK: 0,
                 problem: "the file would not open" } as LoadedFile;
      }
    }));
    setFiles(held => {
      // Same name, same file: dropping a corrected export replaces the old
      // reading rather than stacking a second one behind it.
      const next = [...held.filter(f => !read.some(r => r.name === f.name)), ...read];
      keepFiles(next);
      return next;
    });
    const made = read.reduce((sum, f) => sum + f.entries.length, 0);
    setStatus(read.length === 1 && read[0].problem
      ? `${read[0].name}: ${read[0].problem}`
      : `${read.length} file${read.length === 1 ? "" : "s"} read · `
        + `${made} answer${made === 1 ? "" : "s"} at k = ${k}`);
  }, [k, keepFiles]);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer?.files?.length) void absorb(event.dataTransfer.files);
  };

  const forgetFile = (name: string) => {
    setFiles(held => {
      const next = held.filter(f => f.name !== name);
      keepFiles(next);
      return next;
    });
  };

  /** What is on screen, as a file — the board's own answer to "what do we have". */
  const exportBoard = () => {
    saveJson(`mxn-k${k}-board-${today()}.json`, {
      generatedAt: new Date().toISOString(),
      k,
      handDirection,
      source: base || "no worker",
      board: { max: BOARD_MAX },
      tally,
      caveats: [
        "A cell is ks = [k] at level 1. Judgements at deeper levels are conditioned "
        + "on the levels below them and are not this board's answer.",
        "An inadmissible cell is not a hole: kLimits refuses some k at some sizes.",
        "Engine entries without run figures are keys the catalogue listed whose "
        + "bodies had not been fetched when this was written.",
      ],
      cells: cells.filter(c => c.admissible).map(c => ({
        m: c.m, n: c.n, state: c.state,
        chosen: c.chosen && {
          kind: c.chosen.kind, chooser: c.chosen.chooser ?? null, at: c.chosen.at,
          origin: c.chosen.origin, from: c.chosen.from, ks: c.chosen.ks,
          hExt: c.chosen.h?.ext ?? null, hAngle: c.chosen.h?.angle ?? null,
          vExt: c.chosen.v?.ext ?? null, vAngle: c.chosen.v?.angle ?? null,
          metrics: c.chosen.metrics ?? null, audit: c.chosen.audit ?? null,
          hasRing: !!c.chosen.strands?.length,
        },
        engineAlso: c.engine ? { at: c.engine.at, extPeak: c.engine.run?.extPeak ?? null } : null,
        rejected: c.rejected ? { chooser: c.rejected.chooser ?? null, at: c.rejected.at } : null,
      })),
    });
  };

  const goToHole = () => {
    const hole = nextHole(cells, current ? { m: current.m, n: current.n } : undefined);
    if (!hole) { setStatus(`No holes left at k = ${k} — every admissible cell has something.`); return; }
    setSelected(cellId(hole.m, hole.n));
    const [hand, direction] = handDirection.split("-");
    window.open(fitUrl(BASE, hole.m, hole.n, [k], hand, direction), "_blank", "noopener");
  };

  const ks = boardKRange();

  return (
    <div
      className={`board${dragging ? " is-dragging" : ""}`}
      onDragOver={event => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <header className="board-top">
        <a className="board-brand" href="../">
          <span className="board-mark">k</span>
          <span>
            <b>MXN · k {k}</b><br />
            <i>EVERY SIZE AT ONE k</i>
          </span>
        </a>
        <div className="board-top-right">{status}</div>
      </header>

      <p className="board-lede">
        One k, held still, across every size up to <b>{BOARD_MAX}×{BOARD_MAX}</b>. Each tile
        draws the best ring anybody has for that cell, and <b>a person outranks the engine</b> —
        a ★ best you judged at <a href="../../fit/">the fitter</a> fills its tile even when
        the farm has swept the same parameters, with the engine's answer kept beside it rather
        than dropped. A hatched tile is a k that size cannot hold; an <b>empty tile is a hole</b>,
        and pressing it opens the fitter there, ready to edit.
        The sibling page <a href="../">the k atlas</a> asks the other half of this question —
        one size, every k.
      </p>

      <nav className="board-ks" aria-label="every k with a board">
        {ks.map(other => (
          <a
            key={other}
            className={`board-k${other === k ? " is-on" : ""}`}
            href={`../${other}/`}
            aria-current={other === k ? "page" : undefined}
          >
            {other > 0 ? `+${other}` : other}
          </a>
        ))}
      </nav>

      <div className="board-grid">
        <div className="board-col">
          <section className="board-panel">
            <h2>The shelf</h2>
            <label className="board-field">
              <span>worker url</span>
              <input
                value={base}
                onChange={event => setBase(event.target.value.replace(/\/+$/, ""))}
                onBlur={() => writeSetting(CACHE_URL_KEY, base)}
                placeholder="https://…workers.dev"
                spellCheck={false}
              />
            </label>
            <p className="board-note">
              Reads are public, so no token is needed here. This page never writes: a
              verdict is a button somebody presses, and that button is at the fitter.
            </p>
            <label className="board-field">
              <span>hand · direction</span>
              <select value={handDirection} onChange={event => setHandDirection(event.target.value)}>
                {HAND_DIRECTIONS.map(hd => <option key={hd} value={hd}>{hd}</option>)}
              </select>
            </label>
            {otherHands.length > 0 && (
              <p className="board-note">
                Other hands hold answers too:{" "}
                {otherHands.map(([hd, count]) => (
                  <button
                    key={hd} type="button" className="board-inline"
                    onClick={() => setHandDirection(hd)}
                  >
                    {hd} ({count})
                  </button>
                ))}
                . They are different rings, not different views of one — which is why
                the board shows one at a time.
              </p>
            )}
            <label className="board-check">
              <input
                type="checkbox" checked={drawEngine}
                onChange={event => {
                  setDrawEngine(event.target.checked);
                  if (!event.target.checked) { stopDrawing.current = true; setProgress(null); }
                }}
              />
              <span>
                draw the engine's rings — fetches each run's body, which is where its
                geometry and its figures both live. Untick to leave engine tiles as
                "swept, not drawn".
              </span>
            </label>
            <div className="board-row">
              <button type="button" className="board-go" onClick={() => void read()} disabled={busy}>
                {busy ? "reading…" : "reload"}
              </button>
              <button type="button" className="board-ghost" onClick={exportBoard}>
                export this board
              </button>
            </div>
            {progress && (
              <div className="board-progress">
                <i style={{ width: `${Math.round(100 * progress.done / Math.max(1, progress.total))}%` }} />
              </div>
            )}
            {problem && <p className="board-warn">{problem}</p>}
            {truncated.length > 0 && (
              <p className="board-warn">
                {truncated.length} prefix{truncated.length === 1 ? "" : "es"} came back exactly
                full even after being subdivided, so this board may be a slice of the shelf
                rather than the whole of it: {truncated.join(", ")}.
              </p>
            )}
            {unreadable.length > 0 && (
              <p className="board-warn">
                {unreadable.length} key{unreadable.length === 1 ? " was" : "s were"} listed but
                would not come back. Those cells are drawn as if empty and are not —
                {" "}{unreadable.slice(0, 4).join(", ")}
                {unreadable.length > 4 ? ` and ${unreadable.length - 4} more` : ""}.
              </p>
            )}
          </section>

          <section className="board-panel">
            <h2>Your own files</h2>
            <p className="board-note">
              Drop JSON anywhere on this page, or pick it below. A ★ best in a file
              outranks an engine run exactly as one on the shelf does — the ladder is by
              what the answer <b>is</b>, not by where it was read from.
            </p>
            <label className="board-field">
              <span>load json</span>
              <input
                type="file" accept=".json,application/json" multiple
                onChange={event => {
                  if (event.target.files?.length) void absorb(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
            <details className="board-details">
              <summary>what it accepts</summary>
              <ul className="board-list">
                <li><b>a picks artifact</b> — <code>kind: "picks"</code>, as the shelf stores it</li>
                <li><b>judgement rows</b> — <code>mxn-fit-judgements</code> out of the fitter's localStorage</li>
                <li><b>an atlas dump</b> — <code>ks-atlas.json</code>, the engine's records</li>
                <li><b>a fit report</b> — <code>*.fit.json</code>: the knobs, with no ring</li>
                <li>
                  <b>a ring export</b> — the bare strand array. It carries no parameters, so
                  it is placed by its file name (<code>mxn-2x1-k1-lh-cw-L1-….json</code>);
                  a renamed one cannot be placed and says so rather than guessing.
                </li>
              </ul>
            </details>
            {files.length > 0 && (
              <ul className="board-files">
                {files.map(file => (
                  <li key={file.name}>
                    <span>
                      <b>{file.name}</b>
                      <i>
                        {file.problem
                          ? file.problem
                          : `${file.shape} · ${file.entries.length} at k = ${k}`
                            + (file.otherK ? ` · ${file.otherK} at another k, dropped` : "")}
                      </i>
                    </span>
                    <button type="button" onClick={() => forgetFile(file.name)}>forget</button>
                  </li>
                ))}
              </ul>
            )}
            {files.length > 0 && !filesKept && (
              <p className="board-warn">
                Too much to keep between visits, so these are held for this session only —
                drop them again after a reload.
              </p>
            )}
          </section>

          <section className="board-panel">
            <h2>What this k has</h2>
            <ul className="board-tally">
              <li><b>{tally.handmade}</b><span>tiles a person judged</span></li>
              <li><b>{tally.improved}</b><span>where a hand beat a run the engine had already done</span></li>
              <li><b>{tally.engine}</b><span>tiles the engine alone holds</span></li>
              <li><b>{tally.rejectedOnly}</b><span>tried and ruled out, nothing standing</span></li>
              <li><b>{tally.holes}</b><span>holes — admissible, and nobody has been</span></li>
              <li><b>{tally.outside}</b><span>sizes that cannot hold k = {k}</span></li>
            </ul>
            <button type="button" className="board-go" onClick={goToHole} disabled={!tally.holes}>
              open the next hole in the fitter
            </button>
            <p className="board-note">
              {tally.admissible} of {BOARD_MAX * BOARD_MAX} sizes admit k = {k}
              {tally.admissible
                ? ` · ${Math.round(100 * (tally.handmade + tally.engine) / tally.admissible)}% of them hold something`
                : ""}.
            </p>
          </section>

          <section className="board-panel">
            <h2>Reading a tile</h2>
            <ul className="board-legend">
              <li><span className="board-swatch is-best" />★ a ★ best somebody judged</li>
              <li><span className="board-swatch is-valid" />✓ judged valid, no best yet</li>
              <li><span className="board-swatch is-engine" />▣ the engine's run, nobody has judged it</li>
              <li><span className="board-swatch is-rejected" />✗ ruled out — press it to fit again</li>
              <li><span className="board-swatch is-hole" />+ a hole — press it to start</li>
              <li><span className="board-swatch is-outside" />hatched — this size cannot hold this k</li>
            </ul>
            <p className="board-note">
              <b>·↑</b> on a tile means a person's ring is drawn and the engine had swept that
              cell too. Every tile is framed to itself, so read the shape across the board and
              the numbers for the scale.
            </p>
            <label className="board-field">
              <span>tile size — {tileSize}px</span>
              <input
                type="range" min={56} max={168} step={8} value={tileSize}
                onChange={event => setTileSize(Number(event.target.value))}
              />
            </label>
          </section>
        </div>

        <div className="board-col">
          <section className="board-panel">
            <h2>k = {k} · m across, n down</h2>
            <div className="board-plane" style={{ "--tile": `${tileSize + 46}px` } as never}>
              <div className="board-corner"><i>n \ m</i></div>
              {SIDES.map(m => <div key={`h${m}`} className="board-head">{m}</div>)}
              {SIDES.map(n => (
                <div key={`row${n}`} className="board-rowline" style={{ display: "contents" }}>
                  <div className="board-head is-side">{n}</div>
                  {SIDES.map(m => {
                    const cell = cells.find(c => c.m === m && c.n === n)!;
                    return (
                      <Tile
                        key={cellId(m, n)}
                        cell={cell}
                        k={k}
                        size={tileSize}
                        selected={selected === cellId(m, n)}
                        onSelect={() => setSelected(cellId(m, n))}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </section>

          {current && current.admissible && (
            <CellPanel cell={current} k={k} handDirection={handDirection} />
          )}
        </div>
      </div>

      {dragging && <div className="board-drop">drop JSON to fold it into this board</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One cell, opened.
//
// Every answer for it rather than only the winner: the point of the ladder is
// that it can be checked, and a panel that showed only what won would be asking
// to be trusted about the thing the page is arguing.
// ---------------------------------------------------------------------------

function CellPanel({ cell, k, handDirection }: {
  cell: BoardCell; k: number; handDirection: string;
}) {
  const [hand, direction] = handDirection.split("-");
  const { min, max } = kLimits(cell.m, cell.n);
  return (
    <section className="board-panel">
      <h2>{describeCell(cell.m, cell.n, k)}</h2>
      <p className="board-note">
        This size admits k <b>{min}…{max}</b>. {cell.entries.length
          ? `${cell.entries.length} answer${cell.entries.length === 1 ? "" : "s"} known, best first.`
          : "Nothing known here yet."}
      </p>
      <div className="board-row">
        <a
          className="board-go"
          href={fitUrl(BASE, cell.m, cell.n, [k], hand, direction)}
          target="_blank"
          rel="noopener"
        >
          open in the fitter
        </a>
      </div>
      {cell.entries.map((entry, at) => (
        <article className={`board-entry is-${entry.kind}${at === 0 && entry.kind !== "rejected" ? " is-drawn" : ""}`} key={`${entry.from}-${entry.at}-${at}`}>
          <header>
            <b>{KIND_GLYPH[entry.kind]} {KIND_NAME[entry.kind]}</b>
            <span>{entry.chooser ?? "the engine"} · {short(entry.at)} · {entry.origin}</span>
          </header>
          {stageOf(entry) && <Ring stage={stageOf(entry)!} size={200} />}
          <dl>
            <div><dt>H ext</dt><dd>{extText(entry.h?.ext)}</dd></div>
            <div><dt>H angle</dt><dd>{entry.h?.angle === null || entry.h?.angle === undefined ? "—" : `${fmt(entry.h.angle, 2)}°`}</dd></div>
            <div><dt>V ext</dt><dd>{extText(entry.v?.ext)}</dd></div>
            <div><dt>V angle</dt><dd>{entry.v?.angle === null || entry.v?.angle === undefined ? "—" : `${fmt(entry.v.angle, 2)}°`}</dd></div>
            {entry.audit && (
              <div>
                <dt>crossings</dt>
                <dd className={entry.audit.crossings === entry.audit.expected ? "" : "is-warn"}>
                  {entry.audit.crossings}/{entry.audit.expected}
                </dd>
              </div>
            )}
            {entry.metrics && (
              <div><dt>neighbour Δ</dt><dd>{fmt(entry.metrics.neighbour_delta, 2)}</dd></div>
            )}
            {entry.run && (
              <>
                <div><dt>ext peak</dt><dd>{fmt(entry.run.extPeak)}</dd></div>
                <div>
                  <dt>closed</dt>
                  <dd className={entry.run.healthy ? "" : "is-warn"}>{entry.run.healthy ? "yes" : "no"}</dd>
                </div>
              </>
            )}
            <div><dt>ks</dt><dd>{entry.ks.join(" · ")}{entry.ks.length > 1 ? " — L1 of a deeper run" : ""}</dd></div>
          </dl>
          {entry.note && <p className="board-note">“{entry.note}”</p>}
          <p className="board-key"><code>{cellKey(entry.descriptor)}</code></p>
        </article>
      ))}
    </section>
  );
}
