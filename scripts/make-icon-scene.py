"""Emit the two-round box stitch the icon is a render of.

    python3 scripts/make-icon-scene.py [tail] [outfile]

Two rounds rather than one because the point being made is that levels stack:
one stitch is a knot, two is the start of a column, and the second round sitting
on the first is the thing you cannot show in a flat drawing.


Geometry is the app's own box-stitch column (src/model/samples.ts,
boxStitchRounds): cx=400, cy=268, Q=33 -> the woven square is x 367..433,
y 235..301, and each lace's pinned middle runs E=26 past its two corners.
Round 1 is the six strands of the starting stitch; round 2 is the next four
folds, one per arm, and since nothing is folded on top of them their far ends
are the loose tails.

TAIL is how far past the far corner those four ends run. The sample uses 120;
an icon is a square, and 120 shrinks the knot to nothing in the middle of four
long spokes, so this takes a shorter one.
"""
import json
import sys

ORANGE = {"r": 255, "g": 92, "b": 53, "a": 255}
YELLOW = {"r": 255, "g": 212, "b": 71, "a": 255}
STROKE = {"r": 30, "g": 30, "b": 30, "a": 255}

TAIL = float(sys.argv[1]) if len(sys.argv) > 1 else 62
OUT = sys.argv[2] if len(sys.argv) > 2 else "scripts/icon-scene.json"

LEFT, RIGHT, TOP, BOTTOM = 367, 433, 235, 301


def mk(sid, start, end, color, parent=None, side=None, last=False):
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
        "width": 54,
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


strands = [
    # Round 1 — the two pinned middles, then the four folds, in the order they
    # were folded (which is the order they stack in).
    mk("1_1", (341, 301), (459, 235), ORANGE),
    mk("2_1", (367, 209), (433, 327), YELLOW),
    mk("1_2", (341, 301), (466, 301), ORANGE, "1_1", 0),
    mk("2_2", (433, 327), (433, 202), YELLOW, "2_1", 1),
    mk("1_3", (459, 235), (334, 235), ORANGE, "1_1", 1),
    mk("2_3", (367, 209), (367, 334), YELLOW, "2_1", 0),
    # Round 2 — same four moves again, each arm folding back across the middle,
    # and the rotation reversed. Their ends are the tails.
    mk("2_4", (367, 334), (367, TOP - TAIL), YELLOW, "2_3", 1, last=True),
    mk("1_4", (334, 235), (RIGHT + TAIL, 235), ORANGE, "1_3", 1, last=True),
    mk("2_5", (433, 202), (433, BOTTOM + TAIL), YELLOW, "2_2", 1, last=True),
    mk("1_5", (466, 301), (LEFT - TAIL, 301), ORANGE, "1_2", 1, last=True),
]

scene = {
    "format": "scoubidou3d-scene",
    "version": 2,
    "name": "Box stitch — 2 levels",
    "strands": strands,
    # One mask a round: the move that locks the stitch, where the last arm
    # folded has to dive back UNDER the first one. Every other crossing is told
    # truthfully by the stacking order.
    "masks": [
        {"overId": "1_2", "underId": "2_3"},
        {"overId": "2_4", "underId": "1_5"},
    ],
    # Round 2 starts at the seventh strand.
    "levelBreaks": [6],
}

with open(OUT, "w") as f:
    json.dump(scene, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(f"{OUT}  tail={TAIL}")
