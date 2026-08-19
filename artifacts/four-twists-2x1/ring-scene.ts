// One hand-fitted 2x1 ring, k = -1 four times over, put on its storeys.
//
// The ring came off the MXN lab as an OpenStrand save (ring.json). That file
// knows nothing about levels: the lab draws every round in ONE plane, and
// `sceneFromOss` says so — it hands back `levelBreaks: []`. Its four "levels" are
// four observations of k, not four storeys.
//
// A level in Scoubidou3D is the other thing entirely: a break in the layer stack,
// above which everything rests one storey — TWO strand thicknesses — higher (see
// docs/layer-levels.md). So the ring has to be told where its storeys are, and
// that is most of this file: the block is the ground, and each k = -1 round is
// one storey up, exactly as `swirlStitch` splits its own single continuation off
// its block.
//
// The page imports this and builds in the browser, so what you orbit — and what
// you edit — is the app's own model, not a picture of it.
import { sceneFromOss } from '../../src/model/importOss';
import { collectJunctions } from '../../src/model/connections';
import { Scene3D } from '../../src/model/types';
import RING from './ring.json';

export const PARAMS = RING.params;
export const ROUNDS = RING.params.ks.length;
/** Two arms leaving each lace, every round. */
export const PER_ROUND = 2 * (RING.params.m + RING.params.n);
export const CORDS = RING.params.m + RING.params.n;

type RawStrand = (typeof RING.strands)[number];

/**
 * Which storey a strand belongs on, from its OpenStrand layer name.
 *
 * The lab names a lace's members `set_suffix`. Suffixes 1..3 are the block —
 * the buried strand and the two arms leaving it — and each round after that
 * takes the next PAIR of suffixes: round 1 is `_4`/`_5`, round 2 `_6`/`_7`, and
 * so on. A round is what a level break separates, so the storey is the round.
 */
export function storeyOf(id: string): number {
  const suffix = Number(id.slice(id.lastIndexOf('_') + 1));
  if (!Number.isFinite(suffix) || suffix < 1) throw new Error(`unreadable layer name: ${id}`);
  return suffix <= 3 ? 0 : Math.floor(suffix / 2) - 1;
}

/**
 * Run each block arm out to the round that leaves it.
 *
 * This ring was fitted before extension 0 moved from an arm's TIP to its weave
 * point, so its first round starts 25 to 47 px PAST the tip it hangs off: the
 * arms overlap on the page and the joint looks closed, but the two endpoints are
 * not the same point, so nothing welds there — and with storeys in play the
 * whole block then floats free of everything above it.
 *
 * All six are exactly collinear with the arm they leave — off-axis 0.0000 px —
 * so the joint closes by running the arm out along its own axis to the start
 * already sitting on it. Nothing is bent, nothing is moved sideways, and the
 * round above keeps the position the fit solved for. That is the same dialling
 * out a refit in the lab would do; it happens here so the record in `ring.json`
 * stays exactly as the lab saved it.
 */
function dialArmsOut(raw: RawStrand[]): { strands: RawStrand[]; runs: string[] } {
  const strands = JSON.parse(JSON.stringify(raw)) as RawStrand[];
  const byName = new Map(
    strands.filter((r) => r.type !== 'MaskedStrand').map((r) => [r.layer_name, r]),
  );
  const runs: string[] = [];
  for (const child of strands) {
    if (child.type !== 'AttachedStrand' || !child.attached_to) continue;
    const parent = byName.get(child.attached_to);
    if (!parent) continue;
    const near = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
      Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
    if (near(parent.end, child.start) || near(parent.start, child.start)) continue;

    const vx = parent.end.x - parent.start.x;
    const vy = parent.end.y - parent.start.y;
    const len = Math.hypot(vx, vy);
    if (len === 0) continue;
    const wx = child.start.x - parent.end.x;
    const wy = child.start.y - parent.end.y;
    const offAxis = Math.abs(vx * wy - vy * wx) / len; // how far off the arm's line
    const beyond = (vx * wx + vy * wy) / len; // how far past its tip
    // Only ever run an arm OUT along its own line. A start that is off the axis,
    // or back down the arm, is a different joint than this repair understands —
    // leave it open rather than inventing a weld.
    if (offAxis > 0.5 || beyond <= 0) continue;
    parent.end = { x: child.start.x, y: child.start.y };
    runs.push(`${parent.layer_name}→${child.layer_name} ${beyond.toFixed(1)}px`);
  }
  return { strands, runs };
}

export interface Ring {
  /** The whole ring, storeys and all. */
  scene: Scene3D;
  /** Each strand's storey, by index into `scene.strands`. */
  storey: number[];
  /** Where each storey starts in the stack — which is exactly its level break. */
  breaks: number[];
  /** The block arms run out to their round, for the page to report. */
  runs: string[];
  /** How many separate cords the ring reads as — three, when every joint welds. */
  pieces: number;
  /** Welded joints, and how many the save asked for. */
  joints: { welded: number; declared: number };
}

/** Build the ring: import it, close its joints, and put its storeys in. */
export function buildRing(): Ring {
  const { m, n, ks } = RING.params;
  const dialled = dialArmsOut(RING.strands);
  const scene = sceneFromOss({ strands: dialled.strands }, `${m}x${n} · k = −1 ×${ks.length}`);
  const storey = scene.strands.map((s) => storeyOf(s.id));

  // ---- the checks, because a storey put on wrong still renders --------------
  // A break is a POSITION in the layer stack, so a storey that is not one
  // unbroken run of that stack cannot be expressed as one.
  for (let i = 1; i < storey.length; i++) {
    if (storey[i] < storey[i - 1]) {
      throw new Error(
        `storeys are not in stacking order: ${scene.strands[i - 1].id} (storey ${storey[i - 1]}) ` +
          `is under ${scene.strands[i].id} (storey ${storey[i]})`,
      );
    }
  }
  for (let r = 1; r <= ROUNDS; r++) {
    const arms = storey.filter((s) => s === r).length;
    if (arms !== PER_ROUND) {
      throw new Error(`storey ${r} carries ${arms} arms, expected ${PER_ROUND} for ${m}x${n}`);
    }
  }
  if (storey[storey.length - 1] !== ROUNDS) {
    throw new Error(`the ring stops at storey ${storey[storey.length - 1]}, expected ${ROUNDS}`);
  }
  // Every crossing this ring weaves is between two arms of the SAME round. That
  // is what makes the storeys honest: a mask reaching across a break would be
  // asking two strands a full storey apart to interlock.
  const storeyById = new Map(scene.strands.map((s, i) => [s.id, storey[i]]));
  for (const mask of scene.masks) {
    const a = storeyById.get(mask.overId);
    const b = storeyById.get(mask.underId);
    if (a !== b) {
      throw new Error(`mask ${mask.overId} over ${mask.underId} crosses storeys (${a} vs ${b})`);
    }
  }

  const breaks: number[] = [];
  for (let i = 1; i < storey.length; i++) if (storey[i] !== storey[i - 1]) breaks.push(i);
  scene.levelBreaks = breaks;

  // How much of the ring holds together once the storeys are in. Three cords is
  // the answer for a 2x1; anything else means a joint that should have welded
  // did not, and the page would be showing a ring in pieces without saying so.
  const junctions = collectJunctions(scene);
  const root = scene.strands.map((_, i) => i);
  const find = (a: number): number => {
    while (root[a] !== a) {
      root[a] = root[root[a]];
      a = root[a];
    }
    return a;
  };
  for (const j of junctions) {
    const a = find(j.childIndex);
    const b = find(j.parentIndex);
    if (a !== b) root[b] = a;
  }
  const pieces = new Set(scene.strands.map((_, i) => find(i))).size;
  if (pieces !== CORDS) throw new Error(`the ring reads as ${pieces} pieces, not ${CORDS} cords`);

  return {
    scene,
    storey,
    breaks,
    runs: dialled.runs,
    pieces,
    joints: {
      welded: junctions.length,
      declared: RING.strands.filter((r) => typeof r.attached_to === 'string').length,
    },
  };
}

/**
 * The ring cut after storey `top`. The strands are the SAME objects as the whole
 * ring's, so an edit made while looking at one storey is an edit to the ring.
 * `withLevels: false` is the lab's own reading — every round in one plane.
 */
export function cutTo(ring: Ring, top: number, withLevels = true): Scene3D {
  const cut = ring.storey.filter((s) => s <= top).length;
  const strands = ring.scene.strands.slice(0, cut);
  const ids = new Set(strands.map((s) => s.id));
  return {
    name: `${ring.scene.name} · storey ${top}`,
    strands,
    masks: ring.scene.masks.filter((k) => ids.has(k.overId) && ids.has(k.underId)),
    levelBreaks: withLevels ? ring.breaks.filter((b) => b < cut) : [],
  };
}

/** The arms of one storey, in stacking order — what the arm picker offers. */
export function armsOf(ring: Ring, top: number): string[] {
  return ring.scene.strands.filter((_, i) => ring.storey[i] === top).map((s) => s.id);
}
