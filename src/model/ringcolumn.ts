// A column read off the MXN engine's own rings, put on the studio's storeys.
//
// `ysetbon/mxn` takes m, n and one k per level and computes the continuation
// rings (docs/mxn-lab.md). For a 1×1 at k = 1 its Lᵥ rings ARE the twist: each
// level is a stitch of four arms, turned from the one below, and every ring after
// the first is solved for the same gap the box has between its laces. What the
// engine does not know is height — it draws every round in one plane, and
// `sceneFromOss` says as much (`levelBreaks: []`). This file is the other half:
// it reads one stage of an engine run, keeps the engine's geometry EXACTLY (its
// arms, its angles, its weave, nothing re-derived) and says where the storeys are.
//
// The engine rewrites the rounds below it as the column grows — a round that had
// long loose tails is drawn pulled in once another is worked on top of it — so a
// column of N levels is stage N − 1 of the run, not the first N − 1 rounds of a
// longer one. `stages[i]` here is the run's stage i, as it came back.
import { sceneFromOss } from './importOss';
import { Point, RGBA, Scene3D } from './types';

/** The record the engine hands back for one strand, cut down to what the scene needs. */
export interface RingStrand {
  type: string;
  layer_name: string;
  set_number: number;
  start: Point;
  end: Point;
  attached_to?: string | null;
  attachment_side?: number | null;
  width?: number;
}
export interface RingRun {
  source: string;
  params: { m: number; n: number; ks: number[]; hand: string; direction: string };
  stages: Array<{ level: number; strands: RingStrand[] }>;
}

/** Which storey a layer belongs to: `_1`–`_3` are the starting stitch, then two to a round. */
export function ringStorey(id: string): number {
  const layer = Number(id.slice(id.lastIndexOf('_') + 1));
  return layer <= 3 ? 0 : Math.floor(layer / 2) - 1;
}

/**
 * Stage `stage` of a run, as a scene: the engine's rings, one storey each.
 *
 * `hand` mirrors the whole thing across the vertical through the centre, the way
 * `twoFanColumn` makes its right hand — which keeps layer order and so every
 * over and under.
 */
export function ringColumn(
  run: RingRun,
  stage: number,
  name: string,
  palette: { first: RGBA; second: RGBA },
  hand: 'lh' | 'rh' = 'lh',
): Scene3D {
  const raw = run.stages[stage].strands.map((s) => ({
    ...s,
    color: s.set_number === 1 ? palette.first : s.set_number === 2 ? palette.second : undefined,
  }));
  // The engine draws a whole level of arms with one centre; put it on the page's
  // own, so a column sits where the other samples do.
  const ring = raw.filter((s) => s.type !== 'MaskedStrand' && ringStorey(s.layer_name) === 0);
  const xs = ring.flatMap((s) => [s.start.x, s.end.x]);
  const ys = ring.flatMap((s) => [s.start.y, s.end.y]);
  const dx = 400 - (Math.min(...xs) + Math.max(...xs)) / 2;
  const dy = 300 - (Math.min(...ys) + Math.max(...ys)) / 2;
  const move = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  const moved = raw.map((s) => ({ ...s, start: move(s.start), end: move(s.end) }));

  const scene = sceneFromOss({ strands: moved }, name);
  const storey = scene.strands.map((s) => ringStorey(s.id));
  for (let i = 1; i < storey.length; i++) {
    if (storey[i] < storey[i - 1]) {
      throw new Error(`storeys are not in stacking order: ${scene.strands[i - 1].id} is under ${scene.strands[i].id}`);
    }
  }
  const breaks: number[] = [];
  for (let i = 1; i < storey.length; i++) if (storey[i] !== storey[i - 1]) breaks.push(i);
  scene.levelBreaks = breaks;

  if (hand === run.params.hand) return scene;
  const flip = (q: Point): Point => ({ x: 800 - q.x, y: q.y });
  return {
    ...scene,
    strands: scene.strands.map((s) => ({
      ...s,
      start: flip(s.start),
      end: flip(s.end),
      control_points: s.control_points.map(flip) as [Point, Point],
    })),
  };
}
