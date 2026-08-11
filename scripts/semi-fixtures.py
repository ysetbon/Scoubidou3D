"""Canned near-miss output, so the sort strip can be driven without Pyodide.

Writes exactly what exact-worker.js posts back for a near-miss session:
bridge.generate for the run, bridge.scan_semicomplete for the ⚑ sweep,
bridge.select_semicomplete for the ring the page then draws, and one
bridge.sort_semicomplete per key in bridge.SEMI_KEYS. The QA replays these as
the worker's replies verbatim, so the strip is tested against the orderings the
engine really produces rather than against a hand-written list.

    python3 scripts/semi-fixtures.py         # -> node_modules/.cache/

Needs numpy for the host Python. Regenerate whenever the near-miss payload's
shape or the set of sort keys changes.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "node_modules", ".cache", "semi-fixtures.json")
os.chdir(ROOT)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
sys.path.insert(0, os.path.join(ROOT, "public", "mxn", "py"))

import bridge  # noqa: E402

# 3x1 k=1 is the cheapest case with a near-miss list long enough to reorder
# visibly: its V sweep keeps 165 rows, and BEST puts them in a different order
# from NEAR because the worst pair is not the total.
result = json.loads(bridge.generate(3, 1, [1], "lh", "cw"))
scan = json.loads(bridge.scan_semicomplete(1, "v"))
first = json.loads(bridge.select_semicomplete(1, 0))
sorts = {key: json.loads(bridge.sort_semicomplete(1, key)) for key in bridge.SEMI_KEYS}
# Leave the session in the order the scan handed back, so `first` and the reply
# the QA replays for the initial select agree.
bridge.sort_semicomplete(1, scan["key"])

print(f"L1 v sweep: {scan['count']} rows, key={scan['key']!r}, "
      f"grounded={scan['grounded']} refs={scan['refs']}")
for key, payload in sorts.items():
    head = [(sum(r["hExt"]), sum(r["vExt"]), r["peak"], r["deficit"])
            for r in payload["items"][:4]]
    print(f"  {key:>4}: index={payload['index']} head(H,V,peak,deficit)={head}")

json.dump({"result": result, "scan": scan, "first": first, "sorts": sorts},
          open(OUT, "w"))
print("wrote", OUT, os.path.getsize(OUT), "bytes")
