// Spatial chunk streaming.
//
// The world is 8.4 x 8.4 km.  It is cut into 128 m chunks; each chunk owns its
// terrain tile, the roads/buildings/props whose centre falls inside it, and its
// own deterministic vegetation scatter.  Chunks are built a few per frame on a
// priority queue so riding never stalls, and recycled when you leave.
//
// Three detail bands:
//   near  (<  NEAR)  full geometry
//   mid   (<  MID)   simplified buildings, no facades, no wires
//   far   (<= FAR)   terrain only + the distant-town silhouette layer

import * as THREE from 'three';
import { clamp, clamp01, lerp } from '../core/util.js';
import { Rng, hashU32, hashF } from '../core/rng.js';
import { MeshAccum } from './meshBuilder.js';
import { buildRoad, buildSpeedBreaker } from './roadBuilder.js';
import { buildBuilding } from './buildingBuilder.js';
import { buildEdgeProps, buildDrain, buildWall, buildBusShelter, buildJunctionSign } from './propBuilder.js';
import { buildVegetation, buildFarmland } from './vegetationBuilder.js';
import { GROUND } from './worldData.js';

export const CHUNK = 128;

const GROUND_COLOR = {
  [GROUND.DRY_EARTH]: [0.70, 0.59, 0.43],
  [GROUND.FIELD]: [0.50, 0.57, 0.30],
  [GROUND.SCRUB]: [0.58, 0.54, 0.37],
  [GROUND.TOWN]: [0.64, 0.59, 0.50],
  [GROUND.WATER_BED]: [0.44, 0.39, 0.29],
  [GROUND.GRASS]: [0.45, 0.55, 0.28],
};

export class ChunkManager {
  constructor(scene, world, materials, quality) {
    this.scene = scene;
    this.world = world;
    this.materials = materials;
    this.quality = quality;
    this.chunks = new Map();
    this.group = new THREE.Group();
    this.group.name = 'chunks';
    scene.add(this.group);

    this.near = quality.nearDist;
    this.mid = quality.midDist;
    this.far = quality.farDist;

    this.pending = [];
    this.streetLights = [];
    this._buildBudgetMs = quality.buildBudgetMs;

    this._prepareStatics();
    this._buildFarLayer();
    this._buildWater();
  }

  _prepareStatics() {
    const w = this.world;
    this.edgesByChunk = new Map();
    this.buildingsByChunk = new Map();
    this.wallsByChunk = new Map();

    const add = (map, key, v) => {
      let a = map.get(key);
      if (!a) {
        a = [];
        map.set(key, a);
      }
      a.push(v);
    };
    for (const e of w.edges) {
      // an edge belongs to every chunk its polyline passes through
      const seen = new Set();
      for (const p of e.pts3) {
        const k = this.keyAt(p[0], p[2]);
        if (!seen.has(k)) {
          seen.add(k);
          add(this.edgesByChunk, k, e.i);
        }
      }
    }
    for (let i = 0; i < w.buildings.length; i++) {
      const b = w.buildings[i];
      add(this.buildingsByChunk, this.keyAt(b.wx, b.wz), i);
    }
    for (let i = 0; i < w.walls.length; i++) {
      const p = w.walls[i].pts[0];
      add(this.wallsByChunk, this.keyAt(p[0], -p[1]), i);
    }
  }

  keyAt(x, z) {
    const i = Math.floor((x + this.world.half) / CHUNK);
    const j = Math.floor((z + this.world.half) / CHUNK);
    return i * 10000 + j;
  }

  chunkOrigin(key) {
    const i = Math.floor(key / 10000);
    const j = key - i * 10000;
    return [i * CHUNK - this.world.half, j * CHUNK - this.world.half, i, j];
  }

  // ------------------------------------------------------------- streaming

  update(px, pz, dt) {
    const far = this.far;
    const i0 = Math.floor((px - far + this.world.half) / CHUNK);
    const i1 = Math.floor((px + far + this.world.half) / CHUNK);
    const j0 = Math.floor((pz - far + this.world.half) / CHUNK);
    const j1 = Math.floor((pz + far + this.world.half) / CHUNK);

    const wanted = new Set();
    const queue = [];
    const maxI = Math.ceil((2 * this.world.half) / CHUNK);
    for (let i = Math.max(0, i0); i <= Math.min(maxI, i1); i++) {
      for (let j = Math.max(0, j0); j <= Math.min(maxI, j1); j++) {
        const ox = i * CHUNK - this.world.half;
        const oz = j * CHUNK - this.world.half;
        const dx = Math.max(Math.abs(px - (ox + CHUNK / 2)) - CHUNK / 2, 0);
        const dz = Math.max(Math.abs(pz - (oz + CHUNK / 2)) - CHUNK / 2, 0);
        const d = Math.hypot(dx, dz);
        if (d > far) continue;
        const key = i * 10000 + j;
        const lod = d < this.near ? 0 : d < this.mid ? 1 : 2;
        wanted.add(key);
        const have = this.chunks.get(key);
        if (!have) queue.push({ key, d, lod });
        else if (have.lod !== lod && d < this.mid + CHUNK) queue.push({ key, d, lod, rebuild: true });
      }
    }

    for (const [key, c] of this.chunks) {
      if (!wanted.has(key)) {
        this._dispose(c);
        this.chunks.delete(key);
      }
    }

    queue.sort((a, b) => a.d - b.d);
    const t0 = performance.now();
    let built = 0;
    for (const q of queue) {
      if (performance.now() - t0 > this._buildBudgetMs && built > 0) break;
      const old = this.chunks.get(q.key);
      if (old) {
        if (old.lod === q.lod) continue;
        this._dispose(old);
      }
      this.chunks.set(q.key, this._build(q.key, q.lod));
      built++;
      if (built > 6) break;
    }
    return { active: this.chunks.size, queued: queue.length };
  }

  _dispose(c) {
    for (const m of c.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    c.meshes.length = 0;
  }

  // ------------------------------------------------------------- building

  _build(key, lod) {
    const [ox, oz, ci, cj] = this.chunkOrigin(key);
    const accum = new MeshAccum();
    const w = this.world;
    const bounds = [ox, oz, ox + CHUNK, oz + CHUNK];
    const lights = [];

    this._terrainTile(accum, ox, oz, lod);

    const edgeIds = this.edgesByChunk.get(key) || [];
    for (const id of edgeIds) {
      const e = w.edges[id];
      // only the owning chunk (first point) draws the ribbon, to avoid overdraw
      if (this.keyAt(e.pts3[0][0], e.pts3[0][2]) !== key) continue;
      buildRoad(accum, e, w, lod >= 1 ? 1 : 0);
      if (lod === 0) {
        buildEdgeProps(accum, e, w, bounds, lights, 0);
        buildDrain(accum, e, w, bounds);
      } else if (lod === 1) {
        buildEdgeProps(accum, e, w, bounds, lights, 1);
      }
    }

    if (lod <= 1) {
      const bIds = this.buildingsByChunk.get(key) || [];
      for (const id of bIds) {
        buildBuilding(accum, w.buildings[id], w, lod);
      }
      for (const id of this.wallsByChunk.get(key) || []) {
        buildWall(accum, w.walls[id], w, bounds);
      }
    }

    if (lod === 0) {
      for (const tc of w.trafficCalming) {
        const x = tc.x;
        const z = -tc.y;
        if (x < ox || x >= ox + CHUNK || z < oz || z >= oz + CHUNK) continue;
        const near = w.nearestRoad(x, z, 14);
        if (near) buildSpeedBreaker(accum, near.edge, near.s);
      }
      const blocked = this._blockTester(ox, oz);
      buildVegetation(accum, w, ox, oz, CHUNK, 0, blocked);
      buildFarmland(accum, w, ox, oz, CHUNK, 0);
      this._chunkPois(accum, ox, oz);
    } else if (lod === 1) {
      const blocked = this._blockTester(ox, oz);
      buildVegetation(accum, w, ox, oz, CHUNK, 1, blocked);
    }

    const meshes = [];
    for (const [matKey, geo] of accum.build()) {
      const mesh = new THREE.Mesh(geo, this.materials.get(matKey));
      mesh.castShadow = lod === 0 && matKey !== 'marking' && !matKey.startsWith('road') && matKey !== 'terrain' && matKey !== 'shoulder';
      mesh.receiveShadow = lod === 0;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      meshes.push(mesh);
    }
    if (lod === 0) this.streetLights.push(...lights);
    return { key, lod, meshes, lights };
  }

  _blockTester(ox, oz) {
    const w = this.world;
    const list = [];
    const r = CHUNK * 0.9;
    for (const id of w.buildingGrid.query(ox + CHUNK / 2, oz + CHUNK / 2, r)) {
      const b = w.buildings[id];
      const pad = b.wl && b.pl ? b.pl[2] + 1.0 : 1.2;
      list.push([b.wx, b.wz, Math.max(b.w, b.d) * 0.5 + pad]);
    }
    return (x, z, extra) => {
      for (const [bx, bz, br] of list) {
        const dx = x - bx;
        const dz = z - bz;
        if (dx * dx + dz * dz < (br + extra) * (br + extra)) return true;
      }
      return false;
    };
  }

  _chunkPois(accum, ox, oz) {
    const w = this.world;
    for (const p of w.pois) {
      if (p.wx < ox || p.wx >= ox + CHUNK || p.wz < oz || p.wz >= oz + CHUNK) continue;
      if (p.cat === 'amenity:bus_station' || p.cat === 'highway:bus_stop') {
        const near = w.nearestRoad(p.wx, p.wz, 40);
        const ang = near ? Math.atan2(near.dirZ, near.dirX) : 0;
        buildBusShelter(accum, w, p.wx, p.wz, ang);
      }
    }
  }

  // ------------------------------------------------------------- terrain

  _terrainTile(accum, ox, oz, lod) {
    const w = this.world;
    const segs = lod === 0 ? this.quality.terrainSegs : lod === 1 ? Math.max(8, this.quality.terrainSegs / 2) : 8;
    const b = accum.bucket('terrain');
    const base = b.count;
    const stride = segs + 1;
    const cols = [];
    for (let j = 0; j <= segs; j++) {
      for (let i = 0; i <= segs; i++) {
        const x = ox + (i / segs) * CHUNK;
        const z = oz + (j / segs) * CHUNK;
        const y = w.heightAt(x, z);
        const g = w.groundAt(x, z);
        const c = GROUND_COLOR[g] || GROUND_COLOR[0];
        // macro variation so big open areas are not flat colour
        const n1 = 0.86 + 0.28 * noise2(x * 0.011, z * 0.011);
        const n2 = 0.93 + 0.14 * noise2(x * 0.08, z * 0.08);
        const u = w.urbanAt(x, z);
        const dust = clamp01(u * 0.5);
        const r = lerp(c[0] * n1 * n2, 0.64, dust * 0.3);
        const gg = lerp(c[1] * n1 * n2, 0.59, dust * 0.3);
        const bb = lerp(c[2] * n1 * n2, 0.50, dust * 0.3);
        b.pos.push(x, y, z);
        b.nor.push(0, 1, 0);
        b.uv.push(x / 7, z / 7);
        b.col.push(r, gg, bb);
        cols.push(0);
      }
    }
    b.count += stride * stride;
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const i0 = base + j * stride + i;
        b.idx.push(i0, i0 + stride, i0 + stride + 1, i0, i0 + stride + 1, i0 + 1);
      }
    }
    // normals
    for (let j = 0; j <= segs; j++) {
      for (let i = 0; i <= segs; i++) {
        const x = ox + (i / segs) * CHUNK;
        const z = oz + (j / segs) * CHUNK;
        const d = CHUNK / segs;
        const hl = w.heightAt(x - d, z);
        const hr = w.heightAt(x + d, z);
        const hd = w.heightAt(x, z - d);
        const hu = w.heightAt(x, z + d);
        let nx = hl - hr;
        let ny = 2 * d;
        let nz = hd - hu;
        const L = Math.hypot(nx, ny, nz) || 1;
        const o = (base + j * stride + i) * 3;
        b.nor[o] = nx / L;
        b.nor[o + 1] = ny / L;
        b.nor[o + 2] = nz / L;
      }
    }
    // skirt to hide LOD cracks
    const skirt = 2.4;
    const edgeIdx = [];
    for (let i = 0; i <= segs; i++) edgeIdx.push([0, i]);
    for (let i = 0; i <= segs; i++) edgeIdx.push([segs, i]);
    for (let j = 0; j <= segs; j++) edgeIdx.push([j, 0]);
    for (let j = 0; j <= segs; j++) edgeIdx.push([j, segs]);
    const sb = accum.bucket('terrain');
    for (const [j, i] of edgeIdx) {
      const o = (base + j * stride + i) * 3;
      const x = sb.pos[o];
      const y = sb.pos[o + 1];
      const z = sb.pos[o + 2];
      const c0 = sb.col[o];
      const c1 = sb.col[o + 1];
      const c2 = sb.col[o + 2];
      const bi = sb.count;
      sb.pos.push(x, y, z, x, y - skirt, z);
      sb.nor.push(0, 1, 0, 0, 1, 0);
      sb.uv.push(x / 7, z / 7, x / 7, (z + skirt) / 7);
      sb.col.push(c0, c1, c2, c0 * 0.8, c1 * 0.8, c2 * 0.8);
      sb.count += 2;
      if (edgeIdx.indexOf) {
        // connect to the previous skirt pair within the same edge run
      }
      sb._lastSkirt = sb._lastSkirt || {};
      const run = `${j === 0 || j === segs ? 'j' + j : 'i' + i}`;
      const prev = sb._lastSkirt[run];
      if (prev !== undefined) {
        sb.idx.push(prev, prev + 1, bi + 1, prev, bi + 1, bi);
        sb.idx.push(prev, bi + 1, prev + 1, prev, bi, bi + 1);
      }
      sb._lastSkirt[run] = bi;
    }
    delete sb._lastSkirt;
  }

  // ------------------------------------------------------------- far layer

  _buildFarLayer() {
    // One instanced box per building beyond the chunk radius, so the town has
    // a believable silhouette from the outskirts without any streaming cost.
    const w = this.world;
    const list = w.buildings;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const colors = new Float32Array(list.length * 3);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.ang3);
      pos.set(b.wx, b.g, b.wz);
      // a compound is a wall around a yard -- it has no silhouette of its own
      if (b.cat === 'compound') scl.set(0, 0, 0);
      else scl.set(b.w, Math.max(2.5, b.h + b.pp), b.d);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
      const rr = new Rng(hashU32(b.sd, 991));
      const base = 0.52 + rr.f() * 0.34;
      colors[i * 3] = base * 1.02;
      colors[i * 3 + 1] = base * 0.98;
      colors[i * 3 + 2] = base * 0.9;
    }
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = -5;
    this.farMesh = mesh;
    this.scene.add(mesh);
  }

  _buildWater() {
    const w = this.world;
    const group = new THREE.Group();
    const mat = this.materials.get('water');
    for (const a of w.areas) {
      if (a.kind !== 'water' || a.water_level === undefined) continue;
      const shape = new THREE.Shape();
      const poly = a.poly3;
      shape.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) shape.lineTo(poly[i][0], poly[i][1]);
      shape.closePath();
      const geo = new THREE.ShapeGeometry(shape, 2);
      geo.rotateX(Math.PI / 2);
      geo.translate(0, a.water_level, 0);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = false;
      group.add(mesh);
    }
    this.scene.add(group);
    this.waterGroup = group;
  }
}

function noise2(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const h = (a, b) => hashF(a, b, 4242) * 2 - 1;
  const n00 = h(ix, iy);
  const n10 = h(ix + 1, iy);
  const n01 = h(ix, iy + 1);
  const n11 = h(ix + 1, iy + 1);
  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
}
