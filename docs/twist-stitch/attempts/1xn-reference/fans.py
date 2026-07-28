#!/usr/bin/env python3
"""The two-fan construction, derived from its rules and checked against the reference.

The reference (docs/twist-stitch/attempts/1xn-reference/README.md) tabulates 1x1..1x8
in both hands. Nothing here is fitted to that table: the angles and the extension
ladders below come out of the three rules, and the table is only the check.

Run:  python3 fans.py
"""

import json
import math
import os

W = 46.0    # lace width
G = 56.0    # gap floor: neighbouring parallel laces sit this far apart, w + 10
C = 32.0    # how far an arm pokes past the far edge of the band it crosses


def fan(count, D, g=G):
    """One family's fan: `count` pairs of arms whose two columns are D apart.

    Returns (angle_deg, ladder_step). The arms of a pair sit one gap apart across
    the fan and 2*count-1 gaps span it; equal gaps at the floor leave one degree of
    freedom, spent by emptying the shortest arm.
    """
    if count == 1:
        # A single pair: D*sin - g*cos = g has the closed form below.
        return math.degrees(2 * math.atan(g / D)), 0.0
    p, q = 2 * count - 1, 2 * count - 3
    # 2D + p*d == hypot(4g, 2D + q*d)
    a, b, c = p * p - q * q, 4 * D * (p - q), -((4 * g) ** 2)
    d = (-b + math.sqrt(b * b - 4 * a * c)) / (2 * a)
    return math.degrees(math.atan2(4 * g, 2 * D + q * d)), d


def stitch(m, n, g=G, c=C):
    """Both fans of an m x n. The weft family has n pairs, the warp family m."""
    weft, dw = fan(n, (2 * m - 1) * g + 2 * c, g)
    warp, dp = fan(m, (2 * n - 1) * g + 2 * c, g)
    return weft, warp, dw, dp


def ladder(count, d):
    """Extension per pair, outermost first: the ladder read alternately from its ends."""
    rungs = [round(k * d) for k in range(count)][::-1]
    out, lo, hi = [], 0, count - 1
    while lo <= hi:
        out.append(rungs[lo])
        lo += 1
        if lo <= hi:
            out.append(rungs[hi])
            hi -= 1
    return out


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    ref = json.load(open(os.path.join(here, 'measured.json')))
    by_n = {r['n']: r for r in ref['rows']}

    print('m = 1, against the reference. "H" is the weft fan, "V" the warp pair.')
    print(f"{'':6}{'H':>9}{'H ref':>9}{'V':>9}{'V ref':>9}   extensions / reference")
    worst = 0.0
    for n in range(1, 9):
        weft, warp, dw, _ = stitch(1, n)
        r = by_n[n]
        hr, vr = abs(r['rh']['H']), abs(r['lh']['V'])
        worst = max(worst, abs(weft - hr), abs(warp + 90.0 - vr))
        print(f"1x{n:<4}{weft:9.2f}{hr:9.2f}{warp + 90.0:9.2f}{vr:9.2f}   {ladder(n, dw)}")
    print(f'\nlargest disagreement with the reference: {worst:.3f} deg')

    print('\nand what the one-turn law in samples.ts says, for comparison:')
    print(f"{'shape':8}{'weft':>8}{'warp':>8}{'atan(1/max)':>13}")
    for m, n in [(1, 1), (1, 4), (1, 8), (2, 1), (2, 2), (3, 7), (8, 8)]:
        weft, warp, _, _ = stitch(m, n)
        print(f'{m}x{n:<6}{weft:8.2f}{warp:8.2f}{math.degrees(math.atan(1 / max(m, n))):13.2f}')
