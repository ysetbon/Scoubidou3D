// Three answers to one question: what is the lace DOING where it turns back on
// itself and changes storey?
//
// Nothing here shares code with the studio's fold (StrandScene.foldRungs,
// ribbon.ts). That is the point — the studio's answer was arrived at by
// correcting one shape seven times, and every correction assumed the shape
// before it. These three start from the joint and build outward, so they can be
// held against each other and against a real lace.
//
// THE THING THAT MAKES 180 HARD, stated once so all three can be judged on it:
//
// Call the angle between the two runs, measured at the joint between the rays
// they send out from it, the SEPARATION. At 180 the lace carries straight on and
// there is no turn at all. At 0 the outgoing run lies exactly on top of the
// incoming one and the turn is a dead fold-back.
//
// A dead fold-back is not badly conditioned — the crease is perfectly well
// defined, square to both runs, and the shear the studio computes goes cleanly
// to zero. What actually goes is ROOM. At separation 0 the two runs share one
// footprint in the drawing plane: everything that distinguishes them is height.
// Any construction that reaches "out of the turn" along an in-plane normal is
// reaching along the runs' own direction, out past the end of the lace, because
// in plan there is no outward left. That is why the studio's turn reads as a
// block stuck on the end rather than as part of the lace.
//
// So the useful question is not how to stabilise a normal. It is which of these
// three a lace actually does, none of which needs an in-plane outward at all.

import * as THREE from 'three';

export type Vec3 = { x: number; y: number; z: number };
export type Vec2 = { x: number; y: number };

export interface Gauge {
  /** Across the lace, world units. */
  width: number;
  /** Through the lace. */
  thickness: number;
  /** How far apart the two runs' centrelines sit in Z. */
  step: number;
  /** How much of the section's corner is rounded, 0..1. */
  round: number;
  /** How far back along each run the bend is allowed to start (SWEEP only). */
  reach: number;
  /** 0 a dead fold-back, 1 straight through. See `blend`. */
  k: number;
  /** How long the ramp gets at straight-through, world units. */
  ramp: number;
}

export type BandKind = 'bridge' | 'sweep' | 'cap';

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
 * How far the band travels in plan, AS A VECTOR — direction and distance in one,
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
function travel(din: Vec2, dout: Vec2): Vec2 {
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
function heading(din: Vec2, dout: Vec2): number {
  const a = norm(din);
  const b = norm(dout);
  return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
}

// ---- section ---------------------------------------------------------------

/** A rounded rectangle, walked once, in section coordinates: u across the
 *  width, v through the thickness. Same sampling for every builder, so the
 *  three can be lofted into one another without re-indexing. */
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
 * Stitch a list of equal-length rings into a closed solid.
 *
 * Every builder below produces rings and nothing else, so the winding, the
 * caps and the normals are decided in exactly one place. Rings must be walked
 * the same way round and ordered along the piece.
 */
export function tube(rings: Vec3[][]): THREE.BufferGeometry {
  const m = rings[0].length;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const ring of rings) for (const p of ring) pos.push(p.x, p.y, p.z);
  for (let i = 0; i < rings.length - 1; i++) {
    const a = i * m;
    const b = (i + 1) * m;
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      idx.push(a + j, b + j, b + j2);
      idx.push(a + j, b + j2, a + j2);
    }
  }
  // Flat caps, fanned from the first vertex of each end ring.
  const last = (rings.length - 1) * m;
  for (let j = 1; j < m - 1; j++) {
    idx.push(0, j + 1, j);
    idx.push(last, last + j, last + j + 1);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  return geom;
}

/** Place a section at `p`, lying across `side` with its thickness along +Z. */
function ring(p: Vec3, side: Vec2, sec: Vec2[]): Vec3[] {
  return sec.map((s) => ({
    x: p.x + side.x * s.x,
    y: p.y + side.y * s.x,
    z: p.z + s.y,
  }));
}

const perp = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x });
const norm = (d: Vec2): Vec2 => {
  const l = Math.hypot(d.x, d.y) || 1;
  return { x: d.x / l, y: d.y / l };
};

// ---- the runs --------------------------------------------------------------

/**
 * One straight run, from `len` back along `dir` up to the joint at height `z`.
 * Both runs stop AT the joint; what happens there is the band's business.
 */
export function run(dir: Vec2, len: number, z: number, g: Gauge): THREE.BufferGeometry {
  const d = norm(dir);
  const s = perp(d);
  const sec = section(g);
  const rings: Vec3[][] = [];
  for (const t of [len, 0]) {
    rings.push(ring({ x: -d.x * t, y: -d.y * t, z }, s, sec));
  }
  return tube(rings);
}

// ---- 1. BRIDGE -------------------------------------------------------------

/**
 * Loft straight from one run's end face to the other's.
 *
 * The two faces are the only things the turn is actually pinned by, so this
 * builder uses nothing else: no crease, no bisector, no outward normal. Rings
 * interpolate position, the axis they lie across, and height, so the surface
 * leaves each run exactly flush with it and twists between.
 *
 * At separation 0 the two faces are parallel and stacked, and the loft is a
 * clean vertical prism — the degenerate case is the EASY one here, which is the
 * opposite of how the studio's fold behaves. Its weakness is the other end: as
 * the separation opens toward 180 there is less and less to bridge, and the
 * loft becomes a short twisted collar that a real lace would not show.
 */
function bridge(din: Vec2, dout: Vec2, g: Gauge, steps = 14): THREE.BufferGeometry {
  const sec = section(g);
  const a = perp(norm(din));
  const a0 = Math.atan2(a.y, a.x);
  const turn = heading(din, dout);
  // Opened out, the loft stops climbing in place and travels along the axis
  // both runs agree on, so a straight-through lace gets a ramp rather than a
  // collar standing in it. The travel is a vector, not a direction times a
  // separate distance — see `travel`.
  const m = travel(din, dout);
  const spread = g.ramp * g.k;
  const rings: Vec3[][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = a0 + turn * t;
    const s = spread * (t - 0.5);
    rings.push(
      ring(
        { x: m.x * s, y: m.y * s, z: -g.step / 2 + g.step * t },
        { x: Math.cos(ang), y: Math.sin(ang) },
        sec,
      ),
    );
  }
  return tube(rings);
}

// ---- 2. SWEEP --------------------------------------------------------------

/**
 * Let the lace bend, and sweep it round the bend.
 *
 * The other two treat the joint as a place where something has to be inserted.
 * This one says there is nothing to insert: a lace bending back on itself is
 * one continuous piece, and the turn is just the part of it that is curved. The
 * centreline leaves the incoming run `reach` back from the joint, curves
 * through, and rejoins the outgoing run `reach` along — and the same section is
 * carried round it.
 *
 * At separation 0 the curve is a vertical semicircle: the lace goes up and over,
 * which is what it does in the hand. Nothing is degenerate, because the bend
 * happens in the vertical plane the two runs share and that plane is perfectly
 * well defined however close together they lie.
 *
 * Its cost is that it MOVES THE RUNS: the last `reach` of each is no longer
 * straight, so the turn is not a thing you can switch on and off without the
 * runs noticing. Everything else here leaves them alone.
 */
function sweep(din: Vec2, dout: Vec2, g: Gauge, steps = 28): THREE.BufferGeometry {
  const di = norm(din);
  const dO = norm(dout);
  // The handles lengthen as the runs open out. Tangency is what keeps the joint
  // invisible, so the ramp is drawn out by reaching FURTHER along each run
  // rather than by moving the handles off them.
  const r = Math.max(g.reach * (1 + g.k * 2), 1e-3);
  const zi = -g.step / 2;
  const zo = g.step / 2;
  // A cubic Bezier from run to run: the handles run along each run's own
  // heading, so the curve leaves and arrives tangent and the joint disappears.
  const p0 = { x: -di.x * r, y: -di.y * r, z: zi };
  const p1 = { x: 0, y: 0, z: zi };
  const p2 = { x: 0, y: 0, z: zo };
  const p3 = { x: dO.x * r, y: dO.y * r, z: zo };
  const at = (t: number): Vec3 => {
    const u = 1 - t;
    const k0 = u * u * u;
    const k1 = 3 * u * u * t;
    const k2 = 3 * u * t * t;
    const k3 = t * t * t;
    return {
      x: k0 * p0.x + k1 * p1.x + k2 * p2.x + k3 * p3.x,
      y: k0 * p0.y + k1 * p1.y + k2 * p2.y + k3 * p3.y,
      z: k0 * p0.z + k1 * p1.z + k2 * p2.z + k3 * p3.z,
    };
  };
  const sec = section(g);
  const rings: Vec3[][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = at(t);
    const q = at(Math.min(1, t + 1e-3));
    const back = at(Math.max(0, t - 1e-3));
    // The heading's SHADOW in the drawing plane sets the width axis, so the
    // lace keeps its face up and never rolls about its own centreline. Where
    // the shadow vanishes — the top of a dead fold-back, where the lace is
    // travelling straight up — the previous axis is held instead.
    let d: Vec2 = { x: q.x - back.x, y: q.y - back.y };
    if (Math.hypot(d.x, d.y) < 1e-6) d = i > 0 ? lastDir : di;
    lastDir = norm(d);
    rings.push(ring(p, perp(lastDir), sec));
  }
  return tube(rings);
}
let lastDir: Vec2 = { x: 1, y: 0 };

// ---- 3. CAP ----------------------------------------------------------------

/**
 * Stand a piece of lace on end between the two run ends.
 *
 * This is the studio's idea, rebuilt from the joint rather than corrected into
 * shape: a short column whose axis is Z, spanning the storey step, with the
 * lace's own section. Its width axis is the BISECTOR of the two runs' width
 * axes, so it meets both squarely rather than favouring either.
 *
 * It needs no in-plane outward, which is the trap the studio's version fell
 * into — and so it survives separation 0, where the column is simply a stub
 * joining two runs that sit one above the other. It reaches past the runs at
 * neither end. What it does not do is look like bending: it is honestly a
 * joint, and at wide separations the column reads as a peg rather than a turn.
 */
function cap(din: Vec2, dout: Vec2, g: Gauge, steps = 8): THREE.BufferGeometry {
  // Half the heading turn, applied to the incoming width axis: the bisector,
  // reached by rotating rather than by adding two axes that cancel. Adding them
  // needs a fallback exactly where the answer matters most, and the fallback is
  // a jump; rotating is continuous everywhere.
  const a = perp(norm(din));
  const half = heading(din, dout) / 2;
  const ca = Math.cos(half);
  const sa = Math.sin(half);
  const s: Vec2 = { x: a.x * ca - a.y * sa, y: a.x * sa + a.y * ca };
  // The column's section lies in the drawing plane, so its "thickness" runs
  // along Z and its length is the step. Swap the two and stand it up.
  const stood: Gauge = { ...g, thickness: g.width, width: g.thickness };
  const sec = section(stood).map((p) => ({ x: p.y, y: p.x }));
  // Opened out, the column lies down along the runs' shared axis rather than
  // standing across them: a stub that stays upright in a straight lace is the
  // peg this blend exists to remove.
  const m = travel(din, dout);
  const spread = g.ramp * g.k;
  const rings: Vec3[][] = [];
  const hz = g.step / 2 + g.thickness / 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const z = -hz + hz * 2 * t;
    const d = spread * (t - 0.5);
    rings.push(ring({ x: m.x * d, y: m.y * d, z }, s, sec));
  }
  return tube(rings);
}

// ---- pick ------------------------------------------------------------------

export function band(kind: BandKind, din: Vec2, dout: Vec2, g: Gauge): THREE.BufferGeometry {
  if (kind === 'bridge') return bridge(din, dout, g);
  if (kind === 'sweep') return sweep(din, dout, g);
  return cap(din, dout, g);
}

/** How far the runs must be cut back for this band to meet them, if at all. */
export function runTrim(kind: BandKind, g: Gauge): number {
  return kind === 'sweep' ? Math.max(g.reach * (1 + g.k * 2), 1e-3) : 0;
}
