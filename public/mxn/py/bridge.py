"""Browser bridge for the repository's real continuation calculation.

This is the calculation path from continuation/make_diagrams.py, adapted to
return JSON instead of writing PNG files. Level 1 is grown with the same
purple-crossing anchor routine used by every later continuation level.
"""
import contextlib
import copy
import io
import json
import pickle
import random
import sys
import time

import mxn_continuation_next as NX
from ui_utils import _get_active_strands


try:
    from js import emitFrame, emitProgress, emitTrace
except ImportError:
    def emitFrame(_payload):
        pass

    def emitProgress(_message):
        pass

    def emitTrace(_payload):
        pass

# Its own import so a worker that predates it keeps loading: the farm defines
# emitSearch to fill its progress bars; the lab's workers never need to.
try:
    from js import emitSearch
except ImportError:
    def emitSearch(_payload):
        pass


if sys.platform == "emscripten":
    # Web Workers have no Python subprocesses. The engine's serial path uses
    # the same evaluator and ordering, so results remain deterministic.
    NX._lh._get_cpu_worker_count = lambda _total: 1
    # The candidate relay fires at most once per chunk, so the chunk size IS
    # the ceiling on how often the busy sheet can switch tiles. The native
    # default of up to 256 combos per chunk amortises process-spawn overhead
    # the browser does not have; a chunk's only fixed cost here is one clone
    # of the strand list, so 32 keeps that overhead trivial while letting
    # candidates surface often enough for FRAME_MIN_INTERVAL to be the only
    # gate that matters.
    NX._lh._get_cpu_chunk_size = lambda total, _workers: max(1, min(32, total))


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
    if search["horizontal"].get("judged") or search["vertical"].get("judged"):
        applied.append("judged ring")
    if search["horizontal"].get("placed") or search["vertical"].get("placed"):
        applied.append("placed at the ring below")
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
                      valid=0, angle=None, extensions=None, trace=None):
    emitFrame(json.dumps({
        "level": level,
        "k": k,
        "phase": phase,
        "completed": int(completed),
        "total": int(total),
        "valid": int(valid),
        "angle": angle,
        "extensions": list(extensions or ()),
        # Which band's trace replay this frame belongs to, when it is one. The
        # run's own frames carry no tag, so the busy sheet and a level widget
        # never draw each other's candidates.
        "trace": trace,
        "strands": _stage_strands(json.dumps({"strands": strands})),
    }, separators=(",", ":")))


# The shortest gap between two frames of the busy sheet. A tile every 0.036s
# is ~28 a second — five times the 0.18s cadence this started at — which reads
# as the search flying through candidates rather than paging through them.
# The final frame of a group (completed == total) always passes.
FRAME_MIN_INTERVAL = 0.036
# Frames must never crowd out the search itself: a frame costs a deepcopy, a
# projection and a JSON dump, and on a slow machine 28 of those a second could
# eat the worker alive. Cap frame-building at this share of the worker's time;
# the gap between frames stretches beyond FRAME_MIN_INTERVAL when a frame
# turns out to cost more than duty x gap to build.
FRAME_MAX_DUTY = 0.2

# How often the gate reports the search's combo count through emitSearch. A
# report is a dozen bytes of JSON and no geometry, so it can afford to run on
# a farm whose FRAME_MIN_INTERVAL has priced every actual frame out.
SEARCH_PROGRESS_INTERVAL = 0.5


def _candidate_frame_emitter(base_strands, level, k, trace=None):
    last_sent = [0.0]
    min_gap = [FRAME_MIN_INTERVAL]
    last_count = [0.0]

    # Consulted by the engine BEFORE it builds a preview: a frame that would
    # be dropped must not cost a deepcopy of the working ring first. Passing
    # the gate claims the slot, so a caller that passes must then emit.
    def ready(completed, total):
        now = time.monotonic()
        # The numbers pass through even when the frame does not: they are the
        # only sign of life a long level search has.
        if total and now - last_count[0] >= SEARCH_PROGRESS_INTERVAL:
            last_count[0] = now
            emitSearch(json.dumps({
                "kind": "search", "level": level, "k": k,
                "combosDone": int(completed), "combos": int(total),
            }, separators=(",", ":")))
        if completed < total and now - last_sent[0] < min_gap[0]:
            return False
        last_sent[0] = now
        return True

    def relay(virtual_strands, back_map, meta):
        # A caller that consulted the gate says so; throttle the ones that
        # did not, or every chunk would land regardless of the interval.
        if not meta.get("gated") and not ready(
                int(meta.get("completed", 0)), int(meta.get("total", 0))):
            return

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
            trace,
        )

        # ready() stamped last_sent when the gate was passed — before the
        # engine's own deepcopy — so this measures the frame's whole cost.
        # Stretch the gap so frames stay under FRAME_MAX_DUTY of the worker's
        # time, and restart the idle clock now that the frame is out.
        done = time.monotonic()
        min_gap[0] = max(FRAME_MIN_INTERVAL, (done - last_sent[0]) / FRAME_MAX_DUTY)
        last_sent[0] = done

    relay.ready = ready
    return relay


def _register_level(level, k, checkpoint, result, search):
    """Record what browsing this level needs, and where the engine landed."""
    cands = result.get("candidates") or {"h": [], "v": []}
    h_cands, v_cands = cands.get("h") or [], cands.get("v") or []
    if k == 0:
        enumerated, reason = "none", "k=0 preserves the continuation"
    elif (result.get("search") or {}).get("horizontal", {}).get("placed"):
        # A placed level was never searched at all: it was welded at the
        # fixed ring's own arm ends and handed to a person to place.
        enumerated, reason = "none", ("built at the fixed ring's arm ends -- "
                                      "place this level by hand")
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
        # What the level actually adopted, straight off the alignment result.
        # The candidate lists are empty on a seeded or square-mirrored level --
        # it only ever saw the combo it was told to use -- so a reader asking
        # "what did this level do" cannot always be answered from them.
        "engine_ext": {"horizontal": list(engine_h), "vertical": list(engine_v)},
        "search": result.get("search") or {},
        "enumerated": enumerated, "reason": reason,
        "engine_pick_hv": (pick_h, pick_v),
        "engine_pick": 0, "index": 0,
        "truncated": len(h_cands) >= NX.BAND_CANDIDATE_CAP
                     or len(v_cands) >= NX.BAND_CANDIDATE_CAP,
        "found": [], "scan_cursor": 0,
    }


def l1_ring_from_json(text):
    """
    A judged L1 ring off the page, as JSON TEXT, or None for "search it".

    Text for the reason l1_from_json is text: a JS null set as a Pyodide global
    arrives as JsNull, and "" has no such ambiguity. The payload is
    {"strands": [...], "h_ext": [...], "v_ext": [...]} — the whole ring a
    judgement carries, plus the extensions it was fitted at, which become the
    row's ext since nothing here searches for them.
    """
    if not text:
        return None
    got = json.loads(text)
    strands = got.get("strands") if isinstance(got, dict) else None
    if (not isinstance(strands, list) or not strands
            or not all(isinstance(s, dict) and s.get("layer_name") for s in strands)):
        raise ValueError("level1_ring needs a strands list with layer names")
    return {"strands": strands,
            "h_ext": [float(v) for v in (got.get("h_ext") or [])],
            "v_ext": [float(v) for v in (got.get("v_ext") or [])]}


def _adopt_l1(built, ring):
    """
    The judged ring as this run's level 1, or None when it cannot be.

    The one guard that matters: the judged ring must be a ring for THIS level of
    THIS size — checked by comparing the non-mask layer names against the ones
    build_level_one just produced. Masks are left free, because a fitted ring
    may legitimately re-lay them. A mismatch is not an error, it is "this pick
    is not this level's ring", and the caller searches instead and says so.
    """
    names = lambda lst: {s["layer_name"] for s in lst
                         if s.get("type") != "MaskedStrand"}
    if names(built) != names(ring["strands"]):
        return None
    return [dict(s) for s in ring["strands"]]


def l1_from_json(text):
    """
    `[h_ext, v_ext]` off the page, as JSON TEXT, or None for "search it".

    A string on purpose, and this is the one interesting thing about it: a JS
    `null` handed to `runtime.globals.set` does NOT arrive as Python `None`. It
    arrives as `JsNull`, which is not None and has no `.to_py()` -- so
    `x.to_py() if x is not None else None` reads as obviously correct and
    crashes every single run with

        AttributeError: 'JsNull' object has no attribute 'to_py'

    which is how it reached a sweep. A string has no such ambiguity: "" is the
    absence, json.loads is the only conversion, and neither depends on how a
    given Pyodide maps the JS null.

    Shape is checked here rather than trusted, because a malformed pin would
    pin level 1 to nonsense: two bands of integers, or nothing at all.
    """
    if not text:
        return None
    pair = json.loads(text)
    if (not isinstance(pair, list) or len(pair) != 2
            or not all(isinstance(side, list) for side in pair)):
        raise ValueError(f"level1_pin must be [h_ext, v_ext], got {pair!r}")
    return [[int(value) for value in side] for side in pair]


def _l1_seed(given):
    """`[h_ext, v_ext]` as the engine wants it: a pair of integer tuples."""
    h, v = given
    return (tuple(int(value) for value in h), tuple(int(value) for value in v))


def _placed_result(h_pairs, v_pairs):
    """What _register_level and describe() need, for a level built PLACED.

    A placed level was welded at the fixed ring's own arm ends and never
    searched: extension 0 IS the fixed ring's arm end, and the level is
    handed to a person to place, not to the search. The zeros here are the
    truth of that -- the level's configuration is "exactly where the build
    left it" -- and the empty candidate lists make _register_level report it
    as unbrowsable, which it is.
    """
    def side(pairs):
        return {"success": True, "average_gap": 0,
                "pair_extensions": tuple(0.0 for _ in range(pairs))}
    return {"horizontal": side(h_pairs), "vertical": side(v_pairs),
            "search": {"horizontal": {"placed": True}, "vertical": {"placed": True}},
            "candidates": {"h": [], "v": []}}


def _adopted_result(h_ext, v_ext):
    """
    What _register_level and describe() need, for a level nothing searched.

    The extensions are the judgement's own, floats and all -- nothing here
    searched for them, so nothing rounds them. The gaps are 0 because they were
    not measured, which describe() prints as 0.00; the crossings ARE measured,
    by audit(), off the adopted strands themselves. Empty candidate lists make
    _register_level report the level as unbrowsable, which is true.
    """
    def side(ext):
        return {"success": True, "average_gap": 0, "pair_extensions": tuple(ext)}
    return {"horizontal": side(h_ext), "vertical": side(v_ext),
            "search": {"horizontal": {"judged": True}, "vertical": {"judged": True}},
            "candidates": {"h": [], "v": []}}


def _learned_reach(rows):
    """
    The longest arm any level so far actually used.

    The escalating search walks the extension ceiling up to 200 because "every
    ring past the first sits further out and needs longer arms" -- true of the
    ceiling it MIGHT need, and measurably not true of the one it uses. Measured
    on 3x1 ks=[-1,-1]: level 1 reaches 80, level 2's escalating search spends
    54s to land on (190, 190, 70), and the same level capped at 80 spends 4.9s
    to land on (50, 0, 0) with the same 10/12 crossings. The 120px of ceiling
    above what the previous level needed bought nothing but time and arm length.

    Zero means nothing was learned -- a k=0 level preserves the continuation and
    extends nothing -- and the caller leaves that level's search alone rather
    than capping it at a ceiling with no cells under it.
    """
    reach = max((value for row in rows for side in row["ext"] for value in side),
                default=0)
    # An adopted judged ring carries float extensions (62.55 was fitted by
    # hand); the search grid below is integer, so the ceiling rounds UP -- a
    # cap just short of the reach that produced the ring would be perverse.
    return int(reach) + (1 if reach != int(reach) else 0)


def _seed_of(row):
    """One level's extensions as the next level's search seed.

    Rounded, and that is the whole point: a seed is a GRID POINT the search is
    told to try first, and a fitted level's extensions are continuous -- 84.37
    is exactly the thing the grid steps over (docs/mxn-fit.md). Handed over raw
    they would name a cell the search cannot visit, which is not an error and
    not a seed either. Rounding keeps a fitted level's answer as the hint it
    was meant to be.
    """
    return (tuple(int(round(value)) for value in row["ext"][0]),
            tuple(int(round(value)) for value in row["ext"][1]))


def _grow_levels(strands, prev_v2r, first, ctx):
    """Build levels `first`…len(ks) onto `strands`, and register each one.

    Lifted out of generate unchanged so that fit_adopt can continue a run from
    a level a person fitted by hand. That sharing is the point: the levels above
    an adopted ring have to be built by the same search, on the same flags, with
    the same seeds as the run they belong to -- otherwise "I fixed L2 and kept
    going" quietly produces a stitch whose upper levels were searched under
    different rules from its lower ones.

    `ctx` is the run context generate leaves on the session. `rows` and `stages`
    are appended to in place, so the caller reads them back from ctx.
    """
    m, n, ks = ctx["m"], ctx["n"], ctx["ks"]
    hand, direction, search = ctx["hand"], ctx["direction"], ctx["search"]
    rows, stages, level1_for_k = ctx["rows"], ctx["stages"], ctx["level1_for_k"]
    # Placed mode: the ring below is FIXED -- somebody's hand or judgement --
    # and the levels growing on it must not touch it. Each level is welded at
    # the fixed ring's own arm ends (anchor="placed", zero retraction), and it
    # is NOT searched: extension 0 is the fixed ring's arm end, the level is
    # registered as unsearched, and placing it is the person's next move. The
    # searched default the ordinary mode produces is exactly what a reader in
    # this mode did not ask for.
    placed = bool(ctx.get("placed"))
    if placed:
        for level in range(first, len(ks) + 1):
            k_level = ks[level - 1]
            emitProgress(f"Building L{level} · k={k_level} at the fixed ring's arms…")
            with contextlib.redirect_stdout(io.StringIO()):
                strands, info = NX.add_continuation_level(
                    strands, m, n, k_level, direction, hand, level,
                    k_prev=ks[level - 2], prev_virtual_to_real=prev_v2r,
                    anchor="placed", verbose=False)
                prev_v2r = info["virtual_to_real"]
                checkpoint = copy.deepcopy((strands, info))
                _send_stage_frame(strands, level, k_level, "ring built")
                result = _placed_result(len(info["horizontal_order"]) // 2,
                                        len(info["vertical_order"]) // 2)
                snapshot = [dict(s) for s in strands]
                stages.append({"level": level, "k": k_level,
                               "label": f"twist {level}",
                               "strands": _stage_strands(NX._snapshot_json(strands))})
            rows.append(describe(result, snapshot, level, k_level,
                                 ctx["expected"], ctx["sizes"]))
            _register_level(level, k_level, checkpoint, result, search)
        return strands
    for level in range(first, len(ks) + 1):
        k_level = ks[level - 1]
        emitProgress(f"Calculating L{level} · k={k_level}…")
        with contextlib.redirect_stdout(io.StringIO()):
            if k_level not in level1_for_k:
                level1_for_k[k_level] = level1_extensions(
                    m, n, k_level, hand, direction, search)
            k_seed = level1_for_k[k_level]
            # Every level below this one, nearest first -- the same order
            # generate has always assembled, rebuilt from the rows rather than
            # carried alongside them so that a rebuilt tail cannot inherit a
            # seed from the levels it replaced.
            seeds = [_seed_of(row) for row in rows if row["level"] < level]
            level_seeds = ([k_seed] if k_seed else []) + list(reversed(seeds))
            strands, info = NX.add_continuation_level(
                strands, m, n, k_level, direction, hand, level,
                k_prev=ks[level - 2], prev_virtual_to_real=prev_v2r,
                verbose=False)
            prev_v2r = info["virtual_to_real"]
            # What the levels below reached, when this run is asked to learn
            # from them rather than escalate. Off by default: it changes which
            # ring the level settles on, so it is part of the cache key and a
            # run stored under it is never confused with the ordinary search.
            level_search = dict(search)
            learned = _learned_reach(rows) if ctx["reach_from_previous"] else 0
            if learned:
                level_search["max_pair_extension"] = learned
                level_search["escalate_extension"] = False
            checkpoint = copy.deepcopy((strands, info))
            _send_stage_frame(strands, level, k_level, "ring built")
            NX._progress_frame_callback = _candidate_frame_emitter(
                strands, level, k_level)
            try:
                result = NX.align_continuation_level(
                    strands, m, n, k_level, direction, hand, level, info,
                    seed_extensions=level_seeds, verbose=False, **level_search)
            finally:
                NX._progress_frame_callback = None
            _send_stage_frame(
                strands, level, k_level, "candidate accepted", 1, 1)
            snapshot = [dict(s) for s in strands]
            stages.append({"level": level, "k": k_level,
                           "label": f"twist {level}",
                           "strands": _stage_strands(NX._snapshot_json(strands))})
        rows.append(describe(result, snapshot, level, k_level,
                             ctx["expected"], ctx["sizes"]))
        _register_level(level, k_level, checkpoint, result, search)
    return strands


def generate(m, n, ks, hand="lh", direction="cw",
             prefer_short_arms=True, ext_step=None, combo_budget=None,
             reach_from_previous=False, level1_pin=None,
             hand_step=0, hand_ceiling=0, level1_ring=None,
             preserve_arms=False):
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
    reach_from_previous = bool(reach_from_previous)
    # The grid a judged best implies. Two plain numbers rather than a structure,
    # and 0 for absent rather than None: a scalar crosses from JS as a scalar,
    # and the one thing this boundary has already got wrong is a null that
    # arrived as JsNull (see l1_from_json). There is nothing to be wrong about
    # here -- 0 is falsy in both languages.
    hand_step, hand_ceiling = int(hand_step or 0), int(hand_ceiling or 0)
    if hand_ceiling:
        # Every level, level 1 included. The pick's reach is a statement about
        # where the answer lives for this m, n and k, and level 1 is the level
        # it was judged on -- capping only the deeper ones would search widest
        # exactly where the evidence is strongest.
        search["max_pair_extension"] = hand_ceiling
        search["escalate_extension"] = False
        if hand_step:
            search["pair_extension_step"] = hand_step
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
        # Level 1 ADOPTED rather than searched, when the caller has the ring.
        #
        # The L1 of [k, ...] is the L1 of [k] -- the same identity the replay
        # below and level1_for_k both stand on -- so a judged ring for [k] IS
        # this run's level 1, and searching for it would at best approximate
        # it: a hand-fitted ring sits off every grid, in angle as well as
        # extension. The strands go in whole; audit() measures crossings off
        # the geometry itself, so the row is measured rather than trusted.
        adopted = _adopt_l1(strands, level1_ring) if level1_ring else None
        if adopted is not None:
            strands = adopted
            checkpoint1 = copy.deepcopy((strands, level1_info))
            _send_stage_frame(strands, 1, ks[0], "judged ring adopted")
            ext_pair = (tuple(level1_ring["h_ext"]), tuple(level1_ring["v_ext"]))
            result = _adopted_result(*ext_pair)
            _SESSION["level1_adopted"] = True
        elif level1_ring:
            # The pick was not this level's ring (wrong names, wrong size, an
            # old placeholder). Said in the output rather than swallowed: a
            # caller that sent a ring deserves to know it searched instead.
            _SESSION["level1_adopt_failed"] = True
        if adopted is None:
            NX._progress_frame_callback = _candidate_frame_emitter(
                strands, 1, ks[0])
        # Level 1 replayed rather than searched, when the caller has the combo.
        #
        # L1 depends on nothing but (m, n, ks[0], hand, direction) and the
        # search flags -- the same fact `level1_for_k` below relies on within a
        # single run -- so the L1 of `[-1, -1, -1]` IS the L1 of the stored
        # `[-1]` run. Searching for it again is the largest single waste in a
        # deep sequence: measured on 3x1 k=-1, 52 of the run's seconds.
        #
        # What it costs is this level's candidate lists, and so its solution
        # browser and its exact count: a pinned attempt only ever evaluates the
        # one combo it was told to use. That enumeration is not lost from the
        # shelf, only from this artifact -- the single-k run it was replayed
        # from has it in full -- and _register_level says which it is.
        if adopted is None:
            try:
                result = NX.align_continuation_level(
                    strands, m, n, ks[0], direction, hand, 1,
                    level1_info, mirror_sides=m == n, verbose=False,
                    seed_extensions=[_l1_seed(level1_pin)] if level1_pin else None,
                    pin_seed=bool(level1_pin),
                    **search)
            finally:
                NX._progress_frame_callback = None
            if level1_pin and not (result.get("candidates") or {}).get("h"):
                _SESSION["level1_replayed"] = True
        _send_stage_frame(strands, 1, ks[0], "candidate accepted", 1, 1)
        snapshot = [dict(s) for s in strands]
        stages.append({"level": 1, "k": ks[0], "label": "1st twist",
                       "strands": _stage_strands(NX._snapshot_json(strands))})
    rows.append(describe(result, snapshot, 1, ks[0], expected, sizes))
    _register_level(1, ks[0], checkpoint1, result, search)

    # Everything another level would need, kept on the session rather than in
    # this frame: fit_adopt builds levels with the SAME code after a fitted ring
    # replaces one, and a rebuild that searched on different flags from the run
    # it is continuing would be a different stitch wearing the run's name.
    context = {"m": m, "n": n, "ks": ks, "hand": hand, "direction": direction,
               "search": search, "reach_from_previous": reach_from_previous,
               "expected": expected, "sizes": sizes,
               "rows": rows, "stages": stages,
               # Placed mode is asked for AND earned: the caller wants the
               # adopted ring preserved, and a ring was actually adopted. A
               # searched L1 has no placed arms to preserve, so the flag on
               # its own changes nothing.
               "placed": bool(preserve_arms) and bool(_SESSION.get("level1_adopted")),
               "level1_for_k": {ks[0]: (tuple(rows[0]["ext"][0]),
                                        tuple(rows[0]["ext"][1]))}}
    _SESSION["run"] = context
    _grow_levels(strands, virtual_to_real, 2, context)

    return json.dumps({
        "m": m, "n": n, "ks": ks, "hand": hand, "direction": direction,
        "expected": expected, "seconds": round(time.time() - started, 1),
        "rows": rows, "stages": stages,
        "reachFromPrevious": reach_from_previous,
        "handCeiling": hand_ceiling,
        "handStep": hand_step,
        # Whether L1 was replayed off a stored run rather than searched, so a
        # reader is told why that level has no solution browser.
        "level1Replayed": bool(_SESSION.get("level1_replayed")),
        "level1Adopted": bool(_SESSION.get("level1_adopted")),
        "level1AdoptFailed": bool(_SESSION.get("level1_adopt_failed")),
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


def _clone_checkpoint(entry):
    """A fresh (strands, info) from the level's checkpoint.

    pickle round-trips the same structure about twice as fast as deepcopy, and
    the walk pays one clone per cell of the product, so this is most of what
    counting costs. The blob is cached on the entry; the checkpoint never
    changes after the level is built.
    """
    blob = entry.get("checkpoint_blob")
    if blob is None:
        blob = pickle.dumps(entry["checkpoint"], pickle.HIGHEST_PROTOCOL)
        entry["checkpoint_blob"] = blob
    return pickle.loads(blob)


def _walk(entry, want_index, healthy_only, cursor, budget=None):
    """Walk the product in search order and land on the want_index-th ring.

    Order is lexicographic with H outer and V inner -- the same shape attempt()
    itself uses -- and nothing is re-ranked.

    Every closed ring is cached LIGHT -- candidate indexes and the audit row,
    never strands. Strands per ring read as harmless and are half a gigabyte
    for a 2x2 counted to the end; select_solution re-materialises the one ring
    it returns instead, at the price of the single replay a cache miss always
    cost. The cache holds every closed ring whatever the filter, and the filter
    is applied when picking, so browsing healthy-only cannot poison the list
    an unfiltered browse then indexes into.
    """
    h_cands, v_cands = entry["h_cands"], entry["v_cands"]
    level, m, n = entry["level"], _SESSION["m"], _SESSION["n"]
    expected = 4 * m * n
    found = entry["found"]

    def matches(ring):
        return not healthy_only or ring["row"]["healthy"]

    hits = sum(1 for ring in found if matches(ring))
    scanned = 0
    start = cursor or entry.get("scan_cursor") or 0
    total_cells = len(h_cands) * len(v_cands)
    budget = budget or RING_SCAN_BUDGET

    while hits <= want_index and start < total_cells:
        if scanned >= budget:
            entry["scan_cursor"] = start
            return None, True, start
        i, j = divmod(start, len(v_cands))
        start += 1
        scanned += 1
        strands, info = _clone_checkpoint(entry)
        crossings = NX.apply_solution(strands, info, level, m, n,
                                      _SESSION["hand"], h_cands[i], v_cands[j])
        if crossings != expected:
            continue
        row = describe(_synth_result(entry, h_cands[i], v_cands[j]),
                       [dict(s) for s in strands], level,
                       entry["k"], expected, (2 * m, 2 * n))
        ring = {"h": i, "v": j, "row": row}
        found.append(ring)
        if matches(ring):
            hits += 1
    entry["scan_cursor"] = start
    seen = -1
    for ring in found:
        if not matches(ring):
            continue
        seen += 1
        if seen == want_index:
            return ring, False, start
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


def _band_name(band):
    return "vertical" if str(band).lower().startswith("v") else "horizontal"


def _trace_band_inputs(entry, want):
    """The band search's own arguments, grabbed by replaying the level.

    Replays the level from its checkpoint the way enumerate_level does, but with
    the band search hooked so its inputs can be handed to mxn_trace. The replay
    is a full search, so the vectorised angle scan is forced on for the duration
    whatever the page is running -- without it a 3x3 trace is tens of seconds.

    Cached on the session entry: the plan, the census and every weave preview
    read the same inputs, and re-grabbing them would cost another full replay.
    Returns None when this level solved the band without a search at all.

    Nothing about the replay is silent. Its own search relays candidates as it
    finds them, tagged with the band being traced, and the plan is emitted from
    inside the hook -- which fires BEFORE the band's search runs, not after the
    replay finishes -- so the page has the real grid to draw at the earliest
    moment it exists rather than at the end of the wait.
    """
    import mxn_lh_continuation as LH
    import mxn_trace

    held = (entry.get("trace_bands") or {}).get(want)
    if held is not None:
        return held

    m, n = _SESSION["m"], _SESSION["n"]
    grabbed = []
    real_search = LH._search_combo_space_cpu
    was_fast = LH.FAST_ANGLE_SCAN

    def announce(band):
        """Hand the page the plan for a band the moment its inputs exist."""
        try:
            ahead = mxn_trace.plan(band)
        except Exception:
            return
        ahead.update({
            "kind": "plan", "level": entry["level"], "band": want,
            "unavailable": False, "k": entry["k"],
            "applied": _applied_ext(entry, want),
        })
        emitTrace(json.dumps(ahead, separators=(",", ":")))

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
            announce(grabbed[0])
        return real_search(strands_list, pairs, pair_directions, pair_originals,
                           ext_range_values, angle_step_degrees, max_extension,
                           strand_width, custom_angle_min, custom_angle_max,
                           angle_mode, on_config_callback, direction_type,
                           num_opposite_pairs)

    strands, info = copy.deepcopy(entry["checkpoint"])
    LH._search_combo_space_cpu = hook
    LH.FAST_ANGLE_SCAN = True
    # The same relay a run installs, so the replay draws rings while it works.
    # Throttled by the same gate (FRAME_MIN_INTERVAL, FRAME_MAX_DUTY), so the
    # frames cost the replay a bounded share of its time.
    NX._progress_frame_callback = _candidate_frame_emitter(
        strands, entry["level"], entry["k"], trace=want)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            NX.align_continuation_level(
                strands, m, n, entry["k"], _SESSION["direction"], _SESSION["hand"],
                entry["level"], info, mirror_sides=False, seed_extensions=[],
                collect_candidates=False, verbose=False)
    finally:
        LH._search_combo_space_cpu = real_search
        LH.FAST_ANGLE_SCAN = was_fast
        NX._progress_frame_callback = None

    if not grabbed:
        return None

    entry.setdefault("trace_bands", {})[want] = grabbed[0]
    return grabbed[0]


def _no_search(entry, want):
    return {
        "level": entry["level"], "band": want, "unavailable": True,
        "reason": "this level solved its %s band without a search" % want,
    }


def _over_ceiling(entry, want, combos, angles, budget):
    return {
        "level": entry["level"], "band": want, "unavailable": True,
        "reason": "%d combos x %d angles is over the %d trace ceiling"
                  % (combos, angles, budget),
        "combos": combos, "angles": angles,
    }


def _applied_ext(entry, want):
    """The extensions this level adopted for one band.

    From the candidate list where there is one, and from the alignment result
    where there is not: a seeded or square-mirrored level has no list to index
    into, and used to answer this question with an empty list even though the
    combo it adopted was never in doubt.
    """
    picked = entry["engine_pick_hv"][0 if want == "horizontal" else 1]
    cands = entry["h_cands"] if want == "horizontal" else entry["v_cands"]
    if picked < len(cands):
        return list(cands[picked]["ext"])
    return list((entry.get("engine_ext") or {}).get(want) or ())


def trace_plan(level, band="v"):
    """What tracing this band is about to sweep, before it sweeps it.

    Costs the level replay and one probe placement -- the census that follows is
    the expensive half -- so the page can be told the size of the job and handed
    the band's own geometry while the sweep is still running. Sent first, then
    trace_census sends the census itself.
    """
    import mxn_trace

    entry = _level_session(int(level))
    want = _band_name(band)
    data = _trace_band_inputs(entry, want)
    if data is None:
        return json.dumps(_no_search(entry, want), separators=(",", ":"))

    ahead = mxn_trace.plan(data)
    if ahead["overBudget"]:
        return json.dumps(
            _over_ceiling(entry, want, ahead["combos"], ahead["nAngles"],
                          ahead["budget"]), separators=(",", ":"))
    ahead.update({
        "level": entry["level"], "band": want, "unavailable": False,
        "k": entry["k"], "applied": _applied_ext(entry, want),
    })
    return json.dumps(ahead, separators=(",", ":"))


def _trace_reporter(level, want, total_angles):
    """Where the sweep has got to, on its way to the page.

    A census is one long synchronous call, so without this the page can only
    say that a trace started. emitTrace is a no-op outside the worker, which is
    what the offline callers want.
    """
    def report(done, total):
        emitTrace(json.dumps({
            "kind": "progress",
            "level": level, "band": want, "combosDone": int(done),
            "combos": int(total), "nAngles": int(total_angles),
        }, separators=(",", ":")))
    return report


def trace_census(level, band="v", on_progress=None):
    """Census every (combo, angle) one band of `level` could be asked about.

    Runs the same tests the shipped search runs, in the same order, over a wider
    sweep, and records a verdict for every pair instead of stopping at the first
    failure. Reads the band inputs trace_plan left in the session, and replays
    the level itself when called without one.

    Only the verdict census crosses the worker boundary; the page recomputes the
    geometry for whichever cell is being looked at.
    """
    import mxn_trace

    entry = _level_session(int(level))
    want = _band_name(band)
    data = _trace_band_inputs(entry, want)
    if data is None:
        return json.dumps(_no_search(entry, want), separators=(",", ":"))

    ahead = mxn_trace.plan(data)
    counted = mxn_trace.census(
        data, ahead=ahead,
        on_progress=on_progress or _trace_reporter(
            entry["level"], want, ahead["nAngles"]))
    payload = mxn_trace.pack(counted)
    if payload.get("over_budget"):
        return json.dumps(
            _over_ceiling(entry, want, payload["combos"], payload["angles"],
                          payload["budget"]), separators=(",", ":"))

    payload.update({
        "level": entry["level"], "band": want, "unavailable": False,
        "k": entry["k"],
        "applied": _applied_ext(entry, want),
        # What the plan already told the page, echoed so a census that arrives
        # without one (an offline caller, or a page that missed the plan) still
        # carries the size of the job it just did.
        "combos": ahead["combos"], "evaluations": ahead["evaluations"],
    })

    # The engine's own pick, woven up front. The panel lands on this cell at
    # the angle its ranking selects, so its preview must not cost a worker
    # round trip -- by the time the census is on screen the weave is too.
    # Best-effort: a pick the census grid cannot place just falls back to the
    # panel's ordinary request path.
    try:
        applied = payload["applied"]
        if applied:
            vals = counted["vals"]
            idx = 0
            for e in applied:
                idx = idx * len(vals) + vals.index(float(e))
            best_i = int(counted["best"][idx])
            angle = (float(counted["angle0"][idx])
                     + max(best_i, 0) * float(counted["step"]))
            payload["weave"] = _weave_cell(entry, want, applied, angle)
    except Exception:
        pass

    return json.dumps(payload, separators=(",", ":"))


def trace_level(level, band="v"):
    """Plan and census in one call, for callers with nothing to report to.

    The page splits these so it can draw the band while the sweep runs; the
    offline scripts want the finished census and nothing else. The plan is not
    wasted work either way -- the census reads the same cached band inputs.
    """
    return trace_census(level, band)


def _band_moves(data, ext, angle_deg):
    """Where one band's arms land, as the moves NX._apply_candidate consumes.

    The same geometry sweep_combo vectorises, at one angle: each arm starts from
    its displaced original_start and runs its projection along the shared
    heading, flipped for the arms that head the other way.

    Pure geometry over a band's own inputs, so both the trace preview (one band
    swept, the other held at the engine's pick) and the fitter (both bands
    placed by the caller) run the same arithmetic rather than two copies of it.
    Extensions are floats throughout: the search walks a 10px grid, but nothing
    downstream of the placement cares, and the fit lands between its points.
    """
    import math

    import mxn_trace

    placed = mxn_trace.place(data, [float(e) for e in ext])
    starts = [(s["original_start"]["x"], s["original_start"]["y"]) for s in placed]
    deltas = [(s["target_position"]["x"] - sx, s["target_position"]["y"] - sy)
              for s, (sx, sy) in zip(placed, starts)]
    ref = math.atan2(deltas[0][1], deltas[0][0])
    a = math.radians(float(angle_deg))
    moves, lengths = [], []
    for s, (sx, sy), (dx, dy) in zip(placed, starts, deltas):
        sa = a if dx * math.cos(ref) + dy * math.sin(ref) >= 0 else a + math.pi
        proj = dx * math.cos(sa) + dy * math.sin(sa)
        lengths.append(proj)
        moves.append((s["strand_4_5"]["layer_name"],
                      (s.get("strand_2_3") or {}).get("layer_name"),
                      sx, sy,
                      sx + proj * math.cos(sa), sy + proj * math.sin(sa)))
    return moves, lengths


def _weave_cell(entry, want, ext, angle_deg):
    """Materialise the ring one traced (combo, angle) cell would produce.

    The traced band's arms take the given extensions at the given heading --
    the same affine placement mxn_trace sweeps -- and the other band is held at
    the engine's own pick, the partner the trace's ring marker already refers
    to. The ring is applied whether or not the cell passed its tests: what a
    failing combo looks like woven is exactly what the preview is for.

    Reads the band inputs trace_level left in the session, so it costs one
    checkpoint replay per call rather than a fresh search. Returns a dict:
    trace_weave sends it alone, trace_level embeds one for the engine's pick.
    """
    ext = [float(e) for e in ext]
    angle_deg = float(angle_deg)
    data = (entry.get("trace_bands") or {}).get(want)
    if data is None:
        return {
            "level": entry["level"], "band": want, "unavailable": True,
            "ext": [int(e) for e in ext], "angle": angle_deg,
            "reason": "trace this band first; the weave preview reads its inputs",
        }

    moves, _lengths = _band_moves(data, ext, angle_deg)

    swept = {"ext": tuple(int(e) for e in ext), "angle": angle_deg,
             "gap": None, "moves": moves}
    pick_h, pick_v = entry["engine_pick_hv"]
    h_cands, v_cands = entry["h_cands"], entry["v_cands"]
    if want == "horizontal":
        h_cand = swept
        v_cand = v_cands[pick_v] if pick_v < len(v_cands) else None
    else:
        v_cand = swept
        h_cand = h_cands[pick_h] if pick_h < len(h_cands) else None

    m, n = _SESSION["m"], _SESSION["n"]
    expected = 4 * m * n
    strands, info = copy.deepcopy(entry["checkpoint"])
    crossings = NX.apply_solution(strands, info, entry["level"], m, n,
                                  _SESSION["hand"], h_cand, v_cand)
    row = describe(_synth_result(entry, h_cand or {}, v_cand or {}),
                   [dict(s) for s in strands], entry["level"], entry["k"],
                   expected, (2 * m, 2 * n))
    return {
        "level": entry["level"], "band": want, "unavailable": False,
        "ext": [int(e) for e in ext], "angle": angle_deg,
        "crossings": crossings, "row": row,
        "strands": _stage_strands(NX._snapshot_json(strands)),
    }


def trace_weave(level, band, ext, angle_deg):
    """One traced cell, woven -- _weave_cell as the worker message."""
    entry = _level_session(int(level))
    want = "vertical" if str(band).lower().startswith("v") else "horizontal"
    return json.dumps(_weave_cell(entry, want, ext, angle_deg),
                      separators=(",", ":"))


# ---------------------------------------------------------------------------
# The fitter, /mxn/fit/.
#
# The page solves for itself: arm length is affine in the pair's own extension,
# so the extensions that make a band flush at a given angle are a division per
# pair, and mxn_trace.plan already carries everything that division needs. What
# the page cannot do without the engine is WEAVE a ring and audit it, which is
# the whole of what these two add (see docs/mxn-fit.md).
# ---------------------------------------------------------------------------

def fit_plan(level):
    """Both bands of a level, as inputs the page can solve against.

    mxn_trace.plan for each band -- the extension grid, the angle window, the
    gap bounds, and the origins/directions/targets every configuration is
    affine in -- plus the engine's own pick, so the fit has something to be
    measured against. Costs one checkpoint replay per band and NO census: the
    fitter walks a curve, not a grid, and never needs the verdict raster the
    trace panel draws.
    """
    import mxn_trace

    entry = _level_session(int(level))
    out = {"level": entry["level"], "k": entry["k"],
           "m": _SESSION["m"], "n": _SESSION["n"],
           "hand": _SESSION["hand"], "direction": _SESSION["direction"]}
    for want, key in (("horizontal", "h"), ("vertical", "v")):
        data = _trace_band_inputs(entry, want)
        if data is None:
            out[key] = _no_search(entry, want)
            continue
        band = mxn_trace.plan(data)
        picked = entry["engine_pick_hv"][0 if want == "horizontal" else 1]
        cands = entry["h_cands"] if want == "horizontal" else entry["v_cands"]
        band.update({
            "band": want, "unavailable": False,
            "applied": _applied_ext(entry, want),
            # The angle the engine settled on. Best-effort: a seeded level has
            # no candidate to read it off. The page does not depend on it --
            # it measures the arms it is drawing rather than recomputing them
            # from an extension and a heading (docs/mxn-fit.md).
            "appliedAngle": (float(cands[picked]["angle"])
                             if picked < len(cands) else None),
            # The band's arms, in the band's own order. What makes it possible
            # to measure a length off a drawn ring rather than off a model of
            # one: these are the layer names to look for in a stage's strands.
            "names": [s["strand_4_5"]["layer_name"] for s in data["strands_list"]],
        })
        out[key] = band
    return json.dumps(out, separators=(",", ":"))


def fit_plan_now(m, n, ks, hand="lh", direction="cw"):
    """L1's two bands, as inputs the page can solve against — WITHOUT searching.

    The band plan is the geometry every configuration is affine in: the pair
    origins and directions, the arms' targets, the extension grid, the angle
    window, the gap bounds. None of it is a RESULT of the search. It is the
    space the search walks, and it is complete the moment the search is handed
    its arguments -- which is why _trace_band_inputs already announces it from
    inside the hook rather than after the replay returns.

    fit_plan waits for the whole thing anyway, because it also wants the
    engine's own pick to measure against. That pick costs 194,481 combinations
    on a 4x1 and about five minutes of CPU, and a reader who only wants to move
    the arms by hand is paying all of it for something they are about to
    replace. So this grabs the inputs at the hook and stops the level there.

    Measured on this repo's engine: 0.13 s for a 4x1, against 280 s for the
    full generate. Same plan, to the byte.

    L1 only, and it says so rather than pretending. Level N's inputs hang off
    level N-1's SOLVED ring, so anything above the first genuinely does need
    the levels below it searched -- which is generate, and is what Run is for.
    """
    import mxn_lh_continuation as LH
    import mxn_trace

    m, n = int(m), int(n)
    ks = [int(k) for k in ks]
    if not ks:
        raise ValueError("ks must contain at least one value")
    random.seed(0)

    class _Enough(Exception):
        """Both bands' inputs are in hand; the walk is no longer wanted."""

    grabbed = {}
    real_search = LH._search_combo_space_cpu
    was_fast = LH.FAST_ANGLE_SCAN

    def hook(strands_list, pairs, pair_directions, pair_originals,
             ext_range_values, angle_step_degrees, max_extension, strand_width,
             custom_angle_min, custom_angle_max, angle_mode,
             on_config_callback=None, direction_type="horizontal",
             num_opposite_pairs=1):
        if direction_type not in grabbed:
            grabbed[direction_type] = {
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
            }
        # The band with more pairs is the expensive one and it is searched
        # second, so stopping the moment BOTH are in hand costs only the cheap
        # band's walk -- 21 combos on a 4x1, against the 194,481 skipped.
        if len(grabbed) >= 2:
            raise _Enough()
        return real_search(strands_list, pairs, pair_directions, pair_originals,
                           ext_range_values, angle_step_degrees, max_extension,
                           strand_width, custom_angle_min, custom_angle_max,
                           angle_mode, on_config_callback, direction_type,
                           num_opposite_pairs)

    emitProgress("Reading L₁'s two bands — no search…")
    LH._search_combo_space_cpu = hook
    LH.FAST_ANGLE_SCAN = True
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            starting_json, strands, info = NX.build_level_one(
                m, n, ks[0], hand, direction, verbose=False)
            try:
                NX.align_continuation_level(
                    strands, m, n, ks[0], direction, hand, 1, info,
                    mirror_sides=m == n, verbose=False,
                    prefer_short_arms=True, collect_candidates=False)
            except _Enough:
                pass
            ring = _stage_strands(NX._snapshot_json(strands))
    finally:
        LH._search_combo_space_cpu = real_search
        LH.FAST_ANGLE_SCAN = was_fast

    out = {"level": 1, "k": ks[0], "m": m, "n": n, "hand": hand,
           "direction": direction, "fast": True, "strands": ring}
    for want, key in (("horizontal", "h"), ("vertical", "v")):
        band = grabbed.get(want)
        if band is None:
            out[key] = {"band": want, "unavailable": True,
                        "reason": f"L1 solved its {want} band without a search"}
            continue
        ahead = mxn_trace.plan(band)
        ahead.update({
            "band": want, "unavailable": False,
            # No search ran, so there IS no engine pick to quote. The arms are
            # where build_level_one left them, and the page recovers the
            # heading off the ring it is drawing -- which is what it prefers
            # anyway (docs/mxn-fit.md: every number measured off the ring).
            "applied": [0.0] * band["pairs_n"],
            "appliedAngle": None,
            "names": [s["strand_4_5"]["layer_name"] for s in band["strands_list"]],
        })
        out[key] = ahead
    return json.dumps(out, separators=(",", ":"))


def fit_bands_from_json(text):
    """`{"hExt":…,"hAngle":…,"vExt":…,"vAngle":…}` as the four values a fit takes.

    JSON text for exactly the reason l1_from_json is text, and this one had
    already gone wrong: a JS `null` handed to `globals.set` arrives as `JsNull`,
    which is not `None` and has no `.to_py()`. The worker's guard read

        None if mxn_h_ext is None else mxn_h_ext.to_py()

    which is obviously correct and never true, so the else branch ran and raised
    `AttributeError: 'JsNull' object has no attribute 'to_py'` -- on precisely
    the band that asked to be LEFT ALONE, which is the one a fit sends null for
    whenever a band needs no fitting or was never searched.

    A null band comes back as None here, and None is what fit_weave means by
    "hold it where the engine left it".
    """
    if not text:
        return (None, None, None, None)
    got = json.loads(text)
    if not isinstance(got, dict):
        raise ValueError("fit bands must be an object, got %r" % (got,))

    def ext(key):
        value = got.get(key)
        return None if value is None else [float(v) for v in value]

    def angle(key):
        value = got.get(key)
        return None if value is None else float(value)

    return (ext("hExt"), angle("hAngle"), ext("vExt"), angle("vAngle"))


def _fit_bands(entry, h_ext, h_angle, v_ext, v_angle):
    """The two band candidates a fit names, or None when no plan was read.

    `(h_cand, v_cand, lengths)`. A band whose extensions are None is held at the
    engine's own pick, which is what a band that needs no fitting asks for --
    two arms are a mirror pair, so they are always the same length.

    Shared by fit_weave and fit_adopt so that the ring a person LOOKS at and the
    ring the levels above are then built on are placed by one piece of code. Two
    transcriptions of "put the bands here" is exactly the kind of drift that
    ends with a stack whose upper levels stand on a ring nobody saw.
    """
    pick_h, pick_v = entry["engine_pick_hv"]
    h_cands, v_cands = entry["h_cands"], entry["v_cands"]
    cands = []
    lengths = {}
    for want, ext, angle, picked, pool in (
            ("horizontal", h_ext, h_angle, pick_h, h_cands),
            ("vertical", v_ext, v_angle, pick_v, v_cands)):
        if ext is None:
            cands.append(pool[picked] if picked < len(pool) else None)
            continue
        data = (entry.get("trace_bands") or {}).get(want)
        if data is None:
            return None
        ext = [float(e) for e in ext]
        moves, arms = _band_moves(data, ext, angle)
        lengths["h" if want == "horizontal" else "v"] = [float(x) for x in arms]
        cands.append({"ext": tuple(ext), "angle": float(angle),
                      "gap": None, "moves": moves})
    return cands[0], cands[1], lengths


def _fit_apply(entry, h_cand, v_cand):
    """That candidate pair, applied to a fresh clone of the level's checkpoint.

    Returns the live `(strands, info, crossings, row)` -- live because fit_adopt
    grows the next level onto these very strands, and a JSON snapshot cannot be
    grown onto.
    """
    m, n = _SESSION["m"], _SESSION["n"]
    strands, info = copy.deepcopy(entry["checkpoint"])
    crossings = NX.apply_solution(strands, info, entry["level"], m, n,
                                  _SESSION["hand"], h_cand, v_cand)
    row = describe(_synth_result(entry, h_cand or {}, v_cand or {}),
                   [dict(s) for s in strands], entry["level"], entry["k"],
                   4 * m * n, (2 * m, 2 * n))
    return strands, info, crossings, row


def fit_weave(level, h_ext, h_angle, v_ext, v_angle):
    """Weave a ring with BOTH bands placed by the caller, and audit it.

    _weave_cell holds one band at the engine's pick because a trace is about one
    band at a time. A fit is not: it moves both, and the ring has to be measured
    as the pair it will be exported as. Pass None for a band's extensions to
    hold that one at the engine's own answer -- which is what a band that needs
    no fitting (two arms are a mirror pair, so they are always the same length)
    asks for.

    The arms' lengths come back with it. They are the thing being fitted, and
    measuring them here rather than in the page means the number quoted in an
    export is the number the applied geometry actually has.
    """
    entry = _level_session(int(level))
    placed = _fit_bands(entry, h_ext, h_angle, v_ext, v_angle)
    if placed is None:
        return json.dumps({
            "level": entry["level"], "unavailable": True,
            "reason": "call fit_plan first; the weave reads its band inputs",
        }, separators=(",", ":"))
    h_cand, v_cand, lengths = placed
    strands, info, crossings, row = _fit_apply(entry, h_cand, v_cand)
    return json.dumps({
        "level": entry["level"], "unavailable": False,
        "h": {"ext": list(h_cand["ext"]) if h_cand else [],
              "angle": h_cand["angle"] if h_cand else None},
        "v": {"ext": list(v_cand["ext"]) if v_cand else [],
              "angle": v_cand["angle"] if v_cand else None},
        "lengths": lengths, "crossings": crossings, "row": row,
        "strands": _stage_strands(NX._snapshot_json(strands)),
    }, separators=(",", ":"))


def fit_adopt(level, h_ext, h_angle, v_ext, v_angle, rebuild=True,
              preserve_arms=False):
    """Make a fitted ring THIS level's ring, and rebuild every level above it.

    This is what lets a stitch be fixed one level at a time. `fit_weave` weaves
    a fit and audits it, but it always starts from the level's own checkpoint --
    the ring the RUN built underneath -- so a fit is a proposal about one level
    and nothing above it ever hears about it. Fit L1, move to L2, and L2 is
    still sitting on the engine's L1: the two fits never coexisted in a ring,
    and a judgement saved over both would be describing a stitch that was never
    woven.

    So the fitted ring is adopted: it replaces this level's row and diagram, and
    every level above it is built again from it, by `_grow_levels` -- the same
    search, the same flags and the same seeds the run itself used. What comes
    back IS the stitch as it now stands, from `level` up.

    The cost is honest and large: rebuilding is a real search per level, the
    same work `generate` did for those levels. `rebuild=False` adopts the ring
    and leaves the levels above alone, for the caller that wants the record
    without the wait -- and it is then the caller's job to say that the levels
    above stand on a ring that has moved.
    """
    level = int(level)
    entry = _level_session(level)
    context = _SESSION.get("run")
    if context is None:
        raise ValueError("level %s has no run to rebuild; run generate first"
                         % level)
    placed = _fit_bands(entry, h_ext, h_angle, v_ext, v_angle)
    if placed is None:
        return json.dumps({
            "level": level, "unavailable": True,
            "reason": "call fit_plan first; adopting reads its band inputs",
        }, separators=(",", ":"))
    h_cand, v_cand, lengths = placed
    started = time.time()
    strands, info, crossings, row = _fit_apply(entry, h_cand, v_cand)

    # The run's own record, with this level's row and diagram replaced by the
    # ring a person chose. When the levels above are being rebuilt they are
    # dropped first, so a stale row cannot survive as a seed or as a diagram;
    # when they are not, they are left exactly as they were and reported as
    # standing on a ring that has moved.
    stage = {"level": level, "k": entry["k"], "label": "fitted by hand",
             "strands": _stage_strands(NX._snapshot_json(strands))}
    keep = (lambda item: item["level"] < level) if rebuild \
        else (lambda item: item["level"] != level)
    rows = [r for r in context["rows"] if keep(r)]
    stages = [s for s in context["stages"] if keep(s)]
    rows.append(row)
    stages.append(stage)
    rows.sort(key=lambda r: r["level"])
    stages.sort(key=lambda s: s["level"])
    context["rows"], context["stages"] = rows, stages
    # What was adopted, so the level can say where its ring came from after the
    # page that adopted it has been reloaded.
    entry["adopted"] = {
        "h": {"ext": list(h_cand["ext"]) if h_cand else [],
              "angle": h_cand["angle"] if h_cand else None},
        "v": {"ext": list(v_cand["ext"]) if v_cand else [],
              "angle": v_cand["angle"] if v_cand else None},
    }
    _SESSION["adopted"] = sorted(
        {lv for lv, e in _SESSION["levels"].items() if e.get("adopted")})

    if rebuild:
        # Levels above are being rebuilt, so whatever they had adopted was
        # adopted onto a ring that no longer exists.
        for above in list(_SESSION["levels"]):
            if above > level:
                _SESSION["levels"][above].pop("adopted", None)
        # preserve_arms: the ring being fixed is a person's -- weld the levels
        # above at ITS arm ends and hand them over unsearched, instead of
        # re-laying its arms and searching a default over it. Set (not merely
        # defaulted) each time, so one preserving fix cannot leak the mode
        # into a later ordinary rebuild.
        context["placed"] = bool(preserve_arms)
        _grow_levels(strands, info["virtual_to_real"], level + 1, context)
        _SESSION["adopted"] = sorted(
            {lv for lv, e in _SESSION["levels"].items() if e.get("adopted")})

    # What actually changed, and nothing that did not. Rebuilt, that is every
    # level from the adopted one up; not rebuilt, it is the adopted level alone
    # -- returning the levels above would be handing back rings that stand on a
    # ring this call just moved out from under them.
    def changed(item):
        return item["level"] == level or (rebuild and item["level"] > level)
    return json.dumps({
        "level": level, "unavailable": False, "rebuilt": bool(rebuild),
        "seconds": round(time.time() - started, 1),
        "h": entry["adopted"]["h"], "v": entry["adopted"]["v"],
        "lengths": lengths, "crossings": crossings, "row": row,
        "adopted": _SESSION["adopted"],
        # The levels this adopt left standing on a ring that has moved. Empty
        # after a rebuild, by construction.
        "stale": [] if rebuild else [lv for lv in sorted(_SESSION["levels"])
                                     if lv > level],
        "rows": [r for r in context["rows"] if changed(r)],
        "stages": [s for s in context["stages"] if changed(s)],
        "solutions": [_solution_meta(_SESSION["levels"][lv])
                      for lv in sorted(_SESSION["levels"])
                      if changed({"level": lv})],
    }, separators=(",", ":"))


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
    # The cache is light -- indexes and row -- so the ring the reader asked for
    # is replayed here, once, exactly as the walk first built it.
    strands, info = _clone_checkpoint(entry)
    NX.apply_solution(strands, info, entry["level"], _SESSION["m"], _SESSION["n"],
                      _SESSION["hand"], entry["h_cands"][hit["h"]],
                      entry["v_cands"][hit["v"]])
    return json.dumps({
        "level": entry["level"], "index": index, "partial": False,
        "count": len(entry["found"]),
        "countExact": entry["scan_cursor"] >= len(entry["h_cands"]) * len(entry["v_cands"]),
        "row": hit["row"], "strands": _stage_strands(NX._snapshot_json(strands)),
        "meta": _solution_meta(entry),
    }, separators=(",", ":"))


# ---------------------------------------------------------------------------
# Parallel counting. The walk's order is lexicographic over the H x V product,
# so the range [0, cells) splits into contiguous slices that independent
# workers can count with no session at all: a slice needs only the checkpoint,
# the candidate lists and the audit inputs, which export_count_job carries.
# Concatenating the slices in range order IS the serial walk's found-list.

def export_count_job(level):
    """Everything one level's count needs, session-free and JSON-safe."""
    entry = _level_session(int(level))
    if entry["enumerated"] == "none" and entry["k"] != 0:
        enumerate_level(entry["level"])
    m, n = _SESSION["m"], _SESSION["n"]
    return json.dumps({
        "level": entry["level"], "k": entry["k"],
        "m": m, "n": n, "hand": _SESSION["hand"],
        "expected": 4 * m * n, "search": entry["search"],
        "checkpoint": entry["checkpoint"],
        "hCands": entry["h_cands"], "vCands": entry["v_cands"],
    }, separators=(",", ":"))


# One job at a time per worker: the blob is compared by identity of content,
# and the pickled checkpoint is what each cell actually clones.
_SLICE_JOB = {"blob": None, "job": None, "checkpoint": None}


def count_slice(job_json, start, end):
    """Walk cells [start, end) of a job's product. Stateless between jobs."""
    if _SLICE_JOB["blob"] != job_json:
        job = json.loads(job_json)
        _SLICE_JOB.update({"blob": job_json, "job": job,
                           "checkpoint": pickle.dumps(
                               job["checkpoint"], pickle.HIGHEST_PROTOCOL)})
    job = _SLICE_JOB["job"]
    h_cands, v_cands = job["hCands"], job["vCands"]
    level, m, n, hand = job["level"], job["m"], job["n"], job["hand"]
    expected = job["expected"]
    entryish = {"search": job["search"]}
    found = []
    for cell in range(int(start), int(end)):
        i, j = divmod(cell, len(v_cands))
        strands, info = pickle.loads(_SLICE_JOB["checkpoint"])
        crossings = NX.apply_solution(strands, info, level, m, n, hand,
                                      h_cands[i], v_cands[j])
        if crossings != expected:
            continue
        row = describe(_synth_result(entryish, h_cands[i], v_cands[j]),
                       [dict(s) for s in strands], level,
                       job["k"], expected, (2 * m, 2 * n))
        found.append({"h": i, "v": j, "row": row})
    return json.dumps({"found": found, "start": int(start), "end": int(end)},
                      separators=(",", ":"))


def adopt_count(level, slices_json):
    """Install a full set of slice results as the level's own found-cache.

    Only called when every slice of [0, cells) came back: partial adoption
    would leave scan_cursor lying about what was walked.
    """
    entry = _level_session(int(level))
    pieces = sorted(json.loads(slices_json), key=lambda piece: piece["start"])
    found = []
    for piece in pieces:
        found.extend(piece["found"])
    entry["found"] = found
    entry["scan_cursor"] = len(entry["h_cands"]) * len(entry["v_cands"])
    return count_solutions(entry["level"])


def count_solutions(level, budget=None):
    """Firm up the exact solution count for a level, budget-bounded.

    Resumable: each call advances the shared scan cursor by at most `budget`
    cells (RING_SCAN_BUDGET when unset), so the caller chains calls until
    countExact rather than blocking the worker on the whole product at once.
    The worker runs one message at a time, so the round size IS the longest a
    click can wait behind the counting: the page passes a small budget and
    chains more rounds, and paging stays a click, not a queue. Enumerates
    first if the level was solved without a candidate list — the count must
    not depend on the reader having browsed once.
    """
    entry = _level_session(int(level))
    if entry["enumerated"] == "none" and entry["k"] != 0:
        enumerate_level(entry["level"])
    if entry["enumerated"] == "none":
        return json.dumps({"level": entry["level"],
                           "count": len(entry.get("found") or []),
                           "healthy": 0, "countExact": True},
                          separators=(",", ":"))
    _walk(entry, 1 << 30, False, None, budget=budget)
    total = len(entry["h_cands"]) * len(entry["v_cands"])
    # Both totals travel: every closed ring, and the weaves among them -- the
    # two denominators the browser can be paging under. cells/scanned are for
    # narration: counting inside the run's thinking needs a fraction to say.
    return json.dumps({"level": entry["level"], "count": len(entry["found"]),
                       "healthy": sum(1 for ring in entry["found"]
                                      if ring["row"]["healthy"]),
                       "cells": total, "scanned": entry["scan_cursor"],
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


def scan_semicomplete(level, band=None):
    """Sweep a band against partners that work, and keep what falls short.

    `band` is "h" or "v" and names the band to sweep -- the one the shortfall
    would be attributed to. The page asks for one at a time because that is the
    question it puts on screen ("which H values did the search throw away?"),
    and sweeping only that band halves the replays. None sweeps both, which is
    what the offline callers want.
    """
    entry = _level_session(int(level))
    if entry["enumerated"] == "none" and entry["k"] != 0:
        enumerate_level(entry["level"])
    want = str(band) if band in ("h", "v") else None
    m, n = _SESSION["m"], _SESSION["n"]
    expected = 4 * m * n
    sizes = (2 * m, 2 * n)
    h_cands, v_cands = entry["h_cands"], entry["v_cands"]
    if not h_cands or not v_cands:
        entry["semi"] = []
        entry["semi_band"] = want
        entry["semi_index"] = 0
        return json.dumps({
            "level": entry["level"], "items": [], "count": 0, "truncated": False,
            "grounded": False, "refs": 0, "band": want,
            "reason": entry.get("reason") or "this level has no candidate lists",
        }, separators=(",", ":"))

    partners, complete_seen = _reference_partners(entry)
    grounded = complete_seen > 0
    items, truncated = [], False
    for side, cands in (("h", h_cands), ("v", v_cands)):
        if want is not None and side != want:
            continue
        others = [index for index in partners[side]
                  if index < len(v_cands if side == "h" else h_cands)]
        if not others:
            continue
        if len(cands) > SEMI_BAND_CAP:
            truncated = True
        for index in range(min(len(cands), SEMI_BAND_CAP)):
            best = None
            closed = False
            for other in others:
                i, j = (index, other) if side == "h" else (other, index)
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
            swept = h_cands[i] if side == "h" else v_cands[j]
            items.append({
                "band": side, "index": index, "h": i, "v": j,
                "refs": len(others),
                "ext": list(swept.get("ext") or ()),
                "heldExt": list((v_cands[j] if side == "h" else h_cands[i]).get("ext") or ()),
                "angle": swept.get("angle"), "gap": swept.get("gap"),
                "hExt": list(h_cands[i].get("ext") or ()),
                "vExt": list(v_cands[j].get("ext") or ()),
                "total": sum(int(e) for e in (h_cands[i].get("ext") or ()))
                         + sum(int(e) for e in (v_cands[j].get("ext") or ())),
                # The longest single pair extension in the ring. A total says
                # how much string was spent; this says how far the worst pair
                # had to be stretched, which is what the "best" ordering below
                # minimises.
                "peak": max((int(e) for e in
                             list(h_cands[i].get("ext") or ())
                             + list(v_cands[j].get("ext") or ())), default=0),
                "across": report["across"], "expected": expected,
                "withinH": report["withinH"], "withinV": report["withinV"],
                "deficit": report["deficit"],
                "folded": (report["withinH"] > 0) if side == "h"
                          else (report["withinV"] > 0),
            })

    # Nearest misses first: a ring one crossing short is where the corner test is
    # most likely to be the thing that is wrong, and it is the cheapest to judge.
    items.sort(key=_semi_order("near"))
    entry["semi"] = items
    entry["semi_key"] = "near"
    entry["semi_band"] = want
    entry["semi_index"] = 0
    return json.dumps({
        "level": entry["level"], "count": len(items), "truncated": truncated,
        "key": "near", "band": want,
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


# The orderings the page can put the list in. Every one of them is a TOTAL
# order -- band and index close it -- so a reorder is reproducible and
# `sort_semicomplete` can find the row that is on screen again afterwards.
SEMI_KEYS = ("near", "h", "v", "best")


def _semi_sum(item, band):
    """One band's total extension, in px."""
    return sum(int(e) for e in (item.get("hExt" if band == "h" else "vExt") or ()))


def _semi_band_peak(item, band):
    """One band's longest single pair extension, in px."""
    return max((int(e) for e in (item.get("hExt" if band == "h" else "vExt") or ())),
               default=0)


def _semi_peak(item):
    """The ring's worst pair. Recomputed when a row predates the stored field."""
    stored = item.get("peak")
    if stored is not None:
        return int(stored)
    return max(_semi_band_peak(item, "h"), _semi_band_peak(item, "v"))


def _semi_order(key):
    """One near-miss ordering, as a sort key.

    `near` is the sweep's own order: fewest crossings missing first, because a
    ring one crossing short is where the corner test is most likely to be the
    thing that is wrong, and it is the cheapest to judge.

    `h` and `v` judge one band's answer rather than the whole ring. Shortest
    total extension in that band first, its own worst pair breaking the tie: a
    band that reaches with less string is the better answer to the same
    question, which is what the engine's `prefer_short_arms` already assumes
    when it picks. The band sorted on is the band the reader is looking at --
    ordering an H list by V would sort it by the number the sweep is holding
    still, which is the ordering that made no sense.

    `best` is minimax over the pairs: the ring whose LONGEST single pair
    extension is shortest. A total can hide one pair stretched to the limit
    behind several short ones, and that pair is the one that fails first, so of
    the rings that fell short the one whose worst pair is mildest is the
    best-formed -- the closest thing this list has to a best solution.
    """
    if key in ("h", "v"):
        other = "v" if key == "h" else "h"
        return lambda item: (_semi_sum(item, key), _semi_band_peak(item, key),
                             item["deficit"], _semi_sum(item, other),
                             item["band"], item["index"])
    if key == "best":
        return lambda item: (_semi_peak(item), item["total"], item["deficit"],
                             item["band"], item["index"])
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
        scan_semicomplete(entry["level"], entry.get("semi_band"))
        items = entry.get("semi") or []
    key = str(key) if str(key) in SEMI_KEYS else "near"
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


def select_semicomplete(level, index):
    """Materialise near-miss `index` so it can be drawn, audited and starred."""
    entry = _level_session(int(level))
    items = entry.get("semi")
    if items is None:
        scan_semicomplete(entry["level"], entry.get("semi_band"))
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
