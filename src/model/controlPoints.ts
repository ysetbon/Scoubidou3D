// OpenStrand Studio's control-point behaviour, ported.
//
// bezier.ts already reproduces OSS's curve MATH. This is the other half: the
// rules that decide which handles a strand offers, what a drag does to the other
// handles, and when the set folds back up. They come from move_mode.py
// (try_move_control_points / update_strand_position / mouseReleaseEvent),
// strand.py (update_shape, the `start` setter) and strand_drawing_canvas.py
// (_draw_control_points_impl). Summarised in docs/control-points.md.
//
// The shapes named below are OSS's own: control point 1 is drawn as a TRIANGLE,
// control point 2 as a CIRCLE, the centre as a SQUARE.

import { Point, Strand3D } from './types';

/** OSS's "these are the same point" tolerance for control points — 1 pixel. */
export const CP_EPS = 1.0;
/** A hand-placed centre unlocks itself within half a pixel of the midpoint
 *  (strand.py update_shape). */
export const CENTER_EPS = 0.5;

/** Which handle a gesture is on. 0 = triangle, 1 = circle, 'center' = square. */
export type ControlHandle = 0 | 1 | 'center';

function near(a: Point, b: Point, eps: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= eps;
}

/** Where the centre sits when the user hasn't placed it: midway between the two
 *  end control points (OSS's `default_center`). */
export function defaultCenter(s: Strand3D): Point {
  const [cp1, cp2] = s.control_points;
  return { x: (cp1.x + cp2.x) / 2, y: (cp1.y + cp2.y) / 2 };
}

/**
 * The control-point half of OSS's `update_shape`, run after every edit: a centre
 * the user has not locked simply tracks the midpoint, and a locked one releases
 * itself as soon as it is dropped back onto that midpoint. That release is what
 * lets a user undo a centre by hand, with no separate control.
 */
export function updateControlCenter(s: Strand3D): void {
  const def = defaultCenter(s);
  if (s.control_point_center_locked && s.control_point_center) {
    if (near(s.control_point_center, def, CENTER_EPS)) s.control_point_center_locked = false;
  }
  if (!s.control_point_center_locked) s.control_point_center = def;
}

export interface VisibleControls {
  triangle: boolean;
  circle: boolean;
  center: boolean;
}

/**
 * Which handles OSS would draw for this strand, given the third-control-point
 * setting. The triangle is always there; everything else waits for it to move.
 * The small handles also stay hidden while both control points are still parked
 * on the start (a brand-new straight strand), unless the centre is in play.
 */
export function visibleControls(s: Strand3D, thirdEnabled: boolean): VisibleControls {
  const [cp1, cp2] = s.control_points;
  const bothAtStart = near(cp1, s.start, CP_EPS) && near(cp2, s.start, CP_EPS);
  const smallShown = thirdEnabled || !bothAtStart;
  return {
    triangle: true,
    circle: s.triangleHasMoved && smallShown,
    center: s.triangleHasMoved && thirdEnabled,
  };
}

/**
 * Press side effects, applied the moment a handle is grabbed (OSS does this in
 * try_move_control_points, before any movement): grabbing the triangle reveals
 * the rest of the set, and grabbing the centre is itself the act of locking it.
 */
export function beginControlDrag(s: Strand3D, handle: ControlHandle): void {
  if (handle === 0) {
    s.triangleHasMoved = true;
  } else if (handle === 'center') {
    if (!s.control_point_center) s.control_point_center = defaultCenter(s);
    s.control_point_center_locked = true;
  }
}

/** Drag a handle to `p`, with OSS's side effects. */
export function dragControl(s: Strand3D, handle: ControlHandle, p: Point): void {
  const at: Point = { x: p.x, y: p.y };
  if (handle === 'center') {
    s.control_point_center = at;
    s.control_point_center_locked = true;
    return;
  }
  s.control_points[handle] = at;
  if (handle === 1) {
    // Leaving the end makes the circle independent; landing back on it hands the
    // circle back to the endpoint.
    s.cp2Activated = !near(at, s.end, CP_EPS);
  }
  // Moving an END control point never locks the centre — it just carries it
  // along on the midpoint (move_mode.py is explicit about this).
  updateControlCenter(s);
}

/**
 * Keep a passive circle glued to the end while the end is dragged, so a strand
 * that was straight stays straight (move_mode.py's auto-sync). Does nothing once
 * the user has pulled the circle off the end.
 */
export function syncPassiveCp2(s: Strand3D): void {
  if (s.cp2Activated) return;
  s.control_points[1] = { x: s.end.x, y: s.end.y };
}

/**
 * Release side effect: once every control point is back on the start the strand
 * counts as untouched again and folds back to just the triangle
 * (move_mode.py mouseReleaseEvent).
 *
 * One deliberate difference. OSS tests only the circle and the centre, not the
 * triangle, so bending the triangle alone and letting go folds the set away
 * again — and because the desktop app gates DRAWING on `triangle_has_moved` but
 * SELECTING on a separate `control_point2_shown` flag that survives the release,
 * the circle stays clickable while invisible, parked under the start. A handle
 * you can grab but cannot see is a bad trade in a view you can orbit, so the
 * triangle is included in the test here: the set folds away when the strand is
 * genuinely untouched, and never before.
 */
export function settleControls(s: Strand3D): void {
  if (!s.triangleHasMoved) return;
  const cp1AtStart = near(s.control_points[0], s.start, CP_EPS);
  const cp2AtStart = near(s.control_points[1], s.start, CP_EPS);
  const centerAtStart =
    !s.control_point_center_locked ||
    !s.control_point_center ||
    near(s.control_point_center, s.start, CP_EPS);
  if (cp1AtStart && cp2AtStart && centerAtStart) s.triangleHasMoved = false;
}

/**
 * OSS's fallback for a file that predates the flag: a strand counts as touched
 * when its triangle sits off the start (save_load_manager.py).
 */
export function inferTriangleHasMoved(s: {
  start: Point;
  control_points: [Point, Point];
}): boolean {
  return !near(s.control_points[0], s.start, CP_EPS);
}
