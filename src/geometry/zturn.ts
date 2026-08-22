// The storey turn, taken from the Z band lab.
//
// `/zlab/` (docs/z-lab.md on the z-connection branch) works one storey turn on
// its own, away from any weave, and settles what shape it should be. This file
// is the part of that answer the studio needs: the CENTRELINE of the turn. The
// lab also builds its own ribbon rings, and those are not wanted here — the
// studio sweeps its own section along whatever centreline it is given.
//
// The shape, in the lab's own words:
//
//     leg out at the lower storey, half-turn tip of radius step/2,
//     leg back at the upper storey
//
// and the legs are the point. A plane curve that turns exactly half a turn and
// rises exactly one storey cannot be much deeper than half that storey at a
// steady turning rate; depth has to be bought with turning that does not rise,
// and the straight legs are that turning-free depth. A tip on its own is a
// knuckle, not a bight.
//
// The rule underneath the whole family: wrapping a strip a half turn about a
// crease reverses the heading across the crease and keeps it along it, so a
// crease at θ to the strap turns the heading by 2θ. The crease position is the
// entire design parameter, and `lean` is where it sits — 0 an exact fold on the
// bisector, 1 a square crease.

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

/** The lab's gauge for the turn itself: Leg length against its lace width. The
 *  studio's laces are any width, so the leg is carried across as a RATIO — the
 *  turn should be the same shape on a fat lace as on a thin one. */
export const LEG = 0.95;
export const LAB_LACE_WIDTH = 1.1;
export const LEG_PER_WIDTH = LEG / LAB_LACE_WIDTH;

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
 */
export function zTurn(o: TurnOpts): Vec3[] {
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
  const len = Math.max(o.leg, 0);
  const legSteps = o.legSteps ?? 10;
  const tipSteps = o.tipSteps ?? 28;

  const out: Vec3[] = [];

  // One leg: an arc of `bend` over `len`, flat, at a fixed height. Straight is
  // the limit rather than a special case, but the radius is 1/0 there.
  const r = Math.abs(bend) < 1e-6 ? 0 : len / bend;
  const legAt = (from: Vec2, head: Vec2, t: number): Vec2 => {
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
  const UP = { x: 0, y: 0, z: 1 };
  const DOWN = { x: 0, y: 0, z: -1 };

  for (let i = 0; i <= legSteps; i++) {
    const q = legAt(o.from, a, i / legSteps);
    out.push({ x: q.x, y: q.y, z: mid - sign * h, up: UP });
  }

  // The tip. The crease sits at half the turn it has to make, off the heading
  // the leg brings in — the bisector when the legs did nothing, square to the
  // strap when they did it all.
  const inTip = spin(a, bend);
  const c = spin(inTip, tipTurn / 2);
  let n = perp(c);
  const du = inTip.x * c.x + inTip.y * c.y;
  let dv = inTip.x * n.x + inTip.y * n.y;
  if (dv < 0) {
    n = { x: -n.x, y: -n.y };
    dv = -dv;
  }
  // How far the strip walks along the crease per unit of tip travelled. It
  // diverges as the crease swings onto the strip's own length — where a fold
  // stops being one — so it is capped there.
  const k = Math.min(dv < 1e-9 ? Infinity : du / dv, (len * 4) / (Math.PI * h));
  const base = legAt(o.from, a, 1);
  for (let i = 1; i <= tipSteps; i++) {
    const phi = Math.PI * (i / tipSteps);
    const walk = h * phi * k; // profile arclength times the crease rate
    const sin = Math.sin(phi);
    const cos = Math.cos(phi);
    out.push({
      x: base.x + c.x * walk + n.x * h * sin,
      y: base.y + c.y * walk + n.y * h * sin,
      z: mid - sign * h * cos,
      // Square to the crease and to the tip's own tangent, turning over with the
      // strip. Taken from the lab's own ring frame.
      up: { x: -n.x * sin, y: -n.y * sin, z: cos },
    });
  }

  // The leg coming away, bending the rest of the way onto the outgoing run.
  const away = spin(inTip, tipTurn);
  const tipEnd: Vec2 = {
    x: base.x + c.x * h * Math.PI * k,
    y: base.y + c.y * h * Math.PI * k,
  };
  for (let i = 1; i <= legSteps; i++) {
    const q = legAt(tipEnd, away, i / legSteps);
    out.push({ x: q.x, y: q.y, z: mid + sign * h, up: DOWN });
  }

  return out;
}
