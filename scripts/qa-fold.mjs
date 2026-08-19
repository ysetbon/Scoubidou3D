// The storey turn, measured and photographed.
//
//   npm run dev -- --port 5178 --strictPort     # in one shell
//   node scripts/qa-fold.mjs [--out DIR] [--tag NAME] [key...]
//
// A lace that changes storey does it at a FOLD — it doubles back and the run it
// comes away on rests on the run it came off, one storey up. That climb is the
// hardest thing the sweep is asked to draw, and when it is crammed into too
// little run the ribbon stands on its edge and the turn reads as a flat tab
// stuck on the side of the model rather than as a bight.
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
//   creaseStep the height the two faces are apart at the crease itself. One
//              thickness is right — that is the returning run lying on the run
//              it came off. More than that is a cliff.
//   noseReach  how far the SURFACE gets past the crease, on the outside of the
//              turn, as a fraction of the gap the two faces leave. Zero is a flat
//              wall — the square-cut block a fold used to come out as. Half is
//              the half-round a lace really turns on (`noseOf` in ribbon.ts).
//              This one is read off the built mesh, not off the centreline: it is
//              the whole of what the nose changed, and the centreline is
//              identical either way.
//
// To measure the fold as it was before the nose, build with it switched off:
//
//   sed -i 's/opts.noseSteps ?? 6/opts.noseSteps ?? 0/' src/geometry/ribbon.ts
//   node scripts/qa-fold.mjs --tag before
//   git checkout src/geometry/ribbon.ts
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
// the scene. Which fold that is comes off the centreline, which the nose does not
// touch — so the before and after shots of a detail are of the same turn from the
// same spot, and can be laid side by side.
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
        minNoseReach: Infinity,
        meanNoseReach: 0,
        flatFolds: 0,
      };

      // Every body vertex in the scene, in world space, for the nose measurement.
      // The outline shell is skipped: it has no nose by design (openFolds), and a
      // shell vertex would answer for a surface the eye never sees.
      const V = window.__scoubidou.view.camera.position.constructor;
      const verts = [];
      for (const group of window.__scoubidou.view.strandGroup.children) {
        const mesh = group.isMesh ? group : group.children?.[0];
        const pos = mesh?.geometry?.attributes?.position;
        if (!pos) continue;
        mesh.updateWorldMatrix(true, false);
        for (let i = 0; i < pos.count; i++) {
          verts.push(new V(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld));
        }
      }

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
          const gap = Math.abs(zOut - zIn);
          const step = gap / L.thickness;
          if (step > out.worstCreaseStep) out.worstCreaseStep = step;

          // How far the surface gets past the crease, on the outside of the turn.
          // `din - dout` is the way the lace would have carried on had it not
          // doubled back, which is the direction the nose bulges into. Only
          // vertices within a ball round the crease are asked, so the runs
          // leading up to it cannot answer for the turn itself.
          const din = { x: P[i].x - P[i - 1].x, y: P[i].y - P[i - 1].y };
          const dout = { x: P[i + 1].x - P[i].x, y: P[i + 1].y - P[i].y };
          const dl = Math.hypot(din.x, din.y) || 1;
          const ol = Math.hypot(dout.x, dout.y) || 1;
          let nx = din.x / dl - dout.x / ol;
          let ny = din.y / dl - dout.y / ol;
          const nl = Math.hypot(nx, ny);
          if (nl < 1e-9 || gap < 1e-9) continue;
          nx /= nl;
          ny /= nl;
          const ball = L.width * 0.75;
          let reach = 0;
          for (const v of verts) {
            const dx = v.x - P[i].x;
            const dy = v.y - P[i].y;
            const dz = v.z - P[i].z;
            if (dx * dx + dy * dy + dz * dz > ball * ball) continue;
            const along = dx * nx + dy * ny;
            if (along > reach) reach = along;
          }
          const rel = reach / gap;
          out.meanNoseReach += rel;
          if (rel < out.minNoseReach) out.minNoseReach = rel;
          if (rel < 0.25) out.flatFolds++;
        }
      }
      out.meanNoseReach = out.folds ? out.meanNoseReach / out.folds : 0;
      if (!isFinite(out.minNoseReach)) out.minNoseReach = 0;
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
        // The steepest fold in the scene, ties going to the first one found.
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
        let best = null;
        let worst = -1;
        for (const L of view.laceCenterlines) {
          const P = L.line;
          for (let i = 1; i < P.length - 1; i++) {
            if (turnAt(P, i) < FOLD) continue;
            const zIn = P[i].zIn ?? P[i].z;
            const zOut = P[i].zOut ?? P[i].z;
            const rIn = Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
            const rOut = Math.hypot(P[i + 1].x - P[i].x, P[i + 1].y - P[i].y);
            const s = Math.abs(((zIn - P[i - 1].z) / rIn + (P[i + 1].z - zOut) / rOut) / 2);
            if (s > worst) {
              worst = s;
              best = { p: P[i], w: L.width };
            }
          }
        }
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
console.log('  scene                     folds  noseReach min/mean  flat folds  faceTilt  creaseStep');
for (const r of report) {
  console.log(
    `  ${r.key.padEnd(24)} ${String(r.folds).padStart(5)}` +
      `  ${r.minNoseReach.toFixed(3).padStart(9)}/${r.meanNoseReach.toFixed(3)}` +
      `  ${String(r.flatFolds).padStart(10)}` +
      `  ${r.worstFaceTilt.toFixed(1).padStart(8)}` +
      `  ${r.worstCreaseStep.toFixed(2).padStart(10)}`,
  );
}
writeFileSync(`${OUT}/${TAG}.json`, `${JSON.stringify(report, null, 2)}\n`);
