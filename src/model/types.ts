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

  /**
   * OSS `triangle_has_moved` (strand.py). Gates the staged reveal of the control
   * handles: an untouched strand offers only the triangle (control point 1); the
   * circle (control point 2) and the centre square appear once the triangle has
   * been grabbed, and fold away again when the circle is put back on the start.
   */
  triangleHasMoved: boolean;
  /**
   * OSS `control_point2_activated`. While false the circle is PASSIVE — it rides
   * along with the strand's end, so dragging the end keeps the strand straight.
   * Pulling the circle off the end activates it (now independent); dropping it
   * back on the end makes it passive again.
   */
  cp2Activated: boolean;

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

/**
 * An over/under relationship between two strands at their crossing — the 3D
 * meaning of an OpenStrand Studio MaskedStrand. In OSS a MaskedStrand paints its
 * `first_selected_strand` on top of its `second_selected_strand` where they
 * cross (masked_strand.py); here that becomes "at their crossing, `overId` rides
 * over `underId`", and the weave lifts/dips the ribbons to make it real.
 */
export interface MaskLink {
  /** Strand id that rides OVER (OSS first_selected_strand). */
  overId: string;
  /** Strand id that ducks UNDER (OSS second_selected_strand). */
  underId: string;
}

export interface Scene3D {
  /**
   * Strands in stacking order: index 0 is the BOTTOM layer, the last index is
   * the TOP layer (highest Z). This is exactly the OpenStrand layer-panel order,
   * so "Y is above X in the layer panel" becomes "Y sits on top of X in 3D".
   *
   * That order sets the DEFAULT over/under at every crossing (higher layer rides
   * over); `masks` overrides specific crossings, exactly like OSS masks override
   * the natural stacking.
   */
  strands: Strand3D[];
  /** Over/under overrides — the weave's masks. Empty means "stack order decides". */
  masks: MaskLink[];
  /**
   * LEVEL BREAKS — storeys in the layer stack, as positions in `strands`
   * (ascending, duplicates allowed, each in `[0, strands.length]`).
   *
   * A break at `k` lifts every strand from index `k` upward by one full strand
   * thickness, on top of the usual layer-lift spacing. That's the one distance
   * at which a ribbon rests ON another instead of sinking into it, so a break is
   * a real step in the model: below it one storey, above it the next.
   *
   * Empty (the default) means one storey — exactly the old behaviour.
   * See docs/layer-levels.md.
   */
  levelBreaks: number[];
  name: string;
}

/**
 * One entry in the named-sample list — what the dropdown and the browser show.
 *
 * `label` is the full line, and the dropdown needs it: an `<option>` is one
 * string with nowhere to put a second. `cell` is the same scene said short, for
 * a folder that has too many entries to read as prose. A family of a dozen faces
 * is a table, not a list of sentences, so when every entry in a group carries a
 * `cell` the browser draws that group as one — `head` and `note` in the tile,
 * `label` kept whole in its tooltip.
 */
export interface SampleLabel {
  key: string;
  label: string;
  group: string;
  cell?: {
    /** Subdivision heading — one little table per distinct value, in order. */
    band: string;
    /** Row within the band, drawn as the row's axis label on the left. */
    row: string;
    /** The tile's own line: the face, `3×2`. */
    head: string;
    /** The number under it — what tells this face from its neighbours. */
    note: string;
  };
}

export function cssColor(c: RGBA): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${(c.a / 255).toFixed(3)})`;
}
