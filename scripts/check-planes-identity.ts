/**
 * Does grouping the Planes view by storey leave an UNSTACKED scene alone?
 *
 * The proposal buckets each lace's members by `levelAt` and draws a figure per
 * bucket. The claim being checked here is the one that matters most: on a scene
 * with no storeys — `box + strand` above all, which is what the plane work is
 * judged against — the bucketing must be a no-op, so the card is the card that
 * ships today rather than one that merely looks like it.
 *
 * The claim reduces to a fact about `levelAt` alone, which is pure scene data
 * and needs none of the 3D pipeline: if every strand of a lace returns the same
 * storey, the lace has ONE bucket holding all of its members, and a figure over
 * all of a lace's members is the figure `laceFigure` draws now.
 *
 * So this prints, for every sample: whether it is stacked, how many storeys have
 * something on them, and — for the unstacked ones — asserts that every strand
 * sits on storey 0. It also names which samples the grouping actually changes,
 * which is the other half of the question.
 */
import { SAMPLES } from '../src/model/samples';
import { levelAt, isStacked } from '../src/model/levels';
import type { Scene3D } from '../src/model/types';

interface Report {
  key: string;
  strands: number;
  breaks: number;
  stacked: boolean;
  storeys: number;
  levels: number[];
}

function inspect(key: string, scene: Scene3D): Report {
  const levels = scene.strands.map((_, i) => levelAt(scene, i));
  return {
    key,
    strands: scene.strands.length,
    breaks: scene.levelBreaks.length,
    stacked: isStacked(scene),
    storeys: new Set(levels).size,
    levels,
  };
}

let failures = 0;
function assert(ok: boolean, what: string): void {
  if (ok) return;
  failures++;
  console.log(`  FAIL  ${what}`);
}

const reports: Report[] = [];
for (const key of Object.keys(SAMPLES)) {
  let scene: Scene3D;
  try {
    scene = SAMPLES[key]();
  } catch (e) {
    console.log(`  skip  ${key} — ${(e as Error).message}`);
    continue;
  }
  reports.push(inspect(key, scene));
}

const flat = reports.filter((r) => !r.stacked);
const stacked = reports.filter((r) => r.stacked);

console.log('\n=== UNTOUCHED — one storey, so one bucket, so today\'s card ===\n');
console.log('  sample                          strands  breaks  storeys');
for (const r of flat) {
  console.log(
    `  ${r.key.padEnd(30)}  ${String(r.strands).padStart(7)}  ${String(r.breaks).padStart(6)}  ${String(r.storeys).padStart(7)}`,
  );
  // The whole guarantee, per sample: nothing is on a storey other than the ground.
  assert(r.storeys === 1, `${r.key}: expected 1 storey with anything on it, got ${r.storeys}`);
  assert(r.levels.every((l) => l === 0), `${r.key}: a strand is off storey 0`);
}

console.log('\n=== GROUPED — real storeys, so the proposal does something ===\n');
console.log('  sample                          strands  breaks  storeys');
for (const r of stacked) {
  console.log(
    `  ${r.key.padEnd(30)}  ${String(r.strands).padStart(7)}  ${String(r.breaks).padStart(6)}  ${String(r.storeys).padStart(7)}`,
  );
  assert(r.storeys > 1, `${r.key}: isStacked said yes but only ${r.storeys} storey carries anything`);
}

// ---- box + strand, the one the plane work is judged against ----------------
const bas = SAMPLES['box-and-strand']();
console.log('\n=== box + strand, strand by strand ===\n');
bas.strands.forEach((s, i) => {
  console.log(`  [${i}] ${s.id.padEnd(6)} level ${levelAt(bas, i)}`);
});
console.log(`\n  levelBreaks   ${JSON.stringify(bas.levelBreaks)}`);
console.log(`  isStacked     ${isStacked(bas)}`);
console.log(`  storeys       ${new Set(bas.strands.map((_, i) => levelAt(bas, i))).size}`);
console.log(`  placed runs   ${Object.keys(bas.planes ?? {}).length}`);
console.log(`  placed cross  ${Object.keys(bas.crossPlanes ?? {}).length}`);

assert(bas.levelBreaks.length === 0, 'box + strand should carry no level breaks');
assert(!isStacked(bas), 'box + strand should not be stacked');
assert(
  bas.strands.every((_, i) => levelAt(bas, i) === 0),
  'every box + strand layer should sit on storey 0',
);

console.log(
  `\n${failures === 0 ? 'OK' : `${failures} FAILURE(S)`} — ` +
    `${flat.length} unstacked sample(s) untouched, ${stacked.length} grouped\n`,
);
process.exit(failures === 0 ? 0 : 1);
