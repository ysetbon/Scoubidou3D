// The project site's sample pictures, shot from the running app.
//
// site/art/*.svg is a flat projection of a scene's centerlines — honest about
// the coordinates, but it is a drawing, and a drawing cannot show the one thing
// this project is about: that a strand has thickness and a crossing is a real
// lift and dip you can orbit around. So the cards on the landing page use these
// instead — the app's own WebGL canvas, framed and captured, grid and all.
//
//   npm run dev -- --port 5178 --strictPort     # in one shell
//   node scripts/site-shots.mjs [key...]        # in another; no keys = all 13
//
// Two files per sample, one per canvas skin, because the page has two themes and
// a cream canvas dropped into the dark theme is a hole in the page:
//
//   site/shots/<key>-light.webp    on #f5efdf, the light paper
//   site/shots/<key>-dark.webp     on #191410, the dark paper
//
// Those two backgrounds are exactly the site's own --cream in each theme (see
// PALETTE in src/scene/StrandScene.ts against the tokens in site/site.css), so a
// shot sits on the page without a seam.
//
// Needs the dev server: window.__scoubidou, the handle this drives, is stripped
// from production builds.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = process.env.PORT ?? '5178';
const OUT = 'site/shots';

// Framing, per sample. `az` is the compass bearing in degrees, `el` the
// elevation above the weave plane, `fill` how much of the frame the model's
// projected extent should take, and `fov` the lens.
//
// A flat mat wants to be looked down on — from low down its own crossings hide
// each other. A column wants the opposite: the whole point of it is that it is
// tall, and an eye-level view is where you can count the rounds. So the two
// families get different cameras rather than one compromise that flatters
// neither.
//
// The braids get a long lens as well as a high camera. They are strips several
// times longer than they are wide, and on the app's own 45 degree lens — fine
// for something you are orbiting — a strip that long has its near end towering
// over its far end, which reads as a mistake rather than as perspective.
const FLAT = { az: 34, el: 46, fill: 0.9 };
const COLUMN = { az: 34, el: 21, fill: 0.86 };
const BRAID = { az: 42, el: 52, fill: 0.94, fov: 22 };

const SHOTS = {
  'two-crossing': { az: 30, el: 40, fill: 0.82 },
  'box-stitch': { az: 34, el: 42, fill: 0.88 },
  'woven-mat': FLAT,
  'braid-3': BRAID,
  'box-stitch-10': COLUMN,
  diagonal: FLAT,
  'curved-stack': { az: 34, el: 38, fill: 0.88 },
  'round-stitch-10': COLUMN,
  'braid-4': BRAID,
  'box-stitch-15': COLUMN,
  'twist-stitch-10': COLUMN,
  // The two-fan columns, not the older twist-MxN family they superseded: same
  // face, same strand and mask counts, but derived from the reference stitch
  // rather than idealised, and it is the derived one the app now opens.
  'twofan-col-lh-1x3-10': COLUMN,
  'twofan-col-lh-2x2-10': COLUMN,
  // The box on a face wider than a square. Flat framing: a single round is a mat,
  // not a column, and the whole point of it is the checkerboard read from above.
  'box-lh-3x2': FLAT,
  'box-lh-5x5': FLAT,
};

const KEYS = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);

// 2x the ~380px the card is at a desktop width, so the picture is still crisp on
// a retina screen. The aspect matches .projectArt's own 1.08.
const W = 780;
const H = 722;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('  page error:', e.message.slice(0, 200)));

for (const key of KEYS) {
  const framing = SHOTS[key];
  if (!framing) {
    console.log(`skip ${key} — no framing defined`);
    continue;
  }

  await page.goto(`http://localhost:${PORT}/Scoubidou3D/app/?sample=${key}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__scoubidou, null, { timeout: 60000 });
  // Strip the UI: the picture is of the weave, not of the editor around it.
  await page.addStyleTag({
    content:
      '#toolbar,#panel,#hover-chip,#panel-toggle,.panel-toggle{display:none!important}' +
      '#scene{position:fixed;inset:0;width:100vw!important;height:100vh!important}',
  });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(500);

  for (const theme of ['light', 'dark']) {
    const data = await page.evaluate(
      async ({ framing, theme }) => {
        const { view } = window.__scoubidou;
        view.setTheme(theme);

        const cam = view.camera;
        const V = cam.position.constructor;
        cam.fov = framing.fov ?? 45; // 45 is the app's own lens
        cam.updateProjectionMatrix();

        // World-space points off the ribbons themselves — every 9th vertex, which
        // on geometry this dense still lands on every cap and every crossing.
        //
        // Framing against the bounding BOX instead would frame air: a box round a
        // tipped column has corners nothing occupies, and they project further out
        // than any part of the model, so the stitch comes out small and off
        // centre. The grid is excluded for the same reason — it is built 2x the
        // content wide, and fitting it would put every model in the far distance.
        const pts = [];
        view.scene.traverse((o) => {
          if (!o.isMesh || o.type === 'GridHelper' || !o.visible) return;
          for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
          const pos = o.geometry?.attributes?.position;
          if (!pos) return;
          o.updateWorldMatrix(true, false);
          for (let i = 0; i < pos.count; i += 9) {
            pts.push(new V(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld));
          }
        });
        if (!pts.length) throw new Error('nothing to frame');

        const lo = pts[0].clone();
        const hi = pts[0].clone();
        for (const p of pts) {
          lo.min(p);
          hi.max(p);
        }
        const target = lo.clone().add(hi).multiplyScalar(0.5);

        const az = (framing.az * Math.PI) / 180;
        const el = (framing.el * Math.PI) / 180;
        const dir = new V(Math.cos(el) * Math.sin(az), -Math.cos(el) * Math.cos(az), Math.sin(el));

        // Frame by measurement, not by formula. Place the camera, project the
        // model, read off how much of the frame it takes and how far off centre it
        // sits, then correct both — and repeat, because in perspective the answer
        // moves when the camera does. Four passes settles it to under a pixel.
        let dist = hi.distanceTo(lo) * 1.3;
        for (let pass = 0; pass < 5; pass++) {
          cam.position.copy(dir).multiplyScalar(dist).add(target);
          cam.near = Math.max(0.01, dist / 200);
          cam.far = dist * 40;
          view.controls.target.copy(target);
          cam.updateProjectionMatrix();
          view.controls.update();
          cam.updateMatrixWorld();

          let x0 = Infinity;
          let y0 = Infinity;
          let x1 = -Infinity;
          let y1 = -Infinity;
          for (const p of pts) {
            const q = p.clone().project(cam);
            x0 = Math.min(x0, q.x);
            x1 = Math.max(x1, q.x);
            y0 = Math.min(y0, q.y);
            y1 = Math.max(y1, q.y);
          }
          const ext = Math.max(x1 - x0, y1 - y0) / 2;
          if (!isFinite(ext) || ext <= 0) break;

          // Pan the aim point by whatever the model is off centre. A screen
          // offset in NDC is a world offset of that fraction of the frustum's
          // half-extent at the target's depth, along the camera's own axes.
          const halfH = dist * Math.tan((cam.fov * Math.PI) / 360);
          const right = new V().setFromMatrixColumn(cam.matrixWorld, 0);
          const up = new V().setFromMatrixColumn(cam.matrixWorld, 1);
          target
            .add(right.multiplyScalar(((x0 + x1) / 2) * halfH * cam.aspect))
            .add(up.multiplyScalar(((y0 + y1) / 2) * halfH));
          dist *= ext / framing.fill;
        }

        // Render this frame ourselves, then read the canvas back before the
        // browser composites and clears it — the renderer is not asked to
        // preserve its drawing buffer, so a later toDataURL comes back blank.
        view.renderer.render(view.scene, view.camera);
        return view.renderer.domElement.toDataURL('image/webp', 0.9);
      },
      { framing, theme },
    );

    const b64 = data.slice(data.indexOf(',') + 1);
    const buf = Buffer.from(b64, 'base64');
    writeFileSync(`${OUT}/${key}-${theme}.webp`, buf);
    console.log(`  ${key}-${theme}.webp  ${(buf.length / 1024).toFixed(0)} kB`);
  }
}

await browser.close();
console.log(`\n${KEYS.length} samples x 2 themes written to ${OUT}/`);
