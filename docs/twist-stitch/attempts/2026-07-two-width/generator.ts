// The same generator, with the ONE assumption the hand-built 2x1 cannot test
// released: that both families are the same width.
//
// A weft arm's pitch is the weft lace's width V; the band it crosses is m warp
// widths, m*G. So it is snug when V/sin0 = m*G. A warp arm is snug when
// G/sin0 = n*V. Both at once needs  m*G^2 = n*V^2, i.e.
//
//     V/G = sqrt(m/n)          and     sin 0 = 1/sqrt(m*n)
//
// which is zero overhang on BOTH sides for any m,n. With V = G it collapses to
// sin 0 = 1/max(m,n) and the narrow side is left |m-n| widths long — what we
// have now.
import { Point, RGBA, Scene3D, Strand3D, MaskLink } from '/home/user/Scoubidou3D/src/model/types';
import { sceneToFile } from '/home/user/Scoubidou3D/src/model/sceneIO';
import { mkdirSync, writeFileSync } from 'node:fs';

const STROKE: RGBA = { r: 30, g: 30, b: 30, a: 255 };
function mk(
  id: string,
  start: Point,
  end: Point,
  color: RGBA,
  opts: { width: number; parentId?: string; parentSide?: 0 | 1 },
): Strand3D {
  return {
    id,
    start,
    end,
    control_points: [{ ...start }, { ...start }],
    control_point_center: null,
    control_point_center_locked: false,
    triangleHasMoved: false,
    cp2Activated: false,
    width: opts.width,
    stroke_width: 4,
    color,
    stroke_color: STROKE,
    thickness: null,
    visible: true,
    isMask: false,
    hasCircles: [false, false],
    parentId: opts.parentId ?? null,
    parentSide: opts.parentSide ?? null,
  };
}

const PALETTE: RGBA[] = [
  { r: 226, g: 122, b: 38, a: 255 },
  { r: 245, g: 200, b: 55, a: 255 },
  { r: 60, g: 175, b: 175, a: 255 },
  { r: 240, g: 240, b: 238, a: 255 },
  { r: 210, g: 90, b: 110, a: 255 },
  { r: 140, g: 160, b: 210, a: 255 },
  { r: 150, g: 195, b: 120, a: 255 },
  { r: 190, g: 140, b: 200, a: 255 },
];

export interface Build {
  scene: Scene3D;
  turn: number;
  V: number;
  G: number;
  overhang: number[];
}

/** V = weft lace width (and weft pitch), G = warp lace width. */
export function build(m: number, n: number, twists: number, V: number, G: number, name: string): Build {
  const cx = 400;
  const cy = 300;

  interface Slot {
    warp: boolean;
    off: number;
    dir: number;
    w: number;
  }
  const slots: Slot[] = [];
  for (let i = 0; i < 2 * n; i++) slots.push({ warp: false, off: (n - 0.5 - i) * V, dir: 0, w: V });
  for (let j = 0; j < 2 * m; j++) slots.push({ warp: true, off: (m - 0.5 - j) * G, dir: 0, w: G });
  const NW = 2 * n;

  const sib: number[] = [];
  const laces: Array<{ set: number; pair: [number, number] }> = [];
  for (let p = 0; p < n; p++) laces.push({ set: 1 + p, pair: [2 * p, 2 * p + 1] });
  for (let p = 0; p < m; p++) laces.push({ set: 1 + n + p, pair: [NW + 2 * p, NW + 2 * p + 1] });
  for (const l of laces) {
    sib[l.pair[0]] = l.pair[1];
    sib[l.pair[1]] = l.pair[0];
  }
  const laceOf: number[] = [];
  for (const l of laces) for (const k of l.pair) laceOf[k] = l.set;

  // Half the band an arm crosses: out to the far edge of the outermost
  // PERPENDICULAR line, which is that family's width, not this one's.
  const band = (k: number): number => (slots[k].warp ? n * V : m * G);
  const solved = (k: number, c: number, s: number): number =>
    (slots[sib[k]].off - slots[k].off * c) / ((slots[k].warp ? 1 : -1) * s);

  // The snug turn: the largest one where no arm falls short of its own band.
  // Bisected rather than closed-form so it stays honest for V != G.
  const fits = (t: number): boolean => {
    const c = Math.cos(t);
    const s = Math.sin(t);
    return slots.every((_, k) => Math.abs(solved(k, c, s)) >= band(k) - 1e-9);
  };
  let lo = 1e-6;
  let hi = Math.PI / 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  const TURN = lo;
  const c = Math.cos(TURN);
  const s = Math.sin(TURN);

  const reach: number[] = slots.map((_, k) => solved(k, c, s));
  slots.forEach((sl, k) => {
    sl.dir = reach[k] >= 0 ? 1 : -1;
    reach[k] = Math.abs(reach[k]);
  });
  const overhang = slots.map((sl, k) => (reach[k] - band(k)) / sl.w);
  const TAIL = 1.5 * Math.max(...reach);

  const on = (k: number, along: number): Point => {
    const sl = slots[k];
    return sl.warp ? { x: cx + sl.off, y: cy + along } : { x: cx + along, y: cy + sl.off };
  };
  const turned = (p: Point, level: number): Point => {
    const t = TURN * level;
    const cc = Math.cos(t);
    const ss = Math.sin(t);
    const x = p.x - cx;
    const y = p.y - cy;
    return { x: cx + x * cc - y * ss, y: cy + x * ss + y * cc };
  };
  const tip = (k: number, level: number, along: number): Point =>
    turned(on(k, slots[k].dir * along), level);
  // the loop turns half its own width clear of the band it goes round
  const entry = (k: number): Point => on(k, -slots[k].dir * (band(k) + slots[k].w / 2));

  const strands: Strand3D[] = [];
  const masks: MaskLink[] = [];
  const levelBreaks: number[] = [];
  const nextId: Record<number, number> = {};
  const colour = (set: number): RGBA => PALETTE[(set - 1) % PALETTE.length];
  const widthOf = (set: number): number => (set <= n ? V : G);

  for (const l of laces) {
    nextId[l.set] = 1;
    strands.push(
      mk(`${l.set}_1`, entry(l.pair[1]), entry(l.pair[0]), colour(l.set), { width: widthOf(l.set) }),
    );
  }
  interface Arm {
    at: Point;
    last: string;
    side: 0 | 1;
  }
  const arm: Arm[] = [];
  for (const l of laces) {
    arm[l.pair[0]] = { at: entry(l.pair[0]), last: `${l.set}_1`, side: 1 };
    arm[l.pair[1]] = { at: entry(l.pair[1]), last: `${l.set}_1`, side: 0 };
  }

  for (let level = 0; level <= twists; level++) {
    if (level > 0) levelBreaks.push(strands.length);
    const laid: string[] = [];
    for (let k = 0; k < slots.length; k++) {
      const set = laceOf[k];
      const a = arm[k];
      const along = level === twists ? band(k) + TAIL : reach[k];
      const end = tip(k, level, along);
      const id = `${set}_${++nextId[set]}`;
      strands.push(
        mk(id, { ...a.at }, end, colour(set), {
          width: widthOf(set),
          parentId: a.last,
          parentSide: a.side,
        }),
      );
      laid[k] = id;
      a.at = end;
      a.last = id;
      a.side = 1;
    }
    for (let i = 0; i < NW; i++) {
      for (let j = NW; j < slots.length; j++) {
        if (i % 2 !== (j - NW) % 2) masks.push({ overId: laid[i], underId: laid[j] });
      }
    }
    for (const l of laces) {
      const t = arm[l.pair[0]];
      arm[l.pair[0]] = arm[l.pair[1]];
      arm[l.pair[1]] = t;
    }
  }
  return { scene: { name, strands, masks, levelBreaks }, turn: (TURN * 180) / Math.PI, V, G, overhang };
}

// --- report + emit -----------------------------------------------------------
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const SHAPES: Array<[number, number]> = [
  [1, 6],
  [2, 6],
  [3, 7],
  [2, 1],
  [2, 4],
  [8, 1],
];
const W = 54;
console.log('shape   variant   V     G     turn     worst overhang (widths)');
for (const [m, n] of SHAPES) {
  // A: one width for both, what ships today
  const A = build(m, n, 10, W, W, `Twist ${m}×${n} — equal widths`);
  // B: widths in the ratio the snug-both algebra asks for, geometric mean 54
  const r = Math.pow(m / n, 0.25);
  const B = build(m, n, 10, W * r, W / r, `Twist ${m}×${n} — snug both sides`);
  for (const [tag, b] of [['A equal', A], ['B ratio', B]] as Array<[string, Build]>) {
    console.log(
      `${m}x${n}   ${tag}  ${b.V.toFixed(1).padStart(5)} ${b.G.toFixed(1).padStart(5)}` +
        ` ${b.turn.toFixed(2).padStart(7)}°  ${Math.max(...b.overhang).toFixed(2).padStart(6)}`,
    );
    writeFileSync(`${OUT}/${tag[0]}-${m}x${n}.json`, JSON.stringify(sceneToFile(b.scene)));
  }
}
