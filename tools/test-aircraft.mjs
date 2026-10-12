// Behavioral flight regression tests. Run with Node 22+: node tools/test-aircraft.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// Aircraft materials draw a brush texture; flight tests do not need a GPU or browser.
globalThis.document = {
  createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }) }),
};
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  await RAPIER.init();
  const { Aircraft } = await server.ssrLoadModule('/src/player/Aircraft.ts');
  const { WorldData } = await server.ssrLoadModule('/src/world/WorldData.ts');
  const { Physics } = await server.ssrLoadModule('/src/engine/Physics.ts');
  const { getAirfield, prepareAirfield } = await server.ssrLoadModule('/src/world/Airfield.ts');
  const { bus } = await server.ssrLoadModule('/src/core/EventBus.ts');
  const events = [];
  const off = bus.on('toast', (event) => events.push(event));
  const idle = { throttle: 0, brake: 0, steer: 0, pitch: 0 };
  const tick = (plane, seconds, input = idle) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) plane.fixedUpdate(1 / 60, { ...idle, ...input });
  };
  const fixtures = [];
  const fixture = () => {
    const world = { heightAt: () => 500, meta: { playArea: { x0: -4000, x1: 4000, n0: -4000, n1: 4000 } } };
    const physics = { world: new RAPIER.World({ x: 0, y: -9.81, z: 0 }) };
    const plane = new Aircraft(world, new THREE.Scene(), physics, { x: 0, n: 0, heading: 0 });
    fixtures.push(physics.world);
    plane.active = true;
    return { plane, world, physics };
  };

  const { plane } = fixture();
  plane.active = false;
  const parked = plane.position.clone();
  tick(plane, 12, { throttle: 1, pitch: 1 });
  assert.deepEqual(plane.position, parked, 'parked plane must stay still');
  assert.equal(plane.speed, 0);
  plane.active = true;
  tick(plane, 3, { throttle: 1, pitch: 1 });
  assert.equal(plane.grounded, true, 'cannot lift off below flying speed');
  tick(plane, 6, { throttle: 1 });
  assert.equal(plane.grounded, false, 'accelerating alone provides an assisted takeoff');
  assert.ok(plane.altitude > 5, 'assisted takeoff gains height');
  tick(plane, 15);
  assert.ok(plane.altitude > 34 && plane.altitude < 40, 'assistance levels off above the runway');
  const level = plane.position.y;
  tick(plane, 5);
  assert.ok(Math.abs(plane.position.y - level) < 0.2, 'neutral pitch holds altitude');
  tick(plane, 3, { pitch: 1 });
  assert.ok(plane.position.y > level + 20, 'climb control gains height');
  const high = plane.position.y;
  tick(plane, 4, { pitch: -1 });
  assert.ok(plane.position.y < high - 10, 'descent control loses height');
  const beforeTurn = plane.position.z;
  tick(plane, 2, { steer: 1 });
  assert.ok(plane.position.z > beforeTurn, 'right input turns right from an east heading');
  plane.reset();
  assert.equal(plane.active, true, 'reset must preserve active mode');
  assert.equal(plane.speed, 0);
  assert.equal(plane.grounded, true);
  assert.deepEqual(plane.position, parked, 'reset must always return to the aeroclub spawn');

  const obstacle = fixture();
  obstacle.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1, 5, 8).setTranslation(45, 505, 0));
  obstacle.physics.world.step();
  let hit = false;
  for (let i = 0; i < 600; i++) {
    obstacle.plane.fixedUpdate(1 / 60, { ...idle, throttle: 1 });
    if (i > 120 && obstacle.plane.speed === 0 && obstacle.plane.position.x === 0) { hit = true; break; }
  }
  assert.ok(hit, 'static building collision must reset the flight');
  assert.equal(obstacle.plane.position.x, 0);
  assert.match(events.at(-1).text, /obstáculo/);

  const dynamic = fixture();
  const parkedCar = dynamic.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(45, 504, 0));
  dynamic.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1, 4, 8), parkedCar);
  dynamic.physics.world.step();
  tick(dynamic.plane, 9, { throttle: 1 });
  assert.ok(dynamic.plane.position.x > 120, 'dynamic parked car must be excluded from aircraft casts');

  const landing = fixture().plane;
  tick(landing, 9, { throttle: 1 });
  landing.position.y = 512;
  landing.speed = 28;
  landing.throttleOut = 0.4;
  tick(landing, 4, { pitch: -1 });
  assert.equal(landing.grounded, true, 'a slow, gentle approach can land');
  assert.ok(landing.position.x > 100, 'landing stays in place instead of resetting to the aeroclub');
  tick(landing, 5, { brake: 1 });
  assert.equal(landing.speed, 0, 'brakes bring the landed plane to a stop');

  const boundary = fixture();
  boundary.world.meta.playArea.x1 = 100;
  tick(boundary.plane, 9, { throttle: 1 });
  assert.ok(boundary.plane.position.x < 92, 'map boundary recovers the plane');
  assert.ok(events.some((e) => /límite/.test(e.text)));

  const a = fixture().plane, b = fixture().plane;
  for (const [seconds, input] of [[7, { throttle: 1 }], [5, { pitch: 1, steer: 0.3 }], [4, { pitch: -1, brake: 0.2 }]]) {
    tick(a, seconds, input); tick(b, seconds, input);
  }
  assert.deepEqual(a.position, b.position, 'identical fixed-step input must replay deterministically');
  assert.equal(a.speed, b.speed);

  // Exercise the real DEM and real fixed building colliders on the departure path.
  const real = new WorldData();
  real.meta = JSON.parse(fs.readFileSync('public/world/meta.json', 'utf8'));
  const buffer = fs.readFileSync('public/world/terrain.bin');
  real.heights = Float32Array.from(new Uint16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2), (h) => h / real.meta.terrain.scale);
  real.ground = new Uint8Array(fs.readFileSync('public/world/ground.bin'));
  const trees = fs.readFileSync('public/world/trees.bin');
  real.trees = new Float32Array(trees.buffer.slice(trees.byteOffset, trees.byteOffset + trees.byteLength));
  real.buildings = JSON.parse(fs.readFileSync('public/world/buildings.json', 'utf8'));
  prepareAirfield(real);
  const realPhysics = new Physics(real);
  fixtures.push(realPhysics.world);
  for (const building of real.buildings) {
    if (Math.hypot(building.x - getAirfield(real).x, building.n - getAirfield(real).n) > 1000) continue;
    realPhysics.world.createCollider(RAPIER.ColliderDesc.cuboid(building.w / 2, 3, building.d / 2)
      .setTranslation(building.x, building.y + 3, -building.n));
  }
  realPhysics.world.step();
  const realPlane = new Aircraft(real, new THREE.Scene(), realPhysics, getAirfield(real).spawn);
  realPlane.active = true;
  const initial = realPlane.position.clone();
  const eventIndex = events.length;
  tick(realPlane, 18, { throttle: 1 });
  assert.equal(realPlane.grounded, false, 'real VGB runway permits assisted takeoff');
  assert.ok(realPlane.altitude > 20, 'real takeoff reaches a usable height');
  assert.ok(realPlane.position.distanceTo(initial) > 400, 'actual flight progresses beyond the departure end');
  assert.ok(!events.slice(eventIndex).some((e) => /Volvimos/.test(e.sub ?? '')), 'real runway takeoff must not reset');

  off();
  fixtures.forEach((world) => world.free());
  console.log('Aircraft OK: parked mode, takeoff, level flight, controls, landing, reset, collisions, boundaries, deterministic replay and real VGB runway.');
} finally {
  await server.close();
}
