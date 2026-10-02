// Capsule-vs-OBB collision resolution against buildings, plus walls.
//
// Hitting a wall should feel like hitting a wall: you stop, you scrub speed,
// and a square-on impact at speed throws you off. Glancing blows slide.

import { clamp, clamp01 } from '../core/util.js';

const RADIUS = 0.42;   // bike + rider body radius in plan
const LEN = 0.95;      // half length front-to-back

export function resolveCollisions(bike, world, dt) {
  const px = bike.pos.x;
  const pz = bike.pos.z;
  const fx = Math.sin(bike.heading);
  const fz = Math.cos(bike.heading);

  // two sample spheres: front and rear of the bike
  const pts = [
    [px + fx * LEN * 0.55, pz + fz * LEN * 0.55],
    [px - fx * LEN * 0.55, pz - fz * LEN * 0.55],
  ];

  let hit = null;
  let totalPushX = 0;
  let totalPushZ = 0;

  for (const id of world.buildingGrid.query(px, pz, 6)) {
    const b = world.buildings[id];
    // roofs above the rider do not block (none here, but keep the test honest)
    if (b.g + b.h + b.pp < bike.pos.y + 0.2) continue;
    const ca = Math.cos(-b.ang3);
    const sa = Math.sin(-b.ang3);
    const hw = b.w / 2;
    const hd = b.d / 2;
    for (const [sx, sz] of pts) {
      const dx = sx - b.wx;
      const dz = sz - b.wz;
      const lx = dx * ca - dz * sa;
      const lz = dx * sa + dz * ca;
      const cx = clamp(lx, -hw, hw);
      const cz = clamp(lz, -hd, hd);
      let ox = lx - cx;
      let oz = lz - cz;
      let d = Math.hypot(ox, oz);
      if (d >= RADIUS) continue;
      if (d < 1e-5) {
        // deep inside: push out along the shortest axis
        const toX = hw - Math.abs(lx);
        const toZ = hd - Math.abs(lz);
        if (toX < toZ) {
          ox = Math.sign(lx) || 1;
          oz = 0;
          d = 0.001;
        } else {
          ox = 0;
          oz = Math.sign(lz) || 1;
          d = 0.001;
        }
      }
      const pen = RADIUS - d;
      const nxl = ox / d;
      const nzl = oz / d;
      // back to world space
      const nx = nxl * ca + nzl * sa;
      const nz = -nxl * sa + nzl * ca;
      totalPushX += nx * pen;
      totalPushZ += nz * pen;
      const dot = nx * fx + nz * fz;
      if (!hit || Math.abs(dot) > Math.abs(hit.dot)) hit = { nx, nz, dot, pen, b };
    }
  }

  if (!hit) return null;

  bike.pos.x += totalPushX * 1.02;
  bike.pos.z += totalPushZ * 1.02;

  const speed = bike.speed;
  const headOn = Math.abs(hit.dot); // 1 = square on, 0 = parallel slide
  const impact = Math.abs(speed) * headOn;

  if (headOn > 0.55) {
    // frontal: kill most of the speed
    bike.speed *= clamp01(1 - headOn * 0.92);
    if (impact > 8 && !bike.crashed) {
      bike.crashed = true;
      bike.crashTimer = 1.7;
    }
    // Nose-in against a wall at walking pace: a real rider paddles the bike
    // around rather than sitting there with the throttle open forever, so
    // swing the heading towards whichever way the wall runs. Without this you
    // can wedge yourself into a corner with no way out but a reset.
    if (Math.abs(speed) < 1.6) {
      const tx = -hit.nz;
      const tz = hit.nx;
      const fdotT = fx * tx + fz * tz;
      const dirSign = fdotT >= 0 ? 1 : -1;
      const escape = Math.atan2(tx * dirSign, tz * dirSign);
      let diff = escape - bike.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      bike.heading += clamp(diff, -1.8 * dt, 1.8 * dt);
      // nudge out of the contact so the next frame starts free
      bike.pos.x += hit.nx * 0.9 * dt;
      bike.pos.z += hit.nz * 0.9 * dt;
    }
  } else {
    // glancing: scrub a little and get deflected along the wall
    bike.speed *= 1 - headOn * 0.35;
    const tx = -hit.nz;
    const tz = hit.nx;
    const newHeading = Math.atan2(tx, tz);
    const diff = Math.atan2(Math.sin(newHeading - bike.heading), Math.cos(newHeading - bike.heading));
    bike.heading += clamp(diff, -0.5, 0.5) * clamp01(headOn * 2.5) * Math.min(1, dt * 22);
    bike.lean += Math.sign(hit.dot || 1) * 0.1;
  }
  bike.lateral *= 0.2;
  bike.bumpEvent = Math.max(bike.bumpEvent, clamp01(impact / 14));
  return { impact, headOn, building: hit.b };
}
