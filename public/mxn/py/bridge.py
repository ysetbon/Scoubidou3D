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


def level1_extensions(m, n, k, hand, direction, search=None):
    if k == 0:
        return None
    _starting, strands, info = NX.build_level_one(
        m, n, k, hand, direction, verbose=False)
    result = NX.align_continuation_level(
        strands, m, n, k, direction, hand, 1, info,
        mirror_sides=m == n, verbose=False, **(search or {}))
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


def _register_level(level, k, checkpoint, result, search):
    """Record what browsing this level needs, and where the engine landed."""
    cands = result.get("candidates") or {"h": [], "v": []}
    h_cands, v_cands = cands.get("h") or [], cands.get("v") or []
    if k == 0:
        enumerated, reason = "none", "k=0 preserves the continuation"
    elif not h_cands or not v_cands:
        # A seeded, pinned or square-mirrored level only ever saw the one
        # combo it was told to use, so there is no list to page through.
        enumerated, reason = "none", "this level was solved from a seed"
    else:
        enumerated, reason = "full", None
    engine_h = tuple(result["horizontal"].get("pair_extensions") or ())
    engine_v = tuple(result["vertical"].get("pair_extensions") or ())
    pick_h = next((i for i, c in enumerate(h_cands) if c["ext"] == engine_h), 0)
    pick_v = next((i for i, c in enumerate(v_cands) if c["ext"] == engine_v), 0)
    _SESSION["levels"][level] = {
        "level": level, "k": k, "checkpoint": checkpoint,
        "h_cands": h_cands, "v_cands": v_cands,
        "search": result.get("search") or {},
        "enumerated": enumerated, "reason": reason,
        "engine_pick_hv": (pick_h, pick_v),
        "engine_pick": 0, "index": 0,
        "truncated": len(h_cands) >= NX.BAND_CANDIDATE_CAP
                     or len(v_cands) >= NX.BAND_CANDIDATE_CAP,
        "found": [], "scan_cursor": 0,
    }


def generate(m, n, ks, hand="lh", direction="cw",
             prefer_short_arms=True, ext_step=None, combo_budget=None):
    m, n = int(m), int(n)
    ks = [int(k) for k in ks]
    if not ks:
        raise ValueError("ks must contain at least one value")
    random.seed(0)
    expected = (m * 2) * (n * 2)
    sizes = (2 * m, 2 * n)
    # One place the search knobs are assembled, so every level -- including
    # the per-k level-1 seed solves -- searches on the same grid as the run.
    search = {"prefer_short_arms": bool(prefer_short_arms)}
    if ext_step:
        search["pair_extension_step"] = int(ext_step)
    if combo_budget:
        search["combo_budget"] = int(combo_budget)
    search["collect_candidates"] = True
    _SESSION.clear()
    _SESSION.update({"m": m, "n": n, "ks": ks, "hand": hand,
                     "direction": direction, "levels": {}})
    started = time.time()
    rows, stages = [], []

    emitProgress("Calculating L₁ with the repository engine…")
    with contextlib.redirect_stdout(io.StringIO()):
        starting_json, strands, level1_info = NX.build_level_one(
            m, n, ks[0], hand, direction, verbose=False)
        stages.append({"level": 0, "k": None, "label": "starting stitch",
                       "strands": _stage_strands(starting_json)})
        virtual_to_real = level1_info["virtual_to_real"]
        # Checkpoint before the level is aligned. deepcopy the pair in ONE
        # call: level_info["new_masks"] holds references into strands, and
        # copying them separately would break that aliasing.
        checkpoint1 = copy.deepcopy((strands, level1_info))
        _send_stage_frame(strands, 1, ks[0], "ring built")
        NX._progress_frame_callback = _candidate_frame_emitter(
            strands, 1, ks[0])
        try:
            result = NX.align_continuation_level(
                strands, m, n, ks[0], direction, hand, 1,
                level1_info, mirror_sides=m == n, verbose=False, **search)
        finally:
            NX._progress_frame_callback = None
        _send_stage_frame(strands, 1, ks[0], "candidate accepted", 1, 1)
        snapshot = [dict(s) for s in strands]
        stages.append({"level": 1, "k": ks[0], "label": "1st twist",
                       "strands": _stage_strands(NX._snapshot_json(strands))})
    rows.append(describe(result, snapshot, 1, ks[0], expected, sizes))
    _register_level(1, ks[0], checkpoint1, result, search)

    seeds = [(rows[0]["ext"][0], rows[0]["ext"][1])]
    level1_for_k = {ks[0]: (tuple(rows[0]["ext"][0]), tuple(rows[0]["ext"][1]))}
    prev_v2r = virtual_to_real
    for level in range(2, len(ks) + 1):
        k_level = ks[level - 1]
        emitProgress(f"Calculating L{level} · k={k_level}…")
        with contextlib.redirect_stdout(io.StringIO()):
            if k_level not in level1_for_k:
                level1_for_k[k_level] = level1_extensions(
                    m, n, k_level, hand, direction, search)
            k_seed = level1_for_k[k_level]
            level_seeds = ([k_seed] if k_seed else []) + list(reversed(seeds))
            strands, info = NX.add_continuation_level(
                strands, m, n, k_level, direction, hand, level,
                k_prev=ks[level - 2], prev_virtual_to_real=prev_v2r,
                verbose=False)
            prev_v2r = info["virtual_to_real"]
            checkpoint = copy.deepcopy((strands, info))
            _send_stage_frame(strands, level, k_level, "ring built")
            NX._progress_frame_callback = _candidate_frame_emitter(
                strands, level, k_level)
            try:
                result = NX.align_continuation_level(
                    strands, m, n, k_level, direction, hand, level, info,
                    seed_extensions=level_seeds, verbose=False, **search)
            finally:
                NX._progress_frame_callback = None
            _send_stage_frame(
                strands, level, k_level, "candidate accepted", 1, 1)
            snapshot = [dict(s) for s in strands]
            stages.append({"level": level, "k": k_level,
                           "label": f"twist {level}",
                           "strands": _stage_strands(NX._snapshot_json(strands))})
        rows.append(describe(result, snapshot, level, k_level, expected, sizes))
        _register_level(level, k_level, checkpoint, result, search)
        seeds.append((rows[-1]["ext"][0], rows[-1]["ext"][1]))

    return json.dumps({
        "m": m, "n": n, "ks": ks, "hand": hand, "direction": direction,
        "expected": expected, "seconds": round(time.time() - started, 1),
        "rows": rows, "stages": stages,
        "solutions": [_solution_meta(_SESSION["levels"][lv])
                      for lv in sorted(_SESSION["levels"])],
    }, separators=(",", ":"))

# ---------------------------------------------------------------------------
# Browsing every valid solution for a level.
#
# The engine enumerates each band's valid configurations anyway and hands them
# over through on_config_callback, so the candidate lists cost nothing extra.
# The two bands are independent -- the V search reads only the V arms and their
# own parents -- so every (H, V) pair is a reachable configuration. Whether the
# ring CLOSES is joint, and that is what NX.apply_solution measures, so the walk
# below tests each pair rather than trusting the per-band validity.
#
# Rings are materialised lazily. The full product is dense but large (2x2 k=1 is
# 101 x 101), and scanning all of it up front costs tens of seconds in Pyodide
# for a list the reader steps through a handful of.
# ---------------------------------------------------------------------------

_SESSION = {}

# How many product cells one select_solution call will walk before returning a
# resume cursor. Keeps a click responsive on a dense level.
RING_SCAN_BUDGET = 4000


def _level_session(level):
    entry = _SESSION.get("levels", {}).get(level)
    if entry is None:
        raise ValueError("level %s has no browsing session; run generate first" % level)
    return entry


def _solution_meta(entry):
    h, v = entry["h_cands"], entry["v_cands"]
    return {
        "level": entry["level"],
        "enumerated": entry["enumerated"],
        "reason": entry.get("reason"),
        "hCount": len(h), "vCount": len(v),
        "candidates": len(h) * len(v),
        "enginePick": entry.get("engine_pick", 0),
        "index": entry.get("index", 0),
        "truncated": entry.get("truncated", False),
    }


def _walk(entry, want_index, healthy_only, cursor):
    """Walk the product in search order and materialise the want_index-th ring.

    Order is lexicographic with H outer and V inner -- the same shape attempt()
    itself uses -- and nothing is re-ranked.
    """
    h_cands, v_cands = entry["h_cands"], entry["v_cands"]
    level, m, n = entry["level"], _SESSION["m"], _SESSION["n"]
    expected = 4 * m * n
    found = entry["found"]
    scanned = 0
    start = cursor or entry.get("scan_cursor") or 0
    total_cells = len(h_cands) * len(v_cands)

    while len(found) <= want_index and start < total_cells:
        if scanned >= RING_SCAN_BUDGET:
            entry["scan_cursor"] = start
            return None, True, start
        i, j = divmod(start, len(v_cands))
        start += 1
        scanned += 1
        strands, info = copy.deepcopy(entry["checkpoint"])
        crossings = NX.apply_solution(strands, info, level, m, n,
                                      _SESSION["hand"], h_cands[i], v_cands[j])
        if crossings != expected:
            continue
        row = describe(_synth_result(entry, h_cands[i], v_cands[j]),
                       [dict(s) for s in strands], level,
                       entry["k"], expected, (2 * m, 2 * n))
        if healthy_only and not row["healthy"]:
            continue
        found.append({"h": i, "v": j, "row": row,
                      "strands": _stage_strands(NX._snapshot_json(strands))})
    entry["scan_cursor"] = start
    if want_index < len(found):
        return found[want_index], False, start
    return None, False, start


def _synth_result(entry, h_cand, v_cand):
    """The shape describe() reads, rebuilt from a candidate pair."""
    def side(cand):
        return {"success": True, "is_fallback": False,
                "average_gap": cand.get("gap") or 0,
                "pair_extensions": list(cand.get("ext") or ())}
    return {"horizontal": side(h_cand), "vertical": side(v_cand),
            "search": entry["search"]}


def enumerate_level(level):
    """Build a candidate list for a level that was solved without one.

    A seeded or pinned level only ever saw the single combo it was told to use,
    and a square level 1 pins V to H through share_square_extensions, so neither
    has anything to page through. Re-solve the level from its checkpoint with no
    seeds and no mirroring, purely to enumerate -- the ring the reader is looking
    at is left exactly as generate() produced it until they actually step.
    """
    entry = _level_session(int(level))
    if entry["enumerated"] == "full" or entry["k"] == 0:
        return json.dumps({"level": entry["level"], "meta": _solution_meta(entry)},
                          separators=(",", ":"))
    m, n = _SESSION["m"], _SESSION["n"]
    strands, info = copy.deepcopy(entry["checkpoint"])
    with contextlib.redirect_stdout(io.StringIO()):
        result = NX.align_continuation_level(
            strands, m, n, entry["k"], _SESSION["direction"], _SESSION["hand"],
            entry["level"], info, mirror_sides=False, seed_extensions=[],
            collect_candidates=True, verbose=False)
    cands = result.get("candidates") or {}
    entry["h_cands"] = cands.get("h") or []
    entry["v_cands"] = cands.get("v") or []
    entry["found"] = []
    entry["scan_cursor"] = 0
    if entry["h_cands"] and entry["v_cands"]:
        entry["enumerated"] = "full"
        entry["reason"] = None
    return json.dumps({"level": entry["level"], "meta": _solution_meta(entry)},
                      separators=(",", ":"))


def trace_level(level, band="v"):
    """Census every (combo, angle) one band of `level` could be asked about.

    Replays the level from its checkpoint the way enumerate_level does, but with
    the band search hooked so its inputs can be handed to mxn_trace. The replay
    is a full search and the census is roughly another two on top of it, so the
    vectorised angle scan is forced on for the duration whatever the page is
    running -- without it a 3x3 trace is tens of seconds.

    Only the verdict census crosses the worker boundary; the page recomputes the
    geometry for whichever cell is being looked at.
    """
    import mxn_lh_continuation as LH
    import mxn_trace

    entry = _level_session(int(level))
    want = "vertical" if str(band).lower().startswith("v") else "horizontal"
    m, n = _SESSION["m"], _SESSION["n"]

    grabbed = []
    real_search = LH._search_combo_space_cpu
    was_fast = LH.FAST_ANGLE_SCAN

    def hook(strands_list, pairs, pair_directions, pair_originals, ext_range_values,
             angle_step_degrees, max_extension, strand_width,
             custom_angle_min, custom_angle_max, angle_mode,
             on_config_callback=None, direction_type="horizontal",
             num_opposite_pairs=1):
        if direction_type == want and not grabbed:
            grabbed.append({
                "strands_list": copy.deepcopy(strands_list),
                "pair_indices": LH._encode_pair_indices(strands_list, pairs),
                "pair_directions": copy.deepcopy(pair_directions),
                "pair_originals": copy.deepcopy(pair_originals),
                "ext_range_values": list(ext_range_values),
                "angle_step_degrees": angle_step_degrees,
                "max_extension": max_extension,
                "strand_width": strand_width,
                "angle_mode": angle_mode,
                "num_opposite_pairs": num_opposite_pairs,
                "direction_type": direction_type,
                "num_strands": len(strands_list),
                "pairs_n": len(pairs),
            })
        return real_search(strands_list, pairs, pair_directions, pair_originals,
                           ext_range_values, angle_step_degrees, max_extension,
                           strand_width, custom_angle_min, custom_angle_max,
                           angle_mode, on_config_callback, direction_type,
                           num_opposite_pairs)

    strands, info = copy.deepcopy(entry["checkpoint"])
    LH._search_combo_space_cpu = hook
    LH.FAST_ANGLE_SCAN = True
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            NX.align_continuation_level(
                strands, m, n, entry["k"], _SESSION["direction"], _SESSION["hand"],
                entry["level"], info, mirror_sides=False, seed_extensions=[],
                collect_candidates=False, verbose=False)
    finally:
        LH._search_combo_space_cpu = real_search
        LH.FAST_ANGLE_SCAN = was_fast

    if not grabbed:
        return json.dumps({
            "level": entry["level"], "band": want, "unavailable": True,
            "reason": "this level solved its %s band without a search" % want,
        }, separators=(",", ":"))

    payload = mxn_trace.pack(mxn_trace.census(grabbed[0]))
    if payload.get("over_budget"):
        return json.dumps({
            "level": entry["level"], "band": want, "unavailable": True,
            "reason": "%d combos x %d angles is over the %d trace ceiling"
                      % (payload["combos"], payload["angles"], payload["budget"]),
            "combos": payload["combos"], "angles": payload["angles"],
        }, separators=(",", ":"))

    picked = entry["engine_pick_hv"][0 if want == "horizontal" else 1]
    cands = entry["h_cands"] if want == "horizontal" else entry["v_cands"]
    payload.update({
        "level": entry["level"], "band": want, "unavailable": False,
        "k": entry["k"],
        "applied": list(cands[picked]["ext"]) if picked < len(cands) else [],
    })
    return json.dumps(payload, separators=(",", ":"))


def select_solution(level, index, healthy_only=False, cursor=None):
    """Materialise solution `index` for `level` and make it the live ring."""
    entry = _level_session(int(level))
    index = max(0, int(index))
    if entry["enumerated"] == "none" and entry["k"] != 0:
        enumerate_level(entry["level"])
    if entry["enumerated"] == "none":
        return json.dumps({"level": entry["level"], "partial": False,
                           "reason": entry.get("reason"),
                           "meta": _solution_meta(entry)}, separators=(",", ":"))
    hit, partial, cur = _walk(entry, index, bool(healthy_only), cursor)
    if hit is None:
        return json.dumps({"level": entry["level"], "partial": partial,
                           "cursor": cur, "count": len(entry["found"]),
                           "meta": _solution_meta(entry)}, separators=(",", ":"))
    entry["index"] = index
    return json.dumps({
        "level": entry["level"], "index": index, "partial": False,
        "count": len(entry["found"]),
        "countExact": entry["scan_cursor"] >= len(entry["h_cands"]) * len(entry["v_cands"]),
        "row": hit["row"], "strands": hit["strands"],
        "meta": _solution_meta(entry),
    }, separators=(",", ":"))


def count_solutions(level):
    """Firm up the exact solution count for a level, budget-bounded."""
    entry = _level_session(int(level))
    _walk(entry, 1 << 30, False, None)
    total = len(entry["h_cands"]) * len(entry["v_cands"])
    return json.dumps({"level": entry["level"], "count": len(entry["found"]),
                       "countExact": entry["scan_cursor"] >= total},
                      separators=(",", ":"))


# ---------------------------------------------------------------------------
# Near-misses: rings where one band is good and the other is what failed.
#
# The ordinary browse keeps only pairs whose joint crossing count reaches
# `expected` and throws the rest away, which is too strict to learn anything
# from. The two bands are searched independently, so a perfectly good set of H
# extensions can be discarded on account of the V it happened to be tested
# against; and what decides a borderline pair is the corner detection, which is
# not yet exact for every k and every m x n.
#
# So hold one band at a value taken from a ring that IS complete, sweep every
# candidate of the other band against it, and keep the ones that fall short.
# Because the held band is known good, the shortfall is attributable to the
# swept band -- which is the whole point. Each row then says "this H value
# failed, against a V that is known to work", and that is a claim a person can
# look at and judge.
#
# One held value is not enough, and getting this wrong is the trap the whole
# routine is here to avoid. A candidate that fails against one partner may close
# against another, and THAT kind is already reachable by browsing -- so calling
# it a near-miss would send a rater to judge something the search never lost.
# Measured on 2x1 k=1: sweeping against one partner reported 59 near-misses, of
# which 40 closed as soon as a second distinct partner was tried. So each band
# is swept against up to SEMI_REFERENCES distinct partners and a candidate is
# kept only if it closed against none of them.
#
# It is still not a proof -- some further partner might close it -- so the number
# of partners tried travels with every row instead of being rounded up to
# "never". A rating is only as good as what the rater was told.
#
# Cost is (len(h) + len(v)) * partners ring replays, not len(h) * len(v): the
# product is what makes a full joint scan unaffordable, and a marginal sweep
# avoids it even several partners deep.
# ---------------------------------------------------------------------------

# Per band, how many candidates one sweep will replay. 1200 rings is a few
# seconds in Pyodide; past that the scan reports itself truncated rather than
# quietly stopping.
SEMI_BAND_CAP = 1200

# How many budgeted _walk chunks to spend collecting complete rings to take
# reference partners from, before giving up and holding the engine's own pick.
SEMI_REF_CHUNKS = 4

# How many complete rings to add per pass while looking for partners, and how
# many distinct partners to sweep each band against.
SEMI_REF_SCAN = 12
SEMI_REFERENCES = 3

# How many of the sorted near-misses to hand back to the page in one reply.
SEMI_RETURN_CAP = 500


def _band_split(strands, level, sizes):
    """This level's new arms, split into the two direction families and named.

    `_split_direction_families` returns the families in geometric order, with no
    opinion about which is which. Name them the way `_stage_strands` colours
    them -- the family whose arms run more up-and-down is the vertical one -- so
    "V" on a rating card means the indigo band the reader is looking at.
    """
    _, _, dst_a, dst_b = NX.level_suffixes(level)
    arms = [s for s in strands if s.get("type") == "AttachedStrand"
            and s["layer_name"].endswith((f"_{dst_a}", f"_{dst_b}"))]
    if len(arms) < 4:
        return None
    by_name = {s["layer_name"]: s for s in arms}
    band_a, band_b, _fan = NX._split_direction_families(by_name, list(by_name), sizes)

    def uprightness(names):
        if not names:
            return 0.0
        total = 0.0
        for name in names:
            arm = by_name[name]
            total += (abs(arm["end"]["y"] - arm["start"]["y"])
                      - abs(arm["end"]["x"] - arm["start"]["x"]))
        return total / len(names)

    if uprightness(band_a) > uprightness(band_b):
        return arms, by_name, list(band_b), list(band_a)
    return arms, by_name, list(band_a), list(band_b)


def band_report(strands, level, expected, sizes, h_arms=None):
    """Score a ring per band, rather than as one number.

    `_ring_crossings` collapses the ring to `across - within`, which cannot say
    which band went wrong. Here the same crossings are counted but kept apart:
    within-band crossings are attributed to the band they happened inside, and
    every arm's reach across the other band is recorded, so an arm that fell
    short can be pointed at.

    Note that `across` alone is symmetric -- if one H arm misses a V arm then
    that V arm equally misses it, so a shortfall in `across` is never by itself
    evidence against one band. What IS one-sided is a fold: a band whose own
    arms cross each other is malformed on its own terms. Both are reported, and
    the sweep below supplies the attribution `across` cannot.

    `h_arms`, when given, names the H band exactly: a candidate's `moves` list
    every arm that band's search controls, so it settles which band is "H"
    without a heuristic. That matters on a non-square, where the engine's H
    group is not always the geometrically horizontal family -- 2x1 puts 1 pair
    in H and 2 in V, and the direction-family split cuts the other way round.
    Reporting `withinH` on one axis while labelling the row on the other would
    put the fold against the wrong band. Falls back to the geometric split for
    callers with no candidate in hand.
    """
    split = _band_split(strands, level, sizes)
    if split is None:
        return None
    arms, _by_name, h_names, v_names = split
    names = {arm["layer_name"] for arm in arms}
    stated = set(h_arms or ()) & names
    if stated and stated != names:
        h_names, v_names = sorted(stated), sorted(names - stated)
    h_set = set(h_names)
    reach = {arm["layer_name"]: 0 for arm in arms}
    across = within_h = within_v = 0
    for i, a in enumerate(arms):
        for b in arms[i + 1:]:
            if NX._segment_crossing(a, b) is None:
                continue
            an, bn = a["layer_name"], b["layer_name"]
            if (an in h_set) == (bn in h_set):
                if an in h_set:
                    within_h += 1
                else:
                    within_v += 1
            else:
                across += 1
                reach[an] += 1
                reach[bn] += 1
    h_short = sum(1 for name in h_names if reach[name] < len(v_names))
    v_short = sum(1 for name in v_names if reach[name] < len(h_names))
    return {
        "across": across, "expected": expected,
        "withinH": within_h, "withinV": within_v,
        "hArms": len(h_names), "vArms": len(v_names),
        "hShort": h_short, "vShort": v_short,
        "hPass": not h_short and not within_h,
        "vPass": not v_short and not within_v,
        "deficit": expected - (across - within_h - within_v),
    }


def _candidate_arms(candidate):
    """The `_4/_5` arm names one band's candidate controls.

    `_project_candidate` records one move per arm the band's search wrote, so
    this is the band's own account of its membership rather than an inference
    from the geometry.
    """
    return [move[0] for move in (candidate.get("moves") or [])]


def _reference_partners(entry):
    """Distinct partners, drawn from rings that close, one list per swept band.

    Sweeping against a single partner cannot tell "this value is bad" from "this
    value did not suit that one partner", and the difference is the whole point:
    the second kind is already reachable by browsing, so calling it a near-miss
    would send a rater to judge something the engine never actually lost.

    Several distinct partners narrow the claim. A candidate that closed against
    none of them is one the search really does throw away. It is still not a
    proof -- some further partner might close it -- which is why the count of
    partners tried travels with every row instead of being rounded up to
    "never".

    An H candidate's partner is a V and vice versa, so the two lists are the
    distinct V and H sides of the complete rings found.
    """
    # Keep going until BOTH sides are diverse, not just until enough rings have
    # been found. Complete rings come out H-outer and V-inner, so the first
    # dozen tend to share one H between them -- and it is the V sweep that needs
    # distinct H partners. Stopping on ring count alone left that sweep with a
    # single partner, which is the weak evidence this is here to avoid.
    total = len(entry["h_cands"]) * len(entry["v_cands"])
    target = SEMI_REF_SCAN
    for _ in range(SEMI_REF_CHUNKS):
        _walk(entry, target, False, None)
        partners = _partners_from(entry["found"])
        if min(len(partners["h"]), len(partners["v"])) >= SEMI_REFERENCES:
            break
        # Exhaustion is the cursor reaching the end of the product, NOT _walk
        # returning partial=False -- it returns that whenever it simply found
        # what it was asked for, which is the common case and would end this
        # loop after a single pass with whatever diversity that pass happened
        # to give. Asking for more rings than are currently held is what makes
        # the next pass go further.
        if entry.get("scan_cursor", 0) >= total:
            break
        target = len(entry["found"]) + SEMI_REF_SCAN
    rings = entry["found"]
    if not rings:
        pick_h, pick_v = entry["engine_pick_hv"]
        return {"h": [pick_v], "v": [pick_h]}, 0
    return _partners_from(rings), len(rings)


def _partners_from(rings):
    """Distinct partner indices per swept band; "h" holds V indices, and back."""
    partners = {"h": [], "v": []}
    for ring in rings:
        if ring["v"] not in partners["h"] and len(partners["h"]) < SEMI_REFERENCES:
            partners["h"].append(ring["v"])
        if ring["h"] not in partners["v"] and len(partners["v"]) < SEMI_REFERENCES:
            partners["v"].append(ring["h"])
    return partners


def scan_semicomplete(level):
    """Sweep both bands against partners that work, and keep what falls short."""
    entry = _level_session(int(level))
    if entry["enumerated"] == "none" and entry["k"] != 0:
        enumerate_level(entry["level"])
    m, n = _SESSION["m"], _SESSION["n"]
    expected = 4 * m * n
    sizes = (2 * m, 2 * n)
    h_cands, v_cands = entry["h_cands"], entry["v_cands"]
    if not h_cands or not v_cands:
        entry["semi"] = []
        return json.dumps({
            "level": entry["level"], "items": [], "count": 0, "truncated": False,
            "grounded": False, "refs": 0,
            "reason": entry.get("reason") or "this level has no candidate lists",
        }, separators=(",", ":"))

    partners, complete_seen = _reference_partners(entry)
    grounded = complete_seen > 0
    items, truncated = [], False
    for band, cands in (("h", h_cands), ("v", v_cands)):
        others = [index for index in partners[band]
                  if index < len(v_cands if band == "h" else h_cands)]
        if not others:
            continue
        if len(cands) > SEMI_BAND_CAP:
            truncated = True
        for index in range(min(len(cands), SEMI_BAND_CAP)):
            best = None
            closed = False
            for other in others:
                i, j = (index, other) if band == "h" else (other, index)
                strands, info = copy.deepcopy(entry["checkpoint"])
                NX.apply_solution(strands, info, entry["level"], m, n,
                                  _SESSION["hand"], h_cands[i], v_cands[j])
                report = band_report(strands, entry["level"], expected, sizes,
                                     _candidate_arms(h_cands[i]))
                if report is None:
                    continue
                if report["deficit"] <= 0:
                    # This value closes the ring with a real partner, so it is
                    # not lost and the ordinary browse already reaches it.
                    closed = True
                    break
                if best is None or report["deficit"] < best[0]["deficit"]:
                    best = (report, i, j)
            if closed or best is None:
                continue
            report, i, j = best
            swept = h_cands[i] if band == "h" else v_cands[j]
            items.append({
                "band": band, "index": index, "h": i, "v": j,
                "refs": len(others),
                "ext": list(swept.get("ext") or ()),
                "heldExt": list((v_cands[j] if band == "h" else h_cands[i]).get("ext") or ()),
                "angle": swept.get("angle"), "gap": swept.get("gap"),
                "hExt": list(h_cands[i].get("ext") or ()),
                "vExt": list(v_cands[j].get("ext") or ()),
                "total": sum(int(e) for e in (h_cands[i].get("ext") or ()))
                         + sum(int(e) for e in (v_cands[j].get("ext") or ())),
                "across": report["across"], "expected": expected,
                "withinH": report["withinH"], "withinV": report["withinV"],
                "deficit": report["deficit"],
                "folded": (report["withinH"] > 0) if band == "h"
                          else (report["withinV"] > 0),
            })

    # Nearest misses first: a ring one crossing short is where the corner test is
    # most likely to be the thing that is wrong, and it is the cheapest to judge.
    items.sort(key=_semi_order("near"))
    entry["semi"] = items
    entry["semi_key"] = "near"
    return json.dumps({
        "level": entry["level"], "count": len(items), "truncated": truncated,
        "key": "near",
        "grounded": grounded, "refs": max(len(partners["h"]), len(partners["v"])),
        "reason": None if grounded else
                  "no complete ring was found to sweep against, so the engine's own "
                  "pick is standing in and the band labels are not proof",
        # The full list stays in the session for select_semicomplete to index
        # into; only the head of it crosses the worker boundary, because a dense
        # level can produce a couple of thousand of these and the page walks
        # them one at a time anyway.
        "items": items[:SEMI_RETURN_CAP],
        "listed": min(len(items), SEMI_RETURN_CAP),
    }, separators=(",", ":"))


def _semi_order(key):
    """The two orderings, as sort keys over one near-miss."""
    if key == "ext":
        # Shortest first. Two rings that fall equally short are not equally
        # interesting: the one that does it on less string is the one worth
        # looking at, so total breaks nothing and deficit breaks the tie.
        return lambda item: (item["total"], item["deficit"], item["band"], item["index"])
    return lambda item: (item["deficit"], item["total"], item["band"], item["index"])


def sort_semicomplete(level, key):
    """
    Reorder the kept near-misses without recomputing them.

    The sweep is the expensive half and its result does not depend on the
    order, so this only moves rows around a list that is already in the
    session -- and the ring on screen stays on screen. Its position changes,
    which is why the new index is computed by identity rather than kept.
    """
    entry = _level_session(int(level))
    items = entry.get("semi")
    if items is None:
        scan_semicomplete(entry["level"])
        items = entry.get("semi") or []
    key = "ext" if str(key) == "ext" else "near"
    position = entry.get("semi_index", 0)
    current = items[position] if 0 <= position < len(items) else None
    items.sort(key=_semi_order(key))
    entry["semi"] = items
    entry["semi_key"] = key
    if current is not None:
        position = next((i for i, item in enumerate(items) if item is current), 0)
    entry["semi_index"] = position
    return json.dumps({
        "level": entry["level"], "key": key, "index": position,
        "count": len(items), "listed": min(len(items), SEMI_RETURN_CAP),
        "items": items[:SEMI_RETURN_CAP],
    }, separators=(",", ":"))


def step_semicomplete(level, band, direction):
    """
    Move along one band's extension with the other band held where it is.

    The ‹ › arrows walk the whole list in whatever order it is sorted, which
    mixes both bands and every extension at once. This asks a narrower
    question -- keep this V, what is the next H that also falls short? -- and
    it is the question the sweep is built out of, since every near-miss is one
    band varied against a partner that stayed put.

    "Next" is by extension, not by candidate index: the index is enumeration
    order and means nothing to the eye, while the extension is the number on
    the card.
    """
    entry = _level_session(int(level))
    items = entry.get("semi")
    if items is None:
        scan_semicomplete(entry["level"])
        items = entry.get("semi") or []
    position = entry.get("semi_index", 0)
    if not items or not (0 <= position < len(items)):
        return json.dumps({"level": entry["level"], "count": len(items or []),
                           "reason": "no near-miss is selected"},
                          separators=(",", ":"))

    band = "h" if str(band) == "h" else "v"
    forward = int(direction) >= 0
    current = items[position]
    # Hold the OTHER band's candidate, so the ring on screen changes in one
    # axis only. Holding by candidate index rather than by extension value is
    # deliberate: two candidates can share an extension and still be different
    # rings, and swapping to one of those is not "held".
    held = "v" if band == "h" else "h"
    measure = (lambda item: sum(item["hExt"])) if band == "h" \
        else (lambda item: sum(item["vExt"]))
    here = measure(current)

    best = None
    for index, item in enumerate(items):
        if index == position or item[held] != current[held]:
            continue
        value = measure(item)
        if forward and value <= here:
            continue
        if not forward and value >= here:
            continue
        # Nearest step in the asked-for direction, so repeated clicks walk the
        # extensions in order instead of jumping to the end of the run.
        if best is None or (value < best[0] if forward else value > best[0]):
            best = (value, index)

    if best is None:
        return json.dumps({
            "level": entry["level"], "index": position, "count": len(items),
            "reason": "no {0} near-miss {1} {2}px with this {3} held".format(
                band.upper(), "above" if forward else "below", here, held.upper()),
        }, separators=(",", ":"))
    return select_semicomplete(entry["level"], best[1])


def select_semicomplete(level, index):
    """Materialise near-miss `index` so it can be drawn, audited and starred."""
    entry = _level_session(int(level))
    items = entry.get("semi")
    if items is None:
        scan_semicomplete(entry["level"])
        items = entry.get("semi") or []
    index = max(0, int(index))
    if not items:
        return json.dumps({"level": entry["level"], "count": 0,
                           "reason": "nothing fell short for this level"},
                          separators=(",", ":"))
    index = min(index, len(items) - 1)
    item = items[index]
    m, n = _SESSION["m"], _SESSION["n"]
    expected = 4 * m * n
    strands, info = copy.deepcopy(entry["checkpoint"])
    NX.apply_solution(strands, info, entry["level"], m, n, _SESSION["hand"],
                      entry["h_cands"][item["h"]], entry["v_cands"][item["v"]])
    row = describe(_synth_result(entry, entry["h_cands"][item["h"]],
                                 entry["v_cands"][item["v"]]),
                   [dict(s) for s in strands], entry["level"], entry["k"],
                   expected, (2 * m, 2 * n))
    entry["semi_index"] = index
    return json.dumps({
        "level": entry["level"], "index": index, "count": len(items),
        "item": item, "row": row,
        "strands": _stage_strands(NX._snapshot_json(strands)),
    }, separators=(",", ":"))
