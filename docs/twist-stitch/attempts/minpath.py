"""What I actually minimised, and what happens when the restriction comes off.

A weft arm sits on the line y = b and runs along x. Its tip is (x, b). For that
tip to land on a line of the NEXT level, that line rotated by theta must pass
through it.

  same family — the next level's weft line y = b'
      (x, b) on the rotated line  ->   x = (b' - b.cos t) / (-sin t)

  other family — the next level's warp line x = a
      rotate it by t: points (a.c - u.s, a.s + u.c); set equal to (x, b)
      u = (b - a.s)/c   ->   x = (a - b.sin t) / cos t

Both are exact. The first is the law we use. The second is the one I excluded
by hand, on the strength of the hand-built 2x1 — and that is the whole argument.
"""
import math

w = 54.0


def runs(m, n):
    t = math.atan(1 / max(m, n))
    c, s = math.cos(t), math.sin(t)
    weft = [(n - 0.5 - i) * w for i in range(2 * n)]
    warp = [(m - 0.5 - j) * w for j in range(2 * m)]
    out = []
    for i, b in enumerate(weft):
        same = min(abs((b2 - b * c) / -s) for j, b2 in enumerate(weft) if j != i)
        cross = min(abs((a - b * s) / c) for a in warp)
        out.append((b, same, cross))
    return math.degrees(t), out


print('shortest run an arm can make, staying in its family vs turning the corner')
print('(one lace width = 54)\n')
print('shape    arm on line   stay in family   turn the corner   which is shorter')
for (m, n) in [(2, 1), (1, 1), (3, 3), (2, 4), (1, 6), (3, 7)]:
    deg, rows = runs(m, n)
    b, same, cross = max(rows, key=lambda r: r[1] - r[2])
    tag = 'CORNER' if cross < same else 'family'
    print(f'{m}x{n} {deg:6.2f}°  off {b:7.1f}   {same:12.1f}   {cross:15.1f}   {tag}'
          f'  ({same / cross:.0f}x shorter)' if cross < same else '')

print('\nevery arm of every shape, does minimum path prefer to turn the corner?')
prefer, total = 0, 0
for m in range(1, 9):
    for n in range(1, 9):
        _, rows = runs(m, n)
        for b, same, cross in rows:
            total += 1
            if cross < same:
                prefer += 1
print(f'  {prefer} of {total} weft arms — {100 * prefer // total}%')

print('\nand the 2x1, arm by arm, against what the hand-built scene actually does:')
deg, rows = runs(2, 1)
for b, same, cross in rows:
    print(f'  weft line at {b:+6.1f}: family {same:6.1f}   corner {cross:6.1f}'
          f'   -> minimum path says {"CORNER" if cross < same else "family"}')
print('  the hand-built 2x1 does: family, on all six arms (sigma-check.py)')
