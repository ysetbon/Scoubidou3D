#!/usr/bin/env python3
"""A level fixed by hand is the level everything above it stands on.

    python3 scripts/check-fit-stack.py            # 2x1, three levels, ~30s
    python3 scripts/check-fit-stack.py --big      # adds a 2x2, ~3 minutes

`bridge.fit_weave` weaves a fit and audits it, and that is ALL it does: it
starts from the level's own checkpoint — the ring the run built underneath — so
the fit is a proposal about one level and no level above it ever hears about it.
Fit L1, move to L2, and L2 is still standing on the engine's L1. The two fits
never coexisted in one ring, which makes a judgement saved over both a
description of a stitch nobody ever wove.

`bridge.fit_adopt` is the answer, and this file is what says it works. It makes
the fitted ring the level's ring and rebuilds every level above it from there,
through the same `_grow_levels` that `generate` itself now uses.

Three claims, and they are checked against the engine rather than against each
other:

  1 · FAITHFUL. Adopt the configuration the engine itself chose, and the levels
      above must come back EXACTLY as the run produced them — same crossings,
      same extensions, same strands, hashed. If the rebuild differed here it
      would be searching under different rules from the run it continues, and
      every later claim would be about a different stitch.

  2 · REAL. Adopt a different configuration and the levels above must MOVE. A
      rebuild that quietly replayed the run would pass claim 1 perfectly and be
      worthless, so the two are checked together or neither means anything.

  3 · COMPOSES. Adopt L1, then adopt L2 on top of it, and both must still be
      adopted — L2's own rebuild must not throw L1's ring away. This is the
      whole level-at-a-time workflow at /mxn/fit/: fix L1, then L2, then L3.

And one guard: `rebuild=False` must leave the levels above alone, because that
is the cheap mode the page offers when a reader wants the record without the
wait, and a silent rebuild there would be a very expensive surprise.
"""
import contextlib
import hashlib
import io
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "public", "mxn", "py"))
import mxn_continuation_next as NX          # noqa: E402
# Same pin as scripts/check-l1-replay.py, for the same reason: the parallel
# path can settle on a different combo for the same input, and this test is
# about equality.
NX._lh._get_cpu_worker_count = lambda _total: 1
import bridge                               # noqa: E402

PASS, FAIL = [0], [0]


def check(name, ok, detail=""):
    if ok:
        PASS[0] += 1
        print("  PASS  %s%s" % (name, " — %s" % detail if detail else ""))
    else:
        FAIL[0] += 1
        print("  FAIL  %s%s" % (name, " — %s" % detail if detail else ""))


def quiet(call, *args, **kwargs):
    """The engine prints; this is a test report."""
    with contextlib.redirect_stdout(io.StringIO()):
        return call(*args, **kwargs)


def ring_hash(strands):
    """A ring's geometry, to the micron. Two rings can share an extension
    tuple and differ, so equality is asserted on the strands themselves."""
    digest = hashlib.sha256()
    for strand in sorted(strands, key=lambda s: s["layer_name"]):
        digest.update(strand["layer_name"].encode())
        for point in ("start", "end"):
            spot = strand.get(point) or {}
            digest.update(("%.6f,%.6f" % (spot.get("x", 0), spot.get("y", 0))).encode())
    return digest.hexdigest()[:16]


def rows_by_level(payload):
    return {row["level"]: row for row in payload["rows"]}


def stages_by_level(payload):
    return {stage["level"]: stage for stage in payload["stages"]
            if stage["level"] >= 1}


def band_inputs(level):
    """The plan for a level, and the configuration the engine left it at."""
    plan = json.loads(quiet(bridge.fit_plan, level))
    held = {}
    for key in ("h", "v"):
        side = plan[key]
        if side.get("unavailable"):
            held[key] = (None, None)
        else:
            held[key] = ([float(v) for v in side["applied"]], side["appliedAngle"])
    return plan, held


def run_case(m, n, ks):
    print("\n=========== %dx%d · ks %s ===========" % (m, n, " ".join(map(str, ks))))
    began = time.time()
    run = json.loads(quiet(bridge.generate, m, n, ks, "lh", "cw"))
    print("  the run itself: %.1fs" % (time.time() - began))
    run_rows = rows_by_level(run)
    run_stages = stages_by_level(run)
    top = len(ks)

    # ---------------------------------------------------------------- claim 1
    _plan, held = band_inputs(1)
    began = time.time()
    same = json.loads(quiet(bridge.fit_adopt, 1,
                            held["h"][0], held["h"][1],
                            held["v"][0], held["v"][1]))
    print("  adopting the engine's own L1 and rebuilding above: %.1fs"
          % (time.time() - began))
    check("adopting reports the level it was asked about", same["level"] == 1)
    check("and says it rebuilt", same["rebuilt"] is True)
    check("and lists L1 as adopted", same["adopted"] == [1], str(same["adopted"]))
    check("it returns every level from the adopted one up, and no other",
          sorted(rows_by_level(same)) == list(range(1, top + 1)))

    faithful = rows_by_level(same)
    for level in range(2, top + 1):
        was, now = run_rows[level], faithful[level]
        check("L%d comes back as the run built it" % level,
              was["across"] == now["across"] and was["ext"] == now["ext"],
              "%d/%d ext %s → %d/%d ext %s" % (was["across"], was["expected"],
                                               was["ext"], now["across"],
                                               now["expected"], now["ext"]))
    rebuilt_stages = stages_by_level(same)
    for level in range(2, top + 1):
        check("L%d's ring is the same geometry, hashed" % level,
              ring_hash(run_stages[level]["strands"])
              == ring_hash(rebuilt_stages[level]["strands"]),
              ring_hash(run_stages[level]["strands"]))

    # ---------------------------------------------------------------- claim 2
    #
    # A band moved by 12.5px — off the engine's 10px grid on purpose, because
    # that is what a fit does (docs/mxn-fit.md: the flush answer is at 84.37).
    plan, held = band_inputs(1)
    band = "v" if not plan["v"].get("unavailable") else "h"
    moved = list(held[band][0])
    if not moved:
        print("  (this size has no extension to move at L1; claim 2 skipped)")
        return
    moved[0] = moved[0] + 12.5
    other = "h" if band == "v" else "v"
    args = {band: (moved, held[band][1]), other: held[other]}
    woven = json.loads(quiet(bridge.fit_weave, 1,
                             args["h"][0], args["h"][1],
                             args["v"][0], args["v"][1]))
    changed = json.loads(quiet(bridge.fit_adopt, 1,
                               args["h"][0], args["h"][1],
                               args["v"][0], args["v"][1]))
    check("the adopted L1 row IS the woven L1 row, to the field",
          changed["row"] == woven["row"])
    after = rows_by_level(changed)
    differs = [level for level in range(2, top + 1)
               if run_rows[level]["ext"] != after[level]["ext"]
               or run_rows[level]["across"] != after[level]["across"]]
    check("a different L1 gives different levels above it", bool(differs),
          "moved: %s" % (", ".join("L%d" % level for level in differs) or "none"))

    # ---------------------------------------------------------------- claim 3
    if top >= 3:
        _plan2, held2 = band_inputs(2)
        stacked = json.loads(quiet(bridge.fit_adopt, 2,
                                   held2["h"][0], held2["h"][1],
                                   held2["v"][0], held2["v"][1]))
        check("adopting L2 keeps L1 adopted", stacked["adopted"] == [1, 2],
              str(stacked["adopted"]))
        check("and returns L2 up, leaving the levels below alone",
              sorted(rows_by_level(stacked)) == list(range(2, top + 1)))
        # L1 is still the ring that was adopted: the level below an adopt is
        # never touched, and the run context still carries its row.
        check("L1's row still reads as the ring that was adopted there",
              bridge._SESSION["run"]["rows"][0]["ext"] == changed["row"]["ext"],
              str(bridge._SESSION["run"]["rows"][0]["ext"]))

    # ----------------------------------------------------------------- guard
    before_top = json.dumps(bridge._SESSION["run"]["rows"][-1], sort_keys=True)
    cheap = json.loads(quiet(bridge.fit_adopt, 1,
                             held["h"][0], held["h"][1],
                             held["v"][0], held["v"][1], False))
    check("rebuild=False says so", cheap["rebuilt"] is False)
    check("and it returns the adopted level alone",
          sorted(rows_by_level(cheap)) == [1], str(sorted(rows_by_level(cheap))))
    check("and the levels above are left exactly where they were",
          json.dumps(bridge._SESSION["run"]["rows"][-1], sort_keys=True) == before_top)

    # ---------------------------------------------------------------- claim 4
    #
    # PLACED. A fixed ring is a person's: adopt it with preserve_arms and the
    # levels above must be WELDED AT ITS ARM ENDS, unsearched -- the arms a
    # hand placed come through byte-identical under every level, each new
    # strand starts exactly on one of them, and the level says what it is
    # ("placed at the ring below", knobs at extension 0). This is the report
    # that produced the mode: "keep L1, and L2 starts at the red points".
    plan4, held4 = band_inputs(1)
    band4 = "v" if not plan4["v"].get("unavailable") else "h"
    moved4 = [e + 21.5 for e in held4[band4][0]]
    other4 = "h" if band4 == "v" else "v"
    args4 = {band4: (moved4, held4[band4][1]), other4: held4[other4]}
    woven4 = json.loads(quiet(bridge.fit_weave, 1,
                              args4["h"][0], args4["h"][1],
                              args4["v"][0], args4["v"][1]))
    arm_names = [nm for nm in
                 (plan4["h"].get("names") or []) + (plan4["v"].get("names") or [])]
    red = {s["layer_name"]: (s["end"]["x"], s["end"]["y"])
           for s in woven4["strands"] if s["layer_name"] in arm_names}
    placed = json.loads(quiet(bridge.fit_adopt, 1,
                              args4["h"][0], args4["h"][1],
                              args4["v"][0], args4["v"][1], True, True))
    placed_stages = stages_by_level(placed)
    for lv in range(2, top + 1):
        tips = {s["layer_name"]: (s["end"]["x"], s["end"]["y"])
                for s in placed_stages[lv]["strands"]
                if s["layer_name"] in arm_names}
        check("placed: the fixed arms are byte-identical under L%d" % lv,
              all(tips.get(nm) == red[nm] for nm in red),
              "%d/%d intact" % (sum(tips.get(nm) == red[nm] for nm in red), len(red)))
    starts_on_red = [
        s for s in placed_stages[2]["strands"]
        if s.get("attached_to") in red
        and (s["start"]["x"], s["start"]["y"]) == red[s["attached_to"]]]
    check("placed: every new strand starts exactly on a fixed arm end",
          len(starts_on_red) >= len(red),
          "%d welds on %d arm ends" % (len(starts_on_red), len(red)))
    check("placed: the levels above say what they are",
          all("placed at the ring below" in (r.get("applied") or [])
              for r in placed["rows"] if r["level"] > 1),
          str([r.get("applied") for r in placed["rows"]]))
    check("placed: their knobs open at extension 0",
          all(all(v == 0 for side in r["ext"] for v in side)
              for r in placed["rows"] if r["level"] > 1))


run_case(2, 1, [-1, -1, -1])
if "--big" in sys.argv:
    run_case(2, 2, [1, 1, 1])

print("\n%d passed, %d failed" % (PASS[0], FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
