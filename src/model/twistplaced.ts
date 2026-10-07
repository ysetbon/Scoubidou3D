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
import { Hand, twoFanColumn } from './twofan';
import { Scene3D } from './types';

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
