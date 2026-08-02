// Checks the m×n box family against the rules the drawn sheet states.
//   npm run check:box
// The sheet (docs/box-stitch-mxn/) draws all 64 faces in both hands from a
// closed set of rules, and its own drawing code reproduces the eight stitches
// the reference generator produced byte for byte. This asserts the SCENES the
// app builds are the same object: same counts, same bars, same right angles,
// and — the part no formula can be read off — the same weave at every crossing.
import { readFileSync } from 'node:fs';
import { BOX_FAMILY, BOX_MAX, boxKey, boxStitchMN } from '../src/model/boxmn';
import { GAP, HANDS, Hand, POKE } from '../src/model/twofan';
import { Scene3D, Strand3D } from '../src/model/types';

let bad = 0;
const fail = (what: string): void => {
  bad++;
  console.log(`  FAIL ${what}`);
};

const len = (s: Strand3D): number => Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y);
const dir = (s: Strand3D): number => {
  const a = (Math.round((Math.atan2(s.end.y - s.start.y, s.end.x - s.start.x) * 180) / Math.PI) + 360) % 360;
  return a;
};
const byId = (sc: Scene3D): Record<string, Strand3D> =>
  Object.fromEntries(sc.strands.map((s) => [s.id, s]));

/** Who rides over at this crossing: the mask if one covers it, else the stack. */
const over = (sc: Scene3D, a: string, b: string): string => {
  for (const m of sc.masks) {
    if (m.overId === a && m.underId === b) return a;
    if (m.overId === b && m.underId === a) return b;
  }
  const ia = sc.strands.findIndex((s) => s.id === a);
  const ib = sc.strands.findIndex((s) => s.id === b);
  return ia > ib ? a : b;
};

console.log(`box family — ${BOX_FAMILY.length} faces x ${HANDS.length} hands`);

let weaveChecked = 0;
for (const { hand } of HANDS as Array<{ hand: Hand }>) {
  for (const f of BOX_FAMILY) {
    const { m, n } = f;
    const tag = `${m}x${n} ${hand}`;
    const sc = boxStitchMN(m, n, boxKey(hand, m, n), hand);
    const S = byId(sc);

    // ---- counts ------------------------------------------------------------
    if (sc.strands.length !== f.strands) fail(`${tag}: ${sc.strands.length} strands, want ${f.strands}`);
    if (sc.masks.length !== f.masks) fail(`${tag}: ${sc.masks.length} masks, want ${f.masks}`);
    if (new Set(sc.strands.map((s) => s.id)).size !== sc.strands.length) fail(`${tag}: duplicate ids`);
    for (const k of sc.masks)
      if (!S[k.overId] || !S[k.underId]) fail(`${tag}: mask names a strand that is not there`);
    // One break, and it falls exactly where the block ends — the continuation
    // rests on the starting stitch rather than interlocking with it.
    if (sc.levelBreaks.length !== 1 || sc.levelBreaks[0] !== 3 * (m + n))
      fail(`${tag}: level break at ${sc.levelBreaks}, want [${3 * (m + n)}]`);

    // ---- the rules the sheet states ----------------------------------------
    const hBar = 2 * GAP * m + 60;
    const vBar = 2 * GAP * n + 60;
    const arm = (count: number): number => 2 * GAP * count + 4;
    for (let p = 1; p <= n; p++) {
      for (const l of [2, 3]) {
        if (Math.abs(len(S[`${p}_${l}`]) - arm(m)) > 1e-9) fail(`${tag}: ${p}_${l} arm ${len(S[`${p}_${l}`])}, want ${arm(m)}`);
      }
      for (const l of [4, 5]) {
        if (Math.abs(len(S[`${p}_${l}`]) - hBar) > 1e-9) fail(`${tag}: ${p}_${l} bar ${len(S[`${p}_${l}`])}, want ${hBar}`);
      }
      // 0° and 180°, both hands — a horizontal bar never depends on the hand.
      if (dir(S[`${p}_4`]) !== 0) fail(`${tag}: ${p}_4 runs ${dir(S[`${p}_4`])}°, want 0°`);
      if (dir(S[`${p}_5`]) !== 180) fail(`${tag}: ${p}_5 runs ${dir(S[`${p}_5`])}°, want 180°`);
      // `_4` carries on from `_2` and is collinear with it; `_5` from `_3`.
      for (const [c, a] of [[4, 2], [5, 3]] as Array<[number, number]>) {
        const k = S[`${p}_${c}`];
        const j = S[`${p}_${a}`];
        if (k.start.x !== j.end.x || k.start.y !== j.end.y) fail(`${tag}: ${p}_${c} does not start where ${p}_${a} ends`);
        if (k.start.y !== j.start.y) fail(`${tag}: ${p}_${c} is not collinear with ${p}_${a}`);
        if (k.parentId !== j.id || k.parentSide !== 1) fail(`${tag}: ${p}_${c} is not attached to ${p}_${a}'s end`);
      }
    }
    for (let q = 1; q <= m; q++) {
      const set = n + q;
      for (const l of [2, 3]) {
        if (Math.abs(len(S[`${set}_${l}`]) - arm(n)) > 1e-9) fail(`${tag}: ${set}_${l} arm, want ${arm(n)}`);
      }
      for (const l of [4, 5]) {
        if (Math.abs(len(S[`${set}_${l}`]) - vBar) > 1e-9) fail(`${tag}: ${set}_${l} bar, want ${vBar}`);
      }
      // The hand, and the only thing it changes: down/up in LH, up/down in RH.
      const want4 = hand === 'lh' ? 90 : 270;
      if (dir(S[`${set}_4`]) !== want4) fail(`${tag}: ${set}_4 runs ${dir(S[`${set}_4`])}°, want ${want4}°`);
      if (dir(S[`${set}_5`]) !== (want4 + 180) % 360) fail(`${tag}: ${set}_5 runs ${dir(S[`${set}_5`])}°`);
      for (const [c, a] of [[4, 2], [5, 3]] as Array<[number, number]>) {
        const k = S[`${set}_${c}`];
        const j = S[`${set}_${a}`];
        if (k.start.x !== j.end.x || k.start.y !== j.end.y) fail(`${tag}: ${set}_${c} does not start where ${set}_${a} ends`);
        if (k.start.x !== j.start.x) fail(`${tag}: ${set}_${c} is not collinear with ${set}_${a}`);
      }
    }

    // ---- the footprint -----------------------------------------------------
    const xs = sc.strands.flatMap((s) => [s.start.x, s.end.x]);
    const ys = sc.strands.flatMap((s) => [s.start.y, s.end.y]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w !== f.width || h !== f.height) fail(`${tag}: box ${w}x${h}, want ${f.width}x${f.height}`);
    // An arm pokes exactly POKE past the far edge of the band it crosses, which
    // is what makes this the twist's own block rather than something new. The
    // band is the outermost line of the other family, taken off the scene.
    const colX: number[] = []; //  the warp band: the columns its two arms lie on
    const rowY: number[] = []; //  the weft band: the rows its two arms lie on
    const armX: number[] = []; //  every weft arm endpoint
    const armY: number[] = []; //  every warp arm endpoint
    for (let q = 1; q <= m; q++) {
      colX.push(S[`${n + q}_1`].start.x, S[`${n + q}_1`].end.x);
      for (const l of [2, 3]) armY.push(S[`${n + q}_${l}`].start.y, S[`${n + q}_${l}`].end.y);
    }
    for (let p = 1; p <= n; p++) {
      rowY.push(S[`${p}_1`].start.y, S[`${p}_1`].end.y);
      for (const l of [2, 3]) armX.push(S[`${p}_${l}`].start.x, S[`${p}_${l}`].end.x);
    }
    const pokeX = Math.min(...colX) - Math.min(...armX);
    const pokeY = Math.min(...rowY) - Math.min(...armY);
    if (Math.abs(pokeX - POKE) > 1e-9)
      fail(`${tag}: weft arms reach ${pokeX.toFixed(2)} past the warp band, want ${POKE}`);
    if (Math.abs(pokeY - POKE) > 1e-9)
      fail(`${tag}: warp arms reach ${pokeY.toFixed(2)} past the weft band, want ${POKE}`);

    // ---- the weave ---------------------------------------------------------
    // Half the crossings are masked and half fall to the layer stack, so neither
    // the mask list nor the stack order proves the weave on its own. Resolve
    // every crossing the way the scene does and demand a checkerboard: at a
    // warp `_2` the weft rides over on its own `_2` and under on its `_3`, and
    // the far side of the ribbon reverses it. Same again, a storey up.
    for (let q = 1; q <= m; q++) {
      const v = n + q;
      for (let p = 1; p <= n; p++) {
        for (const [vl, hl, wantWeft] of [
          [2, 2, true], [2, 3, false], [3, 2, false], [3, 3, true],
          [4, 4, false], [4, 5, true], [5, 4, true], [5, 5, false],
        ] as Array<[number, number, boolean]>) {
          const winner = over(sc, `${v}_${vl}`, `${p}_${hl}`);
          const isWeft = winner === `${p}_${hl}`;
          if (isWeft !== wantWeft)
            fail(`${tag}: ${v}_${vl} x ${p}_${hl} — ${winner} rides over, want the ${wantWeft ? 'weft' : 'warp'}`);
          weaveChecked++;
        }
      }
    }
  }
}

console.log(`  ${weaveChecked} crossings resolved and checked for alternation`);
console.log(`  ${BOX_FAMILY.length * HANDS.length} scenes built, 1x1 to ${BOX_MAX}x${BOX_MAX}, both hands`);

// ---- and the drawn sheet ----------------------------------------------------
// docs/box-stitch-mxn/artifact.html draws the same 64 faces flat, from its own
// copy of the construction — it has to, since it is one self-contained file on a
// host that can fetch nothing. Two copies of a construction drift. This reads the
// page's own drawing code out of it and puts every strand of every scene against
// the segment the sheet would draw, so they cannot.
//
// The sheet's frame is (1232, 392) where the scene's is (400, 300); nothing else
// differs, and nothing else is allowed to.
// Relative to the repo root, which is where npm runs it from — the bundle itself
// lands in node_modules/.cache, so its own location is no use here.
const SHEET = 'docs/box-stitch-mxn/artifact.html';
const page = readFileSync(SHEET, 'utf8');
const from = page.indexOf('  var W = 46,');
const to = page.indexOf('  // ---- the page ---');
if (from < 0 || to < 0 || to < from) {
  fail('cannot find the drawing code in docs/box-stitch-mxn/artifact.html — has it moved?');
} else {
  const sheet = new Function(
    `return (function(){ let out; ${page.slice(from, to)}; out = { build }; return out; })()`,
  )() as { build: (m: number, n: number, hand: string) => any };
  const DX = 1232 - 400;
  const DY = 392 - 300;
  const at = (p: { x: number; y: number }): string => `${(p.x + DX).toFixed(2)},${(p.y + DY).toFixed(2)}`;
  const raw = (p: { x: number; y: number }): string => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  let checked = 0;
  for (const { hand } of HANDS as Array<{ hand: Hand }>) {
    for (const f of BOX_FAMILY) {
      const sc = boxStitchMN(f.m, f.n, 'x', hand);
      const S = byId(sc);
      const drawn = sheet.build(f.m, f.n, hand);
      if (drawn.warp.length + drawn.weft.length !== f.m + f.n)
        fail(`${f.m}x${f.n} ${hand}: the sheet drew ${drawn.warp.length + drawn.weft.length} ribbons, want ${f.m + f.n}`);
      for (const side of [drawn.warp, drawn.weft]) {
        for (const piece of side) {
          for (const l of [1, 2, 3, 4, 5]) {
            const id = `${piece.set}_${l}`;
            const want = `${raw(piece['s' + l][0])} -> ${raw(piece['s' + l][1])}`;
            const got = S[id] ? `${at(S[id].start)} -> ${at(S[id].end)}` : 'missing';
            if (got !== want) fail(`${f.m}x${f.n} ${hand} ${id}: scene ${got}, sheet ${want}`);
            checked++;
          }
        }
      }
    }
  }
  console.log(`  ${checked} strands put against the drawn sheet, coordinate for coordinate`);
}

console.log(bad ? `  ${bad} FAILED` : '  all clear');
if (bad) process.exit(1);
