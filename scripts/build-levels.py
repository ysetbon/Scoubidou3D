#!/usr/bin/env python3
"""Build public/levels/ — every level of every m x n face, at full resolution.

    python3 scripts/build-levels.py <render-dir>

`render-dir` holds one folder per face (`1x5/`) of `L00-top.png` .. `L10-orb.png`,
as `scripts/level-shots.mjs` leaves them. Each is cropped to the model, resized to
IMG px and written as WebP, and one page is generated that reads the whole family.

The page is a rollup entry (see vite.config.ts) so its `<link>` to site.css gets
the same hashed build copy the rest of the site uses; the images go to `public/`,
which vite copies verbatim. Both land at /Scoubidou3D/levels/, and the page
deep-links per face (#3x7). Every thumbnail is an anchor to the image itself, so
"open in a new tab" gives the full-resolution render rather than a scaled copy.

Palette and type are site/site.css's, because this is a page of that site.
"""
import io
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# The page is a vite entry so it can link site.css and get the hashed build copy;
# the images sit in public/ and are copied verbatim. Both land at /levels/.
PAGE = os.path.join(ROOT, 'levels')
OUT = os.path.join(ROOT, 'public', 'levels')
IMG = 800          # px on the long side; the raw crop is ~910
QUALITY = 78
LEVELS = 11


def crop(im, pad=18):
    """Trim to the laces: they are saturated or near-black, the grid is neither."""
    g = im.convert('RGB')
    px = g.load()
    w, h = g.size
    minx, miny, maxx, maxy = w, h, 0, 0
    for y in range(0, h, 3):
        for x in range(0, w, 3):
            r, gg, b = px[x, y]
            if max(r, gg, b) - min(r, gg, b) > 42 or max(r, gg, b) < 105:
                minx = min(minx, x); maxx = max(maxx, x)
                miny = min(miny, y); maxy = max(maxy, y)
    if maxx <= minx:
        return g
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    half = max(maxx - minx, maxy - miny) / 2 + pad
    return g.crop((max(0, int(cx - half)), max(0, int(cy - half)),
                   min(w, int(cx + half)), min(h, int(cy + half))))


def main(src):
    faces = json.load(open(os.path.join(ROOT, 'scripts', 'twofan-cost.json')))['faces']
    os.makedirs(os.path.join(OUT, 'img'), exist_ok=True)
    os.makedirs(PAGE, exist_ok=True)
    total = 0
    written = 0
    for m in range(1, 9):
        for n in range(1, 9):
            key = f'{m}x{n}'
            d = os.path.join(OUT, 'img', key)
            os.makedirs(d, exist_ok=True)
            for L in range(LEVELS):
                for tag in ('top', 'orb'):
                    srcp = os.path.join(src, key, f'L{L:02d}-{tag}.png')
                    dstp = os.path.join(d, f'L{L:02d}-{tag}.webp')
                    total += 1
                    if not os.path.exists(srcp):
                        continue
                    im = crop(Image.open(srcp))
                    im.thumbnail((IMG, IMG), Image.LANCZOS)
                    im.save(dstp, 'WEBP', quality=QUALITY, method=6)
                    written += os.path.getsize(dstp)
    open(os.path.join(PAGE, 'index.html'), 'w').write(page(faces))
    print(f'{total} images, {written / 1048576:.1f} MB, plus index.html')


def state(f):
    if f['kept'] == f['want'] and 55.9 < f['gmin'] < 56.1 and 55.9 < f['gmax'] < 56.1:
        return 'clean', 'every crossing real, every gap at the floor'
    if f['gmin'] < 40:
        return 'crit', f'a gap closes to {f["gmin"]} px — two 46 px laces overlapping'
    if f['kept'] == f['want']:
        return 'warn', f'every crossing still real, but gaps open to {f["gmax"]} px — past the 69 px ceiling'
    return 'warn', f'{f["want"] - f["kept"]} crossings a level lost, gaps out to {f["gmax"]} px'


def page(faces):
    cells = []
    for m in range(1, 9):
        cells.append(f'<span class="ax axm">m{m}</span>')
        for n in range(1, 9):
            key = f'{m}x{n}'
            f = faces[key]
            st, why = state(f)
            shade = min(1.0, (f['over'] - 0.7) / 3.5)
            cells.append(
                f'<button class="cell {st}" type="button" data-face="{key}" style="--s:{shade:.3f}" '
                f'title="{m}×{n} — turn {f["turn"]}° (was {f["was"]}°) · overhang {f["over"]}w '
                f'(was {f["wasOver"]}w) · {f["kept"]}/{f["want"]} crossings · '
                f'gaps {f["gmin"]}–{f["gmax"]} px&#10;{why}">'
                f'<b>{m}×{n}</b><i>{f["turn"]}°</i><s>{f["over"]}w</s></button>')
    data = json.dumps({k: {kk: v[kk] for kk in ('turn', 'was', 'over', 'wasOver', 'kept', 'want', 'gmin', 'gmax')}
                       for k, v in faces.items()}, separators=(',', ':'))
    return TEMPLATE.replace('{{CELLS}}', '\n      '.join(cells)).replace('{{DATA}}', data)


TEMPLATE = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Twist stitch levels — Scoubidou3D</title>
<meta name="description" content="Every level of every m x n twist face, top and orbit, at full resolution.">
<link rel="icon" href="../favicon.svg">
<link rel="stylesheet" href="../site/site.css">
<style>
  /* The site's tokens carry the page; only what the site has no component for
     lives here — the face matrix and the level viewer. */
  .lv { max-width: 1180px; margin: 0 auto; padding: 34px 24px 90px; }
  .lv-head { display: flex; flex-direction: column; gap: 14px; padding-bottom: 26px;
    border-bottom: 1px solid var(--line); }
  .lv-head h1 { font-family: Georgia, serif; font-size: clamp(30px, 4.6vw, 48px);
    line-height: 1.08; margin: 0; letter-spacing: -0.02em; }
  .lv-head p { margin: 0; max-width: 62ch; color: var(--muted); font-size: 16px; line-height: 1.6; }
  .kicker { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 11px;
    letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); }
  .lv h2 { font-family: Georgia, serif; font-size: 26px; margin: 40px 0 6px; }
  .lv h2 + p { margin: 0 0 18px; color: var(--muted); max-width: 62ch; line-height: 1.6; }

  .grid { display: grid; grid-template-columns: auto repeat(8, minmax(0, 1fr)); gap: 4px; }
  .ax { font-family: ui-monospace, monospace; font-size: 10.5px; color: var(--muted);
    display: flex; align-items: center; justify-content: center; }
  .axm { justify-content: flex-end; padding-right: 7px; }
  .cell { background: var(--paper); border: 1px solid var(--line); border-left: 3px solid var(--line);
    border-radius: 2px; padding: 8px 3px 7px; cursor: pointer; display: flex; flex-direction: column;
    align-items: center; gap: 1px; font-family: ui-monospace, monospace; text-align: center;
    font-variant-numeric: tabular-nums;
    box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--coral) calc(var(--s) * 13%), transparent); }
  .cell.clean { border-left-color: var(--teal); }
  .cell.warn { border-left-color: var(--yellow); }
  .cell.crit { border-left-color: var(--coral); }
  .cell b { font-size: 12px; }
  .cell i { font-style: normal; font-size: 10.5px; color: var(--muted); }
  .cell s { text-decoration: none; font-size: 9.5px; color: var(--muted); opacity: 0.8; }
  .cell:hover { border-color: var(--ink); }
  .cell[aria-pressed="true"] { box-shadow: inset 0 0 0 999px
    color-mix(in srgb, var(--coral) calc(var(--s) * 13%), transparent), 0 0 0 2px var(--ink); }
  .legend { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 14px;
    font-family: ui-monospace, monospace; font-size: 11.5px; color: var(--muted); }
  .legend i { display: inline-block; width: 3px; height: 13px; vertical-align: -2px; margin-right: 8px; }

  .viewer { margin-top: 30px; background: var(--paper); border: 1px solid var(--line); border-radius: 3px; }
  .vhead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 20px; padding: 16px 20px;
    border-bottom: 1px solid var(--line); font-family: ui-monospace, monospace; font-size: 12.5px;
    color: var(--muted); }
  .vhead b { font-size: 19px; color: var(--ink); font-family: Georgia, serif; }
  .vhead em { font-style: normal; color: var(--ink); font-weight: 600; }
  .chip { padding: 3px 10px; border-radius: 12px; font-size: 11px; }
  .chip.clean { background: color-mix(in srgb, var(--teal) 15%, transparent); color: var(--teal); }
  .chip.warn { background: color-mix(in srgb, var(--yellow) 42%, transparent); color: #6b5200; }
  .chip.crit { background: color-mix(in srgb, var(--coral) 16%, transparent); color: var(--coral); }
  .hint { padding: 12px 20px 0; font-family: ui-monospace, monospace; font-size: 11px; color: var(--muted); }
  .levels { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 14px; padding: 14px 20px 22px; }
  .lvl { display: flex; flex-direction: column; gap: 6px; }
  .lvl .n { font-family: ui-monospace, monospace; font-size: 11px; color: var(--muted);
    letter-spacing: 0.06em; text-transform: uppercase; }
  .lvl a { display: block; border: 1px solid var(--line); border-radius: 2px; overflow: hidden;
    background: #eef0f4; }
  .lvl a:hover { border-color: var(--ink); }
  .lvl img { display: block; width: 100%; height: auto; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .cap { font-family: ui-monospace, monospace; font-size: 10px; color: var(--muted); }
  @media (max-width: 640px) { .grid { font-size: 9px; } .cell b { font-size: 10px; } }
</style>
</head>
<body>
  <header>
    <a class="brand" href="../">
      <svg class="mark small" viewBox="0 0 72 72" aria-hidden="true">
        <path d="M9 16h54v16H9z" class="ma" />
        <path d="M28 8h16v56H28z" class="mb" />
        <path d="M28 16h16v16H28z" class="mt" />
      </svg>
      <span>Scoubidou<strong>3D</strong></span>
    </a>
    <nav aria-label="Primary">
      <a href="../#samples">Samples</a>
      <a href="../#how">How it works</a>
      <a href="../#learn">Notes</a>
      <a href="https://github.com/ysetbon/Scoubidou3D">GitHub</a>
    </nav>
    <a class="btn dark" href="../app/">Open the studio
      <svg class="arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5" /></svg>
    </a>
  </header>

  <div class="lv">
    <div class="lv-head">
      <span class="kicker">Twist family · every level of every face</span>
      <h1>All 64 faces, level by level.</h1>
      <p>Eleven levels of each m&nbsp;×&nbsp;n twist column, straight from the studio's own 3D view — top
      view and orbit, side by side. Pick a face; open any picture for the full-resolution render.</p>
    </div>

    <h2>The family</h2>
    <p>Each cell carries its turn and how far the majority family's loosest arm hangs past the band it
    crosses. The stripe on the left is what that face paid for being turned at its own angle instead of
    the one that suits the few.</p>
    <div class="grid">
      <span class="ax"></span><span class="ax">n1</span><span class="ax">n2</span><span class="ax">n3</span><span class="ax">n4</span><span class="ax">n5</span><span class="ax">n6</span><span class="ax">n7</span><span class="ax">n8</span>
      {{CELLS}}
    </div>
    <div class="legend">
      <span><i style="background:var(--teal)"></i>paid nothing — the diagonal, where the two fans are one angle</span>
      <span><i style="background:var(--yellow)"></i>gaps opened past the 69&nbsp;px ceiling; most also lost crossings</span>
      <span><i style="background:var(--coral)"></i>a gap closed under 40&nbsp;px — laces overlapping</span>
      <span>wash = overhang</span>
    </div>

    <div class="viewer">
      <div class="vhead" id="vhead"></div>
      <p class="hint">Top view left, orbit right. Open a picture in a new tab for the full-resolution render.</p>
      <div class="levels" id="levels"></div>
    </div>
  </div>

<script>
(function () {
  var FACES = {{DATA}};
  var head = document.getElementById('vhead');
  var box = document.getElementById('levels');
  var cells = Array.prototype.slice.call(document.querySelectorAll('.cell'));

  function stateOf(f) {
    if (f.kept === f.want && f.gmin > 55.9 && f.gmin < 56.1 && f.gmax > 55.9 && f.gmax < 56.1) return 'clean';
    return f.gmin < 40 ? 'crit' : 'warn';
  }

  function show(face) {
    var f = FACES[face];
    if (!f) return;
    var st = stateOf(f);
    head.innerHTML =
      '<b>' + face.replace('x', '\\u00d7') + '</b>' +
      '<span>turn <em>' + f.turn + '\\u00b0</em>' + (f.turn === f.was ? '' : ' \\u2014 was ' + f.was + '\\u00b0') + '</span>' +
      '<span>overhang <em>' + f.over + 'w</em>' + (f.over === f.wasOver ? '' : ' \\u2014 was ' + f.wasOver + 'w') + '</span>' +
      '<span class="chip ' + st + '">' + f.kept + '/' + f.want + ' crossings \\u00b7 gaps ' + f.gmin + '\\u2013' + f.gmax + ' px</span>';
    var html = '';
    for (var L = 0; L <= 10; L++) {
      var p = 'img/' + face + '/L' + (L < 10 ? '0' + L : L);
      html += '<div class="lvl"><span class="n">level ' + L + '</span><div class="pair">' +
        '<a href="' + p + '-top.webp" target="_blank" rel="noopener"><img loading="lazy" ' +
        'alt="' + face + ' level ' + L + ', from the top" src="' + p + '-top.webp"></a>' +
        '<a href="' + p + '-orb.webp" target="_blank" rel="noopener"><img loading="lazy" ' +
        'alt="' + face + ' level ' + L + ', orbit" src="' + p + '-orb.webp"></a>' +
        '</div><span class="cap">top \\u00b7 orbit</span></div>';
    }
    box.innerHTML = html;
    cells.forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.face === face)); });
    if (location.hash.slice(1) !== face) history.replaceState(null, '', '#' + face);
  }

  cells.forEach(function (c) { c.addEventListener('click', function () { show(c.dataset.face); }); });
  window.addEventListener('hashchange', function () { show(location.hash.slice(1)); });
  show(FACES[location.hash.slice(1)] ? location.hash.slice(1) : '1x5');
})();
</script>
</body>
</html>
'''

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'renders')
