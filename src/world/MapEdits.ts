import * as THREE from 'three';
import { paintedMaterial } from '../render/PaintedMaterial';
import { Building, GROUND, WorldData } from './WorldData';

/**
 * Correcciones del mapa que salen de las anotaciones del modo debug (docs/DEBUG.md).
 * Cada bloque lleva el id de la nota que lo pidió. Se aplican al cargar, antes de armar
 * terreno, calles, casas y vegetación, y siempre dan el mismo resultado.
 */

type P2 = [number, number];
export interface MapExtras { pools: { x: number; n: number; y: number; w: number; d: number; r: number }[]; flags: { x: number; n: number; y: number }[] }

// ---------------------------------------------------------------- zonas (de las notas y de OSM)

/** Nota 6ad015bf4c4045906f7073f6: Boulevard Los Reartes (Villa Ciudad Parque). */
const BOULEVARD = 'Boulevard Los Reartes';
/** Nota 6ad0153f4c4045906f7073f4: barrio cerrado Champaquí Golf (polígono marcado). */
const CHAMPAQUI_BARRIO: P2[] = [[398, 2156], [268, 2064], [-477, 2215], [-621, 2050], [-734, 2004], [-767, 2236], [-742, 2550], [-656, 2671], [-145, 2631], [44, 2525], [144, 2503]];
/** Cancha real: OSM way 1151594964 "Champaquí Golf Club" (leisure=golf_course). */
const CHAMPAQUI_CANCHA: P2[] = [[-612.9, 2672.1], [-735.9, 2121.5], [-717.1, 2068.8], [-693.3, 2049], [-641.1, 2091.6], [-520.5, 2257.4], [-408.1, 2293.7], [-326.9, 2282.6], [-206.9, 2241.6], [-175.1, 2253.9], [-165.1, 2299.6], [-94.5, 2292.6], [-68.5, 2283.5], [-14.5, 2239.7], [89.9, 2206.9], [93.2, 2217.6], [172.7, 2193.2], [209.2, 2169.5], [232.1, 2180.1], [222.7, 2208.8], [206.8, 2285.5], [39.1, 2378.7], [-8.6, 2396.8], [-126.2, 2428.4], [-213.3, 2432.5], [-214.5, 2456.6], [-191, 2477.7], [-168, 2523.9], [-180.4, 2547.4], [-220, 2557.7], [-230.8, 2546.3], [-236.5, 2525], [-237.4, 2506.2], [-254.3, 2459.7], [-282.7, 2433.2], [-289.1, 2421.9], [-286, 2393.6], [-291.1, 2375.2], [-294.3, 2356.2], [-306.1, 2345.2], [-327.7, 2348.3], [-361.6, 2351.4], [-371.5, 2359.3], [-370.7, 2369.4], [-367.7, 2383], [-343.1, 2427.9], [-313.9, 2469.1], [-284.5, 2527.6], [-262.5, 2568.8], [-288.7, 2576.1], [-301.6, 2538.6], [-363.4, 2474.1], [-406.9, 2404.4], [-483.4, 2365.8], [-567, 2356.4], [-491.1, 2641.7]];
/** Nota 6ad0146f4c4045906f7073f3: barrio Villa Galicia (Villa Ciudad Parque). */
const VILLA_GALICIA: P2[] = [[1126, 6650], [1269, 7098], [1350, 7241], [978, 7347], [827, 7268], [-757, 7754], [-914, 7421], [-286, 7109], [-242, 7031]];
/** Nota 6ad0144b4c4045906f7073f2: barrio El Cedrón (Villa Ciudad Parque). */
const EL_CEDRON: P2[] = [[1979, 7588], [2243, 8427], [-490, 9114], [-690, 8962], [-525, 8270]];
/** Plaza de El Cedrón: OSM way 1182759948 (leisure=park). */
const PLAZA_CEDRON: P2[] = [[-326.9, 8406.7], [-340.6, 8348.7], [-357.7, 8370.4], [-368, 8390.7], [-374.7, 8410.7], [-375.4, 8419.4]];

// ---------------------------------------------------------------- utilidades

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
const hash01 = (x: number, n: number) => { const s = Math.sin(x * 12.9898 + n * 78.233) * 43758.5453; return s - Math.floor(s); };

function inPoly(x: number, n: number, poly: P2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, ni] = poly[i], [xj, nj] = poly[j];
    if ((ni > n) !== (nj > n) && x < ((xj - xi) * (n - ni)) / (nj - ni) + xi) c = !c;
  }
  return c;
}
/** Distancia al borde del polígono. */
function edgeDist(x: number, n: number, poly: P2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) best = Math.min(best, segDist(x, n, poly[j], poly[i]).d);
  return best;
}
function segDist(x: number, n: number, a: P2, b: P2): { d: number; px: number; pn: number } {
  const dx = b[0] - a[0], dn = b[1] - a[1], L2 = dx * dx + dn * dn || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (n - a[1]) * dn) / L2));
  const px = a[0] + t * dx, pn = a[1] + t * dn;
  return { d: Math.hypot(x - px, n - pn), px, pn };
}
function polyline(p: number[]): P2[] { const out: P2[] = []; for (let k = 0; k < p.length; k += 3) out.push([p[k], p[k + 1]]); return out; }
function nearestOnLine(x: number, n: number, line: P2[]): { d: number; px: number; pn: number } {
  let best = { d: Infinity, px: x, pn: n };
  for (let i = 1; i < line.length; i++) { const s = segDist(x, n, line[i - 1], line[i]); if (s.d < best.d) best = s; }
  return best;
}
function bbox(poly: P2[]): [number, number, number, number] {
  const xs = poly.map((p) => p[0]), ns = poly.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ns), Math.max(...xs), Math.max(...ns)];
}
function inBuilding(list: Building[], x: number, n: number, margin: number): boolean {
  for (const b of list) {
    const dx = x - b.x, dn = n - b.n;
    if (Math.abs(dx) > 40 || Math.abs(dn) > 40) continue;
    const c = Math.cos(b.r), s = Math.sin(b.r);
    if (Math.abs(dx * c + dn * s) < b.w / 2 + margin && Math.abs(-dx * s + dn * c) < b.d / 2 + margin) return true;
  }
  return false;
}
function onRoad(w: WorldData, x: number, n: number, margin: number): boolean {
  const r = w.nearestRoad(x, n);
  return !!r && r.dist < r.road.width / 2 + margin;
}
/** Recorre una polilínea cada `step` metros. */
function walk(line: P2[], step: number, cb: (x: number, n: number, tx: number, tn: number) => void): void {
  let acc = 0, next = step / 2;
  for (let i = 1; i < line.length; i++) {
    const [ax, an] = line[i - 1], dx = line[i][0] - ax, dn = line[i][1] - an, L = Math.hypot(dx, dn);
    if (L < 1e-6) continue;
    while (next <= acc + L) { const t = (next - acc) / L; cb(ax + dx * t, an + dn * t, dx / L, dn / L); next += step; }
    acc += L;
  }
}

/** Índice de tramos por celdas: distancia exacta hasta `pad` metros, Infinity más lejos. */
class SegIndex {
  private cells = new Map<string, [P2, P2][]>();
  constructor(lines: P2[][], private pad: number, private C = 25) {
    for (const l of lines) for (let i = 1; i < l.length; i++) {
      const a = l[i - 1], b = l[i];
      for (let gx = Math.floor((Math.min(a[0], b[0]) - pad) / C); gx <= Math.floor((Math.max(a[0], b[0]) + pad) / C); gx++)
        for (let gn = Math.floor((Math.min(a[1], b[1]) - pad) / C); gn <= Math.floor((Math.max(a[1], b[1]) + pad) / C); gn++) {
          const k = `${gx},${gn}`;
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push([a, b]);
        }
    }
  }
  nearest(x: number, n: number): { d: number; px: number; pn: number } | null {
    const l = this.cells.get(`${Math.floor(x / this.C)},${Math.floor(n / this.C)}`);
    if (!l) return null;
    let best: { d: number; px: number; pn: number } | null = null;
    for (const [a, b] of l) { const q = segDist(x, n, a, b); if (!best || q.d < best.d) best = q; }
    return best && best.d <= this.pad ? best : null;
  }
  dist(x: number, n: number): number {
    const l = this.cells.get(`${Math.floor(x / this.C)},${Math.floor(n / this.C)}`);
    if (!l) return Infinity;
    let d = Infinity;
    for (const [a, b] of l) d = Math.min(d, segDist(x, n, a, b).d);
    return d <= this.pad ? d : Infinity;
  }
}

/** Árboles: se marcan para borrar y se agregan aparte; al final se arma el arreglo nuevo. */
class TreeEdit {
  readonly n: number;
  readonly del: Uint8Array;
  readonly added: number[] = [];
  private grid = new Map<string, number[]>(); // ocupación (solo donde se planta)
  constructor(readonly base: Float32Array) { this.n = base.length / 4; this.del = new Uint8Array(this.n); }
  x(i: number) { return this.base[i * 4]; }
  y(i: number) { return this.base[i * 4 + 1]; }
  /** Índices vivos dentro de un rectángulo. */
  each(x0: number, n0: number, x1: number, n1: number, cb: (i: number, x: number, n: number) => void): void {
    const b = this.base;
    for (let i = 0; i < this.n; i++) {
      if (this.del[i]) continue;
      const x = b[i * 4], n = b[i * 4 + 1];
      if (x >= x0 && x <= x1 && n >= n0 && n <= n1) cb(i, x, n);
    }
  }
  mark(x: number, n: number): void {
    const k = `${Math.floor(x / 8)},${Math.floor(n / 8)}`;
    let l = this.grid.get(k);
    if (!l) this.grid.set(k, (l = []));
    l.push(x, n);
  }
  occupied(x: number, n: number, r: number): boolean {
    for (let gx = Math.floor((x - r) / 8); gx <= Math.floor((x + r) / 8); gx++)
      for (let gn = Math.floor((n - r) / 8); gn <= Math.floor((n + r) / 8); gn++) {
        const l = this.grid.get(`${gx},${gn}`);
        if (l) for (let k = 0; k < l.length; k += 2) if (Math.hypot(l[k] - x, l[k + 1] - n) < r) return true;
      }
    return false;
  }
  plant(x: number, n: number, scale: number, type: number): void { this.added.push(x, n, scale, type); this.mark(x, n); }
  build(): Float32Array {
    let live = 0;
    for (let i = 0; i < this.n; i++) if (!this.del[i]) live++;
    const out = new Float32Array(live * 4 + this.added.length);
    let o = 0;
    for (let i = 0; i < this.n; i++) if (!this.del[i]) { out.set(this.base.subarray(i * 4, i * 4 + 4), o); o += 4; }
    out.set(this.added, o);
    return out;
  }
}

/** Celdas del suelo dentro de un polígono (para cambiar su tipo). */
function eachCell(w: WorldData, poly: P2[], cb: (idx: number, x: number, n: number) => void): void {
  const t = w.meta.terrain, [x0, n0, x1, n1] = bbox(poly);
  for (let j = Math.max(0, Math.floor((n0 - t.n0) / t.step)); j <= Math.min(t.H - 1, Math.ceil((n1 - t.n0) / t.step)); j++)
    for (let i = Math.max(0, Math.floor((x0 - t.x0) / t.step)); i <= Math.min(t.W - 1, Math.ceil((x1 - t.x0) / t.step)); i++) {
      const x = t.x0 + i * t.step, n = t.n0 + j * t.step;
      if (inPoly(x, n, poly)) cb(j * t.W + i, x, n);
    }
}

// ---------------------------------------------------------------- aplicar

export function applyMapEdits(w: WorldData): MapExtras {
  const extras: MapExtras = { pools: [], flags: [] };
  const trees = new TreeEdit(w.trees);

  // ===== Nota 6ad015bf…: Boulevard Los Reartes — árboles comunes a los costados y pinos en el cantero
  {
    const ways = w.roads.filter((r) => r.name === BOULEVARD && !r.rb);
    const lines = new Map(ways.map((r) => [r, polyline(r.p)]));
    // pares de calzadas (doble mano): se separan para dejar un cantero central de ~8 m
    const SHIFT = 4;
    const medians: P2[][] = [];
    for (const a of ways) {
      const la = lines.get(a)!;
      if (la.length < 4) continue;
      const mid = la[Math.floor(la.length / 2)];
      let partner: P2[] | null = null, pd = Infinity;
      for (const b of ways) if (b !== a) { const d = nearestOnLine(mid[0], mid[1], lines.get(b)!).d; if (d < pd) { pd = d; partner = lines.get(b)!; } }
      if (!partner || pd > 12) continue;
      for (let k = 0; k < a.p.length; k += 3) {
        const x = a.p[k], n = a.p[k + 1];
        const q = nearestOnLine(x, n, partner);
        if (q.d < 0.5 || q.d > 12) continue;
        const ux = (x - q.px) / q.d, un = (n - q.pn) / q.d;
        a.p[k] = x + ux * SHIFT; a.p[k + 1] = n + un * SHIFT;
      }
      // eje del cantero: punto medio entre las dos calzadas originales
      medians.push(la.map(([x, n]) => { const q = nearestOnLine(x, n, partner!); return q.d < 12 ? [(x + q.px) / 2, (n + q.pn) / 2] as P2 : [x, n] as P2; }));
    }
    w.indexRoads();
    const newLines = ways.map((r) => polyline(r.p));
    const blvd = new SegIndex(newLines, 45);
    const med = new SegIndex(medians, 6);
    const inMedian = (x: number, n: number) => med.dist(x, n) < SHIFT - 0.3;
    // las casas que quedaron pisando la calzada se corren hacia afuera
    for (const b of w.buildings) {
      const q = blvd.nearest(b.x, b.n);
      if (!q || q.d > 35 || q.d < 0.1) continue;
      const c = Math.cos(b.r), sn = Math.sin(b.r);
      const minCorner = Math.min(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, d]) => blvd.dist(b.x + c * a * b.w / 2 - sn * d * b.d / 2, b.n + sn * a * b.w / 2 + c * d * b.d / 2)));
      const need = 3.5 + 1.5 - minCorner;
      if (need > 0) { b.x += ((b.x - q.px) / q.d) * need; b.n += ((b.n - q.pn) / q.d) * need; }
    }
    // el cantero es pasto
    const t = w.meta.terrain;
    for (const m of medians) walk(m, t.step / 2, (x, n) => {
      const i = Math.round((x - t.x0) / t.step), j = Math.round((n - t.n0) / t.step);
      if (i >= 0 && j >= 0 && i < t.W && j < t.H) w.ground[j * t.W + i] = GROUND.LAWN;
    });
    // los pinos de los costados pasan a ser árboles comunes; lo que quedó en la calzada o el cantero se saca
    const all = newLines.flat();
    const [bx0, bn0, bx1, bn1] = bbox(all);
    trees.each(bx0 - 45, bn0 - 45, bx1 + 45, bn1 + 45, (i, x, n) => {
      const d = blvd.dist(x, n);
      if (d > 40) return;
      if (d < 3.5 + 1.2 || inMedian(x, n)) { trees.del[i] = 1; return; }
      if (trees.base[i * 4 + 3] === 0) { trees.base[i * 4 + 3] = 1; trees.base[i * 4 + 2] = 0.95 + hash01(x, n) * 0.4; }
      trees.mark(x, n);
    });
    const R = rng(611);
    // filas de árboles comunes a ambos lados (muy arbolada)
    for (const l of newLines) walk(l, 9, (x, n, tx, tn) => {
      for (const side of [-1, 1]) {
        const ox = -tn * side, on = tx * side;
        const px = x + ox * (3.5 + 3.2), pn = n + on * (3.5 + 3.2);
        if (inMedian(px, pn) || blvd.dist(px, pn) < 5.5) continue; // ese lado es el cantero
        if (onRoad(w, px, pn, 1.6) || inBuilding(w.buildings, px, pn, 1.2) || w.groundAt(px, pn) === GROUND.BANK || trees.occupied(px, pn, 4)) continue;
        trees.plant(px, pn, 1.0 + R() * 0.45, 1);
      }
    });
    // pinos en el cantero central
    for (const m of medians) walk(m, 8, (x, n) => {
      if (onRoad(w, x, n, 0.8) || trees.occupied(x, n, 3)) return;
      trees.plant(x, n, 0.85 + R() * 0.35, 0);
    });
  }

  // ===== Nota 6ad0144b…: El Cedrón — muy pocas casas y muy pocos árboles (salvo en las plazas)
  w.buildings = w.buildings.filter((b) => !inPoly(b.x, b.n, EL_CEDRON) || hash01(b.x, b.n) < 0.18);
  thinTrees(w, trees, EL_CEDRON, { keepFar: 0.04, keepNearHouse: 0.4, parks: [PLAZA_CEDRON] });

  // ===== Nota 6ad0146f…: Villa Galicia — pocos árboles, salvo en plazas y algunas casas
  thinTrees(w, trees, VILLA_GALICIA, { keepFar: 0.07, keepNearHouse: 0.45, parks: [] });

  // ===== Nota 6ad0153f…: Champaquí Golf — cancha de golf y pocas casas de categoría, algunas con pileta
  {
    // la cancha (contorno real de OSM): césped de fairway, greens con bandera y bunkers
    eachCell(w, CHAMPAQUI_CANCHA, (idx) => { w.ground[idx] = GROUND.FAIRWAY; });
    const [x0, n0, x1, n1] = bbox(CHAMPAQUI_CANCHA);
    const cand: P2[] = [];
    for (let x = x0; x <= x1; x += 6) for (let n = n0; n <= n1; n += 6)
      if (inPoly(x, n, CHAMPAQUI_CANCHA) && edgeDist(x, n, CHAMPAQUI_CANCHA) > 14) cand.push([x, n]);
    // greens repartidos por toda la cancha (el más alejado de los ya elegidos)
    const greens: P2[] = [];
    if (cand.length) {
      const cx = cand.reduce((a, p) => a + p[0], 0) / cand.length, cn = cand.reduce((a, p) => a + p[1], 0) / cand.length;
      greens.push(cand.reduce((best, p) => (Math.hypot(p[0] - cx, p[1] - cn) > Math.hypot(best[0] - cx, best[1] - cn) ? p : best)));
      while (greens.length < 9) {
        let best: P2 | null = null, bd = 0;
        for (const p of cand) { const d = Math.min(...greens.map((g) => Math.hypot(g[0] - p[0], g[1] - p[1]))); if (d > bd) { bd = d; best = p; } }
        if (!best || bd < 70) break;
        greens.push(best);
      }
    }
    const R = rng(1933);
    const t = w.meta.terrain;
    const paint = (cx: number, cn: number, r: number, type: number) => {
      for (let j = Math.floor((cn - r - t.n0) / t.step); j <= Math.ceil((cn + r - t.n0) / t.step); j++)
        for (let i = Math.floor((cx - r - t.x0) / t.step); i <= Math.ceil((cx + r - t.x0) / t.step); i++) {
          const x = t.x0 + i * t.step, n = t.n0 + j * t.step;
          if (Math.hypot(x - cx, n - cn) <= r && inPoly(x, n, CHAMPAQUI_CANCHA)) w.ground[j * t.W + i] = type;
        }
    };
    for (const [gx, gn] of greens) {
      paint(gx, gn, 13, GROUND.GREEN);
      extras.flags.push({ x: gx, n: gn, y: w.heightAt(gx, gn) });
      // uno o dos bunkers al costado del green
      const k = 1 + Math.floor(R() * 2), a0 = R() * Math.PI * 2;
      for (let b = 0; b < k; b++) {
        const a = a0 + b * 2.1, bx = gx + Math.cos(a) * 19, bn = gn + Math.sin(a) * 19;
        if (inPoly(bx, bn, CHAMPAQUI_CANCHA) && edgeDist(bx, bn, CHAMPAQUI_CANCHA) > 6) paint(bx, bn, 6.5, GROUND.BUNKER);
      }
    }
    // árboles: fuera de la cancha quedan algunos; dentro, solo en los bordes
    {
      const [ax0, an0, ax1, an1] = bbox(CHAMPAQUI_BARRIO);
      trees.each(ax0, an0, ax1, an1, (i, x, n) => {
        if (!inPoly(x, n, CHAMPAQUI_BARRIO)) return;
        const inCourse = inPoly(x, n, CHAMPAQUI_CANCHA);
        const keep = inCourse ? edgeDist(x, n, CHAMPAQUI_CANCHA) < 7 && hash01(x, n) < 0.5 : hash01(x, n) < 0.45;
        if (!keep) trees.del[i] = 1;
      });
    }
    // casas grandes sobre las calles internas (fuera de la cancha), algunas con pileta
    const internal = w.roads.filter((r) => r.kind !== 'tertiary' && r.kind !== 'secondary' && r.kind !== 'primary' && polyline(r.p).some(([x, n]) => inPoly(x, n, CHAMPAQUI_BARRIO)));
    let placed = 0;
    for (const r of internal) {
      const line = polyline(r.p);
      const hw = r.width / 2;
      const nextFree = [0, 0];
      let s = 0;
      walk(line, 6, (x, n, tx, tn) => {
        s += 6;
        if (placed >= 22) return;
        [-1, 1].forEach((side, si) => {
          if (s < nextFree[si] || placed >= 22) return;
          const ox = -tn * side, on = tx * side;
          const W = 15 + R() * 6, D = 11 + R() * 4;
          const off = hw + 7 + D / 2;
          const cx = x + ox * off, cn = n + on * off;
          const corners: P2[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + tx * a * W / 2 + ox * b * D / 2, cn + tn * a * W / 2 + on * b * D / 2]);
          const pts = [...corners, [cx, cn] as P2];
          const ok = pts.every(([px, pn]) => inPoly(px, pn, CHAMPAQUI_BARRIO) && !inPoly(px, pn, CHAMPAQUI_CANCHA) && edgeDist(px, pn, CHAMPAQUI_CANCHA) > 5
            && !onRoad(w, px, pn, 2) && !inBuilding(w.buildings, px, pn, 4) && w.groundAt(px, pn) !== GROUND.BANK);
          const ys = corners.map(([px, pn]) => w.heightAt(px, pn));
          if (!ok || Math.max(...ys) - Math.min(...ys) > 3) { nextFree[si] = s + 6; return; }
          w.buildings.push({ x: cx, n: cn, r: Math.atan2(tn, tx), w: W, d: D, l: R() < 0.45 ? 2 : 1, s: 'premium', y: Math.min(...ys), k: 'house' });
          placed++;
          // pileta en el fondo del lote
          if (R() < 0.6) {
            const pd = D / 2 + 5.5, px = cx + ox * pd, pn = cn + on * pd;
            if (!inPoly(px, pn, CHAMPAQUI_CANCHA) && !onRoad(w, px, pn, 3)) extras.pools.push({ x: px, n: pn, y: w.heightAt(px, pn), w: 8 + R() * 3, d: 4 + R() * 1.2, r: Math.atan2(tn, tx) });
          }
          // sin árboles encima de la casa ni de la pileta
          const rr = Math.hypot(W, D) / 2 + 9;
          trees.each(cx - rr, cn - rr, cx + rr, cn + rr, (i, tx2, tn2) => { if (Math.hypot(tx2 - cx, tn2 - cn) < rr) trees.del[i] = 1; });
          nextFree[si] = s + W + 25 + R() * 25;
        });
      });
    }
  }

  w.trees = trees.build();
  return extras;
}

/** Raleo de árboles: quedan los de las plazas, algunos cerca de las casas y muy pocos sueltos. */
function thinTrees(w: WorldData, trees: TreeEdit, area: P2[], o: { keepFar: number; keepNearHouse: number; parks: P2[][] }): void {
  const houses = w.buildings.filter((b) => inPoly(b.x, b.n, area));
  const plazas = (w.meta.landmarks ?? []).filter((l) => l.type === 'plaza');
  const [x0, n0, x1, n1] = bbox(area);
  trees.each(x0, n0, x1, n1, (i, x, n) => {
    if (!inPoly(x, n, area)) return;
    if (o.parks.some((p) => inPoly(x, n, p)) || plazas.some((p) => Math.hypot(p.x - x, p.n - n) < (p.r ?? 40))) return;
    const h = hash01(x, n);
    const keep = inBuilding(houses, x, n, 12) ? h < o.keepNearHouse : h < o.keepFar;
    if (!keep) trees.del[i] = 1;
  });
}

// ---------------------------------------------------------------- piletas y banderas

/** Piletas de las casas y banderas de los greens. */
export class MapExtrasView {
  readonly group = new THREE.Group();

  constructor(extras: MapExtras, scene: THREE.Scene) {
    const water = paintedMaterial({ color: 0x3fa9c9, brushScale: 0.6, brushAmount: 0.08, rim: 0.3 });
    const coping = paintedMaterial({ color: 0xece4d2, brushScale: 0.6, brushAmount: 0.06 });
    for (const p of extras.pools) {
      const g = new THREE.Group();
      const rim = new THREE.Mesh(new THREE.BoxGeometry(p.w + 1.6, 0.5, p.d + 1.6), coping);
      rim.position.y = 0.1;
      const pool = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.5, p.d), water);
      pool.position.y = 0.14;
      g.add(rim, pool);
      g.position.set(p.x, p.y, -p.n);
      g.rotation.y = p.r;
      g.traverse((o) => { (o as THREE.Mesh).receiveShadow = true; });
      this.group.add(g);
    }
    const pole = paintedMaterial({ color: 0xf2efe6, brushAmount: 0.05 });
    const cloth = paintedMaterial({ color: 0xc8332a, side: THREE.DoubleSide, brushAmount: 0.05 });
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5);
    poleGeo.translate(0, 1.2, 0);
    const flagGeo = new THREE.BufferGeometry();
    flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 2.35, 0, 0, 1.85, 0, 0.75, 2.1, 0], 3));
    flagGeo.computeVertexNormals();
    for (const f of extras.flags) {
      const p = new THREE.Mesh(poleGeo, pole);
      p.position.set(f.x, f.y, -f.n);
      p.castShadow = true;
      const c = new THREE.Mesh(flagGeo, cloth);
      c.position.copy(p.position);
      this.group.add(p, c);
    }
    scene.add(this.group);
  }
}
