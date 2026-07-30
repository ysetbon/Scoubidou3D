// Squeeze a bake down to something that can live inside one HTML file.
//
// Float32 positions and Uint32 indices are most of an artifact's weight, and both
// are far more precision than a page you orbit needs. Positions are quantised to
// Int16 against the level's own bounding box — a 1x1 column is ~11 units tall, so
// a step is well under a thousandth of a lace width — and indices drop to Uint16
// wherever the mesh is small enough. What is left is deflated and base64'd, which
// the page undoes with DecompressionStream.
import { deflateSync } from 'node:zlib';

// Node pools small Buffers, so `Buffer.from(b64, 'base64').buffer` is a shared
// arena and slicing it reads whatever else happens to be in there. Copy the exact
// bytes out before casting — this cost an afternoon once.
function view(b64, Ctor) {
  const b = Buffer.from(b64, 'base64');
  const copy = new ArrayBuffer(b.length);
  new Uint8Array(copy).set(b);
  return new Ctor(copy);
}

export function pack(baked, levels = null) {
  const chunks = [];
  const meta = {};
  let offset = 0;

  for (const [level, data] of Object.entries(baked)) {
    if (levels && !levels.includes(level)) continue;
    const floats = data.parts.map((p) => view(p.pos, Float32Array));

    // One bounding box per level, shared by every part, so the parts still line
    // up with each other after the round trip.
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const f of floats) {
      for (let i = 0; i < f.length; i++) {
        const k = i % 3;
        if (f[i] < lo[k]) lo[k] = f[i];
        if (f[i] > hi[k]) hi[k] = f[i];
      }
    }
    const scale = [0, 1, 2].map((k) => (hi[k] - lo[k]) / 65534 || 1);

    const parts = data.parts.map((p, pi) => {
      const f = floats[pi];
      const q = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) {
        q[i] = Math.round((f[i] - lo[i % 3]) / scale[i % 3]) - 32767;
      }
      const posOff = offset;
      chunks.push(Buffer.from(q.buffer));
      offset += q.byteLength;

      const raw = view(p.idx, Uint32Array);
      const small = f.length / 3 <= 65535;
      const packed = small ? Uint16Array.from(raw) : raw;
      const idxOff = offset;
      chunks.push(Buffer.from(packed.buffer));
      offset += packed.byteLength;

      return {
        color: p.color,
        side: p.side,
        basic: p.basic,
        polygonOffset: p.polygonOffset,
        outline: p.outline,
        posOff,
        posCount: q.length,
        idxOff,
        idxCount: raw.length,
        idx16: small,
      };
    });
    meta[level] = { lo, scale, parts };
  }

  const blob = deflateSync(Buffer.concat(chunks), { level: 9 });
  return { meta, blob: blob.toString('base64'), rawBytes: offset };
}
