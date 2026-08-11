"""Render the traced MXN band search to a video.

Every (combo, angle) the search could evaluate gets a verdict from mxn_trace --
including the ones production never reaches -- and this draws the whole census:
the strands themselves, the grid of extension combos, and the angle sweep inside
each combo, with one icon per test the algorithm applies.

    python3 scripts/mxn_trace_video.py 2 1 1 out.webm

ffmpeg here is Playwright's build: JPEG in over image2pipe, VP8 out to webm. It
has no H.264 encoder, so mp4 is not available.
"""
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mxn_trace import (BEST, DEGEN, NAMES, ORDER, OVERLAP, REACH, TOOFAR,  # noqa: E402
                       VALID, WINDOW, capture_bands, trace_band)

W, H, FPS = 1280, 720, 12
FFMPEG = "/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux"

PAPER = (244, 240, 230)
INK = (26, 26, 26)
FAINT = (150, 145, 132)
RULE = (200, 194, 180)

COLOUR = {
    WINDOW:  (176, 172, 160),
    REACH:   (198, 60, 40),
    DEGEN:   (120, 20, 20),
    ORDER:   (226, 138, 28),
    OVERLAP: (146, 74, 176),
    TOOFAR:  (52, 116, 196),
    VALID:   (58, 156, 88),
    BEST:    (212, 168, 30),
}
BLURB = {
    WINDOW:  "outside +/-20 window - never tried",
    REACH:   "strand cannot reach its target",
    DEGEN:   "strand line collapsed",
    ORDER:   "gaps disagree in sign - order wrong",
    OVERLAP: "gap below min - strands too close",
    TOOFAR:  "gap above max - band pulled apart",
    VALID:   "every test passed",
    BEST:    "chosen for this combo",
}
# The legend has seven columns across 1220px, so it gets its own wording rather
# than a truncation of the long one.
SHORT = {
    WINDOW: "never tried", REACH: "falls short", DEGEN: "collapsed",
    ORDER: "order wrong", OVERLAP: "too close", TOOFAR: "too far",
    VALID: "passed", BEST: "chosen",
}


def font(size, bold=False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(f"/usr/share/fonts/truetype/dejavu/{name}", size)


F_TITLE, F_HEAD, F_BODY, F_SMALL, F_TINY = (
    font(30, True), font(19, True), font(16), font(14), font(12))


def icon(dr, x, y, code, r=7):
    """One glyph per test the algorithm applies -- the legend key."""
    c = COLOUR[code]
    if code == WINDOW:                                  # not tried
        dr.rectangle([x - r, y - r, x + r, y + r], outline=c, width=2)
        dr.line([x - r, y + r, x + r, y - r], fill=c, width=2)
    elif code == REACH:                                 # falls short
        dr.line([x - r, y, x + 1, y], fill=c, width=3)
        dr.ellipse([x + 3, y - 3, x + 9, y + 3], outline=c, width=2)
    elif code == DEGEN:
        dr.line([x - r, y - r, x + r, y + r], fill=c, width=3)
        dr.line([x - r, y + r, x + r, y - r], fill=c, width=3)
    elif code == ORDER:                                 # crossed
        dr.line([x - r, y - r, x + r, y + r], fill=c, width=3)
        dr.line([x - r, y + r, x + r, y - r], fill=c, width=3)
        dr.ellipse([x - r - 3, y - r - 3, x + r + 3, y + r + 3], outline=c, width=1)
    elif code == OVERLAP:                               # bars too close
        dr.line([x - 2, y - r, x - 2, y + r], fill=c, width=3)
        dr.line([x + 2, y - r, x + 2, y + r], fill=c, width=3)
    elif code == TOOFAR:                                # bars too far
        dr.line([x - r, y - r, x - r, y + r], fill=c, width=3)
        dr.line([x + r, y - r, x + r, y + r], fill=c, width=3)
        dr.line([x - r + 2, y, x + r - 2, y], fill=c, width=1)
    elif code == VALID:                                 # tick
        dr.line([x - r, y, x - 2, y + r - 1], fill=c, width=3)
        dr.line([x - 2, y + r - 1, x + r, y - r], fill=c, width=3)
    elif code == BEST:                                  # star
        pts = []
        for i in range(10):
            ang = -np.pi / 2 + i * np.pi / 5
            rad = r + 2 if i % 2 == 0 else (r + 2) * 0.45
            pts.append((x + rad * np.cos(ang), y + rad * np.sin(ang)))
        dr.polygon(pts, fill=c)


class Renderer:
    def __init__(self, traces, applied, m, n, ks):
        self.running_total = 0
        self.traces = traces
        self.applied = applied
        self.title = f"{m}x{n}   k = {', '.join(map(str, ks))}"
        self.bounds = []
        for tr in traces:
            pts = []
            for row in tr["rows"]:
                pts.append(row["starts"])
                pts.append(row["ends"].transpose(0, 2, 1).reshape(-1, 2))
            allp = np.concatenate(pts)
            self.bounds.append((allp[:, 0].min(), allp[:, 0].max(),
                                allp[:, 1].min(), allp[:, 1].max()))

    # ---------- panels ----------
    def _frame(self, band_label, sub):
        img = Image.new("RGB", (W, H), PAPER)
        dr = ImageDraw.Draw(img)
        dr.text((30, 22), "MXN continuation search, fully traced", INK, F_TITLE)
        dr.text((30, 60), f"{self.title}    ·    {band_label}", (70, 68, 60), F_HEAD)
        dr.text((30, 84), sub, FAINT, F_SMALL)
        dr.line([30, 108, W - 30, 108], fill=RULE, width=2)
        if self.running_total:
            dr.text((W - 250, 30), "evaluations shown", FAINT, F_SMALL)
            dr.text((W - 250, 50), f"{self.running_total:,}", INK, font(26, True))
        return img, dr

    def _geometry(self, dr, ti, row, ai, box):
        x0, y0, x1, y1 = box
        dr.rectangle(box, outline=RULE, width=1)
        dr.text((x0 + 8, y0 + 6), "strands at this combo and angle", INK, F_SMALL)
        bx0, bx1, by0, by1 = self.bounds[ti]
        pad = 40
        sx = (x1 - x0 - 2 * pad) / max(bx1 - bx0, 1e-6)
        sy = (y1 - y0 - 2 * pad - 20) / max(by1 - by0, 1e-6)
        s = min(sx, sy)
        ox = x0 + pad + ((x1 - x0 - 2 * pad) - (bx1 - bx0) * s) / 2
        oy = y0 + pad + 16

        def P(p):
            return (ox + (p[0] - bx0) * s, oy + (p[1] - by0) * s)

        starts = row["starts"]
        ends = row["ends"][:, :, ai]
        verdict = int(row["verdicts"][ai])
        for i in range(len(starts)):
            a, b = P(starts[i]), P(ends[i])
            dr.line([a, b], fill=(90, 88, 82), width=5)
            dr.ellipse([a[0] - 4, a[1] - 4, a[0] + 4, a[1] + 4], fill=INK)
            dr.text((a[0] - 20, a[1] - 6), f"S{i}", (110, 106, 98), F_TINY)
        # The gap the engine tests is the perpendicular distance from the next
        # strand's start onto this strand's line, so draw that foot rather than a
        # line between the two starts -- which is a different, longer quantity.
        gaps = row["gaps"][:, ai]
        for i, g in enumerate(gaps):
            u = ends[i] - starts[i]
            nu = float(np.hypot(*u))
            if nu < 1e-6:
                continue
            u = u / nu
            w = starts[i + 1] - starts[i]
            foot = starts[i] + float(w @ u) * u
            a, b = P(starts[i + 1]), P(foot)
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            ok = self.min_gap <= g <= self.max_gap
            col = COLOUR[VALID] if ok else (COLOUR[OVERLAP] if g < self.min_gap
                                            else COLOUR[TOOFAR])
            dr.line([a, b], fill=col, width=2)
            dr.text((mid[0] + 6, mid[1] - 8), f"{g:.0f}", col, F_SMALL)
        dr.text((x0 + 8, y1 - 42),
                f"gap must land in {self.min_gap:.0f}-{self.max_gap:.0f} px", FAINT, F_TINY)
        dr.text((x0 + 8, y1 - 26),
                "coloured ticks are the measured perpendicular gaps", FAINT, F_TINY)
        icon(dr, x1 - 26, y0 + 18, verdict)

    def _grid(self, dr, tr, upto, box, cur=None):
        x0, y0, x1, y1 = box
        dr.text((x0, y0 - 22), "every extension combo", INK, F_SMALL)
        rows = tr["rows"]
        P = tr["band"]["pairs_n"]
        vals = tr["band"]["ext_range_values"]
        E = len(vals)
        if P == 1:
            cols, rws = E, 1
        else:
            cols, rws = E, E
        cw = min((x1 - x0) / cols, (y1 - y0) / max(rws, 1), 26)
        for idx in range(min(upto + 1, len(rows))):
            r = rows[idx]
            cx = x0 + (idx % cols) * cw
            cy = y0 + (idx // cols) * cw
            v = r["verdicts"]
            best = BEST if r["best"] is not None else int(
                np.bincount(v[v != WINDOW], minlength=8).argmax()) if np.any(v != WINDOW) else WINDOW
            dr.rectangle([cx, cy, cx + cw - 2, cy + cw - 2], fill=COLOUR[best])
            if tuple(r["combo"]) == self.applied.get(tr["band"]["direction_type"]):
                # The one the level adopted. A star, not another outline, so it
                # cannot be mistaken for the cursor when the two sit side by side.
                icon(dr, cx + cw / 2 - 1, cy + cw / 2 - 1, BEST, r=int(cw / 2))
                dr.rectangle([cx - 1, cy - 1, cx + cw - 1, cy + cw - 1],
                             outline=INK, width=2)
        if cur is not None and cur < len(rows):
            cx = x0 + (cur % cols) * cw
            cy = y0 + (cur // cols) * cw
            dr.rectangle([cx - 3, cy - 3, cx + cw + 1, cy + cw + 1],
                         outline=(198, 60, 40), width=3)
        dr.text((x0, y0 + max(rws, 1) * cw + 10),
                "red box = combo being evaluated      star = the combo this level adopted",
                FAINT, F_TINY)
        return cw

    def _strip(self, dr, row, box, ai=None):
        x0, y0, x1, y1 = box
        dr.text((x0, y0 - 22), "every angle inside this combo", INK, F_SMALL)
        v = row["verdicts"]
        n = len(v)
        bw = (x1 - x0) / n
        for i in range(n):
            dr.rectangle([x0 + i * bw, y0, x0 + (i + 1) * bw, y1],
                         fill=COLOUR[int(v[i])])
        inside = np.where(v != WINDOW)[0]
        if len(inside):
            for e in (inside[0], inside[-1] + 1):
                dr.line([x0 + e * bw, y0 - 6, x0 + e * bw, y1 + 6], fill=INK, width=2)
            dr.text((x0 + inside[0] * bw, y1 + 8), "window", INK, F_TINY)
        if ai is not None:
            dr.line([x0 + ai * bw, y0 - 10, x0 + ai * bw, y1 + 10], fill=INK, width=2)

    def _legend(self, dr, tally, y):
        dr.line([30, y - 14, W - 30, y - 14], fill=RULE, width=1)
        for j, code in enumerate([WINDOW, REACH, ORDER, OVERLAP, TOOFAR, VALID, BEST]):
            cx = 44 + j * 174
            icon(dr, cx, y + 12, code)
            dr.text((cx + 16, y + 2), NAMES[code], COLOUR[code], F_SMALL)
            dr.text((cx + 16, y + 20), f"{tally.get(code, 0):,}", INK, F_BODY)
            dr.text((cx + 16, y + 40), SHORT[code], FAINT, F_TINY)


def build(m, n, ks, out):
    bands = capture_bands(m, n, ks)
    import bridge, json
    applied_rows = json.loads(bridge.generate(m, n, ks, "lh", "cw"))["rows"]
    ext = applied_rows[0].get("ext") or [[], []]
    applied = {"horizontal": tuple(ext[0]), "vertical": tuple(ext[1])}

    traces = []
    for b in bands:
        print(f"  tracing {b['direction_type']} N={b['num_strands']} P={b['pairs_n']}…")
        traces.append(trace_band(b))

    R = Renderer(traces, applied, m, n, ks)
    proc = subprocess.Popen(
        # pipe:0, not "-": this build compiles in only the pipe and file
        # protocols, and "-" resolves to fd:, which it would reject.
        [FFMPEG, "-y", "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", str(FPS),
         "-i", "pipe:0", "-c:v", "libvpx", "-b:v", "3M", "-pix_fmt", "yuv420p",
         "-an", out],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    tally = {}
    frames = 0

    def emit(img):
        nonlocal frames
        img.save(proc.stdin, "JPEG", quality=88)
        frames += 1

    def hold(img, seconds):
        for _ in range(int(seconds * FPS)):
            emit(img)

    # ---- title ----
    img, dr = R._frame("", "")
    dr.text((30, 200), "Nothing is skipped.", INK, font(46, True))
    dr.text((30, 262),
            "The real search stops at the first failed test and never looks outside",
            (70, 68, 60), font(22))
    dr.text((30, 292),
            "its +/-20 degree window. This traces every test on every combo and every",
            (70, 68, 60), font(22))
    dr.text((30, 322),
            "angle, and records what would have been skipped instead of skipping it.",
            (70, 68, 60), font(22))
    for j, code in enumerate([WINDOW, REACH, ORDER, OVERLAP, TOOFAR, VALID, BEST]):
        cy = 400 + j * 38
        icon(dr, 52, cy + 8, code)
        dr.text((78, cy), NAMES[code], COLOUR[code], F_HEAD)
        dr.text((190, cy + 2), BLURB[code], (70, 68, 60), F_BODY)
    hold(img, 4.5)

    for ti, tr in enumerate(traces):
        band = tr["band"]
        R.min_gap, R.max_gap = tr["min_gap"], tr["max_gap"]
        label = (f"{band['direction_type']} band  ·  {band['num_strands']} strands  ·  "
                 f"{band['pairs_n']} extension pair{'s' if band['pairs_n'] > 1 else ''}")
        rows = tr["rows"]
        n_ang = len(rows[0]["verdicts"])
        sub = (f"{len(rows)} combos x {n_ang} angles = "
               f"{len(rows)*n_ang:,} evaluations, all of them shown")

        # sweep every combo, one frame each
        for ci, row in enumerate(rows):
            for code, cnt in zip(*np.unique(row["verdicts"], return_counts=True)):
                tally[int(code)] = tally.get(int(code), 0) + int(cnt)
            R.running_total = sum(tally.values())
            img, dr = R._frame(label, sub)
            show = row["best"] if row["best"] is not None else int(
                np.argmax(row["verdicts"] != WINDOW))
            R._geometry(dr, ti, row, show, (30, 130, 600, 560))
            R._grid(dr, tr, ci, (640, 152, 1250, 400), cur=ci)
            R._strip(dr, row, (640, 452, 1250, 496), ai=show)
            dr.text((640, 520), f"combo {ci+1} of {len(rows)}   "
                                f"extensions {tuple(int(v) for v in row['combo'])}",
                    INK, F_BODY)
            R._legend(dr, tally, 590)
            emit(img)

        # walk the angles of one combo in detail
        pick = next((i for i, r in enumerate(rows) if r["best"] is not None), 0)
        row = rows[pick]
        idxs = np.linspace(0, n_ang - 1, 48).astype(int)
        for ai in idxs:
            R.running_total = sum(tally.values())
            img, dr = R._frame(label, "inside one combo: every angle, one at a time")
            R._geometry(dr, ti, row, int(ai), (30, 130, 600, 560))
            R._grid(dr, tr, len(rows) - 1, (640, 152, 1250, 400), cur=pick)
            R._strip(dr, row, (640, 452, 1250, 496), ai=int(ai))
            v = int(row["verdicts"][ai])
            dr.text((640, 520), f"angle {row['angles'][ai]:.1f}deg", INK, F_BODY)
            icon(dr, 648, 552, v)
            dr.text((666, 542), f"{NAMES[v]} - {BLURB[v]}", COLOUR[v], F_BODY)
            R._legend(dr, tally, 590)
            emit(img)

    # ---- summary ----
    img, dr = R._frame("", "")
    dr.text((30, 170), "What the search actually spends itself on", INK, font(34, True))
    total = sum(tally.values())
    y = 240
    for code in [WINDOW, REACH, DEGEN, ORDER, OVERLAP, TOOFAR, VALID, BEST]:
        if not tally.get(code):
            continue
        icon(dr, 52, y + 12, code)
        dr.text((80, y), NAMES[code], COLOUR[code], F_HEAD)
        dr.text((220, y + 2), BLURB[code], (70, 68, 60), F_BODY)
        pct = 100 * tally[code] / total
        dr.rectangle([700, y + 4, 700 + 380 * tally[code] / total, y + 22],
                     fill=COLOUR[code])
        dr.text((1096, y + 2), f"{tally[code]:>7,}  {pct:4.1f}%", INK, F_BODY)
        y += 42
    dr.text((30, y + 16), f"{total:,} evaluations in total — "
                          f"the real engine performs only the non-WINDOW ones, "
                          f"and stops each at its first failure.", FAINT, F_BODY)
    hold(img, 5)

    proc.stdin.close()
    proc.wait()
    print(f"  {frames} frames at {FPS} fps = {frames/FPS:.1f}s -> {out}")


if __name__ == "__main__":
    m, n = int(sys.argv[1]), int(sys.argv[2])
    ks = [int(x) for x in sys.argv[3].split(",")]
    out = sys.argv[4] if len(sys.argv) > 4 else "mxn-trace.webm"
    build(m, n, ks, out)
