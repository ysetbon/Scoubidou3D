"""The facts the fitter (docs/mxn-fit.md) is built on, checked against the engine.

    python3 scripts/check-fit.py

No numpy, no engine run, no network: everything here works off
`mocks/fixtures/fit-l1.json`, which is what `bridge.fit_plan` and
`bridge.fit_weave` actually returned for L1 of a 2x1 and a 3x2 (rebuild it with
`python3 scripts/fit-fixtures.py`). So the numbers docs/mxn-fit.md quotes are
reproducible by anyone with the repository, which is the point of the file.

What is checked:

    1  arm length is affine in the extension of the arm's own pair
    2  a pair's extension moves ONLY that pair's arms, and moves both equally
    3  the two arms of a pair are always the same length (central symmetry),
       so a band of 2q arms has q free lengths, one per pair
    4  the model agrees with the DRAWING -- lengths computed from an extension
       and a heading equal lengths measured off the ring the engine drew
    5  exact flush solutions exist, and form a curve
    6  the flushest cell of the engine's own grid is where the fixture says

and then, per band: the stagger the engine ships, the best its own grid could
have done, and what the fit reaches.
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE = os.path.join(ROOT, "mocks", "fixtures", "fit-l1.json")

WINDOW, REACH, DEGEN, ORDER, OVERLAP, TOOFAR, VALID, BEST = range(8)
NAMES = ["WINDOW", "REACH", "DEGEN", "ORDER", "OVERLAP", "TOOFAR", "VALID", "BEST"]

failures = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")
    if not ok:
        failures.append(name)


# --- mxn_trace.place / mxn_trace.sweep_combo, one combo at a time -----------

def place(b, ext):
    starts = [[0.0, 0.0] for _ in b["targets"]]
    for p, (li, ri) in enumerate(b["pairIndices"]):
        lnx, lny, rnx, rny = b["directions"][p]
        lo, ro = b["origins"][p]
        e = ext[p]
        if lo:
            starts[li] = [lo[0] + e * lnx, lo[1] + e * lny]
        if ri is not None and ro:
            starts[ri] = [ro[0] + e * rnx, ro[1] + e * rny]
    return starts


def sweep(b, starts, angle_deg):
    n = len(starts)
    d = [[b["targets"][i][0] - starts[i][0], b["targets"][i][1] - starts[i][1]]
         for i in range(n)]
    ref = math.atan2(d[0][1], d[0][0])
    a = math.radians(angle_deg)
    proj, ld, inv = [], [], []
    degen = unreach = False
    for di in d:
        pos = di[0] * math.cos(ref) + di[1] * math.sin(ref) >= 0
        sa = a if pos else a + math.pi
        pr = di[0] * math.cos(sa) + di[1] * math.sin(sa)
        proj.append(pr)
        ld.append([pr * math.cos(sa), pr * math.sin(sa)])
        ll = abs(pr)
        inv.append(1 / ll if ll > 1e-3 else 0.0)
        degen = degen or ll < 1e-3
        unreach = unreach or not pr > 10
    signed = []
    for i in range(n - 1):
        vx = starts[i + 1][0] - starts[i][0]
        vy = starts[i + 1][1] - starts[i][1]
        signed.append((ld[i][1] * vx - ld[i][0] * vy) * inv[i] * (-1 if i % 2 else 1))
    gaps = [abs(s) for s in signed]
    last = (ld[0][1] * (starts[-1][0] - starts[0][0])
            - ld[0][0] * (starts[-1][1] - starts[0][1])) * inv[0]
    bad = not (all(s > 0 for s in signed) if last >= 0
               else all(s < 0 for s in signed))
    v = VALID
    if degen:
        v = DEGEN
    if v == VALID and bad:
        v = ORDER
    if v == VALID and any(g > b["maxGap"] for g in gaps):
        v = TOOFAR
    if v == VALID and any(g < b["minGap"] for g in gaps):
        v = OVERLAP
    if unreach:
        v = REACH
    return {"proj": proj, "gaps": gaps, "verdict": v}


def window(b, ext):
    """ANGLE_MODE is "first_strand": arm 0's heading from its EXTENDED start, +/-20."""
    s = place(b, ext)[0]
    ref = math.degrees(math.atan2(b["targets"][0][1] - s[1], b["targets"][0][0] - s[0]))
    return ref - 20.0, ref + 20.0


def coefficients(b, angle_deg):
    zero = sweep(b, place(b, [0.0] * b["P"]), angle_deg)["proj"]
    one = sweep(b, place(b, [1.0] * b["P"]), angle_deg)["proj"]
    A = [zero[li] for li, _ in b["pairIndices"]]
    B = [zero[li] - one[li] for li, _ in b["pairIndices"]]
    return A, B


def flush_ext(b, angle_deg, star, ext_max=200.0):
    A, B = coefficients(b, angle_deg)
    ext = []
    for p in range(b["P"]):
        if abs(B[p]) < 1e-9:
            return None
        e = (A[p] - star) / B[p]
        if not -1e-9 <= e <= ext_max + 1e-9:
            return None
        ext.append(min(ext_max, max(0.0, e)))
    return ext


def star_range(A, B, ext_max=200.0):
    lo, hi = -1e18, 1e18
    for a, bb in zip(A, B):
        if abs(bb) < 1e-9:
            return None
        ends = sorted((a - bb * ext_max, a))
        lo, hi = max(lo, ends[0]), min(hi, ends[1])
    return (lo, hi) if hi > lo else None


def d_neigh(L):
    return max(abs(L[i + 1] - L[i]) for i in range(len(L) - 1)) if len(L) > 1 else 0.0


def margin(b, g):
    return min(min(g) - b["minGap"], b["maxGap"] - max(g))


def measured(strands, names):
    by = {s["layer_name"]: s for s in strands}
    return [math.hypot(by[nm]["end"]["x"] - by[nm]["start"]["x"],
                       by[nm]["end"]["y"] - by[nm]["start"]["y"])
            for nm in names if nm in by]


def drawn_heading(strands, name):
    """The heading the ring was actually drawn at, off one of its arms."""
    by = {s["layer_name"]: s for s in strands}
    s = by[name]
    return math.degrees(math.atan2(s["end"]["y"] - s["start"]["y"],
                                   s["end"]["x"] - s["start"]["x"]))


def main():
    if not os.path.exists(FIXTURE):
        print(f"missing {os.path.relpath(FIXTURE, ROOT)} — "
              f"run: python3 scripts/fit-fixtures.py")
        return 1
    data = json.load(open(FIXTURE))
    print(__doc__.strip().splitlines()[0])
    print(f"\nfixture: {os.path.relpath(FIXTURE, ROOT)}  (engine {data['engine']})")

    for size, entry in data["sizes"].items():
        print(f"\n=========== {size} · L{entry['level']} · "
              f"{entry['hand']} {entry['direction']} ===========")
        strands = entry["before"]["strands"]
        for key in ("h", "v"):
            b = entry["plan"][key]
            if b.get("unavailable"):
                print(f"\n{key.upper()} band — {b.get('reason')}")
                continue
            q, P = b["nStrands"], b["P"]
            print(f"\n{key.upper()} band — {q} arms, {P} pair(s), "
                  f"gaps {b['minGap']}..{b['maxGap']}px")

            mid = (b["windowLo"] + b["windowHi"]) / 2
            zero = sweep(b, place(b, [0.0] * P), mid)["proj"]

            # 1 + 2 — affine, and confined to the pair
            worst_lin = cross = within = 0.0
            for p in range(P):
                one, hundred = [0.0] * P, [0.0] * P
                one[p], hundred[p] = 1.0, 100.0
                s1 = [x - y for x, y in
                      zip(sweep(b, place(b, one), mid)["proj"], zero)]
                s100 = [(x - y) / 100 for x, y in
                        zip(sweep(b, place(b, hundred), mid)["proj"], zero)]
                worst_lin = max(worst_lin,
                                max(abs(x - y) for x, y in zip(s1, s100)))
                own = {i for i in b["pairIndices"][p] if i is not None}
                cross = max([cross] + [abs(s1[i]) for i in range(q) if i not in own])
                li, ri = b["pairIndices"][p]
                if ri is not None:
                    within = max(within, abs(s1[li] - s1[ri]))
            check("1 · length is affine in the pair's extension",
                  worst_lin < 1e-9, f"residual over 100px {worst_lin:.2e}")
            check("2 · a pair moves only its own arms, and both alike",
                  cross < 1e-12 and within < 1e-12,
                  f"cross-talk {cross:.2e}, within-pair {within:.2e}")

            # 3 — central symmetry
            mirror = max(abs(zero[i] - zero[q - 1 - i]) for i in range(q // 2))
            check("3 · mirrored arms are the same length",
                  mirror < 1e-9, f"worst |L_i − L_(n−1−i)| {mirror:.2e}")

            # 4 — the model against the drawing
            applied = [float(e) for e in b["applied"]]
            drawn = measured(strands, b["names"])
            heading = drawn_heading(strands, b["names"][0])
            model = sweep(b, place(b, applied), heading)["proj"]
            worst = max(abs(x - y) for x, y in zip(drawn, model)) if drawn else 9e9
            check("4 · the model agrees with the ring the engine drew",
                  worst < 1e-6,
                  f"worst |measured − computed| {worst:.2e}px over {len(drawn)} arms")

            # 5 — the flush manifold: where it survives the tests, and where it
            # does not. Algebraically it always exists (q−1 equations, q+1
            # unknowns); whether any of it is a ring you can weave is a fact
            # about the band, and at 3×2 the V band's answer is no.
            exact, closest, algebraic = [], None, 0
            angle = b["windowLo"] - 25
            while angle <= b["windowHi"] + 25:
                A, B = coefficients(b, angle)
                span = star_range(A, B)
                if span:
                    algebraic += 1
                    for i in range(49):
                        star = span[0] + (span[1] - span[0]) * i / 48
                        ext = flush_ext(b, angle, star)
                        if ext is None:
                            continue
                        wl, wh = window(b, ext)
                        if not wl <= angle <= wh:
                            continue
                        r = sweep(b, place(b, ext), angle)
                        if d_neigh(r["proj"]) > 1e-6:
                            continue
                        if r["verdict"] == VALID:
                            exact.append((angle, star, ext, r))
                        else:
                            room = margin(b, r["gaps"])
                            if closest is None or room > closest[0]:
                                closest = (room, angle, star, ext, r)
                angle += b["step"] * 4          # a sample of the curve, not all of it
            check("5 · the flush manifold is there in the algebra",
                  algebraic > 0,
                  f"{algebraic} headings admit a common length")
            if exact:
                print(f"    flush    {len(exact)} sampled points survive every test — "
                      f"angles {min(x[0] for x in exact):.1f}..{max(x[0] for x in exact):.1f}°, "
                      f"L* {min(x[1] for x in exact):.0f}..{max(x[1] for x in exact):.0f}px")
            elif closest:
                room, a, star, ext, r = closest
                print(f"    flush    NOT REACHABLE — every flush configuration fails a "
                      f"test. Closest: L* {star:.0f}px at {a:.2f}°,")
                print(f"             gaps {[round(g, 2) for g in r['gaps']]} against "
                      f"{b['minGap']}..{b['maxGap']} — {NAMES[r['verdict']]}, "
                      f"short by {-room:.2f}px")

            # 6 — the recorded grid scan, re-verified at its own cell
            grid = (entry.get("grid") or {}).get(key)
            if grid and grid.get("flushest"):
                g = grid["flushest"]
                r = sweep(b, place(b, g["ext"]), g["angle"])
                ok = (r["verdict"] == VALID
                      and abs(d_neigh(r["proj"]) - g["delta"]) < 1e-6)
                check("6 · the flushest grid cell is where the fixture says",
                      ok, f"ext {[int(x) for x in g['ext']]} @ {g['angle']:.2f}° "
                          f"Δ {d_neigh(r['proj']):.2f}px, {NAMES[r['verdict']]}")

            # and what all of that is worth
            g_before = sweep(b, place(b, applied), heading)["gaps"]
            print(f"    engine   ext {[int(e) for e in applied]} @ {heading:.2f}°"
                  f"   Δ {d_neigh(drawn):6.2f}px   margin {margin(b, g_before):5.2f}px")
            if grid and grid.get("flushest"):
                g = grid["flushest"]
                print(f"    grid     {grid['valid']} valid cells · flushest "
                      f"{[int(x) for x in g['ext']]} @ {g['angle']:.2f}°"
                      f"   Δ {g['delta']:6.2f}px   margin {g['margin']:5.2f}px")
            if exact:
                best = max(exact, key=lambda x: x[1])
                a, star, ext, r = best
                print(f"    fit      ext {[round(x, 2) for x in ext]} @ {a:.2f}°"
                      f"   Δ {d_neigh(r['proj']):6.2f}px   "
                      f"margin {margin(b, r['gaps']):5.2f}px   L* {star:.1f}px")

    print()
    if failures:
        print(f"{len(failures)} check(s) failed: {', '.join(sorted(set(failures)))}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
