# Layer levels — the “New level” button

This is the written-out version of the request, so the behaviour is pinned down
before the code exists. Short form:

> Add a button to the layer panel that drops a **layers icon row** into the
> stack. Everything above that row rests **one full strand thickness higher** in
> Z — so every layer you add after pressing it sits on a new storey.

![the button and the row it adds](layer-levels-panel.svg)

## Why it is needed

Scoubidou3D already has two ways of moving a strand in Z, and neither one does
this job:

| control | what it does | why it isn't this |
| --- | --- | --- |
| **Layer order** (`▲`/`▼`) | Ranks laces, spaced by the **Layer lift** slider (default `10`). | The lift is one global number, much *smaller* than a strand's thickness — it separates the stack, it doesn't stack it storey by storey. |
| **Masks** (Weave tool) | At one *crossing*, one lace lifts and the other dips. | Purely local, and only where two strands actually cross. It says nothing about resting height. |

A **level** is the missing third thing: a permanent step in the resting plane,
the exact height of one strand body, applied to a whole region of the layer
panel.

![what it does in 3D](layer-levels-step.svg)

Note the size. The Layer lift is deliberately *less* than a thickness, so two
laces that overlap without crossing still occupy some of the same space. One
level is exactly `thickness`, which is precisely the distance at which the upper
ribbon's underside meets the lower ribbon's top face — laces stacked, not merged.

## The instruction

1. **The button.** The Layers section gets a button showing the stacked-layers
   icon, labelled **New level**.
2. **What it adds.** Pressing it inserts a **level row** at the *top* of the
   layer stack. The row shows the same layers icon, is named `level N` (counting
   up from the bottom) and is tagged `+1 thickness`.
3. **What it means.** Every strand **above** a level row rests one strand
   thickness (the Ribbon ▸ **Thickness** value) higher in Z than it otherwise
   would. Levels add up: two rows above a lace means two thicknesses.
4. **Why the top.** Because the row goes in at the top, *existing* strands don't
   move at all — but every strand born afterwards (**Add strand**, **Attach**,
   both of which push onto the top of the stack) lands above it, one storey up.
   That is the point of the button: press it, and the next thing you draw is on
   a new level.
5. **It is a real layer.** The row moves with `▲` / `▼` like any other layer, so
   you can push it down through the stack and watch the strands it passes drop a
   level. `✕` removes it and everything settles back.
6. **A lace is one object.** Strands glued end to end share one resting height
   (that is what stops a stitch from climbing a staircase along its own length).
   A lace therefore takes the level of its lowest-numbered member — you cannot
   put half a cord on the floor and half on the shelf.
7. **Crossings are unaffected.** A level changes where laces *rest*. Who goes
   over whom at a crossing is still decided by the masks and the layer order,
   exactly as before, so switching levels on can never silently rewrite a weave.
8. **It is saved.** Levels are part of the scene: they survive Save sample,
   Copy JSON, and paste-back. Older saves without them load as “no levels”.

## The rule, exactly

Levels are stored as break positions in the layer stack. A break at position `k`
means *every strand from index `k` upward is one thickness higher*:

```
restZ(lace) = rank(lace) · layerGap  +  level(lace) · thickness
level(lace) = how many breaks sit at or below the lace's lowest member
```

with `rank` the lace's position in layer-panel order, as today. The whole stack
is then re-centred on `z = 0`, so adding a level opens the model up rather than
sending it drifting off the grid.

With no level rows, `level` is `0` everywhere and the formula collapses to the
current behaviour — the feature is invisible until it is used.
