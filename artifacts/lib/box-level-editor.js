// An editor for ONE level of the 1×1 box, on the studio's own view.
//
// Every level below it is fixed, placed the way it was settled: level 1 exactly as
// the box in `box + strand`, the levels above that by `UpperPlan` 'hand' — the
// plan placed by hand in the level 2 editor. Everything about the level being
// edited is the reader's to set: where each arm rests, where each arm sits at each
// crossing, and which arm is on top there. It opens on what the levels below teach
// (the 'hand' plan carried up), and Copy hands the result back as JSON, in the same
// rungs and keys a saved studio scene uses, so it can be built in as it stands.
//
// Shared by box-level2-editor and box-level3-editor; each calls `startEditor(level)`.
import { StrandScene } from '../../src/scene/StrandScene';
import { boxStitchMN, UPPER_PLANS } from '../../src/model/boxmn';

export function startEditor(LEVEL) {

const RUNG = 0.5; // a rung is half a thickness (PLANE_RUNGS in the panel)
const RUNGS = [3, 2, 1, 0, -1, -2, -3];
const RUNG_NAMES = {
  3: 'rung above this storey', 2: 'top of this storey', 1: 'upper half', 0: 'middle',
  '-1': 'lower half', '-2': 'floor of this storey', '-3': 'rung below this storey',
};
const ROUND = LEVEL - 1; // rounds worked over the starting stitch
const LAYERS = [2 + 2 * ROUND, 3 + 2 * ROUND];
const ARMS = ['1', '2'].flatMap((set) => LAYERS.map((l) => `${set}_${l}`));
const STORE = `box-level${LEVEL}-editor`;

const layer = (id) => Number(id.split('_')[1]);
/** The level a layer is on, from 1: `_1` … `_3` are level 1, then two layers to a level. */
const levelOf = (id) => (layer(id) < 4 ? 1 : Math.floor((layer(id) - 2) / 2) + 1);
const isEdited = (id) => levelOf(id) === LEVEL;
const sign = (r) => (r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0');

// ---- the base: the levels below placed, this one bare --------------------------------
// `stop` is how far past POKE the fold stops sit (boxStitchMN's own argument), so the
// base is built per stop; it is small and pure, so the few there are get kept.
const bases = new Map();
function base(stop = 0) {
  if (!bases.has(stop)) {
    const sc = boxStitchMN(1, 1, `Box 1×1 RH — level ${LEVEL} edited`, 'rh', ROUND, true, 'hand', stop);
    const keepL1 = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.split('|').some(isEdited)));
    bases.set(stop, {
      ...sc,
      planes: keepL1(sc.planes ?? {}),
      crossPlanes: keepL1(sc.crossPlanes ?? {}),
      planeEnds: lowerEnds(sc.planeEnds ?? {}),
    });
  }
  return bases.get(stop);
}
/** The fold ends that belong to the levels below: everything but the folds into this one. */
function lowerEnds(ends) {
  const out = {};
  for (const [id, e] of Object.entries(ends)) {
    if (isEdited(id)) continue;
    const kept = levelOf(id) === LEVEL - 1 ? { in: e.in } : { ...e };
    if (kept.in === undefined) delete kept.in;
    if (Object.keys(kept).length) out[id] = kept;
  }
  return out;
}
/** …and the ones that do: the starts of this level's arms, the ends of the level below's. */
function foldEnds(ends) {
  const out = {};
  for (const [id, e] of Object.entries(ends)) {
    if (isEdited(id) && e.in !== undefined) out[id] = { in: e.in };
    else if (levelOf(id) === LEVEL - 1 && e.out !== undefined) out[id] = { out: e.out };
  }
  return out;
}
const BASE = base();

/**
 * The plan: what the reader has set, and nothing else. `rest`, `cross` and `flip` are
 * this level. `ends` and `stop` are the FOLDS into it — where each arm of the level
 * below ends (`out`) and where the arm of this level that carries on from it starts
 * (`in`), in rungs, and how far out the fold stops sit, in px.
 */
const empty = () => ({ rest: {}, cross: {}, flip: [], ends: {}, stop: 0 });
let plan = empty();

function presetPlan(name) {
  const p = empty();
  if (name === 'none') return p;
  const full = boxStitchMN(1, 1, 'preset', 'rh', ROUND, true, name);
  for (const [id, r] of Object.entries(full.planes ?? {})) if (isEdited(id)) p.rest[id] = r;
  for (const [k, r] of Object.entries(full.crossPlanes ?? {})) if (k.split('|').slice(0, 2).every(isEdited)) p.cross[k] = r;
  p.ends = foldEnds(full.planeEnds ?? {});
  return p;
}

// ---- the scene the plan describes -------------------------------------------------
function pairKey(a, b) {
  return [a, b].sort().join('|');
}
function sceneFor(p) {
  const B = base(p.stop ?? 0);
  const flipped = new Set(p.flip);
  const masks = B.masks.filter((m) => !(isEdited(m.overId) && isEdited(m.underId) && flipped.has(pairKey(m.overId, m.underId))));
  // A flip is the other lace on top: the reverse of whatever the box says there.
  for (const key of flipped) {
    const was = defaultOver[key];
    if (!was) continue;
    const other = key.split('|').find((id) => id !== was);
    masks.push({ overId: other, underId: was });
  }
  return {
    ...B,
    strands: B.strands.map((s) => ({ ...s, start: { ...s.start }, end: { ...s.end },
      visible: state.showL1 || isEdited(s.id) })),
    masks,
    planes: { ...B.planes, ...p.rest },
    crossPlanes: { ...B.crossPlanes, ...p.cross },
    // Not a field a saved scene has yet: one rung per arm cannot say an arm that
    // rests on one plane and ends on another. Read by `show`, and handed back in Copy.
    planeEnds: mergeEnds(B.planeEnds ?? {}, p.ends ?? {}),
  };
}

function mergeEnds(a, b) {
  const out = JSON.parse(JSON.stringify(a));
  for (const [id, e] of Object.entries(b)) out[id] = { ...(out[id] ?? {}), ...e };
  return out;
}

// ---- view ------------------------------------------------------------------------
const view = new StrandScene(document.getElementById('c'));
view.renderer.shadowMap.enabled = false;
const state = { showL1: true };

function show(sc) {
  view.setScene(sc, false);
  const map = new Map(Object.entries(sc.planes ?? {}).map(([id, r]) => [id, { in: r * RUNG, out: r * RUNG }]));
  // An end that is set overrides that end of the arm only; the other end keeps the
  // arm's rest, so the arm ramps between them.
  for (const [id, e] of Object.entries(sc.planeEnds ?? {})) {
    const rest = sc.planes?.[id] ?? 0;
    map.set(id, { in: (e.in ?? rest) * RUNG, out: (e.out ?? rest) * RUNG });
  }
  view.setSublevels(map.size ? map : null);
  const cross = Object.entries(sc.crossPlanes ?? {});
  view.setCrossingPlanes(cross.length ? new Map(cross.map(([k, r]) => [k, r * RUNG])) : null);
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

/** This level's four crossings as the view found them: key, the pair, who is on top. */
function crossings() {
  return view.getCrossPoints()
    .filter((c) => isEdited(c.aId) && isEdited(c.bId) && c.aId[0] !== c.bId[0])
    .map((c) => ({ c, key: c.key, ids: [c.aId, c.bId], over: c.overIndex === c.aIndex ? c.aId : c.bId }))
    .sort((a, b) => pairKey(...a.ids).localeCompare(pairKey(...b.ids)));
}

// Who the box itself puts on top at each of this level's crossings, before any flip.
const defaultOver = {};
show(sceneFor(empty()));
for (const x of crossings()) defaultOver[pairKey(...x.ids)] = x.over;

// ---- the folds into this level --------------------------------------------------------
/** Each arm of the level below, paired with the arm of this level that carries on from its end. */
function folds(sc) {
  return sc.strands
    .filter((s) => levelOf(s.id) === LEVEL - 1 && layer(s.id) >= 2)
    .map((low) => ({ low, high: sc.strands.find((t) => t.parentId === low.id && isEdited(t.id)) }))
    .filter((f) => f.high)
    .sort((a, b) => a.low.id.localeCompare(b.low.id));
}

const W = 46; // ribbon width, px
const T = 26; // ribbon thickness, px
const SCALE = 0.02; // world units per source px

/**
 * How close a fold's turning end is to the arm beside it on its own level: from the
 * end to that arm's near edge as seen from above, and in height. A ribbon needs about
 * half a thickness to curl, so under 13 px from the edge and under 26 in height is
 * touching.
 */
function foldContact(sc, low) {
  const line = view.getStrandCentrelineWorld(low.id);
  const E = line[line.length - 1];
  let best = { gap: Infinity, dz: 0, near: '' };
  for (const t of sc.strands) {
    if (levelOf(t.id) !== levelOf(low.id) || t.id.split('_')[0] === low.id.split('_')[0]) continue;
    for (const q of view.getStrandCentrelineWorld(t.id)) {
      const gap = Math.hypot(E.x - q.x, E.y - q.y) / SCALE - W / 2;
      if (gap < best.gap) best = { gap, dz: Math.abs(E.z - q.z) / SCALE, near: t.id };
    }
  }
  return { ...best, touching: best.gap < T / 2 && best.dz < T };
}

// Swept on the 1×1 level 3: lifting the end of the arm below (to the seam, or the
// rung above) makes the contact WORSE, because that arm's last crossing before its
// fold is UNDER its neighbour, and lifting it climbs straight through it. What
// clears it is the arm staying under — ending low and turning up from below — or
// the fold stopping further out. Ending at -3 clears its own level but runs into
// the level below, so -2 is the floor of what works.
const FOLD_IDEAS = [
  { id: 'learned', label: 'Yours: end 0, start +1', note: 'What you placed at the fold into level 3: the arm below ends on the middle, the arm above starts on the upper half.', end: 0, start: 1, stop: 0 },
  { id: 'built', label: 'Nothing set', note: 'Nothing set on the folds: the arm climbs straight off its rest.', stop: 0 },
  { id: 'under2', label: 'Stay under, end on the floor (−2)', note: 'The arm below keeps going down after it passes under its neighbour and ends on the floor of its level, then turns up from below. Footprint unchanged.', end: -2, stop: 0 },
  { id: 'under1', label: 'Stay under, end low (−1)', note: 'The same, half as far down: right on the line, 26 px, exactly a thickness.', end: -1, stop: 0 },
  { id: 'under2low', label: 'Floor (−2) and start low (−2)', note: 'Ends on the floor of its level and the arm above starts on the floor of its own, so the turn is as short as it can be.', end: -2, start: -2, stop: 0 },
  { id: 'stop8', label: 'Stops out 8 px', note: 'No rung changes: the fold stops sit 8 px further out, enough room for the climb.', stop: 8 },
];

// ---- controls ---------------------------------------------------------------------
function ladder(current, onPick, freeLabel = 'free') {
  const seg = document.createElement('div');
  seg.className = 'rungs';
  const opts = [null, ...RUNGS];
  for (const r of opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = r === null ? freeLabel : sign(r);
    b.title = r === null ? 'not placed' : RUNG_NAMES[r];
    b.setAttribute('aria-pressed', String(current === r || (current === undefined && r === null)));
    b.addEventListener('click', () => onPick(r));
    seg.appendChild(b);
  }
  return seg;
}

function set(obj, key, r) {
  if (r === null) delete obj[key];
  else obj[key] = r;
  commit();
}

function renderFolds(sc) {
  const host = document.getElementById('folds');
  if (!host) return;
  host.textContent = '';
  for (const { low, high } of folds(sc)) {
    const card = document.createElement('div');
    card.className = 'card';
    const head = document.createElement('div');
    head.className = 'head';
    const t = document.createElement('b');
    t.textContent = `${low.id} → ${high.id}`;
    const sub = document.createElement('span');
    sub.textContent = `level ${LEVEL - 1} turns into level ${LEVEL}`;
    head.append(t, sub);
    card.appendChild(head);
    for (const [id, end, label] of [[low.id, 'out', 'ends'], [high.id, 'in', 'starts']]) {
      const row = document.createElement('div');
      row.className = 'row';
      const name = document.createElement('b');
      name.textContent = `${id} ${label}`;
      name.className = (id.startsWith('1_') ? 'weft' : 'warp') + ' wide';
      const cur = plan.ends[id]?.[end];
      row.append(name, ladder(cur, (r) => {
        const e = { ...(plan.ends[id] ?? {}) };
        if (r === null) delete e[end];
        else e[end] = r;
        if (Object.keys(e).length) plan.ends[id] = e;
        else delete plan.ends[id];
        commit();
      }, 'rest'));
      card.appendChild(row);
    }
    const c = foldContact(sc, low);
    const read = document.createElement('p');
    read.className = 'read ' + (c.touching ? 'off' : 'ok');
    read.textContent = `built: the turning end of ${low.id} is ${Math.max(0, c.gap).toFixed(0)} px from ${c.near}'s edge and ` +
      `${c.dz.toFixed(0)} px from its height — ${c.touching ? 'touching' : 'clear'}`;
    card.appendChild(read);
    host.appendChild(card);
  }
  document.querySelectorAll('[data-stop]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.stop === (plan.stop ?? 0))));
}

function applyIdea(idea) {
  const sc = sceneFor(plan);
  plan.ends = {};
  for (const { low, high } of folds(sc)) {
    if (idea.end !== undefined) plan.ends[low.id] = { out: idea.end };
    if (idea.start !== undefined) plan.ends[high.id] = { in: idea.start };
  }
  plan.stop = idea.stop;
  commit();
}

function renderControls(xs) {
  const rest = document.getElementById('rest');
  rest.textContent = '';
  for (const id of ARMS) {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('b');
    name.textContent = id;
    name.className = id.startsWith('1_') ? 'weft' : 'warp';
    row.append(name, ladder(plan.rest[id], (r) => set(plan.rest, id, r)));
    rest.appendChild(row);
  }

  const host = document.getElementById('cross');
  host.textContent = '';
  const th = view.getThicknessWorld();
  const z0 = view.getStoreyPlane(LEVEL - 1);
  for (const x of xs) {
    const card = document.createElement('div');
    card.className = 'card';
    const pk = pairKey(...x.ids);
    const flipped = plan.flip.includes(pk);
    const head = document.createElement('div');
    head.className = 'head';
    const t = document.createElement('b');
    t.textContent = `${x.ids[0]} × ${x.ids[1]} ·`;
    const top = document.createElement('span');
    top.innerHTML = `<i class="${x.over.startsWith('1_') ? 'weft' : 'warp'}">${x.over}</i> on top`;
    const flip = document.createElement('button');
    flip.type = 'button';
    flip.className = 'flip';
    flip.textContent = flipped ? 'Flipped · undo' : 'Flip who is on top';
    flip.setAttribute('aria-pressed', String(flipped));
    flip.addEventListener('click', () => {
      plan.flip = flipped ? plan.flip.filter((k) => k !== pk) : [...plan.flip, pk];
      // The other arm is on top now, so it takes the higher rung: swap what the two
      // were placed at here, so a flip never leaves the top arm underneath.
      const [ka, kb] = x.ids.map((id) => `${x.key}|${id}`);
      const ra = plan.cross[ka];
      const rb = plan.cross[kb];
      delete plan.cross[ka];
      delete plan.cross[kb];
      if (rb !== undefined) plan.cross[ka] = rb;
      if (ra !== undefined) plan.cross[kb] = ra;
      commit();
    });
    head.append(t, top, flip);
    card.appendChild(head);
    const zs = {};
    for (const id of x.ids) {
      zs[id] = (nearest(view.getStrandCentrelineWorld(id), x.c.x, x.c.y).z - z0) / th / RUNG;
      const key = `${x.key}|${id}`;
      const row = document.createElement('div');
      row.className = 'row';
      const name = document.createElement('b');
      name.textContent = id;
      name.className = id.startsWith('1_') ? 'weft' : 'warp';
      row.append(name, ladder(plan.cross[key], (r) => set(plan.cross, key, r)));
      card.appendChild(row);
    }
    const under = x.ids.find((id) => id !== x.over);
    const air = (zs[x.over] - zs[under]) / 2 - 1;
    const read = document.createElement('p');
    read.className = 'read ' + (zs[x.over] < zs[under] - 0.05 ? 'off' : air < -0.55 ? 'off' : 'ok');
    read.textContent = `built: ${x.over} ${sign(+zs[x.over].toFixed(2))} · ${under} ${sign(+zs[under].toFixed(2))} · ` +
      (zs[x.over] < zs[under] - 0.05 ? 'the one on top is lower'
        : air >= -0.05 ? `air ${Math.max(0, air).toFixed(2)} th` : `overlap ${(-air).toFixed(2)} th`);
    card.appendChild(read);
    host.appendChild(card);
  }
}

// ---- output ------------------------------------------------------------------------
function output() {
  const sc = sceneFor(plan);
  const level2 = {
    planes: Object.fromEntries(Object.entries(plan.rest).sort()),
    crossPlanes: Object.fromEntries(Object.entries(plan.cross).sort()),
    flipped: [...plan.flip].sort().map((k) => ({ crossing: k, onTop: k.split('|').find((id) => id !== defaultOver[k]) })),
    folds: {
      planeEnds: Object.fromEntries(Object.entries(plan.ends).sort()),
      stopPx: plan.stop ?? 0,
    },
  };
  return JSON.stringify({
    what: `box 1×1 RH, level ${LEVEL} placed by hand (rungs; levels below as built)`,
    [`level${LEVEL}`]: level2,
    scene: {
      name: sc.name,
      strands: sc.strands.map((s) => ({ ...s, visible: true })),
      masks: sc.masks,
      levelBreaks: sc.levelBreaks,
      planes: sc.planes,
      crossPlanes: sc.crossPlanes,
      planeEnds: sc.planeEnds,
    },
  }, null, 2);
}

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(plan)); } catch { /* private window: fine */ }
}
function load() {
  try {
    const p = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (p && p.rest && p.cross && Array.isArray(p.flip)) return { ends: {}, stop: 0, ...p };
  } catch { /* nothing saved */ }
  return null;
}

let refit = true;
function commit() {
  const sc = sceneFor(plan);
  show(sc);
  if (refit) { view.fitView(); refit = false; }
  renderControls(crossings());
  renderFolds(sc);
  document.getElementById('out').value = output();
  const n = Object.keys(plan.rest).length + Object.keys(plan.cross).length + plan.flip.length +
    Object.values(plan.ends).reduce((k, e) => k + Object.keys(e).length, 0) + (plan.stop ? 1 : 0);
  document.getElementById('count').textContent = n ? `${n} set on level ${LEVEL}` : `nothing set on level ${LEVEL}`;
  save();
}

document.getElementById('copy').addEventListener('click', async () => {
  const out = document.getElementById('out');
  const msg = document.getElementById('copied');
  try {
    await navigator.clipboard.writeText(out.value);
    msg.textContent = 'Copied. Paste it to Claude.';
  } catch {
    out.focus();
    out.select();
    msg.textContent = 'Selected. Press Ctrl+C (⌘C) to copy.';
  }
});
document.getElementById('preset').addEventListener('change', (e) => {
  // A preset is this level's plan, folds into it included; the stop is kept.
  plan = { ...presetPlan(e.target.value), stop: plan.stop };
  commit();
});
document.getElementById('clear').addEventListener('click', () => {
  plan = { ...empty(), ends: plan.ends, stop: plan.stop };
  document.getElementById('preset').value = 'none';
  commit();
});
document.getElementById('show-l1').addEventListener('change', (e) => {
  state.showL1 = e.target.checked;
  commit();
});
document.getElementById('v-fit').addEventListener('click', () => view.fitView());
document.getElementById('v-plan').addEventListener('click', () => view.topView());
document.getElementById('v-side').addEventListener('click', () => {
  view.fitView();
  const t = view.controls.target;
  const d = view.camera.position.distanceTo(t);
  view.camera.position.set(t.x + 0.12 * d, t.y - 0.98 * d, t.z + 0.16 * d);
  view.controls.update();
});

const ideas = document.getElementById('fold-ideas');
if (ideas) {
  for (const idea of FOLD_IDEAS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = idea.label;
    b.title = idea.note;
    b.addEventListener('click', () => applyIdea(idea));
    ideas.appendChild(b);
  }
}
document.querySelectorAll('[data-stop]').forEach((b) => b.addEventListener('click', () => {
  plan.stop = +b.dataset.stop;
  commit();
}));
document.getElementById('v-fold')?.addEventListener('click', () => {
  const f = folds(sceneFor(plan))[0];
  if (!f) return;
  const L = view.getStrandCentrelineWorld(f.low.id);
  const tip = L[L.length - 1];
  view.controls.target.set(tip.x, tip.y, tip.z);
  view.camera.position.set(tip.x + 4.2, tip.y - 2.6, tip.z + 2.6);
  view.controls.update();
});

const sel = document.getElementById('preset');
sel.add(new Option('Nothing placed', 'none'));
for (const [k, p] of Object.entries(UPPER_PLANS)) {
  const hand = LEVEL <= 3 ? 'Yours, as you placed it' : 'Learned from your levels 2 and 3';
  sel.add(new Option(k === 'hand' ? hand : p.label, k));
}
document.querySelectorAll('.lvl').forEach((e) => { e.textContent = String(LEVEL); });

function paintTheme() {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  view.setTheme(dark ? 'dark' : 'light');
}
paintTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);
new MutationObserver(paintTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

const saved = load();
plan = saved ?? presetPlan('hand');
sel.value = saved ? 'none' : 'hand';
window.__ed = { get plan() { return plan; }, commit, output, applyIdea, FOLD_IDEAS, foldContact, folds, sceneFor, view }; // test hook
commit();
document.getElementById('loading').remove();
}
