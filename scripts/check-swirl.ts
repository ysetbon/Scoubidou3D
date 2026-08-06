// The swirl stitch against the reference's own numbers.
//
// Three things are asserted, over all 64 sizes in both hands:
//
//   1. the block is the twist's block — same rows, same columns, same poke
//   2. every gap in both fans lands on the target, to 1e-9 px
//   3. the corner margin never falls below the floor Case C builds to
//
// The gap test is the reference aligner's own: a gap is the difference of the
// perpendicular coordinate W = x·sin θ − y·cos θ taken at two consecutive
// extended starts, and the sign has to hold all the way along or the strand
// order has folded back on itself.

import { GAP, Hand, POKE, W } from '../src/model/twofan';
import {
  SWIRL_CORNER_FLOOR,
  SWIRL_FAMILY,
  SWIRL_GAP,
  SWIRL_MAX,
  swirlHorizontalArms,
  swirlSolve,
  swirlStitch,
  swirlVerticalArms,
} from '../src/model/swirl';

const RAD = Math.PI / 180;
const HANDS: Hand[] = ['lh', 'rh'];

function pairIndex(N: number): number[] {
  const q = new Array<number>(N).fill(0);
  const half = Math.floor(N / 2);
  for (let i = 0; i < half; i++) {
    q[i] = i;
    q[N - 1 - i] = i;
  }
  if (N % 2) q[half] = half;
  return q;
}

/** The extended starts of one fan, in gap order, off the built scene. */
function feet(scene: ReturnType<typeof swirlStitch>, ids: string[]): Array<{ x: number; y: number }> {
  const by: Record<string, { x: number; y: number }> = {};
  for (const s of scene.strands) by[s.id] = { x: s.start.x, y: s.start.y };
  return ids.map((id) => by[id]);
}

/** Every gap in a fan: consecutive extended starts, measured across the fan. */
function gapsOf(pts: Array<{ x: number; y: number }>, angleDeg: number): number[] {
  const th = angleDeg * RAD;
  const sn = Math.sin(th);
  const cs = Math.cos(th);
  const w = pts.map((p) => p.x * sn - p.y * cs);
  const out: number[] = [];
  for (let i = 0; i < w.length - 1; i++) out.push(w[i + 1] - w[i]);
  return out;
}

let bad = 0;
let worstGap = 0;
let worstGapAt = '';
let worstBlock = 0;
let tightest = Infinity;
let tightestAt = '';

for (const hand of HANDS) {
  for (const shape of SWIRL_FAMILY) {
    const { m, n } = shape;
    const sol = swirlSolve(m, n)!;
    const scene = swirlStitch(m, n, 'check', hand);
    const tag = `${hand} ${m}x${n}`;

    // 1 — the block is the twist's block
    const cx = 400;
    const cy = 300;
    const flip = (x: number) => (hand === 'rh' ? 2 * cx - x : x);
    const wantRow = (i: number) => cy + (i - (2 * n - 1) / 2) * GAP;
    const wantCol = (j: number) => flip(cx + (j - (2 * m - 1) / 2) * GAP);
    const by: Record<string, (typeof scene.strands)[number]> = {};
    for (const s of scene.strands) by[s.id] = s;
    let blockErr = 0;
    for (let p = 0; p < n; p++) {
      blockErr = Math.max(blockErr, Math.abs(by[`${p + 1}_1`].end.y - wantRow(2 * p)));
      blockErr = Math.max(blockErr, Math.abs(by[`${p + 1}_1`].start.y - wantRow(2 * p + 1)));
    }
    for (let q = 0; q < m; q++) {
      blockErr = Math.max(blockErr, Math.abs(by[`${n + q + 1}_1`].end.x - wantCol(2 * q)));
      blockErr = Math.max(blockErr, Math.abs(by[`${n + q + 1}_1`].start.x - wantCol(2 * q + 1)));
    }
    worstBlock = Math.max(worstBlock, blockErr);

    // 2 — every gap on target, in both fans
    const hIds = swirlHorizontalArms(m, n);
    const vIds = swirlVerticalArms(m, n);
    const hAngle = hand === 'rh' ? 180 - sol.hAngle : sol.hAngle;
    const vAngle = hand === 'rh' ? -sol.vAngle : sol.vAngle;
    const hGaps = gapsOf(feet(scene, hIds), hAngle);
    const vGaps = gapsOf(feet(scene, vIds), vAngle);
    const all = [...hGaps, ...vGaps];
    const gapErr = all.length ? Math.max(...all.map((g) => Math.abs(Math.abs(g) - SWIRL_GAP))) : 0;
    const signOk =
      hGaps.every((g) => g > 0) ||
      hGaps.every((g) => g < 0)
        ? vGaps.every((g) => g > 0) || vGaps.every((g) => g < 0)
        : false;
    if (gapErr > worstGap) {
      worstGap = gapErr;
      worstGapAt = tag;
    }

    // 3 — the corner: which side of the opposite fan's starts the outside pair runs
    const perp = (p: { x: number; y: number }, a: number) =>
      p.x * Math.sin(a * RAD) - p.y * Math.cos(a * RAD);
    const margins: number[] = [];
    const oneWay = (
      band: Array<{ x: number; y: number }>,
      bandAngle: number,
      other: Array<{ x: number; y: number }>,
    ) => {
      const e0 = perp(band[0], bandAngle);
      const e1 = perp(band[band.length - 1], bandAngle);
      const lo = Math.min(e0, e1);
      const hi = Math.max(e0, e1);
      for (const p of other) {
        const w = perp(p, bandAngle);
        margins.push(Math.abs(w - lo) <= Math.abs(w - hi) ? lo - w : w - hi);
      }
    };
    oneWay(feet(scene, hIds), hAngle, feet(scene, vIds));
    if (pairIndex(vIds.length).length > 1 && m > 1) {
      oneWay(feet(scene, vIds), vAngle, feet(scene, hIds));
    }
    const corner = margins.length ? Math.min(...margins) : Infinity;
    if (corner < tightest) {
      tightest = corner;
      tightestAt = tag;
    }

    const ok = blockErr < 1e-9 && gapErr < 1e-9 && signOk && corner >= SWIRL_CORNER_FLOOR - 1e-4;
    if (!ok) {
      bad++;
      console.log(
        `  FAIL ${tag}  block ${blockErr.toExponential(1)}  gap ${gapErr.toExponential(1)}` +
          `  order ${signOk ? 'ok' : 'folds back'}  corner ${corner.toFixed(4)}`,
      );
    }
  }
}

console.log(`swirl stitch, k = -1, ${SWIRL_FAMILY.length} sizes x ${HANDS.length} hands:`);
console.log(`  block matches the twist's        ${worstBlock.toExponential(1)} px`);
console.log(`  worst gap off ${SWIRL_GAP} px          ${worstGap.toExponential(1)} px  (${worstGapAt})`);
console.log(`  tightest corner anywhere         ${tightest.toFixed(4)} px  (${tightestAt}), floor is ${SWIRL_CORNER_FLOOR}`);
console.log(`  lace ${W}, gap ${GAP} floor, poke ${POKE}, sizes to ${SWIRL_MAX}`);
console.log(bad === 0 ? '  all clear' : `  ${bad} failures`);
if (bad !== 0) process.exit(1);
