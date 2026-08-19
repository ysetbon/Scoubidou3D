// The scenes this artifact shows: one hand-fitted 2x1 ring, k = -1 four times
// over, cut storey by storey — plus the same ring with no storeys at all.
//
// The ring itself came off the MXN lab as an OpenStrand save (ring.json). That
// file knows nothing about levels: the lab draws every round in ONE plane, and
// `sceneFromOss` says so — it hands back `levelBreaks: []`. Its four "levels" are
// four observations of k, not four storeys.
//
// A level in Scoubidou3D is the other thing entirely: a break in the layer stack,
// above which everything rests one storey — TWO strand thicknesses — higher (see
// docs/layer-levels.md). So the ring has to be told where its storeys are, and
// that is the whole of this file: the block is the ground, and each k = -1 round
// is one storey up, exactly as `swirlStitch` splits its own single continuation
// off its block.
//
// Run by artifacts/build.mjs; writes one scene per file into `.work/scenes/`.
import { writeFileSync, mkdirSync } from 'node:fs';
import { sceneFromOss } from '../../src/model/importOss';
import { collectJunctions } from '../../src/model/connections';
import { Scene3D } from '../../src/model/types';
import RING from './ring.json';

const [outDir, spec] = process.argv.slice(2);

// artifact.json states what this ring is meant to be; ring.json carries what it
// actually is. They are two different files and only one of them was fitted by
// hand, so say so out loud rather than trusting either.
const want = JSON.parse(spec) as { m: number; n: number; ks: number[]; hand: string };
const { m, n, ks, hand } = RING.params;
if (m !== want.m || n !== want.n || hand !== want.hand || ks.join() !== want.ks.join()) {
  throw new Error(
    `ring.json is ${m}x${n} ${hand} ks=[${ks}], artifact.json asked for ` +
      `${want.m}x${want.n} ${want.hand} ks=[${want.ks}]`,
  );
}

const scene = sceneFromOss(RING, `${m}x${n} · k = -1 ×${ks.length}`);
const ROUNDS = ks.length;
const PER_ROUND = 2 * (m + n); // two arms leaving each lace, every round

/**
 * Which storey a strand belongs on, from its OpenStrand layer name.
 *
 * The lab names a lace's members `set_suffix`. Suffixes 1..3 are the block —
 * the buried strand and the two arms leaving it — and each round after that
 * takes the next PAIR of suffixes: round 1 is `_4`/`_5`, round 2 `_6`/`_7`, and
 * so on. A round is what a level break separates, so the storey is the round.
 */
function storeyOf(id: string): number {
  const suffix = Number(id.slice(id.lastIndexOf('_') + 1));
  if (!Number.isFinite(suffix) || suffix < 1) throw new Error(`unreadable layer name: ${id}`);
  return suffix <= 3 ? 0 : Math.floor(suffix / 2) - 1;
}

const storey = scene.strands.map((s) => storeyOf(s.id));

// ---- the checks, because a storey put on wrong still renders --------------
// A break is a POSITION in the layer stack, so a storey that is not one
// unbroken run of that stack cannot be expressed as one — and if the lab ever
// writes its rounds in a different order, this build stops rather than quietly
// drawing a ring whose storeys interleave.
for (let i = 1; i < storey.length; i++) {
  if (storey[i] < storey[i - 1]) {
    throw new Error(
      `storeys are not in stacking order: ${scene.strands[i - 1].id} (storey ${storey[i - 1]}) ` +
        `is under ${scene.strands[i].id} (storey ${storey[i]})`,
    );
  }
}
for (let r = 1; r <= ROUNDS; r++) {
  const arms = storey.filter((s) => s === r).length;
  if (arms !== PER_ROUND) {
    throw new Error(`storey ${r} carries ${arms} arms, expected ${PER_ROUND} for ${m}x${n}`);
  }
}
if (storey[storey.length - 1] !== ROUNDS) {
  throw new Error(`the ring stops at storey ${storey[storey.length - 1]}, expected ${ROUNDS}`);
}
// Every crossing this ring weaves is between two arms of the SAME round. That
// is what makes the storeys honest: a mask reaching across a break would be
// asking two strands a full storey apart to interlock.
const storeyById = new Map(scene.strands.map((s, i) => [s.id, storey[i]]));
for (const mask of scene.masks) {
  const a = storeyById.get(mask.overId);
  const b = storeyById.get(mask.underId);
  if (a !== b) {
    throw new Error(`mask ${mask.overId} over ${mask.underId} crosses storeys (${a} vs ${b})`);
  }
}

/** Where each storey starts in the stack — which is exactly its level break. */
const breaks: number[] = [];
for (let i = 1; i < storey.length; i++) if (storey[i] !== storey[i - 1]) breaks.push(i);

/** The ring cut after storey `top`, carrying the breaks below it. */
function upTo(top: number, withLevels: boolean): Scene3D {
  const cut = storey.filter((s) => s <= top).length;
  const strands = scene.strands.slice(0, cut);
  const ids = new Set(strands.map((s) => s.id));
  return {
    name: `${m}x${n} k=-1 · storey ${top}`,
    strands,
    masks: scene.masks.filter((k) => ids.has(k.overId) && ids.has(k.underId)),
    levelBreaks: withLevels ? breaks.filter((b) => b < cut) : [],
  };
}

mkdirSync(outDir, { recursive: true });
for (let s = 0; s <= ROUNDS; s++) {
  writeFileSync(`${outDir}/S${s}.json`, JSON.stringify(upTo(s, true)));
}
// The same ring as the lab hands it over: every round in one plane, which is
// what you get today if you import the save and draw it.
writeFileSync(`${outDir}/FLAT.json`, JSON.stringify(upTo(ROUNDS, false)));

// How much of the ring holds together once the storeys are in — the page quotes
// these, so print them where a build can be read.
const full = upTo(ROUNDS, true);
const junctions = collectJunctions(full);
const root = full.strands.map((_, i) => i);
const find = (a: number): number => {
  while (root[a] !== a) {
    root[a] = root[root[a]];
    a = root[a];
  }
  return a;
};
for (const j of junctions) {
  const a = find(j.childIndex);
  const b = find(j.parentIndex);
  if (a !== b) root[b] = a;
}
const pieces = new Set(full.strands.map((_, i) => find(i))).size;

console.log(
  `  scenes: ${Array.from({ length: ROUNDS + 1 }, (_, s) => 'S' + s).join(' ')} FLAT` +
    `  (breaks at ${breaks.join(', ')} of ${scene.strands.length} strands)`,
);
// Every arm the save hangs off another one is a joint the model should close.
const declared = RING.strands.filter((r) => typeof r.attached_to === 'string').length;
console.log(
  `  joints: ${junctions.length} welded of ${declared} — the ring reads as ${pieces} piece(s)`,
);
