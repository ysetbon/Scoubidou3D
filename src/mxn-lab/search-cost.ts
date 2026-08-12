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

export function autoStep(pairs: number, budget: number) {
  for (const step of EXT_STEPS) {
    if (comboCount(step, pairs) <= budget) return step;
  }
  return EXT_STEPS[EXT_STEPS.length - 1];
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
