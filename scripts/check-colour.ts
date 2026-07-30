// Checks where a picked colour lands:
//   npm run check:colour
// One layer, or the whole lace it belongs to. The rule is in src/model/colour.ts
// — the SET is the `N` of an OpenStrand `N_M` name — and everything below is
// that rule from a different side: a lace going one colour in one edit, a
// neighbouring lace left alone, alpha surviving, and a name outside the
// convention behaving like the set of one that it is.

import { recolour, setMembers, setOf } from '../src/model/colour';
import { makeSample } from '../src/model/samples';
import { RGBA, Scene3D } from '../src/model/types';

let bad = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    bad++;
    console.log(`  FAIL  ${what}`);
  } else {
    console.log(`   ok   ${what}`);
  }
};

const GREEN: RGBA = { r: 20, g: 200, b: 90, a: 255 };
const same = (a: RGBA, b: RGBA): boolean => a.r === b.r && a.g === b.g && a.b === b.b;

// A box stitch is three laces — 1_x, 2_x, 3_x — many lengths each, over levels.
const rich = (): Scene3D => makeSample('box-stitch-10');

// ---- 1. reading the set off a name -----------------------------------------
{
  ok(setOf('1_2') === '1', '1_2 belongs to set 1');
  ok(setOf('12_3') === '12', 'and 12_3 to set 12 — the number, not the first digit');
  ok(setOf('s7') === null, 'a hand-named strand is in no set');
  ok(setOf('1_2_3_4') === null, 'and neither is a mask, named for the pair it joins');
}

// ---- 2. the members of a set ------------------------------------------------
{
  const scene = rich();
  const mates = setMembers(scene, '1_2');
  ok(mates.length > 1, `1_2 has company — ${mates.length} lengths of lace 1`);
  ok(mates.every((s) => setOf(s.id) === '1'), 'and every one of them is a 1_x');
  ok(mates.some((s) => s.id === '1_2'), 'the strand asked about is one of its own set');
  const all = scene.strands.filter((s) => !s.isMask).length;
  ok(mates.length < all, 'the other laces are not in it');
  ok(setMembers(scene, 'nope').length === 0, 'a name that is in no scene has no members');
}

// ---- 3. colouring one layer -------------------------------------------------
{
  const scene = rich();
  const before = scene.strands.map((s) => ({ ...s.color }));
  const n = recolour(scene, '1_2', GREEN, 'layer');
  ok(n === 1, 'colouring a layer touches one strand');
  scene.strands.forEach((s, i) => {
    if (s.id === '1_2') return;
    if (!same(s.color, before[i])) {
      bad++;
      console.log(`  FAIL  ${s.id} moved when only 1_2 was painted`);
    }
  });
  ok(same(scene.strands.find((s) => s.id === '1_2')!.color, GREEN), 'and 1_2 took the colour');
}

// ---- 4. colouring the whole set ---------------------------------------------
{
  const scene = rich();
  const others = scene.strands.filter((s) => setOf(s.id) !== null && setOf(s.id) !== '1');
  const before = others.map((s) => ({ ...s.color }));
  const n = recolour(scene, '1_2', GREEN, 'set');
  ok(n > 1, `colouring the set takes the lace in one edit — ${n} layers`);
  const lace = scene.strands.filter((s) => setOf(s.id) === '1');
  ok(lace.every((s) => same(s.color, GREEN)), 'every 1_x is the new colour');
  ok(
    others.every((s, i) => same(s.color, before[i])),
    'and the laces beside it are exactly as they were',
  );
}

// ---- 5. what each strand keeps ----------------------------------------------
{
  const scene = rich();
  // A lace left semi-transparent should not go solid because a neighbour was
  // painted: the picker is an RGB well, and alpha is the strand's own.
  const lace = scene.strands.filter((s) => setOf(s.id) === '1');
  lace[0].color = { ...lace[0].color, a: 90 };
  const strokes = scene.strands.map((s) => ({ ...s.stroke_color }));
  recolour(scene, '1_2', GREEN, 'set');
  ok(lace[0].color.a === 90, 'a strand keeps its own alpha');
  ok(lace[1].color.a === 255, 'and so does the opaque one beside it');
  ok(
    scene.strands.every((s, i) => same(s.stroke_color, strokes[i])),
    'the outline colour is not the fill and is left alone',
  );
}

// ---- 6. a strand with no set ------------------------------------------------
{
  const scene = rich();
  const loner = scene.strands[0];
  loner.id = 'hand-named';
  ok(setMembers(scene, 'hand-named').length === 1, 'a strand outside the convention is alone');
  const n = recolour(scene, 'hand-named', GREEN, 'set');
  ok(n === 1, 'so "the whole set" is quietly just that strand');
  ok(same(loner.color, GREEN), 'and it still takes the colour');
}

console.log(bad === 0 ? '\nall good' : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
