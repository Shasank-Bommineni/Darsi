// Procedural 3D motorcycle: the "Sahaja 125", an original design in the Indian
// commuter idiom (think the shape language shared by every 100-125cc bike that
// actually rides through a town like Darsi -- round headlamp, teardrop tank,
// long flat seat, chrome grab rail, twin rear shocks, exposed chain).
//
// Every dimension below is a real measurement in metres:
//   wheelbase 1.285 | wheel dia 0.635 (18") | seat height 0.79 | width 0.72
// so the bike sits correctly against 2.1 m doors and 1.6 m compound walls.

import * as THREE from 'three';
import { clamp, lerp } from '../core/util.js';

const MAT = {
  paint: (c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.55, roughness: 0.32 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.95, roughness: 0.14 }),
  darkMetal: () => new THREE.MeshStandardMaterial({ color: 0x33363a, metalness: 0.8, roughness: 0.42 }),
  blackPlastic: () => new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.1, roughness: 0.72 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.0, roughness: 0.94 }),
  seat: () => new THREE.MeshStandardMaterial({ color: 0x121214, metalness: 0.05, roughness: 0.78 }),
  engine: () => new THREE.MeshStandardMaterial({ color: 0x8c9196, metalness: 0.75, roughness: 0.46 }),
  glass: () => new THREE.MeshStandardMaterial({ color: 0xfff6e0, metalness: 0.1, roughness: 0.1 }),
};

export const BIKE_COLOURS = {
  maroon: 0x6d1f26,
  black: 0x18181b,
  blue: 0x1b3a66,
  red: 0x9c2118,
  silver: 0x9aa0a6,
  green: 0x1f4a35,
};

function box(w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}

function cyl(rt, rb, h, seg, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}

function sph(r, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}

function makeWheel(radius, width, spokes, mats) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(radius - width * 0.42, width * 0.46, 10, 26), mats.rubber);
  tyre.rotation.y = Math.PI / 2;
  tyre.castShadow = true;
  g.add(tyre);
  // tread band
  const tread = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width * 0.82, 26, 1, true), mats.rubber);
  tread.rotation.z = Math.PI / 2;
  g.add(tread);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.63, radius * 0.63, width * 0.5, 22, 1, true), mats.chrome);
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  const hub = cyl(radius * 0.21, radius * 0.21, width * 1.15, 14, mats.engine, 0, 0, 0, 0, 0, Math.PI / 2);
  g.add(hub);
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, radius * 1.2, 5), mats.chrome);
    s.position.set(0, 0, 0);
    s.rotation.z = a;
    s.position.x = (i % 2 ? 1 : -1) * width * 0.18;
    g.add(s);
  }
  // brake disc / drum
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.46, radius * 0.46, 0.008, 20), mats.darkMetal);
  disc.rotation.z = Math.PI / 2;
  disc.position.x = -width * 0.5;
  g.add(disc);
  return g;
}

export function createBike(colourName = 'maroon') {
  const mats = {
    paint: MAT.paint(BIKE_COLOURS[colourName] ?? BIKE_COLOURS.maroon),
    paintDark: MAT.paint(0x24262b),
    chrome: MAT.chrome(),
    darkMetal: MAT.darkMetal(),
    blackPlastic: MAT.blackPlastic(),
    rubber: MAT.rubber(),
    seat: MAT.seat(),
    engine: MAT.engine(),
    glass: new THREE.MeshStandardMaterial({ color: 0xfff4dd, emissive: 0x000000, metalness: 0.2, roughness: 0.15 }),
    amberLens: new THREE.MeshStandardMaterial({ color: 0xff9a2e, emissive: 0x000000, roughness: 0.4 }),
    redLens: new THREE.MeshStandardMaterial({ color: 0xcc1f1f, emissive: 0x000000, roughness: 0.4 }),
  };

  const root = new THREE.Group();
  root.name = 'bike';

  // ---------------------------------------------------------------- wheels
  const R = 0.3175;
  const rearWheel = makeWheel(R, 0.10, 18, mats);
  const frontWheel = makeWheel(R, 0.085, 18, mats);

  const WB = 1.285;
  const rearX = -WB * 0.5;
  const frontX = WB * 0.5;

  // --------------------------------------------------- rear: swingarm + shocks
  const rearAssembly = new THREE.Group();   // pivots for suspension travel
  rearAssembly.position.set(0, R, rearX);
  rearWheel.position.set(0, 0, 0);
  rearWheel.rotation.y = Math.PI / 2;
  rearAssembly.add(rearWheel);

  // swingarm arms
  for (const s of [-1, 1]) {
    const arm = box(0.045, 0.055, 0.52, mats.darkMetal, s * 0.105, 0.02, 0.26);
    rearAssembly.add(arm);
  }
  // chain + sprocket
  const sprocket = cyl(0.105, 0.105, 0.012, 20, mats.darkMetal, -0.115, 0, 0, 0, 0, Math.PI / 2);
  rearAssembly.add(sprocket);
  const chainTop = box(0.012, 0.012, 0.50, mats.darkMetal, -0.115, 0.095, 0.25);
  const chainBot = box(0.012, 0.012, 0.50, mats.darkMetal, -0.115, -0.095, 0.25);
  rearAssembly.add(chainTop, chainBot);
  // chain guard
  rearAssembly.add(box(0.02, 0.07, 0.34, mats.paintDark, -0.125, 0.11, 0.2));

  // twin shocks
  const shockL = new THREE.Group();
  const shockR = new THREE.Group();
  for (const [grp, s] of [[shockL, -1], [shockR, 1]]) {
    const body = cyl(0.016, 0.016, 0.21, 8, mats.chrome, 0, 0, 0);
    const spring = new THREE.Mesh(new THREE.TorusKnotGeometry(0.027, 0.0065, 48, 5, 7, 1), mats.paint);
    spring.scale.set(1, 1, 0.42);
    spring.rotation.x = Math.PI / 2;
    grp.add(body, spring);
    grp.position.set(s * 0.115, R + 0.17, rearX + 0.08);
    grp.rotation.x = -0.28;
  }

  // ---------------------------------------------------------------- frame
  const chassis = new THREE.Group();
  chassis.name = 'chassis';

  // backbone + downtube + cradle, as real tubes
  const frameMat = mats.paintDark;
  const tube = (len, r, x, y, z, rx, ry, rz) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), frameMat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    return m;
  };
  // headstock
  const headZ = frontX - 0.09;
  const headY = R + 0.52;
  chassis.add(tube(0.17, 0.034, 0, headY, headZ, 0.44, 0, 0));
  // top backbone from headstock to under the seat
  chassis.add(tube(0.78, 0.023, 0, R + 0.43, headZ - 0.40, Math.PI / 2 - 0.16, 0, 0));
  // down tube
  chassis.add(tube(0.52, 0.021, 0, R + 0.17, headZ - 0.17, Math.PI / 2 + 0.72, 0, 0));
  // lower cradle
  chassis.add(tube(0.62, 0.019, 0, R - 0.11, headZ - 0.56, Math.PI / 2, 0, 0));
  // seat rails
  for (const s of [-1, 1]) {
    chassis.add(tube(0.60, 0.016, s * 0.07, R + 0.40, rearX + 0.20, Math.PI / 2 - 0.08, 0, 0));
    chassis.add(tube(0.30, 0.016, s * 0.07, R + 0.26, rearX + 0.28, Math.PI / 2 + 0.75, 0, 0));
  }
  // swingarm pivot plate
  chassis.add(box(0.19, 0.16, 0.05, frameMat, 0, R + 0.03, rearX + 0.50));

  // ---------------------------------------------------------------- engine
  const eng = new THREE.Group();
  eng.position.set(0, R + 0.055, -0.04);
  // crankcase
  eng.add(box(0.22, 0.20, 0.30, mats.engine, 0, 0, 0));
  eng.add(sph(0.105, mats.engine, 0.0, -0.02, -0.11, 1.0, 0.9, 1.0));
  // cylinder barrel with fins, inclined forward
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.12, 0.09);
  barrel.rotation.x = -0.38;
  for (let i = 0; i < 7; i++) {
    const fin = box(0.185, 0.011, 0.155, mats.engine, 0, 0.018 + i * 0.025, 0);
    barrel.add(fin);
  }
  barrel.add(box(0.12, 0.2, 0.1, mats.engine, 0, 0.1, 0));
  // head + rocker cover
  barrel.add(box(0.17, 0.065, 0.15, mats.engine, 0, 0.215, 0));
  barrel.add(box(0.13, 0.05, 0.12, mats.darkMetal, 0, 0.26, 0));
  eng.add(barrel);
  // clutch cover (right) and magneto (left)
  eng.add(cyl(0.085, 0.085, 0.035, 14, mats.engine, 0.115, -0.01, -0.02, 0, 0, Math.PI / 2));
  eng.add(cyl(0.075, 0.075, 0.03, 14, mats.engine, -0.118, -0.01, -0.02, 0, 0, Math.PI / 2));
  // front sprocket cover
  eng.add(cyl(0.055, 0.055, 0.03, 12, mats.darkMetal, -0.115, -0.03, -0.14, 0, 0, Math.PI / 2));
  // kick lever
  eng.add(box(0.02, 0.02, 0.17, mats.darkMetal, 0.14, -0.04, -0.06, 0, 0, 0));
  chassis.add(eng);

  // ---------------------------------------------------------------- exhaust
  const exh = new THREE.Group();
  const header = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.015, 8, 12, Math.PI * 0.75), mats.chrome);
  header.position.set(0.055, R + 0.10, 0.12);
  header.rotation.set(Math.PI / 2, 0.2, -0.2);
  exh.add(header);
  exh.add(cyl(0.017, 0.019, 0.42, 10, mats.chrome, 0.085, R - 0.03, -0.12, Math.PI / 2 - 0.08, 0.1, 0));
  const can = cyl(0.045, 0.052, 0.42, 14, mats.chrome, 0.115, R + 0.02, -0.46, Math.PI / 2 - 0.05, 0, 0);
  exh.add(can);
  exh.add(cyl(0.028, 0.03, 0.05, 10, mats.darkMetal, 0.122, R + 0.03, -0.67, Math.PI / 2, 0, 0));
  // heat shield
  exh.add(box(0.012, 0.06, 0.22, mats.chrome, 0.145, R + 0.045, -0.4));
  chassis.add(exh);

  // ---------------------------------------------------------------- tank
  const tankGrp = new THREE.Group();
  tankGrp.position.set(0, R + 0.52, 0.16);
  const tankGeo = new THREE.SphereGeometry(0.19, 20, 14);
  const tank = new THREE.Mesh(tankGeo, mats.paint);
  tank.scale.set(0.95, 0.72, 1.55);
  tank.castShadow = true;
  tankGrp.add(tank);
  // knee recesses / tank pads
  for (const s of [-1, 1]) {
    tankGrp.add(box(0.012, 0.09, 0.2, mats.blackPlastic, s * 0.175, -0.025, -0.02));
  }
  // filler cap
  tankGrp.add(cyl(0.035, 0.035, 0.016, 12, mats.chrome, 0, 0.133, -0.02));
  // tank stripe
  const stripe = box(0.196, 0.035, 0.52, mats.chrome, 0, -0.02, 0.0);
  stripe.scale.set(1.0, 1, 1);
  tankGrp.add(stripe);
  chassis.add(tankGrp);

  // ---------------------------------------------------------------- seat
  const seatGrp = new THREE.Group();
  const seatGeo = new THREE.BoxGeometry(0.27, 0.085, 0.70);
  const seat = new THREE.Mesh(seatGeo, mats.seat);
  seat.castShadow = true;
  seatGrp.add(seat);
  seatGrp.add(box(0.26, 0.05, 0.22, mats.seat, 0, 0.045, -0.26)); // pillion step up
  seatGrp.position.set(0, R + 0.455, -0.26);
  chassis.add(seatGrp);

  // side panels + tail
  for (const s of [-1, 1]) {
    chassis.add(box(0.016, 0.14, 0.26, mats.paint, s * 0.095, R + 0.36, -0.42));
  }
  chassis.add(box(0.20, 0.10, 0.22, mats.paint, 0, R + 0.40, -0.63));

  // grab rail
  const grab = new THREE.Group();
  for (const s of [-1, 1]) {
    grab.add(cyl(0.011, 0.011, 0.30, 8, mats.chrome, s * 0.115, 0, -0.07, Math.PI / 2, 0, 0));
  }
  grab.add(cyl(0.011, 0.011, 0.23, 8, mats.chrome, 0, 0, -0.22, 0, 0, Math.PI / 2));
  grab.position.set(0, R + 0.50, -0.55);
  chassis.add(grab);

  // rear mudguard + number plate + tail light
  chassis.add(box(0.19, 0.012, 0.36, mats.paintDark, 0, R + 0.235, -0.62, -0.18, 0, 0));
  const plate = box(0.18, 0.11, 0.012, new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.7 }), 0, R + 0.17, -0.78);
  plate.rotation.x = 0.22;
  chassis.add(plate);
  const tailLight = box(0.10, 0.055, 0.04, mats.redLens, 0, R + 0.37, -0.745);
  chassis.add(tailLight);

  // footpegs + rider pegs
  for (const s of [-1, 1]) {
    chassis.add(cyl(0.013, 0.013, 0.10, 8, mats.darkMetal, s * 0.175, R - 0.085, -0.10, 0, 0, Math.PI / 2));
    chassis.add(cyl(0.011, 0.011, 0.08, 8, mats.darkMetal, s * 0.17, R - 0.03, -0.42, 0, 0, Math.PI / 2));
  }
  // centre stand
  chassis.add(box(0.26, 0.018, 0.018, mats.darkMetal, 0, R - 0.26, -0.22));
  // brake pedal & gear lever
  chassis.add(box(0.012, 0.012, 0.15, mats.darkMetal, 0.17, R - 0.09, 0.0));
  chassis.add(box(0.012, 0.012, 0.13, mats.darkMetal, -0.17, R - 0.09, 0.02));

  chassis.add(shockL, shockR);
  chassis.add(rearAssembly);

  // ---------------------------------------------------------------- front end
  const steer = new THREE.Group();   // rotates about the steering axis
  steer.name = 'steering';
  const rake = 0.46; // ~26 deg
  steer.position.set(0, headY, headZ);

  const forkGrp = new THREE.Group();
  forkGrp.rotation.x = rake;

  // triple clamps
  forkGrp.add(box(0.21, 0.028, 0.07, mats.darkMetal, 0, 0.055, 0));
  forkGrp.add(box(0.19, 0.026, 0.065, mats.darkMetal, 0, -0.07, 0));
  // stanchions + sliders
  const frontSus = new THREE.Group();
  for (const s of [-1, 1]) {
    forkGrp.add(cyl(0.0165, 0.0165, 0.30, 10, mats.chrome, s * 0.082, -0.19, 0));
    const slider = cyl(0.024, 0.024, 0.26, 10, mats.blackPlastic, s * 0.082, -0.42, 0);
    frontSus.add(slider);
  }
  forkGrp.add(frontSus);
  // gaiters
  for (const s of [-1, 1]) {
    forkGrp.add(cyl(0.027, 0.027, 0.08, 10, mats.blackPlastic, s * 0.082, -0.3, 0));
  }
  steer.add(forkGrp);

  // the front wheel hangs at the bottom of the fork along the rake axis
  const frontHub = new THREE.Group();
  const forkLen = 0.555;
  frontHub.position.set(0, -Math.cos(rake) * forkLen, Math.sin(rake) * forkLen * 0 + 0);
  // place along fork direction
  frontHub.position.set(0, -forkLen * Math.cos(rake), forkLen * Math.sin(rake));
  frontWheel.rotation.y = Math.PI / 2;
  frontHub.add(frontWheel);
  steer.add(frontHub);

  // front mudguard
  const mud = new THREE.Mesh(new THREE.TorusGeometry(R + 0.045, 0.012, 6, 16, Math.PI * 0.62), mats.paint);
  mud.rotation.set(0, Math.PI / 2, Math.PI * 0.72);
  mud.scale.set(1, 1, 7.0);
  const mudPlate = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.05, 0.11, 18, 1, true, Math.PI * 0.15, Math.PI * 0.72), mats.paint);
  mudPlate.rotation.z = Math.PI / 2;
  mudPlate.position.copy(frontHub.position);
  steer.add(mudPlate);

  // handlebars
  const bars = new THREE.Group();
  bars.position.set(0, 0.095, -0.015);
  bars.add(cyl(0.0115, 0.0115, 0.62, 10, mats.chrome, 0, 0, 0, 0, 0, Math.PI / 2));
  for (const s of [-1, 1]) {
    bars.add(cyl(0.0115, 0.0115, 0.10, 8, mats.chrome, s * 0.30, -0.02, 0.01, 0.6, 0, Math.PI / 2 - 0.25 * s));
    // grips
    bars.add(cyl(0.0165, 0.0165, 0.115, 10, mats.blackPlastic, s * 0.265, 0, 0, 0, 0, Math.PI / 2));
    // levers
    const lever = box(0.085, 0.008, 0.016, mats.chrome, s * 0.195, 0.0, 0.035);
    lever.rotation.y = s * 0.3;
    bars.add(lever);
    // switchgear
    bars.add(box(0.045, 0.035, 0.045, mats.blackPlastic, s * 0.20, -0.005, -0.005));
    // mirror
    const stalk = cyl(0.006, 0.006, 0.17, 6, mats.chrome, s * 0.225, 0.085, -0.01);
    const glassM = new THREE.Mesh(new THREE.CircleGeometry(0.045, 14), new THREE.MeshStandardMaterial({ color: 0x9fb3c0, metalness: 0.9, roughness: 0.12 }));
    glassM.position.set(s * 0.235, 0.17, -0.012);
    glassM.rotation.set(0.1, Math.PI + s * 0.2, 0);
    bars.add(stalk, glassM);
  }
  steer.add(bars);

  // headlamp
  const lampGrp = new THREE.Group();
  lampGrp.position.set(0, 0.035, 0.09);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.095, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mats.chrome);
  bowl.rotation.x = -Math.PI / 2 + 0.08;
  lampGrp.add(bowl);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.093, 20), mats.glass);
  lens.position.z = 0.045;
  lens.rotation.x = 0.08;
  lampGrp.add(lens);
  lampGrp.add(new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.009, 6, 20), mats.chrome));
  steer.add(lampGrp);

  // indicators
  const indicators = [];
  for (const s of [-1, 1]) {
    const ind = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), mats.amberLens);
    ind.position.set(s * 0.165, 0.045, 0.055);
    steer.add(ind);
    steer.add(cyl(0.006, 0.006, 0.06, 6, mats.blackPlastic, s * 0.145, 0.04, 0.045, 0, 0, Math.PI / 2 - s * 0.5));
    indicators.push(ind);
  }
  for (const s of [-1, 1]) {
    const ind = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), mats.amberLens);
    ind.position.set(s * 0.13, R + 0.33, -0.72);
    chassis.add(ind);
    indicators.push(ind);
  }

  // speedo cluster
  const cluster = new THREE.Group();
  cluster.position.set(0, 0.145, 0.045);
  cluster.rotation.x = -0.5;
  cluster.add(cyl(0.052, 0.052, 0.045, 14, mats.blackPlastic, -0.03, 0, 0, Math.PI / 2, 0, 0));
  cluster.add(cyl(0.042, 0.042, 0.04, 14, mats.blackPlastic, 0.045, 0, 0, Math.PI / 2, 0, 0));
  const dial = new THREE.Mesh(new THREE.CircleGeometry(0.046, 16), new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.6 }));
  dial.position.set(-0.03, 0.024, 0);
  dial.rotation.x = -Math.PI / 2;
  cluster.add(dial);
  steer.add(cluster);

  chassis.add(steer);
  root.add(chassis);

  // headlight beam
  const beam = new THREE.SpotLight(0xfff0d0, 0, 46, 0.55, 0.55, 1.4);
  beam.position.set(0, headY + 0.03, headZ + 0.16);
  beam.castShadow = false;
  const beamTarget = new THREE.Object3D();
  beamTarget.position.set(0, headY - 0.9, headZ + 16);
  chassis.add(beam, beamTarget);
  beam.target = beamTarget;

  return {
    root,
    chassis,
    steer,
    frontWheel,
    rearWheel,
    frontHub,
    rearAssembly,
    frontSus,
    shockL,
    shockR,
    bars,
    lamp: lens,
    beam,
    tailLight,
    indicators,
    mats,
    headY,
    headZ,
    rake,
    forkLen,
    seatPos: new THREE.Vector3(0, R + 0.50, -0.20),
    pegPos: new THREE.Vector3(0.175, R - 0.085, -0.10),
    gripPos: new THREE.Vector3(0.265, headY + 0.095, headZ - 0.015),
  };
}
