// Faithful port of OpenStrand Studio's centerline math (strand.py
// _build_curve_profile, mirrored in OpenStrandJS strand-renderer.js buildProfile).
//
// A strand is not a naive cubic through its two control points — OSS derives an
// eased two-segment curve so the ribbon bulges smoothly toward the control
// handles. We reproduce that here, then sample it into a polyline (+ tangents)
// that the 3D ribbon builder sweeps a cross-section along. Getting this right is
// what makes an imported OSS/OpenStrandJS file look the same in 3D as it does in
// the original top-down editor.

import { Vec2, vadd, vsub, vmul, vnorm, vdist } from './vec';

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

// OSS default curve tuning (settings.curve_params). Exposed so the eased shape
// matches the desktop defaults; unlikely to need changing for the 3D view.
export const CURVE = { base_fraction: 0.5, dist_multiplier: 1.0, exponent: 1.0 };

export interface StrandCurveInput {
  start: Vec2;
  end: Vec2;
  control_points?: [Vec2, Vec2];
  control_point_center?: Vec2 | null;
  control_point_center_locked?: boolean;
}

/** Build the eased curve profile (world coords), matching OSS buildProfile. */
export function buildProfile(s: StrandCurveInput): Profile {
  const start = s.start;
  const end = s.end;
  const cps = s.control_points || [start, end];
  const control_point1 = cps[0] || start;
  const control_point2 = cps[1] || end;
  const { base_fraction, dist_multiplier, exponent } = CURVE;
  const bias_triangle = 0.5;
  const bias_circle = 0.5;

  const enableThird = s.control_point_center != null;
  const thirdLocked = enableThird && s.control_point_center_locked && s.control_point_center;

  if (thirdLocked && s.control_point_center) {
    const p0 = start;
    const p1 = control_point1;
    const p2 = s.control_point_center;
    const p3 = control_point2;
    const p4 = end;
    const in_norm = vnorm(vsub(p2, p1));
    const out_norm = vnorm(vsub(p3, p2));
    const center_tangent = { x: (in_norm.x + out_norm.x) * 0.5, y: (in_norm.y + out_norm.y) * 0.5 };
    const dist2 = vdist(p2, p1);
    const dist3 = vdist(p3, p2);
    let frac1 = Math.min(0.1 + base_fraction * 0.3, 8.33);
    let frac2 = Math.min(0.05 + base_fraction * 0.15, 3.77);
    frac1 = Math.min(frac1 * dist_multiplier, 8.33);
    frac2 = Math.min(frac2 * dist_multiplier, 8.33);
    if (exponent !== 1.0) {
      frac1 = Math.pow(frac1, 1 / exponent);
      frac2 = Math.pow(frac2, 1 / exponent);
    }
    const cp1 = vadd(p0, vmul(vsub(p1, p0), frac1 * (0.5 + bias_triangle)));
    const cp2 = vsub(p2, vmul(center_tangent, dist2 * frac2 * (0.5 + bias_triangle)));
    const cp3 = vadd(p2, vmul(center_tangent, dist3 * frac2 * (0.5 + bias_circle)));
    const cp4 = vadd(p4, vmul(vsub(p3, p4), frac2 * (0.5 + bias_circle)));
    return {
      mode: 'multi',
      segments: [
        { p0, cp1, cp2, p3: p2 },
        { p0: p2, cp1: cp3, cp2: cp4, p3: p4 },
      ],
    };
  }

  const cp1_at_start = Math.abs(control_point1.x - start.x) < 1.0 && Math.abs(control_point1.y - start.y) < 1.0;
  const cp2_at_start = Math.abs(control_point2.x - start.x) < 1.0 && Math.abs(control_point2.y - start.y) < 1.0;
  if (cp1_at_start && cp2_at_start) return { mode: 'line', segments: [] };

  const p0 = start;
  const p1 = control_point1;
  const p2 = { x: (control_point1.x + control_point2.x) / 2, y: (control_point1.y + control_point2.y) / 2 };
  const p3 = control_point2;
  const p4 = end;
  const in_norm = vnorm(vsub(p2, p1));
  const out_norm = vnorm(vsub(p3, p2));
  const center_tangent = { x: (in_norm.x + out_norm.x) * 0.5, y: (in_norm.y + out_norm.y) * 0.5 };
  const dist2 = vdist(p2, p1);
  const dist3 = vdist(p3, p2);
  let frac1 = Math.min(Math.min(0.1 + base_fraction * 0.2, 2.34) * dist_multiplier, 8.33);
  let frac2 = Math.min(Math.min(0.05 + base_fraction * 0.1, 1.17) * dist_multiplier, 8.33);
  if (exponent !== 1.0) {
    frac1 = Math.pow(frac1, 1 / exponent);
    frac2 = Math.pow(frac2, 1 / exponent);
  }
  const cp1 = vadd(p0, vmul(vsub(p1, p0), frac1 * (0.5 + bias_triangle)));
  const cp2 = vsub(p2, vmul(center_tangent, dist2 * frac2 * (0.5 + bias_triangle)));
  const cp3 = vadd(p2, vmul(center_tangent, dist3 * frac2 * (0.5 + bias_circle)));
  const cp4 = vadd(p4, vmul(vsub(p3, p4), frac2 * (0.5 + bias_circle)));
  return {
    mode: 'multi',
    segments: [
      { p0, cp1, cp2, p3: p2 },
      { p0: p2, cp1: cp3, cp2: cp4, p3: p4 },
    ],
  };
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
