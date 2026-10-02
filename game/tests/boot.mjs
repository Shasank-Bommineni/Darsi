// Boot-path verification under a real DOM (jsdom).
//
// The headless world test proves the simulation is sound; this one proves the
// things that only exist in a browser actually construct and run: the bike and
// rider meshes, the chase camera, the HUD, the player map, the touch layer,
// the sky/weather rigs and a few hundred frames of the real update order.
// Only the WebGL device itself is stubbed.

import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORLD_DIR = path.resolve(HERE, '../public/world');

const dom = new JSDOM(
  '<!doctype html><html><body><div id="app"></div><div id="boot"><div id="bar"><i></i></div>' +
  '<div id="bootmsg"></div><button id="startbtn"></button></div></body></html>',
  { pretendToBeVisual: true, url: 'http://localhost:5173/' }
);

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Image = window.Image;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
window.devicePixelRatio = 1;
window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));

// canvas 2D: jsdom has no canvas module, so provide a usable fake
const ctxProto = () => {
  const noop = () => {};
  const grad = { addColorStop: noop };
  const o = {
    canvas: null,
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => null,
    measureText: (t) => ({ width: (t || '').length * 6 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w | 0) * Math.max(1, h | 0) * 4), width: w | 0, height: h | 0 }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getLineDash: () => [],
    getTransform: () => ({}),
  };
  return new Proxy(o, {
    get: (t, p) => (p in t ? t[p] : noop),
    set: (t, p, v) => ((t[p] = v), true),
  });
};
window.HTMLCanvasElement.prototype.getContext = function getContext(kind) {
  if (kind === '2d') {
    const c = ctxProto();
    c.canvas = this;
    return c;
  }
  return null;
};
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
window.HTMLElement.prototype.setPointerCapture = function () {};
window.HTMLElement.prototype.releasePointerCapture = function () {};

globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^.*world\//, '');
  const p = path.join(WORLD_DIR, rel);
  if (!fs.existsSync(p)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(p);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(buf.toString('utf8')),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? `  (${detail})` : ''}`);
  }
}
function section(t) {
  console.log(`\n── ${t}`);
}

const THREE = await import('three');
const { WorldData } = await import('../src/world/worldData.js');
const { Materials } = await import('../src/render/materials.js');
const { SkySystem, WEATHER } = await import('../src/render/sky.js');
const { RainSystem, DustSystem, LightningSystem } = await import('../src/render/weather.js');
const { ChunkManager } = await import('../src/world/chunkManager.js');
const { sampleRoadSurface } = await import('../src/world/roadBuilder.js');
const { BIKE_SPECS, BikePhysics } = await import('../src/bike/physics.js');
const { createBike } = await import('../src/bike/bikeModel.js');
const { createRider, poseRider } = await import('../src/bike/rider.js');
const { resolveCollisions } = await import('../src/bike/collision.js');
const { ChaseCamera, CAM_MODES } = await import('../src/camera/chaseCamera.js');
const { TrafficSystem } = await import('../src/ai/traffic.js');
const { PedestrianSystem } = await import('../src/ai/pedestrians.js');
const { Input } = await import('../src/core/input.js');
const { Hud } = await import('../src/ui/hud.js');
const { MapUI } = await import('../src/ui/map.js');
const { TouchControls } = await import('../src/ui/touch.js');
const { AudioEngine } = await import('../src/audio/audio.js');

section('browser objects');
const world = await new WorldData().load('world');
check('world loads under a DOM', world.ready);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.18, 6500);

// a renderer stand-in: SkySystem only needs setClearColor
const fakeRenderer = { setClearColor() {}, shadowMap: {}, info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0 } } };

let sky;
try {
  sky = new SkySystem(scene, fakeRenderer);
  check('sky system constructs', !!sky.sun && !!sky.mesh);
} catch (e) {
  check('sky system constructs', false, e.message);
}

const rain = new RainSystem(scene, 500);
const dust = new DustSystem(scene, 100);
const lightning = new LightningSystem(scene);
check('weather systems construct', !!rain.mesh && !!dust.points && !!lightning.light);

const materials = new Materials();
const quality = {
  name: 'test', pixelRatio: 1, shadows: false, shadowSize: 1024,
  nearDist: 180, midDist: 320, farDist: 480, terrainSegs: 16,
  buildBudgetMs: 1000, maxTraffic: 14, trafficRadius: 180, maxPeds: 10, pedRadius: 100,
};
const chunks = new ChunkManager(scene, world, materials, quality);
check('chunk manager constructs', !!chunks.farMesh);

let bikeView;
try {
  bikeView = createBike('maroon');
  let meshes = 0;
  bikeView.root.traverse((o) => {
    if (o.isMesh) meshes++;
  });
  check('motorcycle mesh builds', meshes > 60, `${meshes} parts`);
  const box = new THREE.Box3().setFromObject(bikeView.root);
  const size = box.getSize(new THREE.Vector3());
  check('bike is motorcycle-sized',
    size.x > 0.5 && size.x < 1.1 && size.z > 1.7 && size.z < 2.4 && size.y > 0.9 && size.y < 1.5,
    `${size.x.toFixed(2)} W x ${size.z.toFixed(2)} L x ${size.y.toFixed(2)} H m`);
  check('bike has both wheels, fork, bars and lamp',
    !!bikeView.frontWheel && !!bikeView.rearWheel && !!bikeView.steer && !!bikeView.bars && !!bikeView.beam);
} catch (e) {
  check('motorcycle mesh builds', false, e.message);
}

let rider;
try {
  rider = createRider({});
  let parts = 0;
  rider.root.traverse((o) => {
    if (o.isMesh) parts++;
  });
  bikeView.chassis.add(rider.root);
  check('rider builds and mounts', parts > 10, `${parts} parts`);
  const rb = new THREE.Box3().setFromObject(rider.root);
  const rs = rb.getSize(new THREE.Vector3());
  check('rider is person-sized', rs.y > 1.0 && rs.y < 1.75, `${rs.y.toFixed(2)} m tall seated`);
} catch (e) {
  check('rider builds and mounts', false, e.message);
}

scene.add(bikeView.root);

const bike = new BikePhysics(BIKE_SPECS.sahaja125, world);
const sp = world.meta.spawn;
bike.reset(sp.x, -sp.y, sp.heading);

const input = new Input(document.createElement('canvas'));
check('input binds without a real canvas', !!input);
const cam = new ChaseCamera(camera, world);
const traffic = new TrafficSystem(scene, world, quality);
const peds = new PedestrianSystem(scene, world, quality);
const audio = new AudioEngine(); // never started: no WebAudio in jsdom

section('ui');
let hud;
let map;
let touch;
try {
  hud = new Hud(document.body);
  check('hud builds', !!document.getElementById('speedo') && !!document.getElementById('spd'));
  hud.notify('hello', 'good');
  hud.setPrompt('<b>E</b> test');
  hud.toggleDebug();
  check('hud debug toggles', hud.debugOn);
} catch (e) {
  check('hud builds', false, e.message);
}
try {
  map = new MapUI(document.body, world);
  check('map ui builds', !!document.getElementById('mapcanvas'));
  map.show({ x: sp.x, z: -sp.y });
  map.update({ x: sp.x, z: -sp.y }, 0.4);
  check('map renders without throwing', true);
  const fuel = world.pois.find((p) => p.cat === 'amenity:fuel');
  const route = map._route({ x: sp.x, z: -sp.y }, fuel);
  check('map routes over the road graph', route && route.len > 100,
    route ? `${(route.len / 1000).toFixed(2)} km to ${fuel.name || 'fuel'}` : 'no route');
  map.hide();
} catch (e) {
  check('map ui builds', false, `${e.message}`);
}
try {
  touch = new TouchControls(document.body, input, {
    camera() {}, horn() {}, map() {}, reset() {}, photo() {},
  });
  touch.setVisible(true);
  const btn = document.getElementById('tThrottle');
  btn.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  check('touch controls build and fire', input.touch.throttle === 1,
    `throttle=${input.touch.throttle}`);
  btn.dispatchEvent(new window.Event('pointerup', { bubbles: true }));
  check('touch release clears input', input.touch.throttle === 0);
} catch (e) {
  check('touch controls build and fire', false, e.message);
}

section("frame loop (600 frames, real update order)");
let frames = 0;
let err = null;
const dt = 1 / 60;
try {
  for (let i = 0; i < 600; i++) {
    input.update(dt, false);
    // ride forward with a gentle turn so every system sees motion
    const fakeInput = { throttle: 0.7, brake: 0, steer: Math.sin(i / 80) * 0.4, hardBrake: false };
    const fx = Math.sin(bike.heading);
    const fz = Math.cos(bike.heading);
    const hw = bike.spec.wheelbase * 0.5;
    const mid = sampleRoadSurface(world, bike.pos.x, bike.pos.z);
    const f = sampleRoadSurface(world, bike.pos.x + fx * hw, bike.pos.z + fz * hw);
    const r = sampleRoadSurface(world, bike.pos.x - fx * hw, bike.pos.z - fz * hw);
    bike.step(dt, fakeInput, {
      name: mid.name, grip: mid.grip, roughness: mid.roughness,
      frontOffset: f.y - world.heightAt(bike.pos.x + fx * hw, bike.pos.z + fz * hw),
      rearOffset: r.y - world.heightAt(bike.pos.x - fx * hw, bike.pos.z - fz * hw),
    });
    resolveCollisions(bike, world, dt);
    chunks.update(bike.pos.x, bike.pos.z, dt);
    sky.update(dt, bike.pos);
    materials.setWetness(sky.wetness);
    traffic.update(dt, bike, null);
    peds.update(dt, bike, sky.hour);

    bikeView.root.position.set(bike.pos.x, bike.pos.y, bike.pos.z);
    bikeView.root.rotation.set(0, bike.heading, 0);
    bikeView.chassis.rotation.set(bike.pitch, 0, -bike.lean);
    bikeView.steer.rotation.y = -bike.steer * 0.85;
    poseRider(rider, bike, bikeView, dt);
    cam.update(dt, bike, bikeView, input);
    rain.update(dt, camera.position, sky.wetness, Math.abs(bike.speed));
    dust.update(dt, camera.position, 0.3);
    lightning.update(dt, sky.wetness, () => {});
    hud.update({
      speedKmh: bike.speedKmh, gear: bike.gear, rpm: bike.rpm, redline: bike.spec.redline,
      fuel: bike.fuel, fuelCap: bike.spec.fuelCapacity, hour: sky.hour,
      weather: WEATHER[sky.weather].name, phase: sky.phaseName,
      placeName: 'Darsi', placeSub: 'Prakasam', debug: 'x',
    });
    if (i % 2 === 0) map.drawMini(hud.mmctx, hud.mm.width, { x: bike.pos.x, z: bike.pos.z }, bike.heading);
    input.endFrame();
    frames++;
    if (i === 120) sky.setWeather('rain');
    if (i === 200) cam.cycle();
    if (i === 260) cam.enterPhoto(bike);
    if (i === 320) cam.exitPhoto();
  }
} catch (e) {
  err = e;
}
check("600 frames run without throwing", err === null, err ? `${err.message} @frame ${frames}` : `${frames} frames`);
check('camera position is finite',
  [camera.position.x, camera.position.y, camera.position.z].every(Number.isFinite),
  `${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}`);
check('camera is above the ground',
  camera.position.y > world.heightAt(camera.position.x, camera.position.z) - 0.1,
  `cam y ${camera.position.y.toFixed(2)} vs ground ${world.heightAt(camera.position.x, camera.position.z).toFixed(2)}`);
check('camera stays near the rider',
  camera.position.distanceTo(new THREE.Vector3(bike.pos.x, bike.pos.y, bike.pos.z)) < 20,
  `${camera.position.distanceTo(new THREE.Vector3(bike.pos.x, bike.pos.y, bike.pos.z)).toFixed(1)} m behind`);
check('all four camera modes exist', CAM_MODES.length === 4, CAM_MODES.join(', '));
check('bike actually travelled', bike.odometer > 50, `${bike.odometer.toFixed(0)} m`);
check('rain became visible in the rain', rain.mesh.visible, `intensity ${rain.intensity.toFixed(2)}`);
check('wet weather darkens the road materials', materials.get('road|asphalt|1.00').color.r < 0.95,
  `r=${materials.get('road|asphalt|1.00').color.r.toFixed(2)}`);
check('scene is populated', scene.children.length > 5, `${scene.children.length} top-level objects`);

section('audio graph');
check('audio engine constructs without WebAudio', audio.enabled === false);

console.log(`\n${'─'.repeat(52)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
process.exit(0);
