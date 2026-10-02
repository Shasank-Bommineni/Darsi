// Road ribbon generator.
//
// Each surveyed OSM way becomes a strip of quads that follows the carved
// terrain. On top of the carriageway we add, deterministically and in
// *geometry*, the things that make an Indian district road read correctly:
//
//   * crown/camber so water sheds to the edges
//   * an earth shoulder that is lower than the asphalt, with a broken edge
//   * patched repairs (darker, slightly proud) and worn depressions
//   * real potholes: a depressed rim of vertices, not a black decal
//   * centre line that fades/disappears by road class and condition
//   * speed breakers where OSM records traffic calming
//
// The same seed produces the same road every run, and the physics layer reads
// the identical functions so the bike feels what you can see.

import { clamp, clamp01, lerp, smoothstep } from '../core/util.js';
import { hashF, hashU32, Rng, valueNoise2 } from '../core/rng.js';

const SURFACE_COLOR = {
  asphalt: [0.40, 0.395, 0.385],
  concrete: [0.62, 0.615, 0.60],
  gravel: [0.56, 0.52, 0.45],
  dirt: [0.60, 0.50, 0.37],
};

export const LANE_SIDE = -1; // India drives on the LEFT

/** Potholes/patches for an edge, as deterministic feature lists. */
export function roadFeatures(edge) {
  if (edge._features) return edge._features;
  const rng = new Rng(hashU32(edge.i, 0x9a71));
  const q = edge.q;
  const len = edge.len;
  const w = edge.w;

  const potholes = [];
  const patches = [];
  const roughStretches = [];

  // Pothole density rises sharply as quality falls. Good highways: almost none.
  const phPerKm = Math.max(0, (0.72 - q) * 46) * (edge.cls === 'farm' ? 0.4 : 1);
  const nPh = Math.round((len / 1000) * phPerKm);
  for (let i = 0; i < nPh; i++) {
    const s = rng.range(2, Math.max(3, len - 2));
    // potholes cluster near the edges and at junction approaches
    const edgeBias = rng.f() < 0.62;
    const off = edgeBias
      ? (rng.f() < 0.5 ? -1 : 1) * rng.range(w * 0.22, w * 0.46)
      : rng.range(-w * 0.3, w * 0.3);
    const r = rng.range(0.28, 0.95) * (1 + (0.7 - q));
    potholes.push({ s, off, r: Math.min(r, w * 0.3), depth: rng.range(0.05, 0.14) * (1.3 - q) });
  }

  const nPatch = Math.round((len / 1000) * (10 + (1 - q) * 46));
  for (let i = 0; i < nPatch; i++) {
    patches.push({
      s: rng.range(0, Math.max(1, len)),
      off: rng.range(-w * 0.34, w * 0.34),
      rl: rng.range(0.8, 4.2),
      rw: rng.range(0.5, Math.max(0.6, w * 0.4)),
      tone: rng.range(-0.14, -0.04),
      proud: rng.range(0.004, 0.018),
    });
  }

  const nRough = Math.round((len / 1000) * (1 - q) * 9);
  for (let i = 0; i < nRough; i++) {
    const s0 = rng.range(0, Math.max(1, len - 12));
    roughStretches.push({ s0, s1: s0 + rng.range(6, 34), amp: rng.range(0.012, 0.04) * (1.3 - q) });
  }

  edge._features = { potholes, patches, roughStretches, rng: null };
  return edge._features;
}

/** Vertical offset (m) of the finished road surface relative to the centreline. */
export function surfaceOffset(edge, s, off) {
  const f = roadFeatures(edge);
  const w = edge.w;
  const halfW = w * 0.5;
  // camber: 2.5% crown on good roads, flatter and messier on bad ones
  const crown = lerp(0.012, 0.030, clamp01(edge.q)) * w;
  const n = clamp(Math.abs(off) / Math.max(halfW, 0.1), 0, 1.4);
  let y = -crown * n * n;

  // long-wave settlement
  y += (valueNoise2(s * 0.055, off * 0.1 + edge.i * 3.3, 11) - 0.5) * 0.085 * (1.25 - edge.q);
  // small-scale coarseness
  y += (valueNoise2(s * 0.75, off * 0.9 + edge.i, 29) - 0.5) * 0.022 * (1.3 - edge.q);

  for (const r of f.roughStretches) {
    if (s > r.s0 && s < r.s1) {
      const t = smoothstep(Math.min((s - r.s0) / 3, (r.s1 - s) / 3));
      y -= t * r.amp * (0.6 + 0.8 * valueNoise2(s * 1.7, off * 1.3, 61));
    }
  }
  for (const p of f.patches) {
    const ds = Math.abs(s - p.s) / p.rl;
    const dof = Math.abs(off - p.off) / p.rw;
    if (ds < 1 && dof < 1) {
      const t = (1 - ds * ds) * (1 - dof * dof);
      y += p.proud * t;
    }
  }
  for (const p of f.potholes) {
    const d = Math.hypot(s - p.s, off - p.off);
    if (d < p.r * 1.35) {
      const t = 1 - clamp01(d / (p.r * 1.35));
      y -= p.depth * t * t * (3 - 2 * t);
    }
  }
  return y;
}

/** Surface colour multiplier at a point (patches, dust, wear). */
function surfaceTint(edge, s, off, base) {
  const f = roadFeatures(edge);
  let m = 1;
  // wheel tracks polish the asphalt
  const lane = edge.w * 0.22;
  const track = Math.min(Math.abs(Math.abs(off) - lane) / lane, 1);
  m *= lerp(0.93, 1.06, track);
  // dust towards the edges
  const n = clamp01(Math.abs(off) / (edge.w * 0.5));
  const dust = Math.pow(n, 2.2) * lerp(0.35, 0.1, edge.q);
  let r = base[0] * m;
  let g = base[1] * m;
  let b = base[2] * m;
  r = lerp(r, 0.62, dust);
  g = lerp(g, 0.55, dust);
  b = lerp(b, 0.43, dust);
  const nz = valueNoise2(s * 0.18, off * 0.3 + edge.i * 7, 97);
  const k = lerp(0.88, 1.1, nz);
  r *= k; g *= k; b *= k;
  for (const p of f.patches) {
    const ds = Math.abs(s - p.s) / p.rl;
    const dof = Math.abs(off - p.off) / p.rw;
    if (ds < 1 && dof < 1) {
      const t = smoothstep(1 - Math.max(ds, dof));
      r = lerp(r, 0.18, t * 0.85);
      g = lerp(g, 0.17, t * 0.85);
      b = lerp(b, 0.17, t * 0.85);
    }
  }
  for (const p of f.potholes) {
    const d = Math.hypot(s - p.s, off - p.off);
    if (d < p.r) {
      const t = 1 - clamp01(d / p.r);
      r = lerp(r, 0.13, t);
      g = lerp(g, 0.12, t);
      b = lerp(b, 0.11, t);
    }
  }
  return [r, g, b];
}

function frameAt(edge, sTarget) {
  // returns { x, y, z, tx, tz, nx, nz }
  const pts = edge.pts3;
  const cum = edge.cum;
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < sTarget) i++;
  const a = pts[i];
  const b = pts[i + 1] || pts[i];
  const segLen = Math.max(1e-5, cum[i + 1] - cum[i]);
  const t = clamp01((sTarget - cum[i]) / segLen);
  const x = a[0] + (b[0] - a[0]) * t;
  const y = a[1] + (b[1] - a[1]) * t;
  const z = a[2] + (b[2] - a[2]) * t;
  let tx = b[0] - a[0];
  let tz = b[2] - a[2];
  const L = Math.hypot(tx, tz) || 1;
  tx /= L;
  tz /= L;
  return { x, y, z, tx, tz, nx: -tz, nz: tx };
}

export function sampleRoadPoint(edge, s, off) {
  const fr = frameAt(edge, s);
  return {
    x: fr.x + fr.nx * off,
    y: fr.y + surfaceOffset(edge, s, off),
    z: fr.z + fr.nz * off,
  };
}

const CLASS_STEP = {
  highway: 3.6, arterial: 3.4, major: 3.0, secondary: 2.8,
  townroad: 2.6, bazaar: 2.4, residential: 2.2, lane: 2.0, farm: 2.6, path: 3.0,
};

/**
 * Emit the road ribbon for one edge into a MeshAccum.
 * `lod` 0 = full detail, 1 = simplified (no shoulder detail, coarser steps).
 */
export function buildRoad(accum, edge, world, lod = 0) {
  const len = edge.len;
  if (len < 0.5) return;
  const step = (CLASS_STEP[edge.cls] || 2.6) * (lod ? 2.6 : 1);
  const n = Math.max(2, Math.ceil(len / step));
  const halfW = edge.w * 0.5;
  const sh = edge.sh;
  const base = SURFACE_COLOR[edge.sf] || SURFACE_COLOR.asphalt;

  const surfKey = edge.sf === 'asphalt'
    ? `road|asphalt|${(Math.round(edge.q * 4) / 4).toFixed(2)}`
    : `road|${edge.sf}`;

  // lateral stations: more across wide roads so potholes have resolution
  const across = lod ? 4 : Math.max(5, Math.round(edge.w / 0.75));
  const offs = [];
  for (let k = 0; k <= across; k++) offs.push(-halfW + (edge.w * k) / across);

  const rows = [];
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * len;
    const fr = frameAt(edge, s);
    const row = [];
    for (const off of offs) {
      const y = fr.y + surfaceOffset(edge, s, off);
      row.push({
        x: fr.x + fr.nx * off,
        y,
        z: fr.z + fr.nz * off,
        off,
        s,
        c: surfaceTint(edge, s, off, base),
      });
    }
    rows.push({ row, fr, s });
  }

  const b = accum.bucket(surfKey);
  const baseIdx = b.count;
  for (const { row, s } of rows) {
    for (const v of row) {
      b.pos.push(v.x, v.y, v.z);
      b.nor.push(0, 1, 0);
      b.uv.push((v.off + halfW) / 3.2, s / 3.2);
      b.col.push(v.c[0], v.c[1], v.c[2]);
    }
  }
  b.count += rows.length * offs.length;
  const stride = offs.length;
  for (let i = 0; i < rows.length - 1; i++) {
    for (let k = 0; k < stride - 1; k++) {
      const i0 = baseIdx + i * stride + k;
      b.idx.push(i0, i0 + stride, i0 + stride + 1, i0, i0 + stride + 1, i0 + 1);
    }
  }
  // recompute smooth normals for the carriageway so potholes catch light
  fixNormals(b, baseIdx, rows.length, stride);

  // ------------------------------------------------------------- shoulders
  if (sh > 0.05) {
    const shKey = 'shoulder';
    const sb = accum.bucket(shKey);
    for (const side of [-1, 1]) {
      const sBase = sb.count;
      for (let i = 0; i < rows.length; i++) {
        const { fr, s } = rows[i];
        const inner = rows[i].row[side < 0 ? 0 : stride - 1];
        // broken, irregular pavement edge
        const ragged = (valueNoise2(s * 0.42, side * 10 + edge.i, 7) - 0.5) * lerp(0.55, 0.12, edge.q);
        const outerOff = side * (halfW + sh + ragged * 0.8);
        const drop = lerp(0.14, 0.035, edge.q) + Math.abs(ragged) * 0.1;
        const terr = world.heightAt(fr.x + fr.nx * outerOff, fr.z + fr.nz * outerOff);
        const outerY = Math.min(inner.y - drop, terr + 0.02);
        const dust = 0.62 + 0.14 * valueNoise2(s * 0.3, side * 3, 19);
        sb.pos.push(inner.x, inner.y - 0.012, inner.z);
        sb.nor.push(0, 1, 0);
        sb.uv.push(0, s / 3.0);
        sb.col.push(dust * 0.95, dust * 0.84, dust * 0.66);
        sb.pos.push(fr.x + fr.nx * outerOff, outerY, fr.z + fr.nz * outerOff);
        sb.nor.push(0, 1, 0);
        sb.uv.push(1.2, s / 3.0);
        sb.col.push(dust, dust * 0.86, dust * 0.64);
      }
      sb.count += rows.length * 2;
      for (let i = 0; i < rows.length - 1; i++) {
        const i0 = sBase + i * 2;
        if (side < 0) sb.idx.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2);
        else sb.idx.push(i0, i0 + 2, i0 + 3, i0, i0 + 3, i0 + 1);
      }
    }
  }

  // ------------------------------------------------------------- markings
  if (lod === 0 && edge.mk !== 'none' && edge.w >= 5.4) {
    const faded = edge.mk === 'centre_faded' || edge.q < 0.55;
    const dash = 3.0;
    const gap = 4.5;
    const mb = accum.bucket('marking');
    let s = 2;
    while (s < len - 2) {
      const vis = hashF(edge.i, Math.round(s), 0x3311);
      const presence = faded ? 0.45 : 0.85;
      if (vis < presence) {
        const a = frameAt(edge, s);
        const c = frameAt(edge, Math.min(len, s + dash));
        const wdt = 0.09;
        const y0 = a.y + surfaceOffset(edge, s, 0) + 0.015;
        const y1 = c.y + surfaceOffset(edge, Math.min(len, s + dash), 0) + 0.015;
        const alpha = faded ? 0.42 : 0.82;
        const col = [alpha, alpha * 0.98, alpha * 0.88];
        const base2 = mb.count;
        const pts = [
          [a.x - a.nx * wdt, y0, a.z - a.nz * wdt],
          [a.x + a.nx * wdt, y0, a.z + a.nz * wdt],
          [c.x + c.nx * wdt, y1, c.z + c.nz * wdt],
          [c.x - c.nx * wdt, y1, c.z - c.nz * wdt],
        ];
        for (const q of pts) {
          mb.pos.push(q[0], q[1], q[2]);
          mb.nor.push(0, 1, 0);
          mb.uv.push(0, 0);
          mb.col.push(col[0], col[1], col[2]);
        }
        mb.count += 4;
        mb.idx.push(base2, base2 + 1, base2 + 2, base2, base2 + 2, base2 + 3);
      }
      s += dash + gap;
    }
    // edge lines on the better roads only
    if (!faded && (edge.cls === 'highway' || edge.cls === 'arterial')) {
      for (const side of [-1, 1]) {
        const eb = accum.bucket('marking');
        const eBase = eb.count;
        const steps = Math.max(2, Math.ceil(len / 4));
        for (let i = 0; i <= steps; i++) {
          const ss = (i / steps) * len;
          const fr = frameAt(edge, ss);
          const o = side * (halfW - 0.45);
          const y = fr.y + surfaceOffset(edge, ss, o) + 0.015;
          const a = 0.6 * (0.5 + 0.5 * hashF(edge.i, i >> 2, 5));
          for (const d of [-0.07, 0.07]) {
            eb.pos.push(fr.x + fr.nx * (o + d), y, fr.z + fr.nz * (o + d));
            eb.nor.push(0, 1, 0);
            eb.uv.push(0, 0);
            eb.col.push(a, a * 0.98, a * 0.86);
          }
        }
        eb.count += (steps + 1) * 2;
        for (let i = 0; i < steps; i++) {
          const i0 = eBase + i * 2;
          eb.idx.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2);
        }
      }
    }
  }
}

function fixNormals(bucket, baseIdx, rowCount, stride) {
  const pos = bucket.pos;
  const nor = bucket.nor;
  const get = (i, k) => {
    const o = (baseIdx + i * stride + k) * 3;
    return [pos[o], pos[o + 1], pos[o + 2]];
  };
  for (let i = 0; i < rowCount; i++) {
    for (let k = 0; k < stride; k++) {
      const a = get(Math.max(0, i - 1), k);
      const b = get(Math.min(rowCount - 1, i + 1), k);
      const c = get(i, Math.max(0, k - 1));
      const d = get(i, Math.min(stride - 1, k + 1));
      const t1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const t2 = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
      let nx = t1[1] * t2[2] - t1[2] * t2[1];
      let ny = t1[2] * t2[0] - t1[0] * t2[2];
      let nz = t1[0] * t2[1] - t1[1] * t2[0];
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const L = Math.hypot(nx, ny, nz) || 1;
      const o = (baseIdx + i * stride + k) * 3;
      nor[o] = nx / L;
      nor[o + 1] = ny / L;
      nor[o + 2] = nz / L;
    }
  }
}

/** Speed breaker across the road at arclength s. */
export function buildSpeedBreaker(accum, edge, s) {
  const halfW = edge.w * 0.5 + edge.sh * 0.4;
  const segs = 8;
  const widthSteps = 10;
  const b = accum.bucket('marking');
  const key = 'flat';
  const fb = accum.bucket(key);
  const base = fb.count;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const ss = s - 1.6 + t * 3.2;
    const bump = Math.sin(t * Math.PI) * 0.11;
    const fr = frameAt(edge, clamp(ss, 0, edge.len));
    for (let k = 0; k <= widthSteps; k++) {
      const off = -halfW + (2 * halfW * k) / widthSteps;
      const y = fr.y + surfaceOffset(edge, clamp(ss, 0, edge.len), off) + bump;
      const stripe = (k % 2 === 0) ? 0.85 : 0.22;
      fb.pos.push(fr.x + fr.nx * off, y + 0.01, fr.z + fr.nz * off);
      fb.nor.push(0, 1, 0);
      fb.uv.push(k / widthSteps, t);
      fb.col.push(stripe, stripe * 0.92, stripe * 0.5);
    }
  }
  fb.count += (segs + 1) * (widthSteps + 1);
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < widthSteps; k++) {
      const i0 = base + i * (widthSteps + 1) + k;
      fb.idx.push(i0, i0 + widthSteps + 1, i0 + widthSteps + 2, i0, i0 + widthSteps + 2, i0 + 1);
    }
  }
}

/** Physics query: total surface height + grip + roughness at a world point. */
export function sampleRoadSurface(world, x, z) {
  const near = world.nearestRoad(x, z, 26);
  const terrainY = world.heightAt(x, z);
  if (!near) {
    const g = world.groundAt(x, z);
    const grip = g === 4 ? 0.35 : g === 1 || g === 5 ? 0.56 : 0.6;
    return { y: terrainY, grip, roughness: 0.75, name: 'offroad', edge: null, off: 0, s: 0 };
  }
  const e = near.edge;
  const halfW = e.w * 0.5;
  const sideSign = Math.sign(
    (x - near.px) * -near.dirZ + (z - near.pz) * near.dirX
  ) || 1;
  const off = near.dist * sideSign;
  if (near.dist > halfW + e.sh) {
    const g = world.groundAt(x, z);
    return { y: terrainY, grip: g === 1 || g === 5 ? 0.56 : 0.6, roughness: 0.8, name: 'offroad', edge: e, off, s: near.s };
  }
  if (near.dist > halfW) {
    // the earth shoulder
    const t = clamp01((near.dist - halfW) / Math.max(0.1, e.sh));
    const road = frameAt(e, near.s);
    const y = lerp(road.y + surfaceOffset(e, near.s, off), terrainY, t * 0.8) - t * 0.08;
    return { y, grip: lerp(0.78, 0.6, t), roughness: 0.85, name: 'gravel', edge: e, off, s: near.s };
  }
  const fr = frameAt(e, near.s);
  const y = fr.y + surfaceOffset(e, near.s, off);
  const f = roadFeatures(e);
  let rough = (1 - e.q) * 0.55;
  for (const p of f.potholes) {
    const d = Math.hypot(near.s - p.s, off - p.off);
    if (d < p.r * 1.3) rough = Math.max(rough, 0.9);
  }
  return {
    y,
    grip: e.sf === 'asphalt' ? 1.0 : e.sf === 'concrete' ? 0.96 : e.sf === 'gravel' ? 0.72 : 0.64,
    roughness: rough,
    name: e.sf,
    edge: e,
    off,
    s: near.s,
  };
}
