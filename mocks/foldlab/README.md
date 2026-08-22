# /foldlab — the design canvas

Working drawings for a page that does not exist yet: **`/foldlab/`**, the
successor to the Bight Lab artifact. Bight Lab asked what one turn costs to
climb a storey; this asks the question underneath it — **where every part of
every strand rests**, so that two levels of a box stitch read as one continuous
weave rather than two rounds stacked on a lid.

## The proposal, in one line

A level stops being *one plane with a ±t/2 crossing swing on it* and becomes
**three named planes** — `bottom`, `center`, `top` — one strand thickness apart;
and **level L's top is level L+1's bottom**.

That last clause is the whole of "seamless". Today `restZ = rank·layerGap +
level·2t` (`StrandScene.levelStepSource`) gives a storey two usable heights,
arrived at by accident as ±half a thickness either side of the storey plane
(`StrandScene.weaveAmplitude`), with **nothing between them** — so an arm that
should pass between the lace riding over and the lace ducking under has nowhere
to be, and consecutive rounds only ever touch. Naming three planes gives that
arm a home; sharing one between levels makes the round above bite a thickness
into the round below.

## The artboards

| file | what it draws |
|---|---|
| `Main.dc.html` | the page itself: the three seam models (shared / butt / today's) switched live, a section through two levels with every plane labelled, and the audit that decides whether the result is seamless |
| `Ledger.dc.html` | the sheet to argue with — two rounds of a 1×1 box, one row per arm per level, each plane a chip you cycle `bottom → center → top`. The prefilled values are a **first guess, not a finding** |
| `Crossing.dc.html` | the rule at a meeting: Δ planes between two parts → weave, collision or daylight, over the five distinct planes of two shared-seam levels; and the one place a shared plane bites back |
| `Bight.dc.html` | the C carried over from Bight Lab, re-asked in planes. Same half-roll, same closed forms — but a fold now climbs a *number of planes*, and different folds in one stitch climb different numbers, which is what `FOLD_STACK = 2` cannot express |

## The page itself

This directory is the *drawing*. The page it argues for now exists and is a real
route: **`/foldlab/`** — `foldlab/index.html` + `src/foldlab/main.ts`, a vite
entry like every other page here.

```sh
npm run dev
# http://localhost:5173/Scoubidou3D/foldlab/
```

It wears the studio's own stylesheet and mounts the studio's own renderer, so
the ribbons, the colours, the grid and the layer panel are the real ones. Two
rounds of box stitch, and every layer row carries the ledger of what it rides
**over** and what it ducks **under**. Those facts come from
`StrandScene.getCrossings()`, which reports what `weaveCenterlines` actually
decided — a mask if one covers the pair, otherwise the higher layer — so the
list and the picture cannot drift apart.

The plane chips (`bottom` / `center` / `top`) are the part that is **not**
implemented in the engine. Pressing one changes what the panel reports, not what
the canvas draws; **Copy ledger** puts the whole assignment on the clipboard as
plain text. That is the artefact to correct and hand back.

Everything opens on `center`, which is deliberately wrong: with every layer on
one plane every crossing reads `Δ0 same plane`, and the panel is showing you that
nothing has been decided yet rather than presenting a guess as a finding.

## Rebuilding the canvas

`fold-lab.html` is the published payload and is **not** tracked — the `.dc.html`
files and `canvas.json` are the source. To regenerate it, re-run the `/design`
skill's seeder over the artboards in this directory and republish to the same
artifact URL.

## One trap, if you edit an artboard

A `{{hole}}` used as the **text content of an SVG `<text>` element renders as
nothing** — silently. Attribute holes (`x="{{p.x}}"`, `fill="{{p.tone}}"`) and
literal text are fine; only the text node is dropped. Every label in these
drawings is therefore an absolutely-positioned HTML element over the SVG, keyed
to a percentage of the SVG's own box. Keep it that way.
