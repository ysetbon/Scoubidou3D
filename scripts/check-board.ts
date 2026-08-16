// The k board's rules, in node.
//
//   npm run check:board
//
// src/mxn-ks/board-model.ts is pure and React-free precisely so this can run:
// the ladder that decides which of two answers for one cell gets drawn is the
// page's whole argument, and an argument that lives inside a component is one
// nobody can check.
//
// Four things are pinned here, and each of them is a way the page could look
// perfectly fine while lying:
//
//   1. a person outranks the engine, in every combination and either order
//   2. an inadmissible cell is not a hole — and so is never a link to /mxn/fit/
//   3. a judgement at level 2 is not this board's answer
//   4. every k in the range has a page, and every page is in the range
//
// The dropped-file adapters are checked over bytes shaped exactly as the fitter
// and the shelf actually write them, because "the page would not read my own
// export" is the failure a file-loading feature has.

import { readFileSync } from "node:fs";
import type { Judgement, PicksArtifact, RunDescriptor } from "../src/mxn-lab/cache";
import { kLimits } from "../src/mxn-farm/plan";
import {
  BOARD_MAX, admits, boardKRange, entriesFromFile, entryFromJudgement,
  entryFromRecord, fitUrl, foldBoard, foldCell, nextHole, parseRingFileName,
  tallyBoard, type BoardEntry,
} from "../src/mxn-ks/board-model";
import type { AtlasRecord } from "../src/mxn-ks/model";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const FLAGS = { shortArms: true, step: "auto" as const, budget: 400_000 };

const descriptorAt = (m: number, n: number, ks: number[]): RunDescriptor =>
  ({ m, n, ks, hand: "lh", direction: "cw", ...FLAGS });

const judgementAt = (
  verdict: Judgement["verdict"], at: string, level = 1, chooser = "yonatan",
): Judgement => ({
  id: `${verdict}-${at}`, verdict, source: "fitter", chooser, at,
  levels: [{ level, h: { ext: [40, 10], angle: -172.5 }, v: { ext: [20], angle: 8.25 } }],
  strands: [{ id: "a", points: [] }],
});

const recordAt = (m: number, n: number, ks: number[], at: string): AtlasRecord => ({
  runKey: `run/v3/lh-cw/${m}x${n}/${ks.join("_")}/s1-e5-b100000000`,
  m, n, k: ks[0], level: 1, levels: ks.length, ks, hand: "lh", direction: "cw",
  shortArms: true, step: 5, budget: 100_000_000, computedAt: at, seconds: 90,
  hExt: [60, 40], vExt: [60], extPeak: 60, extTotal: 160, gapH: 12, gapV: 9,
  across: 8, expected: 8, masks: 2, healthy: true, degenerate: false,
});

// ===========================================================================
console.log("=========== a person outranks the engine ===========");

const K = -1;

const handEntry = (verdict: Judgement["verdict"], at: string) =>
  entryFromJudgement(judgementAt(verdict, at), descriptorAt(3, 2, [K]), K, "shelf", "picks/…")!;
const engineEntry = (at: string) =>
  entryFromRecord(recordAt(3, 2, [K], at), K, "shelf")!;

{
  // The engine's run is newer by two years, and still loses.
  const cell = foldCell(3, 2, K, [engineEntry("2026-08-16T00:00:00Z"),
                                  handEntry("best", "2024-01-01T00:00:00Z")]);
  check("a ★ best from years ago beats a run from this morning",
    cell.chosen?.kind === "best" && cell.state === "handmade",
    `drew ${cell.chosen?.kind}`);
  check("the engine's answer is kept beside it rather than dropped",
    !!cell.engine, cell.engine ? "engine entry present" : "engine entry lost");
}

{
  // Same two, offered the other way round: order in must not decide.
  const cell = foldCell(3, 2, K, [handEntry("best", "2024-01-01T00:00:00Z"),
                                  engineEntry("2026-08-16T00:00:00Z")]);
  check("the ladder does not depend on the order the answers arrive in",
    cell.chosen?.kind === "best");
}

{
  const cell = foldCell(3, 2, K, [engineEntry("2026-08-16T00:00:00Z"),
                                  handEntry("valid", "2024-01-01T00:00:00Z")]);
  check("a ✓ valid with no ★ best still beats the engine",
    cell.chosen?.kind === "valid", `drew ${cell.chosen?.kind}`);
}

{
  const cell = foldCell(3, 2, K, [handEntry("valid", "2025-01-01T00:00:00Z"),
                                  handEntry("best", "2024-01-01T00:00:00Z")]);
  check("a ★ best beats a NEWER ✓ valid — rank first, recency second",
    cell.chosen?.kind === "best");
}

{
  const cell = foldCell(3, 2, K, [handEntry("valid", "2024-01-01T00:00:00Z"),
                                  handEntry("valid", "2026-01-01T00:00:00Z")]);
  check("two answers of the same rank resolve to the later one",
    cell.chosen?.at === "2026-01-01T00:00:00Z", `drew ${cell.chosen?.at}`);
}

{
  // A ✗ must not blank a good run: rejecting one ring says nothing about another.
  const cell = foldCell(3, 2, K, [handEntry("rejected", "2026-08-16T00:00:00Z"),
                                  engineEntry("2024-01-01T00:00:00Z")]);
  check("a ✗ rejected does not blank the engine's answer",
    cell.chosen?.kind === "engine" && cell.state === "engine", `state ${cell.state}`);
  check("but the rejection is still reported on the cell", !!cell.rejected);
}

{
  const cell = foldCell(3, 2, K, [handEntry("rejected", "2026-08-16T00:00:00Z")]);
  check("a cell with nothing but a ✗ is 'rejected', not 'empty'",
    cell.state === "rejected" && cell.chosen === null, `state ${cell.state}`);
}

// ===========================================================================
console.log("\n=========== an inadmissible cell is not a hole ===========");

{
  // 1x1 admits k 0…1, so k = -1 is not a ring that exists there.
  check("kLimits refuses k = -1 at 1x1", !admits(1, 1, -1),
    `1x1 admits ${kLimits(1, 1).min}…${kLimits(1, 1).max}`);
  const cell = foldCell(1, 1, -1, []);
  check("so its tile is 'outside' rather than 'empty'",
    cell.state === "outside" && !cell.admissible, `state ${cell.state}`);
}

{
  const board = foldBoard(-1, []);
  const tally = tallyBoard(board);
  check("an empty board counts every admissible cell as a hole and no others",
    tally.holes === tally.admissible && tally.holes + tally.outside === BOARD_MAX * BOARD_MAX,
    `${tally.holes} holes, ${tally.outside} outside, ${BOARD_MAX * BOARD_MAX} tiles`);
  check("k = -1 is admissible at 63 of the 64 sizes on the board",
    tally.admissible === 63, `${tally.admissible} admissible`);
  check("the next hole is never an inadmissible cell",
    board.filter(c => c.state === "empty").every(c => c.admissible));
  const hole = nextHole(board);
  check("nextHole walks m fastest, so it starts at the first admissible cell",
    hole?.m === 2 && hole?.n === 1, hole ? `${hole.m}×${hole.n}` : "none");
}

{
  // Every k the generator makes a page for must be admissible SOMEWHERE, and
  // every k admitted by a size on the board must have a page. Either failing is
  // a cell that cannot be drawn, which is this page's worst available bug.
  const range = boardKRange();
  const admittedSomewhere = (k: number) =>
    range.length > 0 && foldBoard(k, []).some(c => c.admissible);
  check("every k in the board range is admissible at some size on the board",
    range.every(admittedSomewhere), `k ${range[0]}…${range[range.length - 1]}`);
  let widest = { min: 0, max: 0 };
  for (let m = 1; m <= BOARD_MAX; m += 1) {
    for (let n = 1; n <= BOARD_MAX; n += 1) {
      const limits = kLimits(m, n);
      widest = { min: Math.min(widest.min, limits.min), max: Math.max(widest.max, limits.max) };
    }
  }
  check("and no size admits a k the range leaves out",
    range[0] === widest.min && range[range.length - 1] === widest.max,
    `range ${range[0]}…${range[range.length - 1]} vs sizes ${widest.min}…${widest.max}`);

  // The pages on disk, against the same range. A shell that is missing is a URL
  // that 404s; one that is left over is a board vite no longer builds.
  const missing = range.filter(k => {
    try {
      return !readFileSync(`mxn/ks/${k}/index.html`, "utf8").includes(`data-k="${k}"`);
    } catch {
      return true;
    }
  });
  check("every k in the range has a page shell that states its own k",
    missing.length === 0,
    missing.length ? `missing or wrong: ${missing.join(", ")}` : `${range.length} pages`);
}

// ===========================================================================
console.log("\n=========== a cell is ks = [k] at level 1 ===========");

{
  const deep = entryFromJudgement(
    judgementAt("best", "2026-01-01T00:00:00Z", 2), descriptorAt(3, 2, [K, 2]), K, "shelf", "k");
  check("a judgement about level 2 is not an answer for this board", deep === null);

  const wrongK = entryFromJudgement(
    judgementAt("best", "2026-01-01T00:00:00Z"), descriptorAt(3, 2, [2, K]), K, "shelf", "k");
  check("a judgement whose sequence merely CONTAINS k is not one either",
    wrongK === null);

  const l1OfDeep = entryFromRecord(recordAt(3, 2, [K, 2], "2026-01-01T00:00:00Z"), K, "shelf");
  check("but a run at ks = [k, …] does count — its L1 IS the ks = [k] search",
    l1OfDeep !== null && l1OfDeep.ks.length === 2,
    l1OfDeep ? `ks ${l1OfDeep.ks.join(",")}` : "dropped");

  const l2OfDeep = entryFromRecord(
    { ...recordAt(3, 2, [K, 2], "2026-01-01T00:00:00Z"), level: 2, k: 2 }, K, "shelf");
  check("while that same run's level 2 does not", l2OfDeep === null);
}

// ===========================================================================
console.log("\n=========== the link out ===========");

{
  const url = fitUrl("/Scoubidou3D/", 3, 2, [K], "lh", "cw");
  check("an empty tile links to the fitter with every knob filled in",
    url === "/Scoubidou3D/mxn/fit/?m=3&n=2&ks=-1&hand=lh&direction=cw", url);
  const deepUrl = fitUrl("/Scoubidou3D/", 3, 2, [K, 2], "rh", "ccw");
  check("a sequence travels as a sequence",
    deepUrl.includes("ks=-1+2") && deepUrl.includes("hand=rh"), deepUrl);
}

// ===========================================================================
console.log("\n=========== files off the reader's own machine ===========");

{
  const artifact: PicksArtifact = {
    kind: "picks", cacheVersion: "v3", descriptor: descriptorAt(4, 3, [K]),
    judgements: [judgementAt("best", "2026-02-02T00:00:00Z"),
                 judgementAt("valid", "2026-01-01T00:00:00Z")],
  };
  const read = entriesFromFile("picks.json", JSON.stringify(artifact), K);
  check("a picks artifact reads as its judgements",
    read.entries.length === 2 && read.shape === "picks artifact",
    `${read.entries.length} entries, shape ${read.shape}`);
  check("and a ★ best in a FILE outranks a run on the shelf",
    foldCell(4, 3, K, [...read.entries, entryFromRecord(
      recordAt(4, 3, [K], "2026-08-16T00:00:00Z"), K, "shelf")!]).chosen?.kind === "best");

  const otherK = entriesFromFile("picks.json", JSON.stringify(
    { ...artifact, descriptor: descriptorAt(4, 3, [3]) }), K);
  check("a file about another k contributes nothing and says how much it dropped",
    otherK.entries.length === 0 && otherK.otherK === 2,
    `${otherK.otherK} dropped`);
}

{
  const rows = [{ key: `picks/v3/lh-cw/2x1/${K}/s1-eauto-b400000`,
                  judgement: judgementAt("best", "2026-03-03T00:00:00Z") }];
  const read = entriesFromFile("mxn-fit-judgements.json", JSON.stringify(rows), K);
  check("the fitter's localStorage rows read, with the KEY supplying the parameters",
    read.entries.length === 1 && read.entries[0].m === 2 && read.entries[0].n === 1,
    `${read.entries.length} entries`);
}

{
  const dump = { records: [recordAt(5, 4, [K], "2026-04-04T00:00:00Z")] };
  const read = entriesFromFile("ks-atlas.json", JSON.stringify(dump), K);
  check("an atlas dump reads as the engine's records",
    read.entries.length === 1 && read.entries[0].kind === "engine",
    `${read.entries.length} entries`);
}

{
  const report = { params: { m: 2, n: 2, ks: [K], hand: "lh", direction: "cw" },
                   engine: { level: 1, k: K },
                   bands: [{ band: "horizontal", after: { ext: [30, 20], angle: -170 } },
                           { band: "vertical", before: { ext: [10, 10], angle: 6 } }] };
  const read = entriesFromFile("x.fit.json", JSON.stringify(report), K);
  check("a *.fit.json reads as knobs with no ring",
    read.entries.length === 1 && read.entries[0].strands === null
    && read.entries[0].h?.ext.join(",") === "30,20",
    read.entries[0] ? `h ${read.entries[0].h?.ext.join(",")}` : "nothing");
}

{
  const named = parseRingFileName("mxn-2x1-k-1-lh-cw-L1-2026-08-16.json");
  check("a ring export's file name places it",
    named?.descriptor.m === 2 && named?.descriptor.ks.join(",") === "-1",
    named ? `${named.descriptor.m}×${named.descriptor.n} ks ${named.descriptor.ks}` : "unplaced");
  const read = entriesFromFile("mxn-2x1-k-1-lh-cw-L1-2026-08-16.json",
    JSON.stringify([{ id: "a", points: [] }]), K);
  check("and it lands on that cell carrying its ring",
    read.entries.length === 1 && !!read.entries[0].strands, `${read.entries.length} entries`);

  const anon = entriesFromFile("ring.json", JSON.stringify([{ id: "a" }]), K);
  check("a renamed ring export is refused rather than guessed at",
    anon.entries.length === 0 && !!anon.problem, anon.problem ?? "accepted");
}

{
  const bad = entriesFromFile("notes.txt", "not json at all", K);
  check("a file that is not JSON says so instead of throwing",
    bad.entries.length === 0 && bad.problem === "not JSON", bad.problem ?? "");
}

// ===========================================================================
console.log("\n=========== the tally ===========");

{
  const entries: BoardEntry[] = [
    handEntry("best", "2026-01-01T00:00:00Z"),                       // 3x2, improved
    engineEntry("2025-01-01T00:00:00Z"),                             // 3x2
    entryFromRecord(recordAt(4, 4, [K], "2025-01-01T00:00:00Z"), K, "shelf")!,
    entryFromJudgement(judgementAt("rejected", "2026-01-01T00:00:00Z"),
      descriptorAt(2, 2, [K]), K, "shelf", "picks/…")!,
  ];
  const tally = tallyBoard(foldBoard(K, entries));
  check("the tally separates a hand that beat a run from one that stands alone",
    tally.handmade === 1 && tally.improved === 1 && tally.engine === 1,
    `${tally.handmade} handmade, ${tally.improved} improved, ${tally.engine} engine`);
  check("a rejected-only cell is counted apart from a hole",
    tally.rejectedOnly === 1 && tally.holes === tally.admissible - 3,
    `${tally.rejectedOnly} rejected, ${tally.holes} holes`);
}

console.log(`\n${fail ? `${fail} check(s) failed, ${pass} passed`
                      : `all ${pass} checks passed`}`);
process.exit(fail ? 1 : 0);
