// Where a colour lands when you pick one.
//
// OpenStrand names a layer `N_M`: `N` is the SET — one lace — and `M` is which
// length of that lace this is (connections.nextAttachedName grows a set by
// counting `M` up). A lace worked through a stitch is a dozen layers of one set,
// so "recolour" is really two edits wearing the same name:
//
//   * the LAYER — `1_2` alone goes green, and the rest of the lace stays as it
//     was. This is the edit you want when a single length is wrong, and it is
//     what the panel has always done;
//   * the SET — `1_2` goes green and so does every other `1_x`, because a real
//     lace is one colour along its whole length. Colouring a twelve-length lace
//     used to be twelve presses, and every one of them a separate undo.
//
// The set is read off the NAME, not off the attach graph, for the same reason
// OSS names them that way: the name is the author's own statement of which lace
// a length belongs to, and it survives a file being saved, reopened, and edited
// by hand — where the graph does not. A name outside the `N_M` convention (a
// hand-named sample strand, `s7`) is in no set, and for it the two edits are the
// same edit.

import { RGBA, Scene3D, Strand3D } from './types';

/**
 * How far an edit reaches: the one layer, or every layer of its set.
 *
 * Named for the reach rather than for colour because colour is no longer the
 * only thing that has one — straightening, hiding, and hiding everything else
 * each carry their own, and they all mean this same pair.
 */
export type Scope = 'layer' | 'set';

/** The set a layer name belongs to — the `N` of `N_M` — or null for a name
 *  outside the convention. Masks are named for the pair they join (`1_2_3_4`),
 *  which is not `N_M`, so they fall out here rather than by a special case. */
export function setOf(id: string): string | null {
  const m = /^(\d+)_(\d+)$/.exec(id);
  return m ? m[1] : null;
}

/**
 * Every strand of `id`'s set, in stack order, `id` itself included.
 *
 * A strand with no set is its own only member, so a caller never has to check:
 * asking for the set of a hand-named strand gives back just that strand, and
 * colouring "the set" quietly colours the one layer there is.
 */
export function setMembers(scene: Scene3D, id: string): Strand3D[] {
  const self = scene.strands.find((s) => s.id === id);
  if (!self) return [];
  const set = setOf(id);
  if (set === null) return [self];
  // `self` may be a mask record whose name happens to parse; keep it in the list
  // either way, since it is the strand that was actually picked.
  return scene.strands.filter((s) => s === self || (!s.isMask && setOf(s.id) === set));
}

/**
 * Paint `colour` onto one layer or onto its whole set.
 *
 * Each strand keeps its OWN alpha: the picker is an RGB well, and a lace that
 * was left semi-transparent should not go solid because its neighbour was
 * recoloured. Returns how many strands actually took the colour, which is what
 * the panel names the edit by.
 */
export function recolour(scene: Scene3D, id: string, colour: RGBA, scope: Scope): number {
  const targets = scope === 'set' ? setMembers(scene, id) : scene.strands.filter((s) => s.id === id);
  for (const s of targets) s.color = { r: colour.r, g: colour.g, b: colour.b, a: s.color.a };
  return targets.length;
}
