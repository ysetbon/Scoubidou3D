# Mocks

Working drawings for the MXN lab's busy states. Neither file is a vite build
input, so nothing here is published.

| file | what it is |
|---|---|
| [`thinking-indicator-mock.html`](thinking-indicator-mock.html) | the original proposal for the busy state: three layouts for the candidate sheet, judged before any of it existed. Standalone — it copies the tokens out of `src/mxn-lab/lab.css` and fakes the drawing in vanilla JS. Open it with any static server, or straight off disk. |
| [`widgets.html`](widgets.html) | the two busy states as they now are. Mounts the **real** components against **real** engine payloads; only the worker is a stand-in. |

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
