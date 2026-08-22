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
// What is REAL on this page: the geometry, the colours, the over/unders, the
// storeys, and the gaps between planes once you assign them. What is a PROPOSAL:
// the plane assignment itself — the engine has no notion of a sublevel yet, so
// setting a chip changes what this page reports, not what the renderer draws.
// The page says so in the note under the stack rather than letting it be guessed.

import '../styles.css';
import './foldlab.css';

import { boxStitchRounds } from '../model/samples';
import { levelAt } from '../model/levels';
import { StrandScene, type CrossingFact } from '../scene/StrandScene';
import type { RGBA, Scene3D } from '../model/types';

/** The three resting planes inside one level, low to high. */
const PLANES = ['bottom', 'center', 'top'] as const;
type Plane = (typeof PLANES)[number];

/** How many rounds of box stitch to stand up. Two is the case being argued about. */
const ROUNDS = 2;

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLElement;

const view = new StrandScene(canvas);
const scene: Scene3D = boxStitchRounds(ROUNDS, `Box stitch — ${ROUNDS} levels`);
view.setScene(scene);

// Which plane each strand is declared to rest on. Everything starts on `center`
// — the honest default, because nothing has been decided yet, and a page that
// opened with a full assignment would be presenting a guess as a finding.
const restingPlane = new Map<string, Plane>(scene.strands.map((s) => [s.id, 'center']));

const css = (c: RGBA): string => `rgb(${c.r} ${c.g} ${c.b})`;

/** A strand's absolute plane index: its storey times the level pitch, plus the
 *  plane it rests on within that storey. Two levels share a plane, which is the
 *  proposal — so the pitch is two planes, not three. */
const planeIndex = (index: number, id: string): number =>
  levelAt(scene, index) * 2 + PLANES.indexOf(restingPlane.get(id) ?? 'center');

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

/** Every crossing a given strand takes part in, from the weave's own report. */
function crossingsOf(index: number, facts: CrossingFact[]): CrossingFact[] {
  return facts.filter((f) => f.aIndex === index || f.bIndex === index);
}

/** The gap between two layers' declared planes, and what that gap means. */
function gapOf(mine: number, theirs: number): { text: string; kind: string } {
  const d = Math.abs(mine - theirs);
  if (d === 0) return { text: 'Δ0 same plane', kind: '0' };
  if (d === 1) return { text: 'Δ1 lying on', kind: '1' };
  if (d === 2) return { text: 'Δ2 daylight', kind: 'hole' };
  return { text: `Δ${d} a level clear`, kind: 'far' };
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
  const copied = el('span', 'copied');
  const copy = el('button', 'pill');
  copy.textContent = 'Copy ledger';
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(asText(facts)).then(
      () => {
        copied.textContent = 'copied';
        setTimeout(() => (copied.textContent = ''), 1600);
      },
      () => (copied.textContent = 'blocked'),
    );
  });
  stackbar.appendChild(copied);
  stackbar.appendChild(copy);
  panel.appendChild(stackbar);

  const stack = el('div', 'stack from-bottom');

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

    // Within a storey the panel still reads top-of-stack first.
    for (const i of [...members].reverse()) {
      const strand = scene.strands[i];
      const row = el('div', 'row');
      const sw = el('span', 'swatch');
      sw.style.background = css(strand.color);
      row.appendChild(sw);
      row.appendChild(el('span', 'row-name', strand.id));

      const plane = el('button', 'plane');
      const setPlane = (p: Plane): void => {
        restingPlane.set(strand.id, p);
        plane.dataset.plane = p;
        plane.textContent = (p === 'top' ? '▲ ' : p === 'bottom' ? '▼ ' : '● ') + p;
      };
      setPlane(restingPlane.get(strand.id) ?? 'center');
      plane.addEventListener('click', () => {
        const next = PLANES[(PLANES.indexOf(restingPlane.get(strand.id) ?? 'center') + 1) % 3];
        setPlane(next);
        build(); // every gap in the panel depends on this one value
      });
      row.appendChild(plane);
      group.appendChild(row);

      const mine = crossingsOf(i, facts);
      const ledger = el('div', 'ledger');
      if (mine.length === 0) {
        ledger.appendChild(el('div', 'no-cross', 'crosses nothing'));
      }
      for (const f of mine) {
        const otherIndex = f.aIndex === i ? f.bIndex : f.aIndex;
        const otherId = f.aIndex === i ? f.bId : f.aId;
        const iAmOver = f.overIndex === i;
        const line = el('div', `cross ${f.woven ? (iAmOver ? 'over' : 'under') : 'clear'}`);
        line.appendChild(
          el('i', undefined, f.woven ? (iAmOver ? 'over' : 'under') : 'clear of'),
        );
        line.appendChild(el('b', undefined, otherId));
        if (f.count > 1) line.appendChild(el('span', undefined, `×${f.count}`));
        if (f.masked) line.appendChild(el('span', 'masked', 'MASK'));
        const g = gapOf(planeIndex(i, strand.id), planeIndex(otherIndex, otherId));
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

  const foot = el('div', 'foot');
  foot.appendChild(
    el('b', undefined, 'Over and under are real; the planes are the proposal. '),
  );
  foot.appendChild(
    document.createTextNode(
      'Every OVER / UNDER above is what the renderer actually decided at that ' +
        'crossing — a mask if one covers the pair, otherwise the higher layer. ' +
        'The plane chips are not implemented in the engine: pressing one changes ' +
        'what this panel reports, not what the canvas draws. Set them to what you ' +
        'want, then Copy ledger.',
    ),
  );
  stack.appendChild(foot);

  panel.appendChild(stack);
}

/** The whole panel as plain text — the thing to paste back with corrections. */
function asText(facts: CrossingFact[]): string {
  const out: string[] = [`Fold Lab — box stitch, ${ROUNDS} rounds`, ''];
  for (let i = scene.strands.length - 1; i >= 0; i--) {
    const s = scene.strands[i];
    const level = levelAt(scene, i);
    out.push(`L${level}  ${s.id}  rests on ${restingPlane.get(s.id)}`);
    for (const f of crossingsOf(i, facts)) {
      const otherIndex = f.aIndex === i ? f.bIndex : f.aIndex;
      const otherId = f.aIndex === i ? f.bId : f.aId;
      const rel = f.woven ? (f.overIndex === i ? 'over ' : 'under') : 'clear';
      const g = gapOf(planeIndex(i, s.id), planeIndex(otherIndex, otherId));
      out.push(
        `      ${rel} ${otherId}${f.count > 1 ? ` x${f.count}` : ''}` +
          `${f.masked ? ' [mask]' : ''}  ${g.text}`,
      );
    }
  }
  return out.join('\n');
}

build();

// Follow the theme the same way the studio does, so the canvas never stays cream
// under a dark panel.
const theme = (): 'light' | 'dark' =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
view.setTheme(theme());

if (import.meta.env.DEV) {
  (window as unknown as { __foldlab?: unknown }).__foldlab = { view, scene, restingPlane };
}
