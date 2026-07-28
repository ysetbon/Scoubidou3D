// Orbit and top views of a scene, shot from the real app rather than redrawn.
//
// The thumbnails in site/art are a flat projection; these are the 3D view the
// app actually renders, so what you see is what the geometry is.
//
//   npm run dev -- --port 5178 --strictPort      # in one shell
//   node scripts/orbit-shots.mjs <sample-key>...  # in another
//   python3 scripts/orbit-sheet.py                # lays them out as contact sheets
//
// Five views per scene: four orbits 90 degrees apart at a 32 degree elevation,
// and one straight down. Needs the dev server -- window.__scoubidou, the handle
// this drives, is stripped from production builds.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const SHAPES = process.argv.slice(2);
const OUT = 'orbit';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 780 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('  page error:', e.message));

for (const key of SHAPES) {
  await page.goto(`http://localhost:5178/Scoubidou3D/app/?sample=${key}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__scoubidou, null, { timeout: 60000 });
  // strip the UI so the shot is only the model
  await page.addStyleTag({
    content: '#toolbar,#panel,#hover-chip,#panel-toggle,.panel-toggle{display:none!important}' +
             '#scene{position:fixed;inset:0;width:100vw!important;height:100vh!important}',
  });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(600);

  const views = [
    ['a', 'orbit 0'], ['b', 'orbit 90'], ['c', 'orbit 180'], ['d', 'orbit 270'], ['top', 'top'],
  ];
  for (const [tag] of views) {
    await page.evaluate((t) => {
      const { view } = window.__scoubidou;
      const c = view.controls;
      if (t === 'top') { view.topView(); return; }
      view.fitView();
      const az = { a: 0, b: 90, c: 180, d: 270 }[t] * Math.PI / 180;
      const d = view.camera.position.length();
      const el = 32 * Math.PI / 180;              // a low, readable elevation
      view.camera.position.set(
        d * Math.cos(el) * Math.sin(az), -d * Math.cos(el) * Math.cos(az), d * Math.sin(el));
      c.target.set(0, 0, 0);
      c.update();
    }, tag);
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}/${key}-${tag}.png` });
  }
  console.log('shot', key);
}
await browser.close();
