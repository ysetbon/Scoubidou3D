// The scenes this artifact shows: the m×n box stitch at a handful of sizes, and
// one of them in the other hand. Straight out of `boxStitchMN` — the same call
// the studio's own Browse grid makes, so the page cannot be showing a different
// object from the sample.
//
// Run by artifacts/build.mjs; writes one scene per face into `.work/scenes/`.
import { boxStitchMN } from '../../src/model/boxmn';
import { Hand } from '../../src/model/twofan';
import { writeFileSync, mkdirSync } from 'node:fs';

const [outDir, spec] = process.argv.slice(2);
const { faces } = JSON.parse(spec) as {
  faces: Array<{ id: string; m: number; n: number; hand: Hand; label: string }>;
};

mkdirSync(outDir, { recursive: true });
for (const f of faces) {
  const scene = boxStitchMN(f.m, f.n, `${f.m}x${f.n} ${f.hand}`, f.hand);
  writeFileSync(`${outDir}/${f.id}.json`, JSON.stringify(scene));
}
console.log(`  scenes: ${faces.map((f) => f.label).join(', ')}`);
