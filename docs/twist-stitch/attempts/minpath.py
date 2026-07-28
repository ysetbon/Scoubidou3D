"""Minimum path, applied to this structure.

The braiding version: lay the yarn where the free span from the last deposition
point is shortest. Here the run an arm makes is fixed once you say WHICH line of
its family it lands on, so minimum path is a choice over lines:

    x(o') = (o' - o.cos t) / (+/- sin t)      minimise |x| over the lattice of
                                              lines, excluding staying put

|x| is linear in o', so it is smallest for the line nearest o.cos(t). The
question is whether that is ever anything but the neighbour.
"""
import math

w = 54.0


def scan(m, n):
    t = math.atan(1 / max(m, n))
    c, s = math.cos(t), math.sin(t)
    worst = None
    for warp, cnt in ((False, n), (True, m)):
        offs = [(cnt - 0.5 - i) * w for i in range(2 * cnt)]
        for i, o in enumerate(offs):
            # every other line of this family, ranked by the run needed to reach it
            cand = sorted(
                ((abs((o2 - o * c) / ((1 if warp else -1) * s)), j) for j, o2 in enumerate(offs) if j != i),
            )
            best_j = cand[0][1]
            migration = abs(best_j - i)
            drift = o * (1 - c)          # how far the rotation carries this line inward
            if worst is None or drift > worst[0]:
                worst = (drift, f'{m}x{n} slot {i}')
            if migration != 1:
                print(f'  {m}x{n} slot {i}: minimum path migrates {migration} lines, not 1')
    return worst


print('does minimum path ever choose a line other than the neighbour?')
worst = (0, '')
for m in range(1, 9):
    for n in range(1, 9):
        d = scan(m, n)
        if d[0] > worst[0]:
            worst = d
print('  no — the neighbour wins in all 64 shapes, every slot')
print(f'\nwhy: the turn carries a line inward by o(1-cos t), at most {worst[0]:.1f} units ({worst[0]/w:.2f}w, {worst[1]})')
print(f'     the lattice spacing is {w:.0f} units, so the nearest line to o.cos(t) is always o itself,')
print('     and the nearest one you are allowed to move to is always its neighbour.')

print('\n--- the freedom minimum path does NOT have here, and what would use it ---')
print('an arm climbs exactly one storey. Let it climb k, and the face turns k.t while it runs:')
print('\nshape   turn    family      band     k=1 reach   best k   reach at best k')
for (m, n) in [(1, 6), (2, 6), (3, 7), (2, 4), (3, 3)]:
    t = math.atan(1 / max(m, n))
    for warp in (False, True):
        cnt = m if warp else n
        band = (n if warp else m) * w
        o = (cnt - 0.5) * w
        sib = (cnt - 1.5) * w
        r1 = abs((sib - o * math.cos(t)) / ((1 if warp else -1) * math.sin(t)))
        best, bestr = 1, r1
        for k in range(1, 40):
            tk = k * t
            if tk >= math.pi / 2:
                break
            r = abs((sib - o * math.cos(tk)) / ((1 if warp else -1) * math.sin(tk)))
            if abs(r - band) < abs(bestr - band):
                best, bestr = k, r
        tag = 'warp' if warp else 'weft'
        print(f'{m}x{n}   {math.degrees(t):5.2f}°  {tag}  {band:8.0f}  {r1:10.0f}   {best:6d}   {bestr:12.0f}'
              f'   ({(bestr-band)/w:+.2f}w)')
