// Draws the project site's sample thumbnails from the samples themselves.
//
// Every picture on the landing page is a top-down view of the SAME scene the
// app loads when you click the card — the strands come out of `samples.ts`, the
// centerlines out of the same OpenStrand curve math the 3D ribbon is swept
// along (`geometry/bezier.ts`), and the over/unders out of each scene's own
// mask list. Nothing here is drawn by hand, so a sample cannot drift away from
// its own illustration: change the generator in `samples.ts` and re-run this.
//
//   npm run art          → writes site/art/<key>.svg and prints the stats table
//
// The stats it prints (strands / masks / levels / junctions) are the numbers the
// cards quote, so the site never claims a count the scene doesn't have.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SAMPLE_LABELS, SAMPLES } from '../src/model/samples';
import { Point, RGBA, Scene3D, Strand3D } from '../src/model/types';
import { sampleCenterline } from '../src/geometry/bezier';

// Relative to where npm run puts you, which is the repo root. The script is
// bundled to a temp file before it runs, so its own path is no help here.
const OUT = resolve(process.cwd(), 'site/art');

// How far the darkened understudy of the whole weave is offset. It stands in for
// the ribbon thickness the 3D view gives you for real — the same trick the hero
// drawing uses, and the reason a flat picture still reads as a solid lace.
const LIFT = 9;
const MARGIN = 14;
// Wider than the app's default so the thumbnail stays legible at card size.
const OUTLINE = 5;

function hex(c: RGBA): string {
  const h = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function d(pts: Point[]): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');
}

/** The strand's centerline, exactly as the 3D ribbon builder gets it. */
function centerline(s: Strand3D): Point[] {
  return sampleCenterline(
    {
      start: s.start,
      end: s.end,
      control_points: [s.control_points[0], s.control_points[1]],
      control_point_center: s.control_point_center,
      control_point_center_locked: s.control_point_center_locked,
    },
    18,
  );
}

/** Outline underneath, colour on top — the order OpenStrand draws a lace in. */
function ribbon(s: Strand3D, path: string): string {
  const w = s.width;
  return (
    `<path d="${path}" stroke="${hex(s.stroke_color)}" stroke-width="${w + 2 * OUTLINE}"/>` +
    `<path d="${path}" stroke="${hex(s.color)}" stroke-width="${w}"/>`
  );
}

interface Stats {
  key: string;
  name: string;
  strands: number;
  masks: number;
  levels: number;
  junctions: number;
}

/**
 * Endpoints that more than one strand shares — the joins where a lace was grown
 * off another with Attach. Snapped to the pixel, which is the same tolerance
 * `connections.ts` glues by, so this counts what the app counts.
 */
function junctions(scene: Scene3D): number {
  const at = new Map<string, number>();
  for (const s of scene.strands) {
    for (const p of [s.start, s.end]) {
      const k = `${Math.round(p.x)},${Math.round(p.y)}`;
      at.set(k, (at.get(k) ?? 0) + 1);
    }
  }
  let n = 0;
  for (const count of at.values()) if (count > 1) n++;
  return n;
}

// A scene worked in storeys is the one case where straight down is the wrong
// place to stand: every round of a box stitch column lands on the same square,
// so from above ten rounds look exactly like one. These get tipped instead —
// the same oblique the hero drawing uses — and each storey is lifted clear of
// the one below, which is precisely what a level break means in the app.
const TIP = { a: 0.94, b: -0.188, c: 0.342, d: 0.517 };
const STOREY = 26;

function render(key: string, scene: Scene3D): Stats {
  const paths = new Map<string, string>();
  for (const s of scene.strands) paths.set(s.id, d(centerline(s)));

  // Which storey each strand belongs to: `levelBreaks` holds the indices where a
  // new one starts, exactly as `levels.ts` reads them.
  const levels = scene.levelBreaks.length;
  const levelOf = (i: number): number => scene.levelBreaks.filter((b) => i >= b).length;
  const tipped = levels > 0;
  const M = tipped ? TIP : { a: 1, b: 0, c: 0, d: 1 };
  const lift = (level: number): number => (tipped ? -level * STOREY : 0);

  // Bounds from the drawn extent — centerline plus half a ribbon plus its
  // outline, run through the same projection — so no sample is clipped and none
  // floats in a sea of margin.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  scene.strands.forEach((s, i) => {
    const r = s.width / 2 + OUTLINE;
    const ty = lift(levelOf(i));
    for (const p of centerline(s)) {
      const X = M.a * p.x + M.c * p.y;
      const Y = M.b * p.x + M.d * p.y + ty;
      x0 = Math.min(x0, X - r);
      y0 = Math.min(y0, Y - r);
      x1 = Math.max(x1, X + r);
      y1 = Math.max(y1, Y + r);
    }
  });

  // One group per storey, bottom first, so an upper round rests on the one under
  // it. A flat scene is just the single-storey case.
  const windows: string[] = [];
  const groups: string[] = [];
  for (let level = 0; level <= levels; level++) {
    const here = scene.strands.filter((_, i) => levelOf(i) === level);
    if (!here.length) continue;
    const ids = new Set(here.map((s) => s.id));

    // Layer order first: a strand later in the list sits higher, which on a
    // drawing simply means it is painted last.
    let body = here.map((s) => `<g>${ribbon(s, paths.get(s.id) as string)}</g>`).join('');

    // Then the masks, which are the crossings the layer order gets wrong. Each
    // one repaints the OVER lace through a window cut to the UNDER lace, so the
    // over lace wins at that crossing and nowhere else — a MaskedStrand,
    // flattened onto the page.
    scene.masks.forEach((m, i) => {
      if (!ids.has(m.overId) || !ids.has(m.underId)) return;
      const under = scene.strands.find((s) => s.id === m.underId);
      const over = scene.strands.find((s) => s.id === m.overId);
      if (!under || !over) return;
      const id = `${key}-m${i}`;
      // The window is cut a shade WIDER than the lace it follows. Its edge is
      // antialiased, and an edge that lands exactly on the under lace's dark
      // outline half-blends with it and leaves a hairline scored across the over
      // lace; a few pixels of slack puts the blend on plain colour instead.
      windows.push(
        `<mask id="${id}" maskUnits="userSpaceOnUse" x="-4000" y="-4000" width="8000" height="8000">` +
          `<path d="${paths.get(under.id)}" stroke="#fff" stroke-width="${under.width + 2 * OUTLINE + 6}"/>` +
          `</mask>`,
      );
      body += `<g mask="url(#${id})">${ribbon(over, paths.get(over.id) as string)}</g>`;
    });

    const t = `matrix(${M.a} ${M.b} ${M.c} ${M.d} 0 ${lift(level)})`;
    groups.push(`<g transform="${t}">${body}</g>`);
  }

  const weave = groups.join('');
  const w = x1 - x0 + 2 * MARGIN;
  const h = y1 - y0 + 2 * MARGIN + LIFT;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(x0 - MARGIN).toFixed(1)} ${(y0 - MARGIN).toFixed(1)} ` +
    `${w.toFixed(1)} ${h.toFixed(1)}" role="img" aria-label="${scene.name}">` +
    `<defs>` +
    // The understudy is the same weave run through a darkening matrix — the side
    // of the lace you would see if you tipped the camera a degree off top-down.
    `<filter id="edge-${key}" x="-10%" y="-10%" width="120%" height="120%">` +
    `<feColorMatrix type="matrix" values="0.55 0 0 0 0  0 0.55 0 0 0  0 0 0.55 0 0  0 0 0 1 0"/>` +
    `</filter>` +
    windows.join('') +
    `<g id="weave-${key}" fill="none" stroke-linecap="round" stroke-linejoin="round">${weave}</g>` +
    `</defs>` +
    `<use href="#weave-${key}" y="${LIFT}" filter="url(#edge-${key})"/>` +
    `<use href="#weave-${key}"/>` +
    `</svg>\n`;

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, `${key}.svg`), svg);

  return {
    key,
    name: scene.name,
    strands: scene.strands.length,
    masks: scene.masks.length,
    levels: scene.levelBreaks.length + 1,
    junctions: junctions(scene),
  };
}

const rows: Stats[] = [];
// Only the named samples get a thumbnail: the m x n twist family is 64 scenes and
// the site does not show them as cards, so drawing them would be dead weight.
for (const { key } of SAMPLE_LABELS) rows.push(render(key, SAMPLES[key]()));

const head = ['key', 'name', 'strands', 'masks', 'levels', 'junctions'];
const table = [head, ...rows.map((r) => head.map((k) => String(r[k as keyof Stats])))];
const widths = head.map((_, i) => Math.max(...table.map((r) => r[i].length)));
for (const r of table) console.log(r.map((c, i) => c.padEnd(widths[i])).join('  '));
console.log(`\n${rows.length} thumbnails written to site/art/`);
