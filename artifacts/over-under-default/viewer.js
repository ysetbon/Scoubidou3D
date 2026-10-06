// What does the studio do at a crossing when nobody has said? — shown on the real renderer.
//
// Two StrandScene views, the same class the app runs. The left one is the scene
// exactly as the app builds it with NO masks: layer order decides. The right one
// is the same strands with the masks a different default rule would have
// produced. Nothing is drawn by this page; it only chooses which pairs to mask,
// so the geometry on both sides is the engine's own.
import { StrandScene } from '../../src/scene/StrandScene';

const YELLOW = { r: 245, g: 200, b: 55, a: 255 };
const ORANGE = { r: 226, g: 122, b: 38, a: 255 };
const WHITE = { r: 240, g: 240, b: 240, a: 255 };
const TEAL = { r: 60, g: 170, b: 175, a: 255 };
const STROKE = { r: 30, g: 30, b: 30, a: 255 };

function mk(id, start, end, color, width, cp1, cp2) {
  return {
    id, start, end,
    control_points: [cp1 ?? { ...start }, cp2 ?? { ...start }],
    control_point_center: null,
    control_point_center_locked: false,
    triangleHasMoved: !!(cp1 || cp2),
    cp2Activated: !!cp2,
    width,
    stroke_width: 4,
    color,
    stroke_color: STROKE,
    thickness: null,
    visible: true,
    isMask: false,
    hasCircles: [false, false],
    parentId: null,
    parentSide: null,
  };
}

// ---- the samples: n horizontals h0.., then n verticals v0.. ------------------
// Stack order is h first, v last, which is what drawing a row and then a column
// gives you in the app. Crossing (i, j) is h_i against v_j, and j is also how far
// along h_i it sits, i how far along v_j.
const rot = (p, deg) => {
  const a = (deg * Math.PI) / 180;
  const dx = p.x - 400;
  const dy = p.y - 250;
  return { x: 400 + dx * Math.cos(a) - dy * Math.sin(a), y: 250 + dx * Math.sin(a) + dy * Math.cos(a) };
};

function lattice({ ys, xs, w, hx = [130, 670], vy = [110, 430], deg = 0, bow = 0 }) {
  const strands = [];
  const R = (p) => (deg ? rot(p, deg) : p);
  ys.forEach((y, i) => {
    const cps = bow
      ? [R({ x: 285, y: y - bow }), R({ x: 515, y: y + bow })]
      : [undefined, undefined];
    strands.push(mk(`h${i}`, R({ x: hx[0], y }), R({ x: hx[1], y }), i % 2 ? ORANGE : YELLOW, w, cps[0], cps[1]));
  });
  xs.forEach((x, j) => {
    const cps = bow
      ? [R({ x: x + bow, y: 190 }), R({ x: x - bow, y: 350 })]
      : [undefined, undefined];
    strands.push(mk(`v${j}`, R({ x, y: vy[0] }), R({ x, y: vy[1] }), j % 2 ? WHITE : TEAL, w, cps[0], cps[1]));
  });
  return { n: ys.length, m: xs.length, strands };
}

const SAMPLES = {
  g3: { label: '3 × 3', build: () => lattice({ ys: [165, 270, 375], xs: [250, 400, 550], w: 50 }) },
  g5: {
    label: '5 × 5',
    build: () => lattice({
      ys: [110, 180, 250, 320, 390], xs: [180, 290, 400, 510, 620], w: 42,
      hx: [120, 680], vy: [70, 430],
    }),
  },
  diamond: {
    label: 'Diamond 4 × 4',
    build: () => lattice({ ys: [150, 215, 280, 345], xs: [200, 330, 460, 590], w: 46, hx: [140, 660], vy: [110, 390], deg: 45 }),
  },
  curved: {
    label: 'Curved 3 × 3',
    build: () => lattice({ ys: [165, 270, 375], xs: [250, 400, 550], w: 50, vy: [110, 430], bow: 72 }),
  },
};

// ---- the rules: does v_j ride over h_i at crossing (i, j)? -------------------
// "Over" is the vertical, the higher layer, so the first rule is today's.
const RULES = {
  layer: { label: 'Layer order', over: () => true },
  plain: { label: 'Plain weave', over: (i, j) => (i + j) % 2 === 0 },
  twill: { label: 'Twill 2/1', over: (i, j) => (i + j) % 3 !== 2 },
  basket: { label: 'Basket 2×2', over: (i, j) => (Math.floor(i / 2) + Math.floor(j / 2)) % 2 === 0 },
};

function sceneFor(sampleKey, ruleKey, flip) {
  const { strands, n, m } = SAMPLES[sampleKey].build();
  const masks = [];
  if (ruleKey !== 'layer') {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        const vOver = RULES[ruleKey].over(i, j) !== flip;
        masks.push(vOver ? { overId: `v${j}`, underId: `h${i}` } : { overId: `h${i}`, underId: `v${j}` });
      }
    }
  }
  return { name: `${SAMPLES[sampleKey].label} · ${RULES[ruleKey].label}`, strands, masks, levelBreaks: [] };
}

// ---- two real views -----------------------------------------------------------
function paintTheme(views) {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  views.forEach((v) => v.setTheme(dark ? 'dark' : 'light'));
}

const today = new StrandScene(document.getElementById('c-today'));
const prop = new StrandScene(document.getElementById('c-prop'));
const views = [today, prop];
// Two shadow maps of 2048² each is the one thing that makes a page without a GPU
// crawl, and the shadow says nothing about who is over whom.
views.forEach((v) => { v.renderer.shadowMap.enabled = false; });

const state = { sample: 'g3', rule: 'plain', flip: false, link: true };

// ---- the ledger: what the engine actually decided, strand by strand --------------
function ledger(view, host, summary) {
  const strands = view.getScene().strands;
  const pts = view.getCrossPoints();
  let both = 0;
  let twice = 0;
  host.textContent = '';
  strands.forEach((s, idx) => {
    const seq = [];
    for (const p of pts) {
      if (p.aIndex === idx) seq.push({ s: p.sA, over: p.overIndex === idx });
      else if (p.bIndex === idx) seq.push({ s: p.sB, over: p.overIndex === idx });
    }
    seq.sort((a, b) => a.s - b.s);
    const hasO = seq.some((x) => x.over);
    const hasU = seq.some((x) => !x.over);
    if (hasO && hasU) both++;
    const row = document.createElement('div');
    row.className = 'lrow';
    const name = document.createElement('span');
    name.className = 'lname';
    name.textContent = s.id;
    row.appendChild(name);
    for (const x of seq) {
      const c = document.createElement('i');
      c.className = x.over ? 'o' : 'u';
      c.textContent = x.over ? 'over' : 'under';
      row.appendChild(c);
    }
    host.appendChild(row);
  });
  for (const f of view.getCrossings()) if (f.count > 1) twice++;
  summary.textContent = `${both} of ${strands.length} laces go both over and under` +
    (twice ? ` · ${twice} pair${twice > 1 ? 's' : ''} cross more than once` : '');
  summary.className = both === strands.length ? 'sum ok' : 'sum off';
}

let framed = '';
function render() {
  const { sample, rule, flip } = state;
  today.setScene(sceneFor(sample, 'layer', false), false);
  prop.setScene(sceneFor(sample, rule, flip), false);
  if (framed !== sample) {
    low(today);
    syncFrom(today);
    framed = sample;
  }
  ledger(today, document.getElementById('l-today'), document.getElementById('s-today'));
  ledger(prop, document.getElementById('l-prop'), document.getElementById('s-prop'));
  document.getElementById('prop-name').textContent = RULES[rule].label + (flip && rule !== 'layer' ? ' · flipped' : '');
  document.querySelectorAll('[data-sample]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.sample === sample)));
  document.querySelectorAll('[data-rule]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.rule === rule)));
  document.getElementById('flip').setAttribute('aria-pressed', String(flip));
  document.querySelectorAll('[data-rule-note]').forEach((n) => { n.hidden = n.dataset.ruleNote !== rule; });
}

// ---- cameras: orbit one, the other follows ----------------------------------------
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
  copyCam(src, src === today ? prop : today);
  syncing = false;
}
today.controls.addEventListener('change', () => syncFrom(today));
prop.controls.addEventListener('change', () => syncFrom(prop));

function low(v) {
  v.fitView();
  const d = v.camera.position.length() * 0.82;
  v.camera.position.set(0.3, -1.0, 0.38).normalize().multiplyScalar(d);
  v.controls.update();
}
function tilt(v) { v.fitView(); }
function plan(v) { v.topView(); }
function setCam(fn) {
  const was = state.link;
  state.link = false;
  views.forEach(fn);
  state.link = was;
  copyCam(today, prop);
}
document.getElementById('v-low').addEventListener('click', () => setCam(low));
document.getElementById('v-tilt').addEventListener('click', () => setCam(tilt));
document.getElementById('v-plan').addEventListener('click', () => setCam(plan));
document.getElementById('link').addEventListener('click', (e) => {
  state.link = !state.link;
  e.currentTarget.setAttribute('aria-pressed', String(state.link));
  if (state.link) copyCam(today, prop);
});

// ---- controls -------------------------------------------------------------------
document.querySelectorAll('[data-sample]').forEach((b) =>
  b.addEventListener('click', () => { state.sample = b.dataset.sample; render(); }));
document.querySelectorAll('[data-rule]').forEach((b) =>
  b.addEventListener('click', () => { state.rule = b.dataset.rule; render(); }));
document.getElementById('flip').addEventListener('click', () => { state.flip = !state.flip; render(); });

// The numbers the engine is running with, read off the view rather than typed in.
const p = today.getParams();
document.getElementById('p-thick').textContent = p.thickness;
document.getElementById('p-depth').textContent = p.weaveDepth;
document.getElementById('p-depth2').textContent = p.weaveDepth;
document.getElementById('p-lift').textContent = p.layerGap;
document.getElementById('p-span').textContent = p.weaveSpan;

paintTheme(views);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => paintTheme(views));
new MutationObserver(() => paintTheme(views)).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});

render();
document.getElementById('loading').remove();
