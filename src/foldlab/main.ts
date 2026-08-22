// Fold Lab — /foldlab/. The studio's own scene and its own layer panel, asking
// the one question the studio has no word for yet: where does each layer REST?
//
// Two levels of a box stitch, drawn by the real renderer, beside a layer panel
// that prints — per layer — exactly what it rides OVER and what it ducks UNDER.
// Those facts are not re-derived here: `StrandScene.getCrossings()` reports what
// `weaveCenterlines` actually decided, so the list and the picture cannot drift
// apart. See docs/layer-levels.md for what a level is today, and
// mocks/foldlab/README.md for the three-plane proposal this page exists to test.
//
// ---- the three planes ------------------------------------------------------
// A storey is two thicknesses. Inside it a layer rests on one of three planes:
//
//     top     +1t      ── and level L's top IS level L+1's bottom
//     center   0t
//     bottom  -1t
//
// so the planes of consecutive storeys interlock rather than butt. That is the
// whole proposal, and it is `StrandScene.setSublevels` that realises it.
//
// ---- the C -----------------------------------------------------------------
// Where two strands are glued end to end the lace doubles back: a FOLD, and the
// C-shaped bight is what carries it from one plane to the other. The C has two
// arms and they belong to DIFFERENT layers — the upper arm to whichever strand
// rests higher, the lower arm to the other — so a fold is named by its two arms
// and each arm carries its own plane. The Folds section below is where they are
// set, and the crease then shows exactly the climb between them.

import '../styles.css';
import './foldlab.css';

import { collectJunctions } from '../model/connections';
import { levelAt } from '../model/levels';
import { boxStitchRounds } from '../model/samples';
import { StrandScene, type CrossingFact } from '../scene/StrandScene';
import type { RGBA, Scene3D } from '../model/types';

/** The three resting planes inside one storey, in thicknesses off its middle. */
const PLANES = [
  { id: 'bottom', at: -1, mark: '▼' },
  { id: 'center', at: 0, mark: '●' },
  { id: 'top', at: 1, mark: '▲' },
] as const;
type PlaneId = (typeof PLANES)[number]['id'];

/** How many rounds of box stitch to stand up. Two is the case being argued about. */
const ROUNDS = 2;

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLElement;

const view = new StrandScene(canvas);
const scene: Scene3D = boxStitchRounds(ROUNDS, `Box stitch — ${ROUNDS} levels`);
view.setScene(scene);

/** Which plane each strand is declared to rest on. */
const plane = new Map<string, PlaneId>(scene.strands.map((s) => [s.id, 'center']));
/** Off until asked for: with no declaration the page shows the studio's weave. */
let declared = false;

const at = (id: PlaneId): number => PLANES.find((p) => p.id === id)!.at;
const css = (c: RGBA): string => `rgb(${c.r} ${c.g} ${c.b})`;
const indexOfId = new Map(scene.strands.map((s, i) => [s.id, i]));

/** A strand's absolute height in thicknesses: its storey (two thicknesses) plus
 *  the plane it rests on inside it. Level L's top and level L+1's bottom both
 *  land on the same number, which is the interlock. */
const heightOf = (id: string): number =>
  levelAt(scene, indexOfId.get(id) ?? 0) * 2 + at(plane.get(id) ?? 'center');

function push(): void {
  view.setSublevels(declared ? new Map([...plane].map(([id, p]) => [id, at(p)])) : null);
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const crossingsOf = (index: number, facts: CrossingFact[]): CrossingFact[] =>
  facts.filter((f) => f.aIndex === index || f.bIndex === index);

/** The gap between two layers' declared planes, and what that gap means. */
function gapOf(a: number, b: number): { text: string; kind: string } {
  const d = Math.abs(a - b);
  if (d === 0) return { text: 'Δ0 same plane', kind: '0' };
  if (d === 1) return { text: 'Δ1 lying on', kind: '1' };
  if (d === 2) return { text: 'Δ2 daylight', kind: 'hole' };
  return { text: `Δ${d} a level clear`, kind: 'far' };
}

/** A plane chip. Pressing it cycles bottom → center → top and rebuilds. */
function chip(id: string): HTMLButtonElement {
  const b = el('button', 'plane');
  const paint = (p: PlaneId): void => {
    b.dataset.plane = p;
    b.textContent = `${PLANES.find((x) => x.id === p)!.mark}  ${p}`;
  };
  paint(plane.get(id) ?? 'center');
  b.addEventListener('click', () => {
    const now = PLANES.findIndex((x) => x.id === (plane.get(id) ?? 'center'));
    plane.set(id, PLANES[(now + 1) % PLANES.length].id);
    declared = true; // touching a chip is the act of declaring
    push();
    build();
  });
  return b;
}

/**
 * Read a plane assignment off the weave the renderer already resolved: whatever
 * a strand rides over more often than it ducks under goes to `top`, the reverse
 * to `bottom`, and a strand that crosses nothing stays on `center`.
 *
 * This is DERIVED, not invented — it is the over/under the scene already has,
 * restated as planes. It is a starting point to correct, not an answer.
 */
function fromTheWeave(facts: CrossingFact[]): void {
  scene.strands.forEach((s, i) => {
    let score = 0;
    for (const f of crossingsOf(i, facts)) {
      if (!f.woven) continue;
      score += f.overIndex === i ? 1 : -1;
    }
    plane.set(s.id, score > 0 ? 'top' : score < 0 ? 'bottom' : 'center');
  });
  declared = true;
}

function build(): void {
  const facts = view.getCrossings();
  panel.textContent = '';

  const bar = el('div', 'brandbar');
  const home = el('a', 'brand-home');
  home.setAttribute('href', '../app/');
  home.appendChild(el('span', undefined, 'Fold Lab'));
  bar.appendChild(home);
  panel.appendChild(bar);

  const stackbar = el('div', 'stackbar');
  stackbar.appendChild(el('span', 'stack-title', 'Layers'));

  const derive = el('button', 'pill');
  derive.textContent = declared ? 'Re-read weave' : 'Plane from weave';
  derive.addEventListener('click', () => {
    fromTheWeave(view.getCrossings());
    push();
    build();
  });
  stackbar.appendChild(derive);

  const copy = el('button', 'pill');
  copy.textContent = 'Copy';
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(asText(facts)).then(
      () => {
        copy.textContent = 'copied';
        setTimeout(() => (copy.textContent = 'Copy'), 1600);
      },
      () => (copy.textContent = 'blocked'),
    );
  });
  stackbar.appendChild(copy);
  panel.appendChild(stackbar);

  const stack = el('div', 'stack from-bottom');

  if (!declared) {
    const b = el('div', 'hint');
    b.appendChild(el('b', undefined, 'No planes declared yet. '));
    b.appendChild(
      document.createTextNode(
        'The canvas is showing the studio’s ordinary weave. Press a plane chip, ' +
          'or Plane from weave to start from the over/unders the scene already has.',
      ),
    );
    stack.appendChild(b);
  }

  // The studio builds its stack bottom-up — level 0's bar is the ground, and the
  // last thing in the panel. Same here, so the two panels read alike.
  const levels = new Map<number, number[]>();
  scene.strands.forEach((_, i) => {
    const l = levelAt(scene, i);
    if (!levels.has(l)) levels.set(l, []);
    levels.get(l)!.push(i);
  });

  for (const level of [...levels.keys()].sort((a, b) => b - a)) {
    const members = levels.get(level)!;
    const group = el('div', 'level-group');

    for (const i of [...members].reverse()) {
      const strand = scene.strands[i];
      const row = el('div', 'row');
      const sw = el('span', 'swatch');
      sw.style.background = css(strand.color);
      row.appendChild(sw);
      row.appendChild(el('span', 'row-name', strand.id));
      row.appendChild(chip(strand.id));
      group.appendChild(row);

      const mine = crossingsOf(i, facts);
      const ledger = el('div', 'ledger');
      if (mine.length === 0) ledger.appendChild(el('div', 'no-cross', 'crosses nothing'));
      for (const f of mine) {
        const otherId = f.aIndex === i ? f.bId : f.aId;
        const iAmOver = f.overIndex === i;
        const line = el('div', `cross ${f.woven ? (iAmOver ? 'over' : 'under') : 'clear'}`);
        line.appendChild(el('i', undefined, f.woven ? (iAmOver ? 'over' : 'under') : 'clear of'));
        line.appendChild(el('b', undefined, otherId));
        if (f.count > 1) line.appendChild(el('span', undefined, `×${f.count}`));
        if (f.masked) line.appendChild(el('span', 'masked', 'MASK'));
        const g = gapOf(heightOf(strand.id), heightOf(otherId));
        const gap = el('em', undefined, g.text);
        gap.dataset.gap = g.kind;
        line.appendChild(gap);
        ledger.appendChild(line);
      }
      group.appendChild(ledger);
    }

    stack.appendChild(group);

    const lb = el('div', 'level-bar');
    lb.appendChild(el('span', 'level-badge', String(level)));
    lb.appendChild(el('b', undefined, `Level ${level}`));
    lb.appendChild(
      el('small', undefined, `${members.length} layer${members.length === 1 ? '' : 's'}`),
    );
    stack.appendChild(lb);
  }

  stack.appendChild(foldsSection());

  const foot = el('div', 'foot');
  foot.appendChild(el('b', undefined, 'Over and under are read from the renderer. '));
  foot.appendChild(
    document.createTextNode(
      'Every OVER / UNDER above is what the scene actually decided at that ' +
        'crossing — a mask if one covers the pair, otherwise the higher layer. ' +
        'Planes are yours to set, and once any is set they drive the geometry: ' +
        'the runs go flat on their planes and each crease carries the climb ' +
        'between them.',
    ),
  );
  stack.appendChild(foot);

  panel.appendChild(stack);
}

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const n = document.createElementNS(SVG, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  return n;
};

/**
 * The fold, drawn side-on: two runs at their declared planes and the C that
 * carries the lace between them.
 *
 * This is the picture the whole page is about, so it is drawn from the SAME
 * numbers the renderer uses — `heightOf` — rather than sketched. The upper arm
 * is the run resting higher, the lower arm the other, and the bight's radius is
 * half the gap between them, which is what makes the turn a semicircle rather
 * than a crease with a cliff in it. A fold that climbs nothing collapses to the
 * strap's own half-width: the C pinches shut, and it should look wrong.
 */
function cShape(hiId: string, loId: string, colour: string): SVGElement {
  const W = 130, H = 86, MID = 43, PER_T = 14, STRAP = 13;
  const climb = Math.abs(heightOf(hiId) - heightOf(loId));
  const span = Math.min(climb * PER_T, 56);
  const yU = MID - span / 2;
  const yL = MID + span / 2;
  const r = Math.max(span / 2, STRAP / 2);
  const armEnd = 62;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'c-shape', role: 'img',
    'aria-label': `The fold: upper arm ${hiId}, lower arm ${loId}, climbing ${climb} thicknesses`,
  });

  for (const y of yU === yL ? [yU] : [yU, yL]) {
    svg.appendChild(svgEl('line', {
      x1: 0, y1: y, x2: W, y2: y,
      stroke: 'var(--line)', 'stroke-width': 1, 'stroke-dasharray': '4 4',
    }));
  }

  // The two runs, muted, so the C is what the eye lands on.
  for (const y of [yU, yL]) {
    svg.appendChild(svgEl('rect', {
      x: 6, y: y - STRAP / 2, width: armEnd - 6, height: STRAP,
      fill: 'var(--hover)', stroke: 'var(--line)', 'stroke-width': 1,
    }));
  }

  // The C: out along the upper run, round the bight, back along the lower one.
  svg.appendChild(svgEl('path', {
    d: `M ${armEnd} ${yU} H ${armEnd + 14} A ${r} ${r} 0 0 1 ${armEnd + 14} ${yL} H ${armEnd}`,
    fill: 'none', stroke: colour, 'stroke-width': STRAP, 'stroke-linecap': 'butt',
  }));
  svg.appendChild(svgEl('path', {
    d: `M ${armEnd} ${yU} H ${armEnd + 14} A ${r} ${r} 0 0 1 ${armEnd + 14} ${yL} H ${armEnd}`,
    fill: 'none', stroke: 'var(--paper)', 'stroke-width': 1, opacity: 0.55,
  }));

  return svg;
}

/** Every fold in the scene: the C, its two arms, and the climb it carries. */
function foldsSection(): HTMLElement {
  const wrap = el('div', 'folds');
  const head = el('div', 'folds-head');
  head.appendChild(el('b', undefined, 'Folds — the C shapes'));
  head.appendChild(
    el('small', undefined, 'upper arm and lower arm, each on its own plane'),
  );
  wrap.appendChild(head);

  const js = collectJunctions(scene);
  if (js.length === 0) {
    wrap.appendChild(el('div', 'no-cross', 'no folds in this scene'));
    return wrap;
  }

  for (const j of js) {
    const a = scene.strands[j.parentIndex];
    const b = scene.strands[j.childIndex];
    // Which arm is the UPPER one is a consequence of the planes, not a label:
    // whichever of the two currently rests higher is the top of the C.
    const [hi, lo] =
      heightOf(a.id) >= heightOf(b.id) ? [a, b] : [b, a];
    const climb = Math.abs(heightOf(hi.id) - heightOf(lo.id));

    const card = el('div', 'fold');
    const title = el('div', 'fold-title');
    title.appendChild(el('span', 'fold-c', 'C'));
    title.appendChild(el('b', undefined, `${a.id} → ${b.id}`));
    const cl = el('em', undefined, climb === 0 ? 'flat — no climb' : `climbs ${climb}.00 t`);
    cl.dataset.climb = climb === 0 ? 'none' : 'yes';
    title.appendChild(cl);
    card.appendChild(title);
    card.appendChild(cShape(hi.id, lo.id, css(hi.color)));

    for (const [label, strand] of [
      ['upper arm', hi],
      ['lower arm', lo],
    ] as const) {
      const arm = el('div', 'arm');
      arm.appendChild(el('i', undefined, label));
      const sw = el('span', 'swatch');
      sw.style.background = css(strand.color);
      arm.appendChild(sw);
      arm.appendChild(el('b', undefined, strand.id));
      arm.appendChild(el('span', 'lvl', `L${levelAt(scene, indexOfId.get(strand.id) ?? 0)}`));
      arm.appendChild(chip(strand.id));
      card.appendChild(arm);
    }

    wrap.appendChild(card);
  }
  return wrap;
}

/** The whole panel as plain text — the thing to paste back with corrections. */
function asText(facts: CrossingFact[]): string {
  const out: string[] = [
    `Fold Lab — box stitch, ${ROUNDS} rounds`,
    declared ? 'planes: declared' : 'planes: none declared (studio weave)',
    '',
    'LAYERS',
  ];
  for (let i = scene.strands.length - 1; i >= 0; i--) {
    const s = scene.strands[i];
    out.push(`L${levelAt(scene, i)}  ${s.id}  rests on ${plane.get(s.id)}`);
    for (const f of crossingsOf(i, facts)) {
      const otherId = f.aIndex === i ? f.bId : f.aId;
      const rel = f.woven ? (f.overIndex === i ? 'over ' : 'under') : 'clear';
      const g = gapOf(heightOf(s.id), heightOf(otherId));
      out.push(
        `      ${rel} ${otherId}${f.count > 1 ? ` x${f.count}` : ''}` +
          `${f.masked ? ' [mask]' : ''}  ${g.text}`,
      );
    }
  }
  out.push('', 'FOLDS (the C shapes)');
  for (const j of collectJunctions(scene)) {
    const a = scene.strands[j.parentIndex];
    const b = scene.strands[j.childIndex];
    const [hi, lo] = heightOf(a.id) >= heightOf(b.id) ? [a, b] : [b, a];
    out.push(`C ${a.id} -> ${b.id}   climbs ${Math.abs(heightOf(hi.id) - heightOf(lo.id))}.00 t`);
    out.push(`      upper arm  ${hi.id}  ${plane.get(hi.id)}`);
    out.push(`      lower arm  ${lo.id}  ${plane.get(lo.id)}`);
  }
  return out.join('\n');
}

push();
build();

view.setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

if (import.meta.env.DEV) {
  (window as unknown as { __foldlab?: unknown }).__foldlab = { view, scene, plane };
}
