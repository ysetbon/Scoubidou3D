// The band search's own tests, on the page.
//
// mxn_trace.sweep_combo is the authority; this is the same arithmetic one combo
// at a time. Two callers want it. The finished trace panel draws a cell from
// the census inputs rather than from geometry the census would have had to
// carry. And the pending sweep — the thing on screen while the worker is still
// censusing — runs it over the band's own extension grid, so what it shows is
// the real band failing the real tests rather than a schematic of one.
//
// Geometry is affine in the extensions, which is why this is possible at all:
// `origins`, `directions` and `targets` place every configuration the search
// will ever look at.

// Verdict codes, in the order mxn_trace applies the tests.
export const WINDOW = 0;
export const REACH = 1;
export const DEGEN = 2;
export const ORDER = 3;
export const OVERLAP = 4;
export const TOOFAR = 5;
export const VALID = 6;
export const BEST = 7;

export const VERDICT_COLOUR = [
  "#b0aca0", "#c63c28", "#781414", "#e28a1c",
  "#924ab0", "#3474c4", "#3a9c58", "#d4a81e",
];

// Matches mxn_trace.NAMES, so a payload's own names array and these agree.
export const VERDICT_NAMES = ["WINDOW", "REACH", "DEGEN", "ORDER",
                              "OVERLAP", "TOOFAR", "VALID", "BEST"];

export const VERDICT_BLURB = [
  "outside the ±20° window — the real search never tries it",
  "a strand cannot reach its target at this angle",
  "a strand's line collapsed",
  "the gaps disagree in sign — the strands run out of order",
  "a gap is below the minimum — too close to fit",
  "a gap is above the maximum — the band has pulled apart",
  "every test passed",
  "the angle this combo's ranking selects",
];

/**
 * Everything one band's configurations are affine in.
 *
 * The trace payload and the plan that precedes it both carry exactly this, so
 * the same code draws the pending sweep and the finished panel.
 */
export type TraceInputs = {
  P: number;
  vals: number[];
  nAngles: number;
  step: number;
  minGap: number;
  maxGap: number;
  origins: ([number, number] | null)[][];
  directions: number[][];
  pairIndices: [number, number | null][];
  targets: [number, number][];
};

/** How many combos the census walks: one extension per pair, independently. */
export const comboCount = (inputs: TraceInputs) =>
  inputs.vals.length ** inputs.P;

/** Combo index → the extension each pair takes, as the engine orders them. */
export function comboExt(inputs: TraceInputs, comboIdx: number) {
  const E = inputs.vals.length;
  const ext: number[] = [];
  let rest = comboIdx;
  for (let p = inputs.P - 1; p >= 0; p -= 1) {
    ext[p] = inputs.vals[rest % E];
    rest = Math.floor(rest / E);
  }
  return ext;
}

/** The reverse: where a combo of extensions sits in the census grid. */
export function extCombo(inputs: TraceInputs, ext: number[]) {
  let idx = 0;
  ext.forEach(e => { idx = idx * inputs.vals.length + Math.max(0, inputs.vals.indexOf(e)); });
  return idx;
}

/** mxn_trace.place: each pair's arms slid along their own direction. */
export function placeStarts(inputs: TraceInputs, ext: number[]) {
  const starts: [number, number][] = inputs.targets.map(() => [0, 0]);
  inputs.pairIndices.forEach(([li, ri], p) => {
    const [lnx, lny, rnx, rny] = inputs.directions[p];
    const [lo, ro] = inputs.origins[p];
    if (lo) starts[li] = [lo[0] + ext[p] * lnx, lo[1] + ext[p] * lny];
    if (ri != null && ro) starts[ri] = [ro[0] + ext[p] * rnx, ro[1] + ext[p] * rny];
  });
  return starts;
}

export type Swept = {
  starts: [number, number][];
  ends: [number, number][];
  gaps: number[];
  proj: number[];
  verdict: number;
};

/**
 * mxn_trace.sweep_combo at one angle: where the arms land, the gaps between
 * them, and which test the configuration ends on.
 *
 * The tests are applied in the engine's order — REACH is checked first and so
 * overwrites everything, exactly as the census writes it last.
 */
export function sweepAngle(inputs: TraceInputs, starts: [number, number][],
                           angleDeg: number): Swept {
  const n = starts.length;
  const d = starts.map((s, i) => [inputs.targets[i][0] - s[0],
                                  inputs.targets[i][1] - s[1]]);
  const ref = Math.atan2(d[0][1], d[0][0]);
  const a = (angleDeg * Math.PI) / 180;

  const ends: [number, number][] = [];
  const proj: number[] = [];
  const ld: number[][] = [];
  const inv: number[] = [];
  let degenerate = false;
  let unreachable = false;
  d.forEach((di, i) => {
    const pos = di[0] * Math.cos(ref) + di[1] * Math.sin(ref) >= 0;
    const sa = pos ? a : a + Math.PI;
    const pr = di[0] * Math.cos(sa) + di[1] * Math.sin(sa);
    const dx = pr * Math.cos(sa);
    const dy = pr * Math.sin(sa);
    proj.push(pr);
    ld.push([dx, dy]);
    const ll = Math.abs(pr);
    inv.push(ll > 1e-3 ? 1 / ll : 0);
    if (ll < 1e-3) degenerate = true;
    if (!(pr > 10)) unreachable = true;
    ends.push([starts[i][0] + dx, starts[i][1] + dy]);
  });

  // Signed gaps alternate in the sense the engine reads them; the sign is what
  // ORDER tests and the magnitude is what the gap bounds test.
  const signed: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const vx = starts[i + 1][0] - starts[i][0];
    const vy = starts[i + 1][1] - starts[i][1];
    signed.push((ld[i][1] * vx - ld[i][0] * vy) * inv[i] * (i % 2 === 1 ? -1 : 1));
  }
  const gaps = signed.map(Math.abs);
  const lastSg = (ld[0][1] * (starts[n - 1][0] - starts[0][0])
                  - ld[0][0] * (starts[n - 1][1] - starts[0][1])) * inv[0];
  const badOrder = !(lastSg >= 0
    ? signed.every(s => s > 0)
    : signed.every(s => s < 0));

  let verdict = VALID;
  if (degenerate) verdict = DEGEN;
  if (verdict === VALID && badOrder) verdict = ORDER;
  if (verdict === VALID && gaps.some(g => g > inputs.maxGap)) verdict = TOOFAR;
  if (verdict === VALID && gaps.some(g => g < inputs.minGap)) verdict = OVERLAP;
  if (unreachable) verdict = REACH;

  return { starts, ends, gaps, proj, verdict };
}

export type ComboSweep = {
  ext: number[];
  /** One verdict per angle in `angles`. */
  verdicts: number[];
  angles: number[];
  /** The angle this combo settles on: its first VALID, else the least bad. */
  pick: number;
  swept: Swept;
};

/**
 * One combo against a whole angle grid — the unit of work the census does.
 *
 * `pick` is the angle the drawing lands on. Where the combo has a valid angle
 * that is the census's own answer for it; where it has none, the middle of the
 * grid, because the interesting thing about a failing combo is how it fails
 * across the window rather than at one end of it.
 */
export function sweepCombo(inputs: TraceInputs, comboIdx: number,
                           angles: number[]): ComboSweep {
  const ext = comboExt(inputs, comboIdx);
  const starts = placeStarts(inputs, ext);
  const verdicts = angles.map(angle => sweepAngle(inputs, starts, angle).verdict);
  const valid = verdicts.indexOf(VALID);
  const pick = valid >= 0 ? valid : Math.floor(angles.length / 2);
  return { ext, verdicts, angles, pick,
           swept: sweepAngle(inputs, starts, angles[pick]) };
}
