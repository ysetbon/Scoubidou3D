// The trace grid has to be a bijection: every combo lands on its own cell, and
// clicking that cell has to give the combo back. The renderer uses place and
// hit-testing uses unplace, so if they ever disagree the panel points at the
// wrong search.
//
//     npm run check:trace
import { bandKey, traceKey } from "../src/mxn-lab/trace-band";
import { layoutFor } from "../src/mxn-lab/trace-layout";

let failures = 0;

function check(what: string, ok: boolean, detail = "") {
  if (!ok) {
    failures += 1;
    console.log(`  FAIL  ${what}${detail ? ` — ${detail}` : ""}`);
  }
}

for (const E of [2, 4, 7, 8, 21]) {
  for (let P = 1; P <= 4; P += 1) {
    const total = E ** P;
    if (total > 200_000) continue;
    const layout = layoutFor(P, E);
    const seen = new Map<string, number>();

    for (let i = 0; i < total; i += 1) {
      const { x, y } = layout.place(i);
      const key = `${x},${y}`;
      const clash = seen.get(key);
      if (clash !== undefined) {
        check(`E=${E} P=${P} collision`, false, `combos ${clash} and ${i} both at ${key}`);
        break;
      }
      seen.set(key, i);
      if (x < 0 || y < 0 || x >= layout.cols || y >= layout.rows) {
        check(`E=${E} P=${P} in bounds`, false, `combo ${i} at ${key} outside ${layout.cols}x${layout.rows}`);
        break;
      }
      const back = layout.unplace(x, y);
      if (back !== i) {
        check(`E=${E} P=${P} round trip`, false, `combo ${i} -> ${key} -> ${back}`);
        break;
      }
    }
    check(`E=${E} P=${P} every combo placed`, seen.size === total,
          `${seen.size} of ${total}`);

    // Nothing outside the census may claim to be a combo: gutters and the
    // unfilled tail of a wrapped block grid have to answer null.
    let ghosts = 0;
    for (let y = 0; y < layout.rows; y += 1) {
      for (let x = 0; x < layout.cols; x += 1) {
        const i = layout.unplace(x, y);
        if (i === null) continue;
        if (seen.get(`${x},${y}`) !== i) ghosts += 1;
      }
    }
    check(`E=${E} P=${P} no ghost cells`, ghosts === 0, `${ghosts} cells`);

    console.log(`  ok    E=${E} P=${P}  ${total.toLocaleString()} combos in `
                + `${layout.cols}x${layout.rows}`
                + (layout.inner ? `  (blocks of ${layout.inner})` : ""));
  }
}

// The two shapes the panel drew before this rule existed have to survive it,
// or the change is a redesign rather than a generalisation.
const one = layoutFor(1, 21);
check("P=1 is still one row of 21", one.cols === 21 && one.rows === 1,
      `${one.cols}x${one.rows}`);
const two = layoutFor(2, 21);
check("P=2 is still 21x21", two.cols === 21 && two.rows === 21,
      `${two.cols}x${two.rows}`);
check("P=2 row is pair 0", two.place(17 * 21 + 19).y === 17 && two.place(17 * 21 + 19).x === 19,
      JSON.stringify(two.place(17 * 21 + 19)));

// Aspect ratio: the wrap exists so that an odd P stays lookable-at.
const three = layoutFor(3, 21);
check("P=3 is not a 21:1 ribbon", three.cols / three.rows < 2,
      `${three.cols}x${three.rows}`);

// A trace is asked for as "v" and comes back calling itself "vertical". Both
// spellings have to land on the same cache key, or the widget waits forever for
// a payload it already has.
check("ask and answer agree, vertical", traceKey(1, "v") === traceKey(1, "vertical"),
      `${traceKey(1, "v")} vs ${traceKey(1, "vertical")}`);
check("ask and answer agree, horizontal", traceKey(1, "h") === traceKey(1, "horizontal"),
      `${traceKey(1, "h")} vs ${traceKey(1, "horizontal")}`);
check("the two bands stay apart", traceKey(1, "vertical") !== traceKey(1, "horizontal"));
check("levels stay apart", traceKey(1, "v") !== traceKey(2, "v"));
// bridge.trace_level decides with startswith("v"); anything else is horizontal.
check("bandKey mirrors the bridge",
      bandKey("Vertical") === "v" && bandKey("horizontal") === "h" && bandKey("") === "h");

console.log(failures ? `\n${failures} failure(s)` : "\nall trace-layout checks passed");
process.exit(failures ? 1 : 0);
