// Three answers to one question: what is the lace DOING where it turns back on
// itself and changes storey?
//
// The FOLD — the answer that won — now lives in `src/geometry/fold.ts`, because
// the studio builds its turns with it too and a second copy would drift. What is
// left here is the other two, kept so the winner can still be held against them:
// the loft between the two run faces, and the stub stood on end between them.
//
// The separation, and why 180 is hard, is stated once at the top of
// `src/geometry/fold.ts`; everything below assumes it.

import * as THREE from 'three';
import {
  Gauge,
  heading,
  norm,
  perp,
  ring,
  section,
  travel,
  tube,
  turn,
} from '../geometry/fold';
import { Vec2, Vec3 } from '../geometry/vec';

export type { Gauge, Vec2, Vec3 };
export { blend, section, tube } from '../geometry/fold';

export type BandKind = 'bridge' | 'sweep' | 'cap';

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
 * opposite of how a swept turn behaves. Its weakness is the other end: as the
 * separation opens toward 180 there is less and less to bridge, and the loft
 * becomes a short twisted collar that a real lace would not show.
 */
function bridge(din: Vec2, dout: Vec2, g: Gauge, steps = 14): THREE.BufferGeometry {
  const sec = section(g);
  const a = perp(norm(din));
  const a0 = Math.atan2(a.y, a.x);
  const swing = heading(din, dout);
  // Opened out, the loft stops climbing in place and travels along the axis
  // both runs agree on, so a straight-through lace gets a ramp rather than a
  // collar standing in it. The travel is a vector, not a direction times a
  // separate distance — see `travel`.
  const m = travel(din, dout);
  const spread = g.ramp * g.k;
  const rings: Vec3[][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = a0 + swing * t;
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

// ---- 3. CAP ----------------------------------------------------------------

/**
 * Stand a piece of lace on end between the two run ends.
 *
 * A short column whose axis is Z, spanning the storey step, with the lace's own
 * section. Its width axis is the BISECTOR of the two runs' width axes, so it
 * meets both squarely rather than favouring either.
 *
 * It needs no in-plane outward, which is the trap a turn built on one falls
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
  const t = turn(din, dout, g, section(g));
  return { geom: tube(t.rings), shiftOut: t.slide };
}
