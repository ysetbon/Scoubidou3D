// The project's icon, shot from the running app.
//
// The favicon is not a drawing of a scoubidou — it IS one: the starting box
// stitch of scripts/icon-scene.json, rendered by the app's own WebGL canvas
// with the grid off and the paper knocked out, so what lands in the browser tab
// is the weave itself on transparency rather than a tile of cream with a weave
// inside it.
//
//   npm run dev -- --port 5178 --strictPort   # in one shell
//   node scripts/icon-shot.mjs                # in another
//
// Writes the sizes an icon actually gets asked for — public/icon-512.png and
// icon-192.png for install prompts and Android, icon-180.png for iOS' home
// screen, icon-32.png for the tab — plus public/favicon.ico carrying 16, 32 and
// 48 for the places that still ask for that file by name.
//
// Everything is rendered once at MASTER px and stepped down by halves, because
// a browser's own one-shot downscale of a 2048px render to 16px throws away the
// black outlines that are the only thing keeping the strands apart at that size.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const PORT = process.env.PORT ?? '5178';
const OUT = process.env.OUT ?? 'public';
// The scene the icon is of, as a saved .json — the four-fold starting stitch
// with its arms trimmed back to stubs. Trimmed because an icon is a square and
// the app's own sample runs its arms right off to the edge of the canvas, which
// in a square frame shrinks the knot in the middle to nothing.
const SCENE = process.env.SCENE ?? 'scripts/icon-scene.json';
const MASTER = 2048;
// Written as their own files…
const PNGS = [512, 192, 180, 32];
// …and packed into favicon.ico, which is a container of PNGs and nothing more.
const ICO = [48, 32, 16];
const SIZES = [...new Set([...PNGS, ...ICO])];

// A flat stitch wants to be looked down on — from low down its own crossings
// hide each other, and the over/under that the whole project is about is the one
// thing the icon has to show. High, but not straight overhead: some tilt is what
// gives the ribbons a visible thickness rather than four flat bars.
const AZ = Number(process.env.AZ ?? 34);
const EL = Number(process.env.EL ?? 55);
// How much of the frame the model's projected extent takes, on its wider axis.
const FILL = Number(process.env.FILL ?? 0.9);
const FOV = Number(process.env.FOV ?? 30);

mkdirSync(OUT, { recursive: true });

const sceneText = readFileSync(SCENE, 'utf8');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: 1024, height: 1024 },
  deviceScaleFactor: 1,
});
page.on('pageerror', (e) => console.log('  page error:', e.message.slice(0, 200)));

await page.goto(`http://localhost:${PORT}/Scoubidou3D/app/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__scoubidou, null, { timeout: 60000 });
await page.addStyleTag({
  content:
    '#toolbar,#panel,#hover-chip,#panel-toggle,.panel-toggle{display:none!important}' +
    '#scene{position:fixed;inset:0;width:100vw!important;height:100vh!important}',
});
await page.evaluate(() => window.dispatchEvent(new Event('resize')));
await page.waitForTimeout(500);

const shots = await page.evaluate(
  async ({ az, el, fill, fov, master, sizes, sceneText }) => {
    const { view } = window.__scoubidou;
    // The saved scene, read by the app's own loader — same path a dropped file
    // takes, so the icon is of exactly what the .json says and not of a sample
    // that happens to look like it. Only the dev server can hand us the module;
    // the handle this whole script drives is dev-only anyway.
    const { parseSceneText } = await import('/Scoubidou3D/src/model/sceneIO.ts');
    view.setScene(parseSceneText(sceneText, 'icon'), false);

    // Grid off and paper gone — this is what makes the PNG a cut-out. Square
    // ends rather than round: the open end of a ribbon shows its thickness, and
    // thickness is the thing this project has that a flat drawing does not.
    view.setParams({ showGrid: false, roundCaps: false });
    view.scene.background = null;

    const cam = view.camera;
    const V = cam.position.constructor;
    cam.fov = fov;
    cam.aspect = 1;
    cam.updateProjectionMatrix();

    // Frame against points off the ribbons themselves, not a bounding box: a box
    // round a tipped stitch has corners nothing occupies, and fitting those puts
    // the weave small and off centre.
    const pts = [];
    view.scene.traverse((o) => {
      if (!o.isMesh || o.type === 'GridHelper' || !o.visible) return;
      for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
      const pos = o.geometry?.attributes?.position;
      if (!pos) return;
      o.updateWorldMatrix(true, false);
      for (let i = 0; i < pos.count; i += 3) {
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

    const azr = (az * Math.PI) / 180;
    const elr = (el * Math.PI) / 180;
    const dir = new V(Math.cos(elr) * Math.sin(azr), -Math.cos(elr) * Math.cos(azr), Math.sin(elr));

    // Place, project, measure, correct — repeat, because in perspective the
    // answer moves when the camera does.
    let dist = hi.distanceTo(lo) * 1.3;
    for (let pass = 0; pass < 6; pass++) {
      cam.position.copy(dir).multiplyScalar(dist).add(target);
      cam.near = Math.max(0.01, dist / 200);
      cam.far = dist * 40;
      cam.updateProjectionMatrix();
      cam.lookAt(target);
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

      const halfH = dist * Math.tan((cam.fov * Math.PI) / 360);
      const right = new V().setFromMatrixColumn(cam.matrixWorld, 0);
      const up = new V().setFromMatrixColumn(cam.matrixWorld, 1);
      target
        .add(right.multiplyScalar(((x0 + x1) / 2) * halfH * cam.aspect))
        .add(up.multiplyScalar(((y0 + y1) / 2) * halfH));
      dist *= ext / fill;
    }

    // The app's renderer has no alpha channel, so it can only ever hand back a
    // picture of cream. Borrow its class and its colour settings for a second,
    // transparent one; the scene, the lights and the camera are shared.
    const R = view.renderer.constructor;
    const r = new R({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(master, master, false);
    r.outputColorSpace = view.renderer.outputColorSpace;
    r.toneMapping = view.renderer.toneMapping;
    r.toneMappingExposure = view.renderer.toneMappingExposure;
    r.shadowMap.enabled = true;
    r.shadowMap.type = view.renderer.shadowMap.type;
    r.setClearColor(0x000000, 0);
    r.render(view.scene, cam);

    const out = { master: r.domElement.toDataURL('image/png') };

    // Step down by halves. Each pass is a 2x box filter, which keeps the dark
    // outlines; one 128x jump to 16px does not.
    const img = new Image();
    img.src = out.master;
    await img.decode();
    for (const size of sizes) {
      let w = master;
      let src = img;
      while (w > size * 2) {
        w = Math.max(size, Math.round(w / 2));
        const c = document.createElement('canvas');
        c.width = c.height = w;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, w, w);
        src = c;
      }
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, size, size);
      out[size] = c.toDataURL('image/png');
    }
    return out;
  },
  { az: AZ, el: EL, fill: FILL, fov: FOV, master: MASTER, sizes: SIZES, sceneText },
);

await browser.close();

const png = (size) => Buffer.from(shots[size].slice(shots[size].indexOf(',') + 1), 'base64');

for (const size of PNGS) {
  const buf = png(size);
  writeFileSync(`${OUT}/icon-${size}.png`, buf);
  console.log(`  icon-${size}.png  ${(buf.length / 1024).toFixed(1)} kB`);
}

// An .ico is a six-byte header, one sixteen-byte directory entry per image, and
// then the images — which since Vista may be PNGs, so the ones just rendered go
// in whole. A 256px image would be recorded as 0 in the byte-wide size fields;
// nothing here is that big, so the plain value is right.
const ico = (sizes) => {
  const imgs = sizes.map(png);
  const head = Buffer.alloc(6 + 16 * imgs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // 1 = icon, as opposed to 2 = cursor
  head.writeUInt16LE(imgs.length, 4);
  let offset = head.length;
  imgs.forEach((img, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(sizes[i] % 256, e);
    head.writeUInt8(sizes[i] % 256, e + 1);
    head.writeUInt8(0, e + 2); // palette size: 0, being truecolour
    head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); // colour planes
    head.writeUInt16LE(32, e + 6); // bits per pixel, alpha included
    head.writeUInt32LE(img.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += img.length;
  });
  return Buffer.concat([head, ...imgs]);
};

const icoBuf = ico(ICO);
writeFileSync(`${OUT}/favicon.ico`, icoBuf);
console.log(`  favicon.ico  ${(icoBuf.length / 1024).toFixed(1)} kB  (${ICO.join(', ')})`);
