# Mocks

Working drawings for the MXN lab's busy states. Neither file is a vite build
input, so nothing here is published.

| file | what it is |
|---|---|
| [`thinking-indicator-mock.html`](thinking-indicator-mock.html) | the original proposal for the busy state: three layouts for the candidate sheet, judged before any of it existed. Standalone — it copies the tokens out of `src/mxn-lab/lab.css` and fakes the drawing in vanilla JS. Open it with any static server, or straight off disk. |
| [`widgets.html`](widgets.html) | the two busy states as they now are. Mounts the **real** components against **real** engine payloads; only the worker is a stand-in. |
| [`ks-atlas.html`](ks-atlas.html) | the **real** `/mxn/ks/` page against a committed snapshot of the Cloudflare shelf, with the live one switched off before it can be reached. See [docs/mxn-ks.md](../docs/mxn-ks.md) § *The offline mock*. |
| [`fit.html`](fit.html) | a page that does not exist yet: `/mxn/fit/`, the fitter, proposed in [docs/mxn-fit.md](../docs/mxn-fit.md). Standalone — tokens copied from `src/mxn-lab/lab.css`, no build and no server. The chrome is a drawing; the band, its census, the exact-fit field and the sorted table are computed in the page from `fixtures/trace-plan-l1.json` with the arithmetic of `mxn_trace.sweep_combo`. `python3 scripts/check-fit.py` re-derives the same numbers from a shell. |
| [`mxn-hand.html`](mxn-hand.html) | a page that does not exist yet: `/mxn/hand/`, the ks bench — the tool with no engine, no Pyodide and no Cloudflare on it, where a k sequence you type becomes one level per k and every heading, arm length and pair extension is a slider. Standalone, and written for Claude's Artifact host as well as for disk, so it carries no `<!doctype>` of its own. The base 2×1 ring is the committed geometry of `artifacts/four-twists-2x1/ring.json`; every arm above it, and every length, gap and clearance quoted, is placed and measured in the page by the fitter's own arithmetic. What is a stand-in and says so: how a k becomes a heading. |
| [`foldlab/`](foldlab/) | a page that does not exist yet: `/foldlab/`, the successor to the Bight Lab artifact — where every part of every strand declares which of a level's three planes (`bottom`, `center`, `top`) it rests on, so two levels of a box stitch read as one weave rather than two rounds stacked on a lid. Four artboards on a design canvas rather than a standalone page; the `.dc.html` files are the source and the seeded payload is not tracked. See [`foldlab/README.md`](foldlab/README.md). |

## widgets.html

```sh
npm run dev
# http://localhost:5173/Scoubidou3D/mocks/widgets.html
```

Two cases:

- **A · level widget, band being censused** — `TraceSweep` over
  `bridge.trace_plan`'s output for L1 of a 2×1. Real extension grid, real angle
  window, real gap bounds; the verdicts it paints are computed here by
  `src/mxn-lab/trace-census.ts`, which is `mxn_trace.sweep_combo` one combo at a
  time. The band switch, the *replaying → sweeping* switch and the census pause
  are the mock's, so both states and both clocks can be looked at on demand.
  *Replaying* stands in for the replay's candidate relay — real rings on a
  timer, as the worker sends them before any plan exists.
- **B · run in progress** — `LiveCandidateFigure`, its tiles drawn from eight
  real woven rings, its plaque bar driven by frames shaped like the engine's.
  `m`, `n` and `levels` change the ceiling the plaque quotes.

`fixtures/` is engine output, committed so the mock opens on a machine that has
never run the engine. Regenerate with:

```sh
python3 scripts/mock-fixtures.py     # needs numpy for the host Python
```

`npm run qa:widgets` drives this page in Playwright and shoots both widgets into
`node_modules/.cache/`.
