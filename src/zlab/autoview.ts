// Three ways to say which separation gets which turn, over one set of numbers.
//
// They are VIEWS, not modes. Each one edits the same `Auto` — three angles and
// an influence — so switching between them is a change of drawing and nothing
// else: whatever the strand is doing carries straight across, because there is
// no second copy of the state for it to fall out of step with.
//
// The numbers themselves, and what they mean, are in
// `src/geometry/autoFold.ts`: the studio phases its turns off the same four,
// so a change made here is a change made there.
//
// All three also draw the SHELL THRESHOLD, which is computed rather than set.
// Past `2 asin(step / width)` an exact fold's tip stands taller than the storey
// it climbs and flares into a shell, so that angle is the constraint the whole
// setting exists to clear. A control that hides the thing it is for is a
// control the reader has to be told about; this one says it.

import { Auto, autoCarries, autoLean, flareBand, shellThreshold } from '../geometry/autoFold';

export type { Auto };
export { autoCarries, autoLean, flareBand, shellThreshold };

export type AutoView = 'bar' | 'curve' | 'dial';

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const smooth = (t: number): number => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

/** The three angles in order, whatever order they were dropped in. */
function bounds(a: Auto): [number, number, number] {
  const lo = clamp(a.lo, 0, 180);
  const hi = clamp(Math.max(a.hi, lo), 0, 180);
  return [lo, hi, clamp(Math.max(a.carry, hi), 0, 180)];
}

// ---- drawing ---------------------------------------------------------------

const NS = 'http://www.w3.org/2000/svg';
const INK = '#f0e9dd';
const DIM = '#9a9088';
const LINE = '#332c26';
const HOT = '#e0857a';
const BAD = '#ff6b5e';
const FOLD: RGB = [0x7f, 0xb6, 0xe8];
const SQUARE: RGB = [0x8f, 0xc7, 0x9a];
const CARRY: RGB = [0xc9, 0xa8, 0x6a];

type RGB = [number, number, number];
const blend = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const css = (c: RGB): string => `rgb(${c.map((v) => Math.round(v)).join(',')})`;

/**
 * What colour a separation is: blue where the crease is on the bisector, green
 * where it has swung square, and gold past the carry angle, where the lace has
 * stopped folding entirely.
 */
function tint(a: Auto, sep: number): string {
  const [, hi, carry] = bounds(a);
  if (sep >= carry) return css(CARRY);
  const base = blend(FOLD, SQUARE, autoLean(a, sep));
  const tail = carry <= hi ? 0 : smooth((sep - hi) / (carry - hi));
  return css(blend(base, CARRY, sep <= hi ? 0 : tail * 0.75));
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
  size: number,
  fill: string,
  anchor = 'start',
  weight = '400',
): SVGTextElement =>
  svgEl('text', {
    x,
    y,
    'font-size': size,
    fill,
    'text-anchor': anchor,
    'font-weight': weight,
    'font-family': 'system-ui, -apple-system, Segoe UI, sans-serif',
  });

export interface AutoDial {
  el: SVGSVGElement;
  /** Redraw from the model. Cheap; call it whenever anything it shows moves. */
  paint(separation: number, step: number, width: number): void;
}

type Grab = 'lo' | 'hi' | 'carry' | 'cap' | 'now';

/**
 * Build one of the three views over `auto`, mutating it in place as the reader
 * drags. `onEdit` fires on every change so the strand can be rebuilt.
 *
 * The element is built once and repainted in place rather than replaced, so a
 * drag keeps its pointer capture all the way through.
 *
 * The three angles report themselves on ONE line underneath rather than each
 * carrying a pill of its own. Pills were the obvious thing and they were wrong:
 * pushed together they overprint into a smear exactly when the reader is
 * looking hardest, and three of them cannot be staggered clear in the height
 * available. A sentence reads at any spacing.
 */
export function autoDial(
  view: AutoView,
  auto: Auto,
  onEdit: () => void,
  onSeparation: (deg: number) => void,
): AutoDial {
  const W = 320;
  const PAD = 14;
  // One layout per view, so the vertical arithmetic is in a single place rather
  // than smeared through the drawing as magic numbers.
  const L =
    view === 'bar'
      ? { h: 128, track: 30, top: 26, sum: 82, shell: 100, now: 120 }
      : view === 'curve'
        ? { h: 176, track: 0, top: 34, sum: 136, shell: 154, now: 170 }
        : { h: 198, track: 0, top: 48, sum: 170, shell: 186, now: 148 };
  const H = L.h;
  const el = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    style: 'display:block;touch-action:none;cursor:pointer',
  });

  const span = W - 2 * PAD;
  const xOf = (deg: number): number => PAD + (deg / 180) * span;
  const degOf = (x: number): number => clamp(((x - PAD) / span) * 180, 0, 180);

  const CX = W / 2;
  const CY = 144;
  const R = 96;
  const dialAt = (deg: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [CX - R * Math.cos(a), CY - R * Math.sin(a)];
  };
  const dialDeg = (x: number, y: number): number =>
    clamp((Math.atan2(-(y - CY), -(x - CX)) * 180) / Math.PI, 0, 180);

  // Lean 1 sits at yTop, lean 0 at yBase — curve view only.
  const yTop = L.top;
  const yBase = 118;
  const yOf = (lean: number): number => yBase - lean * (yBase - yTop);

  /** Where a given angle's handle lives, in whichever view this is. */
  const spot = (deg: number, lean: number): [number, number] => {
    if (view === 'dial') return dialAt(deg);
    if (view === 'curve') return [xOf(deg), yOf(lean)];
    return [xOf(deg), L.top + L.track / 2];
  };

  // ---- the parts that get repainted ----------------------------------------

  const paints: Array<() => void> = [];

  if (view === 'dial') {
    el.appendChild(label(CX - R - 2, CY + 15, 10, DIM, 'middle')).textContent = '0°';
    el.appendChild(label(CX, CY - R - 12, 10, DIM, 'middle')).textContent = '90°';
    el.appendChild(label(CX + R + 4, CY + 15, 10, DIM, 'middle')).textContent = '180°';
  } else {
    for (const d of [0, 90, 180]) {
      const t = label(xOf(d), 14, 10, DIM, d === 0 ? 'start' : d === 180 ? 'end' : 'middle');
      t.textContent = `${d}°`;
      el.appendChild(t);
    }
  }

  if (view === 'bar' || view === 'dial') {
    // Both are the same idea drawn on a different line: the colour sampled all
    // the way along, so the gradient IS the setting rather than a picture of it.
    const SEGS = 84;
    const bits: SVGElement[] = [];
    if (view === 'bar') {
      const clipId = `bar${Math.random().toString(36).slice(2, 9)}`;
      const clip = svgEl('clipPath', { id: clipId });
      clip.appendChild(
        svgEl('rect', { x: PAD, y: L.top, width: span, height: L.track, rx: 7 }),
      );
      el.appendChild(clip);
      const g = svgEl('g', { 'clip-path': `url(#${clipId})` });
      for (let i = 0; i < SEGS; i++) {
        const r = svgEl('rect', {
          x: PAD + (span * i) / SEGS,
          y: L.top,
          width: span / SEGS + 1,
          height: L.track,
        });
        bits.push(r);
        g.appendChild(r);
      }
      el.appendChild(g);
    } else {
      for (let i = 0; i < SEGS; i++) {
        const [x0, y0] = dialAt((180 * i) / SEGS);
        const [x1, y1] = dialAt((180 * (i + 1)) / SEGS + 0.35);
        const p = svgEl('path', {
          d: `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
          fill: 'none',
          'stroke-width': 20,
        });
        bits.push(p);
        el.appendChild(p);
      }
    }
    paints.push(() => {
      bits.forEach((b, i) => {
        const c = tint(auto, (180 * (i + 0.5)) / SEGS);
        b.setAttribute('stroke', c);
        if (view === 'bar') b.setAttribute('fill', c);
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
    // Left-hand edge: the right is where the carry band and its grip sit, and
    // a word underneath a handle is a word nobody can read.
    const t1 = label(PAD, yTop - 5, 10, DIM, 'start');
    t1.textContent = 'square';
    el.appendChild(t1);
    const t0 = label(PAD, yBase + 13, 10, DIM, 'start');
    t0.textContent = 'bisector';
    el.appendChild(t0);
    const fill = svgEl('path', { fill: 'rgba(143,199,154,0.22)' });
    const line = svgEl('path', { fill: 'none', stroke: css(SQUARE), 'stroke-width': 2.2 });
    // Past the carry angle there is no fold to plot, so the plot says so
    // instead of drawing a zero that looks like a setting.
    const tail = svgEl('rect', { y: yTop - 6, height: yBase - yTop + 6, fill: 'rgba(201,168,106,0.16)' });
    el.appendChild(tail);
    el.appendChild(fill);
    el.appendChild(line);
    paints.push(() => {
      let d = '';
      for (let s = 0; s <= 180; s += 2) {
        d += `${d ? 'L' : 'M'}${xOf(s).toFixed(2)} ${yOf(autoLean(auto, s)).toFixed(2)}`;
      }
      line.setAttribute('d', d);
      fill.setAttribute('d', `${d}L${xOf(180)} ${yBase}L${xOf(0)} ${yBase}Z`);
      const c = bounds(auto)[2];
      tail.setAttribute('x', String(xOf(c)));
      tail.setAttribute('width', String(Math.max(0, xOf(180) - xOf(c))));
    });
  }

  const shellMark = svgEl('line', { 'stroke-width': 2, 'stroke-dasharray': '3 3' });
  // The band that is actually coming out flared, drawn where it is rather than
  // summarised by one angle somewhere else.
  const flareMark =
    view === 'dial'
      ? svgEl('path', { fill: 'none', stroke: BAD, 'stroke-width': 3.5 })
      : svgEl('rect', { height: 3.5, rx: 1.75, fill: BAD });
  const shellText = label(0, L.shell, 10.5, HOT);
  el.appendChild(shellMark);
  el.appendChild(flareMark);
  el.appendChild(shellText);

  const nowMark = svgEl('line', { stroke: HOT, 'stroke-width': 1.5, opacity: 0.6 });
  const nowDot = svgEl('circle', { r: 6, fill: HOT, stroke: '#141110', 'stroke-width': 1.5 });
  el.appendChild(nowMark);
  el.appendChild(nowDot);

  const grip = (): SVGElement => {
    const g =
      view === 'bar'
        ? svgEl('rect', { width: 9, height: L.track + 16, rx: 4.5, fill: INK })
        : svgEl('circle', { r: 7.5, fill: INK, stroke: '#141110', 'stroke-width': 2 });
    el.appendChild(g);
    return g;
  };
  const grips: Record<'lo' | 'hi' | 'carry', SVGElement> = {
    lo: grip(),
    hi: grip(),
    carry: grip(),
  };

  const summary = label(W / 2, L.sum, 11.5, DIM, 'middle');
  el.appendChild(summary);
  const readout = label(W / 2, L.now, 11.5, INK, 'middle', '700');
  el.appendChild(readout);

  const put = (g: SVGElement, deg: number, lean: number): void => {
    const [x, y] = spot(deg, lean);
    if (view === 'bar') {
      g.setAttribute('x', String(x - 4.5));
      g.setAttribute('y', String(y - (L.track + 16) / 2));
    } else {
      g.setAttribute('cx', String(x));
      g.setAttribute('cy', String(y));
    }
  };

  let shown = 0; // the separation last painted, so a drag knows what it is near

  const paint = (separation: number, step: number, width: number): void => {
    shown = separation;
    for (const p of paints) p();
    const [lo, hi, carry] = bounds(auto);
    const lean = autoLean(auto, separation);

    const shell = shellThreshold(step, width);
    const flare = flareBand(auto, step, width);
    if (view === 'dial') {
      const [ix, iy] = dialAt(Math.min(180, shell));
      shellMark.setAttribute('x1', String(ix));
      shellMark.setAttribute('y1', String(iy));
      shellMark.setAttribute('x2', String(CX + (ix - CX) * 1.18));
      shellMark.setAttribute('y2', String(CY + (iy - CY) * 1.18));
      shellText.setAttribute('x', String(W / 2));
      shellText.setAttribute('text-anchor', 'middle');
    } else {
      const sx = xOf(Math.min(180, shell));
      shellMark.setAttribute('x1', String(sx));
      shellMark.setAttribute('y1', String(view === 'curve' ? yTop - 8 : L.top - 5));
      shellMark.setAttribute('x2', String(sx));
      shellMark.setAttribute('y2', String(view === 'curve' ? yBase : L.top + L.track + 5));
      shellText.setAttribute('x', String(W / 2));
      shellText.setAttribute('text-anchor', 'middle');
    }
    // Naming the band is the whole use of the warning. "Not covered" says
    // something is wrong without saying what to drag or how far.
    shellText.textContent = flare
      ? `shell ${Math.round(shell)}° · flares ${flare.from}–${flare.to}°`
      : `shell ${Math.round(shell)}° · covered`;
    // Red only ever means a problem, so a cleared threshold goes quiet.
    shellText.setAttribute('fill', flare ? BAD : DIM);
    shellMark.setAttribute('stroke', flare ? BAD : DIM);
    flareMark.setAttribute('opacity', flare ? '1' : '0');
    if (flare) {
      if (view === 'dial') {
        const rr = R + 16;
        const arc = (d: number): [number, number] => {
          const t = (d * Math.PI) / 180;
          return [CX - rr * Math.cos(t), CY - rr * Math.sin(t)];
        };
        const [ax, ay] = arc(flare.from);
        const [bx, by] = arc(flare.to);
        flareMark.setAttribute(
          'd',
          `M${ax.toFixed(2)} ${ay.toFixed(2)} A${rr} ${rr} 0 0 1 ${bx.toFixed(2)} ${by.toFixed(2)}`,
        );
      } else {
        flareMark.setAttribute('x', String(xOf(flare.from)));
        flareMark.setAttribute('width', String(Math.max(2, xOf(flare.to) - xOf(flare.from))));
        flareMark.setAttribute('y', String(view === 'curve' ? yBase + 2 : L.top + L.track + 3));
      }
    }

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
      nowMark.setAttribute('y1', String(view === 'curve' ? yTop - 8 : L.top - 5));
      nowMark.setAttribute('x2', String(nx));
      nowMark.setAttribute('y2', String(view === 'curve' ? yBase : L.top + L.track + 5));
      nowDot.setAttribute('cx', String(nx));
      nowDot.setAttribute('cy', String(view === 'curve' ? yOf(lean) : L.top + L.track + 9));
    }

    put(grips.lo, lo, auto.cap);
    put(grips.hi, hi, auto.cap);
    put(grips.carry, carry, 0);

    summary.textContent = `square ${Math.round(lo)}–${Math.round(hi)}°  ·  carry on from ${Math.round(carry)}°`;
    readout.textContent = autoCarries(auto, separation)
      ? `now ${Math.round(separation)}° · carrying on`
      : `now ${Math.round(separation)}° · lean ${lean.toFixed(2)}`;
  };

  // ---- dragging ------------------------------------------------------------

  let held: Grab | null = null;
  const local = (e: PointerEvent): [number, number] => {
    const r = el.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };

  el.addEventListener('pointerdown', (e) => {
    const [x, y] = local(e);
    const deg = view === 'dial' ? dialDeg(x, y) : degOf(x);
    const [lo, hi, carry] = bounds(auto);
    // The separation marker wins when the pointer is close to it. Being able to
    // drag it here is the difference between a control that answers and one
    // that only records: an edit which leaves the lean where it was — a
    // shoulder moved to the far side of the separation, say — changes nothing
    // on screen and reads as a dead control, which is exactly what it is not.
    if (Math.abs(deg - shown) < 7) {
      held = 'now';
    } else if (view === 'curve' && deg > lo + 6 && deg < hi - 6) {
      // On the curve the influence is grabbed by the plateau itself: there is
      // nowhere else on that line to aim, so it needs no handle of its own.
      held = 'cap';
    } else {
      const near: Array<[Grab, number]> = [
        ['lo', Math.abs(deg - lo)],
        ['hi', Math.abs(deg - hi)],
        ['carry', Math.abs(deg - carry)],
      ];
      near.sort((p, q) => p[1] - q[1]);
      held = near[0][0];
    }
    el.setPointerCapture(e.pointerId);
    el.dispatchEvent(new PointerEvent('pointermove', e));
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    // A pointerup that never arrives — the pointer leaving on a dropped
    // capture, a button released off-window — would otherwise leave every later
    // hover silently editing. The capture is the authority, not the flag.
    if (held && !el.hasPointerCapture(e.pointerId)) held = null;
    if (!held) return;
    const [x, y] = local(e);
    if (held === 'now') {
      onSeparation(Math.round(view === 'dial' ? dialDeg(x, y) : degOf(x)));
      return;
    }
    if (held === 'cap') {
      auto.cap = clamp((yBase - y) / (yBase - yTop), 0, 1);
    } else {
      const deg = Math.round(view === 'dial' ? dialDeg(x, y) : degOf(x));
      // The three may meet but not cross: an order read back to front is a
      // curve nobody meant to draw.
      if (held === 'lo') auto.lo = Math.min(deg, auto.hi);
      else if (held === 'hi') auto.hi = clamp(deg, auto.lo, auto.carry);
      else auto.carry = Math.max(deg, auto.hi);
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
