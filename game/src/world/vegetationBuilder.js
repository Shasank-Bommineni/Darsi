// Contextual vegetation.
//
// Density and species follow the land cover and the urbanity field, so the
// town gets neem and tamarind along the streets, the outskirts get scrub and
// palmyra, the farmland gets crop rows with bunds, and the tank banks get a
// thicker fringe.  Nothing is scattered uniformly.

import { clamp, clamp01, lerp } from '../core/util.js';
import { Rng, hashU32, hashF, valueNoise2 } from '../core/rng.js';
import { GROUND } from './worldData.js';

const SPECIES = {
  neem: { h: [5.0, 9.0], crown: [2.4, 4.0], trunk: 0.19, kind: 'neem', cards: 3 },
  tamarind: { h: [6.5, 11.0], crown: [3.2, 5.4], trunk: 0.28, kind: 'banyan', cards: 4 },
  banyan: { h: [7.0, 12.0], crown: [4.0, 7.0], trunk: 0.5, kind: 'banyan', cards: 4 },
  palmyra: { h: [8.0, 14.0], crown: [1.5, 2.3], trunk: 0.17, kind: 'palm', cards: 0, palm: true },
  coconut: { h: [7.0, 12.0], crown: [1.8, 2.8], trunk: 0.15, kind: 'palm', cards: 0, palm: true },
  babul: { h: [3.2, 5.5], crown: [1.8, 3.0], trunk: 0.14, kind: 'dry', cards: 3 },
};

const ZONE_MIX = {
  [GROUND.TOWN]: ['neem', 'neem', 'tamarind', 'coconut'],
  [GROUND.DRY_EARTH]: ['babul', 'babul', 'palmyra', 'neem'],
  [GROUND.SCRUB]: ['babul', 'babul', 'neem', 'palmyra'],
  [GROUND.FIELD]: ['palmyra', 'babul', 'tamarind'],
  [GROUND.GRASS]: ['neem', 'tamarind', 'palmyra'],
  [GROUND.WATER_BED]: ['coconut', 'palmyra'],
};

export function buildVegetation(accum, world, cx, cz, size, lod, blocked) {
  const step = 6.0;
  const n = Math.ceil(size / step);
  const ci = Math.round(cx / size);
  const cj = Math.round(cz / size);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const h = hashU32(ci * 1021 + i, cj * 1031 + j, 0x7e3a);
      const rng = new Rng(h);
      const x = cx + (i + rng.f()) * step;
      const z = cz + (j + rng.f()) * step;
      const g = world.groundAt(x, z);
      const u = world.urbanAt(x, z);

      // base density per land cover
      let p =
        g === GROUND.SCRUB ? 0.26 :
        g === GROUND.FIELD ? 0.045 :
        g === GROUND.GRASS ? 0.12 :
        g === GROUND.WATER_BED ? 0.3 :
        g === GROUND.TOWN ? 0.10 : 0.09;

      // towns: trees live at plot edges and along streets, not in the middle
      const road = world.nearestRoad(x, z, 26);
      const dRoad = road ? road.dist : 99;
      if (dRoad < (road ? road.edge.w * 0.5 + road.edge.sh + 0.6 : 4)) continue;
      if (dRoad < 9 && u > 0.25) p *= 2.3;      // avenue planting
      p *= lerp(1.25, 0.5, u);                   // dense bazaar has fewer trees
      if (blocked && blocked(x, z, 2.5)) continue;

      if (rng.f() > p) continue;

      const mix = ZONE_MIX[g] || ZONE_MIX[GROUND.DRY_EARTH];
      const name = mix[rng.u32() % mix.length];
      tree(accum, world, x, z, name, rng, lod);
    }
  }

  // shrubs and dry grass tufts fill the ground between
  if (lod === 0) {
    const sStep = 3.4;
    const sn = Math.ceil(size / sStep);
    for (let i = 0; i < sn; i++) {
      for (let j = 0; j < sn; j++) {
        const rng = new Rng(hashU32(ci * 2003 + i, cj * 2011 + j, 0x31b7));
        const x = cx + (i + rng.f()) * sStep;
        const z = cz + (j + rng.f()) * sStep;
        const g = world.groundAt(x, z);
        const u = world.urbanAt(x, z);
        let p = g === GROUND.SCRUB ? 0.34 : g === GROUND.GRASS ? 0.3 : g === GROUND.FIELD ? 0.07 : 0.14;
        p *= lerp(1.2, 0.35, u);
        const road = world.nearestRoad(x, z, 18);
        if (road && road.dist < road.edge.w * 0.5 + road.edge.sh + 0.3) continue;
        if (road && road.dist < 6) p *= 1.5; // verge growth
        if (blocked && blocked(x, z, 1.2)) continue;
        if (rng.f() > p) continue;
        shrub(accum, world, x, z, rng, g);
      }
    }
  }
}

function tree(accum, world, x, z, name, rng, lod) {
  const sp = SPECIES[name];
  const y = world.heightAt(x, z);
  const h = rng.range(sp.h[0], sp.h[1]);
  const crown = rng.range(sp.crown[0], sp.crown[1]);
  const tilt = rng.sym() * 0.05;

  if (sp.palm) {
    // slender trunk with ring texture + radiating fronds
    const segs = 6;
    let px = x;
    let pz = z;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const r0 = sp.trunk * (1 - t0 * 0.35);
      const r1 = sp.trunk * (1 - t1 * 0.35);
      const bend = tilt * 6;
      accum.cylinder('bark', px + bend * t0 * t0, y + h * t0, pz, r0, r1, h / segs, 7, [0.72, 0.66, 0.54]);
    }
    const nf = rng.int(8, 13);
    for (let i = 0; i < nf; i++) {
      const a = (i / nf) * Math.PI * 2 + rng.f();
      const L = crown * rng.range(0.8, 1.3);
      const droop = rng.range(0.3, 0.9);
      const tipX = x + Math.cos(a) * L + tilt * 6;
      const tipZ = z + Math.sin(a) * L;
      const baseY = y + h;
      accum.quad('leafcard|palm',
        [x - Math.sin(a) * 0.14 + tilt * 6, baseY, z + Math.cos(a) * 0.14],
        [x + Math.sin(a) * 0.14 + tilt * 6, baseY, z - Math.cos(a) * 0.14],
        [tipX + Math.sin(a) * 0.3, baseY - droop, tipZ - Math.cos(a) * 0.3],
        [tipX - Math.sin(a) * 0.3, baseY - droop, tipZ + Math.cos(a) * 0.3],
        [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], [0.9, 0.95, 0.85]);
    }
    if (name === 'coconut' && rng.chance(0.5)) {
      for (let i = 0; i < 4; i++) {
        const a = rng.f() * Math.PI * 2;
        accum.cylinder('flat', x + Math.cos(a) * 0.3 + tilt * 6, y + h - 0.5, z + Math.sin(a) * 0.3,
          0.14, 0.12, 0.26, 6, [0.42, 0.38, 0.22], { capTop: true });
      }
    }
    return;
  }

  // broadleaf: tapered trunk, a few limbs, crossed foliage cards + a canopy blob
  const trunkH = h * rng.range(0.3, 0.45);
  accum.cylinder('bark', x, y - 0.1, z, sp.trunk * 1.35, sp.trunk * 0.85, trunkH + 0.1, 7, [0.68, 0.6, 0.48]);
  const nLimb = lod === 0 ? rng.int(3, 5) : 2;
  for (let i = 0; i < nLimb; i++) {
    const a = (i / nLimb) * Math.PI * 2 + rng.f() * 0.6;
    const len = crown * rng.range(0.4, 0.7);
    const ex = x + Math.cos(a) * len;
    const ez = z + Math.sin(a) * len;
    const ey = y + trunkH + rng.range(0.4, 1.2);
    const mx = (x + ex) / 2;
    const mz = (z + ez) / 2;
    const my = (y + trunkH + ey) / 2;
    const L = Math.hypot(ex - x, ez - z);
    accum.box('bark', mx, my, mz, L, 0.14, 0.14, Math.atan2(ez - z, ex - x), [0.62, 0.55, 0.44], 1);
  }

  const cy = y + trunkH + crown * 0.55;
  const cards = lod === 0 ? sp.cards : 2;
  for (let i = 0; i < cards; i++) {
    const a = (i / cards) * Math.PI;
    const cw = crown * rng.range(1.5, 2.1);
    const ch = crown * rng.range(1.1, 1.5);
    const dx = Math.cos(a) * cw * 0.5;
    const dz = Math.sin(a) * cw * 0.5;
    const jx = rng.sym() * crown * 0.18;
    const jz = rng.sym() * crown * 0.18;
    accum.quad(`leafcard|${sp.kind}`,
      [x - dx + jx, cy - ch / 2, z - dz + jz],
      [x + dx + jx, cy - ch / 2, z + dz + jz],
      [x + dx + jx, cy + ch / 2, z + dz + jz],
      [x - dx + jx, cy + ch / 2, z - dz + jz],
      [0, 0.3, 1], [0, 0, 1, 0, 1, 1, 0, 1], [1, 1, 1]);
  }
  // horizontal card gives the canopy volume from above / at distance
  const cw2 = crown * 1.8;
  accum.quad(`leafcard|${sp.kind}`,
    [x - cw2 / 2, cy + crown * 0.25, z - cw2 / 2],
    [x + cw2 / 2, cy + crown * 0.25, z - cw2 / 2],
    [x + cw2 / 2, cy + crown * 0.25, z + cw2 / 2],
    [x - cw2 / 2, cy + crown * 0.25, z + cw2 / 2],
    [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], [0.86, 0.9, 0.82]);
}

function shrub(accum, world, x, z, rng, ground) {
  const y = world.heightAt(x, z);
  const h = rng.range(0.4, 1.5);
  const w = rng.range(0.6, 1.8);
  const kind = ground === GROUND.FIELD || ground === GROUND.GRASS ? 'shrub' : 'dry';
  const n = 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI + rng.f() * 0.4;
    const dx = Math.cos(a) * w * 0.5;
    const dz = Math.sin(a) * w * 0.5;
    accum.quad(`leafcard|${kind}`,
      [x - dx, y, z - dz], [x + dx, y, z + dz],
      [x + dx, y + h, z + dz], [x - dx, y + h, z - dz],
      [0, 0.4, 1], [0, 0, 1, 0, 1, 1, 0, 1], [1, 1, 1]);
  }
}

/** Crop rows + earth bunds inside mapped farmland polygons. */
export function buildFarmland(accum, world, cx, cz, size, lod) {
  if (lod > 0) return;
  const step = 2.6;
  const n = Math.ceil(size / step);
  const ci = Math.round(cx / size);
  const cj = Math.round(cz / size);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const rng = new Rng(hashU32(ci * 3001 + i, cj * 3011 + j, 0x4411));
      const x = cx + (i + 0.5) * step;
      const z = cz + (j + 0.5) * step;
      if (world.groundAt(x, z) !== GROUND.FIELD) continue;
      const road = world.nearestRoad(x, z, 14);
      if (road && road.dist < road.edge.w * 0.5 + road.edge.sh + 1.0) continue;
      // field "cell" identity so one plot is uniformly planted
      const fx = Math.floor(x / 46);
      const fz = Math.floor(z / 46);
      const kind = hashU32(fx, fz, 0x991) % 4;
      if (kind === 3) continue; // fallow
      const y = world.heightAt(x, z);
      const hgt = kind === 0 ? rng.range(0.6, 1.0) : kind === 1 ? rng.range(0.25, 0.5) : rng.range(1.2, 2.0);
      const col = kind === 2 ? [0.72, 0.78, 0.4] : [0.55, 0.72, 0.33];
      const ang = (hashU32(fx, fz, 7) % 180) * (Math.PI / 180);
      for (let k = 0; k < 2; k++) {
        const a = ang + k * Math.PI * 0.5;
        const dx = Math.cos(a) * step * 0.55;
        const dz = Math.sin(a) * step * 0.55;
        accum.quad('leafcard|shrub',
          [x - dx, y, z - dz], [x + dx, y, z + dz],
          [x + dx, y + hgt, z + dz], [x - dx, y + hgt, z - dz],
          [0, 0.5, 1], [0, 0, 1, 0, 1, 1, 0, 1], col);
      }
    }
  }
}
