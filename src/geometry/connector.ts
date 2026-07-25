// The attach connector: what makes an attached strand REALLY connected in 3D.
//
// When strand B is attached to strand A (attach_mode.py / AttachedStrand: B's
// start is glued to a free endpoint of A), the two share that point in the
// drawing plane. But in 3D they live on different layers — A at its height, B at
// its own — so at the junction the ribbons don't touch: B floats above or below
// A's end with a gap. That reads as broken.
//
// We close the gap with a short lofted bridge — a "Z vector, meshed nicely": a
// tube that morphs A's end cross-section (at A's height) into B's start
// cross-section (at B's height), banking gently along the joint so the lace
// looks like one continuous piece that dives between the layers.

import * as THREE from 'three';
import { Vec2, Vec3 } from './vec';
import { crossSection } from './ribbon';

/** One end of a connector: the world-space endpoint (its woven height baked into
 *  z) and the in-plane heading of the strand there, pointing ALONG the bridge
 *  (outward from the parent body / forward into the child). */
export interface ConnectorEnd {
  center: Vec3;
  tangent: Vec2;
}

export interface ConnectorOptions {
  width: number; // world units — the shared ribbon width at the junction
  thickness: number; // world units
  cornerRadius: number;
  cornerSteps: number;
  steps?: number; // loft rings between the two ends (default 10)
}

function normalize2(x: number, y: number): Vec2 {
  const len = Math.hypot(x, y);
  if (len < 1e-9) return { x: 1, y: 0 };
  return { x: x / len, y: y / len };
}

// smoothstep 0..1 — eases the height ramp so the bridge starts and ends flush.
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// World vertices of one cross-section ring: center + side*u + up*v, up = +Z.
function ringVertices(center: Vec3, tangent: Vec2, section: Vec2[]): Vec3[] {
  const sx = -tangent.y; // in-plane side (perpendicular to heading)
  const sy = tangent.x;
  return section.map((s) => ({
    x: center.x + sx * s.x,
    y: center.y + sy * s.x,
    z: center.z + s.y,
  }));
}

/**
 * Build a lofted bridge geometry between two strand ends, or null if the ends
 * are effectively coincident (nothing to bridge) or degenerate.
 */
export function buildConnectorGeometry(a: ConnectorEnd, b: ConnectorEnd, opts: ConnectorOptions): THREE.BufferGeometry | null {
  const dz = b.center.z - a.center.z;
  const dxy = Math.hypot(b.center.x - a.center.x, b.center.y - a.center.y);
  const span = Math.hypot(dz, dxy);
  if (span < 1e-4) return null; // already touching — no bridge needed
  if (opts.width <= 0 || opts.thickness <= 0) return null;

  const section = crossSection(opts.width, opts.thickness, opts.cornerRadius, opts.cornerSteps);
  const m = section.length;
  const steps = Math.max(2, opts.steps ?? 10);

  // Keep the two rings' vertex order on the same rotational sense so the loft
  // morphs twist-free. A natural attach continues forward, so the headings
  // already agree; only a strand that doubles straight back would disagree, and
  // flipping keeps that from pinching the bridge to a point at its middle.
  const ta = normalize2(a.tangent.x, a.tangent.y);
  let tb = normalize2(b.tangent.x, b.tangent.y);
  if (ta.x * tb.x + ta.y * tb.y < 0) tb = { x: -tb.x, y: -tb.y };

  const ringA = ringVertices(a.center, ta, section);
  const ringB = ringVertices(b.center, tb, section);

  // A gentle bow along the average heading turns a stark vertical step into a
  // smooth lace bend.
  const dir = normalize2(ta.x + tb.x, ta.y + tb.y);
  const bow = 0.4 * Math.abs(dz);

  const positions: number[] = [];
  const rings: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const e = smoothstep(s);
    const off = bow * Math.sin(Math.PI * s); // 0 at both ends, peak in the middle
    const ring: number[] = [];
    for (let j = 0; j < m; j++) {
      const x = ringA[j].x + (ringB[j].x - ringA[j].x) * e + dir.x * off;
      const y = ringA[j].y + (ringB[j].y - ringA[j].y) * e + dir.y * off;
      const z = ringA[j].z + (ringB[j].z - ringA[j].z) * e;
      ring.push(positions.length / 3);
      positions.push(x, y, z);
    }
    rings.push(ring);
  }

  const indices: number[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const r0 = rings[i];
    const r1 = rings[i + 1];
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      // Outward winding, matching the ribbon tube (see ribbon.ts). The bodies at
      // both ends seal the open rings, so the bridge needs no caps of its own.
      indices.push(r0[j], r1[j2], r1[j]);
      indices.push(r0[j], r0[j2], r1[j2]);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}
