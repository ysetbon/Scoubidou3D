"""Reference verdicts from the Python census, for `npm run check:census`.

src/mxn-lab/trace-census.ts is a port of mxn_trace.sweep_combo: the pending
sweep paints verdicts from it, and the trace panel draws cells with it. A port
that quietly disagrees with the engine would be a widget that lies confidently,
so the two are held to the same answers.

Both sides are run over ONE fixed angle grid -- the probe combo's, the one
trace_plan sends -- rather than the census's per-combo windows. What is being
checked is the arithmetic of the tests, not where the window sits.

    python3 scripts/census-fixtures.py      # -> node_modules/.cache/

Needs numpy for the host Python.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "node_modules", ".cache", "census-check.json")
os.chdir(ROOT)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
sys.path.insert(0, os.path.join(ROOT, "public", "mxn", "py"))

import bridge  # noqa: E402
import mxn_trace  # noqa: E402

import numpy as np  # noqa: E402

bridge.generate(2, 1, [1], "lh", "cw")

cases = {}
for band in ("h", "v"):
    want = bridge._band_name(band)
    entry = bridge._level_session(1)
    data = bridge._trace_band_inputs(entry, want)
    plan = mxn_trace.plan(data)
    angles = [plan["angleFrom"] + (plan["insideFrom"] + j) * plan["step"]
              for j in range(plan["insideCount"])]

    vals, P = plan["vals"], plan["P"]
    rows = []
    combos = len(vals) ** P
    for index in range(combos):
        ext, rest = [0] * P, index
        for p in range(P - 1, -1, -1):
            ext[p] = vals[rest % len(vals)]
            rest //= len(vals)
        swept = mxn_trace.sweep_combo(data, mxn_trace.place(data, ext), angles)
        rows.append([int(v) for v in swept["verdicts"]])
    cases[band] = {"plan": plan, "angles": angles, "verdicts": rows}
    print(f"L1 {band}: {combos} combos x {len(angles)} angles")

with open(OUT, "w") as handle:
    json.dump(cases, handle, separators=(",", ":"))
print("wrote", OUT, os.path.getsize(OUT), "bytes")
