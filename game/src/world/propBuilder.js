// Street furniture: utility poles, overhead wires, streetlights, transformers,
// compound walls, drains, signs, bus shelters and roadside clutter.
//
// Poles are laid out by walking each surveyed road, so spacing is regular and
// the wires actually connect pole to pole with a catenary sag instead of being
// random floating lines.

import { clamp, clamp01, lerp } from '../core/util.js';
import { Rng, hashU32, hashF } from '../core/rng.js';

const POLE_GREY = [0.68, 0.67, 0.64];
const WIRE_COL = [0.08, 0.08, 0.09];

const POLE_SPACING = {
  highway: 48, arterial: 42, major: 38, secondary: 34,
  townroad: 30, bazaar: 26, residential: 30, lane: 36, farm: 70, path: 90,
};

/** Returns pole anchor points for an edge (cached). */
export function edgePoles(edge, world) {
  if (edge._poles) return edge._poles;
  const spacing = POLE_SPACING[edge.cls] || 34;
  const n = Math.max(1, Math.round(edge.len / spacing));
  const out = [];
  const side = hashF(edge.i, 3) < 0.5 ? -1 : 1;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * edge.len;
    const fr = frameAt(edge, s);
    const off = side * (edge.w * 0.5 + edge.sh + 0.55 + hashF(edge.i, i, 5) * 0.5);
    const x = fr.x + fr.nx * off;
    const z = fr.z + fr.nz * off;
    out.push({ x, z, y: world.heightAt(x, z), s, side, tx: fr.tx, tz: fr.tz, i });
  }
  edge._poles = out;
  return out;
}

function frameAt(edge, sTarget) {
  const pts = edge.pts3;
  const cum = edge.cum;
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < sTarget) i++;
  const a = pts[i];
  const b = pts[i + 1] || pts[i];
  const segLen = Math.max(1e-5, cum[i + 1] - cum[i]);
  const t = clamp01((sTarget - cum[i]) / segLen);
  let tx = b[0] - a[0];
  let tz = b[2] - a[2];
  const L = Math.hypot(tx, tz) || 1;
  tx /= L;
  tz /= L;
  return {
    x: a[0] + (b[0] - a[0]) * t,
    y: a[1] + (b[1] - a[1]) * t,
    z: a[2] + (b[2] - a[2]) * t,
    tx, tz, nx: -tz, nz: tx,
  };
}

export function buildEdgeProps(accum, edge, world, chunkBounds, lights, lod) {
  const urbanMid = world.urbanAt(edge.mid[0], edge.mid[1]);
  if (edge.cls === 'path') return;
  const poles = edgePoles(edge, world);
  const inChunk = (p) => p.x >= chunkBounds[0] && p.x < chunkBounds[2] && p.z >= chunkBounds[1] && p.z < chunkBounds[3];

  const hasPoles = urbanMid > 0.1 || edge.cls === 'arterial' || edge.cls === 'highway' || edge.cls === 'major';
  if (!hasPoles) return;

  for (let i = 0; i < poles.length; i++) {
    const p = poles[i];
    if (!inChunk(p)) continue;
    const rng = new Rng(hashU32(edge.i, i, 0x51c1));
    const u = world.urbanAt(p.x, p.z);
    const poleH = lerp(7.4, 9.2, u) + rng.range(-0.5, 0.7);
    const ang = Math.atan2(p.tz, p.tx);

    // concrete pole: square-section, tapered, with the classic cable hook
    accum.box('concrete|0', p.x, p.y - 0.2, p.z, 0.24, poleH, 0.18, ang, POLE_GREY, 0.7);
    accum.box('concrete|0', p.x, p.y - 0.35, p.z, 0.44, 0.35, 0.4, ang, [0.6, 0.59, 0.56], 1);

    // cross-arm with insulators
    const armY = p.y + poleH - 0.55;
    accum.box('flat', p.x, armY, p.z, 0.08, 0.08, 1.35, ang, [0.3, 0.29, 0.27], 1);
    for (let k = -1; k <= 1; k++) {
      if (k === 0) continue;
      const ox = -Math.sin(ang) * k * 0.55;
      const oz = Math.cos(ang) * k * 0.55;
      accum.cylinder('flat', p.x + ox, armY + 0.08, p.z + oz, 0.07, 0.06, 0.16, 6, [0.45, 0.33, 0.2], { capTop: true });
    }

    // streetlight arm on the busier urban roads
    const lit = u > 0.33 && (edge.cls !== 'lane') && (i % 2 === 0 || u > 0.6);
    if (lit && lod === 0) {
      const dirX = -Math.sin(ang) * -p.side;
      const dirZ = Math.cos(ang) * -p.side;
      const armLen = 1.5;
      const hx = p.x + dirX * armLen;
      const hz = p.z + dirZ * armLen;
      const hy = p.y + poleH - 0.25;
      accum.box('flat', (p.x + hx) / 2, hy, (p.z + hz) / 2, armLen, 0.07, 0.07,
        Math.atan2(hz - p.z, hx - p.x), [0.3, 0.3, 0.29], 1);
      accum.box('flat', hx, hy - 0.16, hz, 0.46, 0.14, 0.26, Math.atan2(hz - p.z, hx - p.x), [0.32, 0.32, 0.3], 1);
      accum.box('emissive', hx, hy - 0.2, hz, 0.34, 0.04, 0.18, Math.atan2(hz - p.z, hx - p.x), [1, 0.86, 0.6], 1);
      lights.push({ x: hx, y: hy - 0.22, z: hz });
    }

    // transformer on a stepped platform, occasionally, in the denser areas
    if (u > 0.55 && rng.chance(0.07) && lod === 0) {
      const tx = p.x - Math.sin(ang) * p.side * 1.3;
      const tz = p.z + Math.cos(ang) * p.side * 1.3;
      const ty = world.heightAt(tx, tz);
      accum.box('concrete|0', tx, ty, tz, 1.7, 0.5, 1.5, ang, [0.6, 0.59, 0.56], 1);
      accum.box('flat', tx, ty + 0.5, tz, 0.9, 1.1, 0.8, ang, [0.42, 0.44, 0.4], 1);
      accum.cylinder('flat', tx, ty + 1.6, tz, 0.12, 0.1, 0.28, 8, [0.5, 0.42, 0.3], { capTop: true });
      for (const s of [-1, 1]) {
        accum.box('concrete|0', tx + Math.cos(ang) * s * 0.9, ty, tz + Math.sin(ang) * s * 0.9, 0.16, 2.0, 0.16, ang, POLE_GREY, 1);
      }
    }
  }

  // ---- wires: connect consecutive poles with real sag ---------------------
  if (lod === 0) {
    for (let i = 0; i < poles.length - 1; i++) {
      const a = poles[i];
      const b = poles[i + 1];
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      if (mx < chunkBounds[0] || mx >= chunkBounds[2] || mz < chunkBounds[1] || mz >= chunkBounds[3]) continue;
      const ua = world.urbanAt(a.x, a.z);
      const poleHa = lerp(7.4, 9.2, ua);
      const ang = Math.atan2(b.z - a.z, b.x - a.x);
      const span = Math.hypot(b.x - a.x, b.z - a.z);
      const sag = clamp(span * 0.035, 0.18, 1.1);
      const nWires = ua > 0.5 ? 4 : 2;
      for (let k = 0; k < nWires; k++) {
        const lateral = (k - (nWires - 1) / 2) * 0.34;
        const dropK = k * 0.12;
        catenary(accum, a, b, poleHa - 0.55 - dropK, lateral, sag, ang, 6);
      }
    }
  }
}

function catenary(accum, a, b, hOff, lateral, sag, ang, segs) {
  const nx = -Math.sin(ang);
  const nz = Math.cos(ang);
  const prev = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = a.x + (b.x - a.x) * t + nx * lateral;
    const z = a.z + (b.z - a.z) * t + nz * lateral;
    const y = a.y + hOff + ((b.y + hOff) - (a.y + hOff)) * t - Math.sin(t * Math.PI) * sag;
    prev.push([x, y, z]);
  }
  for (let i = 0; i < segs; i++) {
    const p0 = prev[i];
    const p1 = prev[i + 1];
    const len = Math.hypot(p1[0] - p0[0], p1[2] - p0[2], p1[1] - p0[1]);
    const cx = (p0[0] + p1[0]) / 2;
    const cy = (p0[1] + p1[1]) / 2;
    const cz = (p0[2] + p1[2]) / 2;
    const segAng = Math.atan2(p1[2] - p0[2], p1[0] - p0[0]);
    // thin, slightly tilted box reads as a wire at any sane distance
    const dy = p1[1] - p0[1];
    const horiz = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    accum.box('flat', cx, cy - 0.015, cz, horiz, Math.max(0.03, Math.abs(dy) + 0.03), 0.03, segAng, WIRE_COL, 1);
  }
}

/** Drain channel along urban streets, plus kerb. */
export function buildDrain(accum, edge, world, chunkBounds) {
  const u = world.urbanAt(edge.mid[0], edge.mid[1]);
  if (u < 0.5) return;
  if (!['bazaar', 'townroad', 'secondary', 'major'].includes(edge.cls)) return;
  const step = 4;
  const n = Math.max(2, Math.ceil(edge.len / step));
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const s = (i / n) * edge.len;
      const fr = frameAt(edge, s);
      const off = side * (edge.w * 0.5 + edge.sh * 0.7);
      const x = fr.x + fr.nx * off;
      const z = fr.z + fr.nz * off;
      if (x < chunkBounds[0] || x >= chunkBounds[2] || z < chunkBounds[1] || z >= chunkBounds[3]) continue;
      const y = world.heightAt(x, z);
      const ang = Math.atan2(fr.tz, fr.tx);
      const segLen = edge.len / n + 0.1;
      // kerb stone
      accum.box('concrete|2', x, y - 0.1, z, segLen, 0.34, 0.26, ang, [0.72, 0.71, 0.67], 0.8);
      // open drain behind it
      const dx = x + fr.nx * side * 0.42;
      const dz = z + fr.nz * side * 0.42;
      accum.box('concrete|0', dx, y - 0.55, dz, segLen, 0.5, 0.5, ang, [0.52, 0.51, 0.48], 0.8);
      if (hashF(edge.i, i, side, 9) < 0.22) {
        // slab cover
        accum.box('concrete|2', dx, y - 0.1, dz, segLen * 0.9, 0.1, 0.56, ang, [0.66, 0.65, 0.62], 1);
      }
    }
  }
}

/** Mapped OSM barriers. */
export function buildWall(accum, wall, world, chunkBounds) {
  const pts = wall.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0];
    const az = -pts[i][1];
    const bx = pts[i + 1][0];
    const bz = -pts[i + 1][1];
    const cx = (ax + bx) / 2;
    const cz = (az + bz) / 2;
    if (cx < chunkBounds[0] || cx >= chunkBounds[2] || cz < chunkBounds[1] || cz >= chunkBounds[3]) continue;
    const len = Math.hypot(bx - ax, bz - az);
    const ang = Math.atan2(bz - az, bx - ax);
    const y = Math.min(world.heightAt(ax, az), world.heightAt(bx, bz));
    const key = wall.kind === 'hedge' ? 'leafcard|shrub' : 'plaster|7';
    accum.box(key, cx, y - 0.2, cz, len, wall.h + 0.2, 0.22, ang, [0.9, 0.89, 0.85], 0.6);
  }
}

/** Junction direction sign on the bigger roads. */
export function buildJunctionSign(accum, world, x, z, label, ang) {
  const y = world.heightAt(x, z);
  accum.box('flat', x, y, z, 0.1, 2.6, 0.1, ang, [0.5, 0.5, 0.48], 1);
  const key = `sign|${label}|#1d4f3c|#f6e9c8|`;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const w = Math.min(2.6, 0.55 + label.length * 0.17);
  const P = (lx, lz, yy) => [x + lx * ca - lz * sa, yy, z + lx * sa + lz * ca];
  accum.quad(key, P(-w / 2, 0.03, y + 2.0), P(w / 2, 0.03, y + 2.0), P(w / 2, 0.03, y + 2.62), P(-w / 2, 0.03, y + 2.62),
    [-sa, 0, ca], [0, 1, 1, 1, 1, 0, 0, 0], [1, 1, 1]);
  accum.box('flat', x, y + 1.98, z, w, 0.66, 0.05, ang, [0.1, 0.25, 0.19], 1);
}

/** A simple bus shelter. */
export function buildBusShelter(accum, world, x, z, ang) {
  const y = world.heightAt(x, z);
  const w = 4.4;
  const d = 1.9;
  accum.box('concrete|2', x, y - 0.1, z, w + 0.4, 0.2, d + 0.4, ang, [0.74, 0.73, 0.7], 0.6);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const lx = sx * (w / 2 - 0.15);
      const lz = sz * (d / 2 - 0.15);
      accum.box('flat', x + lx * Math.cos(ang) - lz * Math.sin(ang), y + 0.1,
        z + lx * Math.sin(ang) + lz * Math.cos(ang), 0.12, 2.4, 0.12, ang, [0.35, 0.36, 0.34], 1);
    }
  }
  accum.box('flat', x, y + 0.45, z, w - 0.4, 0.08, 0.42, ang, [0.42, 0.38, 0.3], 1); // bench
  accum.box('tin|#8f9aa0', x, y + 2.5, z, w + 0.6, 0.1, d + 0.7, ang, [0.9, 0.9, 0.9], 1);
  // back panel with advert-ish board
  const lz = -(d / 2 - 0.1);
  accum.box('flat', x - lz * Math.sin(ang), y + 0.1, z + lz * Math.cos(ang), w - 0.3, 2.3, 0.06, ang, [0.55, 0.5, 0.42], 1);
}

/** Km stone on the state highways. */
export function buildMilestone(accum, world, x, z, ang, text) {
  const y = world.heightAt(x, z);
  accum.box('concrete|2', x, y, z, 0.3, 0.72, 0.22, ang, [0.92, 0.91, 0.88], 1);
  accum.box('flat', x, y + 0.5, z, 0.32, 0.24, 0.24, ang, [0.85, 0.3, 0.2], 1);
}
