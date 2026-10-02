// Deterministic hashing. Mirrors tools/darsi/rng.py exactly so the Python
// build pipeline and the JS runtime agree on every procedural decision.

const MASK = 0xffffffff;

export function hashU32(...vals) {
  let h = 2166136261 >>> 0;
  for (let k = 0; k < vals.length; k++) {
    const v = (vals[k] | 0) >>> 0;
    for (let shift = 0; shift < 32; shift += 8) {
      h = (h ^ ((v >>> shift) & 0xff)) >>> 0;
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 3266489917) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h >>> 0;
}

export function hashF(...vals) {
  return hashU32(...vals) / 4294967296;
}

export function randRange(lo, hi, ...vals) {
  return lo + (hi - lo) * hashF(...vals);
}

export function pick(arr, ...vals) {
  return arr[hashU32(...vals) % arr.length];
}

/** Small stateful deterministic stream. */
export class Rng {
  constructor(seed) {
    this.s = hashU32(seed | 0, 0x9e3779b9 | 0);
  }
  u32() {
    this.s = hashU32(this.s, 0x85ebca6b | 0);
    return this.s;
  }
  f() {
    return this.u32() / 4294967296;
  }
  range(lo, hi) {
    return lo + (hi - lo) * this.f();
  }
  int(lo, hi) {
    return lo + (this.u32() % Math.max(1, hi - lo + 1));
  }
  pick(arr) {
    return arr[this.u32() % arr.length];
  }
  chance(p) {
    return this.f() < p;
  }
  // Signed value in [-1, 1]
  sym() {
    return this.f() * 2 - 1;
  }
}

/** 2D value noise, used for texture/scatter variety (not for terrain shape). */
export function valueNoise2(x, y, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hashF(ix, iy, seed);
  const n10 = hashF(ix + 1, iy, seed);
  const n01 = hashF(ix, iy + 1, seed);
  const n11 = hashF(ix + 1, iy + 1, seed);
  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
}

export function fbm2(x, y, octaves = 4, seed = 0) {
  let total = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let o = 0; o < octaves; o++) {
    total += amp * valueNoise2(fx, fy, seed + o * 131);
    norm += amp;
    amp *= 0.5;
    fx *= 2.03;
    fy *= 2.03;
  }
  return total / norm;
}
