// Renderer setup + quality tiers.

import * as THREE from 'three';

export const QUALITY = {
  low: {
    name: 'low', pixelRatio: 1.0, shadows: false, shadowSize: 1024,
    nearDist: 190, midDist: 380, farDist: 620, terrainSegs: 16,
    buildBudgetMs: 5, maxTraffic: 12, trafficRadius: 150, maxPeds: 10, pedRadius: 85,
    fogMul: 0.75, antialias: false,
  },
  medium: {
    name: 'medium', pixelRatio: 1.25, shadows: true, shadowSize: 2048,
    nearDist: 300, midDist: 620, farDist: 980, terrainSegs: 24,
    buildBudgetMs: 7, maxTraffic: 26, trafficRadius: 240, maxPeds: 22, pedRadius: 120,
    fogMul: 1.0, antialias: true,
  },
  high: {
    name: 'high', pixelRatio: 1.6, shadows: true, shadowSize: 2048,
    nearDist: 380, midDist: 780, farDist: 1300, terrainSegs: 32,
    buildBudgetMs: 9, maxTraffic: 40, trafficRadius: 320, maxPeds: 34, pedRadius: 150,
    fogMul: 1.25, antialias: true,
  },
};

export function detectQuality() {
  const mem = navigator.deviceMemory || 4;
  const touch = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  if (touch || mem <= 3 || cores <= 3) return QUALITY.low;
  if (mem >= 8 && cores >= 8) return QUALITY.high;
  return QUALITY.medium;
}

export function createRenderer(canvasHost, quality) {
  const renderer = new THREE.WebGLRenderer({
    antialias: quality.antialias,
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer: true, // needed for photo-mode saves
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  if (quality.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.position = 'fixed';
  renderer.domElement.style.inset = '0';
  canvasHost.appendChild(renderer.domElement);
  return renderer;
}

/** Simple rolling FPS meter with an adaptive-resolution hook. */
export class PerfMonitor {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.quality = quality;
    this.samples = [];
    this.fps = 60;
    this.scale = 1;
    this.cooldown = 2;
  }

  tick(dt) {
    this.samples.push(dt);
    if (this.samples.length > 60) this.samples.shift();
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.fps = 1 / Math.max(1e-4, avg);
    this.cooldown -= dt;
    if (this.cooldown > 0 || this.samples.length < 45) return;
    const base = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    if (this.fps < 26 && this.scale > 0.62) {
      this.scale = Math.max(0.6, this.scale - 0.12);
      this.renderer.setPixelRatio(base * this.scale);
      this.cooldown = 3;
    } else if (this.fps > 56 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.08);
      this.renderer.setPixelRatio(base * this.scale);
      this.cooldown = 3;
    }
  }
}
