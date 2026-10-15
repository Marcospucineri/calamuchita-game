import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paintedMaterial } from '../render/PaintedMaterial';
import type { BoxCollider } from './Buildings';
import { Building, GROUND, WorldData } from './WorldData';

/**
 * Calles comerciales:
 *  - VGB, Av. San Martín (desde la rotonda de Las Magnolias) y Av. Roca hasta Julio Kochmann:
 *    locales centroeuropeos de dos plantas con un deck de madera en la vereda (deck.glb).
 *  - Av. Las Magnolias: algunos locales grandes (locales-magnolias.glb) en terrenos libres.
 *  - Los Reartes, Av. San Martín desde la capilla hasta la ruta S-271: locales comerciales comunes
 *    (se completan los terrenos vacíos).
 *  - Villa Ciudad Parque, Boulevard Los Reartes: locales comunes alternados con las casas.
 * Todo se calcula al cargar, a partir de las calles y casas de OSM, y siempre da el mismo resultado.
 */

type ShopKind = 'centro' | 'local';

interface Seg { ax: number; an: number; bx: number; bn: number; hw: number }
/** Frente de un local: centro, tangente (a lo largo) y normal hacia la calle, en coordenadas del mapa. */
interface Front { b: Building; kind: ShopKind; cx: number; cn: number; tx: number; tn: number; nx: number; nn: number; hl: number; gap: number; sign: number; awning: number }
interface Site { x: number; n: number; y: number; rot: number; sx: number }

export interface ShopPlan { fronts: Front[]; decks: Site[]; magnolias: Site[]; colliders: BoxCollider[] }

const LOCAL_STYLES = ['localA', 'localB', 'localC'];
const NOT_SHOPS = new Set(['church', 'chapel', 'townhall', 'school', 'hospital', 'police', 'fire_station', 'civic', 'public', 'government', 'roof', 'garage', 'garages', 'shed', 'hangar']);

const SIGNS: Record<ShopKind, string[]> = {
  centro: ['Konditorei', 'Bierstube', 'Chocolates', 'Regionales', 'Café Vienés', 'Strudel', 'Ahumados', 'Alfajores',
    'Cervecería', 'Artesanías', 'Panadería Alpina', 'Fiambres', 'Tejidos', 'Salón de Té', 'Recuerdos', 'Dulces Caseros'],
  local: ['Almacén', 'Kiosco', 'Despensa', 'Ferretería', 'Panadería', 'Verdulería', 'Farmacia', 'Librería',
    'Carnicería', 'Heladería', 'Regalería', 'Rotisería', 'Forrajería', 'Pinturería', 'Mercería', 'Pizzería'],
};

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (x: number, n: number) => Math.abs(Math.floor(x * 73.13) * 31 + Math.floor(n * 17.71) * 131) % 9973;

/** Tramos de las calles con esos nombres; si se dan A y B, solo los que quedan entre ambos puntos. */
function corridor(w: WorldData, names: string[], A?: [number, number], B?: [number, number], width = 150): Seg[] {
  const out: Seg[] = [];
  let ux = 0, un = 0, L = 0;
  if (A && B) { L = Math.hypot(B[0] - A[0], B[1] - A[1]); ux = (B[0] - A[0]) / L; un = (B[1] - A[1]) / L; }
  for (const r of w.roads) {
    if (!names.includes(r.name)) continue;
    const p = r.p;
    for (let k = 3; k < p.length; k += 3) {
      const s = { ax: p[k - 3], an: p[k - 2], bx: p[k], bn: p[k + 1], hw: r.width / 2 };
      if (A && B) {
        const mx = (s.ax + s.bx) / 2 - A[0], mn = (s.an + s.bn) / 2 - A[1];
        const t = mx * ux + mn * un, q = Math.abs(-mx * un + mn * ux);
        if (t < -5 || t > L + 5 || q > width) continue;
      }
      out.push(s);
    }
  }
  return out;
}

/** Recorre las calles con esos nombres cada `step` metros (por largo de recorrido, no por tramo). */
function walk(w: WorldData, names: string[], step: number, cb: (x: number, n: number, tx: number, tn: number, hw: number, s: number, id: number) => void): void {
  for (const r of w.roads) {
    if (!names.includes(r.name)) continue;
    const p = r.p;
    let acc = 0, next = 0;
    for (let k = 3; k < p.length; k += 3) {
      const ax = p[k - 3], an = p[k - 2], dx = p[k] - ax, dn = p[k + 1] - an, L = Math.hypot(dx, dn);
      if (L < 1e-6) continue;
      while (next <= acc + L) {
        const t = (next - acc) / L;
        cb(ax + dx * t, an + dn * t, dx / L, dn / L, r.width / 2, next, r.id);
        next += step;
      }
      acc += L;
    }
  }
}

function closest(segs: Seg[], x: number, n: number): { d: number; s: Seg; px: number; pn: number; tx: number; tn: number } | null {
  let best: { d: number; s: Seg; px: number; pn: number; tx: number; tn: number } | null = null;
  for (const s of segs) {
    const dx = s.bx - s.ax, dn = s.bn - s.an, L2 = dx * dx + dn * dn || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (n - s.an) * dn) / L2));
    const px = s.ax + t * dx, pn = s.an + t * dn;
    const d = Math.hypot(x - px, n - pn);
    if (!best || d < best.d) { const L = Math.sqrt(L2); best = { d, s, px, pn, tx: dx / L, tn: dn / L }; }
  }
  return best;
}

/** ¿El punto cae dentro (o cerca) de alguna casa? */
function inBuilding(list: Building[], x: number, n: number, margin: number): boolean {
  for (const b of list) {
    const dx = x - b.x, dn = n - b.n;
    if (Math.abs(dx) > 60 || Math.abs(dn) > 60) continue;
    const c = Math.cos(b.r), s = Math.sin(b.r);
    if (Math.abs(dx * c + dn * s) < b.w / 2 + margin && Math.abs(-dx * s + dn * c) < b.d / 2 + margin) return true;
  }
  return false;
}

/**
 * Decide qué casas son locales y dónde van los modelos. Hay que llamarlo antes de armar
 * edificios y vegetación: cambia estilos, agrega locales nuevos y saca árboles de los terrenos.
 */
export function planShops(w: WorldData): ShopPlan {
  const plan: ShopPlan = { fronts: [], decks: [], magnolias: [], colliders: [] };
  const clear: { x: number; n: number; r: number }[] = [];
  const near = (x: number, n: number) => w.buildings.filter((b) => Math.abs(b.x - x) < 80 && Math.abs(b.n - n) < 80);

  /** Casas que dan a la calle del corredor, con el lado que mira a la calle. */
  const facing = (segs: Seg[], names: string[], maxGap = 14) => {
    const out: Front[] = [];
    for (const b of w.buildings) {
      if (NOT_SHOPS.has(b.k) || b.w > 45 || b.d > 45 || Math.max(b.w, b.d) < 5) continue;
      const cl = closest(segs, b.x, b.n);
      if (!cl || cl.d > 60) continue;
      const nr = w.nearestRoad(b.x, b.n);
      const c = Math.cos(b.r), s = Math.sin(b.r);
      const ox = (cl.px - b.x) / (cl.d || 1), on = (cl.pn - b.n) / (cl.d || 1);
      // las cuatro caras: normal y semiextensión (hacia afuera / a lo largo)
      const faces = [
        { nx: c, nn: s, e: b.w / 2, l: b.d / 2 }, { nx: -c, nn: -s, e: b.w / 2, l: b.d / 2 },
        { nx: -s, nn: c, e: b.d / 2, l: b.w / 2 }, { nx: s, nn: -c, e: b.d / 2, l: b.w / 2 },
      ];
      let f = faces[0], dot = -2;
      for (const q of faces) { const d = q.nx * ox + q.nn * on; if (d > dot) { dot = d; f = q; } }
      if (dot < 0.72) continue;
      const cx = b.x + f.nx * f.e, cn = b.n + f.nn * f.e;
      const fc = closest(segs, cx, cn)!;
      const gap = fc.d - fc.s.hw;
      if (gap < -0.5 || gap > maxGap || f.l < 2.6) continue;
      // si en realidad da a otra calle más cercana, no es de este corredor
      if (nr && !names.includes(nr.road.name) && gap > 6 && nr.dist < cl.d - 3) continue;
      out.push({ b, kind: 'local', cx, cn, tx: -f.nn, tn: f.nx, nx: f.nx, nn: f.nn, hl: f.l, gap, sign: 0, awning: 0 });
    }
    return out;
  };

  // --- Villa General Belgrano: San Martín (rotonda) → Roca → Julio Kochmann
  const vgbNames = ['Avenida San Martín', 'Avenida Julio Argentino Roca'];
  const vgb = corridor(w, vgbNames, [205, 615], [-162, -603]);
  for (const f of facing(vgb, vgbNames)) {
    f.kind = 'centro';
    f.b.s = 'alpino';
    f.b.l = Math.max(f.b.l, 2);
    f.sign = hash(f.b.x, f.b.n) % SIGNS.centro.length;
    plan.fronts.push(f);
    const len = 2 * f.hl - 0.8;
    if (f.gap >= 2.3 && len >= 4) {
      const dx = f.cx + f.nx * 0.04, dn = f.cn + f.nn * 0.04;
      const mid = { x: dx + f.nx * 0.85, n: dn + f.nn * 0.85 };
      const y = Math.min(w.heightAt(mid.x, mid.n), f.b.y) - 0.04;
      const rot = Math.atan2(-f.nx, f.nn);
      plan.decks.push({ x: dx, n: dn, y, rot, sx: len / DECK_LEN });
      plan.colliders.push({ x: mid.x, y: y + 0.6, z: -mid.n, hx: len / 2, hy: 0.6, hz: 0.85, rotY: rot });
    }
  }

  // --- VGB: zonas marcadas en notas del modo debug
  const inPolyS = (x: number, n: number, poly: number[][]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, ni] = poly[i], [xj, nj] = poly[j];
      if ((ni > n) !== (nj > n) && x < ((xj - xi) * (n - ni)) / (nj - ni) + xi) c = !c;
    }
    return c;
  };
  const already = new Set(plan.fronts.map((f) => f.b));
  // Nota 6ad01e00…: locales comerciales que dan a Av. Comechingones (todas las casas del tramo + terrenos vacíos)
  {
    const zone = [[493, 627], [469, 627], [468, 542], [509, 547]];
    const names = ['Avenida Comechingones'];
    const segs = corridor(w, names);
    const zr = rng(4317);
    const free = new Map<string, number>();
    walk(w, names, 2, (px, pn, tx, tn, hw, s, id) => {
      for (const side of [-1, 1]) {
        const key = `${id}|${side}`;
        if (s < (free.get(key) ?? 0)) continue;
        const nx = -tn * side, nn = tx * side;
        const W = 9 + zr() * 4, D = 8 + zr() * 3;
        const off = hw + 3 + D / 2;
        const x = px + tx * (W / 2) + nx * off, n = pn + tn * (W / 2) + nn * off;
        if (!inPolyS(x, n, zone)) continue;
        if (lotFree(w, x, n, tx, tn, W, D, near(x, n), [])) {
          const ys = corners(x, n, tx, tn, W, D).map(([cx, cn]) => w.heightAt(cx, cn));
          if (Math.max(...ys) - Math.min(...ys) < 2.2) {
            w.buildings.push({ x, n, r: Math.atan2(tn, tx), w: W, d: D, l: 1, s: 'localA', y: Math.min(...ys), k: 'retail' });
            clear.push({ x, n, r: Math.hypot(W, D) / 2 + 1.5 });
            free.set(key, s + W + 2 + zr() * 5);
            continue;
          }
        }
        free.set(key, s + 3);
      }
    });
    for (const f of facing(segs, names, 12)) {
      if (already.has(f.b) || !inPolyS(f.b.x, f.b.n, zone)) continue;
      asLocal(f);
      plan.fronts.push(f);
      already.add(f.b);
    }
  }
  // Nota 6ad01d84…: locales comunes intercalados con las casas sobre Av. Ojo de Agua
  {
    const zone = [[225, -214], [8, -132], [-10, -169], [213, -264]];
    const names = ['Avenida Ojo de Agua'];
    const segs = corridor(w, names);
    const list = facing(segs, names, 14).filter((f) => !already.has(f.b) && inPolyS(f.b.x, f.b.n, zone));
    const A = segs[0];
    if (A) {
      const dx = segs[segs.length - 1].bx - A.ax, dn = segs[segs.length - 1].bn - A.an;
      const key = (f: Front) => (f.b.x - A.ax) * dx + (f.b.n - A.an) * dn;
      for (const side of [-1, 1]) {
        list.filter((f) => Math.sign((f.b.x - A.ax) * dn - (f.b.n - A.an) * dx) === side).sort((a, b) => key(a) - key(b))
          .forEach((f, i) => { if (i % 2 === 0) { asLocal(f); plan.fronts.push(f); already.add(f.b); } });
      }
    }
  }

  // --- Los Reartes: San Martín desde la capilla hasta la ruta S-271 (completa terrenos vacíos)
  const lrNames = ['Avenida San Martín'];
  const lr = corridor(w, lrNames, [-1603, 6391], [-1824, 5728], 120);
  const avoid = w.pois.filter((p) => Math.hypot(p.x + 1700, p.n - 6100) < 900).map((p) => ({ x: p.x, n: p.n }));
  const rnd = rng(2024);
  const nextFree = new Map<string, number>();
  walk(w, lrNames, 2, (px, pn, tx, tn, hw, s, id) => {
    const cl = closest(lr, px, pn);
    if (!cl || cl.d > 1) return; // fuera del tramo capilla → ruta
    for (const side of [-1, 1]) {
      const key = `${id}|${side}`;
      if (s < (nextFree.get(key) ?? 0)) continue;
      const nx = -tn * side, nn = tx * side; // de la calle hacia el terreno
      const W = 9 + rnd() * 5, D = 8 + rnd() * 3;
      const off = hw + 3 + D / 2;
      const x = px + tx * (W / 2) + nx * off, n = pn + tn * (W / 2) + nn * off;
      if (lotFree(w, x, n, tx, tn, W, D, near(x, n), avoid)) {
        const ys = corners(x, n, tx, tn, W, D).map(([cx, cn]) => w.heightAt(cx, cn));
        if (Math.max(...ys) - Math.min(...ys) < 2.2) {
          w.buildings.push({ x, n, r: Math.atan2(tn, tx), w: W, d: D, l: 1, s: 'localA', y: Math.min(...ys), k: 'retail' });
          clear.push({ x, n, r: Math.hypot(W, D) / 2 + 1.5 });
          nextFree.set(key, s + W + 3 + rnd() * 10);
          continue;
        }
      }
      nextFree.set(key, s + 4);
    }
  });
  for (const f of facing(lr, lrNames, 9)) {
    if (Math.hypot(f.b.x + 1603, f.b.n - 6391) > 760) continue;
    asLocal(f);
    plan.fronts.push(f);
  }

  // --- Villa Ciudad Parque: Boulevard Los Reartes, locales alternados con casas
  const vcpNames = ['Boulevard Los Reartes'];
  const vcp = corridor(w, vcpNames);
  const vf = facing(vcp, vcpNames, 10);
  if (vf.length) {
    const A = vcp[0], dx = vcp[vcp.length - 1].bx - A.ax, dn = vcp[vcp.length - 1].bn - A.an;
    const key = (f: Front) => (f.b.x - A.ax) * dx + (f.b.n - A.an) * dn;
    for (const side of [-1, 1]) {
      const list = vf.filter((f) => Math.sign((f.b.x - A.ax) * dn - (f.b.n - A.an) * dx) === side).sort((a, b) => key(a) - key(b));
      list.forEach((f, i) => { if (i % 2 === 0) { asLocal(f); plan.fronts.push(f); } });
    }
  }

  // --- Av. Las Magnolias: algunos locales grandes en terrenos libres
  const botella = w.meta.landmarks?.find((l) => l.type === 'botella');
  const taken: { x: number; n: number; side: number }[] = [];
  const mrnd = rng(77);
  walk(w, ['Avenida Las Magnolias'], 12, (px, pn, tx, tn, hw) => {
    if (plan.magnolias.length >= 7) return;
    if (Math.hypot(px - 230, pn - 628) < 90) return; // rotonda
    if (botella && Math.hypot(px - botella.x, pn - botella.n) < 70) return;
    const side = mrnd() < 0.5 ? -1 : 1;
    for (const sd of [side, -side]) {
      if (taken.some((q) => Math.hypot(q.x - px, q.n - pn) < (q.side === sd ? 170 : 90))) continue;
      const nx = -tn * sd, nn = tx * sd;
      const front = hw + 6;
      const cx = px + nx * (front + MAG_D / 2), cn = pn + nn * (front + MAG_D / 2);
      if (!lotFree(w, cx, cn, tx, tn, MAG_W + 2, MAG_D + 2, near(cx, cn), [])) continue;
      const ys = corners(cx, cn, tx, tn, MAG_W, MAG_D).map(([qx, qn]) => w.heightAt(qx, qn));
      if (Math.max(...ys) - Math.min(...ys) > 2.6) continue;
      const fx = px + nx * front, fn = pn + nn * front;
      const y = Math.min(...ys) - 0.3;
      const rot = Math.atan2(-nx, nn);
      plan.magnolias.push({ x: fx, n: fn, y, rot, sx: 1 });
      plan.colliders.push({ x: cx, y: y + 3.6, z: -cn, hx: MAG_W / 2, hy: 3.6, hz: MAG_D / 2, rotY: rot });
      clear.push({ x: cx, n: cn, r: Math.hypot(MAG_W, MAG_D) / 2 + 2 });
      taken.push({ x: px, n: pn, side: sd });
      break;
    }
  });

  // sacar árboles de los terrenos ocupados
  if (clear.length) {
    const t = w.trees, keep: number[] = [];
    for (let i = 0; i < t.length; i += 4) {
      const x = t[i], n = t[i + 1];
      if (!clear.some((c) => Math.abs(c.x - x) < c.r && Math.abs(c.n - n) < c.r && Math.hypot(c.x - x, c.n - n) < c.r)) keep.push(t[i], t[i + 1], t[i + 2], t[i + 3]);
    }
    w.trees = new Float32Array(keep);
  }
  return plan;
}

function asLocal(f: Front): void {
  const h = hash(f.b.x, f.b.n);
  f.kind = 'local';
  f.b.s = LOCAL_STYLES[h % LOCAL_STYLES.length];
  f.sign = (h >> 2) % SIGNS.local.length;
  f.awning = (h >> 5) % 4;
}

function corners(x: number, n: number, tx: number, tn: number, W: number, D: number): [number, number][] {
  const out: [number, number][] = [];
  for (const a of [-W / 2, W / 2]) for (const b of [-D / 2, D / 2]) out.push([x + tx * a - tn * b, n + tn * a + tx * b]);
  out.push([x, n]);
  return out;
}

/** Terreno libre: sin calles, casas, agua ni lugares importantes encima. */
function lotFree(w: WorldData, x: number, n: number, tx: number, tn: number, W: number, D: number, houses: Building[], avoid: { x: number; n: number }[]): boolean {
  if (avoid.some((p) => Math.hypot(p.x - x, p.n - n) < Math.hypot(W, D) / 2 + 14)) return false;
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      const a = (i / 4 - 0.5) * W, b = (j / 4 - 0.5) * D;
      const px = x + tx * a - tn * b, pn = n + tn * a + tx * b;
      const r = w.nearestRoad(px, pn);
      if (r && r.dist < r.road.width / 2 + 1.2) return false;
      if (w.groundAt(px, pn) === GROUND.BANK) return false;
      if (inBuilding(houses, px, pn, 1.5)) return false;
    }
  }
  return !houses.some((b) => Math.abs((b.x - x) * tx + (b.n - n) * tn) < W / 2 + 1 && Math.abs(-(b.x - x) * tn + (b.n - n) * tx) < D / 2 + 1);
}

// ------------------------------------------------------------------ geometría y modelos

const DECK_LEN = 17.64;
const MAG_W = 18.6, MAG_D = 17.7;

interface Builder { pos: number[]; uv: number[]; idx: number[] }
const newB = (): Builder => ({ pos: [], uv: [], idx: [] });
function quad(B: Builder, p: number[][], uv: number[]): void {
  const base = B.pos.length / 3;
  for (const v of p) B.pos.push(v[0], v[1], v[2]);
  B.uv.push(...uv);
  B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function geo(B: Builder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
  g.setIndex(B.idx);
  g.computeVertexNormals();
  return g;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}
function tex(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Vidriera de 5,2 m: dos vidrieras y una puerta. */
function storefrontTexture(kind: ShopKind): THREE.CanvasTexture {
  const [c, g] = canvas(512, 256);
  const frame = kind === 'centro' ? '#4a2e1c' : '#9aa1a4';
  g.fillStyle = frame;
  g.fillRect(0, 0, 512, 256);
  if (kind === 'local') { g.fillStyle = '#7d8487'; g.fillRect(0, 0, 512, 22); } // cajón de la persiana
  const glass = (x: number, y: number, w: number, h: number) => {
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, '#30444f'); gr.addColorStop(1, '#1d2a31');
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    // mercadería en exhibición
    for (let i = 0; i < 9; i++) {
      g.fillStyle = ['#c9a25b', '#b5523b', '#e8dcc0', '#6f8f5a', '#d98b3a'][i % 5];
      const bw = 10 + ((i * 37) % 14), bh = 12 + ((i * 53) % 22);
      g.fillRect(x + 10 + ((i * 47) % (w - 30)), y + h - 18 - bh, bw, bh);
    }
    g.fillStyle = 'rgba(70,50,35,0.85)'; g.fillRect(x, y + h - 18, w, 6); // estante
    g.fillStyle = 'rgba(215,235,245,0.22)';
    g.beginPath(); g.moveTo(x + w * 0.15, y); g.lineTo(x + w * 0.42, y); g.lineTo(x + w * 0.12, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h * 0.6); g.fill();
  };
  const top = kind === 'local' ? 30 : 16;
  glass(14, top, 180, 220 - top);
  glass(318, top, 180, 220 - top);
  // puerta
  if (kind === 'centro') {
    g.fillStyle = '#6b4128'; g.fillRect(212, top, 88, 240 - top);
    glass(222, top + 12, 68, 110);
    g.fillStyle = '#d9b46a'; g.fillRect(284, 150, 6, 18);
  } else {
    glass(214, top, 84, 240 - top);
    g.fillStyle = '#c9cfd2'; g.fillRect(286, 120, 5, 40);
  }
  g.fillStyle = kind === 'centro' ? '#3a2416' : '#6d7376';
  g.fillRect(0, 232, 512, 24); // zócalo
  return tex(c, true);
}

/** Atlas de carteles: columna 0 centroeuropeos, columna 1 comunes; 16 filas de 512×64. */
function signAtlas(): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 1024);
  const fit = (text: string, font: (s: number) => string, max: number, size: number) => {
    let s = size;
    g.font = font(s);
    while (g.measureText(text).width > max && s > 14) { s -= 2; g.font = font(s); }
  };
  SIGNS.centro.forEach((name, i) => {
    const y = i * 64;
    g.fillStyle = '#3d2616'; g.fillRect(0, y, 512, 64);
    g.strokeStyle = '#d8b878'; g.lineWidth = 3; g.strokeRect(8, y + 7, 496, 50);
    g.fillStyle = '#d8b878';
    for (const x of [22, 490]) { g.beginPath(); g.arc(x, y + 32, 5, 0, Math.PI * 2); g.fill(); }
    fit(name, (s) => `italic bold ${s}px Georgia, 'Times New Roman', serif`, 420, 38);
    g.fillStyle = '#f2dca0'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, 256, y + 34);
  });
  const palette = [['#c8442f', '#fff7ea'], ['#2f6d8a', '#fff7ea'], ['#3f7a46', '#fff7ea'], ['#e0a52c', '#3a2a1a'], ['#7a3f6d', '#fff7ea'], ['#f2ece0', '#2c3a44']];
  SIGNS.local.forEach((name, i) => {
    const y = i * 64, [bg, fg] = palette[i % palette.length];
    g.fillStyle = bg; g.fillRect(512, y, 512, 64);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(512, y + 56, 512, 8);
    fit(name.toUpperCase(), (s) => `900 ${s}px 'Arial Black', Helvetica, Arial, sans-serif`, 440, 36);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name.toUpperCase(), 768, y + 31);
  });
  const t = tex(c);
  t.generateMipmaps = true;
  return t;
}

/** Toldos a rayas: 4 colores en franjas horizontales de 64 px. */
function awningTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  ['#c8442f', '#3f7a46', '#2f6d8a', '#e09a2c'].forEach((col, k) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#f4ecdc' : col;
      g.fillRect(i * 32, k * 64, 32, 64);
    }
  });
  return tex(c, true);
}

/** Vidrieras, carteles, toldos y los modelos de deck y locales. */
export class ShopDecor {
  readonly group = new THREE.Group();

  constructor(private plan: ShopPlan, scene: THREE.Scene) {
    const fronts = { centro: newB(), local: newB() };
    const signs = newB(), awnings = newB();
    for (const f of plan.fronts) {
      const base = f.b.y;
      const P = (s: number, y: number, off: number) => [f.cx + f.tx * s + f.nx * off, y, -(f.cn + f.tn * s + f.nn * off)];
      // vidriera
      const s0 = -f.hl + 0.45, s1 = f.hl - 0.45;
      const u1 = (s1 - s0) / 5.2;
      const y0 = base + 0.25, y1 = base + 2.45;
      quad(fronts[f.kind], [P(s0, y0, 0.05), P(s1, y0, 0.05), P(s1, y1, 0.05), P(s0, y1, 0.05)], [0, 0, u1, 0, u1, 1, 0, 1]);
      // cartel (proporción 8:1, igual que el atlas)
      const sh = Math.min(f.kind === 'centro' ? 0.72 : 0.6, (2 * f.hl - 1.2) / 8);
      const sw = sh * 8;
      const sy = base + (f.kind === 'centro' ? 3.5 : 2.68);
      const col = f.kind === 'centro' ? 0 : 0.5, row = f.sign;
      const v0 = 1 - (row + 1) / 16 + 0.002, v1 = 1 - row / 16 - 0.002;
      quad(signs, [P(-sw / 2, sy, 0.1), P(sw / 2, sy, 0.1), P(sw / 2, sy + sh, 0.1), P(-sw / 2, sy + sh, 0.1)], [col + 0.002, v0, col + 0.498, v0, col + 0.498, v1, col + 0.002, v1]);
      // toldo a rayas (los centroeuropeos ya tienen el del deck)
      if (f.kind === 'local') {
        const a0 = -f.hl + 0.35, a1 = f.hl - 0.35;
        const au = (a1 - a0) / 2;
        const k = f.awning, av0 = 1 - (k + 1) / 4 + 0.01, av1 = 1 - k / 4 - 0.01;
        const out = Math.min(1.4, Math.max(0.6, f.gap - 0.4));
        const ya = base + 2.62, yb = base + 2.2;
        quad(awnings, [P(a0, ya, 0.06), P(a1, ya, 0.06), P(a1, yb, out), P(a0, yb, out)], [0, av1, au, av1, au, av0, 0, av0]);
        quad(awnings, [P(a0, yb, out), P(a1, yb, out), P(a1, yb - 0.22, out), P(a0, yb - 0.22, out)], [0, av1, au, av1, au, av0, 0, av0]);
      }
    }
    const mk = (b: Builder, mat: THREE.Material) => {
      if (!b.idx.length) return;
      const m = new THREE.Mesh(geo(b), mat);
      m.castShadow = false;
      m.receiveShadow = true;
      this.group.add(m);
    };
    const opts = { brushScale: 0.6, brushAmount: 0.06, side: THREE.DoubleSide, polygonOffset: 2 } as const;
    mk(fronts.centro, paintedMaterial({ ...opts, map: storefrontTexture('centro') }));
    mk(fronts.local, paintedMaterial({ ...opts, map: storefrontTexture('local') }));
    mk(signs, paintedMaterial({ ...opts, map: signAtlas(), brushAmount: 0.03 }));
    const aw = new THREE.Mesh(geo(awnings), paintedMaterial({ ...opts, map: awningTexture(), polygonOffset: 0 }));
    aw.castShadow = true; aw.receiveShadow = true;
    if (awnings.idx.length) this.group.add(aw);
    scene.add(this.group);
  }

  /** Carga deck.glb y locales-magnolias.glb y los repite en sus lugares. */
  async load(baseUrl: string): Promise<void> {
    const jobs: Promise<void>[] = [];
    if (this.plan.decks.length) jobs.push(this.place(`${baseUrl}models/deck.glb`, this.plan.decks, 'deck'));
    if (this.plan.magnolias.length) jobs.push(this.place(`${baseUrl}models/locales-magnolias.glb`, this.plan.magnolias, 'magnolias'));
    await Promise.all(jobs);
  }

  private async place(url: string, sites: Site[], which: 'deck' | 'magnolias'): Promise<void> {
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      // centro en X, frente sobre z = 0 (lado de la vereda en el deck, vidriera en el local), piso en y = 0
      const shift = new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -box.max.z);
      const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        let g = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(shift, m.matrixWorld));
        if (g.index) g = g.toNonIndexed();
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        const groups = g.groups.length ? g.groups : [{ start: 0, count: g.getAttribute('position').count, materialIndex: 0 }];
        for (const gr of groups) {
          const mat = mats[gr.materialIndex ?? 0];
          const part = groups.length > 1 ? sub(g, gr.start, gr.count) : g;
          let list = byMat.get(mat);
          if (!list) byMat.set(mat, (list = []));
          list.push(part);
        }
      });

      // instancias por zonas de 500 m para que la cámara descarte las lejanas
      const zones = new Map<string, Site[]>();
      for (const s of sites) {
        const k = `${Math.floor(s.x / 500)},${Math.floor(s.n / 500)}`;
        let l = zones.get(k);
        if (!l) zones.set(k, (l = []));
        l.push(s);
      }
      const dummy = new THREE.Object3D();
      for (const [src, list] of byMat) {
        const g = mergeGeometries(list, false);
        if (!g) continue;
        const mat = toPainted(src as THREE.MeshStandardMaterial, which);
        for (const zs of zones.values()) {
          const im = new THREE.InstancedMesh(g, mat, zs.length);
          zs.forEach((s, i) => {
            dummy.position.set(s.x, s.y, -s.n);
            dummy.rotation.set(0, s.rot, 0);
            dummy.scale.set(s.sx, 1, 1);
            dummy.updateMatrix();
            im.setMatrixAt(i, dummy.matrix);
          });
          im.instanceMatrix.needsUpdate = true;
          im.computeBoundingSphere();
          const transparent = (mat as THREE.Material).transparent;
          // en el deck solo el toldo y el piso dan sombra: barandas y macetas son muchos triángulos chicos
          im.castShadow = !transparent && (which === 'magnolias' || /naranja|piso/i.test(src.name));
          im.receiveShadow = true;
          this.group.add(im);
        }
      }
    } catch (e) {
      console.warn('No se pudo cargar el modelo', url, e);
    }
  }
}

function sub(g: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) {
    const at = a as THREE.BufferAttribute;
    out.setAttribute(k, new THREE.BufferAttribute((at.array as Float32Array).slice(start * at.itemSize, (start + count) * at.itemSize), at.itemSize));
  }
  return out;
}

/** Pasa los materiales de SketchUp al estilo pintado del juego. */
function toPainted(m: THREE.MeshStandardMaterial, which: 'deck' | 'magnolias'): THREE.Material {
  const name = m.name.toLowerCase();
  const glass = name.includes('vidrio');
  const plant = name.includes('bush') || name.includes('azalea');
  const p = paintedMaterial({
    map: m.map ?? undefined,
    side: THREE.DoubleSide,
    transparent: glass,
    opacity: glass ? 0.62 : 1,
    alphaTest: plant ? 0.45 : 0,
    brushScale: 0.7,
    brushAmount: 0.08,
  });
  p.color.copy(m.color);
  // el "material por defecto" de SketchUp sale gris oscuro: en el local, revoque claro
  if (which === 'magnolias' && name === 'default material') p.color.set(0xe9dfcc);
  if (glass) p.color.set(0x5a7f98);
  if (glass) p.depthWrite = false;
  return p;
}
