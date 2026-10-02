// Minimal browser stubs so the world/physics code can be exercised in Node.
// Nothing here touches WebGL: we only build geometry and run simulation.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WORLD_DIR = path.resolve(HERE, '../public/world');

function fakeCtx2d(canvas) {
  const noop = () => {};
  const grad = { addColorStop: noop };
  return new Proxy(
    {
      canvas,
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      globalAlpha: 1,
      font: '10px sans-serif',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      globalCompositeOperation: 'source-over',
      lineCap: 'butt',
      lineJoin: 'miter',
      shadowBlur: 0,
      shadowColor: '#000',
      createLinearGradient: () => grad,
      createRadialGradient: () => grad,
      createPattern: () => null,
      measureText: (t) => ({ width: (t || '').length * 6 }),
      getImageData: (x, y, w, h) => ({
        data: new Uint8ClampedArray(Math.max(1, w | 0) * Math.max(1, h | 0) * 4),
        width: w | 0,
        height: h | 0,
      }),
      putImageData: noop,
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      setTransform: noop,
      getTransform: () => ({}),
      setLineDash: noop,
      getLineDash: () => [],
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return noop;
      },
      set(target, prop, v) {
        target[prop] = v;
        return true;
      },
    }
  );
}

export function installDom() {
  if (globalThis.document) return;
  const makeCanvas = () => {
    const c = {
      width: 300,
      height: 150,
      style: {},
      nodeType: 1,
      getContext: (kind) => (kind === '2d' ? fakeCtx2d(c) : null),
      toDataURL: () => 'data:image/png;base64,',
      addEventListener: () => {},
      removeEventListener: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 150 }),
    };
    return c;
  };
  globalThis.document = {
    createElementNS: () => makeCanvas(),
    createElement: (tag) => (tag === 'canvas' ? makeCanvas() : { style: {}, appendChild() {}, addEventListener() {} }),
    head: { appendChild() {} },
    body: { appendChild() {} },
    addEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
  };
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    addEventListener() {},
    matchMedia: () => ({ matches: false }),
  };
  if (!globalThis.navigator) {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'node', hardwareConcurrency: 4 },
      configurable: true,
    });
  }
  globalThis.self = globalThis;
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
}

/** fetch() backed by the local world directory. */
export function installFetch(dir = WORLD_DIR) {
  globalThis.fetch = async (url) => {
    const rel = String(url).replace(/^.*world\//, '');
    const p = path.join(dir, rel);
    if (!fs.existsSync(p)) {
      return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const buf = fs.readFileSync(p);
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(buf.toString('utf8')),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      text: async () => buf.toString('utf8'),
    };
  };
}
