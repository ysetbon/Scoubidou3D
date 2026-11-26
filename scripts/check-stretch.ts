// What Stretch does to a knot:
//   npm run check:stretch
//
// The function pulls one level of a scene tight (src/model/stretch.ts). What it
// promises is checkable to the pixel, so it is checked to a good deal less:
//
//   * the WEAVE is the one that was drawn — the same strands cross, the same
//     number of times, and nothing else does;
//   * every strand that can be straight IS, and is handed back as an untouched
//     strand rather than one with its handles parked on its chord;
//   * the clearances land ON their numbers — side by side at the family's gap,
//     a fold half a gap past what it wraps, a loose end at the family's poke;
//   * a lace keeps its length: what the middle gives up, the arms take;
//   * a tight stitch is a fixed point, so pressing the button twice is pressing
//     it once — and the blocks the families build are already tight.
//
// `scripts/stretch-knot.json` is the knot the function was written against: a
// 1×1 starting stitch drawn loose by hand, with wandering middles, a hook on
// three of its arms, and the two laces 1.6° off square.

import { sampleCenterline } from '../src/geometry/bezier';
import { polylineCrossings } from '../src/geometry/weave';
import { endpointJoints } from '../src/model/connections';
import { controlsAtDefault, curveInput } from '../src/model/controlPoints';
import { levelAt } from '../src/model/levels';
import { makeSample } from '../src/model/samples';
import { parseSceneText } from '../src/model/sceneIO';
import { STRETCH_AIR, STRETCH_POKE, stretchLevel } from '../src/model/stretch';
import { GAP, POKE, W, WEFT, mk } from '../src/model/twofan';
import { Point, Scene3D, Strand3D } from '../src/model/types';
import knot from './stretch-knot.json';

let bad = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    bad++;
    console.log(`  FAIL  ${what}`);
  } else {
    console.log(`   ok   ${what}`);
  }
};

const line = (s: Strand3D): Point[] => sampleCenterline(curveInput(s, true), 24);
const len = (p: Point[]): number => p.slice(1).reduce((n, q, i) => n + Math.hypot(q.x - p[i].x, q.y - p[i].y), 0);
const strand = (sc: Scene3D, id: string): Strand3D => sc.strands.find((s) => s.id === id) as Strand3D;
const angle = (s: Strand3D): number => Math.atan2(s.end.y - s.start.y, s.end.x - s.start.x);
const deg = (r: number): number => (r * 180) / Math.PI;
/** Distance from `p` to the infinite line through a straight strand. */
const off = (p: Point, s: Strand3D): number => {
  const dx = s.end.x - s.start.x;
  const dy = s.end.y - s.start.y;
  return Math.abs((p.x - s.start.x) * dy - (p.y - s.start.y) * dx) / Math.hypot(dx, dy);
};

/** `a|b` → how many times they cross, for every pair on one storey that is not
 *  glued end to end. (Two strands on different storeys are not woven: levels.ts.) */
function weave(sc: Scene3D): Map<string, number> {
  const joint = endpointJoints(sc);
  const lines = sc.strands.map(line);
  const out = new Map<string, number>();
  for (let i = 0; i < sc.strands.length; i++) {
    for (let j = i + 1; j < sc.strands.length; j++) {
      if (levelAt(sc, i) !== levelAt(sc, j)) continue;
      const glued = [0, 1].some((t) => [0, 1].some((u) => joint[i * 2 + t] === joint[j * 2 + u]));
      if (glued) continue;
      const n = polylineCrossings(lines[i], lines[j]).length;
      if (n) out.set(`${sc.strands[i].id}|${sc.strands[j].id}`, n);
    }
  }
  return out;
}
const sameWeave = (a: Map<string, number>, b: Map<string, number>): boolean =>
  a.size === b.size && [...a].every(([k, n]) => b.get(k) === n);

// ---- 1. the knot it was written against ---------------------------------------
console.log('the hand-drawn 1×1 starting stitch');
{
  const drawn = parseSceneText(JSON.stringify(knot));
  const frozen = JSON.stringify(drawn);
  const { scene: tight, report } = stretchLevel(drawn, 0);

  ok(JSON.stringify(drawn) === frozen, 'the scene handed in is not touched');
  ok(report.changed && report.strands === 6 && report.movable === 6, 'all six strands were free to move, and did');

  const before = weave(drawn);
  const after = weave(tight);
  ok(before.size === 9 && sameWeave(before, after), `the nine crossings are the nine that were drawn (${after.size} after)`);
  ok(JSON.stringify(tight.masks) === JSON.stringify(drawn.masks), 'and the masks over them are untouched');

  ok(
    tight.strands.every((s) => controlsAtDefault(s)),
    `every strand comes out straight, as an untouched strand (${report.straightened} straightened, ${report.bent} left bent)`,
  );

  // Each lace's two arms exactly opposite, the two laces exactly square.
  const a12 = angle(strand(tight, '1_2'));
  const a13 = angle(strand(tight, '1_3'));
  const a22 = angle(strand(tight, '2_2'));
  const a23 = angle(strand(tight, '2_3'));
  const fold = (r: number): number => Math.abs(((deg(r) % 360) + 540) % 360 - 180);
  ok(fold(a12 - a13 - Math.PI) < 1e-9 && fold(a22 - a23 - Math.PI) < 1e-9, 'the two arms of each lace point exactly opposite ways');
  ok(fold(a12 - a22 - Math.PI / 2) < 1e-9 || fold(a12 - a22 + Math.PI / 2) < 1e-9, 'and the two laces lie exactly square');
  const turned = Math.max(...['1_2', '1_3', '2_2', '2_3'].map((id) => fold(angle(strand(tight, id)) - angle(strand(drawn, id)))));
  ok(turned < 4, `no arm was turned more than a few degrees to get there (${turned.toFixed(2)}°)`);

  // The clearances, on their numbers. An arm starts at its fold, so the fold of
  // the OTHER arm of the same lace is the nearest thing to it: one gap away.
  const j1a = strand(tight, '1_2').start;
  const j1b = strand(tight, '1_3').start;
  const j2a = strand(tight, '2_2').start;
  const j2b = strand(tight, '2_3').start;
  const near = (got: number, want: number): boolean => Math.abs(got - want) < 1e-5;
  const gaps = [off(j1b, strand(tight, '1_2')), off(j1a, strand(tight, '1_3')), off(j2b, strand(tight, '2_2')), off(j2a, strand(tight, '2_3'))];
  ok(gaps.every((g) => near(g, GAP)), `side by side, the arms of a lace are one gap apart: ${gaps.map((g) => g.toFixed(6)).join(', ')} (want ${GAP})`);
  ok(GAP === W + STRETCH_AIR && POKE === W / 2 + STRETCH_POKE, "which is the families' own gap, and poke, by construction");
  // A fold wraps the nearer of the other lace's two arms, half a gap past it.
  const wraps = [
    Math.min(off(j1a, strand(tight, '2_2')), off(j1a, strand(tight, '2_3'))),
    Math.min(off(j1b, strand(tight, '2_2')), off(j1b, strand(tight, '2_3'))),
    Math.min(off(j2a, strand(tight, '1_2')), off(j2a, strand(tight, '1_3'))),
    Math.min(off(j2b, strand(tight, '1_2')), off(j2b, strand(tight, '1_3'))),
  ];
  ok(wraps.every((g) => near(g, GAP / 2)), `each fold stops half a gap past the arm it wraps: ${wraps.map((g) => g.toFixed(6)).join(', ')} (want ${GAP / 2})`);
  // So the buried middle is the diagonal of a gap by two gaps — the built block's slant.
  const slant = Math.hypot(GAP, 2 * GAP);
  const mids = ['1_1', '2_1'].map((id) => len(line(strand(tight, id))));
  ok(mids.every((m) => near(m, slant)), `the two middles are the block's slant: ${mids.map((m) => m.toFixed(6)).join(', ')} (want ${slant.toFixed(6)})`);
  ok(report.overlapAfter < 1e-6 && report.overlapBefore > 1, `nothing overlaps afterwards (worst ${report.overlapBefore.toFixed(2)} px before, ${report.overlapAfter.toExponential(1)} after)`);

  // A lace is not shortened by pulling it.
  for (const set of ['1', '2']) {
    const total = (sc: Scene3D): number => sc.strands.filter((s) => s.id.startsWith(`${set}_`)).reduce((n, s) => n + len(line(s)), 0);
    ok(Math.abs(total(drawn) - total(tight)) < 1e-6, `lace ${set} is the length it was drawn (${total(drawn).toFixed(3)} → ${total(tight).toFixed(3)})`);
  }
  ok(report.slack > 50, `and the slack came out through the arms (${report.slack.toFixed(1)} px)`);

  // The joints are still joints.
  ok(
    ['1_2', '2_2'].every((id) => {
      const arm = strand(tight, id);
      const mid = strand(tight, `${id[0]}_1`);
      return arm.start.x === mid.start.x && arm.start.y === mid.start.y;
    }) &&
      ['1_3', '2_3'].every((id) => {
        const arm = strand(tight, id);
        const mid = strand(tight, `${id[0]}_1`);
        return arm.start.x === mid.end.x && arm.start.y === mid.end.y;
      }),
    'every arm still starts exactly on the end of its middle',
  );

  // Pressing it again changes nothing.
  const again = stretchLevel(tight, 0);
  ok(!again.report.changed, 'a second press moves nothing: tight is a fixed point');

  // Frames, for the motion: first to last, ending on the answer.
  const filmed = stretchLevel(drawn, 0, { frames: 12 });
  ok(filmed.frames.length > 1 && filmed.frames.length <= 12, `asked for frames, it hands back the pull as a motion (${filmed.frames.length})`);
  ok(JSON.stringify(filmed.frames[filmed.frames.length - 1].strands) === JSON.stringify(filmed.scene.strands), 'whose last frame is the answer');
  ok(filmed.frames.every((f) => sameWeave(before, weave(f))), 'and whose every frame is the same weave');
}

// ---- 2. what the families build is already tight --------------------------------
console.log('\nthe built blocks');
for (const key of ['box-lh-1x1', 'box-rh-2x3', 'box-lh-3x3', 'twofan-lh-1x1']) {
  const sc = makeSample(key);
  const { report } = stretchLevel(sc, 0);
  ok(!report.changed && report.overlapBefore < 1e-6, `${key}: level 0 is already tight, and is left exactly as built`);
}

// ---- 3. other levels do not move -------------------------------------------------
console.log('\nscope');
{
  const sc = makeSample('box-stitch-10');
  const { scene: out } = stretchLevel(sc, 0);
  const still = sc.strands.every((s, i) => {
    if (i < 6) return true; // level 0's own six
    const t = out.strands[i];
    return s.start.x === t.start.x && s.start.y === t.start.y && s.end.x === t.end.x && s.end.y === t.end.y;
  });
  ok(still, 'stretching level 0 of a ten-level column moves nothing on the nine above');
  const top = stretchLevel(sc, 5);
  ok(top.report.movable === 0 && !top.report.changed, 'and a level pinned at both ends by its neighbours has nothing free to pull');
}

// ---- 4. a bend that is only slack comes out -------------------------------------
console.log('\ncurves');
{
  const sc = makeSample('curved-stack');
  const before = weave(sc);
  const { scene: out, report } = stretchLevel(sc, 0);
  ok(report.straightened === 6 && out.strands.every((s) => controlsAtDefault(s)), 'six wavy ribbons crossing six ways come out as six straight ones');
  ok(sameWeave(before, weave(out)), 'with the weave they had');
}

// ---- 5. three laces locked round each other cannot close to a point ---------------
console.log('\na locked triangle');
{
  // Three straight strands crossing pairwise, a over b over c over a, drawn
  // with the triangle between them far too small for three ribbons to share.
  const ray = (id: string, deg0: number, r: number): Strand3D => {
    const t = (deg0 * Math.PI) / 180;
    const nx = -Math.sin(t);
    const ny = Math.cos(t);
    return mk(id, { x: nx * r - Math.cos(t) * 260, y: ny * r - Math.sin(t) * 260 }, { x: nx * r + Math.cos(t) * 260, y: ny * r + Math.sin(t) * 260 }, WEFT[0]);
  };
  const scene: Scene3D = {
    name: 'triangle',
    strands: [ray('a', 0, 6), ray('b', 120, 6), ray('c', 240, 6)],
    masks: [
      { overId: 'a', underId: 'b' },
      { overId: 'b', underId: 'c' },
      { overId: 'c', underId: 'a' },
    ],
    levelBreaks: [],
  };
  const inradius = (sc: Scene3D): number => {
    const l = sc.strands.map(line);
    const p = [polylineCrossings(l[0], l[1])[0], polylineCrossings(l[1], l[2])[0], polylineCrossings(l[2], l[0])[0]];
    const side = [0, 1, 2].map((i) => Math.hypot(p[i].x - p[(i + 1) % 3].x, p[i].y - p[(i + 1) % 3].y));
    const area = Math.abs((p[1].x - p[0].x) * (p[2].y - p[0].y) - (p[1].y - p[0].y) * (p[2].x - p[0].x)) / 2;
    return (2 * area) / (side[0] + side[1] + side[2]);
  };
  const { scene: out, report } = stretchLevel(scene, 0);
  const want = W / 2 + STRETCH_AIR / 2;
  ok(Math.abs(inradius(scene) - 6) < 1e-9, 'drawn with six pixels of room inside it');
  ok(Math.abs(inradius(out) - want) < 1e-4, `it opens until no point is under all three ribbons: inradius ${inradius(out).toFixed(5)} (want ${want})`);
  ok(sameWeave(weave(scene), weave(out)) && report.bent === 0, 'the three strands still cross each other once, and are still straight');
}

// ---- 6. a loop is slack, unless something is caught in it -------------------------
console.log('\na loop laid over another strand');
{
  // `over` arches across `post` and back. An over/under is declared per pair,
  // so both crossings are the same way up and nothing holds the loop on.
  const arch = (): Scene3D => {
    const post = mk('post', { x: 0, y: -160 }, { x: 0, y: 160 }, WEFT[1]);
    const over = mk('over', { x: 150, y: -70 }, { x: 150, y: 70 }, WEFT[2]);
    over.control_points = [
      { x: -260, y: -60 },
      { x: -260, y: 60 },
    ];
    over.triangleHasMoved = true;
    over.cp2Activated = true;
    return { name: 'arch', strands: [post, over], masks: [], levelBreaks: [] };
  };
  {
    const scene = arch();
    const { scene: out, report } = stretchLevel(scene, 0);
    ok(weave(scene).get('post|over') === 2, 'drawn crossing it twice');
    ok(weave(out).size === 0 && report.bent === 0 && controlsAtDefault(strand(out, 'over')), 'pulled, the loop comes off and the strand is straight');
    ok(report.overlapAfter < 1e-6, 'and clear of the post it came off');
  }
  {
    // The same loop with the end of a third strand caught inside it: the loop
    // cannot close past that end, so it stays, and stays bent.
    const scene = arch();
    scene.strands.push(mk('pin', { x: -300, y: 0 }, { x: -70, y: 0 }, WEFT[3]));
    const before = weave(scene);
    const { scene: out, report } = stretchLevel(scene, 0);
    ok(before.get('post|over') === 2 && before.get('over|pin') === 1, 'with a strand ending inside the loop');
    ok(sameWeave(before, weave(out)), 'the loop stays on: every crossing is still there');
    ok(report.bent === 1 && !controlsAtDefault(strand(out, 'over')), 'so the arch keeps its handles — the one strand left bent');
    ok(len(line(strand(out, 'over'))) < len(line(strand(scene, 'over'))) - 1 && report.overlapAfter < 1e-3, `pulled in as far as the caught end allows (${len(line(strand(scene, 'over'))).toFixed(0)} → ${len(line(strand(out, 'over'))).toFixed(0)} px)`);
  }
}

// ---- 7. every built-in sample: the weave survives ----------------------------------
console.log('\nevery sample');
{
  const keys = [
    'two-crossing', 'two-crossing-arms', 'box-and-strand', 'box-stitch', 'braid-3', 'braid-4', 'diagonal',
    'woven-mat', 'curved-stack', 'box-lh-2x2', 'twofan-rh-2x3', 'swirl-lh-2x2', 'twist-stitch-10',
  ];
  let runs = 0;
  const broke: string[] = [];
  const worse: string[] = [];
  for (const key of keys) {
    const sc = makeSample(key);
    for (let level = 0; level <= Math.min(sc.levelBreaks.length, 2); level++) {
      const { scene: out, report } = stretchLevel(sc, level);
      if (!report.strands) continue;
      runs++;
      if (!sameWeave(weave(sc), weave(out))) {
        // Allowed: a pair that crossed three times now crosses once.
        const a = weave(sc);
        const b = weave(out);
        const fine = [...a].every(([k, n]) => {
          const m = b.get(k) ?? 0;
          return m === n || (m >= 1 && m < n && (n - m) % 2 === 0);
        });
        if (!fine || b.size > a.size) broke.push(`${key} L${level}`);
      }
      if (report.overlapAfter > report.overlapBefore + 1e-4) worse.push(`${key} L${level}`);
    }
  }
  ok(broke.length === 0, `${runs} levels stretched, no crossing made or lost${broke.length ? ` — broke: ${broke.join(', ')}` : ''}`);
  ok(worse.length === 0, `and nothing left overlapping more than it began${worse.length ? ` — worse: ${worse.join(', ')}` : ''}`);
}

console.log(bad ? `\n${bad} check(s) FAILED` : '\nall good');
process.exit(bad ? 1 : 0);
