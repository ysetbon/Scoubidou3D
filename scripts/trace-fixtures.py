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
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "node_modules", ".cache", "trace-fixtures.json")
os.chdir(ROOT)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
sys.path.insert(0, os.path.join(ROOT, "public", "mxn", "py"))

import bridge  # noqa: E402

result = json.loads(bridge.generate(2, 1, [1], "lh", "cw"))
traces = {}
for band in ("v", "h"):
    traces[band] = json.loads(bridge.trace_level(1, band))
    t = traces[band]
    print(f"L1 {band}: band={t['band']!r} unavailable={t.get('unavailable')} "
          f"P={t.get('P')} vals={len(t.get('vals') or [])} angles={t.get('nAngles')} "
          f"counts={t.get('counts')}")

json.dump({"result": result, "traces": traces}, open(OUT, "w"))
print("wrote", OUT, os.path.getsize(OUT), "bytes")
print("levels:", [s["level"] for s in result["stages"]])
print("applied L1 ext:", result["rows"][0]["ext"])
