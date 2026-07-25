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
   * Tip the end cross-section over instead of leaving it square to the run, so
   * the ribbon finishes on an oblique flat face. A vertex sitting `u` across the
   * width is slid `shear * u` along the heading.
   *
   * This is how a FOLD is built (polyline.ts): the two runs meeting at a fold are
   * cut along one shared crease line, so their end faces coincide and the lace
   * reads as one strap creased flat — no corner to mitre, notch or pinch.
   */
  startShear?: number;
  endShear?: number;
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

// Corners turning at least this much are cut square rather than mitred to a point.
// Well below the ~155 degrees a folded lace makes, well above anything a sampled
// curve produces between neighbouring points.
const BEVEL_TURN = (60 * Math.PI) / 180;

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

// How steeply the centerline climbs at each sample: rise over in-plane run.
//
// The sweep keeps "across" horizontal, so the lace never rolls about its own
// axis — that is what makes it read like the flat 2D drawing from above. But a
// lace ducking under a crossing can climb steeply over a short run, and a
// cross-section held dead level on a steep climb stands the ribbon on edge: the
// strip between two rings comes out a near-vertical wall, and the top face
// creases where the slope turns over.
//
// Tilting the section with the slope — pitch only, still no roll — lays the flat
// face along the ramp, the way a real lace lies over the strand it is climbing.
// Level stretches are unaffected: the pitch is zero and "up" is +Z as before.
function slopesOf(points: Vec3[]): number[] {
  const n = points.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const run = Math.hypot(b.x - a.x, b.y - a.y);
    out.push(run < 1e-9 ? 0 : (b.z - a.z) / run);
  }
  return out;
}

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

  // Cut sharp corners square instead of letting them run to a point.
  //
  // A corner gets one cross-section, laid across the bisector of the two runs. The
  // sharper the corner the further that cross-section has to reach to meet both
  // runs, and at a fold — where the bisector is almost square to both — it reaches
  // out into a long spike. (It is the mitre join of any stroked line, and it blows
  // up the same way as the turn approaches a reversal.)
  //
  // Giving the corner TWO cross-sections instead, one square to each run, ends both
  // runs cleanly and joins them with a flat face across the tip. Nothing reaches
  // past the corner, so there is nothing to spike.
  const beveled: Vec3[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i === 0 || i === pts.length - 1) {
      beveled.push(pts[i]);
      continue;
    }
    const ax = pts[i].x - pts[i - 1].x;
    const ay = pts[i].y - pts[i - 1].y;
    const bx = pts[i + 1].x - pts[i].x;
    const by = pts[i + 1].y - pts[i].y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) {
      beveled.push(pts[i]);
      continue;
    }
    const turn = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
    if (turn < BEVEL_TURN) {
      beveled.push(pts[i]);
      continue;
    }
    const step = Math.min(0.02 * Math.min(la, lb), 0.004);
    beveled.push({ x: pts[i].x - (ax / la) * step, y: pts[i].y - (ay / la) * step, z: pts[i].z });
    beveled.push({ x: pts[i].x + (bx / lb) * step, y: pts[i].y + (by / lb) * step, z: pts[i].z });
  }
  pts.length = 0;
  pts.push(...beveled);

  const section = crossSection(opts.width, opts.thickness, opts.cornerRadius, opts.cornerSteps);
  const m = section.length; // vertices per ring
  const tangents = tangentsOf(pts);
  const slopes = slopesOf(pts);

  const positions: number[] = [];
  const rings: number[][] = []; // index bookkeeping per ring

  // Which way round each ring is walked.
  //
  // "Across" is taken as the perpendicular of the heading, so it reverses the
  // moment the heading does — and at a fold the heading reverses. Ring vertex j
  // then lands on the opposite edge of the lace from the one it was on, and the
  // strip between the two rings joins near edge to far edge: it crosses over, which
  // is the X. The cross-section has not really turned over, only its numbering.
  //
  // So once the perpendicular flips, keep walking the section the other way round.
  // Vertex j goes on pointing at the same physical edge, the strip stays flat
  // through the fold, and the lace comes away parallel.
  const mirrored: boolean[] = [false];
  for (let i = 1; i < pts.length; i++) {
    const prev = tangents[i - 1];
    const t = tangents[i];
    const flipped = -t.y * -prev.y + t.x * prev.x < 0; // the perpendiculars oppose
    mirrored.push(flipped ? !mirrored[i - 1] : mirrored[i - 1]);
  }

  // One ring of vertices per centerline sample.
  const lastIdx = pts.length - 1;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const t = tangents[i];
    // In-plane side normal (perpendicular to tangent, in XY): (-ty, tx).
    const sx = -t.y;
    const sy = t.x;
    // Pitch the section with the climb so the flat face lies along the ramp.
    // "Up" leans back over the heading; the side axis stays level, so the lace
    // never rolls.
    const k = 1 / Math.hypot(1, slopes[i]);
    const ux = -t.x * slopes[i] * k;
    const uy = -t.y * slopes[i] * k;
    const uz = k;
    // Only the two end rings can be tipped over onto a crease.
    const shear = i === 0 ? (opts.startShear ?? 0) : i === lastIdx ? (opts.endShear ?? 0) : 0;
    const ringIdx: number[] = [];
    for (let j = 0; j < m; j++) {
      const s = section[mirrored[i] ? m - 1 - j : j];
      const u = s.x; // across width -> along side
      const v = s.y; // through thickness -> along the (pitched) up axis
      const d = shear * u; // slide along the heading to reach the crease line
      const x = p.x + sx * u + t.x * d + ux * v;
      const y = p.y + sy * u + t.y * d + uy * v;
      const z = p.z + uz * v;
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
      // outside and the BackSide outline shell reads as a silhouette rim. Where the
      // section is walked backwards (past a fold) the loop runs the other way, so
      // the winding is reversed to match and the normals still face out.
      if (mirrored[i]) {
        indices.push(v00, v10, v11);
        indices.push(v00, v11, v01);
      } else {
        indices.push(v00, v11, v10);
        indices.push(v00, v01, v11);
      }
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
  const lastRing = rings.length - 1;
  if (!opts.openStart) capFan(rings[0], mirrored[0]); // start cap faces back (-tangent)
  if (!opts.openEnd) capFan(rings[lastRing], !mirrored[lastRing]); // end cap faces forward

  if (!opts.openStart && (opts.capStart ?? opts.roundCaps)) {
    addDomeCap(positions, indices, pts[0], tangents[0], section, opts, true);
  }
  if (!opts.openEnd && (opts.capEnd ?? opts.roundCaps)) {
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
