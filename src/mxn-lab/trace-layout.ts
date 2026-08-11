// Where a combo sits in the trace panel's grid.
//
// The combo index is already a base-E number with one digit per extension pair
// -- itertools.product enumerates it that way, and the panel's geometry()
// decodes it that way -- so the grid is that number de-interleaved: the digit
// whose place value has an even exponent goes on x, odd on y. P = 1 falls out
// as one row of E and P = 2 as row = pair 0, column = pair 1, which are the two
// layouts this panel used to reach by a special case each.
//
// An odd P >= 3 would come out E:1 under that rule (441 x 21 at P = 3), which
// is unreadable, so its leading digit is wrapped into a near-square arrangement
// of blocks instead. Pairs are built outside-in, so pair 0 is the outermost
// pair of the band and the block it selects is the coarsest thing on screen.
//
// place and unplace are inverses in both cases. That matters beyond neatness:
// the renderer uses one and hit-testing uses the other, and a grid you cannot
// click accurately is worse than no grid.

export type Layout = {
  cols: number;
  rows: number;
  /** Side of one block when the leading digit is wrapped out, else 0. */
  inner: number;
  /** Cell spans worth drawing a seam at, coarsest first. */
  seams: number[];
  place: (index: number) => { x: number; y: number };
  /** Inverse of place. null for a gutter, or a slot no combo occupies. */
  unplace: (x: number, y: number) => number | null;
};

/** Gutter between wrapped blocks, in cells. */
const GAP = 1;

/** Digits of `index`, pair 0 first -- the order the engine pairs strands in. */
export function digitsOf(index: number, count: number, E: number) {
  const out: number[] = [];
  let rest = index;
  for (let i = 0; i < count; i += 1) { out.push(rest % E); rest = Math.floor(rest / E); }
  return out.reverse();
}

/** De-interleave the low `count` digits of `index` into a square-ish (x, y). */
export function spread(index: number, count: number, E: number) {
  const d = digitsOf(index, count, E);
  let x = 0, y = 0;
  for (let p = 0; p < count; p += 1) {
    const q = count - 1 - p;
    const scale = E ** (q >> 1);
    if ((q & 1) === 0) x += d[p] * scale;
    else y += d[p] * scale;
  }
  return { x, y };
}

/** Inverse of spread. */
export function gather(x: number, y: number, count: number, E: number) {
  let index = 0;
  for (let p = 0; p < count; p += 1) {
    const q = count - 1 - p;
    const scale = E ** (q >> 1);
    const along = (q & 1) === 0 ? x : y;
    index = index * E + (Math.floor(along / scale) % E);
  }
  return index;
}

export function layoutFor(P: number, E: number): Layout {
  const wrap = P >= 3 && P % 2 === 1;

  if (!wrap) {
    const cols = E ** Math.ceil(P / 2);
    const rows = E ** Math.floor(P / 2);
    const seams = P >= 3 ? [E * E, E].filter(s => s < Math.max(cols, rows)) : [];
    return {
      cols, rows, inner: 0, seams,
      place: index => spread(index, P, E),
      unplace: (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows)
        ? null : gather(x, y, P, E),
    };
  }

  const inner = E ** ((P - 1) / 2);
  const bw = Math.ceil(Math.sqrt(E));
  const bh = Math.ceil(E / bw);
  const pitch = inner + GAP;
  const cols = bw * inner + (bw - 1) * GAP;
  const rows = bh * inner + (bh - 1) * GAP;
  const rest = P - 1;
  const block = E ** rest;
  return {
    cols, rows, inner, seams: [],
    place: index => {
      const lead = Math.floor(index / block);
      const within = spread(index % block, rest, E);
      return {
        x: (lead % bw) * pitch + within.x,
        y: Math.floor(lead / bw) * pitch + within.y,
      };
    },
    unplace: (x, y) => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
      const bx = Math.floor(x / pitch), ox = x - bx * pitch;
      const by = Math.floor(y / pitch), oy = y - by * pitch;
      if (ox >= inner || oy >= inner) return null;      // a gutter between blocks
      const lead = by * bw + bx;
      if (lead >= E) return null;                        // an unfilled block slot
      return lead * block + gather(ox, oy, rest, E);
    },
  };
}
