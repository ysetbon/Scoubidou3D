// What the majority-fan turn costs, face by face -- and the turn that would cost
// nothing, for comparison.
//
//   npm run probe:turn                 report
//   npm run probe:turn -- --write      also refresh scripts/twofan-cost.json
//
// THE TRADE. A lopsided face has two candidate turns. The MINORITY fan's keeps
// every crossing real and every gap at the floor, and hands the majority family an
// arm several widths longer than the shallow band it crosses -- six on a 1x5 -- so
// the overhang bundles up on two sides of every level. The MAJORITY fan's lays that
// family tight, which is what the face is judged on by eye, and is what ships.
//
// It is not free, and the point of this script is that the price is measured rather
// than argued. Past the minority turn the minority arms stop reaching across the
// majority band; the generator extends them to compensate; crossings stop being
// real and the level's gaps stop being equal. Some open -- 167.6 px on a 1x5 against
// a ceiling of 69. Some CLOSE: 1.1 px on a 4x8, which is two 46 px laces nearly on
// top of each other. Faces on the diagonal pay nothing, because there the
// reference's two fans are the same angle.
import { readFileSync, writeFileSync } from 'node:fs';
import { twoFanColumn, columnTurn, columnTurnRad, reachTurn, GAP, W, TWOFAN_MAX } from '../src/model/twofan';

const seg = (a: any, b: any): boolean => {
  const d = (p: any, q: any, r: any) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return d(a.start, a.end, b.start) * d(a.start, a.end, b.end) < 0 &&
         d(b.start, b.end, a.start) * d(b.start, b.end, a.end) < 0;
};
const n180 = (a: number): number => ((a % 180) + 180) % 180;

export interface FaceCost {
  kept: number; want: number; gmin: number; gmax: number; over: number;
  /** The shipped turn and the overhang, against what the minority fan would give. */
  turn?: number; was?: number; wasOver?: number;
}

/** How far the majority family's loosest arm hangs past its band, in widths. */
export function bigOvershoot(m: number, n: number, turn: number): number {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const cnt = Math.max(m, n);
  const warp = m > n;
  const band = (Math.min(m, n) - 0.5) * GAP;
  let w = 0;
  for (let i = 0; i < 2 * cnt; i++) {
    const off = (cnt - 0.5 - i) * GAP;
    const sib = (cnt - 0.5 - (i % 2 === 0 ? i + 1 : i - 1)) * GAP;
    w = Math.max(w, (Math.abs((sib - off * c) / ((warp ? 1 : -1) * s)) - band) / W);
  }
  return w;
}

/** Crossings kept, and the tightest and widest gap in any level, at the shipped turn. */
export function faceCost(m: number, n: number, turn?: number): FaceCost {
  const sc = twoFanColumn(m, n, 4, 'probe', 'lh', turn);
  let want = 0;
  let kept = 0;
  let gmin = Infinity;
  let gmax = 0;
  for (let L = 0; L < sc.levelBreaks.length; L++) {
    const a = sc.levelBreaks[L];
    const b = sc.levelBreaks[L + 1] ?? sc.strands.length;
    const lvl = sc.strands.slice(a, b);
    const weft = lvl.filter((x) => parseInt(x.id, 10) <= n);
    const warp = lvl.filter((x) => parseInt(x.id, 10) > n);
    for (const p of weft) for (const q of warp) { want++; if (seg(p, q)) kept++; }
    for (const fam of [weft, warp]) {
      const th = (n180((Math.atan2(fam[0].end.y - fam[0].start.y, fam[0].end.x - fam[0].start.x) * 180) / Math.PI) * Math.PI) / 180;
      const nx = -Math.sin(th);
      const ny = Math.cos(th);
      const o = fam.map((x) => x.start.x * nx + x.start.y * ny).sort((p, q) => p - q);
      for (let i = 1; i < o.length; i++) { gmin = Math.min(gmin, o[i] - o[i - 1]); gmax = Math.max(gmax, o[i] - o[i - 1]); }
    }
  }
  return { kept, want, gmin: +gmin.toFixed(1), gmax: +gmax.toFixed(1), over: +bigOvershoot(m, n, turn ?? columnTurnRad(m, n)).toFixed(2) };
}

if (process.argv[1]?.includes('probe-turn')) {
  const snap: Record<string, FaceCost> = {};
  let whole = 0;
  let tidy = 0;
  let kept = 0;
  let want = 0;
  let now = 0;
  let was = 0;
  const rows: string[] = [];
  for (let m = 1; m <= TWOFAN_MAX; m++) {
    for (let n = 1; n <= TWOFAN_MAX; n++) {
      const c = faceCost(m, n);
      snap[`${m}x${n}`] = {
        ...c,
        turn: +columnTurn(m, n).toFixed(2),
        was: +reachTurn(m, n).toFixed(2),
        wasOver: +bigOvershoot(m, n, (reachTurn(m, n) * Math.PI) / 180).toFixed(2),
      };
      if (c.kept === c.want) whole++;
      if (Math.abs(c.gmin - GAP) < 1e-6 && Math.abs(c.gmax - GAP) < 1e-6) tidy++;
      kept += c.kept; want += c.want;
      now += c.over;
      was += bigOvershoot(m, n, (reachTurn(m, n) * Math.PI) / 180);
      if ([[1, 1], [1, 3], [1, 5], [1, 8], [2, 5], [3, 7], [4, 8], [8, 8]].some(([p, q]) => p === m && q === n))
        rows.push(`${(m + 'x' + n).padEnd(7)}${(reachTurn(m, n).toFixed(2) + ' -> ' + columnTurn(m, n).toFixed(2)).padEnd(18)}` +
          `${(bigOvershoot(m, n, (reachTurn(m, n) * Math.PI) / 180).toFixed(2) + 'w -> ' + c.over + 'w').padEnd(20)}` +
          `${(c.kept + '/' + c.want).padEnd(14)}${c.gmin}..${c.gmax}`);
    }
  }
  console.log(`${'face'.padEnd(7)}${'turn was -> now'.padEnd(18)}${'overhang was -> now'.padEnd(20)}${'crossings'.padEnd(14)}gaps`);
  console.log(rows.join('\n'));
  console.log(`\nmean overhang        ${(was / 64).toFixed(2)}w -> ${(now / 64).toFixed(2)}w   <- what the retune buys`);
  console.log(`crossings kept       ${kept}/${want}`);
  console.log(`faces weaving whole  ${whole}/64   (was 64/64)`);
  console.log(`faces all gaps at 56 ${tidy}/64   (was 64/64 -- these are the m = n faces, which pay nothing)`);
  console.log(`\nThe minority fan is the turn that costs none of this. It is in reachTurn().`);
  if (process.argv.includes('--write')) {
    const note = JSON.parse(readFileSync('scripts/twofan-cost.json', 'utf8'))._;
    writeFileSync('scripts/twofan-cost.json', JSON.stringify({ _: note, faces: snap }, null, 0));
    console.log('\nwrote scripts/twofan-cost.json');
  }
}
