// Builds the "Box stitch — 10 levels, stretched" sample, a level at a time:
//   npm run make:stretched-box   → writes src/model/fitted/box-1x1-stretched-10.json
//
// It is the box stitch worked the way a person works one, with the app's
// Stretch (src/model/stretch.ts) pulling each round tight before the next is
// laid on it:
//
//   1. Start from `scripts/stretch-two-levels.json` — a starting stitch and a
//      second round drawn by hand in the studio, loose. Stretch level 0, then
//      level 1, and give level 1 the plane heights that were placed on it by
//      hand (the four arms on the upper half, and its four crossings).
//   2. For each level from 2 to 9: draw the loose ends of the level below in to
//      a little past where their folds will land; fold each of them back
//      across, in the reverse of the order the level below was laid (that
//      reversal is what makes it a box and not a round stitch), a few degrees
//      off its line and with its fold standing out, as a hand would; mask the
//      first arm over the last, which is the move that locks a round; then
//      Stretch that level.
//   3. Draw the four loose ends at the top in to where the built columns leave
//      theirs, so the finished thing does not end in four long tails.
//
// The heights above level 1 are left at the studio's defaults.
//
// The result is a RECORD, checked in, not regenerated on load: what Stretch
// does may be tuned later, and a sample that quietly changed shape with it would
// be a different sample. `npm run check:stretch` holds the record to being
// tight — every level of it a fixed point of Stretch — so a change that
// disagrees with it is noticed, and this script is how it is rebuilt.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { recomputeOccupancy } from '../src/model/connections';
import { levelAt } from '../src/model/levels';
import { parseSceneText, sceneToJson } from '../src/model/sceneIO';
import { STRETCH_AIR, STRETCH_POKE, stretchLevel } from '../src/model/stretch';
import { Scene3D, Strand3D } from '../src/model/types';

const LEVELS = 10;
/** How far off the line below each new arm is drawn, degrees. A fixed list, so
 *  the build repeats exactly. */
const WOBBLE = [5, -4, 3, -6, 4, -5, 6, -3];
/** How far a new fold is drawn standing out past where it will land, px. */
const SLACK = 40;
/** How far past its fold a new arm is drawn running on, px. */
const TAIL = 70;

const root = process.cwd();
const OUT = resolve(root, 'src/model/fitted/box-1x1-stretched-10.json');

let scene: Scene3D = parseSceneText(readFileSync(resolve(root, 'scripts/stretch-two-levels.json'), 'utf8'));
const stretch = (level: number): void => {
  const r = stretchLevel(scene, level);
  const { changed, overlapAfter, cutShort } = r.report;
  console.log(`level ${level}: ${changed ? 'stretched' : 'already tight'}, overlap left ${overlapAfter.toExponential(1)} px`);
  if (overlapAfter > 1e-3 || cutShort) throw new Error(`level ${level} did not close (overlap ${overlapAfter}, cut short ${cutShort})`);
  scene = r.scene;
};

// ---- 1. the two levels drawn by hand -------------------------------------------
stretch(0);
stretch(1);
scene.planes = { '1_4': 1, '1_5': 1, '2_4': 1, '2_5': 1 };
scene.crossPlanes = {
  '1_5|2_5|0|1_5': -1,
  '2_4|1_5|0|1_5': 2,
  '1_4|2_5|0|1_4': 2,
  '1_5|2_5|0|2_5': 2,
};

// What a tight arm is: a poke past the strand it wraps, a gap, and a poke again.
const W = scene.strands[0].width;
const POKE = W / 2 + STRETCH_POKE;
const TIGHT = POKE + (W + STRETCH_AIR) + POKE;
const resize = (s: Strand3D, length: number): void => {
  const L = Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y);
  s.end = {
    x: s.start.x + ((s.end.x - s.start.x) / L) * length,
    y: s.start.y + ((s.end.y - s.start.y) / L) * length,
  };
};
const onLevel = (level: number): Strand3D[] => scene.strands.filter((_, i) => levelAt(scene, i) === level);

// ---- 2. a round at a time ---------------------------------------------------------
for (let level = 2; level < LEVELS; level++) {
  const below = onLevel(level - 1);
  if (below.length !== 4) throw new Error(`level ${level - 1} has ${below.length} strands, not 4`);
  for (const s of below) resize(s, TIGHT + SLACK);

  const first = scene.strands.length;
  const made: Strand3D[] = [...below].reverse().map((p, q) => {
    const [, set, n] = /^(\d+)_(\d+)$/.exec(p.id) as RegExpExecArray;
    const back =
      Math.atan2(p.start.y - p.end.y, p.start.x - p.end.x) +
      (WOBBLE[(level * 4 + q) % WOBBLE.length] * Math.PI) / 180;
    const at = () => ({ x: p.end.x, y: p.end.y });
    const length = TIGHT + SLACK + TAIL;
    return {
      ...p,
      id: `${set}_${Number(n) + 2}`,
      start: at(),
      end: { x: p.end.x + Math.cos(back) * length, y: p.end.y + Math.sin(back) * length },
      control_points: [at(), at()],
      control_point_center: null,
      control_point_center_locked: false,
      triangleHasMoved: false,
      cp2Activated: false,
      hasCircles: [true, false],
      parentId: p.id,
      parentSide: 1,
      color: { ...p.color },
      stroke_color: { ...p.stroke_color },
    };
  });
  scene.strands.push(...made);
  scene.levelBreaks.push(first);
  scene.masks.push({ overId: made[0].id, underId: made[3].id });
  recomputeOccupancy(scene);
  stretch(level);
}

// ---- 3. the loose ends at the top ---------------------------------------------------
for (const s of onLevel(LEVELS - 1)) resize(s, TIGHT + W + 30);
recomputeOccupancy(scene);

scene.name = `Box stitch — ${LEVELS} levels, stretched`;
writeFileSync(OUT, `${sceneToJson(scene)}\n`);
console.log(`${scene.strands.length} strands, ${LEVELS} levels, ${scene.masks.length} masks → ${OUT}`);
