// Tiny geometry accumulator.
//
// Chunks push triangles into named buckets (one per material) and get back a
// handful of merged BufferGeometries, which keeps the draw-call count for a
// whole 128 m block of town in the low tens instead of the thousands.

import * as THREE from 'three';

export class MeshAccum {
  constructor() {
    this.buckets = new Map();
  }

  bucket(key) {
    let b = this.buckets.get(key);
    if (!b) {
      b = { pos: [], nor: [], uv: [], col: [], idx: [], count: 0 };
      this.buckets.set(key, b);
    }
    return b;
  }

  /**
   * Push a triangle fan/strip-free raw triangle list.
   * verts: [[x,y,z,nx,ny,nz,u,v,r,g,b], ...]; tris: flat index list into verts
   */
  pushRaw(key, verts, tris) {
    const b = this.bucket(key);
    const base = b.count;
    for (const v of verts) {
      b.pos.push(v[0], v[1], v[2]);
      b.nor.push(v[3], v[4], v[5]);
      b.uv.push(v[6], v[7]);
      b.col.push(v[8], v[9], v[10]);
    }
    b.count += verts.length;
    for (let i = 0; i < tris.length; i++) b.idx.push(base + tris[i]);
  }

  /** Quad from 4 corner positions (CCW when seen from the normal side). */
  quad(key, p0, p1, p2, p3, n, uvs, col) {
    const b = this.bucket(key);
    const base = b.count;
    const ps = [p0, p1, p2, p3];
    for (let i = 0; i < 4; i++) {
      b.pos.push(ps[i][0], ps[i][1], ps[i][2]);
      b.nor.push(n[0], n[1], n[2]);
      b.uv.push(uvs[i * 2], uvs[i * 2 + 1]);
      b.col.push(col[0], col[1], col[2]);
    }
    b.count += 4;
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Axis-aligned-in-local-space box, rotated about +Y by `ang`. */
  box(key, cx, cy, cz, w, h, d, ang, col, uvScale = 1, opts = {}) {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const hw = w / 2;
    const hd = d / 2;
    const y0 = cy;
    const y1 = cy + h;
    const P = (lx, lz, y) => [cx + lx * ca - lz * sa, y, cz + lx * sa + lz * ca];
    const N = (lx, lz) => [lx * ca - lz * sa, 0, lx * sa + lz * ca];
    const c = col;
    const us = uvScale;
    const skipTop = opts.skipTop;
    const skipBottom = opts.skipBottom !== false;

    // +x face
    this.quad(key, P(hw, -hd, y0), P(hw, hd, y0), P(hw, hd, y1), P(hw, -hd, y1), N(1, 0),
      [0, 0, d * us, 0, d * us, h * us, 0, h * us], c);
    // -x
    this.quad(key, P(-hw, hd, y0), P(-hw, -hd, y0), P(-hw, -hd, y1), P(-hw, hd, y1), N(-1, 0),
      [0, 0, d * us, 0, d * us, h * us, 0, h * us], c);
    // +z
    this.quad(key, P(hw, hd, y0), P(-hw, hd, y0), P(-hw, hd, y1), P(hw, hd, y1), N(0, 1),
      [0, 0, w * us, 0, w * us, h * us, 0, h * us], c);
    // -z
    this.quad(key, P(-hw, -hd, y0), P(hw, -hd, y0), P(hw, -hd, y1), P(-hw, -hd, y1), N(0, -1),
      [0, 0, w * us, 0, w * us, h * us, 0, h * us], c);
    if (!skipTop) {
      this.quad(key, P(-hw, -hd, y1), P(hw, -hd, y1), P(hw, hd, y1), P(-hw, hd, y1), [0, 1, 0],
        [0, 0, w * us, 0, w * us, d * us, 0, d * us], c);
    }
    if (!skipBottom) {
      this.quad(key, P(-hw, hd, y0), P(hw, hd, y0), P(hw, -hd, y0), P(-hw, -hd, y0), [0, -1, 0],
        [0, 0, w * us, 0, w * us, d * us, 0, d * us], c);
    }
  }

  /** Vertical prism from a closed 2D ring (used for odd-shaped OSM footprints). */
  prism(key, ring, y0, y1, col, uvScale = 1, cap = true) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const L = Math.hypot(dx, dz);
      if (L < 1e-4) continue;
      const nx = dz / L;
      const nz = -dx / L;
      this.quad(key, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [nx, 0, nz],
        [0, 0, L * uvScale, 0, L * uvScale, (y1 - y0) * uvScale, 0, (y1 - y0) * uvScale], col);
    }
    if (cap) {
      const tris = earcut(ring);
      const b = this.bucket(key);
      const base = b.count;
      for (const p of ring) {
        b.pos.push(p[0], y1, p[1]);
        b.nor.push(0, 1, 0);
        b.uv.push(p[0] * uvScale, p[1] * uvScale);
        b.col.push(col[0], col[1], col[2]);
      }
      b.count += ring.length;
      for (const t of tris) b.idx.push(base + t);
    }
  }

  cylinder(key, cx, cy, cz, rBottom, rTop, h, segs, col, opts = {}) {
    const b = this.bucket(key);
    const base = b.count;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      b.pos.push(cx + ca * rBottom, cy, cz + sa * rBottom);
      b.nor.push(ca, 0.1, sa);
      b.uv.push(i / segs * (opts.uRepeat || 1), 0);
      b.col.push(col[0], col[1], col[2]);
      b.pos.push(cx + ca * rTop, cy + h, cz + sa * rTop);
      b.nor.push(ca, 0.1, sa);
      b.uv.push(i / segs * (opts.uRepeat || 1), h * (opts.vScale || 0.4));
      b.col.push(col[0], col[1], col[2]);
    }
    b.count += (segs + 1) * 2;
    for (let i = 0; i < segs; i++) {
      const i0 = base + i * 2;
      b.idx.push(i0, i0 + 2, i0 + 3, i0, i0 + 3, i0 + 1);
    }
    if (opts.capTop) {
      const c0 = b.count;
      b.pos.push(cx, cy + h, cz);
      b.nor.push(0, 1, 0);
      b.uv.push(0.5, 0.5);
      b.col.push(col[0], col[1], col[2]);
      b.count++;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        b.pos.push(cx + Math.cos(a) * rTop, cy + h, cz + Math.sin(a) * rTop);
        b.nor.push(0, 1, 0);
        b.uv.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
        b.col.push(col[0], col[1], col[2]);
      }
      b.count += segs + 1;
      for (let i = 0; i < segs; i++) b.idx.push(c0, c0 + 1 + i, c0 + 2 + i);
    }
  }

  isEmpty() {
    for (const b of this.buckets.values()) if (b.count) return false;
    return true;
  }

  build() {
    const out = [];
    for (const [key, b] of this.buckets) {
      if (!b.count) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.setIndex(b.count > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere();
      out.push([key, g]);
    }
    return out;
  }
}

/** Minimal ear-clipping triangulator for simple polygons (CCW or CW). */
export function earcut(ring) {
  const n = ring.length;
  if (n < 3) return [];
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) idx.reverse();

  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 4000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i - 1 + idx.length) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = ring[i0];
      const b = ring[i1];
      const c = ring[i2];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 1e-9) continue;
      let ok = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTri(ring[j], a, b, c)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      tris.push(i0, i1, i2);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
  return tris;
}

function pointInTri(p, a, b, c) {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
