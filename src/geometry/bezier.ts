// Faithful port of OpenStrand Studio's centerline math (strand.py
// _build_curve_profile, and AttachedStrand.get_path for strands that hang off
// another one).
//
// A strand is not a naive cubic through its two control points — OSS derives an
// eased two-segment curve so the ribbon bulges smoothly toward the control
// handles. We reproduce that here, then sample it into a polyline (+ tangents)
// that the 3D ribbon builder sweeps a cross-section along. Getting this right is
// what makes an imported OSS/OpenStrandJS file look the same in 3D as it does in
// the original top-down editor.
//
// Three inputs decide the shape besides the points, and all three used to be
// fixed here at values OSS never draws with — see docs/control-points.md, "The
// curve itself":
//
//   * the curve tuning (`CURVE`) — the canvas settings OSS pushes onto every strand
//     it creates or loads;
//   * which class drew the strand — an AttachedStrand eases its THREE-point curve
//     with a formula of its own;
//   * the per-strand curvature bias, when the file carries one.

import { Vec2, vadd, vsub, vmul, vdist } from './vec';

export interface Cubic {
  p0: Vec2;
  cp1: Vec2;
  cp2: Vec2;
  p3: Vec2;
}

export interface Profile {
  mode: 'line' | 'multi';
  segments: Cubic[];
}

/** OSS's three curve settings ("Control point influence", "Distance boost",
 *  "Curve response" in the settings dialog). */
export interface CurveParams {
  base_fraction: number;
  dist_multiplier: number;
  exponent: number;
}

/**
 * The tuning OSS actually draws with: `load_user_settings` (main.py) defaults,
 * also what the shipped user_settings.txt says. The canvas pushes these onto
 * every strand it creates or loads (save_load_manager.py: "Apply current canvas
 * curve settings to loaded strands"), so they are the shape of every OSS file
 * opened in a default install. The `0.4 / 1.2 / 1.5` written in Strand.__init__
 * never survives to a draw, and the `0.5 / 1.0 / 1.0` this port used to carry
 * is not anywhere in OSS — it pulled every bend about four times flatter than
 * the desktop app draws it.
 */
export const CURVE: Readonly<CurveParams> = { base_fraction: 1.0, dist_multiplier: 2.0, exponent: 2.0 };

/** OSS CurvatureBiasControl: how hard each half of the curve leans on its
 *  handle, 0..1 with 0.5 neutral. */
export interface CurveBias {
  triangle: number;
  circle: number;
}

export interface StrandCurveInput {
  start: Vec2;
  end: Vec2;
  control_points?: [Vec2, Vec2];
  control_point_center?: Vec2 | null;
  control_point_center_locked?: boolean;
  /** Drawn by OSS's AttachedStrand (it hangs off another strand). Only the
   *  locked-centre curve differs between the two classes. */
  attached?: boolean;
  /** Per-strand curvature bias; absent means neutral (0.5 / 0.5). */
  bias?: CurveBias | null;
  /** Curve tuning; absent means OSS's shipped defaults. */
  curve?: CurveParams;
}

/** OSS's normalize_vector: anything under 0.001 long has no direction. */
function unit(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  return len < 0.001 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

/** OSS's curve-response shaping. */
function respond(frac: number, exponent: number): number {
  return exponent !== 1.0 ? Math.pow(frac, 1 / exponent) : frac;
}

/**
 * The two eased cubics through p0 → p2 → p4 that every OSS curve is built from.
 * p1 and p3 are the handles (triangle and circle), p2 the waist the curve passes
 * through. `frac1` scales the pull of the triangle at the start, `frac2` the
 * pull at the waist and at the end.
 */
function twoSegments(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  p4: Vec2,
  frac1: number,
  frac2: number,
  bias: CurveBias,
  normalizeTangent: boolean,
): Profile {
  const in_norm = unit(vsub(p2, p1));
  const out_norm = unit(vsub(p3, p2));
  let center_tangent = { x: (in_norm.x + out_norm.x) * 0.5, y: (in_norm.y + out_norm.y) * 0.5 };
  if (normalizeTangent) center_tangent = unit(center_tangent);
  const dist2 = vdist(p2, p1);
  const dist3 = vdist(p3, p2);
  const bt = 0.5 + bias.triangle;
  const bc = 0.5 + bias.circle;
  const cp1 = vadd(p0, vmul(vsub(p1, p0), frac1 * bt));
  const cp2 = vsub(p2, vmul(center_tangent, dist2 * frac2 * bt));
  const cp3 = vadd(p2, vmul(center_tangent, dist3 * frac2 * bc));
  const cp4 = vadd(p4, vmul(vsub(p3, p4), frac2 * bc));
  return {
    mode: 'multi',
    segments: [
      { p0, cp1, cp2, p3: p2 },
      { p0: p2, cp1: cp3, cp2: cp4, p3: p4 },
    ],
  };
}

const NEUTRAL: CurveBias = { triangle: 0.5, circle: 0.5 };

/** Build the eased curve profile (world coords), matching OSS's own path. */
export function buildProfile(s: StrandCurveInput): Profile {
  const start = s.start;
  const end = s.end;
  const cps = s.control_points || [start, end];
  const control_point1 = cps[0] || start;
  const control_point2 = cps[1] || end;
  const { base_fraction, dist_multiplier, exponent } = s.curve ?? CURVE;
  const bias = s.bias ?? NEUTRAL;

  // Callers hand the centre over only while the third control point is enabled
  // (OSS: `third_locked = third_enabled and ...locked`).
  const center = s.control_point_center_locked ? s.control_point_center : null;
  if (center) {
    if (s.attached) {
      // AttachedStrand.get_path: ONE fraction for both halves, hard-capped
      // before the response curve, and the waist tangent re-normalised.
      let fraction = Math.min(0.1 + base_fraction * 0.13, 3.77);
      fraction = respond(Math.min(fraction * dist_multiplier, 0.49), exponent);
      return twoSegments(start, control_point1, center, control_point2, end, fraction, fraction, bias, true);
    }
    // Strand._build_curve_profile, locked-centre branch.
    const frac1 = respond(Math.min(Math.min(0.1 + base_fraction * 0.3, 8.33) * dist_multiplier, 8.33), exponent);
    const frac2 = respond(Math.min(Math.min(0.05 + base_fraction * 0.15, 3.77) * dist_multiplier, 8.33), exponent);
    return twoSegments(start, control_point1, center, control_point2, end, frac1, frac2, bias, false);
  }

  const cp1_at_start = Math.abs(control_point1.x - start.x) < 1.0 && Math.abs(control_point1.y - start.y) < 1.0;
  const cp2_at_start = Math.abs(control_point2.x - start.x) < 1.0 && Math.abs(control_point2.y - start.y) < 1.0;
  if (cp1_at_start && cp2_at_start) return { mode: 'line', segments: [] };

  // Two handles: a virtual centre at their midpoint, the same in both classes.
  const mid = { x: (control_point1.x + control_point2.x) / 2, y: (control_point1.y + control_point2.y) / 2 };
  const frac1 = respond(Math.min(Math.min(0.1 + base_fraction * 0.2, 2.34) * dist_multiplier, 8.33), exponent);
  const frac2 = respond(Math.min(Math.min(0.05 + base_fraction * 0.1, 1.17) * dist_multiplier, 8.33), exponent);
  return twoSegments(start, control_point1, mid, control_point2, end, frac1, frac2, bias, false);
}

function cubicAt(c: Cubic, t: number): Vec2 {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const d = 3 * mt * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.cp1.x + d * c.cp2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.cp1.y + d * c.cp2.y + e * c.p3.y,
  };
}

/**
 * Sample a strand's centerline into a polyline of world-space points.
 * `stepsPerSegment` controls smoothness (more = smoother curves).
 */
export function sampleCenterline(s: StrandCurveInput, stepsPerSegment = 24): Vec2[] {
  const prof = buildProfile(s);
  if (prof.mode === 'line') {
    return [s.start, s.end];
  }
  const pts: Vec2[] = [];
  for (const seg of prof.segments) {
    for (let i = 0; i <= stepsPerSegment; i++) {
      const t = i / stepsPerSegment;
      const p = cubicAt(seg, t);
      // Skip duplicate joints between consecutive segments.
      const last = pts[pts.length - 1];
      if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
      pts.push(p);
    }
  }
  return pts;
}
