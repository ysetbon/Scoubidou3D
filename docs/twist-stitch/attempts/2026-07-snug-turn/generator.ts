// FROZEN COPY — the generator exactly as it stood when the 64 scenes in
// scenes.tar.gz were built (repo commit da2b71b). Kept so the results stay
// reproducible if src/model/samples.ts moves on. Not compiled: mk(), the
// palette constants and the types come from src/model/samples.ts and
// src/model/types.ts.

//
//     THE WEAVE is the one thing the geometry does NOT fix: a face is a grid, so
//     over-under-over-under can start either way and the complement of a plain
//     weave is another plain weave. The hand-built 2x1 pins it — read by position,
//     its outermost weft line goes UNDER the outermost warp line — so a weft line
//     rides over the warp lines of OPPOSITE parity, counting both from outside in.
export function twistStitchMN(m: number, n: number, twists: number, name: string): Scene3D {
  const w = 54;
  const G = w; // across the face: the gap between neighbouring warp lines
  const V = w; // through it: the gap between neighbouring weft lines
  const cx = 400;
  const cy = 300;

  const hi = Math.max(m, n);
  const lo = Math.min(m, n);
  const TURN = 2 * Math.atan(1 / (hi + Math.sqrt(hi * hi + 2 * (lo - 1))));
  const c = Math.cos(TURN);
  const s = Math.sin(TURN);

  // A slot is one of the 2(m+n) lines an arm can lie on: `off` is how far it sits
  // from the middle across its own direction, and `dir` which way along it the arm
  // travels — solved below, never chosen.
  interface Slot {
    warp: boolean;
    off: number;
    dir: number;
  }
  const slots: Slot[] = [];
  for (let i = 0; i < 2 * n; i++) slots.push({ warp: false, off: (n - 0.5 - i) * V, dir: 0 });
  for (let j = 0; j < 2 * m; j++) slots.push({ warp: true, off: (m - 0.5 - j) * G, dir: 0 });
  const NW = 2 * n; // where the warp slots start — the layer order is weft, then warp

  // Each lace owns an ADJACENT pair of lines in its own family, so a fold always
  // migrates by exactly one gap whatever m and n are.
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

  // A point on slot `k`'s line, `along` out from the middle, before the level turn.
  const on = (k: number, along: number): Point => {
    const sl = slots[k];
    return sl.warp ? { x: cx + sl.off, y: cy + along } : { x: cx + along, y: cy + sl.off };
  };
  /** Half the band this arm has to cross, plus half a width to clear its far edge. */
  const band = (k: number): number => (slots[k].warp ? (n - 0.5) * V : (m - 0.5) * G) + w / 2;
  /** The law: the one length that lands this tip on its sibling's line one level up. */
  const solved = (k: number): number =>
    (slots[sib[k]].off - slots[k].off * c) / ((slots[k].warp ? 1 : -1) * s);

  const reach: number[] = slots.map((_, k) => solved(k));
  slots.forEach((sl, k) => {
    sl.dir = reach[k] >= 0 ? 1 : -1;
    reach[k] = Math.abs(reach[k]);
  });
  // How far the pinned run pokes past the face before its loop turns back. This is
  // a CLEARANCE, not a length that scales with the face: the loop of a snug stitch
  // sits half a width clear of the band it turns around whatever m and n are. The
  // hand-built 2×1 measures 133 across / 81 through against 135 / 81 for w/2.
  const E = w / 2;
  const TAIL = 1.5 * Math.max(...reach); // the top stitch is never folded again

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
  const entry = (k: number): Point => on(k, -slots[k].dir * (band(k) + E));

  const PALETTE: RGBA[] = [
    ORANGE, YELLOW, TEAL, WHITE,
    { r: 210, g: 90, b: 110, a: 255 },
    { r: 140, g: 160, b: 210, a: 255 },
    { r: 150, g: 195, b: 120, a: 255 },
    { r: 190, g: 140, b: 200, a: 255 },
  ];
  const colour = (set: number): RGBA => PALETTE[(set - 1) % PALETTE.length];

  const strands: Strand3D[] = [];
  const masks: MaskLink[] = [];
  const levelBreaks: number[] = [];
  const nextId: Record<number, number> = {};

  // The laces pinned across each other, each running from one of its lines' entry
  // points to the other's — the slant that offsets its two arms from each other.
  for (const l of laces) {
    nextId[l.set] = 1;
    strands.push(mk(`${l.set}_1`, entry(l.pair[1]), entry(l.pair[0]), colour(l.set), { width: w }));
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
      strands.push(mk(id, { ...a.at }, end, colour(set), { width: w, parentId: a.last, parentSide: a.side }));
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

  return { name, strands, masks, levelBreaks };
}
