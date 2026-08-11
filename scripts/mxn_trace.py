"""Offline side of the band-search trace.

The census itself lives in `public/mxn/py/mxn_trace.py`, because Pyodide loads
it for the lab's trace panel. This adds the two things only an offline run
needs: pulling a real generate's band inputs out of the engine, and keeping the
per-combo geometry that the video renderer draws and the panel recomputes in
the page instead of receiving.

    python3 scripts/mxn_trace.py 2 1 1
"""
import copy
import os
import sys

import numpy as np

PY_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                      "..", "public", "mxn", "py"))
sys.path.insert(0, PY_DIR)

import mxn_lh_continuation as L          # noqa: E402
import mxn_continuation_next as NX       # noqa: E402
from mxn_trace import (BEST, DEGEN, NAMES, ORDER, OVERLAP, REACH,  # noqa: E402,F401
                       SWEEP_HALF_WIDTH, TOOFAR, VALID, WINDOW,
                       place, sweep_combo, window_for)


def capture_bands(m, n, ks, direction="cw"):
    """Run a real generate and keep the inputs of every band search it performs."""
    NX._lh._get_cpu_worker_count = lambda _total: 1     # serial, as Pyodide is
    L.FAST_ANGLE_SCAN = True                            # the trace is 2x a search
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


def trace_band(band, progress=None):
    """Census of one band, with the geometry kept for drawing."""
    import itertools
    vals = band["ext_range_values"]
    step = band["angle_step_degrees"]
    combos = list(itertools.product(vals, repeat=band["pairs_n"]))

    rows = []
    for i, combo in enumerate(combos):
        strands = place(band, list(combo))
        lo, hi = window_for(band, strands)
        # The engine's own in-window grid, so in-window verdicts match it
        # exactly, flanked by the same step continued outside. Those flanks are
        # the angles production never reaches; they are marked, not omitted.
        inside = np.asarray(L._build_angle_values(lo, hi, step), dtype=float)
        left = np.arange(inside[0] - step, lo - SWEEP_HALF_WIDTH, -step)[::-1]
        right = np.arange(inside[-1] + step, hi + SWEEP_HALF_WIDTH, step)
        angles = np.round(np.concatenate([left, inside, right]), 6)

        res = sweep_combo(band, strands, angles)
        v = res["verdicts"]
        outside = np.ones(len(angles), dtype=bool)
        outside[len(left):len(left) + len(inside)] = False
        v[outside] = WINDOW

        good = np.where(v == VALID)[0]
        best = None
        if len(good):
            best = int(good[np.lexsort((good, res["variance"][good],
                                        res["first_last"][good]))[0]])
            v[best] = BEST
        rows.append({
            "combo": combo, "verdicts": v, "best": best, "gaps": res["gaps"],
            "starts": res["starts"], "ends": res["ends"],
            "first_last": res["first_last"], "variance": res["variance"],
            "window": (lo, hi), "angles": angles,
        })
        if progress and i % 25 == 0:
            progress(i, len(combos))
    return {"band": band, "rows": rows,
            "min_gap": band["strand_width"] + 10,
            "max_gap": band["strand_width"] * 1.5}


if __name__ == "__main__":
    m, n = int(sys.argv[1]), int(sys.argv[2])
    ks = [int(x) for x in sys.argv[3].split(",")]
    for b in capture_bands(m, n, ks):
        tr = trace_band(b)
        counts = np.bincount(np.concatenate([r["verdicts"] for r in tr["rows"]]),
                             minlength=8)
        total = int(counts.sum())
        print(f"{b['direction_type']:<11} N={b['num_strands']} P={b['pairs_n']} "
              f"combos={len(tr['rows'])} angles={len(tr['rows'][0]['angles'])} "
              f"-> {total:,} evaluations")
        for code, cnt in enumerate(counts):
            if cnt:
                print(f"    {NAMES[code]:<8} {cnt:>8,}  {100*cnt/total:5.1f}%")
