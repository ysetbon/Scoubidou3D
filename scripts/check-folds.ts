/**
 * Can every fold in the model actually be BENT?
 *
 * A fold is spliced out for a storey turn (`zFolds`), and that turn is a
 * half-cylinder whose radius is half the step between the fold's two runs. The
 * lace's own section is swept round it, so the ribbon's INNER surface lands at
 *
 *     step/2 − thickness/2
 *
 * At a step of one thickness — the two runs touching, which is exactly what a
 * storey resting on the storey below produces, and what a declared plane can ask
 * for outright — that radius is ZERO: the inner face wrings itself into a line
 * and the ribbon shows a nick at the crease. Any smaller and it goes NEGATIVE,
 * the lace passes through its own body, and the crease renders as a torn
 * crumple. Both were visible on `box + strand` with planes declared.
 *
 * `easeFolds` now floors the step at `FOLD_MIN` thicknesses and ramps the
 * difference back into the runs, so the crease is never asked to bend tighter
 * than the section's own corner radius. This checks that floor holds — across
 * step sizes from zero up to three thicknesses, both directions of climb, and
 * the separations the lab's turn family spans — and that it is a FLOOR and not a
 * clamp: a fold that already steps further keeps its own step.
 */
import { easeFolds, zFolds, foldsOf } from '../src/geometry/polyline';
import { CORNER, FOLD_MIN } from '../src/scene/StrandScene';
import type { Vec3 } from '../src/geometry/vec';

const T = 0.52; // one thickness, world units — the studio's own at ribbon 26
const WIDTH = 1.08;
const REACH = T * 2;
const LEG = WIDTH * (0.95 / 1.1); // LEG_PER_WIDTH, as StrandScene passes it
const STEP = 0.19; // in-plane sample spacing, as the studio samples centrelines

/** A lace running in, doubling back at `sepDeg` from dead reverse, and running
 *  out again — the two runs at `zA` and `zB`, meeting at one shared vertex. */
function foldedLace(sepDeg: number, zA: number, zB: number, n = 60): Vec3[] {
  const out: Vec3[] = [];
  const a = { x: 1, y: 0 };
  const back = (180 - sepDeg) * (Math.PI / 180);
  const b = { x: -Math.cos(back - Math.PI), y: Math.sin(back - Math.PI) };
  for (let i = n; i >= 1; i--) out.push({ x: -a.x * i * STEP, y: -a.y * i * STEP, z: zA });
  out.push({ x: 0, y: 0, z: (zA + zB) / 2, zIn: zA, zOut: zB });
  for (let i = 1; i <= n; i++) out.push({ x: b.x * i * STEP, y: b.y * i * STEP, z: zB });
  return out;
}

let failures = 0;
function assert(ok: boolean, what: string): void {
  if (ok) console.log(`  PASS  ${what}`);
  else {
    failures++;
    console.log(`  FAIL  ${what}`);
  }
}

const MIN_STEP = T * FOLD_MIN;
const WANT_INNER = T * CORNER; // what the floor is worth, as a bend radius

console.log(`floor ${FOLD_MIN}t = ${MIN_STEP.toFixed(4)}; inner radius it buys ${WANT_INNER.toFixed(4)}\n`);

// --- the floor holds, whatever the fold was asking for --------------------
const SEPS = [0, 12, 25, 48, 60, 90, 110];
const STEPS_T = [0, 0.05, 0.31, 0.99, 1, 1.5, 1.96, 2, 3];
let worstInner = Infinity;
let worstAt = '';
for (const sep of SEPS) {
  for (const s of STEPS_T) {
    for (const dir of [1, -1]) {
      const line = foldedLace(sep, 0, dir * s * T);
      easeFolds(line, REACH, { min: MIN_STEP, max: Infinity });
      const folds = foldsOf(line);
      if (folds.length !== 1) continue; // at 110° apart it is no longer a fold
      const p = line[folds[0].index];
      const settled = Math.abs((p.zOut ?? p.z) - (p.zIn ?? p.z));
      const inner = settled / 2 - T / 2;
      if (inner < worstInner) {
        worstInner = inner;
        worstAt = `sep ${sep}°, asked ${s}t, ${dir > 0 ? 'up' : 'down'}`;
      }
    }
  }
}
assert(
  worstInner >= WANT_INNER - 1e-9,
  `every fold clears its own corner radius — worst ${worstInner.toFixed(4)} vs ${WANT_INNER.toFixed(4)} (${worstAt})`,
);

// --- and it is a floor, not a clamp ---------------------------------------
for (const s of [2, 3, 5]) {
  const line = foldedLace(25, 0, s * T);
  easeFolds(line, REACH, { min: MIN_STEP, max: Infinity });
  const p = line[foldsOf(line)[0].index];
  const settled = ((p.zOut ?? p.z) - (p.zIn ?? p.z)) / T;
  assert(Math.abs(settled - s) < 1e-9, `a ${s}t fold keeps its ${s}t step (got ${settled.toFixed(4)}t)`);
}

// --- the cap still caps, where a cap is asked for -------------------------
{
  const line = foldedLace(25, 0, 5 * T);
  easeFolds(line, REACH, { min: MIN_STEP, max: 2 * T });
  const p = line[foldsOf(line)[0].index];
  const settled = ((p.zOut ?? p.z) - (p.zIn ?? p.z)) / T;
  assert(Math.abs(settled - 2) < 1e-9, `a 5t fold under a 2t cap comes back to 2t (got ${settled.toFixed(4)}t)`);
}

// --- a descending fold is pushed APART, not dragged through itself --------
{
  const line = foldedLace(25, 0, -0.1 * T);
  easeFolds(line, REACH, { min: MIN_STEP, max: Infinity });
  const p = line[foldsOf(line)[0].index];
  const settled = ((p.zOut ?? p.z) - (p.zIn ?? p.z)) / T;
  assert(settled < 0 && Math.abs(settled + FOLD_MIN) < 1e-9, `a descending fold still descends (got ${settled.toFixed(4)}t)`);
}

// --- and the turn actually spliced in has that radius ---------------------
{
  const worst: Array<{ what: string; inner: number }> = [];
  for (const sep of [0, 25, 60, 90]) {
    for (const s of [0, 0.31, 1, 2]) {
      const line = foldedLace(sep, 0, s * T);
      easeFolds(line, REACH, { min: MIN_STEP, max: Infinity });
      const turns = zFolds(line, LEG);
      if (turns.length !== 1) continue;
      const t = turns[0];
      // The tip is what bends: 20 samples per leg either side of it, and the
      // legs are given the run's own weave back, so only the tip's arc measures
      // the radius the material is asked for.
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = t.from + 20; k <= t.to - 20; k++) {
        const z = line[k].z;
        if (z < lo) lo = z;
        if (z > hi) hi = z;
      }
      worst.push({ what: `sep ${sep}°, asked ${s}t`, inner: (hi - lo) / 2 - T / 2 });
    }
  }
  worst.sort((a, b) => a.inner - b.inner);
  const w = worst[0];
  assert(
    w.inner >= WANT_INNER - 1e-6,
    `the spliced turn's own arc clears it too — worst ${w.inner.toFixed(4)} (${w.what})`,
  );
}

console.log(`\n${failures === 0 ? 'all clear' : `${failures} FAILED`}`);
if (failures) process.exit(1);
