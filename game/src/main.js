// Darsi — entry point.
//
// Boot sequence: load the surveyed world data -> build the scene -> stream the
// first chunks -> hand control to the player.

import * as THREE from 'three';

import { WorldData } from './world/worldData.js';
import { Input } from './core/input.js';
import { clamp, clamp01, lerp, damp, fmtDistance, fmtClock, isTouchDevice } from './core/util.js';
import { createRenderer, detectQuality, PerfMonitor, QUALITY } from './render/renderer.js';
import { Materials } from './render/materials.js';
import { SkySystem, WEATHER } from './render/sky.js';
import { RainSystem, DustSystem, LightningSystem } from './render/weather.js';
import { ChunkManager } from './world/chunkManager.js';
import { sampleRoadSurface } from './world/roadBuilder.js';
import { BIKE_SPECS, BikePhysics } from './bike/physics.js';
import { createBike } from './bike/bikeModel.js';
import { createRider, poseRider } from './bike/rider.js';
import { resolveCollisions } from './bike/collision.js';
import { ChaseCamera } from './camera/chaseCamera.js';
import { TrafficSystem } from './ai/traffic.js';
import { PedestrianSystem } from './ai/pedestrians.js';
import { AudioEngine } from './audio/audio.js';
import { Hud } from './ui/hud.js';
import { MapUI } from './ui/map.js';
import { TouchControls } from './ui/touch.js';

const boot = document.getElementById('boot');
const bar = document.querySelector('#bar > i');
const bootmsg = document.getElementById('bootmsg');
const startbtn = document.getElementById('startbtn');
const app = document.getElementById('app');

function progress(p, msg) {
  bar.style.width = `${Math.round(p * 100)}%`;
  if (msg) bootmsg.textContent = msg;
}

function fail(err) {
  console.error(err);
  bootmsg.className = 'err';
  bootmsg.textContent = `${err.message || err}\n\n${(err.stack || '').split('\n').slice(0, 4).join('\n')}`;
  startbtn.style.display = 'none';
}

class Game {
  constructor(world, quality) {
    this.world = world;
    this.quality = quality;

    // ---------------- scene -------------------------------------------
    this.renderer = createRenderer(app, quality);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.18, 6500);
    this.perf = new PerfMonitor(this.renderer, quality);

    this.materials = new Materials();
    this.sky = new SkySystem(this.scene, this.renderer);
    this.rain = new RainSystem(this.scene, quality.name === 'low' ? 1800 : 4200);
    this.dust = new DustSystem(this.scene, quality.name === 'low' ? 220 : 500);
    this.lightning = new LightningSystem(this.scene);
    this.chunks = new ChunkManager(this.scene, world, this.materials, quality);

    // ---------------- bike --------------------------------------------
    this.bike = new BikePhysics(BIKE_SPECS.sahaja125, world);
    this.bikeView = createBike('maroon');
    this.rider = createRider({ shirt: 0x3f5f80, helmet: 0xe2ddd0 });
    this.bikeView.chassis.add(this.rider.root);
    this.scene.add(this.bikeView.root);

    const sp = world.meta.spawn;
    this.spawn = { x: sp.x, z: -sp.y, heading: sp.heading };
    this.resetBike();

    // ---------------- systems -----------------------------------------
    this.input = new Input(this.renderer.domElement);
    this.cam = new ChaseCamera(this.camera, world);
    this.traffic = new TrafficSystem(this.scene, world, quality);
    this.peds = new PedestrianSystem(this.scene, world, quality);
    this.audio = new AudioEngine();

    this.hud = new Hud(document.body);
    this.map = new MapUI(document.body, world);
    this.touch = new TouchControls(document.body, this.input, {
      camera: () => this.cycleCamera(),
      horn: () => this.audio.horn('player'),
      map: () => this.toggleMap(),
      reset: () => this.resetBike(true),
      photo: () => this.togglePhoto(),
    });
    this.touch.setVisible(isTouchDevice());

    // pooled street lighting
    this.lamps = [];
    for (let i = 0; i < (quality.name === 'low' ? 0 : 4); i++) {
      const l = new THREE.PointLight(0xffd79a, 0, 22, 1.8);
      l.visible = false;
      this.scene.add(l);
      this.lamps.push(l);
    }

    this.paused = false;
    this.photoMode = false;
    this.nearPoi = null;
    this.visited = new Set();
    this.lastTime = performance.now();
    this.accum = 0;
    this.frame = 0;
    this.distanceRidden = 0;
    this.sessionStart = performance.now();

    window.addEventListener('resize', () => this.onResize());
    this.onResize();

    this.map.onDestination = (p) => {
      this.hud.notify(`Route set: ${p.name || p.cat.split(':')[1]}`, 'good');
    };

    // expose for the automated drive test / debugging
    window.DARSI = this;
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  resetBike(notify = false) {
    const w = this.world;
    // snap to the nearest road so a reset never drops you into a wall
    const near = w.nearestRoad(this.bike?.pos?.x ?? this.spawn.x, this.bike?.pos?.z ?? this.spawn.z, 60);
    let x = this.spawn.x;
    let z = this.spawn.z;
    let heading = this.spawn.heading;
    if (notify && near) {
      x = near.px;
      z = near.pz;
      heading = Math.atan2(near.dirX, near.dirZ);
    }
    this.bike.reset(x, z, heading);
    const surf = sampleRoadSurface(w, x, z);
    this.bike.pos.y = surf.y;
    if (notify) {
      this.hud?.notify('Bike reset', 'good');
      this.cam._initialised = false;
    }
  }

  cycleCamera() {
    const name = this.cam.cycle();
    this.hud.notify(`Camera: ${name}`);
    this.audio.blip(520, 0.06, 0.08);
  }

  toggleMap() {
    const open = this.map.toggle({ x: this.bike.pos.x, z: this.bike.pos.z });
    this.audio.blip(open ? 740 : 460, 0.07, 0.09);
  }

  togglePhoto() {
    this.photoMode = !this.photoMode;
    this.hud.setPhoto(this.photoMode);
    if (this.photoMode) this.cam.enterPhoto(this.bike);
    else this.cam.exitPhoto();
  }

  savePhoto() {
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    const t = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `darsi-${t}.png`;
    a.click();
    this.hud.notify('Photo saved', 'good');
    this.audio.blip(980, 0.09, 0.1);
  }

  // ------------------------------------------------------------------ loop

  start() {
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      const now = performance.now();
      let dt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      dt = Math.min(dt, 0.1);
      try {
        this.update(dt);
      } catch (e) {
        cancelAnimationFrame(this.raf);
        fail(e);
        boot.style.display = 'flex';
        throw e;
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  update(dt) {
    this.frame++;
    const input = this.input;
    input.update(dt, this.paused || this.map.open);

    // ---------------- actions -----------------------------------------
    if (input.pressed('pause')) {
      this.paused = !this.paused;
      this.hud.notify(this.paused ? 'Paused' : 'Resumed');
    }
    if (input.pressed('map')) this.toggleMap();
    if (input.pressed('camera')) this.cycleCamera();
    if (input.pressed('photo')) this.togglePhoto();
    if (input.pressed('reset')) this.resetBike(true);
    if (input.pressed('debug')) this.hud.toggleDebug();
    if (input.pressed('lights')) {
      this.headlight = !this.headlight;
      this.hud.notify(`Headlight ${this.headlight ? 'on' : 'off'}`);
    }
    if (input.pressed('timeSkip')) {
      this.sky.setHour(this.sky.hour + 3);
      this.hud.notify(`Time: ${fmtClock(this.sky.hour)}`);
    }
    if (input.pressed('gearToggle')) {
      const w = this.sky.cycleWeather();
      this.hud.notify(`Weather: ${WEATHER[w].name}`);
    }
    if (input.horn && !this._hornHeld) this.audio.horn('player');
    this._hornHeld = input.horn;
    if (input.pressed('interact')) this.interact();

    const active = !this.paused && !this.map.open;

    // ---------------- physics ------------------------------------------
    if (active && !this.photoMode) {
      const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const surf = this.surfaceUnderBike();
        this.bike.step(h, input, surf);
        const col = resolveCollisions(this.bike, this.world, h);
        if (col && col.impact > 4 && this.frame % 2 === 0) {
          this.cam.addShake(clamp01(col.impact / 14) * 0.8);
          this.audio.bump(clamp01(col.impact / 12));
        }
      }
      this.distanceRidden = this.bike.odometer;
    }

    // ---------------- world --------------------------------------------
    const p = this.bike.pos;
    this.chunkStats = this.chunks.update(p.x, p.z, dt);
    this.sky.update(active ? dt : 0, p);
    this.materials.setWetness(this.sky.wetness);
    this.traffic.update(active ? dt : 0, this.bike, this.camera);
    this.peds.update(active ? dt : 0, this.bike, this.sky.hour);

    for (const ev of this.traffic.events) {
      if (ev.type === 'horn') {
        const d = Math.hypot(ev.x - p.x, ev.z - p.z);
        if (d < 55) this.audio.horn(ev.vehicle, d);
      }
    }

    // ---------------- view ---------------------------------------------
    this.syncBikeMesh(dt);
    poseRider(this.rider, this.bike, this.bikeView, dt);
    this.cam.update(dt, this.bike, this.bikeView, input);
    this.updateLighting(dt);
    this.rain.update(dt, this.camera.position, this.sky.wetness, Math.abs(this.bike.speed));
    this.dust.update(dt, this.camera.position,
      this.sky.wetness < 0.1 ? clamp01(0.25 + this.world.urbanAt(p.x, p.z) * 0.4) * (this.sky.hour > 7 && this.sky.hour < 18 ? 1 : 0.3) : 0);
    this.lightning.update(dt, this.sky.wetness, () => this.thunder());

    // ---------------- ui -----------------------------------------------
    this.updateInteractPrompt();
    this.updateHud(dt);
    if (this.map.open) this.map.update({ x: p.x, z: p.z }, this.bike.heading);
    if (this.frame % 2 === 0 && !this.photoMode) {
      this.map.drawMini(this.hud.mmctx, this.hud.mm.width, { x: p.x, z: p.z }, this.bike.heading);
    }

    this.audio.update(dt, this.bike, {
      hour: this.sky.hour,
      rain: this.sky.wetness,
      urban: this.world.urbanAt(p.x, p.z),
      crowd: clamp01(this.peds.people.length / 12),
    });

    this.perf.tick(dt);
    this.renderer.render(this.scene, this.camera);
    input.endFrame();
  }

  thunder() {
    const a = this.audio;
    if (!a.ctx) return;
    const ctx = a.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = a.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(240, t);
    f.frequency.exponentialRampToValueAtTime(70, t + 1.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    src.connect(f);
    f.connect(g);
    g.connect(a.master);
    src.start(t);
    src.stop(t + 2.5);
  }

  surfaceUnderBike() {
    const b = this.bike;
    const fx = Math.sin(b.heading);
    const fz = Math.cos(b.heading);
    const hw = b.spec.wheelbase * 0.5;
    const f = sampleRoadSurface(this.world, b.pos.x + fx * hw, b.pos.z + fz * hw);
    const r = sampleRoadSurface(this.world, b.pos.x - fx * hw, b.pos.z - fz * hw);
    const mid = sampleRoadSurface(this.world, b.pos.x, b.pos.z);
    const wet = this.sky.wetness;
    return {
      name: mid.name,
      grip: mid.grip * lerp(1, 0.78, wet),
      roughness: mid.roughness,
      frontOffset: f.y - this.world.heightAt(b.pos.x + fx * hw, b.pos.z + fz * hw),
      rearOffset: r.y - this.world.heightAt(b.pos.x - fx * hw, b.pos.z - fz * hw),
    };
  }

  syncBikeMesh(dt) {
    const b = this.bike;
    const v = this.bikeView;
    v.root.position.set(b.pos.x, b.pos.y, b.pos.z);
    v.root.rotation.set(0, b.heading, 0);
    // lean about the roll axis, pitch with the slope and suspension
    v.chassis.rotation.set(b.pitch, 0, -b.lean + b.roll * 0.35);
    v.chassis.position.y = -b.susR * 0.5;
    v.steer.rotation.y = -b.steer * 0.85;
    v.frontWheel.rotation.x = b.wheelSpinF;
    v.rearWheel.rotation.x = b.wheelSpinR;
    v.frontSus.position.y = -b.susF * 0.55;
    const squat = b.susR * 0.6;
    v.rearAssembly.rotation.x = squat * 0.6;
    v.shockL.scale.y = 1 - b.susR * 1.4;
    v.shockR.scale.y = 1 - b.susR * 1.4;

    // lights
    const night = this.sky.streetlightsOn;
    const on = this.headlight === undefined ? night : this.headlight;
    v.beam.intensity = on ? (night ? 3.2 : 1.1) : 0;
    v.lamp.material.emissive = v.lamp.material.emissive || new THREE.Color();
    v.lamp.material.emissive.setScalar(on ? 0.95 : 0);
    const braking = b.brakeInput > 0.05;
    v.tailLight.material.emissive = v.tailLight.material.emissive || new THREE.Color();
    v.tailLight.material.emissive.setRGB(braking ? 1 : (on ? 0.35 : 0), 0, 0);
  }

  updateLighting(dt) {
    if (!this.lamps.length) return;
    const on = this.sky.streetlightsOn;
    const p = this.camera.position;
    if (!on) {
      for (const l of this.lamps) l.visible = false;
      return;
    }
    // pick the nearest known streetlight positions
    const all = this.chunks.streetLights;
    if (all.length > 4000) all.splice(0, all.length - 2000);
    const picked = [];
    for (const s of all) {
      const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
      if (d > 2500) continue;
      picked.push([d, s]);
    }
    picked.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < this.lamps.length; i++) {
      const l = this.lamps[i];
      if (i < picked.length) {
        const s = picked[i][1];
        l.position.set(s.x, s.y, s.z);
        l.visible = true;
        l.intensity = 9;
      } else {
        l.visible = false;
      }
    }
  }

  updateInteractPrompt() {
    const p = this.bike.pos;
    let best = null;
    for (const poi of this.world.pois) {
      const d = Math.hypot(poi.wx - p.x, poi.wz - p.z);
      if (d < 16 && (!best || d < best.d)) best = { poi, d };
    }
    this.nearPoi = best ? best.poi : null;
    if (best) {
      const label = best.poi.name || best.poi.cat.split(':')[1].replace(/_/g, ' ');
      const verb = best.poi.cat === 'amenity:fuel' ? 'refuel at' : 'look at';
      this.hud.setPrompt(`<b>E</b> ${verb} <b style="background:none;color:#f0e6d2">${label}</b>`);
    } else {
      this.hud.setPrompt(null);
    }
  }

  interact() {
    const poi = this.nearPoi;
    if (!poi) {
      this.hud.notify('Nothing here');
      return;
    }
    const name = poi.name || poi.cat.split(':')[1].replace(/_/g, ' ');
    if (poi.cat === 'amenity:fuel') {
      if (Math.abs(this.bike.speed) > 1.5) {
        this.hud.notify('Stop first', 'warn');
        return;
      }
      const need = this.bike.spec.fuelCapacity - this.bike.fuel;
      this.bike.fuel = this.bike.spec.fuelCapacity;
      this.hud.notify(`Filled ${need.toFixed(1)} L — ₹${Math.round(need * 103)}`, 'good');
      this.audio.blip(880, 0.12, 0.1);
      return;
    }
    if (!this.visited.has(poi.id)) {
      this.visited.add(poi.id);
      this.hud.notify(`Discovered: ${name}`, 'good');
      this.audio.blip(700, 0.1, 0.1);
    } else {
      this.hud.notify(name);
    }
  }

  placeName() {
    const p = this.bike.pos;
    let best = null;
    for (const poi of this.world.pois) {
      if (!poi.cat.startsWith('place:')) continue;
      const d = Math.hypot(poi.wx - p.x, poi.wz - p.z);
      if (!best || d < best.d) best = { poi, d };
    }
    const road = this.world.nearestRoad(p.x, p.z, 45);
    const roadName = road && road.edge.name ? road.edge.name : '';
    if (best && best.d < 1400) {
      return [best.poi.name, roadName || `${best.poi.cat.split(':')[1]} · Prakasam`];
    }
    return ['Darsi Mandal', roadName || 'Prakasam · Andhra Pradesh'];
  }

  updateHud(dt) {
    const b = this.bike;
    this._placeTimer = (this._placeTimer || 0) - dt;
    if (this._placeTimer <= 0) {
      this._placeTimer = 0.6;
      const [n, s] = this.placeName();
      this._place = [n, s];
    }
    const surf = b.surface;
    this.hud.update({
      speedKmh: b.speedKmh,
      gear: b.gear,
      rpm: b.rpm,
      redline: b.spec.redline,
      fuel: b.fuel,
      fuelCap: b.spec.fuelCapacity,
      hour: this.sky.hour,
      weather: WEATHER[this.sky.weather].name,
      phase: this.sky.phaseName,
      placeName: this._place ? this._place[0] : 'Darsi',
      placeSub: this._place ? this._place[1] : '',
      debug: this.debugText(),
    });
  }

  debugText() {
    const b = this.bike;
    const p = b.pos;
    const c = this.chunkStats || {};
    const info = this.renderer.info;
    return [
      `fps      ${this.perf.fps.toFixed(0)}  res x${this.perf.scale.toFixed(2)}  ${this.quality.name}`,
      `pos      ${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}`,
      `speed    ${b.speedKmh.toFixed(1)} km/h  gear ${b.gear}  ${b.rpm.toFixed(0)} rpm`,
      `lean     ${(b.lean * 57.3).toFixed(1)}°  steer ${(b.steer * 57.3).toFixed(1)}°  slip ${b.gripLoss.toFixed(2)}`,
      `surface  ${b.surface}  grip ${b.surfaceGrip.toFixed(2)}  rough ${b.roughness.toFixed(2)}`,
      `terrain  ${this.world.heightAt(p.x, p.z).toFixed(1)} m  urban ${this.world.urbanAt(p.x, p.z).toFixed(2)}`,
      `chunks   ${c.active || 0} active / ${c.queued || 0} queued`,
      `draws    ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k  geo ${info.memory.geometries}`,
      `traffic  ${this.traffic.agents.length}  peds ${this.peds.people.length}`,
      `clock    ${fmtClock(this.sky.hour)}  ${this.sky.weather}  wet ${this.sky.wetness.toFixed(2)}`,
      `odo      ${fmtDistance(b.odometer)}  fuel ${b.fuel.toFixed(2)} L`,
    ].join('\n');
  }
}

// ---------------------------------------------------------------- bootstrap

(async function main() {
  try {
    progress(0.02, 'checking device');
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) throw new Error('WebGL is not available in this browser.');

    const quality = detectQuality();
    progress(0.05, `survey data · ${quality.name} detail`);

    const world = await new WorldData().load('world', (p, msg) => progress(0.05 + p * 0.7, msg));

    progress(0.78, 'building Darsi');
    const game = new Game(world, quality);

    // pre-build the chunks around the spawn so the first frame is complete
    await new Promise((res) => setTimeout(res, 0));
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) {
      const st = game.chunks.update(game.bike.pos.x, game.bike.pos.z, 0.016);
      progress(0.78 + Math.min(0.18, i / 60 * 0.18), `building Darsi · ${st.active} chunks`);
      if (st.queued === 0) break;
      if (performance.now() - t0 > 7000) break;
      await new Promise((res) => setTimeout(res, 0));
    }

    game.renderer.compile(game.scene, game.camera);
    progress(1, 'ready');

    startbtn.style.display = 'inline-block';
    startbtn.textContent = 'RIDE';
    const go = () => {
      startbtn.removeEventListener('click', go);
      game.audio.start();
      boot.style.opacity = '0';
      boot.style.transition = 'opacity .5s';
      setTimeout(() => {
        boot.style.display = 'none';
      }, 520);
      game.start();
      game.hud.notify('W throttle · A/D steer · S brake', 'good');
      const shot = document.getElementById('shotbtn');
      const exitp = document.getElementById('exitphoto');
      if (shot) shot.onclick = () => game.savePhoto();
      if (exitp) exitp.onclick = () => game.togglePhoto();
    };
    startbtn.addEventListener('click', go);

    // also allow Enter / tap anywhere
    window.addEventListener('keydown', function once(e) {
      if (e.code === 'Enter' || e.code === 'Space') {
        window.removeEventListener('keydown', once);
        go();
      }
    });
  } catch (e) {
    fail(e);
  }
})();
