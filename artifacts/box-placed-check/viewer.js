// The 1×1 box at every depth, and a 2×1 to see whether the idea carries: today's
// unplaced build beside the same box placed. Nothing is baked — both panels are
// `StrandScene` fed by `boxStitchMN`, the app's own builder; the only difference
// between them is the `placed` argument, so the page cannot disagree with the
// samples in the studio (`box-placed-…`). The ledgers are read back off the built
// ribbons: where each lace actually is at each crossing, over a full thickness
// being two ribbons resting on each other.
import { StrandScene } from '../../src/scene/StrandScene';
import { boxStitchMN } from '../../src/model/boxmn';

const RUNG = 0.5; // a rung is half a thickness (PLANE_RUNGS in the panel)
const FACES = [[1, 1], [2, 1]];
const LEVELS = [1, 2, 3, 10, 15];
const state = { m: 1, n: 1, hand: 'rh', levels: 3, link: true };

const before = new StrandScene(document.getElementById('c-before'));
const after = new StrandScene(document.getElementById('c-after'));
const views = [before, after];
views.forEach((v) => { v.renderer.shadowMap.enabled = false; });

const built = new Map();
function scene(placed) {
  const { m, n, hand, levels } = state;
  const key = `${placed}-${hand}-${m}x${n}-${levels}`;
  if (!built.has(key)) {
    if (built.size > 16) built.clear();
    built.set(key, boxStitchMN(m, n, `Box ${m}×${n} ${hand.toUpperCase()}, ${levels} levels`, hand, levels - 1, placed, 'hand'));
  }
  return built.get(key);
}

/** What the panel does with a scene's placements: rungs to thicknesses, then to the view. */
function place(view, sc) {
  const runs = Object.entries(sc.planes ?? {});
  view.setSublevels(runs.length ? new Map(runs.map(([id, r]) => [id, { in: r * RUNG, out: r * RUNG }])) : null);
  const cross = Object.entries(sc.crossPlanes ?? {});
  view.setCrossingPlanes(cross.length ? new Map(cross.map(([k, r]) => [k, r * RUNG])) : null);
}

function nearest(line, x, y) {
  let best = line[0];
  let d = Infinity;
  for (const p of line) {
    const q = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (q < d) { d = q; best = p; }
  }
  return best;
}

function measure(view, sc) {
  const th = view.getThicknessWorld();
  const lines = {};
  let lo = Infinity;
  let hi = -Infinity;
  for (const st of view.getScene().strands) {
    const l = view.getStrandCentrelineWorld(st.id);
    lines[st.id] = l;
    for (const p of l) { lo = Math.min(lo, p.z); hi = Math.max(hi, p.z); }
  }
  let woven = 0, clear = 0, squeezed = 0, inverted = 0, worst = Infinity;
  for (const c of view.getCrossPoints()) {
    if (!c.woven) continue;
    const over = c.overIndex === c.aIndex ? c.aId : c.bId;
    const under = over === c.aId ? c.bId : c.aId;
    // A lace's own glued joint is counted as a crossing; it is not a weave.
    if (over.split('_')[0] === under.split('_')[0]) continue;
    const gap = (nearest(lines[over], c.x, c.y).z - nearest(lines[under], c.x, c.y).z) / th;
    woven++;
    worst = Math.min(worst, gap);
    if (gap < 0) inverted++;
    else if (gap < 0.9) squeezed++;
    else clear++;
  }
  return {
    strands: sc.strands.length,
    placed: Object.keys(sc.planes ?? {}).length + Object.keys(sc.crossPlanes ?? {}).length,
    woven, clear, squeezed, inverted,
    worst: woven ? worst : 0,
    height: (hi - lo) / th,
  };
}

const set = (id, text) => (document.getElementById(id).textContent = text);
const fmt = (n, d = 2) => n.toFixed(d).replace('-', '−');
function ledger(side, r) {
  set(`${side}-strands`, String(r.strands));
  set(`${side}-placed`, r.placed ? `${r.placed} placed` : 'none placed');
  set(`${side}-woven`, String(r.woven));
  set(`${side}-clear`, String(r.clear));
  set(`${side}-squeezed`, String(r.squeezed));
  set(`${side}-inverted`, String(r.inverted));
  document.getElementById(`${side}-inverted`).className = r.inverted ? 'bad' : 'good';
  set(`${side}-worst`, `${fmt(r.worst)} th`);
  set(`${side}-height`, `${fmt(r.height, 1)} th`);
}

function paintTheme() {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  views.forEach((v) => v.setTheme(dark ? 'dark' : 'light'));
}

// ---- cameras: orbit one, the other follows ---------------------------------------
let syncing = false;
function copyCam(from, to) {
  to.camera.position.copy(from.camera.position);
  to.controls.target.copy(from.controls.target);
  to.camera.near = from.camera.near;
  to.camera.far = from.camera.far;
  to.camera.updateProjectionMatrix();
  to.controls.update();
}
function syncFrom(src) {
  if (syncing || !state.link) return;
  syncing = true;
  copyCam(src, src === before ? after : before);
  syncing = false;
}
before.controls.addEventListener('change', () => syncFrom(before));
after.controls.addEventListener('change', () => syncFrom(after));
function setCam(fn) {
  const was = state.link;
  state.link = false;
  views.forEach(fn);
  state.link = was;
  copyCam(before, after);
}
const side = (v) => {
  v.fitView();
  const d = v.camera.position.length() * 1.1;
  v.camera.position.set(0.15, -1.0, 0.22).normalize().multiplyScalar(d);
  v.controls.update();
};

let framed = '';
function render(refit) {
  const b = scene(false);
  const a = scene(true);
  before.setScene(b, false);
  place(before, b);
  after.setScene(a, false);
  place(after, a);
  const shape = `${state.hand}-${state.m}x${state.n}-${state.levels}`;
  if (refit || shape !== framed) { setCam((v) => v.fitView()); framed = shape; }
  ledger('before', measure(before, b));
  ledger('after', measure(after, a));
  const { m, n, hand, levels } = state;
  set('facename', `${m} × ${n}`);
  set('facemeta', `${hand === 'lh' ? 'left hand' : 'right hand'} · ${levels} level${levels === 1 ? '' : 's'}`);
  const key = `box-placed-${hand === 'lh' ? 'lh-' : ''}${m}x${n}-l${levels}`;
  set('samplekey', `?sample=${key}`);
  document.querySelectorAll('[data-face]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.face === `${m}x${n}`)));
  document.querySelectorAll('[data-hand]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.hand === hand)));
  document.querySelectorAll('[data-levels]').forEach((c) => c.setAttribute('aria-pressed', String(+c.dataset.levels === levels)));
}

function buttons(host, items, attr, label, onPick) {
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset[attr] = it.value;
    b.textContent = label(it);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => { onPick(it); render(); });
    host.appendChild(b);
  }
}
buttons(document.getElementById('faces'), FACES.map(([m, n]) => ({ value: `${m}x${n}`, m, n })), 'face', (f) => `${f.m} × ${f.n}`, (f) => { state.m = f.m; state.n = f.n; });
buttons(document.getElementById('levels'), LEVELS.map((l) => ({ value: l })), 'levels', (l) => String(l.value), (l) => { state.levels = l.value; });
document.querySelectorAll('[data-hand]').forEach((b) => b.addEventListener('click', () => { state.hand = b.dataset.hand; render(); }));
document.getElementById('v-fit').addEventListener('click', () => setCam((v) => v.fitView()));
document.getElementById('v-side').addEventListener('click', () => setCam(side));
document.getElementById('v-plan').addEventListener('click', () => setCam((v) => v.topView()));
document.getElementById('link').addEventListener('click', (e) => {
  state.link = !state.link;
  e.currentTarget.setAttribute('aria-pressed', String(state.link));
  if (state.link) copyCam(before, after);
});

paintTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);
new MutationObserver(paintTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

window.__pc = { state, render, before, after }; // test hook
render(true);
document.getElementById('loading').remove();
