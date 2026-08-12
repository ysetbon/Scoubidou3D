/*
 * Holds the farm's planner and its cache keys to what they claim.
 *
 * Two things are checked, and the second is the one that matters.
 *
 * The planner, because a sweep that quietly drops a size is a bug nobody sees
 * until the morning, when the missing answer is missing and nothing anywhere
 * says so. Every exclusion it makes has to be counted and reported.
 *
 * The key shapes, because they are agreed across a boundary that has no types.
 * src/mxn-lab/cache.ts builds a key; worker-api/src/index.ts validates one with
 * its own regexes and stores nothing that fails them. Nothing connects the two
 * but this file, which reads the Worker's regexes out of its source and runs
 * the client's keys through them. A client that starts spelling ks differently
 * would otherwise fail at runtime as a 400 on a machine nobody is watching.
 *
 *   npm run check:plan
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { descriptorPath, runKey, traceKeyPath, type RunDescriptor } from "../src/mxn-lab/cache";
import { kLimits, planSweep, sequencesFor, type SweepSpec } from "../src/mxn-farm/plan";

let failures = 0;

function check(what: string, got: unknown, want: unknown) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) {
    failures += 1;
    console.log(`FAIL  ${what}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok    ${what}`);
  }
}

function ok(what: string, condition: boolean) {
  check(what, condition, true);
}

// ---------------------------------------------------------------------------
// The keys, against the Worker's own validators.
// ---------------------------------------------------------------------------

// Against the working directory rather than import.meta.url: this file is
// bundled into node_modules/.cache before it runs, so its own URL points at the
// bundle. npm scripts run from the repository root.
const workerSource = readFileSync(
  resolve(process.cwd(), "worker-api/src/index.ts"), "utf8");

function workerRegex(name: string): RegExp {
  const found = workerSource.match(new RegExp(`const ${name} = (/.*/);`));
  if (!found) throw new Error(`worker-api/src/index.ts no longer defines ${name}`);
  const body = found[1].slice(1, -1);
  return new RegExp(body);
}

const SEG_VERSION = workerRegex("SEG_VERSION");
const SEG_HAND_DIRECTION = workerRegex("SEG_HAND_DIRECTION");
const SEG_SIZE = workerRegex("SEG_SIZE");
const SEG_KS = workerRegex("SEG_KS");
const SEG_FLAGS = workerRegex("SEG_FLAGS");
const SEG_LEVEL_BAND = workerRegex("SEG_LEVEL_BAND");

/** Exactly what the Worker's cacheKey() does, so a key that fails here 400s there. */
function workerAccepts(kind: "run" | "trace", key: string): boolean {
  const segments = key.split("/");
  if (segments.length !== (kind === "run" ? 5 : 6)) return false;
  const [version, handDirection, size, ks, flags, levelBand] = segments;
  if (!SEG_VERSION.test(version)) return false;
  if (!SEG_HAND_DIRECTION.test(handDirection)) return false;
  if (!SEG_SIZE.test(size)) return false;
  if (!SEG_KS.test(ks)) return false;
  if (!SEG_FLAGS.test(flags)) return false;
  return kind === "run" || SEG_LEVEL_BAND.test(levelBand);
}

const descriptor: RunDescriptor = {
  m: 2, n: 2, ks: [1, 2, 2], hand: "lh", direction: "cw",
  shortArms: true, step: "auto", budget: 400_000,
};

check("descriptorPath spells a run out",
  descriptorPath(descriptor), "lh-cw/2x2/1_2_2/s1-eauto-b400000");
check("runKey prefixes the cache version",
  runKey(descriptor).split("/").length, 5);
check("traceKeyPath adds the level and band",
  traceKeyPath(descriptor, 3, "vertical").endsWith("/L3-v"), true);

ok("the Worker accepts a plain run key", workerAccepts("run", runKey(descriptor)));
ok("the Worker accepts a trace key",
  workerAccepts("trace", traceKeyPath(descriptor, 1, "h")));

// The awkward ones: negative ks, an explicit step, a non-square size, the
// deepest sequence the lab will run, and both bands spelled either way.
const awkward: RunDescriptor[] = [
  { ...descriptor, ks: [-1, -1] },
  { ...descriptor, ks: [-1], m: 1, n: 4, step: 5 },
  { ...descriptor, ks: [1, 1, -1, -1, -1, -1, -1, -1], step: 20, shortArms: false },
  { ...descriptor, hand: "rh", direction: "ccw", m: 4, n: 4, budget: 10_000_000 },
];
for (const one of awkward) {
  ok(`the Worker accepts ${descriptorPath(one)}`, workerAccepts("run", runKey(one)));
  ok(`the Worker accepts ${descriptorPath(one)} traced`,
    workerAccepts("trace", traceKeyPath(one, 8, "vertical")));
}

// And a key the Worker must refuse, so the check is not merely permissive.
ok("the Worker refuses a key with a path escape",
  !workerAccepts("run", runKey({ ...descriptor, hand: "../lh" })));
ok("the Worker refuses a run key with a trace tail",
  !workerAccepts("run", traceKeyPath(descriptor, 1, "v")));

// ---------------------------------------------------------------------------
// The planner.
// ---------------------------------------------------------------------------

const base: SweepSpec = {
  mFrom: 1, mTo: 1, nFrom: 1, nTo: 1,
  ksMode: "each", kFrom: 1, kTo: 1, depth: 1, ksText: "",
  hand: "lh", direction: "cw", shortArms: true, step: "auto",
  budget: 400_000, wantTraces: true, countCeiling: 0, fastEngine: true,
};

check("k limits are square-aware", kLimits(2, 2), { min: -1, max: 2 });
check("k limits widen off the diagonal", kLimits(1, 3), { min: -3, max: 4 });

check("`each` makes one sequence per k, held at every level",
  sequencesFor({ ...base, kFrom: -1, kTo: 1, depth: 3 }),
  [[-1, -1, -1], [0, 0, 0], [1, 1, 1]]);
check("`words` makes every ordered sequence",
  sequencesFor({ ...base, ksMode: "words", kFrom: 0, kTo: 1, depth: 2 }),
  [[0, 0], [0, 1], [1, 0], [1, 1]]);
check("`list` reads one sequence per line, brackets and commas allowed",
  sequencesFor({ ...base, ksMode: "list", ksText: "1 2\n[1, -1]\n\nnot a k\n-1" }),
  [[1, 2], [1, -1], [-1]]);

// 2×2 admits -1…2 and 1×2 admits -2…3, so a sweep over -3…3 keeps different
// ks at the two sizes and has to say how many it dropped rather than pretend
// the range it was given was the range it used.
const mixed = planSweep({
  ...base, mFrom: 1, mTo: 2, nFrom: 2, nTo: 2, kFrom: -3, kTo: 3, depth: 1,
});
check("1×2 keeps -2…3 and 2×2 keeps -1…2",
  mixed.jobs.map(job => `${job.m}x${job.n}:${job.ks[0]}`),
  ["1x2:-2", "1x2:-1", "1x2:0", "1x2:1", "1x2:2", "1x2:3",
    "2x2:-1", "2x2:0", "2x2:1", "2x2:2"]);
check("and counts what the range could not reach",
  mixed.skipped, [{ reason: "k outside the size's valid range", count: 4 }]);

// A list with a repeated line reaches the same parameters twice. The queue keys
// on the id, so a duplicate would only be double-counted on screen.
const repeated = planSweep({
  ...base, ksMode: "list", ksText: "1\n1\n1 1",
});
check("duplicate parameters are dropped once", repeated.jobs.length, 2);
check("and counted", repeated.skipped, [{ reason: "duplicate parameters", count: 1 }]);

// Cheapest first, so a sweep left overnight has the small sizes long before it
// reaches the big one — and stopping it early still leaves something useful.
const ordered = planSweep({ ...base, mFrom: 1, mTo: 3, nFrom: 1, nTo: 3, kFrom: 1, kTo: 1 });
const weights = ordered.jobs.map(job => job.weight);
ok("the plan is ordered cheapest first",
  weights.every((weight, at) => at === 0 || weights[at - 1] <= weight));
ok("every job carries the id its artifacts will be stored under",
  ordered.jobs.every(job => job.id === runKey(job.descriptor)));
ok("every planned job's key is one the Worker will accept",
  ordered.jobs.every(job => workerAccepts("run", job.id)));

// A run's ceiling is per level, so twice the levels is twice the ceiling.
const oneLevel = planSweep({ ...base, mFrom: 2, mTo: 2, nFrom: 2, nTo: 2, kFrom: 1, kTo: 1, depth: 1 });
const twoLevels = planSweep({ ...base, mFrom: 2, mTo: 2, nFrom: 2, nTo: 2, kFrom: 1, kTo: 1, depth: 2 });
check("weight scales with the number of levels",
  twoLevels.jobs[0].weight, oneLevel.jobs[0].weight * 2);

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
