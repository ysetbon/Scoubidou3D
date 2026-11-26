// STRETCH — pull a knot tight.
//
// A knot drawn by hand is slack: the middles wander, the folds stand off from
// what they wrap, the arms lean on each other. Pulling its loose ends is what
// takes that out, and this is that pull, done on the drawing.
//
// THE MODEL. Every lace is a string under one unit of tension, so the thing to
// make small is its length — each strand between two joints wants to be the
// straight line between them, and each joint wants to slide toward its
// neighbours. A loose end is pulled along the line its arm was drawn on, from
// infinitely far away: the arm keeps its DIRECTION and only slides sideways,
// which is what holding an end and pulling does. Three things push back, and
// they are the whole of what "tight" means:
//
//   * SIDE BY SIDE. Two strands that do not cross keep a lace width plus `air`
//     between their centre lines. That is the family's own gap floor, `w + 10`
//     (twofan.ts `GAP`).
//   * A FOLD STOPS SHORT. A joint whose strand crosses another stays half that
//     air past the other's edge — half a gap from its centre line, which is
//     where the built block puts the folds of its slants — and a LOOSE END
//     runs on to `poke` past it, the 32 px an arm runs past the band it
//     crosses in every built stitch (twofan.ts `POKE`).
//   * THREE LACES LOCKED ROUND EACH OTHER — a over b over c over a — cannot all
//     cover one point, so the triangle they make cannot shrink to nothing.
//
// And one thing is held fixed outright: WHICH strands cross which. The solve
// starts from the drawing and never lets a crossing appear, nor an interlock
// vanish, so the over/unders the scene declares mean after it exactly what they
// meant before. What a pair may do is shed crossings TWO AT A TIME: an over/under
// is declared per pair, so a strand that passes over another and comes back over
// it is not held by it, and pulling takes the loop out — three crossings to one,
// two to none. That is slack leaving, not the weave changing; a loop with
// something caught in it stays, because the thing caught keeps its clearances.
//
// THE DESCENT. The unknowns are the joints and, for a strand that is bent, its
// control points — measured along and across its own chord, so a joint that
// moves carries its strand's handles with it. Length plus a quadratic penalty
// on every violated clearance is minimised by L-BFGS, the gradient taken by
// differences through the app's real curve (`buildProfile`), so what is
// optimised is exactly what is drawn. The penalty is then stiffened by tens —
// 1, 10, … 10^5 — each solve started from the last, and the last two are
// extrapolated to an infinitely stiff one, which lands the clearances on their
// numbers to about a millionth of a pixel.
//
// THE HANDLES. A taut lace is straight wherever nothing bends it, so straight is
// not something the descent is left to find — it comes first. Every bent strand
// has its handles walked onto its chord in small steps, the weave checked at
// each, and a strand that gets there is handed back as an untouched one: both
// control points on the start, the state a fresh strand is born in. Only a
// strand that cannot be straightened without its crossings changing keeps its
// handles, and then they are unknowns like the joints, with bending made dearer
// than length so the bend is the least one that clears. A strand that was
// straightened and then cannot clear what it must gets its bend back the same
// way; one that was drawn straight is never bent.
// Handles that remain are parked a third and two thirds along the strand, which
// is where a hand would put them.
//
// (It has to be this way round. Left to the descent, a bend is a way to cheat:
// an arm pulled along a fixed line can still shorten the knot's middle by
// kinking sideways just outside it, and the "tightest" stitch comes out sheared
// with S-shaped arms. That is what a string does, and not what a lace does.)
//
// THE SLACK. A lace does not get shorter when you pull it; the length taken out
// of the knot comes out through the loose ends. So each lace keeps its drawn
// length, and its arms grow by what its middle gave up.
//
// SCOPE. One level at a time: strands on other storeys are not woven with this
// one (levels.ts) and do not move. A joint shared with another storey is a pin.

import { CurveBias, sampleCenterline } from '../geometry/bezier';
import { polylineCrossings } from '../geometry/weave';
import { Vec2 } from '../geometry/vec';
import { endpointJoints, recomputeOccupancy } from './connections';
import { CP_EPS, resetControlPoints, updateControlCenter } from './controlPoints';
import { levelAt } from './levels';
import { GAP, POKE, W } from './twofan';
import { Scene3D, Strand3D } from './types';

/** Air between two laces lying side by side: the families' `GAP - W`. */
export const STRETCH_AIR = GAP - W;
/** How far a loose end runs past the edge of what its arm crosses: `POKE - W/2`. */
export const STRETCH_POKE = POKE - W / 2;

export interface StretchOptions {
  /** Air between side-by-side laces, on top of their half widths. */
  air?: number;
  /** How far a loose end runs past the edge of the last strand its arm crosses.
   *  (A fold between two strands stops half the `air` past it.) */
  poke?: number;
  /**
   * Tidy the pull directions before pulling: the two ends of one lace are made
   * exactly opposite when they nearly are, and arms that are nearly parallel or
   * nearly square to each other are made exactly so. On by default — a hand
   * draws "straight across" to within a few degrees, and a stitch pulled along
   * those few degrees comes out a rhombus.
   */
  square?: boolean;
  /** The view's Middle handle setting: whether a locked centre shapes the curve. */
  thirdEnabled?: boolean;
  /** The view's width multiplier, so clearances match the ribbons on screen. */
  widthScale?: number;
  /** How many in-between states to hand back, for playing the pull as a motion. */
  frames?: number;
  /** Milliseconds the descent may take before it settles for where it has got
   *  to. The answer is still a valid scene — the weave is checked at every step
   *  — only less tight than it could be. Default 2500. */
  budget?: number;
}

export interface StretchReport {
  /** Strands on the level. */
  strands: number;
  /** Of those, how many had anything free to move. */
  movable: number;
  /** Crossings between them, after. */
  crossings: number;
  /** Did anything move by more than a hundredth of a pixel? */
  changed: boolean;
  /** Lace pulled out of the knot and into the arms, px. Negative when the knot
   *  had to open up to clear itself. */
  slack: number;
  /** Bent strands that came out straight. */
  straightened: number;
  /** Strands that carry a bend afterwards. */
  bent: number;
  /** The worst clearance violation before and after, px. */
  overlapBefore: number;
  overlapAfter: number;
  iterations: number;
  /** The descent ran out of its time budget before it had settled. */
  cutShort: boolean;
}

export interface StretchResult {
  scene: Scene3D;
  report: StretchReport;
  /** In-between scenes, first to last, when `frames` asked for them. */
  frames: Scene3D[];
}

// ---- small vector helpers ---------------------------------------------------

const STEPS = 24; // per cubic, the same density the scene draws and weaves with
const TAU = Math.PI * 2;

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polyLength(p: Vec2[]): number {
  let n = 0;
  for (let i = 1; i < p.length; i++) n += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  return n;
}

/** Distance from a point to a polyline. */
function pointPoly(px: number, py: number, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const ax = poly[i - 1].x;
    const ay = poly[i - 1].y;
    const dx = poly[i].x - ax;
    const dy = poly[i].y - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = px - (ax + t * dx);
    const ey = py - (ay + t * dy);
    const d2 = ex * ex + ey * ey;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxOf(p: Vec2[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of p) {
    if (q.x < x0) x0 = q.x;
    if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y;
    if (q.y > y1) y1 = q.y;
  }
  return { x0, y0, x1, y1 };
}

function boxesWithin(a: Box, b: Box, pad: number): boolean {
  return a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1;
}

/** `a - b` wrapped into (-π, π]. */
function wrap(a: number): number {
  let v = a % TAU;
  if (v > Math.PI) v -= TAU;
  if (v <= -Math.PI) v += TAU;
  return v;
}

// ---- the problem --------------------------------------------------------------

interface SNode {
  kind: 'joint' | 'pinned' | 'free';
  p: Vec2;
  /** Offset of this joint's (x, y) in the unknowns, or -1. */
  v: number;
  strands: number[];
}

interface SStrand {
  /** Index into `scene.strands`. */
  i: number;
  src: Strand3D;
  n0: number;
  n1: number;
  half: number;
  /** Straight: no handles in play. */
  line: boolean;
  wasLine: boolean;
  /** Chord length the handle unknowns are scaled by. */
  L0: number;
  /** Offset of [a1, b1, a2, b2, ac, bc] in the unknowns — always reserved. */
  v: number;
  cp2Free: boolean;
  centre: boolean;
  attached: boolean;
  bias: CurveBias | null;
  /** Which end is loose: -1 neither, 0 the start, 1 the end, 2 both. */
  free: -1 | 0 | 1 | 2;
  /** An arm's drawn chord length. */
  len: number;
  /** Offset of an arm's chord length in the unknowns, or -1. */
  lv: number;
  /** Direction the loose end lies in from the held one (start → end for both). */
  ang: number;
  /** Dead-load weight on the arm's pull. */
  pull: number;
  /** Offset of a both-ends-loose strand's centre in the unknowns, or -1. */
  cv: number;
  movable: boolean;
}

type Term =
  | { t: 'len'; s: number }
  /** Every vertex of `a` keeps `d` from the polyline of `b`. */
  | { t: 'clear'; a: number; b: number; d: number }
  /** One end of `a` keeps `d` from the polyline of `b`. */
  | { t: 'poke'; a: number; side: 0 | 1; b: number; d: number }
  /** A locked triangle keeps its three ribbons from covering one point. */
  | { t: 'tri'; a: number; b: number; c: number; sign: number; d: number };

const REG = 1e-3; // how hard a bent strand's handles are drawn to thirds
const STIFF = 8; // how much dearer a pixel of bend is than a pixel of length
const UNBEND = 2; // px a handle travels per unbending step
const HOLD = 0.05; // how hard an arm is held to the length it was drawn
const MAX_MOVE = 8; // px any unknown may travel in one step
const FD = 1e-5; // differencing step, px
const STRAIGHT = 0.25; // px off its chord below which a strand is straight

class Problem {
  nodes: SNode[] = [];
  strands: SStrand[] = [];
  terms: Term[] = [];
  x: Float64Array = new Float64Array(0);
  /** Unknowns that are live (a reserved handle slot of a straight strand is not). */
  live: Uint8Array = new Uint8Array(0);
  varStrands: number[][] = [];
  varTerms: number[][] = [];
  /** Non-adjacent pairs with something movable in them, and their crossing counts. */
  pairs: Array<[number, number]> = [];
  ref: number[] = [];
  polys: Vec2[][] = [];
  iterations = 0;
  /** `performance.now()` past which the descent stops where it is. */
  deadline = Infinity;
  /** A pair has come fully uncrossed since `constrain` last ran. */
  private parted = false;
  private air: number;
  private poke: number;

  constructor(
    private scene: Scene3D,
    active: number[],
    private opts: Required<Pick<StretchOptions, 'air' | 'poke' | 'square' | 'thirdEnabled' | 'widthScale'>>,
  ) {
    this.air = opts.air;
    this.poke = opts.poke;
    this.build(active);
  }

  // ---- setup ------------------------------------------------------------------

  private build(active: number[]): void {
    const S = this.scene.strands;
    const joint = endpointJoints(this.scene);
    const isActive = new Set(active);

    // Nodes: one per joint an active strand's end belongs to.
    const nodeOf = new Map<number, number>();
    const outside = new Set<number>(); // joints something off the level is on
    const count = new Map<number, number>();
    S.forEach((s, i) => {
      if (s.isMask) return;
      for (const side of [0, 1]) {
        const j = joint[i * 2 + side];
        if (!isActive.has(i)) outside.add(j);
        else count.set(j, (count.get(j) ?? 0) + 1);
      }
    });
    const nodeFor = (i: number, side: 0 | 1): number => {
      const j = joint[i * 2 + side];
      let n = nodeOf.get(j);
      if (n === undefined) {
        const p = side === 0 ? S[i].start : S[i].end;
        const kind = outside.has(j) ? 'pinned' : (count.get(j) ?? 0) > 1 ? 'joint' : 'free';
        n = this.nodes.length;
        this.nodes.push({ kind, p: { x: p.x, y: p.y }, v: -1, strands: [] });
        nodeOf.set(j, n);
      }
      return n;
    };

    let nvar = 0;
    for (const i of active) {
      const src = S[i];
      const n0 = nodeFor(i, 0);
      const n1 = nodeFor(i, 1);
      const k = this.strands.length;
      this.nodes[n0].strands.push(k);
      if (n1 !== n0) this.nodes[n1].strands.push(k);
      const f0 = this.nodes[n0].kind === 'free';
      const f1 = this.nodes[n1].kind === 'free';
      const chord = dist(src.start, src.end);
      const shape = sampleCenterline(this.input(src, src.start, src.end), STEPS);
      const line = shape.length <= 2;
      this.strands.push({
        i,
        src,
        n0,
        n1,
        half: (src.width * this.opts.widthScale) / 2,
        line,
        wasLine: line,
        L0: chord,
        v: -1,
        cp2Free: src.cp2Activated,
        centre: this.opts.thirdEnabled && src.control_point_center_locked && !!src.control_point_center,
        attached: src.parentId !== null,
        bias: src.bias ?? null,
        free: f0 && f1 ? 2 : f0 ? 0 : f1 ? 1 : -1,
        len: chord,
        ang: f0 && !f1 ? Math.atan2(src.start.y - src.end.y, src.start.x - src.end.x) : Math.atan2(src.end.y - src.start.y, src.end.x - src.start.x),
        pull: 1,
        lv: -1,
        cv: -1,
        movable: false,
      });
    }

    // Unknowns: joints, then six handle slots a strand, then for an arm its
    // length and for a strand loose at both ends its centre.
    for (const n of this.nodes) {
      if (n.kind === 'joint') {
        n.v = nvar;
        nvar += 2;
      }
    }
    for (const s of this.strands) {
      s.v = nvar;
      nvar += 6;
      if (s.free >= 0) s.lv = nvar++;
      if (s.free === 2) {
        s.cv = nvar;
        nvar += 2;
      }
    }
    this.x = new Float64Array(nvar);
    this.live = new Uint8Array(nvar);
    this.varStrands = Array.from({ length: nvar }, () => []);
    for (const n of this.nodes) {
      if (n.v < 0) continue;
      this.x[n.v] = n.p.x;
      this.x[n.v + 1] = n.p.y;
      this.live[n.v] = this.live[n.v + 1] = 1;
      this.varStrands[n.v] = this.varStrands[n.v + 1] = n.strands;
    }
    this.strands.forEach((s, k) => {
      for (let q = 0; q < 6; q++) this.varStrands[s.v + q] = [k];
      if (s.lv >= 0) {
        // An arm's length costs nothing either way — the lace it would take is
        // the slack — so only a clearance ever moves it: an end that stops
        // short of what its arm crosses is let out until it pokes past.
        this.x[s.lv] = s.len;
        this.live[s.lv] = 1;
        this.varStrands[s.lv] = [k];
      }
      if (s.cv >= 0) {
        this.x[s.cv] = (s.src.start.x + s.src.end.x) / 2;
        this.x[s.cv + 1] = (s.src.start.y + s.src.end.y) / 2;
        this.live[s.cv] = this.live[s.cv + 1] = 1;
        this.varStrands[s.cv] = this.varStrands[s.cv + 1] = [k];
      }
      if (!s.line) this.measureHandles(s);
      s.movable = this.nodes[s.n0].kind === 'joint' || this.nodes[s.n1].kind === 'joint' || s.free >= 0 || !s.line;
    });

    this.polys = this.strands.map((_, k) => this.poly(k, this.x));
    this.aim();
    this.polys = this.strands.map((_, k) => this.poly(k, this.x));
    this.constrain();
  }

  /** Read a bent strand's handles into chord coordinates and switch them on. */
  private measureHandles(s: SStrand): void {
    const a = s.src.start;
    const b = s.src.end;
    const cx = b.x - a.x;
    const cy = b.y - a.y;
    const L2 = cx * cx + cy * cy;
    if (L2 < 1e-12) {
      s.line = true;
      return;
    }
    const put = (slot: number, p: Vec2): void => {
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      this.x[s.v + slot] = ((dx * cx + dy * cy) / L2) * s.L0;
      this.x[s.v + slot + 1] = ((-dx * cy + dy * cx) / L2) * s.L0;
      this.live[s.v + slot] = this.live[s.v + slot + 1] = 1;
    };
    put(0, s.src.control_points[0]);
    if (s.cp2Free) put(2, s.src.control_points[1]);
    if (s.centre && s.src.control_point_center) put(4, s.src.control_point_center);
  }

  private input(src: Strand3D, start: Vec2, end: Vec2) {
    return {
      start,
      end,
      control_points: src.control_points,
      control_point_center: this.opts.thirdEnabled ? src.control_point_center : null,
      control_point_center_locked: src.control_point_center_locked,
      attached: src.parentId !== null,
      bias: src.bias ?? null,
    };
  }

  // ---- geometry from the unknowns -----------------------------------------------

  private nodePos(n: number, x: Float64Array): Vec2 {
    const node = this.nodes[n];
    return node.v >= 0 ? { x: x[node.v], y: x[node.v + 1] } : node.p;
  }

  ends(k: number, x: Float64Array): [Vec2, Vec2] {
    const s = this.strands[k];
    if (s.free < 0) return [this.nodePos(s.n0, x), this.nodePos(s.n1, x)];
    const len = Math.max(x[s.lv], 1);
    const ux = Math.cos(s.ang) * len;
    const uy = Math.sin(s.ang) * len;
    if (s.free === 2) {
      return [
        { x: x[s.cv] - ux / 2, y: x[s.cv + 1] - uy / 2 },
        { x: x[s.cv] + ux / 2, y: x[s.cv + 1] + uy / 2 },
      ];
    }
    if (s.free === 1) {
      const a = this.nodePos(s.n0, x);
      return [a, { x: a.x + ux, y: a.y + uy }];
    }
    const b = this.nodePos(s.n1, x);
    return [{ x: b.x + ux, y: b.y + uy }, b];
  }

  /** A bent strand's handles in the plane: [triangle, circle, centre | null]. */
  handles(k: number, x: Float64Array, a: Vec2, b: Vec2): [Vec2, Vec2, Vec2 | null] {
    const s = this.strands[k];
    const cx = (b.x - a.x) / s.L0;
    const cy = (b.y - a.y) / s.L0;
    const at = (slot: number): Vec2 => ({
      x: a.x + x[s.v + slot] * cx - x[s.v + slot + 1] * cy,
      y: a.y + x[s.v + slot] * cy + x[s.v + slot + 1] * cx,
    });
    return [at(0), s.cp2Free ? at(2) : { x: b.x, y: b.y }, s.centre ? at(4) : null];
  }

  poly(k: number, x: Float64Array): Vec2[] {
    const s = this.strands[k];
    const [a, b] = this.ends(k, x);
    if (s.line || s.L0 < 1e-9) return [a, b];
    const [c1, c2, centre] = this.handles(k, x, a, b);
    const pts = sampleCenterline(
      {
        start: a,
        end: b,
        control_points: [c1, c2],
        control_point_center: centre,
        control_point_center_locked: centre !== null,
        attached: s.attached,
        bias: s.bias,
      },
      STEPS,
    );
    return pts.length >= 2 ? pts : [a, b];
  }

  // ---- where the arms are pulled ------------------------------------------------

  /**
   * Settle each arm's pull direction, then turn the arms onto them.
   *
   * The turn is done in half-degree steps with the crossings checked at each,
   * so tidying the directions can never be what changes the weave: an arm that
   * would have to sweep through something to get there stops where it is.
   */
  private aim(): void {
    const arms = this.strands.map((s, k) => (s.free >= 0 ? k : -1)).filter((k) => k >= 0);
    if (!arms.length) return;
    const target = new Map<number, number>(arms.map((k) => [k, this.strands[k].ang]));

    // Laces: strands joined through nodes.
    const comp = this.components();

    if (this.opts.square) {
      // 1. The two ends of one lace, made exactly opposite when they nearly are.
      const byComp = new Map<number, number[]>();
      for (const k of arms) {
        if (this.strands[k].free === 2) continue;
        const c = comp[k];
        byComp.set(c, [...(byComp.get(c) ?? []), k]);
      }
      for (const pair of byComp.values()) {
        if (pair.length !== 2) continue;
        const a = target.get(pair[0]) as number;
        const b = target.get(pair[1]) as number;
        const off = wrap(a - (b + Math.PI));
        if (Math.abs(off) > (20 * Math.PI) / 180) continue;
        target.set(pair[0], a - off / 2);
        target.set(pair[1], b + off / 2);
      }
      // 2. Arms nearly parallel or square to one another, made exactly so: the
      //    shared axis is the mean taken four times round, and whatever lies
      //    within eight degrees of it is put on it.
      const TOL = (8 * Math.PI) / 180;
      const quarter = (v: number): number => {
        const q = Math.PI / 2;
        let d = v % q;
        if (d > q / 2) d -= q;
        if (d < -q / 2) d += q;
        return d;
      };
      let pool = arms;
      let axis = 0;
      for (let round = 0; round < 4 && pool.length >= 2; round++) {
        let sx = 0;
        let sy = 0;
        for (const k of pool) {
          sx += Math.cos(4 * (target.get(k) as number));
          sy += Math.sin(4 * (target.get(k) as number));
        }
        axis = Math.atan2(sy, sx) / 4;
        pool = arms.filter((k) => Math.abs(quarter((target.get(k) as number) - axis)) <= TOL);
      }
      if (pool.length >= 2) {
        for (const k of pool) {
          const t = target.get(k) as number;
          target.set(k, t - quarter(t - axis));
        }
      }
    }

    // Turn the arms there, never through a crossing.
    this.pairsAndCounts();
    const turn = new Map<number, number>(arms.map((k) => [k, wrap((target.get(k) as number) - this.strands[k].ang)]));
    const most = Math.max(...arms.map((k) => Math.abs(turn.get(k) as number)));
    const steps = Math.ceil(most / ((0.5 * Math.PI) / 180));
    const from = new Map<number, number>(arms.map((k) => [k, this.strands[k].ang]));
    for (let step = 1; step <= steps; step++) {
      const before = arms.map((k) => this.strands[k].ang);
      for (const k of arms) this.strands[k].ang = (from.get(k) as number) + ((turn.get(k) as number) * step) / steps;
      const polys = this.strands.map((_, k) => this.poly(k, this.x));
      if (!this.sameWeave(polys, false)) {
        arms.forEach((k, n) => (this.strands[k].ang = before[n]));
        break;
      }
    }

    // A lace nothing holds would be dragged off by any pull that does not
    // cancel, so its pulls are scaled until they do (and dropped if they cannot).
    const held = new Set<number>();
    this.strands.forEach((s, k) => {
      if (this.nodes[s.n0].kind === 'pinned' || this.nodes[s.n1].kind === 'pinned') held.add(comp[k]);
    });
    const loose = new Map<number, number[]>();
    for (const k of arms) {
      const s = this.strands[k];
      if (s.free === 2) {
        s.pull = 0;
        continue;
      }
      if (held.has(comp[k])) continue;
      loose.set(comp[k], [...(loose.get(comp[k]) ?? []), k]);
    }
    for (const group of loose.values()) {
      const u = group.map((k) => ({ x: Math.cos(this.strands[k].ang), y: Math.sin(this.strands[k].ang) }));
      const sx = u.reduce((n, q) => n + q.x, 0);
      const sy = u.reduce((n, q) => n + q.y, 0);
      if (Math.hypot(sx, sy) < 1e-9) continue;
      // Least change to unit pulls that makes them cancel: T = 1 - Uᵀ(UUᵀ)⁻¹U1.
      const xx = u.reduce((n, q) => n + q.x * q.x, 0);
      const xy = u.reduce((n, q) => n + q.x * q.y, 0);
      const yy = u.reduce((n, q) => n + q.y * q.y, 0);
      const det = xx * yy - xy * xy;
      let weights: number[] | null = null;
      if (Math.abs(det) > 1e-9) {
        const lx = (yy * sx - xy * sy) / det;
        const ly = (-xy * sx + xx * sy) / det;
        weights = u.map((q) => 1 - (q.x * lx + q.y * ly));
        if (weights.some((w) => w < 0)) weights = null;
      }
      group.forEach((k, n) => (this.strands[k].pull = weights ? weights[n] : 0));
    }
  }

  /** Which lace each strand belongs to. */
  components(): number[] {
    const root = this.strands.map((_, k) => k);
    const find = (a: number): number => {
      while (root[a] !== a) a = root[a] = root[root[a]];
      return a;
    };
    for (const n of this.nodes) {
      for (let q = 1; q < n.strands.length; q++) root[find(n.strands[q])] = find(n.strands[0]);
    }
    return root.map((_, k) => find(k));
  }

  // ---- the weave, and what must stay clear of what ---------------------------------

  private adjacent(a: number, b: number): boolean {
    const p = this.strands[a];
    const q = this.strands[b];
    return p.n0 === q.n0 || p.n0 === q.n1 || p.n1 === q.n0 || p.n1 === q.n1;
  }

  private pairsAndCounts(): void {
    this.pairs = [];
    this.ref = [];
    const level = this.strands.map((s) => levelAt(this.scene, s.i));
    const boxes = this.polys.map(boxOf);
    for (let a = 0; a < this.strands.length; a++) {
      for (let b = a + 1; b < this.strands.length; b++) {
        if (level[a] !== level[b]) continue; // other storeys are not woven with this one
        if (this.adjacent(a, b)) continue;
        this.pairs.push([a, b]);
        this.ref.push(boxesWithin(boxes[a], boxes[b], 0) ? polylineCrossings(this.polys[a], this.polys[b]).length : 0);
      }
    }
  }

  /**
   * Is the weave these polylines make the one the drawing made?
   *
   * A count may fall by twos — a strand that wandered across another three
   * times now crosses it once, a loop laid over another strand comes off it —
   * and `commit` then ratchets the reference down to it. Anything else is a
   * crossing made, or an interlock lost. A pair that comes apart altogether is
   * flagged, because from then on it has to be kept clear side by side
   * (`reconstrain`).
   */
  sameWeave(polys: Vec2[][], commit: boolean): boolean {
    const boxes = polys.map(boxOf);
    const got: number[] = [];
    for (let n = 0; n < this.pairs.length; n++) {
      const [a, b] = this.pairs[n];
      const want = this.ref[n];
      const c = boxesWithin(boxes[a], boxes[b], 0) ? polylineCrossings(polys[a], polys[b]).length : 0;
      if (c !== want && !(c < want && (want - c) % 2 === 0)) return false;
      got.push(c);
    }
    if (commit) {
      if (got.some((c, n) => c === 0 && this.ref[n] !== 0)) this.parted = true;
      this.ref = got;
    }
    return true;
  }

  /** Pairs have come uncrossed since the clearances were listed: list them again. */
  reconstrain(): void {
    if (!this.parted) return;
    this.parted = false;
    this.constrain();
  }

  private over(a: number, b: number): number {
    const ia = this.strands[a].src.id;
    const ib = this.strands[b].src.id;
    for (const m of this.scene.masks) {
      if (m.overId === ia && m.underId === ib) return a;
      if (m.overId === ib && m.underId === ia) return b;
    }
    return this.strands[a].i > this.strands[b].i ? a : b;
  }

  private constrain(): void {
    this.pairsAndCounts();
    this.terms = this.strands.map((_, k) => ({ t: 'len', s: k }) as Term);
    const crosses = new Map<string, number>();
    this.pairs.forEach(([a, b], n) => {
      crosses.set(`${a}:${b}`, this.ref[n]);
      crosses.set(`${b}:${a}`, this.ref[n]);
    });
    for (let n = 0; n < this.pairs.length; n++) {
      const [a, b] = this.pairs[n];
      const sa = this.strands[a];
      const sb = this.strands[b];
      if (!sa.movable && !sb.movable) continue;
      if (this.ref[n] === 0) {
        const d = sa.half + sb.half + this.air;
        this.terms.push({ t: 'clear', a, b, d }, { t: 'clear', a: b, b: a, d });
      }
    }
    // A fold stops short of what its strands cross, and a loose end runs a
    // little further. Where NONE of a node's strands crosses `b`, each of them
    // is already held clear of it side by side.
    this.nodes.forEach((node) => {
      for (let b = 0; b < this.strands.length; b++) {
        if (node.strands.includes(b)) continue;
        const through = node.strands.filter((a) => (crosses.get(`${a}:${b}`) ?? 0) > 0);
        if (!through.length) continue;
        const a = through[0];
        if (!this.strands[a].movable && !this.strands[b].movable) continue;
        const side: 0 | 1 = this.nodes[this.strands[a].n0] === node ? 0 : 1;
        const past = node.kind === 'free' ? this.poke : this.air / 2;
        this.terms.push({ t: 'poke', a, side, b, d: this.strands[b].half + past });
      }
    });
    // Three strands crossing each other once, each over the next.
    const n = this.strands.length;
    const once = (a: number, b: number): boolean => crosses.get(`${a}:${b}`) === 1;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        if (!once(a, b)) continue;
        for (let c = b + 1; c < n; c++) {
          if (!once(a, c) || !once(b, c)) continue;
          const ab = this.over(a, b);
          const bc = this.over(b, c);
          const ca = this.over(c, a);
          const cyclic = (ab === a && bc === b && ca === c) || (ab === b && bc === c && ca === a);
          if (!cyclic) continue;
          const area = this.triangle(a, b, c, this.polys);
          if (!area || Math.abs(area.area) < 1e-9) continue;
          this.terms.push({ t: 'tri', a, b, c, sign: Math.sign(area.area), d: this.air / 2 });
        }
      }
    }

    const termsOf: number[][] = this.strands.map(() => []);
    this.terms.forEach((term, q) => {
      const on = term.t === 'len' ? [term.s] : term.t === 'tri' ? [term.a, term.b, term.c] : [term.a, term.b];
      for (const k of on) termsOf[k].push(q);
    });
    this.varTerms = this.varStrands.map((list) => [...new Set(list.flatMap((k) => termsOf[k]))]);
  }

  /** The triangle three mutually crossing strands make: signed area, and the
   *  side of it lying along each. */
  private triangle(
    a: number,
    b: number,
    c: number,
    polys: Vec2[][],
  ): { area: number; sa: number; sb: number; sc: number } | null {
    const ab = polylineCrossings(polys[a], polys[b])[0];
    const bc = polylineCrossings(polys[b], polys[c])[0];
    const ca = polylineCrossings(polys[c], polys[a])[0];
    if (!ab || !bc || !ca) return null;
    const area = ((bc.x - ab.x) * (ca.y - ab.y) - (bc.y - ab.y) * (ca.x - ab.x)) / 2;
    return { area, sa: dist(ab, ca), sb: dist(ab, bc), sc: dist(bc, ca) };
  }

  // ---- the energy ---------------------------------------------------------------

  /** How far a term is from holding, px (0 for a length). */
  violation(term: Term, polys: Vec2[][]): number {
    if (term.t === 'len') return 0;
    if (term.t === 'poke') {
      const p = polys[term.a];
      const e = term.side === 0 ? p[0] : p[p.length - 1];
      return Math.max(0, term.d - pointPoly(e.x, e.y, polys[term.b]));
    }
    if (term.t === 'clear') {
      let worst = 0;
      const other = polys[term.b];
      for (const p of polys[term.a]) {
        const v = term.d - pointPoly(p.x, p.y, other);
        if (v > worst) worst = v;
      }
      return worst;
    }
    const tri = this.triangle(term.a, term.b, term.c, polys);
    if (!tri) return 0;
    const sides = tri.sa + tri.sb + tri.sc;
    if (sides < 1e-9) return term.d;
    const covered =
      tri.sa * this.strands[term.a].half + tri.sb * this.strands[term.b].half + tri.sc * this.strands[term.c].half;
    return Math.max(0, term.d - (2 * tri.area * term.sign - covered) / sides);
  }

  private value(term: Term, polys: Vec2[][], x: Float64Array, k: number): number {
    if (term.t === 'len') {
      const s = this.strands[term.s];
      const p = polys[term.s];
      let e = polyLength(p);
      if (s.free >= 0) {
        const held = Math.max(x[s.lv], 1);
        e -= held;
        // Barely held to its drawn length — enough that a clearance moves it and
        // nothing else does. Without this a bent arm can lower its own bending
        // by simply growing: the same bulge on a longer chord is a flatter one.
        e += (HOLD * (held - s.len) ** 2) / Math.max(s.len, 1);
        if (s.free !== 2 && s.pull > 0) {
          const hold = s.free === 1 ? p[0] : p[p.length - 1];
          e -= s.pull * (Math.cos(s.ang) * hold.x + Math.sin(s.ang) * hold.y);
        }
      }
      if (!s.line && s.L0 > 1e-9) {
        // A bend costs more than the length it adds, so it is only ever as much
        // as a clearance demands.
        e += STIFF * Math.max(0, polyLength(p) - dist(p[0], p[p.length - 1]));
        // Handles to thirds; a locked centre to the middle of the other two.
        const a1 = x[s.v];
        const a2 = s.cp2Free ? x[s.v + 2] : s.L0;
        const b2 = s.cp2Free ? x[s.v + 3] : 0;
        let r = (a1 - s.L0 / 3) ** 2;
        if (s.cp2Free) r += (a2 - (2 * s.L0) / 3) ** 2;
        if (s.centre) r += (x[s.v + 4] - (a1 + a2) / 2) ** 2 + (x[s.v + 5] - (x[s.v + 1] + b2) / 2) ** 2;
        e += (REG * r) / s.L0;
      }
      return e;
    }
    if (term.t === 'clear') {
      // Summed over the vertices, not the worst one: two parallel runs then feel
      // both their ends at once, and the descent does not zigzag between them.
      let sum = 0;
      const other = polys[term.b];
      if (!boxesWithin(boxOf(polys[term.a]), boxOf(other), term.d)) return 0;
      for (const p of polys[term.a]) {
        const v = term.d - pointPoly(p.x, p.y, other);
        if (v > 0) sum += v * v;
      }
      return (k / 2) * sum;
    }
    const v = this.violation(term, polys);
    return (k / 2) * v * v;
  }

  energy(x: Float64Array, k: number, polys: Vec2[][]): number {
    let e = 0;
    for (const term of this.terms) e += this.value(term, polys, x, k);
    return e;
  }

  allPolys(x: Float64Array): Vec2[][] {
    return this.strands.map((_, k) => this.poly(k, x));
  }

  /** Gradient by central differences, each unknown re-evaluating only the terms
   *  its strands appear in. `polys` must be the polylines at `x`. */
  private gradient(x: Float64Array, k: number, polys: Vec2[][]): Float64Array {
    const g = new Float64Array(x.length);
    for (let v = 0; v < x.length; v++) {
      if (!this.live[v]) continue;
      const strands = this.varStrands[v];
      const terms = this.varTerms[v];
      const keep = strands.map((s) => polys[s]);
      const at = (value: number): number => {
        const was = x[v];
        x[v] = value;
        for (const s of strands) polys[s] = this.poly(s, x);
        let e = 0;
        for (const q of terms) e += this.value(this.terms[q], polys, x, k);
        x[v] = was;
        return e;
      };
      const base = x[v];
      g[v] = (at(base + FD) - at(base - FD)) / (2 * FD);
      strands.forEach((s, n) => (polys[s] = keep[n]));
    }
    return g;
  }

  /**
   * L-BFGS at one stiffness. Every step is capped, must lower the energy, and
   * must leave the weave as it was — a step that would make or lose a crossing
   * is halved until it does not.
   */
  minimize(k: number, maxIter: number, onStep?: () => void): void {
    const n = this.x.length;
    let x = this.x;
    let polys = this.allPolys(x);
    let f = this.energy(x, k, polys);
    let g = this.gradient(x, k, polys);
    const S: Float64Array[] = [];
    const Y: Float64Array[] = [];
    const dot = (a: Float64Array, b: Float64Array): number => {
      let s = 0;
      for (let i = 0; i < n; i++) s += a[i] * b[i];
      return s;
    };
    let calm = 0;
    for (let it = 0; it < maxIter; it++) {
      if (performance.now() > this.deadline) break;
      // Two-loop recursion.
      const d = Float64Array.from(g, (v) => -v);
      const alpha: number[] = [];
      for (let i = S.length - 1; i >= 0; i--) {
        const a = dot(S[i], d) / dot(S[i], Y[i]);
        alpha[i] = a;
        for (let j = 0; j < n; j++) d[j] -= a * Y[i][j];
      }
      if (S.length) {
        const last = S.length - 1;
        const scale = dot(S[last], Y[last]) / dot(Y[last], Y[last]);
        for (let j = 0; j < n; j++) d[j] *= scale;
      }
      for (let i = 0; i < S.length; i++) {
        const b = dot(Y[i], d) / dot(S[i], Y[i]);
        for (let j = 0; j < n; j++) d[j] += (alpha[i] - b) * S[i][j];
      }
      let slope = dot(g, d);
      if (!(slope < 0)) {
        for (let j = 0; j < n; j++) d[j] = -g[j];
        slope = -dot(g, g);
        S.length = Y.length = 0;
      }
      if (slope > -1e-18) break;
      let big = 0;
      for (let j = 0; j < n; j++) big = Math.max(big, Math.abs(d[j]));
      let t = Math.min(1, MAX_MOVE / big);
      let next: Float64Array | null = null;
      let nextPolys: Vec2[][] = polys;
      let fNext = f;
      for (let ls = 0; ls < 30; ls++) {
        const trial = new Float64Array(n);
        for (let j = 0; j < n; j++) trial[j] = x[j] + t * d[j];
        const tp = this.allPolys(trial);
        const ft = this.energy(trial, k, tp);
        if (ft <= f + 1e-4 * t * slope && this.sameWeave(tp, true)) {
          next = trial;
          nextPolys = tp;
          fNext = ft;
          break;
        }
        t *= 0.5;
      }
      if (!next) {
        if (S.length) {
          // The curvature history may be what is wrong; try again downhill.
          S.length = Y.length = 0;
          continue;
        }
        break;
      }
      const gNext = this.gradient(next, k, nextPolys);
      const s = new Float64Array(n);
      const y = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        s[j] = next[j] - x[j];
        y[j] = gNext[j] - g[j];
      }
      if (dot(s, y) > 1e-14) {
        S.push(s);
        Y.push(y);
        if (S.length > 12) {
          S.shift();
          Y.shift();
        }
      }
      const gain = f - fNext;
      x = next;
      polys = nextPolys;
      f = fNext;
      g = gNext;
      this.x = x;
      this.polys = polys;
      this.iterations++;
      onStep?.();
      let gmax = 0;
      for (let j = 0; j < n; j++) gmax = Math.max(gmax, Math.abs(g[j]));
      if (gmax < 1e-9) break;
      calm = gain < 1e-13 * (1 + Math.abs(f)) ? calm + 1 : 0;
      if (calm >= 3) break;
    }
    this.x = x;
    this.polys = polys;
  }

  // ---- straight strands, and strands that must bend --------------------------------

  /**
   * Walk every bent strand's handles onto its chord — thirds along, nothing
   * across — a couple of pixels at a time, checking the weave at each step.
   * A strand that arrives is a straight one from then on. One that would have
   * to pass through a crossing to get there stops where it is and stays bent.
   *
   * It stops BEFORE it gets that far, not on arrival: a step is also refused if
   * it would push anything more than halfway into a clearance it was not already
   * that deep in. This walk is blind to the penalties — it only moves handles —
   * so without that it would lay a strand right across the end it has to go
   * round and leave the descent standing on the one configuration it cannot
   * step off.
   */
  unbend(onStep?: () => void): void {
    const bent = this.strands.map((s, k) => (s.line ? -1 : k)).filter((k) => k >= 0);
    if (!bent.length) return;
    const goal = (s: SStrand): number[] => [s.L0 / 3, 0, (2 * s.L0) / 3, 0, s.L0 / 2, 0];
    const from = new Map<number, number[]>(bent.map((k) => [k, Array.from(this.x.subarray(this.strands[k].v, this.strands[k].v + 6))]));
    let far = 0;
    for (const k of bent) {
      const s = this.strands[k];
      const g = goal(s);
      (from.get(k) as number[]).forEach((v, q) => {
        if (this.live[s.v + q]) far = Math.max(far, Math.abs(v - g[q]));
      });
    }
    const steps = Math.max(1, Math.ceil(far / UNBEND));
    const put = (k: number, step: number): void => {
      const s = this.strands[k];
      const g = goal(s);
      const f = from.get(k) as number[];
      for (let q = 0; q < 6; q++) this.x[s.v + q] = f[q] + ((g[q] - f[q]) * step) / steps;
    };
    const limit = this.terms.map((term) =>
      term.t === 'len' ? 0 : Math.max(this.violation(term, this.polys), term.d / 2),
    );
    const allowed = (polys: Vec2[][]): boolean => {
      for (let q = 0; q < this.terms.length; q++) {
        const term = this.terms[q];
        if (term.t !== 'len' && this.violation(term, polys) > limit[q] + 1e-9) return false;
      }
      return this.sameWeave(polys, true);
    };
    let going = bent;
    for (let step = 1; step <= steps && going.length; step++) {
      for (const k of going) put(k, step);
      let polys = this.allPolys(this.x);
      if (!allowed(polys)) {
        // Somebody is in the way of somebody: find out who, one at a time.
        for (const k of going) put(k, step - 1);
        const still: number[] = [];
        for (const k of going) {
          put(k, step);
          if (allowed(this.allPolys(this.x))) still.push(k);
          else put(k, step - 1);
        }
        going = still;
        polys = this.allPolys(this.x);
      }
      this.polys = polys;
      onStep?.();
    }
    for (const k of going) {
      const s = this.strands[k];
      s.line = true;
      for (let q = 0; q < 6; q++) this.live[s.v + q] = 0;
    }
    this.polys = this.allPolys(this.x);
  }

  /** A bent strand that tension has laid along its chord becomes a straight one. */
  straighten(): void {
    for (let k = 0; k < this.strands.length; k++) {
      const s = this.strands[k];
      if (s.line) continue;
      const p = this.polys[k];
      const a = p[0];
      const b = p[p.length - 1];
      const chord = [a, b];
      let off = 0;
      for (const q of p) off = Math.max(off, pointPoly(q.x, q.y, chord));
      // And not doubling back along it: a handle past the far end draws a
      // straight line that overshoots, which is longer than its chord.
      if (off > STRAIGHT || polyLength(p) - dist(a, b) > STRAIGHT) continue;
      s.line = true;
      const polys = this.allPolys(this.x);
      if (!this.sameWeave(polys, true)) {
        s.line = false;
        continue;
      }
      for (let q = 0; q < 6; q++) this.live[s.v + q] = 0;
      this.polys = polys;
    }
  }

  /**
   * Give its bend back to a strand that was straightened and is now caught in a
   * clearance that will not close. Called once the penalty is stiff enough that
   * what is still violated is violated because straight lines cannot do it.
   *
   * Only a strand that was DRAWN bent. One drawn straight stays straight even
   * where that leaves it overlapping — which happens when the things it would
   * have to clear are pinned by another level — because an S put into every arm
   * of a stitch that was merely built tight is not a tidier stitch.
   */
  bendWhereStuck(tolerance: number): boolean {
    const stuck = new Set<number>();
    for (const term of this.terms) {
      if (term.t === 'len' || this.violation(term, this.polys) <= tolerance) continue;
      const on = term.t === 'tri' ? [term.a, term.b, term.c] : [term.a, term.b];
      for (const k of on) {
        const s = this.strands[k];
        if (s.line && !s.wasLine && s.L0 > 1e-6) stuck.add(k);
      }
    }
    for (const k of stuck) {
      const s = this.strands[k];
      const p = this.polys[k];
      s.L0 = Math.max(dist(p[0], p[p.length - 1]), 1e-6);
      s.line = false;
      s.cp2Free = true;
      s.centre = false;
      const slots = [s.L0 / 3, 0, (2 * s.L0) / 3, 0];
      slots.forEach((v, q) => {
        this.x[s.v + q] = v;
        this.live[s.v + q] = 1;
      });
      s.movable = true;
    }
    if (stuck.size) this.polys = this.allPolys(this.x);
    return stuck.size > 0;
  }

  worst(): number {
    let w = 0;
    for (const term of this.terms) w = Math.max(w, this.violation(term, this.polys));
    return w;
  }

  crossings(): number {
    return this.ref.reduce((n, c) => n + c, 0);
  }

  // ---- back onto the scene -------------------------------------------------------

  /** Write the current state onto the strand records this problem was built on. */
  write(): void {
    for (let k = 0; k < this.strands.length; k++) {
      const s = this.strands[k];
      const [a, b] = this.ends(k, this.x);
      const src = s.src;
      src.start = { x: a.x, y: a.y };
      src.end = { x: b.x, y: b.y };
      if (s.line || s.L0 < 1e-9) {
        resetControlPoints(src);
        continue;
      }
      const [c1, c2, centre] = this.handles(k, this.x, a, b);
      src.control_points = [c1, c2];
      src.triangleHasMoved = true;
      src.cp2Activated = s.cp2Free && Math.hypot(c2.x - b.x, c2.y - b.y) > CP_EPS;
      if (centre) {
        src.control_point_center = centre;
        src.control_point_center_locked = true;
      } else if (!s.centre) {
        // A centre the curve was not reading (Middle handle off) is left locked
        // where the solve could not see it only if it was never ours to move.
        if (!(src.control_point_center_locked && !this.opts.thirdEnabled)) src.control_point_center_locked = false;
      }
      updateControlCenter(src);
    }
  }
}

// ---- the function -----------------------------------------------------------------

function cloneScene(scene: Scene3D): Scene3D {
  return JSON.parse(JSON.stringify(scene)) as Scene3D;
}

/** The strands a stretch of `level` works on (`null` for every storey at once). */
export function stretchScope(scene: Scene3D, level: number | null): number[] {
  const out: number[] = [];
  scene.strands.forEach((s, i) => {
    if (s.isMask) return;
    if (level !== null && levelAt(scene, i) !== level) return;
    if (Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y) < 1e-6) return;
    out.push(i);
  });
  return out;
}

/**
 * Pull one level of a scene tight. The scene passed in is not touched; the
 * result carries a new one.
 */
export function stretchLevel(scene: Scene3D, level: number | null, options: StretchOptions = {}): StretchResult {
  const opts = {
    air: options.air ?? STRETCH_AIR,
    poke: options.poke ?? STRETCH_POKE,
    square: options.square ?? true,
    thirdEnabled: options.thirdEnabled ?? true,
    widthScale: options.widthScale ?? 1,
  };
  const out = cloneScene(scene);
  const active = stretchScope(out, level);
  const report: StretchReport = {
    strands: active.length,
    movable: 0,
    crossings: 0,
    changed: false,
    slack: 0,
    straightened: 0,
    bent: 0,
    overlapBefore: 0,
    overlapAfter: 0,
    iterations: 0,
    cutShort: false,
  };
  if (!active.length) return { scene: out, report, frames: [] };

  // The "before" is measured on the drawing itself, ahead of any tidying.
  const lengthBefore = active.map((i) => polyLength(drawn(out.strands[i], opts.thirdEnabled)));

  const p = new Problem(out, active, opts);
  p.deadline = performance.now() + (options.budget ?? 2500);
  report.movable = p.strands.filter((s) => s.movable).length;
  report.overlapBefore = p.worst();

  const wantFrames = Math.max(0, Math.floor(options.frames ?? 0));
  const shots: Array<{ x: Float64Array; line: boolean[] }> = [];
  const shoot = (): void => {
    if (wantFrames) shots.push({ x: p.x.slice(), line: p.strands.map((s) => s.line) });
  };
  shoot();

  if (report.movable > 0) {
    // Straight first, then tight: loose to begin with, so the drawing relaxes
    // rather than snaps, and stiffer by tens from there.
    const stage = (k: number): void => {
      // A loop that came off another strand has to be kept clear of it from here.
      p.reconstrain();
      p.minimize(k, 400, shoot);
    };
    p.unbend(shoot);
    p.reconstrain();
    for (const k of [1, 10, 100]) stage(k);
    // What would not straighten where it was drawn may do now the knot has moved.
    p.unbend(shoot);
    p.straighten();
    if (p.bendWhereStuck(0.5)) for (const k of [10, 100]) stage(k);
    for (const k of [1e3, 1e4]) stage(k);
    p.straighten();
    p.reconstrain();
    // The last two stiffnesses, extrapolated to an infinite one: a penalty
    // leaves each clearance short by (force / stiffness), which is linear in
    // 1/k, so two solves a decade apart say where the line meets zero.
    const soft = p.x.slice();
    p.minimize(1e5, 400, shoot);
    const stiff = p.x.slice();
    const exact = new Float64Array(stiff.length);
    for (let j = 0; j < stiff.length; j++) exact[j] = stiff[j] + (stiff[j] - soft[j]) / 9;
    const polys = p.allPolys(exact);
    if (p.sameWeave(polys, false)) {
      const held = p.worst();
      p.x = exact;
      p.polys = polys;
      if (p.worst() > held + 1e-9) {
        p.x = stiff;
        p.polys = p.allPolys(stiff);
      }
    }
    shoot();
  }

  // The slack comes out through the loose ends: each lace keeps its drawn
  // length, so its arms take up what its middle gave (or give back what the
  // knot needed to open). Unless that would undo the solve — an arm let out
  // into something, or drawn back short of what it must poke past — in which
  // case the arms stay as the clearances left them.
  const comp = p.components();
  const lengthAfter = p.polys.map(polyLength);
  const given = new Map<number, number>();
  p.strands.forEach((_, k) => given.set(comp[k], (given.get(comp[k]) ?? 0) + lengthBefore[k] - lengthAfter[k]));
  const ends = new Map<number, number>();
  p.strands.forEach((s, k) => {
    if (s.free >= 0 && s.line) ends.set(comp[k], (ends.get(comp[k]) ?? 0) + (s.free === 2 ? 2 : 1));
  });
  const solved = p.x.slice();
  const heldAt = p.worst();
  p.strands.forEach((s, k) => {
    const n = ends.get(comp[k]);
    if (!n || s.free < 0 || !s.line) return;
    const grow = ((given.get(comp[k]) ?? 0) / n) * (s.free === 2 ? 2 : 1);
    p.x[s.lv] = Math.max(p.x[s.lv] + grow, 1);
  });
  const grown = p.allPolys(p.x);
  const keeps = p.sameWeave(grown, false);
  if (keeps) p.polys = grown;
  if (!keeps || p.worst() > heldAt + 1e-6) {
    p.x = solved;
    p.polys = p.allPolys(solved);
  }
  report.slack = p.strands.reduce((n, s) => n + (s.lv >= 0 ? p.x[s.lv] - s.len : 0), 0);
  shoot();

  report.overlapAfter = p.worst();

  report.crossings = p.crossings();
  report.iterations = p.iterations;
  report.cutShort = performance.now() > p.deadline;
  report.straightened = p.strands.filter((s) => s.line && !s.wasLine).length;
  report.bent = p.strands.filter((s) => !s.line).length;

  // Frames first (they rewrite the same records), the final state last.
  const frames: Scene3D[] = [];
  if (wantFrames && shots.length > 1) {
    const final = { x: p.x, line: p.strands.map((s) => s.line) };
    const pick = Math.min(wantFrames, shots.length);
    for (let f = 0; f < pick; f++) {
      const shot = shots[Math.round((f * (shots.length - 1)) / Math.max(1, pick - 1))];
      p.x = shot.x;
      p.strands.forEach((s, k) => (s.line = shot.line[k]));
      p.write();
      frames.push(cloneScene(out));
    }
    p.x = final.x;
    p.strands.forEach((s, k) => (s.line = final.line[k]));
  }
  p.write();
  recomputeOccupancy(out);

  report.changed = active.some((i) => {
    const a = scene.strands[i];
    const b = out.strands[i];
    const moved = (u: Vec2, v: Vec2): boolean => Math.hypot(u.x - v.x, u.y - v.y) > 0.01;
    return (
      moved(a.start, b.start) ||
      moved(a.end, b.end) ||
      moved(a.control_points[0], b.control_points[0]) ||
      moved(a.control_points[1], b.control_points[1])
    );
  });
  // Nothing moved: hand back the scene exactly as it came, not a re-normalised copy.
  if (!report.changed) {
    report.slack = 0;
    report.straightened = 0;
    report.overlapAfter = report.overlapBefore;
    return { scene: cloneScene(scene), report, frames: [] };
  }
  return { scene: out, report, frames };
}

function drawn(s: Strand3D, thirdEnabled: boolean): Vec2[] {
  return sampleCenterline(
    {
      start: s.start,
      end: s.end,
      control_points: s.control_points,
      control_point_center: thirdEnabled ? s.control_point_center : null,
      control_point_center_locked: s.control_point_center_locked,
      attached: s.parentId !== null,
      bias: s.bias ?? null,
    },
    STEPS,
  );
}
