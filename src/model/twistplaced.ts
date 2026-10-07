// The twist family PLACED the way the box family is: the same rules, by role.
//
// A two-fan twist column (twofan.ts) is built like a box column. Level 1 is the
// same starting stitch — the `_1` slants buried in the block and the `_2` / `_3`
// arms leaving it — and every level above is the arms carried on, `_4` / `_5`,
// `_6` / `_7` and so on, with weft sets numbered first. What makes it a twist is
// that each level is turned by the column's angle, so a level's arms cross the
// level below at that angle rather than square; within one level they still cross
// each other, and which one is on top is the twist's own weave (its masks and its
// layer stack).
//
// `boxPlacements` says everything by role — the slant underneath, an arm over a
// slant, the arm on top and the arm underneath at a crossing, the arm below and
// the arm above at a fold — and finds the crossings from the geometry. So the
// rules settled by hand on the box (level 1 as `box + strand`, every level above
// on -1 with crossings ±1, each fold ending on -1 and starting on +1) apply to a
// twist as they stand.
//
// With ONE exception, which is the twist's own. Turned, a level-2 arm's fold end
// lands right over the corner where a level-1 arm of the other lace leaves its
// slant — the box never puts a fold end there, because its levels stand straight
// over each other. That corner sits high (the arm comes off the slant at about
// +2, as in the `box + strand` box), so a level-2 end on -1 is only half a
// thickness above it and the two ribbons graze (5–6 px of a 26 px ribbon, at all
// four corners of a 1×1). Ending the level-2 arms on the middle, 0, instead clears
// it; nothing else changes, and no other level's fold ends over a slant.

import { boxPlacements, UpperPlan } from './boxmn';
import {
  Hand, INDIGO, POKE, WEFT, columnGaps, columnTurnRad, famOffsets, mk, twoFanColumn,
} from './twofan';
import { MaskLink, Point, RGBA, Scene3D, Strand3D } from './types';

/**
 * A two-fan twist column of `levels` LEVELS — storeys, as the studio's Level panel
 * counts them, the starting stitch being level 1 — placed by the box rules.
 */
export function twistColumnPlaced(
  m: number,
  n: number,
  levels: number,
  name: string,
  hand: Hand = 'lh',
  placed = true,
  upper: UpperPlan = 'hand',
  /** End the level-2 arms on the middle, clear of the slant corners below (see above). */
  clearCorners = true,
): Scene3D {
  // twoFanColumn counts the levels it lays OVER the starting stitch's own arms.
  const scene = twoFanColumn(m, n, levels - 1, name, hand);
  if (!placed) return scene;
  const placement = boxPlacements(scene, n, m > 1 || n > 1, upper);
  if (clearCorners && levels > 2) {
    const ends = { ...(placement.planeEnds ?? {}) };
    for (const s of scene.strands) {
      const layer = Number(s.id.split('_')[1]);
      if (layer === 4 || layer === 5) ends[s.id] = { ...ends[s.id], out: TWIST_LEVEL2_END };
    }
    placement.planeEnds = ends;
  }
  return { ...scene, ...placement };
}

/** Where a level-2 arm of a twist ends, at the fold into level 3: the middle. */
export const TWIST_LEVEL2_END = 0;

/**
 * A twist column whose turn is set PER LEVEL: `turns[i]` is how far level i + 2
 * is turned from level i + 1, in radians, so a column of N levels takes N − 1 of
 * them. `twoFanColumn` turns every level by the same angle; this is the same
 * construction with that one number opened up, for finding by eye the angles a
 * column needs (artifacts/twist-turn-editor).
 *
 * Everything else is `twoFanColumn`'s, rule for rule: the slots and their offsets
 * (opened for the face's own turn by `columnGaps`), the landing law that puts an
 * arm's tip on its sibling's line one level up — now solved with THAT level's
 * turn — the arms swapping slots every level, and the same masks. An arm the law
 * leaves too short to cross the band it has to is not lengthened: it is reported
 * in `short`, because lengthening it is exactly what breaks the fold.
 */
export function twistColumnTurns(
  m: number,
  n: number,
  levels: number,
  turns: number[],
  name: string,
  hand: Hand = 'lh',
): Scene3D & { short: Array<{ level: number; id: string; reach: number; need: number }> } {
  const cx = 400;
  const cy = 300;
  const inner = columnGaps(m, n, columnTurnRad(m, n));
  const weftOff = famOffsets(n, inner.weft);
  const warpOff = famOffsets(m, inner.warp);
  interface Slot { warp: boolean; off: number }
  const slots: Slot[] = [
    ...weftOff.map((off) => ({ warp: false, off })),
    ...warpOff.map((off) => ({ warp: true, off })),
  ];
  const NW = 2 * n;
  const half = (off: number[]): number => Math.max(...off.map(Math.abs));
  const band = (k: number): number => (slots[k].warp ? half(weftOff) : half(warpOff));
  const sib = (k: number): number => (k % 2 === 0 ? k + 1 : k - 1);
  const laceOf = (k: number): number => (k < NW ? 1 + Math.floor(k / 2) : 1 + n + Math.floor((k - NW) / 2));

  // The turn into each level, at least a degree either way: at no turn at all the
  // landing law has no answer (the sibling's line is parallel).
  const MIN = Math.PI / 180;
  const d = (i: number): number => {
    const t = turns[i] ?? columnTurnRad(m, n);
    return Math.abs(t) < MIN ? (t < 0 ? -MIN : MIN) : t;
  };
  const angle: number[] = [0];
  for (let i = 1; i < levels; i++) angle[i] = angle[i - 1] + d(i - 1);

  /** The landing law at one level: signed length along the slot that puts the tip on its sibling's line. */
  const solved = (k: number, i: number): number => {
    const t = d(i);
    return (slots[sib(k)].off - slots[k].off * Math.cos(t)) / ((slots[k].warp ? 1 : -1) * Math.sin(t));
  };
  const on = (k: number, along: number): Point => {
    const sl = slots[k];
    return sl.warp ? { x: cx + sl.off, y: cy + along } : { x: cx + along, y: cy + sl.off };
  };
  const turned = (p: Point, i: number): Point => {
    const c = Math.cos(angle[i]);
    const s = Math.sin(angle[i]);
    const x = p.x - cx;
    const y = p.y - cy;
    return { x: cx + x * c - y * s, y: cy + x * s + y * c };
  };
  const colour = (set: number): RGBA => (set > n ? INDIGO : WEFT[(set - 1) % WEFT.length]);

  const reach: number[][] = [];
  const dirs: number[][] = [];
  const short: Array<{ level: number; id: string; reach: number; need: number }> = [];
  for (let i = 0; i < levels; i++) {
    reach[i] = [];
    dirs[i] = [];
    for (let k = 0; k < slots.length; k++) {
      const r = i < levels - 1 ? solved(k, i) : solved(k, Math.max(0, i - 1));
      dirs[i][k] = r >= 0 ? 1 : -1;
      reach[i][k] = Math.abs(r);
    }
  }
  const TAIL = 1.5 * Math.max(...reach.flat().filter(Number.isFinite));

  const strands: Strand3D[] = [];
  const masks: MaskLink[] = [];
  const levelBreaks: number[] = [];
  const nextId: Record<number, number> = {};
  const entry = (k: number): Point => on(k, -dirs[0][k] * (band(k) + POKE));
  for (let p = 0; p < n + m; p++) {
    const k0 = p < n ? 2 * p : NW + 2 * (p - n);
    const set = laceOf(k0);
    nextId[set] = 1;
    strands.push(mk(`${set}_1`, entry(k0 + 1), entry(k0), colour(set)));
  }
  interface Arm { at: Point; last: string; side: 0 | 1 }
  const arm: Arm[] = [];
  for (let k = 0; k < slots.length; k++) {
    arm[k] = { at: entry(k), last: `${laceOf(k)}_1`, side: k % 2 === 0 ? 1 : 0 };
  }
  for (let i = 0; i < levels; i++) {
    if (i > 0) levelBreaks.push(strands.length);
    const laid: string[] = [];
    for (let k = 0; k < slots.length; k++) {
      const set = laceOf(k);
      const a = arm[k];
      const top = i === levels - 1;
      const along = top ? band(k) + TAIL : reach[i][k];
      const id = `${set}_${++nextId[set]}`;
      if (!top && reach[i][k] < band(k) + POKE - 1e-6) {
        short.push({ level: i + 1, id, reach: reach[i][k], need: band(k) + POKE });
      }
      const end = turned(on(k, dirs[i][k] * along), i);
      strands.push(mk(id, { ...a.at }, end, colour(set), a.last, a.side));
      laid[k] = id;
      a.at = end;
      a.last = id;
      a.side = 1;
    }
    for (let a = 0; a < NW; a++) {
      for (let b = NW; b < slots.length; b++) {
        if (a % 2 !== (b - NW) % 2) masks.push({ overId: laid[a], underId: laid[b] });
      }
    }
    for (let p = 0; p < n + m; p++) {
      const k0 = p < n ? 2 * p : NW + 2 * (p - n);
      const t = arm[k0];
      arm[k0] = arm[k0 + 1];
      arm[k0 + 1] = t;
    }
  }
  const flip = (q: Point): Point => ({ x: 2 * cx - q.x, y: q.y });
  const built: Scene3D = { name, strands, masks, levelBreaks };
  const out = hand === 'rh'
    ? { ...built, strands: strands.map((st) => ({ ...st, start: flip(st.start), end: flip(st.end), control_points: st.control_points.map(flip) as [Point, Point] })) }
    : built;
  return { ...out, short };
}

/** `twistColumnTurns`, placed the way `twistColumnPlaced` places a column. */
export function twistColumnTurnsPlaced(
  m: number,
  n: number,
  levels: number,
  turns: number[],
  name: string,
  hand: Hand = 'lh',
  clearCorners = true,
): Scene3D & { short: Array<{ level: number; id: string; reach: number; need: number }> } {
  const scene = twistColumnTurns(m, n, levels, turns, name, hand);
  const placement = boxPlacements(scene, n, m > 1 || n > 1, 'hand');
  if (clearCorners && levels > 2) {
    const ends = { ...(placement.planeEnds ?? {}) };
    for (const st of scene.strands) {
      const layer = Number(st.id.split('_')[1]);
      if (layer === 4 || layer === 5) ends[st.id] = { ...ends[st.id], out: TWIST_LEVEL2_END };
    }
    placement.planeEnds = ends;
  }
  return { ...scene, ...placement };
}
