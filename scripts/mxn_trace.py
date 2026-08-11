"""Instrumented twin of the MXN band search, for seeing what the real one does.

The production search exits the moment a test fails and never visits angles
outside the +/-20 degree window, so most of its work is invisible. This module
runs the same tests in the same order over a WIDER angle sweep and records a
verdict for every (combo, angle) pair instead of stopping at the first failure.
Nothing is skipped -- a skip is recorded as a verdict and the evaluation
continues -- so the trace is a complete census of the search space.

Verdicts, in the order the engine tests them:

    WINDOW   angle lies outside the +/-20 degree window; production never tries it
    REACH    a strand cannot reach its target at this angle (projection <= 10)
    DEGEN    a strand's line collapsed (length < 0.001)
    ORDER    gaps do not all share a sign: the strands run out of order
    OVERLAP  a gap is below min_gap -- the strands are too close to fit
    TOOFAR   a gap is above max_gap -- the band has pulled apart
    VALID    every test passed
    BEST     the VALID entry the engine's ranking actually selects

Not part of the shipped engine. Import it or run it; it changes nothing.
"""
import copy
import math
import os
import sys

import numpy as np

PY_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "..", "public", "mxn", "py")
sys.path.insert(0, os.path.abspath(PY_DIR))

import mxn_lh_continuation as L          # noqa: E402
import mxn_continuation_next as NX       # noqa: E402

WINDOW, REACH, DEGEN, ORDER, OVERLAP, TOOFAR, VALID, BEST = range(8)
NAMES = ["WINDOW", "REACH", "DEGEN", "ORDER", "OVERLAP", "TOOFAR", "VALID", "BEST"]

# Half-width of the swept range. The engine uses 20; sweeping wider is what
# makes the WINDOW verdict visible rather than merely asserted.
SWEEP_HALF_WIDTH = 40.0


def capture_bands(m, n, ks, direction="cw"):
    """Run a real generate and keep the inputs of every band search it performs."""
    NX._lh._get_cpu_worker_count = lambda _total: 1     # serial, as Pyodide is
    import bridge

    grabbed = []
    real = L._search_combo_space_cpu

    def hook(strands_list, pairs, pair_directions, pair_originals, ext_range_values,
             angle_step_degrees, max_extension, strand_width,
             custom_angle_min, custom_angle_max, angle_mode,
             on_config_callback=None, direction_type="horizontal",
             num_opposite_pairs=1):
        grabbed.append({
            "strands_list": copy.deepcopy(strands_list),
            "pair_indices": L._encode_pair_indices(strands_list, pairs),
            "pair_directions": copy.deepcopy(pair_directions),
            "pair_originals": copy.deepcopy(pair_originals),
            "ext_range_values": list(ext_range_values),
            "angle_step_degrees": angle_step_degrees,
            "max_extension": max_extension,
            "strand_width": strand_width,
            "angle_mode": angle_mode,
            "num_opposite_pairs": num_opposite_pairs,
            "direction_type": direction_type,
            "num_strands": len(strands_list),
            "pairs_n": len(pairs),
        })
        return real(strands_list, pairs, pair_directions, pair_originals,
                    ext_range_values, angle_step_degrees, max_extension,
                    strand_width, custom_angle_min, custom_angle_max, angle_mode,
                    on_config_callback, direction_type, num_opposite_pairs)

    L._search_combo_space_cpu = hook
    try:
        bridge.generate(m, n, ks, "lh", direction)
    finally:
        L._search_combo_space_cpu = real

    # A level runs each band more than once; identical inputs are the same search.
    unique, seen = [], set()
    for band in grabbed:
        key = (band["direction_type"], band["num_strands"], band["pairs_n"],
               tuple(band["ext_range_values"]),
               tuple(sorted((s["original_start"]["x"], s["original_start"]["y"])
                            for s in band["strands_list"])))
        if key not in seen:
            seen.add(key)
            unique.append(band)
    return unique


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
    """Every test, every angle, no early exit. Returns per-angle verdicts + geometry."""
    n = len(strands)
    min_gap = band["strand_width"] + 10
    max_gap = band["strand_width"] * 1.5

    starts = np.array([[s["original_start"]["x"], s["original_start"]["y"]] for s in strands])
    targets = np.array([[s["target_position"]["x"], s["target_position"]["y"]] for s in strands])
    d = targets - starts
    ref = math.atan2(d[0, 1], d[0, 0])
    goes_pos = (d[:, 0] * math.cos(ref) + d[:, 1] * math.sin(ref)) >= 0

    ar = np.radians(np.asarray(angles_deg, dtype=float))
    sa = np.where(goes_pos[:, None], ar[None, :], ar[None, :] + math.pi)
    cs, sn = np.cos(sa), np.sin(sa)
    proj = d[:, 0:1] * cs + d[:, 1:2] * sn                    # (N, A)

    ldx, ldy = proj * cs, proj * sn
    ll = np.abs(proj)
    inv = np.where(ll > 1e-3, 1.0 / np.where(ll > 1e-3, ll, 1.0), 0.0)
    lc = (starts[:, 0:1] + ldx) * starts[:, 1:2] - (starts[:, 1:2] + ldy) * starts[:, 0:1]

    vx = (starts[1:, 0] - starts[:-1, 0])[:, None]
    vy = (starts[1:, 1] - starts[:-1, 1])[:, None]
    signed = (ldy[:-1] * vx - ldx[:-1] * vy) * inv[:-1]
    flip = np.where(np.arange(n - 1) % 2 == 1, -1.0, 1.0)[:, None]
    signed = signed * flip
    gaps = np.abs(signed)

    lvx = starts[-1, 0] - starts[0, 0]
    lvy = starts[-1, 1] - starts[0, 1]
    last_sg = (ldy[0] * lvx - ldx[0] * lvy) * inv[0]

    verdicts = np.full(len(angles_deg), VALID, dtype=np.int8)
    verdicts[~np.all(ll >= 1e-3, axis=0)] = DEGEN
    bad_order = ~np.where(last_sg >= 0, np.all(signed > 0, axis=0),
                          np.all(signed < 0, axis=0))
    verdicts[(verdicts == VALID) & bad_order] = ORDER
    verdicts[(verdicts == VALID) & np.any(gaps > max_gap, axis=0)] = TOOFAR
    verdicts[(verdicts == VALID) & np.any(gaps < min_gap, axis=0)] = OVERLAP
    verdicts[~np.all(proj > 10, axis=0)] = REACH          # tested first, so last written

    return {
        "verdicts": verdicts,
        "gaps": gaps,
        "first_last": np.abs(last_sg),
        "variance": np.var(gaps, axis=0),
        "starts": starts,
        "ends": starts[:, :, None] + np.stack([ldx, ldy], axis=1),
        "min_gap": min_gap,
        "max_gap": max_gap,
    }


def trace_band(band, progress=None):
    """Full census of one band: every combo, every angle, wide sweep."""
    import itertools
    vals = band["ext_range_values"]
    P = band["pairs_n"]
    step = band["angle_step_degrees"]

    combos = list(itertools.product(vals, repeat=P))

    rows = []
    for i, combo in enumerate(combos):
        strands = place(band, list(combo))
        lo, hi = window_for(band, strands)
        # The engine's own in-window grid, so in-window verdicts match it exactly,
        # flanked by the same step continued outside the window. Those flanks are
        # the angles production never reaches; they get a WINDOW verdict rather
        # than being left out, which is the point of the trace.
        inside = np.asarray(L._build_angle_values(lo, hi, step), dtype=float)
        left = np.arange(inside[0] - step, lo - SWEEP_HALF_WIDTH, -step)[::-1]
        right = np.arange(inside[-1] + step, hi + SWEEP_HALF_WIDTH, step)
        angles = np.round(np.concatenate([left, inside, right]), 6)
        res = sweep_combo(band, strands, angles)
        outside = np.ones(len(angles), dtype=bool)
        outside[len(left):len(left) + len(inside)] = False
        res["verdicts"][outside] = WINDOW          # recorded, not skipped

        inwin_valid = np.where(res["verdicts"] == VALID)[0]
        best = None
        if len(inwin_valid):
            order = np.lexsort((inwin_valid,
                                res["variance"][inwin_valid],
                                res["first_last"][inwin_valid]))
            best = int(inwin_valid[order[0]])
            res["verdicts"][best] = BEST
        rows.append({
            "combo": combo, "verdicts": res["verdicts"], "best": best,
            "gaps": res["gaps"], "starts": res["starts"], "ends": res["ends"],
            "first_last": res["first_last"], "variance": res["variance"],
            "window": (lo, hi), "angles": angles,
        })
        if progress and i % 25 == 0:
            progress(i, len(combos))
    return {
        "band": band, "rows": rows,
        "min_gap": band["strand_width"] + 10,
        "max_gap": band["strand_width"] * 1.5,
    }


if __name__ == "__main__":
    m, n = int(sys.argv[1]), int(sys.argv[2])
    ks = [int(x) for x in sys.argv[3].split(",")]
    for b in capture_bands(m, n, ks):
        tr = trace_band(b)
        counts = np.bincount(np.concatenate([r["verdicts"] for r in tr["rows"]]),
                             minlength=8)
        total = int(counts.sum())
        print(f"{b['direction_type']:<11} N={b['num_strands']} P={b['pairs_n']} "
              f"combos={len(tr['rows'])} angles={len(tr['rows'][0]['angles'])} -> {total:,} evaluations")
        for code, cnt in enumerate(counts):
            if cnt:
                print(f"    {NAMES[code]:<8} {cnt:>8,}  {100*cnt/total:5.1f}%")
