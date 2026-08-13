#!/usr/bin/env python3
"""The census numbers again, with numpy, sharing no code with the TypeScript.

`npm run check:atlas` holds src/mxn-ks/model.ts's census derivation to the
numbers this prints. Two implementations over the same bytes, on purpose: a
fixture produced by the module under test would make that check a tautology, and
this derivation is exactly the kind that is plausible and wrong. Three ways in
particular:

    the angle axis is ragged   a cell's angle is angle0[combo] + i * step, and
                               angle0 moves per combo because the window is
                               recomputed as the arms move
    WINDOW is an over-sweep    the census sweeps 40 degrees past each combo's own
                               window for context; the search never tries those
    BEST is valid              it is the angle the ranking picked, not a separate
                               outcome

Reading numpy indexing wrong in any of those gives an answer that looks fine.

    python3 scripts/ks-census-expect.py

Paste what it prints into EXPECTED_CENSUS in scripts/check-atlas.ts. If these
numbers move without the engine moving, that is the news.
"""
import base64
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE = os.path.join(ROOT, "mocks", "fixtures", "ks-census.json")

VALID, BEST = 6, 7


def derive(census):
    verdicts = np.frombuffer(base64.b64decode(census["verdicts"]), dtype=np.uint8)
    n_angles = int(census["nAngles"])
    combos = verdicts.size // n_angles
    verdicts = verdicts.reshape(combos, n_angles)
    angle0 = np.frombuffer(base64.b64decode(census["angle0"]), dtype="<f4")
    step = float(census["step"])
    vals = np.asarray(census["vals"], dtype=float)
    pairs = int(census["P"])
    grid = vals.size

    good = (verdicts == VALID) | (verdicts == BEST)
    ci, ai = np.nonzero(good)
    if ci.size == 0:
        return None
    angles = angle0[ci] + ai * step

    # Each valid combo's worst pair. The smallest of those is the smallest
    # ceiling the band still works at; the largest is how far valid ever runs.
    peaks = []
    for combo in np.unique(ci):
        rest, worst = int(combo), 0.0
        for _ in range(pairs):
            worst = max(worst, vals[rest % grid])
            rest //= grid
        peaks.append(worst)

    return {
        "combos": int(combos),
        "combosValid": int(np.unique(ci).size),
        "validLo": round(float(angles.min()), 2),
        "validHi": round(float(angles.max()), 2),
        "extCeilingNeeded": float(min(peaks)),
        "extPeakValid": float(max(peaks)),
    }


def main():
    if not os.path.exists(FIXTURE):
        sys.exit("%s is missing — run scripts/ks-fixtures.py first" % FIXTURE)
    with open(FIXTURE) as handle:
        fixture = json.load(handle)

    print("const EXPECTED_CENSUS = {")
    for label, entry in fixture.items():
        for band in ("h", "v"):
            census = entry[band].get("census")
            if not census or census.get("unavailable"):
                continue
            got = derive(census)
            if not got:
                continue
            fields = ", ".join(
                "%s: %s" % (name, int(value) if float(value).is_integer() else value)
                for name, value in got.items())
            print('  "%s.%s": { %s },' % (label, band, fields))
    print("} as Record<string, {")
    print("  combos: number; combosValid: number;")
    print("  validLo: number; validHi: number;")
    print("  extCeilingNeeded: number; extPeakValid: number;")
    print("}>;")


if __name__ == "__main__":
    main()
