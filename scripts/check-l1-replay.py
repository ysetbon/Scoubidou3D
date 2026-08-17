#!/usr/bin/env python3
"""A replayed level 1 is the searched level 1, or this must not ship.

    python3 scripts/check-l1-replay.py            # 2x2 and 2x1, ~30s
    python3 scripts/check-l1-replay.py --big      # adds 3x1, ~6 minutes

`bridge.generate(..., level1_pin=…)` pins level 1 to a combo the caller
read off a stored single-k run instead of searching for it. The whole thing
rests on one claim:

    Level 1 depends on nothing but (m, n, ks[0], hand, direction) and the
    search flags — so the L1 of `[k, k, k]` IS the L1 of the stored `[k]`.

That claim is why bridge.generate can already cache `level1_for_k` across the
levels of one run. This asserts it across SEPARATE runs, which is the new part,
and it asserts it on the geometry rather than on the extensions: two rings can
share an extension tuple and differ, so the strands themselves are hashed.

Two things are allowed to differ, and both are asserted rather than excused:

  `enumerated` — a pinned attempt evaluates one combo and so has no candidate
  list, which is L1's solution browser gone from THIS artifact. Checked in both
  directions: a searched level must still enumerate, or the replay is saving
  nothing anybody would have missed.

  `applied` — the audit trail's record of how the ring was found, which is the
  one thing that genuinely changed. A replayed L1 reports `seeded`. Every audit
  NUMBER must still agree exactly.
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
# Pyodide has no subprocesses, so bridge.py pins the serial path there. Pin it
# here for the reason docs/mxn-lab.md gives: the parallel path can settle on a
# different combo for the same input, and this test is about equality.
NX._lh._get_cpu_worker_count = lambda _total: 1
import bridge                               # noqa: E402
bridge.FRAME_MIN_INTERVAL = 1e9

CASES = [(2, 2, -1), (2, 1, -1)]
if "--big" in sys.argv:
    CASES.append((3, 1, -1))

passed = 0
failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  PASS  {name}" + (f" — {detail}" if detail else ""))
    else:
        failed += 1
        print(f"  FAIL  {name}" + (f" — {detail}" if detail else ""))


def run(m, n, ks, **kw):
    started = time.time()
    with contextlib.redirect_stdout(io.StringIO()):
        out = json.loads(bridge.generate(m, n, ks, **kw))
    out["_seconds"] = time.time() - started
    return out


def ring(out, level):
    stage = next(s for s in out["stages"] if s["level"] == level)
    return hashlib.sha256(
        json.dumps(stage["strands"], sort_keys=True).encode()).hexdigest()


ring_hash_of = ring


for m, n, k in CASES:
    print(f"\n=========== {m}x{n} · k = {k} ===========")
    stored = run(m, n, [k])
    l1 = stored["rows"][0]["ext"]
    print(f"  stored [{k}] in {stored['_seconds']:.1f}s, L1 ext {l1}")

    deep = [k, k, k]
    searched = run(m, n, deep)
    replayed = run(m, n, deep, level1_pin=l1)
    print(f"  [{k},{k},{k}] searched {searched['_seconds']:.1f}s"
          f" · replayed {replayed['_seconds']:.1f}s")

    check("the replayed L1 is the searched L1, strand for strand",
          ring(searched, 1) == ring(replayed, 1),
          ring(replayed, 1)[:16])
    check("  and so is every level built on top of it",
          all(ring(searched, lv) == ring(replayed, lv)
              for lv in range(0, len(deep) + 1)),
          f"L0…L{len(deep)}")
    # Every MEASUREMENT, but not `applied`: that field is the record of how the
    # ring was found, and how it was found is the one thing that changed. A
    # replayed L1 reports `seeded`, which is the audit trail working rather
    # than a discrepancy — so it is asserted rather than excused.
    measured = ["level", "k", "expected", "state", "gap", "ext", "across",
                "within", "masks", "stray", "broken", "healthy"]
    check("  and every audit NUMBER agrees",
          all(a[key] == b[key] for a, b in zip(searched["rows"], replayed["rows"])
              for key in measured))
    check("  while the audit trail says the level was seeded",
          replayed["rows"][0]["applied"] == ["seeded"]
          and searched["rows"][0]["applied"] != ["seeded"],
          f"{searched['rows'][0]['applied']} → {replayed['rows'][0]['applied']}")
    check("  and no deeper level's trail changed",
          all(a["applied"] == b["applied"]
              for a, b in zip(searched["rows"][1:], replayed["rows"][1:])))
    check("  and the run says which it was",
          replayed["level1Replayed"] is True
          and searched["level1Replayed"] is False)

    # The one permitted difference, asserted rather than assumed. A square
    # stitch already reports `none` at L1 from the mirror shortcut, so there is
    # nothing to lose there and nothing to assert.
    meta = {out_name: next(x for x in out["solutions"] if x["level"] == 1)
            for out_name, out in (("searched", searched), ("replayed", replayed))}
    if meta["searched"]["enumerated"] == "full":
        check("  the replay costs L1's candidate list, and only that",
              meta["replayed"]["enumerated"] == "none",
              f"{meta['searched']['enumerated']} → {meta['replayed']['enumerated']}")
    else:
        check("  L1 was not browsable either way here (square mirror)",
              meta["replayed"]["enumerated"] == meta["searched"]["enumerated"],
              meta["searched"]["enumerated"])
    check("  and the deeper levels keep theirs",
          all(next(x for x in searched["solutions"] if x["level"] == lv)["enumerated"]
              == next(x for x in replayed["solutions"] if x["level"] == lv)["enumerated"]
              for lv in range(2, len(deep) + 1)))

# ---------------------------------------------------------------------------
# A sequence whose DEEPER levels use a k the first one did not.
#
# This is here because it caught a real bug: the pin's parameter was first
# called `level1_extensions`, which shadowed the module-level function of that
# name — and `generate` calls that function only when a deeper level needs a k
# it has not seen. Every same-k case above passed while `[1, 2, 2]` threw
# `'NoneType' object is not callable`. The oracle sequence from docs/mxn-lab.md
# is exactly that shape, so it is the case that guards it.
print("\n=========== 2x2 · ks = [1, 2, 2] · the oracle ===========")
oracle = run(2, 2, [1, 2, 2])
check("the documented oracle still holds",
      [r["ext"] for r in oracle["rows"]]
      == [[[40, 10], [40, 10]], [[50, 60], [50, 60]], [[60, 50], [60, 50]]],
      str([r["ext"] for r in oracle["rows"]]))

pinned = run(2, 2, [1, 2, 2], level1_pin=oracle["rows"][0]["ext"])
check("  a mixed-k sequence pins L1 without tripping over level1_extensions()",
      pinned["level1Replayed"] is True)
check("  and every level is still the ring the search found",
      all(ring(oracle, lv) == ring(pinned, lv) for lv in range(0, 4)),
      "L0…L3")

# ---------------------------------------------------------------------------
# Adoption: the judged ring AS level 1, no search at all.
#
# The identity is the same one the pin stands on -- the L1 of [k, k] IS the L1
# of [k] -- but adoption goes further: the ring goes in whole, so a hand-fitted
# ring that sits off every grid (62.55 was judged) is stood on rather than
# approximated. Measured on 3x1 [-1,-1,-1]: the shipped search ends 2/12 at
# level 3 in 149s; adopted + hand-grid ends 12/12 in 46s.
print("\n=========== 2x1 · the judged ring adopted as L1 ===========")
donor = run(2, 1, [-1])
ring = {"strands": next(s for s in donor["stages"] if s["level"] == 1)["strands"],
        "h_ext": donor["rows"][0]["ext"][0], "v_ext": donor["rows"][0]["ext"][1]}
adopted = run(2, 1, [-1, -1], level1_ring=bridge.l1_ring_from_json(json.dumps(ring)))
check("the adopted L1 is the donor ring, strand for strand",
      ring_hash_of(adopted, 1) == hashlib.sha256(
          json.dumps(ring["strands"], sort_keys=True).encode()).hexdigest(),
      ring_hash_of(adopted, 1)[:16])
check("  the run says it adopted", adopted["level1Adopted"] is True
      and adopted["level1AdoptFailed"] is False)
check("  the audit trail reads 'judged ring' on L1 and only L1",
      adopted["rows"][0]["applied"] == ["judged ring"]
      and all("judged ring" not in r["applied"] for r in adopted["rows"][1:]),
      str([r["applied"] for r in adopted["rows"]]))
check("  L1's crossings are measured off the adopted strands",
      adopted["rows"][0]["across"] == donor["rows"][0]["across"])
check("  and level 2 grew on top of it",
      len(adopted["rows"]) == 2 and adopted["rows"][1]["across"] > 0)
adopted_meta = next(x for x in adopted["solutions"] if x["level"] == 1)
check("  and L1 exposes no engine solution browser",
      adopted_meta["enumerated"] == "none"
      and adopted_meta["enumerable"] is False,
      str(adopted_meta))
still_adopted = json.loads(bridge.enumerate_level(1))["meta"]
check("  even an enumerate call cannot turn the adopted ring into a search",
      still_adopted["enumerated"] == "none"
      and still_adopted["enumerable"] is False)

bad = {"strands": [{"layer_name": "9_9", "type": "Strand"}], "h_ext": [], "v_ext": []}
refused = run(2, 1, [-1, -1], level1_ring=bridge.l1_ring_from_json(json.dumps(bad)))
check("  a foreign ring is refused, searched instead, and says so",
      refused["level1Adopted"] is False and refused["level1AdoptFailed"] is True
      and refused["rows"][0]["across"] == donor["rows"][0]["across"])

# ---------------------------------------------------------------------------
# The JS -> Python boundary, statically.
#
# Here because the bug it guards shipped: `mxn_l1.to_py() if mxn_l1 is not None
# else None` is obviously correct and crashes EVERY run, because a JS null set
# as a Pyodide global arrives as JsNull -- not None, and with no .to_py().
#
#     AttributeError: 'JsNull' object has no attribute 'to_py'
#
# Nothing in CI could catch it. qa:cache drives the real page but asserts the
# engine is never woken, which is the whole point of a cache test, and the one
# path that does wake it fetches Pyodide from a CDN the sandbox blocks. So the
# boundary is pinned by reading the workers instead: text across, parsed by one
# function, and no null in sight.
print("\n=========== the JS to Python boundary ===========")
check("bridge exposes the one parser both workers use",
      callable(getattr(bridge, "l1_from_json", None)))
check("  it reads absence as absence", bridge.l1_from_json("") is None)
check("  and a pair as a pair", bridge.l1_from_json("[[0],[30,80]]") == [[0], [30, 80]])
for bad in ("[[0]]", "[1,2]", "[]", '"x"'):
    try:
        bridge.l1_from_json(bad)
        check(f"  it refuses {bad}", False, "accepted")
    except (ValueError, TypeError):
        check(f"  it refuses {bad}", True)

for name in ("exact-worker.js", "farm-worker.js"):
    source = open(os.path.join(ROOT, "public", "mxn", name)).read()
    check(f"{name} sends TEXT, never a JS null",
          'runtime.globals.set("mxn_l1", ' in source
          and "JSON.stringify" in source
          and 'set("mxn_l1", level1Extensions ?? null)' not in source
          and 'set("mxn_l1", job.level1Extensions ?? null)' not in source)
    check("  and parses it with the one function that knows about JsNull",
          "bridge.l1_from_json(mxn_l1)" in source and ".to_py()" not in source.split("mxn_l1")[-1][:200])
    if name == "exact-worker.js":
        check("  and never enumerates an adopted L1 merely to count it",
              'if (meta.enumerated !== "full") continue;' in source)

studio = open(os.path.join(ROOT, "src", "mxn-lab", "weave-studio.tsx")).read()
check("the page only auto-counts levels the run already enumerated",
      'entry.enumerated === "full"' in studio)
check("  and an adopted ring is explicitly not browsable",
      "meta.enumerable !== false" in studio
      and "adopted ring · no engine list" in studio)

print(f"\n{f'{failed} check(s) failed, {passed} passed' if failed else f'all {passed} checks passed'}")
sys.exit(1 if failed else 0)
