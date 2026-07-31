"""Emit the box stitch the icon is a render of, worked for N rounds.

    python3 scripts/make-icon-scene.py [rounds] [tail] [outfile]

More than one round because the point being made is that levels stack: one
stitch is a knot, and the rounds sitting on top of it are the thing a flat
drawing cannot say.

Geometry is the app's own box-stitch column (src/model/samples.ts,
boxStitchRounds): cx=400, cy=268, Q=33, so the woven square is x 367..433,
y 235..301, and each lace's pinned middle runs E=26 past two of its corners.
Four arms hang off the two middles and fold in a rotation around that square —
A, D, B, C, then C, B, D, A, then A, D, B, C… the reversal each round being
what makes this the box stitch rather than the round one. An arm goes OUT on
its even folds and BACK on its odd ones, so its ends alternate between the two
far sides of the square, overhanging the corner a little either way.

TAIL is how far past the corner the LAST round's four ends run — they are the
loose tails, never folded again. The sample uses 120; an icon is a square, and
spokes that long shrink the knot in the middle of it, so this takes a shorter
one by default.
"""
import json
import sys

ROUNDS = int(sys.argv[1]) if len(sys.argv) > 1 else 2
TAIL = float(sys.argv[2]) if len(sys.argv) > 2 else 62
OUT = sys.argv[3] if len(sys.argv) > 3 else "scripts/icon-scene.json"

ORANGE = {"r": 255, "g": 92, "b": 53, "a": 255}
YELLOW = {"r": 255, "g": 212, "b": 71, "a": 255}
STROKE = {"r": 30, "g": 30, "b": 30, "a": 255}

CX, CY = 400, 268
Q = 33  # half the woven square
E = 26  # how far a pinned middle runs past the square before its arm folds off
WIDTH = 54

LEFT, RIGHT = CX - Q, CX + Q
TOP, BOTTOM = CY - Q, CY + Q

# How far a fold reaches past the far corner. It creeps outward round by round:
# two folds ending on the same point would be read as one junction by everything
# downstream, and a stitch that fans out by a hair is what a real one does. The
# spread is shared out over the folds one arm makes on one parity, exactly as
# samples.ts does it.
SPREAD, SPLAY = 14, 2
_slots = max(1, (ROUNDS + 1) // 2)
STEP = SPREAD if _slots < 2 else max(SPLAY, SPREAD / (_slots - 1))


def overhang(fold):
    return Q + STEP * (fold // 2)


class Arm:
    """One folded arm: where it hangs off, which way its first fold travels, and
    where its free end is now."""

    def __init__(self, key, set_no, color, base, u, parent, side):
        self.key = key
        self.set = set_no
        self.color = color
        self.base = base
        self.u = u
        self.folds = 0
        self.at = base
        self.parent = parent  # id of the strand this arm's next fold hangs off
        self.side = side


A = Arm("A", 1, ORANGE, (LEFT - E, BOTTOM), (1, 0), "1_1", 0)
B = Arm("B", 1, ORANGE, (RIGHT + E, TOP), (-1, 0), "1_1", 1)
C = Arm("C", 2, YELLOW, (LEFT, TOP - E), (0, 1), "2_1", 0)
D = Arm("D", 2, YELLOW, (RIGHT, BOTTOM + E), (0, -1), "2_1", 1)


def strand(sid, start, end, color, parent, side, last):
    return {
        "id": sid,
        "start": {"x": start[0], "y": start[1]},
        "end": {"x": end[0], "y": end[1]},
        "control_points": [
            {"x": start[0], "y": start[1]},
            {"x": start[0], "y": start[1]},
        ],
        "control_point_center": None,
        "control_point_center_locked": False,
        "triangleHasMoved": False,
        "cp2Activated": False,
        "width": WIDTH,
        "stroke_width": 4,
        "color": color,
        "stroke_color": STROKE,
        "thickness": None,
        "visible": True,
        "isMask": False,
        # The far end of a loose tail carries no join mark: nothing folds off it.
        "hasCircles": [True, not last],
        "parentId": parent,
        "parentSide": side,
    }


# The two laces, pinned across each other. Each runs corner to corner and out the
# far side by E, and its two ends are where its two arms fold off.
strands = [
    strand("1_1", A.base, B.base, ORANGE, None, None, False),
    strand("2_1", C.base, D.base, YELLOW, None, None, False),
]
masks = []
level_breaks = []
next_id = {1: 1, 2: 1}

for rnd in range(ROUNDS):
    # The rotation reverses every round — that alternation is what makes this the
    # BOX stitch. Keep turning the same way and you get the round stitch instead.
    order = [A, D, B, C] if rnd % 2 == 0 else [C, B, D, A]
    last_round = rnd == ROUNDS - 1
    ids = []
    for arm in order:
        over = TAIL if last_round else overhang(arm.folds)
        # Out past the far corner on the even folds, back past the near one on
        # the odd ones. The middle it folds off eats E of the outward leg.
        t = E + 2 * Q + over if arm.folds % 2 == 0 else E - over
        end = (arm.base[0] + arm.u[0] * t, arm.base[1] + arm.u[1] * t)

        next_id[arm.set] += 1
        sid = f"{arm.set}_{next_id[arm.set]}"
        strands.append(strand(sid, arm.at, end, arm.color, arm.parent, arm.side, last_round))
        ids.append(sid)

        arm.at = end
        arm.folds += 1
        arm.parent = sid  # the next arm round folds off this one…
        arm.side = 1  # …at its free end

    # One mask a round: the move that locks the stitch, where the last arm folded
    # has to dive back UNDER the first one. Every other crossing is told truly by
    # the stacking order, so it needs no mask at all.
    masks.append({"overId": ids[0], "underId": ids[-1]})
    if not last_round:
        level_breaks.append(len(strands))

scene = {
    "format": "scoubidou3d-scene",
    "version": 2,
    "name": f"Box stitch — {ROUNDS} levels",
    "strands": strands,
    "masks": masks,
    "levelBreaks": level_breaks,
}

with open(OUT, "w") as f:
    json.dump(scene, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(f"{OUT}  rounds={ROUNDS} tail={TAIL}  {len(strands)} strands, {len(masks)} masks")
