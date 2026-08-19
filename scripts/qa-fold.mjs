// The storey turn, measured and photographed.
//
//   npm run dev -- --port 5178 --strictPort     # in one shell
//   node scripts/qa-fold.mjs [--out DIR] [--tag NAME] [key...]
//
// A lace that changes storey does it at a FOLD — it doubles back and the run it
// comes away on rests on the run it came off, one storey up. The fold shows that
// climb as a flat face the height of the gap it leaves, and whatever of the climb
// the face does not carry has to be walked by the runs on either side instead.
// Too little on the face and the turn reads thin and cut-off, with the runs
// tipped up on edge to make up for it.
//
// This measures the climb rather than describing it. For every merged lace it
// reads `view.laceCenterlines` — the polyline the ribbon is actually swept
// along — and reports, per fold and over the whole lace:
//
//   faceTilt   how far off vertical the fold's two end faces are tipped. The
//              sweep pitches its "up" axis with the local gradient, so this IS
//              the gradient at the crease, in degrees. Past ~30 degrees the flat
//              face of the lace is visibly on edge.
//   maxSlope   the steepest gradient anywhere on the lace, fold or not.
//   faceHeight the height of the flat face the fold turns on — the gap its two
//              runs are left at, in strand thicknesses. This is the whole of what
//              a turn shows, and it is set by FOLD_STACK in StrandScene. One is
//              the two runs touching; a fold that also climbs a storey has two
//              thicknesses of step to place and should show all of it.
//   ramped     how much of the step the crease refused and the runs had to carry
//              instead, in thicknesses. Whatever the cap turns away lands here,
//              and it is what tips the runs up either side of the turn.
//
// To compare two settings, build each with its own tag:
//
//   sed -i 's/const FOLD_STACK = 2/const FOLD_STACK = 1/' src/scene/StrandScene.ts
//   node scripts/qa-fold.mjs --tag before
//   git checkout src/scene/StrandScene.ts
//   node scripts/qa-fold.mjs --tag after
//
// and writes a PNG per view so the numbers can be checked against the picture.
// `--tag before` / `--tag after` name the files; scripts/fold-compare.mjs pairs
// them into one sheet.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = process.env.PORT ?? '5178';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const OUT = flag('out', `${ROOT}node_modules/.cache/fold`);
const TAG = flag('tag', 'now');

// The scenes worth looking at, and where to stand. Every one of them has laces
// that change storey; the framings are the ones that put a turn in the frame
// large enough to see the ribbon's own face.
// A `detail` view stands close to ONE turn instead of framing the model: the
// number of lace widths to fit across the frame, centred on the steepest fold in
// the scene. Which fold that is comes off the centreline, so two builds that
// differ only in FOLD_STACK pick the same turn and can be laid side by side.
const VIEWS = [
  { key: 'ring-2x1-k1111-lh', az: 34, el: 14, fill: 0.78, label: 'Fitted ring 2x1 — from the side' },
  { key: 'ring-2x1-k1111-lh', az: 110, el: 12, detail: 3.5, label: 'Fitted ring 2x1 — one turn' },
  { key: 'box-stitch-10', az: 34, el: 16, fill: 0.8, label: 'Box stitch, 10 levels' },
  { key: 'box-stitch-10', az: 110, el: 12, detail: 3.5, label: 'Box stitch, 10 levels — one turn' },
  { key: 'twist-stitch-10', az: 34, el: 16, fill: 0.8, label: 'Twist stitch, 10 twists' },
  { key: 'twist-stitch-10', az: 110, el: 12, detail: 4, label: 'Twist stitch — one turn' },
  { key: 'box-stitch', az: 34, el: 30, fill: 0.8, label: 'Box stitch — starting stitch' },
  { key: 'box-stitch', az: 110, el: 14, detail: 4, label: 'Box stitch — one turn' },
];
const KEYS = argv.length ? argv : null;
const shots = KEYS ? VIEWS.filter((v) => KEYS.includes(v.key)) : VIEWS;

const W = 760;
const H = 620;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('  page error:', e.message.slice(0, 300)));

const report = [];
let seen = new Set();

for (const view of shots) {
  await page.goto(`http://localhost:${PORT}/Scoubidou3D/app/?sample=${view.key}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__scoubidou?.view?.laceCenterlines?.length, null, { timeout: 60000 });
  await page.addStyleTag({
    content:
      '#toolbar,#panel,#hover-chip,#panel-toggle,.panel-toggle{display:none!important}' +
      '#scene{position:fixed;inset:0;width:100vw!important;height:100vh!important}',
  });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(250);

  // ---- the numbers ---------------------------------------------------------
  if (!seen.has(view.key)) {
    seen.add(view.key);
    const stats = await page.evaluate(() => {
      const FOLD = Math.PI / 3;
      const turnAt = (p, i) => {
        const ax = p[i].x - p[i - 1].x;
        const ay = p[i].y - p[i - 1].y;
        const bx = p[i + 1].x - p[i].x;
        const by = p[i + 1].y - p[i].y;
        const la = Math.hypot(ax, ay);
        const lb = Math.hypot(bx, by);
        if (la < 1e-9 || lb < 1e-9) return 0;
        return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
      };
      const deg = (r) => (r * 180) / Math.PI;
      const out = {
        laces: 0,
        folds: 0,
        worstFaceTilt: 0,
        worstMaxSlope: 0,
        worstCreaseStep: 0,
        overTilt: 0,
        steep: 0,
        samples: 0,
        minFace: Infinity,
        meanFace: 0,
        worstRamped: 0,
        meanRamped: 0,
      };

      for (const L of window.__scoubidou.view.laceCenterlines) {
        const P = L.line;
        out.laces++;
        for (let i = 1; i < P.length; i++) {
          const run = Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
          if (run < 1e-9) continue;
          const s = Math.abs((P[i].z - P[i - 1].z) / run);
          out.samples++;
          if (s > 1) out.steep++;
          if (s > out.worstMaxSlope) out.worstMaxSlope = s;
        }
        for (let i = 1; i < P.length - 1; i++) {
          if (turnAt(P, i) < FOLD) continue;
          out.folds++;
          const zIn = P[i].zIn ?? P[i].z;
          const zOut = P[i].zOut ?? P[i].z;
          const runIn = Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
          const runOut = Math.hypot(P[i + 1].x - P[i].x, P[i + 1].y - P[i].y);
          const sIn = runIn < 1e-9 ? 0 : (zIn - P[i - 1].z) / runIn;
          const sOut = runOut < 1e-9 ? 0 : (P[i + 1].z - zOut) / runOut;
          const tilt = deg(Math.atan(Math.abs((sIn + sOut) / 2)));
          if (tilt > out.worstFaceTilt) out.worstFaceTilt = tilt;
          if (tilt > 30) out.overTilt++;
          const face = Math.abs(zOut - zIn) / L.thickness;
          if (face > out.worstCreaseStep) out.worstCreaseStep = face;
          if (face < out.minFace) out.minFace = face;
          out.meanFace += face;

          // What the crease turned away, and the runs on either side had to walk
          // instead. The step the lace really makes here is the height difference
          // between the two runs clear of the fold, so anything of it the face is
          // not showing is being ramped.
          const step = Math.abs(P[i + 1].z - P[i - 1].z) / L.thickness;
          const ramped = Math.max(0, step - face);
          if (ramped > out.worstRamped) out.worstRamped = ramped;
          out.meanRamped += ramped;
        }
      }
      out.meanFace = out.folds ? out.meanFace / out.folds : 0;
      out.meanRamped = out.folds ? out.meanRamped / out.folds : 0;
      if (!isFinite(out.minFace)) out.minFace = 0;
      return out;
    });
    report.push({ key: view.key, ...stats });
  }

  // ---- the picture ---------------------------------------------------------
  const png = await page.evaluate(
    async ({ az, el, fill, detail }) => {
      const { view } = window.__scoubidou;
      view.setTheme('dark');
      const cam = view.camera;
      const V = cam.position.constructor;
      cam.fov = 45;
      cam.updateProjectionMatrix();

      const stand = (target, dist) => {
        const a = (az * Math.PI) / 180;
        const e = (el * Math.PI) / 180;
        cam.position.set(
          target.x + dist * Math.cos(e) * Math.sin(a),
          target.y - dist * Math.cos(e) * Math.cos(a),
          target.z + dist * Math.sin(e),
        );
        view.controls.target.copy(target);
        cam.lookAt(target);
        view.controls.update();
        view.renderer.render(view.scene, cam);
      };
      const shoot = async () => {
        await new Promise((res) => requestAnimationFrame(res));
        view.renderer.render(view.scene, cam);
        return view.renderer.domElement.toDataURL('image/png');
      };

      if (detail) {
        // The middle fold of the first lace. Deliberately NOT the steepest one:
        // steepness is read off Z, and Z is the thing under test, so the steepest
        // fold moves between builds and two panels of a comparison would be of
        // different turns. Every build has the same laces with the same folds in
        // the same order, so an ordinal picks the same turn every time.
        const FOLD = Math.PI / 3;
        const turnAt = (p, i) => {
          const ax = p[i].x - p[i - 1].x;
          const ay = p[i].y - p[i - 1].y;
          const bx = p[i + 1].x - p[i].x;
          const by = p[i + 1].y - p[i].y;
          const la = Math.hypot(ax, ay);
          const lb = Math.hypot(bx, by);
          if (la < 1e-9 || lb < 1e-9) return 0;
          return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
        };
        const L = view.laceCenterlines[0];
        const P = L.line;
        const folds = [];
        for (let i = 1; i < P.length - 1; i++) if (turnAt(P, i) >= FOLD) folds.push(i);
        const best = { p: P[folds[folds.length >> 1]], w: L.width };
        const c = new V(best.p.x, best.p.y, best.p.z);
        stand(c, (best.w * detail) / (2 * Math.tan((cam.fov * Math.PI) / 360)));
        return shoot();
      }

      const pts = [];
      view.scene.traverse((o) => {
        if (!o.isMesh || o.type === 'GridHelper' || !o.visible) return;
        for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
        const pos = o.geometry?.attributes?.position;
        if (!pos) return;
        o.updateWorldMatrix(true, false);
        for (let i = 0; i < pos.count; i += 5) {
          pts.push(new V(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld));
        }
      });
      const lo = pts[0].clone();
      const hi = pts[0].clone();
      for (const p of pts) {
        lo.min(p);
        hi.max(p);
      }
      const c = lo.clone().add(hi).multiplyScalar(0.5);
      const r = hi.distanceTo(lo) / 2;
      stand(c, r / Math.sin((cam.fov * Math.PI) / 360) / fill);
      return shoot();
    },
    view,
  );
  const name = `${view.key}-${view.az}-${view.el}`;
  writeFileSync(`${OUT}/${TAG}-${name}.png`, Buffer.from(png.split(',')[1], 'base64'));
  console.log(`shot ${TAG}-${name}.png`);
}

await browser.close();

console.log('');
console.log(`${TAG}: the storey turn, per scene`);
console.log('  scene                     folds  faceHeight min/mean  ramped max/mean  faceTilt  folds>30deg');
for (const r of report) {
  console.log(
    `  ${r.key.padEnd(24)} ${String(r.folds).padStart(5)}` +
      `  ${r.minFace.toFixed(2).padStart(10)}/${r.meanFace.toFixed(2)}` +
      `  ${r.worstRamped.toFixed(2).padStart(10)}/${r.meanRamped.toFixed(2)}` +
      `  ${r.worstFaceTilt.toFixed(1).padStart(8)}` +
      `  ${String(r.overTilt).padStart(11)}`,
  );
}
writeFileSync(`${OUT}/${TAG}.json`, `${JSON.stringify(report, null, 2)}\n`);
