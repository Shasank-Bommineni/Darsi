// Material registry. Bucket keys produced by the world builders are resolved
// here, lazily, so chunks never create duplicate materials.

import * as THREE from 'three';
import * as T from './textures.js';

export class Materials {
  constructor() {
    this.map = new Map();
    this.wetness = 0;
    this._wetTargets = [];
  }

  get(key) {
    let m = this.map.get(key);
    if (m) return m;
    m = this._create(key);
    this.map.set(key, m);
    return m;
  }

  _reg(m, opts = {}) {
    if (opts.wet) {
      const t = { mat: m, dry: opts.wet.dry, wet: opts.wet.wet };
      this._wetTargets.push(t);
      // A chunk built while it is already raining must come out wet, not dry.
      this._applyWet(t);
    }
    return m;
  }

  _applyWet(t) {
    const v = t.dry + (t.wet - t.dry) * this.wetness;
    t.mat.color.setScalar(v);
  }

  _create(key) {
    const p = key.split('|');
    const kind = p[0];

    switch (kind) {
      case 'terrain': {
        const t = T.groundAtlasTexture();
        t.repeat.set(1, 1);
        return new THREE.MeshLambertMaterial({
          map: T.gravelTexture(3),
          vertexColors: true,
          side: THREE.FrontSide,
        });
      }
      case 'road': {
        // road|asphalt|q  road|concrete  road|dirt  road|gravel
        const surf = p[1];
        let map;
        if (surf === 'asphalt') map = T.asphaltTexture(parseFloat(p[2] || '0.7'), 0);
        else if (surf === 'concrete') map = T.concreteRoadTexture();
        else if (surf === 'gravel') map = T.gravelTexture();
        else map = T.dirtRoadTexture();
        map.repeat.set(1, 1);
        const m = new THREE.MeshLambertMaterial({ map, vertexColors: true });
        return this._reg(m, { wet: { dry: 1.0, wet: 0.42 } });
      }
      case 'shoulder': {
        const m = new THREE.MeshLambertMaterial({ map: T.dirtRoadTexture(5), vertexColors: true });
        return this._reg(m, { wet: { dry: 1.0, wet: 0.6 } });
      }
      case 'marking': {
        return new THREE.MeshBasicMaterial({
          color: 0xffffff,
          vertexColors: true,
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        });
      }
      case 'plaster': {
        const idx = parseInt(p[1] || '0', 10);
        return new THREE.MeshLambertMaterial({ map: T.plasterTexture(idx), vertexColors: true });
      }
      case 'concrete':
        return new THREE.MeshLambertMaterial({ map: T.concreteTexture(parseInt(p[1] || '0', 10)), vertexColors: true });
      case 'brick':
        return new THREE.MeshLambertMaterial({ map: T.brickTexture(), vertexColors: true });
      case 'tin':
        return new THREE.MeshLambertMaterial({ map: T.tinRoofTexture(p[1] || '#8f9aa0'), vertexColors: true });
      case 'tile':
        return new THREE.MeshLambertMaterial({ map: T.tileRoofTexture(), vertexColors: true });
      case 'shutter':
        return new THREE.MeshLambertMaterial({ map: T.shutterTexture(p[1] || '#4a6b8a'), vertexColors: true });
      case 'glass':
        return new THREE.MeshPhongMaterial({
          color: 0x2b3a44, vertexColors: true, shininess: 90, specular: 0x9ab4c4,
          transparent: true, opacity: 0.86,
        });
      case 'flat':
        return new THREE.MeshLambertMaterial({ vertexColors: true });
      case 'flat2':
        return new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      case 'metal':
        return new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: 0x555555 });
      case 'emissive':
        return new THREE.MeshBasicMaterial({ vertexColors: true });
      case 'foliage':
        return new THREE.MeshLambertMaterial({
          map: T.foliageTexture(p[1] || 'neem'),
          vertexColors: true,
          alphaTest: 0.42,
          transparent: false,
          side: THREE.DoubleSide,
        });
      case 'leafcard':
        return new THREE.MeshLambertMaterial({
          map: T.foliageTexture(p[1] || 'neem'),
          vertexColors: true,
          alphaTest: 0.5,
          side: THREE.DoubleSide,
        });
      case 'bark':
        return new THREE.MeshLambertMaterial({ map: T.barkTexture(), vertexColors: true });
      case 'water': {
        const m = new THREE.MeshPhongMaterial({
          map: T.waterTexture(),
          color: 0x6e8a84,
          transparent: true,
          opacity: 0.86,
          shininess: 110,
          specular: 0xaad0d8,
        });
        m.map.repeat.set(24, 24);
        return m;
      }
      case 'sign': {
        const [, text, bg, fg, sub] = p;
        return new THREE.MeshLambertMaterial({ map: T.signTexture(text, bg, fg, sub), vertexColors: true });
      }
      default:
        return new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xcccccc });
    }
  }

  setWetness(w) {
    if (Math.abs(w - this.wetness) < 0.005) return;
    this.wetness = w;
    for (const t of this._wetTargets) this._applyWet(t);
  }
}
