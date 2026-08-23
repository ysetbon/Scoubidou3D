// What a lace is MADE OF, for the studio's Planes view.
//
// The panel needs to point at a part of a lace and say where it rests. Every
// part it can point at is already decided by the geometry, and this reads that
// back rather than working it out again:
//
//   * a member's stretch comes from `Vec3.owner`, the tag `buildLaceMeshes` and
//     `zFolds` write on every point (split at each turn's apex);
//   * a C comes from the `TurnRecord` zFolds returns, which addresses the final
//     centreline directly;
//   * a crossing comes from `polylineCrossings`, the same finder the weave uses,
//     so the ticks in the picture sit where the weave says they are;
//   * every height is measured off the built line.
//
// Nothing here is derived by nearest-point distance. That was tried once and it
// put a member's share in the wrong place at exactly the spots — the turns —
// where the answer matters, which is what the ownership tags exist to prevent.
import { Vec3 } from '../geometry/vec';
import { TurnRecord } from '../geometry/polyline';

/** One member of a lace, and the stretch of it a plane would govern. */
export interface MemberFact {
  id: string;
  /** Index into `scene.strands`. */
  index: number;
  /** Its owned stretch, as fractions of the lace's length. */
  u0: number;
  u1: number;
  /**
   * The FREE run — the owned stretch outside every C.
   *
   * Null when the C's have eaten it: a core between two folds can own a lot of
   * points and still have no straight run at all (measured at 1.1% of the lace
   * on `two-crossing-arms`, which is 0.2 units against a width of 1.08). A plane
   * still applies to such a member — it is what its half of each C climbs from —
   * so this says how much of it you can SEE, not whether it is settable.
   */
  run: { u0: number; u1: number } | null;
  /** Where it rests now, in thicknesses. Measured, not declared. */
  restT: number;
}

/** One C, and the step it actually carries. */
export interface FoldFact {
  inId: string;
  outId: string;
  /** The whole turn, and its apex, as fractions of the lace's length. */
  u0: number;
  u1: number;
  uApex: number;
  /**
   * The height the C climbs end to end, in thicknesses. This is the readout that
   * says whether two declared planes reached the C: a fold between members a
   * storey apart carries that storey here, and one between members on the same
   * plane carries only the weave's own swing.
   */
  stepT: number;
}

/** One place this lace passes another — one PASSAGE, not a pair. */
export interface CrossFact {
  /**
   * The crossing's own key, from the weave. This is what makes a passage
   * addressable: `1_2 under 2_2` is one of the three crossings that arm makes,
   * and until there was a key for it there was no way to point at it.
   */
  key: string;
  u: number;
  /** The member of this lace, and the layer of the other one. */
  ownId: string;
  ownIndex: number;
  withId: string;
  /** True when this lace passes ABOVE the other here — the weave's own verdict. */
  over: boolean;
  /** The gap between the two, in thicknesses. */
  gapT: number;
  /** False when nothing is woven here: two storeys passing, no mask between. */
  woven: boolean;
}

/**
 * One crossing as `StrandScene` recorded it. `CrossPoint` there satisfies this;
 * the shape is restated rather than imported so the geometry does not have to
 * depend on the renderer.
 */
export interface CrossInput {
  key: string;
  aIndex: number;
  bIndex: number;
  x: number;
  y: number;
  overIndex: number;
  underIndex: number;
  woven: boolean;
}

export interface LaceFact {
  /** Stable across rebuilds: the members in chain order. */
  key: string;
  members: MemberFact[];
  folds: FoldFact[];
  crossings: CrossFact[];
  /** Height in thicknesses at `PROFILE` even steps along the lace. */
  profile: number[];
  thickness: number;
}

/** One built lace, as `StrandScene.laceCenterlines` holds it. */
export interface LaceInput {
  chain: number[];
  line: Vec3[];
  thickness: number;
  turns: TurnRecord[];
}

/** How many samples the elevation is drawn from. Enough for a 300px sparkline
 *  to show the C's shape; the line itself has two to eight times as many. */
export const PROFILE = 180;

/** Plan arc length at every point, and the total. The weave measures in the
 *  drawing plane, and a crossing's position comes back in those units. */
function planArc(line: Vec3[]): { cum: number[]; total: number } {
  const cum = new Array<number>(line.length);
  cum[0] = 0;
  for (let i = 1; i < line.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
  }
  return { cum, total: cum[line.length - 1] ?? 0 };
}

/** The index whose arc position is at or just below `s`. */
function indexAt(cum: number[], s: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Height at an arc position, interpolated along the segment it falls in. */
function zAt(line: Vec3[], cum: number[], s: number): number {
  const i = indexAt(cum, s);
  if (i >= line.length - 1) return line[line.length - 1].z;
  const span = cum[i + 1] - cum[i];
  const t = span > 1e-12 ? (s - cum[i]) / span : 0;
  return line[i].z + t * (line[i + 1].z - line[i].z);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/**
 * The sections of every lace in the scene.
 *
 * `laces` is every built centreline — a merged lace or a strand standing on its
 * own — and `ids` names the layers by index.
 */
/** Are these two members glued to each other inside this lace? */
function adjacentInChain(chain: number[], a: number, b: number): boolean {
  const ia = chain.indexOf(a);
  const ib = chain.indexOf(b);
  return ia >= 0 && ib >= 0 && Math.abs(ia - ib) === 1;
}

export function laceFacts(
  laces: LaceInput[],
  ids: string[],
  points: CrossInput[],
): LaceFact[] {
  const arcs = laces.map((L) => planArc(L.line));

  // WHERE THE CROSSINGS COME FROM, and why not from here.
  //
  // This used to run the weave's finder again over the merged laces. It agreed
  // with the weave — it was the same function — but agreeing is not the same as
  // being the same thing, and it could not be: a crossing found here had no
  // identity the weave would recognise, so a tick in the picture could be looked
  // at and never pointed at. Placing one needs a name for it.
  //
  // So the weave names them (`CrossPoint.key`) and this only has to say WHERE on
  // each lace to draw the tick. The owner is already known — the crossing says
  // which strand — so the search is over that member's own stretch of the lace
  // and nothing else. That is a drawing position, not a decision about ownership,
  // which is the thing the tags exist to settle.
  const memberSpan = new Map<number, { li: number; from: number; to: number }>();
  laces.forEach((L, li) => {
    let from = 0;
    for (let k = 1; k <= L.line.length; k++) {
      const owner = L.line[k - 1].owner;
      if (k < L.line.length && L.line[k].owner === owner) continue;
      const index = owner ?? L.chain[0] ?? 0;
      if (!memberSpan.has(index)) memberSpan.set(index, { li, from, to: k - 1 });
      from = k;
    }
  });

  /** The point of `index`'s own stretch closest to (x, y), and its height. */
  const place = (index: number, x: number, y: number) => {
    const span = memberSpan.get(index);
    if (!span) return null;
    const L = laces[span.li];
    let best = span.from;
    let bestD = Infinity;
    for (let k = span.from; k <= span.to; k++) {
      const d = (L.line[k].x - x) ** 2 + (L.line[k].y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return { li: span.li, k: best, z: L.line[best].z };
  };

  const found: CrossFact[][] = laces.map(() => []);
  for (const point of points) {
    const a = place(point.aIndex, point.x, point.y);
    const b = place(point.bIndex, point.x, point.y);
    if (!a || !b) continue;
    // Two members of ONE lace glued end to end are not crossing, they are joined:
    // the "crossing" is the joint itself. Chain adjacency says so exactly, so no
    // guess is involved and a lace that genuinely crosses itself still reports it.
    if (a.li === b.li && adjacentInChain(laces[a.li].chain, point.aIndex, point.bIndex)) continue;
    const t = laces[a.li].thickness || 1;
    const gapT = Math.abs(a.z - b.z) / t;
    const push = (side: typeof a, index: number, otherIndex: number) => {
      const { cum, total } = arcs[side.li];
      found[side.li].push({
        key: point.key,
        u: total > 0 ? cum[side.k] / total : 0,
        ownId: ids[index] ?? String(index),
        ownIndex: index,
        withId: ids[otherIndex] ?? String(otherIndex),
        over: point.overIndex === index,
        gapT,
        woven: point.woven,
      });
    };
    push(a, point.aIndex, point.bIndex);
    push(b, point.bIndex, point.aIndex);
  }

  return laces.map((L, li) => {
    const { cum, total } = arcs[li];
    const t = L.thickness || 1;
    const u = (s: number): number => (total > 0 ? s / total : 0);
    const uAt = (k: number): number => u(cum[k]);

    // Which points a C covers, so a member's FREE run is what is left over.
    const inTurn = new Uint8Array(L.line.length);
    for (const turn of L.turns) {
      for (let k = turn.from; k <= turn.to && k < inTurn.length; k++) inTurn[k] = 1;
    }

    // Owned stretches, straight off the tags. Consecutive points with the same
    // owner are one member's share; a lace visits each member exactly once.
    const members: MemberFact[] = [];
    let from = 0;
    for (let k = 1; k <= L.line.length; k++) {
      const owner = L.line[k - 1].owner;
      if (k < L.line.length && L.line[k].owner === owner) continue;
      const index = owner ?? L.chain[0] ?? 0;
      // The longest stretch of this member outside every C — what you can see of
      // its run, and what the median height below is read from.
      let best: { a: number; b: number } | null = null;
      let open = -1;
      for (let j = from; j <= k; j++) {
        const free = j < k && !inTurn[j];
        if (free) {
          if (open < 0) open = j;
        } else if (open >= 0) {
          if (!best || j - 1 - open > best.b - best.a) best = { a: open, b: j - 1 };
          open = -1;
        }
      }
      const zs: number[] = [];
      for (let j = best ? best.a : from; j <= (best ? best.b : k - 1); j++) zs.push(L.line[j].z);
      members.push({
        id: ids[index] ?? String(index),
        index,
        u0: uAt(from),
        u1: uAt(k - 1),
        run: best ? { u0: uAt(best.a), u1: uAt(best.b) } : null,
        restT: median(zs) / t,
      });
      from = k;
    }

    const folds: FoldFact[] = L.turns.map((turn) => ({
      inId: ids[turn.inOwner ?? -1] ?? '?',
      outId: ids[turn.outOwner ?? -1] ?? '?',
      u0: uAt(turn.from),
      u1: uAt(turn.to),
      uApex: uAt(turn.apex),
      stepT: (L.line[turn.to].z - L.line[turn.from].z) / t,
    }));

    const crossings = found[li];
    crossings.sort((a, b) => a.u - b.u);

    const profile: number[] = [];
    for (let s = 0; s < PROFILE; s++) {
      profile.push(zAt(L.line, cum, (s / (PROFILE - 1)) * total) / t);
    }

    return {
      key: L.chain.map((i) => ids[i] ?? i).join('→'),
      members,
      folds,
      crossings,
      profile,
      thickness: t,
    };
  });
}
