// Fold Lab — /foldlab/. The studio's own scene and its own layer panel, asking
// the one question the studio has no word for yet: where does each layer REST?
//
// ---- the three planes ------------------------------------------------------
// A storey is two thicknesses. Inside it a layer rests on one of three planes:
//
//     top     +1t      ── and level L's top IS level L+1's bottom
//     center   0t
//     bottom  -1t
//
// so the planes of consecutive storeys interlock rather than butt. That is the
// proposal, and `StrandScene.setSublevels` realises it.
//
// ---- the C -----------------------------------------------------------------
// Where two strands are glued end to end the lace doubles back: a FOLD, and the
// C-shaped bight carries it from one plane to the other. The C has two arms and
// they belong to DIFFERENT layers — the upper arm to whichever strand rests
// higher — so each arm carries its own plane. Which of the Z lab's three turns
// it is comes from the separation between the arms; see src/geometry/zturn.ts.
//
// ---- the panel -------------------------------------------------------------
// One card per layer, holding everything about that layer: where it rests, what
// it crosses and how it stands to each of those, and every fold it takes part in
// drawn in side elevation against the planes themselves. A layer's details used
// to be split between a stack row and a separate folds section, which meant
// answering one question about one layer took two places and a scroll.

import '../styles.css';
import './foldlab.css';

import { collectJunctions } from '../model/connections';
import { levelAt } from '../model/levels';
import { boxStitchRounds } from '../model/samples';
import { separationOf, turnMode } from '../geometry/zturn';
import { StrandScene, type CrossingFact } from '../scene/StrandScene';
import type { Point, RGBA, Scene3D, Strand3D } from '../model/types';

/** The three resting planes inside one storey, in thicknesses off its middle. */
const PLANES = [
  { id: 'bottom', at: -1, mark: '▼' },
  { id: 'center', at: 0, mark: '●' },
  { id: 'top', at: 1, mark: '▲' },
] as const;
type PlaneId = (typeof PLANES)[number]['id'];

/** How many rounds of box stitch to stand up. Two is the case being argued about. */
const ROUNDS = 2;
/** Level pitch in planes: two, which is what makes a level's top the next's bottom. */
const PITCH = 2;

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLElement;

const view = new StrandScene(canvas);
const scene: Scene3D = boxStitchRounds(ROUNDS, `Box stitch — ${ROUNDS} levels`);
view.setScene(scene);

interface Rest {
  /** The plane the run rests on where it leaves its fold. */
  in: PlaneId;
  /** …and the plane it settles onto AFTER the C. Usually the same. */
  out: PlaneId;
}
/**
 * The assignment the page opens on.
 *
 * This is not a guess and not a derivation — it is the author's own sheet, handed
 * back and kept, so the page opens where the work left off instead of on a blank
 * one that has to be pasted in every reload. Anything not listed falls back to
 * `center`, and nothing here is load-bearing: every value is a chip away, and
 * `Plane from weave` still overwrites the lot.
 *
 * `out` is the plane the run settles onto AFTER its C. None is set here, so each
 * run rests at one height for its whole length — which is what the sheet said.
 */
const OPENING: Record<string, PlaneId> = {
  '1_5': 'top',
  '2_5': 'top',
  '1_4': 'top',
  '2_4': 'bottom',
  '2_3': 'top',
  '1_3': 'bottom',
  '2_2': 'bottom',
  '1_2': 'bottom',
  '2_1': 'bottom',
  '1_1': 'bottom',
};

const plane = new Map<string, Rest>(
  scene.strands.map((s) => {
    const p = OPENING[s.id] ?? 'center';
    return [s.id, { in: p, out: p }];
  }),
);
const open = new Set<string>();
let declared = true;
let scrollKeep = 0;
let selected: string | null = null;
let pasting = false;
let pasteNote = '';

/** Select a layer from either end — a click in the canvas or a card in the panel.
 *  The 3D lights it and the panel opens it and scrolls to it, so the two views
 *  never disagree about which layer is being talked about. */
function selectLayer(id: string | null, fromCanvas = false): void {
  selected = id;
  view.selectStrand(id);
  if (id) open.add(id);
  build();
  if (id && fromCanvas) {
    document.querySelector(`[data-layer="${id}"]`)?.scrollIntoView({ block: 'center' });
  }
}

const at = (id: PlaneId): number => PLANES.find((p) => p.id === id)!.at;
const css = (c: RGBA): string => `rgb(${c.r} ${c.g} ${c.b})`;
const indexOfId = new Map(scene.strands.map((s, i) => [s.id, i]));
const levelOf = (id: string): number => levelAt(scene, indexOfId.get(id) ?? 0);

/** A layer's absolute height in thicknesses: its storey, plus its plane inside it. */
const restOf = (id: string): Rest => plane.get(id) ?? { in: 'center', out: 'center' };
/** A layer's height in thicknesses, at either end of its run. */
const heightOf = (id: string, end: 'in' | 'out' = 'in'): number =>
  levelOf(id) * PITCH + at(restOf(id)[end]);

function push(): void {
  view.setSublevels(
    declared
      ? new Map([...plane].map(([id, p]) => [id, { in: at(p.in), out: at(p.out) }]))
      : null,
  );
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

const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag: string, attrs: Record<string, string | number>, text?: string): SVGElement => {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  if (text !== undefined) n.textContent = text;
  return n;
};

const crossingsOf = (index: number, facts: CrossingFact[]): CrossingFact[] =>
  facts.filter((f) => f.aIndex === index || f.bIndex === index);

function gapOf(a: number, b: number): { text: string; kind: string } {
  const d = Math.abs(a - b);
  if (d === 0) return { text: 'Δ0 same plane', kind: '0' };
  if (d === 1) return { text: 'Δ1 lying on', kind: '1' };
  if (d === 2) return { text: 'Δ2 daylight', kind: 'hole' };
  return { text: `Δ${d} a level clear`, kind: 'far' };
}

/** Every fold, with its two arms already sorted by which rests higher. */
interface FoldRow {
  a: Strand3D;
  b: Strand3D;
  hi: Strand3D;
  lo: Strand3D;
  climb: number;
  sep: number;
  mode: string;
}

function foldRows(): FoldRow[] {
  const arrive = (st: Strand3D, side: 0 | 1): Point => {
    const from = side === 0 ? st.end : st.start;
    const to = side === 0 ? st.start : st.end;
    return { x: to.x - from.x, y: to.y - from.y };
  };
  const leave = (st: Strand3D, side: 0 | 1): Point => {
    const from = side === 0 ? st.start : st.end;
    const to = side === 0 ? st.end : st.start;
    return { x: to.x - from.x, y: to.y - from.y };
  };
  return collectJunctions(scene).map((j) => {
    const a = scene.strands[j.parentIndex];
    const b = scene.strands[j.childIndex];
    const [hi, lo] = heightOf(a.id) >= heightOf(b.id) ? [a, b] : [b, a];
    // Separation is between the heading ARRIVING at the joint and the one
    // LEAVING it, so the two arms are read in opposite senses.
    const sep = separationOf(arrive(a, j.parentSide), leave(b, j.childSide));
    return {
      a, b, hi, lo,
      climb: Math.abs(heightOf(hi.id) - heightOf(lo.id)),
      sep,
      mode: turnMode(sep),
    };
  });
}

/**
 * This layer in SIDE ELEVATION, drawn from the geometry the renderer actually
 * built — not a schematic of a C.
 *
 * A stylised C could show the turn and nothing else, so it could not answer the
 * question that matters once a run has two planes: what does this layer do AFTER
 * the C? Here the lace's own woven centreline is plotted, height against distance
 * travelled, with the stretch belonging to THIS layer drawn solid and the rest of
 * its lace ghosted. The turn appears as what it is — a climb partway along —
 * rather than as an icon, and the run after it is right there to read.
 *
 * The horizontal rules are the planes, stepped a thickness apart off this
 * layer's own resting height and named by the level and plane they belong to.
 */
function sideView(id: string, colour: string): SVGElement | null {
  const i = indexOfId.get(id);
  if (i === undefined) return null;
  const lace = view.laceCenterlines.find((l) => l.chain.includes(i));
  const own = view.getStrandCentrelineWorld(id);
  const rest = view.getRestingWorld(id);
  const t = view.getThicknessWorld();
  if (!lace || !own || own.length < 2 || !rest || !(t > 0)) return null;

  const W = 320, H = 168, PADX = 8, PADT = 16, PADB = 14, LABEL = 150;
  const line = lace.line;

  // Distance travelled along the lace, which is the honest x-axis for an
  // elevation: the C doubles back in plan, and plotting against a straight axis
  // would fold the turn on top of itself.
  const cum: number[] = [0];
  for (let k = 1; k < line.length; k++) {
    cum.push(cum[k - 1] + Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y));
  }
  const total = cum[cum.length - 1] || 1;

  const nearest = (q: { x: number; y: number }): number => {
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k < line.length; k++) {
      const d = (line[k].x - q.x) ** 2 + (line[k].y - q.y) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  };
  const a = nearest(own[0]);
  const b = nearest(own[own.length - 1]);
  const from = Math.min(a, b);
  const to = Math.max(a, b);

  // The x-window is THIS LAYER plus a margin, not the whole lace. Scaled to the
  // lace, a single arm of a five-arm stitch is a few pixels wide and the drawing
  // stops being about the layer whose card it is on; the margin is what keeps the
  // fold at either end of it in view.
  const margin = Math.max((cum[to] - cum[from]) * 0.35, total * 0.02);
  const x0 = Math.max(0, cum[from] - margin);
  const x1 = Math.min(total, cum[to] + margin);
  let wLo = 0;
  let wHi = line.length - 1;
  while (wLo < from && cum[wLo] < x0) wLo++;
  while (wHi > to && cum[wHi] > x1) wHi--;

  let zLo = Infinity;
  let zHi = -Infinity;
  for (let k = wLo; k <= wHi; k++) { zLo = Math.min(zLo, line[k].z); zHi = Math.max(zHi, line[k].z); }
  const pad = Math.max(t * 0.9, (zHi - zLo) * 0.12);
  zLo -= pad;
  zHi += pad;

  const span = x1 - x0 || 1;
  const X = (k: number): number => PADX + ((cum[k] - x0) / span) * (LABEL - PADX - 4);
  const Y = (z: number): number => PADT + ((zHi - z) / (zHi - zLo || 1)) * (H - PADT - PADB);

  const svg = sv('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'side', role: 'img',
    'aria-label': `${id} in side elevation: height against distance along its lace`,
  });

  // The planes, stepped off this layer's own resting height.
  const abs = levelOf(id) * PITCH + at(restOf(id).in);
  for (let k = -4; k <= 4; k++) {
    const z = rest.in + k * t;
    if (z < zLo || z > zHi) continue;
    const names: string[] = [];
    for (let l = 0; l < ROUNDS; l++) {
      const q = PLANES.find((x) => x.at === abs + k - l * PITCH);
      if (q) names.push(`L${l} ${q.id}`);
    }
    const mine = k === 0 || abs + k === heightOf(id, 'out');
    svg.appendChild(sv('line', {
      x1: 0, y1: Y(z), x2: LABEL - 2, y2: Y(z),
      stroke: mine ? 'var(--edge2)' : 'var(--line)',
      'stroke-width': mine ? 1.3 : 1,
      'stroke-dasharray': mine ? '0' : '3 4',
      opacity: mine ? 0.9 : 0.5,
    }));
    if (names.length) {
      svg.appendChild(sv('text', { x: LABEL + 4, y: Y(z) + 3.4, class: mine ? 'pl on' : 'pl' },
        names.join(' = ')));
    }
  }

  const path = (lo: number, hi: number): string =>
    line.slice(lo, hi + 1).map((q, n) => `${n ? 'L' : 'M'} ${X(lo + n).toFixed(2)} ${Y(q.z).toFixed(2)}`).join(' ');

  // The rest of the lace, ghosted, so this layer is read in its own context.
  svg.appendChild(sv('path', { d: path(wLo, wHi), fill: 'none',
    stroke: 'var(--line)', 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0.5 }));
  // This layer, at the lace's real thickness.
  svg.appendChild(sv('path', { d: path(from, to), fill: 'none', stroke: colour,
    'stroke-width': 7, 'stroke-linecap': 'round' }));
  svg.appendChild(sv('path', { d: path(from, to), fill: 'none', stroke: 'var(--edge2)',
    'stroke-width': 1, opacity: 0.5 }));

  svg.appendChild(sv('text', { x: X(from) + 2, y: Y(line[from].z) - 7, class: 'arm-id' }, id));
  return svg;
}

/** A plane chip for one END of a run. Cycles bottom → center → top. */
function chip(id: string, end: 'in' | 'out', small = false): HTMLButtonElement {
  const b = el('button', small ? 'plane sm' : 'plane');
  const p = restOf(id)[end];
  b.dataset.plane = p;
  b.textContent = `${PLANES.find((x) => x.id === p)!.mark}  ${p}`;
  b.title = end === 'in' ? 'Where this run rests' : 'Where it settles after the C';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const cur = restOf(id);
    const next = PLANES[(PLANES.findIndex((x) => x.id === cur[end]) + 1) % PLANES.length].id;
    plane.set(id, { ...cur, [end]: next });
    declared = true;
    push();
    build();
  });
  return b;
}

/** Read a plane assignment off the weave the renderer already resolved. */
function fromTheWeave(facts: CrossingFact[]): void {
  scene.strands.forEach((s, i) => {
    let score = 0;
    for (const f of crossingsOf(i, facts)) {
      if (!f.woven) continue;
      score += f.overIndex === i ? 1 : -1;
    }
    const p: PlaneId = score > 0 ? 'top' : score < 0 ? 'bottom' : 'center';
    plane.set(s.id, { in: p, out: p });
  });
  declared = true;
}

/**
 * Adopt a plane assignment from text — the other half of Copy.
 *
 * Reads the ledger's own `L1  1_5  rests on center` lines, so whatever Copy
 * produced can go straight back in. It also takes the short form `1_5 top`, one
 * per line, because the useful thing to hand back is usually a handful of
 * corrections rather than the whole sheet — and anything it does not recognise is
 * ignored rather than guessed at, with a count reported so a typo cannot pass for
 * a setting silently.
 *
 * Only the resting planes are read. Everything else in the sheet — the crossings,
 * the folds, the gaps — is DERIVED from those planes and the scene, so taking it
 * as input would let the page assert something the geometry disagreed with.
 */
function applyLedger(text: string): { applied: number; unknown: string[]; skipped: number } {
  const known = new Map(scene.strands.map((st) => [st.id.toLowerCase(), st.id]));
  const planeOf = (w: string): PlaneId | null =>
    (PLANES.find((q) => q.id === w.toLowerCase())?.id as PlaneId | undefined) ?? null;

  const next = new Map(plane);
  const unknown: string[] = [];
  let applied = 0;
  let skipped = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let id: string | undefined;
    let p: PlaneId | null = null;

    const full = /^L\d+\s+(\S+)\s+rests\s+on\s+(\w+)/i.exec(line);
    const short = /^(\S+)\s*[:=]?\s*(bottom|center|centre|top)\b/i.exec(line);
    if (full) {
      id = known.get(full[1].toLowerCase());
      p = planeOf(full[2] === 'centre' ? 'center' : full[2]);
      if (!id) unknown.push(full[1]);
    } else if (short) {
      id = known.get(short[1].toLowerCase());
      p = planeOf(short[2].toLowerCase() === 'centre' ? 'center' : short[2]);
      if (!id) unknown.push(short[1]);
    } else {
      skipped++;
      continue;
    }
    if (!id || !p) continue;
    // A second plane after the arrow, when given: `1_5 top -> bottom`.
    const after = /(?:->|→|,\s*after(?:\s+the)?\s+C:?)\s*(bottom|center|centre|top)/i.exec(line);
    const q = after ? planeOf(after[1].toLowerCase() === 'centre' ? 'center' : after[1]) : null;
    next.set(id, { in: p, out: q ?? p });
    applied++;
  }

  if (applied > 0) {
    for (const [k, v] of next) plane.set(k, v);
    declared = true;
  }
  return { applied, unknown, skipped };
}

/** One layer, whole: where it rests, what it crosses, and every fold it is in. */
function layerCard(i: number, facts: CrossingFact[], folds: FoldRow[]): HTMLElement {
  const s = scene.strands[i];
  const isOpen = open.has(s.id);
  const mine = crossingsOf(i, facts);
  const myFolds = folds.filter((f) => f.a.id === s.id || f.b.id === s.id);
  const faults = mine.filter((f) => {
    const otherId = f.aIndex === i ? f.bId : f.aId;
    return Math.abs(heightOf(s.id) - heightOf(otherId)) !== 1;
  }).length;

  const card = el(
    'div',
    `layer${isOpen ? ' open' : ''}${faults ? ' warn' : ''}${selected === s.id ? ' sel' : ''}`,
  );
  card.dataset.layer = s.id;

  const head = el('button', 'layer-head');
  head.setAttribute('aria-expanded', String(isOpen));
  head.addEventListener('click', () => {
    if (isOpen && selected === s.id) {
      open.delete(s.id);
      selectLayer(null);
      return;
    }
    selectLayer(s.id);
  });
  const caret = el('span', 'caret', isOpen ? '▾' : '▸');
  head.appendChild(caret);
  const swatch = el('span', 'swatch');
  swatch.style.background = css(s.color);
  head.appendChild(swatch);
  head.appendChild(el('span', 'row-name', s.id));
  head.appendChild(el('span', 'lvl', `L${levelOf(s.id)}`));
  card.appendChild(head);

  const chipWrap = el('span', 'head-chip');
  chipWrap.appendChild(chip(s.id, 'in'));
  head.appendChild(chipWrap);

  // Collapsed, the one line that matters: is this layer sitting right?
  const sum = el('div', 'layer-sum');
  sum.appendChild(
    el('span', undefined,
      `${mine.length} crossing${mine.length === 1 ? '' : 's'} · ` +
      `${myFolds.length} fold${myFolds.length === 1 ? '' : 's'}`),
  );
  const ramped = restOf(s.id).in !== restOf(s.id).out;
  const verdict = el('span', faults ? 'bad' : 'good',
    (faults ? `${faults} not Δ1` : 'all Δ1') + (ramped ? ' at the start' : ''));
  sum.appendChild(verdict);
  card.appendChild(sum);

  if (!isOpen) return card;

  const body = el('div', 'layer-body');

  body.appendChild(el('h4', undefined, 'This layer, side on'));
  const drawing = sideView(s.id, css(s.color));
  if (drawing) body.appendChild(drawing);
  else body.appendChild(el('div', 'no-cross', 'not built yet'));

  const after = el('div', 'arm');
  after.appendChild(el('i', undefined, 'after C'));
  after.appendChild(el('b', undefined, 'settles on'));
  after.appendChild(chip(s.id, 'out', true));
  body.appendChild(after);

  if (mine.length) {
    body.appendChild(el('h4', undefined, 'Crossings'));
    for (const f of mine) {
      const otherId = f.aIndex === i ? f.bId : f.aId;
      const iAmOver = f.overIndex === i;
      const line = el('div', `cross ${f.woven ? (iAmOver ? 'over' : 'under') : 'clear'}`);
      line.appendChild(el('i', undefined, f.woven ? (iAmOver ? 'over' : 'under') : 'clear of'));
      line.appendChild(el('b', undefined, otherId));
      if (f.count > 1) line.appendChild(el('span', undefined, `×${f.count}`));
      if (f.masked) line.appendChild(el('span', 'masked', 'MASK'));
      const g = gapOf(heightOf(s.id), heightOf(otherId));
      // Read at the START of both runs. Once either of them settles onto a second
      // plane after its C, its height depends on WHERE along the run the crossing
      // falls, and this number no longer covers it — so it says so rather than
      // quietly reporting one end as though it were the whole run.
      const ramped = restOf(s.id).in !== restOf(s.id).out
        || restOf(otherId).in !== restOf(otherId).out;
      const gap = el('em', undefined, ramped ? `${g.text} at the start` : g.text);
      gap.dataset.gap = ramped ? 'part' : g.kind;
      if (ramped) gap.title = 'One of these runs changes plane after its C; this is read where the runs begin.';
      line.appendChild(gap);
      body.appendChild(line);
    }
  } else {
    body.appendChild(el('div', 'no-cross', 'crosses nothing'));
  }

  for (const f of myFolds) {
    const other = f.a.id === s.id ? f.b : f.a;
    const thisIsUpper = f.hi.id === s.id;
    body.appendChild(el('h4', undefined, `Fold — with ${other.id}`));

    const meta = el('div', 'zrow');
    const tag = el('span', 'mode', f.mode);
    tag.dataset.mode = f.mode;
    meta.appendChild(tag);
    meta.appendChild(el('span', undefined, `separation ${f.sep.toFixed(0)}°`));
    const cl = el('em', undefined, f.climb === 0 ? 'no climb' : `climbs ${f.climb}.00 t`);
    cl.dataset.climb = f.climb === 0 ? 'none' : 'yes';
    meta.appendChild(cl);
    body.appendChild(meta);



    for (const [role, st] of [
      ['upper arm', f.hi],
      ['lower arm', f.lo],
    ] as const) {
      const arm = el('div', `arm${st.id === s.id ? ' self' : ''}`);
      arm.appendChild(el('i', undefined, role));
      arm.appendChild(el('b', undefined, st.id === s.id ? `${st.id} (this)` : st.id));
      arm.appendChild(el('span', 'lvl', `L${levelOf(st.id)}`));
      arm.appendChild(chip(st.id, 'in', true));
      body.appendChild(arm);
    }
    if (thisIsUpper) body.appendChild(el('div', 'hintline', 'This layer is the TOP of the C.'));
    else body.appendChild(el('div', 'hintline', 'This layer is the BOTTOM of the C.'));
  }

  card.appendChild(body);
  return card;
}

function build(): void {
  const facts = view.getCrossings();
  const folds = foldRows();
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

  const all = el('button', 'pill square');
  const everyOpen = open.size === scene.strands.length;
  all.textContent = everyOpen ? '⊖' : '⊕';
  all.title = everyOpen ? 'Collapse every layer' : 'Expand every layer';
  all.addEventListener('click', () => {
    if (everyOpen) open.clear();
    else scene.strands.forEach((s) => open.add(s.id));
    build();
  });
  stackbar.appendChild(all);

  const paste = el('button', 'pill square');
  paste.textContent = '⇩';
  paste.title = 'Paste an assignment back in';
  paste.addEventListener('click', () => {
    pasting = true;
    pasteNote = '';
    build();
  });
  stackbar.appendChild(paste);

  const copy = el('button', 'pill square');
  copy.textContent = '⧉';
  copy.title = 'Copy the whole assignment as text';
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(asText(facts, folds)).then(
      () => {
        copy.textContent = '✓';
        setTimeout(() => (copy.textContent = '⧉'), 1400);
      },
      () => (copy.textContent = '✕'),
    );
  });
  stackbar.appendChild(copy);
  panel.appendChild(stackbar);

  const stack = el('div', 'stack from-bottom');
  stack.addEventListener('scroll', () => (scrollKeep = stack.scrollTop));

  if (pasting) {
    const sheet = el('div', 'paste');
    sheet.appendChild(el('h4', undefined, 'Paste an assignment'));
    sheet.appendChild(
      el('p', undefined,
        'The ledger from Copy goes straight back in. Or one per line: 1_5 top'),
    );
    const ta = el('textarea');
    ta.setAttribute('rows', '8');
    ta.setAttribute('spellcheck', 'false');
    ta.placeholder = 'L1  1_5  rests on center\n2_4 bottom';
    sheet.appendChild(ta);
    if (pasteNote) sheet.appendChild(el('p', 'note', pasteNote));
    const row = el('div', 'pill-row');
    const apply = el('button', 'pill coral');
    apply.textContent = 'Apply';
    apply.addEventListener('click', () => {
      const r = applyLedger(ta.value);
      pasteNote = r.applied
        ? `Set ${r.applied} layer${r.applied === 1 ? '' : 's'}.` +
          (r.unknown.length ? ` Not in this scene: ${r.unknown.join(', ')}.` : '')
        : `Nothing recognised in ${r.skipped} line${r.skipped === 1 ? '' : 's'}.` +
          (r.unknown.length ? ` Not in this scene: ${r.unknown.join(', ')}.` : '');
      if (r.applied) pasting = false;
      push();
      build();
    });
    const cancel = el('button', 'pill ghost');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      pasting = false;
      pasteNote = '';
      build();
    });
    row.appendChild(apply);
    row.appendChild(cancel);
    sheet.appendChild(row);
    stack.appendChild(sheet);
    panel.appendChild(stack);
    ta.focus();
    return;
  }

  if (pasteNote) {
    const n = el('div', 'hint');
    n.appendChild(el('b', undefined, 'Pasted. '));
    n.appendChild(document.createTextNode(pasteNote));
    stack.appendChild(n);
  }

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

  const levels = new Map<number, number[]>();
  scene.strands.forEach((_, i) => {
    const l = levelAt(scene, i);
    if (!levels.has(l)) levels.set(l, []);
    levels.get(l)!.push(i);
  });

  for (const level of [...levels.keys()].sort((a, b) => b - a)) {
    const members = levels.get(level)!;
    const group = el('div', 'level-group');
    for (const i of [...members].reverse()) group.appendChild(layerCard(i, facts, folds));
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
  foot.appendChild(el('b', undefined, 'Over and under are read from the renderer. '));
  foot.appendChild(
    document.createTextNode(
      'Planes are yours to set, and once any is set they drive the geometry: the ' +
        'runs go flat on their planes and each crease carries the climb between ' +
        'them. Which of the Z lab’s three turns a fold is comes from the ' +
        'separation between its arms.',
    ),
  );
  stack.appendChild(foot);

  panel.appendChild(stack);
  stack.scrollTop = scrollKeep;
}

/** The whole panel as plain text — the thing to paste back with corrections. */
function asText(facts: CrossingFact[], folds: FoldRow[]): string {
  const out: string[] = [
    `Fold Lab — box stitch, ${ROUNDS} rounds`,
    declared ? 'planes: declared' : 'planes: none declared (studio weave)',
    '',
  ];
  for (let i = scene.strands.length - 1; i >= 0; i--) {
    const s = scene.strands[i];
    const r = restOf(s.id);
    out.push(
      `L${levelOf(s.id)}  ${s.id}  rests on ${r.in}` +
        (r.out === r.in ? '' : ` -> ${r.out} after the C`),
    );
    for (const f of crossingsOf(i, facts)) {
      const otherId = f.aIndex === i ? f.bId : f.aId;
      const rel = f.woven ? (f.overIndex === i ? 'over ' : 'under') : 'clear';
      const g = gapOf(heightOf(s.id), heightOf(otherId));
      out.push(
        `      ${rel} ${otherId}${f.count > 1 ? ` x${f.count}` : ''}` +
          `${f.masked ? ' [mask]' : ''}  ${g.text}`,
      );
    }
    for (const f of folds.filter((q) => q.a.id === s.id || q.b.id === s.id)) {
      const other = f.a.id === s.id ? f.b : f.a;
      out.push(
        `      fold with ${other.id}: ${f.mode}, separation ${f.sep.toFixed(0)}deg, ` +
          `climbs ${f.climb}.00 t; upper ${f.hi.id} ${restOf(f.hi.id).in}, ` +
          `lower ${f.lo.id} ${restOf(f.lo.id).in}`,
      );
    }
  }
  return out.join('\n');
}

// One ribbon per strand, kept up so a click in the canvas can name a LAYER
// rather than the lace it was merged into.
view.setLayerPicking(true);

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const id = view.pickStrandAt(e.clientX, e.clientY);
  // A click on empty ground clears the selection; a click on a lace selects it.
  // Orbiting is a drag, so this fires on the press and the drag still orbits.
  selectLayer(id, true);
});

push();
build();
view.setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

if (import.meta.env.DEV) {
  (window as unknown as { __foldlab?: unknown }).__foldlab = { view, scene, plane };
}
