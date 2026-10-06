// An editor for the box's SECOND level, on the studio's own view.
//
// Level 1 is fixed: the 1×1 right hand, placed exactly the way the box in
// `box + strand` was placed. Everything about level 2 is the reader's to set —
// where each arm rests, where each arm sits at each crossing, and which arm is on
// top there — and Copy hands the result back as JSON, in the same rungs and keys a
// saved studio scene uses, so it can be built in as it stands.
import { StrandScene } from '../../src/scene/StrandScene';
import { boxStitchMN, UPPER_PLANS } from '../../src/model/boxmn';

const RUNG = 0.5; // a rung is half a thickness (PLANE_RUNGS in the panel)
const RUNGS = [3, 2, 1, 0, -1, -2, -3];
const RUNG_NAMES = {
  3: 'rung above this storey', 2: 'top of this storey', 1: 'upper half', 0: 'middle',
  '-1': 'lower half', '-2': 'floor of this storey', '-3': 'rung below this storey',
};
const ARMS = ['1_4', '1_5', '2_4', '2_5'];
const STORE = 'box-level2-editor';

const layer = (id) => Number(id.split('_')[1]);
const isL2 = (id) => layer(id) >= 4;
const sign = (r) => (r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0');

// ---- the base: level 1 placed, level 2 bare ---------------------------------------
function base() {
  const sc = boxStitchMN(1, 1, 'Box 1×1 RH — level 2 edited', 'rh', 1, true, 'hand');
  const keepL1 = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.split('|').some(isL2)));
  return { ...sc, planes: keepL1(sc.planes ?? {}), crossPlanes: keepL1(sc.crossPlanes ?? {}) };
}
const BASE = base();

/** The plan: what the reader has set on level 2, and nothing else. */
const empty = () => ({ rest: {}, cross: {}, flip: [] });
let plan = empty();

function presetPlan(name) {
  const p = empty();
  if (name === 'none') return p;
  const full = boxStitchMN(1, 1, 'preset', 'rh', 1, true, name);
  for (const [id, r] of Object.entries(full.planes ?? {})) if (isL2(id)) p.rest[id] = r;
  for (const [k, r] of Object.entries(full.crossPlanes ?? {})) if (k.split('|').slice(0, 2).every(isL2)) p.cross[k] = r;
  return p;
}

// ---- the scene the plan describes -------------------------------------------------
function pairKey(a, b) {
  return [a, b].sort().join('|');
}
function sceneFor(p) {
  const flipped = new Set(p.flip);
  const masks = BASE.masks.filter((m) => !(isL2(m.overId) && isL2(m.underId) && flipped.has(pairKey(m.overId, m.underId))));
  // A flip is the other lace on top: the reverse of whatever the box says there.
  for (const key of flipped) {
    const was = defaultOver[key];
    if (!was) continue;
    const other = key.split('|').find((id) => id !== was);
    masks.push({ overId: other, underId: was });
  }
  return {
    ...BASE,
    strands: BASE.strands.map((s) => ({ ...s, start: { ...s.start }, end: { ...s.end },
      visible: state.showL1 || isL2(s.id) })),
    masks,
    planes: { ...BASE.planes, ...p.rest },
    crossPlanes: { ...BASE.crossPlanes, ...p.cross },
  };
}

// ---- view ------------------------------------------------------------------------
const view = new StrandScene(document.getElementById('c'));
view.renderer.shadowMap.enabled = false;
const state = { showL1: true };

function show(sc) {
  view.setScene(sc, false);
  const runs = Object.entries(sc.planes ?? {});
  view.setSublevels(runs.length ? new Map(runs.map(([id, r]) => [id, { in: r * RUNG, out: r * RUNG }])) : null);
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

/** Level 2's four crossings as the view found them: key, the pair, who is on top. */
function crossings() {
  return view.getCrossPoints()
    .filter((c) => isL2(c.aId) && isL2(c.bId) && c.aId[0] !== c.bId[0])
    .map((c) => ({ c, key: c.key, ids: [c.aId, c.bId], over: c.overIndex === c.aIndex ? c.aId : c.bId }))
    .sort((a, b) => pairKey(...a.ids).localeCompare(pairKey(...b.ids)));
}

// Who the box itself puts on top at each level-2 crossing, before any flip.
const defaultOver = {};
show(sceneFor(empty()));
for (const x of crossings()) defaultOver[pairKey(...x.ids)] = x.over;

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
  const z0 = view.getStoreyPlane(1);
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
  };
  return JSON.stringify({
    what: 'box 1×1 RH, level 2 placed by hand (rungs; level 1 is box + strand as built)',
    level2,
    scene: {
      name: sc.name,
      strands: sc.strands.map((s) => ({ ...s, visible: true })),
      masks: sc.masks,
      levelBreaks: sc.levelBreaks,
      planes: sc.planes,
      crossPlanes: sc.crossPlanes,
    },
  }, null, 2);
}

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(plan)); } catch { /* private window: fine */ }
}
function load() {
  try {
    const p = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (p && p.rest && p.cross && Array.isArray(p.flip)) return p;
  } catch { /* nothing saved */ }
  return null;
}

let refit = true;
function commit() {
  show(sceneFor(plan));
  if (refit) { view.fitView(); refit = false; }
  renderControls(crossings());
  document.getElementById('out').value = output();
  const n = Object.keys(plan.rest).length + Object.keys(plan.cross).length + plan.flip.length;
  document.getElementById('count').textContent = n ? `${n} set on level 2` : 'nothing set on level 2';
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
  plan = presetPlan(e.target.value);
  commit();
});
document.getElementById('clear').addEventListener('click', () => {
  plan = empty();
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

const sel = document.getElementById('preset');
sel.add(new Option('Nothing placed', 'none'));
for (const [k, p] of Object.entries(UPPER_PLANS)) sel.add(new Option(p.label, k));

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
window.__ed = { get plan() { return plan; }, commit, output }; // test hook
commit();
document.getElementById('loading').remove();
