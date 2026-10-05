// Holds the curve to what OpenStrand Studio itself draws:
//   npm run check:curve
//
// scripts/oss-curves.json is OSS's own QPainterPath for every strand of four of
// its sample files, recorded by running OSS's Strand / AttachedStrand classes
// (scripts/oss-curve-fixtures.py). Each file is imported here the way the app
// imports it, and the profile bezier.ts builds has to land on OSS's path — every
// Bézier handle, to a millionth of a pixel.
//
// It exists because the port once looked faithful and was not: the formulas were
// OSS's, but the curve tuning was a set of numbers OSS never draws with, the
// attached-strand formula was missing and the bias was dropped. Every bent strand
// came out about four times flatter than on the desktop, and nothing failed.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildProfile, CURVE, Profile } from '../src/geometry/bezier';
import { curveInput } from '../src/model/controlPoints';
import { sceneFromOss } from '../src/model/importOss';
import { parseSceneText, sceneToJson } from '../src/model/sceneIO';
import { Point } from '../src/model/types';

type El = [number, number, number];
interface Fixture {
  curve: [number, number, number];
  files: { file: string; strands: unknown[]; oss: { layer: string; elements: El[] }[] }[];
}

let bad = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) bad++;
  console.log(`${cond ? '   ok ' : '  FAIL'}  ${what}`);
};

// Relative to where npm run puts you, which is the repo root: the script is
// bundled to a temp file before it runs, so its own path is no help here.
const fx: Fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/oss-curves.json'), 'utf8'));

// The tuning the fixture was recorded under IS the default here.
ok(
  CURVE.base_fraction === fx.curve[0] && CURVE.dist_multiplier === fx.curve[1] && CURVE.exponent === fx.curve[2],
  `CURVE is OSS's shipped tuning (${fx.curve.join(' / ')})`,
);

/** A profile as the QPainterPath OSS builds from it. */
function elements(start: Point, end: Point, p: Profile): El[] {
  const out: El[] = [[0, start.x, start.y]];
  if (p.mode === 'line') out.push([1, end.x, end.y]);
  else for (const s of p.segments) out.push([2, s.cp1.x, s.cp1.y], [3, s.cp2.x, s.cp2.y], [3, s.p3.x, s.p3.y]);
  return out;
}

function gap(a: El[], b: El[]): number {
  if (a.length !== b.length) return Infinity;
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0]) return Infinity;
    worst = Math.max(worst, Math.hypot(a[i][1] - b[i][1], a[i][2] - b[i][2]));
  }
  return worst;
}

/** Points along a path, cubic by cubic. */
function trace(els: El[], steps = 64): Point[] {
  const pts: Point[] = [{ x: els[0][1], y: els[0][2] }];
  for (let i = 1; i < els.length; ) {
    const p0 = pts[pts.length - 1];
    if (els[i][0] === 1) {
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        pts.push({ x: p0.x + (els[i][1] - p0.x) * t, y: p0.y + (els[i][2] - p0.y) * t });
      }
      i += 1;
      continue;
    }
    const [c1, c2, p3] = [els[i], els[i + 1], els[i + 2]];
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      pts.push({ x: a * p0.x + b * c1[1] + c * c2[1] + d * p3[1], y: a * p0.y + b * c1[2] + c * c2[2] + d * p3[2] });
    }
    i += 3;
  }
  return pts;
}

/** How far apart two drawn paths ever get (both ways round), whatever cubics
 *  they are written as. */
function shapeGap(a: El[], b: El[]): number {
  const one = (p: Point[], q: Point[]) => {
    let worst = 0;
    for (const x of p) {
      let best = Infinity;
      for (let i = 1; i < q.length; i++) {
        const [u, v] = [q[i - 1], q[i]];
        const dx = v.x - u.x, dy = v.y - u.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((x.x - u.x) * dx + (x.y - u.y) * dy) / len2)) : 0;
        best = Math.min(best, Math.hypot(x.x - (u.x + dx * t), x.y - (u.y + dy * t)));
      }
      worst = Math.max(worst, best);
    }
    return worst;
  };
  const [p, q] = [trace(a), trace(b)];
  return Math.max(one(p, q), one(q, p));
}

for (const f of fx.files) {
  // Through the app's own importer, so lineage (which class OSS drew it with)
  // and the bias come from the same reading the 3D view gets.
  const scene = sceneFromOss({ strands: f.strands }, f.file);
  // ...and back out through a save, which has to keep both. A save is allowed
  // to re-encode a strand that is straight anyway (normalizeControlPoints puts a
  // straight strand back on its default handles, which OSS draws as a line rather
  // than as two flat cubics), so here it is the DRAWN path that has to match.
  const saved = parseSceneText(sceneToJson(scene));
  const runs = [
    ['imported', scene, gap],
    ['saved and reloaded', saved, shapeGap],
  ] as const;
  for (const [label, sc, measure] of runs) {
    const byId = new Map(sc.strands.map((s) => [s.id, s]));
    let worst = 0;
    let miss = '';
    for (const o of f.oss) {
      const s = byId.get(o.layer);
      if (!s) {
        miss = o.layer;
        worst = Infinity;
        continue;
      }
      const d = measure(elements(s.start, s.end, buildProfile(curveInput(s, true))), o.elements);
      if (d > worst) {
        worst = d;
        miss = o.layer;
      }
    }
    ok(worst < 1e-6, `${f.file} ${label}: ${f.oss.length} strands on OSS's path (worst ${worst.toExponential(1)}${worst >= 1e-6 ? ` at ${miss}` : ''})`);
  }
}

// The third control point off: a locked centre is ignored, not lost, and the
// strand falls back to OSS's two-handle curve.
{
  const braid = fx.files.find((f) => f.file.endsWith('three_strand_braid.json'))!;
  const s = sceneFromOss({ strands: braid.strands }).strands.find((x) => x.control_point_center_locked)!;
  const off = buildProfile(curveInput(s, false));
  const asTwo = buildProfile({ ...curveInput(s, true), control_point_center_locked: false });
  ok(gap(elements(s.start, s.end, off), elements(s.start, s.end, asTwo)) === 0, 'third control point off: the centre is ignored');
  ok(s.control_point_center !== null, 'third control point off: the centre is kept');
}

// A record with no control points is OSS's fresh strand — both on the start.
{
  const s = sceneFromOss({ strands: [{ type: 'Strand', layer_name: '1_1', start: { x: 0, y: 0 }, end: { x: 300, y: 40 } }] })
    .strands[0];
  ok(buildProfile(curveInput(s, true)).mode === 'line', 'no control points on file: a straight strand');
}

if (bad) {
  console.log(`\n${bad} check(s) failed`);
  process.exit(1);
}
console.log('\nall curve checks passed');
