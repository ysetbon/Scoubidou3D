#!/usr/bin/env python3
"""Real cache artifacts, for `npm run qa:cache`.

Runs the engine the way public/mxn/farm-worker.js runs it — generate, then every
level's solution count walked to exact, then both bands of every level censused
— and writes each answer in exactly the shape the farm PUTs to the Worker. What
the QA then drives is the real lab against real precomputed geometry, with only
Cloudflare standing in.

    python3 scripts/cache-fixtures.py       # once, or after an engine change

Writes into node_modules/.cache/, like scripts/semi-fixtures.py: it is 1.5 MB of
JSON that anyone can regenerate in half a minute, which is not a thing to keep in
a repository.
"""
import gzip
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "public", "mxn", "py"))
OUT = os.path.join(ROOT, "node_modules", ".cache", "cache-fixtures")
os.makedirs(OUT, exist_ok=True)

import mxn_continuation_next as NX  # noqa: E402

# Pyodide has no subprocesses, so bridge.py pins the serial path there. Pin it
# here for the same reason docs/mxn-lab.md gives: the parallel path can settle
# on a different combo for the same input, and a fixture that disagrees with the
# browser would be a QA that fails for the wrong reason.
NX._lh._get_cpu_worker_count = lambda _total: 1

import mxn_lh_continuation as _lh  # noqa: E402

_lh.FAST_ANGLE_SCAN = True          # the farm's default, and byte-identical

import bridge  # noqa: E402

bridge.FRAME_MIN_INTERVAL = 1e9     # what the farm sets to stop preview frames

# The oracle sequence from docs/mxn-lab.md: (40,10), (50,60), (60,50), every
# level 16 across and 8 masks. If the fixtures are wrong the QA's own assertions
# will say so, which is why this is the size it is.
M, N, KS = 2, 2, [1, 2, 2]
DESCRIPTOR = {
    "m": M, "n": N, "ks": KS, "hand": "lh", "direction": "cw",
    "shortArms": True, "step": "auto", "budget": 400000,
}
# Mirrors descriptorPath() in src/mxn-lab/cache.ts. The QA seeds the Worker by
# key, so the two have to agree; check-plan.ts is what holds them to it.
KEY = "v2/lh-cw/%dx%d/%s/s1-eauto-b400000" % (M, N, "_".join(map(str, KS)))


def store(name, payload):
    path = os.path.join(OUT, name)
    text = json.dumps(payload, separators=(",", ":"))
    with open(path, "w") as handle:
        handle.write(text)
    print("  %-18s %8d bytes  %7d gzipped" % (name, len(text),
                                              len(gzip.compress(text.encode()))))


started = time.time()
print("2x2 ks %s" % " ".join(map(str, KS)))
result = json.loads(bridge.generate(M, N, KS, "lh", "cw"))
print("  search %.1fs -> %s" % (
    time.time() - started,
    " ".join(str(tuple(row["ext"][0])) for row in result["rows"])))

for meta in result["solutions"]:
    if meta["level"] <= 0:
        continue
    if meta["enumerated"] != "full" and (meta.get("reason") or "").startswith("k=0"):
        continue
    at = time.time()
    reply, spent = None, 0
    while not (reply or {}).get("countExact") and spent < 400000:
        reply = json.loads(bridge.count_solutions(meta["level"], 20000))
        spent += 20000
    meta["count"] = reply["count"]
    meta["countExact"] = reply["countExact"]
    meta["healthy"] = reply["healthy"]
    print("  L%d counted %d rings (%d weaves) in %.1fs"
          % (meta["level"], reply["count"], reply["healthy"], time.time() - at))

store("run.json", {
    "kind": "run", "cacheVersion": "v2", "descriptor": DESCRIPTOR,
    "computedAt": "2026-08-12T00:00:00Z",
    "seconds": round(time.time() - started, 1), "runner": "fixtures",
    "result": result,
})

for level in range(1, len(KS) + 1):
    for band in ("h", "v"):
        at = time.time()
        plan = json.loads(bridge.trace_plan(level, band))
        census = plan if plan.get("unavailable") else json.loads(
            bridge.trace_census(level, band))
        store("trace-L%d-%s.json" % (level, band), {
            "kind": "trace", "cacheVersion": "v2", "descriptor": DESCRIPTOR,
            "level": level, "band": band,
            "computedAt": "2026-08-12T00:00:00Z",
            "seconds": round(time.time() - at, 1), "runner": "fixtures",
            "plan": plan, "census": census,
        })

with open(os.path.join(OUT, "index.json"), "w") as handle:
    json.dump({
        "key": KEY,
        "descriptor": DESCRIPTOR,
        "run": "run.json",
        "traces": {"%d:%s" % (level, band): "trace-L%d-%s.json" % (level, band)
                   for level in range(1, len(KS) + 1) for band in ("h", "v")},
    }, handle, indent=1)

print("wrote %s in %.1fs" % (OUT, time.time() - started))
