// Traffic that drives the real road graph.
//
// Agents are pooled and recycled around the player. Each one follows an edge,
// picks a plausible continuation at the node, keeps left (India), yields to
// what is ahead of it, and conforms to the same road surface the player rides.
// Density is driven by road class and the urbanity field, so the bazaar is
// busy and a farm track is empty.

import * as THREE from 'three';
import { clamp, clamp01, lerp, damp, wrapAngle } from '../core/util.js';
import { Rng, hashU32, hashF } from '../core/rng.js';

const KEEP_LEFT = -1; // offset sign for the near-side lane

export const VEHICLE_TYPES = [
  { id: 'motorcycle', w: 0.72, l: 1.9, h: 1.15, speed: 13.5, weight: { highway: 0.26, arterial: 0.32, major: 0.36, secondary: 0.4, townroad: 0.42, bazaar: 0.44, residential: 0.46, lane: 0.5, farm: 0.3 } },
  { id: 'scooter', w: 0.68, l: 1.8, h: 1.1, speed: 11.0, weight: { highway: 0.06, arterial: 0.12, major: 0.16, secondary: 0.18, townroad: 0.2, bazaar: 0.24, residential: 0.22, lane: 0.24, farm: 0.05 } },
  { id: 'auto', w: 1.3, l: 2.6, h: 1.75, speed: 10.0, weight: { highway: 0.05, arterial: 0.12, major: 0.16, secondary: 0.18, townroad: 0.2, bazaar: 0.22, residential: 0.14, lane: 0.1, farm: 0.03 } },
  { id: 'car', w: 1.65, l: 3.9, h: 1.5, speed: 15.0, weight: { highway: 0.26, arterial: 0.22, major: 0.16, secondary: 0.12, townroad: 0.09, bazaar: 0.05, residential: 0.08, lane: 0.04, farm: 0.02 } },
  { id: 'bus', w: 2.4, l: 9.5, h: 3.1, speed: 12.0, weight: { highway: 0.12, arterial: 0.08, major: 0.06, secondary: 0.04, townroad: 0.02, bazaar: 0.01, residential: 0.0, lane: 0.0, farm: 0.0 } },
  { id: 'truck', w: 2.3, l: 7.2, h: 3.0, speed: 11.0, weight: { highway: 0.18, arterial: 0.1, major: 0.06, secondary: 0.03, townroad: 0.02, bazaar: 0.0, residential: 0.0, lane: 0.0, farm: 0.02 } },
  { id: 'tractor', w: 1.8, l: 3.6, h: 2.4, speed: 6.5, weight: { highway: 0.02, arterial: 0.03, major: 0.03, secondary: 0.04, townroad: 0.03, bazaar: 0.01, residential: 0.02, lane: 0.04, farm: 0.4 } },
  { id: 'cycle', w: 0.55, l: 1.7, h: 1.6, speed: 4.5, weight: { highway: 0.02, arterial: 0.05, major: 0.07, secondary: 0.1, townroad: 0.12, bazaar: 0.14, residential: 0.16, lane: 0.18, farm: 0.18 } },
];

const PAINT = [0xb8c4cc, 0xd8d8d2, 0x2b3038, 0x7a1f1f, 0x1d3a5c, 0x3a5a3a, 0xc8a23a, 0x8a4b22];

// ---------------------------------------------------------------- meshes

function mat(color, rough = 0.6, metal = 0.25) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function wheelMesh(r, w) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 10), mat(0x16161a, 0.95, 0));
  m.rotation.z = Math.PI / 2;
  return m;
}

function buildVehicle(type, rng) {
  const g = new THREE.Group();
  const col = PAINT[rng.u32() % PAINT.length];
  const body = mat(col, 0.5, 0.35);
  const dark = mat(0x22252a, 0.7, 0.2);
  const glass = new THREE.MeshStandardMaterial({ color: 0x27343c, roughness: 0.15, metalness: 0.7 });

  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const me = new THREE.Mesh(geo, m);
    me.position.set(x, y, z);
    me.rotation.set(rx, ry, rz);
    me.castShadow = true;
    g.add(me);
    return me;
  };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  switch (type.id) {
    case 'motorcycle':
    case 'scooter': {
      const r = 0.26;
      const w1 = wheelMesh(r, 0.08);
      w1.position.set(0, r, 0.62);
      const w2 = wheelMesh(r, 0.09);
      w2.position.set(0, r, -0.62);
      g.add(w1, w2);
      if (type.id === 'scooter') {
        add(B(0.34, 0.3, 1.0), body, 0, 0.5, -0.1);
        add(B(0.3, 0.16, 0.42), body, 0, 0.78, -0.3);
        add(B(0.14, 0.42, 0.14), dark, 0, 0.62, 0.52);
      } else {
        add(B(0.26, 0.26, 0.5), body, 0, 0.55, 0.05);
        add(B(0.3, 0.12, 0.52), dark, 0, 0.72, -0.28);
        add(B(0.3, 0.22, 0.28), dark, 0, 0.44, -0.1);
      }
      add(B(0.56, 0.035, 0.035), dark, 0, 0.98, 0.5);
      add(new THREE.SphereGeometry(0.07, 8, 6), mat(0xffeecc, 0.3, 0.4), 0, 0.88, 0.62);
      // rider
      add(new THREE.CapsuleGeometry(0.12, 0.34, 3, 7), mat(rng.u32() % 2 ? 0x3a5a7a : 0x7a4a3a, 0.9, 0), 0, 1.15, -0.1, 0.22, 0, 0);
      add(new THREE.SphereGeometry(0.11, 10, 8), mat(0x24262a, 0.4, 0.2), 0, 1.47, 0.02);
      break;
    }
    case 'auto': {
      // three-wheeler: yellow top, green body is the AP livery idiom
      const r = 0.22;
      const wf = wheelMesh(r, 0.1);
      wf.position.set(0, r, 1.0);
      const wl = wheelMesh(r, 0.11);
      wl.position.set(-0.56, r, -0.75);
      const wr = wheelMesh(r, 0.11);
      wr.position.set(0.56, r, -0.75);
      g.add(wf, wl, wr);
      const green = mat(0x1d6b3a, 0.55, 0.2);
      const yellow = mat(0xe3b320, 0.55, 0.2);
      add(B(1.18, 0.62, 2.1), green, 0, 0.55, -0.1);
      add(B(1.2, 0.5, 1.5), yellow, 0, 1.1, -0.25);
      add(B(1.05, 0.42, 0.06), glass, 0, 1.12, 0.52);
      add(B(1.24, 0.08, 1.9), yellow, 0, 1.38, -0.2);
      add(new THREE.SphereGeometry(0.09, 8, 6), mat(0xffeecc, 0.3, 0.4), 0, 0.72, 1.02);
      break;
    }
    case 'car': {
      const r = 0.31;
      for (const [x, z] of [[-0.72, 1.2], [0.72, 1.2], [-0.72, -1.15], [0.72, -1.15]]) {
        const wmesh = wheelMesh(r, 0.2);
        wmesh.position.set(x, r, z);
        g.add(wmesh);
      }
      add(B(1.64, 0.52, 3.8), body, 0, 0.55, 0);
      add(B(1.5, 0.46, 2.0), body, 0, 1.02, -0.18);
      add(B(1.44, 0.34, 1.86), glass, 0, 1.06, -0.18);
      add(B(1.5, 0.12, 0.1), dark, 0, 0.62, 1.9);
      add(new THREE.BoxGeometry(0.28, 0.12, 0.06), mat(0xfff0d0, 0.2, 0.5), -0.56, 0.68, 1.92);
      add(new THREE.BoxGeometry(0.28, 0.12, 0.06), mat(0xfff0d0, 0.2, 0.5), 0.56, 0.68, 1.92);
      add(new THREE.BoxGeometry(0.26, 0.1, 0.05), mat(0xaa2020, 0.3, 0.3), -0.56, 0.7, -1.92);
      add(new THREE.BoxGeometry(0.26, 0.1, 0.05), mat(0xaa2020, 0.3, 0.3), 0.56, 0.7, -1.92);
      break;
    }
    case 'bus': {
      const r = 0.46;
      for (const [x, z] of [[-1.0, 3.1], [1.0, 3.1], [-1.0, -2.6], [1.0, -2.6]]) {
        const wmesh = wheelMesh(r, 0.3);
        wmesh.position.set(x, r, z);
        g.add(wmesh);
      }
      const liv = mat(rng.u32() % 2 ? 0xd14a2a : 0x2f6fa8, 0.6, 0.15);
      add(B(2.4, 1.7, 9.4), liv, 0, 1.3, 0);
      add(B(2.44, 0.5, 9.0), mat(0xe8e2d2, 0.7, 0.05), 0, 2.3, 0);
      for (let i = -3; i <= 3; i++) add(B(2.46, 0.6, 1.0), glass, 0, 1.95, i * 1.2);
      add(B(2.2, 0.9, 0.08), glass, 0, 1.95, 4.7);
      add(new THREE.BoxGeometry(0.3, 0.2, 0.06), mat(0xfff0d0, 0.2, 0.5), -0.85, 0.85, 4.72);
      add(new THREE.BoxGeometry(0.3, 0.2, 0.06), mat(0xfff0d0, 0.2, 0.5), 0.85, 0.85, 4.72);
      break;
    }
    case 'truck': {
      const r = 0.44;
      for (const [x, z] of [[-0.95, 2.2], [0.95, 2.2], [-0.95, -1.9], [0.95, -1.9]]) {
        const wmesh = wheelMesh(r, 0.3);
        wmesh.position.set(x, r, z);
        g.add(wmesh);
      }
      const cabCol = mat(rng.u32() % 2 ? 0x1f5fa0 : 0xbb3322, 0.55, 0.25);
      add(B(2.2, 1.5, 1.9), cabCol, 0, 1.4, 2.4);
      add(B(2.0, 0.6, 0.08), glass, 0, 1.85, 3.3);
      add(B(2.3, 2.0, 4.6), mat(0x8a6a3a, 0.8, 0.05), 0, 1.7, -1.1);
      add(B(2.36, 0.18, 4.7), mat(0xd8c070, 0.7, 0.1), 0, 2.75, -1.1);
      add(new THREE.BoxGeometry(0.3, 0.2, 0.06), mat(0xfff0d0, 0.2, 0.5), -0.8, 0.9, 3.36);
      add(new THREE.BoxGeometry(0.3, 0.2, 0.06), mat(0xfff0d0, 0.2, 0.5), 0.8, 0.9, 3.36);
      break;
    }
    case 'tractor': {
      const wf = wheelMesh(0.33, 0.2);
      wf.position.set(-0.68, 0.33, 1.1);
      const wf2 = wheelMesh(0.33, 0.2);
      wf2.position.set(0.68, 0.33, 1.1);
      const wr1 = wheelMesh(0.68, 0.34);
      wr1.position.set(-0.78, 0.68, -0.9);
      const wr2 = wheelMesh(0.68, 0.34);
      wr2.position.set(0.78, 0.68, -0.9);
      g.add(wf, wf2, wr1, wr2);
      const blue = mat(0x1f4fa0, 0.55, 0.3);
      add(B(0.9, 0.6, 2.0), blue, 0, 0.8, 0.3);
      add(B(1.1, 0.5, 0.9), blue, 0, 1.25, -0.7);
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 8), mat(0x33363a, 0.8, 0.3), 0.3, 1.5, 0.9);
      add(new THREE.CapsuleGeometry(0.13, 0.36, 3, 7), mat(0x6a5a3a, 0.9, 0), 0, 1.75, -0.6);
      break;
    }
    default: {
      // bicycle
      const r = 0.33;
      const w1 = wheelMesh(r, 0.045);
      w1.position.set(0, r, 0.52);
      const w2 = wheelMesh(r, 0.045);
      w2.position.set(0, r, -0.52);
      g.add(w1, w2);
      add(B(0.05, 0.05, 1.0), dark, 0, 0.6, 0);
      add(B(0.5, 0.03, 0.03), dark, 0, 0.98, 0.42);
      add(new THREE.CapsuleGeometry(0.12, 0.34, 3, 7), mat(0x8a7a5a, 0.9, 0), 0, 1.15, -0.1, 0.3, 0, 0);
      add(new THREE.SphereGeometry(0.1, 10, 8), mat(0x4a3a2a, 0.8, 0), 0, 1.45, 0.02);
      break;
    }
  }
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return g;
}

// ---------------------------------------------------------------- system

export class TrafficSystem {
  constructor(scene, world, quality) {
    this.scene = scene;
    this.world = world;
    this.max = quality.maxTraffic;
    this.radius = quality.trafficRadius;
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    scene.add(this.group);
    this.agents = [];
    this.pool = new Map();
    this.spawnTimer = 0;
    this.rng = new Rng(0x7a771);
    this.hornCooldown = 0;
    this.events = [];
  }

  _acquireMesh(typeId, rng) {
    let arr = this.pool.get(typeId);
    if (arr && arr.length) {
      const m = arr.pop();
      m.visible = true;
      return m;
    }
    const type = VEHICLE_TYPES.find((t) => t.id === typeId);
    return buildVehicle(type, rng);
  }

  _release(agent) {
    agent.mesh.visible = false;
    this.group.remove(agent.mesh);
    let arr = this.pool.get(agent.type.id);
    if (!arr) {
      arr = [];
      this.pool.set(agent.type.id, arr);
    }
    if (arr.length < 14) arr.push(agent.mesh);
  }

  /** Target population near the player, from road class + urbanity. */
  _densityAt(x, z) {
    const u = this.world.urbanAt(x, z);
    return clamp01(0.12 + u * 1.05);
  }

  spawnOne(px, pz) {
    const w = this.world;
    // find a candidate edge in a ring around the player
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = this.rng.f() * Math.PI * 2;
      const r = lerp(this.radius * 0.45, this.radius, this.rng.f());
      const sx = px + Math.cos(a) * r;
      const sz = pz + Math.sin(a) * r;
      const near = w.nearestRoad(sx, sz, 55);
      if (!near) continue;
      const e = near.edge;
      if (e.cls === 'path') continue;
      const u = w.urbanAt(e.mid[0], e.mid[1]);
      const roadBusy = { highway: 0.8, arterial: 0.75, major: 0.65, secondary: 0.5, townroad: 0.45, bazaar: 0.5, residential: 0.25, lane: 0.16, farm: 0.08 }[e.cls] ?? 0.2;
      if (this.rng.f() > clamp01(roadBusy * (0.35 + u * 1.1))) continue;

      // pick a vehicle type by weight for this class
      let total = 0;
      for (const t of VEHICLE_TYPES) total += t.weight[e.cls] ?? 0;
      if (total <= 0) continue;
      let pickV = this.rng.f() * total;
      let type = VEHICLE_TYPES[0];
      for (const t of VEHICLE_TYPES) {
        pickV -= t.weight[e.cls] ?? 0;
        if (pickV <= 0) {
          type = t;
          break;
        }
      }
      if (type.w > e.w * 0.62) continue; // a bus does not fit down a lane

      const dir = this.rng.f() < 0.5 ? 1 : -1;
      const s = this.rng.range(2, Math.max(3, e.len - 2));
      const mesh = this._acquireMesh(type.id, this.rng);
      this.group.add(mesh);
      const agent = {
        type,
        mesh,
        edge: e,
        dir,
        s,
        lane: (e.w * 0.25) * KEEP_LEFT * dir,
        speed: type.speed * this.rng.range(0.78, 1.1),
        targetSpeed: type.speed * this.rng.range(0.78, 1.1),
        y: 0,
        heading: 0,
        hornTimer: this.rng.range(4, 30),
        wheelSpin: 0,
        stuck: 0,
      };
      agent.targetSpeed = Math.min(agent.targetSpeed, (e.sp / 3.6) * 0.95);
      this.agents.push(agent);
      return agent;
    }
    return null;
  }

  update(dt, player, listener) {
    const px = player.pos.x;
    const pz = player.pos.z;
    this.events.length = 0;

    const want = Math.round(this.max * this._densityAt(px, pz));
    // despawn out of range
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i];
      const d = Math.hypot(a.mesh.position.x - px, a.mesh.position.z - pz);
      if (d > this.radius * 1.3) {
        this._release(a);
        this.agents.splice(i, 1);
      }
    }
    this.spawnTimer -= dt;
    if (this.agents.length < want && this.spawnTimer <= 0) {
      for (let k = 0; k < 3 && this.agents.length < want; k++) this.spawnOne(px, pz);
      this.spawnTimer = 0.12;
    }

    // cheap neighbour buckets for following behaviour
    const buckets = new Map();
    for (const a of this.agents) {
      const key = `${a.edge.i}:${a.dir}`;
      let arr = buckets.get(key);
      if (!arr) {
        arr = [];
        buckets.set(key, arr);
      }
      arr.push(a);
    }
    for (const arr of buckets.values()) arr.sort((p, q) => (p.s - q.s) * (p.dir || 1));

    for (const a of this.agents) {
      this._stepAgent(a, dt, player, buckets);
    }
  }

  _stepAgent(a, dt, player, buckets) {
    const w = this.world;
    const e = a.edge;

    // --- desired speed ----------------------------------------------------
    let target = a.targetSpeed * lerp(0.55, 1.0, e.q);
    // slow for the vehicle in front
    const arr = buckets.get(`${e.i}:${a.dir}`) || [];
    let gap = 1e9;
    for (const o of arr) {
      if (o === a) continue;
      const ds = (o.s - a.s) * a.dir;
      if (ds > 0 && ds < gap) gap = ds;
    }
    const safe = a.type.l * 0.5 + 3.0 + a.speed * 0.85;
    if (gap < safe) target *= clamp01((gap - a.type.l * 0.6) / Math.max(1, safe));

    // yield to the player when close and in the way
    const dpx = player.pos.x - a.mesh.position.x;
    const dpz = player.pos.z - a.mesh.position.z;
    const dp = Math.hypot(dpx, dpz);
    if (dp < 9) {
      const fx = Math.sin(a.heading);
      const fz = Math.cos(a.heading);
      const ahead = (dpx * fx + dpz * fz) / Math.max(dp, 0.01);
      if (ahead > 0.45) target *= clamp01(dp / 11);
      a.hornTimer -= dt * 2.5;
    }

    a.speed = damp(a.speed, Math.max(0, target), target < a.speed ? 2.6 : 1.1, dt);
    a.s += a.speed * a.dir * dt;

    // --- node transition --------------------------------------------------
    if (a.s > e.len - 0.5 || a.s < 0.5) {
      const nodeId = a.s >= e.len - 0.5 ? e.b : e.a;
      const options = (w.nodeEdges.get(nodeId) || []).filter((id) => id !== e.i);
      let next = null;
      if (options.length) {
        // prefer staying on the same class of road
        const scored = options.map((id) => {
          const o = w.edges[id];
          let sc = hashF(a.s | 0, id, 3);
          if (o.cls === e.cls) sc += 0.6;
          if (o.name && o.name === e.name) sc += 0.8;
          if (this._fits(a.type, o)) sc += 0.4;
          else sc -= 2;
          return [sc, o];
        });
        scored.sort((p, q) => q[0] - p[0]);
        next = scored[0][1];
      }
      if (!next || !this._fits(a.type, next)) {
        // dead end -> turn around
        a.dir *= -1;
        a.s = clamp(a.s, 1, e.len - 1);
      } else {
        const atStart = Math.hypot(next.pts3[0][0] - w.nodes[nodeId][0], next.pts3[0][2] + w.nodes[nodeId][1]) < 2.5;
        a.edge = next;
        a.dir = next.a === nodeId ? 1 : -1;
        a.s = a.dir === 1 ? 0.6 : next.len - 0.6;
        a.lane = (next.w * 0.25) * KEEP_LEFT * a.dir;
        a.targetSpeed = Math.min(a.type.speed, (next.sp / 3.6) * 0.95);
      }
    }
    a.s = clamp(a.s, 0, a.edge.len);

    // --- place -------------------------------------------------------------
    const pose = sampleEdge(a.edge, a.s);
    const laneOff = (a.edge.w * 0.25) * KEEP_LEFT * a.dir;
    a.lane = damp(a.lane, laneOff, 3, dt);
    const x = pose.x + pose.nx * a.lane;
    const z = pose.z + pose.nz * a.lane;
    const y = w.heightAt(x, z);
    a.mesh.position.set(x, y + 0.01, z);
    const hd = Math.atan2(pose.tx * a.dir, pose.tz * a.dir);
    a.heading = a.heading === 0 ? hd : a.heading + wrapAngle(hd - a.heading) * Math.min(1, dt * 9);
    a.mesh.rotation.y = a.heading;
    // pitch with the road
    const ahead = sampleEdge(a.edge, clamp(a.s + 2 * a.dir, 0, a.edge.len));
    const y2 = w.heightAt(ahead.x, ahead.z);
    a.mesh.rotation.x = -Math.atan2(y2 - y, 2) * a.dir * -1;

    a.hornTimer -= dt;
    if (a.hornTimer <= 0) {
      a.hornTimer = 6 + hashF(a.s | 0, a.edge.i, 17) * 40;
      const d = Math.hypot(x - player.pos.x, z - player.pos.z);
      if (d < 55) this.events.push({ type: 'horn', x, y, z, vehicle: a.type.id });
    }
  }

  _fits(type, edge) {
    return type.w < edge.w * 0.62;
  }

  setNight(on) {
    // cheap: tint the headlight boxes emissive
    for (const a of this.agents) {
      a.mesh.traverse((o) => {
        if (o.isMesh && o.material && o.material.color && o.material.color.r > 0.9 && o.material.color.g > 0.85) {
          o.material.emissive = o.material.emissive || new THREE.Color();
          o.material.emissive.setScalar(on ? 0.9 : 0);
        }
      });
    }
  }

  nearestVehicleDistance(x, z) {
    let best = 1e9;
    for (const a of this.agents) {
      const d = Math.hypot(a.mesh.position.x - x, a.mesh.position.z - z);
      if (d < best) best = d;
    }
    return best;
  }
}

export function sampleEdge(edge, s) {
  const pts = edge.pts3;
  const cum = edge.cum;
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < s) i++;
  const a = pts[i];
  const b = pts[i + 1] || pts[i];
  const segLen = Math.max(1e-5, cum[i + 1] - cum[i]);
  const t = clamp01((s - cum[i]) / segLen);
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
