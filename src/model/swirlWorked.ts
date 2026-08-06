// A swirl carried up by hand — the one worked scene there is.
//
// This is not generated. It is a 1 x 2 LH at k = -1 that was worked out by hand
// in the studio, block and two continuations, and it is kept verbatim because it
// is the only ground truth for what happens ABOVE the first continuation.
//
// `swirlStitch` agrees with it where the two overlap: the block cores are
// identical to the pixel, and its four continuation masks are exactly the four
// the rule emits. Where it differs is that its arms bend off-axis to meet the
// continuation, where the twist and the box run them straight along their own
// row or column.
//
// What it settles, and nothing else does: an arm simply CARRIES ON, one segment
// per level, its own chain the whole way; the turn per level sits near the angle
// between the two fans; and which family leads belongs to the level rather than
// to the stitch. What it does NOT settle is what stops a segment — the lengths
// here were placed by eye, and every rule tried against them has failed.

import { Point, RGBA, Scene3D, Strand3D } from './types';
import { mk } from './twofan';

function arm(
  id: string, ax: number, ay: number, bx: number, by: number,
  colour: RGBA, parentId: string | null, parentSide: 0 | 1 | null,
): Strand3D {
  const a: Point = { x: ax, y: ay };
  const b: Point = { x: bx, y: by };
  return mk(id, a, b, colour, parentId ?? undefined, parentSide ?? undefined);
}

export const SWIRL_WORKED_KEY = 'swirl-worked-lh-1x2';

/** The hand-worked 1 x 2 LH, block and two continuations. */
export function swirlWorked(): Scene3D {
  return {
    name: 'Swirl worked by hand — 1x2 LH, k = -1, block and two levels',
    strands: [
  arm('1_1', 344, 272, 456, 216, { r: 226, g: 122, b: 38, a: 255 }, null, null),
  arm('1_2', 456, 216, 324.12715693373326, 203.36445951145788, { r: 226, g: 122, b: 38, a: 255 }, '1_1', 1),
  arm('1_3', 344, 272, 452.893026967948, 273.2825577482895, { r: 226, g: 122, b: 38, a: 255 }, '1_1', 1),
  arm('2_1', 344, 384, 456, 328, { r: 245, g: 200, b: 55, a: 255 }, null, null),
  arm('2_2', 456, 328, 340, 328, { r: 245, g: 200, b: 55, a: 255 }, '2_1', 1),
  arm('2_3', 344, 384, 478.8854784590952, 392.37595820889334, { r: 245, g: 200, b: 55, a: 255 }, '2_1', 1),
  arm('3_1', 428, 412, 372, 188, { r: 61, g: 58, b: 140, a: 255 }, null, null),
  arm('3_2', 428, 412, 401.17736778230994, 171.8006950905238, { r: 61, g: 58, b: 140, a: 255 }, '3_1', 1),
  arm('3_3', 372, 188, 379.4369334839276, 419.28798023273487, { r: 61, g: 58, b: 140, a: 255 }, '3_1', 1),
  arm('3_4', 401.17736778230994, 171.8006950905238, 274.0201043095364, 261.1512426947336, { r: 61, g: 58, b: 140, a: 255 }, '3_2', 1),
  arm('2_4', 340, 328, 323.06827385705816, 336.98155032510243, { r: 245, g: 200, b: 55, a: 255 }, '2_2', 1),
  arm('1_5', 452.893026967948, 273.2825577482895, 466.35126127772514, 265.9629298718406, { r: 226, g: 122, b: 38, a: 255 }, '1_3', 1),
  arm('3_5', 379.4369334839276, 419.28798023273487, 511.5137333304484, 334.30195139949836, { r: 61, g: 58, b: 140, a: 255 }, '3_3', 1),
  arm('1_4', 324.12715693373326, 203.36445951145788, 454.4255217209126, 404.3983800379878, { r: 226, g: 122, b: 38, a: 255 }, '1_2', 1),
  arm('2_5', 478.8854784590952, 392.37595820889334, 354.87301972316385, 186.7035659656906, { r: 245, g: 200, b: 55, a: 255 }, '2_3', 1),
  arm('1_6', 466.35126127772514, 265.9629298718406, 345.93019463047324, 360.28292190442886, { r: 226, g: 122, b: 38, a: 255 }, '1_5', 1),
  arm('2_6', 323.06827385705816, 336.98155032510243, 450.51052315216845, 251.3219383698068, { r: 245, g: 200, b: 55, a: 255 }, '2_4', 1),
  arm('3_6', 511.5137333304484, 334.30195139949836, 241.0100376344978, 183.48894081774787, { r: 61, g: 58, b: 140, a: 255 }, '3_5', 1),
  arm('3_7', 274.0201043095364, 261.1512426947336, 542.8659761206329, 415.15782283758244, { r: 61, g: 58, b: 140, a: 255 }, '3_4', 1),
  arm('1_7', 454.4255217209126, 404.3983800379878, 513.4474632631983, 202.37161624307882, { r: 226, g: 122, b: 38, a: 255 }, '1_4', 1),
  arm('2_7', 450.51052315216845, 251.3219383698068, 361.6111306352303, 447.58275659122717, { r: 245, g: 200, b: 55, a: 255 }, '2_6', 1),
  arm('1_8', 345.93019463047324, 360.28292190442886, 444.2120838541789, 111.24647064156025, { r: 226, g: 122, b: 38, a: 255 }, '1_6', 1),
  arm('2_8', 354.87301972316385, 186.7035659656906, 263.58674909027445, 389.21875816415405, { r: 245, g: 200, b: 55, a: 255 }, '2_5', 1),
    ],
    masks: [
  { overId: '3_2', underId: '1_3' },
  { overId: '3_3', underId: '1_2' },
  { overId: '3_2', underId: '2_3' },
  { overId: '3_3', underId: '2_2' },
  { overId: '1_4', underId: '3_4' },
  { overId: '1_4', underId: '1_5' },
  { overId: '2_5', underId: '2_4' },
  { overId: '2_5', underId: '3_5' },
  { overId: '2_5', underId: '2_6' },
  { overId: '3_4', underId: '2_5' },
  { overId: '3_5', underId: '1_4' },
  { overId: '2_6', underId: '1_4' },
  { overId: '1_4', underId: '1_6' },
  { overId: '3_7', underId: '2_8' },
  { overId: '3_7', underId: '2_7' },
  { overId: '3_6', underId: '1_7' },
  { overId: '3_6', underId: '1_8' },
    ],
    levelBreaks: [9, 17],
  };
}
