// The swirl stitch — the two-fan block worked at k = −1.
//
// A box stitch is the starting stitch at k = 0: every loose end pairs with the
// end straight opposite. A twist is k = +1. This is the same block again with
// the twist the other way, and the difference is not a mirror — a mirror is the
// other hand. What k = −1 changes is WHICH loose end joins which fan:
//
//   at k = +1  a set's two ends both join its own family's fan, so every arm in
//              a fan leaves the block along the same axis
//   at k = −1  a set's ends split between the two fans, so one fan holds arms
//              leaving along both axes
//
// So the block here is `twoFanStitch`'s block unchanged — same 56 px pitch, same
// 32 px poke, same over/unders — and everything below is about the continuation:
// which arm joins which fan, the angle each fan runs at, and how far each pair
// slides out before it leaves.
//
// THE CONSTRUCTION. Both fans keep every gap equal, and the palindrome of gap
// equations that pins them leaves two unknowns free per fan — p distinct
// equations against p + 2 unknowns. Fixing the shared angle and the gap
// telescopes every pair extension out of the middle pair, one subtraction at a
// time. `swirlSolve` is that closed form, in three cases:
//
//   A  1 × 1, the exact 45° stitch, g = √2(32 + E)
//   B  a multi-pair fan, angle pinned by the cone edge — the angle at which the
//      shallowest pair empties to exactly zero
//   C  the one-pair boundary (n = 1 or m = 1), where solving directly returns the
//      member the corner check rejects, so the corner floor is taken as an INPUT
//      and the arm extends by exactly what reaches it
//
// Checked against the reference's own numbers by `npm run check:swirl`: the
// block matches the twist's exactly, every gap lands on its target to 5e-13 px
// over all 63 sizes in both hands, and no corner falls below the floor.
//
// 1 x 1 is not here. Its k only runs 0 ... 1, so it has no k = -1 at all — the
// reference shows it at the single twist it has instead.
//
// NOT HERE: the column. A twist carries up ten levels by rotating the whole
// stitch a level at a time (`twoFanColumn`), an arm's worked end being its
// sibling's start one storey up. That fold does not carry over as-is — searching
// every correspondence of a 2 × 1's six arms against every turn finds nothing
// that closes about the block centre with all arms running forward. So this
// module stops where the reference stops: the block, and one continuation.

import { MaskLink, Point, RGBA, Scene3D, Strand3D } from './types';
import { GAP, Hand, HANDS, INDIGO, POKE, TWOFAN_MAX, W, WEFT, mk } from './twofan';

export const SWIRL_MAX = TWOFAN_MAX;

/** The gap every lace in the stitch is laid to, in px. */
export const SWIRL_GAP = 56.01;
/**
 * The corner floor the one-pair boundary is built to, in px.
 *
 * Not a threshold something is checked against afterwards — the number Case C
 * extends the outer arm to reach, so the floor is hit exactly rather than
 * cleared by luck. 16 px is what the reference's own configurations sit on.
 */
export const SWIRL_CORNER_FLOOR = 16;

export const swirlKey = (hand: Hand, m: number, n: number): string => `swirl-${hand}-${m}x${n}`;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

// ---- the closed form -------------------------------------------------------

/** The palindrome: arm i of a fan of N belongs to pair `pairIndex[i]`. */
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

/**
 * Every pair extension of a fan, given its shared angle and its gap.
 *
 * `m` is the count of the OTHER family — what sets the row pitch the fan crosses
 * — and `p` the number of pairs in this one. The two layout constants come
 * straight out of the 112 px pitch and the four fixed start columns.
 */
function extensionsAt(m: number, p: number, angleDeg: number, gap: number): number[] {
  const th = angleDeg * RAD;
  const s = Math.sin(th);
  const c = Math.cos(th);
  const Q = 8 + 112 * m;
  const R = 24 - 112 * m;
  const U = (gap - 56 * c) / s - Q;
  const V = -(gap + 168 * c) / s - Q;
  const e = new Array<number>(p).fill(0);
  e[p - 1] = ((p - 1) % 2 === 1 ? U : V) / 2;
  for (let j = p - 2; j >= 1; j--) e[j] = (j % 2 === 1 ? U : V) - e[j + 1];
  e[0] = p > 1 ? (R * s - 144 * c - s * e[1] - gap) / c : (R * s - 144 * c - gap) / c;
  return e;
}

/**
 * How much of U and V the shallow pair carries.
 *
 * `a` and `b` are coefficients, not lengths: walking outward from the centre
 * pair to pair `r = min(2, p − 1)`, each step flips one of them. Writing that
 * pair's extension as `aU + bV` and setting it to zero is what pins the angle.
 */
function shallowCoefficients(p: number): [number, number] {
  const r = Math.min(2, p - 1);
  let a: number;
  let b: number;
  if ((p - 1) % 2 === 1) {
    a = 0.5;
    b = 0;
  } else {
    a = 0;
    b = 0.5;
  }
  for (let j = p - 2; j >= r; j--) {
    if (j % 2 === 1) {
      a = 1 - a;
      b = -b;
    } else {
      a = -a;
      b = 1 - b;
    }
  }
  return [a, b];
}

interface Fan {
  angle: number;
  ext: number[];
}

/** Case B — a multi-pair fan, sitting on the edge of its feasible cone. */
function multiPairFan(m: number, p: number, gap: number): Fan | null {
  const [a, b] = shallowCoefficients(p);
  const Q = 8 + 112 * m;
  const A = 56 * a + 168 * b;
  const B = Q * (a + b);
  const C = (a - b) * gap;
  const rho = Math.hypot(A, B);
  if (Math.abs(C / rho) > 1) return null;
  const base = Math.asin(C / rho);
  const delta = Math.atan2(A, B);
  let best: (Fan & { total: number }) | null = null;
  for (const candidate of [base - delta, Math.PI - base - delta]) {
    for (const shift of [-2 * Math.PI, 0, 2 * Math.PI]) {
      const t = candidate + shift;
      // the left-hand interval: 90 deg < theta < 180 deg
      if (!(t > Math.PI / 2 + 1e-12 && t < Math.PI - 1e-12)) continue;
      const ext = extensionsAt(m, p, t * DEG, gap);
      if (ext.some((v) => !isFinite(v) || v < -1e-6)) continue;
      const total = ext.reduce((x, y) => x + y, 0);
      if (!best || total < best.total) best = { angle: t * DEG, ext, total };
    }
  }
  return best ? { angle: best.angle, ext: best.ext } : null;
}

/**
 * Case C — the one-pair boundary.
 *
 * Solve the transposed multi-pair fan first, read its uncorrected outside-corner
 * margin off it, and extend by exactly what carries that margin to the floor.
 * `88 sin φ` is the fixed layout offset projected onto the outside-line normal;
 * `(32 + p₀) cos φ` is the outer arm's own base offset plus its extension on the
 * same normal, and since φ sits in quadrant II that second term reduces it.
 */
function onePairFan(m: number, gap: number, floor: number): (Fan & { transposed: Fan }) | null {
  const t = multiPairFan(1, m, gap);
  if (!t) return null;
  const phi = t.angle * RAD;
  const M0 = 88 * Math.sin(phi) + (32 + t.ext[0]) * Math.cos(phi);
  const E = Math.max(0, (floor - M0) / Math.sin(phi));
  const A = 56 - 112 * m;
  const B = -(120 + 2 * E);
  const rho = Math.hypot(A, B);
  if (Math.abs(gap / rho) > 1) return null;
  const base = Math.asin(gap / rho);
  const delta = Math.atan2(B, A);
  let angle: number | null = null;
  for (const candidate of [base - delta, Math.PI - base - delta]) {
    for (const shift of [-2 * Math.PI, 0, 2 * Math.PI]) {
      const v = candidate + shift;
      if (v > Math.PI / 2 + 1e-12 && v < Math.PI - 1e-12) angle = v;
    }
  }
  if (angle === null) return null;
  return { angle: angle * DEG, ext: [E], transposed: t };
}

export interface SwirlSolution {
  /** The horizontal fan's shared angle, in degrees. */
  hAngle: number;
  /** Its pair extensions, outside pair first. */
  hExt: number[];
  /** The vertical fan's shared angle, in degrees. */
  vAngle: number;
  vExt: number[];
  /** Which case each fan came out of, for the labels. */
  kind: string;
}

/**
 * The whole stitch, from the size alone. Nothing here is searched or fitted.
 *
 * The horizontal fan is `f(m, n)` and the vertical is `f(n, m)` turned −90°, so
 * a size and its transpose are the same object with the two fans swapped.
 */
export function swirlSolve(
  m: number,
  n: number,
  gap = SWIRL_GAP,
  floor = SWIRL_CORNER_FLOOR,
): SwirlSolution | null {
  if (m === 1 && n === 1) {
    // Case A: exactly on the diagonal, and the extension is not zero — it is
    // what makes the single gap exactly `gap`.
    const E = gap / Math.SQRT2 - 32;
    return { hAngle: -135, hExt: [E], vAngle: 135, vExt: [E], kind: 'A' };
  }
  const h = n === 1 ? onePairFan(m, gap, floor) : multiPairFan(m, n, gap);
  const v = m === 1 ? onePairFan(n, gap, floor) : multiPairFan(n, m, gap);
  if (!h || !v) return null;
  return {
    hAngle: h.angle,
    hExt: h.ext,
    vAngle: v.angle - 90,
    vExt: v.ext,
    kind: `${n === 1 ? 'C' : 'B'}/${m === 1 ? 'C' : 'B'}`,
  };
}

// ---- which end joins which fan ---------------------------------------------
//
// This is the whole of k = −1. Reading the arms in the order their gaps are
// measured in, the horizontal fan takes the last set's `_4`, then alternates
// `j_4, (j−1)_5` up the weft sets, and closes on the first warp set's `_5`; the
// vertical fan starts at `1_4`, alternates back down the warp sets, and closes
// on the last weft set's `_5`. Both come out 2n and 2m long, as they must.

/** The horizontal fan's arms, in gap order. */
export function swirlHorizontalArms(m: number, n: number): string[] {
  const out = [`${n + m}_4`];
  for (let j = 2; j <= n; j++) out.push(`${j}_4`, `${j - 1}_5`);
  out.push(`${n + 1}_5`);
  return out;
}

/** The vertical fan's arms, in gap order. */
export function swirlVerticalArms(m: number, n: number): string[] {
  const out = ['1_4'];
  for (let i = 1; i <= m - 1; i++) out.push(`${n + i + 1}_5`, `${n + i}_4`);
  out.push(`${n}_5`);
  return out;
}

// ---- the stitch ------------------------------------------------------------

/** Reflect across `x = cx`. Layer order is untouched: a mirror does not change
 *  which lace is on top of which. */
function mirrored(scene: Scene3D, cx: number): Scene3D {
  const flip = (p: Point): Point => ({ x: 2 * cx - p.x, y: p.y });
  return {
    ...scene,
    strands: scene.strands.map((s) => ({
      ...s,
      start: flip(s.start),
      end: flip(s.end),
      control_points: s.control_points.map(flip) as [Point, Point],
    })),
  };
}

/**
 * The swirl's starting stitch and its one continuation: a block of n weft sets
 * crossing m warp sets, every loose end carried out and turned into a strand of
 * whichever fan k = −1 sends it to. `levelBreaks` splits the two, so the level
 * control shows the block alone and then the continuation on top of it.
 *
 * Naming follows the reference: `_1` is buried in the block, `_2` and `_3` are
 * the arms leaving it, `_4` and `_5` the continuation — `_2` carries on as `_4`,
 * `_3` as `_5`. Weft sets are numbered first, then warp.
 */
export function swirlStitch(m: number, n: number, name: string, hand: Hand = 'lh'): Scene3D {
  const cx = 400;
  const cy = 300;
  const sol = swirlSolve(m, n);
  if (!sol) throw new Error(`swirlStitch ${m}x${n}: no solution at gap ${SWIRL_GAP}`);

  const hArms = swirlHorizontalArms(m, n);
  const vArms = swirlVerticalArms(m, n);
  const hPair = pairIndex(hArms.length);
  const vPair = pairIndex(vArms.length);

  /** Each arm's extension, by arm id — a pair shares one, first with last. */
  const slideOf: Record<string, number> = {};
  hArms.forEach((id, i) => {
    slideOf[id] = sol.hExt[hPair[i]] ?? 0;
  });
  vArms.forEach((id, i) => {
    slideOf[id] = sol.vExt[vPair[i]] ?? 0;
  });
  const fanOf: Record<string, number> = {};
  hArms.forEach((id) => {
    fanOf[id] = sol.hAngle;
  });
  vArms.forEach((id) => {
    fanOf[id] = sol.vAngle;
  });

  // The block, exactly as the twist lays it: 2n weft arms on rows one gap apart,
  // 2m warp arms on columns the same, each running out to POKE past the far edge
  // of the other family's band.
  const halfW = ((2 * m - 1) * GAP) / 2;
  const halfH = ((2 * n - 1) * GAP) / 2;
  const row = (i: number): number => cy + (i - (2 * n - 1) / 2) * GAP;
  const col = (j: number): number => cx + (j - (2 * m - 1) / 2) * GAP;
  const armX = halfW + POKE;
  const armY = halfH + POKE;

  const strands: Strand3D[] = [];
  const masks: MaskLink[] = [];
  const colourOf = (set: number): RGBA => (set > n ? INDIGO : WEFT[(set - 1) % WEFT.length]);

  /** Where an arm's continuation begins, once the pair has slid out. */
  const foot: Record<string, Point> = {};

  for (let p = 0; p < n; p++) {
    const set = p + 1;
    const colour = colourOf(set);
    const hi = row(2 * p);
    const lo = row(2 * p + 1);
    const a = { x: cx - m * GAP, y: lo };
    const b = { x: cx + m * GAP, y: hi };
    strands.push(mk(`${set}_1`, a, b, colour));
    const left = { x: cx - armX - (slideOf[`${set}_4`] ?? 0), y: hi };
    const right = { x: cx + armX + (slideOf[`${set}_5`] ?? 0), y: lo };
    strands.push(mk(`${set}_2`, { ...b }, left, colour, `${set}_1`, 1));
    strands.push(mk(`${set}_3`, { ...a }, right, colour, `${set}_1`, 0));
    foot[`${set}_4`] = left;
    foot[`${set}_5`] = right;
  }

  for (let q = 0; q < m; q++) {
    const set = n + q + 1;
    const left = col(2 * q);
    const right = col(2 * q + 1);
    const a = { x: right, y: cy + n * GAP };
    const b = { x: left, y: cy - n * GAP };
    strands.push(mk(`${set}_1`, a, b, INDIGO));
    const up = { x: right, y: cy - armY - (slideOf[`${set}_4`] ?? 0) };
    const down = { x: left, y: cy + armY + (slideOf[`${set}_5`] ?? 0) };
    strands.push(mk(`${set}_2`, { ...a }, up, INDIGO, `${set}_1`, 0));
    strands.push(mk(`${set}_3`, { ...b }, down, INDIGO, `${set}_1`, 1));
    foot[`${set}_4`] = up;
    foot[`${set}_5`] = down;
  }

  // The block's over/unders are the twist's: the warp rides over every weft end.
  for (let q = 0; q < m; q++) {
    const warpSet = n + q + 1;
    for (let p = 0; p < n; p++) {
      const weftSet = p + 1;
      masks.push({ overId: `${warpSet}_2`, underId: `${weftSet}_3` });
      masks.push({ overId: `${warpSet}_3`, underId: `${weftSet}_2` });
    }
  }

  // ---- the continuation ------------------------------------------------------
  const levelBreaks = [strands.length];

  /** A continuation runs until it has cleared the last line of the opposite fan
   *  it crosses, by the same POKE its arm used plus half a width for that line's
   *  own edge — the same tail rule the twist draws to. */
  const dirOf = (id: string): Point => {
    const a = fanOf[id] * RAD;
    // `_4` leaves along the fan, `_5` back along it: a pair reads outward from
    // opposite ends, which is what makes the index a palindrome.
    const sense = id.endsWith('_4') ? 1 : -1;
    return { x: sense * Math.cos(a), y: sense * Math.sin(a) };
  };
  const tail = (from: Point, along: Point, lines: Array<{ at: Point; along: Point }>): number => {
    let far = 0;
    for (const l of lines) {
      const nx = -l.along.y;
      const ny = l.along.x;
      const denom = along.x * nx + along.y * ny;
      if (Math.abs(denom) < 1e-9) continue;
      const t = -((from.x - l.at.x) * nx + (from.y - l.at.y) * ny) / denom;
      if (t > far) far = t;
    }
    return far + POKE + W / 2;
  };
  const linesOf = (ids: string[]): Array<{ at: Point; along: Point }> =>
    ids.map((id) => ({ at: foot[id], along: dirOf(id) }));
  const hLines = linesOf(hArms);
  const vLines = linesOf(vArms);

  for (const [ids, opposite] of [
    [hArms, vLines],
    [vArms, hLines],
  ] as Array<[string[], Array<{ at: Point; along: Point }>]>) {
    for (const id of ids) {
      const set = parseInt(id, 10);
      const at = foot[id];
      const away = dirOf(id);
      const len = tail(at, away, opposite);
      const end = { x: at.x + away.x * len, y: at.y + away.y * len };
      const parent = id.endsWith('_4') ? `${set}_2` : `${set}_3`;
      strands.push(mk(id, { ...at }, end, colourOf(set), parent, 1));
    }
  }

  // The continuation's over/unders: a vertical arm rides over a horizontal one
  // when the two sit at the same parity in their own fan's gap order. That is
  // the alternation the weave needs, and it is what k = −1 leaves behind once
  // the ends have been re-routed.
  vArms.forEach((v, i) => {
    hArms.forEach((h, j) => {
      if (i % 2 === j % 2) masks.push({ overId: v, underId: h });
    });
  });

  const built = { name, strands, masks, levelBreaks };
  return hand === 'rh' ? mirrored(built, cx) : built;
}

export interface SwirlShape {
  key: string;
  m: number;
  n: number;
  /** The horizontal fan's shared angle, in degrees. */
  h: number;
  /** The vertical fan's, in degrees. */
  v: number;
  /** Which of the three cases each fan came out of. */
  kind: string;
}

export const SWIRL_FAMILY: SwirlShape[] = (() => {
  const out: SwirlShape[] = [];
  for (let m = 1; m <= SWIRL_MAX; m++) {
    for (let n = 1; n <= SWIRL_MAX; n++) {
      // 1 x 1's k only runs 0 ... 1, so it has no k = -1 to build. It is the
      // one size the reference shows at the single twist it has instead.
      if (m === 1 && n === 1) continue;
      const s = swirlSolve(m, n);
      if (!s) continue;
      out.push({ key: `swirl-${m}x${n}`, m, n, h: s.hAngle, v: s.vAngle, kind: s.kind });
    }
  }
  return out;
})();

export const SWIRL_SAMPLES: Record<string, () => Scene3D> = Object.fromEntries(
  HANDS.flatMap(({ hand, sense }) =>
    SWIRL_FAMILY.map((s) => [
      swirlKey(hand, s.m, s.n),
      () =>
        swirlStitch(
          s.m,
          s.n,
          `Swirl stitch — ${s.m}×${s.n} ${hand.toUpperCase()} (${sense}), k = −1, ` +
            `H ${s.h.toFixed(2)}°, V ${s.v.toFixed(2)}°`,
          hand,
        ),
    ]),
  ),
);

// The named list. Only the sizes worth naming; the browser grid carries the rest.
const GROUP = 'Swirl — the k = −1 stitch (block + one continuation)';

export const SWIRL_LABELS: Array<{ key: string; label: string; group: string }> = HANDS.flatMap(
  ({ hand, label }) =>
    (
      [
        [2, 1],
        [1, 2],
        [2, 2],
        [3, 3],
        [1, 8],
      ] as Array<[number, number]>
    ).map(([m, n]) => {
      const s = SWIRL_FAMILY.find((f) => f.m === m && f.n === n)!;
      return {
        key: swirlKey(hand, m, n),
        label: `${label} · swirl ${m}×${n} — H ${s.h.toFixed(1)}°, V ${s.v.toFixed(1)}°`,
        group: GROUP,
      };
    }),
);
