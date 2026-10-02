// Procedural Indian small-town architecture.
//
// A building record from the pipeline gives footprint, orientation, category,
// storey count and a seed.  This module turns that into modular geometry:
// plinth, storeys with real openings, parapet, terrace clutter, compound wall,
// shopfront with shutter + awning + signboard, and the specific silhouettes of
// temples, mosques, churches, schools and water tanks.
//
// Reference: ordinary RCC construction in coastal Andhra -- 3.0-3.5 m floors,
// 2.1 m doors, 1.2-1.5 m windows with grilles, 0.8-1.1 m parapets, Sintex
// tanks on the terrace, 1.5-1.8 m compound walls with a steel gate.

import { clamp, clamp01, lerp } from '../core/util.js';
import { Rng, hashU32, hashF } from '../core/rng.js';
import { PLASTER_COLOURS, TRIM_COLOURS } from '../render/textures.js';
import { earcut } from './meshBuilder.js';

const SHUTTER_COLOURS = ['#3f6484', '#4b6b3f', '#7a4030', '#5a5a62', '#2f5a68', '#8a6a28'];
const TANK_COLOURS = [[0.11, 0.11, 0.12], [0.12, 0.22, 0.42], [0.55, 0.14, 0.12], [0.25, 0.25, 0.28]];
const TIN_TINTS = ['#8f9aa0', '#9aa39a', '#7d8488', '#a0968a'];

const WHITE = [1, 1, 1];

function tintFor(rng, strength = 0.1) {
  const k = 1 + rng.sym() * strength;
  return [k, k * (1 + rng.sym() * strength * 0.3), k * (1 + rng.sym() * strength * 0.3)];
}

export function buildBuilding(accum, b, world, lod = 0) {
  const rng = new Rng(hashU32(b.sd, b.id, 0x2b17));
  const cat = b.cat;

  switch (cat) {
    case 'temple':
      return buildTemple(accum, b, world, rng, lod);
    case 'mosque':
      return buildMosque(accum, b, world, rng, lod);
    case 'church':
      return buildChurch(accum, b, world, rng, lod);
    case 'water_tank':
      return buildWaterTank(accum, b, world, rng, lod);
    case 'compound':
      return buildCompoundSite(accum, b, world, rng, lod);
    case 'hut':
      return buildHut(accum, b, world, rng, lod);
    case 'shed':
      return buildShed(accum, b, world, rng, lod);
    case 'warehouse':
    case 'industrial':
      return buildWarehouse(accum, b, world, rng, lod);
    default:
      return buildStandard(accum, b, world, rng, lod);
  }
}

// ---------------------------------------------------------------- standard

function buildStandard(accum, b, world, rng, lod) {
  const ang = b.ang3;
  const w = b.w;
  const d = b.d;
  const g = b.g;
  const levels = b.lv;
  const storeyH = b.h / Math.max(1, levels);
  const plinth = rng.range(0.18, 0.62);
  const isShop = b.cat === 'shop' || b.cat === 'shophouse' || b.cat === 'commercial';
  const isUnfinished = b.cat === 'unfinished';
  const isPublic = ['school', 'hospital', 'government', 'civic'].includes(b.cat);

  const plasterIdx = rng.int(0, PLASTER_COLOURS.length - 1);
  const matKey = isUnfinished ? 'concrete|1' : `plaster|${plasterIdx}`;
  const tint = tintFor(rng, 0.09);

  // --- plinth -------------------------------------------------------------
  accum.box('concrete|0', b.wx, g - 0.5, b.wz, w + 0.45, 0.5 + plinth, d + 0.45, ang,
    [0.62, 0.6, 0.57], 0.5, { skipTop: false });

  const baseY = g + plinth;
  const topY = baseY + storeyH * levels;

  // --- body ---------------------------------------------------------------
  if (lod >= 2) {
    accum.box(matKey, b.wx, baseY, b.wz, w, topY - baseY + b.pp, d, ang, tint, 0.26);
    return;
  }

  // Many Indian houses are stepped: upper floor smaller than the ground floor.
  let curW = w;
  let curD = d;
  for (let L = 0; L < levels; L++) {
    const y0 = baseY + L * storeyH;
    const stepped = L > 0 && rng.chance(0.3);
    if (stepped) {
      curW = Math.max(3.4, curW - rng.range(0.6, 2.2));
      curD = Math.max(3.4, curD - rng.range(0.6, 2.6));
    }
    accum.box(matKey, b.wx, y0, b.wz, curW, storeyH, curD, ang, tint, 0.26, { skipTop: true });

    if (lod === 0) {
      addFacade(accum, b, rng, {
        y0, h: storeyH, w: curW, d: curD, ang, level: L, levels, isShop, isUnfinished, isPublic,
      });
    }
    // floor slab lip
    if (L < levels - 1) {
      accum.box('concrete|2', b.wx, y0 + storeyH - 0.09, b.wz, curW + 0.22, 0.14, curD + 0.22, ang,
        [0.66, 0.65, 0.62], 0.5, { skipTop: true });
    }
  }

  // --- roof ---------------------------------------------------------------
  const roofY = baseY + storeyH * levels;
  if (isUnfinished && rng.chance(0.6)) {
    // exposed columns and rebar on the unfinished top floor
    addRebar(accum, b, rng, roofY, curW, curD, ang);
  }
  // terrace slab
  accum.box('concrete|2', b.wx, roofY - 0.12, b.wz, curW + 0.3, 0.2, curD + 0.3, ang, [0.67, 0.66, 0.63], 0.5);

  if (b.pp > 0.05) {
    addParapet(accum, b.wx, roofY + 0.08, b.wz, curW + 0.3, curD + 0.3, b.pp, ang, matKey, tint, rng);
  }

  if (lod === 0) {
    addTerraceClutter(accum, b, rng, roofY + 0.08, curW, curD, ang, levels);
  }

  // --- shopfront ----------------------------------------------------------
  if (isShop && lod === 0) {
    addShopfront(accum, b, rng, baseY, storeyH, w, d, ang);
  }

  // --- compound wall ------------------------------------------------------
  if (b.wl && b.pl && lod === 0) {
    addCompound(accum, b, rng, world);
  }
}

function addFacade(accum, b, rng, o) {
  const { y0, h, w, d, ang, level, levels, isShop, isUnfinished, isPublic } = o;
  if (isUnfinished && level === levels - 1 && rng.chance(0.5)) return; // open frame

  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const P = (lx, lz, y) => [b.wx + lx * ca - lz * sa, y, b.wz + lx * sa + lz * ca];

  const trim = TRIM_COLOURS[rng.int(0, TRIM_COLOURS.length - 1)];
  const trimCol = hexCol(trim);
  const glassCol = [0.14, 0.18, 0.21];

  // the "front" is the +Z local face (the pipeline aligns `a` with the street)
  const faces = [
    { nx: 0, nz: 1, len: w, depthHalf: d / 2, front: true },
    { nx: 0, nz: -1, len: w, depthHalf: d / 2, front: false },
    { nx: 1, nz: 0, len: d, depthHalf: w / 2, front: false },
    { nx: -1, nz: 0, len: d, depthHalf: w / 2, front: false },
  ];

  for (const f of faces) {
    if (!f.front && rng.chance(0.25)) continue; // blank side walls are normal
    const bays = Math.max(1, Math.round(f.len / rng.range(2.1, 3.3)));
    const bayW = f.len / bays;
    const groundFloor = level === 0;
    for (let i = 0; i < bays; i++) {
      const u = -f.len / 2 + bayW * (i + 0.5);
      if (groundFloor && f.front && isShop) continue; // shutter handles it
      const isDoor = groundFloor && f.front && i === Math.floor(bays / 2) && !isShop;
      const skip = !isDoor && rng.chance(f.front ? 0.12 : 0.42);
      if (skip) continue;

      const ow = isDoor ? Math.min(1.15, bayW * 0.52) : Math.min(rng.range(0.95, 1.5), bayW * 0.66);
      const oh = isDoor ? 2.08 : rng.range(1.05, 1.42);
      const oy = isDoor ? y0 + 0.02 : y0 + rng.range(0.95, 1.2);
      if (oy + oh > y0 + h - 0.25) continue;

      const push = f.depthHalf + 0.012;
      const lx = f.nx * push + (f.nx ? 0 : u);
      const lz = f.nz * push + (f.nz ? 0 : u);
      const perpX = f.nx ? 0 : 1;
      const perpZ = f.nz ? 0 : 1;

      // recessed reveal
      const corners = [
        P(lx - perpX * ow / 2, lz - perpZ * ow / 2, oy),
        P(lx + perpX * ow / 2, lz + perpZ * ow / 2, oy),
        P(lx + perpX * ow / 2, lz + perpZ * ow / 2, oy + oh),
        P(lx - perpX * ow / 2, lz - perpZ * ow / 2, oy + oh),
      ];
      const nrm = [f.nx * ca - f.nz * sa, 0, f.nx * sa + f.nz * ca];
      accum.quad(isDoor ? 'flat' : 'glass', corners[0], corners[1], corners[2], corners[3], nrm,
        [0, 0, 1, 0, 1, 1, 0, 1], isDoor ? trimCol : glassCol);

      // frame
      const fw = 0.08;
      const outer = [
        P(lx - perpX * (ow / 2 + fw), lz - perpZ * (ow / 2 + fw), oy - fw),
        P(lx + perpX * (ow / 2 + fw), lz + perpZ * (ow / 2 + fw), oy - fw),
        P(lx + perpX * (ow / 2 + fw), lz + perpZ * (ow / 2 + fw), oy + oh + fw),
        P(lx - perpX * (ow / 2 + fw), lz - perpZ * (ow / 2 + fw), oy + oh + fw),
      ];
      accum.quad('flat', outer[0], outer[1], outer[2], outer[3], nrm, [0, 0, 1, 0, 1, 1, 0, 1],
        [0.9, 0.9, 0.88]);

      // window grille bars -- near-universal here
      if (!isDoor && rng.chance(0.82)) {
        const bars = Math.max(2, Math.round(ow / 0.22));
        for (let k = 1; k < bars; k++) {
          const t = k / bars;
          const bx = lx + perpX * (-ow / 2 + ow * t) + f.nx * 0.02;
          const bz = lz + perpZ * (-ow / 2 + ow * t) + f.nz * 0.02;
          accum.box('flat', P(bx, bz, 0)[0], oy, P(bx, bz, 0)[2], 0.028, oh, 0.028, ang, [0.16, 0.16, 0.17], 1);
        }
      }
      // sunshade / chajja above the opening
      if (rng.chance(f.front ? 0.78 : 0.4)) {
        const sx = lx + f.nx * 0.14;
        const sz = lz + f.nz * 0.14;
        const pw = ow + 0.42;
        accum.box('concrete|0',
          b.wx + sx * ca - sz * sa, oy + oh + 0.06, b.wz + sx * sa + sz * ca,
          f.nx ? 0.36 : pw, 0.075, f.nz ? 0.36 : pw, ang, [0.72, 0.71, 0.68], 0.8);
      }
    }
  }

  // balcony on upper floors facing the street
  if (level > 0 && rng.chance(0.34)) {
    const bw = Math.min(w * 0.55, 3.2);
    const bd = rng.range(0.9, 1.5);
    const lz = d / 2 + bd / 2;
    accum.box('concrete|0', b.wx - lz * sa, y0 + 0.02, b.wz + lz * ca, bw, 0.14, bd, ang, [0.7, 0.69, 0.66], 0.6);
    // railing
    const rails = Math.round(bw / 0.16);
    for (let i = 0; i <= rails; i++) {
      const u = -bw / 2 + (bw * i) / rails;
      const px = u * ca - lz * sa;
      const pz = u * sa + lz * ca;
      accum.box('flat', b.wx + px, y0 + 0.16, b.wz + pz, 0.03, 0.95, 0.03, ang, [0.2, 0.2, 0.22], 1);
    }
    const px = -lz * sa;
    const pz = lz * ca;
    accum.box('flat', b.wx + px, y0 + 1.08, b.wz + pz, bw, 0.06, bd * 0.2, ang, [0.22, 0.22, 0.24], 1);
  }
}

function addParapet(accum, cx, y, cz, w, d, h, ang, matKey, tint, rng) {
  const t = 0.16;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const place = (lx, lz, bw, bd) => {
    accum.box(matKey, cx + lx * ca - lz * sa, y, cz + lx * sa + lz * ca, bw, h, bd, ang, tint, 0.5);
  };
  place(0, d / 2 - t / 2, w, t);
  place(0, -d / 2 + t / 2, w, t);
  place(w / 2 - t / 2, 0, t, d - t * 2);
  place(-w / 2 + t / 2, 0, t, d - t * 2);
  // coping
  const cop = [0.86, 0.85, 0.82];
  accum.box('concrete|2', cx, y + h, cz, w + 0.1, 0.06, d + 0.1, ang, cop, 0.6);
}

function addTerraceClutter(accum, b, rng, y, w, d, ang, levels) {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const at = (lx, lz) => [b.wx + lx * ca - lz * sa, b.wz + lx * sa + lz * ca];

  // Sintex water tank
  if (rng.chance(0.62)) {
    const r = rng.range(0.42, 0.68);
    const hh = rng.range(0.85, 1.25);
    const lx = rng.range(-w / 2 + r + 0.3, w / 2 - r - 0.3);
    const lz = rng.range(-d / 2 + r + 0.3, d / 2 - r - 0.3);
    const [px, pz] = at(lx, lz);
    // short stand
    accum.box('concrete|1', px, y, pz, r * 2.1, 0.32, r * 2.1, ang, [0.6, 0.59, 0.56], 1);
    const col = TANK_COLOURS[rng.int(0, TANK_COLOURS.length - 1)];
    accum.cylinder('flat', px, y + 0.32, pz, r, r * 0.94, hh, 12, col, { capTop: true });
    accum.cylinder('flat', px, y + 0.32 + hh, pz, r * 0.5, r * 0.38, 0.12, 10, col, { capTop: true });
  }

  // staircase head-room box (mumty)
  if (levels >= 2 || rng.chance(0.3)) {
    const sw = rng.range(1.6, 2.4);
    const sd = rng.range(1.5, 2.2);
    if (sw < w - 0.8 && sd < d - 0.8) {
      const lx = (w / 2 - sw / 2 - 0.3) * (rng.chance(0.5) ? 1 : -1);
      const lz = (d / 2 - sd / 2 - 0.3) * (rng.chance(0.5) ? 1 : -1);
      const [px, pz] = at(lx, lz);
      accum.box(`plaster|${rng.int(0, PLASTER_COLOURS.length - 1)}`, px, y, pz, sw, rng.range(2.1, 2.5), sd, ang,
        [1, 1, 1], 0.3);
      accum.box('tin|#9aa39a', px, y + 2.45, pz, sw + 0.3, 0.1, sd + 0.3, ang, [0.8, 0.8, 0.8], 1);
    }
  }

  // TV dish
  if (rng.chance(0.4)) {
    const [px, pz] = at(rng.range(-w / 2, w / 2) * 0.7, rng.range(-d / 2, d / 2) * 0.7);
    accum.box('flat', px, y, pz, 0.05, 0.9, 0.05, ang, [0.3, 0.3, 0.3], 1);
    accum.cylinder('flat', px, y + 0.9, pz, 0.3, 0.26, 0.06, 10, [0.85, 0.85, 0.83], { capTop: true });
  }
  // clothesline posts
  if (rng.chance(0.3)) {
    for (const s of [-1, 1]) {
      const [px, pz] = at(s * (w / 2 - 0.5), 0);
      accum.box('flat', px, y, pz, 0.05, 1.3, 0.05, ang, [0.4, 0.38, 0.34], 1);
    }
  }
}

function addRebar(accum, b, rng, y, w, d, ang) {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const cols = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of cols) {
    const lx = sx * (w / 2 - 0.25);
    const lz = sz * (d / 2 - 0.25);
    const px = b.wx + lx * ca - lz * sa;
    const pz = b.wz + lx * sa + lz * ca;
    accum.box('concrete|1', px, y, pz, 0.32, rng.range(0.4, 1.1), 0.32, ang, [0.62, 0.61, 0.58], 1);
    for (let k = 0; k < 4; k++) {
      accum.box('flat', px + (k % 2 ? 0.08 : -0.08), y + 0.4, pz + (k < 2 ? 0.08 : -0.08),
        0.016, rng.range(0.3, 0.8), 0.016, ang, [0.42, 0.26, 0.16], 1);
    }
  }
}

function addShopfront(accum, b, rng, baseY, storeyH, w, d, ang) {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const front = d / 2;
  const units = Math.max(1, Math.round(w / rng.range(2.6, 4.2)));
  const uw = w / units;
  const shutterCol = SHUTTER_COLOURS[rng.int(0, SHUTTER_COLOURS.length - 1)];
  const sh = Math.min(2.4, storeyH - 0.6);

  for (let i = 0; i < units; i++) {
    const u = -w / 2 + uw * (i + 0.5);
    const openW = uw * rng.range(0.68, 0.86);
    const lx = u;
    const lz = front + 0.02;
    const px = b.wx + lx * ca - lz * sa;
    const pz = b.wz + lx * sa + lz * ca;
    const closed = rng.chance(0.42);
    accum.box(closed ? `shutter|${shutterCol}` : 'flat', px, baseY + 0.02, pz,
      openW, sh, 0.06, ang, closed ? [1, 1, 1] : [0.08, 0.07, 0.07], 1);
    // frame pillars
    accum.box('concrete|0', b.wx + (u - uw / 2) * ca - lz * sa, baseY, b.wz + (u - uw / 2) * sa + lz * ca,
      0.22, sh + 0.25, 0.24, ang, [0.66, 0.65, 0.62], 1);
  }
  accum.box('concrete|0', b.wx + (w / 2) * ca - (front + 0.02) * sa, baseY,
    b.wz + (w / 2) * sa + (front + 0.02) * ca, 0.22, sh + 0.25, 0.24, ang, [0.66, 0.65, 0.62], 1);

  // awning: corrugated sheet on a slope
  const awD = rng.range(1.1, 2.0);
  const awY = baseY + sh + 0.3;
  const lzA = front + awD / 2;
  const pxA = b.wx + 0 * ca - lzA * sa;
  const pzA = b.wz + 0 * sa + lzA * ca;
  const tin = TIN_TINTS[rng.int(0, TIN_TINTS.length - 1)];
  // sloped quad
  const P = (lx, lz, y) => [b.wx + lx * ca - lz * sa, y, b.wz + lx * sa + lz * ca];
  accum.quad(`tin|${tin}`,
    P(-w / 2, front, awY + 0.3), P(w / 2, front, awY + 0.3),
    P(w / 2, front + awD, awY - 0.15), P(-w / 2, front + awD, awY - 0.15),
    [0, 0.93, 0.36], [0, 0, w * 0.5, 0, w * 0.5, awD * 0.5, 0, awD * 0.5], [0.95, 0.95, 0.95]);
  // supports
  for (const s of [-1, 1]) {
    accum.box('flat', ...[P(s * (w / 2 - 0.15), front + awD - 0.1, 0)[0], baseY, P(s * (w / 2 - 0.15), front + awD - 0.1, 0)[2]],
      0.05, awY - 0.15 - baseY, 0.05, ang, [0.3, 0.29, 0.27], 1);
  }

  // signboard
  if (rng.chance(0.85)) {
    const name = SHOP_NAMES[hashU32(b.sd, b.id, 7) % SHOP_NAMES.length];
    const sub = SHOP_SUBS[hashU32(b.sd, b.id, 11) % SHOP_SUBS.length];
    const bg = SIGN_BG[hashU32(b.sd, b.id, 13) % SIGN_BG.length];
    const sy = awY + 0.42;
    const sHh = rng.range(0.55, 0.85);
    const key = `sign|${name}|${bg[0]}|${bg[1]}|${sub}`;
    const lzS = front + 0.1;
    accum.quad(key,
      P(-w / 2 + 0.1, lzS, sy), P(w / 2 - 0.1, lzS, sy),
      P(w / 2 - 0.1, lzS, sy + sHh), P(-w / 2 + 0.1, lzS, sy + sHh),
      [-sa, 0, ca], [0, 1, 1, 1, 1, 0, 0, 0], [1, 1, 1]);
    accum.box('flat', b.wx - lzS * sa, sy - 0.05, b.wz + lzS * ca, w - 0.1, sHh + 0.1, 0.07, ang, [0.12, 0.12, 0.12], 1);
  }
}

const SHOP_NAMES = [
  'SRI LAKSHMI', 'VENKATESWARA', 'SAI KIRANA', 'ANNAPURNA', 'RAMA & CO',
  'NAVEEN STORES', 'SRI DURGA', 'BALAJI', 'NEW STAR', 'GANESH',
  'SRI SAI', 'JAI HANUMAN', 'PADMAVATHI', 'ANJALI', 'SRI RAMA',
  'KRISHNA', 'VIJAYA', 'MAHALAKSHMI', 'SRINIVASA', 'TIRUMALA',
];
const SHOP_SUBS = [
  'GENERAL STORES', 'KIRANA', 'MOBILES', 'TAILORS', 'MEDICALS',
  'HOTEL & TIFFINS', 'HARDWARE', 'XEROX & NET', 'FANCY STORE', 'CYCLE MART',
  'ELECTRICALS', 'CLOTH STORE', 'SWEETS', 'TEA STALL', 'BAKERY',
];
const SIGN_BG = [
  ['#1d4f3c', '#f6e9c8'], ['#8a2518', '#ffe9c0'], ['#1b3b6b', '#ffffff'],
  ['#d8a200', '#2b1d00'], ['#2f2f33', '#ffd75e'], ['#6b1b4a', '#ffe6f0'],
];

function addCompound(accum, b, rng, world) {
  const [frontage, depth, setback, halfRoad] = b.pl;
  if (setback < 2.0) return;
  const ang = b.ang3;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const h = rng.range(1.35, 1.85);
  const t = 0.18;
  const w = frontage - 0.3;
  const front = -(setback - 0.5) - 0; // relative to building centre, towards street
  // Determine the plot front relative to the building: building sits setback from street
  const bFrontLocal = -(b.d / 2 + setback - 0.6);
  const matKey = `plaster|${rng.int(0, PLASTER_COLOURS.length - 1)}`;
  const tint = [0.95, 0.94, 0.9];

  const P = (lx, lz) => [b.wx + lx * ca - lz * sa, b.wz + lx * sa + lz * ca];

  // street-facing wall with a gate gap
  const gateW = Math.min(3.0, w * 0.42);
  const segW = (w - gateW) / 2;
  for (const s of [-1, 1]) {
    const u = s * (gateW / 2 + segW / 2);
    const [px, pz] = P(u, b.d / 2 + setback - 0.4);
    accum.box(matKey, px, b.g, pz, segW, h, t, ang, tint, 0.6);
    accum.box('concrete|2', px, b.g + h, pz, segW + 0.06, 0.07, t + 0.06, ang, [0.8, 0.79, 0.76], 1);
  }
  // pillars
  for (const s of [-1, 1]) {
    const [px, pz] = P(s * gateW / 2, b.d / 2 + setback - 0.4);
    accum.box('concrete|0', px, b.g, pz, 0.26, h + 0.3, 0.26, ang, [0.7, 0.69, 0.66], 1);
  }
  // steel gate
  const [gx, gz] = P(0, b.d / 2 + setback - 0.4);
  const gateCol = rng.chance(0.5) ? [0.18, 0.28, 0.22] : [0.3, 0.2, 0.16];
  accum.box('flat', gx, b.g, gz, gateW - 0.1, h * 0.92, 0.06, ang, gateCol, 1);
  const bars = Math.round(gateW / 0.22);
  for (let i = 1; i < bars; i++) {
    const u = -gateW / 2 + (gateW * i) / bars;
    const [px, pz] = P(u, b.d / 2 + setback - 0.33);
    accum.box('flat', px, b.g, pz, 0.035, h * 0.92, 0.035, ang, [0.1, 0.12, 0.1], 1);
  }
  // side walls
  for (const s of [-1, 1]) {
    const [px, pz] = P(s * (w / 2), b.d / 2 + setback / 2 - 0.4);
    accum.box(matKey, px, b.g, pz, t, h * 0.92, setback + 0.4, ang, tint, 0.6);
  }
}

// ---------------------------------------------------------------- variants

function buildHut(accum, b, world, rng, lod) {
  const ang = b.ang3;
  const w = Math.min(b.w, 7);
  const d = Math.min(b.d, 6.5);
  const h = rng.range(2.2, 2.7);
  const wallKey = rng.chance(0.45) ? 'brick' : `plaster|${rng.int(0, 5)}`;
  accum.box('concrete|0', b.wx, b.g - 0.25, b.wz, w + 0.3, 0.35, d + 0.3, ang, [0.6, 0.57, 0.52], 0.6);
  accum.box(wallKey, b.wx, b.g + 0.1, b.wz, w, h, d, ang, [0.92, 0.9, 0.86], 0.4, { skipTop: true });
  // pitched tin/thatch roof
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const P = (lx, lz, y) => [b.wx + lx * ca - lz * sa, y, b.wz + lx * sa + lz * ca];
  const ov = 0.42;
  const ridge = h + rng.range(0.6, 1.1);
  const thatch = rng.chance(0.42);
  const key = thatch ? 'flat' : `tin|${TIN_TINTS[rng.int(0, 3)]}`;
  const col = thatch ? [0.52, 0.42, 0.26] : [0.95, 0.95, 0.95];
  const y0 = b.g + 0.1 + h;
  accum.quad(key, P(-w / 2 - ov, -d / 2 - ov, y0), P(w / 2 + ov, -d / 2 - ov, y0),
    P(w / 2 + ov, 0, b.g + 0.1 + ridge), P(-w / 2 - ov, 0, b.g + 0.1 + ridge),
    [0, 0.8, -0.6], [0, 0, w, 0, w, d / 2, 0, d / 2], col);
  accum.quad(key, P(w / 2 + ov, d / 2 + ov, y0), P(-w / 2 - ov, d / 2 + ov, y0),
    P(-w / 2 - ov, 0, b.g + 0.1 + ridge), P(w / 2 + ov, 0, b.g + 0.1 + ridge),
    [0, 0.8, 0.6], [0, 0, w, 0, w, d / 2, 0, d / 2], col);
  // gable fill
  accum.quad('flat2', P(-w / 2, -d / 2, y0), P(-w / 2, d / 2, y0), P(-w / 2, 0, b.g + 0.1 + ridge),
    P(-w / 2, 0, b.g + 0.1 + ridge), [-1, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], [0.8, 0.78, 0.72]);
  if (lod === 0) {
    // door
    accum.box('flat', ...[P(0, d / 2 + 0.03, 0)[0], b.g + 0.1, P(0, d / 2 + 0.03, 0)[2]],
      0.9, 1.95, 0.05, ang, [0.32, 0.22, 0.14], 1);
  }
}

function buildShed(accum, b, world, rng, lod) {
  const ang = b.ang3;
  const w = b.w;
  const d = b.d;
  const h = rng.range(2.4, 3.2);
  const tin = TIN_TINTS[rng.int(0, 3)];
  accum.box(`tin|${tin}`, b.wx, b.g, b.wz, w, h, d, ang, [0.86, 0.86, 0.86], 0.9, { skipTop: true });
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const P = (lx, lz, y) => [b.wx + lx * ca - lz * sa, y, b.wz + lx * sa + lz * ca];
  accum.quad(`tin|${tin}`, P(-w / 2 - 0.3, -d / 2 - 0.3, b.g + h + 0.35), P(w / 2 + 0.3, -d / 2 - 0.3, b.g + h + 0.35),
    P(w / 2 + 0.3, d / 2 + 0.3, b.g + h), P(-w / 2 - 0.3, d / 2 + 0.3, b.g + h),
    [0, 0.98, 0.18], [0, 0, w, 0, w, d, 0, d], [0.9, 0.9, 0.9]);
}

function buildWarehouse(accum, b, world, rng, lod) {
  const ang = b.ang3;
  const w = b.w;
  const d = b.d;
  const h = rng.range(5.0, 7.5);
  accum.box('concrete|0', b.wx, b.g - 0.3, b.wz, w + 0.5, 0.4, d + 0.5, ang, [0.6, 0.59, 0.56], 0.5);
  accum.box(`plaster|${rng.int(0, 5)}`, b.wx, b.g + 0.1, b.wz, w, h, d, ang, [0.9, 0.89, 0.86], 0.2, { skipTop: true });
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const P = (lx, lz, y) => [b.wx + lx * ca - lz * sa, y, b.wz + lx * sa + lz * ca];
  const ridge = b.g + 0.1 + h + Math.min(2.4, d * 0.16);
  const tin = TIN_TINTS[rng.int(0, 3)];
  accum.quad(`tin|${tin}`, P(-w / 2 - 0.4, -d / 2 - 0.4, b.g + 0.1 + h), P(w / 2 + 0.4, -d / 2 - 0.4, b.g + 0.1 + h),
    P(w / 2 + 0.4, 0, ridge), P(-w / 2 - 0.4, 0, ridge), [0, 0.9, -0.4],
    [0, 0, w * 0.4, 0, w * 0.4, d * 0.4, 0, d * 0.4], [0.92, 0.92, 0.92]);
  accum.quad(`tin|${tin}`, P(w / 2 + 0.4, d / 2 + 0.4, b.g + 0.1 + h), P(-w / 2 - 0.4, d / 2 + 0.4, b.g + 0.1 + h),
    P(-w / 2 - 0.4, 0, ridge), P(w / 2 + 0.4, 0, ridge), [0, 0.9, 0.4],
    [0, 0, w * 0.4, 0, w * 0.4, d * 0.4, 0, d * 0.4], [0.92, 0.92, 0.92]);
  if (lod === 0) {
    const doorW = Math.min(w * 0.4, 4.2);
    accum.box('shutter|#5a5a62', b.wx - (d / 2 + 0.03) * sa, b.g + 0.1, b.wz + (d / 2 + 0.03) * ca,
      doorW, Math.min(3.6, h - 0.6), 0.08, ang, [1, 1, 1], 1);
  }
}

function buildWaterTank(accum, b, world, rng, lod) {
  // Overhead municipal tank -- a real landmark silhouette in every AP town.
  const r = clamp(Math.max(b.w, b.d) * 0.42, 2.4, 5.2);
  const legH = rng.range(11, 17);
  const col = [0.76, 0.74, 0.68];
  const legs = 6;
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * Math.PI * 2;
    const px = b.wx + Math.cos(a) * r * 0.82;
    const pz = b.wz + Math.sin(a) * r * 0.82;
    accum.cylinder('concrete|0', px, b.g, pz, 0.34, 0.26, legH, 8, col);
  }
  // bracing rings
  for (let k = 1; k <= 3; k++) {
    const y = b.g + (legH * k) / 4;
    for (let i = 0; i < legs; i++) {
      const a0 = (i / legs) * Math.PI * 2;
      const a1 = ((i + 1) / legs) * Math.PI * 2;
      const x0 = b.wx + Math.cos(a0) * r * 0.82;
      const z0 = b.wz + Math.sin(a0) * r * 0.82;
      const x1 = b.wx + Math.cos(a1) * r * 0.82;
      const z1 = b.wz + Math.sin(a1) * r * 0.82;
      const len = Math.hypot(x1 - x0, z1 - z0);
      accum.box('concrete|0', (x0 + x1) / 2, y, (z0 + z1) / 2, len, 0.18, 0.18,
        Math.atan2(z1 - z0, x1 - x0), col, 1);
    }
  }
  accum.cylinder('concrete|2', b.wx, b.g + legH, b.wz, r * 0.7, r, 1.2, 16, col);
  accum.cylinder('concrete|2', b.wx, b.g + legH + 1.2, b.wz, r, r * 0.98, 4.2, 16, col, { capTop: true });
  accum.cylinder('concrete|2', b.wx, b.g + legH + 5.4, b.wz, r * 0.98, r * 0.6, 0.9, 16, [0.6, 0.6, 0.58], { capTop: true });
  // ladder
  accum.box('flat', b.wx + r * 0.9, b.g, b.wz, 0.06, legH, 0.5, 0, [0.3, 0.3, 0.32], 1);
}

// ---------------------------------------------------------------- religious

function buildTemple(accum, b, world, rng, lod) {
  const ang = b.ang3;
  const w = clamp(b.w, 5, 26);
  const d = clamp(b.d, 5, 30);
  const g = b.g;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const P = (lx, lz, y) => [b.wx + lx * ca - lz * sa, y, b.wz + lx * sa + lz * ca];

  const white = [0.96, 0.94, 0.88];
  const ochre = [0.88, 0.62, 0.3];

  // raised platform
  accum.box('concrete|2', b.wx, g - 0.1, b.wz, w + 2.2, 0.85, d + 2.2, ang, [0.78, 0.76, 0.72], 0.4);
  // steps at the front
  for (let i = 0; i < 3; i++) {
    accum.box('concrete|2', b.wx - (d / 2 + 1.3 + i * 0.34) * sa, g - 0.1 + i * 0.25, b.wz + (d / 2 + 1.3 + i * 0.34) * ca,
      Math.min(w, 6), 0.26, 0.34, ang, [0.8, 0.78, 0.74], 1);
  }

  // main hall (mandapa)
  const hallH = rng.range(4.2, 5.6);
  accum.box('plaster|1', b.wx, g + 0.75, b.wz, w, hallH, d, ang, white, 0.3, { skipTop: true });
  accum.box('concrete|2', b.wx, g + 0.75 + hallH, b.wz, w + 0.8, 0.35, d + 0.8, ang, [0.86, 0.84, 0.8], 0.6);

  // pillared porch
  const cols = Math.max(2, Math.round(w / 2.4));
  for (let i = 0; i <= cols; i++) {
    const u = -w / 2 + (w * i) / cols;
    const [px, pz] = [P(u, d / 2 + 1.1, 0)[0], P(u, d / 2 + 1.1, 0)[2]];
    accum.box('concrete|2', px, g + 0.75, pz, 0.3, hallH - 0.4, 0.3, ang, [0.9, 0.88, 0.84], 1);
    accum.box('concrete|2', px, g + 0.75 + hallH - 0.4, pz, 0.46, 0.3, 0.46, ang, ochre, 1);
  }
  accum.box('concrete|2', b.wx - (d / 2 + 1.1) * sa, g + 0.75 + hallH, b.wz + (d / 2 + 1.1) * ca,
    w + 0.8, 0.4, 2.6, ang, [0.86, 0.84, 0.8], 0.8);

  // vimana / gopuram -- the stepped tower that makes it read as a temple
  const towerW = Math.min(w * 0.55, 6.5);
  const towerD = Math.min(d * 0.45, 6.5);
  const tiers = rng.int(4, 7);
  let ty = g + 0.75 + hallH + 0.35;
  let tw = towerW;
  let td = towerD;
  const back = -d * 0.22;
  for (let i = 0; i < tiers; i++) {
    const th = lerp(1.5, 0.75, i / tiers);
    const [px, pz] = [P(0, back, 0)[0], P(0, back, 0)[2]];
    accum.box(i % 2 ? 'plaster|12' : 'plaster|1', px, ty, pz, tw, th, td, ang,
      i % 2 ? ochre : white, 0.6, { skipTop: true });
    // cornice
    accum.box('concrete|2', px, ty + th, pz, tw + 0.35, 0.18, td + 0.35, ang, [0.9, 0.78, 0.6], 1);
    ty += th + 0.18;
    tw *= 0.84;
    td *= 0.84;
  }
  // kalasam finial
  const [fx, fz] = [P(0, back, 0)[0], P(0, back, 0)[2]];
  accum.cylinder('metal', fx, ty, fz, tw * 0.3, tw * 0.16, 0.5, 10, [0.85, 0.7, 0.28], { capTop: true });
  accum.cylinder('metal', fx, ty + 0.5, fz, tw * 0.22, 0.02, 0.85, 10, [0.9, 0.76, 0.3], { capTop: true });

  // compound wall with gate towers
  if (lod === 0) {
    const cw = w + 7;
    const cd = d + 7;
    const h = 1.75;
    const t = 0.25;
    for (const [lx, lz, bw, bd] of [
      [0, -cd / 2, cw, t],
      [cw / 2, 0, t, cd],
      [-cw / 2, 0, t, cd],
    ]) {
      const [px, pz] = [P(lx, lz, 0)[0], P(lx, lz, 0)[2]];
      accum.box('plaster|1', px, g - 0.1, pz, bw, h, bd, ang, white, 0.5);
    }
    // front wall with opening
    const gateW = 3.6;
    for (const s of [-1, 1]) {
      const segW = (cw - gateW) / 2;
      const [px, pz] = [P(s * (gateW / 2 + segW / 2), cd / 2, 0)[0], P(s * (gateW / 2 + segW / 2), cd / 2, 0)[2]];
      accum.box('plaster|1', px, g - 0.1, pz, segW, h, t, ang, white, 0.5);
      const [qx, qz] = [P(s * gateW / 2, cd / 2, 0)[0], P(s * gateW / 2, cd / 2, 0)[2]];
      accum.box('plaster|12', qx, g - 0.1, qz, 0.7, 3.4, 0.7, ang, ochre, 0.8);
      accum.cylinder('metal', qx, g + 3.3, qz, 0.3, 0.05, 0.55, 8, [0.85, 0.7, 0.28], { capTop: true });
    }
    // orange/white vertical stripes on the compound: unmistakably a temple
    for (let i = 0; i < Math.round(cw / 1.1); i++) {
      if (i % 2) continue;
      const u = -cw / 2 + i * 1.1 + 0.55;
      const [px, pz] = [P(u, -cd / 2 - 0.14, 0)[0], P(u, -cd / 2 - 0.14, 0)[2]];
      accum.box('flat', px, g - 0.1, pz, 0.55, h, 0.04, ang, ochre, 1);
    }
  }
}

function buildMosque(accum, b, world, rng, lod) {
  const ang = b.ang3;
  const w = clamp(b.w, 6, 24);
  const d = clamp(b.d, 6, 24);
  const g = b.g;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const P = (lx, lz) => [b.wx + lx * ca - lz * sa, b.wz + lx * sa + lz * ca];
  const white = [0.97, 0.96, 0.93];
  const green = [0.25, 0.52, 0.36];

  accum.box('concrete|2', b.wx, g - 0.1, b.wz, w + 1.6, 0.6, d + 1.6, ang, [0.82, 0.8, 0.76], 0.4);
  const h = rng.range(4.6, 6.2);
  accum.box('plaster|1', b.wx, g + 0.5, b.wz, w, h, d, ang, white, 0.28, { skipTop: true });
  accum.box('concrete|2', b.wx, g + 0.5 + h, b.wz, w + 0.7, 0.4, d + 0.7, ang, [0.88, 0.87, 0.84], 0.6);
  // parapet with merlons
  const n = Math.round(w / 0.9);
  for (let i = 0; i < n; i++) {
    const u = -w / 2 + (w * (i + 0.5)) / n;
    for (const s of [-1, 1]) {
      const [px, pz] = P(u, s * (d / 2 + 0.2));
      accum.box('plaster|1', px, g + 0.9 + h, pz, 0.42, 0.45, 0.3, ang, white, 1);
    }
  }
  // central dome
  const domeR = Math.min(w, d) * 0.3;
  const domeY = g + 0.9 + h + 0.4;
  const segs = 10;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const r0 = Math.cos(t0 * Math.PI * 0.5) * domeR;
    const r1 = Math.cos(t1 * Math.PI * 0.5) * domeR;
    const y0 = domeY + Math.sin(t0 * Math.PI * 0.5) * domeR * 1.08;
    const y1 = domeY + Math.sin(t1 * Math.PI * 0.5) * domeR * 1.08;
    accum.cylinder('plaster|1', b.wx, y0, b.wz, r0, r1, y1 - y0, 14, green, {});
  }
  accum.cylinder('metal', b.wx, domeY + domeR * 1.08, b.wz, 0.14, 0.02, 0.8, 8, [0.85, 0.74, 0.3], { capTop: true });
  // minarets
  for (const s of [-1, 1]) {
    const [px, pz] = P(s * (w / 2 - 0.5), d / 2 - 0.5);
    const mh = rng.range(8, 13);
    accum.cylinder('plaster|1', px, g + 0.5, pz, 0.55, 0.42, mh, 10, white, {});
    accum.cylinder('plaster|1', px, g + 0.5 + mh, pz, 0.62, 0.62, 0.5, 10, green, { capTop: true });
    accum.cylinder('plaster|1', px, g + 1.0 + mh, pz, 0.4, 0.05, 1.1, 10, green, { capTop: true });
    accum.cylinder('metal', px, g + 2.1 + mh, pz, 0.08, 0.02, 0.5, 6, [0.85, 0.74, 0.3], { capTop: true });
  }
}

function buildChurch(accum, b, world, rng, lod) {
  const ang = b.ang3;
  const w = clamp(b.w, 6, 20);
  const d = clamp(b.d, 8, 32);
  const g = b.g;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const P = (lx, lz, y) => [b.wx + lx * ca - lz * sa, y, b.wz + lx * sa + lz * ca];
  const white = [0.97, 0.96, 0.94];

  accum.box('concrete|2', b.wx, g - 0.1, b.wz, w + 1.2, 0.5, d + 1.2, ang, [0.82, 0.8, 0.76], 0.4);
  const h = rng.range(5.5, 7.5);
  accum.box('plaster|1', b.wx, g + 0.4, b.wz, w, h, d, ang, white, 0.26, { skipTop: true });
  // pitched roof
  const ridge = g + 0.4 + h + Math.min(3.2, w * 0.32);
  accum.quad('tile', P(-w / 2 - 0.3, -d / 2 - 0.3, g + 0.4 + h), P(-w / 2 - 0.3, d / 2 + 0.3, g + 0.4 + h),
    P(0, d / 2 + 0.3, ridge), P(0, -d / 2 - 0.3, ridge), [-0.6, 0.8, 0],
    [0, 0, d * 0.4, 0, d * 0.4, w * 0.3, 0, w * 0.3], [0.95, 0.95, 0.95]);
  accum.quad('tile', P(w / 2 + 0.3, d / 2 + 0.3, g + 0.4 + h), P(w / 2 + 0.3, -d / 2 - 0.3, g + 0.4 + h),
    P(0, -d / 2 - 0.3, ridge), P(0, d / 2 + 0.3, ridge), [0.6, 0.8, 0],
    [0, 0, d * 0.4, 0, d * 0.4, w * 0.3, 0, w * 0.3], [0.95, 0.95, 0.95]);
  // bell tower at the front
  const tw = Math.min(w * 0.42, 3.6);
  const [tx, tz] = [P(0, d / 2 + tw / 2, 0)[0], P(0, d / 2 + tw / 2, 0)[2]];
  const th = h + rng.range(4, 7);
  accum.box('plaster|1', tx, g + 0.4, tz, tw, th, tw, ang, white, 0.4, { skipTop: true });
  accum.box('concrete|2', tx, g + 0.4 + th, tz, tw + 0.5, 0.3, tw + 0.5, ang, [0.88, 0.87, 0.84], 1);
  // spire
  accum.cylinder('plaster|1', tx, g + 0.7 + th, tz, tw * 0.6, 0.05, 2.6, 4, [0.85, 0.3, 0.25], { capTop: true });
  // cross
  accum.box('flat', tx, g + 3.3 + th, tz, 0.1, 1.2, 0.1, ang, [0.9, 0.88, 0.84], 1);
  accum.box('flat', tx, g + 4.05 + th, tz, 0.7, 0.1, 0.1, ang, [0.9, 0.88, 0.84], 1);
}

function hexCol(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Simplified far-LOD silhouette used by the distant-town layer. */
export function buildingSilhouette(b) {
  return {
    x: b.wx,
    y: b.g,
    z: b.wz,
    w: b.w,
    d: b.d,
    h: b.h + b.pp,
    ang: b.ang3,
    cat: b.cat,
  };
}


// ---------------------------------------------------------------- site

/**
 * A large mapped footprint is a *site*, not a building: a school campus, a
 * training institute, a depot. Draw its boundary wall, a gate and a yard,
 * and let the separately-generated blocks inside do the building work.
 */
function buildCompoundSite(accum, b, world, rng, lod) {
  const poly = b.poly3 || null;
  const wallH = 2.1 + rng.range(-0.2, 0.35);
  const wallCol = [0.9, 0.88, 0.82];
  const trimCol = TRIM_COLOURS[rng.int(0, TRIM_COLOURS.length - 1)];

  // boundary: use the surveyed polygon when we have it, else the fitted rect
  let ring;
  if (poly && poly.length >= 4) {
    ring = poly;
  } else {
    const ca = Math.cos(b.ang3);
    const sa = Math.sin(b.ang3);
    const hw = b.w / 2;
    const hd = b.d / 2;
    ring = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => [
      b.wx + lx * ca - lz * sa,
      b.wz + lx * sa + lz * ca,
    ]);
  }

  // find the longest edge: that is where the gate goes
  let gateIdx = 0;
  let gateLen = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const c = ring[(i + 1) % ring.length];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L > gateLen) {
      gateLen = L;
      gateIdx = i;
    }
  }

  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const c = ring[(i + 1) % ring.length];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L < 0.5) continue;
    const ang = Math.atan2(c[1] - a[1], c[0] - a[0]);
    const segs = Math.max(1, Math.round(L / 6));
    const gateT = i === gateIdx ? 0.5 : -1;
    for (let k = 0; k < segs; k++) {
      const t0 = k / segs;
      const t1 = (k + 1) / segs;
      const tm = (t0 + t1) / 2;
      // leave a gap for the gate
      if (gateT >= 0 && Math.abs(tm - gateT) * L < 3.6) continue;
      const mx = a[0] + (c[0] - a[0]) * tm;
      const mz = a[1] + (c[1] - a[1]) * tm;
      const y = world.heightAt(mx, mz);
      const segLen = (L / segs) + 0.12;
      accum.box('plaster|7', mx, y - 0.25, mz, segLen, wallH + 0.25, 0.22, ang, wallCol, 0.5);
      accum.box('concrete|2', mx, y + wallH, mz, segLen, 0.1, 0.3, ang, [0.78, 0.76, 0.72], 1);
      // pillar at each segment join
      const px = a[0] + (c[0] - a[0]) * t1;
      const pz = a[1] + (c[1] - a[1]) * t1;
      const py = world.heightAt(px, pz);
      accum.box('plaster|7', px, py - 0.25, pz, 0.32, wallH + 0.55, 0.32, ang, wallCol, 1);
      accum.box('concrete|2', px, py + wallH + 0.3, pz, 0.42, 0.14, 0.42, ang, trimCol, 1);
    }
  }

  if (lod === 0) {
    // gate: two piers and a barred steel leaf set
    const a = ring[gateIdx];
    const c = ring[(gateIdx + 1) % ring.length];
    const ang = Math.atan2(c[1] - a[1], c[0] - a[0]);
    const mx = a[0] + (c[0] - a[0]) * 0.5;
    const mz = a[1] + (c[1] - a[1]) * 0.5;
    const my = world.heightAt(mx, mz);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (const s of [-1, 1]) {
      const px = mx + ca * s * 3.4;
      const pz = mz + sa * s * 3.4;
      const py = world.heightAt(px, pz);
      accum.box('plaster|7', px, py - 0.25, pz, 0.5, wallH + 1.0, 0.5, ang, wallCol, 1);
      accum.box('concrete|2', px, py + wallH + 0.75, pz, 0.66, 0.2, 0.66, ang, trimCol, 1);
    }
    const bars = 13;
    for (let i = 0; i < bars; i++) {
      const t = (i / (bars - 1) - 0.5) * 6.4;
      const px = mx + ca * t;
      const pz = mz + sa * t;
      accum.box('metal', px, my, pz, 0.05, wallH * 0.92, 0.05, ang, [0.3, 0.33, 0.3], 1);
    }
    accum.box('metal', mx, my + wallH * 0.9, mz, 6.6, 0.08, 0.08, ang, [0.3, 0.33, 0.3], 1);
    accum.box('metal', mx, my + wallH * 0.45, mz, 6.6, 0.07, 0.07, ang, [0.3, 0.33, 0.3], 1);

    // name board over the gate
    if (b.n) {
      const label = b.n.length > 26 ? `${b.n.slice(0, 24)}…` : b.n;
      const key = `sign|${label}|#1d3f6b|#f4ecd8|`;
      const boardW = Math.min(7.0, 1.2 + label.length * 0.26);
      const yTop = my + wallH + 1.9;
      const P = (lx, ly) => [mx + ca * lx, ly, mz + sa * lx];
      accum.quad(key, P(-boardW / 2, yTop - 0.9), P(boardW / 2, yTop - 0.9), P(boardW / 2, yTop), P(-boardW / 2, yTop),
        [-sa, 0, ca], [0, 1, 1, 1, 1, 0, 0, 0], [1, 1, 1]);
      accum.box('flat', mx, yTop - 0.92, mz, boardW, 0.95, 0.07, ang, [0.11, 0.25, 0.42], 1);
    }
  }
}
