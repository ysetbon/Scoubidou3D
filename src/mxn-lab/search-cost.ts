// What a run can cost, before it is run.
//
// Mirrors of the engine's own search constants. They size the busy plaque's
// ceiling in the lab and the queue's ordering in the farm, so they live apart
// from the lab component rather than inside it: /mxn/gpu/ needs the arithmetic
// and nothing else React draws. weave-studio.tsx re-exports them, so the
// existing importers are unchanged.
//
// Keep in step with MAX_PAIR_EXTENSION, COMBO_BUDGET and
// _get_alignment_combo_limit in the Python.

export const MAX_PAIR_EXTENSION = 200;
export const DEFAULT_COMBO_BUDGET = 400_000;
export const ENGINE_COMBO_LIMIT = 10_000_000;

// The ladder pick_extension_step() walks, finest first. 5 is offered as an
// explicit choice in the lab but is deliberately not in the auto ladder,
// exactly as in the Python — adding it there changes what every existing
// stitch picks.
export const EXT_STEPS = [10, 20, 25, 40, 50, 100];

// Same formula as pick_extension_step(): the grid per pair is 0..ext_max in
// `step` increments, and pairs are independent.
export function comboCount(step: number, pairs: number, extMax = MAX_PAIR_EXTENSION) {
  return Math.pow(Math.floor(extMax / step) + 1, Math.max(pairs, 1));
}

export function autoStep(pairs: number, budget: number, extMax = MAX_PAIR_EXTENSION) {
  for (const step of EXT_STEPS) {
    if (comboCount(step, pairs, extMax) <= budget) return step;
  }
  return EXT_STEPS[EXT_STEPS.length - 1];
}

/**
 * The grid a judged ★ best implies: its own reach, and the finest step that
 * fits inside the same budget once the ceiling is that much smaller.
 *
 * A hand-fitted ring sits off the grid entirely — 3×1 k=−1 was judged at
 * `(62.55)` and `(55.75, 57.3, 27.5)` — so its numbers cannot be searched FOR.
 * What they can do is say where to look: nothing beyond about 63 was ever going
 * to be the answer, and the 70→200 the engine walks anyway is the expensive
 * part. Cap there and the saving buys resolution instead:
 *
 *   0..200 step 10   21 values    9,261 combos   (what an auto sweep does)
 *   0..200 step  5   41 values   68,921 combos   (what an explicit 5 costs)
 *   0.. 70 step  5   15 values    3,375 combos   finer AND a third the cost
 *   0.. 70 step  2   36 values   46,656 combos   finer still, cheaper than 5 today
 *
 * `EXT_STEPS` is not consulted: its ladder starts at 10 because that is what a
 * full-width grid can afford, and the whole point here is that a narrow one can
 * afford better. The ceiling rounds UP to a multiple of the step so the grid
 * reaches past the pick rather than stopping just short of it.
 */
export const HAND_STEPS = [1, 2, 5, 10, 20, 25, 50] as const;

export function handGrid(reach: number, pairs: number, budget: number) {
  const ceiling = Math.max(10, Math.ceil(reach));
  // The ceiling for this search is what the FULL-WIDTH one would have cost, not
  // the raw combo budget. Spending the whole budget on resolution is the
  // obvious rule and is measurably wrong: on 3×1 k=−1, whose ★ best reaches
  // 62.55, the budget affords step 1 and the answers go
  //
  //   0..200 step 10 (what ships)   33.2s    8/12
  //   0.. 70 step 10                 2.1s    6/12   too coarse
  //   0.. 70 step  5                13.3s   10/12   better than ships, faster
  //   0.. 70 step  2               185.6s   10/12   14x the time, no better
  //
  // Past step 5 the search stops finding anything and only costs. Holding the
  // combo count to what the level was going to spend anyway keeps the narrower
  // grid strictly a better deal: never slower than the search it replaces, with
  // every pixel of the saving turned into resolution up to the point it pays.
  const affordable = Math.min(budget, comboCount(autoStep(pairs, budget), pairs));
  for (const step of HAND_STEPS) {
    const rounded = Math.ceil(ceiling / step) * step;
    if (comboCount(step, pairs, rounded) <= affordable) return { step, ceiling: rounded };
  }
  const step = HAND_STEPS[HAND_STEPS.length - 1];
  return { step, ceiling: Math.ceil(ceiling / step) * step };
}

// A level's two search groups hold 2m and 2n arms, paired outside-in, so the
// worst group is the one with more pairs.
export function worstPairs(m: number, n: number) {
  return Math.max(Math.ceil((2 * m) / 2), Math.ceil((2 * n) / 2), 1);
}

/**
 * How much searching a run can possibly do.
 *
 * Every level searches both groups, and a group is the extension grid the
 * engine will walk: (ext_max / step + 1) choices per pair, pairs independent —
 * the same formula pick_extension_step() sizes a run with. It is a ceiling,
 * not a forecast: the search stops a group early when it has what it needs, so
 * the run finishes at or before this. That is the point of showing it. A bar
 * against a number that can be beaten is a promise the engine can keep.
 */
export function worstCase(m: number, n: number, levels: number, step: number) {
  const perLevel = comboCount(step, m) + comboCount(step, n);
  return { perLevel, groups: levels * 2, total: perLevel * levels };
}
