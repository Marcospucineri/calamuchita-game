import * as THREE from 'three';
import { PALETTE } from '../core/Config';
import { paintedMaterial, sharedUniforms } from '../render/PaintedMaterial';
import { asphaltTexture, gravelTexture, pavingTexture, stoneTexture } from '../render/Textures';
import { Road, WorldData } from './WorldData';

type MatKey = 'asphalt' | 'paving' | 'gravel' | 'dirt' | 'compacted';

interface Builder { pos: number[]; uv: number[]; idx: number[] }

const TILE = 1000;

/**
 * Cintas de calles sobre el terreno ya tallado, agrupadas por material y por tile
 * de 1 km (pocas draw calls, culling por frustum).
 * También genera puentes (tablero + barandas) y la malla de colisión de cada tablero.
 */
export class Roads {
  readonly group = new THREE.Group();
  /** Triángulos de los tableros de puentes (coordenadas de mundo) para Rapier. */
  readonly bridgeColliders: { vertices: Float32Array; indices: Uint32Array }[] = [];

  constructor(private w: WorldData, scene: THREE.Scene) {
    const mats: Record<MatKey, THREE.Material> = {
      asphalt: paintedMaterial({ map: asphaltTexture(false), brushScale: 0.3, brushAmount: 0.12, polygonOffset: 3, rim: 0 }),
      paving: paintedMaterial({ map: pavingTexture(), brushScale: 0.3, brushAmount: 0.1, polygonOffset: 3, rim: 0 }),
      compacted: paintedMaterial({ map: gravelTexture(), color: 0xe8dcc8, brushScale: 0.2, brushAmount: 0.15, polygonOffset: 2, rim: 0 }),
      gravel: paintedMaterial({ map: gravelTexture(), brushScale: 0.2, brushAmount: 0.15, polygonOffset: 2, rim: 0 }),
      dirt: paintedMaterial({ map: gravelTexture(), color: 0xc9a27a, brushScale: 0.2, brushAmount: 0.2, polygonOffset: 2, rim: 0 }),
    };
    const builders = new Map<string, Builder>();
    const get = (tile: string, m: MatKey) => {
      const k = `${tile}|${m}`;
      let b = builders.get(k);
      if (!b) builders.set(k, (b = { pos: [], uv: [], idx: [] }));
      return b;
    };

    const bridgeParts: Builder = { pos: [], uv: [], idx: [] };
    const railParts: Builder = { pos: [], uv: [], idx: [] };

    for (const r of w.roads) {
      const key: MatKey = r.surface;
      const lift = r.major ? 0.1 : 0.06;
      if (r.bridge) {
        this.buildBridge(r, bridgeParts, railParts, get('0,0', key), lift);
        continue;
      }
      // partir en tiles según el primer punto de cada tramo de ~60 vértices
      const p = r.p;
      const n = p.length / 3;
      for (let s = 0; s < n - 1; s += 60) {
        const e = Math.min(n - 1, s + 60);
        const tile = `${Math.floor(p[s * 3] / TILE)},${Math.floor(p[s * 3 + 1] / TILE)}`;
        this.ribbon(r, s, e, get(tile, key), lift, true);
      }
    }

    for (const [k, b] of builders) {
      if (!b.idx.length) continue;
      const m = k.split('|')[1] as MatKey;
      const mesh = new THREE.Mesh(toGeo(b), mats[m]);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    if (bridgeParts.idx.length) {
      const deck = new THREE.Mesh(toGeo(bridgeParts), paintedMaterial({ map: stoneTexture(), color: 0xd8cfc0, brushScale: 0.3, side: THREE.DoubleSide }));
      deck.castShadow = deck.receiveShadow = true;
      this.group.add(deck);
    }
    if (railParts.idx.length) {
      const rail = new THREE.Mesh(toGeo(railParts), paintedMaterial({ color: 0x8a6a48, brushScale: 0.5, side: THREE.DoubleSide }));
      rail.castShadow = true;
      this.group.add(rail);
    }
    this.buildMarkings();
    this.buildWater();
    scene.add(this.group);
  }

  // ---------------------------------------------------------------- demarcación
  private jGrid = new Map<string, [number, number, number][]>();

  private nearJunction(x: number, n: number): boolean {
    const C = 60;
    const gx = Math.floor(x / C), gn = Math.floor(n / C);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const l = this.jGrid.get(`${gx + a},${gn + b}`);
      if (l) for (const [jx, jn, jr] of l) if (Math.hypot(x - jx, n - jn) < jr) return true;
    }
    return false;
  }

  /**
   * Líneas pintadas como capa aparte: doble amarilla + bordes blancos en rutas,
   * línea blanca discontinua en calles comunes de asfalto. Se cortan en cruces y rotondas,
   * así nunca se cruzan ni se "rompen" sobre la calzada de otra calle.
   */
  private buildMarkings(): void {
    for (const j of this.w.junctions) {
      const k = `${Math.floor(j[0] / 60)},${Math.floor(j[1] / 60)}`;
      let l = this.jGrid.get(k);
      if (!l) this.jGrid.set(k, (l = []));
      l.push(j);
    }
    const yellow = new Map<string, Builder>(), white = new Map<string, Builder>();
    const get = (m: Map<string, Builder>, t: string) => { let b = m.get(t); if (!b) m.set(t, (b = { pos: [], uv: [], idx: [] })); return b; };
    for (const r of this.w.roads) {
      if (r.surface !== 'asphalt' || r.rb || r.link || r.width < 5.8) continue;
      const p = r.p, n = p.length / 3;
      if (n < 2) continue;
      const acc = new Float32Array(n);
      for (let i = 1; i < n; i++) acc[i] = acc[i - 1] + Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2]);
      // tramos fuera de los cruces
      const spans: [number, number][] = [];
      let start = -1;
      for (let i = 0; i < n; i++) {
        const blocked = this.nearJunction(p[i * 3], p[i * 3 + 1]);
        if (!blocked && start < 0) start = i;
        if ((blocked || i === n - 1) && start >= 0) {
          const end = blocked ? i - 1 : i;
          const sa = acc[start] + (start > 0 ? 1.5 : 2), sb = acc[end] - (end < n - 1 ? 1.5 : 2);
          if (sb - sa > 4) spans.push([sa, sb]);
          start = -1;
        }
      }
      if (!spans.length) continue;
      const tile = `${Math.floor(p[0] / TILE)},${Math.floor(p[1] / TILE)}`;
      const lift = (r.major ? 0.1 : 0.06) + 0.02 + (r.bridge ? 0.37 : 0);
      const major = r.major && !!(r.ref || ['primary', 'secondary', 'trunk'].includes(r.kind));
      for (const [sa, sb] of spans) {
        if (major) {
          for (const off of [0.13, -0.13]) this.lineStrip(r, acc, sa, sb, off, 0.11, lift, get(yellow, tile));
          for (const off of [r.width / 2 - 0.35, -(r.width / 2 - 0.35)]) this.lineStrip(r, acc, sa, sb, off, 0.14, lift, get(white, tile));
        } else {
          for (let d = sa; d < sb - 1; d += 7) this.lineStrip(r, acc, d, Math.min(d + 3, sb), 0, 0.13, lift, get(white, tile));
        }
      }
    }
    const mk = (m: Map<string, Builder>, color: number) => {
      const mat = paintedMaterial({ color, brushScale: 0.6, brushAmount: 0.08, polygonOffset: 6, rim: 0, side: THREE.DoubleSide });
      for (const b of m.values()) if (b.idx.length) { const mesh = new THREE.Mesh(toGeo(b), mat); mesh.receiveShadow = true; this.group.add(mesh); }
    };
    mk(yellow, 0xe0ad2c);
    mk(white, 0xeeeadc);
  }

  /** Franja pintada entre las distancias s0 y s1 del eje, desplazada `off` metros a la izquierda. */
  private lineStrip(r: Road, acc: Float32Array, s0: number, s1: number, off: number, wdt: number, lift: number, b: Builder): void {
    const p = r.p, n = p.length / 3;
    const at = (s: number): [number, number, number, number] => {
      let i = 1;
      while (i < n - 1 && acc[i] < s) i++;
      const t = (s - acc[i - 1]) / (acc[i] - acc[i - 1] || 1);
      return [i - 1 + Math.max(0, Math.min(1, t)), 0, 0, 0];
    };
    const pts: number[] = [at(s0)[0]];
    for (let i = 1; i < n - 1; i++) if (acc[i] > s0 && acc[i] < s1) pts.push(i);
    pts.push(at(s1)[0]);
    const base = b.pos.length / 3;
    pts.forEach((f, k) => {
      const i = Math.floor(f), t = f - i;
      const i2 = Math.min(n - 1, i + 1);
      const x = p[i * 3] + (p[i2 * 3] - p[i * 3]) * t, nn = p[i * 3 + 1] + (p[i2 * 3 + 1] - p[i * 3 + 1]) * t;
      // normal suavizada en los vértices (inglete limitado)
      let ox: number, on: number;
      const seg = (a: number) => { const a2 = Math.min(n - 1, a + 1), a1 = Math.min(a, n - 2); const dx = p[a2 * 3] - p[a1 * 3], dn = p[a2 * 3 + 1] - p[a1 * 3 + 1]; const L = Math.hypot(dx, dn) || 1; return [-dn / L, dx / L]; };
      if (t === 0 && i > 0 && i < n - 1) {
        const [ax, an] = seg(i - 1), [bx, bn] = seg(i);
        let mx = ax + bx, mn = an + bn;
        const L = Math.hypot(mx, mn) || 1;
        mx /= L; mn /= L;
        const miter = Math.min(1.5, 1 / Math.max(0.5, mx * bx + mn * bn));
        ox = mx * miter; on = mn * miter;
      } else [ox, on] = seg(i);
      const lx = x + ox * (off + wdt / 2), ln = nn + on * (off + wdt / 2);
      const rx = x + ox * (off - wdt / 2), rn = nn + on * (off - wdt / 2);
      const hb = r.bridge ? p[i * 3 + 2] + (p[i2 * 3 + 2] - p[i * 3 + 2]) * t : 0;
      const hl = r.bridge ? hb : this.w.heightAt(lx, ln), hr = r.bridge ? hb : this.w.heightAt(rx, rn);
      b.pos.push(lx, hl + lift, -ln, rx, hr + lift, -rn);
      b.uv.push(0, 0, 1, 0);
      if (k) { const a = base + (k - 1) * 2, c = base + k * 2; b.idx.push(a, a + 1, c, a + 1, c + 1, c); }
    });
  }

  /** Cinta sobre el terreno: cada vértice toma la altura real del terreno. */
  private ribbon(r: Road, s: number, e: number, b: Builder, lift: number, followTerrain: boolean, hOverride?: (k: number) => number): void {
    const p = r.p;
    const half = r.width / 2;
    const base = b.pos.length / 3;
    let v = 0;
    for (let k = s; k <= e; k++) {
      const x = p[k * 3], n = p[k * 3 + 1];
      const kp = Math.max(0, k - 1), kn = Math.min(p.length / 3 - 1, k + 1);
      let dx = p[kn * 3] - p[kp * 3], dn = p[kn * 3 + 1] - p[kp * 3 + 1];
      const L = Math.hypot(dx, dn) || 1;
      dx /= L; dn /= L;
      // vector lateral (izquierda) y factor de inglete
      let ox = -dn, on = dx;
      if (k > 0 && k < p.length / 3 - 1) {
        const ax = p[k * 3] - p[kp * 3], an = p[k * 3 + 1] - p[kp * 3 + 1];
        const la = Math.hypot(ax, an) || 1;
        const cosHalf = Math.max(0.5, (ax / la) * dx + (an / la) * dn);
        const miter = 1 / Math.sqrt((1 + cosHalf) / 2);
        ox *= Math.min(miter, 1.6); on *= Math.min(miter, 1.6);
      }
      const lx = x + ox * half, ln = n + on * half, rx = x - ox * half, rn = n - on * half;
      const hl = hOverride ? hOverride(k) : followTerrain ? this.w.heightAt(lx, ln) : p[k * 3 + 2];
      const hr = hOverride ? hOverride(k) : followTerrain ? this.w.heightAt(rx, rn) : p[k * 3 + 2];
      const hc = hOverride ? hOverride(k) : followTerrain ? this.w.heightAt(x, n) : p[k * 3 + 2];
      const vv = this.distAlong(r, k) / 8;
      // tres columnas (izq, centro, der) para que la cinta siga el bombeo del terreno
      b.pos.push(lx, hl + lift, -ln, x, hc + lift, -n, rx, hr + lift, -rn);
      b.uv.push(0, vv, 0.5, vv, 1, vv);
      if (v > 0) {
        const a = base + (v - 1) * 3, c = base + v * 3;
        b.idx.push(a, a + 1, c, a + 1, c + 1, c, a + 1, a + 2, c + 1, a + 2, c + 2, c + 1);
      }
      v++;
    }
  }

  private alongCache = new Map<Road, Float32Array>();
  private distAlong(r: Road, k: number): number {
    let acc = this.alongCache.get(r);
    if (!acc) {
      const p = r.p, n = p.length / 3;
      acc = new Float32Array(n);
      for (let i = 1; i < n; i++) acc[i] = acc[i - 1] + Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2]);
      this.alongCache.set(r, acc);
    }
    return acc[k];
  }

  private buildBridge(r: Road, deck: Builder, rails: Builder, surf: Builder, lift: number): void {
    const p = r.p, n = p.length / 3;
    const h = (k: number) => p[k * 3 + 2];
    // superficie de rodamiento
    const before = surf.pos.length / 3;
    this.ribbon(r, 0, n - 1, surf, lift + 0.02, false, (k) => h(k) + 0.35);
    // colisión: misma cinta (3 columnas)
    const verts = new Float32Array(surf.pos.slice(before * 3));
    const tris: number[] = [];
    for (let k = 1; k < n; k++) {
      const a = (k - 1) * 3, c = k * 3;
      tris.push(a, a + 1, c, a + 1, c + 1, c, a + 1, a + 2, c + 1, a + 2, c + 2, c + 1);
    }
    this.bridgeColliders.push({ vertices: verts, indices: new Uint32Array(tris) });
    // tablero (losa con espesor) y barandas
    const half = r.width / 2 + 0.6;
    for (let k = 0; k < n - 1; k++) {
      const ax = p[k * 3], an = p[k * 3 + 1], bx = p[k * 3 + 3], bn = p[k * 3 + 4];
      const L = Math.hypot(bx - ax, bn - an) || 1;
      const ox = -(bn - an) / L, on = (bx - ax) / L;
      const ha = h(k) + 0.35, hb = h(k + 1) + 0.35;
      // losa: caras laterales
      for (const side of [1, -1]) {
        const sx = ox * half * side, sn = on * half * side;
        quad(deck, [ax + sx, ha + 0.05, -(an + sn)], [bx + sx, hb + 0.05, -(bn + sn)], [bx + sx, hb - 1.1, -(bn + sn)], [ax + sx, ha - 1.1, -(an + sn)], side < 0);
        // baranda: listón superior + postes
        const rx = ox * (half - 0.15) * side, rn = on * (half - 0.15) * side;
        box(rails, ax + rx, ha + 0.9, an + rn, bx + rx, hb + 0.9, bn + rn, 0.12, 0.12);
        box(rails, ax + rx, ha + 0.5, an + rn, ax + rx + (bx - ax) * 0.02, ha + 0.5, an + rn + (bn - an) * 0.02, 0.14, 0.9);
      }
      // fondo
      quad(deck, [ax + ox * half, ha - 1.1, -(an + on * half)], [bx + ox * half, hb - 1.1, -(bn + on * half)], [bx - ox * half, hb - 1.1, -(bn - on * half)], [ax - ox * half, ha - 1.1, -(an - on * half)], true);
    }
  }

  private buildWater(): void {
    const b: Builder = { pos: [], uv: [], idx: [] };
    for (const rv of this.w.rivers) {
      const p = rv.p, n = p.length / 3;
      if (n < 2) continue;
      const half = rv.width / 2 + (rv.kind === 'river' ? 3 : 1.2);
      const base = b.pos.length / 3;
      let along = 0;
      for (let k = 0; k < n; k++) {
        const kp = Math.max(0, k - 1), kn = Math.min(n - 1, k + 1);
        let dx = p[kn * 3] - p[kp * 3], dn = p[kn * 3 + 1] - p[kp * 3 + 1];
        const L = Math.hypot(dx, dn) || 1;
        dx /= L; dn /= L;
        if (k > 0) along += Math.hypot(p[k * 3] - p[k * 3 - 3], p[k * 3 + 1] - p[k * 3 - 2]);
        const x = p[k * 3], nn = p[k * 3 + 1], y = p[k * 3 + 2];
        b.pos.push(x - dn * half, y, -(nn + dx * half), x + dn * half, y, -(nn - dx * half));
        b.uv.push(0, along / 10, 1, along / 10);
        if (k > 0) {
          const a = base + (k - 1) * 2, c = base + k * 2;
          b.idx.push(a, a + 1, c, a + 1, c + 1, c);
        }
      }
    }
    const mat = new THREE.MeshLambertMaterial({ color: PALETTE.water, transparent: true, opacity: 0.82, depthWrite: false });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = sharedUniforms.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWUv; varying vec3 vWP;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvWUv = uv; vWP = (modelMatrix*vec4(position,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; varying vec2 vWUv; varying vec3 vWP;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float edge = smoothstep(0.0, 0.18, vWUv.x) * smoothstep(1.0, 0.82, vWUv.x);
          float ripple = sin(vWP.x*0.35 + uTime*1.3 + sin(vWP.z*0.21 - uTime)) * sin(vWP.z*0.3 - uTime*0.9);
          diffuseColor.rgb = mix(diffuseColor.rgb*0.85, diffuseColor.rgb*1.25 + 0.05, smoothstep(0.55, 0.95, ripple));
          diffuseColor.rgb = mix(vec3(0.62,0.58,0.45), diffuseColor.rgb, edge);
          diffuseColor.a *= mix(0.35, 1.0, edge);`,
        );
    };
    const mesh = new THREE.Mesh(toGeo(b), mat);
    mesh.renderOrder = 2;
    this.group.add(mesh);
  }
}

function toGeo(b: Builder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  if (b.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setIndex(b.idx);
  g.computeVertexNormals();
  return g;
}

function quad(b: Builder, a: number[], c: number[], d: number[], e: number[], flip: boolean): void {
  const base = b.pos.length / 3;
  b.pos.push(...a, ...c, ...d, ...e);
  b.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
  if (flip) b.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  else b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Caja orientada entre dos puntos (coords del pipeline: x, y, n). */
function box(b: Builder, ax: number, ay: number, an: number, bx: number, by: number, bn: number, wdt: number, hgt: number): void {
  const L = Math.hypot(bx - ax, bn - an) || 1;
  const ox = (-(bn - an) / L) * wdt / 2, on = ((bx - ax) / L) * wdt / 2;
  const hh = hgt / 2;
  const P = (x: number, y: number, n: number) => [x, y, -n];
  const c = [
    P(ax + ox, ay - hh, an + on), P(bx + ox, by - hh, bn + on), P(bx - ox, by - hh, bn - on), P(ax - ox, ay - hh, an - on),
    P(ax + ox, ay + hh, an + on), P(bx + ox, by + hh, bn + on), P(bx - ox, by + hh, bn - on), P(ax - ox, ay + hh, an - on),
  ];
  quad(b, c[4], c[5], c[6], c[7], false);
  quad(b, c[0], c[1], c[5], c[4], true);
  quad(b, c[3], c[2], c[6], c[7], false);
  quad(b, c[0], c[3], c[7], c[4], false);
  quad(b, c[1], c[2], c[6], c[5], true);
}
