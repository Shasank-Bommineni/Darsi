// The rider: a 1.72 m figure built from capsules, seated ON the bike with
// hands on the grips and feet on the pegs. Posture responds to throttle,
// braking, lean and steering.

import * as THREE from 'three';
import { clamp, lerp, damp } from '../core/util.js';

function capsule(r, len, mat) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
  m.castShadow = true;
  return m;
}

export function createRider(opts = {}) {
  const shirt = new THREE.MeshStandardMaterial({ color: opts.shirt ?? 0x3a5a7a, roughness: 0.82, metalness: 0.02 });
  const pants = new THREE.MeshStandardMaterial({ color: opts.pants ?? 0x2a2d35, roughness: 0.88 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a6243, roughness: 0.75 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: opts.helmet ?? 0xd8d4c8, roughness: 0.3, metalness: 0.2 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.12, metalness: 0.6 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.9 });

  const root = new THREE.Group();
  root.name = 'rider';

  // ---- pelvis / torso ----------------------------------------------------
  const pelvis = new THREE.Group();
  pelvis.position.set(0, 0, 0);
  root.add(pelvis);
  const hips = capsule(0.115, 0.1, pants);
  hips.rotation.z = Math.PI / 2;
  pelvis.add(hips);

  const torso = new THREE.Group();
  torso.position.set(0, 0.10, 0);
  pelvis.add(torso);
  const chest = capsule(0.135, 0.30, shirt);
  chest.position.y = 0.21;
  chest.scale.set(1.15, 1, 0.78);
  torso.add(chest);
  // shoulders
  const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.30, 4, 8), shirt);
  shoulders.rotation.z = Math.PI / 2;
  shoulders.position.y = 0.37;
  torso.add(shoulders);

  // ---- head --------------------------------------------------------------
  const neck = new THREE.Group();
  neck.position.set(0, 0.42, 0);
  torso.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 16, 12), skin);
  head.position.y = 0.1;
  neck.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 18, 14), helmetMat);
  helmet.position.y = 0.11;
  helmet.scale.set(1, 1.04, 1.08);
  helmet.castShadow = true;
  neck.add(helmet);
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.137, 18, 10, Math.PI * 0.72, Math.PI * 0.56, Math.PI * 0.30, Math.PI * 0.34),
    visorMat
  );
  visor.position.y = 0.11;
  visor.scale.set(1, 1.04, 1.1);
  neck.add(visor);
  // chin bar
  const chin = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.028, 6, 14, Math.PI), helmetMat);
  chin.position.set(0, 0.055, 0.045);
  chin.rotation.set(1.3, 0, 0);
  neck.add(chin);

  // ---- arms --------------------------------------------------------------
  function makeArm(side) {
    const g = new THREE.Group();
    g.position.set(side * 0.165, 0.37, 0.0);
    const upper = capsule(0.047, 0.21, shirt);
    upper.position.set(0, -0.12, 0);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.24, 0);
    const lower = capsule(0.041, 0.2, skin);
    lower.position.set(0, -0.115, 0);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.047, 10, 8), skin);
    hand.position.set(0, -0.235, 0);
    hand.scale.set(1, 0.85, 1.25);
    elbow.add(lower, hand);
    g.add(upper, elbow);
    return { group: g, elbow, hand };
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);
  torso.add(armL.group, armR.group);

  // ---- legs --------------------------------------------------------------
  function makeLeg(side) {
    const g = new THREE.Group();
    g.position.set(side * 0.095, -0.03, 0);
    const thigh = capsule(0.062, 0.24, pants);
    thigh.position.set(0, -0.13, 0);
    const knee = new THREE.Group();
    knee.position.set(0, -0.27, 0);
    const shin = capsule(0.05, 0.24, pants);
    shin.position.set(0, -0.14, 0);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.055, 0.21), shoe);
    foot.position.set(0, -0.285, 0.045);
    foot.castShadow = true;
    knee.add(shin, foot);
    g.add(thigh, knee);
    return { group: g, knee, foot };
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);
  pelvis.add(legL.group, legR.group);

  return {
    root, pelvis, torso, neck, head, helmet,
    armL, armR, legL, legR,
    state: { lean: 0, crouch: 0, headTurn: 0, legOut: 0 },
  };
}

/**
 * Pose the rider for the current bike state.
 * `anchor` carries the local-space seat / peg / grip positions from the bike.
 */
export function poseRider(rider, bike, anchor, dt) {
  const s = rider.state;
  const speed = Math.abs(bike.speed);
  const accelLean = clamp(bike.throttle * 0.9 - bike.brakeInput * 1.5, -1, 1);
  const crouchTarget = clamp(speed / 30, 0, 1) * 0.55 + Math.max(0, accelLean) * 0.1;
  s.crouch = damp(s.crouch, crouchTarget, 4, dt);
  s.lean = damp(s.lean, clamp(-accelLean * 0.22, -0.4, 0.18), 6, dt);
  s.headTurn = damp(s.headTurn, clamp(bike.steer * 1.4, -0.6, 0.6), 7, dt);
  // put a foot down when nearly stopped
  const wantFoot = speed < 0.8 && bike.brakeInput > 0.05 ? 1 : 0;
  s.legOut = damp(s.legOut, wantFoot, 5, dt);

  const seat = anchor.seatPos;
  rider.root.position.set(seat.x, seat.y + 0.12 - s.crouch * 0.03, seat.z + 0.02);

  // torso leans forward with speed, back under braking
  rider.torso.rotation.x = 0.16 + s.crouch * 0.45 + s.lean;
  rider.pelvis.rotation.z = -bike.lean * 0.06;
  rider.neck.rotation.x = -rider.torso.rotation.x * 0.75;
  rider.neck.rotation.y = s.headTurn * 0.7;
  rider.helmet.rotation.y = 0;

  // arms reach for the grips
  const grip = anchor.gripPos;
  const shoulderY = seat.y + 0.12 + 0.37;
  const reach = Math.hypot(grip.z - seat.z, grip.y - shoulderY);
  const pitchToGrip = Math.atan2(grip.z - seat.z - 0.02, Math.max(0.01, shoulderY - grip.y));
  for (const [arm, side] of [[rider.armL, -1], [rider.armR, 1]]) {
    arm.group.rotation.x = -(Math.PI / 2 - pitchToGrip) + 0.18 - s.crouch * 0.22;
    arm.group.rotation.z = side * (0.30 - bike.steer * side * 0.1);
    arm.elbow.rotation.x = 0.55 - s.crouch * 0.3 + Math.abs(bike.steer) * 0.15;
    // the inside arm pulls in slightly when steering
    arm.group.rotation.y = -bike.steer * 0.18 * side;
  }

  // legs tuck onto the pegs; one comes down at a stop
  for (const [leg, side] of [[rider.legL, -1], [rider.legR, 1]]) {
    const out = side < 0 ? s.legOut : 0;
    leg.group.rotation.x = -0.72 + out * 0.62;
    leg.group.rotation.z = side * (0.16 - out * 0.22);
    leg.knee.rotation.x = 1.42 - out * 1.15;
  }
}
