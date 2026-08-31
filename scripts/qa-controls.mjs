// The control-point handles, driven for real.
//
//   npm run dev -- --port 5178 --strictPort     # in one shell
//   node scripts/qa-controls.mjs
//
// Everything here is one gesture the app has to answer correctly, pressed and
// dragged through the browser's own pointer events on the studio's canvas. It
// exists because the case that went wrong is not visible from the model alone:
// it takes an ATTACHMENT — `1_1` with `1_2` grown off its end — for a strand's
// handles to land on another strand's handles, and it takes a real press to find
// out which of the four marks stacked on that joint the app hands you.
//
// The three things it holds the app to:
//
//   1. Bending an arm bends it smoothly. A passive circle rides its strand's END
//      the moment the strand stops being straight, so the curve's waist sits in
//      the middle of the strand and the next nudge of the far end moves the
//      ribbon by about as much as the nudge — instead of jumping, which is what
//      happened while the circle was left behind on the start.
//   2. Every mark on a joint can be grabbed. The one drawn on top answers the
//      first press; pressing the same spot again walks down the pile.
//   3. A strand put back the way it was is the strand it was. Dropping the
//      triangle back on the start returns the exact default set, so `Straighten`
//      goes quiet again and the file saves no bend.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const PORT = process.env.PORT ?? '5178';
const W = 900;
const H = 700;

let bad = 0;
const ok = (cond, what) => {
  if (!cond) {
    bad++;
    console.log(`  FAIL  ${what}`);
  } else {
    console.log(`   ok   ${what}`);
  }
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('  page error:', e.message.slice(0, 300)));

await page.goto(`http://localhost:${PORT}/Scoubidou3D/app/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__scoubidou?.view, null, { timeout: 60000 });
// The panel would only be in the way of the canvas coordinates below.
await page.addStyleTag({
  content:
    '#toolbar,#panel,#hover-chip,#panel-toggle,.panel-toggle{display:none!important}' +
    '#scene{position:fixed;inset:0;width:100vw!important;height:100vh!important}',
});
await page.evaluate(() => window.dispatchEvent(new Event('resize')));
await page.waitForTimeout(200);

// ---- the page's side of the harness ----------------------------------------
// `private` is a compile-time word; at runtime the view is a plain object, which
// is what lets a test press the handles the app actually built rather than a
// second copy of the arithmetic that places them.
await page.evaluate(() => {
  const { view } = window.__scoubidou;
  const api = {};
  window.__qa = api;

  api.reset = () => {
    const at = (x, y) => ({ x, y });
    const strand = (id, sx, sy, ex, ey) => ({
      id,
      start: at(sx, sy),
      end: at(ex, ey),
      control_points: [at(sx, sy), at(sx, sy)],
      control_point_center: null,
      control_point_center_locked: false,
      triangleHasMoved: false,
      cp2Activated: false,
      width: 46,
      stroke_width: 4,
      color: { r: 226, g: 122, b: 38, a: 255 },
      stroke_color: { r: 30, g: 30, b: 30, a: 255 },
      thickness: null,
      visible: true,
      isMask: false,
      hasCircles: [false, false],
      parentId: null,
      parentSide: null,
    });
    view.setScene({
      name: 'qa-controls',
      masks: [],
      levelBreaks: [],
      strands: [strand('1_1', 180, 250, 620, 250)],
    });
    view.setMode('move');
  };

  const rect = () => view.canvas.getBoundingClientRect();
  const toScreen = (world) => {
    const r = rect();
    const p = world.clone().project(view.camera);
    return { x: ((p.x + 1) / 2) * r.width + r.left, y: ((1 - p.y) / 2) * r.height + r.top };
  };

  const meshes = () => view.handleGroup.children;
  const find = (kind, id, which) =>
    meshes().find(
      (m) =>
        m.userData.kind === kind &&
        view.getScene().strands[m.userData.index].id === id &&
        (kind === 'control' ? String(m.userData.cp) === String(which) : m.userData.side === which),
    ) ?? null;

  /** Where a handle draws, in the page's own coordinates. */
  api.handle = (kind, id, which) => {
    const m = find(kind, id, which);
    return m ? toScreen(m.position) : null;
  };

  /**
   * Where a point in the scene's own (OpenStrand pixel) space lands on screen, on
   * the SAME plane a given handle is dragged in. A drag reads the pointer against
   * a plane through the handle it grabbed, so aiming at the point as it draws on
   * any other plane misses by however far the two are apart.
   */
  api.target = (kind, id, which, p) => {
    const m = find(kind, id, which);
    return m ? toScreen(view.srcToWorld(p, m.position.z)) : null;
  };

  api.strand = (id) => {
    const s = view.getScene().strands.find((x) => x.id === id);
    if (!s) return null;
    return JSON.parse(
      JSON.stringify({
        id: s.id,
        start: s.start,
        end: s.end,
        cp1: s.control_points[0],
        cp2: s.control_points[1],
        center: s.control_point_center,
        locked: s.control_point_center_locked,
        triangleHasMoved: s.triangleHasMoved,
        cp2Activated: s.cp2Activated,
      }),
    );
  };

  /** The woven centreline the ribbon is actually swept along, in world units. */
  api.line = (id) => {
    const i = view.getScene().strands.findIndex((s) => s.id === id);
    return (view.world3D[i] ?? []).map((p) => ({ x: p.x, y: p.y, z: p.z }));
  };

  /** What the press currently down grabbed — the drag is still open when read. */
  api.grabbed = () => {
    const st = view.dragState;
    if (!st) return null;
    if (st.kind === 'move-control') return `${st.strand.id} ${String(st.handle)}`;
    if (st.kind === 'move-endpoint') return `joint ${st.targets.map((t) => `${t.strand.id}:${t.side}`).join('+')}`;
    return st.kind;
  };
});

const drag = async (from, to, steps = 6) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
  }
  await page.mouse.up();
  await page.waitForTimeout(30);
};

/** Press, read what the press took, and let go without moving. */
const tapAndRead = async (at) => {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  const got = await page.evaluate(() => window.__qa.grabbed());
  await page.mouse.up();
  await page.waitForTimeout(20);
  return got;
};

/** Take the pointer somewhere else entirely, the way a hand does between two
 *  separate pieces of work. It is what puts the pile back to its top mark. */
const restPointer = async () => {
  await page.mouse.move(40, 40);
  await page.waitForTimeout(20);
};

const maxShift = (a, b) => {
  let m = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    m = Math.max(m, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y, a[i].z - b[i].z));
  }
  return m;
};

const JOINT = { x: 620, y: 250 };

// ---- 1. grow `1_2` off `1_1`'s end -----------------------------------------
await page.evaluate(() => window.__qa.reset());
await page.evaluate(() => window.__scoubidou.view.setMode('attach'));
await page.waitForTimeout(50);
{
  const from = await page.evaluate(() => window.__qa.handle('endpoint', '1_1', 1));
  const to = await page.evaluate(() =>
    window.__qa.target('endpoint', '1_1', 1, { x: 620, y: 450 }),
  );
  await drag(from, to);
}
await page.evaluate(() => window.__scoubidou.view.setMode('move'));
await page.waitForTimeout(50);
{
  const child = await page.evaluate(() => window.__qa.strand('1_2'));
  ok(!!child, 'attach grows a `1_2` off `1_1`');
  ok(
    child && Math.hypot(child.start.x - JOINT.x, child.start.y - JOINT.y) < 1,
    'glued to the joint its parent ends at',
  );
  ok(
    child && child.cp1.x === child.start.x && child.cp2.x === child.start.x && !child.triangleHasMoved,
    'and born straight, with both control points on that start',
  );
}

// ---- 2. the arm's triangle is on the joint, and it answers ------------------
{
  const at = await page.evaluate(() => window.__qa.handle('control', '1_2', '0'));
  const got = await tapAndRead(at);
  ok(got === '1_2 0', `a press on the joint takes the arm's own triangle (got ${got})`);
}

// ---- 3. bend the parent, and the joint holds two marks ---------------------
// `1_1`'s circle is passive, so bending `1_1` sends it out to `1_1`'s END — which
// is this joint, where `1_2`'s triangle already is. Two control marks, one pixel:
// the case that used to hand every press to the lower layer.
{
  const tri = await page.evaluate(() => window.__qa.handle('control', '1_1', '0'));
  const to = await page.evaluate(() => window.__qa.target('control', '1_1', '0', { x: 300, y: 170 }));
  await drag(tri, to);
  const p = await page.evaluate(() => window.__qa.strand('1_1'));
  ok(
    Math.hypot(p.cp2.x - p.end.x, p.cp2.y - p.end.y) < 1,
    "bending `1_1` sends its passive circle to its end — which IS the joint",
  );

  const at = await page.evaluate(() => window.__qa.handle('control', '1_2', '0'));
  const seen = [];
  for (let i = 0; i < 3; i++) seen.push(await tapAndRead(at));
  ok(
    seen[0] === '1_2 0',
    `the first press takes the mark drawn on TOP — the arm's triangle (got ${seen[0]})`,
  );
  ok(
    seen[1] === '1_1 1',
    `pressing the same spot again walks down to the one underneath (got ${seen[1]})`,
  );
  ok(seen[2] === '1_2 0', `and round again (got ${seen[2]})`);

  await restPointer();
  const back = await tapAndRead(at);
  ok(
    back === '1_2 0',
    `taking the pointer away and coming back starts again at the top (got ${back})`,
  );
}

// ---- 4. bending the arm ----------------------------------------------------
{
  await restPointer();
  const tri = await page.evaluate(() => window.__qa.handle('control', '1_2', '0'));
  const to = await page.evaluate(() => window.__qa.target('control', '1_2', '0', { x: 700, y: 300 }));
  await drag(tri, to);
  const s = await page.evaluate(() => window.__qa.strand('1_2'));
  ok(s.triangleHasMoved, 'dragging the triangle marks the arm bent');
  ok(
    Math.hypot(s.cp2.x - s.end.x, s.cp2.y - s.end.y) < 1,
    `and its unclaimed circle takes up its home on the END (cp2 ${s.cp2.x.toFixed(1)},${s.cp2.y.toFixed(1)} vs end ${s.end.x.toFixed(1)},${s.end.y.toFixed(1)})`,
  );
  ok(!s.cp2Activated, 'without claiming it — the circle is still passive');
  const mid = { x: (s.cp1.x + s.cp2.x) / 2, y: (s.cp1.y + s.cp2.y) / 2 };
  ok(
    s.center && Math.hypot(s.center.x - mid.x, s.center.y - mid.y) < 0.5 && !s.locked,
    'and the centre tracks the midpoint of the two, unlocked',
  );
}

// ---- 5. the end of a bent strand is still its end --------------------------
// The circle now rides that end, and OSS hands every press to a control mark
// before an endpoint. In a flat canvas that costs nothing — the two are the same
// pixel. Here they draw apart, so the aim decides, and only where they really are
// on top of each other does the pass order take over (and the pile is walkable).
{
  await restPointer();
  const onEnd = await page.evaluate(() => window.__qa.handle('endpoint', '1_2', 1));
  const onCircle = await page.evaluate(() => window.__qa.handle('control', '1_2', '1'));
  const gotEnd = await tapAndRead(onEnd);
  ok(gotEnd === 'joint 1_2:1', `pressing the end dot takes the END (got ${gotEnd})`);
  const under = await tapAndRead(onEnd);
  ok(under === '1_2 1', `and pressing it again reaches the circle riding it (got ${under})`);
  await restPointer();
  const gotCircle = await tapAndRead(onCircle);
  ok(gotCircle === '1_2 1', `pressing the circle takes the circle (got ${gotCircle})`);

  await restPointer();
  const before = await page.evaluate(() => window.__qa.line('1_2'));
  const from = await page.evaluate(() => window.__qa.handle('endpoint', '1_2', 1));
  const to = await page.evaluate(() =>
    window.__qa.target('endpoint', '1_2', 1, { x: 625, y: 455 }),
  );
  await drag(from, to);
  const after = await page.evaluate(() => window.__qa.line('1_2'));
  const moved = maxShift(before, after);
  // The end itself travels 5√2 source units, and SCALE is 0.02 — about 0.14 world
  // units. Three times that is generous for a curve following its own endpoint,
  // and nowhere near the ~2 world units the ribbon lurched when this very gesture
  // teleported the circle from the start to the end.
  ok(
    moved < 0.45,
    `nudging the far end by 5px moves the ribbon by ${moved.toFixed(3)} world units, not a jump`,
  );
}

// ---- 6. putting it back puts it back ---------------------------------------
{
  await restPointer();
  const tri = await page.evaluate(() => window.__qa.handle('control', '1_2', '0'));
  const home = await page.evaluate(() => {
    const s = window.__qa.strand('1_2');
    return window.__qa.target('control', '1_2', '0', s.start);
  });
  await drag(tri, home);
  const s = await page.evaluate(() => window.__qa.strand('1_2'));
  ok(
    !s.triangleHasMoved && !s.cp2Activated && s.center === null,
    'dropping the triangle back on the start folds the set away',
  );
  ok(
    Math.hypot(s.cp1.x - s.start.x, s.cp1.y - s.start.y) < 1e-9 &&
      Math.hypot(s.cp2.x - s.start.x, s.cp2.y - s.start.y) < 1e-9,
    'and puts both control points exactly back on it — the default set, not a near miss',
  );
}

// ---- 7. two triangles on one point -----------------------------------------
// An arm grown off a parent's START is the worst of the pile: both strands are
// unbent, so both of their triangles sit on that one shared point, and there is
// nothing to aim between. This is the sample scenes' own shape — `1_1` with arms
// on both ends — and until the tie-break it meant an arm attached at the head
// could not be bent at all.
{
  await restPointer();
  await page.evaluate(() => window.__qa.reset());
  await page.evaluate(() => window.__scoubidou.view.setMode('attach'));
  await page.waitForTimeout(50);
  const from = await page.evaluate(() => window.__qa.handle('endpoint', '1_1', 0));
  const to = await page.evaluate(() => window.__qa.target('endpoint', '1_1', 0, { x: 120, y: 90 }));
  await drag(from, to);
  await page.evaluate(() => window.__scoubidou.view.setMode('move'));
  await page.waitForTimeout(50);

  const a = await page.evaluate(() => window.__qa.handle('control', '1_1', '0'));
  const b = await page.evaluate(() => window.__qa.handle('control', '1_2', '0'));
  ok(
    Math.hypot(a.x - b.x, a.y - b.y) < 0.5,
    'an arm on the head puts both triangles on the very same pixel',
  );
  await restPointer();
  const first = await tapAndRead(a);
  ok(first === '1_2 0', `and the press takes the arm's, which is the one on top (got ${first})`);
  const second = await tapAndRead(a);
  ok(second === '1_1 0', `with the parent's one press further down (got ${second})`);
}

await browser.close();
console.log(bad ? `\n${bad} failed` : '\nall good');
process.exit(bad ? 1 : 0);
