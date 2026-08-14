"""The four facts the fitter (docs/mxn-fit.md) is built on, checked.

    python3 scripts/check-fit.py

No numpy, no engine run, no network: everything here works off the committed
payload in mocks/fixtures/trace-plan-l1.json — what `bridge.trace_plan`
returned for L1 of a 2x1 — with the arithmetic of `mxn_trace.sweep_combo`
transcribed below. That makes the write-up's numbers reproducible by anyone
who has the repository, which is the point of the file.

What is checked, in the order docs/mxn-fit.md argues it:

    1  arm length is affine in the extension of the arm's own pair
    2  a pair's extension moves ONLY that pair's arms, and moves both equally
    3  the two arms of a pair are always the same length (central symmetry),
       so a band of 2q arms has q free lengths, one per pair
    4  therefore the flush condition is q-1 equations in q+1 unknowns, and its
       solutions form a curve -- which is exactly what the fitter walks

and then, on the same band, what that is worth: the stagger the engine ships,
the best its own grid could have done, and the exact fit off the grid.
"""
import itertools
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE = os.path.join(ROOT, "mocks", "fixtures", "trace-plan-l1.json")

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
    return {"proj": proj, "gaps": gaps, "verdict": v, "first_last": abs(last)}


# --- what the fitter adds ---------------------------------------------------

def coefficients(b, angle_deg):
    """L_p(e) = A_p - B_p e, per pair, measured at this angle."""
    zero = sweep(b, place(b, [0.0] * b["P"]), angle_deg)["proj"]
    A, B = [], []
    for p in range(b["P"]):
        one = [0.0] * b["P"]
        one[p] = 1.0
        step = sweep(b, place(b, one), angle_deg)["proj"]
        li = b["pairIndices"][p][0]
        A.append(zero[li])
        B.append(zero[li] - step[li])
    return A, B


def fit_at(b, angle_deg, star, ext_max=200.0):
    """The extensions that make every pair's arms exactly `star` long."""
    A, B = coefficients(b, angle_deg)
    ext = []
    for p in range(b["P"]):
        if abs(B[p]) < 1e-9:
            return None
        e = (A[p] - star) / B[p]
        if not 0.0 <= e <= ext_max:
            return None
        ext.append(e)
    return ext


def angles_of(b):
    out, a = [], b["windowLo"]
    while a <= b["windowHi"] + 1e-9:
        out.append(a)
        a += b["step"]
    return out


spread = lambda p: max(p) - min(p)                                   # noqa: E731
d_neigh = lambda p: max(abs(p[i + 1] - p[i]) for i in range(len(p) - 1))  # noqa: E731
margin = lambda b, g: min(min(g) - b["minGap"], b["maxGap"] - max(g))  # noqa: E731


def main():
    data = json.load(open(FIXTURE))
    print(__doc__.strip().splitlines()[0])
    print(f"\nband payload: {os.path.relpath(FIXTURE, ROOT)}  (2x1, L1)")

    for key in ("h", "v"):
        b = data[key]
        P, q = b["P"], b["nStrands"]
        mid = (b["windowLo"] + b["windowHi"]) / 2
        print(f"\n{key.upper()} band — {q} arms, {P} pair(s), "
              f"window {b['windowLo']:.1f}..{b['windowHi']:.1f}°, "
              f"gaps {b['minGap']}..{b['maxGap']}px")

        # 1 + 2 -- affine, and confined to the pair
        zero = sweep(b, place(b, [0.0] * P), mid)["proj"]
        worst_lin, cross = 0.0, 0.0
        for p in range(P):
            one, hundred = [0.0] * P, [0.0] * P
            one[p], hundred[p] = 1.0, 100.0
            s1 = [x - y for x, y in zip(sweep(b, place(b, one), mid)["proj"], zero)]
            s100 = [(x - y) / 100 for x, y in
                    zip(sweep(b, place(b, hundred), mid)["proj"], zero)]
            worst_lin = max(worst_lin, max(abs(x - y) for x, y in zip(s1, s100)))
            own = set(i for i in b["pairIndices"][p] if i is not None)
            cross = max([cross] + [abs(s1[i]) for i in range(q) if i not in own])
            same = abs(s1[b["pairIndices"][p][0]]
                       - s1[b["pairIndices"][p][1]]) if b["pairIndices"][p][1] is not None else 0.0
        check("1 · length is affine in the pair's extension",
              worst_lin < 1e-9, f"residual over 100px: {worst_lin:.2e}")
        check("2 · a pair moves only its own arms, and both alike",
              cross < 1e-12 and same < 1e-12,
              f"cross-talk {cross:.2e}, within-pair difference {same:.2e}")

        # 3 -- central symmetry
        worst_mirror = max(abs(zero[i] - zero[q - 1 - i]) for i in range(q // 2))
        check("3 · mirrored arms are the same length",
              worst_mirror < 1e-9, f"worst |L_i - L_(n-1-i)|: {worst_mirror:.2e}")

        # 4 -- the exact-fit set, and what the engine does instead
        angles = angles_of(b)
        exact = []
        for a in angles:
            star = 40.0
            while star <= 420.0:
                ext = fit_at(b, a, star)
                if ext is not None:
                    r = sweep(b, place(b, ext), a)
                    if r["verdict"] == VALID and spread(r["proj"]) < 1e-6:
                        exact.append((a, star, ext, r))
                star += 0.5
        check("4 · exact flush solutions exist, and form a curve",
              len(exact) > 0,
              f"{len(exact)} of them, angles "
              f"{min(x[0] for x in exact):.1f}..{max(x[0] for x in exact):.1f}°, "
              f"lengths {min(x[1] for x in exact):.0f}..{max(x[1] for x in exact):.0f}px"
              if exact else "none inside the window")

        # the engine's own grid, ranked as the engine ranks it
        cells = []
        for ext in itertools.product(b["vals"], repeat=P):
            starts = place(b, list(ext))
            for a in angles:
                r = sweep(b, starts, a)
                if r["verdict"] != VALID:
                    continue
                g = r["gaps"]
                mean = sum(g) / len(g)
                cells.append({
                    "ext": list(ext), "angle": a, "proj": r["proj"], "gaps": g,
                    "key": (r["first_last"], sum((x - mean) ** 2 for x in g) / len(g)),
                })
        if not cells:
            print("    no valid cell on the engine's grid")
            continue
        pick = min(cells, key=lambda c: c["key"])
        flushest = min(cells, key=lambda c: d_neigh(c["proj"]))
        best = max(exact, key=lambda x: (round(margin(b, x[3]["gaps"]), 6),
                                         -sum(x[2]))) if exact else None

        print(f"    valid cells on the 10px grid: {len(cells)}")
        fmt = lambda e: str([int(round(x)) for x in e])
        print(f"    engine's pick      ext {fmt(pick['ext']):<12} "
              f"angle {pick['angle']:7.1f}°  neighbour Δ {d_neigh(pick['proj']):6.2f}px  "
              f"gap margin {margin(b, pick['gaps']):5.2f}px")
        print(f"    flushest grid cell ext {fmt(flushest['ext']):<12} "
              f"angle {flushest['angle']:7.1f}°  neighbour Δ {d_neigh(flushest['proj']):6.2f}px  "
              f"gap margin {margin(b, flushest['gaps']):5.2f}px")
        if best:
            a, star, ext, r = best
            print(f"    fitter, continuous ext {str([round(e, 2) for e in ext]):<12} "
                  f"angle {a:7.1f}°  neighbour Δ {d_neigh(r['proj']):6.2f}px  "
                  f"gap margin {margin(b, r['gaps']):5.2f}px   L* {star:.1f}px")
            snapped = [round(e / 10) * 10 for e in ext]
            rs = sweep(b, place(b, snapped), a)
            print(f"    …the same fit snapped back onto the grid {snapped}: "
                  f"neighbour Δ {d_neigh(rs['proj']):.2f}px, {NAMES[rs['verdict']]}")
            check("5 · the fit is exact, and the grid cannot hold it",
                  d_neigh(r["proj"]) < 1e-9,
                  f"fitted Δ {d_neigh(r['proj']):.2e}px, snapped Δ {d_neigh(rs['proj']):.2f}px")

    print()
    if failures:
        print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
