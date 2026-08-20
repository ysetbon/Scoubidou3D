// Turns a strand centerline into a solid 3D ribbon.
//
// The core idea of Scoubidou3D: a strand in OpenStrand Studio already has a
// WIDTH (it is drawn as a fat stroke). We add a second dimension — THICKNESS —
// and sweep a rectangular cross-section (width across, thickness up) along the
// centerline. The result is a flat plastic-lacing-style ribbon (think the gimp
// lanyards) that we can then stack in Z and view from any angle.
//
// The sweep uses a ROLL-FREE frame: "side" is the in-plane normal of the
// centerline and always stays level, so the lace never turns over about its own
// axis. Its flat face therefore goes on pointing broadly at +Z, and the ribbon
// reads exactly like the original top-down editor when viewed straight down —
// even once the WEAVE lifts and drops the centerline in Z at crossings
// (weave.ts). "Up" pitches with the climb, so a lace riding over another lies
// along the ramp instead of standing on edge. The centerline is a Vec3 polyline:
// (x, y) is the drawing-plane position and z is the height the weave gives it.

import * as THREE from 'three';
import { Vec2, Vec3 } from './vec';
import { Fold, foldsOf } from './polyline';

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
   * How far a rounded cap reaches past the end, world units. Defaults to half
   * the WIDTH — the round strand end OSS draws, which is right for a lace lying
   * flat. A short bar standing on end (the fold rung) wants its own thickness
   * instead, or the cap is a nose half a lace wide.
   */
  capReach?: number;
  /**
   * Round a cap in the THICKNESS direction only, leaving the section at full
   * width right to the last ring: the rounded end of a flat bar rather than a
   * bullet nose. The cap is then a half-cylinder lying across the width, and
   * the silhouette turns the corner in one continuous curve instead of stepping.
   */
  capFlat?: boolean;
  /**
   * Leave an end completely open — no dome and no flat cap. Used for the OUTLINE
   * shell at a glued end: two laces meeting end to end would otherwise present
   * two coincident outline caps to each other, which read as a black plate across
   * the joint. Left open, the outline shells form one continuous sleeve.
   */
  openStart?: boolean;
  openEnd?: boolean;
  /**
   * Leave the band across a fold's outer face out of the surface. The OUTLINE
   * shell needs this: grown outward, its band sits in FRONT of the body's own and
   * floods the fold black. Left out, the shell has a hole exactly there, the
   * body's face shows through it, and the rim still runs round the edges.
   */
  openFolds?: boolean;
  /**
   * Square the two faces of every fold: stand them dead vertical and unsheared,
   * so the fold's geometry stays exactly in its own vertical plane and nothing
   * of it reaches past the point where the runs end.
   *
   * Left alone, a fold's faces tip with the runs' climb and shear onto the
   * crease, and that reach past the fold point is visible — a thin fin poking
   * out of the turn. That is fine when the fold IS the turn's outer surface,
   * and wrong the moment something else stands in front of it: the fold RUNG
   * (StrandScene.foldRungs) is a solid piece of lace centred on the fold point,
   * and the tipped faces poke out through it. Squared, the fold is a flat sheet
   * fully inside the rung, and the rung is the only thing the eye gets.
   */
  squareFolds?: boolean;
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
      last.zIn = last.zIn ?? last.z;
      last.zOut = p.zOut ?? p.z;
      last.z = (last.zIn + last.zOut) / 2;
      continue;
    }
    pts.push({ ...p });
  }
  if (pts.length < 2) {
    return new THREE.BufferGeometry();
  }

  const section = crossSection(opts.width, opts.thickness, opts.cornerRadius, opts.cornerSteps);
  const m = section.length; // vertices per ring
  const tangents = tangentsOf(pts);
  const slopes = slopesOf(pts);

  // Plan the cross-sections. Normally one per centerline sample — but a FOLD gets
  // two, at the same point: one squared to the run arriving, one to the run
  // leaving, each tipped over onto the crease they share (polyline.ts).
  //
  // Because both faces lie on that one line, and the section is walked the other
  // way round after the fold, the two cross-sections come out vertex for vertex
  // IDENTICAL. The strip the sweep lays between them therefore has no area at all:
  // the surface passes straight through the fold as one continuous skin. Nothing
  // is cut, nothing is capped, and there is no seam to see — just a crease, which
  // is exactly what a folded lace has.
  //
  // Sweeping the fold instead of splitting it is what keeps the mitre out. Neither
  // face reaches past the crease, so there is no spike; the faces coincide, so
  // there is no notch.
  const folds = new Map<number, Fold>();
  for (const f of foldsOf(pts)) folds.set(f.index, f);

  interface Section {
    p: Vec3;
    t: Vec2;
    up: Vec3; // thickness axis, pitched with the climb
    shear: number; // tips the face over onto the crease
    crease: boolean; // second face of a fold: the section turns over here
    /** Overrides the width axis for this ring (normally the perpendicular of
     *  `t`). Squared folds set it to the crease line, so both of a fold's rings
     *  lie in ONE vertical plane and the fold has no reach at all. */
    side?: Vec2;
  }
  // The thickness axis for a run heading `t` at gradient `slope`: leant back over
  // the heading just enough to stand square to the climb.
  const upOf = (t: Vec2, slope: number): Vec3 => {
    const k = 1 / Math.hypot(1, slope);
    return { x: -t.x * slope * k, y: -t.y * slope * k, z: k };
  };
  const runSlope = (a: Vec3, b: Vec3) => {
    const run = Math.hypot(b.x - a.x, b.y - a.y);
    return run < 1e-9 ? 0 : (b.z - a.z) / run;
  };

  const plan: Section[] = [];
  for (let i = 0; i < pts.length; i++) {
    const f = folds.get(i);
    if (!f) {
      plan.push({ p: pts[i], t: tangents[i], up: upOf(tangents[i], slopes[i]), shear: 0, crease: false });
      continue;
    }
    // A central-difference heading spans the fold and so belongs to neither run;
    // each face takes its own run's heading instead.
    //
    // The two faces must also share ONE thickness axis. Each run would otherwise
    // pitch its own way — a lace cresting a crossing arrives climbing and leaves
    // descending — and the faces would tip apart and open the very seam the crease
    // exists to close. A crease is a single plane through the material, so the two
    // runs' axes are averaged and squared up to the crease line.
    // The lace doubles back over itself here, so the two runs must not share a
    // height — held level they would pass through each other. Each face sits at
    // the height its own run brought to the joint (already stacked one thickness
    // apart by `easeFolds`), and the band the sweep lays between them becomes the
    // outside of the fold.
    const pIn = { x: pts[i].x, y: pts[i].y, z: pts[i].zIn ?? pts[i].z };
    const pOut = { x: pts[i].x, y: pts[i].y, z: pts[i].zOut ?? pts[i].z };
    const a = upOf(f.din, runSlope(pts[i - 1], pIn));
    const b = upOf(f.dout, runSlope(pOut, pts[i + 1]));
    let ux = a.x + b.x;
    let uy = a.y + b.y;
    const uz = a.z + b.z; // both lean up, so this can never cancel
    const along = ux * f.crease.x + uy * f.crease.y;
    ux -= along * f.crease.x;
    uy -= along * f.crease.y;
    const len = Math.hypot(ux, uy, uz) || 1;
    const up = opts.squareFolds ? { x: 0, y: 0, z: 1 } : { x: ux / len, y: uy / len, z: uz / len };
    const shearIn = opts.squareFolds ? 0 : f.shearIn;
    const shearOut = opts.squareFolds ? 0 : f.shearOut;
    // Squared, both rings take the crease itself as their width axis. Each ring
    // normally lies square to its own run, and the two runs' headings differ by
    // whatever the turn falls short of a full reversal — so the rings' corners
    // swing out of the fold's plane by half that. Aligned to the crease they sit
    // in one vertical plane, and the whole fold collapses into it. Only the
    // GEOMETRY is overridden: `t` still carries each run's true heading, because
    // the mirror bookkeeping below reads headings, and feeding it the crease
    // would flip the walk twice and wring the tube.
    const side = opts.squareFolds ? { x: f.crease.x, y: f.crease.y } : undefined;
    plan.push({ p: pIn, t: f.din, up, shear: shearIn, crease: false, side });
    plan.push({ p: pOut, t: f.dout, up, shear: shearOut, crease: true, side });
  }

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
  // through the fold, and the lace comes away parallel. A fold's second face
  // always turns over, even where the runs part by less than a right angle and the
  // perpendiculars have not yet opposed — that is what makes the pair coincide.
  const mirrored: boolean[] = [false];
  for (let i = 1; i < plan.length; i++) {
    const prev = plan[i - 1].t;
    const t = plan[i].t;
    const flipped = plan[i].crease || -t.y * -prev.y + t.x * prev.x < 0;
    mirrored.push(flipped ? !mirrored[i - 1] : mirrored[i - 1]);
  }

  for (let i = 0; i < plan.length; i++) {
    const { p, t, up, shear } = plan[i];
    // In-plane side normal (perpendicular to tangent, in XY): (-ty, tx). It stays
    // level whatever the climb, so the lace never rolls about its own axis.
    const sx = plan[i].side ? plan[i].side!.x : -t.y;
    const sy = plan[i].side ? plan[i].side!.y : t.x;
    const ringIdx: number[] = [];
    for (let j = 0; j < m; j++) {
      const s = section[mirrored[i] ? m - 1 - j : j];
      const u = s.x; // across width -> along side
      const v = s.y; // through thickness -> along the (pitched) up axis
      const d = shear * u; // slide along the heading to reach the crease line
      const x = p.x + sx * u + t.x * d + up.x * v;
      const y = p.y + sy * u + t.y * d + up.y * v;
      const z = p.z + up.z * v;
      ringIdx.push(positions.length / 3);
      positions.push(x, y, z);
    }
    rings.push(ringIdx);
  }

  const indices: number[] = [];
  // Stitch consecutive rings into a tube.
  for (let i = 0; i < rings.length - 1; i++) {
    if (opts.openFolds && plan[i + 1].crease) continue; // skip the fold's outer face
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
    addDomeCap(positions, indices, plan[0].p, plan[0].t, section, opts, true);
  }
  if (!opts.openEnd && (opts.capEnd ?? opts.roundCaps)) {
    addDomeCap(positions, indices, plan[lastRing].p, plan[lastRing].t, section, opts, false);
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
  const reach = opts.capReach ?? opts.width / 2;
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
      const u = section[j].x * (opts.capFlat ? 1 : scale);
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
