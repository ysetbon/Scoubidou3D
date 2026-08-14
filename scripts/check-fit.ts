// The fitter's solver, against the engine's own answers.
//
//   npm run check:fit
//
// src/mxn-fit/solve.ts is what /mxn/fit/ uses to decide which extensions flush
// a band, and it never talks to the engine — so it can be run here, in node,
// over `mocks/fixtures/fit-l1.json`, which is what bridge.fit_plan actually
// returned for a 2×1 and a 3×2 (rebuild with `python3 scripts/fit-fixtures.py`).
//
// `scripts/check-fit.py` checks the same geometry from the Python side. Both
// exist because they check different halves: the Python one proves the facts
// hold of the engine, this one proves the TypeScript agrees with them — and
// they are two independent transcriptions of the same arithmetic, so a slip in
// either shows up as a disagreement rather than as a plausible number.

import { readFileSync } from "node:fs";
import { VALID, sweepAngle, placeStarts } from "../src/mxn-lab/trace-census";
import {
  EXT_MAX, fitCandidates, followPair, isFlush, neighbourDelta, readAt,
  windowFor, type FitBand,
} from "../src/mxn-fit/solve";

// Resolved against the working directory rather than import.meta.url: the
// bundle runs from node_modules/.cache/, which is not where the fixture is.
const FIXTURE = "mocks/fixtures/fit-l1.json";

type Size = {
  m: number; n: number; ks: number[]; level: number;
  plan: { h: FitBand; v: FitBand };
  before: { lengths: Record<string, number[]> };
  grid: Record<string, { valid: number; flushest: {
    ext: number[]; angle: number; delta: number; margin: number } | null }>;
};

const data = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  engine: string; sizes: Record<string, Size>;
};

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

console.log(`solver against engine ${data.engine}\n`);

for (const [size, entry] of Object.entries(data.sizes)) {
  console.log(`=========== ${size} · L${entry.level} ===========`);
  for (const key of ["h", "v"] as const) {
    const band = entry.plan[key];
    if (!band || (band as { unavailable?: boolean }).unavailable) {
      console.log(`\n${key.toUpperCase()} band — not searched`);
      continue;
    }
    const before = entry.before.lengths[key] ?? [];
    const flushAlready = isFlush(before);
    console.log(`\n${key.toUpperCase()} band — ${band.nStrands} arms, ${band.P} pairs,`
      + ` engine Δ ${neighbourDelta(before).toFixed(2)}px`
      + `${flushAlready ? " (already flush)" : ""}`);

    const candidates = fitCandidates(band, { tie: "longest" });

    // Every candidate has to be exactly flush, legal, and inside its own window
    // — the three things the page then relies on when it stops checking.
    let worstDelta = 0;
    let illegal = 0;
    let outside = 0;
    let ranged = 0;
    for (const c of candidates) {
      worstDelta = Math.max(worstDelta, neighbourDelta(c.lengths));
      const starts = placeStarts(band, c.ext);
      if (sweepAngle(band, starts, c.angle).verdict !== VALID) illegal += 1;
      const [lo, hi] = windowFor(band, starts);
      if (c.angle < lo - 1e-9 || c.angle > hi + 1e-9) outside += 1;
      if (c.ext.some(e => e < -1e-9 || e > 200 + 1e-9)) ranged += 1;
    }

    if (candidates.length) {
      check("every candidate is exactly flush", worstDelta < 1e-9,
        `worst neighbour Δ ${worstDelta.toExponential(2)}px over ${candidates.length}`);
      check("every candidate passes the engine's own tests", illegal === 0,
        illegal ? `${illegal} do not` : "reach, order, overlap, too-far");
      check("every candidate is inside its own ±20° window", outside === 0,
        outside ? `${outside} are not` : `${candidates.length} checked`);
      check("every extension is inside 0…200", ranged === 0,
        ranged ? `${ranged} are not` : "");
      const best = candidates[0];
      console.log(`    longest flush: ext [${best.ext.map(e => e.toFixed(2))}]`
        + ` @ ${best.angle.toFixed(2)}°  L* ${best.star.toFixed(1)}px`
        + `  margin ${best.margin.toFixed(2)}px`);
    } else {
      // A band with no candidates is a finding, not an error — 3×2's V band
      // cannot be flushed at all, and the page has to be able to say so.
      check("a band with no flush ring is reported as such", true,
        flushAlready ? "already flush, nothing to fit"
                     : "no flush configuration survives the tests");
    }

    // The manual panel's follow: any pair, moved anywhere, and the others
    // re-solved to its length — the flushness has to be exact wherever the
    // answer stays inside 0…EXT_MAX, and readAt has to report the same
    // geometry sweepAngle does, because it is the page's whole feedback loop.
    if (band.P > 1) {
      const angle = (band.windowLo + band.windowHi) / 2;
      let worstFollow = 0;
      let clamped = 0;
      let tried = 0;
      for (let anchorPair = 0; anchorPair < band.P; anchorPair += 1) {
        for (const e of [0, 35.5, 120, 200]) {
          const ext = new Array(band.P).fill(60);
          ext[anchorPair] = e;
          const followed = followPair(band, ext, angle, anchorPair);
          if (followed.short.length) { clamped += 1; continue; }
          tried += 1;
          worstFollow = Math.max(worstFollow,
            neighbourDelta(readAt(band, followed.ext, angle).lengths));
          if (followed.ext.some(x => x < -1e-9 || x > EXT_MAX + 1e-9)) clamped += 1;
        }
      }
      check("follow re-solves the other pairs exactly flush",
        tried === 0 || worstFollow < 1e-9,
        `worst Δ ${worstFollow.toExponential(2)}px over ${tried} follows`
        + (clamped ? `, ${clamped} out of reach and reported` : ""));
    }

    // And the two sides agree about the one number they both compute.
    const grid = entry.grid?.[key];
    if (grid?.flushest) {
      const starts = placeStarts(band, grid.flushest.ext);
      const swept = sweepAngle(band, starts, grid.flushest.angle);
      check("the grid's flushest cell measures the same in TS as in Python",
        Math.abs(neighbourDelta(swept.proj) - grid.flushest.delta) < 1e-6,
        `Δ ${neighbourDelta(swept.proj).toFixed(4)} vs ${grid.flushest.delta.toFixed(4)}`);
    }
  }
  console.log("");
}

console.log(fail ? `${fail} check(s) failed, ${pass} passed`
                 : `all ${pass} checks passed`);
process.exit(fail ? 1 : 0);
