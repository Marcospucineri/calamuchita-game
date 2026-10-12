import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../core/Config';
import { paintedMaterial } from '../render/PaintedMaterial';
import { WorldData } from './WorldData';

/** Tipos: 0 pino, 1 latifoliada (algarrobo/acacia), 2 arbusto/espinillo, 3 sauce. */
const TYPES = 4;

let s = 99;
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

function colorize(g: THREE.BufferGeometry, color: THREE.Color, dark = 0.75, light = 1.1): THREE.BufferGeometry {
  g = g.index ? g.toNonIndexed() : g;
  const pos = g.attributes.position;
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y || 1);
    c.copy(color).multiplyScalar(THREE.MathUtils.lerp(dark, light, t));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function jitter(g: THREE.BufferGeometry, amt: number): THREE.BufferGeometry {
  const p = g.attributes.position;
  const seen = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let d = seen.get(k);
    if (!d) seen.set(k, (d = [(rnd() - 0.5) * amt, (rnd() - 0.5) * amt * 0.6, (rnd() - 0.5) * amt]));
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  return g;
}

function trunk(h: number, r: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r * 0.7, r, h, 6);
  g.translate(0, h / 2, 0);
  return colorize(g, new THREE.Color(PALETTE.trunk), 0.8, 1);
}

function pine(lowPoly: boolean): THREE.BufferGeometry {
  const parts = [trunk(3, 0.28)];
  const layers = lowPoly ? 2 : 5;
  const seg = lowPoly ? 5 : 8;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1 || 1);
    const r = THREE.MathUtils.lerp(3.2, 1.0, t);
    const h = THREE.MathUtils.lerp(4.2, 3.0, t) * (lowPoly ? 1.9 : 1);
    const cone = new THREE.ConeGeometry(r, h, seg, 1, true);
    cone.translate(0, 2.2 + i * (lowPoly ? 4.2 : 2.15) + h / 2, 0);
    if (!lowPoly) jitter(cone, 0.55);
    const shade = new THREE.Color(PALETTE.pine).lerp(new THREE.Color(PALETTE.pineLight), t * 0.6);
    parts.push(colorize(cone, shade, 0.7, 1.25));
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

function blobTree(color: number, trunkH: number, lowPoly: boolean, blobs: [number, number, number, number][]): THREE.BufferGeometry {
  const parts = [trunk(trunkH, 0.25)];
  for (const [x, y, z, r] of lowPoly ? blobs.slice(0, 1) : blobs) {
    const b = new THREE.IcosahedronGeometry(lowPoly ? r * 1.3 : r, lowPoly ? 0 : 1);
    if (!lowPoly) jitter(b, r * 0.35);
    b.translate(x, y, z);
    parts.push(colorize(b, new THREE.Color(color), 0.65, 1.2));
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

function willow(lowPoly: boolean): THREE.BufferGeometry {
  const parts = [trunk(2.8, 0.35)];
  const crown = new THREE.SphereGeometry(3.4, lowPoly ? 5 : 9, lowPoly ? 4 : 7, 0, Math.PI * 2, 0, Math.PI * 0.62);
  crown.scale(1, 1.15, 1);
  crown.translate(0, 3.0, 0);
  if (!lowPoly) jitter(crown, 0.5);
  parts.push(colorize(crown, new THREE.Color(0x8a9c3e), 0.7, 1.15));
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

/** Versiones lejanas: una sola forma sin tronco (8–10 triángulos). */
function farBlob(color: number, r: number, y: number, sy = 1): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(r, 0);
  g.scale(1, sy, 1);
  g.translate(0, y, 0);
  return colorize(g, new THREE.Color(color), 0.7, 1.15);
}

function geometries(lowPoly: boolean): THREE.BufferGeometry[] {
  if (lowPoly) {
    const cone = new THREE.ConeGeometry(2.9, 10.5, 5, 1, true);
    cone.translate(0, 6.4, 0);
    return [
      colorize(cone, new THREE.Color(PALETTE.pine), 0.7, 1.2),
      farBlob(PALETTE.broadleaf, 3.0, 4.2, 0.85),
      farBlob(0x7a8a3e, 1.5, 1.0, 0.7),
      farBlob(0x8a9c3e, 3.4, 3.6, 0.9),
    ];
  }
  return [
    pine(false),
    blobTree(PALETTE.broadleaf, 2.4, false, [[0, 4.2, 0, 2.6], [1.4, 3.6, 0.6, 1.8], [-1.3, 3.8, -0.5, 1.9], [0.2, 5.4, -0.8, 1.6]]),
    blobTree(0x7a8a3e, 0.6, false, [[0, 1.1, 0, 1.3], [0.9, 0.9, 0.3, 0.9], [-0.8, 1.0, -0.2, 1.0]]),
    willow(false),
  ];
}

/**
 * Vegetación instanciada: cerca (detallada, con sombra) y lejos (low-poly).
 * Las instancias se recalculan cuando el jugador se mueve lo suficiente.
 */
export class Vegetation {
  private near: THREE.InstancedMesh[] = [];
  private far: THREE.InstancedMesh[] = [];
  private ys: Float32Array;
  private rot: Float32Array;
  private tint: Float32Array;
  private lastCenter = new THREE.Vector3(1e9, 0, 1e9);
  private count: number;
  private grid = new Map<string, number[]>();
  static CELL = 100;

  constructor(private w: WorldData, scene: THREE.Scene, private nearR: number, private farR: number, shadows: boolean) {
    const t = w.trees;
    this.count = t.length / 4;
    this.ys = new Float32Array(this.count);
    this.rot = new Float32Array(this.count);
    this.tint = new Float32Array(this.count);
    const perType = new Array(TYPES).fill(0);
    for (let i = 0; i < this.count; i++) {
      const x = t[i * 4], n = t[i * 4 + 1];
      this.ys[i] = w.heightAt(x, n) - 0.15;
      this.rot[i] = rnd() * Math.PI * 2;
      this.tint[i] = rnd();
      perType[t[i * 4 + 3]]++;
      const k = `${Math.floor(x / Vegetation.CELL)},${Math.floor(n / Vegetation.CELL)}`;
      let l = this.grid.get(k);
      if (!l) this.grid.set(k, (l = []));
      l.push(i);
    }
    const mat = paintedMaterial({ vertexColors: true, brushScale: 0.9, brushAmount: 0.25, rim: 0.25 });
    const nearG = geometries(false), farG = geometries(true);
    for (let ty = 0; ty < TYPES; ty++) {
      const nm = new THREE.InstancedMesh(nearG[ty], mat, Math.max(1, Math.min(perType[ty], 60000)));
      nm.castShadow = shadows;
      nm.receiveShadow = true;
      nm.count = 0;
      nm.frustumCulled = false;
      const fm = new THREE.InstancedMesh(farG[ty], mat, Math.max(1, Math.min(perType[ty], 140000)));
      fm.count = 0;
      fm.frustumCulled = false;
      this.near.push(nm);
      this.far.push(fm);
      scene.add(nm, fm);
    }
  }

  /** Índices de árboles dentro de un radio (para colisiones). */
  treesNear(x: number, n: number, r: number): number[] {
    const C = Vegetation.CELL, out: number[] = [];
    for (let gx = Math.floor((x - r) / C); gx <= Math.floor((x + r) / C); gx++)
      for (let gn = Math.floor((n - r) / C); gn <= Math.floor((n + r) / C); gn++) {
        const l = this.grid.get(`${gx},${gn}`);
        if (l) for (const i of l) if (Math.hypot(this.w.trees[i * 4] - x, this.w.trees[i * 4 + 1] - n) < r) out.push(i);
      }
    return out;
  }

  treeInfo(i: number): { x: number; n: number; y: number; scale: number; type: number } {
    const t = this.w.trees;
    return { x: t[i * 4], n: t[i * 4 + 1], y: this.ys[i], scale: t[i * 4 + 2], type: t[i * 4 + 3] };
  }

  private lastFar = new THREE.Vector3(1e9, 0, 1e9);

  /** Cerca: cada 30 m (radio chico, barato). Lejos: cada 220 m. */
  update(center: THREE.Vector3, force = false): void {
    if (force || Math.hypot(center.x - this.lastCenter.x, center.z - this.lastCenter.z) > 30) {
      this.lastCenter.copy(center);
      this.fill(center, true);
    }
    if (force || Math.hypot(center.x - this.lastFar.x, center.z - this.lastFar.z) > 220) {
      this.lastFar.copy(center);
      this.fill(center, false);
    }
  }

  private fill(center: THREE.Vector3, near: boolean): void {
    const t = this.w.trees;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    const cnt = new Array(TYPES).fill(0);
    const meshes = near ? this.near : this.far;
    const cx = center.x, cn = -center.z;
    const nr2 = this.nearR * this.nearR, fr2 = this.farR * this.farR;
    // el anillo lejano empieza un poco antes del radio cercano para no dejar huecos al moverse
    const inner2 = near ? 0 : (this.nearR - 40) ** 2;
    const R = near ? this.nearR : this.farR;
    const C = Vegetation.CELL;
    for (let gx = Math.floor((cx - R) / C); gx <= Math.floor((cx + R) / C); gx++)
      for (let gn = Math.floor((cn - R) / C); gn <= Math.floor((cn + R) / C); gn++) {
        const l = this.grid.get(`${gx},${gn}`);
        if (!l) continue;
        for (const i of l) {
          const x = t[i * 4], n = t[i * 4 + 1];
          const d2 = (x - cx) ** 2 + (n - cn) ** 2;
          if (near ? d2 > nr2 : d2 > fr2 || d2 < inner2) continue;
          if (!near && (i & 1) && d2 > nr2 * 4) continue; // muy lejos, la mitad alcanza
          const ty = t[i * 4 + 3];
          const mesh = meshes[ty];
          const k = cnt[ty];
          if (k >= mesh.instanceMatrix.count) continue;
          const scl = t[i * 4 + 2] * (near ? 1 : 1.06);
          q.setFromAxisAngle(up, this.rot[i]);
          sc.set(scl, scl * (0.9 + this.tint[i] * 0.25), scl);
          p.set(x, this.ys[i] - (near ? 0 : 0.3), -n);
          m.compose(p, q, sc);
          mesh.setMatrixAt(k, m);
          const tv = this.tint[i];
          c.setRGB(0.85 + tv * 0.25, 0.9 + tv * 0.15, 0.85 + (1 - tv) * 0.2);
          mesh.setColorAt(k, c);
          cnt[ty]++;
        }
      }
    for (let ty = 0; ty < TYPES; ty++) {
      const mesh = meshes[ty];
      mesh.count = cnt[ty];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
