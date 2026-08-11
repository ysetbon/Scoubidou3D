"""Canned engine output, so the lab's UI can be driven without Pyodide.

Writes exactly what exact-worker.js posts back: bridge.generate for the run, and
bridge.trace_level for each band of L1. A browser that cannot reach the Pyodide
CDN -- offline, or behind a proxy that will not pass cdn.jsdelivr.net -- still
gets the engine's own payloads, because these come from the same bridge calls
the worker makes.

    python3 scripts/trace-fixtures.py        # -> node_modules/.cache/

Needs numpy for the host Python. Regenerate whenever the trace payload's shape
changes; the QA reads it as the worker's reply verbatim.
"""
import base64
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "node_modules", ".cache", "trace-fixtures.json")
os.chdir(ROOT)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
sys.path.insert(0, os.path.join(ROOT, "public", "mxn", "py"))

import bridge  # noqa: E402

import numpy as np  # noqa: E402

result = json.loads(bridge.generate(2, 1, [1], "lh", "cw"))
traces = {}
plans = {}
weaves = {}
for band in ("v", "h"):
    # The two halves the worker sends: the band's own inputs first, then the
    # census over them. The QA replays both, in that order.
    plans[band] = json.loads(bridge.trace_plan(1, band))
    print(f"L1 {band} plan: combos={plans[band].get('combos')} "
          f"angles={plans[band].get('nAngles')} "
          f"tests={plans[band].get('evaluations')}")
    traces[band] = json.loads(bridge.trace_level(1, band))
    t = traces[band]
    print(f"L1 {band}: band={t['band']!r} unavailable={t.get('unavailable')} "
          f"P={t.get('P')} vals={len(t.get('vals') or [])} angles={t.get('nAngles')} "
          f"counts={t.get('counts')}")
    embedded = t.get("weave")
    print(f"  embedded weave: ext={embedded['ext'] if embedded else None} "
          f"angle={embedded and round(embedded['angle'], 2)}")

    # The weave of the combo the panel lands on: the applied one, at the angle
    # its ranking selects. The QA's fake worker echoes the requested ext/angle
    # onto this payload, so the strands only need to be a real woven ring.
    vals, applied = t["vals"], t["applied"]
    idx = 0
    for e in applied:
        idx = idx * len(vals) + vals.index(float(e))
    angle0 = np.frombuffer(base64.b64decode(t["angle0"]), dtype="<f4")
    best = np.frombuffer(base64.b64decode(t["best"]), dtype="<i2")
    angle = float(angle0[idx] + max(int(best[idx]), 0) * t["step"])
    weaves[band] = json.loads(bridge.trace_weave(1, band, applied, angle))
    w = weaves[band]
    print(f"L1 {band} weave: ext={w['ext']} angle={w['angle']:.2f} "
          f"crossings={w.get('crossings')} healthy={w['row']['healthy']} "
          f"strands={len(w['strands'])}")

json.dump({"result": result, "traces": traces, "plans": plans, "weaves": weaves},
          open(OUT, "w"))
print("wrote", OUT, os.path.getsize(OUT), "bytes")
print("levels:", [s["level"] for s in result["stages"]])
print("applied L1 ext:", result["rows"][0]["ext"])
