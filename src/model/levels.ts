// Level breaks — storeys in the layer stack.
//
// The layer panel already ranks laces and spaces them by the (small) Layer lift.
// A LEVEL BREAK is a coarser step: everything above it rests one full strand
// thickness higher, which is exactly the distance at which one ribbon sits ON
// another rather than through it. The button that adds one drops it at the TOP
// of the stack, so existing strands never move and everything created afterwards
// — Add strand, Attach — is born a storey up. See docs/layer-levels.md.
//
// A break is stored as a POSITION in `scene.strands`: value `k` sits between
// strand `k-1` (below) and strand `k` (above), so `k === strands.length` is "at
// the very top" and `k === 0` is "under everything". Positions, not strand ids,
// because that's what the layer panel is — an order, not a set.

import { Scene3D } from './types';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** How many breaks sit at or below `strandIndex` — that strand's storey. */
export function levelAt(scene: Scene3D, strandIndex: number): number {
  let n = 0;
  for (const b of scene.levelBreaks) if (b <= strandIndex) n++;
  return n;
}

/**
 * Is the scene STACKED — more than one storey with something on it?
 *
 * Not the same question as "are there any breaks", and the difference is a bug
 * you could hit by pressing one button. `addLevelBreak` below defaults to the
 * top of the stack, so "add a level" on a seven-strand scene stores `[7]`: a
 * break above every strand, with nothing yet on the far side of it. Every
 * strand is still on storey 0 and nothing about the scene should move.
 *
 * A break lifts every strand from its index upward, so the level is
 * non-decreasing down the stack and the two ends settle it: same storey at both
 * ends means one storey throughout, however many breaks are stored. That also
 * covers a break at 0, which lifts the whole stack together and stacks nothing.
 */
export function isStacked(scene: Scene3D): boolean {
  const n = scene.strands.length;
  return n > 0 && levelAt(scene, n - 1) !== levelAt(scene, 0);
}

/** Add a break, by default at the top of the stack (the button's behaviour). */
export function addLevelBreak(scene: Scene3D, at: number = scene.strands.length): void {
  scene.levelBreaks.push(clamp(Math.round(at), 0, scene.strands.length));
  scene.levelBreaks.sort((a, b) => a - b);
}

/** Slide a break one position up (+1) or down (-1) through the stack. */
export function moveLevelBreak(scene: Scene3D, index: number, dir: 1 | -1): void {
  const cur = scene.levelBreaks[index];
  if (cur === undefined) return;
  const next = clamp(cur + dir, 0, scene.strands.length);
  if (next === cur) return;
  scene.levelBreaks[index] = next;
  scene.levelBreaks.sort((a, b) => a - b);
}

export function removeLevelBreak(scene: Scene3D, index: number): void {
  if (index < 0 || index >= scene.levelBreaks.length) return;
  scene.levelBreaks.splice(index, 1);
}

/**
 * Delete a strand, keeping every break anchored where it looks anchored: a break
 * above the deleted row stays above the same neighbours, one position lower.
 * (Splicing `strands` on its own would silently slide the breaks down the stack.)
 */
export function removeStrandAt(scene: Scene3D, index: number): void {
  if (index < 0 || index >= scene.strands.length) return;
  scene.strands.splice(index, 1);
  scene.levelBreaks = scene.levelBreaks.map((b) => (b > index ? b - 1 : b));
}

/** Read breaks off an untrusted file: integers only, in range, ascending. */
export function normalizeLevelBreaks(raw: unknown, strandCount: number): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out.push(clamp(Math.round(v), 0, strandCount));
  }
  return out.sort((a, b) => a - b);
}
