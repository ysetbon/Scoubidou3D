# Artifacts

Standalone pages built out of the studio's own geometry — one HTML file each, no
CDN, no fetch, no sibling assets. They exist for the things a screenshot cannot
settle: *is this model actually right?* You orbit it and find out.

```
npm run artifact -- twist-level-9      # -> artifacts/built/twist-level-9.html
npm run artifact -- box-family
```

Open the file in a browser, or publish it (Claude Code's Artifact tool takes the
path). The pages are written for that host in particular, which serves them under
a strict CSP: **everything must be inlined**, and the page renders in the reader's
own light or dark theme, so both are designed rather than one inverted.

| artifact | what it settles |
| --- | --- |
| [`twist-level-9`](twist-level-9/) | The 1×1 twist column at level 9, before and after the fix in `collectJunctions` — whether each lace is one continuous ribbon or four pieces with bridges lofted across the seams. |
| [`box-family`](box-family/) | Every m×n box face, both hands, worked to ten rounds — whether a round really lands on the one below rather than through it, and whether the over/under flips the way a box's has to. **Live**: it carries `StrandScene` and builds what you pick. |
| [`four-twists-2x1`](four-twists-2x1/) | One hand-fitted 2×1 ring, `k = −1` four times over, imported from the MXN lab — whether its four *rounds* stand as four *storeys* once the level breaks are put in, and what the same ring looks like with none. **Live**: it carries `StrandScene`, so its joints can be slid and its points dragged with the app's own move tool. |

---

## What is in one

```
twist-level-9/
  artifact.json     what to build, and which builds to compare
  scenes.ts         the scenes to show, from the model in src/
  viewer.js         the page's own little studio (three.js + orbit camera)
  page.html         the page itself; __VIEWER__ is where the script lands
  .work/            build scratch, ignored
```

Nothing here re-derives geometry. `artifacts/lib/bake.mjs` drives a **headless
studio** and takes the meshes it built — the same ribbon sweep, weave, fold
creases and outline shells the app draws — so a page cannot disagree with the app
about what the model looks like. If the artifact is wrong, the app is wrong.

`artifacts/lib/pack.mjs` then quantises positions to Int16 against each level's
own bounding box, drops indices to Uint16 where the mesh is small enough,
deflates the lot and base64s it. The page undoes that with `DecompressionStream`.
A 1×1 column at level 9 goes from ~0.65 MB of raw arrays to ~0.33 MB of text; the
finished page, three.js and all, is about 1.1 MB.

## Live artifacts

A page whose subject is a *family* cannot be baked: all 64 box faces at ten
rounds each is 640 scenes and hundreds of megabytes, and a page you cannot open
settles nothing. Such an artifact says `"live": true` and no scenes at all — the
build skips straight to bundling — and its `viewer.js` imports `StrandScene` and
whatever builds its scenes, then puts the two together in the browser.

That keeps the same promise a different way. A baked page cannot disagree with
the app because it was handed the app's meshes; a live page cannot disagree
because it *is* the app — the same view class, the same builder, no second
implementation. What it gives up is the frozen record: a baked page still shows
what the model looked like the day it was built, and a live one moves with the
code. Bake a before/after, run a family live.

A page you can EDIT has to be live for a second reason: a baked mesh has no
points to take hold of. `four-twists-2x1` carries the view's `move` tool, so what
the reader drags is the model — the same endpoint move the app makes, glued
endpoints and all — and `Copy scene JSON` carries the result back out.

## Comparing two builds

A variant may name a **`swap`** — a source file and the revision to take it from:

```json
{ "id": "before", "label": "Before the fix",
  "swap": { "src/model/connections.ts": "639941a" } }
```

The build writes that revision of the file, bakes, and puts the file back. So a
before/after page shows the real regression rather than a drawing of one, and it
keeps showing it after the fix has been merged and forgotten.

Pin a **commit sha**, not `HEAD~1` — the parent of a fix stops being the parent
the moment anything lands on top of it.

The build refuses to start if a swapped file has uncommitted changes, so it can
never eat work in progress.

## Adding one

1. `mkdir artifacts/<name>` and copy the four files above as a starting point.
2. Point `scenes.ts` at whatever you want built; it writes one JSON scene per
   file into the directory it is handed.
3. Say which scenes to bake in `artifact.json`, and which of them to keep: `show`
   names one, or a list of them for a page that flips between several. Leave it
   out to keep every scene the bake produced. Weight is the thing to watch — an
   8×8 box is 4 MB of mesh on its own.
4. Write the page. It is a page, not a demo — say what the reader is looking at
   and what would count as it being wrong.
5. `npm run artifact -- <name>`, then add a row to the table above.

## Needs

- **Playwright**, for the headless studio. It is not a dependency of this repo —
  it comes with the environment. Set `PLAYWRIGHT_MODULE` if it lives somewhere
  unusual, `CHROMIUM_PATH` to pick a specific browser binary.
- **The dev server.** `window.__scoubidou` is stripped from production builds, so
  baking needs `vite`. The build starts one on `:5181` if nothing answers there
  and stops it afterwards; `ARTIFACT_PORT` moves it.
