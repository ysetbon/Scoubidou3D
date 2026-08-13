#!/usr/bin/env python3
"""Raw cache artifacts for the k atlas, from the real engine.

/mxn/ks/ reads a Cloudflare shelf. Its offline mock reads a dump of one, and the
honest way to produce that dump is `npm run dump:ks` against a Worker that has
actually been swept. This script is the other way in: it runs the engine over a
grid of (m, n, k) and writes each answer in exactly the shape the farm PUTs, so
a dump can be built on a machine with no Worker and no network.

    python3 scripts/ks-fixtures.py            # needs numpy
    npm run dump:ks -- --from node_modules/.cache/ks-raw

**It is interruptible.** Sizes up to 3x3 are done in the first few minutes;
anything involving a 4 is minutes each, because the run itself is a minute and a
half and every band the trace ceiling does NOT refuse costs a level replay on top
of it. The dump script reads whatever raw files are on disk, so stopping this
half way leaves a smaller but perfectly good fixture -- the same bargain
/mxn/gpu/ makes by ordering its queue cheapest first.

Note the second step: this script writes RAW artifacts and derives nothing. All
of the arithmetic that turns a census into an angle range lives in
src/mxn-ks/model.ts and runs exactly once, in the dump script, for both this
source and a real Worker. A fixture derived by a second implementation would
make the mock a lie about the page.

Writes into node_modules/.cache/, like scripts/cache-fixtures.py: it is tens of
megabytes of censuses that anyone can regenerate, which is not a thing to keep
in a repository. The small derived dump is what gets committed.
"""
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "public", "mxn", "py"))
OUT = os.path.join(ROOT, "node_modules", ".cache", "ks-raw")
os.makedirs(OUT, exist_ok=True)

import mxn_continuation_next as NX  # noqa: E402

# Pyodide has no subprocesses, so bridge.py pins the serial path there. Pin it
# here for the reason docs/mxn-lab.md gives: the parallel path can settle on a
# different combo for the same input, and a fixture that disagreed with what a
# browser computes would be a mock that teaches the wrong thing.
NX._lh._get_cpu_worker_count = lambda _total: 1

import mxn_lh_continuation as _lh  # noqa: E402

_lh.FAST_ANGLE_SCAN = True          # the farm's default, and byte-identical

import bridge  # noqa: E402
import mxn_trace  # noqa: E402

bridge.FRAME_MIN_INTERVAL = 1e9     # what the farm sets to stop preview frames

# The narrowest angle grid a census can have: the +/-20 degree window at the
# 0.5 degree step is 81 values, and mxn_trace sweeps SWEEP_HALF_WIDTH past each
# end, so 241 is the count and 200 is a floor that cannot be wrong in the
# direction that matters. Used only to decide that a band is CERTAINLY over the
# ceiling; anything near the line is left to the engine to judge.
ANGLE_FLOOR = 200

HAND, DIRECTION = "lh", "cw"
SHORT_ARMS, STEP, BUDGET = True, "auto", 400000
CACHE_VERSION = "v3"


def k_limits(m, n):
    """Mirrors kLimits in src/mxn-farm/plan.ts."""
    return (-(m - 1), m) if m == n else (-(m + n - 1), m + n)


def descriptor_path(m, n, ks):
    joined = "_".join(str(int(k)) for k in ks)
    flags = "s%d-e%s-b%d" % (1 if SHORT_ARMS else 0, STEP, BUDGET)
    return "%s-%s/%dx%d/%s/%s" % (HAND, DIRECTION, m, n, joined, flags)


def sweep_plan():
    """What to sweep.

    Every k of every size up to 3x3, because that is where the censuses are
    affordable and the censuses are where the angles live. Sizes involving 4 get
    k = 1 only: a 4x4 run is a minute and a half and its trace is refused
    regardless, so more of them would buy nothing but wall time.

    Two multi-level sequences at the end, so the page's level filter has
    something to filter and the oracle from docs/mxn-lab.md is on the shelf.
    """
    jobs = []
    for m in range(1, 4):
        for n in range(1, 4):
            lo, hi = k_limits(m, n)
            for k in range(lo, hi + 1):
                jobs.append((m, n, [k]))
    # 4x4 first of the fours, and not for symmetry: BOTH its bands hold four
    # pairs, so both are refused from the pair count alone and it costs one
    # generate and nothing else. Every other size involving a 4 has one band
    # small enough to trace, and that band buys a full level replay. 4x4 is also
    # the single most interesting point on the page -- it is where the engine
    # picks the ceiling itself -- so an interrupted sweep should have it.
    # Cheapest and most valuable first, which is the farm's own ordering.
    for m, n in [(4, 4), (4, 1), (1, 4), (4, 2), (2, 4), (4, 3), (3, 4)]:
        jobs.append((m, n, [1]))
    jobs.append((2, 2, [1, 2, 2]))
    jobs.append((2, 1, [1, 1, -1]))
    return jobs


def certain_refusal(m, n, band, level):
    """A band the trace ceiling will refuse, worked out without paying for it.

    bridge.trace_plan replays the whole level BEFORE it can report that the
    census is over budget, and for a 4-pair band that replay is a minute and a
    half spent to be told no. The size of the grid is not a mystery, though:
    pick_extension_step gives the combo count from the pair count alone, and the
    angle axis has a floor. Where the product is over the ceiling by a wide
    margin the answer is knowable now.

    Returns the refusal in _over_ceiling's shape, flagged as predicted so
    nothing downstream mistakes it for something the engine said, or None when
    the band is worth actually tracing.
    """
    pairs = n if band == "h" else m          # measured: H holds n pairs, V holds m
    _, combos = NX.pick_extension_step(pairs)
    if combos * ANGLE_FLOOR <= mxn_trace.TRACE_BUDGET:
        return None
    want = "horizontal" if band == "h" else "vertical"
    return {
        "level": level, "band": want, "unavailable": True,
        "predictedRefusal": True,
        "reason": "%d combos x at least %d angles is over the %d trace ceiling"
                  % (combos, ANGLE_FLOOR, mxn_trace.TRACE_BUDGET),
        "combos": combos,
    }


def round_stages(stages):
    """Strand coordinates to two decimals.

    The engine emits them as full doubles -- 526.0879226959953 is sixteen
    characters to place a point on a canvas a few hundred pixels across, where
    two decimals is already finer than a pixel. Nothing else is dropped: every
    remaining field is one drawExactStage actually reads.
    """
    def fix(value):
        if isinstance(value, float):
            return round(value, 2)
        if isinstance(value, dict):
            return {k: fix(v) for k, v in value.items()}
        if isinstance(value, list):
            return [fix(v) for v in value]
        return value
    return fix(stages)


def write(name, payload):
    path = os.path.join(OUT, name)
    with open(path, "w") as handle:
        json.dump(payload, handle, separators=(",", ":"))
    return os.path.getsize(path)


# What npm run check:atlas reads. Deliberately tiny and deliberately RAW: the
# check runs the TypeScript derivation over real census bytes and compares it to
# numbers worked out independently, so it cannot be satisfied by a fixture that
# was produced by the code under test.
#
#   2x1  pins which band holds which pair count -- H gets n = 1, V gets m = 2 --
#        and its H census is one pair over 21 combos, which is 7 kB of base64.
#   2x2  gives the derivation a two-pair band to walk without being large: 441
#        combos over 240 angles.
CHECK_CASES = [
    ("2x1 k=1", 2, 1, [1], "h"),
    ("2x2 k=1", 2, 2, [1], "v"),
]


def write_check_fixture():
    """Lift the small cases out of the raw sweep into a committed fixture."""
    out = {}
    for label, m, n, ks, keep in CHECK_CASES:
        path = descriptor_path(m, n, ks).replace("/", "__")
        entry = {"m": m, "n": n, "k": ks[0]}
        for band in ("h", "v"):
            name = os.path.join(OUT, "trace__%s__L1-%s.json" % (path, band))
            if not os.path.exists(name):
                print("  missing %s -- run the sweep first" % name)
                return
            with open(name) as handle:
                trace = json.load(handle)
            side = {"plan": trace["plan"]}
            # Only the named band keeps its census; the other's plan is all the
            # band-pair pin needs, and a census is megabytes.
            if band == keep:
                side["census"] = trace["census"]
            entry[band] = side
        out[label] = entry
    target = os.path.join(ROOT, "mocks", "fixtures", "ks-census.json")
    with open(target, "w") as handle:
        json.dump(out, handle, separators=(",", ":"))
    print("  %s  %.1f kB" % (target, os.path.getsize(target) / 1024))


def only_filter():
    """`--only <text>` narrows the sweep to labels containing <text>.

    For topping a fixture up without re-walking it: the expensive sizes are
    minutes each and the resume below already skips finished ones, but a plan
    ordered cheapest-first still has to be read through to reach the end of it.
    """
    if "--only" not in sys.argv:
        return None
    at = sys.argv.index("--only")
    return sys.argv[at + 1] if at + 1 < len(sys.argv) else None


def main():
    if "--check-fixture-only" in sys.argv:
        write_check_fixture()
        return
    jobs = sweep_plan()
    geometry = "--geometry" in sys.argv
    wanted = only_filter()
    if wanted:
        jobs = [job for job in jobs
                if wanted in "%dx%d ks=%s" % (job[0], job[1], " ".join(str(k) for k in job[2]))]
        print("  --only %r matched %d job(s)" % (wanted, len(jobs)))
    index = []
    started = time.time()
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for at, (m, n, ks) in enumerate(jobs, 1):
        path = descriptor_path(m, n, ks)
        label = "%dx%d ks=%s" % (m, n, " ".join(str(k) for k in ks))
        file_name = "run__%s.json" % path.replace("/", "__")
        # Resume: a job whose run is already written is done. Same bargain the
        # farm's queue makes -- pushing the same plan twice adds nothing -- and
        # it is what makes the interruptibility above worth anything.
        #
        # Under --geometry a job also owes its geom file, so a sweep run without
        # it once can be topped up with drawings later without recomputing the
        # jobs that already have both.
        geom_name = "geom__%s.json" % path.replace("/", "__")
        owed_geometry = geometry and not os.path.exists(os.path.join(OUT, geom_name))
        if os.path.exists(os.path.join(OUT, file_name)) and not owed_geometry:
            print("  %-22s already stored" % label)
            index.append({"runKey": "run/%s/%s" % (CACHE_VERSION, path), "file": file_name})
            continue
        clock = time.time()
        try:
            result = json.loads(bridge.generate(m, n, ks, hand=HAND, direction=DIRECTION,
                                                prefer_short_arms=SHORT_ARMS))
        except Exception as error:                       # noqa: BLE001
            print("  %-22s FAILED  %s" % (label, error))
            continue
        seconds = round(time.time() - clock, 1)

        # The stages are the strand geometry and are the whole bulk of a run --
        # 28 kB for a 1x1 and 231 kB for a three-level 2x2, against a 1 kB run
        # once they are gone. The grid, the charts and the fit read none of it.
        #
        # With --geometry they are kept, in a file of their own rather than in
        # the run: the atlas wants them for the contact sheet and the filmstrip,
        # and only for a handful of cells, and only when a reader opens one.
        # Keeping them out of the run is what lets the dump stay small enough to
        # load instantly while the drawings arrive on demand.
        stages = result.pop("stages", None)
        if geometry and stages:
            write("geom__%s.json" % path.replace("/", "__"),
                  {"runKey": "run/%s/%s" % (CACHE_VERSION, path), "stages": round_stages(stages)})
        run = {
            "kind": "run", "cacheVersion": CACHE_VERSION,
            "descriptor": {"m": m, "n": n, "ks": ks, "hand": HAND, "direction": DIRECTION,
                           "shortArms": SHORT_ARMS, "step": STEP, "budget": BUDGET},
            "computedAt": stamp,
            "seconds": seconds, "runner": "ks-fixtures.py",
            "result": result,
        }
        entry = {"runKey": "run/%s/%s" % (CACHE_VERSION, path), "file": file_name, "traces": []}

        for level in range(1, len(ks) + 1):
            for band in ("h", "v"):
                # A refused plan is a real answer and is stored as one: "over
                # the trace ceiling" is something a reader should be told rather
                # than left to find out. Where the refusal is certain from the
                # pair count, it is written without paying a replay to hear it.
                plan = certain_refusal(m, n, band, level)
                census = None
                if plan is None:
                    plan = json.loads(bridge.trace_plan(level, band))
                    if not plan.get("unavailable") and not plan.get("overBudget"):
                        census = json.loads(bridge.trace_census(level, band))
                trace = {
                    "kind": "trace", "cacheVersion": CACHE_VERSION,
                    "descriptor": run["descriptor"], "level": level, "band": band,
                    "computedAt": run["computedAt"], "seconds": 0,
                    "runner": "ks-fixtures.py",
                    "plan": plan, "census": census or plan,
                }
                name = "trace__%s__L%d-%s.json" % (path.replace("/", "__"), level, band)
                write(name, trace)
                entry["traces"].append({
                    "key": "trace/%s/%s/L%d-%s" % (CACHE_VERSION, path, level, band),
                    "file": name,
                })

        # The run goes down LAST, so its presence means "this job finished" and
        # the resume above cannot skip a job whose traces were interrupted.
        write(file_name, run)
        index.append(entry)
        print("  %-22s %5.1fs  %2d traces  (%d/%d, %.0fs elapsed)"
              % (label, seconds, len(entry["traces"]), at, len(jobs), time.time() - started))

    write("index.json", {"generatedAt": stamp, "entries": index})
    write_check_fixture()
    print("\n%d runs into %s" % (len(index), OUT))
    print("Now: npm run dump:ks -- --from node_modules/.cache/ks-raw "
          "--out mocks/fixtures/ks-atlas.json")


if __name__ == "__main__":
    main()
