import * as THREE from 'three';
import { paintedMaterial } from '../render/PaintedMaterial';
import type { BoxCollider } from './Buildings';
import { GROUND, WorldData } from './WorldData';

export interface AirfieldLocation {
  name: string;
  x: number;
  n: number;
  heading: number;
  length: number;
  width: number;
  spawn: { x: number; n: number; heading: number };
}

// OSM runway 310390493, checked against the ANAC aerodrome location.
// South → north endpoints of runway 16/34. See docs/aeroclub.md.
const SOUTH = { lat: -31.9679322, lon: -64.5636354 };
const NORTH = { lat: -31.9614105, lon: -64.5654472 };

export function getAirfield(world: WorldData): AirfieldLocation {
  const o = world.meta.origin;
  const ax = (SOUTH.lon - o.lon) * o.mPerDegLon, an = (SOUTH.lat - o.lat) * o.mPerDegLat;
  const bx = (NORTH.lon - o.lon) * o.mPerDegLon, bn = (NORTH.lat - o.lat) * o.mPerDegLat;
  const heading = Math.atan2(bn - an, bx - ax);
  return {
    name: 'Aeroclub de Villa General Belgrano',
    x: (ax + bx) / 2, n: (an + bn) / 2,
    heading, length: Math.hypot(bx - ax, bn - an), width: 30,
    spawn: { x: ax + Math.cos(heading) * 42, n: an + Math.sin(heading) * 42, heading },
  };
}

function coordinates(a: AirfieldLocation, along: number, across: number): { x: number; n: number } {
  const c = Math.cos(a.heading), s = Math.sin(a.heading);
  return { x: a.x + along * c - across * s, n: a.n + along * s + across * c };
}

/** Must run before vegetation, buildings, terrain and their collision indices are created. */
export function prepareAirfield(world: WorldData): void {
  const a = getAirfield(world), c = Math.cos(a.heading), s = Math.sin(a.heading);
  const isClearArea = (x: number, n: number, radius: number): boolean => {
    const dx = x - a.x, dn = n - a.n;
    const along = dx * c + dn * s, across = -dx * s + dn * c;
    // Include a short departure strip and room for the wings beyond the turf edges.
    const runway = Math.abs(along) < a.length / 2 + 100 + radius && Math.abs(across) < a.width / 2 + 10 + radius;
    const apron = Math.abs(along + 20) < 48 + radius && Math.abs(across + 50) < 32 + radius;
    return runway || apron;
  };
  const trees: number[] = [];
  for (let i = 0; i < world.trees.length; i += 4) {
    const t = world.trees;
    if (!isClearArea(t[i], t[i + 1], 4 * t[i + 2])) trees.push(t[i], t[i + 1], t[i + 2], t[i + 3]);
  }
  world.trees = new Float32Array(trees);
  world.buildings = world.buildings.filter((b) => !isClearArea(b.x, b.n, Math.hypot(b.w, b.d) / 2));

  // Keep the actual DEM heights: runway rendering and aircraft ground contact share them.
  const t = world.meta.terrain;
  const radius = a.length / 2 + 115;
  const i0 = Math.max(0, Math.floor((a.x - radius - t.x0) / t.step));
  const i1 = Math.min(t.W - 1, Math.ceil((a.x + radius - t.x0) / t.step));
  const j0 = Math.max(0, Math.floor((a.n - radius - t.n0) / t.step));
  const j1 = Math.min(t.H - 1, Math.ceil((a.n + radius - t.n0) / t.step));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (isClearArea(t.x0 + i * t.step, t.n0 + j * t.step, 0)) world.ground[j * t.W + i] = GROUND.LAWN;
  }
}

/** A recognizable, terrain-following grass airstrip in the real aeroclub location. */
export class Airfield {
  readonly group = new THREE.Group();
  readonly colliders: BoxCollider[] = [];
  private readonly location: AirfieldLocation;

  constructor(private world: WorldData, scene: THREE.Scene) {
    const a = this.location = getAirfield(world);
    this.group.name = 'Aeroclub Villa General Belgrano';
    const turf = paintedMaterial({ color: 0xb0a777, brushScale: 0.4, brushAmount: 0.18, polygonOffset: 2 });
    const white = paintedMaterial({ color: 0xf4efe0, brushAmount: 0.06, polygonOffset: 4 });
    this.patch(0, 0, a.length, a.width, turf, 0.10);
    this.patch(-20, -38, 88, 47, paintedMaterial({ color: 0xb5aa84, brushAmount: 0.15, polygonOffset: 2 }), 0.11);

    // Small, visible ground markers suit the grass field and aid the first takeoff.
    for (let along = -a.length / 2 + 10; along <= a.length / 2 - 10; along += 42) {
      for (const across of [-a.width / 2, a.width / 2]) this.patch(along, across, 4, 1.4, white, 0.18);
    }
    for (const end of [-1, 1]) {
      const along = end * (a.length / 2 - 10);
      this.patch(along, 0, 2.5, a.width - 3, white, 0.18);
      for (const across of [-8, -4, 4, 8]) this.patch(along - end * 9, across, 9, 1.6, white, 0.18);
    }
    this.hangar();
    this.windsock(-a.length / 2 + 100, -26);
    scene.add(this.group);
  }

  private patch(along: number, across: number, length: number, width: number, material: THREE.Material, lift: number): void {
    const nx = Math.ceil(length / 2), nz = Math.ceil(width / 2);
    const pos: number[] = [], indices: number[] = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const p = coordinates(this.location, along + length * (i / nx - 0.5), across + width * (j / nz - 0.5));
      pos.push(p.x, this.world.heightAt(p.x, p.n) + lift, -p.n);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const v = j * (nx + 1) + i;
      indices.push(v, v + 1, v + nx + 2, v, v + nx + 2, v + nx + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(indices); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private hangar(): void {
    const p = coordinates(this.location, -20, -55);
    const y = this.world.heightAt(p.x, p.n);
    const g = new THREE.Group();
    g.position.set(p.x, y, -p.n);
    g.rotation.y = this.location.heading;
    const wall = paintedMaterial({ color: 0xd5d3c3, brushAmount: 0.12 });
    const roof = paintedMaterial({ color: 0x486c75, brushAmount: 0.14 });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh;
    };
    box(24, 7, 18, 0, 3.2, 0, wall);
    for (const side of [-1, 1]) {
      const panel = box(12.8, 0.45, 19.5, side * 6, 7.2, 0, roof);
      panel.rotation.z = -side * 0.13;
    }
    box(19, 5.1, 0.2, 0, 2.6, -9.15, paintedMaterial({ color: 0x294952, brushAmount: 0.05 }));
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#23464f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff9e8'; ctx.textAlign = 'center';
    ctx.font = 'bold 60px sans-serif'; ctx.fillText('AEROCLUB', 512, 102);
    ctx.font = '34px sans-serif'; ctx.fillText('VILLA GENERAL BELGRANO', 512, 176);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(15.5, 3.9), new THREE.MeshBasicMaterial({ map: texture }));
    sign.position.set(0, 7.8, -9.3); sign.rotation.y = Math.PI; g.add(sign);
    this.group.add(g);
    this.colliders.push({ x: p.x, y: y + 3.7, z: -p.n, hx: 12.5, hy: 4.2, hz: 9.75, rotY: this.location.heading });
  }

  private windsock(along: number, across: number): void {
    const p = coordinates(this.location, along, across), y = this.world.heightAt(p.x, p.n);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 6, 6), paintedMaterial({ color: 0xe5e2d4 }));
    pole.position.set(p.x, y + 3, -p.n); this.group.add(pole);
    const sock = new THREE.Group(); sock.position.set(p.x, y + 5.8, -p.n);
    sock.rotation.z = -Math.PI / 2 - 0.18;
    for (let i = 0; i < 5; i++) {
      const r0 = 0.5 - i * 0.07, r1 = r0 - 0.07;
      const segment = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 0.5, 10, 1, true), paintedMaterial({ color: i % 2 ? 0xfff7e5 : 0xe97332, side: THREE.DoubleSide }));
      segment.position.y = i * 0.5 + 0.25; sock.add(segment);
    }
    this.group.add(sock);
  }
}
