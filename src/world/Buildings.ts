import * as THREE from 'three';
import { paintedMaterial } from '../render/PaintedMaterial';
import { clockTexture, roofTexture, stoneTexture, wallTexture } from '../render/Textures';
import { Building, WorldData } from './WorldData';

interface Builder { pos: number[]; uv: number[]; idx: number[] }
export interface BoxCollider { x: number; y: number; z: number; hx: number; hy: number; hz: number; rotY: number }

const TILE = 800;
const FLOOR = 3;

type RoofKind = 'teja' | 'chapa' | 'tejuela';
const ROOF: Record<string, { kind: RoofKind; pitch: number; overhang: number }> = {
  alpino: { kind: 'teja', pitch: 0.9, overhang: 0.8 },
  criollo: { kind: 'teja', pitch: 0.32, overhang: 0.5 },
  serrano: { kind: 'tejuela', pitch: 1.0, overhang: 0.7 },
  rural: { kind: 'chapa', pitch: 0.25, overhang: 0.4 },
  comun: { kind: 'teja', pitch: 0.42, overhang: 0.55 },
  // locales comerciales (Los Reartes, Villa Ciudad Parque): techo de chapa casi plano
  localA: { kind: 'chapa', pitch: 0.16, overhang: 0.35 },
  localB: { kind: 'chapa', pitch: 0.16, overhang: 0.35 },
  localC: { kind: 'chapa', pitch: 0.16, overhang: 0.35 },
  // casas de categoría (barrio cerrado Champaquí Golf)
  premium: { kind: 'teja', pitch: 0.36, overhang: 0.9 },
};

/** Transforma coordenadas locales del edificio (a: a lo largo, b: profundidad) a Three. */
function T(b: Building, a: number, bb: number, y: number): [number, number, number] {
  const c = Math.cos(b.r), s = Math.sin(b.r);
  return [b.x + a * c - bb * s, y, -(b.n + a * s + bb * c)];
}

function quad(B: Builder, p: [number, number, number][], uv: number[]): void {
  const base = B.pos.length / 3;
  for (const v of p) B.pos.push(...v);
  B.uv.push(...uv);
  B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function tri(B: Builder, p: [number, number, number][], uv: number[]): void {
  const base = B.pos.length / 3;
  for (const v of p) B.pos.push(...v);
  B.uv.push(...uv);
  B.idx.push(base, base + 1, base + 2);
}

function toGeo(b: Builder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setIndex(b.idx);
  g.computeVertexNormals();
  return g;
}

/** Casas (de OSM y procedurales) por estilo de cada pueblo + hitos únicos. */
export class Buildings {
  readonly group = new THREE.Group();
  readonly colliders: BoxCollider[] = [];

  constructor(private w: WorldData, scene: THREE.Scene) {
    const walls = new Map<string, Builder>();
    const roofs = new Map<string, Builder>();
    const getB = (m: Map<string, Builder>, k: string) => { let b = m.get(k); if (!b) m.set(k, (b = { pos: [], uv: [], idx: [] })); return b; };

    for (const b of w.buildings) {
      if (b.k === 'church' || b.k === 'chapel') continue; // se dibujan como hitos
      const style = ROOF[b.s] ? b.s : 'rural';
      const tile = `${Math.floor(b.x / TILE)},${Math.floor(b.n / TILE)}`;
      this.house(b, style, getB(walls, `${tile}|${style}`), getB(roofs, `${tile}|${ROOF[style].kind}`));
    }

    const wallMats: Record<string, THREE.Material> = {};
    for (const s of Object.keys(ROOF)) wallMats[s] = paintedMaterial({ map: wallTexture(s), brushScale: 0.6, brushAmount: 0.12, side: THREE.DoubleSide });
    const roofMats: Record<string, THREE.Material> = {};
    for (const k of ['teja', 'chapa', 'tejuela'] as RoofKind[]) roofMats[k] = paintedMaterial({ map: roofTexture(k), brushScale: 0.5, brushAmount: 0.15, side: THREE.DoubleSide });

    for (const [k, b] of walls) {
      const m = new THREE.Mesh(toGeo(b), wallMats[k.split('|')[1]]);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
    for (const [k, b] of roofs) {
      const m = new THREE.Mesh(toGeo(b), roofMats[k.split('|')[1]]);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }

    this.landmarks();
    scene.add(this.group);
  }

  private house(b: Building, style: string, W: Builder, R: Builder): void {
    const cfg = ROOF[style];
    const hw = b.w / 2, hd = b.d / 2;
    const y0 = b.y - 1.5;
    const top = b.y + b.l * FLOOR + 0.4;
    const vb = (y: number) => (y - b.y) / FLOOR;
    // paredes
    const corners: [number, number][] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    for (let k = 0; k < 4; k++) {
      const [a1, b1] = corners[k], [a2, b2] = corners[(k + 1) % 4];
      const len = Math.hypot(a2 - a1, b2 - b1) / 4;
      quad(W, [T(b, a1, b1, y0), T(b, a2, b2, y0), T(b, a2, b2, top), T(b, a1, b1, top)], [0, vb(y0), len, vb(y0), len, vb(top), 0, vb(top)]);
    }
    // techo a dos aguas, cumbrera a lo largo del lado más largo
    const alongX = b.w >= b.d;
    const L = alongX ? hw : hd, S = alongX ? hd : hw; // semilargo, semiancho
    const oh = cfg.overhang;
    const rise = S * cfg.pitch;
    const P = (along: number, across: number, y: number) => (alongX ? T(b, along, across, y) : T(b, across, along, y));
    const eave = top - oh * cfg.pitch;
    const ridge = top + rise;
    const slopeLen = Math.hypot(S + oh, rise + oh * cfg.pitch) / 3;
    const ul = (2 * (L + oh)) / 3;
    // dos faldones
    quad(R, [P(-L - oh, -S - oh, eave), P(L + oh, -S - oh, eave), P(L + oh, 0, ridge), P(-L - oh, 0, ridge)], [0, 0, ul, 0, ul, slopeLen, 0, slopeLen]);
    quad(R, [P(L + oh, S + oh, eave), P(-L - oh, S + oh, eave), P(-L - oh, 0, ridge), P(L + oh, 0, ridge)], [0, 0, ul, 0, ul, slopeLen, 0, slopeLen]);
    // hastiales
    for (const e of [-L, L]) {
      tri(W, [P(e, -S, top), P(e, S, top), P(e, 0, ridge)], [0, vb(top), (2 * S) / 4, vb(top), S / 4, vb(ridge)]);
    }
    // balcón de madera en las casas alpinas de dos pisos
    if (style === 'alpino' && b.l >= 2) {
      const yb = b.y + FLOOR;
      const front = alongX ? -S : -S;
      quad(R, [P(-L * 0.7, front - 1.2, yb), P(L * 0.7, front - 1.2, yb), P(L * 0.7, front, yb), P(-L * 0.7, front, yb)], [0, 0, 1, 0, 1, 0.3, 0, 0.3]);
      quad(W, [P(-L * 0.7, front - 1.2, yb), P(L * 0.7, front - 1.2, yb), P(L * 0.7, front - 1.2, yb + 1), P(-L * 0.7, front - 1.2, yb + 1)], [0, 0.95, 1, 0.95, 1, 1, 0, 1]);
    }
    const cx = b.x, cn = b.n;
    this.colliders.push({ x: cx, y: (y0 + top) / 2, z: -cn, hx: hw, hy: (top - y0) / 2, hz: hd, rotY: b.r });
  }

  private landmarks(): void {
    const stoneMat = paintedMaterial({ map: stoneTexture(), brushScale: 0.5 });
    const woodMat = paintedMaterial({ color: 0x7a4a2a, brushScale: 0.8 });
    const whiteMat = paintedMaterial({ color: 0xf2ece0, brushScale: 0.5 });
    const roofMat = paintedMaterial({ map: roofTexture('teja'), brushScale: 0.5, side: THREE.DoubleSide });
    const darkRoof = paintedMaterial({ color: 0x4d3a2e, brushScale: 0.5 });
    const add = (m: THREE.Object3D) => { m.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } }); this.group.add(m); };

    for (const p of this.w.pois) {
      const name = p.name.toLowerCase();
      const y = this.w.heightAt(p.x, p.n);
      const nr = this.w.nearestRoad(p.x, p.n);
      // correr el hito fuera de la calle
      let x = p.x, n = p.n, rot = 0;
      if (nr) {
        rot = Math.atan2(nr.dirN, nr.dirX);
        const need = nr.road.width / 2 + 7 - nr.dist;
        if (need > 0) {
          const ox = -nr.dirN, on = nr.dirX;
          const sgn = (p.x - x) * ox + (p.n - n) * on >= 0 ? 1 : 1;
          x += ox * need * sgn; n += on * need * sgn;
        }
      }
      const yy = this.w.heightAt(x, n);
      if (name.includes('torre del reloj')) {
        const g = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 5), stoneMat); base.position.y = 1.6; g.add(base);
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(3.8, 14, 3.8), whiteMat); shaft.position.y = 10.5; g.add(shaft);
        const beams = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.35, 4.0), woodMat);
        for (const hy of [6, 12, 17.3]) { const bm = beams.clone(); bm.position.y = hy; g.add(bm); }
        const clock = clockTexture();
        for (let k = 0; k < 4; k++) {
          const face = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), paintedMaterial({ map: clock, brushAmount: 0.05 }));
          face.position.set(Math.sin((k * Math.PI) / 2) * 1.92, 15, Math.cos((k * Math.PI) / 2) * 1.92);
          face.rotation.y = (k * Math.PI) / 2;
          g.add(face);
        }
        const belfry = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3, 3.4), woodMat); belfry.position.y = 19; g.add(belfry);
        const spire = new THREE.Mesh(new THREE.ConeGeometry(3.3, 7, 4), darkRoof); spire.position.y = 24; spire.rotation.y = Math.PI / 4; g.add(spire);
        g.position.set(x, yy - 0.4, -n);
        g.rotation.y = rot;
        add(g);
        this.colliders.push({ x, y: yy + 10, z: -n, hx: 2.5, hy: 10, hz: 2.5, rotY: rot });
      } else if (p.kind === 'place_of_worship' && name.includes('capilla')) {
        const g = new THREE.Group();
        const nave = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 7), whiteMat); nave.position.y = 2.6; g.add(nave);
        const tri = new THREE.Shape([new THREE.Vector2(-4.4, 0), new THREE.Vector2(4.4, 0), new THREE.Vector2(0, 3.2)]);
        const roofGeo = new THREE.ExtrudeGeometry(tri, { depth: 14.8, bevelEnabled: false });
        roofGeo.translate(0, 0, -7.4);
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.rotation.y = Math.PI / 2; roof.position.y = 5.6; g.add(roof);
        // espadaña
        const bell = new THREE.Mesh(new THREE.BoxGeometry(1.2, 4.5, 5), whiteMat); bell.position.set(-7.4, 7.5, 0); g.add(bell);
        const arch = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 1.3), paintedMaterial({ color: 0x3a3a3a })); arch.position.set(-7.4, 8.2, 0); g.add(arch);
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.4, 0.2), woodMat); cross.position.set(-7.4, 10.4, 0); g.add(cross);
        const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.8), woodMat); cross2.position.set(-7.4, 10.6, 0); g.add(cross2);
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 2), woodMat); door.position.set(-7.05, 1.2, 0); g.add(door);
        g.position.set(x, yy - 0.3, -n);
        g.rotation.y = rot;
        add(g);
        this.colliders.push({ x, y: yy + 3, z: -n, hx: 7.5, hy: 3.5, hz: 3.5, rotY: rot });
      } else if (name.includes('castillo')) {
        const g = new THREE.Group();
        const keep = new THREE.Mesh(new THREE.BoxGeometry(9, 8, 9), stoneMat); keep.position.y = 3.6; g.add(keep);
        for (const [ox, oz] of [[-4.5, -4.5], [4.5, -4.5], [4.5, 4.5], [-4.5, 4.5]]) {
          const tw = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 11, 10), stoneMat); tw.position.set(ox, 5, oz); g.add(tw);
          const cone = new THREE.Mesh(new THREE.ConeGeometry(2.1, 3.2, 10), roofMat); cone.position.set(ox, 12.1, oz); g.add(cone);
        }
        g.position.set(x, yy - 0.3, -n);
        g.rotation.y = rot;
        add(g);
        this.colliders.push({ x, y: yy + 5, z: -n, hx: 6, hy: 5.5, hz: 6, rotY: rot });
      }
      void y;
    }
  }


}
