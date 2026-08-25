/**
 * Does the swept ribbon ever twist through itself between two rings?
 *
 * A turn rolls the strip right over: its legs are `(0, 0, +face)` going in and
 * `(0, 0, -face)` coming away (zturn.ts), because that is what a folded strap
 * does. The RUN either side carries no frame of its own, so `upOf` gives it a
 * thickness axis pointing broadly at +Z — and at the one sample where a leg
 * meets a run, the axis can reverse outright. `side` is `up x tan`, so it goes
 * with it: the section is the same shape, rotated a half turn about the path,
 * while ring vertex j is still numbered j.
 *
 * The strip laid between those two rings then joins each vertex to the one
 * diametrically opposite it — a full twist in one step. The surface wrings
 * itself through its own axis and the lace reads as CUT: a clean gap across the
 * ribbon, mid-run, nowhere near anything that should be a crease.
 *
 * `buildRibbonGeometry` answers the roll the way it already answers a heading
 * reversal — keep walking the section, but from the vertex a half turn round.
 * This checks the result geometrically, on the built mesh: corresponding
 * vertices of consecutive rings must stay NEAR each other. A twist moves them
 * the width of the lace apart, so the two cases are nowhere near each other and
 * the threshold is not delicate.
 *
 * It also asserts the frame really does roll somewhere in each case, so the
 * check cannot pass by testing a lace that never had the problem.
 */
import { buildRibbonGeometry, crossSection } from '../src/geometry/ribbon';
import { easeFolds, easeSteps, roundCorners, zFolds, foldsOf } from '../src/geometry/polyline';
import type { Vec3 } from '../src/geometry/vec';

const T = 0.52; // one thickness, world units — the studio's own at ribbon 26
const WIDTH = 1.08;
const STEP = 0.19; // in-plane sample spacing, as the studio samples centrelines
const LEG = WIDTH * (0.95 / 1.1); // LEG_PER_WIDTH, as StrandScene passes it
const CORNER_STEPS = 3;

/** A lace running in, doubling back at `sepDeg` from dead reverse, and running
 *  out again, with the two runs `stepT` thicknesses apart. `n` samples a side —
 *  long enough that a real run survives on both sides of the turn's legs. */
function foldedLace(sepDeg: number, stepT: number, n: number): Vec3[] {
  const out: Vec3[] = [];
  const back = (180 - sepDeg) * (Math.PI / 180);
  const b = { x: -Math.cos(back - Math.PI), y: Math.sin(back - Math.PI) };
  const zB = stepT * T;
  for (let i = n; i >= 1; i--) out.push({ x: -i * STEP, y: 0, z: 0 });
  out.push({ x: 0, y: 0, z: zB / 2, zIn: 0, zOut: zB });
  for (let i = 1; i <= n; i++) out.push({ x: b.x * i * STEP, y: b.y * i * STEP, z: zB });
  return out;
}

/** The studio's own pre-sweep pipeline, in the order buildMergedLaces runs it. */
function prepare(line: Vec3[]): Vec3[] {
  easeFolds(line, T * 2, T * 2);
  easeSteps(line, WIDTH);
  const rounded = roundCorners(line, WIDTH * 0.5);
  zFolds(rounded, LEG);
  return rounded;
}

const upOf = (t: { x: number; y: number }, slope: number) => {
  const k = 1 / Math.hypot(1, slope);
  return { x: -t.x * slope * k, y: -t.y * slope * k, z: k };
};

/** How many samples of this prepared line reverse their thickness axis outright
 *  — the thing the sweep has to survive. Mirrors ribbon.ts's own frame rules. */
function rollsIn(line: Vec3[]): number {
  const pts: Vec3[] = [];
  for (const p of line) {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) <= 1e-6) continue;
    pts.push({ ...p });
  }
  const n = pts.length;
  const ups = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    if (!p.up) {
      let tx = b.x - a.x;
      let ty = b.y - a.y;
      const l = Math.hypot(tx, ty);
      if (l < 1e-9) { tx = 1; ty = 0; } else { tx /= l; ty /= l; }
      const run = Math.hypot(b.x - a.x, b.y - a.y);
      return upOf({ x: tx, y: ty }, run < 1e-9 ? 0 : (b.z - a.z) / run);
    }
    const tan = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const tl = Math.hypot(tan.x, tan.y, tan.z) || 1;
    tan.x /= tl; tan.y /= tl; tan.z /= tl;
    const d = p.up.x * tan.x + p.up.y * tan.y + p.up.z * tan.z;
    const q = { x: p.up.x - tan.x * d, y: p.up.y - tan.y * d, z: p.up.z - tan.z * d };
    const ql = Math.hypot(q.x, q.y, q.z);
    return ql > 1e-6 ? { x: q.x / ql, y: q.y / ql, z: q.z / ql } : p.up;
  });
  let rolls = 0;
  for (let i = 1; i < n; i++) {
    if (ups[i].x * ups[i - 1].x + ups[i].y * ups[i - 1].y + ups[i].z * ups[i - 1].z < 0) rolls++;
  }
  return rolls;
}

/** The furthest any ring vertex travels to the next ring, over the whole sweep.
 *  A sane sweep keeps this near the sample spacing; a twist takes it to the
 *  section's own diameter. */
function worstVertexTravel(line: Vec3[]): { travel: number; at: number; rings: number } {
  const geom = buildRibbonGeometry(line, {
    width: WIDTH,
    thickness: T,
    cornerRadius: T * 0.48,
    cornerSteps: CORNER_STEPS,
    roundCaps: true,
  });
  const pos = geom.getAttribute('position')!;
  const m = crossSection(WIDTH, T, T * 0.48, CORNER_STEPS).length;
  const pts: Vec3[] = [];
  for (const p of line) {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) <= 1e-6) continue;
    pts.push({ ...p });
  }
  const nRings = pts.length + foldsOf(pts).filter((f) => !pts[f.index].up).length;
  const V = (r: number, j: number) => {
    const k = r * m + j;
    return { x: pos.getX(k), y: pos.getY(k), z: pos.getZ(k) };
  };
  let travel = 0;
  let at = -1;
  for (let r = 0; r < nRings - 1; r++) {
    for (let j = 0; j < m; j++) {
      const a = V(r, j);
      const b = V(r + 1, j);
      const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (d > travel) { travel = d; at = r; }
    }
  }
  return { travel, at, rings: nRings };
}

let failures = 0;
function assert(ok: boolean, what: string): void {
  if (ok) console.log(`  PASS  ${what}`);
  else { failures++; console.log(`  FAIL  ${what}`); }
}

// A twist moves a vertex the section's own diameter; a sane step moves it about
// the sample spacing. Anything under half the lace's width is unambiguously the
// first case, and the sweep's real worst is an order below that.
const LIMIT = WIDTH / 2;

console.log(`sample spacing ${STEP}; a twist would move a vertex about ${Math.hypot(WIDTH, T).toFixed(2)}; limit ${LIMIT}\n`);

let rolledCases = 0;
let worstOverall = 0;
for (const sep of [0, 12, 25, 48, 60, 90]) {
  for (const stepT of [0.3, 1, 1.5, 2, 3]) {
    for (const n of [14, 30]) {
      const line = prepare(foldedLace(sep, stepT, n));
      const rolls = rollsIn(line);
      if (rolls > 0) rolledCases++;
      const w = worstVertexTravel(line);
      if (w.travel > worstOverall) worstOverall = w.travel;
      if (w.travel > LIMIT) {
        assert(false, `sep ${sep}°, step ${stepT}t, ${n} samples a side: vertex travels ${w.travel.toFixed(3)} between rings ${w.at} and ${w.at + 1} (${rolls} roll(s))`);
      }
    }
  }
}

assert(rolledCases > 0, `the frame really does roll somewhere — ${rolledCases} of the cases carry a reversal, so this is not passing vacuously`);
assert(worstOverall <= LIMIT, `no ring pair twists through itself — worst vertex travel ${worstOverall.toFixed(3)} against a limit of ${LIMIT}`);

console.log(`\n${failures === 0 ? 'all clear' : `${failures} FAILED`}`);
if (failures) process.exit(1);
