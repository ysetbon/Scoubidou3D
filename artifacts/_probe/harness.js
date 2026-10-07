import { StrandScene } from '../../src/scene/StrandScene';
import { twistColumnDecided, TWIST_1X1_FIXED } from '../../src/model/twistplaced';
import { twistColumnTurnsPlaced, twistColumnPlaced } from '../../src/model/twistplaced';
import { boxStitchMN } from '../../src/model/boxmn';
import RING from '../twist-1x1-ways/engine-ring.json';
import { ringColumn } from '../../src/model/ringcolumn';
import { boxPlacements } from '../../src/model/boxmn';
import { INDIGO, WEFT, twoFanColumn } from '../../src/model/twofan';
import { ribbonHits, laceWords, meshHits } from '../lib/ribbon-check.js';
const RUNG = 0.5;
const view = new StrandScene(document.getElementById('c'));
function show(sc) {
  view.setScene(sc, false);
  const map = new Map(Object.entries(sc.planes ?? {}).map(([id, r]) => [id, { in: r * RUNG, out: r * RUNG }]));
  for (const [id, e] of Object.entries(sc.planeEnds ?? {})) {
    const rest = sc.planes?.[id] ?? 0;
    map.set(id, { in: (e.in ?? rest) * RUNG, out: (e.out ?? rest) * RUNG });
  }
  view.setSublevels(map.size ? map : null);
  const cross = Object.entries(sc.crossPlanes ?? {});
  view.setCrossingPlanes(cross.length ? new Map(cross.map(([k, r]) => [k, r * RUNG])) : null);
}
window.H = {
  view, show,
  twist(levels, hand = 'rh', fix = true) {
    const sc = twistColumnPlaced(1, 1, levels, 't', hand, true, 'hand', fix);
    show(sc); return sc;
  },
  box(levels, hand = 'rh') { const sc = boxStitchMN(1, 1, 'b', hand, levels - 1, true, 'hand'); show(sc); return sc; },
  engine(levels, hand = 'rh', fix = true) {
    const sc = ringColumn(RING, levels - 1, 'e', { first: WEFT[0], second: INDIGO }, hand);
    const pl = boxPlacements(sc, 1, false, 'hand');
    if (fix && levels > 2) {
      const ends = { ...(pl.planeEnds ?? {}) };
      for (const st of sc.strands) { const l = Number(st.id.split('_')[1]); if (l === 4 || l === 5) ends[st.id] = { ...ends[st.id], out: 0 }; }
      pl.planeEnds = ends;
    }
    const full = { ...sc, ...pl }; show(full); return full;
  },
  words(sc) { return laceWords(view, sc.strands.map((s) => s.id), (id) => { const l = Number(id.split('_')[1]); return l < 4 ? 1 : Math.floor((l - 2) / 2) + 1; }); },
  mesh(sc, opts) { return meshHits(view, sc.strands.map((s) => s.id), opts); },
  hits(sc, opts) { return ribbonHits(view, sc.strands.map((s) => s.id), opts); },
  levelOf: (id) => { const l = Number(id.split('_')[1]); return l < 4 ? 1 : Math.floor((l - 2) / 2) + 1; },
};

const W = 46, SCALE = 0.02;
const layer = (id) => Number(id.split('_')[1]);
const levelOf = (id) => (layer(id) < 4 ? 1 : Math.floor((layer(id) - 2) / 2) + 1);
const lace = (id) => id.split('_')[0];
H.readLevels = function (sc, levels) {
  const view = H.view; const th = view.getThicknessWorld();
  const lines = {}; for (const st of sc.strands) lines[st.id] = view.getStrandCentrelineWorld(st.id);
  const nearest = (line, x, y) => { let best = line[0], d = Infinity; for (const q of line) { const e = (q.x - x) ** 2 + (q.y - y) ** 2; if (e < d) { d = e; best = q; } } return best; };
  const rows = [];
  for (let L = 1; L <= levels; L++) {
    let n = 0, right = 0, worst = Infinity;
    for (const c of view.getCrossPoints()) {
      if (lace(c.aId) === lace(c.bId) || levelOf(c.aId) !== L || levelOf(c.bId) !== L || !c.woven) continue;
      const over = c.overIndex === c.aIndex ? c.aId : c.bId; const under = over === c.aId ? c.bId : c.aId;
      const gap = (nearest(lines[over], c.x, c.y).z - nearest(lines[under], c.x, c.y).z) / th;
      n++; if (gap > -0.05) right++; worst = Math.min(worst, gap);
    }
    let folds = 0, edge = Infinity, height = Infinity;
    if (L < levels) for (const s of sc.strands) {
      if (levelOf(s.id) !== L || layer(s.id) < 2) continue;
      if (!sc.strands.some((t) => t.parentId === s.id)) continue;
      folds++;
      const E = lines[s.id][lines[s.id].length - 1]; let best = { g: Infinity, dz: 0 };
      for (const t of sc.strands) { if (levelOf(t.id) !== L || lace(t.id) === lace(s.id)) continue;
        for (const q of lines[t.id]) { const g = Math.hypot(E.x - q.x, E.y - q.y) / SCALE - W / 2; if (g < best.g) best = { g, dz: Math.abs(E.z - q.z) / SCALE }; } }
      if (best.g < edge) { edge = best.g; height = best.dz; }
    }
    rows.push({ L, n, right, worst: +worst.toFixed(2), folds, edge: +edge.toFixed(1), height: +height.toFixed(1) });
  }
  return rows;
};

H.turnsScene = function (levels, deg, hand = 'rh') {
  const sc = twistColumnTurnsPlaced(1, 1, levels, deg.map((d) => (d * Math.PI) / 180), 't', hand, true);
  H.show(sc); return sc;
};
H.own = function (sc, levels) {
  const L = {}; for (const s of sc.strands) L[s.id] = H.view.getStrandCentrelineWorld(s.id);
  const ids = sc.strands.map((s) => s.id); const parent = Object.fromEntries(sc.strands.map((s) => [s.id, s.parentId]));
  const per = {}; for (let l = 1; l <= levels; l++) per[l] = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j]; if (parent[a] === b || parent[b] === a) continue;
    const la = levelOf(a), lb = levelOf(b); if (la === 1 && lb === 1) continue;
    let w = 0; for (const P of L[a]) for (const Q of L[b]) { const dxy = Math.hypot(P.x - Q.x, P.y - Q.y) / SCALE, dz = Math.abs(P.z - Q.z) / SCALE; if (dxy < 23 && dz < 20) w = Math.max(w, Math.min(23 - dxy, 20 - dz)); }
    if (w > 3) per[Math.max(la, lb)] = Math.max(per[Math.max(la, lb)], Math.round(w));
  }
  return per;
};

H.decided = function (levels, hand = 'rh') { const sc = twistColumnDecided(levels, TWIST_1X1_FIXED, 'd', hand); H.show(sc); return sc; };
H.heights = function (sc) {
  const out = [];
  sc.strands.forEach((s, i) => {
    const line = H.view.wovenLines[i]; if (!line) return;
    const z = (q) => +(q.z / SCALE).toFixed(1);
    const zs = line.map((q) => q.z / SCALE);
    out.push({ id: s.id, level: levelOf(s.id), plane: sc.planes?.[s.id], ends: sc.planeEnds?.[s.id], start: z(line[0]), mid: z(line[Math.floor(line.length / 2)]), end: z(line[line.length - 1]), min: +Math.min(...zs).toFixed(1), max: +Math.max(...zs).toFixed(1) });
  });
  return out;
};
H.crossTable = function (sc) { return sc.crossPlanes ?? {}; };

H.decidedWith = function (levels, dec, hand = 'rh') { const sc = twistColumnDecided(levels, dec, 'd', hand); H.show(sc); return sc; };
