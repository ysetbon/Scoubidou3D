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

import { MaskLink, Point, RGBA, SampleLabel, Scene3D, Strand3D } from './types';

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

/**
 * HOW MUCH OF THE MAJORITY FAN'S TURN A COLUMN TAKES.
 *
 * A lopsided face cannot have the turn its majority fan wants AND the reference's
 * 56 px offsets: past a certain angle the minority family's arms are no longer
 * long enough to reach across the majority band. It can have any point on the
 * line between the two, and this is which point.
 *
 *   0 — the minority fan's angle, the ceiling. Nothing opens; the column lays
 *       shallower than the family you see would.
 *   1 — the majority fan's angle in full, bought by opening the gap inside each
 *       lace as far as it takes: 6.28 lace widths at a 1×8.
 *
 * 0.67 keeps most of the turn on the near-square faces, where it is nearly free
 * (7×8 opens to 1.35 widths), and stops the lopsided ones running away (1×8 to
 * 3.04 rather than 6.28). At m = n the two ends are the same angle and this
 * number does nothing at all — a 1×1 is untouched at any setting.
 */
export const COLUMN_DIAL = 0.67;

const STROKE: RGBA = { r: 30, g: 30, b: 30, a: 255 };
export const INDIGO: RGBA = { r: 61, g: 58, b: 140, a: 255 };
export const WEFT: RGBA[] = [
  { r: 226, g: 122, b: 38, a: 255 },
  { r: 245, g: 200, b: 55, a: 255 },
  { r: 60, g: 170, b: 175, a: 255 },
  { r: 240, g: 240, b: 240, a: 255 },
  { r: 210, g: 90, b: 110, a: 255 },
  { r: 150, g: 195, b: 120, a: 255 },
  { r: 140, g: 160, b: 210, a: 255 },
  { r: 190, g: 140, b: 200, a: 255 },
];

export function mk(
  id: string,
  start: Point,
  end: Point,
  color: RGBA,
  parentId?: string,
  parentSide?: 0 | 1,
): Strand3D {
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
 * Which way the stitch turns. The reference gives every size in both, and they
 * are not two constructions: "Hand only swaps `_2` and `_3`: RH is the mirror
 * image of LH, always." Mirroring across the vertical through the centre takes
 * its LH numbers to its RH ones exactly — a direction θ goes to 180° − θ, which
 * carries the 1×2's H of −141.28° to −38.72° and its V of 117.15° to −117.15°,
 * both the reference's own RH values.
 *
 * Left hand turns clockwise, right hand counter-clockwise.
 */
export type Hand = 'lh' | 'rh';

export const HANDS: Array<{ hand: Hand; label: string; sense: string }> = [
  { hand: 'lh', label: 'Left hand', sense: 'clockwise' },
  { hand: 'rh', label: 'Right hand', sense: 'counter-clockwise' },
];

/** Reflect a scene across `x = cx`. Layer order is untouched, so the over/unders
 *  survive: a mirror does not change which lace is on top of which. */
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

/** Browser keys. Hand is part of the key, so a face is a different sample in each. */
export const stitchKey = (hand: Hand, m: number, n: number): string => `twofan-${hand}-${m}x${n}`;
export const columnKey = (hand: Hand, m: number, n: number): string =>
  `twofan-col-${hand}-${m}x${n}-10`;

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
export function twoFanStitch(m: number, n: number, name: string, hand: Hand = 'lh'): Scene3D {
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

  const built = { name, strands, masks, levelBreaks };
  return hand === 'rh' ? mirrored(built, cx) : built;
}

/** The reference's own object — a block with its ends fanned out once — both hands. */
export const TWOFAN_SAMPLES: Record<string, () => Scene3D> = Object.fromEntries(
  HANDS.flatMap(({ hand, sense }) =>
    TWOFAN_FAMILY.map((s) => [
      stitchKey(hand, s.m, s.n),
      () =>
        twoFanStitch(
          s.m,
          s.n,
          `Two-fan stitch — ${s.m}×${s.n} ${hand.toUpperCase()} (${sense}), ` +
            `weft ${s.weft.toFixed(2)}°, warp ${s.warp.toFixed(2)}°`,
          hand,
        ),
    ]),
  ),
);

export function twoFanColumn(
  m: number,
  n: number,
  levels: number,
  name: string,
  hand: Hand = 'lh',
  /** Override the turn, in radians. For comparing against what a family wants —
   *  see docs/twist-stitch/attempts/1xn-reference/. Omit for the derived turn. */
  turnOverride?: number,
): Scene3D {
  const cx = 400;
  const cy = 300;

  // THE TURN, and which of the reference's two a column can actually take.
  //
  // Not the majority family's. A column's binding constraint is the MINORITY
  // family: its few laces have to reach clear across the wide band the majority
  // makes, and reach goes as 1/sin θ, so a steep turn puts that crossing out of
  // range. Measured: at 1×8 the majority's 22.78° leaves the lone lace 281 px
  // short of a 420 px band and the level loses 132 of its 192 crossings. The
  // minority's angle is the one that spans it, and it is the reference's own
  // number for that fan.
  //
  // This is why the old `arctan(1/max(m,n))` built columns that wove correctly
  // while being the wrong angle: it is very nearly this one. The two coincide at
  // m = n, where the reference has a single angle anyway — 50.03° at a 1×1, which
  // is the number the old law got wrong.
  const TURN = turnOverride ?? columnTurnRad(m, n);
  const c = Math.cos(TURN);
  const s = Math.sin(TURN);

  // AND WHAT THE TURN COSTS: the gap inside a lace.
  //
  // The landing law fixes an arm's length from the turn and the two offsets, so
  // the only way to make a steeper turn reachable is to move the offsets. Open
  // the gap between a lace's OWN two arms — leaving the gap between laces at the
  // reference's floor — and those arms get longer for free. `columnGaps` solves
  // for the least opening this turn needs, which is none at all on the diagonal.
  const inner = columnGaps(m, n, TURN);

  interface Slot {
    warp: boolean;
    off: number;
    dir: number;
  }
  const weftOff = famOffsets(n, inner.weft);
  const warpOff = famOffsets(m, inner.warp);
  const slots: Slot[] = [];
  for (let i = 0; i < 2 * n; i++) slots.push({ warp: false, off: weftOff[i], dir: 0 });
  for (let j = 0; j < 2 * m; j++) slots.push({ warp: true, off: warpOff[j], dir: 0 });
  const NW = 2 * n;
  const weftBand = halfSpan(weftOff);
  const warpBand = halfSpan(warpOff);

  const sib: number[] = [];
  const laces: Array<{ set: number; pair: [number, number] }> = [];
  for (let p = 0; p < n; p++) laces.push({ set: 1 + p, pair: [2 * p, 2 * p + 1] });
  for (let p = 0; p < m; p++) laces.push({ set: 1 + n + p, pair: [NW + 2 * p, NW + 2 * p + 1] });
  for (const l of laces) {
    sib[l.pair[0]] = l.pair[1];
    sib[l.pair[1]] = l.pair[0];
  }
  const laceOf: number[] = [];
  for (const l of laces) for (const k of l.pair) laceOf[k] = l.set;

  const on = (k: number, along: number): Point => {
    const sl = slots[k];
    return sl.warp ? { x: cx + sl.off, y: cy + along } : { x: cx + along, y: cy + sl.off };
  };
  /** Half the perpendicular band this arm crosses: the other family's own half
   *  span, which now depends on how far that family had to open. */
  const band = (k: number): number => (slots[k].warp ? weftBand : warpBand);
  /** The landing law: the length that puts this tip on its sibling's line one level up. */
  const solved = (k: number): number =>
    (slots[sib[k]].off - slots[k].off * c) / ((slots[k].warp ? 1 : -1) * s);

  const reach: number[] = slots.map((_, k) => solved(k));
  slots.forEach((sl, k) => {
    sl.dir = reach[k] >= 0 ? 1 : -1;
    reach[k] = Math.abs(reach[k]);
  });
  // The reference's third rule, as an assertion rather than a repair.
  //
  // This used to read `reach[k] = max(reach[k], band(k) + POKE)`, quietly
  // lengthening any arm the landing law left short. That extension is what broke
  // the fold: an arm pushed past where the law put it lands OFF its sibling's
  // line, so the next strand starts off its own fan line, the level's gaps stop
  // being equal, and the outermost crossings stop happening. It fired on all 56
  // lopsided faces and cost 1276 crossings across the family.
  //
  // With the gaps solved for the turn there is nothing left to repair, so a short
  // arm is now a bug in the solver and says so instead of hiding.
  slots.forEach((sl, k) => {
    if (reach[k] < band(k) + POKE - 1e-6) {
      throw new Error(
        `twoFanColumn ${m}x${n}: ${sl.warp ? 'warp' : 'weft'} slot ${k} reaches ` +
          `${reach[k].toFixed(2)} but must span ${(band(k) + POKE).toFixed(2)} — ` +
          `columnGaps did not open far enough for a turn of ` +
          `${((TURN * 180) / Math.PI).toFixed(3)}°`,
      );
    }
  });
  const TAIL = 1.5 * Math.max(...reach);

  const turned = (p: Point, level: number): Point => {
    const t = TURN * level;
    const cc = Math.cos(t);
    const ss = Math.sin(t);
    const x = p.x - cx;
    const y = p.y - cy;
    return { x: cx + x * cc - y * ss, y: cy + x * ss + y * cc };
  };
  const tip = (k: number, level: number, along: number): Point =>
    turned(on(k, slots[k].dir * along), level);
  const entry = (k: number): Point => on(k, -slots[k].dir * (band(k) + POKE));

  const colour = (set: number): RGBA => (set > n ? INDIGO : WEFT[(set - 1) % WEFT.length]);

  const strands: Strand3D[] = [];
  const masks: MaskLink[] = [];
  const levelBreaks: number[] = [];
  const nextId: Record<number, number> = {};

  for (const l of laces) {
    nextId[l.set] = 1;
    strands.push(mk(`${l.set}_1`, entry(l.pair[1]), entry(l.pair[0]), colour(l.set)));
  }

  interface Arm {
    at: Point;
    last: string;
    side: 0 | 1;
  }
  const arm: Arm[] = [];
  for (const l of laces) {
    arm[l.pair[0]] = { at: entry(l.pair[0]), last: `${l.set}_1`, side: 1 };
    arm[l.pair[1]] = { at: entry(l.pair[1]), last: `${l.set}_1`, side: 0 };
  }

  for (let level = 0; level <= levels; level++) {
    if (level > 0) levelBreaks.push(strands.length);
    const laid: string[] = [];
    for (let k = 0; k < slots.length; k++) {
      const set = laceOf[k];
      const a = arm[k];
      const along = level === levels ? band(k) + TAIL : reach[k];
      const end = tip(k, level, along);
      const id = `${set}_${++nextId[set]}`;
      strands.push(mk(id, { ...a.at }, end, colour(set), a.last, a.side));
      laid[k] = id;
      a.at = end;
      a.last = id;
      a.side = 1;
    }
    for (let i = 0; i < NW; i++) {
      for (let j = NW; j < slots.length; j++) {
        if (i % 2 !== (j - NW) % 2) masks.push({ overId: laid[i], underId: laid[j] });
      }
    }
    for (const l of laces) {
      const t = arm[l.pair[0]];
      arm[l.pair[0]] = arm[l.pair[1]];
      arm[l.pair[1]] = t;
    }
  }

  const built = { name, strands, masks, levelBreaks };
  return hand === 'rh' ? mirrored(built, cx) : built;
}

/**
 * The turn a two-fan column of this shape runs at, in radians.
 *
 * A lopsided face has two angles it would like and cannot have both of.
 *
 * The MAJORITY family is the one you see: 2·max(m,n) strands against the
 * minority's 2·min. Its own fan angle is what lays it tight, and it is what a
 * lopsided face is judged on by eye. But the MINORITY family's few laces have to
 * reach clear across the wide band the majority makes, and reach goes as 1/sin θ,
 * so past the minority fan's own angle — the CEILING — they no longer span it.
 *
 * This used to ship the majority's angle and extend the short arms to cover the
 * difference. The extension is not free: an arm pushed past where the landing law
 * put it misses its sibling's line, so the fold breaks, the level's gaps stop
 * being equal, and the outermost crossings stop happening. It cost 1276 of 51840
 * crossings across the family and left gaps as tight as 1.1 px between two 46 px
 * laces. Every one of those was on a lopsided face; the diagonal paid nothing.
 *
 * There is a third thing to spend instead, and it is the gap INSIDE a lace. The
 * spacing between one lace and the next is the reference's floor and stays there,
 * but a lace's own two arms are only 56 px apart because nothing said otherwise.
 * Open that and the landing law hands those arms more length for nothing. Enough
 * of it and any angle up to the majority's is reachable with the fold intact.
 *
 * So the turn is a dial between the two, `COLUMN_DIAL` says where it sits, and
 * `columnGaps` solves the least opening that setting needs. At 0.67, every one of
 * the 64 faces weaves whole — 20736 of 20736 crossings over four levels — with no
 * gap below the reference's 56 px floor anywhere. What a face pays now is width
 * rather than crossings: `npm run probe:turn` records it and `npm run
 * check:twofan` asserts it.
 *
 * `ceilingTurnRad` and `majorityTurnRad` are the two ends of the dial.
 */
export function columnTurnRad(m: number, n: number): number {
  const lo = ceilingTurnRad(m, n);
  const hi = majorityTurnRad(m, n);
  return lo + COLUMN_DIAL * (hi - lo);
}

/** The steepest turn the reference's own 56 px offsets can carry: the MINORITY
 *  fan's angle. Below it nothing has to open. */
export function ceilingTurnRad(m: number, n: number): number {
  return fan(Math.min(m, n), (2 * Math.max(m, n) - 1) * GAP + 2 * POKE).turn;
}

/** What the majority fan wants — the angle that lays the family you see tight,
 *  and the most a column can ever be asked to turn. */
export function majorityTurnRad(m: number, n: number): number {
  return fan(Math.max(m, n), (2 * Math.min(m, n) - 1) * GAP + 2 * POKE).turn;
}

/** The turn that keeps every crossing real and every gap at the floor. */
export function reachTurn(m: number, n: number): number {
  return (ceilingTurnRad(m, n) * 180) / Math.PI;
}

/** One family's 2*`count` slot offsets: `inner` between a lace's own two arms,
 *  the reference's GAP between one lace and the next, centred on zero. With
 *  `inner === GAP` this is the plain ladder of multiples the column used to lay. */
export function famOffsets(count: number, inner: number): number[] {
  const pos: number[] = [];
  let x = 0;
  for (let i = 0; i < count; i++) {
    pos.push(x);
    pos.push(x - inner);
    x -= inner + GAP;
  }
  const mid = (pos[0] + pos[pos.length - 1]) / 2;
  return pos.map((p) => p - mid);
}

const halfSpan = (off: number[]): number => Math.max(...off.map(Math.abs));

/** Does every arm of this family span the band it has to cross, at this turn,
 *  with the landing law honoured exactly? A strand runs from where the previous
 *  level's fold left it to where the law puts its own tip, and BOTH ends have to
 *  clear the band — a tip that reaches while its root sits inside the band still
 *  misses the crossings on that side. */
function famSpans(off: number[], turn: number, band: number, warp: boolean): boolean {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const sib = (k: number): number => (k % 2 === 0 ? k + 1 : k - 1);
  const arm = off.map((_, k) => (off[sib(k)] - off[k] * c) / ((warp ? 1 : -1) * s));
  const need = band + POKE;
  const TOL = 1e-4; // a ten-thousandth of a pixel; the diagonal is exact and lands here
  for (let k = 0; k < off.length; k++) {
    const root = c * arm[k] + (warp ? -s : s) * off[k];
    const lo = Math.min(root, arm[sib(k)]);
    const hi = Math.max(root, arm[sib(k)]);
    if (lo > -need + TOL || hi < need - TOL) return false;
  }
  return true;
}

/** The least `inner` this family needs to span `band` at this turn. */
function leastInner(count: number, turn: number, band: number, warp: boolean): number {
  for (let inner = GAP; inner <= 8000; inner++) {
    if (famSpans(famOffsets(count, inner), turn, band, warp)) return inner;
  }
  throw new Error(`no lace gap spans a band of ${band.toFixed(1)} at ${turn.toFixed(4)} rad`);
}

/**
 * The least each family has to open, for this face at this turn.
 *
 * The two are coupled: opening the weft block widens the band the WARP arms have
 * to cross, which may force the warp open, which widens the band the weft arms
 * cross. Widening one alone never works — on a 6×4 the shortfall bottoms out at
 * −42 px around a 69 px weft gap and gets worse from there. So this walks the
 * pair up together to the least fixed point, which is the componentwise smallest
 * answer there is.
 *
 * At or below the ceiling the first pass already succeeds at GAP and it returns
 * the reference's own spacing untouched. On the diagonal that is every turn.
 */
export function columnGaps(m: number, n: number, turn: number): { weft: number; warp: number } {
  let weft = GAP;
  let warp = GAP;
  for (let i = 0; i < 64; i++) {
    const nextWeft = leastInner(n, turn, halfSpan(famOffsets(m, warp)), false);
    const nextWarp = leastInner(m, turn, halfSpan(famOffsets(n, nextWeft)), true);
    if (nextWeft === weft && nextWarp === warp) return { weft, warp };
    weft = nextWeft;
    warp = nextWarp;
  }
  return { weft, warp };
}

/** The same, in degrees — what the browser cells quote. */
export function columnTurn(m: number, n: number): number {
  return (columnTurnRad(m, n) * 180) / Math.PI;
}

export interface TwoFanColumnShape {
  key: string;
  m: number;
  n: number;
  /** The column's turn, in degrees — the minority fan's, which is what repeats. */
  turn: number;
  /** How far the loosest arm hangs past the band it crosses, in lace widths. */
  slack: number;
  /** `max(m,n)/min(m,n)` — how much more binding one lace does than another. */
  load: number;
  /** What the reference's majority fan wants: the top of the dial. */
  wanted: number;
  /** The minority fan's angle: the bottom of the dial, where nothing opens. */
  ceiling: number;
  /** Gap inside one weft lace, px. `GAP` when the turn costs that family nothing. */
  innerWeft: number;
  /** Gap inside one warp lace, px. */
  innerWarp: number;
}

export const TWOFAN_COLUMN_FAMILY: TwoFanColumnShape[] = (() => {
  const out: TwoFanColumnShape[] = [];
  for (let m = 1; m <= TWOFAN_MAX; m++) {
    for (let n = 1; n <= TWOFAN_MAX; n++) {
      const t = columnTurnRad(m, n);
      const c = Math.cos(t);
      const s = Math.sin(t);
      const inner = columnGaps(m, n, t);
      const off = { weft: famOffsets(n, inner.weft), warp: famOffsets(m, inner.warp) };
      let slack = 0;
      for (const warp of [false, true]) {
        const mine = warp ? off.warp : off.weft;
        const band = Math.max(...(warp ? off.weft : off.warp).map(Math.abs));
        for (let i = 0; i < mine.length; i++) {
          const sib = mine[i % 2 === 0 ? i + 1 : i - 1];
          const reach = Math.abs((sib - mine[i] * c) / ((warp ? 1 : -1) * s));
          slack = Math.max(slack, (reach - band) / W);
        }
      }
      out.push({
        key: `twofan-col-${m}x${n}-10`,
        m,
        n,
        turn: columnTurn(m, n),
        slack,
        load: Math.max(m, n) / Math.min(m, n),
        wanted: (majorityTurnRad(m, n) * 180) / Math.PI,
        ceiling: (ceilingTurnRad(m, n) * 180) / Math.PI,
        innerWeft: inner.weft,
        innerWarp: inner.warp,
      });
    }
  }
  return out;
})();

export const TWOFAN_COLUMN_SAMPLES: Record<string, () => Scene3D> = Object.fromEntries(
  HANDS.flatMap(({ hand, sense }) =>
    TWOFAN_COLUMN_FAMILY.map((s) => [
      columnKey(hand, s.m, s.n),
      () =>
        twoFanColumn(
          s.m,
          s.n,
          10,
          `Two-fan column — ${s.m}×${s.n} ${hand.toUpperCase()} (${sense}), ` +
            `10 levels, ${s.turn.toFixed(2)}°`,
          hand,
        ),
    ]),
  ),
);

// The named list. These are the reference's own object -- a block with its ends
// fanned out once -- not levels of a column; the columns live in the browser grid.
const GROUP = 'Twist — the reference stitch (block + one twist)';

export const TWOFAN_LABELS: SampleLabel[] = HANDS.flatMap(({ hand, label, sense }) => [
  // The reference's own object at every size it tabulates, plus three columns.
  // The other 61 faces per hand are in the browser.
  //
  // Twenty-two of these, each a full sentence, made a wall of prose out of what
  // is really two rows of eight and two of three. Every entry carries a `cell`,
  // so the browser lays the folder out as the little table it is and keeps the
  // sentence in the tooltip. The dropdown still reads the long form.
  ...TWOFAN_FAMILY.map((s) => ({
    key: stitchKey(hand, s.m, s.n),
    label: `${label} · stitch ${s.m}×${s.n} — weft ${s.weft.toFixed(1)}°, warp ${s.warp.toFixed(1)}°`,
    group: GROUP,
    cell: {
      band: `${label} — turns ${sense}`,
      row: 'stitch',
      head: `${s.m}×${s.n}`,
      note: `${s.weft.toFixed(0)}°/${s.warp.toFixed(0)}°`,
    },
  })),
  ...([[1, 1], [2, 2], [1, 6]] as Array<[number, number]>).map(([m, n]) => ({
    key: columnKey(hand, m, n),
    label: `${label} · column ${m}×${n} — 10 levels, ${columnTurn(m, n).toFixed(1)}°`,
    group: GROUP,
    cell: {
      band: `${label} — turns ${sense}`,
      row: '10 levels',
      head: `${m}×${n}`,
      note: `${columnTurn(m, n).toFixed(1)}°`,
    },
  })),
]);
