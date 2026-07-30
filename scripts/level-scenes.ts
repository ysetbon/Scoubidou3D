// Every level of every m x n twist face, as a scene the studio can load.
//
//   npm run levels          (runs this, then level-shots.mjs, then build-levels.py)
//
// A level of a column is the column TRUNCATED there, not a shorter column: the
// last level of a real column runs its tails out (twofan.ts), and truncating
// keeps the arms at their reach instead. That difference is the whole point of
// the contact sheet — level 10 is the only picture where the arms are finished.
//
// Left hand, because that is the hand the gallery has always published.
import { TWOFAN_MAX, twoFanColumn } from '../src/model/twofan';
import { mkdirSync, writeFileSync } from 'node:fs';

const LEVELS = 10;
const out = process.argv[2] ?? 'node_modules/.cache/levels/scenes';
const only = process.argv[3]; // optional single face, e.g. 1x1

let faces = 0;
for (let m = 1; m <= TWOFAN_MAX; m++) {
  for (let n = 1; n <= TWOFAN_MAX; n++) {
    const key = `${m}x${n}`;
    if (only && only !== key) continue;
    const full = twoFanColumn(m, n, LEVELS, key, 'lh');
    const dir = `${out}/${key}`;
    mkdirSync(dir, { recursive: true });
    for (let L = 0; L <= LEVELS; L++) {
      const cut = L >= LEVELS ? full.strands.length : full.levelBreaks[L];
      const ids = new Set(full.strands.slice(0, cut).map((s) => s.id));
      writeFileSync(
        `${dir}/L${String(L).padStart(2, '0')}.json`,
        JSON.stringify({
          name: `${key} L${L}`,
          strands: full.strands.slice(0, cut),
          masks: full.masks.filter((k) => ids.has(k.overId) && ids.has(k.underId)),
          levelBreaks: full.levelBreaks.filter((b) => b < cut),
        }),
      );
    }
    faces++;
  }
}
console.log(`${faces} faces x ${LEVELS + 1} levels -> ${out}`);
