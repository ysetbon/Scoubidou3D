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

// ---- 2. FOLD ---------------------------------------------------------------

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
 * up the difference, so the surface buckles: the pinch, the collapsed waist and
 * the bulky lump that came with it.
 *
 * What a strip actually does is fold about an OBLIQUE CREASE and roll over. The
 * crease bisects the two headings, and wrapping the strip a half turn about a
 * cylinder whose axis is that crease sends the incoming heading onto the
 * outgoing one exactly — the component along the crease is kept, the component
 * across it reverses:
 *
 *     sep      0     20     40     90    150
 *     crease  90°    80°    70°    45°    15°
 *     error    0      0      0      0      0     (to nine places)
 *
 * The surface is then developable, which is the whole point: it is the strip's
 * own plane rolled onto a cylinder, so nothing stretches, nothing pinches, and
 * width and thickness are carried through untouched. The outer face of the bend
 * gets radius R + t/2 and the inner R - t/2 for free, and the two layers come
 * out a full 2R apart, which is the slot that makes it read as one strip looped
 * rather than two bars joined.
 *
 * R is half the storey step, so the fold delivers the climb by itself.
 *
 * The one thing it cannot do is a lace that carries straight on. There the
 * crease lies ALONG the strip, and a strip creased along its own length does
 * not fold — it just is not a fold any more. The slide along the crease says so
 * by diverging (R·π·tan(sep/2), which is 1.1 R at forty degrees and 11.7 R at a
 * hundred and fifty), so it is capped, and the blend has handed over to the
 * ramp long before it matters.
 */
function fold(din: Vec2, dout: Vec2, g: Gauge, steps = 40): { rings: Vec3[][]; slide: Vec3 } {
  const a = norm(din);
  const b = norm(dout);
  // The crease: the bisector of the two headings. Where they are antiparallel —
  // a dead fold-back — the sum vanishes and the crease is square to the run,
  // which is the limit the sum approaches anyway.
  const sum = { x: a.x + b.x, y: a.y + b.y };
  const c = Math.hypot(sum.x, sum.y) < 1e-9 ? perp(a) : norm(sum);
  let n = perp(c);
  const du = a.x * c.x + a.y * c.y;
  let dv = a.x * n.x + a.y * n.y;
  // `n` points the way the strip travels into the wrap; flip it if it does not.
  if (dv < 0) {
    n = { x: -n.x, y: -n.y };
    dv = -dv;
  }

  const R = Math.max(g.step / 2, g.thickness * 0.25);
  // How far the wrap slides along the crease. An oblique fold displaces the
  // strip sideways, and the more oblique the further — without bound as the
  // crease swings onto the strip's own length, which is where it stops being a
  // fold at all. Capped so a nearly-straight lace cannot throw the run to
  // infinity while the blend is still handing over.
  const slideEnd = Math.min(dv < 1e-4 ? Infinity : (Math.PI * R * du) / dv, g.ramp * 4);

  const sec = section(g);
  const rings: Vec3[][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = Math.PI * t; // round the cylinder, tangent plane to tangent plane
    const u = slideEnd * t;
    const sin = Math.sin(ang);
    const cos = Math.cos(ang);
    // On the cylinder: along the crease by u, out by R at this angle.
    const p: Vec3 = { x: c.x * u + n.x * R * sin, y: c.y * u + n.y * R * sin, z: -R * cos };
    // Radial. The section's thickness rides it, so the strip's faces stay
    // parallel to the cylinder and the fold shows its other side coming out.
    const rad: Vec3 = { x: n.x * sin, y: n.y * sin, z: -cos };
    // The unrolled straight line, rolled: constant along the crease, turning
    // with the wrap across it.
    const tan = norm3({
      x: c.x * (slideEnd / (Math.PI * R)) + n.x * cos,
      y: c.y * (slideEnd / (Math.PI * R)) + n.y * cos,
      z: sin,
    });
    const up = { x: -rad.x, y: -rad.y, z: -rad.z };
    const side = norm3(cross3(up, tan));
    rings.push(ring3(p, side, up, sec));
  }
  return { rings, slide: { x: c.x * slideEnd, y: c.y * slideEnd, z: 0 } };
}

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

/**
 * A band, and where it leaves the two runs.
 *
 * `shiftOut` is not decoration: an oblique fold DISPLACES the strip along its
 * crease, so the run coming away starts to one side of the one going in. Only
 * the fold moves anything; the other two meet the runs where they already are.
 */
export function band(
  kind: BandKind,
  din: Vec2,
  dout: Vec2,
  g: Gauge,
): { geom: THREE.BufferGeometry; shiftOut: Vec3 } {
  const none = { x: 0, y: 0, z: 0 };
  if (kind === 'bridge') return { geom: bridge(din, dout, g), shiftOut: none };
  if (kind === 'cap') return { geom: cap(din, dout, g), shiftOut: none };
  const f = fold(din, dout, g);
  return { geom: tube(f.rings), shiftOut: f.slide };
}
