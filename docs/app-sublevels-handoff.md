# Sublevels in the studio's layer panel — handed over

The fold lab can say where every layer RESTS inside its storey — bottom, center
or top — and the geometry obeys it. The studio cannot say it at all. This is the
brief for giving `/app/` that control, in a form somebody can actually use.

Branch `claude/fold-turn-mirror-only-7k3pqz`, PR #174 (draft, CI green).
Head at time of writing: `b53b078`.

## Read these first, in this order

1. `src/foldlab/main.ts` — the whole plane model, in one 870-line page. The
   parts that matter are `PLANES` (line 40), `PITCH` (48), `Rest` (65),
   `push()` (131) and `chip()` (394).
2. `src/scene/StrandScene.ts` — `Sublevel` (line 120), `setSublevels`
   (search it), and `buildLaceMeshes` where the folds are built.
3. `src/geometry/polyline.ts` — `TurnRecord` (line 283) and `zFolds`.
4. `src/ui/panel.ts` — the studio's panel. 3127 lines. `renderStack` (1802)
   and `layerRow` (2001) are where a control would go.

## What already exists, and works

`StrandScene.setSublevels(map)` takes a `Map<strandId, {in: number, out: number}>`
where the numbers are **thicknesses off the middle of the layer's own storey**.
The fold lab's three planes are just three values:

    bottom  -1      center  0      top  +1

and a storey is `PITCH = 2` thicknesses, so one level's `top` IS the next
level's `bottom`. That interlock is the whole idea and it is already realised.

`in` is where the run rests, `out` is where it settles AFTER its C. The lab
exposes both (`chip(id, 'in')` and `chip(id, 'out')`), and both feed the same
map.

Passing `null` turns the whole thing off and restores the studio's ordinary
weave, which is what `/app/` does today — `setSublevels` is called by
`src/foldlab/main.ts` and by nothing else.

**On this branch the fold geometry no longer depends on that flag.** `zFolds`
runs unconditionally now, so the studio already draws real C-returns; what it
lacks is any way to say which plane a run rests on. `easeFolds` still runs only
when no planes are declared, because with planes the heights are the planes' and
easing them would cap and ramp away the very storey they asked for.

## The actual design question — settle this before writing UI

The user's words: *"top / bottom / center for different sections of part of a
strand — its C shape, and its part interacting with other strands."*

`Sublevel` today is `{in, out}` — **two** values per strand. That is one plane
for the run and one for after the C. The request may need more than two, and
that is the first thing to decide, because everything else follows from it:

- **If two is enough**, this is a small job: surface `in` and `out` per layer in
  the studio panel and call the existing `setSublevels`. No geometry change.
- **If a strand needs a plane per SECTION**, the model has to grow, and the
  sections have to be named. The good news is the geometry already knows where
  they are — see below — so this is not guesswork.

Do not guess which. Look at the scene, and ask the user with a picture.

## What a "section" already is, concretely

This is the part worth knowing, because it means sections do not have to be
invented — they are already computed and addressable.

Every point of a merged lace centreline carries `owner` (an index into
`scene.strands`) and sometimes `shared`. See `Vec3` in `src/geometry/vec.ts`.
Ownership is decided in two places and nowhere else: at concatenation
(`buildLaceMeshes`) and inside `zFolds`, which splits each turn at its **apex**
— everything up to the apex belongs to the arriving layer, everything after to
the leaving one, and the apex itself is marked `shared` so a cut there keeps it
on both sides.

`zFolds` also returns a `TurnRecord[]`, one per fold, addressing the FINAL
centreline:

    { from, to, apex, inOwner, outOwner }

and each lace keeps them: `view.laceCenterlines[i].turns`.

So a strand's own run is already divisible into: the stretch before its turn,
its half of the turn (from `from` to `apex`, or `apex` to `to`), and the stretch
after. If a per-section plane model is needed, those indices are the seams — do
not re-derive them from nearest-point distance, which is the mistake an earlier
pass made and which the ownership map exists to prevent.

Crossings are a separate axis: `view.getCrossings()` returns `CrossingFact[]`
(`StrandScene.ts` line 125) with `aIndex/bIndex/overIndex/underIndex/woven`.
"The part interacting with other strands" is those, and they are positions along
the run rather than owned sections — so if the UI wants to talk about them it
needs a mapping from crossing to arc position that does not exist yet.

## What to learn from the lab's panel, and what NOT to copy

Learn:

- The **chip that cycles** (`chip()`, line 394). One button, tap to advance
  bottom → center → top, showing a mark and the name. No dropdown, no modal.
  It is the whole interaction and it is good.
- **The plane is shown where the layer is**, not in a separate panel section.
  An earlier lab design split a layer's details between a stack row and a folds
  section, and answering one question about one layer took two places and a
  scroll. That is recorded in the file's own header comment as a mistake.
- Reading the geometry back rather than asserting it: the lab's side elevation
  is plotted from `view.laceCenterlines`, not from a schematic, so it cannot
  disagree with what is on the canvas.

Do NOT copy:

- The whole card. The lab's layer card carries crossings, folds, a side
  elevation and a paste sheet. The studio panel is a **layer stack** — its own
  header comment says so — and it is already 3127 lines. Adding a lab card to
  it would be the wrong shape.
- `Plane from weave`, the ledger Copy/Paste, the elevation SVG. Those are
  lab instruments. The user asked for *minimal and simple*.

## The bar for "minimal and simple"

A reasonable target, to be checked with the user before building:

- One control per layer row, in the row, cycling bottom/center/top.
- It should be obvious what it does without a legend — the lab's `▼ ● ▲` marks
  do most of that work.
- Nothing new in the dock or the toolbar.
- Off by default: a scene that has never been touched should render exactly as
  it does today. `setSublevels(null)` is that state, and it must stay reachable.

## How to check the work

Dev server, then the studio:

    npm run dev
    # http://localhost:5173/Scoubidou3D/app/

`/app/` opens on `two-crossing-arms` — six strands, two laces of three arms
each, two folds per lace — so there is a C on screen immediately to move
between planes.

Numbers, not impressions:

    node scripts/qa-fold.mjs --tag <name>

reports per scene the storey each turn carries and the tilt where it meets its
runs. Note it was taught about turns on this branch: a C has no sharp vertex, so
the old "find a vertex turning 60 degrees or more" search finds nothing.

The CI set, all of which currently pass:

    npm run build
    npm run check:enginekey
    npm run check:ladder
    npm run check:board
    npm run check:plan
    npm run check:boundary

## One open trade-off you are inheriting

Enabling C-returns in the studio moved two numbers, and the second is not yet
signed off by the user:

| | crease (main) | C-return (this branch) |
|---|---|---|
| `ramped` max | 0.30–0.33 | 0.00 |
| `faceTilt` | 22–24°, none over 30° | 42–55°, 1–23 turns per scene over 30° |

The runs meet their turns more steeply than they used to. If the user says that
is too steep, the levers are `FOLD_STACK` in `StrandScene.ts` and
`LEG_PER_WIDTH` in `src/geometry/zturn.ts`, plus the leg sizing inside `zFolds`.
A sublevel model changes the step a fold carries, so it may move this number
too — measure it before and after.
