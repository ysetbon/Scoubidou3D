// Top and orbit views of a column at EVERY level, from the app's own 3D view.
//
// A column's levels are not alike -- the top one is the only place the arms are
// never folded again -- so a per-level contact sheet is how you see what a turn
// actually does to the weave as it stacks.
//
//   npm run dev -- --port 5181 --strictPort
//   node scripts/level-shots.mjs <dir-of-Lnn.json> <out-dir>
//   python3 scripts/orbit-sheet.py
//
// Input is one scene per level, named L00.json .. L10.json: build them by
// truncating twoFanColumn's strand list at each entry of levelBreaks. Needs the
// dev server -- window.__scoubidou is stripped from production builds.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
const DIR = process.argv[2], OUT = process.argv[3];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 820, height: 760 } });
page.on('pageerror', (e) => console.log('ERR', e.message.slice(0,200)));
await page.goto('http://localhost:5181/Scoubidou3D/app/?sample=two-crossing', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__scoubidou, null, { timeout: 60000 });
await page.addStyleTag({ content: '#toolbar,#panel,#hover-chip,#panel-toggle{display:none!important}' +
  '#scene{position:fixed;inset:0;width:100vw!important;height:100vh!important}' });
await page.evaluate(() => window.dispatchEvent(new Event('resize')));
for (let L = 0; L <= 10; L++) {
  const json = readFileSync(`${DIR}/L${String(L).padStart(2,'0')}.json`, 'utf8');
  await page.evaluate((j) => { window.__scoubidou.view.setScene(JSON.parse(j), true); }, json);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__scoubidou.view.topView());
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/L${String(L).padStart(2,'0')}-top.png` });
  await page.evaluate(() => {
    const v = window.__scoubidou.view; v.fitView();
    const d = v.camera.position.length(), el = 26 * Math.PI/180, az = 35 * Math.PI/180;
    v.camera.position.set(d*Math.cos(el)*Math.sin(az), -d*Math.cos(el)*Math.cos(az), d*Math.sin(el));
    v.controls.target.set(0,0,0); v.controls.update();
  });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/L${String(L).padStart(2,'0')}-orb.png` });
  console.log('level', L);
}
await browser.close();
