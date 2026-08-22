// Rounding the corners where one strand is glued to the next.
//
// A lace is swept by carrying a cross-section along its centreline, with the
// "across" axis taken perpendicular to the local heading. That works as long as
// the heading turns gradually. Where two strands meet at a sharp angle the
// concatenated centreline has a corner, and at a corner the heading changes in a
// single step: the perpendicular swings with it, so the cross-section pivots
// through most of a half-turn between one ring and the next and the ribbon comes
// out wrung — the flat face twisting edge-on and back.
//
// The fix is geometric rather than cosmetic. A real lace cannot turn a corner with
// no radius either — it bends through a bight. So we replace each corner with a
// short curve tangent to the runs on both sides. The heading then rotates over
// many samples instead of one and the cross-section follows it round.
//
// That works while the lace is BENDING. Past about 60° it is no longer bending but
// FOLDING, and a fold is a different thing entirely — see `foldsOf` at the foot of
// this file, and the sweep that builds it in ribbon.ts.

import { Vec3 } from './vec';
import { zTurn } from './zturn';

/** Corners gentler than this are left alone — a sampled curve is a polyline of
 *  very slight corners, and rounding those would soften the curve itself. */
const MIN_TURN = 0.35; // radians, ~20°

/** Sharper than this and the lace is not bending, it is FOLDING — see
 *  `foldsOf`. Well above anything a sampled curve produces. */
const FOLD_TURN = (60 * Math.PI) / 180;

// The corner is swept as a circular arc sampled at EQUAL ANGLES, so the heading
// advances by the same small amount at every step. Sampling by parameter instead
// (a Bezier, say) piles nearly all the rotation into one step at the apex of a
// sharp turn, which is the very thing that wrings the ribbon.
const STEP_ANGLE = (5 * Math.PI) / 180;
const MIN_ARC_STEPS = 6;

function turnAt(pts: Vec3[], i: number): number {
  const ax = pts[i].x - pts[i - 1].x;
  const ay = pts[i].y - pts[i - 1].y;
  const bx = pts[i + 1].x - pts[i].x;
  const by = pts[i + 1].y - pts[i].y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return 0;
  const dot = (ax * bx + ay * by) / (la * lb);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/** Cumulative in-plane length at each vertex. */
function arcOf(pts: Vec3[]): number[] {
  const cum = new Array<number>(pts.length);
  cum[0] = 0;
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return cum;
}

/** The point a given distance along the polyline (z carried along with it). */
function at(pts: Vec3[], cum: number[], s: number): Vec3 {
  if (s <= 0) return { ...pts[0] };
  const last = cum[cum.length - 1];
  if (s >= last) return { ...pts[pts.length - 1] };
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const span = cum[i] - cum[i - 1];
  const t = span > 1e-12 ? (s - cum[i - 1]) / span : 0;
  const a = pts[i - 1];
  const b = pts[i];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function unit(ax: number, ay: number): { x: number; y: number } {
  const l = Math.hypot(ax, ay);
  return l < 1e-12 ? { x: 1, y: 0 } : { x: ax / l, y: ay / l };
}

interface CornerPlan {
  index: number;
  s: number; // arc position of the corner
  turn: number; // deviation from straight, radians
  trim: number; // how far back along each run the arc starts
  radius: number;
}

/**
 * Replace sharp corners with circular arcs tangent to the runs on both sides.
 *
 * `targetRadius` is the bend we would like — half the lace width, so the inner
 * edge just avoids folding through itself. How much of it we get depends on the
 * corner: for a given trim distance T the tangent arc has radius
 * `T * tan((π - turn) / 2)`, which collapses as the turn approaches a full
 * reversal. So the trim needed for the target radius is computed per corner and
 * then clamped to the run actually available — sharper corners borrow more run,
 * and where there isn't enough the bend simply comes out tighter.
 *
 * A tight bend is the honest answer: a flat lace cannot turn 160° in-plane without
 * riding over itself, which is exactly what a real one does at a fold. What must
 * NOT happen is the heading jumping in one step, and that is what this prevents.
 */
export function roundCorners(pts: Vec3[], targetRadius: number): Vec3[] {
  if (pts.length < 3 || targetRadius <= 0) return pts;
  const cum = arcOf(pts);
  const total = cum[cum.length - 1];
  if (total <= 0) return pts;

  const corners: CornerPlan[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const turn = turnAt(pts, i);
    // Folds are left alone: they are creased, not bent (see `foldsOf`). Rounding
    // one would smear the crease into an arc the lace cannot physically make, and
    // would hide the fold from the sweep that knows how to build it.
    if (turn >= MIN_TURN && turn < FOLD_TURN) {
      corners.push({ index: i, s: cum[i], turn, trim: 0, radius: 0 });
    }
  }
  if (corners.length === 0) return pts;

  for (let c = 0; c < corners.length; c++) {
    const k = corners[c];
    // Run available on each side, shared with the neighbouring corner.
    const before = c === 0 ? k.s : (k.s - corners[c - 1].s) / 2;
    const after = c === corners.length - 1 ? total - k.s : (corners[c + 1].s - k.s) / 2;
    const halfAngle = Math.tan((Math.PI - k.turn) / 2); // large when nearly straight
    const wanted = targetRadius / Math.max(halfAngle, 1e-4);
    k.trim = Math.max(0, Math.min(wanted, before * 0.9, after * 0.9));
    k.radius = k.trim * halfAngle;
  }

  const out: Vec3[] = [];
  const push = (p: Vec3) => {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-7 && Math.abs(last.z - p.z) < 1e-7) return;
    out.push(p);
  };

  let cursor = 0; // arc position already emitted
  for (const k of corners) {
    if (k.trim <= 1e-6) continue;
    const sa = k.s - k.trim;
    const sb = k.s + k.trim;
    for (let i = 0; i < pts.length; i++) {
      if (cum[i] > cursor && cum[i] < sa) push(pts[i]);
    }
    const pa = at(pts, cum, sa);
    const pb = at(pts, cum, sb);
    push(pa);

    const din = unit(pts[k.index].x - pts[k.index - 1].x, pts[k.index].y - pts[k.index - 1].y);
    const dout = unit(pts[k.index + 1].x - pts[k.index].x, pts[k.index + 1].y - pts[k.index].y);
    const side = Math.sign(din.x * dout.y - din.y * dout.x) || 1; // which way it bends
    // Centre sits perpendicular to the incoming run, on the inside of the bend.
    const cx = pa.x + -din.y * side * k.radius;
    const cy = pa.y + din.x * side * k.radius;
    const a0 = Math.atan2(pa.y - cy, pa.x - cx);
    const sweep = k.turn * side;
    const steps = Math.max(MIN_ARC_STEPS, Math.ceil(k.turn / STEP_ANGLE));
    for (let n = 1; n < steps; n++) {
      const f = n / steps;
      const ang = a0 + sweep * f;
      push({
        x: cx + Math.cos(ang) * k.radius,
        y: cy + Math.sin(ang) * k.radius,
        z: pa.z + (pb.z - pa.z) * f,
      });
    }
    push(pb);
    cursor = sb;
  }
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] > cursor) push(pts[i]);
  }
  return out.length >= 2 ? out : pts;
}

// ---------------------------------------------------------------------------
// Folds
// ---------------------------------------------------------------------------
//
// A flat lace cannot turn a sharp corner the way a rope can. Bending 155° in its
// own plane would need the inner edge to shrink to nothing, and every attempt to
// draw it that way shows the strain: mitred to a point it throws a spike, cut off
// square it leaves a notch, swept round it pinches shut.
//
// A real lace does something else entirely — it FOLDS. Lay a paper strip down,
// bring it back on itself, and the strip creases along a straight line and comes
// away flat, full width, on the other side. Nothing bends and nothing narrows.
//
// So a fold is not a corner to be finished, it is a straight cut shared by two
// runs. The crease line bisects the two headings (reflecting one onto the other),
// and each run is cut off along it — one line, both cuts, so the two runs mate
// exactly. No gap to notch, no overlap to spike, and the lace keeps its full
// width straight through the fold.
//
// Crucially the lace is NOT severed there. The two cuts are described as a pair
// of cross-sections at the same point, and the sweep carries the surface across
// them (ribbon.ts) — so the fold is a crease in one continuous skin, not a butt
// joint between two pieces with a visible cut between them.

/** The two end faces meeting at a fold. A shear of `d` slides a cross-section
 *  along its run by `d * u`, where `u` is the vertex's offset across the width,
 *  tipping the flat face over onto the crease. Zero is a square face — which is
 *  what a straight-back fold gives, the crease being square to both runs. */
export interface Fold {
  /** Index into the centreline of the vertex the lace folds at. */
  index: number;
  /** Unit headings of the runs arriving at and leaving the fold. */
  din: { x: number; y: number };
  dout: { x: number; y: number };
  /** Unit direction of the crease line itself, in the drawing plane. */
  crease: { x: number; y: number };
  shearIn: number;
  shearOut: number;
}

/** How far a face must tip to lie along the crease `m`. */
function creaseShear(t: { x: number; y: number }, m: { x: number; y: number }): number {
  const den = t.x * m.y - t.y * m.x;
  if (Math.abs(den) < 1e-6) return 0; // crease along the run — no fold after all
  const num = -t.y * m.y - t.x * m.x; // the perpendicular of t, crossed with m
  // A shallow crease would reach a long way back along the run; cap it at a 63°
  // cut, past which the two runs are far enough apart to mitre normally anyway.
  return Math.max(-2, Math.min(2, -num / den));
}

/**
 * Settle the height a lace steps through at each of its folds.
 *
 * A fold doubles the lace back over itself, so the two runs OVERLAP in the
 * drawing plane for a good way past the crease — a strip brought back on itself
 * at 155° covers the run it came off. Held at one height the two bodies pass
 * straight through each other, and the edge of one surfaces through the face of
 * the other as a lump. They have to be STACKED: exactly one thickness apart, the
 * returning run lying on the run it folded off.
 *
 * The weave, which knows nothing of folds, will often want much more than that —
 * the arm of a stitch can come in riding over everything and leave ducking under
 * everything, a drop of two thicknesses. Taking that literally turns the crease
 * into a cliff. So the step is capped at `stack` and the difference is eased back
 * into the runs on either side, over `reach` of in-plane length: the lace ramps to
 * the fold and ramps away from it, which is what it does in the hand.
 *
 * `stack` is how far apart the two runs are left AT the crease, and so it is also
 * the height of the face the fold turns on — the whole of what that turn shows.
 * One thickness is the two runs touching. A fold that also climbs a storey has a
 * storey's worth of step to place, and can carry more of it here rather than ramp
 * it away; see FOLD_STACK in StrandScene.
 */
/**
 * Replace a fold's crease with the storey TURN the Z band lab settled on.
 *
 * `easeFolds` leaves the crease a crease: the two runs are stepped apart at one
 * vertex and whatever the step will not carry is ramped back into them. That is
 * the right shape for a fold with nothing to climb. It is the wrong one the
 * moment there is a storey to make, because the climb then happens over no
 * in-plane length at all — a cliff at a point, which reads as a flat Z.
 *
 * The lab's answer is three pieces, and the middle one alone is not enough:
 *
 *     leg out at the lower storey · half-turn tip of radius step/2 ·
 *     leg back at the upper storey
 *
 * A tip on its own is a knuckle. A plane curve that turns exactly half a turn
 * and rises exactly one storey cannot be much deeper than half that storey at a
 * steady turning rate, so the depth has to be bought with turning that does not
 * rise — and the straight legs are that turning-free depth. See docs/z-lab.md.
 *
 * The turn is fitted so its TIP lands where the crease was: the lace keeps the
 * reach the model gave it, and the turn is cut into the runs either side rather
 * than added on the end of them. A fold without enough straight run to seat the
 * legs is left as it was — better a crease than a turn poking through the weave.
 */
export function zFolds(pts: Vec3[], legLength: number): void {
  const folds = foldsOf(pts);
  if (folds.length === 0) return;

  // Every measurement below comes from `src`, the line as it was before any turn
  // was spliced into it, and every span is settled before the first splice. Both
  // are the fix for the same defect, and it is worth recording what it looked
  // like, because only ONE arm of each lace came out wrong.
  //
  // A turn is not a point. It eats a leg and a tip either side of the crease —
  // about ten samples each on a box stitch — while the folds themselves sit only
  // about fourteen apart. Ten and ten do not fit in fourteen, so consecutive
  // turns overlapped: measured on a two-round box stitch the four turns of one
  // lace tiled it end to end, 13-61, 62-110, 111-159, 160-208, with no run left
  // between any of them. Where two butt straight together the line reverses a
  // half turn in a single step, and the sweep tears there.
  //
  // It showed up as a head-versus-tail split because the splices run last-to-
  // first (a fold's index must not be shifted out from under it): the LAST arm's
  // turn is the outermost one, with open run beyond it, while the FIRST arm's is
  // boxed in by every other turn in the lace — and, reading the live array, it
  // walked its span along turn points, took `dout` off a leg belonging to another
  // C, and had `restore` sample that C's climb as though it were this run's
  // weave.
  //
  // So: neighbours share the run between them at the midpoint, and each turn's
  // legs are sized to the room ITS OWN side actually has. Sizing them together
  // would shorten the outer leg of an outermost fold for no reason and put a
  // notch where the C should grow smoothly out of the run; sized per side, an
  // arm's outer leg keeps its full length and only the crowded side gives way.
  const src = pts.map((q) => ({ ...q }));

  const arc = (from: number, to: number): number => {
    let d = 0;
    for (let i = from; i < to; i++) d += Math.hypot(src[i + 1].x - src[i].x, src[i + 1].y - src[i].y);
    return d;
  };

  const planned = folds.map((f) => {
    const p = src[f.index];
    const zIn = p.zIn ?? p.z;
    const zOut = p.zOut ?? p.z;
    const h = Math.max(Math.abs(zOut - zIn) / 2, 1e-4);
    const span = legLength + h; // leg, then the tip reaching h further

    let lo = f.index;
    for (let d = 0; lo > 0 && d < span; lo--) {
      d += Math.hypot(src[lo].x - src[lo - 1].x, src[lo].y - src[lo - 1].y);
    }
    let hi = f.index;
    for (let d = 0; hi < src.length - 1 && d < span; hi++) {
      d += Math.hypot(src[hi].x - src[hi + 1].x, src[hi].y - src[hi + 1].y);
    }
    return { f, lo, hi, zIn, zOut, h };
  });

  // Which way up the lace arrives at each fold. It starts face-up and every turn
  // rolls it over, so the face alternates down the chain — see TurnOpts.face.
  const face = planned.map((_, k) => (k % 2 === 0 ? 1 : -1));

  for (let k = 0; k < planned.length - 1; k++) {
    const a = planned[k];
    const b = planned[k + 1];
    if (a.hi < b.lo) continue;
    const mid = Math.floor((a.f.index + b.f.index) / 2);
    a.hi = Math.min(a.hi, mid);
    b.lo = Math.max(b.lo, mid + 1);
  }

  // Last to first: each splice changes the length, and folds after the one being
  // replaced would have their indices shifted out from under them. The spans are
  // clear of one another now, so `lo` and `hi` still address the points they did
  // in `src` when this fold's turn goes in.
  for (let k = planned.length - 1; k >= 0; k--) {
    const { f, lo, hi, zIn, zOut, h } = planned[k];
    if (lo >= f.index || hi <= f.index) continue; // no run to seat the legs in
    if (lo < 1 || hi > src.length - 2) continue; // and a neighbour each side to read the heading off
    // The tip reaches `h` along the run before the leg starts, so what is left
    // for the leg is whatever this side has beyond that.
    const legIn = Math.max(0, Math.min(legLength, arc(lo, f.index) - h));
    const legOut = Math.max(0, Math.min(legLength, arc(f.index, hi) - h));

    // Seat the turn on the heading the run ACTUALLY has where it is cut, not on
    // the one it has at the crease. Rounding leaves the last stretch curving
    // slightly, and a leg laid along the crease's heading meets the run at a
    // visible angle — a seam right where the turn is supposed to grow out of it.
    const din = { x: src[lo].x - src[lo - 1].x, y: src[lo].y - src[lo - 1].y };
    const dout = { x: src[hi + 1].x - src[hi].x, y: src[hi + 1].y - src[hi].y };
    const legSteps = 10;
    const turn = zTurn({
      from: { x: src[lo].x, y: src[lo].y },
      din: Math.hypot(din.x, din.y) > 1e-9 ? din : f.din,
      dout: Math.hypot(dout.x, dout.y) > 1e-9 ? dout : f.dout,
      zIn,
      zOut,
      leg: legLength,
      legIn,
      legOut,
      face: face[k],
      legSteps,
    });

    // Give the legs back whatever the WEAVE had put in this stretch.
    //
    // The turn's legs are flat at their storey by construction, and splicing them
    // in wholesale threw away every height the weave had already decided here —
    // including the dip of any crossing that happened to fall inside the length
    // being replaced. Measured on a two-round box stitch that cost two crossings
    // their over/under entirely: the two laces came out at the same height, dead
    // flat through the meeting, passing through each other instead of one going
    // under the other.
    //
    // So each leg point takes the deviation the weave had at the same place along
    // ITS OWN side of the crease. Sides matter: at a dead fold-back the two runs
    // lie on top of each other in plan, and a search over both would draw from
    // whichever run happened to be nearer.
    //
    // Sampled by POSITION and interpolated, not snapped to the nearest original
    // point. Snapping is a staircase by construction — the turn's points and the
    // run's points do not line up, so each one took a neighbour's height whole
    // and the leg came out in visible steps. Catmull-Rom through the samples is
    // C1: the slope matches across every sample, so no step survives into the
    // sweep, which reads the gradient to pitch the ribbon.
    const restore = (
      from: number,
      to: number,
      oFrom: number,
      oTo: number,
      planeZ: number,
      dir: { x: number; y: number },
      /** 0 at the crease end of this leg, 1 at the end that joins the run. */
      weight: (k: number) => number,
    ) => {
      if (oFrom > oTo) return;
      const dl = Math.hypot(dir.x, dir.y) || 1;
      const ux = dir.x / dl;
      const uy = dir.y / dl;
      const ox = src[oFrom].x;
      const oy = src[oFrom].y;
      const along = (q: { x: number; y: number }): number => (q.x - ox) * ux + (q.y - oy) * uy;

      const ss: number[] = [];
      const dv: number[] = [];
      for (let o = oFrom; o <= oTo; o++) {
        ss.push(along(src[o]));
        dv.push(src[o].z - planeZ);
      }
      if (ss.length > 1 && ss[0] > ss[ss.length - 1]) {
        ss.reverse();
        dv.reverse();
      }

      const devAt = (x: number): number => {
        const n = ss.length;
        if (n === 0) return 0;
        if (n === 1 || x <= ss[0]) return dv[0];
        if (x >= ss[n - 1]) return dv[n - 1];
        let j = 0;
        while (j < n - 2 && ss[j + 1] < x) j++;
        const t = (x - ss[j]) / (ss[j + 1] - ss[j] || 1);
        const p0 = dv[Math.max(0, j - 1)];
        const p1 = dv[j];
        const p2 = dv[j + 1];
        const p3 = dv[Math.min(n - 1, j + 2)];
        return (
          0.5 *
          (2 * p1 +
            (-p0 + p2) * t +
            (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
            (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
        );
      };

      for (let k = from; k <= to && k < turn.length; k++) {
        turn[k].z += devAt(along(turn[k])) * weight(k);
      }
    };
    // Taper to nothing at the crease. The TIP is not adjusted — its height is the
    // turn's own — so a leg carrying its full deviation right up to the join left
    // a step between the two: measured at 0.48 of a world unit across a single
    // 0.10 sample, against a thickness of 0.52. A cliff, and the visible one.
    //
    // Tapering is also the truer statement: a crossing's dip belongs to the RUN,
    // and by the crease the lace has committed to the turn. Smoothstep rather
    // than a straight fade so the slope matches at both ends and the sweep, which
    // pitches the ribbon off the gradient, finds nothing to catch on.
    const smooth = (t: number): number => {
      const u = Math.min(1, Math.max(0, t));
      return u * u * (3 - 2 * u);
    };
    // The crease vertex itself is excluded: its `z` is the collapsed mean of the
    // two runs, which is neither leg's height.
    const tail = turn.length - legSteps;
    restore(0, legSteps, lo, f.index - 1, zIn, din, (k) => smooth(1 - k / legSteps));
    restore(tail, turn.length - 1, f.index + 1, hi, zOut, dout,
      (k) => smooth((k - tail) / Math.max(1, legSteps - 1)));

    // Land the turn ON the run it rejoins. The turn is seated exactly where it
    // starts — from `src[lo]`, on the run's own heading — but where it ENDS is
    // wherever the legs put it, and without the lab's crease-walk term that is
    // not on the run: measured 0.29 to 0.37 off, against a run step of ~0.19.
    // The exit HEADING is right (it is built from `dout`), only the landing
    // point misses. Where the next thing along the lace is open run the bridge
    // hides in the first segment; where it is the NEXT TURN'S entry — seated
    // exactly, like every entry — the two meet in a kink of 60-odd degrees,
    // which is what a lace with a fold at each end of a short core showed at
    // its middle, always beside the FIRST fold's C: the lace is walked from
    // the head arm, so the head turn's exit is the one that lands mid-model.
    //
    // So the miss is eased into the second half of the turn, from the apex
    // out, smoothstepped so the slope matches at both ends. The tip keeps the
    // lab's shape and the seam at the apex does not move; only the exit half
    // leans over to arrive at `src[hi]` exactly — in plan, because the run's
    // heights here belong to the weave and `restore` below owns those.
    const last = turn.length - 1;
    const missX = src[hi].x - turn[last].x;
    const missY = src[hi].y - turn[last].y;
    const apex = legSteps + Math.ceil((last - 2 * legSteps) / 2);
    for (let k = apex + 1; k <= last; k++) {
      const u = (k - apex) / (last - apex);
      const w = u * u * (3 - 2 * u);
      turn[k].x += missX * w;
      turn[k].y += missY * w;
    }
    pts.splice(lo, hi - lo + 1, ...turn);
  }
}

/**
 * Half a turn, at a run whose fold partner is not being drawn.
 *
 * A fold belongs to two strands, and so does the turn that makes it: the tip is
 * where they meet, so half the C is this strand's and half is the neighbour's.
 * Hide the neighbour and the whole turn used to vanish, which is wrong twice
 * over — this run really does climb to the apex before anything of the other one
 * begins, and a layer shown on its own should carry the part of the turn that
 * belongs to it.
 *
 * So the run keeps its leg and its quarter-circle up to the apex, and stops
 * there: at the mid-height between the two planes, which is exactly where the
 * neighbour would take over. The seam is the truth of the thing rather than a
 * cut, and `zPartner` is where the hidden run rests, which is still known.
 */
export function zHalfFold(
  pts: Vec3[],
  end: 'start' | 'end',
  zPartner: number,
  legLength: number,
): void {
  const n = pts.length;
  if (n < 3) return;
  const tip = end === 'end' ? n - 1 : 0;
  const step = end === 'end' ? -1 : 1;
  const zIn = pts[tip].z;
  const h = Math.max(Math.abs(zPartner - zIn) / 2, 1e-4);
  const span = legLength + h;

  let lo = tip;
  for (let d = 0; d < span; ) {
    const next = lo + step;
    if (next < 0 || next >= n) break;
    d += Math.hypot(pts[next].x - pts[lo].x, pts[next].y - pts[lo].y);
    lo = next;
  }
  if (Math.abs(lo - tip) < 2) return; // no run to seat a leg in

  const inner = lo + step; // one step further into the run, for the heading
  if (inner < 0 || inner >= n) return;
  const din = { x: pts[inner].x - pts[lo].x, y: pts[inner].y - pts[lo].y };
  if (Math.hypot(din.x, din.y) < 1e-9) return;

  const legSteps = 10;
  const tipSteps = 28;
  const turn = zTurn({
    from: { x: pts[lo].x, y: pts[lo].y },
    din,
    dout: { x: -din.x, y: -din.y },
    zIn,
    zOut: zPartner,
    leg: legLength,
    legSteps,
    tipSteps,
  });
  // Leg, then the tip as far as its apex — half of a half-turn.
  const half = turn.slice(0, legSteps + 1 + Math.round(tipSteps / 2));
  if (half.length < 2) return;

  if (end === 'end') pts.splice(lo, n - lo, ...half);
  else pts.splice(0, tip - lo + 1, ...half.reverse());
}

export function easeFolds(pts: Vec3[], stack: number, reach: number): void {
  const folds = foldsOf(pts);
  if (folds.length === 0 || reach <= 0) return;
  const was = pts.map((p) => p.z); // read heights from before any easing

  for (const f of folds) {
    const i = f.index;
    const zIn = pts[i].zIn ?? was[i];
    const zOut = pts[i].zOut ?? was[i];
    const mid = (zIn + zOut) / 2;
    const half = Math.max(-stack, Math.min(stack, zOut - zIn)) / 2;
    const toIn = mid - half;
    const toOut = mid + half;

    // Ease each side away from the fold, the correction fading out over `reach`.
    rampAway(pts, was, i, -1, toIn - zIn, reach);
    rampAway(pts, was, i, 1, toOut - zOut, reach);

    pts[i].zIn = toIn;
    pts[i].zOut = toOut;
    pts[i].z = mid;
  }
}

/** Walk a correction of `delta` back into the run leaving vertex `i` in direction
 *  `dir`, fading it out over `reach` of in-plane length. Heights are taken from
 *  `was` so several corrections can be planned against the same original run. */
function rampAway(
  pts: Vec3[],
  was: number[],
  i: number,
  dir: -1 | 1,
  delta: number,
  reach: number,
): void {
  if (Math.abs(delta) < 1e-9) return;
  let travelled = 0;
  for (let k = i + dir; k >= 0 && k < pts.length; k += dir) {
    travelled += Math.hypot(pts[k].x - pts[k - dir].x, pts[k].y - pts[k - dir].y);
    if (travelled >= reach) break;
    pts[k].z = was[k] + delta * (1 - travelled / reach);
  }
}

/**
 * Walk a lace up a height step it meets at a GENTLE joint.
 *
 * Two strands glued end to end can rest on different levels — that is what a
 * level break placed between them means. The concatenated centreline then carries
 * the whole step at the shared vertex, in no in-plane length at all.
 *
 * At a FOLD that is exactly right and `easeFolds` keeps it: the lace doubles back
 * and lies on the run it came off, and the crease is where it climbs. A gentle
 * joint has no crease to climb at, so the step has to be walked instead — the
 * joint is levelled to the midpoint and the difference ramped back into the runs
 * on either side, over `reach` of in-plane length. The lace rises to the joint and
 * carries on at the new height, which is what a real one does when it rides up
 * onto the storey below it.
 */
export function easeSteps(pts: Vec3[], reach: number): void {
  if (reach <= 0 || pts.length < 3) return;
  const was = pts.map((p) => p.z);

  for (let i = 1; i < pts.length - 1; i++) {
    const zIn = pts[i].zIn;
    const zOut = pts[i].zOut;
    if (zIn === undefined || zOut === undefined) continue; // not a joint
    if (Math.abs(zOut - zIn) < 1e-9) continue; // no step to walk
    if (turnAt(pts, i) >= FOLD_TURN) continue; // a fold — its crease is the step

    const mid = (zIn + zOut) / 2;
    rampAway(pts, was, i, -1, mid - zIn, reach);
    rampAway(pts, was, i, 1, mid - zOut, reach);
    pts[i].zIn = mid;
    pts[i].zOut = mid;
    pts[i].z = mid;
  }
}

/** Find every fold in a centreline and work out the crease cut at each. */
export function foldsOf(pts: Vec3[], minTurn = FOLD_TURN): Fold[] {
  const out: Fold[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    if (turnAt(pts, i) < minTurn) continue;
    const din = unit(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const dout = unit(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    // The crease bisects the two headings: reflecting the incoming run about it
    // gives the outgoing one. Half the signed turn, so it stays well defined right
    // through a full reversal, where the crease squares up to both runs.
    const a0 = Math.atan2(din.y, din.x);
    let d = Math.atan2(dout.y, dout.x) - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const phi = a0 + d / 2;
    const m = { x: Math.cos(phi), y: Math.sin(phi) };
    out.push({
      index: i,
      din,
      dout,
      crease: m,
      shearIn: creaseShear(din, m),
      shearOut: creaseShear(dout, m),
    });
  }
  return out;
}
