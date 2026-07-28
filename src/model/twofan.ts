// The two-fan twist stitch — built to the 1×n reference, not to `deriving-the-turn`.
//
// `twistStitchMN` in samples.ts gives a stitch ONE turn and rotates the whole
// thing by it, level after level. An outside reference for 1×1 … 1×8 gives it
// TWO, one per family, and they agree only when m = n. Our single turn is very
// nearly the SMALLER of the two — `arctan(1/max(m,n))` tracks a 1×n's lone lace
// to within 0.05° — which is why a 1×6's six-set looks slack: it wants 25.54°
// and we lay it at 9.46°. See docs/twist-stitch/attempts/1xn-reference/.
//
// This module leaves that generator alone and builds the reference's stitch
// beside it, so the two can be looked at together.
//
// THE CONSTRUCTION, in three rules, from which everything below follows:
//
//   1. Each family's twist strands form a fan of PARALLEL strands with EQUAL
//      gaps. Two fans, so two angles.
//   2. A gap is at least `w + 10` and at most `1.5 w`. This is the constraint
//      the single-turn derivation never had: it packs laces at gap = w, edge to
//      edge, permanently jammed. It is also why 45° is not available to a 1×1 —
//      at 45° that stitch's gap is 45.25 px on a 46 px lace, i.e. overlapping.
//   3. Before its twist strand leaves, an arm may be SLID OUT past the block by
//      its own extension. A pair shares one, first with last.
//
// Push every gap to the floor and spend the one remaining degree of freedom on
// the least deformation — which empties the shortest arm — and the stitch is
// pinned. Nothing here is chosen and nothing is fitted: the angles and ladders
// below reproduce all 16 of the reference's angles to 0.016° and 7 of its 8
// extension ladders exactly.

import { MaskLink, Point, RGBA, Scene3D, Strand3D } from './types';

/** Lace width, in the same pixel space as the rest of the samples. */
export const W = 46;
/** The gap floor, `w + 10`. Every gap in the reference sits exactly here. */
export const GAP = 56;
/**
 * How far an arm pokes past the far edge of the band it crosses before it turns.
 * Measured off the reference at 32 px, constant across all sixteen stitches —
 * the same kind of quantity as `E` in samples.ts, and likewise not a fraction of
 * anything.
 */
export const POKE = 32;

const STROKE: RGBA = { r: 30, g: 30, b: 30, a: 255 };
const INDIGO: RGBA = { r: 61, g: 58, b: 140, a: 255 };
const WEFT: RGBA[] = [
  { r: 226, g: 122, b: 38, a: 255 },
  { r: 245, g: 200, b: 55, a: 255 },
  { r: 60, g: 170, b: 175, a: 255 },
  { r: 240, g: 240, b: 240, a: 255 },
  { r: 210, g: 90, b: 110, a: 255 },
  { r: 150, g: 195, b: 120, a: 255 },
  { r: 140, g: 160, b: 210, a: 255 },
  { r: 190, g: 140, b: 200, a: 255 },
];

function mk(id: string, start: Point, end: Point, color: RGBA, parentId?: string, parentSide?: 0 | 1): Strand3D {
  return {
    id,
    start,
    end,
    control_points: [{ ...start }, { ...start }],
    control_point_center: null,
    control_point_center_locked: false,
    triangleHasMoved: false,
    cp2Activated: false,
    width: W,
    stroke_width: 4,
    color,
    stroke_color: STROKE,
    thickness: null,
    visible: true,
    isMask: false,
    hasCircles: [false, false],
    parentId: parentId ?? null,
    parentSide: parentSide ?? null,
  };
}

/**
 * One family's fan: `count` pairs of arms whose two columns of tips sit `d`
 * apart. Returns the fan's angle off its own family's axis, in radians, and the
 * ladder step the extensions climb by.
 *
 * The two arms of a pair are one gap apart across the fan and `2·count − 1` gaps
 * span it, so equal gaps at the floor give two equations in the angle and the
 * two extension sums. Subtracting them leaves `tan θ = 4g / (2d + A + B)`, which
 * is angle-in-terms-of-extension only; the floor closes it.
 */
export function fan(count: number, d: number, g = GAP): { turn: number; step: number } {
  // A single pair has no second gap to match, so the floor alone fixes it, and
  // `d·sin θ − g·cos θ = g` has the closed form below.
  if (count === 1) return { turn: 2 * Math.atan(g / d), step: 0 };
  const p = 2 * count - 1;
  const q = 2 * count - 3;
  // 2d + p·step === hypot(4g, 2d + q·step)
  const a = p * p - q * q;
  const b = 4 * d * (p - q);
  const c = -((4 * g) ** 2);
  const step = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return { turn: Math.atan2(4 * g, 2 * d + q * step), step };
}

export interface TwoFanShape {
  key: string;
  m: number;
  n: number;
  /** The weft (horizontal) fan's angle off the horizontal, in degrees. */
  weft: number;
  /** The warp (vertical) fan's angle off the vertical, in degrees. */
  warp: number;
  /** How far apart the two turns are — zero only when m = n. */
  split: number;
}

/**
 * The reference tabulates 1×1 … 1×8 at k = +1, left hand, and those are the eight
 * shapes here. `twoFanStitch` itself takes any m and n — the derivation is
 * symmetric, the weft fan getting n pairs and the warp fan m — but only m = 1 has
 * been checked against anything, so only m = 1 is offered.
 */
export const TWOFAN_MAX = 8;

export function shapeOf(m: number, n: number): TwoFanShape {
  const weft = fan(n, (2 * m - 1) * GAP + 2 * POKE).turn;
  const warp = fan(m, (2 * n - 1) * GAP + 2 * POKE).turn;
  const deg = (r: number) => (r * 180) / Math.PI;
  return { key: `twofan-${m}x${n}`, m, n, weft: deg(weft), warp: deg(warp), split: Math.abs(deg(weft) - deg(warp)) };
}

export const TWOFAN_FAMILY: TwoFanShape[] = Array.from({ length: TWOFAN_MAX }, (_, i) => shapeOf(1, i + 1));

/**
 * The starting stitch and its twist, as the reference draws them: a block of n
 * weft sets crossing m warp sets, every loose end carried out and turned into a
 * strand of its family's fan. `levelBreaks` splits the two, so the level control
 * shows the starting stitch alone and then the twist on top of it.
 *
 * Naming follows the reference exactly. A set is one ribbon and a layer is which
 * piece of it: `_1` is buried in the block, `_2` and `_3` are the two arms
 * leaving it, and `_4` / `_5` are the twist — `_2` continues as `_4`, `_3` as
 * `_5`. Weft sets are numbered first, then warp.
 */
export function twoFanStitch(m: number, n: number, name: string): Scene3D {
  const cx = 400;
  const cy = 300;
  const { turn: weftTurn, step: weftStep } = fan(n, (2 * m - 1) * GAP + 2 * POKE);
  const { turn: warpTurn, step: warpStep } = fan(m, (2 * n - 1) * GAP + 2 * POKE);

  // The 2n weft arms lie on rows one gap apart, the 2m warp arms on columns the
  // same, and an arm runs out to POKE past the far edge of the other family's band.
  const halfW = ((2 * m - 1) * GAP) / 2;
  const halfH = ((2 * n - 1) * GAP) / 2;
  const row = (i: number): number => cy + (i - (2 * n - 1) / 2) * GAP;
  const col = (j: number): number => cx + (j - (2 * m - 1) / 2) * GAP;
  const armX = halfW + POKE;
  const armY = halfH + POKE;

  const strands: Strand3D[] = [];
  const masks: MaskLink[] = [];
  // Which twist strand belongs to which family, so the masks can be paired up.
  const weftTwist: string[] = [];
  const warpTwist: string[] = [];

  /** The line every strand of a fan is parallel to, as a unit vector. */
  const dir = (a: number): Point => ({ x: Math.cos(a), y: Math.sin(a) });
  const wefts = dir(weftTurn);
  const warps = dir(warpTurn + Math.PI / 2);

  /**
   * A twist strand runs until it has cleared the LAST line of the opposite fan it
   * crosses, by the same POKE its arm used plus half a width for that line's own
   * edge. This is the one length not taken from the reference — the reference's
   * tails come out of its aligner's bookkeeping rather than out of the geometry,
   * and they are 15–20% longer. Everything that carries meaning here — the two
   * angles, the gaps, the extensions — is the reference's.
   */
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

  // ---- the block, and the arms leaving it -------------------------------------
  // A set's `_1` is the short slant joining the two lines it owns; each arm then
  // runs out along its own line, slid out by its pair's extension.
  interface Arm {
    id: string;
    at: Point;
    /** The way this arm's twist strand leaves, once the fan angle is applied. */
    away: Point;
  }
  const arms: Array<{ arm: Arm; warp: boolean }> = [];

  for (let p = 0; p < n; p++) {
    const set = p + 1;
    const colour = WEFT[p % WEFT.length];
    const hi = row(2 * p);
    const lo = row(2 * p + 1);
    const a = { x: cx - m * GAP, y: lo };
    const b = { x: cx + m * GAP, y: hi };
    strands.push(mk(`${set}_1`, a, b, colour));
    // A pair shares one extension, first with last: the right arm of set p and
    // the left arm of set n-1-p climb the ladder from opposite ends.
    const eRight = (n - 1 - p) * weftStep;
    const eLeft = p * weftStep;
    const left = { x: cx - armX - eLeft, y: hi };
    const right = { x: cx + armX + eRight, y: lo };
    strands.push(mk(`${set}_2`, { ...b }, left, colour, `${set}_1`, 1));
    strands.push(mk(`${set}_3`, { ...a }, right, colour, `${set}_1`, 0));
    arms.push({ arm: { id: `${set}_2`, at: left, away: wefts }, warp: false });
    arms.push({ arm: { id: `${set}_3`, at: right, away: { x: -wefts.x, y: -wefts.y } }, warp: false });
  }

  for (let q = 0; q < m; q++) {
    const set = n + q + 1;
    const left = col(2 * q);
    const right = col(2 * q + 1);
    const a = { x: right, y: cy + n * GAP };
    const b = { x: left, y: cy - n * GAP };
    strands.push(mk(`${set}_1`, a, b, INDIGO));
    const eDown = (m - 1 - q) * warpStep;
    const eUp = q * warpStep;
    const up = { x: right, y: cy - armY - eUp };
    const down = { x: left, y: cy + armY + eDown };
    strands.push(mk(`${set}_2`, { ...a }, up, INDIGO, `${set}_1`, 0));
    strands.push(mk(`${set}_3`, { ...b }, down, INDIGO, `${set}_1`, 1));
    arms.push({ arm: { id: `${set}_2`, at: up, away: warps }, warp: true });
    arms.push({ arm: { id: `${set}_3`, at: down, away: { x: -warps.x, y: -warps.y } }, warp: true });
  }

  // ---- the twist ---------------------------------------------------------------
  const levelBreaks = [strands.length];
  const weftLines = arms.filter((a) => !a.warp).map((a) => ({ at: a.arm.at, along: wefts }));
  const warpLines = arms.filter((a) => a.warp).map((a) => ({ at: a.arm.at, along: warps }));

  for (const { arm, warp } of arms) {
    const set = parseInt(arm.id.split('_')[0], 10);
    const layer = arm.id.endsWith('_2') ? 4 : 5;
    const id = `${set}_${layer}`;
    const len = tail(arm.at, arm.away, warp ? weftLines : warpLines);
    const end = { x: arm.at.x + arm.away.x * len, y: arm.at.y + arm.away.y * len };
    strands.push(mk(id, { ...arm.at }, end, warp ? INDIGO : WEFT[(set - 1) % WEFT.length], arm.id, 1));
    (warp ? warpTwist : weftTwist).push(id);
  }

  // The warp leads: at k = +1 its ends ride over every weft end, in the block and
  // in the twist alike, and an arm crosses the opposite arm of the other family.
  for (let q = 0; q < m; q++) {
    const warpSet = n + q + 1;
    for (let p = 0; p < n; p++) {
      const weftSet = p + 1;
      masks.push({ overId: `${warpSet}_2`, underId: `${weftSet}_3` });
      masks.push({ overId: `${warpSet}_3`, underId: `${weftSet}_2` });
      masks.push({ overId: `${warpSet}_4`, underId: `${weftSet}_5` });
      masks.push({ overId: `${warpSet}_5`, underId: `${weftSet}_4` });
    }
  }

  return { name, strands, masks, levelBreaks };
}

export const TWOFAN_SAMPLES: Record<string, () => Scene3D> = Object.fromEntries(
  TWOFAN_FAMILY.map((s) => [
    s.key,
    () => twoFanStitch(s.m, s.n, `Two-fan twist — ${s.m}×${s.n} (weft ${s.weft.toFixed(2)}°, warp ${s.warp.toFixed(2)}°)`),
  ]),
);

export const TWOFAN_LABELS: Array<{ key: string; label: string; group: string }> = TWOFAN_FAMILY.map((s) => ({
  key: s.key,
  label: `${s.m}×${s.n} — weft ${s.weft.toFixed(1)}°, warp ${s.warp.toFixed(1)}°`,
  group: 'Twist — two fans (1×n reference)',
}));
