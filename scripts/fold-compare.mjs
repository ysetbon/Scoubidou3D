// Pair the two qa-fold.mjs runs into one before/after sheet per view.
//
//   node scripts/fold-compare.mjs [--in DIR] [--out DIR]
//
// Reads `before-<view>.png` and `after-<view>.png` out of the qa-fold output
// directory and writes `compare-<view>.png`: the two side by side, captioned,
// on the app's own dark paper so the pair reads as one picture rather than two
// screenshots. Compositing is done in the browser — the same Chromium qa-fold
// already drives — because the project has no image library and does not need
// one for this.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const IN = flag('in', `${ROOT}node_modules/.cache/fold`);
const OUT = flag('out', `${ROOT}node_modules/.cache/fold`);

const CAPTIONS = {
  'ring-2x1-k1111-lh-34-14': 'Fitted ring 2×1 — from the side',
  'ring-2x1-k1111-lh-110-12': 'Fitted ring 2×1 — one turn, close up',
  'box-stitch-10-34-16': 'Box stitch, 10 levels',
  'box-stitch-10-110-12': 'Box stitch, 10 levels — one turn, close up',
  'twist-stitch-10-34-16': 'Twist stitch, 10 twists',
  'twist-stitch-10-110-12': 'Twist stitch — one turn, close up',
  'box-stitch-34-30': 'Box stitch — starting stitch',
  'box-stitch-110-14': 'Box stitch — one turn, close up',
};

const views = readdirSync(IN)
  .filter((f) => f.startsWith('before-') && f.endsWith('.png'))
  .map((f) => f.slice('before-'.length, -'.png'.length))
  .filter((v) => readdirSync(IN).includes(`after-${v}.png`))
  .sort();

if (!views.length) {
  console.error(`no before-/after- pairs in ${IN} — run qa-fold.mjs with both tags first`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 100, height: 100 } });

const dataUrl = (f) => `data:image/png;base64,${readFileSync(`${IN}/${f}`).toString('base64')}`;

for (const view of views) {
  const png = await page.evaluate(
    async ({ before, after, caption }) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const im = new Image();
          im.onload = () => res(im);
          im.onerror = rej;
          im.src = src;
        });
      const [a, b] = await Promise.all([load(before), load(after)]);
      const PAD = 18;
      const HEAD = 76;
      const LABEL = 46;
      const W = a.width + b.width + PAD * 3;
      const H = HEAD + a.height + LABEL + PAD;
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const g = cv.getContext('2d');
      g.fillStyle = '#141110';
      g.fillRect(0, 0, W, H);

      g.fillStyle = '#f0e9dd';
      g.font = '600 26px system-ui, -apple-system, Segoe UI, sans-serif';
      g.textBaseline = 'top';
      g.fillText(caption, PAD, PAD);
      g.fillStyle = '#9a9088';
      g.font = '15px system-ui, -apple-system, Segoe UI, sans-serif';
      g.fillText('the storey turn: a flat wall, and the half-round a lace really turns on', PAD, PAD + 32);

      g.drawImage(a, PAD, HEAD);
      g.drawImage(b, PAD * 2 + a.width, HEAD);
      g.strokeStyle = '#3a3430';
      g.lineWidth = 1;
      g.strokeRect(PAD + 0.5, HEAD + 0.5, a.width - 1, a.height - 1);
      g.strokeRect(PAD * 2 + a.width + 0.5, HEAD + 0.5, b.width - 1, b.height - 1);

      g.font = '600 19px system-ui, -apple-system, Segoe UI, sans-serif';
      g.fillStyle = '#e0857a';
      g.fillText('BEFORE — fold walled off square', PAD, HEAD + a.height + 12);
      g.fillStyle = '#8fc79a';
      g.fillText('AFTER — fold turns on its nose', PAD * 2 + a.width, HEAD + a.height + 12);

      return cv.toDataURL('image/png');
    },
    { before: dataUrl(`before-${view}.png`), after: dataUrl(`after-${view}.png`), caption: CAPTIONS[view] ?? view },
  );
  writeFileSync(`${OUT}/compare-${view}.png`, Buffer.from(png.split(',')[1], 'base64'));
  console.log(`wrote compare-${view}.png`);
}

await browser.close();
