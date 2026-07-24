// Import an OpenStrand Studio / OpenStrandJS save file (.json) into a Scene3D.
//
// Those files serialize a `strands` array, each with start/end/control_points/
// width/color/etc. (see OpenStrandStudio save_load_manager and OpenStrandJS
// io/saveLoad.ts). We keep the draw order — which is the layer/z order — so the
// stacking in 3D matches the layer panel in the original app. MaskedStrand
// records are flagged and skipped: masking is how the 2D app fakes over/under,
// and in 3D that job is done for real by the Z stack.

import { Point, RGBA, Scene3D, Strand3D } from './types';

interface RawColor {
  r?: number;
  g?: number;
  b?: number;
  a?: number;
}

interface RawStrand {
  type?: string;
  layer_name?: string;
  index?: number;
  start?: Point;
  end?: Point;
  control_points?: [Point, Point] | Point[];
  control_point_center?: Point | null;
  control_point_center_locked?: boolean;
  width?: number;
  stroke_width?: number;
  color?: RawColor;
  stroke_color?: RawColor;
  is_hidden?: boolean;
}

const DEFAULT_COLOR: RGBA = { r: 200, g: 170, b: 230, a: 255 };
const DEFAULT_STROKE: RGBA = { r: 0, g: 0, b: 0, a: 255 };

function color(c: RawColor | undefined, fallback: RGBA): RGBA {
  if (!c) return { ...fallback };
  return {
    r: c.r ?? fallback.r,
    g: c.g ?? fallback.g,
    b: c.b ?? fallback.b,
    a: c.a ?? fallback.a,
  };
}

function point(p: Point | undefined, fallback: Point): Point {
  if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return { ...fallback };
  return { x: p.x, y: p.y };
}

interface RawState {
  step?: number;
  data?: { strands?: RawStrand[] };
}

interface RawFile {
  strands?: RawStrand[];
  states?: RawState[];
  current_step?: number;
}

// OpenStrand files come in two shapes:
//  1. a flat save:     { strands: [...], groups: {} }
//  2. a history file:  { type: "OpenStrandStudioHistory", current_step, states: [{ step, data: { strands } }] }
// Pull the strand array out of whichever we were handed (for history files, the
// state matching current_step, else the last state).
function extractStrands(obj: RawFile): RawStrand[] {
  if (Array.isArray(obj.strands)) return obj.strands;
  if (Array.isArray(obj.states) && obj.states.length > 0) {
    const states = obj.states;
    const match = states.find((s) => s.step === obj.current_step) ?? states[states.length - 1];
    if (Array.isArray(match?.data?.strands)) return match.data!.strands!;
  }
  return [];
}

/** Parse a raw parsed-JSON object (OSS/OpenStrandJS format) into a Scene3D. */
export function sceneFromOss(data: unknown, name = 'imported'): Scene3D {
  const obj = (data ?? {}) as RawFile;
  const raw = extractStrands(obj);
  const strands: Strand3D[] = [];

  raw.forEach((s, i) => {
    const start = point(s.start, { x: 0, y: 0 });
    const end = point(s.end, { x: 100, y: 0 });
    const cps = (s.control_points ?? []) as Point[];
    const cp1 = point(cps[0], start);
    const cp2 = point(cps[1], end);
    const isMask = (s.type ?? 'Strand') === 'MaskedStrand';
    strands.push({
      id: s.layer_name ?? `strand_${i}`,
      start,
      end,
      control_points: [cp1, cp2],
      control_point_center: s.control_point_center ?? null,
      control_point_center_locked: !!s.control_point_center_locked,
      width: typeof s.width === 'number' ? s.width : 46,
      stroke_width: typeof s.stroke_width === 'number' ? s.stroke_width : 4,
      color: color(s.color, DEFAULT_COLOR),
      stroke_color: color(s.stroke_color, DEFAULT_STROKE),
      thickness: null,
      visible: !s.is_hidden && !isMask,
      isMask,
    });
  });

  return { strands, name };
}

/** Parse a JSON string. Throws on malformed JSON. */
export function sceneFromJsonText(text: string, name = 'imported'): Scene3D {
  return sceneFromOss(JSON.parse(text), name);
}
