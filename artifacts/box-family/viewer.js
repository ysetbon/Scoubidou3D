// The page's own studio — and this time that is meant literally.
//
// Every other artifact here bakes its meshes: a headless studio builds them and
// the page replays what it was handed. That cannot work for a family. All 64 box
// faces at ten rounds each is 640 scenes and hundreds of megabytes of mesh, and
// a page you cannot open settles nothing.
//
// So this page carries `StrandScene` — the studio's own view, the same class the
// app runs — and `boxStitchMN`, the same builder the app's Browse grid calls. It
// builds what you ask for, when you ask for it. The promise the bake made by
// construction ("the page cannot disagree with the app") this keeps by identity:
// there is no second implementation to disagree with, because it IS the app.
import { StrandScene } from '../../src/scene/StrandScene';
import { boxStitchMN, BOX_MAX } from '../../src/model/boxmn';

const ROUNDS_MAX = 10;
const canvas = document.getElementById('c');
const view = new StrandScene(canvas);

// One departure from the studio's own settings, and it is not about the model.
// A ten-round 8×8 is 368 ribbons, each casting and receiving into a 2048² shadow
// map; on a machine without a real GPU that alone drops the page to a crawl. The
// shadow says nothing this page is for — the weave is read off the over/unders
// and the storeys, not off contact shadows — so it goes. Every vertex stays
// exactly where the app puts it.
view.renderer.shadowMap.enabled = false;

const state = { m: 3, n: 2, hand: 'lh', rounds: 1 };
const set = (id, text) => (document.getElementById(id).textContent = text);

// A face at a depth costs a rebuild, and the big ones are not free, so what has
// been built is kept. `boxStitchMN` is pure, so a cached scene is the same object
// it would build again.
const built = new Map();
function scene(m, n, hand, rounds) {
  const key = `${hand}-${m}x${n}-${rounds}`;
  if (!built.has(key)) {
    built.set(
      key,
      boxStitchMN(m, n, `Box stitch — ${m}×${n} ${hand.toUpperCase()}, ${rounds} rounds`, hand, rounds),
    );
  }
  return built.get(key);
}

function paintTheme() {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  view.setTheme(dark ? 'dark' : 'light');
}

let framed = '';
function render(refit) {
  const { m, n, hand, rounds } = state;
  view.setScene(scene(m, n, hand, rounds), false);
  // Refit when the shape changes, not when the slider moves: a column growing
  // under a camera that keeps still is the thing worth watching.
  const shape = `${hand}-${m}x${n}`;
  if (refit || shape !== framed) {
    view.fitView();
    framed = shape;
  }

  set('facename', `${m} × ${n}`);
  set('depth-n', rounds);
  set('hand', hand === 'lh' ? 'left hand · cw' : 'right hand · ccw');
  set('ribbons', m + n);
  set('strands', 3 * (m + n) + 2 * (m + n) * rounds);
  set('masks', 2 * m * n * (rounds + 1));
  set('footprint', `${112 * (m + 1)} × ${112 * (n + 1)}`);
  const load = Math.max(m, n) / Math.min(m, n);
  const badge = document.getElementById('load');
  badge.textContent = load === 1
    ? 'balanced — every ribbon binds the same'
    : `${load.toFixed(load % 1 ? 1 : 0)}× — one ribbon does that much more of the binding`;
  badge.className = load === 1 ? 'ok' : 'off';

  document.querySelectorAll('.cell').forEach((b) =>
    b.setAttribute('aria-pressed', String(+b.dataset.m === m && +b.dataset.n === n)));
  document.querySelectorAll('[data-hand]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.hand === hand)));
}

// ---- the 8×8 picker ---------------------------------------------------------
// m across and n down, so a cell sits where its own face's shape does — the same
// grid the studio's Browse panel lays the family out on.
const grid = document.getElementById('grid');
let html = '<span class="ax corner">m→<br>n↓</span>';
for (let m = 1; m <= BOX_MAX; m++) html += `<span class="ax">${m}</span>`;
for (let n = 1; n <= BOX_MAX; n++) {
  html += `<span class="ax">${n}</span>`;
  for (let m = 1; m <= BOX_MAX; m++) {
    html += `<button type="button" class="cell" data-m="${m}" data-n="${n}"` +
      ` aria-pressed="false" aria-label="${m} by ${n}">${m}×${n}</button>`;
  }
}
grid.innerHTML = html;

grid.addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  state.m = +cell.dataset.m;
  state.n = +cell.dataset.n;
  render();
});
grid.addEventListener('keydown', (e) => {
  const cell = e.target.closest('.cell');
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!cell || !d) return;
  e.preventDefault();
  const m = Math.min(BOX_MAX, Math.max(1, +cell.dataset.m + d[0]));
  const n = Math.min(BOX_MAX, Math.max(1, +cell.dataset.n + d[1]));
  const next = grid.querySelector(`.cell[data-m="${m}"][data-n="${n}"]`);
  if (next) {
    next.focus();
    state.m = m;
    state.n = n;
    render();
  }
});

const slider = document.getElementById('depth');
slider.max = String(ROUNDS_MAX);
slider.addEventListener('input', () => {
  state.rounds = Number(slider.value);
  render();
});

document.querySelectorAll('[data-hand]').forEach((b) =>
  b.addEventListener('click', () => {
    state.hand = b.dataset.hand;
    render();
  }));
document.getElementById('fit').addEventListener('click', () => view.fitView());
document.getElementById('top').addEventListener('click', () => view.topView());

paintTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);
new MutationObserver(paintTheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});

render(true);
document.getElementById('loading').remove();
