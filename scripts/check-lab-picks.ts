// What /mxn/ may take off the picks shelf, in node.
//
//   npm run check:picks
//
// src/mxn-lab/picks-shelf.ts is pure and React-free precisely so this can run.
// The lab now draws a person's ★ best in place of the engine's own pick, and
// every way that can go wrong is a way the page looks perfectly fine while
// lying about which ring is on screen:
//
//   1. only a `best` is adopted — never the newest ✓ valid, never a ✗
//   2. a judgement carrying no ring is not drawn, however good its numbers
//   3. the numbers under a judged ring are the JUDGEMENT's, and the ones it
//      does not carry are absent rather than zero
//   4. a run's flags and a judgement's flags are allowed to differ — the farm
//      sweeps at s1-e5-b100000000 and the fitter always writes s1-eauto-b400000
//      — but an exact match is never passed over for a looser one
//
// Point 4 is the whole reason a ★ best on a k board was invisible at /mxn/:
// the two pages were asking the shelf different questions about the same ring.

import type { Judgement, RunDescriptor } from "../src/mxn-lab/cache";
import { picksKey } from "../src/mxn-lab/cache";
import {
  FITTER_FLAGS, auditOfPick, bestOf, judgedDescriptor, ksPrefixDescriptors,
  levelOf, picksCandidates, picksPrefix, pickOfJudgement,
} from "../src/mxn-lab/picks-shelf";
import type { Strand } from "../src/mxn-lab/exact-draw";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const RING = [{ layer_name: "1_2" }] as unknown as Strand[];

const descriptorAt = (
  m: number, n: number, ks: number[],
  flags: Partial<RunDescriptor> = {},
): RunDescriptor =>
  ({ m, n, ks, hand: "lh", direction: "cw", ...FITTER_FLAGS, ...flags });

const judgementAt = (
  verdict: Judgement["verdict"], at: string,
  extra: Partial<Judgement> = {}, level = 1,
): Judgement => ({
  id: `${verdict}-${at}`, verdict, source: "fitter", chooser: "yonatan", at,
  levels: [{ level, h: { ext: [40, 10], angle: -172.5 }, v: { ext: [20], angle: 8.25 } }],
  strands: RING,
  ...extra,
});

// ===========================================================================
console.log("=========== which judgement the lab adopts ===========");

{
  const judgements = [
    judgementAt("valid", "2026-08-16T00:00:00Z"),
    judgementAt("best", "2024-01-01T00:00:00Z"),
  ];
  const best = bestOf(judgements);
  check("a ★ best from 2024 beats a ✓ valid from this morning",
    best?.verdict === "best" && best.at.startsWith("2024"), best?.at ?? "none");
}

{
  const judgements = [
    judgementAt("valid", "2026-08-16T00:00:00Z"),
    judgementAt("rejected", "2026-08-15T00:00:00Z"),
  ];
  check("with no ★ best the engine's own pick stands — there is no middle tier",
    bestOf(judgements) === null);
}

{
  check("an empty shelf adopts nothing", bestOf([]) === null);
}

{
  const j = judgementAt("best", "2026-01-01T00:00:00Z", {}, 2);
  check("a judgement says which level it is about, and a fit judges one",
    levelOf(j) === 2, `L${levelOf(j)}`);
  check("and a judgement with no levels at all reads as L1",
    levelOf({ ...j, levels: [] }) === 1);
}

// ===========================================================================
console.log("\n=========== a judgement with no ring is not drawn ===========");

{
  const carried = pickOfJudgement(
    judgementAt("best", "2026-01-01T00:00:00Z"), "Cloudflare", "picks/…");
  check("a judgement carrying its ring is drawable with no engine anywhere",
    !!carried && carried.strands.length === 1 && carried.level === 1);
  check("and it carries the knobs the ring was fitted at",
    carried?.hExt.join(",") === "40,10" && carried?.vExt.join(",") === "20"
    && carried?.hAngle === -172.5,
    `H (${carried?.hExt.join(", ")}) at ${carried?.hAngle}`);

  for (const [what, strands] of [["none", undefined], ["empty", []]] as const) {
    const ringless = pickOfJudgement(
      judgementAt("best", "2026-01-01T00:00:00Z", { strands }), "Cloudflare", "picks/…");
    check(`a ★ best with ${what} strands is reported, never drawn`, ringless === null);
  }
}

// ===========================================================================
console.log("\n=========== the numbers under a judged ring ===========");

{
  const pick = pickOfJudgement(judgementAt("best", "2026-01-01T00:00:00Z", {
    audit: { crossings: 8, expected: 8, stray: 0, broken: 0 },
  }), "Cloudflare", "picks/…")!;
  const audit = auditOfPick(pick);
  check("what the judgement measured is what the card prints",
    audit.across === 8 && audit.expected === 8 && audit.stray === 0
    && audit.broken === 0);
  check("the extensions are the JUDGED ring's, not the run's",
    audit.ext?.[0].join(",") === "40,10" && audit.ext?.[1].join(",") === "20");
  check("and what it did not measure is absent, not zero",
    audit.gap === null && audit.within === null && audit.masks === null
    && audit.applied === null,
    "gap, within, masks, applied");
}

{
  const pick = pickOfJudgement(
    judgementAt("best", "2026-01-01T00:00:00Z"), "this browser", "picks/…")!;
  const audit = auditOfPick(pick);
  check("a judgement with no audit at all prints no crossings either",
    audit.across === null && audit.expected === null && audit.stray === null,
    "every number a dash");
}

// ===========================================================================
console.log("\n=========== finding the set the judgements are under ===========");

const FARM = { step: 5 as const, budget: 100_000_000 };

{
  const want = descriptorAt(2, 1, [-1], FARM);
  const order = picksCandidates(want, []);
  check("the run's own flags are asked about first",
    picksKey(order[0]) === picksKey(want), picksKey(order[0]));
  check("then the flags every fitter judgement is filed under",
    picksKey(order[1]) === picksKey(descriptorAt(2, 1, [-1])),
    picksKey(order[1]));
  check("and that is the whole list when the shelf lists nothing else",
    order.length === 2, `${order.length} candidates`);
}

{
  const want = descriptorAt(2, 1, [-1]);
  check("a run already at the fitter's flags asks exactly once",
    picksCandidates(want, []).length === 1);
}

{
  const want = descriptorAt(2, 1, [-1], FARM);
  const keys = [
    "picks/v3/lh-cw/2x1/-1/s1-e10-b400000",     // same ring, other flags
    "picks/v3/lh-cw/2x1/-1/s1-eauto-b400000",   // the fitter's own, already in
    "picks/v3/lh-cw/3x1/-1/s1-eauto-b400000",   // another size
    "picks/v3/rh-ccw/2x1/-1/s1-eauto-b400000",  // another hand
    "picks/v3/lh-cw/2x1/-1_2/s1-eauto-b400000", // a deeper sequence
    "picks/v9/lh-cw/2x1/-1/s1-eauto-b400000",   // another engine's answers
    "run/v3/lh-cw/2x1/-1/s1-e5-b100000000",     // not a picks key at all
  ];
  const order = picksCandidates(want, keys);
  const paths = order.map(d => picksKey(d));
  check("a flags-variant of the same ring is picked up off the catalogue",
    paths.includes("v3/lh-cw/2x1/-1/s1-e10-b400000"));
  check("but nothing about another size, hand, sequence or engine version is",
    paths.length === 3, paths.join(" · "));
  check("and the exact match is still first, never passed over for a looser one",
    paths[0] === "v3/lh-cw/2x1/-1/s1-e5-b100000000", paths[0]);
}

{
  // A judgement is a hand-placed ring; the engine's search flags say nothing
  // about it and the fitter sets none of them. Ticking "learn each level's
  // reach" or "size from the ★ best" sent the lookup to `…-r1` / `…-h65`,
  // which nothing will ever write, and the page then reported no ★ best for a
  // size whose board plainly shows one. Both flags are stripped, and the size,
  // hand, direction and ks — which are what the ring IS — are not.
  const searching = descriptorAt(3, 1, [-1], {
    reachFromPrevious: true, handCeiling: 65 });
  const judged = judgedDescriptor(searching);
  check("a pick is looked up without the engine's search flags",
    picksKey(judged) === "v3/lh-cw/3x1/-1/s1-eauto-b400000", picksKey(judged));
  check("  and the reach cap cannot send it somewhere nothing writes",
    picksKey(judged) !== picksKey(searching));
  check("  while the size, hand, direction and ks all survive",
    judged.m === 3 && judged.n === 1 && judged.hand === "lh"
    && judged.direction === "cw" && judged.ks.join() === "-1");
  check("  and the first candidate asked for is the stripped one",
    picksKey(picksCandidates(searching, [])[0]) === picksKey(judged),
    picksKey(picksCandidates(searching, [])[0]));
}

{
  const prefix = picksPrefix(descriptorAt(2, 2, [1, 2, 2], FARM));
  check("the catalogue prefix names the size and the sequence, not the flags",
    prefix === "picks/v3/lh-cw/2x2/1_2_2/", prefix);
}

// ===========================================================================
console.log("\n=========== a deep sequence reads L1 from the [ks[0]] subdirectory ===========");

{
  const want = descriptorAt(3, 1, [-1, -1, -1]);
  const prefixes = ksPrefixDescriptors(want);
  const paths = prefixes.map(d => picksKey(d));
  check("the exact sequence is asked about first",
    paths[0] === "v3/lh-cw/3x1/-1_-1_-1/s1-eauto-b400000", paths[0]);
  check("then the parent subdirectory",
    paths[1] === "v3/lh-cw/3x1/-1_-1/s1-eauto-b400000", paths[1]);
  check("then the L1 subdirectory a hand actually judges",
    paths[2] === "v3/lh-cw/3x1/-1/s1-eauto-b400000", paths[2]);
  check("and a single-k run is already the whole walk",
    ksPrefixDescriptors(descriptorAt(3, 1, [-1])).length === 1);
}

{
  // Flags on the deep run must not send the L1 lookup to a key nothing writes.
  // judgedDescriptor strips them; the prefix walk has to keep doing that.
  const searching = descriptorAt(3, 1, [-1, -1, -1], {
    reachFromPrevious: true, handCeiling: 65, handAdopted: true,
  });
  const l1 = judgedDescriptor(ksPrefixDescriptors(searching).at(-1)!);
  check("the L1 subdirectory is still the fitter's key, flags stripped",
    picksKey(l1) === "v3/lh-cw/3x1/-1/s1-eauto-b400000", picksKey(l1));
}

// ===========================================================================
console.log(`\n${fail ? `${fail} check(s) failed, ${pass} passed`
                      : `all ${pass} checks passed`}`);
process.exit(fail ? 1 : 0);
