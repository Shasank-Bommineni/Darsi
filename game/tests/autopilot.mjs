// A pure-pursuit rider used by the automated drive tests.
//
// It follows the real road graph the same way a player would: look ahead along
// the route, steer towards that point, and modulate the throttle for corners.
// If a human can't ride the road, neither can this, which is exactly what we
// want to measure.

import { sampleRoadSurface } from '../src/world/roadBuilder.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Build a route of {edge, dir} hops starting from an edge. */
export function buildRoute(world, startEdgeId, hops = 40, seed = 1) {
  const route = [];
  let e = world.edges[startEdgeId];
  let dir = 1;
  let node = e.b;
  route.push({ edge: e, dir });
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < hops; i++) {
    const opts = (world.nodeEdges.get(node) || []).filter((id) => id !== e.i);
    if (!opts.length) break;
    const scored = opts.map((id) => {
      const o = world.edges[id];
      let sc = rnd() * 0.4;
      if (o.cls === e.cls) sc += 1.0;
      if (o.name && o.name === e.name) sc += 1.2;
      if (o.cls === 'path' || o.cls === 'farm') sc -= 3;
      return [sc, o];
    });
    scored.sort((a, b) => b[0] - a[0]);
    const next = scored[0][1];
    dir = next.a === node ? 1 : -1;
    node = dir === 1 ? next.b : next.a;
    e = next;
    route.push({ edge: e, dir });
  }
  return route;
}

/** Flatten a route into a dense list of waypoints in three-space. */
export function routePoints(route, laneOffset = -0.25) {
  const pts = [];
  for (const { edge, dir } of route) {
    const list = dir === 1 ? edge.pts3 : [...edge.pts3].reverse();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      // use the previous point's tangent at the end of a run, otherwise the
      // last waypoint of every edge loses its lane offset and the path kinks
      const a = i < list.length - 1 ? p : list[i - 1] || p;
      const q = i < list.length - 1 ? list[i + 1] : p;
      let tx = q[0] - a[0];
      let tz = q[2] - a[2];
      const L = Math.hypot(tx, tz) || 1;
      tx /= L;
      tz /= L;
      // keep left
      const off = edge.w * laneOffset;
      pts.push([p[0] + tz * off, p[2] - tx * off]);
    }
  }
  return pts;
}

export class Autopilot {
  constructor(points) {
    this.pts = points;
    this.idx = 0;
    this.finished = false;
    this.offRouteTime = 0;
    this.maxOffRoute = 0;
    this.stalled = 0;
    this.recovering = 0;
    this.recoveries = 0;
  }

  /** @returns an input object for BikePhysics.step */
  control(bike, dt, targetSpeed = 16) {
    const px = bike.pos.x;
    const pz = bike.pos.z;
    // advance along the path
    while (this.idx < this.pts.length - 1) {
      const p = this.pts[this.idx];
      if (Math.hypot(p[0] - px, p[1] - pz) < 9) this.idx++;
      else break;
    }
    if (this.idx >= this.pts.length - 1) {
      this.finished = true;
      return { throttle: 0, brake: 1, steer: 0, hardBrake: false };
    }
    const cur = this.pts[this.idx];
    const crossTrack = Math.hypot(cur[0] - px, cur[1] - pz);
    this.maxOffRoute = Math.max(this.maxOffRoute, crossTrack);
    if (crossTrack > 14) this.offRouteTime += dt;

    // A player who noses into something backs off and tries again; model that
    // so the drive test measures the world, not a wedged corner case.
    if (Math.abs(bike.speed) < 0.4) this.stalled += dt;
    else this.stalled = Math.max(0, this.stalled - dt * 2);
    if (this.stalled > 1.2 && this.recovering <= 0) {
      this.recovering = 1.6;
      this.recoveries++;
      this.stalled = 0;
    }
    if (this.recovering > 0) {
      this.recovering -= dt;
      // paddle out: gentle power with full lock, which is what frees a bike
      // that has nosed into a kerb or a compound wall
      return { throttle: 0.3, brake: 0, steer: this.recoveries % 2 ? 1 : -1, hardBrake: false };
    }

    // look ahead proportional to speed
    const look = clamp(6 + Math.abs(bike.speed) * 0.85, 7, 28);
    let j = this.idx;
    let acc = 0;
    while (j < this.pts.length - 1 && acc < look) {
      acc += Math.hypot(this.pts[j + 1][0] - this.pts[j][0], this.pts[j + 1][1] - this.pts[j][1]);
      j++;
    }
    const tgt = this.pts[j];
    const dx = tgt[0] - px;
    const dz = tgt[1] - pz;
    const desired = Math.atan2(dx, dz);
    let err = desired - bike.heading;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    const steer = clamp(err * 1.7, -1, 1);

    // slow down for the corner ahead
    let k = j;
    let acc2 = 0;
    while (k < this.pts.length - 1 && acc2 < 34) {
      acc2 += Math.hypot(this.pts[k + 1][0] - this.pts[k][0], this.pts[k + 1][1] - this.pts[k][1]);
      k++;
    }
    const far = this.pts[k];
    let errFar = Math.atan2(far[0] - px, far[1] - pz) - bike.heading;
    while (errFar > Math.PI) errFar -= Math.PI * 2;
    while (errFar < -Math.PI) errFar += Math.PI * 2;
    const corner = Math.abs(errFar);
    const vTarget = targetSpeed * clamp(1 - corner * 0.9, 0.25, 1);

    const dv = vTarget - bike.speed;
    return {
      throttle: clamp(dv * 0.55, 0, 1),
      brake: clamp(-dv * 0.3, 0, 1),
      steer,
      hardBrake: false,
    };
  }
}

export function surfaceFor(world, bike) {
  const fx = Math.sin(bike.heading);
  const fz = Math.cos(bike.heading);
  const hw = bike.spec.wheelbase * 0.5;
  const mid = sampleRoadSurface(world, bike.pos.x, bike.pos.z);
  const f = sampleRoadSurface(world, bike.pos.x + fx * hw, bike.pos.z + fz * hw);
  const r = sampleRoadSurface(world, bike.pos.x - fx * hw, bike.pos.z - fz * hw);
  return {
    name: mid.name,
    grip: mid.grip,
    roughness: mid.roughness,
    frontOffset: f.y - world.heightAt(bike.pos.x + fx * hw, bike.pos.z + fz * hw),
    rearOffset: r.y - world.heightAt(bike.pos.x - fx * hw, bike.pos.z - fz * hw),
  };
}
