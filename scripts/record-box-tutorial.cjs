/** Capture a guided box-stitch build inside the actual editor.
 * Start Vite on port 5178. Requires Playwright, Chromium with WebGL, and ffmpeg.
 * PLAYWRIGHT_MODULE and CHROMIUM_PATH may point to local installations.
 * Intermediate scene states use the editor's development handle and sample geometry.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { mkdtempSync, writeFileSync, rmSync, existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-dev-shm-usage",
    ],
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  await page.addInitScript(() =>
    localStorage.setItem("scoubidou3d-theme", "dark"),
  );
  async function resetScene() {
    await page.goto("http://127.0.0.1:5178/Scoubidou3D/app/?sample=box-stitch");
    await page.waitForFunction(() => window.__scoubidou);
    await page.evaluate(() => {
      const { view } = window.__scoubidou;
      window.fullBox = structuredClone(view.getScene());
      window.boxCamera = view.camera.position.clone();
      window.boxCenter = { ...view.center };
      const caption = document.createElement("div");
      caption.id = "recording-caption";
      caption.style.cssText =
        'position:fixed;left:24px;bottom:80px;max-width:780px;padding:16px 22px;background:rgba(25,20,16,.94);border:1px solid #65513e;border-radius:12px;color:#f3e9d9;font:16px "Segoe UI",sans-serif;z-index:100;pointer-events:none';
      document.body.append(caption);
    });
  }
  const frames =
    process.env.RECORDING_FRAMES ||
    mkdtempSync(join(tmpdir(), "scoubidou-recording-"));
  let frame = 0;
  const fps = 2;
  const steps = [
    [
      "01 · Create the starting strands",
      "New → Draw strand. Start with one orange and one gold lace.",
      4,
    ],
    [
      "02 · Attach four arms",
      "Attach a new strand to each free endpoint. Watch the layers grow.",
      8,
    ],
    [
      "03 · Position the ends",
      "Use Move to arrange the arms around the centre.",
      4,
    ],
    ["04 · Lock the crossing", "Weave: orange 1_2 goes over gold 2_3.", 4],
    [
      "05 · Explore one completed level",
      "Orbit the camera to see the real thickness and over-under weave.",
      6,
    ],
  ];
  for (let step = 0; step < steps.length; step++) {
    await resetScene();
    await page.evaluate(
      ({ step, title, desc }) => {
        const { view, panel } = window.__scoubidou;
        view.setMode(["orbit", "attach", "move", "weave", "orbit"][step]);
        panel.syncToolbar();
        document.getElementById("recording-caption").innerHTML =
          `<b style="display:block;color:#ff805a;font-size:18px;margin-bottom:6px">${title}</b>${desc}`;
      },
      { step, title: steps[step][0], desc: steps[step][1] },
    );
    const total = steps[step][2] * fps;
    for (let i = 0; i < total; i++) {
      if (existsSync(join(frames, String(frame).padStart(4, "0") + ".jpg"))) {
        frame++;
        continue;
      }
      const u = i / (total - 1);
      await page.evaluate(
        ({ step, u }) => {
          const { view, panel } = window.__scoubidou;
          const full = window.fullBox;
          let n =
            step === 0
              ? Math.min(2, 1 + Math.floor(u * 1.8))
              : step === 1
                ? Math.min(6, 3 + Math.floor(u * 3.9))
                : 6;
          const s = structuredClone(full);
          s.strands = s.strands.slice(0, n);
          s.masks = step >= 4 || (step === 3 && u > 0.55) ? full.masks : [];
          if (step < 2) {
            const last = s.strands[n - 1];
            const p =
              step === 0
                ? Math.min(1, ((u * 1.8) % 1) * 1.5)
                : Math.min(1, ((u * 3.9) % 1) * 1.5);
            const end = {
              x: last.start.x + (last.end.x - last.start.x) * Math.max(0.04, p),
              y: last.start.y + (last.end.y - last.start.y) * Math.max(0.04, p),
            };
            if (u < 0.99) {
              last.end = end;
              last.control_points = [{ ...last.start }, { ...end }];
            }
          }
          if (step === 2) {
            const last = s.strands[2];
            last.end.y += 25 * Math.sin(u * Math.PI * 2);
            last.control_points[1] = { ...last.end };
          }
          if (window.lastCount !== n || window.lastStep !== step) {
            panel.setScene(s, "tutorial step");
            window.lastCount = n;
            window.lastStep = step;
          } else {
            panel.scene = s;
            view.setScene(s, false);
          }
          view.center = { ...window.boxCenter };
          view.rebuild();
          view.camera.position.copy(window.boxCamera);
          view.controls.target.set(0, 0, 0);
          if (step === 4) {
            const r = window.boxCamera.length();
            const angle = -1.23 + u * 1.9;
            view.camera.position.set(
              Math.cos(angle) * r * 0.75,
              Math.sin(angle) * r * 0.75,
              r * 0.65,
            );
          }
          view.camera.lookAt(view.controls.target);
          view.controls.update();
          view.renderer.render(view.scene, view.camera);
        },
        { step, u },
      );
      await page.screenshot({
        path: join(frames, String(frame++).padStart(4, "0") + ".jpg"),
        type: "jpeg",
        quality: 85,
        timeout: 15000,
      });
    }
  }
  const out = "public/tutorial/box-stitch-one-level.mp4";
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    String(fps),
    "-i",
    join(frames, "%04d.jpg"),
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "24",
    "-movflags",
    "+faststart",
    out,
  ]);
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-ss",
    "22",
    "-i",
    out,
    "-frames:v",
    "1",
    "public/tutorial/box-stitch-poster.webp",
  ]);
  let time = 0,
    vtt = "WEBVTT\n\n";
  const stamp = (s) => "00:" + String(s).padStart(2, "0") + ".000";
  for (const [title, desc, duration] of steps) {
    vtt += `${stamp(time)} --> ${stamp(time + duration)}\n${title}. ${desc}\n\n`;
    time += duration;
  }
  writeFileSync("public/tutorial/box-stitch-en.vtt", vtt);
  await browser.close();
  rmSync(frames, { recursive: true, force: true });
  console.log(`Recorded ${time}s from the actual editor (${frame} frames).`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
