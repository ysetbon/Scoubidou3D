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
  /**
   * Sweep sharp corners round instead of cutting them square.
   *
   * On for the lace body, where it gives a smooth bend through a fold. Off for the
   * OUTLINE shell: the shell is the same sweep run wider, and swinging it round a
   * corner drags its inner half back through the corner point, where the
   * self-crossing faces show as a black starburst. A squared corner on the shell
   * still sits behind the rounded body it is outlining.
   */
  roundJoins?: boolean;
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

// Corners turning at least this much get join treatment rather than a single
// bisecting cross-section. Well below the ~155 degrees a folded lace makes, well
// above anything a sampled curve produces between neighbouring points.
const JOIN_TURN = (60 * Math.PI) / 180;


/**
 * Build a ribbon BufferGeometry from a centerline polyline. Each point carries
 * its own z (the weave height), so the ribbon can rise and dip along its length.
 */
export function buildRibbonGeometry(centerline: Vec3[], opts: RibbonOptions): THREE.BufferGeometry {
  // Collapse consecutive points that share a position in the drawing plane, taking
  // the average of their heights.
  //
  // A joint produces exactly such a pair: the two strands meeting there were woven
  // separately, so each brings its own height to the shared point. Keeping both
  // leaves a step with no length in the plane, and the heading is read from
  // differences in the plane — so the heading at a joint came out as neither run's,
  // and a fold never registered as a reversal at all.
  const pts: Vec3[] = [];
  for (const p of centerline) {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) <= 1e-6) {
      last.z = (last.z + p.z) / 2;
      continue;
    }
    pts.push({ ...p });
  }
  if (pts.length < 2) {
    return new THREE.BufferGeometry();
  }

  const section = crossSection(opts.width, opts.thickness, opts.cornerRadius, opts.cornerSteps);
  const m = section.length; // vertices per ring

  // Direction of each segment.
  const seg: Vec2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const l = Math.hypot(dx, dy);
    seg.push(l < 1e-12 ? { x: 1, y: 0 } : { x: dx / l, y: dy / l });
  }

  // Where each cross-section sits, and which way it faces.
  //
  // Along a run the cross-section lies across the perpendicular of the heading, and
  // that is all it takes. A corner has TWO headings though, and one cross-section
  // cannot serve both: laid across their bisector it has to reach further and
  // further to meet both runs as the corner sharpens, until at a fold it runs out
  // into a spike.
  //
  // A corner instead gets several cross-sections at the corner point, the facing
  // swinging from one run's perpendicular round to the other's. The outer edge then
  // sweeps a smooth arc around the corner and the two runs' sides meet without a
  // step. It also spares the sweep the reversal it cannot represent: the facing
  // never jumps, it turns.
  // `inner` marks a corner sweep, and which side of the cross-section is on the
  // inside of the turn. That half is folded onto the centreline rather than swung
  // round: swung, it travels backwards through the corner and its faces cross the
  // ones coming the other way, showing as dark slivers. Folded flat it becomes the
  // straight inner edge the outer sweep turns about — the corner is a wedge, not a
  // full cross-section pivoting on its middle.
  const frames: Array<{ p: Vec3; sx: number; sy: number; inner: number }> = [];
  for (let i = 0; i < pts.length; i++) {
    const dPrev = seg[Math.max(0, i - 1)];
    const dNext = seg[Math.min(seg.length - 1, i)];
    const turn =
      i > 0 && i < pts.length - 1
        ? Math.acos(Math.max(-1, Math.min(1, dPrev.x * dNext.x + dPrev.y * dNext.y)))
        : 0;
    if (turn >= JOIN_TURN && (opts.roundJoins ?? true)) {
      const way = Math.sign(dPrev.x * dNext.y - dPrev.y * dNext.x) || 1; // which way it turns
      const steps = Math.max(2, Math.ceil(turn / ((8 * Math.PI) / 180)));
      const a0 = Math.atan2(dPrev.x, -dPrev.y); // angle of perp(dPrev)
      for (let k = 0; k <= steps; k++) {
        const a = a0 + way * turn * (k / steps);
        frames.push({ p: pts[i], sx: Math.cos(a), sy: Math.sin(a), inner: way });
      }
    } else if (turn >= JOIN_TURN) {
      // Squared corner: one cross-section square to each run, nothing reaching past.
      const a0 = Math.atan2(dPrev.x, -dPrev.y);
      const a1 = Math.atan2(dNext.x, -dNext.y);
      frames.push({ p: pts[i], sx: Math.cos(a0), sy: Math.sin(a0), inner: 0 });
      frames.push({ p: pts[i], sx: Math.cos(a1), sy: Math.sin(a1), inner: 0 });
    } else {
      const tx = dPrev.x + dNext.x;
      const ty = dPrev.y + dNext.y;
      const l = Math.hypot(tx, ty) || 1;
      frames.push({ p: pts[i], sx: -ty / l, sy: tx / l, inner: 0 });
    }
  }

  const positions: number[] = [];
  const rings: number[][] = []; // index bookkeeping per ring

  // One ring of vertices per frame.
  for (const f of frames) {
    const ringIdx: number[] = [];
    for (let j = 0; j < m; j++) {
      let u = section[j].x; // across width -> along the facing
      const v = section[j].y; // through thickness -> along +Z
      if (f.inner !== 0 && u * f.inner > 0) u = 0; // inner half folded to the edge
      ringIdx.push(positions.length / 3);
      positions.push(f.p.x + f.sx * u, f.p.y + f.sy * u, f.p.z + v);
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
      // outside and the BackSide outline shell reads as a silhouette rim. Where the
      // section is walked backwards (past a fold) the loop runs the other way, so
      // the winding is reversed to match and the normals still face out.
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
    addDomeCap(positions, indices, pts[0], seg[0], section, opts, true);
  }
  if (!opts.openEnd && (opts.capEnd ?? opts.roundCaps)) {
    addDomeCap(positions, indices, pts[pts.length - 1], seg[seg.length - 1], section, opts, false);
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
