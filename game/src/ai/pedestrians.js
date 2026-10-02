// Pedestrians and roadside life.
//
// People appear where people actually are: along shop frontages, around the
// bus station and temples, at junctions in the bazaar. Numbers follow the
// urbanity field and the clock -- busy at 8-11 and 17-20, nearly empty at 2am.

import * as THREE from 'three';
import { clamp, clamp01, lerp, damp, wrapAngle } from '../core/util.js';
import { Rng, hashU32, hashF } from '../core/rng.js';

const SHIRT = [0xd8d2c4, 0x4a6e8a, 0x8a4a4a, 0x3f6a4a, 0xc8a24a, 0xe0dcd0, 0x6a4a7a, 0x2f3b4a];
const SAREE = [0xc43a5a, 0x2f7a5a, 0xd4a017, 0x7a3a8a, 0x1f5a8a, 0xd05a2a];
const SKIN = [0x8a6243, 0x7a5338, 0x9c7450, 0x6d472e];

function makePerson(rng) {
  const g = new THREE.Group();
  const female = rng.chance(0.42);
  const child = rng.chance(0.12);
  const scale = child ? rng.range(0.6, 0.76) : rng.range(0.93, 1.06);
  const skin = new THREE.MeshStandardMaterial({ color: SKIN[rng.u32() % SKIN.length], roughness: 0.78 });
  const cloth = new THREE.MeshStandardMaterial({
    color: female ? SAREE[rng.u32() % SAREE.length] : SHIRT[rng.u32() % SHIRT.length],
    roughness: 0.88,
  });
  const lower = new THREE.MeshStandardMaterial({
    color: female ? cloth.color.getHex() : (rng.chance(0.5) ? 0x2a2d35 : 0xd8d4c8),
    roughness: 0.9,
  });

  const legs = new THREE.Group();
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.4, 3, 6), lower);
  const legR = legL.clone();
  legL.position.set(-0.075, 0.28, 0);
  legR.position.set(0.075, 0.28, 0);
  if (female) {
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.21, 0.62, 10), lower);
    skirt.position.y = 0.4;
    legs.add(skirt);
  } else {
    legs.add(legL, legR);
  }
  g.add(legs);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.34, 3, 8), cloth);
  torso.position.y = 0.82;
  torso.scale.set(1.1, 1, 0.72);
  g.add(torso);

  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.3, 3, 6), skin);
  armL.position.set(-0.17, 0.82, 0);
  const armR = armL.clone();
  armR.position.set(0.17, 0.82, 0);
  g.add(armL, armR);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 10), skin);
  head.position.y = 1.15;
  g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), new THREE.MeshStandardMaterial({ color: 0x18140f, roughness: 0.9 }));
  hair.position.y = 1.16;
  g.add(hair);

  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  g.scale.setScalar(scale);
  return { group: g, legL, legR, armL, armR, female, child, scale };
}

export class PedestrianSystem {
  constructor(scene, world, quality) {
    this.scene = scene;
    this.world = world;
    this.max = quality.maxPeds;
    this.radius = quality.pedRadius;
    this.group = new THREE.Group();
    this.group.name = 'pedestrians';
    scene.add(this.group);
    this.people = [];
    this.pool = [];
    this.rng = new Rng(0x9f3a1);
    this.timer = 0;
  }

  _acquire() {
    if (this.pool.length) {
      const p = this.pool.pop();
      p.group.visible = true;
      return p;
    }
    return makePerson(this.rng);
  }

  _release(p) {
    p.group.visible = false;
    this.group.remove(p.group);
    if (this.pool.length < 40) this.pool.push(p);
  }

  timeFactor(hour) {
    if (hour < 5) return 0.03;
    if (hour < 6.5) return 0.2;
    if (hour < 11) return 1.0;
    if (hour < 15.5) return 0.55;
    if (hour < 18) return 0.85;
    if (hour < 20.5) return 1.0;
    if (hour < 22) return 0.5;
    return 0.12;
  }

  spawn(px, pz, hour) {
    const w = this.world;
    for (let attempt = 0; attempt < 10; attempt++) {
      const a = this.rng.f() * Math.PI * 2;
      const r = lerp(this.radius * 0.35, this.radius, this.rng.f());
      const sx = px + Math.cos(a) * r;
      const sz = pz + Math.sin(a) * r;
      const u = w.urbanAt(sx, sz);
      if (this.rng.f() > clamp01(u * 1.25) * this.timeFactor(hour)) continue;
      const near = w.nearestRoad(sx, sz, 40);
      if (!near) continue;
      const e = near.edge;
      if (e.cls === 'highway') continue;
      const side = this.rng.chance(0.5) ? 1 : -1;
      const off = side * (e.w * 0.5 + e.sh * 0.6 + this.rng.range(0.3, 2.2));
      const p = this._acquire();
      this.group.add(p.group);
      const ped = {
        ...p,
        edge: e,
        dir: this.rng.chance(0.5) ? 1 : -1,
        s: this.rng.range(1, Math.max(2, e.len - 1)),
        off,
        speed: this.rng.range(0.9, 1.6) * (p.child ? 1.15 : 1),
        phase: this.rng.f() * 10,
        idle: this.rng.chance(0.3) ? this.rng.range(2, 20) : 0,
        heading: 0,
      };
      this.people.push(ped);
      return ped;
    }
    return null;
  }

  update(dt, player, hour) {
    const px = player.pos.x;
    const pz = player.pos.z;
    const w = this.world;
    const want = Math.round(this.max * clamp01(w.urbanAt(px, pz) * 1.3) * this.timeFactor(hour));

    for (let i = this.people.length - 1; i >= 0; i--) {
      const p = this.people[i];
      const d = Math.hypot(p.group.position.x - px, p.group.position.z - pz);
      if (d > this.radius * 1.25) {
        this._release(p);
        this.people.splice(i, 1);
      }
    }
    this.timer -= dt;
    if (this.people.length < want && this.timer <= 0) {
      for (let k = 0; k < 3 && this.people.length < want; k++) this.spawn(px, pz, hour);
      this.timer = 0.2;
    }

    for (const p of this.people) {
      if (p.idle > 0) {
        p.idle -= dt;
      } else {
        p.s += p.speed * p.dir * dt;
        if (p.s > p.edge.len - 1 || p.s < 1) {
          p.dir *= -1;
          p.s = clamp(p.s, 1, p.edge.len - 1);
          if (this.rng.chance(0.4)) p.idle = this.rng.range(3, 25);
        }
      }
      const pose = sampleE(p.edge, p.s);
      const x = pose.x + pose.nx * p.off;
      const z = pose.z + pose.nz * p.off;
      const y = w.heightAt(x, z);
      p.group.position.set(x, y, z);
      const hd = Math.atan2(pose.tx * p.dir, pose.tz * p.dir);
      p.heading = p.heading === 0 ? hd : p.heading + wrapAngle(hd - p.heading) * Math.min(1, dt * 6);
      p.group.rotation.y = p.heading;

      const moving = p.idle <= 0;
      p.phase += dt * (moving ? p.speed * 4.2 : 0.6);
      const sw = Math.sin(p.phase) * (moving ? 0.55 : 0.03);
      if (!p.female) {
        p.legL.rotation.x = sw;
        p.legR.rotation.x = -sw;
      }
      p.armL.rotation.x = -sw * 0.7;
      p.armR.rotation.x = sw * 0.7;
      p.group.position.y += moving ? Math.abs(Math.sin(p.phase)) * 0.015 : 0;
    }
  }
}

function sampleE(edge, s) {
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
  return { x: a[0] + (b[0] - a[0]) * t, z: a[2] + (b[2] - a[2]) * t, tx, tz, nx: -tz, nz: tx };
}
