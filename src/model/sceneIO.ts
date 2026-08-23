// Reading and writing scenes in Scoubidou3D's own format.
//
// Importing an OpenStrand file (importOss.ts) is lossy in one direction that
// matters: it throws away everything the 3D view adds. A scene you have edited
// here — masks you picked with the Weave tool, per-strand thickness, laces you
// grew with Attach — needs a format of its own to survive a save.
//
// The format is deliberately plain: the Scene3D as-is, plus a tag and a version.
// That makes a saved scene readable, diffable, and easy to paste into samples.ts
// as a new built-in.

import { MaskLink, Point, RGBA, Scene3D, Strand3D } from './types';
import { recomputeOccupancy } from './connections';
import { normalizeLevelBreaks } from './levels';
import { inferTriangleHasMoved, normalizeControlPoints } from './controlPoints';
import { sceneFromOss } from './importOss';

export const SCENE_FORMAT = 'scoubidou3d-scene';
// v2 added `levelBreaks`; v3 added `planes` and `crossPlanes` — where each layer
// and each crossing was PLACED. Every step is additive: an older file loads as a
// scene with nothing placed, and an older reader ignores the fields.
export const SCENE_VERSION = 3;

export interface SceneFile {
  format: typeof SCENE_FORMAT;
  version: number;
  name: string;
  strands: Strand3D[];
  masks: MaskLink[];
  levelBreaks: number[];
  planes?: Record<string, number>;
  crossPlanes?: Record<string, number>;
}

export function sceneToFile(scene: Scene3D): SceneFile {
  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    name: scene.name,
    // Deep-copy so a later edit can't mutate what was saved.
    strands: scene.strands.map(cloneStrand),
    masks: scene.masks.map((m) => ({ overId: m.overId, underId: m.underId })),
    levelBreaks: [...scene.levelBreaks],
    // Omitted entirely when nothing is placed, so a scene nobody has touched
    // saves as the same file it always did.
    ...(scene.planes && Object.keys(scene.planes).length ? { planes: { ...scene.planes } } : {}),
    ...(scene.crossPlanes && Object.keys(scene.crossPlanes).length
      ? { crossPlanes: { ...scene.crossPlanes } }
      : {}),
  };
}

export function sceneToJson(scene: Scene3D): string {
  return JSON.stringify(sceneToFile(scene), null, 2);
}

/**
 * The inverse of `sceneToFile`, for a snapshot WE made: a deep copy straight
 * back, with nothing re-derived and nothing tidied away.
 *
 * `sceneFromFile` below cannot do this job, because it is written for untrusted
 * input — it re-derives endpoint occupancy, drops `isMask`, and normalises a
 * strand that is carrying the leftovers of a drag. All of that is right for a
 * file someone hands us and wrong for undo, where the state going in has to be
 * the state coming out or a step would quietly change the scene it restores.
 */
export function sceneFromSnapshot(file: SceneFile): Scene3D {
  return {
    strands: file.strands.map(cloneStrand),
    masks: file.masks.map((m) => ({ overId: m.overId, underId: m.underId })),
    levelBreaks: [...file.levelBreaks],
    ...(file.planes ? { planes: { ...file.planes } } : {}),
    ...(file.crossPlanes ? { crossPlanes: { ...file.crossPlanes } } : {}),
    name: file.name,
  };
}

function cloneStrand(s: Strand3D): Strand3D {
  return {
    ...s,
    start: { ...s.start },
    end: { ...s.end },
    control_points: [{ ...s.control_points[0] }, { ...s.control_points[1] }],
    control_point_center: s.control_point_center ? { ...s.control_point_center } : null,
    color: { ...s.color },
    stroke_color: { ...s.stroke_color },
    hasCircles: [s.hasCircles[0], s.hasCircles[1]],
  };
}

// ---- reading ---------------------------------------------------------------
// Everything below treats the input as untrusted: a hand-edited file or a
// paste-in should fail with a clear message, never render half a scene.

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function pt(v: unknown, fallback: Point): Point {
  const o = v as Point | undefined;
  if (!o || typeof o.x !== 'number' || typeof o.y !== 'number') return { ...fallback };
  return { x: o.x, y: o.y };
}

function byte(v: unknown, fallback: number): number {
  return Math.max(0, Math.min(255, Math.round(num(v, fallback))));
}

function rgba(v: unknown, fallback: RGBA): RGBA {
  const o = (v ?? {}) as Partial<RGBA>;
  return {
    r: byte(o.r, fallback.r),
    g: byte(o.g, fallback.g),
    b: byte(o.b, fallback.b),
    a: byte(o.a, fallback.a),
  };
}

const FALLBACK_COLOR: RGBA = { r: 200, g: 170, b: 230, a: 255 };
const FALLBACK_STROKE: RGBA = { r: 30, g: 30, b: 30, a: 255 };

function parseStrand(raw: unknown, i: number): Strand3D {
  const s = (raw ?? {}) as Record<string, unknown>;
  const start = pt(s.start, { x: 0, y: 0 });
  const end = pt(s.end, { x: 100, y: 0 });
  const cps = Array.isArray(s.control_points) ? (s.control_points as unknown[]) : [];
  const thickness = s.thickness;
  const strand: Strand3D = {
    id: typeof s.id === 'string' && s.id ? s.id : `strand_${i}`,
    start,
    end,
    control_points: [pt(cps[0], start), pt(cps[1], start)],
    control_point_center: s.control_point_center ? pt(s.control_point_center, start) : null,
    control_point_center_locked: !!s.control_point_center_locked,
    triangleHasMoved:
      typeof s.triangleHasMoved === 'boolean'
        ? s.triangleHasMoved
        : inferTriangleHasMoved({ start, control_points: [pt(cps[0], start), pt(cps[1], start)] }),
    cp2Activated: !!s.cp2Activated,
    width: Math.max(1, num(s.width, 46)),
    stroke_width: Math.max(0, num(s.stroke_width, 4)),
    color: rgba(s.color, FALLBACK_COLOR),
    stroke_color: rgba(s.stroke_color, FALLBACK_STROKE),
    thickness: typeof thickness === 'number' && Number.isFinite(thickness) ? thickness : null,
    visible: s.visible !== false,
    isMask: false,
    hasCircles: [false, false], // re-derived from the geometry below
    parentId: typeof s.parentId === 'string' ? s.parentId : null,
    parentSide: s.parentSide === 0 || s.parentSide === 1 ? s.parentSide : null,
  };
  // A straight strand carrying the leftovers of a drag (circle on the end, a
  // centre at the midpoint) comes back on its default set — same shape, and the
  // handles say the truth about it again.
  normalizeControlPoints(strand);
  return strand;
}

/** Parse Scoubidou3D's own scene format. Throws with a readable reason. */
/**
 * A rung from untrusted input. Whole numbers in `[-2, 2]` and nothing else: the
 * ladder has five rungs, and a file claiming `+9` would put a layer four storeys
 * up with no shelf under it and no way to see what happened.
 */
function rung(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= -2 && value <= 2 ? value : null;
}

/** Placed RUNS, keeping only the ones naming a strand this scene actually has. */
function placed(raw: unknown, has: (id: string) => boolean): { planes: Record<string, number> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const r = rung(value);
    if (r === null || !has(id)) continue;
    out[id] = r;
  }
  return Object.keys(out).length ? { planes: out } : null;
}

/**
 * Placed CROSSINGS. The key is `aId|bId|n|strandId`, and only the strand ids can
 * be checked here — whether crossing `n` of that pair still exists depends on
 * geometry the parser has not built yet. The panel drops the stragglers once it
 * has (see prunePlanes), which is the same thing it does when a strand is moved
 * off a crossing during an edit.
 */
function placedCross(
  raw: unknown,
  ids: Set<string>,
): { crossPlanes: Record<string, number> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const r = rung(value);
    const parts = key.split('|');
    if (r === null || parts.length !== 4) continue;
    if (!ids.has(parts[0]) || !ids.has(parts[1]) || !ids.has(parts[3])) continue;
    if (!/^\d+$/.test(parts[2])) continue;
    out[key] = r;
  }
  return Object.keys(out).length ? { crossPlanes: out } : null;
}

export function sceneFromFile(data: unknown, fallbackName = 'saved scene'): Scene3D {
  const obj = (data ?? {}) as Record<string, unknown>;
  if (!Array.isArray(obj.strands)) throw new Error('no "strands" array');
  const strands = (obj.strands as unknown[]).map(parseStrand);
  if (strands.length === 0) throw new Error('the scene has no strands');

  // Keep only masks that name two different, real strands — a stale id would
  // silently do nothing, which is worse than dropping it.
  const ids = new Set(strands.map((s) => s.id));
  const seen = new Set<string>();
  const masks: MaskLink[] = [];
  for (const raw of Array.isArray(obj.masks) ? (obj.masks as unknown[]) : []) {
    const m = (raw ?? {}) as Partial<MaskLink>;
    if (typeof m.overId !== 'string' || typeof m.underId !== 'string') continue;
    if (m.overId === m.underId || !ids.has(m.overId) || !ids.has(m.underId)) continue;
    const key = `${m.overId}>${m.underId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    masks.push({ overId: m.overId, underId: m.underId });
  }

  const scene: Scene3D = {
    strands,
    masks,
    levelBreaks: normalizeLevelBreaks(obj.levelBreaks, strands.length),
    ...(placed(obj.planes, (id) => ids.has(id)) ?? {}),
    ...(placedCross(obj.crossPlanes, ids) ?? {}),
    name: typeof obj.name === 'string' && obj.name ? obj.name : fallbackName,
  };
  recomputeOccupancy(scene);
  return scene;
}

/**
 * Parse either format from JSON text: one of our own saved scenes, or an
 * OpenStrand Studio / OpenStrandJS file. Picks by the format tag, falling back to
 * OSS since those files carry no tag of their own.
 */
export function parseSceneText(text: string, fallbackName = 'imported'): Scene3D {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`that isn't valid JSON (${(e as Error).message})`);
  }
  const obj = (data ?? {}) as Record<string, unknown>;
  if (obj.format === SCENE_FORMAT) return sceneFromFile(obj, fallbackName);
  // An OpenStrand save has strands with layer_name/type; ours have id.
  const first = Array.isArray(obj.strands) ? (obj.strands[0] as Record<string, unknown>) : null;
  if (first && typeof first.id === 'string' && first.layer_name === undefined) {
    return sceneFromFile(obj, fallbackName);
  }
  return sceneFromOss(data, fallbackName);
}
