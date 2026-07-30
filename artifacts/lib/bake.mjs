// Pull the app's OWN built meshes out of a headless studio.
//
// The point of baking rather than re-deriving is that an artifact then shows what
// the app shows: the same ribbon sweep, the same weave, the same fold creases and
// outline shells, down to the vertex. If the geometry in the page is wrong, the
// geometry in the app is wrong — there is no second implementation to disagree.
//
// Needs the dev server (window.__scoubidou is stripped from production builds);
// artifacts/build.mjs starts one if there isn't one already.
import { readFileSync, readdirSync } from 'node:fs';

/** Playwright is not a dependency of this repo — it comes with the environment.
 *  PLAYWRIGHT_MODULE overrides the lookup when it lives somewhere unusual. */
async function playwright() {
  const tries = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    'playwright-core',
    '/opt/node22/lib/node_modules/playwright/index.mjs',
  ].filter(Boolean);
  for (const spec of tries) {
    try {
      return await import(spec);
    } catch {
      /* next */
    }
  }
  throw new Error(
    'playwright not found. Install it, or set PLAYWRIGHT_MODULE to its entry point.',
  );
}

/**
 * Load every scene in `scenesDir` and return its meshes as transferable arrays.
 * Positions are baked to world space; everything else the renderer needs to look
 * the same — colour, which side of the shell shows, the outline's render order —
 * comes along with them.
 */
export async function bake(scenesDir, { url, viewport = { width: 900, height: 800 } } = {}) {
  const { chromium } = await playwright();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--use-angle=swiftshader'],
  });
  try {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${url}/app/?sample=two-crossing`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__scoubidou, null, { timeout: 60000 });

    const out = {};
    for (const file of readdirSync(scenesDir).filter((f) => f.endsWith('.json')).sort()) {
      const level = file.replace(/\.json$/, '');
      await page.evaluate(
        (j) => window.__scoubidou.view.setScene(JSON.parse(j), true),
        readFileSync(`${scenesDir}/${file}`, 'utf8'),
      );
      await page.waitForTimeout(700);
      out[level] = await page.evaluate(() => {
        const view = window.__scoubidou.view;
        const parts = [];
        view.strandGroup.traverse((o) => {
          if (!o.isMesh) return;
          const pos = o.geometry.getAttribute('position');
          const index = o.geometry.getIndex();
          o.updateWorldMatrix(true, false);
          const m = o.matrixWorld.elements;
          const p = new Float32Array(pos.count * 3);
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            p[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
            p[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
            p[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          }
          const b64 = (buf) => {
            const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
            let s = '';
            for (let i = 0; i < bytes.length; i += 8192) {
              s += String.fromCharCode(...bytes.subarray(i, i + 8192));
            }
            return btoa(s);
          };
          parts.push({
            pos: b64(p),
            idx: b64(Uint32Array.from(index.array)),
            color: '#' + o.material.color.getHexString(),
            side: o.material.side,
            basic: !!o.material.isMeshBasicMaterial,
            polygonOffset: !!o.material.polygonOffset,
            outline: o.renderOrder === -1,
          });
        });
        return { parts };
      });
    }
    if (errors.length) throw new Error(`the studio threw while baking: ${errors[0]}`);
    return out;
  } finally {
    await browser.close();
  }
}
