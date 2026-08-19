// Rings placed by hand, kept as scenes.
//
// Everything else in the sample list is GENERATED: `boxStitchMN`, `twoFanColumn`,
// `swirlStitch` and the rest build their stitch from m, n, a hand and a depth, so
// the sample is really the generator and the scene is whatever it says today. A
// fitted ring is the other kind of thing entirely. Somebody sat in the MXN lab
// and placed every round of it — the extensions, the angles, which arm leaves
// where — and the answer is those coordinates and no others. There is no
// generator to call; the scene IS the record.
//
// So these ship as saved scenes (`sceneIO`'s own format, v2 with `levelBreaks`)
// and load through `sceneFromFile`, which is the same door a file dropped on the
// app comes through: occupancy re-derived, control points normalised, masks
// checked against real ids. Each entry parses afresh, so opening a sample twice
// never hands back a scene the last edit changed.
//
// The storeys are part of the record. A ring like this is worked in rounds, and
// a round is a storey — the block on the ground and each k = −1 continuation one
// step up (see docs/layer-levels.md). The lab draws all of them in one plane
// because it is a plan, not a model; the level breaks in these files are what
// make the rounds stand on each other here.

import { Scene3D } from './types';
import { sceneFromFile } from './sceneIO';
import RING_2X1_K1111_LH from './fitted/ring-2x1-k1111-lh.json';

export const FITTED_RING_SAMPLES: Record<string, () => Scene3D> = {
  // 2×1 worked left-handed, k = −1 four times over: 33 strands, 20 crossings,
  // four storeys with breaks at rows 9, 15, 21 and 27. Fitted by hand, then two
  // of its first-round arms brought in by hand again in the 3D view.
  // The name comes off the file — what the lab called this ring is part of the
  // record too; the fallback is only there for a file that carries none.
  'ring-2x1-k1111-lh': () =>
    sceneFromFile(RING_2X1_K1111_LH, 'Fitted ring — 2×1, k = −1 ×4, left hand'),
};

const GROUP = 'Fitted rings — placed by hand in the MXN lab';

export const FITTED_RING_LABELS: Array<{ key: string; label: string; group: string }> = [
  {
    key: 'ring-2x1-k1111-lh',
    label: 'Left hand · 2×1, k = −1 ×4 — four storeys',
    group: GROUP,
  },
];
