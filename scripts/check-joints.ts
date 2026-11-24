// What moves together when an endpoint is dragged:
//   npm run check:joints
//
// A joint is an ATTACHMENT — a child's start and the parent end it declares, and
// every other child of that end — not "whatever lies within a unit of the point".
// Distance only decides between strands that carry no attachment at all, and
// only on one storey. See `endpointJoints` in src/model/connections.ts.
//
// This exists because the distance rule looked right on every flat sample and
// was wrong on the stacked ones: in the swirl column 1x2, dragging the end of the
// brown `2_13` (level 5) dragged the white `1_10` and `1_12` (levels 3 and 4)
// with it, because its end sits 0.8 units from their joint. 68 built-in samples
// carried 1,029 of those accidental welds.

import { SAMPLES, makeSample } from '../src/model/samples';
import { connectedEndpoints, endpoint, pointsClose, recomputeOccupancy } from '../src/model/connections';
import { levelAt } from '../src/model/levels';
import { Scene3D, Strand3D } from '../src/model/types';

let bad = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    bad++;
    console.log(`  FAIL  ${what}`);
  } else {
    console.log(`   ok   ${what}`);
  }
};

const name = (scene: Scene3D, r: { index: number; side: 0 | 1 }): string =>
  `${scene.strands[r.index].id}.${r.side ? 'end' : 'start'}`;
const joint = (scene: Scene3D, id: string, side: 0 | 1): string[] => {
  const i = scene.strands.findIndex((s) => s.id === id);
  return connectedEndpoints(scene, i, side).map((r) => name(scene, r)).sort();
};
const same = (a: string[], b: string[]): boolean => a.join() === [...b].sort().join();

// ---- 1. the case that was reported ------------------------------------------
{
  const sc = makeSample('swirl-column-1x2-lh');
  const brown = joint(sc, '2_13', 1);
  ok(same(brown, ['2_13.end']), `the brown 2_13's end drags itself alone (got ${brown.join(' + ')})`);
  const white = joint(sc, '1_10', 1);
  ok(same(white, ['1_10.end', '1_12.start']), `the white 1_10 -> 1_12 joint drags both of them and not 2_13 (got ${white.join(' + ')})`);
  recomputeOccupancy(sc);
  const s = sc.strands.find((x) => x.id === '2_13') as Strand3D;
  ok(!s.hasCircles[1], 'and 2_13 end counts as free, so Attach can grow from it');
}

// ---- 2. every built-in sample -------------------------------------------------
// Every declared attachment still drags its parent end, and every joint is made
// of attachments or of loose strands on one storey — nothing else.
{
  let samples = 0;
  let held = 0;
  const lost: string[] = [];
  const stray: string[] = [];
  for (const key of Object.keys(SAMPLES)) {
    const sc = makeSample(key);
    const S = sc.strands;
    const byId = new Map(S.map((s, i) => [s.id, i]));
    samples++;
    // Which strands carry an attachment that holds, and which endpoints those
    // attachments tie together — worked out here from the declarations alone.
    const attached = new Set<number>();
    const up = S.flatMap((_, i) => [i * 2, i * 2 + 1]);
    const top = (a: number): number => (up[a] === a ? a : (up[a] = top(up[a])));
    S.forEach((c, ci) => {
      if (c.isMask || c.parentId == null || c.parentSide == null) return;
      const pi = byId.get(c.parentId);
      if (pi === undefined || pi === ci || !pointsClose(endpoint(S[pi], c.parentSide), c.start)) return;
      attached.add(ci);
      attached.add(pi);
      up[top(ci * 2)] = top(pi * 2 + c.parentSide);
      held++;
      const refs = connectedEndpoints(sc, ci, 0);
      if (!refs.some((r) => r.index === pi && r.side === c.parentSide)) {
        lost.push(`${key}: ${c.id}.start no longer drags ${c.parentId}`);
      }
    });
    S.forEach((s, i) => {
      if (s.isMask) return;
      ([0, 1] as const).forEach((side) => {
        for (const r of connectedEndpoints(sc, i, side)) {
          if (r.index === i) continue;
          const bothLoose = !attached.has(i) && !attached.has(r.index);
          if (bothLoose && levelAt(sc, i) === levelAt(sc, r.index)) continue;
          // Both attached: only if a chain of declarations ties these two ends.
          if (attached.has(i) && attached.has(r.index) && top(i * 2 + side) === top(r.index * 2 + r.side)) continue;
          stray.push(`${key}: ${s.id}.${side ? 'end' : 'start'} drags ${name(sc, r)}`);
        }
      });
    });
  }
  ok(lost.length === 0, `every declared attachment in ${samples} samples (${held} of them) still drags its parent` +
    (lost.length ? `\n         ${lost.slice(0, 5).join('\n         ')}` : ''));
  ok(stray.length === 0, 'no joint mixes an attached strand with one it is not attached to' +
    (stray.length ? `\n         ${stray.slice(0, 5).join('\n         ')}` : ''));
}

// ---- 3. a file with no attachments at all -------------------------------------
// An OSS file saved without `attached_to` has nothing but coincidence to say where
// its joints are, and it has to drag the way OSS does. Across a level break,
// though, a shared x, y is a projection and not a joint.
{
  const at = (x: number, y: number) => ({ x, y });
  const strand = (id: string, s: [number, number], e: [number, number]): Strand3D => ({
    id,
    start: at(...s),
    end: at(...e),
    control_points: [at(...s), at(...s)],
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
  const flat: Scene3D = {
    name: 'loose',
    masks: [],
    levelBreaks: [],
    strands: [strand('a', [0, 0], [100, 0]), strand('b', [100.5, 0.5], [200, 50]), strand('c', [300, 300], [400, 300])],
  };
  ok(same(joint(flat, 'a', 1), ['a.end', 'b.start']), 'two loose strands sharing a point drag together');
  ok(same(joint(flat, 'c', 0), ['c.start']), 'and a loose strand on its own drags alone');
  const stacked: Scene3D = { ...flat, levelBreaks: [1] };
  ok(same(joint(stacked, 'a', 1), ['a.end']), 'the same pair a level apart does not');
}

console.log(bad ? `\n${bad} failed` : '\nall passed');
if (bad) process.exit(1);
