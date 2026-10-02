// Loads the build-pipeline output and exposes fast samplers.
//
// Coordinate convention
//   data space : x = metres EAST of the Darsi anchor, y = metres NORTH
//   three space: x = east, y = up, z = -north
// so  worldZ = -dataY  everywhere.  Helper fns below keep that in one place.

import { clamp, clamp01, lerp } from '../core/util.js';
import { hashF, fbm2, valueNoise2 } from '../core/rng.js';

export const GROUND = {
  DRY_EARTH: 0,
  FIELD: 1,
  SCRUB: 2,
  TOWN: 3,
  WATER_BED: 4,
  GRASS: 5,
};

export class WorldData {
  constructor() {
    this.ready = false;
  }

  async load(base = '/world', onProgress = () => {}) {
    const step = (n, msg) => onProgress(n, msg);
    const j = async (name) => {
      const r = await fetch(`${base}/${name}`);
      if (!r.ok) throw new Error(`cannot load ${name}: ${r.status}`);
      return r.json();
    };
    const b = async (name) => {
      const r = await fetch(`${base}/${name}`);
      if (!r.ok) throw new Error(`cannot load ${name}: ${r.status}`);
      return r.arrayBuffer();
    };

    step(0.05, 'reading survey data');
    this.meta = await j('meta.json');
    this.half = this.meta.half_extent;
    this.gridN = this.meta.terrain.grid;
    this.cell = this.meta.terrain.cell;

    step(0.18, 'loading elevation model');
    this.height = new Float32Array(await b('terrain.bin'));
    this.ground = new Uint8Array(await b('ground.bin'));
    this.urban = new Uint8Array(await b('urban.bin'));
    this.urbanN = this.meta.urban.grid;

    step(0.4, 'loading road network');
    const net = await j('network.json');
    this.nodes = net.nodes;
    this.edges = net.edges;

    step(0.6, 'loading buildings');
    this.buildings = (await j('buildings.json')).buildings;

    step(0.75, 'loading land cover');
    const areas = await j('areas.json');
    this.areas = areas.areas;
    this.waterways = areas.waterways;

    step(0.85, 'loading places');
    this.pois = (await j('pois.json')).pois;
    const props = await j('props.json');
    this.walls = props.walls;
    this.powerLines = props.power;
    this.powerNodes = props.power_nodes;
    this.railways = props.railways;
    this.trafficCalming = props.traffic_calming;

    step(0.92, 'indexing world');
    this._buildIndex();
    this.ready = true;
    step(1.0, 'ready');
    return this;
  }

  // ------------------------------------------------------------ terrain

  /** Bilinear terrain height at a three.js position. */
  heightAt(x, z) {
    const h = this.half;
    const fx = clamp((x + h) / this.cell, 0, this.gridN - 1.001);
    const fz = clamp((z + h) / this.cell, 0, this.gridN - 1.001);
    const i = fx | 0;
    const jj = fz | 0;
    const tx = fx - i;
    const tz = fz - jj;
    const N = this.gridN;
    const H = this.height;
    const h00 = H[jj * N + i];
    const h10 = H[jj * N + i + 1];
    const h01 = H[(jj + 1) * N + i];
    const h11 = H[(jj + 1) * N + i + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /** Terrain normal via central differences. */
  normalAt(x, z, out = { x: 0, y: 1, z: 0 }, d = 2.0) {
    const hl = this.heightAt(x - d, z);
    const hr = this.heightAt(x + d, z);
    const hd = this.heightAt(x, z - d);
    const hu = this.heightAt(x, z + d);
    const nx = hl - hr;
    const nz = hd - hu;
    const ny = 2 * d;
    const inv = 1 / Math.hypot(nx, ny, nz);
    out.x = nx * inv;
    out.y = ny * inv;
    out.z = nz * inv;
    return out;
  }

  groundAt(x, z) {
    const h = this.half;
    const i = clamp(Math.round((x + h) / this.cell), 0, this.gridN - 1);
    const j = clamp(Math.round((z + h) / this.cell), 0, this.gridN - 1);
    return this.ground[j * this.gridN + i];
  }

  urbanAt(x, z) {
    const h = this.half;
    const n = this.urbanN;
    const fx = clamp(((x + h) / (2 * h)) * (n - 1), 0, n - 1.001);
    const fz = clamp(((z + h) / (2 * h)) * (n - 1), 0, n - 1.001);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const U = this.urban;
    const a = U[j * n + i] * (1 - tx) + U[j * n + i + 1] * tx;
    const bb = U[(j + 1) * n + i] * (1 - tx) + U[(j + 1) * n + i + 1] * tx;
    return (a * (1 - tz) + bb * tz) / 255;
  }

  // ------------------------------------------------------------ indexing

  _buildIndex() {
    // Convert data-space coords to three-space once, up front.
    for (const e of this.edges) {
      e.pts3 = e.p.map((p) => [p[0], p[2], -p[1]]); // x, y(up), z
      e.len = 0;
      e.cum = [0];
      for (let i = 1; i < e.pts3.length; i++) {
        const a = e.pts3[i - 1];
        const b = e.pts3[i];
        e.len += Math.hypot(b[0] - a[0], b[2] - a[2]);
        e.cum.push(e.len);
      }
      const a = e.pts3[0];
      const b = e.pts3[e.pts3.length - 1];
      e.mid = [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2];
      e.bbox = bboxOf(e.pts3);
    }
    for (const b of this.buildings) {
      b.wx = b.x;
      b.wz = -b.y;
      b.ang3 = -b.a; // rotation about +Y in three-space
      if (b.poly) b.poly3 = b.poly.map((p) => [p[0], -p[1]]);
    }
    for (const p of this.pois) {
      p.wx = p.x;
      p.wz = -p.y;
    }

    // Uniform grid over roads for nearest-road queries and chunk assembly.
    this.roadGrid = new SpatialGrid(this.half, 60);
    for (const e of this.edges) this.roadGrid.insertPolyline(e.pts3, e.i);

    // Solid-body grid. Compound *sites* are boundary walls, not volumes, so
    // they are indexed separately and never treated as one enormous box.
    this.buildingGrid = new SpatialGrid(this.half, 60);
    this.solidBuildings = [];
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      if (b.cat === 'compound') continue;
      const r = Math.max(b.w, b.d) * 0.6 + 2;
      this.buildingGrid.insertBox(b.wx, b.wz, r, i);
      this.solidBuildings.push(i);
    }

    // Node adjacency for traffic + routing.
    this.nodeEdges = new Map();
    for (const e of this.edges) {
      if (!this.nodeEdges.has(e.a)) this.nodeEdges.set(e.a, []);
      if (!this.nodeEdges.has(e.b)) this.nodeEdges.set(e.b, []);
      this.nodeEdges.get(e.a).push(e.i);
      this.nodeEdges.get(e.b).push(e.i);
    }

    this.waterLevels = [];
    for (const a of this.areas) {
      if (a.kind === 'water' && a.water_level !== undefined) {
        a.poly3 = a.poly.map((p) => [p[0], -p[1]]);
        a.bbox = bbox2(a.poly3);
        this.waterLevels.push(a);
      } else {
        a.poly3 = a.poly.map((p) => [p[0], -p[1]]);
        a.bbox = bbox2(a.poly3);
      }
    }
  }

  /** Nearest road sample: { edge, dist, t, px, pz, onRoad }. */
  nearestRoad(x, z, maxDist = 40) {
    const cands = this.roadGrid.query(x, z, maxDist);
    let best = null;
    for (const id of cands) {
      const e = this.edges[id];
      const pts = e.pts3;
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i][0];
        const az = pts[i][2];
        const bx = pts[i + 1][0];
        const bz = pts[i + 1][2];
        const dx = bx - ax;
        const dz = bz - az;
        const L2 = dx * dx + dz * dz;
        if (L2 < 1e-9) continue;
        let t = ((x - ax) * dx + (z - az) * dz) / L2;
        t = clamp01(t);
        const cx = ax + t * dx;
        const cz = az + t * dz;
        const d = Math.hypot(x - cx, z - cz);
        if (!best || d < best.dist) {
          best = {
            edge: e,
            dist: d,
            seg: i,
            t,
            px: cx,
            pz: cz,
            s: e.cum[i] + t * Math.sqrt(L2),
            dirX: dx / Math.sqrt(L2),
            dirZ: dz / Math.sqrt(L2),
          };
        }
      }
    }
    if (best) best.onRoad = best.dist <= best.edge.w * 0.5;
    return best;
  }

  poiByCategory(prefix) {
    return this.pois.filter((p) => p.cat.startsWith(prefix));
  }
}

// ---------------------------------------------------------------- helpers

function bboxOf(pts3) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of pts3) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[2] < z0) z0 = p[2];
    if (p[2] > z1) z1 = p[2];
  }
  return [x0, z0, x1, z1];
}

function bbox2(pts) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < z0) z0 = p[1];
    if (p[1] > z1) z1 = p[1];
  }
  return [x0, z0, x1, z1];
}

export class SpatialGrid {
  constructor(half, cell) {
    this.half = half;
    this.cell = cell;
    this.n = Math.ceil((2 * half) / cell) + 1;
    this.map = new Map();
  }
  _key(i, j) {
    return i * 100000 + j;
  }
  _cellOf(x, z) {
    return [Math.floor((x + this.half) / this.cell), Math.floor((z + this.half) / this.cell)];
  }
  _add(i, j, id) {
    const k = this._key(i, j);
    let arr = this.map.get(k);
    if (!arr) {
      arr = [];
      this.map.set(k, arr);
    }
    if (arr[arr.length - 1] !== id) arr.push(id);
  }
  insertBox(x, z, r, id) {
    const [i0, j0] = this._cellOf(x - r, z - r);
    const [i1, j1] = this._cellOf(x + r, z + r);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this._add(i, j, id);
  }
  insertPolyline(pts3, id) {
    for (let k = 0; k < pts3.length - 1; k++) {
      const a = pts3[k];
      const b = pts3[k + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / (this.cell * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const [i, j] = this._cellOf(a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t);
        this._add(i, j, id);
        this._add(i - 1, j, id);
        this._add(i + 1, j, id);
        this._add(i, j - 1, id);
        this._add(i, j + 1, id);
      }
    }
  }
  query(x, z, r) {
    const out = new Set();
    const [i0, j0] = this._cellOf(x - r, z - r);
    const [i1, j1] = this._cellOf(x + r, z + r);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const arr = this.map.get(this._key(i, j));
        if (arr) for (const id of arr) out.add(id);
      }
    }
    return out;
  }
  cellIds(i, j) {
    return this.map.get(this._key(i, j)) || [];
  }
}
