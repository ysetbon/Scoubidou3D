// Turns a strand centerline into a solid 3D ribbon.
//
// The core idea of Scoubidou3D: a strand in OpenStrand Studio already has a
// WIDTH (it is drawn as a fat stroke). We add a second dimension — THICKNESS —
// and sweep a rectangular cross-section (width across, thickness up) along the
// centerline. The result is a flat plastic-lacing-style ribbon (think the gimp
// lanyards) that we can then stack in Z and view from any angle.
//
// The sweep uses a FIXED frame: "side" is the in-plane normal of the centerline
// and "up" is world +Z. Because the flat face always points toward +Z, the
// ribbon reads exactly like the original top-down editor when viewed straight
// down — even once the WEAVE lifts and drops the centerline in Z at crossings
// (weave.ts). The centerline is a Vec3 polyline: (x, y) is the drawing-plane
// position and z is the height the weave gives that point.

import * as THREE from 'three';
import { Vec2, Vec3 } from './vec';

export interface RibbonOptions {
  width: number; // across the ribbon (the OSS strand width), world units
  thickness: number; // out-of-plane depth, world units
  cornerRadius: number; // rounds the long edges of the cross-section
  cornerSteps: number; // segments used to round each corner
  roundCaps: boolean; // add rounded end caps (like the circular strand ends in OSS)
  /**
   * Per-end override of `roundCaps`. An end that is GLUED to another strand must
   * not grow a dome: the dome bulges out past the joint and reads as a lump
   * sticking through the lace. The flat cap still seals the tube, hidden inside
   * the connector that bridges the joint (connector.ts).
   */
  capStart?: boolean;
  capEnd?: boolean;
  /**
   * Leave an end completely open — no dome and no flat cap. Used for the OUTLINE
   * shell at a glued end: two laces meeting end to end would otherwise present
   * two coincident outline caps to each other, which read as a black plate across
   * the joint. Left open, the outline shells form one continuous sleeve.
   */
  openStart?: boolean;
  openEnd?: boolean;
}

// A cross-section is a closed loop of {u, v} points in the local (side, up)
// frame. u runs across the width, v runs through the thickness. Shared with the
// attach connector (connector.ts) so a bridge's rings match the ribbon's.
export function crossSection(width: number, thickness: number, radius: number, cornerSteps: number): Vec2[] {
  const hw = width / 2;
  const ht = thickness / 2;
  const r = Math.max(0, Math.min(radius, hw, ht));
  if (r < 1e-6) {
    // Sharp rectangle.
    return [
      { x: -hw, y: -ht },
      { x: hw, y: -ht },
      { x: hw, y: ht },
      { x: -hw, y: ht },
    ];
  }
  const pts: Vec2[] = [];
  // Four rounded corners, walked counter-clockwise. Each corner arc is centered
  // on the inset corner point.
  const corners = [
    { cx: hw - r, cy: -ht + r, a0: -Math.PI / 2, a1: 0 }, // bottom-right
    { cx: hw - r, cy: ht - r, a0: 0, a1: Math.PI / 2 }, // top-right
    { cx: -hw + r, cy: ht - r, a0: Math.PI / 2, a1: Math.PI }, // top-left
    { cx: -hw + r, cy: -ht + r, a0: Math.PI, a1: (3 * Math.PI) / 2 }, // bottom-left
  ];
  for (const c of corners) {
    for (let i = 0; i <= cornerSteps; i++) {
      const a = c.a0 + ((c.a1 - c.a0) * i) / cornerSteps;
      pts.push({ x: c.cx + r * Math.cos(a), y: c.cy + r * Math.sin(a) });
    }
  }
  return pts;
}

// ---- 3D frame ---------------------------------------------------------------
// A lace mostly lies flat, and while it does, "up" is world +Z and "across" is the
// in-plane perpendicular. But a lace folding back on itself turns in DEPTH — it
// rides up over its own outgoing run — and there the centreline briefly points at
// the sky, where a fixed +Z gives no usable frame at all.
//
// So the frame is carried along the curve instead of recomputed from scratch:
// each step reflects the previous frame onto the new tangent (the double
// reflection method), which rotates it as little as the curve demands. On a flat
// centreline that reproduces up = +Z exactly, so ordinary strands are unchanged.

const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
function norm3(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z);
  return l < 1e-12 ? { x: 1, y: 0, z: 0 } : { x: v.x / l, y: v.y / l, z: v.z / l };
}

function tangentsOf(points: Vec3[]): Vec3[] {
  const n = points.length;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    let d = sub3(b, a);
    if (Math.hypot(d.x, d.y, d.z) < 1e-9 && i > 0) d = sub3(points[i], points[i - 1]);
    if (Math.hypot(d.x, d.y, d.z) < 1e-9) {
      out.push(out.length ? { ...out[out.length - 1] } : { x: 1, y: 0, z: 0 });
      continue;
    }
    out.push(norm3(d));
  }
  return out;
}

export interface Frame {
  side: Vec3; // across the ribbon's width
  up: Vec3; // through its thickness
}

function framesOf(points: Vec3[], tangents: Vec3[]): Frame[] {
  const n = points.length;
  // Seed with world +Z made perpendicular to the first tangent, so a flat strand
  // comes out exactly as before. If it starts vertical, any perpendicular will do.
  const t0 = tangents[0];
  let up: Vec3 = { x: -t0.z * t0.x, y: -t0.z * t0.y, z: 1 - t0.z * t0.z };
  if (Math.hypot(up.x, up.y, up.z) < 1e-6) up = norm3(cross3(t0, { x: 0, y: 1, z: 0 }));
  else up = norm3(up);

  const frames: Frame[] = [{ side: norm3(cross3(up, t0)), up }];
  for (let i = 0; i < n - 1; i++) {
    const v1 = sub3(points[i + 1], points[i]);
    const c1 = dot3(v1, v1);
    let u = frames[i].up;
    let tL = tangents[i];
    if (c1 > 1e-18) {
      const k1 = (2 / c1) * dot3(v1, u);
      u = { x: u.x - k1 * v1.x, y: u.y - k1 * v1.y, z: u.z - k1 * v1.z };
      const k2 = (2 / c1) * dot3(v1, tL);
      tL = { x: tL.x - k2 * v1.x, y: tL.y - k2 * v1.y, z: tL.z - k2 * v1.z };
    }
    const v2 = sub3(tangents[i + 1], tL);
    const c2 = dot3(v2, v2);
    if (c2 > 1e-18) {
      const k3 = (2 / c2) * dot3(v2, u);
      u = { x: u.x - k3 * v2.x, y: u.y - k3 * v2.y, z: u.z - k3 * v2.z };
    }
    const t = tangents[i + 1];
    // Re-orthogonalise so rounding can't let the frame drift off the tangent.
    const uu = norm3(sub3(u, { x: t.x * dot3(u, t), y: t.y * dot3(u, t), z: t.z * dot3(u, t) }));
    frames.push({ side: norm3(cross3(uu, t)), up: uu });
  }
  return frames;
}

/**
 * Build a ribbon BufferGeometry from a centerline polyline. Each point carries
 * its own z (the weave height), so the ribbon can rise and dip along its length.
 */
export function buildRibbonGeometry(centerline: Vec3[], opts: RibbonOptions): THREE.BufferGeometry {
  // Drop consecutive duplicates (in XY — a pure-Z step is still a real step) so
  // tangents are well-defined.
  const pts: Vec3[] = [];
  for (const p of centerline) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-6 || Math.abs(last.z - p.z) > 1e-6) pts.push(p);
  }
  if (pts.length < 2) {
    return new THREE.BufferGeometry();
  }

  const section = crossSection(opts.width, opts.thickness, opts.cornerRadius, opts.cornerSteps);
  const m = section.length; // vertices per ring
  const tangents = tangentsOf(pts);
  const frames = framesOf(pts, tangents);

  const positions: number[] = [];
  const rings: number[][] = []; // index bookkeeping per ring

  // One ring of vertices per centerline sample.
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const { side, up } = frames[i];
    const ringIdx: number[] = [];
    for (let j = 0; j < m; j++) {
      const u = section[j].x; // across width -> along side
      const v = section[j].y; // through thickness -> along up
      ringIdx.push(positions.length / 3);
      positions.push(p.x + side.x * u + up.x * v, p.y + side.y * u + up.y * v, p.z + side.z * u + up.z * v);
    }
    rings.push(ringIdx);
  }

  const indices: number[] = [];
  // Stitch consecutive rings into a tube.
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      const v00 = a[j];
      const v01 = a[j2];
      const v10 = b[j];
      const v11 = b[j2];
      // Wound so face normals point OUTWARD (radially away from the centerline).
      // This matches Three's front-face convention, so MeshStandard lights the
      // outside and the BackSide outline shell reads as a silhouette rim.
      indices.push(v00, v11, v10);
      indices.push(v00, v01, v11);
    }
  }

  // End caps: fan-triangulate the first and last cross-section rings so the tube
  // is a closed solid. (Flat caps; `roundCaps` adds dome geometry below.)
  const capFan = (ring: number[], reverse: boolean) => {
    const c = ring[0];
    for (let j = 1; j < m - 1; j++) {
      if (reverse) indices.push(c, ring[j + 1], ring[j]);
      else indices.push(c, ring[j], ring[j + 1]);
    }
  };
  if (!opts.openStart) capFan(rings[0], false); // start cap faces back (-tangent)
  if (!opts.openEnd) capFan(rings[rings.length - 1], true); // end cap faces forward

  if (!opts.openStart && (opts.capStart ?? opts.roundCaps)) {
    addDomeCap(positions, indices, pts[0], tangents[0], frames[0], section, opts, true);
  }
  if (!opts.openEnd && (opts.capEnd ?? opts.roundCaps)) {
    const last = pts.length - 1;
    addDomeCap(positions, indices, pts[last], tangents[last], frames[last], section, opts, false);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

// A hemispherical-ish dome that closes an end with a rounded bulge, echoing the
// round end-circles OSS draws. Cheap: a few rings shrunk toward a tip pushed out
// along the tangent by half the width.
function addDomeCap(
  positions: number[],
  indices: number[],
  center: Vec3,
  tangent: Vec3,
  frame: Frame,
  section: Vec2[],
  opts: RibbonOptions,
  atStart: boolean,
): void {
  const m = section.length;
  const dir = atStart ? -1 : 1; // push outward from the strand body
  const { side, up } = frame;
  const tx = tangent.x * dir;
  const ty = tangent.y * dir;
  const tz = tangent.z * dir;
  const reach = opts.width / 2;
  const domeRings = 4;

  // Build shrinking rings from the end cross-section toward a tip. The dome sits
  // over the flat end cap (which already seals the tube), adding a rounded bulge.
  let lastRing: number[] | null = null;
  for (let k = 1; k <= domeRings; k++) {
    const f = k / domeRings; // 0..1
    const scale = Math.cos((f * Math.PI) / 2); // 1 -> 0
    const push = Math.sin((f * Math.PI) / 2) * reach; // 0 -> reach
    const ring: number[] = [];
    for (let j = 0; j < m; j++) {
      const u = section[j].x * scale;
      const v = section[j].y * scale;
      ring.push(positions.length / 3);
      positions.push(
        center.x + side.x * u + up.x * v + tx * push,
        center.y + side.y * u + up.y * v + ty * push,
        center.z + side.z * u + up.z * v + tz * push,
      );
    }
    if (lastRing) {
      for (let j = 0; j < m; j++) {
        const j2 = (j + 1) % m;
        // Outward winding (consistent with the flipped tube body above).
        if (atStart) {
          indices.push(lastRing[j], ring[j2], ring[j]);
          indices.push(lastRing[j], lastRing[j2], ring[j2]);
        } else {
          indices.push(lastRing[j], ring[j], ring[j2]);
          indices.push(lastRing[j], ring[j2], lastRing[j2]);
        }
      }
    }
    lastRing = ring;
  }
}
