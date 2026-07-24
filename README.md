# Scoubidou3D

**A 3D reimagining of [OpenStrand Studio](https://github.com/ysetbon/OpenStrandStudio).**

OpenStrand Studio (and its browser port [OpenStrandJS](https://github.com/ysetbon/OpenStrandJS))
draw strands from a **top-down** point of view. Strands have a *width*, and
over/under weaving is *faked* with masking. Scoubidou3D asks a different
question:

> What if a strand had a real **thickness**, and "layer over layer" in the
> layer panel meant the strand physically sits **on top** in space — so you
> could tilt the camera and see the weave in 3D?

That's the whole idea. Each strand becomes a **ribbon** (like the plastic-lacing
/ gimp lanyards this was inspired by): its OpenStrand *width* runs across the
ribbon, a new *thickness* runs through it, and its **layer index becomes its
height (Z)**. When strand *Y* is above strand *X* in the layer panel, *Y*'s
ribbon sits directly over *X*'s — everywhere they cross.

![concept](docs/concept.svg)

## What works today (initial implementation)

- 🧵 **Strands → 3D ribbons.** Every strand is extruded into a solid ribbon
  with configurable **thickness**, rounded edges, rounded ends, and a
  stroke-colored outline.
- 📚 **Layer stacking = real depth.** The layer order *is* the Z order. Reorder
  a layer and it moves up/down the stack live.
- 🎥 **Full 3D camera.** Orbit, pan, zoom (Three.js `OrbitControls`). One click
  snaps back to the familiar top-down OpenStrand view.
- 🎚️ **Live controls** for thickness, layer gap, width scale, outline, rounded
  ends, and a reference grid.
- 🗂️ **Layer panel** to recolor, hide, reorder, delete, and add strands.
- 📥 **Import real files.** Load an OpenStrand Studio / OpenStrandJS `.json`
  save and see it in 3D. The strand geometry uses a faithful port of OSS's
  curve math (`strand.py::_build_curve_profile`), so curves match the original.
- 🧩 **Sample scenes:** two crossing strands, a woven mat, and a curved ribbon
  stack.

## The 3D translation, in one picture

| OpenStrand (2D) | Scoubidou3D |
| --- | --- |
| strand `width` | ribbon width (across) |
| — | ribbon **thickness** (through) — *new* |
| layer order in the panel | **height in Z** (top layer = front) |
| over/under via masking | real occlusion from the Z stack |
| top-down canvas | orbit camera (drops to top view on demand) |

## Run it

You need [Node.js](https://nodejs.org/) 18+.

```bash
npm install
npm run dev      # http://localhost:5173
```

Build the static site:

```bash
npm run build    # outputs to dist/
npm run preview
```

## How it's built

```
src/
  geometry/
    bezier.ts     # port of OpenStrand's eased curve profile -> sampled centerline
    ribbon.ts     # sweep a (width x thickness) cross-section along the centerline
  model/
    types.ts      # Strand3D / Scene3D
    importOss.ts  # read OpenStrand Studio / OpenStrandJS .json
    samples.ts    # built-in demo scenes
  scene/
    StrandScene.ts# Three.js scene: build meshes, stack in Z, lights, orbit camera
  ui/
    panel.ts      # control panel + layer stack
  main.ts
```

The ribbon sweep uses a **fixed frame** (side = in-plane normal, up = world +Z)
instead of Frenet frames, so a flat ribbon never twists and its face always
points toward the camera in top view — exactly like the original editor.

## Roadmap / ideas

The v1 model is **global Z per layer**: a strand is entirely above or below its
neighbours. That already matches "Y over X in the layer panel," but real
basket-weaves need a strand to go *over one and under the next*. Natural next
steps:

- **Per-crossing undulation** — displace a strand's centerline in Z as it
  crosses others, so a single strand can weave over-and-under (true baskets,
  braids, knots).
- **Direct 3D editing** — drag endpoints/control points in the scene, not just
  in an imported file.
- **Honor masks** from imported files to drive the undulation automatically.
- **Round-trip** back to OpenStrand `.json`, and PNG/GLTF export.
- **Materials** — glossy plastic vs. matte cord, per-strand.

## Relationship to the OpenStrand family

- [OpenStrand Studio](https://github.com/ysetbon/OpenStrandStudio) — the
  original PyQt5 desktop app (the spec).
- [OpenStrandJS](https://github.com/ysetbon/OpenStrandJS) — the fidelity-first
  browser port (2D canvas).
- **Scoubidou3D** — this repo: the same strand model, seen with depth.

## License

GNU General Public License v3.0, matching OpenStrand Studio.
