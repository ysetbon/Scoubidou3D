# Panel mocks

Three proposals for the studio's control panel (`src/ui/panel.ts` + `src/styles.css`),
drawn in the project site's own design language — cream paper, Georgia headlines over a
grotesque, hairline rules, coral / gold / teal, pill buttons with a hard offset shadow.
The tokens are lifted from `site/site.css` so a mock can be judged against the page that
actually ships rather than against a fresh palette.

All three obey the same rules:

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

The three mocks stay in the repo as the record of the choice — and as the place to
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

The mocks are static HTML — no build step. Open one in a browser, or re-render with
Playwright at a 1440 × 900 viewport, `deviceScaleFactor: 2`, `fullPage: true`, once per
theme via `?theme=`; the About shots click `.helpbtn [data-act="about"]` and capture
`.frame` alone.

The scene shown is the same in all three — a box stitch of 3 rounds, 9 strands, 3 masks,
3 levels — so the panels are compared on layout alone.
