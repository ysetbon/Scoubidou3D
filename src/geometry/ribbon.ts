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

// Central-difference tangents along the polyline (world XY, z ignored — the
// flat face stays pointed at +Z, so only the in-plane heading matters).
function tangentsOf(points: Vec3[]): Vec2[] {
  const n = points.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const len = Math.hypot(tx, ty);
    if (len < 1e-9) {
      tx = 1;
      ty = 0;
    } else {
      tx /= len;
      ty /= len;
    }
    out.push({ x: tx, y: ty });
  }
  return out;
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

  const positions: number[] = [];
  const rings: number[][] = []; // index bookkeeping per ring

  // One ring of vertices per centerline sample.
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const t = tangents[i];
    // In-plane side normal (perpendicular to tangent, in XY): (-ty, tx).
    const sx = -t.y;
    const sy = t.x;
    const ringIdx: number[] = [];
    for (let j = 0; j < m; j++) {
      const u = section[j].x; // across width -> along side
      const v = section[j].y; // through thickness -> along +Z
      const x = p.x + sx * u;
      const y = p.y + sy * u;
      const z = p.z + v;
      ringIdx.push(positions.length / 3);
      positions.push(x, y, z);
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
  capFan(rings[0], false); // start cap faces back (-tangent)
  capFan(rings[rings.length - 1], true); // end cap faces forward (+tangent)

  if (opts.roundCaps) {
    addDomeCap(positions, indices, pts[0], tangents[0], section, opts, true);
    addDomeCap(positions, indices, pts[pts.length - 1], tangents[pts.length - 1], section, opts, false);
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
  tangent: Vec2,
  section: Vec2[],
  opts: RibbonOptions,
  atStart: boolean,
): void {
  const m = section.length;
  const dir = atStart ? -1 : 1; // push outward from the strand body
  const sx = -tangent.y;
  const sy = tangent.x;
  const tx = tangent.x * dir;
  const ty = tangent.y * dir;
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
      const x = center.x + sx * u + tx * push;
      const y = center.y + sy * u + ty * push;
      const z = center.z + v;
      ring.push(positions.length / 3);
      positions.push(x, y, z);
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
