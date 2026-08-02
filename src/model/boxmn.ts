// The BOX stitch on an m × n face — the twist's starting stitch at k = 0.
//
// A box and a twist begin from the same object: `twoFanStitch`'s block, m warp
// ribbons crossing n weft ones, every loose end carried out past the band it
// crosses. What happens next is all that separates them, and it is one number.
// The twist walks a pointer k places round the rim, so every end aims at some
// other end, the two families fan out, and the arms have to be turned to a
// shared angle and stretched until their gaps even out — that is `twoFanStitch`
// and `twoFanColumn`, and most of twofan.ts is the price of it.
//
// At k = 0 the pointer does not move. Every end pairs with the end straight
// opposite, so each arm carries on along ITS OWN line, back across the block and
// out the far side. Nothing rotates and nothing is stretched: the alignment pass
// the app runs after a twist reports the continuation is already exact and
// changes nothing. So there is no angle to derive here and no dial to set —
// exactly one box per size per hand, and this file is short because of it.
//
// THE CONSTRUCTION:
//
//   1. The block, unchanged from `twoFanStitch` — rows and columns one GAP
//      apart, an arm running POKE past the far edge of the band it crosses.
//   2. `_2` carries on as `_4` and `_3` as `_5`, each collinear with the arm it
//      continues and ending one GAP past that arm's own start. So a ribbon reads
//      as one straight bar running clean across the block and out both sides.
//   3. The block's over/under is repeated one for one on the new crossings, a
//      storey up. Rounds do not interlock; the box rests on the starting stitch.
//
// Drawn out, both hands, every size: docs/box-stitch-mxn/.

import { MaskLink, Point, RGBA, Scene3D, Strand3D } from './types';
import { GAP, HANDS, Hand, INDIGO, POKE, TWOFAN_MAX, WEFT, mk } from './twofan';

/** Same ceiling as the twist family: 1×1 … 8×8. */
export const BOX_MAX = TWOFAN_MAX;

/** Browser key. Hand is part of it, so a face is a different sample in each. */
export const boxKey = (hand: Hand, m: number, n: number): string => `box-${hand}-${m}x${n}`;

export interface BoxShape {
  key: string;
  m: number;
  n: number;
  /** Every piece the scene holds: 3(m+n) block + 2(m+n) continuation. */
  strands: number;
  /** Over/unders the scene declares: 2mn in the block, 2mn in the continuation. */
  masks: number;
  /** Where a warp line meets a weft one, over both layers: 8mn. */
  crossings: number;
  /** The box's footprint in source px — 112(m+1) by 112(n+1). */
  width: number;
  height: number;
  /**
   * How much more binding one lace does than another: `max(m,n)/min(m,n)`.
   *
   * The one thing a box face can be lopsided about. Nothing here is loose — no
   * arm hangs past its band, because no arm was turned off its own line — but a
   * 1×8's single warp ribbon still passes through all 64 crossings while each of
   * its eight wefts passes through 8. That is the whole of what m ≠ n costs.
   */
  load: number;
}

export const BOX_FAMILY: BoxShape[] = (() => {
  const out: BoxShape[] = [];
  for (let m = 1; m <= BOX_MAX; m++) {
    for (let n = 1; n <= BOX_MAX; n++) {
      out.push({
        key: `box-${m}x${n}`,
        m,
        n,
        strands: 5 * (m + n),
        masks: 4 * m * n,
        crossings: 8 * m * n,
        width: 2 * GAP * (m + 1),
        height: 2 * GAP * (n + 1),
        load: Math.max(m, n) / Math.min(m, n),
      });
    }
  }
  return out;
})();

/**
 * The starting stitch and its k = 0 continuation, in both hands.
 *
 * Naming follows the reference, same as the twist: a set is one ribbon and a
 * layer is which piece of it. `_1` is the slant buried in the block, `_2` and
 * `_3` the two arms leaving it, `_4` / `_5` the continuation — `_2` carries on
 * as `_4`, `_3` as `_5`. Weft sets are numbered first (1 … n), then warp
 * (n+1 … n+m). `levelBreaks` splits block from continuation, so the level
 * control shows the starting stitch alone and then the box closed over it.
 *
 * HAND. Where the twist mirrors the whole scene, a box only swaps which of a
 * set's two lines each arm takes: LH lays the weft `_2` on the high row and the
 * warp `_2` up the right column, RH the other way about. The two are the same
 * object — reflect one and rename `_2` to `_3` and you have the other — but
 * built this way the ids match the drawn sheet in both hands, and the mask list
 * comes out identical for both, which is the thing worth being able to say.
 */
export function boxStitchMN(m: number, n: number, name: string, hand: Hand = 'lh'): Scene3D {
  const cx = 400;
  const cy = 300;
  const lh = hand === 'lh';
  // The 2n weft arms lie on rows one gap apart, the 2m warp arms on columns the
  // same, and an arm runs out to POKE past the far edge of the other's band.
  const armX = ((2 * m - 1) * GAP) / 2 + POKE;
  const armY = ((2 * n - 1) * GAP) / 2 + POKE;
  const row = (i: number): number => cy + (i - (2 * n - 1) / 2) * GAP;
  const col = (j: number): number => cx + (j - (2 * m - 1) / 2) * GAP;

  const strands: Strand3D[] = [];
  const masks: MaskLink[] = [];

  interface Piece {
    set: number;
    colour: RGBA;
    /** `_1` … `_5`, as [start, end]. */
    seg: Record<number, [Point, Point]>;
  }
  const warp: Piece[] = [];
  const weft: Piece[] = [];

  for (let q = 0; q < m; q++) {
    const left = col(2 * q);
    const right = col(2 * q + 1);
    const lowL = { x: left, y: cy + n * GAP };
    const lowR = { x: right, y: cy + n * GAP };
    const highL = { x: left, y: cy - n * GAP };
    const highR = { x: right, y: cy - n * GAP };
    // Each arm ends one gap past the OTHER arm's start, which is the same as
    // saying the finished bar is one gap longer than the arm at each end.
    const seg: Piece['seg'] = lh
      ? {
          1: [lowR, highL],
          2: [lowR, { x: right, y: cy - armY }], // right column, running up
          3: [highL, { x: left, y: cy + armY }], // left column, running down
          4: [{ x: right, y: cy - armY }, { x: right, y: cy + (n + 1) * GAP }],
          5: [{ x: left, y: cy + armY }, { x: left, y: cy - (n + 1) * GAP }],
        }
      : {
          1: [lowL, highR],
          2: [highR, { x: right, y: cy + armY }], // right column, running down
          3: [lowL, { x: left, y: cy - armY }], //  left column, running up
          4: [{ x: right, y: cy + armY }, { x: right, y: cy - (n + 1) * GAP }],
          5: [{ x: left, y: cy - armY }, { x: left, y: cy + (n + 1) * GAP }],
        };
    warp.push({ set: n + q + 1, colour: INDIGO, seg });
  }

  for (let p = 0; p < n; p++) {
    const hi = row(2 * p);
    const lo = row(2 * p + 1);
    const inHi = { x: cx - m * GAP, y: hi };
    const inLo = { x: cx - m * GAP, y: lo };
    const outHi = { x: cx + m * GAP, y: hi };
    const outLo = { x: cx + m * GAP, y: lo };
    const seg: Piece['seg'] = lh
      ? {
          1: [inLo, outHi],
          2: [outHi, { x: cx - armX, y: hi }], // high row, running left
          3: [inLo, { x: cx + armX, y: lo }], //  low row, running right
          4: [{ x: cx - armX, y: hi }, { x: cx + (m + 1) * GAP, y: hi }],
          5: [{ x: cx + armX, y: lo }, { x: cx - (m + 1) * GAP, y: lo }],
        }
      : {
          1: [inHi, outLo],
          2: [outLo, { x: cx - armX, y: lo }], // low row, running left
          3: [inHi, { x: cx + armX, y: hi }], // high row, running right
          4: [{ x: cx - armX, y: lo }, { x: cx + (m + 1) * GAP, y: lo }],
          5: [{ x: cx + armX, y: hi }, { x: cx - (m + 1) * GAP, y: hi }],
        };
    weft.push({ set: p + 1, colour: WEFT[p % WEFT.length], seg });
  }

  // Stacking order IS the weave at half the crossings. The two masks below flip
  // the warp over the weft at (`_2`,`_3`) and (`_3`,`_2`); the other two pairs,
  // (`_2`,`_2`) and (`_3`,`_3`), are left to the layer stack — so a layer's warps
  // have to go down BEFORE its wefts, and the weave alternates as it should.
  const lay = (s: Piece, layer: number, parent?: [string, 0 | 1]): void => {
    const [start, end] = s.seg[layer];
    strands.push(
      mk(`${s.set}_${layer}`, { ...start }, { ...end }, s.colour, parent?.[0], parent?.[1]),
    );
  };
  /** Which end of `_1` an arm hangs off — the arm that starts where `_1` does is side 0. */
  const side = (s: Piece, layer: number): 0 | 1 => {
    const a = s.seg[layer][0];
    const b = s.seg[1][0];
    return a.x === b.x && a.y === b.y ? 0 : 1;
  };

  for (const s of warp) lay(s, 1);
  for (const s of weft) lay(s, 1);
  for (const s of warp) lay(s, 2, [`${s.set}_1`, side(s, 2)]);
  for (const s of weft) lay(s, 2, [`${s.set}_1`, side(s, 2)]);
  for (const s of warp) lay(s, 3, [`${s.set}_1`, side(s, 3)]);
  for (const s of weft) lay(s, 3, [`${s.set}_1`, side(s, 3)]);

  // A storey up. The continuation does not interlock with the block — it rests
  // on it, which is what the level break says, and it is why the level control
  // shows the starting stitch first and the closed box second.
  const levelBreaks = [strands.length];

  // Same rule a layer down: warps first, then wefts, so the second pass weaves
  // against itself exactly as the block does.
  for (const s of warp) for (const l of [5, 4]) lay(s, l, [`${s.set}_${l - 2}`, 1]);
  for (const s of weft) for (const l of [4, 5]) lay(s, l, [`${s.set}_${l - 2}`, 1]);

  for (const v of warp) {
    for (const h of weft) {
      masks.push({ overId: `${v.set}_2`, underId: `${h.set}_3` });
      masks.push({ overId: `${v.set}_3`, underId: `${h.set}_2` });
      masks.push({ overId: `${v.set}_5`, underId: `${h.set}_5` });
      masks.push({ overId: `${v.set}_4`, underId: `${h.set}_4` });
    }
  }

  return { name, strands, masks, levelBreaks };
}

export const BOX_SAMPLES: Record<string, () => Scene3D> = Object.fromEntries(
  HANDS.flatMap(({ hand, sense }) =>
    BOX_FAMILY.map((s) => [
      boxKey(hand, s.m, s.n),
      () =>
        boxStitchMN(
          s.m,
          s.n,
          `Box stitch — ${s.m}×${s.n} ${hand.toUpperCase()} (${sense}), ` +
            `${s.strands} strands, ${s.masks} masks, ${s.width}×${s.height}`,
          hand,
        ),
    ]),
  ),
);

// The named list. Sixty-four faces per hand would drown the dropdown, so it gets
// the diagonal — the eight square boxes, where m = n — and the browser grid gets
// the rest. Same split the twist family makes.
const GROUP = 'Box — every m×n face (block + k = 0 continuation)';

export const BOX_LABELS: Array<{ key: string; label: string; group: string }> = HANDS.flatMap(
  ({ hand, label }) =>
    BOX_FAMILY.filter((s) => s.m === s.n).map((s) => ({
      key: boxKey(hand, s.m, s.n),
      label: `${label} · box ${s.m}×${s.n} — ${s.strands} strands, ${s.crossings} crossings`,
      group: GROUP,
    })),
);
