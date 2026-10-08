// Does any ribbon pass through another? A volumetric check on the studio's own
// built laces, not a centreline-distance one.
//
// The check the twist pages used so far asked whether two CENTRELINES came within
// 23 px in plan and 20 px in height. That is not the question. A ribbon is 46 px
// wide and 26 px thick, so two of them occupy the same space when their
// FOOTPRINTS overlap and their heights differ by less than a thickness — and the
// footprint of a ribbon crossing another at a shallow angle reaches far past 23 px
// of centreline distance (23 / sin θ along the other's axis), while a height gap
// of 20 px already leaves 6 px of ribbon inside the other. A pair can pass the old
// test and still be one lace through the other.
//
// So this slices every lace's built centreline every few px into a small box
// (a slice of the sweep: `length` along, the lace's width across, its thickness
// up), in the same frame the sweep uses, and asks the separating-axis test for
// every pair of boxes that are not neighbours on one lace. The depth it reports
// is how far the two have to move apart to clear, in source px — the smallest
// overlap over the 15 axes — so 0 means touching or clear and 26 means one
// ribbon sits fully inside the other's thickness.
//
// What it reads is `view.laceCenterlines`: the woven centreline of each whole
// lace, folds' own frames included. Nothing is re-derived.

const SCALE = 0.02; // world units per source px — StrandScene's

function frameAt(line, i) {
  const a = line[Math.max(0, i - 1)];
  const b = line[Math.min(line.length - 1, i + 1)];
  let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
  const run = Math.hypot(tx, ty);
  const tl = Math.hypot(tx, ty, tz) || 1;
  const t = { x: tx / tl, y: ty / tl, z: tz / tl };
  let up;
  const given = line[i].up;
  if (given) {
    up = given;
  } else if (run < 1e-9) {
    up = { x: 0, y: 0, z: 1 };
  } else {
    const slope = tz / run;
    const k = 1 / Math.hypot(1, slope);
    up = { x: (-tx / run) * slope * k, y: (-ty / run) * slope * k, z: k };
  }
  // side = up × t, normalised: for a level run it is the in-plane perpendicular.
  let sx = up.y * t.z - up.z * t.y;
  let sy = up.z * t.x - up.x * t.z;
  let sz = up.x * t.y - up.y * t.x;
  const sl = Math.hypot(sx, sy, sz) || 1;
  sx /= sl; sy /= sl; sz /= sl;
  // re-square up so the three are orthonormal
  let ux = sy * t.z - sz * t.y;
  let uy = sz * t.x - sx * t.z;
  let uz = sx * t.y - sy * t.x;
  return { t, s: { x: sx, y: sy, z: sz }, u: { x: ux, y: uy, z: uz } };
}

/** Resample one lace's centreline to a box every `step` px of arc. */
function slices(lace, step, width, thick) {
  const line = lace.line;
  const out = [];
  let arc = 0;
  let next = 0;
  for (let i = 0; i < line.length; i++) {
    if (i > 0) arc += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y, line[i].z - line[i - 1].z) / SCALE;
    if (arc < next && i !== line.length - 1) continue;
    next = arc + step;
    const f = frameAt(line, i);
    out.push({
      c: { x: line[i].x, y: line[i].y, z: line[i].z },
      ax: [f.t, f.s, f.u],
      h: [step / 2 * SCALE, (width / 2) * SCALE, (thick / 2) * SCALE],
      arc,
      owner: line[i].owner,
    });
  }
  return out;
}

// ---- the section the sweep really has --------------------------------------
// A rounded rectangle: `cornerRadius = 0.48 · thickness` (StrandScene's own), so
// at 26 px thick it is almost a stadium. Testing a box would count the corners
// the ribbon does not have, and two ribbons resting flat on each other would read
// as touching along an edge that is in fact rounded away.
const CORNER = 0.48;

/** Signed distance (px) from (u, v) to the rounded section, negative inside. */
function sdf(u, v, halfW, halfT, r) {
  const qx = Math.abs(u) - (halfW - r);
  const qy = Math.abs(v) - (halfT - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Points on the section's outline, in (u, v), `n` of them, evenly by angle-ish. */
function outline(halfW, halfT, r, perCorner = 4) {
  const pts = [];
  const cx = halfW - r, cy = halfT - r;
  for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    for (let k = 0; k <= perCorner; k++) {
      // go round each corner a quarter turn
      const a = (Math.PI / 2) * (k / perCorner);
      const ux = sx > 0 ? Math.cos(a) : -Math.cos(a);
      const uy = sy > 0 ? Math.sin(a) : -Math.sin(a);
      pts.push([sx * cx + (sx > 0 ? 1 : -1) * Math.abs(ux) * r, sy * cy + (sy > 0 ? 1 : -1) * Math.abs(uy) * r]);
    }
  }
  return pts;
}

/**
 * Every place two ribbons share space.
 *
 * @param view  a StrandScene after setScene (and setSublevels), i.e. a built one
 * @param ids   the scene's strand ids, in order — `owner` indexes into it
 * @param opts  step: px between slices (default 3); near: px of arc on one lace
 *              that count as neighbours and are skipped (default 130 — a fold's
 *              own two arms overlap in plan for about that far, and are held
 *              apart by the fold itself, not by weaving); min: ignore depths
 *              below this many px (default 0.5, the mesh's own tessellation)
 * @returns hits sorted deepest first: { depth, a, b, x, y, z } with strand ids.
 *          `depth` is how far a point on one ribbon's SURFACE sits inside the
 *          other's body, in source px.
 */
export function ribbonHits(view, ids, opts = {}) {
  const step = opts.step ?? 3;
  const near = opts.near ?? 130;
  const floor = opts.min ?? 0.5;
  const laces = view.laceCenterlines.map((l, li) => {
    const w = l.width / SCALE, t = l.thickness / SCALE;
    const r = CORNER * t;
    return { li, w, t, r, s: slices(l, step, w, t), ring: outline(w / 2, t / 2, r) };
  });
  // a hash of every slice centre, so a surface point only meets its neighbours
  const CELL = 0.7;
  const grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  laces.forEach((l, p) => l.s.forEach((sl, j) => {
    const k = key(sl.c.x, sl.c.y, sl.c.z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push([p, j]);
  }));
  const hits = new Map();
  for (let p = 0; p < laces.length; p++) {
    const A = laces[p];
    for (let i = 0; i < A.s.length; i++) {
      const sa = A.s[i];
      const [t, side, up] = sa.ax;
      for (const [u, v] of A.ring) {
        const P = {
          x: sa.c.x + (side.x * u + up.x * v) * SCALE,
          y: sa.c.y + (side.y * u + up.y * v) * SCALE,
          z: sa.c.z + (side.z * u + up.z * v) * SCALE,
        };
        const cx = Math.floor(P.x / CELL), cy = Math.floor(P.y / CELL), cz = Math.floor(P.z / CELL);
        let best = null;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const cell = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!cell) continue;
          for (const [q, j] of cell) {
            if (q === p && Math.abs(laces[q].s[j].arc - sa.arc) < near) continue;
            if (q === p && j === i) continue;
            const B = laces[q], sb = B.s[j];
            const rx = (P.x - sb.c.x) / SCALE, ry = (P.y - sb.c.y) / SCALE, rz = (P.z - sb.c.z) / SCALE;
            const [bt, bs, bu] = sb.ax;
            // only a point beside this slice, not far along its axis
            const along = rx * bt.x + ry * bt.y + rz * bt.z;
            if (Math.abs(along) > step * 0.75) continue;
            const d = -sdf(rx * bs.x + ry * bs.y + rz * bs.z, rx * bu.x + ry * bu.y + rz * bu.z, B.w / 2, B.t / 2, B.r);
            if (d > floor && (!best || d > best.d)) best = { d, q, j };
          }
        }
        if (best) {
          const sb = laces[best.q].s[best.j];
          const a = ids[sa.owner] ?? '?', b = ids[sb.owner] ?? '?';
          const k = a < b ? `${a}|${b}` : `${b}|${a}`;
          const cur = hits.get(k);
          if (!cur || best.d > cur.depth) hits.set(k, { depth: best.d, a, b, x: P.x / SCALE, y: P.y / SCALE, z: P.z / SCALE });
        }
      }
    }
  }
  return [...hits.values()].sort((x, y) => y.depth - x.depth);
}

/**
 * The over/under word of every lace: walk each lace from end to end and write down,
 * at every place its centreline crosses another lace's (or its own, far along) in
 * plan, whether it passes OVER or UNDER there, read off the built heights.
 *
 * A woven lace alternates. Over, under, over, under is what makes a braid read as
 * one — two overs in a row means a lace is merely resting on the stack and not
 * woven into it, and a twist column in which a lace goes over four crossings in a
 * row reads as a pile of rings rather than a twist. The panel's own checks ask
 * whether the right lace is on top at each crossing; this asks whether the
 * crossings, taken in the order a lace meets them, are the ones a weaver would
 * make.
 *
 * @returns per lace: { word: 'OUOU…', steps: [{ arc, over, level?, dz, x, y }] }
 */
export function laceWords(view, ids, levelOf) {
  const laces = view.laceCenterlines.map((l) => l.line);
  const arcs = laces.map((line) => {
    const a = [0];
    for (let i = 1; i < line.length; i++) a.push(a[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y) / SCALE);
    return a;
  });
  const out = laces.map(() => []);
  const inter = (p1, p2, p3, p4) => {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (Math.abs(d) < 1e-12) return null;
    const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
    return t > 0 && t < 1 && u > 0 && u < 1 ? { t, u } : null;
  };
  for (let a = 0; a < laces.length; a++) {
    for (let b = a; b < laces.length; b++) {
      const A = laces[a], B = laces[b];
      for (let i = 0; i + 1 < A.length; i++) {
        for (let j = a === b ? i + 1 : 0; j + 1 < B.length; j++) {
          // neighbours on one lace share a fold, which is not a crossing
          if (a === b && Math.abs(arcs[a][j] - arcs[a][i]) < 130) continue;
          const hit = inter(A[i], A[i + 1], B[j], B[j + 1]);
          if (!hit) continue;
          const za = A[i].z + (A[i + 1].z - A[i].z) * hit.t;
          const zb = B[j].z + (B[j + 1].z - B[j].z) * hit.u;
          const x = (A[i].x + (A[i + 1].x - A[i].x) * hit.t) / SCALE;
          const y = (A[i].y + (A[i + 1].y - A[i].y) * hit.t) / SCALE;
          const arcA = arcs[a][i] + (arcs[a][i + 1] - arcs[a][i]) * hit.t;
          const arcB = arcs[b][j] + (arcs[b][j + 1] - arcs[b][j]) * hit.u;
          const oa = ids[A[i].owner], ob = ids[B[j].owner];
          out[a].push({ arc: arcA, over: za > zb, dz: (za - zb) / SCALE, x, y, with: ob, mine: oa, la: levelOf?.(oa), lb: levelOf?.(ob) });
          if (a !== b || true) out[b].push({ arc: arcB, over: zb > za, dz: (zb - za) / SCALE, x, y, with: oa, mine: ob, la: levelOf?.(ob), lb: levelOf?.(oa) });
        }
      }
    }
  }
  return out.map((steps) => {
    steps.sort((p, q) => p.arc - q.arc);
    // two samples of one crossing (a vertex shared by two segments) are one crossing
    const dedup = [];
    for (const s of steps) {
      const last = dedup[dedup.length - 1];
      if (last && Math.hypot(last.x - s.x, last.y - s.y) < 6 && last.with === s.with) continue;
      dedup.push(s);
    }
    return { word: dedup.map((s) => (s.over ? 'O' : 'U')).join(''), steps: dedup };
  });
}

// ---- the surfaces themselves -------------------------------------------------
// The slice test above reasons about the ribbon from its centreline. This one asks
// the question literally: do any two TRIANGLES of the built ribbons cut through
// each other? Two surfaces that cross are one ribbon passing through another —
// there is no other way for it to happen — and two that merely rest on one
// another, however tightly, do not cross.

/** Möller's triangle–triangle test (interval overlap on the planes' line). */
function triTri(a0, a1, a2, b0, b1, b2, wantDepth = false) {
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const crs = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const dt = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const EPS = 1e-7;
  const nB = crs(sub(b1, b0), sub(b2, b0));
  const nl = Math.hypot(nB[0], nB[1], nB[2]);
  if (nl < 1e-12) return false;
  const dB = -dt(nB, b0);
  let da0 = dt(nB, a0) + dB, da1 = dt(nB, a1) + dB, da2 = dt(nB, a2) + dB;
  const e = EPS * nl;
  if (Math.abs(da0) < e) da0 = 0;
  if (Math.abs(da1) < e) da1 = 0;
  if (Math.abs(da2) < e) da2 = 0;
  if ((da0 > 0 && da1 > 0 && da2 > 0) || (da0 < 0 && da1 < 0 && da2 < 0)) return false;
  const nA = crs(sub(a1, a0), sub(a2, a0));
  const nal = Math.hypot(nA[0], nA[1], nA[2]);
  if (nal < 1e-12) return false;
  const dA = -dt(nA, a0);
  let db0 = dt(nA, b0) + dA, db1 = dt(nA, b1) + dA, db2 = dt(nA, b2) + dA;
  const f = EPS * nal;
  if (Math.abs(db0) < f) db0 = 0;
  if (Math.abs(db1) < f) db1 = 0;
  if (Math.abs(db2) < f) db2 = 0;
  if ((db0 > 0 && db1 > 0 && db2 > 0) || (db0 < 0 && db1 < 0 && db2 < 0)) return false;
  // coplanar: resting on each other, not passing through
  if (da0 === 0 && da1 === 0 && da2 === 0) return false;
  const D = crs(nA, nB);
  const ax = Math.abs(D[0]) > Math.abs(D[1]) ? (Math.abs(D[0]) > Math.abs(D[2]) ? 0 : 2) : (Math.abs(D[1]) > Math.abs(D[2]) ? 1 : 2);
  const interval = (v0, v1, v2, d0, d1, d2) => {
    // order so that v0 is the lone vertex on its side
    let p0 = v0[ax], p1 = v1[ax], p2 = v2[ax];
    let q0 = d0, q1 = d1, q2 = d2;
    if (q0 * q1 > 0) { [p0, p1, p2] = [p2, p0, p1]; [q0, q1, q2] = [q2, q0, q1]; }
    else if (q0 * q2 > 0) { [p0, p1, p2] = [p1, p2, p0]; [q0, q1, q2] = [q1, q2, q0]; }
    else if (!(q1 * q2 > 0) && q0 !== 0) { /* v0 alone */ }
    else if (q1 * q2 > 0) { /* v0 alone */ }
    const t1 = p0 + ((p1 - p0) * q0) / (q0 - q1 || 1e-30);
    const t2 = p0 + ((p2 - p0) * q0) / (q0 - q2 || 1e-30);
    return t1 < t2 ? [t1, t2] : [t2, t1];
  };
  const ia = interval(a0, a1, a2, da0, da1, da2);
  const ib = interval(b0, b1, b2, db0, db1, db2);
  const hit = !(ia[1] < ib[0] || ib[1] < ia[0]);
  if (!wantDepth) return hit;
  if (!hit) return 0;
  // how far the smaller side of each triangle pokes through the other's plane, in world units
  const poke = (d0, d1, d2, len) => {
    const pos = Math.max(d0, d1, d2, 0), neg = Math.max(-d0, -d1, -d2, 0);
    return Math.min(pos, neg) / len;
  };
  return Math.max(poke(da0, da1, da2, nl), poke(db0, db1, db2, nal));
}

/**
 * Cluster the places where built ribbons' triangles cut through each other.
 *
 * Only the ribbons' own bodies (the fill meshes the sweep names with a strand id)
 * are read, not the outline shells. Triangles of one lace that are within `skip`
 * vertices of each other are neighbours along the sweep and are not compared.
 */
export function meshHits(view, ids, opts = {}) {
  const skip = opts.skip ?? 1500;
  const cell = 0.45;
  const bodies = [];
  view.strandGroup.traverse((o) => {
    if (o.isMesh && o.userData.strandId && o.material.type === 'MeshStandardMaterial') bodies.push(o);
  });
  const tris = [];
  bodies.forEach((m, mi) => {
    m.updateWorldMatrix(true, false);
    const pos = m.geometry.attributes.position;
    const idx = m.geometry.index;
    const n = idx ? idx.count / 3 : pos.count / 3;
    const v = (i) => {
      const k = idx ? idx.getX(i) : i;
      const p = [pos.getX(k), pos.getY(k), pos.getZ(k)];
      return { p, k };
    };
    for (let t = 0; t < n; t++) {
      const a = v(3 * t), b = v(3 * t + 1), c = v(3 * t + 2);
      tris.push({ mi, a: a.p, b: b.p, c: c.p, k: a.k });
    }
  });
  const grid = new Map();
  tris.forEach((t, i) => {
    const x0 = Math.min(t.a[0], t.b[0], t.c[0]), x1 = Math.max(t.a[0], t.b[0], t.c[0]);
    const y0 = Math.min(t.a[1], t.b[1], t.c[1]), y1 = Math.max(t.a[1], t.b[1], t.c[1]);
    const z0 = Math.min(t.a[2], t.b[2], t.c[2]), z1 = Math.max(t.a[2], t.b[2], t.c[2]);
    for (let x = Math.floor(x0 / cell); x <= Math.floor(x1 / cell); x++)
      for (let y = Math.floor(y0 / cell); y <= Math.floor(y1 / cell); y++)
        for (let z = Math.floor(z0 / cell); z <= Math.floor(z1 / cell); z++) {
          const k = `${x},${y},${z}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(i);
        }
  });
  const seen = new Set();
  const clusters = new Map();
  for (const list of grid.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = tris[list[i]], B = tris[list[j]];
        if (A.mi === B.mi && Math.abs(A.k - B.k) < skip) continue;
        const key = list[i] < list[j] ? `${list[i]}|${list[j]}` : `${list[j]}|${list[i]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const dep = triTri(A.a, A.b, A.c, B.a, B.b, B.c, true);
        if (!dep) continue;
        const cx = (A.a[0] + A.b[0] + A.c[0]) / 3, cy = (A.a[1] + A.b[1] + A.c[1]) / 3, cz = (A.a[2] + A.b[2] + A.c[2]) / 3;
        const ck = `${A.mi}|${B.mi}|${Math.round(cx / 0.6)},${Math.round(cy / 0.6)},${Math.round(cz / 0.6)}`;
        const c = clusters.get(ck) ?? { n: 0, x: cx / SCALE, y: cy / SCALE, z: cz / SCALE, laces: [bodies[A.mi].userData.strandId, bodies[B.mi].userData.strandId], mi: [A.mi, B.mi], at: [cx, cy, cz], depth: 0 };
        c.n++;
        c.depth = Math.max(c.depth, dep / SCALE);
        clusters.set(ck, c);
      }
    }
  }
  // who is where: the strand each mesh's cluster sits on, by nearest point of that mesh's own lace
  const laceOfMesh = bodies.map((m) => {
    const head = ids.indexOf(m.userData.strandId);
    return view.laceCenterlines.find((l) => l.chain.includes(head));
  });
  const list = [...clusters.values()];
  for (const c of list) {
    c.on = c.mi.map((mi) => {
      const lace = laceOfMesh[mi];
      if (!lace) return null;
      let best = null, d = Infinity;
      for (const q of lace.line) {
        const e = (q.x - c.at[0]) ** 2 + (q.y - c.at[1]) ** 2 + (q.z - c.at[2]) ** 2;
        if (e < d) { d = e; best = q; }
      }
      return best ? ids[best.owner] : null;
    });
  }
  return { triangles: tris.length, pairs: seen.size, clusters: list.sort((p, q) => q.n - p.n) };
}
