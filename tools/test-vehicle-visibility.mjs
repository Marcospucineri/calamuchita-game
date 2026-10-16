import assert from 'node:assert/strict';
import { createServer } from 'vite';
import * as THREE from 'three';
// Geometry and ray tests run without a GPU. Canvas is only used for paint/plate textures.
const context = new Proxy({}, { get: (_, key) => typeof key === 'string' ? () => {} : undefined });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { Vehicle } = await server.ssrLoadModule('/src/player/Vehicle.ts');
  const car = Object.assign(Object.create(Vehicle.prototype), { wheels: [], windowMeshes: [], mesh: new THREE.Group(), driverEye: new THREE.Vector3() });
  const model = car.buildModel();
  car.mesh.add(model);
  car.fitCabin(new THREE.Box3().setFromObject(model));
  car.mesh.updateMatrixWorld(true);
  assert.equal(car.windowMeshes.length, 6, 'Four side windows, windshield and rear window');
  const renderedMeshes = () => {
    const meshes = [];
    car.mesh.traverseVisible((o) => { if (o.isMesh) meshes.push(o); });
    return meshes;
  };
  const directions = [new THREE.Vector3(1,0,0), new THREE.Vector3(0,0,-1), new THREE.Vector3(0,0,1), new THREE.Vector3(-1,0,0)];
  car.setInterior(false);
  for (const d of directions) {
    const hit = new THREE.Raycaster(car.driverEye,d,.01,4).intersectObjects(renderedMeshes(), false);
    assert.ok(hit.some((h) => car.windowMeshes.includes(h.object)), 'Exterior glass still renders');
  }
  car.setInterior(true);
  assert.equal(car.interior.visible, true);
  for (const d of directions) {
    const hit = new THREE.Raycaster(car.driverEye,d,.01,4).intersectObjects(renderedMeshes(), false);
    assert.equal(hit.length, 0, 'Driver has clear forward, rear and side sightlines');
  }
  car.setInterior(false);
  assert.ok(car.windowMeshes.every((w) => w.visible), 'Returning to chase camera restores glass');
  assert.equal(car.interior.visible, false);
  console.log('OK: parabrisas y ventanillas libres en primera persona; vidrios restaurados al salir.');
} finally { await server.close(); }
