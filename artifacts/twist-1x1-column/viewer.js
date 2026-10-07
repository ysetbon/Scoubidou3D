// The whole 1×1 twist column, levels 1 to 10, on the box's planes, every level turned 45°.
//
// One copy of the studio's own view, fed by `twistColumnDecided` with
// `TWIST_1X1_FIXED` — the same function and the same numbers the studio's
// "Twist 1×1 decided level by level" samples use, so this page and the sample
// cannot disagree. Nothing here is a second implementation: the table is read
// back off the built ribbons.
import { StrandScene } from '../../src/scene/StrandScene';
import { TWIST_1X1_FIXED, tipToTurnDeg, twistColumnDecided } from '../../src/model/twistplaced';

const RUNG = 0.5;
const W = 46;
const SCALE = 0.02;
const MAXL = 10;

const state = { levels: MAXL, hand: 'rh', only: false, lace: 'both', focus: MAXL, fold: -1 };
const view = new StrandScene(document.getElementById('c'));
view.renderer.shadowMap.enabled = false;
const $ = (id) => document.getElementById(id);

const layer = (id) => Number(id.split('_')[1]);
const levelOf = (id) => (layer(id) < 4 ? 1 : Math.floor((layer(id) - 2) / 2) + 1);
const lace = (id) => id.split('_')[0];
const armsOf = (L) => (L === 1 ? [2, 3] : [2 * L, 2 * L + 1]);
const sign = (r) => (r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0');

let sceneNow = null;
function build() {
  sceneNow = twistColumnDecided(state.levels, TWIST_1X1_FIXED, `Twist 1×1 ${state.hand.toUpperCase()}, ${state.levels} levels`, state.hand);
  return sceneNow;
}

function show(sc) {
  const keep = (s) => (state.only ? levelOf(s.id) === state.focus : true) && (state.lace === 'both' || lace(s.id) === state.lace);
  view.setScene({ ...sc, strands: sc.strands.map((s) => ({ ...s, visible: keep(s) })) }, false);
  const map = new Map(Object.entries(sc.planes ?? {}).map(([id, r]) => [id, { in: r * RUNG, out: r * RUNG }]));
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

/** Per level: crossings with the right lace on top, and how far its fold ends sit from the arm they cross. */
function readLevels(sc) {
  const th = view.getThicknessWorld();
  const lines = {};
  // a hidden lace still weaves; read the woven line either way
  sc.strands.forEach((s, i) => { lines[s.id] = view.wovenLines?.[i] ?? view.getStrandCentrelineWorld(s.id); });
  const rows = [];
  for (let L = 1; L <= state.levels; L++) {
    let n = 0, right = 0, worst = Infinity;
    for (const c of view.getCrossPoints()) {
      if (lace(c.aId) === lace(c.bId) || levelOf(c.aId) !== L || levelOf(c.bId) !== L || !c.woven) continue;
      const over = c.overIndex === c.aIndex ? c.aId : c.bId;
      const under = over === c.aId ? c.bId : c.aId;
      const gap = (nearest(lines[over], c.x, c.y).z - nearest(lines[under], c.x, c.y).z) / th;
      n++;
      if (gap > -0.05) right++;
      worst = Math.min(worst, gap);
    }
    let edge = Infinity;
    if (L < state.levels) {
      for (const s of sc.strands) {
        if (levelOf(s.id) !== L || !armsOf(L).includes(layer(s.id))) continue;
        const E = lines[s.id][lines[s.id].length - 1];
        for (const t of sc.strands) {
          if (levelOf(t.id) !== L || lace(t.id) === lace(s.id) || layer(t.id) < 2) continue;
          for (const q of lines[t.id]) edge = Math.min(edge, Math.hypot(E.x - q.x, E.y - q.y) / SCALE - W / 2);
        }
      }
    }
    rows.push({ L, n, right, worst, edge });
  }
  return rows;
}

function table(rows) {
  const host = $('rows');
  host.textContent = '';
  for (const r of rows) {
    const d = TWIST_1X1_FIXED[r.L - 1];
    const tr = document.createElement('tr');
    tr.tabIndex = 0;
    const td = (t, cls) => { const e = document.createElement('td'); e.textContent = t; if (cls) e.className = cls; tr.appendChild(e); };
    const top = r.L === state.levels;
    td(`Level ${r.L}${r.L === MAXL ? ' (top)' : ''}`);
    td(top ? 'loose ends' : `${d.tip} px`);
    td(top ? '—' : `${tipToTurnDeg(d.tip).toFixed(2)}°`);
    td(top ? '—' : `${sign(d.out)} / ${sign(d.in)}`);
    td(r.n ? `${r.right} of ${r.n} right` : '—', r.n && r.right !== r.n ? 'off' : r.n ? 'ok' : '');
    td(Number.isFinite(r.edge) ? `${r.edge >= 0 ? '+' : '−'}${Math.abs(r.edge).toFixed(0)} px` : '—', Number.isFinite(r.edge) ? (r.edge >= 0 ? 'ok' : 'off') : '');
    const pick = () => { state.focus = r.L; render(); };
    tr.addEventListener('click', pick);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    host.appendChild(tr);
  }
}

function describe(sc, L) {
  const host = $('this-level');
  host.textContent = '';
  const d = TWIST_1X1_FIXED[L - 1];
  const prev = TWIST_1X1_FIXED[L - 2];
  const rows = [
    ['Its fold tip', L < state.levels ? `${d.tip} px out from the centre → level ${L + 1} turned ${tipToTurnDeg(d.tip).toFixed(2)}°` : 'the top level: its ends are loose'],
    ['Its fold ends rest on', L < state.levels ? sign(d.out) : '—'],
    ['Its arms start on', L > 1 ? `${sign(prev.in)} (the fold up from level ${L - 1})` : 'level 1 is the box from box + strand'],
  ];
  for (const [k, v] of rows) {
    const tr = document.createElement('tr');
    const a = document.createElement('td'); a.textContent = k;
    const b = document.createElement('td'); b.textContent = v;
    tr.append(a, b);
    host.appendChild(tr);
  }
  $('this-title').textContent = `Level ${L}`;
}

function foldButtons() {
  const host = $('folds');
  host.textContent = '';
  const L = Math.min(state.focus, state.levels - 1);
  if (L < 1) return;
  armsOf(L).flatMap((l) => ['1', '2'].map((set) => `${set}_${l}`)).forEach((id, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `Fold ${i + 1}`;
    b.title = `the fold at the end of ${id}`;
    b.setAttribute('aria-pressed', String(state.fold === i));
    b.addEventListener('click', () => { state.fold = i; aimAt(id, L); foldButtons(); });
    host.appendChild(b);
  });
}

function aimAt(id, L) {
  const line = view.getStrandCentrelineWorld(id) ?? view.wovenLines?.[sceneNow.strands.findIndex((s) => s.id === id)];
  if (!line) return;
  const tip = line[line.length - 1];
  let cx = 0, cy = 0, n = 0;
  for (const s of sceneNow.strands) {
    if (levelOf(s.id) !== L || !armsOf(L).includes(layer(s.id))) continue;
    const l = view.wovenLines?.[sceneNow.strands.indexOf(s)];
    if (!l) continue;
    cx += l[l.length - 1].x; cy += l[l.length - 1].y; n++;
  }
  cx /= n || 1; cy /= n || 1;
  let ox = tip.x - cx, oy = tip.y - cy;
  const ol = Math.hypot(ox, oy) || 1;
  ox /= ol; oy /= ol;
  view.controls.target.set(tip.x, tip.y, tip.z);
  view.camera.position.set(tip.x + ox * 2.6, tip.y + oy * 2.6, tip.z + 1.8);
  view.controls.update();
}

function coordinates(sc) {
  return sc.strands.map((s, i) => {
    const line = view.wovenLines?.[i];
    const z = (q) => +(q.z / SCALE).toFixed(1);
    return {
      id: s.id,
      level: levelOf(s.id),
      start: { x: +s.start.x.toFixed(1), y: +s.start.y.toFixed(1) },
      end: { x: +s.end.x.toFixed(1), y: +s.end.y.toFixed(1) },
      z: line ? { start: z(line[0]), mid: z(line[Math.floor(line.length / 2)]), end: z(line[line.length - 1]) } : null,
      parent: s.parentId,
    };
  });
}

let framed = '';
function render() {
  const sc = build();
  show(sc);
  const shape = `${state.hand}-${state.levels}`;
  if (shape !== framed) { view.fitView(); framed = shape; state.fold = -1; }
  state.focus = Math.min(state.focus, state.levels);
  const rows = readLevels(sc);
  table(rows);
  document.querySelectorAll('#rows tr').forEach((tr, i) => tr.classList.toggle('focus', i + 1 === state.focus));
  describe(sc, state.focus);
  foldButtons();
  const clean = rows.every((r) => (r.n === 0 || r.right === r.n) && !(r.edge < 0));
  $('verdict').textContent = clean ? `Levels 1–${state.levels}: every crossing has the right lace on top and every fold end clears the arm it crosses.` : 'Something reads wrong — see the red cells.';
  $('verdict').className = clean ? 'ok' : 'off';
  $('out').value = JSON.stringify({
    what: 'twist 1×1 column on the box\'s planes, 45° a level (tip px; heights in rungs of half a thickness)',
    hand: state.hand,
    levels: state.levels,
    decisions: TWIST_1X1_FIXED.slice(0, state.levels - 1).map((d, i) => ({ level: i + 1, tipPx: d.tip, turnIntoNextDeg: +tipToTurnDeg(d.tip).toFixed(2), foldEndsOn: d.out, nextArmsStartOn: d.in })),
    coordinates: coordinates(sc),
  }, null, 1);
  levelButtons();
  for (const [attr, value] of [['hand', state.hand], ['only', String(state.only)], ['lace', state.lace]]) {
    document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  }
}

function levelButtons() {
  const host = $('levels');
  if (!host.children.length) {
    for (let L = 1; L <= MAXL; L++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(L);
      b.dataset.n = String(L);
      b.addEventListener('click', () => { stopPlay(); state.levels = L; state.focus = L; render(); });
      host.appendChild(b);
    }
  }
  [...host.children].forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.n === state.levels)));
}

for (const attr of ['hand', 'only', 'lace']) {
  document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset[attr];
    state[attr] = attr === 'only' ? v === 'true' : v;
    stopPlay();
    render();
  }));
}

function step(d) {
  state.levels = Math.min(MAXL, Math.max(1, state.levels + d));
  state.focus = state.levels;
  render();
}
let timer = null;
function stopPlay() {
  if (timer) clearInterval(timer);
  timer = null;
  $('play').setAttribute('aria-pressed', 'false');
  $('play').textContent = 'Build up';
}
$('prev').addEventListener('click', () => { stopPlay(); step(-1); });
$('next').addEventListener('click', () => { stopPlay(); step(1); });
$('play').addEventListener('click', () => {
  if (timer) { stopPlay(); return; }
  state.levels = 1;
  state.focus = 1;
  render();
  $('play').setAttribute('aria-pressed', 'true');
  $('play').textContent = 'Stop';
  timer = setInterval(() => {
    if (state.levels >= MAXL) { stopPlay(); return; }
    step(1);
  }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 1500 : 900);
});
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('button, input, select, textarea')) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { stopPlay(); step(1); e.preventDefault(); }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { stopPlay(); step(-1); e.preventDefault(); }
});
$('v-fit').addEventListener('click', () => { state.fold = -1; view.fitView(); foldButtons(); });
$('v-plan').addEventListener('click', () => { state.fold = -1; view.topView(); foldButtons(); });
$('v-side').addEventListener('click', () => {
  state.fold = -1;
  view.fitView();
  const t = view.controls.target;
  const d = view.camera.position.distanceTo(t);
  view.camera.position.set(t.x + 0.12 * d, t.y - 0.98 * d, t.z + 0.16 * d);
  view.controls.update();
  foldButtons();
});
$('copy').addEventListener('click', async () => {
  const out = $('out');
  const msg = $('copied');
  try {
    await navigator.clipboard.writeText(out.value);
    msg.textContent = 'Copied.';
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

window.__col = { state, render }; // test hook
render();
$('loading').remove();
