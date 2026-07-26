// Attachment + connection logic, ported from OpenStrand Studio in spirit.
//
// In OSS a strand can be *attached* to another: the child's start point is glued
// to a free endpoint of the parent, they share that point forever, and moving
// one drags the other (attach_mode.py / attached_strand.py / move_mode.py). The
// child inherits the parent's look and joins the same layer "set" (`1_1` → `1_2`).
//
// We reproduce that with two ideas, both keyed off the drawing-plane geometry we
// already store per strand:
//   1. Two endpoints are CONNECTED when they sit on the same point. That single
//      rule powers "move connected strands together" (move_mode.py's
//      points_are_close propagation) AND reconstructs the joints of an imported
//      OSS file for free.
//   2. An endpoint is OCCUPIED (OSS `has_circles`) when it shares its location
//      with another strand's endpoint — a junction. Only FREE endpoints accept a
//      new attachment.

import { Point, Scene3D, Strand3D } from './types';

/** Source-unit tolerance for "these two points are the same" (~OSS's 1px snap). */
export const ATTACH_EPS = 1.0;

export function pointsClose(a: Point, b: Point, eps = ATTACH_EPS): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

/** The start (side 0) or end (side 1) point of a strand. */
export function endpoint(strand: Strand3D, side: 0 | 1): Point {
  return side === 0 ? strand.start : strand.end;
}

/** Move a strand's start/end to `p` (copies, so callers can't alias state). */
export function setEndpoint(strand: Strand3D, side: 0 | 1, p: Point): void {
  if (side === 0) strand.start = { x: p.x, y: p.y };
  else strand.end = { x: p.x, y: p.y };
}

export interface EndpointRef {
  index: number;
  side: 0 | 1;
}

/**
 * Every endpoint (this one included) that coincides with strand[index]'s `side`
 * point. This is the set that must move together when the point is dragged —
 * OSS's "connected strands" for a shared junction.
 */
export function connectedEndpoints(scene: Scene3D, index: number, side: 0 | 1): EndpointRef[] {
  const anchor = endpoint(scene.strands[index], side);
  const refs: EndpointRef[] = [];
  scene.strands.forEach((s, i) => {
    if (s.isMask) return;
    ([0, 1] as const).forEach((t) => {
      if (pointsClose(endpoint(s, t), anchor)) refs.push({ index: i, side: t });
    });
  });
  return refs;
}

/**
 * Recompute every strand's `hasCircles` from the current geometry: an endpoint
 * is occupied when some OTHER strand's endpoint sits on the same point. Call
 * after any structural change (import, add, attach, delete) — never mid-move, so
 * that dragging an endpoint that merely grazes another doesn't silently glue
 * them (OSS only forms attachments through the attach tool, not by dropping).
 */
export function recomputeOccupancy(scene: Scene3D): void {
  const strands = scene.strands;
  for (let i = 0; i < strands.length; i++) {
    const s = strands[i];
    if (s.isMask) continue;
    s.hasCircles = [
      isJunction(strands, i, 0),
      isJunction(strands, i, 1),
    ];
  }
}

function isJunction(strands: Strand3D[], index: number, side: 0 | 1): boolean {
  const anchor = endpoint(strands[index], side);
  for (let j = 0; j < strands.length; j++) {
    if (j === index) continue;
    const o = strands[j];
    if (o.isMask) continue;
    if (pointsClose(o.start, anchor) || pointsClose(o.end, anchor)) return true;
  }
  return false;
}

/**
 * A glued endpoint pair to bridge in 3D. Each strand's START that sits on
 * another strand's endpoint (the OSS "child.start glued to parent" attach shape)
 * yields one junction, pairing the child start with the parent endpoint it hangs
 * off. Derived purely from coincident points, so it reconnects imported files as
 * well as in-app attaches — and a parent carrying several children yields one
 * junction per child (never child-to-child).
 */
export interface Junction {
  childIndex: number;
  childSide: 0 | 1;
  parentIndex: number;
  parentSide: 0 | 1;
}

export function collectJunctions(scene: Scene3D): Junction[] {
  const strands = scene.strands;
  const out: Junction[] = [];
  const seen = new Set<string>();

  for (let ci = 0; ci < strands.length; ci++) {
    const child = strands[ci];
    if (child.isMask) continue;
    const anchor = child.start; // only a strand's START hangs off a parent
    // Find coincident endpoints on other strands; prefer a parent END (a real
    // chain) over a parent START (two strands sharing a head).
    let best: { index: number; side: 0 | 1 } | null = null;
    for (let pi = 0; pi < strands.length; pi++) {
      if (pi === ci) continue;
      const p = strands[pi];
      if (p.isMask) continue;
      ([1, 0] as const).forEach((side) => {
        if (!pointsClose(endpoint(p, side), anchor)) return;
        if (!best || (side === 1 && best.side === 0)) best = { index: pi, side };
      });
    }
    if (!best) continue;
    const parent = best as { index: number; side: 0 | 1 };
    // One bridge per unordered strand pair at this point.
    const key =
      ci < parent.index
        ? `${ci}:${parent.index}:${Math.round(anchor.x)}:${Math.round(anchor.y)}`
        : `${parent.index}:${ci}:${Math.round(anchor.x)}:${Math.round(anchor.y)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ childIndex: ci, childSide: 0, parentIndex: parent.index, parentSide: parent.side });
  }
  return out;
}

/**
 * Next layer name for a strand attached to `parent`, following OSS's family
 * convention: members of a set share the number N and count up — `1_1`, `1_2`,
 * `1_3`. If the parent's id isn't `N_M` (e.g. a hand-named sample), fall back to
 * a unique `<parent>_k` suffix so the connection still works — naming is only
 * cosmetic; movement follows the coincident-point graph regardless.
 */
export function nextAttachedName(scene: Scene3D, parent: Strand3D): string {
  const m = /^(\d+)_(\d+)$/.exec(parent.id);
  if (m) {
    const set = m[1];
    let maxCount = 0;
    for (const s of scene.strands) {
      const mm = /^(\d+)_(\d+)$/.exec(s.id);
      if (mm && mm[1] === set) maxCount = Math.max(maxCount, parseInt(mm[2], 10));
    }
    return `${set}_${maxCount + 1}`;
  }
  const existing = new Set(scene.strands.map((s) => s.id));
  let k = 1;
  while (existing.has(`${parent.id}_${k}`)) k++;
  return `${parent.id}_${k}`;
}

/**
 * Build a new AttachedStrand-equivalent: a zero-length strand whose start is
 * glued to `parent`'s `side` endpoint, inheriting the parent's look and set.
 * Mirrors AttachedStrand.__init__ + AttachMode.start_attachment. The caller
 * grows the `end` out by dragging, then recomputes occupancy.
 */
export function makeAttachedStrand(scene: Scene3D, parent: Strand3D, side: 0 | 1): Strand3D {
  const anchor = endpoint(parent, side);
  const at = (): Point => ({ x: anchor.x, y: anchor.y });
  return {
    id: nextAttachedName(scene, parent),
    start: at(),
    end: at(),
    // A fresh attachment is straight: both control points sit on the start, which
    // buildProfile reads as line mode (bezier.ts).
    control_points: [at(), at()],
    control_point_center: null,
    control_point_center_locked: false,
    triangleHasMoved: false,
    cp2Activated: false,
    width: parent.width,
    stroke_width: parent.stroke_width,
    color: { ...parent.color },
    stroke_color: { ...parent.stroke_color },
    thickness: parent.thickness,
    visible: true,
    isMask: false,
    hasCircles: [true, false], // start glued to parent; end free to extend the chain
    parentId: parent.id,
    parentSide: side,
  };
}
