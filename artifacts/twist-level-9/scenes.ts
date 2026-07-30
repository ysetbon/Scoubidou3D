// The scenes this artifact shows: a 1x1 two-fan column truncated level by level,
// which is what `scripts/level-shots.mjs` photographs and what the levels gallery
// publishes. Level 9 is the one that went wrong — see the artifact's own page.
//
// Run by artifacts/build.mjs; writes one scene per level into `.work/scenes/`.
import { twoFanColumn } from '../../src/model/twofan';
import { Hand } from '../../src/model/twofan';
import { writeFileSync, mkdirSync } from 'node:fs';

const [outDir, spec] = process.argv.slice(2);
const { m, n, hand, levels } = JSON.parse(spec) as {
  m: number; n: number; hand: Hand; levels: number[];
};

// The full ten-level column, cut at each level break. A truncated column is not
// the same object as a shorter one: the LAST level of a real column runs its
// tails out, and truncating keeps the arms at their reach instead.
const full = twoFanColumn(m, n, 10, `${m}x${n}`, hand);
mkdirSync(outDir, { recursive: true });
for (const L of levels) {
  const cut = L >= 10 ? full.strands.length : full.levelBreaks[L];
  const ids = new Set(full.strands.slice(0, cut).map((s) => s.id));
  writeFileSync(
    `${outDir}/L${L}.json`,
    JSON.stringify({
      name: `${m}x${n} L${L}`,
      strands: full.strands.slice(0, cut),
      masks: full.masks.filter((k) => ids.has(k.overId) && ids.has(k.underId)),
      levelBreaks: full.levelBreaks.filter((b) => b < cut),
    }),
  );
}
console.log(`  scenes: ${levels.map((L) => 'L' + L).join(' ')}`);
