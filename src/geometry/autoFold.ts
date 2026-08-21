// Which separation gets which turn.
//
// The fold family (`fold.ts`) is one builder with a dial on it — the LEAN, from
// a crease on the bisector to a crease square to the strap — plus the point past
// which a lace has stopped folding and is merely carrying on. Auto is the four
// numbers that say where in that family each separation sits, and it is shared
// so the Z band lab and the studio phase their turns the same way.
//
// The SHELL THRESHOLD is computed rather than set. Past `2 asin(step / width)`
// an exact fold's tip stands taller than the storey it climbs and flares into a
// shell, so that angle is the constraint the whole setting exists to clear.

/** Where the crease swings towards square, how far, and where folding stops. */
export interface Auto {
  /** Degrees: the lean has reached its influence by here. */
  lo: number;
  /** Degrees: it starts falling away after here. */
  hi: number;
  /** Degrees: past here the lace stops folding and carries on. */
  carry: number;
  /** How square the crease ever gets, 0..1. */
  cap: number;
}

/**
 * The phasing both pages ship with, arrived at on the lab's own dial.
 *
 * The square window sits where an exact fold would otherwise flare, the
 * influence is a quarter rather than the whole way — enough to clear the shell
 * without giving up the developable tip — and folding stops at 126°, which in
 * the studio is past anything that counts as a fold at all (a turn has to reach
 * 60° to be one, so a studio separation never exceeds 120°).
 */
export const AUTO_DEFAULT: Auto = { lo: 48, hi: 61, carry: 126, cap: 0.25 };

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const smooth = (t: number): number => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

/** The three angles in order, whatever order they were dropped in. */
function bounds(a: Auto): [number, number, number] {
  const lo = clamp(a.lo, 0, 180);
  const hi = clamp(Math.max(a.hi, lo), 0, 180);
  return [lo, hi, clamp(Math.max(a.carry, hi), 0, 180)];
}

/** Whether this separation has stopped folding altogether. */
export function autoCarries(a: Auto, separation: number): boolean {
  return separation >= bounds(a)[2];
}

/**
 * The lean this separation gets: nothing at a dead fold-back, the influence
 * across the plateau, nothing again by the time folding stops.
 *
 * The two ends are 0 for reasons that are not symmetry. At 0 the bisector IS
 * square to the strap, so both ends of the fold family are the same hairpin and
 * the lean cannot matter. At the carry angle it matters for the opposite
 * reason: the lean has to be back on the bisector BEFORE the builder changes,
 * because an exact fold there has already flattened into a shallow oblique step
 * and a step is the closest a fold ever gets to a ramp. Handing over anywhere
 * else means handing over across a bigger gap than necessary.
 */
export function autoLean(a: Auto, separation: number): number {
  const [lo, hi, carry] = bounds(a);
  if (separation >= carry) return 0;
  if (separation <= lo) return a.cap * smooth(lo <= 0 ? 1 : separation / lo);
  if (separation >= hi) return a.cap * smooth(carry <= hi ? 0 : (carry - separation) / (carry - hi));
  return a.cap;
}

/** The separation past which an exact fold's tip outgrows its own storey. */
export function shellThreshold(step: number, width: number): number {
  return (2 * Math.asin(Math.min(1, step / width)) * 180) / Math.PI;
}

/**
 * Which separations actually come out flared, given the lean they are getting.
 *
 * The shell angle alone is only the LEAN 0 answer, and reporting the window's
 * left shoulder against it was the wrong test: it asks where the square window
 * starts and never asks how much square is in it. A window opening at 48° with
 * a quarter of an influence barely swings the crease at all, and every angle
 * inside it still flares — which the panel cheerfully called "covered".
 *
 * The real condition falls out of the crease rule. At lean λ the tip turns the
 * heading by (1-λ)·swing + λ·180, so the crease sits at half of that off the
 * strap, and the tip's width axis tilts by the complement. Its vertical span is
 * then `width · sin((1-λ)·sep / 2)`, which is taller than the storey exactly
 * when
 *
 *     (1 - λ(sep)) · sep  >  2 asin(step / width)
 *
 * Both ends check out: at λ 0 it is the shell angle itself, at λ 1 the tip never
 * outgrows anything however wide the runs open. Past the carry angle nothing is
 * folding, so nothing there can flare.
 */
export function flareBand(
  a: Auto,
  step: number,
  width: number,
): { from: number; to: number } | null {
  const shell = shellThreshold(step, width);
  const stop = bounds(a)[2];
  let from = Infinity;
  let to = -Infinity;
  for (let s = 0; s < stop; s++) {
    if ((1 - autoLean(a, s)) * s > shell + 1e-9) {
      from = Math.min(from, s);
      to = Math.max(to, s);
    }
  }
  return from <= to ? { from, to } : null;
}
