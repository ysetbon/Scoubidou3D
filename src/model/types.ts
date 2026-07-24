// The Scoubidou3D scene model. Deliberately close to OpenStrand Studio's strand
// record so we can import real .json files, but reduced to what the 3D view
// needs plus the one new dimension that defines this project: `thickness`.

export interface Point {
  x: number;
  y: number;
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number; // 0..255
}

export interface Strand3D {
  /** Layer name / id, e.g. "1_2". Unique within a scene. */
  id: string;
  start: Point;
  end: Point;
  /** [cp1, cp2] cubic control points (OSS-style). */
  control_points: [Point, Point];
  control_point_center: Point | null;
  control_point_center_locked: boolean;

  /** OSS strand width (across the ribbon), in source/pixel units. */
  width: number;
  /** OSS stroke width — used for the ribbon's outline shell. */
  stroke_width: number;
  color: RGBA;
  stroke_color: RGBA;

  /**
   * New in 3D: out-of-plane depth of the ribbon, in source/pixel units.
   * When null the scene's global thickness is used.
   */
  thickness: number | null;

  visible: boolean;
  /** True for OSS MaskedStrand records — skipped in 3D (masks become real Z). */
  isMask: boolean;

  /**
   * Endpoint occupancy [start, end] — OpenStrand Studio's `has_circles`. An
   * endpoint is "occupied" when another strand's endpoint is glued to the same
   * point (i.e. it's an attachment junction). Occupied endpoints can't receive a
   * NEW attachment; only free endpoints can. This is DERIVED from coincident
   * endpoints (see connections.recomputeOccupancy), keeping attach/move/import
   * all consistent, exactly like the desktop app.
   */
  hasCircles: [boolean, boolean];
  /**
   * The strand this one was attached to (its `start` is glued to the parent's
   * endpoint), or null for a base strand. Used for the layer naming/lineage that
   * mirrors OSS's `set_count` families — not for movement (movement follows the
   * coincident-point graph, so imported files reconnect too).
   */
  parentId: string | null;
  /** Which side of the parent (0=start, 1=end) this strand's start is glued to. */
  parentSide: 0 | 1 | null;
}

export interface Scene3D {
  /**
   * Strands in stacking order: index 0 is the BOTTOM layer, the last index is
   * the TOP layer (highest Z). This is exactly the OpenStrand layer-panel order,
   * so "Y is above X in the layer panel" becomes "Y sits on top of X in 3D".
   */
  strands: Strand3D[];
  name: string;
}

export function cssColor(c: RGBA): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${(c.a / 255).toFixed(3)})`;
}
