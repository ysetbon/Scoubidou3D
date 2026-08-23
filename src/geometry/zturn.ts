// The storey turn: our own build, with the Z lab's angle.
//
// Two separate questions live in a fold, and only one of them is hard:
//
//   1. WHICH TURN is this — a fold, a square-ish crease, or no fold at all?
//      That is a function of the SEPARATION between the two runs, and it is
//      settled: /zlab/ swept every separation from 0 to 180 with nothing else in
//      the frame and published the answer. `autoLean` below is that answer, and
//      its numbers are copied rather than re-derived. See docs/z-lab.md.
//
//   2. WHAT SHAPE does that turn have? Leg out at the lower storey, half-turn
//      tip of radius step/2, leg back at the upper storey. That is built here,
//      simply, against the studio's own centrelines — not lifted from the lab,
//      which builds its own ribbon rings for a single turn standing alone.
//
// So: the angle comes from the lab, the construction is ours. The lab's rule
// underneath both — wrapping a strip a half turn about a crease reverses the
// heading across the crease and keeps it along it, so a crease at θ to the strap
// turns the heading by 2θ — is why the crease position is the whole parameter.

import { Vec3 } from './vec';

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Auto's settled numbers, straight out of docs/z-lab.md. Confirmed by eye in the
 * lab rather than guessed, so they are copied rather than re-derived.
 */
export const AUTO = { lo: 48, hi: 61, carry: 126, cap: 0.25 } as const;

/**
 * Which of the lab's three the turn is. The buttons in `/zlab/` are Fold, Square
 * and Carry on, and Fold/Square are the two ends of one number — the lean — so
 * this is a reading of `autoLean`, not a fourth thing.
 */
export type TurnMode = 'fold' | 'square' | 'carry-on';

export function turnMode(separationDeg: number): TurnMode {
  const sep = Math.abs(separationDeg);
  if (sep >= AUTO.carry) return 'carry-on';
  // The lab's caption: square 48-61. Below the plateau the crease is still
  // mostly on the bisector and the fold is mostly a fold — a 24-degree
  // separation leans an eighth of the way and deserves the name 'fold', not
  // 'square'. Reading 'square' from lean > cap/2 called it square from 24
  // degrees up, which is not what the lab published.
  return sep >= AUTO.lo && sep <= AUTO.hi ? 'square' : 'fold';
}

/** The lab's gauge for the turn itself: Leg length against its lace width. The
 *  studio's laces are any width, so the leg is carried across as a RATIO — the
 *  turn should be the same shape on a fat lace as on a thin one. */
export const LEG = 0.95;
export const LAB_LACE_WIDTH = 1.1;
export const LEG_PER_WIDTH = LEG / LAB_LACE_WIDTH;

/**
 * Which construction the storey turn uses. All four build the same three
 * pieces — leg, rolled tip, leg — and differ only in how the tip's sweep
 * frame is arrived at, which is the whole of the C's shape. See `zTurn`.
 *
 *   current  the shipped frame: correct climbing, degenerate dropping
 *   radial   the frame taken from the path itself (the minimal fix)
 *   mirror   built climbing and reflected (an independent route to `radial`)
 *   broad    `radial`, with the bight opened out in plan
 */
export type TurnStyle = 'current' | 'radial' | 'mirror' | 'broad';

export const TURN_STYLES: TurnStyle[] = ['current', 'radial', 'mirror', 'broad'];

/**
 * How wide `broad` opens the bight, against the lace's width.
 *
 * The tip's in-plane profile radius is normally `h`, half the climb — which on
 * a two-thickness storey lands near half the lace width, so the bight comes
 * out about as tight as the strip is wide and the C closes to a slot. This is
 * the floor under that radius, and it only ever widens it.
 *
 * It has to clear `h` to do anything at all: on this lab's laces the width is
 * 1.08 and `h` is 0.52, so a ratio under about 0.48 leaves the floor never
 * biting and 'broad' collapses onto 'radial'. 0.7 opens the bight by about
 * half again, which is enough to read as a rounder return with an open eye.
 */
export const BROAD_PER_WIDTH = 0.7;

const smoothstep = (t: number): number => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/**
 * How far toward a SQUARE crease the fold leans, at a given separation.
 *
 * Reproduces the lab's Auto curve and its published gauge:
 *
 *     sep   0°     24°    48°    55°    61°    70°    90°    125°   126°+
 *     lean  0.000  0.125  0.250  0.250  0.250  0.237  0.145  0.000  carries on
 *
 * A linear ramp up to `lo`, a plateau at `cap` to `hi`, then a smoothstep decay
 * to nothing by the separation before `carry` — where the fold family hands over
 * to the ramp entirely and this returns 0.
 */
export function autoLean(separationDeg: number): number {
  const sep = Math.abs(separationDeg);
  if (sep >= AUTO.carry) return 0; // carries on: no fold to lean
  if (sep <= 0) return 0;
  if (sep < AUTO.lo) return AUTO.cap * (sep / AUTO.lo);
  if (sep <= AUTO.hi) return AUTO.cap;
  const last = AUTO.carry - 1;
  return AUTO.cap * (1 - smoothstep((sep - AUTO.hi) / (last - AUTO.hi)));
}

const norm = (d: Vec2): Vec2 => {
  const l = Math.hypot(d.x, d.y) || 1;
  return { x: d.x / l, y: d.y / l };
};
const perp = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x });
const spin = (d: Vec2, ang: number): Vec2 => ({
  x: d.x * Math.cos(ang) - d.y * Math.sin(ang),
  y: d.x * Math.sin(ang) + d.y * Math.cos(ang),
});

/** Signed turn from one heading to the other, in radians. */
export function headingChange(din: Vec2, dout: Vec2): number {
  const a = norm(din);
  const b = norm(dout);
  return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
}

/** The separation the lab dials: 0° a dead fold-back, 180° straight through. */
export const separationOf = (din: Vec2, dout: Vec2): number =>
  180 - Math.abs((headingChange(din, dout) * 180) / Math.PI);

export interface TurnOpts {
  /** Where the turn starts, in plan. */
  from: Vec2;
  /** The heading arriving at the turn, unit or not. */
  din: Vec2;
  /** The heading leaving it. */
  dout: Vec2;
  /** Height of the run arriving, and of the run leaving. */
  zIn: number;
  zOut: number;
  /** Straight, turning-free depth at each storey. See LEG. */
  leg: number;
  /** The leg arriving, and the leg leaving, when they cannot be the same.
   *  A turn seated in a short arm has to give up leg length, and it should give
   *  it up on the side that is actually crowded: an arm's outermost fold has open
   *  run beyond it and no reason to shorten there. Default: `leg` for both. */
  legIn?: number;
  legOut?: number;
  /**
   * Which way up the strip ARRIVES: +1 face-up, -1 face-down. Default +1.
   *
   * A turn rolls the strap right over, so a lace with more than one fold does
   * not arrive at the second one the same way up it arrived at the first. The
   * face alternates down the lace, and a turn that assumes face-up regardless
   * puts a half turn of roll between itself and its neighbour with no length to
   * take it in — which is a strip turned inside out in a single step.
   */
  face?: number;
  /** Which construction to use. Default 'current' — the shipped one. */
  style?: TurnStyle;
  /** Samples along each leg and around the tip. */
  legSteps?: number;
  tipSteps?: number;
}

/**
 * The turn's centreline: leg out, half-turn tip, leg back.
 *
 * This is `foldTurn` from src/zlab/bands.ts with the ribbon stripped out — same
 * legs, same crease, same tip — returning points instead of rings. The tip's
 * radius is half the storey step, so the curve leaves on `zIn` and arrives on
 * `zOut` exactly, and `walk` carries it along the crease as it turns, which is
 * what lets a leaning fold travel sideways instead of doubling back on itself.
 *
 * ---- the frame, and why a DROPPING fold used to come out pinched ----------
 *
 * The tip's centreline is a half-circle about the crease. In the plane spanned
 * by the crease's in-plane normal `n` and Z, its offset from the roll axis is
 *
 *     (h·sin φ,  −sign·h·cos φ)          sign = +1 climbing, −1 dropping
 *
 * so a RIGID wrap — the strip going round the roll rather than through it —
 * needs the thickness axis to be that circle's own outward radial,
 *
 *     (sin φ,  −sign·cos φ)
 *
 * The shipped frame ('current') is `(−sin φ·face, cos φ·face)`, which has no
 * `sign` in it at all. Against the radial that is
 *
 *     climbing  (sign +1):  −face                  constant — rigid
 *     dropping  (sign −1):  +face·cos 2φ           swings, and is ZERO at φ=π/2
 *
 * At that zero — the apex, the middle of the bight — the thickness axis lies
 * ALONG the path and the cross-section has no width left to sweep: the strip
 * wrings itself into a point. That is the pinched, twisted flap, and it is why
 * only half a lace's turns showed it. Which half is decided by the junction:
 * walking a chain, the joint taken start-to-start is the one crossed going
 * downhill, so it drops and pinches, while the end-to-start joint climbs and
 * comes out as the broad clean C. Same code, same fold, opposite sign.
 *
 * The lab this was ported from benches ONE canonical turn, climbing, so the
 * half of the parameter space that is wrong never came up there.
 *
 * `style` picks how the frame is arrived at. 'current' keeps the shipped
 * formula; everything else derives the frame from the path, and is therefore
 * rigid whichever way the fold runs. For a CLIMBING fold every style below
 * reproduces 'current' exactly — the accepted C is never touched.
 */
export function zTurn(o: TurnOpts): Vec3[] {
  const style = o.style ?? 'current';

  // 'mirror' does not trust a frame formula to cover both directions: it
  // builds the turn CLIMBING and reflects the result in Z. The plan geometry
  // cannot notice — only `h` enters it, and `h` is a magnitude — so the
  // reflection moves heights and frames and nothing else. An independent route
  // to what 'radial' computes directly; if the two render alike, the formula
  // is right.
  if (style === 'mirror' && o.zOut < o.zIn) {
    const centre = (o.zIn + o.zOut) / 2;
    return zTurn({ ...o, style: 'current', zIn: o.zOut, zOut: o.zIn }).map((q) => ({
      ...q,
      z: 2 * centre - q.z,
      // Reflecting in Z takes (x, y, z) to (x, y, -z), and then the whole axis
      // is negated: a reflection reverses orientation, so the frame comes out
      // pointing into the strip instead of out of it. Negating restores the
      // convention, and lands this on exactly what 'radial' computes — which
      // is the point of keeping both.
      up: q.up ? { x: -q.up.x, y: -q.up.y, z: q.up.z } : undefined,
    }));
  }

  const a = norm(o.din);
  const swing = headingChange(o.din, o.dout);
  const lean = autoLean(separationOf(o.din, o.dout));

  // A square crease turns the heading a half turn, taken the way the lace is
  // already going. Lean says how much of the way there the crease is, and the
  // legs are left holding the difference.
  const square = swing >= 0 ? Math.PI : -Math.PI;
  const bend = (lean * (swing - square)) / 2;
  const tipTurn = swing - 2 * bend;

  const mid = (o.zIn + o.zOut) / 2;
  const h = Math.max(Math.abs(o.zOut - o.zIn) / 2, 1e-4);
  const sign = o.zOut >= o.zIn ? 1 : -1;
  const lenIn = Math.max(o.legIn ?? o.leg, 0);
  const lenOut = Math.max(o.legOut ?? o.leg, 0);
  const legSteps = o.legSteps ?? 10;
  const tipSteps = o.tipSteps ?? 28;

  const out: Vec3[] = [];

  // One leg: an arc of `bend` over its length, flat, at a fixed height. Straight
  // is the limit rather than a special case, but the radius is 1/0 there. Both
  // legs turn through the same `bend` — that is the lean, and it is a property of
  // the crease, not of how much room each side happens to have — so a shorter leg
  // is a tighter arc rather than a smaller turn.
  const legAt = (from: Vec2, head: Vec2, t: number, len: number): Vec2 => {
    const r = Math.abs(bend) < 1e-6 ? 0 : len / bend;
    const m = perp(head);
    if (!r) return { x: from.x + head.x * len * t, y: from.y + head.y * len * t };
    const phi = bend * t;
    return {
      x: from.x + head.x * r * Math.sin(phi) + m.x * r * (1 - Math.cos(phi)),
      y: from.y + head.y * r * Math.sin(phi) + m.y * r * (1 - Math.cos(phi)),
    };
  };

  // The legs lie flat, face up; the tip rolls the strip right over between them,
  // so the leg coming away is upside down. That is not a quirk of the model — it
  // is what a folded strap does, and it is why the other side shows at a turn.
  const face = (o.face ?? 1) >= 0 ? 1 : -1;
  const UP = { x: 0, y: 0, z: face };
  const DOWN = { x: 0, y: 0, z: -face };

  // The climb belongs in the TIP's frame, and ONLY there.
  //
  // `face` arrives as a parity, alternating down the lace, and it is load
  // bearing: a turn hands the strip to whatever follows it upside down, so
  // turn k's exit has to be what turn k+1's entry expects. The legs are that
  // handshake — (0,0,face) in, (0,0,-face) out — and they must not move, or
  // consecutive turns disagree by a half turn with no length to take it in.
  // Folding `sign` into the legs did exactly that, and it showed as a lace
  // torn open along its CORE, the run between its two turns.
  //
  // What the climb has to reach is the tip in between, so `sign` multiplies
  // the parity here alone. The two ends then still read (0,0,face) and
  // (0,0,-face) whichever way the fold runs — the handshake is preserved —
  // and only the path taken between them turns the right way round.
  const tipFace = style === 'current' ? face : sign * face;

  for (let i = 0; i <= legSteps; i++) {
    const q = legAt(o.from, a, i / legSteps, lenIn);
    out.push({ x: q.x, y: q.y, z: mid - sign * h, up: UP });
  }

  // The tip. The crease sits at half the turn it has to make, off the heading
  // the leg brings in — the bisector when the legs did nothing, square to the
  // strap when they did it all.
  const inTip = spin(a, bend);
  const c = spin(inTip, tipTurn / 2);
  let n = perp(c);
  let dv = inTip.x * n.x + inTip.y * n.y;
  if (dv < 0) {
    n = { x: -n.x, y: -n.y };
    dv = -dv;
  }
  // The strip also WALKS along the crease as the tip rolls — the lab's walk
  // term, ported whole this time. An earlier port dropped it, reasoning that
  // the runs are already where the weave put them so there was nowhere to walk
  // to. That was exactly backwards. The walk is not optional travel bolted on:
  // an oblique crease HAS to advance the strip along itself as it rolls — only
  // a crease dead square to the strap (a 0-degree fold-back) rolls in place —
  // and dropping it left every turn landing short of its outgoing run by
  // pi*h/tan(tipTurn/2): measured 0.29 to 0.37 against a run step of ~0.19 on
  // 24-degree folds, exactly this term's value there. The correction that
  // papered over it bent the exit leg to reach the run, which is the SQUARE
  // borrowing — legs bending in plan — smeared onto what the lab's own curve
  // says should be a nearly pure fold at that separation. Fold the walk in and
  // the legs go back to being straight, which is what 'fold' means.
  //
  // `k` is the walk per unit of tip profile, du/dv in the lab's terms. It
  // diverges as the crease swings onto the strip's own length — where a fold
  // stops being one — so the lab caps it; the cap is carried across scaled to
  // the leg, the studio's own reach.
  const du = inTip.x * c.x + inTip.y * c.y;
  const k = Math.min(dv < 1e-9 ? Infinity : du / dv, (Math.max(o.leg, h) * 4) / (Math.PI * h));
  const base = legAt(o.from, a, 1, lenIn);

  // How far the profile reaches out in plan. Normally `h`, which makes the tip
  // a circle; 'broad' lifts it toward the lace's own width and the tip becomes
  // an ellipse — wider across, still climbing exactly `h`. Neither END moves:
  // at phi = 0 and phi = pi the profile is back on the roll axis whatever the
  // radius, so the turn still leaves on `zIn` and lands on `zOut`.
  const rad = style === 'broad' ? Math.max(h, (o.leg / LEG_PER_WIDTH) * BROAD_PER_WIDTH) : h;

  // The walk is the profile's ARCLENGTH times the crease rate. A circle's is
  // h·phi in closed form; the widened ellipse's is not, so it is accumulated
  // over the tip's own samples — the resolution the walk is applied at anyway.
  // The circle keeps its exact form, so 'current' and 'radial' are unchanged
  // to the last bit.
  const arc: number[] = [0];
  for (let i = 1; i <= tipSteps; i++) {
    const p0 = (Math.PI * (i - 1)) / tipSteps;
    const p1 = (Math.PI * i) / tipSteps;
    arc.push(arc[i - 1] + Math.hypot(rad * (Math.sin(p1) - Math.sin(p0)), h * (Math.cos(p1) - Math.cos(p0))));
  }
  const walkAt = (i: number, phi: number): number => (rad === h ? h * phi : arc[i]) * k;

  for (let i = 1; i <= tipSteps; i++) {
    const phi = Math.PI * (i / tipSteps);
    const sin = Math.sin(phi);
    const cos = Math.cos(phi);
    const walk = walkAt(i, phi); // profile arclength times the crease rate
    // Square to the crease and to the tip's own tangent, turning over with the
    // strip. The profile's tangent is (rad·cos, sign·h·sin) in the (n, Z)
    // plane, so its outward normal — the axis a rigid wrap needs — is
    // (h·sin, −sign·rad·cos), normalised. With rad = h that is the circle's
    // radial, and with sign = +1 it is the lab's own ring frame, which is why
    // a climbing fold comes out identical whichever style asked for it.
    const ux = h * sin;
    const uz = -sign * rad * cos;
    const ul = Math.hypot(ux, uz) || 1;
    out.push({
      x: base.x + c.x * walk + n.x * rad * sin,
      y: base.y + c.y * walk + n.y * rad * sin,
      z: mid - sign * h * cos,
      up:
        style === 'current'
          ? { x: -n.x * sin * face, y: -n.y * sin * face, z: cos * face }
          : { x: (-n.x * ux * tipFace) / ul, y: (-n.y * ux * tipFace) / ul, z: (-uz * tipFace) / ul },
    });
  }

  // The leg coming away, bending the rest of the way onto the outgoing run,
  // from where the walk left the strip.
  const away = spin(inTip, tipTurn);
  const reach = walkAt(tipSteps, Math.PI);
  const tipEnd: Vec2 = { x: base.x + c.x * reach, y: base.y + c.y * reach };
  for (let i = 1; i <= legSteps; i++) {
    const q = legAt(tipEnd, away, i / legSteps, lenOut);
    out.push({ x: q.x, y: q.y, z: mid + sign * h, up: DOWN });
  }

  return out;
}
