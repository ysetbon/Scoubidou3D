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
   * Leave an end completely open — no dome and no flat cap. Used for the OUTLINE
   * shell at a glued end: two laces meeting end to end would otherwise present
   * two coincident outline caps to each other, which read as a black plate across
   * the joint. Left open, the outline shells form one continuous sleeve.
   */
  openStart?: boolean;
  openEnd?: boolean;
  /**
   * Leave the outside of a fold — the NOSE — out of the surface. The OUTLINE
   * shell needs this and nothing else does. Growing the section outward moves the
   * nose ACROSS the lace rather than along its own reach, so a shell nose is not
   * outside the body's; worse, the shell's two runs are grown into each other at
   * a fold, where the body's merely touch, so there is no clean outside there to
   * put one on. Left out, the shell has a hole exactly at the nose, the body's
   * own shows through it, and the rim still runs round the edges.
   */
  openFolds?: boolean;
  /**
   * How many rings the fold's NOSE is drawn with — the half-round the lace turns
   * over at a fold (see `noseOf`). Zero leaves the flat wall the nose replaced.
   */
  noseSteps?: number;
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
  // the SAME POINT — offset only by the height `easeFolds` stacks the returning
  // run at. So the surface passes through the fold as one continuous skin, and
  // what the sweep lays between the faces is the outside of the bight: the NOSE
  // (`noseOf`). Nothing is cut and nothing is capped.
  //
  // Sweeping the fold instead of splitting it is what keeps the mitre out. Neither
  // face reaches past the crease, so there is no spike; the faces meet vertex for
  // vertex, so there is no notch.
  const folds = new Map<number, Fold>();
  for (const f of foldsOf(pts)) folds.set(f.index, f);

  interface Section {
    p: Vec3;
    t: Vec2;
    up: Vec3; // thickness axis, pitched with the climb
    shear: number; // tips the face over onto the crease
    crease: boolean; // second face of a fold: the section turns over here
    /** On a crease section: the in-plane direction the fold's nose bulges into
     *  — outward past the turn. See `noseOf`. */
    nose?: Vec2;
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
    const up = { x: ux / len, y: uy / len, z: uz / len };
    // Which way the nose bulges: on past the turn. `din - dout` is the direction
    // the lace would have carried on in had it not doubled back — square to the
    // crease line, and pointing out of the bight rather than back into the lace.
    const nx = f.din.x - f.dout.x;
    const ny = f.din.y - f.dout.y;
    const nl = Math.hypot(nx, ny);
    const nose = nl < 1e-9 ? undefined : { x: nx / nl, y: ny / nl };
    plan.push({ p: pIn, t: f.din, up, shear: f.shearIn, crease: false });
    plan.push({ p: pOut, t: f.dout, up, shear: f.shearOut, crease: true, nose });
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
    const sx = -t.y;
    const sy = t.x;
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
  const noseSteps = Math.max(0, Math.floor(opts.noseSteps ?? 6));

  /**
   * The section read the other way up: for each vertex, the one at the same place
   * across the width and the opposite place through the thickness. That is the
   * vertex a lace's own point arrives at once it has turned over, so it is how the
   * two faces of a fold correspond to each other physically (see `noseOf`).
   * Searched rather than derived, so it stays true of whatever `crossSection`
   * returns; the section is closed and symmetric, so this is always a bijection.
   */
  const flip: number[] = [];
  for (let j = 0; j < m; j++) {
    let best = j;
    let near = Infinity;
    for (let k = 0; k < m; k++) {
      const d = Math.hypot(section[k].x - section[j].x, section[k].y + section[j].y);
      if (d < near) {
        near = d;
        best = k;
      }
    }
    flip.push(best);
  }

  /**
   * The rings that carry the surface round the OUTSIDE of a fold.
   *
   * The two faces of a fold sit at one point in the drawing plane, one above the
   * other — the returning run lying on the run it came off (`easeFolds`). Joined
   * by a single strip, the outside of the fold is a flat wall the height of that
   * gap and the full width of the lace: a square-cut block that reads as a tab
   * stuck on the side of the model, and the taller the gap the bigger the block.
   * Where the fold also climbs a storey it is the most prominent thing on the
   * turn, which is exactly where a real lace shows its softest feature.
   *
   * A real lace has no such face, because it cannot come back on itself without
   * going round something, and what it goes round is the gap. Its outer surface
   * at a fold is a half-round of the radius that gap sets — the same half-round
   * whether the fold merely stacks a run on a run or carries a whole storey.
   *
   * So the wall is replaced by that half-round — and the lace has to TURN through
   * it, not merely travel round it. That distinction is the whole of this
   * function, and missing it puts the wall back somewhere else. Sliding each
   * vertex along its own semicircle reads right on paper and is not: the two faces
   * of a fold sit one gap apart in Z and nowhere else, so every vertex is handed
   * the same arc and the ring is carried round bodily without ever tipping. At the
   * crown it is travelling straight up while still standing on edge, parallel to
   * its own direction of travel, and the sweep degenerates and creases there — the
   * same flat face as before, moved to the top of the loop and dented into it.
   *
   * The ring is therefore ROTATED, about the crease line: the level axis square to
   * the bulge, through the middle of the gap. A quarter of the way round the
   * section lies flat with the surface climbing through it; half way round it has
   * turned over, which is what a lace doubling back does.
   *
   * Turning over is also why the two faces have to be paired by `flip` rather than
   * index for index. A fold's faces are one ring described twice, and the sweep
   * describes the far one with the section's width mirrored and its thickness left
   * alone — the same points, labelled for a lace that came back the same way up.
   * The turn brings it back the OTHER way up, so it lands on the thickness-mirrored
   * labelling instead. Pairing index for index rotates the two halves of the nose
   * into opposition, and averaging them flattens the section to nothing at the
   * crown — a worse dent than the one the nose was for. Paired through `flip` the
   * two agree all the way round, and each end still lands exactly on its face.
   */
  const noseOf = (a: number[], b: number[], dir: Vec2, hub: Vec3, rise: number): number[][] => {
    // The crease line: level, square to the bulge. `dir` is a unit in-plane
    // vector, so this is one too.
    //
    // Its SENSE comes off the rise, because the turn has to come out of the lace
    // whichever way the lace is going through it. A run stepping up doubles back
    // over the top; a run stepping down doubles back underneath, which is the same
    // turn about the same line read the other way round. Fixing the sense would
    // send every second fold's nose inward, burying it in the lace it came off and
    // leaving that turn as square as it ever was.
    const sense = rise < 0 ? -1 : 1;
    const k1 = dir.y * sense;
    const k2 = -dir.x * sense;
    // Rodrigues about that axis. Its Z component is zero, which drops the last
    // term of the usual formula from Z.
    const spin = (wx: number, wy: number, wz: number, c: number, s: number): Vec3 => {
      const dot = k1 * wx + k2 * wy;
      return {
        x: wx * c + k2 * wz * s + k1 * dot * (1 - c),
        y: wy * c - k1 * wz * s + k2 * dot * (1 - c),
        z: wz * c + (k1 * wy - k2 * wx) * s,
      };
    };
    const out: number[][] = [];
    for (let n = 1; n <= noseSteps; n++) {
      const th = (Math.PI * n) / (noseSteps + 1);
      const f = th / Math.PI; // 0 at the arriving face, 1 at the leaving one
      const c = Math.cos(th);
      const s = Math.sin(th);
      const ring: number[] = [];
      for (let j = 0; j < m; j++) {
        const ai = a[j] * 3;
        const bi = b[flip[j]] * 3;
        // Forward from the arriving face…
        const p = spin(positions[ai] - hub.x, positions[ai + 1] - hub.y, positions[ai + 2] - hub.z, c, s);
        // …and back from the leaving one, which is the same turn less a half
        // circle, so cosine and sine simply change sign.
        const q = spin(positions[bi] - hub.x, positions[bi + 1] - hub.y, positions[bi + 2] - hub.z, -c, -s);
        ring.push(positions.length / 3);
        positions.push(
          hub.x + p.x + (q.x - p.x) * f,
          hub.y + p.y + (q.y - p.y) * f,
          hub.z + p.z + (q.z - p.z) * f,
        );
      }
      out.push(ring);
    }
    return out;
  };

  // Stitch consecutive rings into a tube, going round the nose at every fold.
  const strip = (a: number[], b: number[], flip: boolean): void => {
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
      if (flip) {
        indices.push(v00, v10, v11);
        indices.push(v00, v11, v01);
      } else {
        indices.push(v00, v11, v10);
        indices.push(v00, v01, v11);
      }
    }
  };

  for (let i = 0; i < rings.length - 1; i++) {
    const next = plan[i + 1];
    if (opts.openFolds && next.crease) continue; // skip the fold's outer face
    const a = rings[i];
    const b = rings[i + 1];
    // Round the outside of the fold rather than walling it off — unless the two
    // faces meet at one height, which leaves nothing to turn on. That is the
    // shape of a fold in a strand meshed on its own: `easeFolds` runs over a
    // merged lace, so a lone strand's fold arrives unstacked, and a nose of no
    // radius would be a handful of rings all sitting on each other.
    const gap = next.crease ? Math.abs(next.p.z - plan[i].p.z) : 0;
    if (next.nose && noseSteps > 0 && gap > 1e-6) {
      // The turn is about the crease line through the middle of the gap: the two
      // faces share a point in the drawing plane, so only the height is averaged.
      const hub = { x: next.p.x, y: next.p.y, z: (plan[i].p.z + next.p.z) / 2 };
      let prev = a;
      for (const ring of noseOf(a, b, next.nose, hub, next.p.z - plan[i].p.z)) {
        strip(prev, ring, mirrored[i]);
        prev = ring;
      }
      // The nose comes off the turn on the far face's other-way-up labelling, so
      // the last band closes onto it through the same pairing. Same ring, same
      // walk, so the band has no area of its own — it only hands the surface back
      // to the labels the rest of the sweep is using.
      strip(prev, flip.map((k) => b[k]), mirrored[i]);
      continue;
    }
    strip(a, b, mirrored[i]);
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
