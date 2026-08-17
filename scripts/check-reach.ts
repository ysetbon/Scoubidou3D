// The reach cap's key grammar, in node.
//
//   npm run check:reach
//
// `reachFromPrevious` caps each level past the first at the longest arm the
// levels below it used, instead of escalating the ceiling to 200. It makes a
// level settle on a DIFFERENT ring — measured on 3×1 `[-1,-1]`, where L2 goes
// from `(190, 190, 70)` in 54s to `(50, 0, 0)` in 4.9s at the same 10/12
// crossings — so it has to be part of the key, and the one thing that must not
// happen when a flag joins a key is that every key already on the shelf moves.
//
// Four claims, and each is a way a shelf could quietly lose or mix up answers:
//
//   1. off is the absence of a segment, so every key ever written is unchanged
//   2. on appends `-r1`, and two answers never share one key
//   3. a key written either way reads back as what wrote it
//   4. the Worker's own validator accepts exactly the same shape — a key the
//      page can write and the Worker will not store is a silent write failure

import { readFileSync } from "node:fs";
import {
  descriptorPath, parseRunKey, parsePicksKey, parseTraceKey, runKey,
  traceKeyPath, type RunDescriptor,
} from "../src/mxn-lab/cache";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const at = (extra: Partial<RunDescriptor> = {}): RunDescriptor => ({
  m: 3, n: 1, ks: [-1, -1], hand: "lh", direction: "cw",
  shortArms: true, step: "auto", budget: 400_000, ...extra,
});

// ===========================================================================
console.log("=========== off is the absence of a segment ===========");

{
  const bare = descriptorPath(at());
  check("a descriptor with no flag spells the key it always spelled",
    bare === "lh-cw/3x1/-1_-1/s1-eauto-b400000", bare);
  check("and so does one that says off out loud",
    descriptorPath(at({ reachFromPrevious: false })) === bare, bare);
}

// ===========================================================================
console.log("\n=========== on is its own key ===========");

{
  const capped = descriptorPath(at({ reachFromPrevious: true }));
  check("on appends -r1", capped === "lh-cw/3x1/-1_-1/s1-eauto-b400000-r1", capped);
  check("so the two searches can never overwrite each other",
    capped !== descriptorPath(at()));
  check("and a trace under it is addressed the same way",
    traceKeyPath(at({ reachFromPrevious: true }), 2, "v")
      === "v3/lh-cw/3x1/-1_-1/s1-eauto-b400000-r1/L2-v",
    traceKeyPath(at({ reachFromPrevious: true }), 2, "v"));
}

// ===========================================================================
console.log("\n=========== a key reads back as what wrote it ===========");

for (const on of [false, true]) {
  const key = runKey(at({ reachFromPrevious: on }));
  const back = parseRunKey(`run/${key}`);
  check(`a run key written with the cap ${on ? "on" : "off"} round-trips`,
    !!back && !!back.descriptor.reachFromPrevious === on
    && back.descriptor.m === 3 && back.descriptor.ks.join(",") === "-1,-1",
    key);
  const picks = parsePicksKey(`picks/${key}`);
  check(`  and so does a picks key`, !!picks && !!picks.descriptor.reachFromPrevious === on);
  const trace = parseTraceKey(
    `trace/${traceKeyPath(at({ reachFromPrevious: on }), 2, "h")}`);
  check(`  and so does a trace key`,
    !!trace && !!trace.descriptor.reachFromPrevious === on && trace.level === 2);
}

{
  // The shape the farm and the fitter have been writing all along.
  const old = parseRunKey("run/v3/lh-cw/2x2/1_2_2/s1-e5-b100000000");
  check("a key from before the flag existed still parses, and reads as off",
    !!old && old.descriptor.reachFromPrevious === false
    && old.descriptor.budget === 100_000_000);
  check("and a key with a flag value that is not 0 or 1 is not a key",
    parseRunKey("run/v3/lh-cw/2x2/1_2_2/s1-e5-b100000000-r2") === null);
}

// ===========================================================================
console.log("\n=========== the hand-sized grid carries its ceiling ===========");
//
// `-h<ceiling>` rather than a bare `-h1`, because two picks imply two grids and
// a re-judged pick implies a third. A flag would let a later judgement's run
// quietly overwrite an earlier one's; the number cannot.

{
  const sized = descriptorPath(at({ handCeiling: 65 }));
  check("a hand-sized run says which ceiling sized it",
    sized === "lh-cw/3x1/-1_-1/s1-eauto-b400000-h65", sized);
  check("and two ceilings are two shelves",
    sized !== descriptorPath(at({ handCeiling: 70 })));
  check("no ceiling appends nothing, so every old key is where it was",
    descriptorPath(at({ handCeiling: 0 })) === descriptorPath(at()));
  check("it composes with the reach cap rather than replacing it",
    descriptorPath(at({ reachFromPrevious: true, handCeiling: 65 }))
      === "lh-cw/3x1/-1_-1/s1-eauto-b400000-r1-h65");
  const back = parseRunKey(`run/${runKey(at({ handCeiling: 65 }))}`);
  check("and it reads back as the number that wrote it",
    back?.descriptor.handCeiling === 65, String(back?.descriptor.handCeiling));
  // -j: level 1 ADOPTED from the judged ring rather than searched on its grid.
  // Same ceiling, different level 1, so never the same key.
  const adopted = descriptorPath(at({ handCeiling: 65, handAdopted: true }));
  check("an adopted L1 spells -j, and never shares -h's key",
    adopted === "lh-cw/3x1/-1_-1/s1-eauto-b400000-j65"
    && adopted !== descriptorPath(at({ handCeiling: 65 })), adopted);
  const jBack = parseRunKey(`run/v3/${adopted}`);
  check("and -j reads back as adopted, -h as not",
    jBack?.descriptor.handAdopted === true
    && parseRunKey(`run/${runKey(at({ handCeiling: 65 }))}`)?.descriptor.handAdopted === false);
  check("a key with no -h reads as no ceiling",
    parseRunKey("run/v3/lh-cw/2x2/1/s1-eauto-b400000")?.descriptor.handCeiling
      === undefined);
}

// ===========================================================================
console.log("\n=========== the Worker validates the same shape ===========");

{
  // Read rather than imported: worker-api is deployed on its own and has no
  // build step here, and a regex that drifts from this one is a page writing
  // keys the shelf answers 400 to — which looks exactly like a network fault.
  // Relative to the repo root, like check-board.ts's own file reads: the
  // bundle this runs as lives under node_modules/.cache, so import.meta.url
  // points there rather than at scripts/.
  const source = readFileSync("worker-api/src/index.ts", "utf8");
  const line = /const SEG_FLAGS = (\/.*\/);/.exec(source);
  check("the Worker's flag validator is findable", !!line, line?.[1] ?? "not found");
  if (line) {
    const worker = new RegExp(line[1].slice(1, -1));
    const cases: [string, boolean][] = [
      ["s1-eauto-b400000", true],
      ["s1-eauto-b400000-r1", true],
      ["s0-e5-b100000000-r0", true],
      ["s1-eauto-b400000-h65", true],
      ["s1-eauto-b400000-r1-h65", true],
      ["s1-eauto-b400000-j65", true],
      ["s1-eauto-b400000-r1-j65", true],
      ["s1-eauto-b400000-j", false],
      ["s1-eauto-b400000-h", false],
      ["s1-eauto-b400000-h65-r1", false],
      ["s1-eauto-b400000-r2", false],
      ["s1-eauto-b400000-r", false],
      ["s1-eauto-b400000-x1", false],
    ];
    for (const [flags, want] of cases) {
      const got = worker.test(flags);
      check(`  the Worker ${want ? "stores" : "refuses"} ${flags}`, got === want);
      // And the page agrees: a key the Worker takes must be one the page reads.
      if (want) {
        check(`  and the page reads it back`,
          parseRunKey(`run/v3/lh-cw/2x2/1/${flags}`) !== null);
      }
    }
  }
}

// ===========================================================================
console.log(`\n${fail ? `${fail} check(s) failed, ${pass} passed`
                      : `all ${pass} checks passed`}`);
process.exit(fail ? 1 : 0);
