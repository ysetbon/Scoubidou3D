"""What the engine actually answers, committed, so the fitter can be checked.

Writes exactly what the page receives: `bridge.fit_plan` for a level's two
bands, `bridge.fit_weave` for the ring the engine itself adopted, and the run
row beside them. The arms' lengths are then measurable off the drawn ring
rather than recomputed from an extension and a heading, which is the whole
reason the strands are in here.

    python3 scripts/fit-fixtures.py          # -> mocks/fixtures/fit-l1.json

Needs numpy for the host Python. Committed rather than cached: docs/mxn-fit.md
quotes these numbers, `scripts/check-fit.py` re-derives them, and the mock draws
them, so all three have to be reading the same engine answer.

Two sizes, and both earn their place:

    2x1  the smallest stitch with a band worth fitting -- one 2-arm band that
         is flush whatever happens, one 4-arm band that is not
    3x2  the case that decides whether this page needs to exist: its V band's
         stagger is the worst of the small sizes, and no cell of the engine's
         own extension grid does better than the one it already picked
    2x1 twice
         two levels, because fitting one level slides its arms along their
         parents and so lengthens the level below it. A one-level fixture
         cannot show that, and the page's level strip has nothing to strip
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "mocks", "fixtures", "fit-l1.json")
os.chdir(ROOT)
sys.path.insert(0, os.path.join(ROOT, "public", "mxn", "py"))

import bridge  # noqa: E402
import mxn_trace  # noqa: E402

SIZES = [(2, 1, [1]), (3, 2, [1]), (2, 1, [1, 1])]


def window(band, ext):
    """The engine's angle window for one placement.

    ANGLE_MODE is "first_strand", so it is strand 0's own heading from its
    EXTENDED start, +/-20 degrees. It therefore moves with the extensions, which
    is why a level's adopted angle can sit outside the window the plan reports
    for its probe combo.
    """
    p = mxn_trace.place(band, ext)[0]
    ref = math.degrees(math.atan2(p["target_position"]["y"] - p["original_start"]["y"],
                                  p["target_position"]["x"] - p["original_start"]["x"]))
    return ref - 20.0, ref + 20.0


def lengths_at(band, ext, angle_deg):
    placed = mxn_trace.place(band, ext)
    starts = [(s["original_start"]["x"], s["original_start"]["y"]) for s in placed]
    d = [(s["target_position"]["x"] - sx, s["target_position"]["y"] - sy)
         for s, (sx, sy) in zip(placed, starts)]
    ref = math.atan2(d[0][1], d[0][0])
    a = math.radians(angle_deg)
    out = []
    for dx, dy in d:
        sa = a if dx * math.cos(ref) + dy * math.sin(ref) >= 0 else a + math.pi
        out.append(dx * math.cos(sa) + dy * math.sin(sa))
    return out


def neighbour_delta(L):
    return max(abs(L[i + 1] - L[i]) for i in range(len(L) - 1)) if len(L) > 1 else 0.0


def scan_grid(band, p):
    """The flushest cell of the engine's OWN extension grid, and how many are valid.

    Each combo is judged inside its own window, as the engine judges it -- not
    inside the probe combo's, which is a different set of angles and a different
    answer. Expensive (a 3x3 would be 9,261 combos), which is why it is measured
    here, once, and committed rather than recomputed by the checker.
    """
    import itertools

    step = max(1, int(p["step"] * 100))
    valid = 0
    best = None
    for combo in itertools.product(p["vals"], repeat=p["P"]):
        ext = [float(x) for x in combo]
        lo, hi = window(band, ext)
        angles = [h / 100.0 for h in range(int(lo * 100), int(hi * 100) + 1, step)]
        swept = mxn_trace.sweep_combo(band, mxn_trace.place(band, ext), angles)
        for j, verdict in enumerate(swept["verdicts"]):
            if int(verdict) != mxn_trace.VALID:
                continue
            valid += 1
            delta = neighbour_delta(lengths_at(band, ext, angles[j]))
            if best is None or delta < best["delta"]:
                gaps = [float(g[j]) for g in swept["gaps"]]
                best = {"ext": ext, "angle": angles[j], "delta": delta,
                        "gaps": gaps,
                        "margin": min(min(gaps) - p["minGap"],
                                      p["maxGap"] - max(gaps))}
    return {"valid": valid, "flushest": best}


def heading(strands, names):
    """The heading a band was drawn at, off its first arm.

    fit_plan reports the adopted angle only where the level kept a candidate
    list, and a seeded level keeps none -- so the ring itself is asked instead.
    Arm 0 is never one of the reversed ones, so the direction it is drawn in IS
    the band's heading.
    """
    by = {s["layer_name"]: s for s in strands}
    first = by.get(names[0]) if names else None
    if first is None:
        return None
    return math.degrees(math.atan2(first["end"]["y"] - first["start"]["y"],
                                   first["end"]["x"] - first["start"]["x"]))


def measure(strands, names):
    """Arm lengths, off the ring as drawn."""
    by = {s["layer_name"]: s for s in strands}
    out = []
    for name in names:
        s = by.get(name)
        if s is None:
            return []
        out.append(math.hypot(s["end"]["x"] - s["start"]["x"],
                              s["end"]["y"] - s["start"]["y"]))
    return out


payload = {"engine": "984d9ed", "sizes": {}}

for m, n, ks in SIZES:
    key = f"{m}x{n}-k{'_'.join(str(k) for k in ks)}"
    print(f"running {key}…", flush=True)
    run = json.loads(bridge.generate(m, n, ks, "lh", "cw"))
    level = len(ks)
    plan = json.loads(bridge.fit_plan(level))
    stage = next(s for s in run["stages"] if s["level"] == level)

    # The engine's own ring, through the fitter's own call, so "before" and
    # "after" come back down the same path and can be compared without a
    # caveat. Both bands are held where the engine left them -- and WHERE that
    # is has to be recovered from the ring, because passing None applies
    # nothing at all on a seeded level: a 2x1's L2 comes back 6 crossings of 8
    # that way, against the 8 the run reported.
    held = {}
    for k in ("h", "v"):
        if plan[k].get("unavailable"):
            held[k] = (None, None)
            continue
        held[k] = (plan[k]["applied"],
                   heading(stage["strands"], plan[k].get("names") or []))
    before = json.loads(bridge.fit_weave(level, held["h"][0], held["h"][1],
                                         held["v"][0], held["v"][1]))
    engine_row = run["rows"][level - 1]
    if before["row"]["across"] != engine_row["across"]:
        print(f"  !! baseline {before['row']['across']}/{before['row']['expected']}"
              f" but the run reported {engine_row['across']}", flush=True)

    # Every level, not just the fitted one: a stitch is a stack of rings, the
    # page draws a card for each, and fitting one level moves the one below it.
    stages = [s for s in run["stages"] if s["level"] >= 1]
    plans = {}
    for other in range(1, level + 1):
        plans[str(other)] = (plan if other == level
                             else json.loads(bridge.fit_plan(other)))

    entry = {
        "m": m, "n": n, "ks": ks, "level": level,
        "hand": "lh", "direction": "cw",
        "row": run["rows"][level - 1],
        "rows": run["rows"],
        "plan": {k: plan[k] for k in ("h", "v")},
        "stages": stages,
        "plans": plans,
        "held": {k: {"ext": held[k][0], "angle": held[k][1]} for k in ("h", "v")},
        "before": {
            "crossings": before.get("crossings"),
            "row": before.get("row"),
            "strands": stage["strands"],
            "lengths": {
                k: measure(stage["strands"], plan[k].get("names") or [])
                for k in ("h", "v") if not plan[k].get("unavailable")
            },
        },
    }
    entry["grid"] = {}
    for k, want in (("h", "horizontal"), ("v", "vertical")):
        if plan[k].get("unavailable"):
            continue
        L = entry["before"]["lengths"].get(k) or []
        delta = neighbour_delta(L)
        print(f"  {k}: applied {plan[k].get('applied')} "
              f"neighbour Δ {delta:.2f}px  lengths {[round(x, 2) for x in L]}",
              flush=True)
        band = bridge._SESSION["levels"][level]["trace_bands"][want]
        entry["grid"][k] = scan_grid(band, plan[k])
        best = entry["grid"][k]["flushest"]
        print(f"      grid: {entry['grid'][k]['valid']} valid cells · flushest "
              f"{[int(x) for x in best['ext']]} @ {best['angle']:.2f}° "
              f"Δ {best['delta']:.2f}px", flush=True)
    payload["sizes"][key] = entry

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as handle:
    json.dump(payload, handle, separators=(",", ":"))
print(f"wrote {os.path.relpath(OUT, ROOT)} "
      f"({os.path.getsize(OUT)} bytes, {len(payload['sizes'])} sizes)")
