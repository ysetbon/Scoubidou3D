# Panel mocks

Proposals for the studio's control panel (`src/ui/panel.ts` + `src/styles.css`),
drawn in the project site's own design language — cream paper, Georgia headlines over a
grotesque, hairline rules, coral / gold / teal, pill buttons with a hard offset shadow.
The tokens are lifted from `site/site.css` so a mock can be judged against the page that
actually ships rather than against a fresh palette.

Mocks 1–3 are the original three, and they obey the same rules:

1. **No prose in the working panel.** Every note the shipping panel prints — the tool
   notes, the weave and level explanations, the colour legends, the storage caveat, the
   gesture hint — moves into a single **About** sheet with one entry per topic.
2. **The layer stack is the workspace,** not the sixth section of a long scroll.
3. **Levels are counted from 0.** Level 0 is the ground; each level above it is one whole
   storey up. That is what `levelAt()` in `src/model/levels.ts` already returned, while the
   panel of the time labelled the same storey `L1` — so the numbering was the thing that
   was wrong, not the model. The app counts from 0 now.

| Mock | Idea | The one thing it changes |
| --- | --- | --- |
| [1 — Tabbed panel](./mock-1-tabs.html) | Layers / Ribbon / Scene as three peer tabs, one pane on screen | The stack gets the panel's whole height |
| [2 — Numbered cards](./mock-2-cards.html) | Settings collapse into `01 / 02 / 03` cards that print their own current values | You read the scene's whole setup without opening anything |
| [3 — Layers only](./mock-3-dock.html) | Settings leave the panel for a dock over the canvas; a card per level; per-strand inspector in its row | The panel holds nothing but the stack |
| [4 — Layers / Masks switch](./mock-4-layer-mask-switch.html) | The stack bar's title becomes a two-way switch, and the masks get a view of their own | The panel says what it is showing by showing you how to change it |
| [5 — A reach for every action](./mock-5-scoped-layer-actions.html) | Straighten, Hide and a new Hide others each get a row and their own `This layer / All layers` | One press reaches a whole `N_x` branch, not just one layer |

## What shipped

**Mock 3.** The studio now works this way for real — `src/ui/panel.ts` is the layer
stack alone; the settings live in the dock over the canvas; every
note is behind the `?`; levels count from 0; and the dark theme here became the
app's, and then the whole site's (`site/theme.js` shares its stored choice with the
studio, so opening one from the other does not change the lights).

**One deliberate divergence.** Mock 3 floats the dock's card over the canvas, which
is right on a wide screen and wrong on a phone: there the panel is a bottom sheet,
the canvas is the strip above it, and a 310px card over that strip hides the very
thing the slider is changing. So below 860px the app does what mock 1 does instead —
the dock swaps the panel to that card, and the bar names it with a way back to
Layers. Same four pills, same four cards, in the one place there is room for them.

**A second divergence, from use.** The mocks draw a storey as a card whose header
names it. In the app the bar is *detached* and sits **under** the layers it
carries, because that is what a storey is — the floor they rest on — which makes
level 0's bar the last thing in the panel and makes `▲▼` read as walking that bar
through the stack past the rows either side of it. The stack hangs from the bottom
of the panel for the same reason: the ground belongs on the floor. Both came out of
a hand sketch, which was worth more than a mock here — it is what someone reaches
for when they want to move a storey.

**Mock 4, and it shipped too.** The stack bar had grown a title that only named what
the panel already was (`Layers`) and a note you read once and then read forever
(`TOP = FRONT`), while the masks rode in a dashed card wedged above a stack they are
not part of — a mask is a crossing, not a storey. Both went, and the space became a
switch: **Layers | Masks**, a filled thumb sliding between two marks the app already
uses (the Level button's stacked slabs, and one band crossing over another). Two words
and two marks, and nothing else — the Masks side carried the crossing count for a day,
which is three digits on a woven mat and pushed the switch into the Level and Strand
pills beside it, so the number lives in the tooltip instead. `TOP = FRONT` moved into
the About sheet, where the rest of the prose lives.

Mock 4 is drawn against `../../src/styles.css` rather than `mocks.css` — it changes one
strip of a panel that already ships, so it is judged in the shipping palette, at the
shipping panel width, with the shipping rows under it. Its first column is the question
the mock was really for: **which mark for masks**. The Weave tool's own mark is drawn
on the diagonal for a 24px button and shrinks to a bare ✕ beside a label, so the strip
puts it next to three others — upright bands, the mask row's two-tone disc, the
intersect glyph — in both themes and at the size it will actually be read. The upright
bands won.

**Mock 5, still open.** The inspector has exactly one reach switch — `Applies to ·
This layer / All layers` — and it governs the colour chips and nothing else, while
`Straighten` and `Hide` are two pills that always act on the single layer whose row is
open. On a scene with sets in it that split stops making sense: colouring a whole `3_x`
branch is one press and hiding it is twenty-three. So mock 5 gives every action a row
and a reach of its own, and adds a third — **Hide others**, which reads the same switch
the other way round, as what to *keep*: hide everything that is not this layer, or
everything that is not its branch.

Its scene is the **7×3 twist** (`twistStitchMN(7, 3, 10)`) rather than the box stitch
the other mocks use, because the proposal only earns its keep at that size: ten laces,
twenty-three layers each, eleven storeys, 230 rows. `Hide others · All layers` there
turns 207 rows off in one press — which is why the mock draws that state as its fourth
frame and gives it two things the shipping panel has no need for: hidden rows that read
as hidden across a whole stack (dimmed, hollow swatch), and a sticky
`207 layers hidden · Show all` strip on the stack itself. The strip has to live there and
not in the inspector, since the inspector can be closed with the scene still soloed.

Three shapes for the rows, and that is the question the mock is for:

| | The row | Costs |
| --- | --- | --- |
| **A** | verb pill on the left, reach switch on the right | six rows where there were four |
| **B** | no pill — the switch halves *are* the buttons, one press | colour has no button of its own and must stay sticky, so the same control means two things one row apart |
| **C** | one reach at the top governing everything under it | cannot colour a branch while hiding a single layer |

**One thing to settle in the model, not the panel.** `rebuild()` maps a hidden strand's
centerline to `null` (`src/scene/StrandScene.ts`), which drops it out of the crossing
solve as well as out of the drawing — so a soloed branch comes back flat, having lost
every over/under it had with the layers around it. Hiding one layer barely shows it;
`Hide others` makes it the whole picture. Whatever row shape wins, hide wants to stop
the *drawing* and leave the *weave* alone.

The mocks stay in the repo as the record of the choice — and as the place to
try the next panel idea before touching the app.

## Both themes

`mocks.css` carries a light and a dark palette. The dark one is not an inversion: the
paper goes to a warm near-black with the cream's own yellow-brown cast, the stage keeps
its dotted field as dark olive under a soft gold glow, and coral stops being an accent on
white and becomes the fill an active control takes.

What made that possible is splitting the site's single near-black three ways —
`--ink` for text, `--edge`/`--edge2` for borders, `--shadow` for the hard offset. Only
`--ink` flips to cream: cream borders at full strength shout, and a cream drop shadow is
not a shadow.

The theme follows the OS by default, the ◐ button overrides it either way, and the choice
is remembered. `?theme=light` or `?theme=dark` in the URL wins over both — which is how
the renders below are shot.

## The About sheet

`mocks.js` is the only script, and it is deliberately small: the theme switch, the About
sheet, and mock 3's dock popovers. The sheet slides up over the panel it belongs to and
takes the whole of it, so opening reads as *the panel turned over* rather than a dialog
dropped on top. It closes on its own ✕, on Escape, and — where the ? is still uncovered —
on a second press of the ?. Focus follows it in and back out, and Escape only ever closes
the topmost thing, so dismissing the sheet leaves a dock popover where it was.

Its text lives in one place per file: the still in the render strip is the source, and the
working sheet is cloned from it at load, so the two cannot drift apart.

## Renders

Each `.png` is one shot: the app frame at 1440 × 900, then a strip that names the mock,
states its navigation model, and shows the About area at true panel width.

| File | What it shows |
| --- | --- |
| `mock-1-tabs.png` · `mock-1-tabs-dark.png` | mock 1, both themes |
| `mock-2-cards.png` · `mock-2-cards-dark.png` | mock 2, both themes |
| `mock-3-dock.png` · `mock-3-dock-dark.png` | mock 3, both themes |
| `mock-3-dock-about.png` · `mock-3-dock-about-dark.png` | mock 3 with the About sheet open (frame only) |
| `mock-4-layer-mask-switch.png` | mock 4 — both themes in one shot, four panels each |
| `mock-5-scoped-layer-actions.png` | mock 5 — both themes, four panels each, over the whole 7×3 stack |
| `mock-5-inspector.png` · `mock-5-inspector-dark.png` | mock 5's four inspectors on their own, at reading size |

The mocks are static HTML — no build step. Open one in a browser, or re-render with
Playwright at a 1440 × 900 viewport, `deviceScaleFactor: 2`, `fullPage: true`, once per
theme via `?theme=`; the About shots click `.helpbtn [data-act="about"]` and capture
`.frame` alone.

Mocks 4 and 5 are the exception to all of that: one page holds both themes, as a row of
`<iframe>`s per theme, so a colour is judged against its opposite number rather than
across a scroll. Shoot mock 4 whole at 1520 × 1560 and mock 5 at 1500 × 2300, both at
`deviceScaleFactor: 2` — the frames are live, so a switch clicked in the page really does
swap that panel's body. Mock 5's close-up is the same file at `?strip=1`, shot at
1420 × 960, `deviceScaleFactor: 3`, once per theme. The viewport has to be tall enough
to hold the whole page in both cases: an `<iframe>` below the fold does not paint into a
`fullPage` capture.

The scene shown is the same in mocks 1–4 — a box stitch of 3 rounds, 9 strands, 3 masks,
3 levels — so those panels are compared on layout alone. Mock 5 is the one that changes
it, and says why above.
