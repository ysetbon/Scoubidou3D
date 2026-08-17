// The fitter's ladder, and the URL that opens it.
//
//   npm run check:ladder
//
// src/mxn-fit/ladder.ts is what /mxn/fit/ uses to read a k sequence out of a
// URL, to work out where each level of a stack belongs on the shelf, and to
// decide what "fixed" means for a level. None of it talks to an engine or a
// network, so all of it runs here.
//
// The URL at the top of this file is the one that started it. It was reported
// as "the page ignores my ks", and it was worse than that: the field parsed to
// nothing, the fitter fell back to its `ks=1` default, and a ten-level stitch
// opened as a one-level one with no complaint anywhere. Every parse case below
// is here so that cannot come back quietly.

import {
  askedFrom, ksOf, ladderRows, levelSpan, prefixDescriptor, stackAudit,
  stackLevels, stackMetrics, stackSummary, type FixedLevel,
} from "../src/mxn-fit/ladder";
import { parseSequence, specFromSearch } from "../src/mxn-farm/plan";
import { picksKey, type RunDescriptor } from "../src/mxn-lab/cache";

const THE_URL = "?m=2&n=1&ks=-1-1-1-1-1-1-1-1-1-1&hand=lh&direction=cw";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log("=========== the URL that opens a ten-level stitch ===========\n");

const asked = askedFrom(THE_URL, 8);
check("m and n come through", asked.m === 2 && asked.n === 1, `${asked.m}×${asked.n}`);
check("hand and direction come through",
  asked.hand === "lh" && asked.direction === "cw");
check("and ks is TEN levels of -1, not one and not none",
  asked.ksText === "-1 -1 -1 -1 -1 -1 -1 -1 -1 -1", String(asked.ksText));

console.log("\n=========== every spelling of the same sequence ===========\n");

for (const [text, want] of [
  ["-1-1-1-1-1-1-1-1-1-1", Array(10).fill(-1)],   // the compact URL form
  ["-1 -1 -1", [-1, -1, -1]],
  ["-1,-1,-1", [-1, -1, -1]],
  ["[-1,-1,-1]", [-1, -1, -1]],
  ["-1_-1_-1", [-1, -1, -1]],                     // as the cache key spells it
  ["−1−1", [-1, -1]],                   // typographic minus, compact
  ["1 1 -1", [1, 1, -1]],
  ["10-1", [10, -1]],                             // two-digit k, then a negative
  ["1-1-1", [1, -1, -1]],
  ["111", [111]],                                 // ONE k, not three
  ["-1", [-1]],
  ["", []],
] as [string, number[]][]) {
  check(`  ks="${text}"`, same(ksOf(text), want), `→ ${JSON.stringify(ksOf(text))}`);
}

check("  parseSequence agrees on the compact form",
  same(parseSequence("-1-1-1"), [-1, -1, -1]),
  JSON.stringify(parseSequence("-1-1-1")));
check("  and still refuses a line that is not a sequence",
  parseSequence("two levels") === null);
check("  the lab's own link parser takes it too",
  same(specFromSearch("?m=2&n=1&ks=-1-1-1")?.ksText, "-1 -1 -1"),
  String(specFromSearch("?m=2&n=1&ks=-1-1-1")?.ksText));

console.log("\n=========== where each level belongs on the shelf ===========\n");
//
// The engine's identity, from bridge.generate: the L1 of [k, …] is the L1 of
// [k]. So a ★ best judged on `ks=-1` IS this run's level 1 — and it is only
// found by asking for the prefix, because the full key holds all ten ks.

const TEN: RunDescriptor = {
  m: 2, n: 1, ks: Array(10).fill(-1), hand: "lh", direction: "cw",
  shortArms: true, step: "auto", budget: 400_000,
};

check("L1's parameters are the one-level run's",
  same(prefixDescriptor(TEN, 1).ks, [-1]));
check("L3's are the three-level run's",
  same(prefixDescriptor(TEN, 3).ks, [-1, -1, -1]));
check("the top level's are the whole run's",
  same(prefixDescriptor(TEN, 10).ks, TEN.ks));
check("and asking past the top does not invent a level",
  same(prefixDescriptor(TEN, 99).ks, TEN.ks));
check("L1's key is the key a single-k judgement was saved under",
  picksKey(prefixDescriptor(TEN, 1))
    === picksKey({ ...TEN, ks: [-1] }),
  picksKey(prefixDescriptor(TEN, 1)));
check("and it is NOT the ten-level key",
  picksKey(prefixDescriptor(TEN, 1)) !== picksKey(TEN));

console.log("\n=========== what state each level is in ===========\n");

const fixture = (level: number, rebuilt: boolean): FixedLevel => ({
  level, h: { ext: [0], angle: 180 }, v: { ext: [42.5, 80], angle: 60.6 },
  at: "2026-08-17T00:00:00.000Z", rebuilt,
  audit: { crossings: 8, expected: 8, stray: 0, broken: 0 },
  metrics: { neighbour_delta: 0.001 * level, spread: 0.002, gap_margin: 3.7 - level },
});

const base = {
  ks: [-1, -1, -1, -1],
  drawn: [1, 2, 3, 4],
  audits: [1, 2, 3, 4].map(level => ({
    level, across: level === 4 ? 8 : 6, expected: 8, healthy: level === 4,
  })),
  stale: [] as number[],
  proposed: false,
  pinned: false,
};

{
  const rows = ladderRows({ ...base, fitLevel: 2,
    fixed: { 1: fixture(1, true) }, pinned: true });
  check("a level adopted into the run reads as fixed",
    rows[0].state === "fixed", rows[0].state);
  check("the level being fitted is marked current",
    rows[1].current && !rows[0].current);
  check("everything above is still the engine's",
    rows.slice(1).every(row => row.state === "engine"));
  check("a fixed level quotes its own audit, not the run's",
    rows[0].across === 8 && rows[0].closes, `${rows[0].across}/${rows[0].expected}`);
  const summary = stackSummary(rows);
  check("the summary says 1 of 4, next is L2",
    summary.fixed === 1 && summary.total === 4 && summary.next === 2
    && !summary.complete, JSON.stringify(summary));
}

{
  // Nothing adopted yet, and L1 pinned to a judged best at run time.
  const rows = ladderRows({ ...base, fitLevel: 1, fixed: {}, pinned: true });
  check("a pinned L1 counts toward the stack without being re-fitted",
    rows[0].state === "pinned" && stackSummary(rows).next === 2,
    rows[0].state);
}

{
  // A fit on screen is not a fix — the levels above have not heard of it.
  const rows = ladderRows({ ...base, fitLevel: 3, fixed: {}, proposed: true });
  check("a fit on screen reads as proposed, not fixed",
    rows[2].state === "proposed" && stackSummary(rows).fixed === 0,
    rows[2].state);
}

{
  // Adopted without a rebuild: everything above stands on a ring that moved.
  const rows = ladderRows({ ...base, fitLevel: 2,
    fixed: { 2: fixture(2, false) }, stale: [3, 4] });
  check("levels above an un-rebuilt adopt read as stale",
    rows[2].state === "stale" && rows[3].state === "stale");
  check("and stale outranks everything else about them",
    same(stackSummary(rows).stale, [3, 4]));
}

{
  const rows = ladderRows({ ...base, fitLevel: 4,
    fixed: { 1: fixture(1, true), 2: fixture(2, true), 3: fixture(3, true),
             4: fixture(4, true) } });
  const summary = stackSummary(rows);
  check("a stack with every level fixed is complete",
    summary.complete && summary.next === null, JSON.stringify(summary));
}

{
  const open = ladderRows({ ...base, fitLevel: 1,
    fixed: { 1: { ...fixture(1, true),
                  audit: { crossings: 6, expected: 8, stray: 0, broken: 0 } } } });
  check("a fixed level whose ring does not close is counted as open",
    same(stackSummary(open).open, [1]));
}

console.log("\n=========== the stack a judgement carries ===========\n");

{
  const fixed = { 1: fixture(1, true), 2: fixture(2, true), 3: fixture(3, true) };
  check("every fixed level is in the list, in order",
    same(stackLevels(fixed).map(entry => entry.level), [1, 2, 3]));
  check("each carries its own two bands",
    stackLevels(fixed).every(entry => !!entry.h && !!entry.v));
  const worst = stackMetrics(fixed);
  check("the metrics are the stack's WORST, not the top level's",
    !!worst && Math.abs(worst.neighbour_delta - 0.003) < 1e-9
    && Math.abs(worst.spread - 0.002) < 1e-9
    && Math.abs(worst.gap_margin - 0.7) < 1e-9,
    JSON.stringify(worst));
  check("the audit is the ring the stack ends at",
    stackAudit(fixed)?.crossings === 8);
}

{
  // The rule that keeps a saved stack honest: a level adopted WITHOUT the
  // levels above being rebuilt on it never coexisted with them.
  const fixed = { 1: fixture(1, false), 2: fixture(2, true) };
  check("a run of levels is named as a range",
    levelSpan([1, 2, 3]) === "L1–L3", levelSpan([1, 2, 3]));
  check("a single level is named alone", levelSpan([2]) === "L2");
  check("and a gap is never smoothed into a range",
    levelSpan([1, 3]) === "L1, L3", levelSpan([1, 3]));

  check("a level fixed without a rebuild is refused from the stack",
    same(stackLevels(fixed).map(entry => entry.level), [2]),
    JSON.stringify(stackLevels(fixed).map(entry => entry.level)));
  check("but the top level needs no rebuild, and is kept",
    same(stackLevels({ 3: fixture(3, false) }).map(entry => entry.level), [3]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
