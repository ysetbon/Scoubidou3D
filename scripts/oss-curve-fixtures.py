"""Record what OpenStrand Studio itself draws, for `npm run check:curve`.

    pip install PyQt5
    python3 scripts/oss-curve-fixtures.py ../OpenStrandStudio

Loads a handful of OSS's own sample files, builds every strand with OSS's own
classes, and writes the path OSS would paint for it (QPainterPath elements:
move, then a line or two cubics) beside the strand record it came from, into
scripts/oss-curves.json. That file is the ground truth the TypeScript port in
src/geometry/bezier.ts is held to; nothing here runs in CI, because CI has
neither Qt nor an OSS checkout.

The strands get exactly what a default OSS install gives a loaded file:
save_load_manager.py pushes the canvas's curve settings onto every strand, and
those are main.py's defaults (1.0 / 2.0 / 2.0). The third control point and the
curvature bias are on, so a locked centre and a saved bias both count — the
port is told about the third control point by its caller, and only an author who
had the bias controls on writes a bias into a file.

The samples are picked to cover every branch of the curve: a straight strand,
two handles, a locked centre on a base strand AND on an attached one (their
formulas differ), and a non-neutral bias on both halves.
"""
import json
import os
import sys
from types import SimpleNamespace

SAMPLES = [
    'src/samples/three_strand_braid.json',   # locked centres on both classes, biases
    'src/samples/overhand_knot.json',        # locked centres, neutral bias
    'src/samples/box_stitch.json',           # straight, two-handle and locked arms
    'knot_samples/knots/json/trefoil_3_1.json',  # two handles, no bias record at all
]
KEEP = ('type', 'layer_name', 'start', 'end', 'width', 'control_points', 'control_point_center',
        'control_point_center_locked', 'triangle_has_moved', 'control_point2_activated',
        'bias_control', 'attached_to')


def main(oss_root):
    os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
    sys.path.insert(0, os.path.join(oss_root, 'src'))
    from PyQt5.QtWidgets import QApplication
    app = QApplication([])  # noqa: F841 — OSS's classes need one alive
    from PyQt5.QtCore import QPointF
    import attached_strand
    import strand

    canvas = SimpleNamespace(enable_third_control_point=True, enable_curvature_bias_control=True,
                             control_point_base_fraction=1.0, distance_multiplier=2.0,
                             curve_response_exponent=2.0)

    def qp(p):
        return QPointF(p['x'], p['y'])

    files = []
    for rel in SAMPLES:
        d = json.load(open(os.path.join(oss_root, rel)))
        data = d['states'][d['current_step'] - 1]['data'] if 'states' in d else d
        records, paths = [], []
        for r in data['strands']:
            if r.get('type') == 'MaskedStrand':
                continue
            s = strand.Strand(qp(r['start']), qp(r['end']), r.get('width', 46))
            s._canvas = canvas
            cps = r.get('control_points') or []
            if len(cps) > 0 and cps[0]:
                s.control_point1 = qp(cps[0])
            if len(cps) > 1 and cps[1]:
                s.control_point2 = qp(cps[1])
            if r.get('control_point_center'):
                s.control_point_center = qp(r['control_point_center'])
            s.control_point_center_locked = bool(r.get('control_point_center_locked'))
            b = r.get('bias_control')
            s.bias_control = (SimpleNamespace(triangle_bias=b.get('triangle_bias', 0.5),
                                              circle_bias=b.get('circle_bias', 0.5)) if b else None)
            s.control_point_base_fraction = canvas.control_point_base_fraction
            s.distance_multiplier = canvas.distance_multiplier
            s.curve_response_exponent = canvas.curve_response_exponent
            cls = attached_strand.AttachedStrand if r.get('type') == 'AttachedStrand' else strand.Strand
            path = cls.get_path(s)
            els = [[int(path.elementAt(i).type), path.elementAt(i).x, path.elementAt(i).y]
                   for i in range(path.elementCount())]
            records.append({k: r[k] for k in KEEP if k in r})
            paths.append({'layer': r.get('layer_name'), 'elements': els})
        files.append({'file': rel, 'strands': records, 'oss': paths})

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'oss-curves.json')
    with open(out, 'w') as fh:
        json.dump({'curve': [1.0, 2.0, 2.0], 'files': files}, fh, indent=1)
        fh.write('\n')
    print(f'wrote {out}: {sum(len(f["oss"]) for f in files)} strands from {len(files)} files')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '../OpenStrandStudio')
