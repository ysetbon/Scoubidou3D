// Checks the two-fan stitches against the 1xn reference they are built to.
//   npm run check:twofan
// Nothing here is fitted: twofan.ts derives its angles and extension ladders
// from the three construction rules, and this compares the result with the
// numbers measured off the reference's own drawings
// (docs/twist-stitch/attempts/1xn-reference/measured.json).
import { twoFanStitch, twoFanColumn, columnTurn, TWOFAN_FAMILY, TWOFAN_MAX, GAP, W } from '../src/model/twofan';

const REF: Record<number, { H: number; V: number; ext: number[] }> = {
  1: { H: 50.04, V: 140.04, ext: [0] },
  2: { H: 38.72, V: 117.15, ext: [39, 0] },
  3: { H: 33.32, V: 108.50, ext: [67, 0, 34] },
  4: { H: 29.89, V: 104.01, ext: [90, 0, 60, 30] },
  5: { H: 27.43, V: 101.27, ext: [109, 0, 82, 27, 55] },
  6: { H: 25.54, V: 99.42, ext: [127, 0, 102, 25, 76, 51] },
  7: { H: 24.02, V: 98.09, ext: [143, 0, 119, 24, 95, 48, 72] },
  8: { H: 22.77, V: 97.09, ext: [158, 0, 136, 23, 113, 45, 90, 68] },
};
const deg = (dx: number, dy: number) => (Math.atan2(dy, dx) * 180) / Math.PI;
const n180 = (a: number) => ((a % 180) + 180) % 180;

// do two segments actually cross?
const cross = (a: any, b: any) => {
  const d = (p: any, q: any, r: any) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const s1 = d(a.start, a.end, b.start), s2 = d(a.start, a.end, b.end);
  const s3 = d(b.start, b.end, a.start), s4 = d(b.start, b.end, a.end);
  return s1 * s2 < 0 && s3 * s4 < 0;
};

let bad = 0;
for (const sh of TWOFAN_FAMILY) {
  const sc = twoFanStitch(sh.m, sh.n, sh.key);
  const tw = sc.strands.slice(sc.levelBreaks[0]);
  const weft = tw.filter((s) => parseInt(s.id, 10) <= sh.n);
  const warp = tw.filter((s) => parseInt(s.id, 10) > sh.n);

  const fanOf = (g: typeof weft) => {
    const dirs = g.map((s) => n180(deg(s.end.x - s.start.x, s.end.y - s.start.y)));
    const th = (dirs.reduce((a, b) => a + b) / dirs.length) * (Math.PI / 180);
    const nx = -Math.sin(th), ny = Math.cos(th);
    const o = g.map((s) => s.start.x * nx + s.start.y * ny).sort((a, b) => a - b);
    return { par: Math.max(...dirs) - Math.min(...dirs), gaps: o.slice(1).map((v, i) => v - o[i]) };
  };
  const fw = fanOf(weft), fp = fanOf(warp);
  const r = REF[sh.n];
  // extensions: how far each weft arm sits past its nominal tip
  const armX = ((2 * sh.m - 1) * GAP) / 2 + 32;
  const ext = sc.strands
    .filter((s) => parseInt(s.id, 10) <= sh.n && /_[23]$/.test(s.id))
    .map((s) => Math.round(Math.abs(s.end.x - 400) - armX));
  const seen = new Set<number>();
  const uniq = ext.filter((e) => (seen.has(e) ? false : (seen.add(e), true)));

  // every weft twist strand must really cross every warp twist strand
  let miss = 0;
  for (const a of weft) for (const b of warp) if (!cross(a, b)) miss++;

  const dH = Math.abs(sh.weft - r.H), dV = Math.abs(sh.warp + 90 - r.V);
  const gapErr = Math.max(
    ...[...fw.gaps, ...fp.gaps].map((g) => Math.abs(g - GAP)),
  );
  // The reference's own ladder is uniform to +/-0.6 px (its 1x8 lists 136 where
  // its own step gives 135.4), so compare rung by rung with a 1 px tolerance.
  const mine = [...uniq].sort((a, b) => a - b);
  const theirs = [...new Set(r.ext)].sort((a, b) => a - b);
  const extErr = mine.length === theirs.length
    ? Math.max(...mine.map((e, i) => Math.abs(e - theirs[i])))
    : Infinity;
  const ok = dH < 0.03 && dV < 0.03 && gapErr < 1e-6 && miss === 0 && fw.par < 1e-9 && extErr <= 1;
  if (!ok) bad++;
  console.log(
    `1x${sh.n}  weft ${sh.weft.toFixed(2)}/${r.H}  warp ${(sh.warp + 90).toFixed(2)}/${r.V}` +
      `  gaps ${fw.gaps.length + fp.gaps.length}@${GAP} err ${gapErr.toExponential(1)}` +
      `  crossings ${weft.length * warp.length - miss}/${weft.length * warp.length}` +
      `  ext +-${extErr}px  ${ok ? 'ok' : 'FAIL'}`,
  );
}
console.log(
  `\n${TWOFAN_FAMILY.length} shapes, ${bad} failures.` +
    `  lace ${W}, gap ${GAP} = ${(GAP / W).toFixed(3)} w (floor is w + 10).`,
);

// ---- and the column, over the whole family -------------------------------
// A column repeats, so its levels are congruent, so both families turn by the
// same angle -- the reference's two cannot both survive. What is checked here is
// that the one a column CAN take still weaves: every crossing real, every fan
// parallel, every gap at the floor.
let miss = 0;
let gapErr = 0;
let skew = 0;
let levels = 0;
for (let m = 1; m <= TWOFAN_MAX; m++) {
  for (let n = 1; n <= TWOFAN_MAX; n++) {
    const sc = twoFanColumn(m, n, 4, 'x');
    for (let L = 0; L < sc.levelBreaks.length; L++) {
      levels++;
      const lo = sc.levelBreaks[L];
      const hi = sc.levelBreaks[L + 1] ?? sc.strands.length;
      const lvl = sc.strands.slice(lo, hi);
      const weft = lvl.filter((x) => parseInt(x.id, 10) <= n);
      const warp = lvl.filter((x) => parseInt(x.id, 10) > n);
      for (const p of weft) for (const q of warp) if (!cross(p, q)) miss++;
      for (const fam of [weft, warp]) {
        const dirs = fam.map((x) => n180(deg(x.end.x - x.start.x, x.end.y - x.start.y)));
        skew = Math.max(skew, Math.max(...dirs) - Math.min(...dirs));
        const th = (dirs[0] * Math.PI) / 180;
        const nx = -Math.sin(th);
        const ny = Math.cos(th);
        const o = fam.map((x) => x.start.x * nx + x.start.y * ny).sort((a, b) => a - b);
        for (let i = 1; i < o.length; i++) gapErr = Math.max(gapErr, Math.abs(o[i] - o[i - 1] - GAP));
      }
    }
  }
}
const colBad = miss > 0 || gapErr > 1e-8 || skew > 1e-8;
console.log(`\ncolumn, all ${TWOFAN_MAX * TWOFAN_MAX} faces x ${levels / (TWOFAN_MAX * TWOFAN_MAX)} levels:`);
console.log(`  missing crossings ${miss}   gap error ${gapErr.toExponential(1)} px   fan skew ${skew.toExponential(1)} deg`);
console.log(`  turn on the diagonal, where the reference has one angle and this IS it:`);
for (const k of [1, 2, 4, 8]) {
  console.log(`    ${k}x${k}  ${columnTurn(k, k).toFixed(2)} deg   (the old law said ${((Math.atan(1 / k) * 180) / Math.PI).toFixed(2)})`);
}
console.log(colBad ? '  FAIL' : '  all clear');
if (bad > 0 || colBad) process.exit(1);
