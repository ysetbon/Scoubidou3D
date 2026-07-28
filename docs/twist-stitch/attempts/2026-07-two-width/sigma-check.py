"""Does an arm's successor stay in its own family, or turn the corner?

Read straight off the hand-built 2x1: for each level-0 arm, take the arm that
starts on its tip and compare axes. Same family => the axis only turns by the
level turn. Around the perimeter => it turns by ~90 degrees more.
"""
import math

C = (474.5, 304.0)
TURN = 26.0

ROWS = {
    '1_1': (354.66, 329.14, 620.41, 287.83),
    '2_1': (399.99, 222.79, 457.00, 392.74),
    '3_1': (511.38, 231.06, 566.90, 386.61),
    '1_2': (620.41, 287.83, 325.36, 268.39),
    '1_3': (354.66, 329.14, 624.97, 341.70),
    '3_2': (566.90, 386.61, 550.50, 238.00),
    '3_3': (511.38, 231.06, 537.98, 416.32),
    '2_2': (399.99, 222.79, 406.99, 378.45),
    '2_3': (457.00, 392.74, 420.50, 197.19),
    '1_4': (624.97, 341.70, 343.12, 200.03),
    '1_5': (325.36, 268.39, 585.67, 393.74),
    '3_4': (537.98, 416.32, 582.42, 274.29),
    '3_5': (550.50, 238.00, 455.80, 403.33),
    '2_4': (406.99, 378.45, 498.78, 187.05),
    '2_5': (420.50, 197.19, 348.98, 335.31),
}
LEVEL0 = ['1_2', '1_3', '2_2', '2_3', '3_2', '3_3']


def axis(id_):
    x0, y0, x1, y1 = ROWS[id_]
    return math.degrees(math.atan2(y1 - y0, x1 - x0)) % 180


def tip(id_):
    return ROWS[id_][2], ROWS[id_][3]


def rot(p, deg):
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    dx, dy = p[0] - C[0], p[1] - C[1]
    return (C[0] + dx * c - dy * s, C[1] + dx * s + dy * c)


print('arm  axis   successor  axis   turned   family')
for a in LEVEL0:
    t = tip(a)
    succ = [b for b in ROWS if b != a and math.dist(ROWS[b][:2], t) < 1.0]
    if not succ:
        continue
    b = succ[0]
    d = (axis(b) - axis(a) + 90) % 180 - 90
    same = 'SAME' if abs(d) < 45 else 'PERPENDICULAR'
    print(f'{a}  {axis(a):5.1f}  ->  {b}  {axis(b):5.1f}  {d:+6.1f}   {same}')

print('\ndoes the tip land on the rotated line of its lace\'s OTHER arm?')
SIB = {'1_2': '1_3', '1_3': '1_2', '2_2': '2_3', '2_3': '2_2', '3_2': '3_3', '3_3': '3_2'}
for a in LEVEL0:
    s = SIB[a]
    p, q = rot(ROWS[s][:2], TURN), rot(ROWS[s][2:], TURN)
    ux, uy = q[0] - p[0], q[1] - p[1]
    L = math.hypot(ux, uy)
    ux, uy = ux / L, uy / L
    t = tip(a)
    off = abs((t[0] - p[0]) * -uy + (t[1] - p[1]) * ux)
    print(f'  {a} tip is {off:5.1f} units ({off / 54:.2f} widths) off the turned {s} line')
