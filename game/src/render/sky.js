// Sky dome, sun/moon, fog and the time-of-day + weather lighting model.
//
// The palette is tuned for the Deccan plateau in Prakasam district: hard white
// midday light, heavy dust haze, a long warm evening and short dusk.

import * as THREE from 'three';
import { clamp, clamp01, lerp, smoothstep } from '../core/util.js';

const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vWorld = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunSize;
uniform float uHaze;
uniform float uStars;
uniform float uCloud;
uniform vec3 uCloudColor;
uniform float uTime;
varying vec3 vWorld;

float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<5;i++){ v += a*noise(p); p*=2.07; a*=0.5; }
  return v;
}

void main() {
  vec3 dir = normalize(vWorld);
  float h = dir.y;
  float t = clamp(h * 1.25 + 0.08, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(t, 0.62));
  if (h < 0.0) col = mix(uHorizon, uGround, clamp(-h * 3.0, 0.0, 1.0));

  // dust haze thickens near the horizon
  float haze = exp(-max(h, -0.05) * 7.0) * uHaze;
  col = mix(col, uHorizon * 1.06, clamp(haze, 0.0, 0.85));

  // sun disc + glow
  float sd = max(dot(dir, uSunDir), 0.0);
  float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.35, sd);
  float glow = pow(sd, 90.0) * 0.5 + pow(sd, 10.0) * 0.22 + pow(sd, 3.0) * 0.08;
  col += uSunColor * (disc * 2.6 + glow);

  // stars
  if (uStars > 0.01 && h > -0.02) {
    vec2 sp = dir.xz / max(abs(dir.y) + 0.22, 0.12);
    float s = hash(floor(sp * 190.0));
    float tw = 0.6 + 0.4 * sin(uTime * 2.2 + s * 60.0);
    float star = smoothstep(0.9965, 0.9995, s) * tw;
    col += vec3(star) * uStars * clamp(h * 3.0, 0.0, 1.0);
  }

  // clouds
  if (uCloud > 0.01 && h > 0.0) {
    vec2 cp = dir.xz / max(h, 0.055) * 0.55 + vec2(uTime * 0.004, uTime * 0.0021);
    float c = fbm(cp * 1.1);
    float cover = smoothstep(0.62 - uCloud * 0.42, 0.95 - uCloud * 0.30, c);
    cover *= smoothstep(0.0, 0.16, h);
    float shade = fbm(cp * 2.3) * 0.5 + 0.5;
    col = mix(col, uCloudColor * (0.72 + 0.46 * shade), cover * clamp(uCloud * 1.25, 0.0, 0.95));
  }

  gl_FragColor = vec4(col, 1.0);
}`;

// Key-frames across the day. [hour, zenith, horizon, sunColor, sunIntensity, ambient, fogColor, fogDensity, haze]
const KEYS = [
  { h: 0.0,  zen: 0x04070f, hor: 0x0a1020, sun: 0x3b4a74, int: 0.07, amb: 0x1a2236, ai: 0.22, fog: 0x0b1122, fd: 0.0019, haze: 0.5, stars: 1.0 },
  { h: 5.0,  zen: 0x0a1226, hor: 0x241f33, sun: 0x5a4a66, int: 0.10, amb: 0x252a42, ai: 0.28, fog: 0x1b1a2c, fd: 0.0024, haze: 0.7, stars: 0.75 },
  { h: 6.2,  zen: 0x2b4470, hor: 0xc08a5e, sun: 0xff9a52, int: 0.55, amb: 0x5a5366, ai: 0.42, fog: 0xa38468, fd: 0.0030, haze: 0.95, stars: 0.12 },
  { h: 7.4,  zen: 0x4e7cb4, hor: 0xd9b48a, sun: 0xffc98a, int: 1.15, amb: 0x8a8d94, ai: 0.52, fog: 0xc4b094, fd: 0.0021, haze: 0.8, stars: 0.0 },
  { h: 9.5,  zen: 0x5b92cf, hor: 0xcfd3c6, sun: 0xfff0d2, int: 1.6, amb: 0x9fa6a8, ai: 0.6, fog: 0xcbcbb8, fd: 0.0014, haze: 0.6, stars: 0.0 },
  { h: 12.5, zen: 0x5d94d8, hor: 0xd6d8c8, sun: 0xfffaf0, int: 1.85, amb: 0xa8aeaa, ai: 0.66, fog: 0xd2d2c0, fd: 0.0012, haze: 0.55, stars: 0.0 },
  { h: 15.5, zen: 0x5a8ecd, hor: 0xd7cfb4, sun: 0xfff2d8, int: 1.62, amb: 0xa5a69c, ai: 0.62, fog: 0xd0c8ae, fd: 0.0014, haze: 0.62, stars: 0.0 },
  { h: 17.4, zen: 0x4b79b4, hor: 0xe0b183, sun: 0xffd199, int: 1.15, amb: 0x938d82, ai: 0.54, fog: 0xd2ae84, fd: 0.0018, haze: 0.78, stars: 0.0 },
  { h: 18.4, zen: 0x37527f, hor: 0xe8975a, sun: 0xff8c42, int: 0.70, amb: 0x6e6670, ai: 0.44, fog: 0xc98a58, fd: 0.0026, haze: 0.98, stars: 0.05 },
  { h: 19.1, zen: 0x1d2a4b, hor: 0x8c5a4e, sun: 0xd1603a, int: 0.26, amb: 0x3f4158, ai: 0.32, fog: 0x6b4a46, fd: 0.0030, haze: 0.85, stars: 0.4 },
  { h: 20.2, zen: 0x080d1d, hor: 0x1b1c30, sun: 0x4a4a70, int: 0.09, amb: 0x1f2740, ai: 0.24, fog: 0x14182a, fd: 0.0022, haze: 0.6, stars: 0.95 },
  { h: 24.0, zen: 0x04070f, hor: 0x0a1020, sun: 0x3b4a74, int: 0.07, amb: 0x1a2236, ai: 0.22, fog: 0x0b1122, fd: 0.0019, haze: 0.5, stars: 1.0 },
];

function lerpColor(a, b, t) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return ca.lerp(cb, t);
}

function sampleKeys(hour) {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= hour) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = clamp01((hour - a.h) / Math.max(1e-6, b.h - a.h));
  const s = smoothstep(t);
  return {
    zen: lerpColor(a.zen, b.zen, s),
    hor: lerpColor(a.hor, b.hor, s),
    sun: lerpColor(a.sun, b.sun, s),
    int: lerp(a.int, b.int, s),
    amb: lerpColor(a.amb, b.amb, s),
    ai: lerp(a.ai, b.ai, s),
    fog: lerpColor(a.fog, b.fog, s),
    fd: lerp(a.fd, b.fd, s),
    haze: lerp(a.haze, b.haze, s),
    stars: lerp(a.stars, b.stars, s),
  };
}

export const WEATHER = {
  clear: { cloud: 0.12, fogMul: 1.0, lightMul: 1.0, wet: 0, name: 'Clear' },
  hazy: { cloud: 0.26, fogMul: 1.6, lightMul: 0.9, wet: 0, name: 'Hazy' },
  cloudy: { cloud: 0.6, fogMul: 1.25, lightMul: 0.74, wet: 0, name: 'Cloudy' },
  overcast: { cloud: 0.92, fogMul: 1.5, lightMul: 0.52, wet: 0.15, name: 'Overcast' },
  rain: { cloud: 1.0, fogMul: 2.3, lightMul: 0.4, wet: 1.0, name: 'Rain' },
};

export class SkySystem {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.hour = 8.5;
    this.timeScale = 60; // game seconds per real second
    this.paused = false;
    this.weather = 'clear';
    this.weatherBlend = { cloud: 0.12, fogMul: 1, lightMul: 1, wet: 0 };
    this.wetness = 0;

    this.uniforms = {
      uZenith: { value: new THREE.Color(0x5d94d8) },
      uHorizon: { value: new THREE.Color(0xd6d8c8) },
      uGround: { value: new THREE.Color(0x6d6350) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0xfff6e0) },
      uSunSize: { value: 0.006 },
      uHaze: { value: 0.55 },
      uStars: { value: 0 },
      uCloud: { value: 0.12 },
      uCloudColor: { value: new THREE.Color(0xf2ece0) },
      uTime: { value: 0 },
    };

    const geo = new THREE.SphereGeometry(1, 48, 32);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.scale.setScalar(6000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.castShadow = true;
    const sc = this.sun.shadow;
    sc.mapSize.set(2048, 2048);
    sc.camera.near = 1;
    sc.camera.far = 420;
    sc.camera.left = -110;
    sc.camera.right = 110;
    sc.camera.top = 110;
    sc.camera.bottom = -110;
    sc.bias = -0.0008;
    sc.normalBias = 0.5;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xa9c2e0, 0x6b5a42, 0.6);
    scene.add(this.hemi);

    this.fog = new THREE.FogExp2(0xd2d2c0, 0.0012);
    scene.fog = this.fog;

    this.sunDir = new THREE.Vector3();
    this.isNight = false;
  }

  setWeather(name) {
    if (WEATHER[name]) this.weather = name;
  }

  cycleWeather() {
    const keys = Object.keys(WEATHER);
    const i = keys.indexOf(this.weather);
    this.setWeather(keys[(i + 1) % keys.length]);
    return this.weather;
  }

  setHour(h) {
    this.hour = ((h % 24) + 24) % 24;
  }

  update(dt, focus) {
    if (!this.paused) this.hour = (this.hour + (dt * this.timeScale) / 3600) % 24;
    const k = sampleKeys(this.hour);

    const w = WEATHER[this.weather];
    const b = this.weatherBlend;
    const kk = 1 - Math.exp(-dt * 0.8);
    b.cloud += (w.cloud - b.cloud) * kk;
    b.fogMul += (w.fogMul - b.fogMul) * kk;
    b.lightMul += (w.lightMul - b.lightMul) * kk;
    b.wet += (w.wet - b.wet) * (1 - Math.exp(-dt * 0.25));
    this.wetness = b.wet;

    // Sun path: Darsi is at 15.77 N, so the sun passes nearly overhead.
    const dayT = (this.hour - 6) / 12; // 0 at sunrise, 1 at sunset
    const elev = Math.sin(dayT * Math.PI) * 1.32 - 0.06;
    const azim = -Math.PI * 0.5 + dayT * Math.PI * 1.04;
    const ce = Math.cos(clamp(elev, -1.4, 1.4));
    this.sunDir.set(Math.cos(azim) * ce, Math.sin(clamp(elev, -1.4, 1.4)), Math.sin(azim) * ce).normalize();
    this.isNight = this.sunDir.y < 0.02;

    // At night let the moon provide the key light from the opposite side.
    const lightDir = this.sunDir.y > 0.02 ? this.sunDir : this.sunDir.clone().multiplyScalar(-1).setY(Math.abs(this.sunDir.y) * 0.6 + 0.3).normalize();

    this.uniforms.uZenith.value.copy(k.zen);
    this.uniforms.uHorizon.value.copy(k.hor);
    this.uniforms.uSunColor.value.copy(k.sun);
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uHaze.value = k.haze * lerp(1, 1.3, b.cloud);
    this.uniforms.uStars.value = k.stars * (1 - b.cloud * 0.9);
    this.uniforms.uCloud.value = b.cloud;
    this.uniforms.uCloudColor.value.copy(k.hor).lerp(new THREE.Color(0xffffff), 0.35).multiplyScalar(lerp(1, 0.55, b.cloud));
    this.uniforms.uTime.value += dt;

    this.sun.color.copy(k.sun);
    this.sun.intensity = Math.max(0.03, k.int * b.lightMul);
    this.hemi.color.copy(k.zen).lerp(new THREE.Color(0xffffff), 0.35);
    this.hemi.groundColor.copy(new THREE.Color(0x7a6448));
    this.hemi.intensity = k.ai * lerp(1, 1.5, b.cloud) * lerp(1, 0.85, b.wet);

    this.fog.color.copy(k.fog).lerp(this.uniforms.uCloudColor.value, b.cloud * 0.4);
    this.fog.density = k.fd * b.fogMul;
    this.renderer.setClearColor(this.fog.color);

    if (focus) {
      this.mesh.position.set(focus.x, 0, focus.z);
      const d = 150;
      this.sun.position.set(focus.x + lightDir.x * d, focus.y + lightDir.y * d + 30, focus.z + lightDir.z * d);
      this.sun.target.position.set(focus.x, focus.y, focus.z);
      this.sun.target.updateMatrixWorld();
    }
  }

  get streetlightsOn() {
    return this.hour < 6.4 || this.hour > 18.2;
  }

  get phaseName() {
    const h = this.hour;
    if (h < 4.5) return 'Night';
    if (h < 6.2) return 'Dawn';
    if (h < 9) return 'Morning';
    if (h < 12) return 'Late morning';
    if (h < 15) return 'Midday';
    if (h < 17.2) return 'Afternoon';
    if (h < 18.6) return 'Sunset';
    if (h < 20) return 'Dusk';
    return 'Night';
  }
}
