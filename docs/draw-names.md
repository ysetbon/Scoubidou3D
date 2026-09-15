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
| **Level** | The strands resting on the selected layer's storey (`levelAt`, levels.ts). |
| **Layer** | The selected layer alone. |

Level and Layer aim at the **layer panel's selection**, the way the plane guides
already do — you press the row, and the names follow it. With nothing picked they
name **nothing**, and the chip says `press a layer` rather than quietly naming all
forty-two: the same answer Pick's count gives to the same question.

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
| `src/scene/StrandScene.ts` | `showNames` / `nameScope` in `RenderParams`; `updateNameLabels`, `nameSprite`, `setNameTarget`. Rebuilt with the model (`rebuild`) and repainted with the theme (`setTheme`). |
| `src/ui/panel.ts` | The toolbar button in `syncToolbar`, `nameScopeControl`, `toggleNames`, and the `1` key. |
| `src/styles.css` | `.names-ctl`, `.focus-target.waiting`, and the narrow `#toolbar` corner reserve. |
