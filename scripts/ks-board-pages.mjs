// Write one page shell per k, at mxn/ks/<k>/index.html.
//
//     node scripts/ks-board-pages.mjs          # write them
//     node scripts/ks-board-pages.mjs --check  # fail if any is missing or stale
//
// The board is one page per k because /mxn/ks/-1 is a URL somebody types, links
// to and bookmarks — and this site is static files on GitHub Pages, so a URL
// that is not a file is a 404 no matter how good the router. Thirty shells of a
// kilobyte each, all sharing one hashed bundle, buys real addresses.
//
// The range is not a literal here and must not become one: it is every k that
// any size up to BOARD_MAX can legally take, which is -14…15 rather than the
// -16…16 that reading kLimits quickly suggests (`m+n` peaks at 15, on 8x7, and
// the diagonal is narrower still). A missing shell is a k with no board at all,
// so `--check` runs in CI alongside the build.
//
// Kept in step with vite.config.ts, which builds its input map from the same
// range: a shell with no vite input is not published, and an input with no
// shell fails the build.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** Mirrors src/mxn-ks/board-model.ts. Both are checked against each other. */
const BOARD_MAX = 8;

/** Mirrors kLimits in src/mxn-farm/plan.ts. */
const kLimits = (m, n) =>
  (m === n ? { min: -(m - 1), max: m } : { min: -(m + n - 1), max: m + n });

export function boardKRange(max = BOARD_MAX) {
  let min = 0;
  let top = 0;
  for (let m = 1; m <= max; m += 1) {
    for (let n = 1; n <= max; n += 1) {
      const limits = kLimits(m, n);
      min = Math.min(min, limits.min);
      top = Math.max(top, limits.max);
    }
  }
  return Array.from({ length: top - min + 1 }, (_, at) => min + at);
}

/** Which sizes admit this k, for the shell's own description. */
const sizesFor = k => {
  let count = 0;
  for (let m = 1; m <= BOARD_MAX; m += 1) {
    for (let n = 1; n <= BOARD_MAX; n += 1) {
      const { min, max } = kLimits(m, n);
      if (k >= min && k <= max) count += 1;
    }
  }
  return count;
};

const shell = k => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MXN k ${k} board · Scoubidou3D</title>
    <meta name="description" content="Every m×n up to ${BOARD_MAX}×${BOARD_MAX} at k = ${k} (${sizesFor(k)} sizes admit it), drawn from the best ring anybody has for each — a judged ★ best first, the engine's run second, and an empty tile linking straight to the fitter." />
    <link rel="icon" href="../../../favicon.ico" sizes="any" />
    <link rel="icon" type="image/png" sizes="32x32" href="../../../icon-32.png" />
    <link rel="apple-touch-icon" href="../../../icon-180.png" />
    <!-- Counted like every other page, and indexed like /mxn/ks/: this one
         reads public data and has something to say to a reader without a token. -->
    <script type="module" src="../../../site/count.js"></script>
    <!-- Same pre-paint as the rest of the suite: the page paints its own
         background, this only stops a white flash before its stylesheet lands. -->
    <style>html { background: #f4f0e6; }</style>
  </head>
  <body>
    <!-- data-k is what this page is about, and is stated rather than parsed:
         the path is the fallback (src/mxn-ks/board-main.tsx), so a board served
         from an unexpected prefix still opens at the k it was built for.
         data-cache is the site-wide default Worker URL, the same value
         mxn/index.html and mxn/ks/index.html carry. Reads are public; this page
         never writes. ?cache= overrides it. -->
    <div id="board" data-k="${k}" data-cache="https://mxn-solutions-api.ysetbon.workers.dev"></div>
    <script type="module" src="../../../src/mxn-ks/board-main.tsx"></script>
  </body>
</html>
`;

const pageFor = k => join(root, "mxn", "ks", String(k), "index.html");

/**
 * Write the shells, or report which are out of date.
 *
 * Behind a function, and called only when this file is run as a command,
 * because vite.config.ts IMPORTS it for `boardKRange` — a module that wrote 30
 * files as a side effect of being imported would rewrite the tree on every
 * `vite dev`, every build and every `tsc`.
 */
function run({ check }) {
  const range = boardKRange();
  const wrong = [];

  for (const k of range) {
    const path = pageFor(k);
    const wanted = shell(k);
    let held = null;
    try {
      held = readFileSync(path, "utf8");
    } catch { /* absent, which --check reports and a write fixes */ }
    if (held === wanted) continue;
    if (check) {
      wrong.push(`${held === null ? "missing" : "stale"}: mxn/ks/${k}/index.html`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, wanted);
  }

  if (check && wrong.length) {
    console.error(`${wrong.length} board page${wrong.length === 1 ? "" : "s"} out of date:`);
    for (const line of wrong) console.error(`  ${line}`);
    console.error("\nRun `node scripts/ks-board-pages.mjs` and commit the result.");
    process.exit(1);
  }

  console.error(check
    ? `k boards: ${range.length} pages, k ${range[0]}…${range[range.length - 1]}, all current`
    : `k boards: wrote ${range.length} pages, k ${range[0]}…${range[range.length - 1]}`);
}

// `process.argv[1]` is the script that was invoked; an import leaves it pointing
// at vite, tsc or whatever else is running.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run({ check: process.argv.includes("--check") });
}
