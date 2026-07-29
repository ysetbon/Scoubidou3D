# Panel mocks

Three proposals for the studio's control panel (`src/ui/panel.ts` + `src/styles.css`),
drawn in the project site's own design language — cream paper, Georgia headlines over a
grotesque, hairline rules, coral / gold / teal, pill buttons with a hard offset shadow.
The tokens are lifted from `site/site.css` so a mock can be judged against the page that
actually ships rather than against a fresh palette.

All three obey the same two rules:

1. **No prose in the working panel.** Every note the shipping panel prints — the tool
   notes, the weave and level explanations, the colour legends, the storage caveat, the
   gesture hint — moves into a single **About** area with one entry per topic.
2. **The layer stack is the workspace,** not the sixth section of a long scroll.

Each `.png` is one render: the app frame at 1440 × 900 on top, then a strip that names the
mock, states its navigation model, and shows the About area at true panel width.

| Mock | Idea | The one thing it changes |
| --- | --- | --- |
| [1 — Tabbed panel](./mock-1-tabs.html) | Layers / Ribbon / Scene as three peer tabs, one pane on screen | The stack gets the panel's whole height |
| [2 — Numbered cards](./mock-2-cards.html) | Settings collapse into `01 / 02 / 03` cards that print their own current values | You read the scene's whole setup without opening anything |
| [3 — Layers only](./mock-3-dock.html) | Settings leave the panel for a dock over the canvas; a card per level; per-strand inspector in its row | The panel holds nothing but the stack |

The mocks are static HTML — no build step, no JS. Open one in a browser, or re-render the
PNGs with Playwright:

```js
// 1440 x 900 viewport, deviceScaleFactor 2, fullPage
for (const f of ['mock-1-tabs', 'mock-2-cards', 'mock-3-dock']) {
  await page.goto(`file://<repo>/docs/panel-mocks/${f}.html`);
  await page.screenshot({ path: `${f}.png`, fullPage: true });
}
```

The scene shown is the same in all three — a box stitch of 3 rounds, 9 strands, 3 masks,
3 levels — so the panels are compared on layout alone.
