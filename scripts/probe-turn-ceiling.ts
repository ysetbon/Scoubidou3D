// Is the shipped turn the largest one a two-fan column can take? Yes -- but only
// because of the gap floor, and that is worth being able to re-run.
//
//   npm run probe:turn
//
// A search on CROSSINGS ALONE reports a great deal of headroom: 11.26 -> 23.70
// degrees on a 1x5, 50.03 -> 79.38 on a 1x1, with every weft strand still really
// crossing every warp strand. Tightening the majority side by that much would
// halve its overhang, which is the whole open problem, so it looks like the fix.
//
// It is not. Every degree of it is bought by breaking the fan. Past the shipped
// turn the minority arms stop reaching across the majority band, the generator
// extends them to compensate, and the level stops having equal gaps: on a 1x5 at
// the majority family's own 27.44 degrees they run 56 to 167.6 px, against a floor
// of 56 and a ceiling of 69. That is holes, not a weave. Add "gaps still g" to the
// predicate and the headroom is exactly zero on all 64 faces.
//
// So the overhang on a lopsided face is not a slack a better turn removes. Both
// families own two lines one gap apart, so both arms are the same length,
// g/sin(turn); the turn is the largest the gap floor allows; and the majority
// family is left holding the difference between that and the shallow band it has
// to cross.
import { twoFanColumn, fan, columnTurn, GAP, W, POKE, TWOFAN_MAX } from '../src/model/twofan';

const seg = (a: any, b: any): boolean => {
  const d = (p: any, q: any, r: any) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return d(a.start, a.end, b.start) * d(a.start, a.end, b.end) < 0 &&
         d(b.start, b.end, a.start) * d(b.start, b.end, a.end) < 0;
};
const n180 = (a: number): number => ((a % 180) + 180) % 180;

/** The three things a level has to be. Checking only the first is the trap. */
export function levelOk(m: number, n: number, turn: number): { cross: boolean; gaps: boolean } {
  const sc = twoFanColumn(m, n, 3, 'probe', 'lh', turn);
  let cross = true;
  let gaps = true;
  for (let L = 0; L < sc.levelBreaks.length; L++) {
    const a = sc.levelBreaks[L];
    const b = sc.levelBreaks[L + 1] ?? sc.strands.length;
    const lvl = sc.strands.slice(a, b);
    const weft = lvl.filter((x) => parseInt(x.id, 10) <= n);
    const warp = lvl.filter((x) => parseInt(x.id, 10) > n);
    for (const p of weft) for (const q of warp) if (!seg(p, q)) cross = false;
    for (const fam of [weft, warp]) {
      const dirs = fam.map((x) => n180((Math.atan2(x.end.y - x.start.y, x.end.x - x.start.x) * 180) / Math.PI));
      const th = (dirs[0] * Math.PI) / 180;
      const nx = -Math.sin(th);
      const ny = Math.cos(th);
      const o = fam.map((x) => x.start.x * nx + x.start.y * ny).sort((p, q) => p - q);
      for (let i = 1; i < o.length; i++) if (Math.abs(o[i] - o[i - 1] - GAP) > 1e-6) gaps = false;
    }
  }
  return { cross, gaps };
}

/** Largest turn satisfying `pred`, climbing from the shipped turn until it breaks. */
function ceiling(m: number, n: number, pred: (t: number) => boolean): number {
  const base = fan(Math.min(m, n), (2 * Math.max(m, n) - 1) * GAP + 2 * POKE).turn;
  if (!pred(base)) return base;
  let lo = base;
  let hi = base;
  for (let i = 0; i < 24 && pred(hi); i++) { lo = hi; hi = Math.min(hi * 1.25 + 0.01, Math.PI / 2); }
  if (pred(hi)) return hi;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (pred(mid)) lo = mid; else hi = mid; }
  return lo;
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

const D = (r: number): number => (r * 180) / Math.PI;
console.log("largest turn a face can take, under two different ideas of 'can'");
console.log(`${'face'.padEnd(8)}${'shipped'.padEnd(10)}${'crossings only'.padEnd(20)}${'+ gaps still 56'}`);
let loose = 0;
let strict = 0;
for (let m = 1; m <= TWOFAN_MAX; m++) {
  for (let n = 1; n <= TWOFAN_MAX; n++) {
    const base = (columnTurn(m, n) * Math.PI) / 180;
    const a = ceiling(m, n, (t) => levelOk(m, n, t).cross);
    const b = ceiling(m, n, (t) => { const r = levelOk(m, n, t); return r.cross && r.gaps; });
    if (D(a) - D(base) > 0.01) loose++;
    if (D(b) - D(base) > 0.01) strict++;
    if ([[1, 1], [1, 5], [1, 8], [3, 7], [8, 8]].some(([p, q]) => p === m && q === n)) {
      console.log(`${(m + 'x' + n).padEnd(8)}${(D(base).toFixed(2) + '\u00b0').padEnd(10)}` +
        `${(D(a).toFixed(2) + '\u00b0  (+' + (D(a) - D(base)).toFixed(2) + ')').padEnd(20)}` +
        `${D(b).toFixed(2)}\u00b0  (+${(D(b) - D(base)).toFixed(2)})`);
    }
  }
}
console.log(`\nfaces with headroom on crossings alone : ${loose} of 64`);
console.log(`faces with headroom once gaps must hold: ${strict} of 64`);
console.log(`\nthe shipped turn is already the largest the gap floor allows.`);
