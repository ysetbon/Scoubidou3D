// src/mxn-lab/trace-census.ts is a port of mxn_trace.sweep_combo. The pending
// sweep paints verdicts from it and the trace panel draws cells with it, so a
// port that disagrees with the engine is a widget that lies confidently. This
// holds the two to the same answer, combo for combo and angle for angle.
//
//     python3 scripts/census-fixtures.py     # once, or after a test changes
//     npm run check:census
import { readFileSync } from "node:fs";

import {
  VERDICT_NAMES, comboExt, placeStarts, sweepAngle, type TraceInputs,
} from "../src/mxn-lab/trace-census";

type Case = {
  plan: TraceInputs & { combos: number };
  angles: number[];
  verdicts: number[][];
};

// Relative to the working directory, not to this module: npm runs it from the
// project root, and the bundle it runs lives in node_modules/.cache itself.
const FIXTURE = "node_modules/.cache/census-check.json";
let cases: Record<string, Case>;
try {
  cases = JSON.parse(readFileSync(FIXTURE, "utf8"));
} catch {
  console.log("Missing node_modules/.cache/census-check.json\n"
    + "Run: python3 scripts/census-fixtures.py");
  process.exit(2);
}

let failures = 0;
for (const [band, one] of Object.entries(cases)) {
  const { plan, angles, verdicts } = one;
  let checked = 0;
  const tally = new Map<string, number>();

  for (let i = 0; i < verdicts.length; i += 1) {
    const starts = placeStarts(plan, comboExt(plan, i));
    for (let j = 0; j < angles.length; j += 1) {
      const mine = sweepAngle(plan, starts, angles[j]).verdict;
      checked += 1;
      if (mine === verdicts[i][j]) {
        tally.set(VERDICT_NAMES[mine], (tally.get(VERDICT_NAMES[mine]) ?? 0) + 1);
        continue;
      }
      failures += 1;
      if (failures <= 5) {
        console.log(`  FAIL  ${band} combo ${i} angle ${angles[j].toFixed(2)}°`
          + ` — python says ${VERDICT_NAMES[verdicts[i][j]]},`
          + ` the page says ${VERDICT_NAMES[mine]}`);
      }
    }
  }
  const spread = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${name} ${n.toLocaleString()}`)
    .join(", ");
  console.log(`  ${band}: ${checked.toLocaleString()} verdicts agree — ${spread}`);
}

if (failures) {
  console.log(`\n${failures} disagreements.`);
  process.exit(1);
}
console.log("\nThe page's tests are the engine's tests.");
