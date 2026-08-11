"""A census of the band search: every combo, every angle, nothing skipped.

The shipped search exits at the first failed test and never looks outside the
+/-20 degree window, so most of what it decides leaves no trace. This runs the
same tests in the same order over a wider sweep and records a verdict for every
(combo, angle) instead of stopping, which is what the lab's trace panel draws.

Verdicts, in the order the engine applies the tests:

    WINDOW   outside the +/-20 degree window; the real search never tries it
    REACH    a strand cannot reach its target at this angle (projection <= 10)
    DEGEN    a strand's line collapsed (length < 0.001)
    ORDER    the gaps do not share a sign: the strands run out of order
    OVERLAP  a gap is below min_gap -- too close to fit
    TOOFAR   a gap is above max_gap -- the band has pulled apart
    VALID    every test passed
    BEST     the VALID angle this combo's ranking selects

In-window verdicts use the engine's own per-combo angle grid, so the BEST count
equals the number of valid configurations the real search reports.

Only the verdict census crosses the worker boundary. Geometry is affine in the
extensions, so the page recomputes the handful of points it needs to draw from
`origins`, `directions` and `targets` rather than receiving every configuration.
"""
import base64
import itertools
import math

import numpy as np

import mxn_lh_continuation as L

WINDOW, REACH, DEGEN, ORDER, OVERLAP, TOOFAR, VALID, BEST = range(8)
NAMES = ["WINDOW", "REACH", "DEGEN", "ORDER", "OVERLAP", "TOOFAR", "VALID", "BEST"]

# How far past the +/-20 degree window to sweep. What this buys is the WINDOW
# verdict being shown rather than asserted.
SWEEP_HALF_WIDTH = 40.0

# Ceiling on combos x angles for one trace. 3x3 sits near 2.2M and is fine; 4x4
# would be ~46M, which is neither drawable nor worth transferring. Over the
# ceiling the caller is told the real numbers instead of being handed a
# silently subsampled picture.
TRACE_BUDGET = 4_000_000

# How many times at most a census reports where it has got to. Small enough
# that the reporting is free next to the sweep, fine enough that a progress bar
# built out of it moves rather than jumps.
PROGRESS_STEPS = 200


def place(band, combo):
    """Apply one extension combo to the band's strands, as the engine does."""
    strands = [dict(s, original_start=dict(s["original_start"]))
               for s in band["strands_list"]]
    for p, (li, ri) in enumerate(band["pair_indices"]):
        e = combo[p]
        lnx, lny, rnx, rny = band["pair_directions"][p]
        lo, ro = band["pair_originals"][p]
        strands[li]["original_start"] = {"x": lo["x"] + e * lnx, "y": lo["y"] + e * lny}
        if ri is not None and ro is not None:
            strands[ri]["original_start"] = {"x": ro["x"] + e * rnx, "y": ro["y"] + e * rny}
    return strands


def window_for(band, strands):
    adapted = [{"strand": s["strand_4_5"], "start": s["original_start"],
                "target": s["target_position"]} for s in strands]
    _, lo, hi, _ = L._compute_pair_angle_range(
        adapted, band["angle_mode"], num_opposite_pairs=band["num_opposite_pairs"])
    return lo, hi


def sweep_combo(band, strands, angles_deg):
    """Every test at every angle, with no early exit."""
    n = len(strands)
    min_gap = band["strand_width"] + 10
    max_gap = band["strand_width"] * 1.5

    starts = np.array([[s["original_start"]["x"], s["original_start"]["y"]]
                       for s in strands], dtype=float)
    targets = np.array([[s["target_position"]["x"], s["target_position"]["y"]]
                        for s in strands], dtype=float)
    d = targets - starts
    ref = math.atan2(d[0, 1], d[0, 0])
    goes_pos = (d[:, 0] * math.cos(ref) + d[:, 1] * math.sin(ref)) >= 0

    ar = np.radians(np.asarray(angles_deg, dtype=float))
    sa = np.where(goes_pos[:, None], ar[None, :], ar[None, :] + math.pi)
    cs, sn = np.cos(sa), np.sin(sa)
    proj = d[:, 0:1] * cs + d[:, 1:2] * sn

    ldx, ldy = proj * cs, proj * sn
    ll = np.abs(proj)
    inv = np.where(ll > 1e-3, 1.0 / np.where(ll > 1e-3, ll, 1.0), 0.0)
    lc = (starts[:, 0:1] + ldx) * starts[:, 1:2] - (starts[:, 1:2] + ldy) * starts[:, 0:1]

    vx = (starts[1:, 0] - starts[:-1, 0])[:, None]
    vy = (starts[1:, 1] - starts[:-1, 1])[:, None]
    signed = (ldy[:-1] * vx - ldx[:-1] * vy) * inv[:-1]
    signed = signed * np.where(np.arange(n - 1) % 2 == 1, -1.0, 1.0)[:, None]
    gaps = np.abs(signed)

    last_sg = (ldy[0] * (starts[-1, 0] - starts[0, 0])
               - ldx[0] * (starts[-1, 1] - starts[0, 1])) * inv[0]

    verdicts = np.full(len(angles_deg), VALID, dtype=np.uint8)
    verdicts[~np.all(ll >= 1e-3, axis=0)] = DEGEN
    bad_order = ~np.where(last_sg >= 0, np.all(signed > 0, axis=0),
                          np.all(signed < 0, axis=0))
    verdicts[(verdicts == VALID) & bad_order] = ORDER
    verdicts[(verdicts == VALID) & np.any(gaps > max_gap, axis=0)] = TOOFAR
    verdicts[(verdicts == VALID) & np.any(gaps < min_gap, axis=0)] = OVERLAP
    verdicts[~np.all(proj > 10, axis=0)] = REACH      # tested first, so written last

    # ends and gaps are what a renderer needs; census() drops them, the offline
    # video keeps them. Computing them here keeps one copy of the geometry.
    ends = starts[:, :, None] + np.stack([ldx, ldy], axis=1)
    return {"verdicts": verdicts, "first_last": np.abs(last_sg),
            "variance": np.var(gaps, axis=0), "gaps": gaps,
            "starts": starts, "ends": ends}


def plan(band):
    """What the census is about to sweep, without sweeping it.

    Everything here is read off the hooked search itself: the extension grid it
    will walk, its angle step and window, the gap bounds every configuration is
    tested against, and the geometry those configurations are affine in. It
    costs one probe placement, so the page can be handed the band's real
    numbers -- and draw the real sweep -- while the census is still running.

    The geometry keys are named as the packed census names them, because the
    page feeds both to the same drawing code.
    """
    vals = [float(v) for v in band["ext_range_values"]]
    P = band["pairs_n"]
    step = float(band["angle_step_degrees"])

    probe = place(band, [vals[0]] * P)
    lo0, hi0 = window_for(band, probe)
    inside0 = np.asarray(L._build_angle_values(lo0, hi0, step), dtype=float)
    n_left = len(np.arange(inside0[0] - step, lo0 - SWEEP_HALF_WIDTH, -step))
    n_ang = int(n_left + len(inside0) + len(
        np.arange(inside0[-1] + step, hi0 + SWEEP_HALF_WIDTH, step)))
    combos = len(vals) ** P

    return {
        "P": P, "vals": vals, "nAngles": n_ang, "step": step,
        "nStrands": band["num_strands"],
        "minGap": band["strand_width"] + 10,
        "maxGap": band["strand_width"] * 1.5,
        "origins": [[[o["x"], o["y"]] if o else None for o in pair]
                    for pair in band["pair_originals"]],
        "directions": [[float(x) for x in quad] for quad in band["pair_directions"]],
        "pairIndices": [[a, b] for a, b in band["pair_indices"]],
        "targets": [[s["target_position"]["x"], s["target_position"]["y"]]
                    for s in band["strands_list"]],
        # The size of the job, which is the honest answer to "how long": every
        # combo is swept against every angle, and none of it is skipped.
        "combos": int(combos),
        "evaluations": int(combos * n_ang),
        "budget": TRACE_BUDGET,
        "overBudget": bool(combos * n_ang > TRACE_BUDGET),
        # The probe combo's angle grid. Where the window sits shifts a little
        # from combo to combo; its width, and therefore the row length, does not.
        "angleFrom": float(inside0[0] - n_left * step),
        "insideFrom": int(n_left), "insideCount": int(len(inside0)),
        "windowLo": float(lo0), "windowHi": float(hi0),
        "sweepHalfWidth": float(SWEEP_HALF_WIDTH),
    }


def census(band, ahead=None, on_progress=None):
    """Trace one band. Returns a dict ready to be packed for the page.

    `ahead` is a plan() for this band, when the caller has already paid for one.
    `on_progress`, if given, is called as (combos_done, combos_total) a bounded
    number of times, so a caller driving a UI can report where the sweep is
    rather than only that it started.
    """
    vals = [float(v) for v in band["ext_range_values"]]
    P = band["pairs_n"]
    step = band["angle_step_degrees"]
    combos = list(itertools.product(range(len(vals)), repeat=P))

    ahead = ahead or plan(band)
    n_ang = ahead["nAngles"]

    if len(combos) * n_ang > TRACE_BUDGET:
        return {"over_budget": True, "combos": len(combos), "angles": n_ang,
                "budget": TRACE_BUDGET}

    # Progress costs a JSON dump and a postMessage on the other side of the
    # callback, so it is reported on a stride rather than per combo.
    every = max(1, len(combos) // PROGRESS_STEPS)

    verdicts = np.empty((len(combos), n_ang), dtype=np.uint8)
    angle0 = np.empty(len(combos), dtype=np.float32)
    best = np.full(len(combos), -1, dtype=np.int16)

    for ci, idx in enumerate(combos):
        combo = [vals[j] for j in idx]
        strands = place(band, combo)
        lo, hi = window_for(band, strands)
        inside = np.asarray(L._build_angle_values(lo, hi, step), dtype=float)
        left = np.arange(inside[0] - step, lo - SWEEP_HALF_WIDTH, -step)[::-1]
        right = np.arange(inside[-1] + step, hi + SWEEP_HALF_WIDTH, step)
        angles = np.concatenate([left, inside, right])
        # Every combo's window is the same width, so the row length is constant;
        # only where the window sits moves, which angle0 carries.
        if len(angles) != n_ang:
            angles = (np.arange(n_ang) - len(left)) * step + inside[0]
            left_n = len(left)
        else:
            left_n = len(left)

        swept = sweep_combo(band, strands, angles)
        v, fl, var = swept["verdicts"], swept["first_last"], swept["variance"]
        v[:left_n] = WINDOW
        v[left_n + len(inside):] = WINDOW

        good = np.where(v == VALID)[0]
        if len(good):
            pick = int(good[np.lexsort((good, var[good], fl[good]))[0]])
            v[pick] = BEST
            best[ci] = pick
        verdicts[ci] = v
        angle0[ci] = angles[0]
        if on_progress is not None and (ci % every == every - 1
                                        or ci == len(combos) - 1):
            on_progress(ci + 1, len(combos))

    return {
        "over_budget": False,
        "P": P, "vals": vals, "n_angles": int(n_ang), "step": float(step),
        "n_strands": band["num_strands"],
        "min_gap": band["strand_width"] + 10,
        "max_gap": band["strand_width"] * 1.5,
        "verdicts": verdicts, "angle0": angle0, "best": best,
        "origins": band["pair_originals"], "directions": band["pair_directions"],
        "pair_indices": band["pair_indices"],
        "targets": [[s["target_position"]["x"], s["target_position"]["y"]]
                    for s in band["strands_list"]],
    }


def pack(result):
    """JSON-safe payload. The census rides as base64; geometry stays as inputs."""
    if result.get("over_budget"):
        return result
    counts = np.bincount(result["verdicts"].ravel(), minlength=8)
    return {
        "overBudget": False,
        "P": result["P"], "vals": result["vals"],
        "nAngles": result["n_angles"], "step": result["step"],
        "nStrands": result["n_strands"],
        "minGap": result["min_gap"], "maxGap": result["max_gap"],
        "verdicts": base64.b64encode(result["verdicts"].tobytes()).decode("ascii"),
        "angle0": base64.b64encode(
            result["angle0"].astype("<f4").tobytes()).decode("ascii"),
        "best": base64.b64encode(
            result["best"].astype("<i2").tobytes()).decode("ascii"),
        "counts": [int(c) for c in counts],
        "names": NAMES,
        "origins": [[[o["x"], o["y"]] if o else None for o in pair]
                    for pair in result["origins"]],
        "directions": [[float(x) for x in quad] for quad in result["directions"]],
        "pairIndices": [[a, b] for a, b in result["pair_indices"]],
        "targets": result["targets"],
    }
