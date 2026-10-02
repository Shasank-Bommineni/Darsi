// Chase camera with four modes, speed-reactive framing and terrain/building
// collision avoidance.

import * as THREE from 'three';
import { clamp, clamp01, damp, lerp, wrapAngle } from '../core/util.js';

export const CAM_MODES = ['chase', 'close', 'helmet', 'cinematic'];

export class ChaseCamera {
  constructor(camera, world) {
    this.cam = camera;
    this.world = world;
    this.mode = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.curFov = 62;
    this.shake = 0;
    this.yawOffset = 0;
    this.photo = false;
    this.photoYaw = 0;
    this.photoPitch = -0.1;
    this.photoDist = 5;
    this._tmp = new THREE.Vector3();
    this._initialised = false;
  }

  cycle() {
    this.mode = (this.mode + 1) % CAM_MODES.length;
    this._initialised = false;
    return CAM_MODES[this.mode];
  }

  get modeName() {
    return CAM_MODES[this.mode];
  }

  addShake(v) {
    this.shake = Math.min(1.4, this.shake + v);
  }

  update(dt, bike, bikeObj, input) {
    const mode = CAM_MODES[this.mode];
    const speed = Math.abs(bike.speed);
    const sp01 = clamp01(speed / 28);

    if (this.photo) {
      this._photoUpdate(dt, bike, input);
      return;
    }

    const heading = bike.heading;
    const fwd = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const base = new THREE.Vector3(bike.pos.x, bike.pos.y, bike.pos.z);

    let desired;
    let target;
    let fov;

    if (mode === 'helmet') {
      const h = new THREE.Vector3(0, 1.22, 0.22);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(bike.pitch * 0.5, heading, -bike.lean * 0.85, 'YXZ'));
      h.applyQuaternion(q);
      desired = base.clone().add(h);
      target = desired.clone().add(fwd.clone().multiplyScalar(14)).add(new THREE.Vector3(0, -1.2 + bike.pitch * 6, 0));
      // look into the corner a little
      const side = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
      target.add(side.multiplyScalar(-bike.lean * 9));
      fov = lerp(66, 82, sp01);
      this.cam.position.lerp(desired, 1 - Math.exp(-28 * dt));
      this.look.lerp(target, 1 - Math.exp(-16 * dt));
      this.cam.up.set(0, 1, 0).applyAxisAngle(fwd, -bike.lean * 0.5);
      this.cam.lookAt(this.look);
      this.cam.fov = damp(this.cam.fov, fov, 5, dt);
      this.cam.updateProjectionMatrix();
      this._applyShake(dt, bike);
      return;
    }

    const dist = mode === 'close' ? lerp(3.1, 4.1, sp01) : mode === 'cinematic' ? lerp(7.5, 10.5, sp01) : lerp(4.6, 6.6, sp01);
    const height = mode === 'close' ? 1.35 : mode === 'cinematic' ? 2.6 : 1.85;

    // trail behind the direction of travel, swinging out slightly in corners
    const swing = clamp(-bike.yawRate * 0.55, -0.5, 0.5);
    const camYaw = heading + swing + this.yawOffset;
    const back = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    desired = base.clone().add(back.multiplyScalar(dist)).add(new THREE.Vector3(0, height, 0));

    // keep the camera above the ground and out of walls
    const groundY = this.world.heightAt(desired.x, desired.z);
    if (desired.y < groundY + 1.0) desired.y = groundY + 1.0;
    desired.copy(this._avoidObstacles(base, desired));

    target = base.clone().add(new THREE.Vector3(0, 0.95, 0)).add(fwd.clone().multiplyScalar(lerp(2.2, 7.5, sp01)));

    if (!this._initialised) {
      this.cam.position.copy(desired);
      this.look.copy(target);
      this._initialised = true;
    }
    const posLambda = mode === 'cinematic' ? 3.2 : lerp(5.5, 9.0, sp01);
    this.cam.position.lerp(desired, 1 - Math.exp(-posLambda * dt));
    this.look.lerp(target, 1 - Math.exp(-7 * dt));
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.look);
    fov = mode === 'cinematic' ? 44 : lerp(62, 78, sp01);
    this.cam.fov = damp(this.cam.fov, fov, 4, dt);
    this.cam.updateProjectionMatrix();
    this._applyShake(dt, bike);
  }

  _avoidObstacles(from, to) {
    const w = this.world;
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 0.01) return to;
    dir.divideScalar(len);
    const steps = 6;
    for (let i = steps; i >= 1; i--) {
      const t = (i / steps) * len;
      const p = from.clone().add(dir.clone().multiplyScalar(t));
      let blocked = false;
      for (const id of w.buildingGrid.query(p.x, p.z, 6)) {
        const b = w.buildings[id];
        const dx = p.x - b.wx;
        const dz = p.z - b.wz;
        const ca = Math.cos(-b.ang3);
        const sa = Math.sin(-b.ang3);
        const lx = dx * ca - dz * sa;
        const lz = dx * sa + dz * ca;
        if (Math.abs(lx) < b.w / 2 + 0.4 && Math.abs(lz) < b.d / 2 + 0.4 && p.y < b.g + b.h + b.pp) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        const g = w.heightAt(p.x, p.z);
        if (p.y < g + 0.8) p.y = g + 0.8;
        return p;
      }
    }
    return from.clone().add(new THREE.Vector3(0, 2.2, 0));
  }

  _applyShake(dt, bike) {
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const extra = bike.bumpEvent * 0.5 + (bike.roughness > 0.5 ? Math.abs(bike.speed) * 0.0016 * bike.roughness : 0);
    const amt = Math.min(0.55, this.shake + extra);
    if (amt > 0.001) {
      const t = performance.now() * 0.001;
      this.cam.position.x += Math.sin(t * 47.3) * amt * 0.035;
      this.cam.position.y += Math.sin(t * 61.7) * amt * 0.045;
      this.cam.position.z += Math.cos(t * 53.1) * amt * 0.035;
    }
  }

  // ---------------------------------------------------------------- photo

  enterPhoto(bike) {
    this.photo = true;
    this.photoYaw = bike.heading + Math.PI * 0.75;
    this.photoPitch = -0.12;
    this.photoDist = 5;
  }

  exitPhoto() {
    this.photo = false;
    this._initialised = false;
  }

  _photoUpdate(dt, bike, input) {
    const speed = 1.6 * dt;
    this.photoYaw += (input.steer || 0) * speed * 1.4;
    if (input.held('KeyW') || input.touch.throttle > 0.1) this.photoPitch += speed * 0.5;
    if (input.held('KeyS') || input.touch.brake > 0.1) this.photoPitch -= speed * 0.5;
    if (input.held('KeyQ')) this.photoDist = clamp(this.photoDist - dt * 4, 1.2, 28);
    if (input.held('KeyE')) this.photoDist = clamp(this.photoDist + dt * 4, 1.2, 28);
    this.photoPitch = clamp(this.photoPitch, -0.5, 1.2);

    const base = new THREE.Vector3(bike.pos.x, bike.pos.y + 0.8, bike.pos.z);
    const d = this.photoDist;
    const off = new THREE.Vector3(
      Math.sin(this.photoYaw) * Math.cos(this.photoPitch) * d,
      Math.sin(this.photoPitch) * d + 0.6,
      Math.cos(this.photoYaw) * Math.cos(this.photoPitch) * d
    );
    const pos = base.clone().add(off);
    const g = this.world.heightAt(pos.x, pos.z);
    if (pos.y < g + 0.35) pos.y = g + 0.35;
    this.cam.position.lerp(pos, 1 - Math.exp(-14 * dt));
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(base);
    this.cam.fov = damp(this.cam.fov, 48, 6, dt);
    this.cam.updateProjectionMatrix();
  }
}
