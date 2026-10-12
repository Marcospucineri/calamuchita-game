import * as THREE from 'three';
import { PALETTE } from '../core/Config';
import { paintedMaterial } from '../render/PaintedMaterial';
import { GROUND, WorldData } from './WorldData';

const CHUNK = 64; // celdas por lado (64 × 10 m = 640 m)
const LODS = [1, 2, 4, 8];

interface Chunk {
  ci: number;
  cj: number;
  center: THREE.Vector3;
  lod: number;
  mesh: THREE.Mesh | null;
  cache: Map<number, THREE.BufferGeometry>;
}

const C = (hex: number) => new THREE.Color(hex);
const GROUND_COLORS: Record<number, THREE.Color> = {
  [GROUND.PASTURE]: C(PALETTE.grass),
  [GROUND.FIELD]: C(PALETTE.grassDry),
  [GROUND.FOREST]: C(PALETTE.forestFloor),
  [GROUND.URBAN]: C(PALETTE.urban),
  [GROUND.SHOULDER]: C(PALETTE.dirt),
  [GROUND.BANK]: C(PALETTE.sand),
  [GROUND.LAWN]: C(PALETTE.lawn),
};
const ROCK = C(PALETTE.rock);
const HIGH = C(0x8f8a5a);

/**
 * Terreno por chunks con LOD (saltos de 1/2/4/8 celdas) y "polleras" para tapar grietas.
 * Los colores salen del tipo de suelo de OSM + pendiente + altura.
 */
export class Terrain {
  readonly group = new THREE.Group();
  private chunks: Chunk[] = [];
  private material: THREE.Material;
  private colors: Float32Array; // color precalculado por vértice de la grilla completa
  private normals: Float32Array;
  private farMesh: THREE.Mesh;

  constructor(private w: WorldData, scene: THREE.Scene, private lodDist: [number, number, number]) {
    this.material = paintedMaterial({ vertexColors: true, brushScale: 0.045, brushAmount: 0.28, rim: 0.05, side: THREE.DoubleSide });
    const t = w.meta.terrain;
    this.normals = this.computeNormals();
    this.colors = this.computeColors();
    const nci = Math.ceil((t.W - 1) / CHUNK), ncj = Math.ceil((t.H - 1) / CHUNK);
    for (let cj = 0; cj < ncj; cj++)
      for (let ci = 0; ci < nci; ci++) {
        const cx = t.x0 + (ci + 0.5) * CHUNK * t.step, cn = t.n0 + (cj + 0.5) * CHUNK * t.step;
        this.chunks.push({ ci, cj, center: new THREE.Vector3(cx, w.heightAt(cx, cn), -cn), lod: -1, mesh: null, cache: new Map() });
      }
    this.farMesh = this.buildFar();
    this.group.add(this.farMesh);
    scene.add(this.group);
  }

  private computeNormals(): Float32Array {
    const t = this.w.meta.terrain, h = this.w.heights, W = t.W, H = t.H, s = t.step;
    const out = new Float32Array(W * H * 3);
    const v = new THREE.Vector3();
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const hl = h[j * W + Math.max(0, i - 1)], hr = h[j * W + Math.min(W - 1, i + 1)];
        const hd = h[Math.max(0, j - 1) * W + i], hu = h[Math.min(H - 1, j + 1) * W + i];
        // Three: X = x, Z = -n
        v.set(hl - hr, 2 * s, hu - hd).normalize();
        out.set([v.x, v.y, v.z], (j * W + i) * 3);
      }
    return out;
  }

  private computeColors(): Float32Array {
    const t = this.w.meta.terrain, W = t.W, H = t.H;
    const out = new Float32Array(W * H * 3);
    const c = new THREE.Color();
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const id = j * W + i;
        const g = this.w.ground[id];
        c.copy(GROUND_COLORS[g] ?? GROUND_COLORS[0]);
        const ny = this.normals[id * 3 + 1];
        const hgt = this.w.heights[id];
        // laderas empinadas: roca; alturas: pasto serrano más pálido
        const slope = 1 - ny;
        if (g !== GROUND.SHOULDER && g !== GROUND.BANK) {
          c.lerp(HIGH, THREE.MathUtils.smoothstep(hgt, 900, 1150) * 0.6);
          c.lerp(ROCK, THREE.MathUtils.smoothstep(slope, 0.12, 0.3) * 0.85);
        }
        // variación de baja frecuencia para que no quede uniforme
        const x = t.x0 + i * t.step, n = t.n0 + j * t.step;
        const v = Math.sin(x * 0.013 + Math.sin(n * 0.011) * 1.7) * 0.5 + Math.sin(n * 0.017 - x * 0.006) * 0.5;
        c.offsetHSL(v * 0.012, v * 0.04, v * 0.035);
        out[id * 3] = c.r; out[id * 3 + 1] = c.g; out[id * 3 + 2] = c.b;
      }
    return out;
  }

  private buildChunk(ch: Chunk, lod: number): THREE.BufferGeometry {
    const t = this.w.meta.terrain, W = t.W, H = t.H, s = t.step;
    const i0 = ch.ci * CHUNK, j0 = ch.cj * CHUNK;
    const i1 = Math.min(i0 + CHUNK, W - 1), j1 = Math.min(j0 + CHUNK, H - 1);
    const xs: number[] = [], js: number[] = [];
    for (let i = i0; i < i1; i += lod) xs.push(i);
    xs.push(i1);
    for (let j = j0; j < j1; j += lod) js.push(j);
    js.push(j1);
    const nx = xs.length, nj = js.length;
    const skirt = 4 * (nx + nj);
    const vcount = nx * nj + skirt * 1;
    const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3), col = new Float32Array(vcount * 3);
    let v = 0;
    const put = (i: number, j: number, drop: number) => {
      const id = j * W + i;
      pos[v * 3] = t.x0 + i * s;
      pos[v * 3 + 1] = this.w.heights[id] - drop;
      pos[v * 3 + 2] = -(t.n0 + j * s);
      nor.set(this.normals.subarray(id * 3, id * 3 + 3), v * 3);
      col.set(this.colors.subarray(id * 3, id * 3 + 3), v * 3);
      return v++;
    };
    for (let b = 0; b < nj; b++) for (let a = 0; a < nx; a++) put(xs[a], js[b], 0);
    const index: number[] = [];
    const g = (a: number, b: number) => b * nx + a;
    for (let b = 0; b < nj - 1; b++)
      for (let a = 0; a < nx - 1; a++) {
        const p00 = g(a, b), p10 = g(a + 1, b), p01 = g(a, b + 1), p11 = g(a + 1, b + 1);
        // diagonal (i,j)-(i+1,j+1), CCW visto desde arriba (Z = -n)
        index.push(p00, p10, p11, p00, p11, p01);
      }
    // polleras
    const drop = 6 * lod;
    const edge = (verts: number[], flip: boolean) => {
      for (let k = 0; k < verts.length - 1; k++) {
        const a = verts[k], b = verts[k + 1];
        const ia = Math.round((pos[a * 3] - t.x0) / s), ja = Math.round((-pos[a * 3 + 2] - t.n0) / s);
        const ib = Math.round((pos[b * 3] - t.x0) / s), jb = Math.round((-pos[b * 3 + 2] - t.n0) / s);
        const sa = put(ia, ja, drop), sb = put(ib, jb, drop);
        if (flip) index.push(a, sa, b, b, sa, sb);
        else index.push(a, b, sa, b, sb, sa);
      }
    };
    const bottom = xs.map((_, a) => g(a, 0));
    const top = xs.map((_, a) => g(a, nj - 1));
    const left = js.map((_, b) => g(0, b));
    const right = js.map((_, b) => g(nx - 1, b));
    edge(bottom, false);
    edge(top, true);
    edge(left, true);
    edge(right, false);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, v * 3), 3));
    geo.setIndex(index);
    geo.computeBoundingSphere();
    return geo;
  }

  private buildFar(): THREE.Mesh {
    const f = this.w.meta.far, W = f.W, H = f.H;
    const pos = new Float32Array(W * H * 3), col = new Float32Array(W * H * 3);
    const c = new THREE.Color();
    const base = C(0x7f8a4a), high = C(0x9a9670), rock = C(0x8c8579);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const id = j * W + i;
        const hgt = this.w.far[id];
        pos.set([f.x0 + i * f.step, hgt, -(f.n0 + j * f.step)], id * 3);
        c.copy(base).lerp(high, THREE.MathUtils.smoothstep(hgt, 900, 1700)).lerp(rock, THREE.MathUtils.smoothstep(hgt, 1800, 2600) * 0.7);
        col.set([c.r, c.g, c.b], id * 3);
      }
    const index: number[] = [];
    for (let j = 0; j < H - 1; j++)
      for (let i = 0; i < W - 1; i++) {
        const a = j * W + i, b = a + 1, cc = a + W, d = cc + 1;
        index.push(a, b, d, a, d, cc);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, paintedMaterial({ vertexColors: true, brushScale: 0.004, brushAmount: 0.3, rim: 0 }));
    m.receiveShadow = false;
    return m;
  }

  update(cam: THREE.Vector3): void {
    const [d1, d2, d3] = this.lodDist;
    for (const ch of this.chunks) {
      const d = Math.hypot(ch.center.x - cam.x, ch.center.z - cam.z) - CHUNK * 5;
      const lod = d < d1 ? 0 : d < d2 ? 1 : d < d3 ? 2 : 3;
      if (lod === ch.lod) continue;
      ch.lod = lod;
      let geo = ch.cache.get(lod);
      if (!geo) {
        geo = this.buildChunk(ch, LODS[lod]);
        ch.cache.set(lod, geo);
      }
      if (!ch.mesh) {
        ch.mesh = new THREE.Mesh(geo, this.material);
        ch.mesh.receiveShadow = true;
        this.group.add(ch.mesh);
      } else ch.mesh.geometry = geo;
      // liberar geometrías de alto detalle que quedaron lejos
      if (lod >= 2) for (const k of [0, 1]) { const gg = ch.cache.get(k); if (gg) { gg.dispose(); ch.cache.delete(k); } }
    }
  }
}
