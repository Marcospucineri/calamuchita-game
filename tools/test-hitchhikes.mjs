import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import * as THREE from 'three';
// Test the real gameplay update loop without a WebGL context or physics world.
globalThis.window = {};
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { Hitchhikers } = await server.ssrLoadModule('/src/gameplay/Hitchhikers.ts');
  const { newProgress } = await server.ssrLoadModule('/src/gameplay/Progress.ts');
  const routes = JSON.parse(readFileSync(new URL('../src/gameplay/routes.json', import.meta.url)));
  const r = routes[0];
  const make = (progress = newProgress()) => Object.assign(Object.create(Hitchhikers.prototype), {
    world: { heightAt: () => 0 }, progress, people: new Map(routes.map((r) => [r.id, new THREE.Group()])),
    cooldown: new Map(), marker: new THREE.Group(), time: 0, moving: new THREE.Vector2(),
    last: null, pending: null, pickingUp: false, canPick: false, onChange: null,
  });
  let h = make();
  h.update(1/60,r.x,r.n,10,true); await h.pickup(); assert.equal(h.active,null,'Must stop before pickup');
  h.update(1/60,r.x,r.n,0,true); await h.pickup(); assert.equal(h.active.id,r.id);
  const id=h.progress.activeTrip.id;
  h.update(1/60,r.x,r.n,0,true);
  h.update(1/60,r.destX,r.destN,0,true);assert.equal(h.active,null,'Teleport cancels passenger');assert.equal(h.progress.trips.length,0);
  h=make();h.update(1/60,r.x,r.n,0,true);await h.pickup();
  h.progress.activeTrip.startedAt=Date.now()-r.distance/55*1000-10000;
  const steps=100;
  for(let i=0;i<=steps;i++) {
    if(i===50) h=make(structuredClone(h.progress)); // resume saved passenger halfway through
    h.update(2,r.x+(r.destX-r.x)*i/steps,r.n+(r.destN-r.n)*i/steps,10,true);
  }
  assert.ok(h.active,'Must stop to drop off');
  h.update(1/60,r.destX,r.destN,0,true);
  assert.equal(h.active,null);assert.equal(h.progress.trips.length,1);assert.notEqual(h.progress.trips[0].id,id);
  const balance=h.balance();assert.ok(balance>=20&&balance<=60);
  h.update(1/60,r.destX,r.destN,0,true);assert.equal(h.progress.trips.length,1,'No double completion');
  console.log('OK: frenar para subir/bajar, viaje reanudado, pago único y rechazo de teletransporte.');
} finally { await server.close(); }
