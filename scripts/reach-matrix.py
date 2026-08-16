#!/usr/bin/env python3
"""What capping a level at the reach below it costs, over a matrix.

    python3 scripts/reach-matrix.py                 # sides up to 3
    python3 scripts/reach-matrix.py --max-side=4    # overnight

Prints a line per case as it goes, so a long run is readable while it is
still running, and writes the lot to node_modules/.cache/reach-matrix.json
-- the same place scripts/cache-fixtures.py puts its own output, and for the
same reason: it is regenerable measurement, not a thing to keep in a
repository. What belongs in the repository is the CONCLUSION, and that is
the table in docs/mxn-lab.md.

`reach_from_previous` changes which ring a level settles on, so the only
honest way to offer it is to measure it: every case here is run twice, and
what is reported is the pair. Crossings are the thing that must not fall --
arm length and seconds are what it is meant to buy.
"""
import io, json, os, sys, time, contextlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "public", "mxn", "py"))
import mxn_continuation_next as NX          # noqa: E402
NX._lh._get_cpu_worker_count = lambda _total: 1
import bridge                               # noqa: E402
bridge.FRAME_MIN_INTERVAL = 1e9


def kLimits(m, n):
    return (-(m - 1), m) if m == n else (-(m + n - 1), m + n)


# Bounded, and bounded by MEASUREMENT rather than by taste: a 1x3 [-1,-1] pair
# is three minutes and a 1x4 is far worse, so a matrix over the lab's whole
# 4x4 range is an overnight job rather than a check. `--max-side` is how an
# operator asks for the overnight version.
MAX_SIDE = 3
for arg in sys.argv[1:]:
    if arg.startswith("--max-side="):
        MAX_SIDE = int(arg.split("=", 1)[1])

CASES = []
for m in range(1, MAX_SIDE + 1):
    for n in range(1, MAX_SIDE + 1):
        lo, hi = kLimits(m, n)
        for k in (-1, 1):
            if lo <= k <= hi:
                CASES.append((m, n, [k, k]))
print(f"{len(CASES)} cases, sides up to {MAX_SIDE}, each run twice", flush=True)

rows = []
for m, n, ks in CASES:
    line = {"m": m, "n": n, "ks": ks}
    for flag in (False, True):
        t = time.time()
        with contextlib.redirect_stdout(io.StringIO()):
            out = json.loads(bridge.generate(m, n, ks, reach_from_previous=flag))
        key = "on" if flag else "off"
        line[key] = {
            "seconds": round(time.time() - t, 1),
            "across": [r["across"] for r in out["rows"]],
            "expected": out["expected"],
            "total": [sum(v for side in r["ext"] for v in side) for r in out["rows"]],
            "healthy": [r["healthy"] for r in out["rows"]],
        }
    rows.append(line)
    print(json.dumps(line), flush=True)

OUT = os.path.join(ROOT, "node_modules", ".cache", "reach-matrix.json")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as handle:
    json.dump({"maxSide": MAX_SIDE, "rows": rows}, handle, indent=1)
print(f"wrote {OUT}")
