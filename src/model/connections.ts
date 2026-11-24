// Attachment + connection logic, ported from OpenStrand Studio in spirit.
//
// In OSS a strand can be *attached* to another: the child's start point is glued
// to a free endpoint of the parent, they share that point forever, and moving
// one drags the other (attach_mode.py / attached_strand.py / move_mode.py). The
// child inherits the parent's look and joins the same layer "set" (`1_1` → `1_2`).
//
// Two ideas, and the first is what a drag and the attach tool both turn on:
//   1. Two endpoints are one JOINT when an attachment says so — a child's start
//      and the parent end it declares (`parentId` / `parentSide`), and through
//      that parent end every other child hung off it. See `endpointJoints`.
//      Sitting on the same point is NOT enough on its own: `x, y` is a
//      projection, and in a stacked scene the end of one lace lands within a
//      unit of a joint of another lace levels away without being part of it.
//      Distance only decides for strands that carry no attachment at all, which
//      is what an OSS file without `attached_to` gives you.
//   2. An endpoint is OCCUPIED (OSS `has_circles`) when it is part of a joint
//      with some other strand. Only FREE endpoints accept a new attachment.

import { levelAt } from './levels';
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
 * Which joint every endpoint belongs to: `root[i * 2 + side]` is the same number
 * for every endpoint that moves with strand `i`'s `side` point, and that number
 * is no other joint's.
 *
 * The rule, in the order it is applied:
 *
 *   * **An attachment is a joint.** A strand whose declared parent still holds
 *     its start is glued to that parent end. Two children of the same parent end
 *     are therefore glued to each other through it, and a chain is glued link by
 *     link. Whatever else happens to lie on that point is not.
 *   * **Distance decides only between strands with no attachment at all** —
 *     no declared parent holding them, and no child declaring them. That is an
 *     OSS file saved without `attached_to`, where coincidence is the only record
 *     of a joint there is, and it is why such a file still drags as OSS does.
 *     Even then the two have to be on the same storey: across a level break a
 *     shared `x, y` is the projection again (`collectJunctions` draws the same
 *     line for the same reason).
 *
 * Before this, every endpoint within `ATTACH_EPS` of the pressed one was taken,
 * attached or not. In the swirl column 1×2 the brown `2_13` (level 5, child of
 * `2_11`) ends 0.8 units from the white `1_10` → `1_12` joint (levels 3 and 4),
 * so dragging the brown end dragged both white strands with it — and dropped all
 * three on one exact point, which made the weld permanent and saved it. 68 of
 * the built-in samples carried 1,029 such joints, nearly all in the twist faces
 * and two-fan columns.
 */
export function endpointJoints(scene: Scene3D): number[] {
  const strands = scene.strands;
  const root = strands.flatMap((_, i) => [i * 2, i * 2 + 1]);
  const find = (a: number): number => {
    while (root[a] !== a) {
      root[a] = root[root[a]];
      a = root[a];
    }
    return a;
  };
  const join = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) root[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const indexOf = new Map<string, number>();
  strands.forEach((s, i) => {
    if (!s.isMask && !indexOf.has(s.id)) indexOf.set(s.id, i);
  });

  // The attachments that still hold: the parent end is under the child's start.
  const attached = new Set<number>();
  strands.forEach((child, ci) => {
    if (child.isMask || child.parentId == null || child.parentSide == null) return;
    const pi = indexOf.get(child.parentId);
    if (pi === undefined || pi === ci) return;
    if (!pointsClose(endpoint(strands[pi], child.parentSide), child.start)) return;
    join(ci * 2, pi * 2 + child.parentSide);
    attached.add(ci);
    attached.add(pi);
  });

  // Strands with no attachment either way: coincidence, on one storey.
  const loose = strands
    .map((_, i) => i)
    .filter((i) => !strands[i].isMask && !attached.has(i));
  for (let a = 0; a < loose.length; a++) {
    const i = loose[a];
    const storey = levelAt(scene, i);
    for (let b = a + 1; b < loose.length; b++) {
      const j = loose[b];
      if (levelAt(scene, j) !== storey) continue;
      for (const t of [0, 1] as const) {
        for (const u of [0, 1] as const) {
          if (pointsClose(endpoint(strands[i], t), endpoint(strands[j], u))) join(i * 2 + t, j * 2 + u);
        }
      }
    }
  }
  return root.map((_, k) => find(k));
}

/**
 * Every endpoint (this one included) in the same joint as strand[index]'s `side`
 * point — the set that moves together when that point is dragged, OSS's
 * "connected strands" for a shared junction. See `endpointJoints` for what makes
 * a joint.
 */
export function connectedEndpoints(scene: Scene3D, index: number, side: 0 | 1): EndpointRef[] {
  const joint = endpointJoints(scene);
  const mine = joint[index * 2 + side];
  const refs: EndpointRef[] = [];
  scene.strands.forEach((s, i) => {
    if (s.isMask) return;
    ([0, 1] as const).forEach((t) => {
      if (joint[i * 2 + t] === mine) refs.push({ index: i, side: t });
    });
  });
  return refs;
}

/**
 * Recompute every strand's `hasCircles`: an endpoint is occupied when it shares
 * a joint (`endpointJoints`) with another strand's endpoint. Call after any
 * structural change (import, add, attach, delete) — never mid-move, so that
 * dragging an endpoint that merely grazes another doesn't silently glue them
 * (OSS only forms attachments through the attach tool, not by dropping).
 */
export function recomputeOccupancy(scene: Scene3D): void {
  const strands = scene.strands;
  const joint = endpointJoints(scene);
  const size = new Map<number, number>();
  strands.forEach((s, i) => {
    if (s.isMask) return;
    for (const t of [0, 1]) size.set(joint[i * 2 + t], (size.get(joint[i * 2 + t]) ?? 0) + 1);
  });
  for (let i = 0; i < strands.length; i++) {
    const s = strands[i];
    if (s.isMask) continue;
    // More than this one endpoint in the joint. A strand's own two ends can only
    // share one when it is zero-length, which no finished strand is.
    s.hasCircles = [(size.get(joint[i * 2]) ?? 0) > 1, (size.get(joint[i * 2 + 1]) ?? 0) > 1];
  }
}

/**
 * A glued endpoint pair to bridge in 3D. Each strand's START that sits on
 * another strand's endpoint (the OSS "child.start glued to parent" attach shape)
 * yields one junction, pairing the child start with the parent endpoint it hangs
 * off — and a parent carrying several children yields one junction per child
 * (never child-to-child).
 *
 * A strand that DECLARES its parent is paired with that one. Coincidence is how
 * an undeclared pairing is recovered, not the definition of one: `x, y` is a
 * projection of the strand, so two endpoints a storey or more apart in a stacked
 * scene can land on the same spot without being the same joint. In a twisting
 * column they routinely do, and picking by lowest index then bridges an arm to
 * the wrong lace several levels down. The declaration is the author's answer to
 * a question the projection cannot answer.
 *
 * Where there is no declaration to go on, the STOREY answers it instead: a
 * coincidence between two different storeys is that same projection artefact,
 * and the two ends are a level break apart in space. So the search is confined
 * to the storey the child sits on. Only the free root of a lace reaches this
 * path at all — everything grown from it declares its parent — and a root is
 * exactly the end a turning column eventually brings one of its own arms back
 * onto: a 1x1 comes round to within 0.3 px of its base bars by level 8, and the
 * bottom of the orange lace was being adopted by the top of the blue one.
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
  const indexOf = new Map<string, number>();
  strands.forEach((s, i) => {
    if (!s.isMask && !indexOf.has(s.id)) indexOf.set(s.id, i);
  });

  for (let ci = 0; ci < strands.length; ci++) {
    const child = strands[ci];
    if (child.isMask) continue;
    const anchor = child.start; // only a strand's START hangs off a parent
    let best: { index: number; side: 0 | 1 } | null = null;
    // The declared parent, when it is there and still holds this start.
    if (child.parentId != null && child.parentSide != null) {
      const pi = indexOf.get(child.parentId);
      if (pi !== undefined && pi !== ci && pointsClose(endpoint(strands[pi], child.parentSide), anchor)) {
        best = { index: pi, side: child.parentSide };
      }
    }
    // Otherwise find coincident endpoints on other strands, ON THIS STOREY;
    // prefer a parent END (a real chain) over a parent START (two strands
    // sharing a head).
    if (best === null) {
      const storey = levelAt(scene, ci);
      for (let pi = 0; pi < strands.length; pi++) {
        if (pi === ci) continue;
        const p = strands[pi];
        if (p.isMask) continue;
        if (levelAt(scene, pi) !== storey) continue;
        ([1, 0] as const).forEach((side) => {
          if (!pointsClose(endpoint(p, side), anchor)) return;
          if (!best || (side === 1 && best.side === 0)) best = { index: pi, side };
        });
      }
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
 * cosmetic; movement follows the declared parent link (`endpointJoints`).
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
