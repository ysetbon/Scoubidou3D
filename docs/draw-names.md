# Draw names — the **Names** button

OpenStrand Studio has a button under its layer list that writes each strand's
layer name onto the canvas: `layer_panel.py`'s `draw_names_button`, backed by
`canvas.should_draw_names`, with `1` as its keyboard shortcut. This is that
button, in 3D.

Short form:

> **Names** draws every strand's layer name on the model itself. It is a way of
> LOOKING, not a tool: nothing is armed by pressing it, it changes nothing in the
> scene, it holds whichever tool is up, and it is off when the app opens — the
> grid's kind of switch, not the weave's.

## Where it sits, and why there

At the **end of the tool strip**, behind a rule of its own — the same rule the
undo pair sits in front of, and for the same reason: neither is a tool.

Two other homes were built and photographed before this one was picked.

| home | why not |
| --- | --- |
| Beside **Grid** in the dock's View card | The closest match conceptually — both are overlays the view carries — and it costs no permanent space. But two presses to reach, and with the card shut nothing says the names are on except the names. |
| In the **layer panel**, with the names themselves | The most literal home, and closest to OSS. But the stack bar is full: a fourth pill squeezes the Layers / Masks / Planes switch until its label truncates, and a per-row control would be the fifth thing in a row that already carries `●`, `▲`, `▼` and Move's `◎`. |

The strip pays for the choice in width, and `#toolbar`'s `flex-wrap` is what it
pays with: Names takes its scope segment with it onto a second line (they are one
`.names-ctl` group, so the segment can never be left sitting under Move's handles
pointing at the wrong control). Reserving the corner properly for the fold toggle
is what keeps that second line clear of it on a phone — see the `104px` in the
narrow `#toolbar` rule, which also fixes Move's control running under that pill.

## The scope — the part OSS does not need

On a flat canvas "draw names" is one switch, because there is one plane. A scene
here is a **tower**: the ten-level box stitch is forty-two strands, and naming all
forty-two is not a reading of the model, it is fog. So the switch carries a scope,
in the segment the strip already uses for Move's handles:

| scope | what it names |
| --- | --- |
| **All** | Every visible strand — what OSS's button means. |
| **Level** | The strands resting on one storey (`levelAt`, levels.ts). |
| **Layer** | One layer alone. |

Each narrowed scope is aimed at **its own kind of thing**, which the first draft
got wrong: it kept one "target layer" and worked a level out of it, so pressing
**Level** asked for a *layer*, and with none picked it named nothing at all.

* **Level** is aimed from the **level bar** — the `▣` beside its `▲▼✕`, lit on the
  storey being named. Its own mark rather than a second `◎`, because with Move up
  both aims can be on one bar, and two identical rings pointing at different
  things is worse than none.
* **Layer** is aimed by pressing a **row**, which is what selecting a row already
  means. A row is *on* a storey, so a press aims both scopes at once.

And both aims **resolve** rather than being trusted (`getNameLevel` /
`getNameLayer`): a scope that has never been aimed, or was aimed at a layer since
deleted or a storey since emptied, falls back to the top of the stack — the
storey or layer you are looking at. "Level with nothing aimed" is not an error to
report, it is a question with an obvious answer, so the control always names what
it says it is naming. The chip says which: `▣ Level 6`, or `▣ 1_14`.

Nothing is hidden, dimmed or moved by any of this. **Hide others** is the control
that does that, and it is still the one to reach for.

## Where a label goes

OpenStrand draws the name at the middle of the strand (`strand.py`'s label). That
does not survive the third dimension — and not because of the camera. In a box
stitch **the middle of every strand is the same knot**, so six labels land in one
pile and the pile says nothing.

So each label picks, from five points along its **own** run (at 0.5, 0.28, 0.72,
0.14 and 0.86 of the drawn centreline), the one furthest from the labels already
placed. Greedy, one pass, in stack order. It is still unmistakably on its strand,
and it is legible on a stitch rather than stacked.

The rest of the drawing:

* A **sprite**, so it faces the camera from wherever you orbit.
* `depthTest: false`, so a name is never swallowed by the ribbon it belongs to.
* The pill is drawn in the theme's ink, outlined in the **strand's own colour** —
  which is what makes a label point at one ribbon rather than float over the pile.
* **The light theme's glyphs are stroked before they are filled; the dark theme's
  are not.** Ink on near-white reads thinner than cream on near-black at the same
  weight, and the pill is then a texture mip-mapped down to whatever the camera
  makes of it, which takes the thin stems first — side by side, the light labels
  read a weight lighter than the dark ones. Asking for a heavier face cannot fix
  it: in a canvas this stack has one usable weight (600, 700 and 800 all measure
  the same ink to the pixel), so the weight is drawn on, at `1.6px` on a 64px
  face — about the fifth of a stem the two themes measured apart.
* Anchored on `drawnLines` — where the strand is actually drawn, after the lace
  merge — not on the woven centreline, which is that merge's input.

## What does not get one

* **Hidden strands.** Hiding stops the drawing; a name is drawing.
* **Masks.** A mask is a relationship between two layers, not a ribbon.
* **The GLB export.** It carries the craft, not the annotations.
* **The scene file.** `showNames` and `nameScope` are `RenderParams`, like
  `showGrid` — a view setting, saved with neither the scene nor the undo history.

## The code

| where | what |
| --- | --- |
| `src/scene/StrandScene.ts` | `showNames` / `nameScope` in `RenderParams`; `updateNameLabels`, `nameSprite`, the two aims (`setNameLayer` / `setNameLevel`) and their resolvers (`getNameLayer` / `getNameLevel`). Rebuilt with the model (`rebuild`) and repainted with the theme (`setTheme`). |
| `src/ui/panel.ts` | The toolbar button in `syncToolbar`, `nameScopeControl`, `toggleNames`, the `▣` on the level bar, and the `1` key. |
| `src/styles.css` | `.names-ctl`, `.focus-target.waiting`, and the narrow `#toolbar` corner reserve. |
