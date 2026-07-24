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
