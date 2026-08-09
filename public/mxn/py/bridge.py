"""Browser bridge for the repository's real continuation calculation.

This is the calculation path from continuation/make_diagrams.py, adapted to
return JSON instead of writing PNG files. Level 1 is grown with the same
purple-crossing anchor routine used by every later continuation level.
"""
import contextlib
import copy
import io
import json
import random
import sys
import time

import mxn_continuation_next as NX
from ui_utils import _get_active_strands


try:
    from js import emitFrame, emitProgress
except ImportError:
    def emitFrame(_payload):
        pass

    def emitProgress(_message):
        pass


if sys.platform == "emscripten":
    # Web Workers have no Python subprocesses. The engine's serial path uses
    # the same evaluator and ordering, so results remain deterministic.
    NX._lh._get_cpu_worker_count = lambda _total: 1


def _stage_strands(json_text):
    strands = _get_active_strands(json.loads(json_text))
    # Match continuation/render_svg.py: classify sets from the source _2 arms,
    # then keep horizontal sets white/green and vertical sets indigo outward.
    horizontal = [
        {"r": 255, "g": 255, "b": 255, "a": 255},
        {"r": 85, "g": 170, "b": 0, "a": 255},
    ]
    vertical = [
        {"r": 61, "g": 58, "b": 140, "a": 255},
        {"r": 123, "g": 113, "b": 214, "a": 255},
    ]
    vertical_sets = sorted({s["set_number"] for s in strands
                            if s.get("type") != "MaskedStrand"
                            and s.get("layer_name", "").endswith("_2")
                            and abs(s["end"]["y"] - s["start"]["y"])
                            > abs(s["end"]["x"] - s["start"]["x"])})
    all_sets = sorted({s["set_number"] for s in strands
                       if s.get("type") != "MaskedStrand"
                       and isinstance(s.get("set_number"), int)})
    horizontal_sets = [num for num in all_sets if num not in vertical_sets]
    for strand in strands:
        set_number = strand.get("set_number")
        if strand.get("type") != "MaskedStrand" and isinstance(set_number, int) and set_number > 0:
            if set_number in vertical_sets:
                strand["color"] = dict(vertical[vertical_sets.index(set_number) % len(vertical)])
            else:
                strand["color"] = dict(horizontal[horizontal_sets.index(set_number) % len(horizontal)])
    return strands


def audit(strands, level, sizes=None):
    _, _, dst_a, dst_b = NX.level_suffixes(level)
    arms = [s for s in strands if s.get("type") == "AttachedStrand"
            and s["layer_name"].endswith((f"_{dst_a}", f"_{dst_b}"))]
    if len(arms) < 4:
        return 0, 0, 0, 0, 0
    by_name = {s["layer_name"]: s for s in arms}
    band_a, _band_b, _fan = NX._split_direction_families(by_name, list(by_name), sizes)
    band_a = set(band_a)
    masks = [s for s in strands if s.get("type") == "MaskedStrand"
             and NX._is_level_mask(s.get("layer_name", ""), dst_a, dst_b)]
    masked_over = {frozenset((s.get("first_selected_strand"),
                              s.get("second_selected_strand"))):
                   s.get("first_selected_strand") for s in masks}
    draw_index = {s["layer_name"]: i for i, s in enumerate(strands)}
    across = within = 0
    crossing_pairs = set()
    along = {a["layer_name"]: [] for a in arms}
    for i, a in enumerate(arms):
        for b in arms[i + 1:]:
            crossing = NX._segment_crossing(a, b)
            if crossing is None:
                continue
            an, bn = a["layer_name"], b["layer_name"]
            crossing_pairs.add(frozenset((an, bn)))
            if (an in band_a) == (bn in band_a):
                within += 1
            else:
                across += 1
            over = masked_over.get(frozenset((an, bn)))
            if over is None:
                over = an if draw_index[an] > draw_index[bn] else bn
            along[an].append((crossing, over == an))
            reverse_crossing = NX._segment_crossing(b, a)
            along[bn].append((reverse_crossing, over == bn))
    broken = 0
    for seq in along.values():
        seq.sort()
        if any(seq[i][1] == seq[i + 1][1] for i in range(len(seq) - 1)):
            broken += 1
    stray = sum(1 for s in masks
                if frozenset((s.get("first_selected_strand"),
                              s.get("second_selected_strand"))) not in crossing_pairs)
    return across, within, len(masks), stray, broken


def describe(result, strands, level, k, expected, sizes=None):
    across, within, masks, stray, broken = audit(strands, level, sizes)
    def state(axis):
        row = result[axis]
        return "ok" if row.get("success") else ("fb" if row.get("is_fallback") else "FAIL")
    search = result["search"]
    applied = []
    if search["horizontal"].get("seeded") or search["vertical"].get("seeded"):
        applied.append("seeded")
    if search["horizontal"].get("rescued") or search["vertical"].get("rescued"):
        applied.append("regrouped")
    if search["horizontal"].get("mirrored") or search["vertical"].get("mirrored"):
        applied.append("bands mirrored")
    if search.get("masks_relaid"):
        applied.append("masks re-laid")
    return {
        "level": level, "k": k, "expected": expected,
        "state": f"{state('horizontal')}/{state('vertical')}",
        "gap": [result["horizontal"].get("average_gap", 0),
                result["vertical"].get("average_gap", 0)],
        "ext": [list(result["horizontal"].get("pair_extensions") or ()),
                list(result["vertical"].get("pair_extensions") or ())],
        "across": across, "within": within, "masks": masks,
        "stray": stray, "broken": broken, "applied": applied,
        "healthy": across == expected and not within and not stray and not broken,
    }


def level1_extensions(m, n, k, hand, direction):
    if k == 0:
        return None
    _starting, strands, info = NX.build_level_one(
        m, n, k, hand, direction, verbose=False)
    result = NX.align_continuation_level(
        strands, m, n, k, direction, hand, 1, info,
        mirror_sides=m == n, verbose=False)
    horizontal = tuple(result["horizontal"].get("pair_extensions") or ())
    vertical = tuple(result["vertical"].get("pair_extensions") or ())
    return (horizontal, vertical) if horizontal and vertical else None


def _send_stage_frame(strands, level, k, phase, completed=0, total=0,
                      valid=0, angle=None, extensions=None):
    emitFrame(json.dumps({
        "level": level,
        "k": k,
        "phase": phase,
        "completed": int(completed),
        "total": int(total),
        "valid": int(valid),
        "angle": angle,
        "extensions": list(extensions or ()),
        "strands": _stage_strands(json.dumps({"strands": strands})),
    }, separators=(",", ":")))


def _candidate_frame_emitter(base_strands, level, k):
    last_sent = [0.0]

    def relay(virtual_strands, back_map, meta):
        now = time.monotonic()
        completed = int(meta.get("completed", 0))
        total = int(meta.get("total", 0))
        if completed < total and now - last_sent[0] < 0.18:
            return
        last_sent[0] = now

        preview = copy.deepcopy(base_strands)
        by_name = {strand.get("layer_name"): strand for strand in preview}
        for virtual in virtual_strands:
            real = back_map.get(virtual.get("layer_name"))
            if real is None:
                continue
            target = by_name.get(real.get("layer_name"))
            if target is None:
                continue
            for field in ("start", "end", "control_points",
                          "control_point_center"):
                if field in virtual:
                    target[field] = copy.deepcopy(virtual[field])

        # Keep mask geometry attached to its current owner in the preview.
        for strand in preview:
            if strand.get("type") != "MaskedStrand":
                continue
            owner = by_name.get(strand.get("first_selected_strand"))
            if owner is not None:
                strand["start"] = copy.deepcopy(owner["start"])
                strand["end"] = copy.deepcopy(owner["end"])

        _send_stage_frame(
            preview,
            level,
            k,
            meta.get("phase", "candidate"),
            meta.get("completed", 0),
            meta.get("total", 0),
            meta.get("valid", 0),
            meta.get("angle"),
            meta.get("extensions"),
        )

    return relay


def generate(m, n, ks, hand="lh", direction="cw"):
    m, n = int(m), int(n)
    ks = [int(k) for k in ks]
    if not ks:
        raise ValueError("ks must contain at least one value")
    random.seed(0)
    expected = (m * 2) * (n * 2)
    sizes = (2 * m, 2 * n)
    started = time.time()
    rows, stages = [], []

    emitProgress("Calculating L₁ with the repository engine…")
    with contextlib.redirect_stdout(io.StringIO()):
        starting_json, strands, level1_info = NX.build_level_one(
            m, n, ks[0], hand, direction, verbose=False)
        stages.append({"level": 0, "k": None, "label": "starting stitch",
                       "strands": _stage_strands(starting_json)})
        virtual_to_real = level1_info["virtual_to_real"]
        _send_stage_frame(strands, 1, ks[0], "ring built")
        NX._progress_frame_callback = _candidate_frame_emitter(
            strands, 1, ks[0])
        try:
            result = NX.align_continuation_level(
                strands, m, n, ks[0], direction, hand, 1,
                level1_info, mirror_sides=m == n, verbose=False)
        finally:
            NX._progress_frame_callback = None
        _send_stage_frame(strands, 1, ks[0], "candidate accepted", 1, 1)
        snapshot = [dict(s) for s in strands]
        stages.append({"level": 1, "k": ks[0], "label": "1st twist",
                       "strands": _stage_strands(NX._snapshot_json(strands))})
    rows.append(describe(result, snapshot, 1, ks[0], expected, sizes))

    seeds = [(rows[0]["ext"][0], rows[0]["ext"][1])]
    level1_for_k = {ks[0]: (tuple(rows[0]["ext"][0]), tuple(rows[0]["ext"][1]))}
    prev_v2r = virtual_to_real
    for level in range(2, len(ks) + 1):
        k_level = ks[level - 1]
        emitProgress(f"Calculating L{level} · k={k_level}…")
        with contextlib.redirect_stdout(io.StringIO()):
            if k_level not in level1_for_k:
                level1_for_k[k_level] = level1_extensions(
                    m, n, k_level, hand, direction)
            k_seed = level1_for_k[k_level]
            level_seeds = ([k_seed] if k_seed else []) + list(reversed(seeds))
            strands, info = NX.add_continuation_level(
                strands, m, n, k_level, direction, hand, level,
                k_prev=ks[level - 2], prev_virtual_to_real=prev_v2r,
                verbose=False)
            prev_v2r = info["virtual_to_real"]
            _send_stage_frame(strands, level, k_level, "ring built")
            NX._progress_frame_callback = _candidate_frame_emitter(
                strands, level, k_level)
            try:
                result = NX.align_continuation_level(
                    strands, m, n, k_level, direction, hand, level, info,
                    seed_extensions=level_seeds, verbose=False)
            finally:
                NX._progress_frame_callback = None
            _send_stage_frame(
                strands, level, k_level, "candidate accepted", 1, 1)
            snapshot = [dict(s) for s in strands]
            stages.append({"level": level, "k": k_level,
                           "label": f"twist {level}",
                           "strands": _stage_strands(NX._snapshot_json(strands))})
        rows.append(describe(result, snapshot, level, k_level, expected, sizes))
        seeds.append((rows[-1]["ext"][0], rows[-1]["ext"][1]))

    return json.dumps({
        "m": m, "n": n, "ks": ks, "hand": hand, "direction": direction,
        "expected": expected, "seconds": round(time.time() - started, 1),
        "rows": rows, "stages": stages,
    }, separators=(",", ":"))
