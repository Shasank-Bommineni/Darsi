// Visible weather: rain streaks, wind-driven dust haze, puddle wetness and
// the occasional lightning flash. Weather is never only a UI label.

import * as THREE from 'three';
import { clamp01, lerp } from '../core/util.js';

const RAIN_VERT = `
uniform float uTime;
uniform vec3 uOrigin;
uniform float uFall;
uniform vec3 uWind;
uniform float uBox;
attribute float aSpeed;
attribute float aLen;
varying float vA;
void main() {
  vec3 p = position;
  float t = uTime * (uFall * aSpeed);
  p.y -= t;
  p += uWind * uTime * aSpeed * 0.35;
  // wrap into a box that follows the camera
  vec3 rel = p - uOrigin;
  rel = mod(rel + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 world = uOrigin + rel;
  // stretch the streak downward along the fall direction
  vec3 dir = normalize(vec3(uWind.x, -uFall, uWind.z));
  world += dir * (uv.y - 0.5) * aLen;
  vA = smoothstep(uBox * 0.5, uBox * 0.18, length(rel.xz));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}`;

const RAIN_FRAG = `
uniform float uOpacity;
uniform vec3 uColor;
varying float vA;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vA);
}`;

export class RainSystem {
  constructor(scene, count = 4200) {
    this.count = count;
    const box = 70;
    this.box = box;
    const pos = new Float32Array(count * 2 * 3);
    const uv = new Float32Array(count * 2 * 2);
    const spd = new Float32Array(count * 2);
    const len = new Float32Array(count * 2);
    const idx = [];
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * box;
      const y = (Math.random() - 0.5) * box;
      const z = (Math.random() - 0.5) * box;
      const s = 0.75 + Math.random() * 0.6;
      const l = 0.4 + Math.random() * 0.9;
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 3;
        pos[o] = x;
        pos[o + 1] = y;
        pos[o + 2] = z;
        uv[(i * 2 + k) * 2] = 0;
        uv[(i * 2 + k) * 2 + 1] = k;
        spd[i * 2 + k] = s;
        len[i * 2 + k] = l;
      }
      idx.push(i * 2, i * 2 + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
    geo.setAttribute('aLen', new THREE.BufferAttribute(len, 1));
    geo.setIndex(idx);

    this.uniforms = {
      uTime: { value: 0 },
      uOrigin: { value: new THREE.Vector3() },
      uFall: { value: 16 },
      uWind: { value: new THREE.Vector3(2.5, 0, 1.2) },
      uBox: { value: box },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0xc8d6e2) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      fog: false,
    });
    this.mesh = new THREE.LineSegments(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 900;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.intensity = 0;
  }

  update(dt, camPos, wetness, speed) {
    this.intensity += (wetness - this.intensity) * (1 - Math.exp(-dt * 0.5));
    const vis = this.intensity > 0.02;
    this.mesh.visible = vis;
    if (!vis) return;
    this.uniforms.uTime.value += dt;
    this.uniforms.uOrigin.value.set(camPos.x, camPos.y + 8, camPos.z);
    this.uniforms.uOpacity.value = clamp01(this.intensity) * 0.42;
    // riding fast tilts the rain towards you
    this.uniforms.uFall.value = 15 + this.intensity * 7;
    this.uniforms.uWind.value.set(2.2 + speed * 0.45, 0, 1.0);
  }
}

/** Dust / heat-haze particles for the dry season and dirt roads. */
export class DustSystem {
  constructor(scene, count = 500) {
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const box = 44;
    this.box = box;
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * box;
      pos[i * 3 + 1] = Math.random() * 7;
      pos[i * 3 + 2] = (Math.random() - 0.5) * box;
      size[i] = 0.05 + Math.random() * 0.14;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.uniforms = {
      uTime: { value: 0 },
      uOrigin: { value: new THREE.Vector3() },
      uBox: { value: box },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0xd8c6a4) },
      uScale: { value: 300 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        uniform float uTime; uniform vec3 uOrigin; uniform float uBox; uniform float uScale;
        attribute float aSize; varying float vA;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.3 + p.z) * 1.4 + uTime * 0.7;
          p.y += sin(uTime * 0.5 + p.x * 0.4) * 0.5;
          vec3 rel = mod(p - uOrigin + uBox * 0.5, uBox) - uBox * 0.5;
          vec3 world = uOrigin + rel;
          vA = smoothstep(uBox * 0.5, uBox * 0.15, length(rel.xz));
          vec4 mv = modelViewMatrix * vec4(world, 1.0);
          gl_PointSize = aSize * uScale / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uOpacity; uniform vec3 uColor; varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.1, length(d));
          gl_FragColor = vec4(uColor, a * uOpacity * vA);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 880;
    scene.add(this.points);
  }

  update(dt, camPos, amount) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uOrigin.value.set(camPos.x, camPos.y, camPos.z);
    this.uniforms.uOpacity.value = clamp01(amount) * 0.3;
    this.points.visible = amount > 0.01;
  }
}

/** Occasional lightning during rain: a scene-wide flash plus a light. */
export class LightningSystem {
  constructor(scene) {
    this.light = new THREE.DirectionalLight(0xdfe8ff, 0);
    this.light.position.set(60, 180, -90);
    scene.add(this.light);
    this.timer = 20 + Math.random() * 40;
    this.flash = 0;
    this.pending = [];
  }

  update(dt, wetness, onThunder) {
    if (wetness > 0.65) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 12 + Math.random() * 45;
        this.flash = 1;
        const delay = 1.5 + Math.random() * 6;
        this.pending.push(delay);
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 5.5);
      const f = this.flash;
      this.light.intensity = (Math.random() < 0.5 ? f : f * 0.4) * 2.4;
    } else {
      this.light.intensity = 0;
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      this.pending[i] -= dt;
      if (this.pending[i] <= 0) {
        this.pending.splice(i, 1);
        if (onThunder) onThunder();
      }
    }
  }
}
