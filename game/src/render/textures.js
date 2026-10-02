// Procedural texture factory.
//
// Everything the game draws is generated here at load time on a 2D canvas --
// no imagery is downloaded, scraped or shipped.  Each generator is seeded so
// the same texture appears every run.

import * as THREE from 'three';
import { Rng } from '../core/rng.js';

const cache = new Map();

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function finish(canvas, { repeat = 1, aniso = 8, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function texture(key, size, draw, opts) {
  if (cache.has(key)) return cache.get(key);
  const c = makeCanvas(size);
  draw(c.getContext('2d'), size, new Rng(hashString(key)));
  const t = finish(c, opts);
  cache.set(key, t);
  return t;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------- helpers

function noiseFill(ctx, size, rng, base, amp, grain = 1) {
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = (rng.f() - 0.5) * amp;
      d[i] = clamp255(base[0] + n * grain);
      d[i + 1] = clamp255(base[1] + n * grain);
      d[i + 2] = clamp255(base[2] + n * grain);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function blotches(ctx, size, rng, count, colorFn, rMin, rMax, alpha = 0.3) {
  for (let i = 0; i < count; i++) {
    const x = rng.f() * size;
    const y = rng.f() * size;
    const r = rng.range(rMin, rMax);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = colorFn(rng);
    g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${alpha})`);
    g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // wrap
    for (const [ox, oy] of [[size, 0], [-size, 0], [0, size], [0, -size]]) {
      if (x + ox < -r || x + ox > size + r || y + oy < -r || y + oy > size + r) continue;
      const g2 = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g2.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${alpha})`);
      g2.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function cracks(ctx, size, rng, count, color, width) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = rng.f() * size;
    let y = rng.f() * size;
    let a = rng.f() * Math.PI * 2;
    ctx.lineWidth = width * rng.range(0.5, 1.3);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = rng.int(3, 9);
    for (let s = 0; s < segs; s++) {
      a += rng.sym() * 0.9;
      const L = rng.range(4, 26);
      x += Math.cos(a) * L;
      y += Math.sin(a) * L;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- surfaces

export function asphaltTexture(quality = 0.7, seed = 0) {
  const q = Math.round(quality * 4) / 4;
  return texture(`asphalt_${q}_${seed}`, 512, (ctx, size, rng) => {
    const dark = 54 + (1 - q) * 14;
    noiseFill(ctx, size, rng, [dark, dark - 2, dark - 4], 34 + (1 - q) * 26, 1);
    // aggregate
    for (let i = 0; i < 2600; i++) {
      const x = rng.f() * size;
      const y = rng.f() * size;
      const r = rng.range(0.6, 2.2);
      const v = rng.range(60, 118);
      ctx.fillStyle = `rgba(${v},${v - 3},${v - 7},${rng.range(0.1, 0.45)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // bitumen patches -- very characteristic of Indian repair work
    const patches = Math.round((1 - q) * 14) + 2;
    for (let i = 0; i < patches; i++) {
      const x = rng.f() * size;
      const y = rng.f() * size;
      const w = rng.range(40, 170);
      const h = rng.range(26, 120);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rng.sym() * 0.5);
      ctx.fillStyle = `rgba(${26 + rng.range(0, 16)},${24 + rng.range(0, 14)},${24 + rng.range(0, 12)},${rng.range(0.45, 0.8)})`;
      ctx.beginPath();
      roundishRect(ctx, -w / 2, -h / 2, w, h, rng);
      ctx.fill();
      ctx.restore();
    }
    cracks(ctx, size, rng, Math.round((1 - q) * 60) + 6, 'rgba(20,18,16,0.6)', 1.2);
    // dust bleach
    blotches(ctx, size, rng, 26, () => [150, 140, 118], 20, 90, 0.10 + (1 - q) * 0.14);
  }, { repeat: 1 });
}

export function concreteRoadTexture(seed = 0) {
  return texture(`croad_${seed}`, 512, (ctx, size, rng) => {
    noiseFill(ctx, size, rng, [146, 142, 132], 26);
    blotches(ctx, size, rng, 30, () => [120, 116, 106], 20, 80, 0.2);
    ctx.strokeStyle = 'rgba(70,68,62,0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 2; i++) {
      const y = (i * size) / 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
    cracks(ctx, size, rng, 14, 'rgba(60,58,54,0.5)', 1);
  });
}

export function dirtRoadTexture(seed = 0) {
  return texture(`dirt_${seed}`, 512, (ctx, size, rng) => {
    noiseFill(ctx, size, rng, [146, 118, 82], 40);
    blotches(ctx, size, rng, 44, (r) => (r.f() < 0.5 ? [120, 94, 62] : [172, 146, 108]), 16, 80, 0.3);
    // wheel ruts
    for (const cx of [size * 0.3, size * 0.7]) {
      const g = ctx.createLinearGradient(cx - 24, 0, cx + 24, 0);
      g.addColorStop(0, 'rgba(110,86,56,0)');
      g.addColorStop(0.5, 'rgba(110,86,56,0.45)');
      g.addColorStop(1, 'rgba(110,86,56,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - 24, 0, 48, size);
    }
    for (let i = 0; i < 700; i++) {
      const x = rng.f() * size;
      const y = rng.f() * size;
      ctx.fillStyle = `rgba(${rng.range(90, 180) | 0},${rng.range(80, 150) | 0},${rng.range(60, 110) | 0},0.5)`;
      ctx.fillRect(x, y, rng.range(1, 3), rng.range(1, 3));
    }
  });
}

export function gravelTexture(seed = 0) {
  return texture(`gravel_${seed}`, 512, (ctx, size, rng) => {
    noiseFill(ctx, size, rng, [136, 124, 104], 30);
    for (let i = 0; i < 5200; i++) {
      const x = rng.f() * size;
      const y = rng.f() * size;
      const r = rng.range(0.8, 3.0);
      const v = rng.range(80, 175);
      ctx.fillStyle = `rgba(${v},${v - 6},${v - 16},${rng.range(0.3, 0.8)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// ---------------------------------------------------------------- ground

export function groundAtlasTexture() {
  // 6 tiles in a 3x2 atlas: dry earth, field, scrub, town, water bed, grass
  return texture('groundatlas', 1536, (ctx, size, rng) => {
    const tile = size / 3;
    const defs = [
      { base: [168, 139, 100], spots: [[146, 116, 78], [190, 164, 126]], grit: 0.7 },  // dry earth
      { base: [128, 136, 78], spots: [[104, 118, 58], [156, 160, 96]], grit: 0.5 },   // field
      { base: [146, 134, 92], spots: [[112, 118, 70], [168, 150, 110]], grit: 0.6 },  // scrub
      { base: [158, 146, 124], spots: [[130, 120, 102], [182, 172, 152]], grit: 0.8 },// town earth
      { base: [120, 104, 76], spots: [[96, 84, 60], [140, 124, 96]], grit: 0.4 },     // water bed
      { base: [116, 134, 72], spots: [[92, 116, 52], [146, 158, 94]], grit: 0.4 },    // grass
    ];
    for (let k = 0; k < 6; k++) {
      const tx = (k % 3) * tile;
      const ty = Math.floor(k / 3) * tile;
      ctx.save();
      ctx.beginPath();
      ctx.rect(tx, ty, tile, tile);
      ctx.clip();
      ctx.translate(tx, ty);
      const d = defs[k];
      const img = ctx.createImageData(tile, tile);
      const data = img.data;
      for (let i = 0; i < tile * tile; i++) {
        const n = (rng.f() - 0.5) * 40 * d.grit;
        data[i * 4] = clamp255(d.base[0] + n);
        data[i * 4 + 1] = clamp255(d.base[1] + n);
        data[i * 4 + 2] = clamp255(d.base[2] + n);
        data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      for (let i = 0; i < 160; i++) {
        const c = d.spots[rng.int(0, 1)];
        const x = rng.f() * tile;
        const y = rng.f() * tile;
        const r = rng.range(8, 60);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.35)`);
        g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      if (k === 1) {
        // ploughed furrows
        ctx.strokeStyle = 'rgba(92,104,48,0.35)';
        ctx.lineWidth = 2.5;
        for (let y = 0; y < tile; y += 11) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(tile, y + rng.sym() * 3);
          ctx.stroke();
        }
      }
      if (k === 5 || k === 1) {
        for (let i = 0; i < 2200; i++) {
          const x = rng.f() * tile;
          const y = rng.f() * tile;
          ctx.strokeStyle = `rgba(${rng.range(80, 150) | 0},${rng.range(110, 175) | 0},${rng.range(40, 90) | 0},0.5)`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + rng.sym() * 2, y - rng.range(2, 6));
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }, { repeat: 1, srgb: true });
}

// ---------------------------------------------------------------- buildings

export const PLASTER_COLOURS = [
  '#d9c9a8', '#e6dcc4', '#cfd9c8', '#e8d2b0', '#cdd8e0', '#e3cfc2',
  '#c9d6cf', '#efe3c9', '#d6c3b0', '#bfcbd6', '#e9dcd0', '#cbb99c',
  '#f0e7d2', '#bdc9b4', '#ddd0bb', '#e7c9a4',
];

export const TRIM_COLOURS = ['#8c6b4a', '#6d5b45', '#3f4f5a', '#7a4332', '#4a5b43', '#2f3b46', '#8a5c3b'];

export function plasterTexture(idx) {
  const col = PLASTER_COLOURS[idx % PLASTER_COLOURS.length];
  return texture(`plaster_${idx}`, 256, (ctx, size, rng) => {
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, size, size);
    const base = hexToRgb(col);
    for (let i = 0; i < 2400; i++) {
      const x = rng.f() * size;
      const y = rng.f() * size;
      const n = rng.sym() * 16;
      ctx.fillStyle = `rgba(${clamp255(base[0] + n)},${clamp255(base[1] + n)},${clamp255(base[2] + n)},0.35)`;
      ctx.fillRect(x, y, rng.range(1, 4), rng.range(1, 4));
    }
    // damp staining from the base and below the parapet -- monsoon country
    const g = ctx.createLinearGradient(0, size, 0, size * 0.55);
    g.addColorStop(0, 'rgba(70,62,48,0.38)');
    g.addColorStop(1, 'rgba(70,62,48,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, rng, 14, () => [96, 92, 70], 10, 48, 0.16);
    // streaks
    ctx.strokeStyle = 'rgba(80,74,58,0.16)';
    for (let i = 0; i < 26; i++) {
      const x = rng.f() * size;
      ctx.lineWidth = rng.range(1, 5);
      ctx.beginPath();
      ctx.moveTo(x, rng.f() * size * 0.4);
      ctx.lineTo(x + rng.sym() * 6, size);
      ctx.stroke();
    }
  }, { repeat: 1 });
}

export function concreteTexture(seed = 0) {
  return texture(`concrete_${seed}`, 256, (ctx, size, rng) => {
    noiseFill(ctx, size, rng, [172, 168, 158], 24);
    blotches(ctx, size, rng, 22, () => [140, 136, 126], 10, 50, 0.25);
    cracks(ctx, size, rng, 8, 'rgba(110,106,98,0.5)', 1);
  });
}

export function brickTexture() {
  return texture('brick', 256, (ctx, size, rng) => {
    ctx.fillStyle = '#9a6b52';
    ctx.fillRect(0, 0, size, size);
    const bh = 14;
    const bw = 32;
    for (let row = 0, y = 0; y < size; row++, y += bh) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw; x < size + bw; x += bw) {
        const v = rng.range(-22, 22);
        ctx.fillStyle = `rgb(${clamp255(158 + v)},${clamp255(96 + v)},${clamp255(70 + v)})`;
        ctx.fillRect(x + off + 1.5, y + 1.5, bw - 3, bh - 3);
      }
    }
    blotches(ctx, size, rng, 16, () => [90, 72, 56], 10, 40, 0.3);
  });
}

export function tinRoofTexture(tint = '#8f9aa0') {
  return texture(`tin_${tint}`, 256, (ctx, size, rng) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 16) {
      const g = ctx.createLinearGradient(x, 0, x + 16, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.28)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0.28)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 16, size);
    }
    blotches(ctx, size, rng, 30, () => [122, 72, 40], 6, 30, 0.35); // rust
  });
}

export function tileRoofTexture() {
  return texture('tileroof', 256, (ctx, size, rng) => {
    ctx.fillStyle = '#9a4f33';
    ctx.fillRect(0, 0, size, size);
    const rh = 18;
    for (let y = 0; y < size; y += rh) {
      for (let x = 0; x < size; x += 20) {
        const v = rng.range(-24, 24);
        ctx.fillStyle = `rgb(${clamp255(164 + v)},${clamp255(82 + v)},${clamp255(54 + v)})`;
        ctx.beginPath();
        ctx.moveTo(x, y + rh);
        ctx.quadraticCurveTo(x + 10, y - 3, x + 20, y + rh);
        ctx.fill();
      }
    }
    blotches(ctx, size, rng, 20, () => [78, 86, 56], 6, 26, 0.26);
  });
}

export function shutterTexture(colour = '#4a6b8a') {
  return texture(`shutter_${colour}`, 128, (ctx, size, rng) => {
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 6) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, y, size, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(0, y + 2, size, 1);
    }
    blotches(ctx, size, rng, 10, () => [60, 48, 36], 4, 16, 0.3);
  });
}

export function foliageTexture(kind = 'neem') {
  const palette = {
    neem: ['#3f5f2a', '#4d7033', '#355124', '#5b7f3c'],
    palm: ['#4a6b2e', '#5b7f38', '#3b5725'],
    banyan: ['#334f22', '#47682c', '#28401b'],
    dry: ['#6d7340', '#7d8149', '#5a6034'],
    shrub: ['#4c6230', '#5d7338', '#3e5226'],
  }[kind] || ['#44632c'];
  return texture(`foliage_${kind}`, 256, (ctx, size, rng) => {
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 900; i++) {
      const x = rng.f() * size;
      const y = rng.f() * size;
      const r = rng.range(3, 14);
      ctx.fillStyle = palette[rng.int(0, palette.length - 1)];
      ctx.globalAlpha = rng.range(0.55, 1);
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * rng.range(0.5, 1), rng.f() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, { repeat: 1 });
}

export function barkTexture() {
  return texture('bark', 128, (ctx, size, rng) => {
    noiseFill(ctx, size, rng, [92, 76, 58], 26);
    ctx.strokeStyle = 'rgba(52,42,32,0.6)';
    for (let i = 0; i < 40; i++) {
      const x = rng.f() * size;
      ctx.lineWidth = rng.range(1, 4);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + rng.sym() * 8, size * 0.3, x + rng.sym() * 8, size * 0.7, x + rng.sym() * 6, size);
      ctx.stroke();
    }
  });
}

export function signTexture(text, bg = '#1d4f3c', fg = '#f6e9c8', sub = '') {
  return texture(`sign_${text}_${bg}_${sub}`, 512, (ctx, size, rng) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, size * 0.62, size, size * 0.38);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let fs = 92;
    ctx.font = `bold ${fs}px system-ui, sans-serif`;
    while (ctx.measureText(text).width > size * 0.9 && fs > 20) {
      fs -= 4;
      ctx.font = `bold ${fs}px system-ui, sans-serif`;
    }
    ctx.fillText(text, size / 2, size * 0.36);
    if (sub) {
      ctx.font = `${Math.round(fs * 0.52)}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.fillText(sub, size / 2, size * 0.72);
    }
    blotches(ctx, size, rng, 8, () => [40, 36, 28], 10, 40, 0.18);
  }, { repeat: 1 });
}

export function waterTexture() {
  return texture('water', 512, (ctx, size, rng) => {
    noiseFill(ctx, size, rng, [58, 86, 84], 16);
    for (let i = 0; i < 300; i++) {
      const x = rng.f() * size;
      const y = rng.f() * size;
      ctx.strokeStyle = `rgba(190,215,210,${rng.range(0.04, 0.16)})`;
      ctx.lineWidth = rng.range(1, 3);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 18, y + rng.sym() * 5, x + 40, y);
      ctx.stroke();
    }
  });
}

function roundishRect(ctx, x, y, w, h, rng) {
  const n = 9;
  ctx.moveTo(x, y + h / 2);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rx = (w / 2) * (0.8 + rng.f() * 0.4);
    const ry = (h / 2) * (0.8 + rng.f() * 0.4);
    ctx.lineTo(x + w / 2 + Math.cos(a) * rx, y + h / 2 + Math.sin(a) * ry);
  }
  ctx.closePath();
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function disposeTextures() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
