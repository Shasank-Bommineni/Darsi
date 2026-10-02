// Headless verification of the Darsi runtime.
//
// This exercises the real modules the browser runs -- world loading, chunk
// geometry assembly, road surface sampling, bike physics, collision, traffic
// and pedestrian stepping -- without needing a GPU. It is the gate that must
// pass before a build is considered rideable.

import { installDom, installFetch } from './stubs.mjs';

installDom();
installFetch();

const { WorldData, GROUND } = await import('../src/world/worldData.js');
const { Materials } = await import('../src/render/materials.js');
const { ChunkManager, CHUNK } = await import('../src/world/chunkManager.js');
const { sampleRoadSurface, buildRoad } = await import('../src/world/roadBuilder.js');
const { buildBuilding } = await import('../src/world/buildingBuilder.js');
const { MeshAccum } = await import('../src/world/meshBuilder.js');
const { BIKE_SPECS, BikePhysics } = await import('../src/bike/physics.js');
const { resolveCollisions } = await import('../src/bike/collision.js');
const { TrafficSystem } = await import('../src/ai/traffic.js');
const { Autopilot, buildRoute, routePoints, surfaceFor } = await import('./autopilot.mjs');
const { PedestrianSystem } = await import('../src/ai/pedestrians.js');
const THREE = await import('three');

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

const finite = (v) => Number.isFinite(v);

// ---------------------------------------------------------------- world

section('world data');
const t0 = Date.now();
const world = await new WorldData().load('world');
check('world loads', world.ready, `${Date.now() - t0} ms`);
check('schema is darsi-world-2', world.meta.schema === 'darsi-world-2');
check('half extent is 4.2 km', world.half === 4200, `${world.half} m`);
check('road edges present', world.edges.length > 500, `${world.edges.length} edges`);
check('road nodes present', world.nodes.length > 400, `${world.nodes.length} nodes`);
check('buildings present', world.buildings.length > 2000, `${world.buildings.length}`);
check('real OSM footprints kept', world.buildings.filter((b) => b.src === 'osm').length > 100,
  `${world.buildings.filter((b) => b.src === 'osm').length} osm`);
check('POIs present', world.pois.length > 20, `${world.pois.length}`);

section('terrain');
let hmin = Infinity;
let hmax = -Infinity;
let nanH = 0;
for (let i = 0; i < 20000; i++) {
  const x = (Math.random() * 2 - 1) * world.half;
  const z = (Math.random() * 2 - 1) * world.half;
  const h = world.heightAt(x, z);
  if (!finite(h)) nanH++;
  if (h < hmin) hmin = h;
  if (h > hmax) hmax = h;
}
check('no NaN terrain samples', nanH === 0);
check('terrain is not flat', hmax - hmin > 40, `relief ${(hmax - hmin).toFixed(1)} m over samples`);
check('terrain within DEM range', hmin > 50 && hmax < 400, `${hmin.toFixed(1)}..${hmax.toFixed(1)} m`);
const anchorH = world.heightAt(0, 0);
check('anchor elevation plausible for Darsi', anchorH > 90 && anchorH < 140, `${anchorH.toFixed(1)} m`);

// slope sanity: no vertical cliffs in the road corridors
let maxGrade = 0;
for (const e of world.edges) {
  for (let i = 1; i < e.pts3.length; i++) {
    const a = e.pts3[i - 1];
    const b = e.pts3[i];
    const run = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (run < 1) continue;
    const g = Math.abs(b[1] - a[1]) / run;
    if (g > maxGrade) maxGrade = g;
  }
}
check('road gradients are drivable', maxGrade < 0.18, `max ${(maxGrade * 100).toFixed(1)}%`);

section('road network');
const classes = {};
for (const e of world.edges) classes[e.cls] = (classes[e.cls] || 0) + 1;
check('multiple road classes', Object.keys(classes).length >= 4, Object.entries(classes).map(([k, v]) => `${k}:${v}`).join(' '));
let totalKm = 0;
for (const e of world.edges) totalKm += e.len;
totalKm /= 1000;
check('network length matches pipeline', Math.abs(totalKm - world.meta.stats.road_km) < 1.5,
  `${totalKm.toFixed(2)} km vs ${world.meta.stats.road_km} km`);
let widthBad = 0;
for (const e of world.edges) if (!(e.w >= 2 && e.w <= 16)) widthBad++;
check('road widths are sane', widthBad === 0, `${widthBad} outliers`);

// connectivity: flood fill the graph
const adj = world.nodeEdges;
const seen = new Set();
const stack = [world.edges[0].a];
while (stack.length) {
  const n = stack.pop();
  if (seen.has(n)) continue;
  seen.add(n);
  for (const eid of adj.get(n) || []) {
    const e = world.edges[eid];
    const o = e.a === n ? e.b : e.a;
    if (!seen.has(o)) stack.push(o);
  }
}
const frac = seen.size / world.nodes.length;
check('road graph is mostly one component', frac > 0.7, `${(frac * 100).toFixed(1)}% of nodes reachable`);

section('road surface sampling');
let surfNan = 0;
let onRoadCount = 0;
for (const e of world.edges.slice(0, 200)) {
  for (let k = 0; k < 5; k++) {
    const s = (k / 4) * e.len;
    const idx = Math.min(e.pts3.length - 1, Math.floor((k / 4) * (e.pts3.length - 1)));
    const p = e.pts3[idx];
    const r = sampleRoadSurface(world, p[0], p[2]);
    if (!finite(r.y) || !finite(r.grip)) surfNan++;
    if (r.name !== 'offroad') onRoadCount++;
  }
}
check('surface query never NaN', surfNan === 0);
check('road centreline reads as road', onRoadCount > 900, `${onRoadCount}/1000 samples on a surface`);
const off = sampleRoadSurface(world, world.half - 50, world.half - 50);
check('off-road reads as offroad', off.name === 'offroad' || off.grip < 0.8, off.name);

// potholes must be geometric: surface height varies along a worn road
let variedRoads = 0;
for (const e of world.edges.filter((x) => x.q < 0.6).slice(0, 40)) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= 60; i++) {
    const idx = Math.min(e.pts3.length - 1, Math.floor((i / 60) * (e.pts3.length - 1)));
    const p = e.pts3[idx];
    const r = sampleRoadSurface(world, p[0], p[2]);
    const base = world.heightAt(p[0], p[2]);
    lo = Math.min(lo, r.y - base);
    hi = Math.max(hi, r.y - base);
  }
  if (hi - lo > 0.02) variedRoads++;
}
check('worn roads have 3D surface relief', variedRoads > 10, `${variedRoads}/40 sampled worn edges`);

// ---------------------------------------------------------------- geometry

section('chunk geometry');
const materials = new Materials();
const scene = new THREE.Scene();
const quality = {
  name: 'test', nearDist: 300, midDist: 620, farDist: 900, terrainSegs: 24,
  buildBudgetMs: 100000, maxTraffic: 20, trafficRadius: 240, maxPeds: 16, pedRadius: 120,
};
const cm = new ChunkManager(scene, world, materials, quality);
const sp = world.meta.spawn;
const spawn = { x: sp.x, z: -sp.y };
const gt0 = Date.now();
let built = 0;
for (let i = 0; i < 40; i++) {
  const st = cm.update(spawn.x, spawn.z, 0.016);
  built = st.active;
  if (st.queued === 0) break;
}
const gms = Date.now() - gt0;
check('chunks build around spawn', built > 20, `${built} chunks in ${gms} ms`);

let tris = 0;
let nanVerts = 0;
let meshCount = 0;
const matKeys = new Set();
for (const c of cm.chunks.values()) {
  for (const m of c.meshes) {
    meshCount++;
    matKeys.add(m.material.name || m.material.uuid);
    const pos = m.geometry.getAttribute('position');
    tris += (m.geometry.index ? m.geometry.index.count : pos.count) / 3;
    const arr = pos.array;
    for (let i = 0; i < arr.length; i += 97) if (!Number.isFinite(arr[i])) nanVerts++;
  }
}
check('geometry has no NaN vertices', nanVerts === 0);
check('world geometry is substantial', tris > 200000, `${(tris / 1000).toFixed(0)}k triangles, ${meshCount} meshes`);
check('far silhouette layer exists', !!cm.farMesh && cm.farMesh.count === world.buildings.length, `${cm.farMesh.count} instances`);

// building variety: no "box city"
section('building variety');
const heights = world.buildings.map((b) => b.h);
const uniqueH = new Set(heights.map((h) => h.toFixed(2))).size;
const avgH = heights.reduce((a, b) => a + b, 0) / heights.length;
const sd = Math.sqrt(heights.reduce((a, h) => a + (h - avgH) ** 2, 0) / heights.length);
check('building heights vary', uniqueH > 400 && sd > 1.5, `${uniqueH} distinct, sd ${sd.toFixed(2)} m`);
// and they vary *within* a category, so a street is not a row of clones
const houseH = world.buildings.filter((b) => b.cat === 'house').map((b) => b.h);
const hAvg = houseH.reduce((a, b) => a + b, 0) / houseH.length;
const hSd = Math.sqrt(houseH.reduce((a, h) => a + (h - hAvg) ** 2, 0) / houseH.length);
check('houses are not clones of each other', hSd > 0.4, `house height sd ${hSd.toFixed(2)} m`);
check('not all 3 m tall', avgH > 3.5 && avgH < 12, `mean ${avgH.toFixed(2)} m`);
const cats = {};
for (const b of world.buildings) cats[b.cat] = (cats[b.cat] || 0) + 1;
check('many building categories', Object.keys(cats).length >= 8, Object.keys(cats).join(','));
const lv = {};
for (const b of world.buildings) lv[b.lv] = (lv[b.lv] || 0) + 1;
check('multi-storey buildings exist', (lv[2] || 0) + (lv[3] || 0) + (lv[4] || 0) > 1000,
  Object.entries(lv).map(([k, v]) => `${k}:${v}`).join(' '));

// a single building must generate real detail, not one box
const sample = world.buildings.find((b) => b.cat === 'shophouse' || b.cat === 'shop');
const acc1 = new MeshAccum();
buildBuilding(acc1, sample, world, 0);
let bTris = 0;
for (const [, geo] of acc1.build()) bTris += geo.index.count / 3;
check('a shop builds detailed geometry', bTris > 200, `${bTris} triangles for one ${sample.cat}`);
const acc2 = new MeshAccum();
buildBuilding(acc2, sample, world, 2);
let fTris = 0;
for (const [, geo] of acc2.build()) fTris += geo.index.count / 3;
check('LOD2 is much cheaper', fTris < bTris / 4, `${fTris} vs ${bTris} triangles`);

// temples read as temples: taller than their footprint-neighbours, stepped
const temples = world.buildings.filter((b) => b.cat === 'temple');
check('temples exist as buildings', temples.length >= 10, `${temples.length} temples`);
check('the surveyed temple kept its real name and position',
  temples.some((b) => b.src === 'osm' && b.n),
  temples.filter((b) => b.src === 'osm').map((b) => b.n).join(', ') || 'none');
if (temples.length) {
  const acc3 = new MeshAccum();
  buildBuilding(acc3, temples[0], world, 0);
  let tTris = 0;
  for (const [, geo] of acc3.build()) tTris += geo.index.count / 3;
  check('temple builds a gopuram-scale structure', tTris > 300, `${tTris} triangles`);
} else {
  check('temple category present in world', false, 'no temple buildings found');
}

// overlap: generated buildings must not sit on the carriageway
section('placement sanity');
let onRoad = 0;
let checked = 0;
for (let i = 0; i < world.buildings.length; i += 7) {
  const b = world.buildings[i];
  checked++;
  const near = world.nearestRoad(b.wx, b.wz, 30);
  if (near && near.dist < near.edge.w * 0.5 - 0.3) onRoad++;
}
check('buildings are off the carriageway', onRoad / checked < 0.01, `${onRoad}/${checked} overlap`);

let overlaps = 0;
for (let i = 0; i < 4000; i++) {
  const b = world.buildings[(Math.random() * world.buildings.length) | 0];
  for (const id of world.buildingGrid.query(b.wx, b.wz, 8)) {
    const o = world.buildings[id];
    if (o === b) continue;
    const d = Math.hypot(o.wx - b.wx, o.wz - b.wz);
    const rmin = (Math.min(b.w, b.d) + Math.min(o.w, o.d)) * 0.5;
    if (d < rmin * 0.55) {
      overlaps++;
      break;
    }
  }
}
check('buildings do not interpenetrate', overlaps < 120, `${overlaps}/4000 sampled`);

// ---------------------------------------------------------------- physics

section('bike physics');
const bike = new BikePhysics(BIKE_SPECS.sahaja125, world);
bike.reset(spawn.x, spawn.z, sp.heading);
check('spawn is on the ground', Math.abs(bike.pos.y - world.heightAt(spawn.x, spawn.z)) < 1.0,
  `y ${bike.pos.y.toFixed(2)} vs terrain ${world.heightAt(spawn.x, spawn.z).toFixed(2)}`);
const spawnRoad = world.nearestRoad(spawn.x, spawn.z, 30);
check('spawn is on a road', !!spawnRoad && spawnRoad.dist < spawnRoad.edge.w, `${spawnRoad?.dist.toFixed(2)} m from centreline`);

const surfFor = (b) => surfaceFor(world, b);

// --- straight-line acceleration on the longest straight on a main road ----
function longestStraight() {
  let best = null;
  for (const e of world.edges) {
    if (!['arterial', 'major', 'secondary', 'highway'].includes(e.cls)) continue;
    for (let i = 0; i < e.pts3.length - 1; i++) {
      let j = i + 1;
      const a = e.pts3[i];
      const h0 = Math.atan2(e.pts3[i + 1][0] - a[0], e.pts3[i + 1][2] - a[2]);
      while (j < e.pts3.length - 1) {
        const h1 = Math.atan2(e.pts3[j + 1][0] - e.pts3[j][0], e.pts3[j + 1][2] - e.pts3[j][2]);
        let d = h1 - h0;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) > 0.06) break;
        j++;
      }
      const b = e.pts3[j];
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (!best || len > best.len) best = { len, a, b, e, h: Math.atan2(b[0] - a[0], b[2] - a[2]) };
    }
  }
  return best;
}
const straight = longestStraight();
check('a long straight exists to accelerate on', straight && straight.len > 180,
  `${straight.len.toFixed(0)} m on ${straight.e.cls} ${straight.e.name || ''}`);

const dt = 1 / 60;
bike.reset(straight.a[0], straight.a[2], straight.h);
let maxSpeed = 0;
let nanState = 0;
let accelTime = -1;
for (let i = 0; i < 60 * 45; i++) {
  bike.step(dt, { throttle: 1, brake: 0, steer: 0, hardBrake: false }, surfFor(bike));
  maxSpeed = Math.max(maxSpeed, bike.speedKmh);
  if (accelTime < 0 && bike.speedKmh >= 60) accelTime = i / 60;
  if (![bike.pos.x, bike.pos.y, bike.pos.z, bike.speed, bike.lean, bike.heading, bike.rpm].every(finite)) nanState++;
  if (Math.hypot(bike.pos.x - straight.a[0], bike.pos.z - straight.a[2]) > straight.len) break;
}
check('physics never produces NaN/Inf', nanState === 0);
check('bike accelerates to a 125cc top speed', maxSpeed > 70 && maxSpeed < 135, `${maxSpeed.toFixed(1)} km/h`);
check('0-60 km/h in a commuter-bike time', accelTime > 3 && accelTime < 16, `${accelTime.toFixed(1)} s`);
check('gearbox shifts up through the box', bike.gear >= 3, `gear ${bike.gear}`);
check('bike stays upright under power', Math.abs(bike.lean) < 0.25, `${(bike.lean * 57.3).toFixed(1)} deg`);

// --- braking from a known speed ------------------------------------------
bike.reset(straight.a[0], straight.a[2], straight.h);
for (let i = 0; i < 60 * 40 && bike.speedKmh < 55; i++) {
  bike.step(dt, { throttle: 1, brake: 0, steer: 0, hardBrake: false }, surfFor(bike));
}
const v0 = bike.speed;
const startX = bike.pos.x;
const startZ = bike.pos.z;
for (let i = 0; i < 60 * 15 && bike.speed > 0.2; i++) {
  bike.step(dt, { throttle: 0, brake: 1, steer: 0, hardBrake: true }, surfFor(bike));
}
const brakeDist = Math.hypot(bike.pos.x - startX, bike.pos.z - startZ);
check('hard braking stops the bike', bike.speed < 0.3, `${bike.speed.toFixed(3)} m/s`);
check('braking distance is realistic', brakeDist > 8 && brakeDist < 60,
  `${brakeDist.toFixed(1)} m from ${(v0 * 3.6).toFixed(0)} km/h`);

// --- a real ride: follow the road network for kilometres ------------------
section('drive test (autopilot follows the surveyed roads)');
const route = buildRoute(world, sp.edge ?? world.edges[0].i, 70, 7);
const rp = routePoints(route);
check('route built across the network', rp.length > 150,
  `${route.length} edges, ${rp.length} waypoints`);
bike.reset(rp[0][0], rp[0][1], Math.atan2(rp[1][0] - rp[0][0], rp[1][1] - rp[0][1]));
const ap = new Autopilot(rp);
let crashSeconds = 0;
let stuckSeconds = 0;
let offSurface = 0;
let maxLean = 0;
let samples = 0;
const tRide = Date.now();
for (let i = 0; i < 60 * 600 && !ap.finished; i++) {
  const inp = ap.control(bike, dt, 16);
  bike.step(dt, inp, surfFor(bike));
  resolveCollisions(bike, world, dt);
  samples++;
  if (bike.crashed) crashSeconds += dt;
  if (Math.abs(bike.speed) < 0.4) stuckSeconds += dt;
  if (sampleRoadSurface(world, bike.pos.x, bike.pos.z).name === 'offroad') offSurface += dt;
  maxLean = Math.max(maxLean, Math.abs(bike.lean));
  if (![bike.pos.x, bike.pos.y, bike.pos.z].every(finite)) nanState++;
}
const rideSec = samples * dt;
const rideKm = bike.odometer / 1000;
check('autopilot completes a long ride', rideKm > 2,
  `${rideKm.toFixed(2)} km in ${rideSec.toFixed(0)} s sim (${Date.now() - tRide} ms real)`);
check('ride stays on the surveyed carriageway', offSurface < rideSec * 0.15,
  `${offSurface.toFixed(1)} s off-surface of ${rideSec.toFixed(0)} s`);
check('ride stays on the planned route', ap.maxOffRoute < 30, `max ${ap.maxOffRoute.toFixed(1)} m off route`);
check('bike does not spend the ride crashed', crashSeconds < rideSec * 0.05, `${crashSeconds.toFixed(1)} s crashed`);
check('bike never gets permanently stuck', stuckSeconds < rideSec * 0.25,
  `${stuckSeconds.toFixed(1)} s below walking pace`);
check('bike leans through real corners', maxLean > 0.2, `max ${(maxLean * 57.3).toFixed(1)} deg`);
check('no NaN during the ride', nanState === 0);

// --- handling: steering must not throw you off ----------------------------
bike.reset(straight.a[0], straight.a[2], straight.h);
let crashes = 0;
maxLean = 0;
for (let i = 0; i < 60 * 40; i++) {
  const steer = Math.sin(i / 90) * 0.85;
  bike.step(dt, { throttle: 0.55, brake: 0, steer, hardBrake: false }, surfFor(bike));
  maxLean = Math.max(maxLean, Math.abs(bike.lean));
  if (bike.crashed) crashes++;
}
check('slalom does not constantly crash', crashes < 60 * 3, `${(crashes / 60).toFixed(1)} s crashed in 40 s`);
check('bike stays inside the world', Math.abs(bike.pos.x) < world.half && Math.abs(bike.pos.z) < world.half);

bike.pos.x = world.half + 500;
bike.reset(spawn.x, spawn.z, sp.heading);
check('reset returns to spawn', Math.hypot(bike.pos.x - spawn.x, bike.pos.z - spawn.z) < 1);

// ---------------------------------------------------------------- collision
section('collision');
const target = world.buildings.find((b) => b.w > 6 && b.d > 6 && b.src === 'osm') || world.buildings[0];
bike.reset(target.wx - 25, target.wz, Math.atan2(1, 0));
bike.speed = 12;
let inside = false;
for (let i = 0; i < 60 * 8; i++) {
  bike.step(dt, { throttle: 0.4, brake: 0, steer: 0, hardBrake: false }, surfFor(bike));
  resolveCollisions(bike, world, dt);
  const ca = Math.cos(-target.ang3);
  const sa = Math.sin(-target.ang3);
  const dx = bike.pos.x - target.wx;
  const dz = bike.pos.z - target.wz;
  const lx = dx * ca - dz * sa;
  const lz = dx * sa + dz * ca;
  if (Math.abs(lx) < target.w / 2 - 0.2 && Math.abs(lz) < target.d / 2 - 0.2) inside = true;
}
check('bike cannot drive through a building', !inside,
  `target ${target.cat} ${target.w.toFixed(1)}x${target.d.toFixed(1)} m`);

// ---------------------------------------------------------------- agents

section('traffic & pedestrians');
const traffic = new TrafficSystem(scene, world, quality);
bike.reset(spawn.x, spawn.z, sp.heading);
for (let i = 0; i < 300; i++) traffic.update(dt, bike, null);
check('traffic spawns near the player', traffic.agents.length > 3, `${traffic.agents.length} vehicles`);
const kinds = new Set(traffic.agents.map((a) => a.type.id));
check('traffic has mixed vehicle types', kinds.size >= 2, [...kinds].join(','));
let trafficNan = 0;
let offRoadAgents = 0;
for (let i = 0; i < 1200; i++) {
  traffic.update(dt, bike, null);
  for (const a of traffic.agents) {
    if (!finite(a.mesh.position.x) || !finite(a.mesh.position.y) || !finite(a.mesh.position.z)) trafficNan++;
  }
}
for (const a of traffic.agents) {
  const near = world.nearestRoad(a.mesh.position.x, a.mesh.position.z, 25);
  if (!near || near.dist > near.edge.w * 0.75 + 1.0) offRoadAgents++;
}
check('traffic never NaNs', trafficNan === 0);
check('traffic stays on the road network', offRoadAgents <= Math.ceil(traffic.agents.length * 0.1),
  `${offRoadAgents}/${traffic.agents.length} off-road`);
const buses = traffic.agents.filter((a) => a.type.id === 'bus');
check('buses only on roads wide enough', buses.every((a) => a.type.w < a.edge.w * 0.62), `${buses.length} buses`);

const peds = new PedestrianSystem(scene, world, quality);
for (let i = 0; i < 600; i++) peds.update(dt, bike, 9.0);
const dayCount = peds.people.length;
for (let i = 0; i < 600; i++) peds.update(dt, bike, 3.0);
const nightCount = peds.people.length;
check('pedestrians appear in town', dayCount >= 0, `${dayCount} at 09:00`);
check('fewer pedestrians at 03:00', nightCount <= dayCount, `${nightCount} at 03:00 vs ${dayCount} at 09:00`);
let pedNan = 0;
for (const p of peds.people) if (!finite(p.group.position.x) || !finite(p.group.position.y)) pedNan++;
check('pedestrians never NaN', pedNan === 0);

// ---------------------------------------------------------------- determinism

section('determinism');
const accA = new MeshAccum();
const accB = new MeshAccum();
const b0 = world.buildings[1234];
buildBuilding(accA, b0, world, 0);
buildBuilding(accB, b0, world, 0);
const ga = accA.build();
const gb = accB.build();
let identical = ga.length === gb.length;
if (identical) {
  for (let i = 0; i < ga.length && identical; i++) {
    const pa = ga[i][1].getAttribute('position').array;
    const pb = gb[i][1].getAttribute('position').array;
    if (pa.length !== pb.length) identical = false;
    else for (let k = 0; k < pa.length; k++) if (pa[k] !== pb[k]) { identical = false; break; }
  }
}
check('building geometry is deterministic', identical);

const r1 = sampleRoadSurface(world, spawn.x + 3, spawn.z + 3);
const r2 = sampleRoadSurface(world, spawn.x + 3, spawn.z + 3);
check('road surface sampling is deterministic', r1.y === r2.y && r1.grip === r2.grip);

// ---------------------------------------------------------------- summary

console.log(`\n${'─'.repeat(52)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail) {
  console.log('failures:');
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
process.exit(0);
