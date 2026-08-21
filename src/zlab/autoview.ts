// Three ways to say which separation gets which turn, over one set of numbers.
//
// They are VIEWS, not modes. Each one edits the same `Auto` — the two shoulders
// and the cap — so switching between them is a change of drawing and nothing
// else: whatever the strand is doing carries straight across, because there is
// no second copy of the state for it to fall out of step with.
//
// All three also draw the SHELL THRESHOLD, which is computed rather than set.
// Past `2 asin(step / width)` an exact fold's tip stands taller than the storey
// it climbs and flares into a shell, so that angle is the constraint the whole
// setting exists to clear. A control that hides the thing it is for is a
// control the reader has to be told about; this one says it.

export type AutoView = 'bar' | 'curve' | 'dial';

/** Where the crease swings towards square, and how far it is allowed to go. */
export interface Auto {
  /** Degrees: the lean has reached its cap by here. */
  lo: number;
  /** Degrees: it starts falling away after here. */
  hi: number;
  /** How square it ever gets, 0..1. */
  cap: number;
}

const smooth = (t: number): number => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/**
 * The lean this separation gets: nothing at a dead fold-back, the cap across
 * the plateau, nothing again at straight-through.
 *
 * The two ends are 0 for reasons that are not symmetry. At 0 the bisector IS
 * square to the strap, so both ends of the fold family are the same hairpin and
 * the lean cannot matter. At 180 the exact fold has already flattened into a
 * shallow oblique step — it is carrying on in all but name — so leaning it
 * would put a turn in a lace that is not turning.
 */
export function autoLean(a: Auto, separation: number): number {
  const lo = Math.min(a.lo, a.hi);
  const hi = Math.max(a.lo, a.hi);
  if (separation <= lo) return a.cap * smooth(lo <= 0 ? 1 : separation / lo);
  if (separation >= hi) return a.cap * smooth(hi >= 180 ? 1 : (180 - separation) / (180 - hi));
  return a.cap;
}

/** The separation past which an exact fold's tip outgrows its own storey. */
export function shellThreshold(step: number, width: number): number {
  return (2 * Math.asin(Math.min(1, step / width)) * 180) / Math.PI;
}

// ---- drawing ---------------------------------------------------------------

const NS = 'http://www.w3.org/2000/svg';
const INK = '#f0e9dd';
const DIM = '#9a9088';
const LINE = '#332c26';
const HOT = '#e0857a';
const FOLD: RGB = [0x7f, 0xb6, 0xe8];
const SQUARE: RGB = [0x8f, 0xc7, 0x9a];
const CARRY: RGB = [0xc9, 0xa8, 0x6a];

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const css = (c: RGB): string => `rgb(${c.map((v) => Math.round(v)).join(',')})`;

/**
 * What colour a separation is: blue where the crease is on the bisector, green
 * where it has swung square, and fading to the carry colour past the right
 * shoulder, where the fold has flattened into a step whatever the lean says.
 */
function tint(a: Auto, sep: number): string {
  const base = mix(FOLD, SQUARE, autoLean(a, sep));
  const hi = Math.max(a.lo, a.hi);
  const tail = sep <= hi ? 0 : smooth((sep - hi) / Math.max(1, 180 - hi));
  return css(mix(base, CARRY, tail));
}

const svgEl = <K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const label = (
  x: number,
  y: number,
  text: string,
  size: number,
  fill: string,
  anchor = 'start',
  weight = '400',
): SVGTextElement => {
  const t = svgEl('text', {
    x,
    y,
    'font-size': size,
    fill,
    'text-anchor': anchor,
    'font-weight': weight,
    'font-family': 'system-ui, -apple-system, Segoe UI, sans-serif',
  });
  t.textContent = text;
  return t;
};

export interface AutoDial {
  el: SVGSVGElement;
  /** Redraw from the model. Cheap; call it whenever anything it shows moves. */
  paint(separation: number, step: number, width: number): void;
}

/**
 * Build one of the three views over `auto`, mutating it in place as the reader
 * drags. `onEdit` fires on every change so the strand can be rebuilt.
 *
 * The element is built once and repainted in place rather than replaced, so a
 * drag keeps its pointer capture all the way through.
 */
export function autoDial(
  view: AutoView,
  auto: Auto,
  onEdit: () => void,
  onSeparation: (deg: number) => void,
): AutoDial {
  const W = 320;
  const H = view === 'bar' ? 138 : view === 'curve' ? 156 : 182;
  const PAD = 14;
  const el = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    style: 'display:block;touch-action:none;cursor:pointer',
  });

  const span = W - 2 * PAD;
  const xOf = (deg: number): number => PAD + (deg / 180) * span;
  const degOf = (x: number): number =>
    Math.min(180, Math.max(0, ((x - PAD) / span) * 180));

  // The one place the three views differ in how a pointer becomes a number.
  const CX = W / 2;
  const CY = H - 26;
  const R = 96;
  const dialAt = (deg: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [CX - R * Math.cos(a), CY - R * Math.sin(a)];
  };
  const dialDeg = (x: number, y: number): number => {
    const a = (Math.atan2(-(y - CY), -(x - CX)) * 180) / Math.PI;
    return Math.min(180, Math.max(0, a));
  };

  // Lean 1 sits at yTop, lean 0 at yBase — curve view only.
  const yTop = 34;
  const yBase = 118;
  const yOf = (lean: number): number => yBase - lean * (yBase - yTop);

  // ---- the parts that get repainted ----------------------------------------

  const paints: Array<(sep: number, step: number, width: number) => void> = [];

  // The axis, so the numbers on the pills have something to be numbers against.
  if (view === 'dial') {
    el.appendChild(label(CX - R - 2, CY + 14, '0°', 10, DIM, 'middle'));
    el.appendChild(label(CX, CY - R - 14, '90°', 10, DIM, 'middle'));
    el.appendChild(label(CX + R + 2, CY + 14, '180°', 10, DIM, 'middle'));
  } else {
    for (const d of [0, 90, 180]) {
      el.appendChild(label(xOf(d), 14, `${d}°`, 10, DIM, d === 0 ? 'start' : d === 180 ? 'end' : 'middle'));
    }
  }

  if (view === 'bar' || view === 'dial') {
    // Both are the same idea drawn on a different line: the colour sampled all
    // the way along, so the gradient IS the lean rather than a decoration of it.
    const SEGS = 72;
    const bits: SVGElement[] = [];
    if (view === 'bar') {
      const clipId = `barclip${Math.round(xOf(1) * 1e6)}`;
      const clip = svgEl('clipPath', { id: clipId });
      clip.appendChild(svgEl('rect', { x: PAD, y: 26, width: span, height: 30, rx: 7 }));
      el.appendChild(clip);
      const g = svgEl('g', { 'clip-path': `url(#${clipId})` });
      for (let i = 0; i < SEGS; i++) {
        const r = svgEl('rect', {
          x: PAD + (span * i) / SEGS,
          y: 26,
          width: span / SEGS + 1,
          height: 30,
        });
        bits.push(r);
        g.appendChild(r);
      }
      el.appendChild(g);
    } else {
      for (let i = 0; i < SEGS; i++) {
        const a0 = (180 * i) / SEGS;
        const a1 = (180 * (i + 1)) / SEGS + 0.4;
        const [x0, y0] = dialAt(a0);
        const [x1, y1] = dialAt(a1);
        const p = svgEl('path', {
          d: `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
          fill: 'none',
          'stroke-width': 18,
        });
        bits.push(p);
        el.appendChild(p);
      }
    }
    // Names on the bar, because a gradient alone does not say what it is a
    // gradient OF. Each one is dropped when its zone is too narrow to hold it.
    const words =
      view === 'bar'
        ? (['FOLD', 'SQUARE', 'CARRY'] as const).map((w) => {
            const t = label(0, 45, w, 11, '#141110', 'middle', '700');
            el.appendChild(t);
            return t;
          })
        : [];
    paints.push(() => {
      bits.forEach((b, i) => {
        const c = tint(auto, (180 * (i + 0.5)) / SEGS);
        b.setAttribute('stroke', c);
        if (view === 'bar') b.setAttribute('fill', c);
      });
      if (!words.length) return;
      const lo = Math.min(auto.lo, auto.hi);
      const hi = Math.max(auto.lo, auto.hi);
      const zones: Array<[number, number]> = [
        [0, lo],
        [lo, hi],
        [hi, 180],
      ];
      words.forEach((t, i) => {
        const [a, b] = zones[i];
        const room = xOf(b) - xOf(a);
        t.setAttribute('opacity', room < 46 ? '0' : '1');
        t.setAttribute('x', String((xOf(a) + xOf(b)) / 2));
      });
    });
  }

  if (view === 'curve') {
    el.appendChild(svgEl('line', { x1: PAD, y1: yBase, x2: W - PAD, y2: yBase, stroke: LINE }));
    el.appendChild(
      svgEl('line', {
        x1: PAD,
        y1: yTop,
        x2: W - PAD,
        y2: yTop,
        stroke: LINE,
        'stroke-dasharray': '2 4',
      }),
    );
    el.appendChild(label(W - PAD, yTop - 4, 'square', 10, DIM, 'end'));
    el.appendChild(label(W - PAD, yBase + 12, 'bisector', 10, DIM, 'end'));
    const fill = svgEl('path', { fill: 'rgba(143,199,154,0.22)' });
    const line = svgEl('path', { fill: 'none', stroke: css(SQUARE), 'stroke-width': 2.2 });
    el.appendChild(fill);
    el.appendChild(line);
    paints.push(() => {
      let d = '';
      for (let s = 0; s <= 180; s += 2) {
        d += `${d ? 'L' : 'M'}${xOf(s).toFixed(2)} ${yOf(autoLean(auto, s)).toFixed(2)}`;
      }
      line.setAttribute('d', d);
      fill.setAttribute('d', `${d}L${xOf(180)} ${yBase}L${xOf(0)} ${yBase}Z`);
    });
  }

  // Shell threshold — computed, so it is drawn differently from anything set.
  const shellMark = svgEl('line', {
    stroke: HOT,
    'stroke-width': 2,
    'stroke-dasharray': '3 3',
  });
  const shellText = label(0, 0, '', 10, HOT);
  el.appendChild(shellMark);
  el.appendChild(shellText);

  // The separation the lab is actually showing.
  const nowMark = svgEl('line', { stroke: HOT, 'stroke-width': 1.5, opacity: 0.6 });
  const nowDot = svgEl('circle', { r: 6, fill: HOT, stroke: '#141110', 'stroke-width': 1.5 });
  el.appendChild(nowMark);
  el.appendChild(nowDot);

  // The two shoulders, and — on the curve — the cap they sit at.
  const grip = (): { hit: SVGElement; pill: SVGRectElement; text: SVGTextElement } => {
    const hit =
      view === 'bar'
        ? svgEl('rect', { width: 8, height: 46, rx: 4, fill: INK })
        : svgEl('circle', { r: 7, fill: INK, stroke: '#141110', 'stroke-width': 2 });
    const pill = svgEl('rect', { width: 44, height: 18, rx: 9, fill: INK });
    const text = label(0, 0, '', 11, '#141110', 'middle', '700');
    el.appendChild(hit);
    el.appendChild(pill);
    el.appendChild(text);
    return { hit, pill, text };
  };
  const gLo = grip();
  const gHi = grip();

  const readout = label(W / 2, H - 4, '', 11.5, INK, 'middle', '700');
  el.appendChild(readout);

  const place = (g: ReturnType<typeof grip>, deg: number, lean: number): void => {
    let x: number;
    let y: number;
    if (view === 'dial') [x, y] = dialAt(deg);
    else {
      x = xOf(deg);
      y = view === 'curve' ? yOf(lean) : 41;
    }
    if (view === 'bar') {
      g.hit.setAttribute('x', String(x - 4));
      g.hit.setAttribute('y', String(y - 23));
    } else {
      g.hit.setAttribute('cx', String(x));
      g.hit.setAttribute('cy', String(y));
    }
    const py = view === 'bar' ? y + 25 : y + 12;
    g.pill.setAttribute('x', String(Math.min(W - 46, Math.max(2, x - 22))));
    g.pill.setAttribute('y', String(py));
    g.text.setAttribute('x', String(Math.min(W - 24, Math.max(24, x))));
    g.text.setAttribute('y', String(py + 13));
    g.text.textContent = `${Math.round(deg)}°`;
  };

  let shown = 0; // the separation last painted, so a drag knows what it is near

  const paint = (separation: number, step: number, width: number): void => {
    shown = separation;
    for (const p of paints) p(separation, step, width);
    const lean = autoLean(auto, separation);

    const shell = shellThreshold(step, width);
    const covered = shell >= Math.min(auto.lo, auto.hi) - 0.5;
    const sx = xOf(Math.min(180, shell));
    if (view === 'dial') {
      const [ix, iy] = dialAt(shell);
      const [ox, oy] = [CX + (ix - CX) * 1.16, CY + (iy - CY) * 1.16];
      shellMark.setAttribute('x1', String(ix));
      shellMark.setAttribute('y1', String(iy));
      shellMark.setAttribute('x2', String(ox));
      shellMark.setAttribute('y2', String(oy));
      shellText.setAttribute('x', String(PAD));
      shellText.setAttribute('y', String(H - 18));
      shellText.setAttribute('text-anchor', 'start');
    } else {
      shellMark.setAttribute('x1', String(sx));
      shellMark.setAttribute('y1', String(view === 'curve' ? yTop - 8 : 22));
      shellMark.setAttribute('x2', String(sx));
      shellMark.setAttribute('y2', String(view === 'curve' ? yBase : 60));
      shellText.setAttribute('x', String(Math.min(W - 4, sx + 5)));
      // Below where a dropped shoulder pill can reach, or the warning ends up
      // reading through it.
      shellText.setAttribute('y', String(view === 'curve' ? yBase + 14 : 120));
      shellText.setAttribute('text-anchor', 'start');
    }
    // Naming the band is the whole use of the warning. "Not covered" says
    // something is wrong without saying what to drag or how far.
    shellText.textContent = covered
      ? `shell ${Math.round(shell)}° · covered`
      : `shell ${Math.round(shell)}° · flares ${Math.round(shell)}–${Math.round(Math.min(auto.lo, auto.hi))}°`;
    // Red only ever means a problem, so a cleared threshold goes quiet.
    shellText.setAttribute('fill', covered ? DIM : '#ff6b5e');
    shellMark.setAttribute('stroke', covered ? DIM : '#ff6b5e');

    if (view === 'dial') {
      const [nx, ny] = dialAt(separation);
      nowMark.setAttribute('x1', String(CX));
      nowMark.setAttribute('y1', String(CY));
      nowMark.setAttribute('x2', String(nx));
      nowMark.setAttribute('y2', String(ny));
      nowDot.setAttribute('cx', String(nx));
      nowDot.setAttribute('cy', String(ny));
    } else {
      const nx = xOf(separation);
      nowMark.setAttribute('x1', String(nx));
      nowMark.setAttribute('y1', String(view === 'curve' ? yTop - 8 : 22));
      nowMark.setAttribute('x2', String(nx));
      nowMark.setAttribute('y2', String(view === 'curve' ? yBase : 60));
      nowDot.setAttribute('cx', String(nx));
      nowDot.setAttribute('cy', String(view === 'curve' ? yOf(lean) : 63));
    }

    place(gLo, auto.lo, auto.cap);
    place(gHi, auto.hi, auto.cap);
    // Shoulders are allowed to meet, so their pills have to get out of each
    // other's way rather than overprint into an unreadable smear.
    const apart = Math.abs(xOf(auto.hi) - xOf(auto.lo));
    const drop = apart < 48 ? 20 : 0;
    for (const n of [gHi.pill, gHi.text]) {
      n.setAttribute('y', String(Number(n.getAttribute('y')) + drop));
    }
    readout.textContent = `now ${Math.round(separation)}° · lean ${lean.toFixed(2)}`;
  };

  // ---- dragging ------------------------------------------------------------

  let held: 'lo' | 'hi' | 'cap' | 'now' | null = null;
  const local = (e: PointerEvent): [number, number] => {
    const r = el.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };

  el.addEventListener('pointerdown', (e) => {
    const [x, y] = local(e);
    const deg = view === 'dial' ? dialDeg(x, y) : degOf(x);
    // The separation marker wins when the pointer is close to it. Being able to
    // drag it here is the difference between a control that answers and one that
    // only records: an edit that leaves the lean where it was — a shoulder moved
    // to the far side of the separation, say — changes nothing on screen and
    // reads as a dead control, which is exactly what it is not.
    if (Math.abs(deg - shown) < 7) {
      held = 'now';
    } else if (
      view === 'curve' &&
      deg > Math.min(auto.lo, auto.hi) + 6 &&
      deg < Math.max(auto.lo, auto.hi) - 6
    ) {
      // The cap is grabbed by the plateau itself: there is nowhere else on that
      // line to aim, so it needs no handle of its own.
      held = 'cap';
    } else {
      held = Math.abs(deg - auto.lo) <= Math.abs(deg - auto.hi) ? 'lo' : 'hi';
    }
    el.setPointerCapture(e.pointerId);
    el.dispatchEvent(new PointerEvent('pointermove', e));
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    // A pointerup that never arrives — the pointer leaving on a dropped capture,
    // a button released off-window — would otherwise leave every later hover
    // silently editing. The capture is the authority, not the flag.
    if (held && !el.hasPointerCapture(e.pointerId)) held = null;
    if (!held) return;
    const [x, y] = local(e);
    if (held === 'now') {
      onSeparation(Math.round(view === 'dial' ? dialDeg(x, y) : degOf(x)));
      return;
    }
    if (held === 'cap') {
      auto.cap = Math.min(1, Math.max(0, (yBase - y) / (yBase - yTop)));
    } else {
      const deg = Math.round(view === 'dial' ? dialDeg(x, y) : degOf(x));
      // The shoulders may meet but not cross: a plateau read back to front is a
      // curve nobody meant to draw.
      if (held === 'lo') auto.lo = Math.min(deg, auto.hi);
      else auto.hi = Math.max(deg, auto.lo);
    }
    onEdit();
  });

  const drop = (e: PointerEvent): void => {
    held = null;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };
  el.addEventListener('pointerup', drop);
  el.addEventListener('pointercancel', drop);

  return { el, paint };
}
