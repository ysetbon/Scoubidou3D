// The fold between two levels of the 1×1 twist, set one level at a time.
//
// A fold joins the END of an arm on level L−1 to the START of the arm that carries
// on from it on level L. Two heights decide how it climbs: the plane the lower arm
// ends on, and the plane the upper arm starts on, each in rungs of half a ribbon
// thickness (`planeEnds` in the scene: `out` for the end, `in` for the start). Here
// every arm of the fold into the chosen level has both, on the column as set in the samples, on the box's
// planes (`twist1x1Decisions`); what the reader changes is layered on top, arm by arm,
// and everything is rebuilt on the studio's own view and read back off the ribbons.
import { StrandScene } from '../../src/scene/StrandScene';
import { TWIST_1X1_TIPS, tipToTurnDeg, twist1x1Decisions, twistColumnDecided } from '../../src/model/twistplaced';
import { meshHits } from '../lib/ribbon-check.js';

const RUNG = 0.5;
const SCALE = 0.02;
const RUNG_PX = 13;
const W = 46;
const MAXL = 10;
const RUNGS = [-3, -2, -1, 0, 1, 2, 3];
const STORE = 'twist-1x1-ends';

const $ = (id) => document.getElementById(id);
const layer = (id) => Number(id.split('_')[1]);
const levelOf = (id) => (layer(id) < 4 ? 1 : Math.floor((layer(id) - 2) / 2) + 1);
const lace = (id) => id.split('_')[0];
const armsOf = (L) => (L === 1 ? [2, 3] : [2 * L, 2 * L + 1]);
const sign = (r) => (r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0');

const HALF = 28; // every arm sits 28 px off the centre: the crossing arm's centreline is the weave
const state = { hand: 'rh', focus: 2, tip: TWIST_1X1_TIPS[1], tips: null, only: true, span: 'upto', overrides: {}, notes: {}, fold: -1 };
try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
  if (saved && typeof saved.overrides === 'object') Object.assign(state, saved, { fold: -1 });
} catch { /* nothing saved: defaults */ }
if (!Array.isArray(state.tips) || state.tips.length !== 9) state.tips = [...TWIST_1X1_TIPS];
const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ ...state, fold: -1 })); } catch { /* fine */ } };

const view = new StrandScene($('c'));
view.renderer.shadowMap.enabled = false;

let sc = null;
let base = null;
let measured = null; // { for: key, text }

function build() {
  const levels = state.span === 'whole' ? MAXL : state.focus;
  const dec = twist1x1Decisions(MAXL, state.tips);
  base = twistColumnDecided(levels, dec, `Twist 1×1 ${state.hand.toUpperCase()}, ${levels} levels`, state.hand);
  const ids = new Set(base.strands.map((s) => s.id));
  const planeEnds = JSON.parse(JSON.stringify(base.planeEnds ?? {}));
  for (const [id, o] of Object.entries(state.overrides)) if (ids.has(id)) planeEnds[id] = { ...planeEnds[id], ...o };
  sc = { ...base, planeEnds };
}

function show() {
  const keep = (id) => !state.only || levelOf(id) === state.focus - 1 || levelOf(id) === state.focus;
  view.setScene({ ...sc, strands: sc.strands.map((s) => ({ ...s, visible: keep(s.id) })) }, false);
  const map = new Map(Object.entries(sc.planes ?? {}).map(([id, r]) => [id, { in: r * RUNG, out: r * RUNG }]));
  for (const [id, e] of Object.entries(sc.planeEnds ?? {})) {
    const rest = sc.planes?.[id] ?? 0;
    map.set(id, { in: (e.in ?? rest) * RUNG, out: (e.out ?? rest) * RUNG });
  }
  view.setSublevels(map.size ? map : null);
  const cross = Object.entries(sc.crossPlanes ?? {});
  view.setCrossingPlanes(cross.length ? new Map(cross.map(([k, r]) => [k, r * RUNG])) : null);
}

/** The folds into level `L`: [{ from: lower arm id, to: upper arm id }], ordered by the lower arm. */
function foldsInto(L) {
  const ups = sc.strands.filter((s) => levelOf(s.id) === L && armsOf(L).includes(layer(s.id)) && s.parentId);
  return ups.map((s) => ({ from: s.parentId, to: s.id })).sort((a, b) => layer(a.from) - layer(b.from) || lace(a.from).localeCompare(lace(b.from)));
}

const dflt = (id, which) => {
  const e = base.planeEnds?.[id]?.[which];
  return e !== undefined ? e : base.planes?.[id] ?? 0;
};
const eff = (id, which) => state.overrides[id]?.[which] ?? dflt(id, which);
const edited = (id, which) => state.overrides[id]?.[which] !== undefined;

function setRung(id, which, r) {
  const o = { ...(state.overrides[id] ?? {}) };
  if (r === dflt(id, which)) delete o[which]; else o[which] = r;
  if (Object.keys(o).length) state.overrides[id] = o; else delete state.overrides[id];
}

function nearest(line, x, y) {
  let best = line[0];
  let d = Infinity;
  for (const q of line) {
    const e = (q.x - x) ** 2 + (q.y - y) ** 2;
    if (e < d) { d = e; best = q; }
  }
  return best;
}

function lines() {
  const out = {};
  sc.strands.forEach((s, i) => { out[s.id] = view.wovenLines[i]; });
  return out;
}

/** What the built ribbons say about each fold into level L. */
function readFolds(L) {
  const ln = lines();
  const lowerPlane = view.getStoreyPlane(L - 2) / SCALE;
  const upperPlane = view.getStoreyPlane(L - 1) / SCALE;
  return foldsInto(L).map((f) => {
    const E = ln[f.from][ln[f.from].length - 1];
    let dz = Infinity, edge = Infinity;
    for (const t of sc.strands) {
      if (levelOf(t.id) !== L - 1 || lace(t.id) === lace(f.from) || layer(t.id) < 2) continue;
      for (const q of ln[t.id]) {
        const g = Math.hypot(E.x - q.x, E.y - q.y) / SCALE - W / 2;
        if (g < edge) { edge = g; dz = Math.abs(E.z - q.z) / SCALE; }
      }
    }
    const S = ln[f.to][0];
    return { ...f, dz, edge, endRung: (E.z / SCALE - lowerPlane) / RUNG_PX, startRung: (S.z / SCALE - upperPlane) / RUNG_PX };
  });
}

function rungs(host, value, def, isSet, set) {
  host.textContent = '';
  for (const r of RUNGS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = sign(r);
    b.setAttribute('aria-pressed', String(r === value));
    if (def !== null && r === def) b.classList.add('dflt');
    if (isSet && r === value) b.classList.add('set');
    b.addEventListener('click', () => set(r));
    host.appendChild(b);
  }
}

function render() {
  build();
  show();
  if (render.shape !== `${state.hand}-${state.span}-${state.span === 'upto' ? state.focus : 0}`) {
    view.fitView();
    render.shape = `${state.hand}-${state.span}-${state.span === 'upto' ? state.focus : 0}`;
    state.fold = -1;
  }
  const L = state.focus;
  const folds = foldsInto(L);
  const read = readFolds(L);

  // level chips
  const chips = $('levels');
  chips.textContent = '';
  for (let l = 2; l <= MAXL; l++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${l - 1} → ${l}`;
    b.setAttribute('aria-pressed', String(l === L));
    const hasEdit = Object.keys(state.overrides).some((id) => {
      const lv = levelOf(id);
      const o = state.overrides[id];
      return (lv === l - 1 && o.out !== undefined && layer(id) >= 2) || (lv === l && o.in !== undefined);
    });
    if (hasEdit) b.classList.add('edited');
    b.addEventListener('click', () => { state.focus = l; measured = null; render(); });
    chips.appendChild(b);
  }
  $('where').textContent = `Level ${L - 1}'s arms end, and level ${L}'s start, ${L === 2 ? 'where the box (level 1) turns into the first twist level' : 'on the plane that carries one level up onto the next'}.`;
  $('this-title').textContent = `The fold from level ${L - 1} into level ${L}`;
  $('all-out-label').textContent = `All four of level ${L - 1}'s ends on`;
  $('all-in-label').textContent = `All four of level ${L}'s starts on`;

  const allOut = new Set(folds.map((f) => eff(f.from, 'out')));
  const allIn = new Set(folds.map((f) => eff(f.to, 'in')));
  const dOut = new Set(folds.map((f) => dflt(f.from, 'out')));
  const dIn = new Set(folds.map((f) => dflt(f.to, 'in')));
  rungs($('all-out'), allOut.size === 1 ? [...allOut][0] : null, dOut.size === 1 ? [...dOut][0] : null, folds.some((f) => edited(f.from, 'out')), (r) => { folds.forEach((f) => setRung(f.from, 'out', r)); touch(); });
  rungs($('all-in'), allIn.size === 1 ? [...allIn][0] : null, dIn.size === 1 ? [...dIn][0] : null, folds.some((f) => edited(f.to, 'in')), (r) => { folds.forEach((f) => setRung(f.to, 'in', r)); touch(); });

  const pairs = $('pairs');
  pairs.textContent = '';
  folds.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'foldrow';
    const rd = read[i];
    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = `<b>Fold ${i + 1}</b><span>${f.from} → ${f.to}</span>`;
    row.appendChild(head);
    const pair = document.createElement('div');
    pair.className = 'pair';
    for (const [which, id, label] of [['out', f.from, `${f.from} ends on`], ['in', f.to, `${f.to} starts on`]]) {
      const g = document.createElement('div');
      g.className = 'grp';
      const span = document.createElement('span');
      span.textContent = label;
      const host = document.createElement('div');
      host.className = 'rungs';
      g.append(span, host);
      pair.appendChild(g);
      rungs(host, eff(id, which), dflt(id, which), edited(id, which), (r) => { setRung(id, which, r); touch(); });
    }
    row.appendChild(pair);
    pairs.appendChild(row);
  });

  // read-back
  const body = $('read');
  body.textContent = '';
  read.forEach((rd, i) => {
    const tr = document.createElement('tr');
    const td = (t, cls) => { const e = document.createElement('td'); e.textContent = t; if (cls) e.className = cls; tr.appendChild(e); };
    td(`${i + 1}: ${rd.from} → ${rd.to}`);
    td(Number.isFinite(rd.edge) ? `${rd.dz.toFixed(0)} px · ${rd.edge >= 0 ? '+' : '−'}${Math.abs(rd.edge).toFixed(0)} px` : '—', Number.isFinite(rd.edge) && rd.edge < 0 ? 'off' : rd.dz < 14 ? 'off' : 'ok');
    td(`${rd.startRung >= 0 ? '+' : '−'}${Math.abs(rd.startRung).toFixed(1)}`);
    body.appendChild(tr);
  });
  const bad = read.filter((r) => (Number.isFinite(r.edge) && r.edge < 0) || r.dz < 14).length;
  $('verdict').textContent = bad ? `${bad} of the four folds into level ${L} end inside the arm they cross, or within 14 px of it in height (red).` : `All four folds into level ${L} clear the arm they cross, read off the centrelines.`;
  $('verdict').className = bad ? 'off' : 'ok';
  $('deep').textContent = measured && measured.key === measureKey() ? measured.text : 'Press the button to count where the built ribbons cut through each other (a few seconds).';
  $('note').value = state.notes[L] ?? '';
  foldButtons(folds);
  for (const [attr, value] of [['hand', state.hand], ['only', String(state.only)], ['span', state.span]]) {
    document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  }
  syncStretch();
  $('out').value = output();
  save();
}

const measureKey = () => JSON.stringify([state.hand, state.focus, state.span, state.tips, state.overrides]);

function measure() {
  $('measure').disabled = true;
  $('measuring').textContent = ' measuring…';
  setTimeout(() => {
    const ids = sc.strands.map((s) => s.id);
    const hits = meshHits(view, ids, { skip: 1500 });
    const L = state.focus;
    const mine = hits.clusters.filter((c) => c.laces[0] !== c.laces[1] && c.on[0] && c.on[1] && [c.on[0], c.on[1]].some((id) => levelOf(id) === L - 1 || levelOf(id) === L));
    const n6 = mine.filter((c) => c.depth > 6).length;
    const n8 = mine.filter((c) => c.depth > 8).length;
    const max = Math.max(0, ...mine.map((c) => c.depth));
    const worst = mine.sort((a, b) => b.depth - a.depth).slice(0, 3).map((c) => `${c.on.join('/')} ${c.depth.toFixed(1)} px`).join(', ');
    measured = {
      key: measureKey(),
      text: `Levels ${L - 1} and ${L}: ${n6} places deeper than 6 px, ${n8} deeper than 8 px, deepest ${max.toFixed(1)} px${worst ? ` (${worst})` : ''}. For scale, the box has places up to about 10 px where ribbons rest on each other at a crossing; over all ten levels the box has 5 places deeper than 8 px and the column as set in the samples has 4.`,
    };
    $('measure').disabled = false;
    $('measuring').textContent = '';
    $('deep').textContent = measured.text;
    $('out').value = output();
  }, 30);
}

function coordinates() {
  const ln = lines();
  const z = (q) => +(q.z / SCALE).toFixed(1);
  return sc.strands.map((s) => {
    const l = ln[s.id];
    return {
      id: s.id,
      level: levelOf(s.id),
      start: { x: +s.start.x.toFixed(1), y: +s.start.y.toFixed(1) },
      end: { x: +s.end.x.toFixed(1), y: +s.end.y.toFixed(1) },
      z: l ? { start: z(l[0]), mid: z(l[Math.floor(l.length / 2)]), end: z(l[l.length - 1]) } : null,
      parent: s.parentId,
    };
  });
}

function output() {
  const L = state.focus;
  const byLevel = [];
  for (let l = 2; l <= MAXL; l++) {
    const arms = sc.strands
      .filter((s) => levelOf(s.id) === l && armsOf(l).includes(layer(s.id)) && s.parentId)
      .map((s) => ({
        from: s.parentId,
        to: s.id,
        endsOn: eff(s.parentId, 'out'),
        startsOn: eff(s.id, 'in'),
        ...(edited(s.parentId, 'out') ? { endChanged: true } : {}),
        ...(edited(s.id, 'in') ? { startChanged: true } : {}),
      }));
    const changed = arms.some((a) => a.endChanged || a.startChanged);
    if (changed || state.notes[l] || l === L) byLevel.push({ foldInto: l, arms, note: state.notes[l] || undefined });
  }
  return JSON.stringify({
    what: 'twist 1×1 on the box planes, 45° a level: for each fold (previous level → this level) the rung the lower arm ENDS on and the rung the upper arm STARTS on, per arm; rungs are half a ribbon thickness',
    hand: state.hand,
    stretchByLevel: Object.fromEntries(state.tips.map((t, i) => [`level${i + 1}`, { stretchPx: +(t - HALF).toFixed(1), tipPx: +t.toFixed(1), turnIntoNextDeg: +tipToTurnDeg(t).toFixed(2) }])),
    folding: L,
    folds: byLevel,
    ribbonsCuttingThrough: measured && measured.key === measureKey() ? measured.text : undefined,
    coordinates: coordinates(),
  }, null, 1);
}

let timer = null;
function touch() {
  clearTimeout(timer);
  timer = setTimeout(render, 80);
}

// ---- cameras ------------------------------------------------------------------
function foldButtons(folds) {
  const host = $('folds');
  host.textContent = '';
  folds.forEach((f, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `Fold ${i + 1}`;
    b.title = `${f.from} → ${f.to}`;
    b.setAttribute('aria-pressed', String(state.fold === i));
    b.addEventListener('click', () => { state.fold = i; aim(f.from, folds); foldButtons(folds); });
    host.appendChild(b);
  });
}
function aim(id, folds) {
  const ln = lines();
  const line = ln[id];
  if (!line) return;
  const tip = line[line.length - 1];
  let cx = 0, cy = 0;
  for (const f of folds) { const l = ln[f.from]; cx += l[l.length - 1].x; cy += l[l.length - 1].y; }
  cx /= folds.length || 1; cy /= folds.length || 1;
  let ox = tip.x - cx, oy = tip.y - cy;
  const ol = Math.hypot(ox, oy) || 1;
  ox /= ol; oy /= ol;
  view.controls.target.set(tip.x, tip.y, tip.z);
  view.camera.position.set(tip.x + ox * 2.6, tip.y + oy * 2.6, tip.z + 1.8);
  view.controls.update();
}

// ---- wiring -------------------------------------------------------------------
// Stretch: how far past the weave a level's folds sit, i.e. how far from the crossing arm's
// centreline the start of the next level's strands lies. 0 puts the fold right on the weave
// (the engine's extension 0); about 23 px is just clear of the crossing arm's far edge.
const MIN_STRETCH = 10, MAX_STRETCH = 72;
const stretchRows = [];
(function buildStretch() {
  const host = $('stretch');
  for (let i = 0; i < 9; i++) {
    const row = document.createElement('div');
    row.className = 'turn';
    const label = document.createElement('label');
    label.textContent = `Level ${i + 1}`;
    const range = document.createElement('input');
    range.type = 'range'; range.min = String(MIN_STRETCH); range.max = String(MAX_STRETCH); range.step = '0.5';
    range.id = `st${i}`; label.htmlFor = range.id;
    const num = document.createElement('input');
    num.type = 'number'; num.min = String(MIN_STRETCH); num.max = String(MAX_STRETCH); num.step = '0.5';
    num.setAttribute('aria-label', `Level ${i + 1} stretch in px`);
    const out = document.createElement('span');
    out.className = 'state';
    const set = (x) => {
      const val = Math.min(MAX_STRETCH, Math.max(MIN_STRETCH, Number(x)));
      if (!Number.isFinite(val)) return;
      state.tips[i] = val + HALF;
      measured = null;
      syncStretch();
      touch();
    };
    range.addEventListener('input', () => set(range.value));
    num.addEventListener('change', () => { set(num.value); num.blur(); });
    row.append(label, range, num, out);
    host.appendChild(row);
    stretchRows.push({ row, range, num, out });
  }
})();
function syncStretch() {
  stretchRows.forEach((r, i) => {
    const s = state.tips[i] - HALF;
    if (document.activeElement !== r.range) r.range.value = String(s);
    if (document.activeElement !== r.num) r.num.value = String(+s.toFixed(1));
    r.out.textContent = `turn ${tipToTurnDeg(state.tips[i]).toFixed(1)}°`;
    r.row.style.outline = i === state.focus - 2 ? '2px solid var(--accent)' : '';
    r.row.style.outlineOffset = '3px';
    r.row.classList.toggle('off', i + 1 >= (state.span === 'whole' ? MAXL : state.focus));
  });
  $('all-n').textContent = '';
}
$('all').addEventListener('input', (e) => {
  const val = Number(e.target.value);
  state.tips = Array(9).fill(val + HALF);
  state.tip = val + HALF;
  measured = null;
  syncStretch();
  touch();
});
$('all-reset').addEventListener('click', () => {
  state.tips = [...TWIST_1X1_TIPS];
  state.tip = TWIST_1X1_TIPS[1];
  $('all').value = String(+(TWIST_1X1_TIPS[1] - HALF).toFixed(1));
  measured = null;
  syncStretch();
  touch();
});
for (const attr of ['hand', 'only', 'span']) {
  document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.addEventListener('click', () => {
    state[attr] = attr === 'only' ? b.dataset[attr] === 'true' : b.dataset[attr];
    measured = null;
    render();
  }));
}
$('note').addEventListener('input', (e) => { state.notes[state.focus] = e.target.value; $('out').value = output(); save(); });
$('reset').addEventListener('click', () => {
  for (const f of foldsInto(state.focus)) { delete state.overrides[f.from]?.out; delete state.overrides[f.to]?.in; for (const id of [f.from, f.to]) if (state.overrides[id] && !Object.keys(state.overrides[id]).length) delete state.overrides[id]; }
  measured = null;
  render();
});
$('reset-all').addEventListener('click', () => { state.overrides = {}; measured = null; render(); });
$('measure').addEventListener('click', measure);
$('v-fit').addEventListener('click', () => { state.fold = -1; view.fitView(); });
$('v-plan').addEventListener('click', () => { state.fold = -1; view.topView(); });
$('v-side').addEventListener('click', () => {
  state.fold = -1;
  view.fitView();
  const t = view.controls.target;
  const d = view.camera.position.distanceTo(t);
  view.camera.position.set(t.x + 0.12 * d, t.y - 0.98 * d, t.z + 0.16 * d);
  view.controls.update();
});
$('copy').addEventListener('click', async () => {
  const out = $('out');
  const msg = $('copied');
  try {
    await navigator.clipboard.writeText(out.value);
    msg.textContent = 'Copied. Paste it to Claude.';
  } catch {
    out.focus();
    out.select();
    msg.textContent = 'Selected. Press Ctrl+C (⌘C) to copy.';
  }
});

function paintTheme() {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  view.setTheme(dark ? 'dark' : 'light');
}
paintTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);
new MutationObserver(paintTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

window.__en = { state, render, measure }; // test hook
$('all').value = String(+(state.tips[1] - HALF).toFixed(1));
render();
$('loading').remove();
