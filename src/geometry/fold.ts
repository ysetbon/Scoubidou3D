// What a lace DOES where it turns back on itself and changes storey.
//
// This is the fold family the Z band lab (`src/zlab/`) was written to find, and
// it is here rather than there because the studio builds its turns with it too.
// One implementation, two callers: the lab dials it by hand across the whole
// range of separations, the studio reads the same numbers off the model.
//
// THE THING THAT MAKES 180 HARD, stated once so the builders can be judged on it:
//
// Call the angle between the two runs, measured at the joint between the rays
// they send out from it, the SEPARATION. At 180 the lace carries straight on and
// there is no turn at all. At 0 the outgoing run lies exactly on top of the
// incoming one and the turn is a dead fold-back.
//
// A dead fold-back is not badly conditioned — the crease is perfectly well
// defined, square to both runs, and the shear the model computes goes cleanly to
// zero. What actually goes is ROOM. At separation 0 the two runs share one
// footprint in the drawing plane: everything that distinguishes them is height.
// Any construction that reaches "out of the turn" along an in-plane normal is
// reaching along the runs' own direction, out past the end of the lace, because
// in plan there is no outward left. That is why a turn built on an outward
// normal reads as a block stuck on the end rather than as part of the lace.
//
// So the useful question is not how to stabilise a normal. It is what a lace
// actually does, which needs no in-plane outward at all: it CREASES and rolls
// over. See `foldTurn`.

import * as THREE from 'three';
import { Vec2, Vec3 } from './vec';
import { collapseJoints, foldsOf } from './polyline';
import { Auto, autoCarries, autoLean } from './autoFold';

export interface Gauge {
  /** Across the lace, world units. */
  width: number;
  /** Through the lace. */
  thickness: number;
  /** How far apart the two runs' centrelines sit in Z. */
  step: number;
  /** How much of the section's corner is rounded, 0..1. */
  round: number;
  /** How long the fold's straight legs are, world units. */
  reach: number;
  /** 0 a dead fold-back, 1 straight through. See `blend`. */
  k: number;
  /** 0 an exact fold on the bisector, 1 a square fold. See `foldTurn`. */
  lean: number;
  /** Skip the fold family entirely and ramp instead. See `carry`. */
  carryOn: boolean;
  /** How long the ramp gets at straight-through, world units. */
  ramp: number;
}

/** Rings along the turn, how far it displaces the run coming away, and how much
 *  lace it uses getting there. */
export interface Turn {
  rings: Vec3[][];
  slide: Vec3;
  /** Arc length of the turn's own centreline, world units. What the runs on
   *  either side have to give up to make room for it. */
  length: number;
}

/**
 * How much the band should behave like a STRAIGHT-THROUGH lace rather than a
 * dead fold-back, 0..1.
 *
 * The two ends of the separation dial want different things and each builder
 * only ever knew one of them. At 0 the runs lie on top of each other and the
 * band is a turn: it has to climb the storey in place. At 180 the lace carries
 * straight on and merely rises, so the band is a RAMP — and a builder that
 * still climbs in place there leaves a peg standing in an otherwise straight
 * lace, which is what the first cut of all three did.
 *
 * So the character is blended rather than switched. Smoothstep, not a straight
 * line: the turn holds its shape through the tight angles where it is doing
 * real work, and gives it up over the open ones where there is nothing left to
 * turn.
 */
export function blend(separationDeg: number): number {
  const t = Math.min(1, Math.max(0, Math.abs(separationDeg) / 180));
  return t * t * (3 - 2 * t);
}

/**
 * How far a band travels in plan, AS A VECTOR — direction and distance in one,
 * and deliberately not normalised.
 *
 * `(din + dout) / 2` is the axis both runs agree on, and its length is
 * sin(sep/2): nothing at a dead fold-back, where the two headings cancel and
 * there is nowhere to travel, the full run direction at straight-through.
 *
 * Normalising it was a bug, and the visible one. The DIRECTION of that sum is
 * unstable exactly where its length vanishes — at separation 0 it is the
 * incoming heading, and half a degree later it has snapped ninety degrees to
 * the perpendicular:
 *
 *     sep     0     0.5     1     5    15
 *     dir   0.0°   89.8° 89.5° 87.5° 82.5°
 *
 * Scaled by a length that was already positive, that snap moved the whole band
 * sideways the moment the runs parted, which reads as a switch rather than a
 * blend however gently the weight is eased. Left unnormalised the instability
 * cannot bite: the vector is multiplied by its own vanishing length, so it
 * goes smoothly to zero and the direction it points while getting there stops
 * mattering.
 */
export function travel(din: Vec2, dout: Vec2): Vec2 {
  const a = norm(din);
  const b = norm(dout);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * How far the heading turns from one run to the other, signed and UNWRAPPED.
 *
 * The width axis follows the heading, so this is what it must rotate by. Taken
 * between the two width axes instead and folded into a quarter turn either way
 * — which is the obvious thing to do, since a rectangle laid the other way up
 * is the same rectangle — it jumps a half turn as the runs pass square:
 *
 *     sep    89     89.9     90     90.1     91
 *     turn -89.0°  -89.9°  -90.0°  +89.9°  +89.0°
 *
 * Read off the headings and left alone it runs 180° down to 0° without a step.
 * Interpolating through the half turn is safe precisely because the section IS
 * symmetric: it arrives back on itself.
 */
export function heading(din: Vec2, dout: Vec2): number {
  const a = norm(din);
  const b = norm(dout);
  return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
}

/** The separation these two headings meet at, in degrees: 0 a dead fold-back,
 *  180 a lace carrying straight on. */
export function separationOf(din: Vec2, dout: Vec2): number {
  return 180 - (Math.abs(heading(din, dout)) * 180) / Math.PI;
}

// ---- section ---------------------------------------------------------------

/** A rounded rectangle, walked once, in section coordinates: u across the
 *  width, v through the thickness. The builders take the section as an argument
 *  rather than making their own, so a caller with a section of its own — the
 *  studio's swept ribbon has one — can hand the fold the very same ring and
 *  have the two meet vertex for vertex. */
export function section(g: Gauge, steps = 5): Vec2[] {
  const hu = g.width / 2;
  const hv = g.thickness / 2;
  const r = Math.min(hu, hv) * Math.max(0, Math.min(1, g.round));
  const pts: Vec2[] = [];
  const corner = (cu: number, cv: number, a0: number) => {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (Math.PI / 2) * (i / steps);
      pts.push({ x: cu + Math.cos(a) * r, y: cv + Math.sin(a) * r });
    }
  };
  corner(hu - r, hv - r, 0);
  corner(-(hu - r), hv - r, Math.PI / 2);
  corner(-(hu - r), -(hv - r), Math.PI);
  corner(hu - r, -(hv - r), -Math.PI / 2);
  return pts;
}

// ---- tube ------------------------------------------------------------------

/**
 * Stitch a list of equal-length rings into a solid.
 *
 * Every builder below produces rings and nothing else, so the winding, the caps
 * and the normals are decided in exactly one place. Rings must be walked the
 * same way round and ordered along the piece.
 *
 * `caps` closes the two ends. A turn spliced between two swept runs leaves them
 * OPEN: its end rings coincide with the runs' own end rings, so a cap there
 * would be a pair of coincident faces buried inside solid lace, which z-fight
 * rather than seal anything.
 */
export function tube(rings: Vec3[][], caps = true): THREE.BufferGeometry {
  const m = rings[0].length;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const ring of rings) for (const p of ring) pos.push(p.x, p.y, p.z);
  // Wound to match the sweep's rings exactly (ribbon.ts). It has to: a turn and
  // the runs either side of it are one mesh, and the OUTLINE shell is drawn
  // BackSide — so a piece wound the other way shows the near faces of its shell
  // instead of the far ones and floods the turn black. Nothing catches that with
  // a DoubleSide material, which is why the lab never saw it.
  for (let i = 0; i < rings.length - 1; i++) {
    const a = i * m;
    const b = (i + 1) * m;
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      idx.push(a + j, b + j2, b + j);
      idx.push(a + j, a + j2, b + j2);
    }
  }
  if (caps) {
    // Flat caps, fanned from the first vertex of each end ring.
    const last = (rings.length - 1) * m;
    for (let j = 1; j < m - 1; j++) {
      idx.push(0, j, j + 1);
      idx.push(last, last + j + 1, last + j);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  return geom;
}

/** Place a section at `p`, lying across `side` with its thickness along +Z. */
export function ring(p: Vec3, side: Vec2, sec: Vec2[]): Vec3[] {
  return sec.map((s) => ({
    x: p.x + side.x * s.x,
    y: p.y + side.y * s.x,
    z: p.z + s.y,
  }));
}

export const perp = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x });
export const norm = (d: Vec2): Vec2 => {
  const l = Math.hypot(d.x, d.y) || 1;
  return { x: d.x / l, y: d.y / l };
};
export const spin = (d: Vec2, ang: number): Vec2 => ({
  x: d.x * Math.cos(ang) - d.y * Math.sin(ang),
  y: d.x * Math.sin(ang) + d.y * Math.cos(ang),
});

// ---- 3D vector odds and ends, for the fold's frame -------------------------

const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm3 = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

/** Place a section at `p` on an arbitrary pair of axes. */
function ring3(p: Vec3, side: Vec3, up: Vec3, sec: Vec2[]): Vec3[] {
  return sec.map((q) => ({
    x: p.x + side.x * q.x + up.x * q.y,
    y: p.y + side.y * q.x + up.y * q.y,
    z: p.z + side.z * q.x + up.z * q.y,
  }));
}

// ---- FOLD ------------------------------------------------------------------

/**
 * Fold the strap back on itself, the way a belt or a paper strip folds.
 *
 * The build this replaces bent the centreline through the turn and swept the
 * section round it. At a dead fold-back that looks right, and it is wrong
 * everywhere else, for a reason worth stating plainly: A FLAT STRAP CANNOT BEND
 * IN ITS OWN PLANE. It bends about an axis lying across its width — closing a
 * book — and about no other. Asked to turn a hundred and forty degrees in plan,
 * as a swept centreline asks at forty degrees of separation, the inner edge has
 * to travel a shorter path than the outer one and there is no thickness to take
 * up the difference, so the surface buckles.
 *
 * What a strip does instead is crease and roll over. Wrapping the strip a half
 * turn about a cylinder whose axis is the crease reverses the component of the
 * heading across the crease and keeps the component along it, so the crease
 * angle DECIDES how far the heading turns: a crease at θ to the strap turns it
 * by 2θ, and a crease square to the strap turns it a full half turn. The
 * surface is developable either way — the strip's own plane, rolled — so
 * nothing stretches, nothing pinches, and width and thickness carry through
 * untouched.
 *
 * That one fact is what makes this a family rather than two builds. There are
 * two ways to get the runs to line up:
 *
 *   LEAN 0 — crease on the bisector, so the tip alone turns the heading the
 *     whole way and the legs run dead straight. Exact, developable end to end,
 *     and the strip never bends in its own plane. Its price is at wide
 *     separations: the crease sits well off square, the strap's width stands
 *     across it, and the tip spans width·sin(sep/2) — taller than the storey it
 *     climbs once the separation passes 2·asin(step / width). That is the flared
 *     shell. Correct paper, and not a shape anybody wants.
 *
 *   LEAN 1 — crease square to the strap, so the tip is a clean bight with the
 *     width axis flat the whole way round: the ⊂ rather than the C, at any
 *     separation. But a square crease turns the heading a full half turn and
 *     the runs rarely want one, so the LEGS supply the difference, bending in
 *     plan, half each. That bend is the thing a flat strap cannot really do —
 *     spread over a leg it is gentle, where the swept centreline wanted it all
 *     at the joint, but it is the same borrowing.
 *
 * Anything between is a crease somewhere between the two, with the legs taking
 * exactly what the tip does not. Nothing is interpolated and nothing is faked:
 * every lean is a real crease angle with a real developable tip.
 *
 * Both ends of the family agree at a dead fold-back — there the bisector IS
 * square to the strap — so the lean can be swung freely at 0 and only starts to
 * mean anything as the runs part.
 *
 * The build starts at the ORIGIN with the incoming run at z = -step/2 heading
 * `din`, and ends at `slide` with the outgoing run at +step/2 heading `dout`.
 */
export function foldTurn(
  din: Vec2,
  dout: Vec2,
  g: Gauge,
  sec: Vec2[],
  legSteps = 20,
  tipSteps = 56,
): Turn {
  const a = norm(din);
  const swing = heading(din, dout);
  const len = Math.max(g.reach, 0);
  // A leg of no length has nowhere to put a bend, so it cannot hold one: at zero
  // reach the lean is not a choice the geometry can express and the crease goes
  // back on the bisector, where the tip turns the heading the whole way on its
  // own. Left unclamped the legs collapse to a twist in place — rings sharing a
  // centre with their width axes rotating between them, which is a fan of
  // self-crossing slivers rather than a piece of lace.
  const legOn = len > 1e-9;
  const lean = legOn ? Math.max(0, Math.min(1, g.lean)) : 0;
  // A square crease turns the heading a half turn, taken the way the lace is
  // already going. Lean says how much of the way there the crease is, and the
  // legs are left holding the difference.
  const square = swing >= 0 ? Math.PI : -Math.PI;
  const bend = (lean * (swing - square)) / 2;
  const tipTurn = swing - 2 * bend;

  const h = Math.max(g.step / 2, 1e-4);
  const rings: Vec3[][] = [];

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

  const legRings = legOn ? legSteps : 0;
  for (let i = 0; i <= legRings; i++) {
    const t = legRings ? i / legRings : 0;
    const q = legAt({ x: 0, y: 0 }, a, t);
    rings.push(ring({ x: q.x, y: q.y, z: -h }, perp(spin(a, bend * t)), sec));
  }

  // The tip. The crease sits at half the turn it has to make, off the heading
  // the leg brings in — which is the bisector when the legs did nothing, and
  // square to the strap when they did it all.
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
  // diverges as the crease swings onto the strip's own length — the point where
  // a fold stops being one — so it is capped there.
  const k = Math.min(dv < 1e-9 ? Infinity : du / dv, (g.ramp * 4) / (Math.PI * h));
  const base = legAt({ x: 0, y: 0 }, a, 1);
  for (let i = 1; i <= tipSteps; i++) {
    const phi = Math.PI * (i / tipSteps);
    const sin = Math.sin(phi);
    const cos = Math.cos(phi);
    const walk = h * phi * k; // profile arclength times the crease rate
    const p: Vec3 = {
      x: base.x + c.x * walk + n.x * h * sin,
      y: base.y + c.y * walk + n.y * h * sin,
      z: -h * cos,
    };
    const tan = norm3({ x: c.x * k + n.x * cos, y: c.y * k + n.y * cos, z: sin });
    // The face normal, square to the crease and to the tip's own tangent. It
    // turns right over as the strip does, which is what shows the other side
    // coming out.
    const up: Vec3 = { x: -n.x * sin, y: -n.y * sin, z: cos };
    rings.push(ring3(p, norm3(cross3(up, tan)), up, sec));
  }

  // The leg coming away, upside down as the tip left it, bending the rest of
  // the way onto the outgoing run.
  const out = spin(inTip, tipTurn);
  const tipEnd: Vec2 = { x: base.x + c.x * h * Math.PI * k, y: base.y + c.y * h * Math.PI * k };
  const down: Vec3 = { x: 0, y: 0, z: -1 };
  for (let i = 1; i <= legRings; i++) {
    const t = i / legRings;
    const head = spin(out, bend * t);
    const q = legAt(tipEnd, out, t);
    rings.push(
      ring3({ x: q.x, y: q.y, z: h }, cross3(down, { x: head.x, y: head.y, z: 0 }), down, sec),
    );
  }

  const end = legOn ? legAt(tipEnd, out, 1) : tipEnd;
  // Each leg runs its own `len` whether it is straight or bent — a bent one is
  // an arc of radius len/bend through bend — and the tip's speed in phi is
  // h·sqrt(1 + k²), constant, over a half turn of it.
  const length = 2 * len + h * Math.PI * Math.hypot(1, k);
  return { rings, slide: { x: end.x, y: end.y, z: 0 }, length };
}

/**
 * Carry on in the same direction instead of folding: swing the heading round
 * in plan and rise the storey while doing it.
 *
 * This is what the lace does when it is barely turning at all. It is NOT a
 * fold and does not pretend to be — the strip keeps its face up the whole way
 * and bends in its own plane, which a flat strap cannot really do. Over a small
 * turn nobody can tell and it reads as the natural thing; over a large one the
 * inner edge has to travel a shorter path than the outer, and it pinches.
 *
 * It leaves and arrives level, because the runs are level: the climb follows a
 * smoothstep rather than a straight line, so there is no kink at either end.
 *
 * The fold family reaches this shape on its own at a straight-through lace —
 * lean 0 there puts the crease along the strip, the tip flattens into a shallow
 * oblique step and the legs are straight — so this build is kept for comparison
 * rather than because the phase needs it.
 */
export function carry(din: Vec2, dout: Vec2, g: Gauge, sec: Vec2[], steps = 96): Turn {
  const a = norm(din);
  const m = perp(a);
  const swing = heading(din, dout);
  const len = Math.max(g.ramp, 1e-3);
  const r = Math.abs(swing) < 1e-6 ? 0 : len / swing;
  const plan = (t: number): Vec2 => {
    const phi = swing * t;
    if (!r) return { x: a.x * len * t, y: a.y * len * t };
    return {
      x: a.x * r * Math.sin(phi) + m.x * r * (1 - Math.cos(phi)),
      y: a.y * r * Math.sin(phi) + m.y * r * (1 - Math.cos(phi)),
    };
  };

  const h = g.step / 2;
  const rings: Vec3[][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const q = plan(t);
    rings.push(
      ring(
        { x: q.x, y: q.y, z: -h + g.step * (t * t * (3 - 2 * t)) },
        perp(spin(a, swing * t)),
        sec,
      ),
    );
  }
  const end = plan(1);
  return { rings, slide: { x: end.x, y: end.y, z: 0 }, length: len };
}

/**
 * The turn.
 *
 * `carryOn` picks the ramp; otherwise it is the fold family, and `lean` says
 * where in it. Auto swings the lean rather than switching builds, which is the
 * whole reason the family was written as one thing: at a dead fold-back both
 * ends of it are the same hairpin, at ninety degrees the square end is the only
 * one that is not a shell, and at straight-through the exact end has already
 * flattened into a step. Fold, square, carry on — with nothing to cross between
 * them.
 */
export function turn(din: Vec2, dout: Vec2, g: Gauge, sec: Vec2[]): Turn {
  return g.carryOn ? carry(din, dout, g, sec) : foldTurn(din, dout, g, sec);
}

// ---- splicing a turn into a swept lace -------------------------------------
//
// The lab builds one turn between two runs it invents. The studio's runs are
// pinned by the model: both arrive at the same point in the drawing plane, a
// storey apart in height, with no offset between them. An oblique fold does not
// leave them there — it DISPLACES the strip along its crease, so the run coming
// away starts to one side of the one going in.
//
// The two are reconciled by moving the turn rather than the runs. The fold
// starts BEFORE the joint on the way in and ends AFTER it on the way out, at the
// one place where both of its ends land on the two run lines:
//
//     a·din + b·dout = slide
//
// Two equations, two unknowns, determinant `cross(din, dout)` — singular only
// where the runs are parallel, which is not a turn. The incoming run is then
// trimmed at `a` and the outgoing one started at `b`, and the turn is dropped
// into the gap.

/** What a lace is, as far as its turns are concerned. */
export interface LaceGauge {
  width: number;
  thickness: number;
  /** How much of the section's corner is rounded, 0..1. */
  round: number;
  /** Straight leg length, world units. Zero leaves the turn as its bare tip. */
  reach: number;
  /** Ramp length, world units — and so the cap on a crease's slide, at 4×. */
  ramp: number;
  /** Which separation gets which lean. */
  auto: Auto;
}

/** One turn, resolved: what to build and where to put it. */
export interface SplicedTurn {
  /** The gauge it was built at. `step` is the storey it climbs. */
  g: Gauge;
  /** The headings the builder was handed. Reversed where the lace DESCENDS —
   *  the build always climbs, and a descending turn is the same turn walked the
   *  other way. */
  din: Vec2;
  dout: Vec2;
  /** Where the builder's local origin lands. */
  at: Vec3;
  /** Degrees between the two runs' rays: 0 a dead fold-back. */
  separation: number;
  /** How far back along each run the turn had to be given, world units. */
  trimIn: number;
  trimOut: number;
}

/** A lace cut into straight-swept runs with a built turn between each pair. */
export interface SplicedLace {
  runs: Vec3[][];
  turns: SplicedTurn[];
}

/** The turn's rings, in world coordinates, on a section of the caller's
 *  choosing — the same turn is built twice at different gauges for the body and
 *  its outline shell, and both must sit in exactly the same place. */
export function turnRings(t: SplicedTurn, sec: Vec2[]): Vec3[][] {
  const built = turn(t.din, t.dout, t.g, sec);
  return built.rings.map((r) =>
    r.map((p) => ({ x: p.x + t.at.x, y: p.y + t.at.y, z: p.z + t.at.z })),
  );
}

/** Cumulative in-plane length at each vertex. */
function arcOf(pts: Vec3[]): number[] {
  const cum = new Array<number>(pts.length);
  cum[0] = 0;
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return cum;
}

/** Where a run meets a turn: the point, and the heading through it. */
interface Joint {
  p: Vec3;
  dir: Vec2;
}

/**
 * One run of the lace, from arc `lo` to arc `hi`.
 *
 * A turn's end ring is a plain section — width across `perp(dir)`, thickness
 * straight up — so the run has to arrive that way too, or the two faces meet at
 * an angle and leave a wedge. The sweep reads its heading and its climb from
 * DIFFERENCES between neighbouring samples, so the run is given a short level
 * lead at each turn: two samples on the run line at the turn's own height, and
 * the last ring comes out square to the run and dead level whatever the
 * centreline was doing a moment earlier.
 */
function runBetween(
  pts: Vec3[],
  cum: number[],
  lo: number,
  hi: number,
  head: Joint | null,
  tail: Joint | null,
  lead: number,
): Vec3[] {
  const out: Vec3[] = [];
  const push = (p: Vec3): void => {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-9) return;
    out.push(p);
  };
  if (head) {
    push({ x: head.p.x, y: head.p.y, z: head.p.z });
    push({ x: head.p.x + head.dir.x * lead, y: head.p.y + head.dir.y * lead, z: head.p.z });
  }
  const from = head ? lo + lead * 1.5 : -Infinity;
  const to = tail ? hi - lead * 1.5 : Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] > from && cum[i] < to && cum[i] >= lo - 1e-9 && cum[i] <= hi + 1e-9) {
      push({ ...pts[i] });
    }
  }
  if (tail) {
    push({ x: tail.p.x - tail.dir.x * lead, y: tail.p.y - tail.dir.y * lead, z: tail.p.z });
    push({ x: tail.p.x, y: tail.p.y, z: tail.p.z });
  }
  return out;
}

/**
 * Cut a lace at every fold and work out the turn that belongs in each gap.
 *
 * The turn is its own solid rather than something the sweep can carry: the
 * sweep's rings hold their width axis in XY, and a fold's tip tilts its width
 * clean out of horizontal. Splitting is what lets both be exact. The join costs
 * nothing to look at because the turn's end rings ARE the runs' end rings — same
 * section, same width axis, same level — so the two surfaces meet without a
 * step, and neither end is capped: they are inside solid lace.
 */
export function spliceFolds(centerline: Vec3[], lg: LaceGauge): SplicedLace {
  const pts = collapseJoints(centerline);
  if (pts.length < 2) return { runs: [], turns: [] };
  const folds = foldsOf(pts);
  if (folds.length === 0) return { runs: [pts], turns: [] };

  const cum = arcOf(pts);
  const total = cum[cum.length - 1];
  // The slide is the same whatever section the turn is finally built on, so the
  // placement is solved on a section of one point and nothing is swept twice.
  const probe: Vec2[] = [{ x: 0, y: 0 }];

  const turns: SplicedTurn[] = [];
  const cuts: Array<{ s: number; a: number; b: number; into: Joint; outOf: Joint }> = [];

  for (let j = 0; j < folds.length; j++) {
    const f = folds[j];
    const p = pts[f.index];
    const zIn = p.zIn ?? p.z;
    const zOut = p.zOut ?? p.z;
    const step = Math.abs(zOut - zIn);
    const separation = separationOf(f.din, f.dout);
    // The build always climbs: it starts at -step/2 and ends at +step/2. A lace
    // coming DOWN through the turn is the same turn walked the other way, so it
    // is built on the reversed headings and its two ends swap runs.
    const up = zOut >= zIn;
    const din = up ? f.din : { x: -f.dout.x, y: -f.dout.y };
    const dout = up ? f.dout : { x: -f.din.x, y: -f.din.y };
    const g: Gauge = {
      width: lg.width,
      thickness: lg.thickness,
      step,
      round: lg.round,
      reach: lg.reach,
      k: blend(separation),
      lean: autoLean(lg.auto, separation),
      carryOn: autoCarries(lg.auto, separation),
      ramp: lg.ramp,
    };
    const built = turn(din, dout, g, probe);
    // Built the other way round, the slide runs from the outgoing run back to
    // the incoming one, so the same solve wants it negated.
    const S = up ? built.slide : { x: -built.slide.x, y: -built.slide.y };
    const det = f.din.x * f.dout.y - f.din.y * f.dout.x;
    let a: number;
    let b: number;
    if (Math.abs(det) > 1e-9) {
      a = (S.x * f.dout.y - S.y * f.dout.x) / det;
      b = (f.din.x * S.y - f.din.y * S.x) / det;
    } else {
      // A DEAD FOLD-BACK: the two runs are one line, and the solve cannot say
      // where along it the turn sits, because every point on it satisfies the
      // constraint. This is not a rare corner — half the turns in a box stitch
      // column are exactly antiparallel — so it needs the right answer rather
      // than a safe one, and the right answer is the LIMIT of the solve as the
      // runs part. Work it out for a hairpin and it comes to half the turn's own
      // length each way, which is also what the constraint says on its own:
      // a − b is the slide's component along the run, and a + b is what the turn
      // takes out of the two runs to fit in.
      const along = S.x * f.din.x + S.y * f.din.y;
      a = (built.length + along) / 2;
      b = (built.length - along) / 2;
    }
    // Never past the runs themselves. Two neighbouring turns share the run
    // between them, so neither may take more than its half of it.
    const before = cum[f.index] - (j > 0 ? cum[folds[j - 1].index] : 0);
    const after = (j < folds.length - 1 ? cum[folds[j + 1].index] : total) - cum[f.index];
    a = Math.max(0, Math.min(a, before * 0.45));
    b = Math.max(0, Math.min(b, after * 0.45));

    const E: Vec3 = { x: p.x - f.din.x * a, y: p.y - f.din.y * a, z: zIn };
    const X: Vec3 = { x: p.x + f.dout.x * b, y: p.y + f.dout.y * b, z: zOut };
    turns.push({
      g,
      din,
      dout,
      // The local origin is where the build's own incoming run starts, which is
      // whichever end of the turn is LOWER — the run it was built from.
      at: { x: up ? E.x : X.x, y: up ? E.y : X.y, z: (zIn + zOut) / 2 },
      separation,
      trimIn: a,
      trimOut: b,
    });
    cuts.push({ s: cum[f.index], a, b, into: { p: E, dir: f.din }, outOf: { p: X, dir: f.dout } });
  }

  const runs: Vec3[][] = [];
  for (let j = 0; j <= cuts.length; j++) {
    const head = j > 0 ? cuts[j - 1].outOf : null;
    const tail = j < cuts.length ? cuts[j].into : null;
    const lo = j > 0 ? cuts[j - 1].s + cuts[j - 1].b : 0;
    const hi = j < cuts.length ? cuts[j].s - cuts[j].a : total;
    const lead = Math.max(1e-4, Math.min(lg.thickness * 0.5, (hi - lo) * 0.2));
    const run = runBetween(pts, cum, lo, hi, head, tail, lead);
    if (run.length >= 2) runs.push(run);
  }
  return { runs, turns };
}

/**
 * Concatenate several geometries into one.
 *
 * A lace is no longer a single sweep — it is a run, a turn, a run — and the
 * pieces have to arrive as ONE mesh, or picking would answer with whichever
 * piece the ray happened to hit and the weave tool's per-layer coat would come
 * apart. Vertices are not welded: the pieces already meet face to face, and
 * welding by distance would also fuse whatever else happened to touch.
 */
export function mergeGeometry(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 0) return new THREE.BufferGeometry();
  if (parts.length === 1) return parts[0];
  const pos: number[] = [];
  const idx: number[] = [];
  for (const g of parts) {
    const p = g.getAttribute('position');
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}
