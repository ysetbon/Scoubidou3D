// Scenes placed by hand, kept as records.
//
// Everything else in the sample list is GENERATED: `boxStitchMN`, `twoFanColumn`,
// `swirlStitch` and the rest build their stitch from m, n, a hand and a depth, so
// the sample is really the generator and the scene is whatever it says today. A
// scene worked by hand is the other kind of thing entirely. Somebody sat down and
// placed every round of it — the extensions, the angles, which arm leaves where —
// and the answer is those coordinates and no others. There is no generator to
// call; the scene IS the record.
//
// So these ship as saved scenes (`sceneIO`'s own format, v2 with `levelBreaks`)
// and load through `sceneFromFile`, which is the same door a file dropped on the
// app comes through: occupancy re-derived, control points normalised, masks
// checked against real ids. Each entry parses afresh, so opening a sample twice
// never hands back a scene the last edit changed.
//
// The storeys are part of the record. A stitch like this is worked in rounds, and
// a round is a storey — the block on the ground and each k = −1 continuation one
// step up (see docs/layer-levels.md). The lab draws all of them in one plane
// because it is a plan, not a model; the level breaks in these files are what
// make the rounds stand on each other here.

import { Scene3D } from './types';
import { sceneFromFile } from './sceneIO';
import RING_2X1_K1111_LH from './fitted/ring-2x1-k1111-lh.json';
import SWIRL_COLUMN_1X2_LH from './fitted/swirl-column-1x2-lh.json';

export const PLACED_SAMPLES: Record<string, () => Scene3D> = {
  // 2×1 worked left-handed, k = −1 four times over: 33 strands, 20 crossings,
  // four storeys with breaks at rows 9, 15, 21 and 27. Fitted by hand, then two
  // of its first-round arms brought in by hand again in the 3D view.
  // The name comes off the file — what the lab called this ring is part of the
  // record too; the fallback is only there for a file that carries none.
  'ring-2x1-k1111-lh': () =>
    sceneFromFile(RING_2X1_K1111_LH, 'Fitted ring — 2×1, k = −1 ×4, left hand'),

  // The 1×2 LH column the swirl notes are drawn from, carried further than they
  // go: 41 strands, 30 crossings, six storeys with breaks at rows 9, 17, 23, 29
  // and 35. Its ground storey is `swirlStitch(1, 2)`'s block — the three cores
  // land on the generator's coordinates exactly and its twelve block-and-first-
  // continuation masks are the twelve the rule emits — with four of the six
  // block arms bent off-axis to meet what comes next. Above that it is placed,
  // not derived, and it is the scene `swirl.ts`'s note on the column is read off:
  // there is no cross-lace landing — each of the six arms carries on as its own
  // chain and no two ever meet — and a chain turns by better than a right angle
  // from one storey to the next, which is what makes the thing corkscrew rather
  // than stack. The turn measured against the angle between the two fans is in
  // docs/swirl-mxn-k-minus-one/README.md.
  'swirl-column-1x2-lh': () =>
    sceneFromFile(SWIRL_COLUMN_1X2_LH, 'Swirl column — 1×2, k = −1, left hand'),
};

const RING_GROUP = 'Fitted rings — placed by hand in the MXN lab';
const COLUMN_GROUP = 'Worked columns — placed storey by storey';

export const PLACED_LABELS: Array<{ key: string; label: string; group: string }> = [
  {
    key: 'ring-2x1-k1111-lh',
    label: 'Left hand · 2×1, k = −1 ×4 — four storeys',
    group: RING_GROUP,
  },
  {
    key: 'swirl-column-1x2-lh',
    label: 'Left hand · swirl 1×2, k = −1 — six storeys, turning',
    group: COLUMN_GROUP,
  },
];
