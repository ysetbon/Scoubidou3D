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
import { polylineCrossings } from '../geometry/weave';

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

/** One place this lace passes another, as the weave finds it. */
export interface CrossFact {
  u: number;
  /** The member of this lace, and the layer of the other one. */
  ownId: string;
  withId: string;
  /** True when this lace passes ABOVE the other here. */
  over: boolean;
  /** The gap between the two, in thicknesses. */
  gapT: number;
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

/** Do two laces share any of the drawing plane at all? Laces that do not cannot
 *  cross, and on a mat most pairs do not — one box test each saves the whole
 *  segment-against-segment search for them. */
function overlaps(a: Vec3[], b: Vec3[]): boolean {
  const box = (line: Vec3[]) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const q of line) {
      if (q.x < x0) x0 = q.x;
      if (q.x > x1) x1 = q.x;
      if (q.y < y0) y0 = q.y;
      if (q.y > y1) y1 = q.y;
    }
    return { x0, x1, y0, y1 };
  };
  const A = box(a);
  const B = box(b);
  return A.x0 <= B.x1 && B.x0 <= A.x1 && A.y0 <= B.y1 && B.y0 <= A.y1;
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
export function laceFacts(laces: LaceInput[], ids: string[]): LaceFact[] {
  const arcs = laces.map((L) => planArc(L.line));

  // Where the laces meet each other. The finder is the weave's own, so the ticks
  // land where the weave puts a crossing rather than where a second search would
  // — and over/under is READ BACK off the two heights there, which is exactly
  // what the elevation is drawing.
  //
  // Each PAIR is walked once and reported to both laces. Walking it twice, once
  // per direction, doubled the cost of the one measurement in here that is not
  // linear: a twist stitch is three laces of ~2,300 points, and every pair is a
  // segment-against-segment search.
  const found: CrossFact[][] = laces.map(() => []);
  for (let ai = 0; ai < laces.length; ai++) {
    for (let bi = ai + 1; bi < laces.length; bi++) {
      const A = laces[ai];
      const B = laces[bi];
      if (!overlaps(A.line, B.line)) continue;
      for (const hit of polylineCrossings(A.line, B.line)) {
        const pa = A.line[indexAt(arcs[ai].cum, hit.sA)];
        const pb = B.line[indexAt(arcs[bi].cum, hit.sB)];
        const za = zAt(A.line, arcs[ai].cum, hit.sA);
        const zb = zAt(B.line, arcs[bi].cum, hit.sB);
        const aId = ids[pa.owner ?? A.chain[0] ?? -1] ?? '?';
        const bId = ids[pb.owner ?? B.chain[0] ?? -1] ?? '?';
        const gapT = Math.abs(za - zb) / (A.thickness || 1);
        found[ai].push({
          u: arcs[ai].total > 0 ? hit.sA / arcs[ai].total : 0,
          ownId: aId,
          withId: bId,
          over: za > zb,
          gapT,
        });
        found[bi].push({
          u: arcs[bi].total > 0 ? hit.sB / arcs[bi].total : 0,
          ownId: bId,
          withId: aId,
          over: zb > za,
          gapT,
        });
      }
    }
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
