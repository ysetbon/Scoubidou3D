// Top and orbit views of every column at EVERY level, from the app's own 3D view.
//
// A column's levels are not alike -- the top one is the only place the arms are
// never folded again -- so a per-level contact sheet is how you see what a turn
// actually does to the weave as it stacks.
//
//   npm run levels                 scenes -> shots -> page, all 64 faces
//   node scripts/level-shots.mjs <scenes-root> <out-root> [face]
//
// `scenes-root` holds one folder per face (`1x5/`) of `L00.json` .. `L10.json`, as
// `scripts/level-scenes.ts` leaves them; `out-root` gets the same shape in PNGs,
// which is what `scripts/build-levels.py` reads. Needs the dev server --
// window.__scoubidou is stripped from production builds -- and starts one itself
// if nothing answers on the port.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const SCENES = process.argv[2] ?? 'node_modules/.cache/levels/scenes';
const OUT = process.argv[3] ?? 'node_modules/.cache/levels/renders';
const ONLY = process.argv[4];
const PORT = Number(process.env.LEVELS_PORT ?? 5181);
const URL = `http://localhost:${PORT}/Scoubidou3D`;

if (!existsSync(SCENES)) {
  console.error(`no scenes at ${SCENES} — run scripts/level-scenes.ts first`);
  process.exit(1);
}

const reachable = async () => {
  try {
    return (await fetch(`${URL}/app/`)).ok;
  } catch {
    return false;
  }
};

async function serve() {
  if (await reachable()) return null;
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    env: { ...process.env, BROWSER: 'none' },
  });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await reachable()) return child;
  }
  child.kill();
  throw new Error(`vite did not come up on :${PORT}`);
}

async function playwright() {
  for (const spec of [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    'playwright-core',
    '/opt/node22/lib/node_modules/playwright/index.mjs',
  ].filter(Boolean)) {
    try {
      return await import(spec);
    } catch {
      /* next */
    }
  }
  throw new Error('playwright not found. Set PLAYWRIGHT_MODULE to its entry point.');
}

const server = await serve();
const { chromium } = await playwright();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', '--use-angle=swiftshader'],
});
// Big enough that the crop lands over build-levels.py's 800 px long side with
// room to spare (it trims to the model, ~0.83 of the short dimension), so the
// published picture is a DOWNsample rather than a stretch.
const page = await browser.newPage({ viewport: { width: 1180, height: 1100 } });
page.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 200)));
await page.goto(`${URL}/app/?sample=two-crossing`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__scoubidou, null, { timeout: 60000 });
// Everything but the canvas: the panel, the toolbar and the floating docks are
// all children of #app or of <body>, and build-levels.py's crop reads any
// saturated or near-black pixel as model, so a stray pill widens every picture.
await page.addStyleTag({
  content:
    '#app > *:not(#scene), body > *:not(#app){display:none!important}' +
    '#scene{position:fixed;inset:0;width:100vw!important;height:100vh!important}',
});
await page.evaluate(() => window.dispatchEvent(new Event('resize')));

// Take the wheel. The studio renders every frame forever, which on a software
// GPU is ~220 ms of work between every instruction we send it, and none of those
// frames end up in a picture. Starving the loop of requestAnimationFrame stops
// it dead; from here nothing draws until `shoot` asks for it. Damping goes with
// it — it is a per-frame ease, and there are no frames now, so `controls.update`
// has to land the camera in one call.
await page.evaluate(() => {
  window.requestAnimationFrame = () => 0;
  window.__scoubidou.view.controls.enableDamping = false;
});

// Read the canvas rather than photographing the page. `page.screenshot` waits for
// the whole page to settle, and a 3D view never does — it is redrawing every
// frame — so a full-resolution sheet ran to hours. Rendering and reading in ONE
// task keeps the drawing buffer valid without asking for preserveDrawingBuffer,
// and what comes back is only ever the canvas, chrome or no chrome.
const shoot = async (path) => {
  const url = await page.evaluate(() => {
    const v = window.__scoubidou.view;
    v.renderer.render(v.scene, v.camera);
    return v.renderer.domElement.toDataURL('image/png');
  });
  writeFileSync(path, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
};

const faces = readdirSync(SCENES).filter((f) => !ONLY || f === ONLY).sort();
const started = Date.now();
let shots = 0;
for (const face of faces) {
  mkdirSync(`${OUT}/${face}`, { recursive: true });
  for (const file of readdirSync(`${SCENES}/${face}`).filter((f) => f.endsWith('.json')).sort()) {
    const tag = file.replace(/\.json$/, '');
    await page.evaluate(
      (j) => window.__scoubidou.view.setScene(JSON.parse(j), true),
      readFileSync(`${SCENES}/${face}/${file}`, 'utf8'),
    );
    await page.evaluate(() => window.__scoubidou.view.topView());
    await shoot(`${OUT}/${face}/${tag}-top.png`);
    await page.evaluate(() => {
      const v = window.__scoubidou.view;
      v.fitView();
      const d = v.camera.position.length();
      const el = (26 * Math.PI) / 180;
      const az = (35 * Math.PI) / 180;
      v.camera.position.set(
        d * Math.cos(el) * Math.sin(az),
        -d * Math.cos(el) * Math.cos(az),
        d * Math.sin(el),
      );
      v.controls.target.set(0, 0, 0);
      v.controls.update();
    });
    await shoot(`${OUT}/${face}/${tag}-orb.png`);
    shots += 2;
  }
  const mins = (Date.now() - started) / 60000;
  console.log(
    `${face.padEnd(4)} done  (${faces.indexOf(face) + 1}/${faces.length}, ` +
      `${shots} shots, ${mins.toFixed(1)} min)`,
  );
}
await browser.close();
if (server) server.kill();
