// What the turn costs, face by face.
//
//   npm run probe:turn                 report
//   npm run probe:turn -- --write      also refresh scripts/twofan-cost.json
//
// THE TRADE. A lopsided face has two candidate turns. The MINORITY fan's is the
// steepest the reference's 56 px offsets can carry: below it every arm spans its
// band outright. The MAJORITY fan's lays the family you see tight, which is what
// the face is judged on by eye, and is steeper than that on every lopsided shape.
//
// The column used to take the majority's and extend the short arms to cover the
// difference, which broke the fold and cost 1276 of 51840 crossings, with gaps
// running from 1.1 px to 229.8 px against a reference floor of 56 and ceiling of
// 69. It now takes a point between the two -- COLUMN_DIAL -- and pays for it by
// opening the gap INSIDE each lace instead, which the landing law turns into arm
// length for free. Nothing is extended and nothing is lost.
//
// So this script no longer measures a loss. It measures what the turn now costs in
// width: how far each family had to open, and how far the majority family's loosest
// arm still overhangs. Faces on the diagonal pay neither, because there the
// reference's two fans are the same angle.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  twoFanColumn, columnTurn, columnTurnRad, reachTurn, columnGaps, famOffsets,
  GAP, W, TWOFAN_MAX,
} from '../src/model/twofan';

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
  /** Gap inside one lace of each family, px — what the turn is bought with. */
  iw?: number; ip?: number;
}

/** How far the majority family's loosest arm hangs past its band, in widths, in
 *  the construction this turn actually builds. */
export function bigOvershoot(m: number, n: number, turn: number): number {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const inner = columnGaps(m, n, turn);
  const warp = m > n; // the majority family; at m === n either answers
  const mine = famOffsets(warp ? m : n, warp ? inner.warp : inner.weft);
  const band = Math.max(...famOffsets(warp ? n : m, warp ? inner.weft : inner.warp).map(Math.abs));
  let w = 0;
  for (let i = 0; i < mine.length; i++) {
    const sib = mine[i % 2 === 0 ? i + 1 : i - 1];
    w = Math.max(w, (Math.abs((sib - mine[i] * c) / ((warp ? 1 : -1) * s)) - band) / W);
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
      const inner = columnGaps(m, n, columnTurnRad(m, n));
      snap[`${m}x${n}`] = {
        ...c,
        turn: +columnTurn(m, n).toFixed(2),
        was: +reachTurn(m, n).toFixed(2),
        wasOver: +bigOvershoot(m, n, (reachTurn(m, n) * Math.PI) / 180).toFixed(2),
        iw: inner.weft,
        ip: inner.warp,
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
  const widest = Math.max(...Object.values(snap).map((f) => Math.max(f.iw ?? GAP, f.ip ?? GAP)));
  console.log(`\nmean overhang        ${(was / 64).toFixed(2)}w -> ${(now / 64).toFixed(2)}w   <- what the dial buys`);
  console.log(`crossings kept       ${kept}/${want}`);
  console.log(`faces weaving whole  ${whole}/64`);
  console.log(`faces opening nothing ${tidy}/64  -- the m = n faces, where the two fans are one angle`);
  console.log(`widest lace gap      ${widest} px = ${(widest / W).toFixed(2)}w   <- what the dial costs`);
  console.log(`\nThe dial is COLUMN_DIAL in twofan.ts. 0 is reachTurn() and opens nothing.`);
  if (process.argv.includes('--write')) {
    const note = JSON.parse(readFileSync('scripts/twofan-cost.json', 'utf8'))._;
    writeFileSync('scripts/twofan-cost.json', JSON.stringify({ _: note, faces: snap }, null, 0));
    console.log('\nwrote scripts/twofan-cost.json');
  }
}
