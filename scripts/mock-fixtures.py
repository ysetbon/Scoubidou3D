"""Engine payloads for mocks/widgets.html, so the mock shows real output.

The mock mounts the real components; only the worker is a stand-in. These are
what it feeds them: bridge.trace_plan for the band the pending sweep draws, and
a handful of real woven rings for the candidate sheet's tiles.

    python3 scripts/mock-fixtures.py        # -> mocks/fixtures/

Needs numpy for the host Python. Rerun when the plan payload's shape changes.
Committed, unlike scripts/trace-fixtures.py's output, because the mock has to
open on a machine that has never run the engine.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "mocks", "fixtures")
os.chdir(ROOT)
os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, os.path.join(ROOT, "public", "mxn", "py"))

import bridge  # noqa: E402

# Only what the drawing reads. A full strand carries forty fields of editor
# state, which is 4x the bytes for nothing the tiles can show.
KEEP = {"type", "start", "end", "width", "color", "stroke_color", "stroke_width",
        "has_circles", "start_line_visible", "end_line_visible", "layer_name",
        "first_selected_strand", "second_selected_strand", "is_hidden"}

# Cells to weave for the sheet: spread across the extension grid so the tiles
# are visibly different rings rather than one ring eight times.
CELLS = [(0, 0), (4, 8), (8, 4), (12, 12), (16, 6), (20, 20), (6, 16), (10, 2)]


def trim(value):
    if isinstance(value, float):
        return round(value, 2)
    if isinstance(value, dict):
        return {k: trim(v) for k, v in value.items()}
    if isinstance(value, list):
        return [trim(v) for v in value]
    return value


bridge.generate(2, 1, [1], "lh", "cw")

plans = {band: json.loads(bridge.trace_plan(1, band)) for band in ("h", "v")}
for band, plan in plans.items():
    print(f"L1 {band}: P={plan['P']} combos={plan['combos']} "
          f"angles={plan['nAngles']} tests={plan['evaluations']}")
with open(os.path.join(OUT, "trace-plan-l1.json"), "w") as handle:
    json.dump(plans, handle, separators=(",", ":"))

vals = plans["v"]["vals"]
rings = []
for i, (a, b) in enumerate(CELLS):
    woven = json.loads(bridge.trace_weave(1, "v", [vals[a], vals[b]],
                                          146.0 + (i - 4) * 2.5))
    rings.append(trim({
        "ext": woven["ext"], "angle": woven["angle"],
        "across": woven["row"]["across"], "expected": woven["row"]["expected"],
        "healthy": woven["row"]["healthy"],
        "strands": [{k: v for k, v in s.items() if k in KEEP}
                    for s in woven["strands"]],
    }))
with open(os.path.join(OUT, "candidates-l1.json"), "w") as handle:
    json.dump(rings, handle, separators=(",", ":"))

for name in ("trace-plan-l1.json", "candidates-l1.json"):
    print("wrote", os.path.join("mocks", "fixtures", name),
          os.path.getsize(os.path.join(OUT, name)), "bytes")
